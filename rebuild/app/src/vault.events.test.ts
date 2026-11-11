import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type FileEntry } from "./api";
import { sealWrites, unsealWrites } from "./saveSeal";
import { Vault, batchVisits } from "./vault";
import { resetBackendRootForTests, setBackendRoot, setPageVault } from "./vaultRoot";

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
const realTimeout = setTimeout;

async function settle() {
  while (frames.length) frames.shift()!(0);
  await new Promise((resolve) => realTimeout(resolve, 0));
}

async function microtasks() {
  await new Promise((resolve) => realTimeout(resolve, 0));
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
  unsealWrites();
  resetBackendRootForTests();
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

/** Positive timeouts are the flush fallback. Zero stays the real timer so promises can settle. */
function queueFallback() {
  const timers: Array<() => void> = [];
  vi.stubGlobal("setTimeout", (cb: TimerHandler, ms?: number) => {
    if (typeof cb === "function" && (ms ?? 0) > 0) {
      timers.push(() => cb());
      return timers.length;
    }
    return realTimeout(cb as () => void, ms);
  });
  vi.stubGlobal("clearTimeout", (id: number) => {
    timers[id - 1] = () => {};
  });
  return timers;
}

it("flushes once when animation frames never run", async () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  const timers = queueFallback();
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  await openVault(reload);
  const lists = vi.mocked(api.listFiles).mock.calls.length;
  const links = vi.mocked(api.linkIndex).mock.calls.length;

  emit({ kind: "create", paths: ["A.md"] });
  emit({ kind: "modify", paths: ["B.md"] });
  emit({ kind: "remove", paths: ["C.md"] });

  expect(timers).toHaveLength(1);
  expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(lists);
  expect(reload).not.toHaveBeenCalled();
  timers[0]!();
  await microtasks();
  timers[0]!();
  await microtasks();

  expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(lists + 1);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links + 1);
  expect(reload.mock.calls.map((call) => call[0])).toEqual(["A.md", "B.md"]);
});

it("runs the same batch once when the frame and the fallback both fire", async () => {
  const rafs: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafs.push(cb);
    return 1;
  });
  const timers = queueFallback();
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  await openVault(reload);
  const lists = vi.mocked(api.listFiles).mock.calls.length;
  const links = vi.mocked(api.linkIndex).mock.calls.length;

  emit({ kind: "create", paths: ["A.md"] });
  emit({ kind: "modify", paths: ["B.md"] });
  expect(rafs).toHaveLength(1);
  expect(timers).toHaveLength(1);
  rafs[0]!(0);
  await microtasks();
  timers[0]!();
  await microtasks();

  expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(lists + 1);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links + 1);
  expect(reload.mock.calls.map((call) => call[0])).toEqual(["A.md", "B.md"]);
});

it("does not touch or reload a path that ends the frame removed", async () => {
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  const { vault } = await openVault(reload);
  const modified: string[] = [];
  vault.onModified((path) => modified.push(path));
  const lists = vi.mocked(api.listFiles).mock.calls.length;
  const links = vi.mocked(api.linkIndex).mock.calls.length;

  emit({ kind: "modify", paths: ["Folder/a.md", "Folder/sub/b.md", "Folder2/x.md", "Other.md"] });
  emit({ kind: "remove", paths: ["Folder"] });
  emit({ kind: "modify", paths: ["Gone.md"] });
  emit({ kind: "remove", paths: ["Gone.md"] });
  emit({ kind: "remove", paths: ["Back.md"] });
  emit({ kind: "create", paths: ["Back.md"] });
  emit({ kind: "modify", paths: ["Folder/a.md"] });
  emit({ kind: "modify", paths: ["Dir/a.md"] });
  emit({ kind: "rename", paths: ["Dir", "Away"] });
  await settle();

  expect(modified).toEqual(["Folder2/x.md", "Other.md", "Folder/a.md"]);
  expect(reload.mock.calls.map((call) => call[0])).toEqual(["Folder2/x.md", "Other.md", "Back.md", "Folder/a.md", "Dir", "Away"]);
  for (const path of ["Folder", "Folder/sub/b.md", "Gone.md", "Dir/a.md"]) {
    expect(modified).not.toContain(path);
    expect(reload.mock.calls.map((call) => call[0])).not.toContain(path);
  }
  expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(lists + 1);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links + 1);
});

