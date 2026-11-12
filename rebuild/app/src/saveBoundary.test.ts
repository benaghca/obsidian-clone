// Vault identity, path holds, and handoff ordering. Each case is a loss the
// seal used to allow. No window is opened.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, type FileEntry } from "./api";
import { editCanvas } from "./canvas/document";
import type { CanvasNode } from "./canvas/model";
import { attachCanvas, discardCanvases } from "./canvas/pending";
import { attachDrawing, discardDrawings } from "./drawing/pending";
import { addElement, emptyDrawing, parseScene, serializeScene } from "./drawing/scene";
import { copyNote, deleteFile, renameFile, updateNoteText } from "./fileOps";
import { listeners } from "./listeners";
import { NoteEditors } from "./noteEditors";
import { installPathBarrier, usePathPeers } from "./pathBarrier";
import { flushOpenSaves } from "./quitFlush";
import { sealWrites, unsealWrites, writesSealed } from "./saveSeal";
import type { Tab } from "./tabs";
import { resetBackendRootForTests, setBackendRoot } from "./vaultRoot";
import { resetHoldsForTests } from "./holdDrain";
import {
  commitVaultSwitch,
  installVaultSwitch,
  localSaveBus,
  resetVaultSwitchForTests,
} from "./vaultSwitch";
import {
  flushHandoff,
  handoffPending,
  queuedNote,
  queuedStructural,
  restoreDurableHandoff,
  resetHandoffForTests,
  setDirtyCapture,
  writeVaultNote,
} from "./vaultWrite";
import { Workspace } from "./workspace";

vi.mock("./api", () => ({
  isTauri: false,
  api: {
    readNote: vi.fn(),
    writeNote: vi.fn(),
    writeConfig: vi.fn(),
    deletePath: vi.fn(),
    renamePath: vi.fn(),
    linkSources: vi.fn(),
    createNote: vi.fn(),
    createFolder: vi.fn(),
  },
}));

const events = { shown() {}, loaded() {}, changed() {}, saved: vi.fn() };
const store = new Map<string, string>();

function editors() {
  return new NoteEditors({} as never, events);
}

function entry(path: string, isDir = false): FileEntry {
  return { path, name: path, is_dir: isDir, mtime_ms: 0, ctime_ms: 0, size: 1 };
}

function renameWs(notes: NoteEditors, path: string): Workspace {
  return {
    vault: {
      isFolder: (p: string) => p === "Notes",
      files: [{ path }],
      notes: [],
      fileRefs: () => [],
      refreshFiles: vi.fn(async () => {}),
      written: vi.fn(),
    },
    editors: notes,
    followMove: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
    saveNow: async () => true,
    open: async () => {},
    active: { path: null },
  } as unknown as Workspace;
}

function handoffValue(fragment: string): string {
  for (const [key, value] of store) if (key.startsWith("grove.saveHandoff.") && value.includes(fragment)) return value;
  return "";
}

function noteTab(path: string): Tab {
  return {
    id: 1,
    path,
    back: ["Earlier.md", path],
    forward: [],
    mode: "live",
    pinned: false,
    backlinks: false,
    memory: { path, scrollTop: 4, selection: null },
    viewFile: path,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
    clear: () => { store.clear(); },
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
  vi.mocked(api.createNote).mockImplementation(async (path: string) => entry(path));
  vi.mocked(api.createFolder).mockImplementation(async (path: string) => entry(path, true));
  setBackendRoot("/vault-a");
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
});

test("a peer edit after CONFIRM_ACK is kept for the old vault", async () => {
  vi.useFakeTimers();
  const popout = editors();
  await popout.load("Note.md");
  setDirtyCapture(() => popout.snapshot());
  const bus = localSaveBus();
  const reload = vi.fn();
  await installVaultSwitch({
    flushNotes: () => popout.flush(),
    dirty: () => popout.hasUnsaved(),
    reload,
  }, { bus, self: "note-1" });
  await bus.listen("grove-save-confirm-ack", () => {
    popout.change("Note.md", { changes: { from: 0, to: 3, insert: "after-ack" } });
  });
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: async () => true,
    dirty: () => false,
    vault: () => "/vault-a",
    open: async () => ({ path: "/vault-b", name: "B" }),
    reload() {},
  }, { bus, others: ["note-1"], self: "main" })).resolves.toBe(true);
  expect(reload).toHaveBeenCalledOnce();
  expect(queuedNote("/vault-a", "Note.md")).toBe("after-ack");
  expect(api.writeNote).not.toHaveBeenCalled();
  expect(handoffValue("after-ack")).toContain("after-ack");
  expect(store.has("grove.saveHandoff")).toBe(false);
});

