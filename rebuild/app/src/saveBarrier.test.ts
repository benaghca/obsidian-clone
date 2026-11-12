// Edits that arrive after a vault seal, a peer thaw, a delete, or a second
// drawing view. Each one used to land in the wrong vault, get dropped, or
// overwrite a newer scene. No window is opened.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { discardCanvases } from "./canvas/pending";
import { attachDrawing, discardDrawings } from "./drawing/pending";
import { deleteFile, renameFile, updateNoteText } from "./fileOps";
import { NoteEditors } from "./noteEditors";
import { installPathBarrier, usePathPeers } from "./pathBarrier";
import { unsealWrites, writesSealed } from "./saveSeal";
import { resetBackendRootForTests } from "./vaultRoot";
import { resetHoldsForTests } from "./holdDrain";
import { resetHandoffForTests } from "./vaultWrite";
import { settings } from "./settings/store";
import {
  commitVaultSwitch,
  createVaultCoordinator,
  installVaultSwitch,
  localSaveBus,
  resetVaultSwitchForTests,
} from "./vaultSwitch";
import type { Workspace } from "./workspace";

vi.mock("./api", () => ({
  isTauri: false,
  api: {
    readNote: vi.fn(),
    writeNote: vi.fn(),
    writeConfig: vi.fn(),
    deletePath: vi.fn(),
    renamePath: vi.fn(),
    linkSources: vi.fn(),
  },
}));

const events = { shown() {}, loaded() {}, changed() {}, saved: vi.fn() };
const handoffDisk = new Map<string, string>();

function editors() {
  return new NoteEditors({} as never, events);
}

function renameWs(notes: NoteEditors, path: string): Workspace {
  return {
    vault: { isFolder: () => false, files: [{ path }], notes: [], fileRefs: () => [] },
    editors: notes,
    followMove: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
  } as unknown as Workspace;
}

beforeEach(() => {
  vi.clearAllMocks();
  handoffDisk.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => handoffDisk.get(key) ?? null,
    setItem: (key: string, value: string) => { handoffDisk.set(key, value); },
    removeItem: (key: string) => { handoffDisk.delete(key); },
    key: (index: number) => [...handoffDisk.keys()][index] ?? null,
    get length() { return handoffDisk.size; },
    clear: () => { handoffDisk.clear(); },
  });
  vi.stubGlobal("window", {
    setTimeout: (fn: TimerHandler, ms?: number, ...rest: unknown[]) => globalThis.setTimeout(fn, ms, ...rest),
    clearTimeout: (id?: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
    addEventListener() {},
    removeEventListener() {},
  });
  vi.mocked(api.writeNote).mockResolvedValue(undefined);
  vi.mocked(api.readNote).mockResolvedValue("old");
  vi.mocked(api.writeConfig).mockResolvedValue(undefined);
  vi.mocked(api.deletePath).mockResolvedValue(undefined);
  vi.mocked(api.renamePath).mockResolvedValue(undefined);
  vi.mocked(api.linkSources).mockResolvedValue([]);
});

afterEach(async () => {
  resetVaultSwitchForTests();
  unsealWrites();
  resetHandoffForTests();
  resetHoldsForTests();
  resetBackendRootForTests();
  usePathPeers(undefined);
  discardCanvases(() => true);
  discardDrawings(() => true);
  vi.useRealTimers();
  if (settings.get("app.json").showLineNumber) {
    vi.mocked(api.writeConfig).mockResolvedValue(undefined);
    settings.set("app.json", "showLineNumber", false);
    await settings.flush();
  }
});

test("an edit typed after the new vault starts opening is written back to the old one", async () => {
  vi.useFakeTimers();
  let root = "/vault-a";
  const writes: { text: string; root: string }[] = [];
  vi.mocked(api.writeNote).mockImplementation(async (_path, text) => { writes.push({ text, root }); });
  const notes = editors();
  await notes.load("Note.md");
  const open = vi.fn(async (path: string) => {
    root = path;
    if (path === "/vault-b") notes.change("Note.md", { changes: { from: 0, to: 3, insert: "late" } });
    return { path, name: "B" };
  });
  const reload = vi.fn();
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: () => notes.flush(),
    dirty: () => notes.hasUnsaved(),
    vault: () => "/vault-a",
    open,
    reload,
  })).resolves.toBe(false);
  expect(open).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenLastCalledWith("/vault-a", false);
  expect(reload).not.toHaveBeenCalled();
  expect(writes.some((w) => w.text === "late" && w.root === "/vault-a")).toBe(true);
  expect(writes.some((w) => w.root === "/vault-b")).toBe(false);
  expect(writesSealed()).toBe(false);
});

