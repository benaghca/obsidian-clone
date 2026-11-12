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

it("keeps the later file list when an older read replies last", async () => {
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
  // Another caller (a create's confirmation read) asks for the list while the batch reads.
  const direct = vault.refreshFiles();
  await microtasks();
  expect(pending).toHaveLength(3);
  pending[2]!([file("A.md"), file("B.md")]);
  await direct;
  pending[1]!([file("A.md")]);
  await microtasks();

  expect(vault.files.map((entry) => entry.path)).toEqual(["A.md", "B.md"]);
  expect(reload.mock.calls.map((call) => call[0])).toEqual(["A.md"]);
  expect(changed.mock.calls.filter((call) => call[0] === "files")).toEqual([["files"], ["files"]]);
});

it("refreshes once for a mixed burst and ends with the disk's files", async () => {
  vi.mocked(api.listFiles).mockResolvedValueOnce(
    ["Keep.md", "Edit.md", "Del.md", "Old.md", "Folder", "Folder/x.md"].map((path) => file(path, path === "Folder")),
  );
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  const { vault, changed } = await openVault(reload);
  const modified: string[] = [];
  vault.onModified((path) => modified.push(path));
  const lists = vi.mocked(api.listFiles).mock.calls.length;
  const links = vi.mocked(api.linkIndex).mock.calls.length;
  const notices = changed.mock.calls.length;
  vi.mocked(api.listFiles).mockResolvedValue(["Keep.md", "Edit.md", "Renamed.md", "New.md"].map((path) => file(path)));

  emit({ kind: "create", paths: ["New.md"] });
  emit({ kind: "modify", paths: ["Edit.md"] });
  emit({ kind: "remove", paths: ["Del.md"] });
  emit({ kind: "rename", paths: ["Old.md", "Renamed.md"] });
  emit({ kind: "remove", paths: ["Folder"] });
  emit({ kind: "modify", paths: ["Keep.md", "Folder/x.md"] });
  await settle();

  expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(lists + 1);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links + 1);
  expect(changed.mock.calls.slice(notices)).toEqual([["files"], ["links"]]);
  expect(vault.files.map((entry) => entry.path)).toEqual(["Keep.md", "Edit.md", "Renamed.md", "New.md"]);
  expect(vault.notes.map((note) => note.path)).toEqual(["Keep.md", "Edit.md", "Renamed.md", "New.md"]);
  expect(vault.isFolder("Folder")).toBe(false);
  expect(vault.entry("Del.md")).toBeUndefined();
  expect(reload.mock.calls.map((call) => call[0])).toEqual(["New.md", "Edit.md", "Old.md", "Renamed.md", "Keep.md", "Folder/x.md"]);
  expect(modified).toEqual(["Edit.md", "Keep.md", "Folder/x.md"]);
});

it("holds events that arrive while a refresh reads, then refreshes once more for all of them", async () => {
  const pending: Array<(files: FileEntry[]) => void> = [];
  let reading = 0;
  let most = 0;
  vi.mocked(api.listFiles).mockImplementation(() => {
    reading += 1;
    most = Math.max(most, reading);
    return new Promise((resolve) => pending.push((files) => { reading -= 1; resolve(files); }));
  });
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  const changed = vi.fn();
  const vault = new Vault(changed, reload);
  const opening = vault.open();
  await microtasks();
  pending[0]!([file("Old.md"), file("Open.md")]);
  await opening;
  await microtasks();
  const links = vi.mocked(api.linkIndex).mock.calls.length;

  emit({ kind: "create", paths: ["A.md"] });
  frames.shift()!(0);
  await microtasks();
  expect(pending).toHaveLength(2);

  // Three more watcher batches land while that read is still out.
  emit({ kind: "modify", paths: ["Open.md"] });
  emit({ kind: "create", paths: ["B.md"] });
  emit({ kind: "remove", paths: ["Old.md"] });
  emit({ kind: "create", paths: ["C.md"] });
  expect(frames).toHaveLength(0);
  expect(pending).toHaveLength(2);

  pending[1]!([file("Old.md"), file("Open.md"), file("A.md")]);
  await microtasks();
  expect(vault.files.map((entry) => entry.path)).toEqual(["Old.md", "Open.md", "A.md"]);
  expect(reload.mock.calls.map((call) => call[0])).toEqual(["A.md"]);
  // The follow-up reads the link index for both batches.
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links);
  expect(frames).toHaveLength(1);

  frames.shift()!(0);
  await microtasks();
  expect(pending).toHaveLength(3);
  pending[2]!([file("Open.md"), file("A.md"), file("B.md"), file("C.md")]);
  await settle();

  expect(most).toBe(1);
  expect(pending).toHaveLength(3);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links + 1);
  expect(vault.files.map((entry) => entry.path)).toEqual(["Open.md", "A.md", "B.md", "C.md"]);
  expect(reload.mock.calls.map((call) => call[0])).toEqual(["A.md", "Open.md", "B.md", "C.md"]);
  expect(frames).toHaveLength(0);
});

