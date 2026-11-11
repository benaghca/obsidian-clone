import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type FileEntry } from "./api";
import { Vault } from "./vault";

vi.mock("./api", () => ({
  api: {
    listFiles: vi.fn(),
    linkIndex: vi.fn(),
    lastVault: vi.fn(),
    onVaultChanged: vi.fn(),
  },
  isTauri: false,
}));

type Change = { kind: "create" | "modify" | "remove" | "rename"; paths: string[] };

function file(path: string, isDir = false): FileEntry {
  return { path, name: path.slice(path.lastIndexOf("/") + 1), is_dir: isDir, mtime_ms: 1, ctime_ms: 1, size: 0 };
}

/** Counts index reads, which is what `some`, `find`, and a `for` loop do while walking the list. */
function tracked(entries: FileEntry[]) {
  let reads = 0;
  const list = new Proxy(entries, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && /^(?:0|[1-9]\d*)$/.test(prop)) reads += 1;
      return Reflect.get(target, prop, receiver);
    },
  });
  return { list, reset() { reads = 0; }, get reads() { return reads; } };
}

let frames: FrameRequestCallback[] = [];
let emit: (change: Change) => void = () => {};

async function settle() {
  while (frames.length) frames.shift()!(0);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.resetAllMocks();
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  emit = () => {};
  vi.mocked(api.onVaultChanged).mockImplementation((handler) => {
    emit = handler;
    return Promise.resolve(() => {});
  });
  vi.mocked(api.lastVault).mockResolvedValue(null);
  vi.mocked(api.listFiles).mockResolvedValue([]);
  vi.mocked(api.linkIndex).mockResolvedValue({ outgoing: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openVault(reload: (path: string) => Promise<void> = async () => {}) {
  const changed = vi.fn();
  const vault = new Vault(changed, reload);
  await vault.open();
  return { vault, changed, reload };
}

it("refreshes the file list and the link index once for a burst in one frame", async () => {
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  await openVault(reload);
  const lists = vi.mocked(api.listFiles).mock.calls.length;
  const links = vi.mocked(api.linkIndex).mock.calls.length;

  emit({ kind: "modify", paths: ["Same.md", "M1.md"] });
  emit({ kind: "modify", paths: ["Same.md", "M2.md"] });
  emit({ kind: "create", paths: ["C1.md", "C2.md"] });
  emit({ kind: "create", paths: ["C3.md"] });
  emit({ kind: "remove", paths: ["Gone.md", "AlsoGone.md"] });
  emit({ kind: "remove", paths: ["ThirdGone.md"] });
  emit({ kind: "rename", paths: ["Old.md", "New.md"] });
  for (const path of ["M5.md", "M6.md", "M7.md"]) emit({ kind: "modify", paths: [path] });
  emit({ kind: "remove", paths: ["M2.md"] });
  emit({ kind: "create", paths: ["ThirdGone.md"] });

  expect(frames).toHaveLength(1);
  expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(lists);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links);
  expect(reload).not.toHaveBeenCalled();

  await settle();

  expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(lists + 1);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links + 1);
  const reloaded = reload.mock.calls.map((call) => call[0]);
  expect(reloaded).toEqual(["Same.md", "M1.md", "C1.md", "C2.md", "C3.md", "Old.md", "New.md", "M5.md", "M6.md", "M7.md", "ThirdGone.md"]);
  for (const path of ["Gone.md", "AlsoGone.md", "M2.md"]) expect(reloaded).not.toContain(path);
  expect(reloaded.filter((path) => path === "Same.md")).toHaveLength(1);
});

it("refreshes again for a burst that arrives on the next frame", async () => {
  await openVault();
  const lists = vi.mocked(api.listFiles).mock.calls.length;
  const links = vi.mocked(api.linkIndex).mock.calls.length;
  emit({ kind: "remove", paths: ["A.md"] });
  await settle();
  emit({ kind: "create", paths: ["B.md"] });
  await settle();
  expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(lists + 2);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links + 2);
});

it("answers isFolder and touch from the path map, without walking the file list", async () => {
  const entries = Array.from({ length: 40 }, (_, i) => file(`n${i}.md`));
  const middle = entries[20];
  entries.push(file("Folder", true));
  const files = tracked(entries);
  vi.mocked(api.listFiles).mockResolvedValue(files.list);
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  const { vault } = await openVault(reload);
  const modified: string[] = [];
  vault.onModified((path) => modified.push(path));
  files.reset();

  expect(vault.isFolder("Folder")).toBe(true);
  expect(vault.isFolder("n0.md")).toBe(false);
  expect(vault.isFolder("missing")).toBe(false);
  expect(files.reads).toBe(0);

  const lists = vi.mocked(api.listFiles).mock.calls.length;
  const links = vi.mocked(api.linkIndex).mock.calls.length;
  const start = Date.now();
  emit({ kind: "modify", paths: [middle.path, "missing"] });
  emit({ kind: "modify", paths: [middle.path] });
  expect(files.reads).toBe(0);
  expect(reload).not.toHaveBeenCalled();
  await settle();

  expect(files.reads).toBe(0);
  expect(middle.mtime_ms).toBeGreaterThanOrEqual(start);
  expect(entries[0].mtime_ms).toBe(1);
  expect(modified).toEqual([middle.path, "missing"]);
  expect(reload.mock.calls.map((call) => call[0])).toEqual([middle.path, "missing"]);
  expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(lists);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links + 1);
  expect(vault.isFolder("Folder")).toBe(true);
});

it("uses the file list a later refresh installs", async () => {
  const firstEntries = [file("Old.md"), file("Folder", true)];
  const first = tracked(firstEntries);
  vi.mocked(api.listFiles).mockResolvedValueOnce(first.list);
  const { vault } = await openVault();
  first.reset();
  expect(vault.isFolder("Folder")).toBe(true);
  expect(first.reads).toBe(0);
  expect(vault.entry("Old.md")).toBe(firstEntries[0]);

  const nextEntries = [file("Old.md"), file("Next", true)];
  const next = tracked(nextEntries);
  vi.mocked(api.listFiles).mockResolvedValue(next.list);
  emit({ kind: "create", paths: ["Fresh.md"] });
  await settle();
  next.reset();
  first.reset();
  expect(vault.files).toBe(next.list);
  expect(vault.isFolder("Folder")).toBe(false);
  expect(vault.isFolder("Next")).toBe(true);
  expect(vault.entry("Old.md")).toBe(nextEntries[0]);
  expect(vault.entry("Old.md")).not.toBe(firstEntries[0]);
  expect(vault.entry("missing")).toBeUndefined();
  expect(next.reads).toBe(0);
  expect(first.reads).toBe(0);
});
