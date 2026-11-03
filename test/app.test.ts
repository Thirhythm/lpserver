process.env.LOG_LEVEL = "silent";

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { HashCache } from "../src/hash.js";
import type { OpenListApi, OpenListFileObject } from "../src/openlist.js";
import { Sha256Service } from "../src/sha256.js";

const API_KEY = "test-key-0123456789abcdef0123456789abcdef";
const HELLO_SHA256 = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

class FakeOpenList implements OpenListApi {
  lastPath = "";

  constructor(
    public files: OpenListFileObject[],
    public siteUrl = "https://pan.example.com",
  ) {}

  async listFiles(openlistPath: string): Promise<OpenListFileObject[]> {
    this.lastPath = openlistPath;
    return this.files;
  }

  async getSiteUrl(): Promise<string> {
    return this.siteUrl;
  }
}

interface HarnessOptions {
  files?: OpenListFileObject[];
  siteUrl?: string;
}

async function createHarness(options: HarnessOptions = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "lpserver-app-"));
  const localRoot = path.join(directory, "openlist");
  const cachePath = path.join(directory, "data", "hash-cache.json");
  await mkdir(localRoot, { recursive: true });

  const config: Config = {
    port: 3000,
    host: "127.0.0.1",
    apiKey: API_KEY,
    openlist: {
      baseUrl: "http://127.0.0.1:5244",
      basePath: "/",
      localRoot,
      timeoutMs: 5000,
    },
    hashCachePath: cachePath,
    sha256Concurrency: 2,
  };

  const openlist = new FakeOpenList(options.files ?? [], options.siteUrl);
  const cache = new HashCache(cachePath);
  await cache.load();
  const sha256 = new Sha256Service({
    cache,
    localRoot,
    basePath: "/",
    concurrency: 2,
  });
  const app = await buildApp({ config, openlist, sha256 });

  return {
    app,
    openlist,
    cache,
    localRoot,
    cachePath,
    async close() {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("health is public and API endpoints require the key", async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());

  const health = await harness.app.inject({ method: "GET", url: "/healthz" });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: "ok" });

  const missing = await harness.app.inject({
    method: "GET",
    url: "/api/download?module=sympathy",
  });
  assert.equal(missing.statusCode, 401);

  const wrong = await harness.app.inject({
    method: "GET",
    url: "/api/download?module=sympathy",
    headers: { "x-api-key": "wrong-key" },
  });
  assert.equal(wrong.statusCode, 401);
});

