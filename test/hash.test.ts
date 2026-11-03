import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { HashCache, extractSha256, sha256LocalFile } from "../src/hash.js";

const HELLO_SHA256 = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

test("sha256LocalFile hashes file content", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "lpserver-hash-"));
  const file = path.join(directory, "hello.txt");
  await writeFile(file, "hello world");

  assert.deepEqual(await sha256LocalFile(file), { sha256: HELLO_SHA256, size: 11 });
});

test("extractSha256 reads hash_info and hashinfo", () => {
  assert.equal(
    extractSha256({ hash_info: { sha256: HELLO_SHA256.toUpperCase() } }),
    HELLO_SHA256,
  );
  assert.equal(
    extractSha256({ hashinfo: JSON.stringify({ sha256: HELLO_SHA256 }) }),
    HELLO_SHA256,
  );
  assert.equal(extractSha256({ hash_info: null, hashinfo: "null" }), undefined);
  assert.equal(extractSha256({ hash_info: { sha256: "not-a-hash" } }), undefined);
});

test("HashCache invalidates entries when size or modified time changes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "lpserver-cache-"));
  const cachePath = path.join(directory, "nested", "hash-cache.json");
  const cache = new HashCache(cachePath);

  cache.set("/SongPackages/Sympathy/a.zip", 10, "2026-01-01T00:00:00Z", HELLO_SHA256);
  assert.equal(
    cache.get("/SongPackages/Sympathy/a.zip", 10, "2026-01-01T00:00:00Z"),
    HELLO_SHA256,
  );
  assert.equal(cache.get("/SongPackages/Sympathy/a.zip", 11, "2026-01-01T00:00:00Z"), undefined);
  assert.equal(cache.get("/SongPackages/Sympathy/a.zip", 10, "2026-01-02T00:00:00Z"), undefined);

  await cache.save();
  const persisted = JSON.parse(await readFile(cachePath, "utf8")) as {
    entries: Record<string, { sha256: string }>;
  };
  assert.equal(persisted.entries["/SongPackages/Sympathy/a.zip"]?.sha256, HELLO_SHA256);

  const reloaded = new HashCache(cachePath);
  await reloaded.load();
  assert.equal(
    reloaded.get("/SongPackages/Sympathy/a.zip", 10, "2026-01-01T00:00:00Z"),
    HELLO_SHA256,
  );
});

test("HashCache prunes files that disappeared from a module", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "lpserver-prune-"));
  const cache = new HashCache(path.join(directory, "hash-cache.json"));
  cache.set("/SongPackages/Sympathy/a.zip", 1, "m1", HELLO_SHA256);
  cache.set("/SongPackages/Sympathy/b.zip", 2, "m2", HELLO_SHA256);
  cache.set("/SongPackages/Other/c.zip", 3, "m3", HELLO_SHA256);

  cache.prune("/SongPackages/Sympathy", new Set(["/SongPackages/Sympathy/a.zip"]));

  assert.equal(cache.get("/SongPackages/Sympathy/a.zip", 1, "m1"), HELLO_SHA256);
  assert.equal(cache.get("/SongPackages/Sympathy/b.zip", 2, "m2"), undefined);
  assert.equal(cache.get("/SongPackages/Other/c.zip", 3, "m3"), HELLO_SHA256);
});