test("a pop-out edit after its ack is written to the old vault", async () => {
  vi.useFakeTimers();
  let root = "/vault-a";
  const writes: { text: string; root: string }[] = [];
  vi.mocked(api.writeNote).mockImplementation(async (_path, text) => { writes.push({ text, root }); });
  const bus = localSaveBus();
  const popout = editors();
  await popout.load("Note.md");
  const reload = vi.fn();
  await installVaultSwitch({
    flushNotes: () => popout.flush(),
    dirty: () => popout.hasUnsaved(),
    reload,
  }, { bus, self: "note-1" });
  const open = vi.fn(async (path: string) => {
    root = path;
    if (path === "/vault-b") popout.change("Note.md", { changes: { from: 0, to: 3, insert: "from-peer" } });
    return { path, name: "B" };
  });
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: async () => true,
    dirty: () => false,
    vault: () => "/vault-a",
    open,
    reload() {},
  }, { bus, others: ["note-1"], self: "main" })).resolves.toBe(false);
  expect(open).toHaveBeenLastCalledWith("/vault-a", false);
  expect(writesSealed()).toBe(false);
  await vi.advanceTimersByTimeAsync(300);
  expect(writes).toContainEqual({ text: "from-peer", root: "/vault-a" });
  expect(writes.some((w) => w.root === "/vault-b")).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});

test("an unloaded note written while the new vault is opening stays on the old vault", async () => {
  vi.useFakeTimers();
  let root = "/vault-a";
  const writes: { text: string; root: string }[] = [];
  vi.mocked(api.writeNote).mockImplementation(async (_path, text) => { writes.push({ text, root }); });
  const notes = editors();
  const ws = { editors: notes, vault: { written: vi.fn() } } as unknown as Workspace;
  const open = vi.fn(async (path: string) => {
    root = path;
    if (path === "/vault-b") await updateNoteText(ws, "Note.md", "from-links");
    return { path, name: "B" };
  });
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: async () => true,
    dirty: () => false,
    vault: () => "/vault-a",
    open,
    reload() {},
  })).resolves.toBe(false);
  expect(writes).toEqual([{ text: "from-links", root: "/vault-a" }]);
  expect(open).toHaveBeenLastCalledWith("/vault-a", false);
});

test("a slow peer learns the switch was cancelled and its next edit still saves", async () => {
  vi.useFakeTimers();
  let peerSealed = false;
  const peer = createVaultCoordinator({
    seal: () => { peerSealed = true; },
    unseal: () => { peerSealed = false; },
    sealed: () => peerSealed,
  });
  const main = createVaultCoordinator({
    seal: () => {},
    unseal: () => {},
    sealed: () => false,
  });
  const bus = localSaveBus();
  let releaseFlush!: (ok: boolean) => void;
  const hung = new Promise<boolean>((resolve) => { releaseFlush = resolve; });
  await peer.install({
    flushNotes: () => hung,
    dirty: () => false,
    reload() {},
  }, { bus, self: "note-1" });
  const open = vi.fn(async () => ({ path: "/vault-b", name: "B" }));
  const pending = main.commit("/vault-b", false, {
    flushNotes: async () => true,
    dirty: () => false,
    vault: () => "/vault-a",
    open,
    reload() {},
  }, { bus, others: ["note-1"], self: "main" });
  await vi.advanceTimersByTimeAsync(2_000);
  await pending;
  expect(open).not.toHaveBeenCalled();
  expect(peerSealed).toBe(false);
  let answered = false;
  await bus.listen("grove-save-ack", () => { answered = true; });
  releaseFlush(true);
  await vi.waitFor(() => expect(answered).toBe(true));
  expect(peerSealed).toBe(false);
  if (!peerSealed) await api.writeNote("Note.md", "after");
  expect(api.writeNote).toHaveBeenCalledWith("Note.md", "after");
});

test("two windows cannot open two vaults for one switch", async () => {
  const bus = localSaveBus();
  let aSealed = false;
  let bSealed = false;
  const a = createVaultCoordinator({
    seal: () => { aSealed = true; },
    unseal: () => { aSealed = false; },
    sealed: () => aSealed,
  });
  const b = createVaultCoordinator({
    seal: () => { bSealed = true; },
    unseal: () => { bSealed = false; },
    sealed: () => bSealed,
  });
  const quiet = { flushNotes: async () => true, dirty: () => false, reload() {} };
  await a.install(quiet, { bus, self: "a" });
  await b.install(quiet, { bus, self: "b" });
  const opens: string[] = [];
  await Promise.all([
    a.commit("/vault-a", false, { ...quiet, vault: () => "/old", open: async (path) => { opens.push(path); return { path, name: "" }; } }, { bus, others: ["b"], self: "a" }),
    b.commit("/vault-b", false, { ...quiet, vault: () => "/old", open: async (path) => { opens.push(path); return { path, name: "" }; } }, { bus, others: ["a"], self: "b" }),
  ]);
  expect(opens).toHaveLength(1);
  expect(opens[0] === "/vault-a" ? aSealed : bSealed).toBe(true);
});

