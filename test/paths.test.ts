import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildDownloadUrl,
  displayOpenlistPath,
  encodeOpenlistPath,
  joinOpenlistPath,
  normalizeOpenlistPath,
  resolveLocalPath,
  stripOpenlistBasePath,
} from "../src/paths.js";

test("normalizeOpenlistPath handles slashes and dots", () => {
  assert.equal(normalizeOpenlistPath(""), "/");
  assert.equal(normalizeOpenlistPath("/"), "/");
  assert.equal(normalizeOpenlistPath("SongPackages/Sympathy"), "/SongPackages/Sympathy");
  assert.equal(normalizeOpenlistPath("//SongPackages//Sympathy/"), "/SongPackages/Sympathy");
  assert.equal(normalizeOpenlistPath("SongPackages\\Sympathy"), "/SongPackages/Sympathy");
  assert.throws(() => normalizeOpenlistPath("/SongPackages/../secret"), /invalid OpenList path/);
});

test("joinOpenlistPath combines mount path and module path", () => {
  assert.equal(joinOpenlistPath("/", "SongPackages/Sympathy"), "/SongPackages/Sympathy");
  assert.equal(
    joinOpenlistPath("/local", "SongPackages/Sympathy"),
    "/local/SongPackages/Sympathy",
  );
});

test("stripOpenlistBasePath returns path relative to the mount", () => {
  assert.equal(
    stripOpenlistBasePath("/", "/SongPackages/Sympathy/a.zip"),
    "/SongPackages/Sympathy/a.zip",
  );
  assert.equal(
    stripOpenlistBasePath("/local", "/local/SongPackages/Sympathy/a.zip"),
    "/SongPackages/Sympathy/a.zip",
  );
  assert.throws(
    () => stripOpenlistBasePath("/local", "/other/SongPackages/a.zip"),
    /outside OpenList mount/,
  );
});

test("displayOpenlistPath removes the leading slash", () => {
  assert.equal(displayOpenlistPath("/SongPackages/Sympathy/a.zip"), "SongPackages/Sympathy/a.zip");
});

test("resolveLocalPath maps an OpenList path onto the local root", () => {
  const localRoot = path.resolve("/home/user000/openlist");
  assert.equal(
    resolveLocalPath(localRoot, "/", "/SongPackages/Sympathy/a.zip"),
    path.join(localRoot, "SongPackages", "Sympathy", "a.zip"),
  );
  assert.equal(
    resolveLocalPath(localRoot, "/local", "/local/SongPackages/Sympathy/a.zip"),
    path.join(localRoot, "SongPackages", "Sympathy", "a.zip"),
  );
  assert.throws(
    () => resolveLocalPath(localRoot, "/", "/SongPackages/../secret"),
    /invalid OpenList path/,
  );
});

test("buildDownloadUrl encodes path segments and signature", () => {
  assert.equal(
    buildDownloadUrl("https://pan.example.com/", "/SongPackages/Sympathy/a b#1.zip"),
    "https://pan.example.com/d/SongPackages/Sympathy/a%20b%231.zip",
  );
  assert.equal(
    buildDownloadUrl("https://pan.example.com", "/SongPackages/Sympathy/中文.zip", "sig+/="),
    "https://pan.example.com/d/SongPackages/Sympathy/%E4%B8%AD%E6%96%87.zip?sign=sig%2B%2F%3D",
  );
  assert.equal(
    buildDownloadUrl("https://pan.example.com/alist", "/SongPackages/a.zip"),
    "https://pan.example.com/alist/d/SongPackages/a.zip",
  );
  assert.equal(
    encodeOpenlistPath("/SongPackages/中文/a.zip"),
    "SongPackages/%E4%B8%AD%E6%96%87/a.zip",
  );
});
