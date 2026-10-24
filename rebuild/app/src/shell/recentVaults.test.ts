import { expect, test } from "vitest";
import { addRecent, type VaultRef } from "./recentVaults";

const vault = (path: string, name = path): VaultRef => ({ path, name });

test("a vault just opened is first, and opening it again does not duplicate it", () => {
  const once = addRecent([vault("/tmp/a", "a"), vault("/tmp/b", "b")], vault("/tmp/c", "c"));
  expect(once.map((v) => v.path)).toEqual(["/tmp/c", "/tmp/a", "/tmp/b"]);
  const again = addRecent(once, vault("/tmp/a", "A"));
  expect(again).toEqual([
    { path: "/tmp/a", name: "A" },
    { path: "/tmp/c", name: "c" },
    { path: "/tmp/b", name: "b" },
  ]);
});

test("the list stops at the cap and drops an empty path", () => {
  const start = [vault("/tmp/a"), vault("/tmp/b"), vault("/tmp/c")];
  expect(addRecent(start, vault("/tmp/d"), 3).map((v) => v.path)).toEqual(["/tmp/d", "/tmp/a", "/tmp/b"]);
  expect(addRecent(start, vault("  ", "nope")).map((v) => v.path)).toEqual(["/tmp/a", "/tmp/b", "/tmp/c"]);
});

test("a blank name falls back to the folder name", () => {
  expect(addRecent([], { path: "/tmp/scratch/Fresh Vault", name: "  " })).toEqual([
    { path: "/tmp/scratch/Fresh Vault", name: "Fresh Vault" },
  ]);
});
