import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type FileEntry } from "./api";
import { createNote } from "./fileOps";
import { docNeedsFileRefresh, listTokens } from "./listPatch";
import { isUnder, movedPath } from "./paths";
import { sealWrites, unsealWrites } from "./saveSeal";
import { Vault } from "./vault";
import { resetBackendRootForTests, setBackendRoot, setPageVault } from "./vaultRoot";
import type { Workspace } from "./workspace";

vi.mock("./api", () => ({
  api: {
    createNote: vi.fn(),
    listFiles: vi.fn(),
    linkIndex: vi.fn(),
    createFolder: vi.fn(),
  },
  isTauri: false,
}));

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
  vi.clearAllMocks();
  vi.mocked(api.listFiles).mockResolvedValue([]);
  vi.mocked(api.linkIndex).mockResolvedValue({ outgoing: {} });
  vi.stubGlobal("window", {
    setTimeout: () => 0,
    clearTimeout() {},
    addEventListener() {},
    removeEventListener() {},
  });
});

afterEach(() => {
  unsealWrites();
  resetBackendRootForTests();
  vi.unstubAllGlobals();
});

it("adds a created note without reading the whole file list", async () => {
  const vault = vaultWith([entry("A.md"), entry("C.md")]);
  const before = vault.files;
  vi.mocked(api.createNote).mockResolvedValue(entry("B.md"));
  const made = await createNote({ vault } as Workspace, "B.md", "");
  expect(made.path).toBe("B.md");
  expect(api.listFiles).not.toHaveBeenCalled();
  expect(vault.files).not.toBe(before);
  expect(vault.files.map((file) => file.path)).toEqual(["A.md", "B.md", "C.md"]);
  expect(vault.entry("B.md")).toMatchObject({ name: "B", size: 3 });
  expect(vault.entry("B.md")!.mtime_ms).toBeGreaterThan(5);
  expect(vault.notes.map((note) => note.path)).toEqual(["A.md", "B.md", "C.md"]);
  expect(vault.linkExists("B", null)).toBe(true);
  // A one-letter name is too short to decide which panes mention it.
  expect(vault.fileTouch()).toBeNull();
});

it("leaves the list untouched when create fails", async () => {
  const vault = vaultWith([entry("A.md")]);
  const before = vault.files;
  vi.mocked(api.createNote).mockRejectedValue(new Error("already exists"));
  await expect(createNote({ vault } as Workspace, "B.md", "")).rejects.toThrow("already exists");
  expect(vault.files).toBe(before);
  expect(vault.entry("B.md")).toBeUndefined();
  expect(api.listFiles).not.toHaveBeenCalled();
});

it("reads the list when a created note's parent folder is not listed yet", async () => {
  const listed = [entry("A.md")];
  vi.mocked(api.listFiles).mockResolvedValue(listed);
  vi.mocked(api.createNote).mockResolvedValue(entry("Box/B.md"));
  const vault = vaultWith([entry("A.md")]);
  await createNote({ vault } as Workspace, "Box/B.md", "");
  expect(api.listFiles).toHaveBeenCalledOnce();
  expect(vault.files).toBe(listed);
  expect(vault.entry("Box/B.md")).toBeUndefined();
});

it("does not insert a file while this page does not own the disk", () => {
  const vault = vaultWith([entry("A.md")]);
  sealWrites();
  expect(vault.adoptAdded(entry("B.md"))).toBe(false);
  expect(vault.entry("B.md")).toBeUndefined();
  unsealWrites();
  setPageVault("/old");
  setBackendRoot("/new");
  expect(vault.adoptAdded(entry("B.md"))).toBe(false);
  expect(vault.files.map((file) => file.path)).toEqual(["A.md"]);
});

it("renames a folder's children without reading the list, and refuses a missing parent", () => {
  const vault = vaultWith([
    entry("A", true),
    entry("A/N.md"),
    entry("A/Plan.canvas"),
    entry("A/Sub", true),
    entry("A/Sub/X.md"),
    entry("Z.md"),
  ]);
  expect(vault.adoptMapped((path) => movedPath(path, "A", "B"))).toBe(true);
  expect(api.listFiles).not.toHaveBeenCalled();
  expect(vault.files.map((file) => file.path)).toEqual(["B", "B/N.md", "B/Plan.canvas", "B/Sub", "B/Sub/X.md", "Z.md"]);
  expect(vault.entry("B/N.md")).toMatchObject({ name: "N", mtime_ms: 5, size: 3 });
  expect(vault.entry("B/Plan.canvas")?.name).toBe("Plan.canvas");
  expect(vault.entry("B")?.is_dir).toBe(true);
  expect(vault.entry("A/N.md")).toBeUndefined();
  const flat = vaultWith([entry("A.md")]);
  expect(flat.adoptMapped((path) => movedPath(path, "A.md", "Missing/A.md"))).toBe(false);
  expect(flat.files.map((file) => file.path)).toEqual(["A.md"]);
});