it("drops a pending frame and the previous listener when the vault opens again", async () => {
  const stops: Array<() => void> = [];
  vi.mocked(api.onVaultChanged).mockImplementation((handler) => {
    emit = handler;
    const stop = () => {
      const at = stops.indexOf(stop);
      if (at >= 0) stops.splice(at, 1);
    };
    stops.push(stop);
    return Promise.resolve(stop);
  });
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  const { vault } = await openVault(reload);
  const modified: string[] = [];
  vault.onModified((path) => modified.push(path));
  emit({ kind: "modify", paths: ["A.md"] });
  expect(frames).toHaveLength(1);
  const lists = vi.mocked(api.listFiles).mock.calls.length;
  const links = vi.mocked(api.linkIndex).mock.calls.length;

  await vault.open();
  frames.shift()!(0);
  await microtasks();

  expect(stops).toHaveLength(1);
  expect(reload).not.toHaveBeenCalled();
  expect(modified).toEqual([]);
  expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(lists + 1);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links + 1);
});

it("drops a batch that is still reading when the vault opens again", async () => {
  const pending: Array<(files: FileEntry[]) => void> = [];
  vi.mocked(api.listFiles).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  const changed = vi.fn();
  const vault = new Vault(changed, reload);
  const opening = vault.open();
  await microtasks();
  pending[0]!([file("Old.md")]);
  await opening;
  const modified: string[] = [];
  vault.onModified((path) => modified.push(path));

  emit({ kind: "create", paths: ["Stuck.md"] });
  frames.shift()!(0);
  await microtasks();
  const again = vault.open();
  await microtasks();
  const resolvers = pending.slice();
  for (let i = 1; i < resolvers.length - 1; i++) resolvers[i]!([file("Stuck.md")]);
  resolvers[resolvers.length - 1]!([file("Fresh.md")]);
  await again;
  await microtasks();

  expect(vault.files.map((entry) => entry.path)).toEqual(["Fresh.md"]);
  expect(reload).not.toHaveBeenCalled();
  expect(modified).toEqual([]);
});

it("keeps the later file list when two refreshes are in flight", async () => {
  const pending: Array<(files: FileEntry[]) => void> = [];
  vi.mocked(api.listFiles).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  const changed = vi.fn();
  const vault = new Vault(changed, reload);
  const opening = vault.open();
  await microtasks();
  pending[0]!([file("Old.md")]);
  await opening;

  emit({ kind: "create", paths: ["A.md"] });
  frames.shift()!(0);
  await microtasks();
  emit({ kind: "create", paths: ["B.md"] });
  frames.shift()!(0);
  await microtasks();
  pending[1]!([file("A.md")]);
  pending[2]!([file("B.md")]);
  await microtasks();

  expect(vault.files.map((entry) => entry.path)).toEqual(["B.md"]);
  expect(reload.mock.calls.map((call) => call[0])).toEqual(["A.md", "B.md"]);
  expect(changed.mock.calls.filter((call) => call[0] === "files")).toEqual([["files"], ["files"]]);
});

it("cancels a pending flush when the page is going away", async () => {
  const page = new EventTarget();
  vi.stubGlobal("window", page);
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  const { vault } = await openVault(reload);
  const modified: string[] = [];
  vault.onModified((path) => modified.push(path));
  emit({ kind: "modify", paths: ["A.md"] });
  expect(frames).toHaveLength(1);
  page.dispatchEvent(new Event("pagehide"));
  frames.shift()!(0);
  await microtasks();
  emit({ kind: "modify", paths: ["B.md"] });
  expect(frames).toHaveLength(0);
  expect(reload).not.toHaveBeenCalled();
  expect(modified).toEqual([]);

  page.dispatchEvent(new Event("pageshow"));
  emit({ kind: "create", paths: ["C.md"] });
  await settle();
  expect(reload.mock.calls.map((call) => call[0])).toEqual(["C.md"]);
});