test("a failed reload notice after the vault opened does not unseal onto the new root", async () => {
  vi.useFakeTimers();
  const notes = editors();
  await notes.load("Note.md");
  const bus = localSaveBus();
  const wrapped = {
    listen: bus.listen.bind(bus),
    emit: (event: string, payload?: unknown) => {
      if (event === "grove-save-reload") return Promise.reject(new Error("bus"));
      return bus.emit(event, payload);
    },
  };
  const reload = vi.fn();
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: () => notes.flush(),
    dirty: () => notes.hasUnsaved(),
    vault: () => "/vault-a",
    open: async () => ({ path: "/vault-b", name: "B" }),
    reload,
  }, { bus: wrapped, others: [], self: "main" })).resolves.toBe(true);
  expect(reload).toHaveBeenCalledOnce();
  expect(writesSealed()).toBe(true);
  notes.change("Note.md", { changes: { from: 0, to: 3, insert: "sneak" } });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(api.writeNote).not.toHaveBeenCalled();
});

test("delete trashes the edit still waiting out its debounce", async () => {
  vi.useFakeTimers();
  const disk = new Map<string, string>([["Note.md", "old"]]);
  let trashed = "";
  vi.mocked(api.writeNote).mockImplementation(async (path: string, text: string) => { disk.set(path, text); });
  vi.mocked(api.deletePath).mockImplementation(async (path: string) => {
    trashed = disk.get(path) ?? "";
    disk.delete(path);
  });
  const notes = editors();
  await notes.load("Note.md");
  notes.change("Note.md", { changes: { from: 0, to: 3, insert: "newest" } });
  await expect(deleteFile(renameWs(notes, "Note.md"), "Note.md", { confirmed: true })).resolves.toBe(true);
  expect(trashed).toBe("newest");
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  const calls = vi.mocked(api.writeNote).mock.calls.length;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(api.writeNote).toHaveBeenCalledTimes(calls);
});

test("a flush writes the drawing view that edited, not the one opened later", async () => {
  let scene = "scene-a";
  const first = attachDrawing("D.excalidraw", {
    prepare: () => scene,
    onWrote: () => { expect(first.echoing).toBe(true); },
  });
  attachDrawing("D.excalidraw", { prepare: () => "scene-b" });
  first.touch();
  await first.flush();
  expect(api.writeNote).toHaveBeenCalledWith("D.excalidraw", "scene-a");

  let release!: () => void;
  let held = true;
  vi.mocked(api.writeNote).mockImplementation(() => held ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve());
  scene = "a2";
  first.touch();
  const flushing = first.flush();
  await vi.waitFor(() => expect(api.writeNote).toHaveBeenCalledWith("D.excalidraw", "a2"));
  scene = "a3";
  first.setText("a3");
  first.touch();
  held = false;
  release();
  await flushing;
  expect(api.writeNote).toHaveBeenLastCalledWith("D.excalidraw", "a3");
});

test("a window that started alone still flushes when a later window renames", async () => {
  const bus = localSaveBus();
  const main = editors();
  await main.load("Old.md");
  main.change("Old.md", { changes: { from: 0, to: 3, insert: "from-main" } });
  usePathPeers({ bus, others: [], self: "main" });
  await installPathBarrier({
    hold: (under) => main.hold(under),
    release: (under) => main.release(under),
    flush: (under) => main.flush(under),
    retarget: (under, swap) => main.move(under, swap),
    discard: (under) => main.forget(under),
  });
  usePathPeers({ bus, others: ["main"], self: "note-1" });
  const order: string[] = [];
  vi.mocked(api.writeNote).mockImplementation(async (path: string, text: string) => { order.push(`write ${path} ${text}`); });
  vi.mocked(api.renamePath).mockImplementation(async () => { order.push("rename"); });
  await renameFile(renameWs(editors(), "Old.md"), "Old.md", "New");
  const wrote = order.indexOf("write Old.md from-main");
  const renamed = order.indexOf("rename");
  expect(wrote).toBeGreaterThanOrEqual(0);
  expect(renamed).toBeGreaterThan(wrote);
});

test("a pop-out's unsent edit is flushed before this window renames the file", async () => {
  const bus = localSaveBus();
  const peer = editors();
  await peer.load("Old.md");
  peer.change("Old.md", { changes: { from: 0, to: 3, insert: "from-peer" } });
  usePathPeers({ bus, others: ["note-1"], self: "main" });
  await installPathBarrier({
    hold: (under) => peer.hold(under),
    release: (under) => peer.release(under),
    flush: (under) => peer.flush(under),
    retarget: (under, swap) => peer.move(under, swap),
    discard: (under) => peer.forget(under),
  }, { bus, self: "note-1" });
  const order: string[] = [];
  vi.mocked(api.writeNote).mockImplementation(async (path: string, text: string) => { order.push(`write ${path} ${text}`); });
  vi.mocked(api.renamePath).mockImplementation(async () => { order.push("rename"); });
  await renameFile(renameWs(editors(), "Old.md"), "Old.md", "New");
  const wrote = order.indexOf("write Old.md from-peer");
  const renamed = order.indexOf("rename");
  expect(wrote).toBeGreaterThanOrEqual(0);
  expect(renamed).toBeGreaterThan(wrote);
});