it("keeps a change that arrives while the batch is reloading notes", async () => {
  let release: (() => void) | null = null;
  let held = false;
  const reload = vi.fn<(path: string) => Promise<void>>((path) => {
    if (path !== "Slow.md" || held) return Promise.resolve();
    held = true;
    return new Promise<void>((resolve) => { release = resolve; });
  });
  const { vault } = await openVault(reload);
  const modified: string[] = [];
  vault.onModified((path) => modified.push(path));
  const lists = vi.mocked(api.listFiles).mock.calls.length;
  const links = vi.mocked(api.linkIndex).mock.calls.length;

  emit({ kind: "modify", paths: ["Slow.md"] });
  await settle();
  expect(reload.mock.calls.map((call) => call[0])).toEqual(["Slow.md"]);
  emit({ kind: "modify", paths: ["Slow.md", "Late.md"] });
  expect(frames).toHaveLength(0);

  release!();
  await microtasks();
  expect(frames).toHaveLength(1);
  await settle();

  expect(reload.mock.calls.map((call) => call[0])).toEqual(["Slow.md", "Slow.md", "Late.md"]);
  expect(modified).toEqual(["Slow.md", "Slow.md", "Late.md"]);
  expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(lists);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links + 1);
});

it("reads the link index while a steady stream of changes keeps the queue full", async () => {
  const pending: Array<(files: FileEntry[]) => void> = [];
  vi.mocked(api.listFiles).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  // The disk's link index names the latest note the stream wrote.
  let disk = 0;
  vi.mocked(api.linkIndex).mockImplementation(async () => ({ outgoing: { [`N${disk}.md`]: [] } }));
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  const vault = new Vault(vi.fn(), reload);
  const opening = vault.open();
  await microtasks();
  pending[0]!([]);
  await opening;
  await microtasks();
  const links = vi.mocked(api.linkIndex).mock.calls.length;

  disk = 1;
  emit({ kind: "create", paths: ["N1.md"] });
  const batches = 6;
  const during: number[] = [];
  for (let i = 1; i <= batches; i++) {
    expect(frames).toHaveLength(1);
    frames.shift()!(0);
    await microtasks();
    expect(pending).toHaveLength(i + 1);
    // The next change lands before this batch finishes, every time.
    if (i < batches) {
      disk = i + 1;
      emit({ kind: "create", paths: [`N${i + 1}.md`] });
    }
    pending[i]!(Array.from({ length: i }, (_, k) => file(`N${k + 1}.md`)));
    await microtasks();
    during.push(vi.mocked(api.linkIndex).mock.calls.length - links);
  }
  await settle();

  // A read before the stream went quiet, never more than one batch late, and still coalesced.
  expect(during[1]).toBeGreaterThanOrEqual(1);
  for (let i = 1; i < batches; i++) expect(during[i]! - (during[i - 2] ?? 0)).toBeGreaterThanOrEqual(1);
  expect(vi.mocked(api.linkIndex).mock.calls.length - links).toBeLessThanOrEqual(Math.ceil(batches / 2) + 1);
  expect(vault.links).toEqual({ outgoing: { [`N${batches}.md`]: [] } });
  expect(vault.files.map((entry) => entry.path)).toEqual(Array.from({ length: batches }, (_, k) => `N${k + 1}.md`));
  expect(reload.mock.calls.map((call) => call[0])).toEqual(Array.from({ length: batches }, (_, k) => `N${k + 1}.md`));
});