it("reduces thousands of renames without scanning every earlier path", async () => {
  queueFallback();
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  const { vault } = await openVault(reload);
  const modified: string[] = [];
  vault.onModified((path) => modified.push(path));
  const lists = vi.mocked(api.listFiles).mock.calls.length;
  const links = vi.mocked(api.linkIndex).mock.calls.length;

  emit({ kind: "modify", paths: ["Folder/a.md", "Folder/sub/b.md", "Folder2/x.md", "Other.md"] });
  emit({ kind: "remove", paths: ["Folder"] });
  emit({ kind: "modify", paths: ["Gone.md"] });
  emit({ kind: "remove", paths: ["Gone.md"] });
  emit({ kind: "remove", paths: ["Back.md"] });
  emit({ kind: "create", paths: ["Back.md"] });
  emit({ kind: "modify", paths: ["Folder/a.md"] });
  emit({ kind: "modify", paths: ["Dir/a.md"] });
  emit({ kind: "rename", paths: ["Dir", "Away"] });
  const n = 5000;
  for (let i = 0; i < n; i++) emit({ kind: "rename", paths: [`f${i}.md`, `g${i}.md`] });
  await settle();

  const reloaded = reload.mock.calls.map((call) => call[0]);
  expect(modified).toEqual(["Folder2/x.md", "Other.md", "Folder/a.md"]);
  expect(reloaded.slice(0, 6)).toEqual(["Folder2/x.md", "Other.md", "Back.md", "Folder/a.md", "Dir", "Away"]);
  expect(reloaded).toHaveLength(6 + n * 2);
  expect(reloaded[6]).toBe("f0.md");
  expect(reloaded.at(-1)).toBe(`g${n - 1}.md`);
  for (const path of ["Folder", "Folder/sub/b.md", "Gone.md", "Dir/a.md"]) expect(reloaded).not.toContain(path);
  expect(batchVisits).toBeLessThan(n * 8);
  expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(lists + 1);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links + 1);
});

it("does not apply a batch once the page no longer owns the vault", async () => {
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  await openVault(reload);
  setBackendRoot("/vault-a");
  setPageVault("/vault-a");
  let releaseList: (files: FileEntry[]) => void = () => {};
  vi.mocked(api.listFiles).mockImplementation(() => new Promise((resolve) => { releaseList = resolve; }));
  const links = vi.mocked(api.linkIndex).mock.calls.length;
  emit({ kind: "create", paths: ["New.md"] });
  emit({ kind: "modify", paths: ["Same.md"] });
  expect(frames).toHaveLength(1);
  frames.shift()!(0);
  await Promise.resolve();
  setBackendRoot("/vault-b");
  releaseList([file("New.md"), file("Same.md")]);
  await microtasks();
  await microtasks();
  expect(reload).not.toHaveBeenCalled();
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links);
  emit({ kind: "modify", paths: ["Later.md"] });
  expect(frames).toHaveLength(0);
  setBackendRoot("/vault-a");
  await settle();
  expect(reload).not.toHaveBeenCalled();
});

it("does not publish another vault's file list when the switch rolls back", async () => {
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  const { vault, changed } = await openVault(reload);
  setBackendRoot("/vault-a");
  setPageVault("/vault-a");
  vi.mocked(api.listFiles).mockResolvedValueOnce([file("A.md")]);
  await vault.refreshFiles();
  expect(vault.entry("A.md")?.path).toBe("A.md");
  const filesNotices = changed.mock.calls.filter((call) => call[0] === "files").length;

  let releaseList: (files: FileEntry[]) => void = () => {};
  vi.mocked(api.listFiles).mockImplementation(() => new Promise((resolve) => { releaseList = resolve; }));
  emit({ kind: "create", paths: ["New.md"] });
  expect(frames).toHaveLength(1);
  frames.shift()!(0);
  await Promise.resolve();
  sealWrites();
  setBackendRoot("/vault-b");
  releaseList([file("OnlyB.md")]);
  await microtasks();
  await microtasks();
  setBackendRoot("/vault-a");
  unsealWrites();
  await microtasks();

  expect(vault.files.map((entry) => entry.path)).toEqual(["A.md"]);
  expect(vault.notes.map((note) => note.path)).toEqual(["A.md"]);
  expect(vault.entry("OnlyB.md")).toBeUndefined();
  expect(vault.entry("A.md")?.path).toBe("A.md");
  expect(changed.mock.calls.filter((call) => call[0] === "files")).toHaveLength(filesNotices);
  expect(reload).not.toHaveBeenCalled();
});