it("drops a deleted folder and everything inside it", () => {
  const vault = vaultWith([entry("A", true), entry("A/N.md"), entry("Z.md")]);
  const before = vault.files;
  expect(vault.dropPaths((path) => isUnder(path, "A"))).toBe(true);
  expect(vault.files).not.toBe(before);
  expect(vault.files.map((file) => file.path)).toEqual(["Z.md"]);
  expect(api.listFiles).not.toHaveBeenCalled();
});

it("keeps a local create when an older file list returns without it", async () => {
  const vault = vaultWith([entry("A.md"), entry("C.md")]);
  let release: (files: FileEntry[]) => void = () => {};
  vi.mocked(api.listFiles).mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const pending = vault.refreshFiles();
  expect(vault.adoptAdded(entry("B.md"))).toBe(true);
  release([entry("A.md"), entry("C.md")]);
  await pending;
  expect(vault.files.map((file) => file.path)).toEqual(["A.md", "B.md", "C.md"]);
  expect(vault.files.filter((file) => file.path === "B.md")).toHaveLength(1);
  expect(api.listFiles).toHaveBeenCalledOnce();
});

it("lets a list read that starts after the create replace the patched entry", async () => {
  const vault = vaultWith([entry("A.md"), entry("C.md")]);
  expect(vault.adoptAdded(entry("B.md"))).toBe(true);
  const disk = [entry("A.md"), { ...entry("B.md"), mtime_ms: 11 }, entry("C.md")];
  vi.mocked(api.listFiles).mockResolvedValue(disk);
  await vault.refreshFiles();
  expect(vault.files).toBe(disk);
  expect(vault.entry("B.md")?.mtime_ms).toBe(11);
  expect(vault.fileTouch()).toEqual([]);
});

it("does not install a stale list after the page stops owning the disk", async () => {
  const vault = vaultWith([entry("A.md")]);
  let release: (files: FileEntry[]) => void = () => {};
  vi.mocked(api.listFiles).mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const pending = vault.refreshFiles();
  expect(vault.adoptAdded(entry("B.md"))).toBe(true);
  const patched = vault.files;
  sealWrites();
  release([]);
  await pending;
  expect(vault.files).toBe(patched);
  expect(vault.entry("B.md")?.path).toBe("B.md");
});

it("names only the paths a file-list change added or removed", () => {
  expect(listTokens([], [{ path: "A.md" }])).toBeNull();
  expect(listTokens([{ path: "A.md" }], [{ path: "A.md" }])).toEqual([]);
  expect(listTokens([{ path: "A.md" }], [{ path: "A.md" }, { path: "B.md" }])).toBeNull();
  expect(listTokens([{ path: "A.md" }], [{ path: "A.md" }, { path: "Fresh name.md" }])).toEqual(
    expect.arrayContaining(["fresh name.md", "fresh name"]),
  );
  expect(docNeedsFileRefresh("see [[Fresh name]] here", ["fresh name"])).toBe(true);
  expect(docNeedsFileRefresh("no link to it", ["fresh name"])).toBe(false);
  expect(docNeedsFileRefresh("no link to it", null)).toBe(true);
  expect(docNeedsFileRefresh("no link to it", [])).toBe(false);
  expect(docNeedsFileRefresh("no link to it", ["ab"])).toBe(true);
});

it("patches a 5000-file list without a full read", () => {
  const files = Array.from({ length: 5000 }, (_, i) => entry(`N${String(i).padStart(4, "0")}.md`));
  const vault = vaultWith(files);
  const started = performance.now();
  expect(vault.adoptAdded(entry("Untitled.md"))).toBe(true);
  const ms = performance.now() - started;
  console.log(`FILE_LIST_PATCH_MS ${ms.toFixed(2)}`);
  expect(ms).toBeLessThan(50);
  expect(api.listFiles).not.toHaveBeenCalled();
  expect(vault.entry("Untitled.md")?.name).toBe("Untitled");
  expect(vault.files).toHaveLength(5001);
});
