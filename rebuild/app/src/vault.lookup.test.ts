import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileEntry } from "./api";
import { addEntry } from "./listPatch";
import { isUnder, movedPath } from "./paths";
import { Vault } from "./vault";
import { resetBackendRootForTests } from "./vaultRoot";

function entry(path: string, isDir = false): FileEntry {
  const slash = path.lastIndexOf("/");
  const base = slash < 0 ? path : path.slice(slash + 1);
  const name = !isDir && base.length > 3 && base.slice(-3).toLowerCase() === ".md" ? base.slice(0, -3) : base;
  return { path, name, is_dir: isDir, mtime_ms: 5, ctime_ms: 4, size: 3 };
}

function vaultWith(files: FileEntry[]): Vault {
  const vault = new Vault(() => {}, async () => {});
  vault.files = files;
  return vault;
}

beforeEach(() => {
  vi.stubGlobal("window", {
    setTimeout: () => 0,
    clearTimeout() {},
    addEventListener() {},
    removeEventListener() {},
  });
});

afterEach(() => {
  resetBackendRootForTests();
  vi.unstubAllGlobals();
});

it("follows a replaced list, and a case-insensitive lookup stops at the first entry", () => {
  const first = entry("Note.md");
  const second = entry("note.md");
  second.size = 9;
  const vault = vaultWith([first, second, entry("Folder", true)]);
  vault.notes = [{ name: "Note", path: "Note.md" }, { name: "note", path: "note.md" }];
  expect(vault.entry("Note.md")).toBe(first);
  expect(vault.entry("note.md")).toBe(second);
  expect(vault.matchPath("NOTE.md")).toBe(first);
  expect(vault.isFolder("Folder")).toBe(true);
  expect(vault.hasNote("Note.md")).toBe(true);
  expect(vault.hasNote("note.md")).toBe(true);
  expect(vault.hasNote("NOTE.md")).toBe(false);
  expect(vault.hasNote("Folder")).toBe(false);

  const next = [entry("Only.md"), entry("Dir", true)];
  vault.files = next;
  vault.notes = [{ name: "Only", path: "Only.md" }];
  expect(vault.entry("Note.md")).toBeUndefined();
  expect(vault.entry("Only.md")).toBe(next[0]);
  expect(vault.matchPath("only.md")).toBe(next[0]);
  expect(vault.isFolder("Folder")).toBe(false);
  expect(vault.isFolder("Dir")).toBe(true);
  expect(vault.hasNote("Note.md")).toBe(false);
  expect(vault.hasNote("Only.md")).toBe(true);
});

it("follows a patch, a rename, and a delete", () => {
  const vault = vaultWith([entry("A", true), entry("A/N.md"), entry("Z.md")]);
  expect(vault.adoptAdded(entry("B.md"))).toBe(true);
  expect(vault.entry("B.md")?.name).toBe("B");
  expect(vault.hasNote("B.md")).toBe(true);
  expect(vault.matchPath("b.md")?.path).toBe("B.md");

  expect(vault.adoptMapped((path) => movedPath(path, "A", "B"))).toBe(true);
  expect(vault.entry("A/N.md")).toBeUndefined();
  expect(vault.entry("B/N.md")?.name).toBe("N");
  expect(vault.hasNote("A/N.md")).toBe(false);
  expect(vault.hasNote("B/N.md")).toBe(true);
  expect(vault.isFolder("A")).toBe(false);
  expect(vault.isFolder("B")).toBe(true);
  expect(vault.matchPath("b/n.md")?.path).toBe("B/N.md");

  expect(vault.dropPaths((path) => isUnder(path, "B"))).toBe(true);
  expect(vault.entry("B/N.md")).toBeUndefined();
  expect(vault.hasNote("B/N.md")).toBe(false);
  expect(vault.hasNote("Z.md")).toBe(true);
  expect(vault.isFolder("B")).toBe(false);
});

it("follows an in-place push and a same-length splice", () => {
  const files = [entry("A.md"), entry("B.md")];
  const vault = vaultWith(files);
  vault.notes = [{ name: "A", path: "A.md" }, { name: "B", path: "B.md" }];
  files.push(entry("C.md"));
  expect(vault.entry("C.md")?.path).toBe("C.md");
  expect(vault.matchPath("c.md")?.path).toBe("C.md");
  expect(vault.fileRefs().some((note) => note.path === "C.md")).toBe(true);
  expect(vault.hasNote("C.md")).toBe(false);
  vault.notes.push({ name: "C", path: "C.md" });
  expect(vault.hasNote("C.md")).toBe(true);

  files.splice(0, 1, entry("D.md"));
  expect(files).toHaveLength(3);
  expect(vault.entry("A.md")).toBeUndefined();
  expect(vault.entry("D.md")?.path).toBe("D.md");
  expect(vault.matchPath("d.md")?.path).toBe("D.md");
  expect(vault.fileRefs().some((note) => note.path === "A.md")).toBe(false);

  vault.notes.splice(0, 1, { name: "E", path: "E.md" });
  expect(vault.hasNote("A.md")).toBe(false);
  expect(vault.hasNote("E.md")).toBe(true);
  expect(vault.includedNotes().map((note) => note.path)).toEqual(["E.md", "B.md", "C.md"]);
});

it("does not walk the note list once per restored history path", () => {
  const notes = Array.from({ length: 100 }, (_, i) => ({ name: `N${i}`, path: `N${i}.md` }));
  let reads = 0;
  const list = new Proxy(notes, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && /^(?:0|[1-9]\d*)$/.test(prop)) reads += 1;
      return Reflect.get(target, prop, receiver);
    },
  });
  const vault = new Vault(() => {}, async () => {});
  vault.notes = list;
  reads = 0;
  const history = ["N99.md", "N0.md", "gone.md", "N50.md"];
  for (let pass = 0; pass < 20; pass++) for (const path of history) vault.hasNote(path);
  expect(reads).toBe(0);
  expect(vault.hasNote("N99.md")).toBe(true);
  expect(vault.hasNote("gone.md")).toBe(false);
});

it("answers 20k path lookups from the map", () => {
  const n = 20_000;
  const files = Array.from({ length: n }, (_, i) => entry(`N${String(i).padStart(5, "0")}.md`));
  const vault = vaultWith(files);
  vault.notes = files.map((file) => ({ name: file.name, path: file.path }));
  const last = files[n - 1]!.path;
  const started = performance.now();
  for (let i = 0; i < n; i++) {
    vault.entry(i % 2 ? last : "missing.md");
    vault.hasNote(i % 2 ? last : "missing.md");
    vault.matchPath(i % 2 ? last : "missing.md");
    vault.isFolder(i % 2 ? "missing" : last);
  }
  const ms = performance.now() - started;
  console.log(`PATH_LOOKUP_20K_MS ${ms.toFixed(2)}`);
  expect(ms).toBeLessThan(500);
  expect(vault.entry(last)?.path).toBe(last);
  expect(vault.hasNote(last)).toBe(true);
  expect(vault.matchPath(last.toLowerCase())?.path).toBe(last);
  expect(vault.isFolder(last)).toBe(false);
});

it("keeps an already listed path as the same array", () => {
  const files = [entry("A.md"), entry("C.md")];
  expect(addEntry(files, entry("A.md"))).toBe(files);
  expect(addEntry(files, entry("B.md"))!.map((file) => file.path)).toEqual(["A.md", "B.md", "C.md"]);
});