test("an edit during RELOAD is preserved and does not roll the root back", async () => {
  vi.useFakeTimers();
  const notes = editors();
  await notes.load("Note.md");
  setDirtyCapture(() => notes.snapshot());
  const bus = localSaveBus();
  const wrapped = {
    listen: bus.listen.bind(bus),
    emit(event: string, payload?: unknown) {
      if (event === "grove-save-reload") notes.change("Note.md", { changes: { from: 0, to: 3, insert: "during-reload" } });
      return bus.emit(event, payload);
    },
  };
  const open = vi.fn(async () => ({ path: "/vault-b", name: "B" }));
  const reload = vi.fn();
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: () => notes.flush(),
    dirty: () => notes.hasUnsaved(),
    vault: () => "/vault-a",
    open,
    reload,
  }, { bus: wrapped, others: [], self: "main" })).resolves.toBe(true);
  expect(open).toHaveBeenCalledTimes(1);
  expect(reload).toHaveBeenCalledOnce();
  expect(queuedNote("/vault-a", "Note.md")).toBe("during-reload");
  expect(api.writeNote).not.toHaveBeenCalled();
});

test("a failed rollback keeps the dirty bytes and does not write them onto the new vault", async () => {
  vi.useFakeTimers();
  const notes = editors();
  await notes.load("Note.md");
  setDirtyCapture(() => notes.snapshot());
  const open = vi.fn(async (path: string) => {
    if (path === "/vault-b") {
      notes.change("Note.md", { changes: { from: 0, to: 3, insert: "kept-bytes" } });
      return { path, name: "B" };
    }
    throw new Error("restore failed");
  });
  const reload = vi.fn();
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: () => notes.flush(),
    dirty: () => notes.hasUnsaved(),
    vault: () => "/vault-a",
    open,
    reload,
  })).resolves.toBe(false);
  expect(reload).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledWith("/vault-a", false);
  expect(api.writeNote).not.toHaveBeenCalled();
  expect(writesSealed()).toBe(true);
  expect(notes.doc("Note.md")?.toString()).toBe("kept-bytes");
  const savedKey = [...store.keys()].find((key) => key.startsWith("grove.saveHandoff.") && (store.get(key) ?? "").includes("kept-bytes"));
  const blob = savedKey ? store.get(savedKey) ?? "" : "";
  expect(blob).toContain("kept-bytes");
  expect(store.has("grove.saveHandoff")).toBe(false);
  resetHandoffForTests();
  store.set(savedKey ?? "grove.saveHandoff.restored", blob);
  restoreDurableHandoff();
  expect(queuedNote("/vault-a", "Note.md")).toBe("kept-bytes");
  unsealWrites();
  setBackendRoot("/vault-a");
  await flushHandoff();
  expect(api.writeNote).toHaveBeenCalledWith("Note.md", "kept-bytes");
});

test("a rejected open flushes a queued direct write instead of stranding it", async () => {
  vi.useFakeTimers();
  const notes = editors();
  const ws = { editors: notes, vault: { written: vi.fn() } } as unknown as Workspace;
  const open = vi.fn(async (path: string) => {
    if (path === "/vault-b") {
      await updateNoteText(ws, "Queued.md", "from-queue");
      throw new Error("nope");
    }
    return { path, name: "A" };
  });
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: async () => true,
    dirty: () => false,
    vault: () => "/vault-a",
    open,
    reload() {},
  })).resolves.toBe(false);
  expect(api.writeNote).toHaveBeenCalledWith("Queued.md", "from-queue");
  expect(writesSealed()).toBe(false);
  expect(handoffPending()).toBe(false);
  open.mockResolvedValue({ path: "/vault-c", name: "C" });
  await expect(commitVaultSwitch("/vault-c", false, {
    flushNotes: async () => true,
    dirty: () => false,
    vault: () => "/vault-a",
    open,
    reload() {},
  })).resolves.toBe(true);
});