it("runs the waiting batch after an awaited read rejects", async () => {
  const pending: Array<{ resolve: (files: FileEntry[]) => void; reject: (error: Error) => void }> = [];
  vi.mocked(api.listFiles).mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  const vault = new Vault(vi.fn(), reload);
  const opening = vault.open();
  await microtasks();
  pending[0]!.resolve([file("Old.md")]);
  await opening;
  await microtasks();
  const links = vi.mocked(api.linkIndex).mock.calls.length;

  emit({ kind: "create", paths: ["Lost.md"] });
  frames.shift()!(0);
  await microtasks();
  emit({ kind: "create", paths: ["Next.md"] });
  expect(frames).toHaveLength(0);
  pending[1]!.reject(new Error("no vault"));
  await microtasks();

  expect(errors).toHaveBeenCalledTimes(1);
  expect(frames).toHaveLength(1);
  frames.shift()!(0);
  await microtasks();
  pending[2]!.resolve([file("Old.md"), file("Lost.md"), file("Next.md")]);
  await settle();

  expect(vault.files.map((entry) => entry.path)).toEqual(["Old.md", "Lost.md", "Next.md"]);
  expect(reload.mock.calls.map((call) => call[0])).toEqual(["Next.md"]);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links + 1);
  // Nothing is stuck: a later change starts its own batch.
  emit({ kind: "modify", paths: ["Old.md"] });
  expect(frames).toHaveLength(1);
  await settle();
  expect(reload.mock.calls.map((call) => call[0])).toEqual(["Next.md", "Old.md"]);
  errors.mockRestore();
});

it("still reads the links a batch deferred when the batch that waited fails", async () => {
  const pending: Array<{ resolve: (files: FileEntry[]) => void; reject: (error: Error) => void }> = [];
  vi.mocked(api.listFiles).mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const vault = new Vault(vi.fn(), async () => {});
  const opening = vault.open();
  await microtasks();
  pending[0]!.resolve([]);
  await opening;
  await microtasks();
  const links = vi.mocked(api.linkIndex).mock.calls.length;

  emit({ kind: "create", paths: ["A.md"] });
  frames.shift()!(0);
  await microtasks();
  emit({ kind: "create", paths: ["B.md"] });
  pending[1]!.resolve([file("A.md")]);
  await microtasks();
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links);
  frames.shift()!(0);
  await microtasks();
  pending[2]!.reject(new Error("no vault"));
  await settle();

  expect(errors).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.linkIndex)).toHaveBeenCalledTimes(links + 1);
  errors.mockRestore();
});

it("does not let an old vault's batch release a newer batch when it finishes late", async () => {
  const pending: Array<(files: FileEntry[]) => void> = [];
  vi.mocked(api.listFiles).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const reload = vi.fn<(path: string) => Promise<void>>(async () => {});
  const vault = new Vault(vi.fn(), reload);
  const modified: string[] = [];
  vault.onModified((path) => modified.push(path));
  const opening = vault.open();
  await microtasks();
  pending[0]!([file("Old.md")]);
  await opening;

  emit({ kind: "create", paths: ["A.md"] });
  frames.shift()!(0);
  await microtasks();
  expect(pending).toHaveLength(2);

  const again = vault.open();
  await microtasks();
  pending[2]!([file("Fresh.md")]);
  await again;
  emit({ kind: "create", paths: ["B.md"] });
  frames.shift()!(0);
  await microtasks();
  expect(pending).toHaveLength(4);

  // The old batch's read comes back while the new batch is still reading.
  pending[1]!([file("Stale.md")]);
  await microtasks();
  emit({ kind: "modify", paths: ["C.md"] });
  expect(frames).toHaveLength(0);

  pending[3]!([file("Fresh.md"), file("B.md")]);
  await microtasks();
  expect(frames).toHaveLength(1);
  await settle();

  expect(vault.files.map((entry) => entry.path)).toEqual(["Fresh.md", "B.md"]);
  expect(reload.mock.calls.map((call) => call[0])).toEqual(["B.md", "C.md"]);
  expect(modified).toEqual(["C.md"]);
  expect(vi.mocked(api.listFiles)).toHaveBeenCalledTimes(4);
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
