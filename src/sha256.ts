import { extractSha256, sha256LocalFile, type HashCache } from "./hash.js";
import type { OpenListFileObject } from "./openlist.js";
import { resolveLocalPath } from "./paths.js";

export interface Sha256ServiceOptions {
  cache: HashCache;
  localRoot: string;
  basePath: string;
  concurrency: number;
}

export interface HashInput {
  path: string;
  file: OpenListFileObject;
}

export class HashComputationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HashComputationError";
  }
}

export class Sha256Service {
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(private readonly options: Sha256ServiceOptions) {}

  async getHashes(inputs: readonly HashInput[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const computed = await mapLimit(inputs, this.options.concurrency, async (input) => {
      const sha256 = await this.getHash(input.path, input.file);
      return [input.path, sha256] as const;
    });
    for (const [key, value] of computed) results.set(key, value);
    return results;
  }

  async finalize(modulePath: string, keys: readonly string[]): Promise<void> {
    this.options.cache.prune(modulePath, new Set(keys));
    await this.options.cache.save();
  }

  private async getHash(openlistPath: string, file: OpenListFileObject): Promise<string> {
    const modified = file.modified ?? "";
    const cached = this.options.cache.get(openlistPath, file.size, modified);
    if (cached) return cached;

    const dedupeKey = `${openlistPath}|${file.size}|${modified}`;
    const running = this.inflight.get(dedupeKey);
    if (running) return running;

    const task = (async () => {
      const fromOpenList = extractSha256(file);
      if (fromOpenList) {
        this.options.cache.set(openlistPath, file.size, modified, fromOpenList);
        return fromOpenList;
      }

      const localPath = resolveLocalPath(
        this.options.localRoot,
        this.options.basePath,
        openlistPath,
      );
      let computed: { sha256: string; size: number };
      try {
        computed = await sha256LocalFile(localPath);
      } catch (error) {
        throw new HashComputationError(`failed to compute SHA256 for ${file.name}`, {
          cause: error,
        });
      }

      if (computed.size !== file.size) {
        throw new HashComputationError(
          `file changed while hashing ${file.name} (expected ${file.size} bytes, read ${computed.size})`,
        );
      }

      this.options.cache.set(openlistPath, file.size, modified, computed.sha256);
      return computed.sha256;
    })();

    this.inflight.set(dedupeKey, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(dedupeKey);
    }
  }
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  operation: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await operation(items[index] as T);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