test("a failed handoff retries, and close flushes the queue", async () => {
  vi.useFakeTimers();
  sealWrites();
  await writeVaultNote("Note.md", "later");
  unsealWrites();
  vi.mocked(api.writeNote).mockRejectedValueOnce(new Error("disk"));
  await expect(flushHandoff()).resolves.toBe(false);
  expect(handoffPending("/vault-a")).toBe(true);
  vi.mocked(api.writeNote).mockResolvedValue(undefined);
  await vi.advanceTimersByTimeAsync(500);
  expect(api.writeNote).toHaveBeenCalledWith("Note.md", "later");

  sealWrites();
  await writeVaultNote("Other.md", "on-close");
  unsealWrites();
  vi.mocked(api.writeNote).mockRejectedValueOnce(new Error("disk"));
  await expect(flushOpenSaves(async () => true)).resolves.toBe(false);
  vi.mocked(api.writeNote).mockResolvedValue(undefined);
  await expect(flushOpenSaves(async () => true)).resolves.toBe(true);
  expect(api.writeNote).toHaveBeenCalledWith("Other.md", "on-close");
});

test("an older queued snapshot does not overwrite a newer editor edit", async () => {
  const notes = editors();
  await notes.load("Note.md");
  sealWrites();
  await writeVaultNote("Note.md", "queued-old");
  notes.change("Note.md", { changes: { from: 0, to: 3, insert: "typed-new" } });
  unsealWrites();
  await notes.flush();
  await flushHandoff();
  const texts = vi.mocked(api.writeNote).mock.calls.map((call) => call[1]);
  expect(texts.at(-1)).toBe("typed-new");
  expect(texts).not.toContain("queued-old");
});

test("a sealed copy waits for the vault it was accepted on", async () => {
  const notes = editors();
  vi.mocked(api.readNote).mockResolvedValue("page-a");
  await notes.load("Note.md");
  const ws = renameWs(notes, "Note.md");
  sealWrites();
  const pending = copyNote(ws, "Note.md");
  await vi.waitFor(() => expect(queuedStructural().some((job) => job.vault === "/vault-a" && job.content === "page-a")).toBe(true));
  setBackendRoot("/vault-b");
  await flushHandoff();
  expect(api.createNote).not.toHaveBeenCalled();
  expect(queuedStructural().every((job) => job.vault === "/vault-a")).toBe(true);
  setBackendRoot("/vault-a");
  unsealWrites();
  await flushHandoff();
  await pending;
  expect(api.createNote).toHaveBeenCalledWith("Note 1.md", "page-a");
});

test("rename and delete resume against the vault they started on", async () => {
  const bus = localSaveBus();
  let release!: (ok: boolean) => void;
  let started = false;
  const hung = new Promise<boolean>((resolve) => { release = resolve; });
  usePathPeers({ bus, others: ["note-1"], self: "main" });
  await installPathBarrier({
    hold() {},
    release() {},
    flush: () => { started = true; return hung; },
    retarget() {},
    discard() {},
  }, { bus, self: "note-1" });
  const notes = editors();
  const renaming = renameFile(renameWs(notes, "Old.md"), "Old.md", "New");
  await vi.waitFor(() => expect(started).toBe(true));
  setBackendRoot("/vault-b");
  release(true);
  await renaming;
  expect(api.renamePath).not.toHaveBeenCalled();

  started = false;
  setBackendRoot("/vault-a");
  const deleteBus = localSaveBus();
  const hungDelete = new Promise<boolean>((resolve) => { release = resolve; });
  usePathPeers({ bus: deleteBus, others: ["note-1"], self: "main" });
  await installPathBarrier({
    hold() {},
    release() {},
    flush: () => { started = true; return hungDelete; },
    retarget() {},
    discard() {},
  }, { bus: deleteBus, self: "note-1" });
  const deleting = deleteFile(renameWs(notes, "Old.md"), "Old.md", { confirmed: true });
  await vi.waitFor(() => expect(started).toBe(true));
  setBackendRoot("/vault-b");
  release(true);
  await expect(deleting).resolves.toBe(false);
  expect(api.deletePath).not.toHaveBeenCalled();
});