test("download returns sorted OpenList direct links with signature", async (t) => {
  const harness = await createHarness({
    files: [
      {
        name: "b.zip",
        size: 20,
        is_dir: false,
        modified: "2026-01-02T00:00:00Z",
        sign: "sig+/=",
      },
      {
        name: "a b#1.zip",
        size: 10,
        is_dir: false,
        modified: "2026-01-01T00:00:00Z",
      },
      { name: "subdir", size: 0, is_dir: true },
    ],
  });
  t.after(() => harness.close());

  const response = await harness.app.inject({
    method: "GET",
    url: "/api/download?module=sympathy",
    headers: { "x-api-key": API_KEY },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    module: string;
    files: Array<{ name: string; path: string; size: number; modified: string; url: string }>;
  };
  assert.equal(body.module, "sympathy");
  assert.deepEqual(
    body.files.map((file) => file.name),
    ["a b#1.zip", "b.zip"],
  );
  assert.equal(body.files[0]?.path, "SongPackages/Sympathy/a b#1.zip");
  assert.equal(
    body.files[0]?.url,
    "https://pan.example.com/d/SongPackages/Sympathy/a%20b%231.zip",
  );
  assert.equal(
    body.files[1]?.url,
    "https://pan.example.com/d/SongPackages/Sympathy/b.zip?sign=sig%2B%2F%3D",
  );
  assert.equal(harness.openlist.lastPath, "/SongPackages/Sympathy");
});

test("download accepts Authorization: Bearer", async (t) => {
  const harness = await createHarness({ files: [] });
  t.after(() => harness.close());

  const response = await harness.app.inject({
    method: "GET",
    url: "/api/download?module=sympathy",
    headers: { authorization: `Bearer ${API_KEY}` },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { module: "sympathy", files: [] });
});

test("missing or unknown module returns 400 and lists valid values", async (t) => {
  const harness = await createHarness();
  t.after(() => harness.close());

  const missing = await harness.app.inject({
    method: "GET",
    url: "/api/download",
    headers: { "x-api-key": API_KEY },
  });
  assert.equal(missing.statusCode, 400);
  assert.match(missing.json<{ message: string }>().message, /module is required/);

  const invalid = await harness.app.inject({
    method: "GET",
    url: "/api/sha256?module=other",
    headers: { "x-api-key": API_KEY },
  });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.json<{ message: string }>().message, /valid values: sympathy/);
});

test("sha256 prefers OpenList hash_info and persists it", async (t) => {
  const harness = await createHarness({
    files: [
      {
        name: "a.zip",
        size: 11,
        is_dir: false,
        modified: "2026-01-01T00:00:00Z",
        hash_info: { sha256: HELLO_SHA256.toUpperCase() },
      },
    ],
  });
  t.after(() => harness.close());

  const response = await harness.app.inject({
    method: "GET",
    url: "/api/sha256?module=sympathy",
    headers: { "x-api-key": API_KEY },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    module: string;
    files: Array<{ name: string; path: string; size: number; sha256: string }>;
  };
  assert.equal(body.module, "sympathy");
  assert.equal(body.files[0]?.name, "a.zip");
  assert.equal(body.files[0]?.path, "SongPackages/Sympathy/a.zip");
  assert.equal(body.files[0]?.sha256, HELLO_SHA256);

  const persisted = JSON.parse(await readFile(harness.cachePath, "utf8")) as {
    entries: Record<string, { sha256: string }>;
  };
  assert.equal(persisted.entries["/SongPackages/Sympathy/a.zip"]?.sha256, HELLO_SHA256);
});

test("sha256 falls back to the local file and reuses the cache", async (t) => {
  const harness = await createHarness({
    files: [
      {
        name: "a.zip",
        size: 11,
        is_dir: false,
        modified: "2026-01-01T00:00:00Z",
      },
    ],
  });
  t.after(() => harness.close());

  const moduleDirectory = path.join(harness.localRoot, "SongPackages", "Sympathy");
  await mkdir(moduleDirectory, { recursive: true });
  const filePath = path.join(moduleDirectory, "a.zip");
  await writeFile(filePath, "hello world");

  const first = await harness.app.inject({
    method: "GET",
    url: "/api/sha256?module=sympathy",
    headers: { "x-api-key": API_KEY },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(
    (first.json() as { files: Array<{ sha256: string }> }).files[0]?.sha256,
    HELLO_SHA256,
  );

  await rm(filePath);
  const second = await harness.app.inject({
    method: "GET",
    url: "/api/sha256?module=sympathy",
    headers: { "x-api-key": API_KEY },
  });
  assert.equal(second.statusCode, 200);
  assert.equal(
    (second.json() as { files: Array<{ sha256: string }> }).files[0]?.sha256,
    HELLO_SHA256,
  );
});

test("sha256 returns 502 when the file cannot be read", async (t) => {
  const harness = await createHarness({
    files: [
      {
        name: "missing.zip",
        size: 11,
        is_dir: false,
        modified: "2026-01-01T00:00:00Z",
      },
    ],
  });
  t.after(() => harness.close());

  const response = await harness.app.inject({
    method: "GET",
    url: "/api/sha256?module=sympathy",
    headers: { "x-api-key": API_KEY },
  });

  assert.equal(response.statusCode, 502);
  const body = response.json() as { error: string; message: string };
  assert.equal(body.error, "hash_failed");
  assert.match(body.message, /missing\.zip/);
});
