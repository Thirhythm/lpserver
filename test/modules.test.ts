import assert from "node:assert/strict";
import test from "node:test";
import { ModuleError, resolveModule } from "../src/modules.js";

test("resolveModule maps sympathy to the OpenList directory", () => {
  assert.deepEqual(resolveModule("sympathy", "/"), {
    name: "sympathy",
    openlistPath: "/SongPackages/Sympathy",
  });
  assert.deepEqual(resolveModule(" sympathy ", "/local"), {
    name: "sympathy",
    openlistPath: "/local/SongPackages/Sympathy",
  });
});

test("resolveModule rejects missing and unknown modules", () => {
  assert.throws(() => resolveModule(undefined, "/"), ModuleError);
  assert.throws(() => resolveModule("", "/"), /module is required/);
  assert.throws(() => resolveModule("Sympathy", "/"), /invalid module 'Sympathy'/);
  assert.throws(() => resolveModule("other", "/"), /valid values: sympathy/);
});