test("eager flushes after rename ingress do not recreate the old path", async () => {
  const notes = editors();
  await notes.load("Notes/Old.md");
  notes.change("Notes/Old.md", { changes: { from: 0, to: 3, insert: "v1" } });
  const board = attachCanvas("Notes/Old.canvas");
  board.setText('{"nodes":[{"id":"a"}]}');
  board.touch();
  const drawing = attachDrawing("Notes/Old.excalidraw");
  drawing.setText(emptyDrawing());
  drawing.touch();
  const peer = editors();
  await peer.load("Notes/Old.md");
  peer.change("Notes/Old.md", { changes: { from: 0, to: 3, insert: "peer" } });
  const bus = localSaveBus();
  usePathPeers({ bus, others: ["note-1"], self: "main" });
  await installPathBarrier({
    hold: (under) => peer.hold(under),
    release: (under) => peer.release(under),
    flush: (under) => peer.flush(under),
    retarget: (under, swap) => peer.move(under, swap),
    discard: (under) => peer.forget(under),
  }, { bus, self: "note-1" });
  let release!: () => void;
  let renamed = false;
  const leaked: string[] = [];
  vi.mocked(api.renamePath).mockImplementation(() => new Promise((resolve) => {
    renamed = true;
    release = () => resolve(undefined);
  }));
  vi.mocked(api.writeNote).mockImplementation(async (path: string) => {
    if (renamed && path.startsWith("Notes/")) leaked.push(path);
  });
  const ws = renameWs(notes, "Notes");
  ws.vault.files = [
    entry("Notes", true),
    entry("Notes/Old.md"),
    entry("Notes/Old.canvas"),
    entry("Notes/Old.excalidraw"),
  ];
  ws.vault.fileRefs = () => [
    { path: "Notes/Old.md", name: "Old" },
    { path: "Notes/Old.canvas", name: "Old.canvas" },
    { path: "Notes/Old.excalidraw", name: "Old.excalidraw" },
  ];
  const pending = renameFile(ws, "Notes", "Moved");
  await vi.waitFor(() => expect(renamed).toBe(true));
  notes.change("Notes/Old.md", { changes: { from: 0, to: 2, insert: "v2" } });
  await notes.flush();
  board.setText('{"nodes":[{"id":"b"}]}');
  await board.flush();
  drawing.setText(emptyDrawing());
  await drawing.flush();
  peer.change("Notes/Old.md", { changes: { from: 0, to: 4, insert: "peer2" } });
  await peer.flush();
  expect(leaked).toEqual([]);
  release();
  await pending;
  expect(leaked).toEqual([]);
});

test("a clean sibling adopts a saved element before its own edit", async () => {
  const node = (id: string): CanvasNode => ({ id, type: "text", x: 0, y: 0, width: 40, height: 40, text: id });
  let sourceA = "{\"nodes\":[]}";
  let sourceB = "{\"nodes\":[]}";
  const boardA = attachCanvas("Board.canvas", {
    prepare: () => sourceA,
    adopt: (text) => { sourceA = text; },
  });
  const boardB = attachCanvas("Board.canvas", {
    prepare: () => sourceB,
    adopt: (text) => { sourceB = text; },
  });
  sourceA = editCanvas(sourceA, [], undefined, [node("alpha")]);
  boardA.setText(sourceA);
  boardA.touch();
  await boardA.flush();
  expect(sourceB).toContain("alpha");
  sourceB = editCanvas(sourceB, [], undefined, [node("beta")]);
  boardB.setText(sourceB);
  boardB.touch();
  await boardB.flush();
  const canvasText = vi.mocked(api.writeNote).mock.calls.at(-1)?.[1] ?? "";
  expect(canvasText).toContain("alpha");
  expect(canvasText).toContain("beta");

  const sceneA = parseScene(emptyDrawing());
  const sceneB = parseScene(emptyDrawing());
  if (!sceneA.ok || !sceneB.ok) throw new Error("empty drawing");
  addElement(sceneA.scene, "rectangle", { id: "box-a" });
  const drawA = attachDrawing("D.excalidraw", {
    prepare: () => serializeScene(sceneA.scene),
    adopt: (text) => {
      const next = parseScene(text);
      if (!next.ok) return;
      sceneA.scene.data = next.scene.data;
      sceneA.scene.elements = next.scene.elements;
      sceneA.scene.dirty = true;
    },
  });
  const drawB = attachDrawing("D.excalidraw", {
    prepare: () => serializeScene(sceneB.scene),
    adopt: (text) => {
      const next = parseScene(text);
      if (!next.ok) return;
      sceneB.scene.data = next.scene.data;
      sceneB.scene.elements = next.scene.elements;
      sceneB.scene.dirty = true;
    },
  });
  drawA.setText(serializeScene(sceneA.scene));
  drawA.touch();
  await drawA.flush();
  expect(serializeScene(sceneB.scene)).toContain("box-a");
  addElement(sceneB.scene, "ellipse", { id: "box-b" });
  drawB.setText(serializeScene(sceneB.scene));
  drawB.touch();
  await drawB.flush();
  const drawingText = vi.mocked(api.writeNote).mock.calls.at(-1)?.[1] ?? "";
  expect(drawingText).toContain("box-a");
  expect(drawingText).toContain("box-b");
});

