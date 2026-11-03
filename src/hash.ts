import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenListFileObject } from "./openlist.js";

export interface HashCacheEntry {
  size: number;
  modified: string;
  sha256: string;
  updatedAt: string;
}

interface CacheFile {
  version: 1;
  entries: Record<string, HashCacheEntry>;
}

export class HashCache {
  private readonly entries = new Map<string, HashCacheEntry>();
  private saveChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<CacheFile>;
      if (parsed.version !== 1 || typeof parsed.entries !== "object" || parsed.entries === null) {
        throw new Error("unsupported cache format");
      }
      for (const [key, value] of Object.entries(parsed.entries)) {
        if (isCacheEntry(value)) this.entries.set(key, value);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`ignoring invalid hash cache ${this.filePath}: ${reason}`);
      this.entries.clear();
    }
  }

  get(key: string, size: number, modified: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.size !== size || entry.modified !== modified) return undefined;
    return entry.sha256;
  }

  set(key: string, size: number, modified: string, sha256: string): void {
    this.entries.set(key, {
      size,
      modified,
      sha256,
      updatedAt: new Date().toISOString(),
    });
  }

  prune(prefix: string, keep: ReadonlySet<string>): void {
    const directory = prefix.endsWith("/") ? prefix : `${prefix}/`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(directory) && !keep.has(key)) {
        this.entries.delete(key);
      }
    }
  }

  async save(): Promise<void> {
    const snapshot = JSON.stringify({
      version: 1,
      entries: Object.fromEntries(this.entries),
    } satisfies CacheFile);

    this.saveChain = this.saveChain.catch(() => undefined).then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporary, snapshot, "utf8");
      await rename(temporary, this.filePath);
    });

    return this.saveChain;
  }
}

function isCacheEntry(value: unknown): value is HashCacheEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HashCacheEntry>;
  return (
    typeof candidate.size === "number" &&
    typeof candidate.modified === "string" &&
    typeof candidate.sha256 === "string" &&
    /^[a-f0-9]{64}$/i.test(candidate.sha256)
  );
}

export function extractSha256(
  file: Pick<OpenListFileObject, "hash_info" | "hashinfo">,
): string | undefined {
  const direct = findSha256(file.hash_info);
  if (direct) return direct;

  const raw = file.hashinfo;
  if (typeof raw === "string" && raw.trim() !== "" && raw !== "null") {
    try {
      return findSha256(JSON.parse(raw) as unknown);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function findSha256(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (
      key.toLowerCase() === "sha256" &&
      typeof candidate === "string" &&
      /^[a-f0-9]{64}$/i.test(candidate)
    ) {
      return candidate.toLowerCase();
    }
  }
  return undefined;
}

export async function sha256LocalFile(filePath: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    size += buffer.length;
  }
  return { sha256: hash.digest("hex"), size };
}