test("a peer rename updates the real tab and a lost DONE still delivers the edit", async () => {
  vi.useFakeTimers();
  const tab = noteTab("Old.md");
  const closed = [{ saved: { path: "Old.md" }, group: null, index: 0 }];
  const host = {
    layout: { tabs: () => [tab] },
    closed,
    recent: ["Old.md"],
    moves: listeners<[(path: string) => string]>(),
    vault: { refreshFiles: async () => {}, refreshLinks() {} },
    emit() {},
    shownKey: "x",
    settle() {},
    presentAll() {},
  };
  let heard = "";
  host.moves.on((swap) => { heard = swap("Old.md"); });
  const peer = editors();
  await peer.load("Old.md");
  const bus = localSaveBus();
  let failDone = true;
  const wrapped = {
    listen: bus.listen.bind(bus),
    emit(event: string, payload?: unknown) {
      if (event === "grove-path-done" && failDone) return Promise.reject(new Error("lost"));
      return bus.emit(event, payload);
    },
  };
  usePathPeers({ bus: wrapped, others: ["note-1"], self: "main" });
  await installPathBarrier({
    hold: (under) => peer.hold(under),
    release: (under) => peer.release(under),
    flush: (under) => peer.flush(under),
    retarget: (under, swap) => peer.move(under, swap),
    discard: (under) => peer.forget(under),
    moved: (_from, _to, swap) => Workspace.prototype.followMove.call(host as unknown as Workspace, swap),
    removed: (under) => Workspace.prototype.forget.call(host as unknown as Workspace, under),
  }, { bus: wrapped, self: "note-1" });
  const pending = renameFile(renameWs(editors(), "Old.md"), "Old.md", "New");
  await vi.waitFor(() => expect(api.renamePath).toHaveBeenCalled());
  expect(tab.path).toBe("Old.md");
  peer.change("Old.md", { changes: { from: 0, to: 3, insert: "later" } });
  await peer.flush();
  expect(vi.mocked(api.writeNote).mock.calls.some((call) => call[0] === "Old.md" && call[1] === "later")).toBe(false);
  failDone = false;
  await vi.advanceTimersByTimeAsync(500);
  await pending;
  expect(tab.path).toBe("New.md");
  expect(tab.viewFile).toBe("New.md");
  expect(tab.back).toEqual(["Earlier.md", "New.md"]);
  expect(tab.memory?.path).toBe("New.md");
  expect(host.recent).toEqual(["New.md"]);
  expect(closed[0].saved.path).toBe("New.md");
  expect(heard).toBe("New.md");
  peer.change("New.md", { changes: { from: 0, to: 5, insert: "arrived" } });
  await vi.advanceTimersByTimeAsync(300);
  expect(api.writeNote).toHaveBeenCalledWith("New.md", "arrived");
});

test("a peer delete clears the real tab", async () => {
  const tab = noteTab("Gone.md");
  const host = {
    layout: { tabs: () => [tab] },
    closed: [{ saved: { path: "Gone.md" }, group: null, index: 0 }],
    recent: ["Gone.md", "Keep.md"],
    moves: listeners<[(path: string) => string]>(),
    vault: { refreshFiles: async () => {}, refreshLinks() {} },
    emit() {},
    shownKey: "",
    settle() {},
    presentAll() {},
  };
  const peer = editors();
  await peer.load("Gone.md");
  const bus = localSaveBus();
  usePathPeers({ bus, others: ["note-1"], self: "main" });
  await installPathBarrier({
    hold: (under) => peer.hold(under),
    release: (under) => peer.release(under),
    flush: (under) => peer.flush(under),
    retarget: (under, swap) => peer.move(under, swap),
    discard: (under) => peer.forget(under),
    removed: (under) => Workspace.prototype.forget.call(host as unknown as Workspace, under),
  }, { bus, self: "note-1" });
  await expect(deleteFile(renameWs(editors(), "Gone.md"), "Gone.md", { confirmed: true })).resolves.toBe(true);
  expect(tab.path).toBeNull();
  expect(tab.viewFile).toBeNull();
  expect(host.recent).toEqual(["Keep.md"]);
  expect(host.closed).toEqual([]);
});
