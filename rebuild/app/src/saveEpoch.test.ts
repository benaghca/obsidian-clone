// Review 4: the page's vault, each window's journal, and path holds.
// No window is opened.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, type FileEntry } from "./api";
import canvasViewSource from "./canvas/view.ts?raw";
import drawingViewSource from "./drawing/view.ts?raw";
import { copyNote, deleteFile, renameFile } from "./fileOps";
import { beginHoldDrain, pathHeld, resetHoldsForTests } from "./holdDrain";
import mainSource from "./main.ts?raw";
import { NoteEditors } from "./noteEditors";
import { createOwnedSaves } from "./ownedSave";
import { installPathBarrier, usePathPeers } from "./pathBarrier";
import { sealWrites, unsealWrites, writesSealed } from "./saveSeal";
import { settings } from "./settings/store";
import switchSource from "./vaultSwitch.ts?raw";
import {
  backendRoot,
  deliverForeignChange,
  pageVault,
  resetBackendRootForTests,
  setBackendRoot,
  setPageVault,
  sourceVault,
} from "./vaultRoot";
import {
  commitVaultSwitch,
  localSaveBus,
  resetVaultSwitchForTests,
} from "./vaultSwitch";
import {
  flushHandoff,
  preserveAccepted,
  queuedConfig,
  queuedCopy,
  queuedNote,
  queuedStructural,
  replayHandoff,
  resetHandoffForTests,
  retargetHandoff,
  setConfigCapture,
  setDirtyCapture,
  submitBytes,
  submitProperty,
  writeVaultConfig,
  writeVaultNote,
} from "./vaultWrite";
import type { Workspace } from "./workspace";

vi.mock("./api", () => ({
  isTauri: false,
  api: {
    readNote: vi.fn(),
    writeNote: vi.fn(),
    readConfig: vi.fn(),
    writeConfig: vi.fn(),
    writeFileBytes: vi.fn(),
    replaceFileBytes: vi.fn(),
    setProperty: vi.fn(),
    createNote: vi.fn(),
    createFolder: vi.fn(),
    deletePath: vi.fn(),
    renamePath: vi.fn(),
    linkSources: vi.fn(),
  },
}));

const store = new Map<string, string>();
type VaultModule = typeof import("./vaultWrite");
const entry = (path: string): FileEntry => ({ path, name: path, is_dir: false, mtime_ms: 0, ctime_ms: 0, size: 1 });

/** A query string is a second module instance. tsc has no declaration for it. */
async function realm(which: "a" | "b" | "c" | "alpha" | "beta" | "reload" | "keep" | "replay" | "fresh" | "peer" | "later"): Promise<VaultModule> {
  switch (which) {
    case "a":
      // @ts-expect-error Vite query instance
      return import("./vaultWrite.ts?window=a") as Promise<VaultModule>;
    case "b":
      // @ts-expect-error Vite query instance
      return import("./vaultWrite.ts?window=b") as Promise<VaultModule>;
    case "c":
      // @ts-expect-error Vite query instance
      return import("./vaultWrite.ts?window=c") as Promise<VaultModule>;
    case "alpha":
      // @ts-expect-error Vite query instance
      return import("./vaultWrite.ts?vault=alpha") as Promise<VaultModule>;
    case "beta":
      // @ts-expect-error Vite query instance
      return import("./vaultWrite.ts?vault=beta") as Promise<VaultModule>;
    case "reload":
      // @ts-expect-error Vite query instance
      return import("./vaultWrite.ts?handoff=reload") as Promise<VaultModule>;
    case "keep":
      // @ts-expect-error Vite query instance
      return import("./vaultWrite.ts?window=keep") as Promise<VaultModule>;
    case "replay":
      // @ts-expect-error Vite query instance
      return import("./vaultWrite.ts?window=replay") as Promise<VaultModule>;
    case "fresh":
      // @ts-expect-error Vite query instance
      return import("./vaultWrite.ts?window=fresh") as Promise<VaultModule>;
    case "peer":
      // @ts-expect-error Vite query instance
      return import("./vaultWrite.ts?window=peer") as Promise<VaultModule>;
    case "later":
      // @ts-expect-error Vite query instance
      return import("./vaultWrite.ts?window=later") as Promise<VaultModule>;
  }
}
const events = { shown() {}, loaded() {}, changed() {}, saved: vi.fn() };

function editors() {
  return new NoteEditors({} as never, events);
}

function handoffStorage(): Storage {
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
    clear: () => { store.clear(); },
  } as Storage;
}

function copyWs(notes: NoteEditors): Workspace {
  return {
    saveNow: async () => true,
    open: async () => {},
    active: { path: null },
    editors: notes,
    vault: {
      isFolder: () => false,
      files: [{ path: "Note.md" }],
      notes: [],
      fileRefs: () => [],
      refreshFiles: async () => {},
      written() {},
    },
  } as unknown as Workspace;
}

function renameWs(notes: NoteEditors, path: string): Workspace {
  return {
    vault: {
      isFolder: () => false,
      files: [{ path }],
      notes: [],
      fileRefs: () => [],
      refreshFiles: async () => {},
      written() {},
    },
    editors: notes,
    followMove: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
    saveNow: async () => true,
    open: async () => {},
    active: { path: null },
  } as unknown as Workspace;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  vi.stubGlobal("localStorage", handoffStorage());
  vi.stubGlobal("window", {
    setTimeout: (fn: TimerHandler, ms?: number, ...rest: unknown[]) => globalThis.setTimeout(fn, ms, ...rest),
    clearTimeout: (id?: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
    addEventListener() {},
    removeEventListener() {},
  });
  vi.mocked(api.writeNote).mockResolvedValue(undefined);
  vi.mocked(api.readNote).mockResolvedValue("old");
  vi.mocked(api.writeConfig).mockResolvedValue(undefined);
  vi.mocked(api.readConfig).mockResolvedValue(null);
  vi.mocked(api.writeFileBytes).mockImplementation(async (path: string) => entry(path));
  vi.mocked(api.replaceFileBytes).mockImplementation(async (path: string) => entry(path));
  vi.mocked(api.setProperty).mockResolvedValue({ status: "done" } as never);
  vi.mocked(api.createNote).mockImplementation(async (path: string) => entry(path));
  vi.mocked(api.createFolder).mockImplementation(async (path: string) => ({ ...entry(path), is_dir: true, size: 0 }));
  vi.mocked(api.renamePath).mockResolvedValue(undefined);
  vi.mocked(api.deletePath).mockResolvedValue(undefined);
  vi.mocked(api.linkSources).mockResolvedValue([]);
  setBackendRoot("/vault-a");
  setPageVault("/vault-a");
});

afterEach(async () => {
  resetVaultSwitchForTests();
  unsealWrites();
  resetHandoffForTests();
  resetHoldsForTests();
  resetBackendRootForTests();
  usePathPeers(undefined);
  setDirtyCapture(() => []);
  setConfigCapture(() => []);
  vi.useRealTimers();
  if (settings.get("app.json").showLineNumber) {
    vi.mocked(api.writeConfig).mockResolvedValue(undefined);
    settings.set("app.json", "showLineNumber", false);
    await settings.flush();
  }
});

test("a copy and a direct write after open keep the old vault through a failed rollback", async () => {
  vi.mocked(api.readNote).mockResolvedValue("page-a");
  const notes = editors();
  await notes.load("Note.md");
  const ws = copyWs(notes);
  const bus = localSaveBus();
  let copying = Promise.resolve("");
  await bus.listen("grove-save-barrier", (payload) => {
    const body = payload as { id?: string };
    void bus.emit("grove-save-ack", { id: body.id, label: "note-1", ok: true });
  });
  await bus.listen("grove-save-confirm", async (payload) => {
    const body = payload as { id?: string };
    expect(backendRoot()).toBe("/vault-b");
    expect(pageVault()).toBe("/vault-a");
    expect(writesSealed()).toBe(true);
    await writeVaultNote("Direct.md", "from-page-a");
    expect(queuedNote("/vault-a", "Direct.md")).toBe("from-page-a");
    expect(queuedNote("/vault-b", "Direct.md")).toBeUndefined();
    copying = copyNote(ws, "Note.md");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(queuedStructural().some((job) => job.vault === "/vault-a" && job.content === "page-a")).toBe(true);
    expect(queuedStructural().some((job) => job.vault === "/vault-b")).toBe(false);
    await bus.emit("grove-save-confirm-ack", { id: body.id, label: "note-1", ok: true });
  });
  const reload = vi.fn();
  const roots: string[] = [];
  vi.mocked(api.writeNote).mockImplementation(async () => { roots.push(backendRoot()); });
  vi.mocked(api.createNote).mockImplementation(async (path: string) => {
    roots.push(backendRoot());
    return entry(path);
  });
  const open = vi.fn(async (path: string) => {
    if (path === "/vault-a") throw new Error("restore failed");
    return { path, name: "B" };
  });
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: async () => true,
    dirty: () => false,
    vault: () => "/vault-a",
    open,
    reload,
  }, { bus, others: ["note-1"], self: "main" })).resolves.toBe(false);
  expect(reload).not.toHaveBeenCalled();
  expect(api.writeNote).not.toHaveBeenCalled();
  expect(api.createNote).not.toHaveBeenCalled();
  expect(queuedNote("/vault-a", "Direct.md")).toBe("from-page-a");
  unsealWrites();
  setBackendRoot("/vault-b");
  await flushHandoff();
  expect(api.writeNote).not.toHaveBeenCalled();
  expect(api.createNote).not.toHaveBeenCalled();
  setBackendRoot("/vault-a");
  setPageVault("/vault-a");
  await flushHandoff();
  await copying;
  expect(api.writeNote).toHaveBeenCalledWith("Direct.md", "from-page-a");
  expect(api.createNote).toHaveBeenCalledWith("Note 1.md", "page-a");
  expect(roots.every((root) => root === "/vault-a")).toBe(true);
});

test("two windows keep their own handoff records and a new page reads both", async () => {
  const first = await realm("a");
  const second = await realm("b");
  expect(first.writeVaultNote).not.toBe(second.writeVaultNote);
  sealWrites();
  await first.writeVaultNote("A.md", "from-a");
  await second.writeVaultNote("B.md", "from-b");
  unsealWrites();
  const blobs = [...store.entries()].filter(([key]) => key.startsWith("grove.saveHandoff."));
  expect(blobs).toHaveLength(2);
  const rawA = blobs.find(([, value]) => value.includes("from-a"))?.[1] ?? "";
  const rawB = blobs.find(([, value]) => value.includes("from-b"))?.[1] ?? "";
  expect(rawA).toContain("from-a");
  expect(rawA).not.toContain("from-b");
  expect(rawB).toContain("from-b");
  expect(rawB).not.toContain("from-a");
  expect(store.has("grove.saveHandoff")).toBe(false);
  const third = await realm("c");
  expect(third.queuedNote("/vault-a", "A.md")).toBe("from-a");
  expect(third.queuedNote("/vault-a", "B.md")).toBe("from-b");
});

test("a vault switch does not reload when the handoff write is refused", async () => {
  setDirtyCapture(() => [{ path: "Note.md", text: "keep-me", gen: 2 }]);
  const disk = localStorage;
  disk.setItem = () => { throw new Error("quota"); };
  const reload = vi.fn();
  const roots: string[] = [];
  vi.mocked(api.writeNote).mockImplementation(async (_path, text) => { roots.push(`${backendRoot()} ${text}`); });
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: async () => true,
    dirty: () => false,
    vault: () => "/vault-a",
    open: async (path) => ({ path, name: path }),
    reload,
  })).resolves.toBe(false);
  expect(reload).not.toHaveBeenCalled();
  expect(preserveAccepted("/vault-a")).toBe(false);
  expect(roots.some((line) => line.startsWith("/vault-b"))).toBe(false);
  expect(roots.some((line) => line === "/vault-a keep-me")).toBe(true);
});

test("a mutation in vault A leaves vault B's queued records byte for byte", async () => {
  const alpha = await realm("alpha");
  const beta = await realm("beta");
  sealWrites();
  await alpha.writeVaultNote("Note.md", "text-a", undefined, 1, "/vault-a");
  await beta.writeVaultNote("Note.md", "text-b", undefined, 1, "/vault-b");
  void beta.submitBytes("/vault-b", "Note.md", new Uint8Array([4, 5]), "write");
  void beta.submitProperty("/vault-b", "Note.md", { key: "status", expect: null, to: { type: "text", value: "b" } });
  const before = [...store.entries()].find(([, value]) => value.includes("text-b"));
  expect(before).toBeTruthy();
  unsealWrites();
  alpha.discardHandoff("/vault-a", (path) => path === "Note.md");
  alpha.retargetHandoff("/vault-a", () => false, (path) => path);
  const after = store.get(before![0]);
  expect(after).toBe(before![1]);
  expect(beta.queuedNote("/vault-b", "Note.md")).toBe("text-b");
  expect(beta.queuedBytes("/vault-b", "Note.md")).toBe(btoa(String.fromCharCode(4, 5)));
  expect(beta.queuedProp("/vault-b", "Note.md")).toEqual({ key: "status", expect: null, to: { type: "text", value: "b" } });
  expect(alpha.queuedNote("/vault-a", "Note.md")).toBeUndefined();
});

test("a drain for one path does not let a held path write", async () => {
  vi.useFakeTimers();
  const notes = editors();
  await notes.load("X.md");
  notes.change("X.md", { changes: { from: 0, to: 3, insert: "xxxx" } });
  const held = (path: string) => path === "X.md";
  notes.hold(held);
  const endDrain = beginHoldDrain((path) => path === "Y.md");
  await expect(notes.flush()).resolves.toBe(false);
  expect(api.writeNote).not.toHaveBeenCalled();
  endDrain();
  notes.release(held);
});

test("a queued retry during rename ingress waits for the new path", async () => {
  vi.useFakeTimers();
  sealWrites();
  await writeVaultNote("Old.md", "queued-old");
  unsealWrites();
  let phase = "drain";
  let release!: () => void;
  vi.mocked(api.writeNote).mockImplementation(async (path: string) => {
    if (phase !== "after" && path === "Old.md") throw new Error("full");
  });
  vi.mocked(api.renamePath).mockImplementation(() => new Promise((resolve) => {
    phase = "rename";
    release = () => { phase = "after"; resolve(undefined); };
  }));
  const pending = renameFile(renameWs(editors(), "Old.md"), "Old.md", "New");
  await vi.waitFor(() => expect(api.renamePath).toHaveBeenCalledWith("Old.md", "New.md"));
  const tried = vi.mocked(api.writeNote).mock.calls.filter((call) => call[0] === "Old.md").length;
  expect(tried).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(500);
  expect(vi.mocked(api.writeNote).mock.calls.filter((call) => call[0] === "Old.md")).toHaveLength(tried);
  release();
  await pending;
  expect(api.writeNote).toHaveBeenCalledWith("New.md", "queued-old");
});

test("a peer retargets a queued direct write before it releases the hold", async () => {
  const peer = editors();
  await peer.load("Old.md");
  const bus = localSaveBus();
  const order: string[] = [];
  usePathPeers({ bus, others: ["note-1"], self: "main" });
  await installPathBarrier({
    hold: (under) => peer.hold(under),
    release: (under) => { order.push("release"); peer.release(under); },
    flush: async () => true,
    retarget: (under, swap) => {
      order.push("retarget");
      expect(pathHeld("Old.md")).toBe(true);
      retargetHandoff(sourceVault(), under, swap);
      peer.move(under, swap);
    },
    discard: () => {},
  }, { bus, self: "note-1" });
  let release!: () => void;
  vi.mocked(api.renamePath).mockImplementation(() => new Promise((resolve) => { release = () => resolve(undefined); }));
  const pending = renameFile(renameWs(editors(), "Old.md"), "Old.md", "New");
  await vi.waitFor(() => expect(api.renamePath).toHaveBeenCalled());
  await writeVaultNote("Old.md", "direct-text");
  expect(queuedNote("/vault-a", "Old.md")).toBe("direct-text");
  expect(api.writeNote).not.toHaveBeenCalledWith("Old.md", "direct-text");
  release();
  await pending;
  expect(order).toEqual(["retarget", "release"]);
  expect(api.writeNote).toHaveBeenCalledWith("New.md", "direct-text");
  expect(api.writeNote).not.toHaveBeenCalledWith("Old.md", "direct-text");
});

test("settings and a deferred attachment accepted on reload survive a new page", async () => {
  vi.useFakeTimers();
  setConfigCapture(() => settings.pendingText());
  const bus = localSaveBus();
  await bus.listen("grove-save-reload", () => {
    settings.set("app.json", "showLineNumber", true);
    void submitBytes(pageVault(), "Pasted.png", new Uint8Array([1, 2, 3]), "write");
    void submitProperty(pageVault(), "Note.md", { key: "status", expect: null, to: { type: "text", value: "kept" } });
  });
  const reload = vi.fn();
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: async () => true,
    dirty: () => false,
    vault: () => "/vault-a",
    open: async () => ({ path: "/vault-b", name: "B" }),
    reload,
  }, { bus, others: [], self: "main" })).resolves.toBe(true);
  expect(reload).toHaveBeenCalledOnce();
  const next = await realm("reload");
  expect(next.queuedConfig("/vault-a", "app.json")).toContain("showLineNumber");
  expect(next.queuedBytes("/vault-a", "Pasted.png")).toBe(btoa(String.fromCharCode(1, 2, 3)));
  expect(next.queuedProp("/vault-a", "Note.md")).toEqual({ key: "status", expect: null, to: { type: "text", value: "kept" } });
  expect(queuedConfig("/vault-a", "app.json")).toContain("showLineNumber");
});

test("a note and a setting read during recovery keep the recovered bytes", async () => {
  let releaseNote: (text: string) => void = () => {};
  let releaseConfig: (text: string | null) => void = () => {};
  let holdWrites = true;
  const noteWrites: (() => void)[] = [];
  const configWrites: (() => void)[] = [];
  const releaseWrites = () => {
    holdWrites = false;
    noteWrites.splice(0).forEach((release) => release());
    configWrites.splice(0).forEach((release) => release());
  };
  vi.mocked(api.readNote).mockImplementation(() => new Promise((resolve) => { releaseNote = resolve; }));
  vi.mocked(api.writeNote).mockImplementation(() => holdWrites
    ? new Promise((resolve) => { noteWrites.push(() => resolve(undefined)); })
    : Promise.resolve());
  vi.mocked(api.readConfig).mockImplementation((name: string) => name === "app.json"
    ? new Promise((resolve) => { releaseConfig = resolve; })
    : Promise.resolve(null));
  vi.mocked(api.writeConfig).mockImplementation(() => holdWrites
    ? new Promise((resolve) => { configWrites.push(() => resolve(undefined)); })
    : Promise.resolve());
  try {
    sealWrites();
    await writeVaultNote("Note.md", "recovered");
    await writeVaultConfig("app.json", JSON.stringify({ showLineNumber: true }));
    unsealWrites();
    const replay = replayHandoff();
    await vi.waitFor(() => expect(api.writeNote).toHaveBeenCalledWith("Note.md", "recovered"));
    await vi.waitFor(() => expect(api.writeConfig).toHaveBeenCalled());
    const notes = editors();
    const loading = notes.load("Note.md");
    const prefs = settings.load();
    await vi.waitFor(() => expect(api.readNote).toHaveBeenCalledWith("Note.md"));
    await vi.waitFor(() => expect(api.readConfig).toHaveBeenCalledWith("app.json"));
    releaseNote("stale");
    releaseConfig("{}");
    await loading;
    await prefs;
    expect(notes.doc("Note.md")?.toString()).toBe("recovered");
    expect(settings.get("app.json").showLineNumber).toBe(true);
    notes.change("Note.md", { changes: { from: 0, to: notes.doc("Note.md")!.length, insert: "recovered!" } });
    releaseWrites();
    await replay;
    await notes.flush();
    const texts = vi.mocked(api.writeNote).mock.calls.map((call) => call[1]);
    expect(texts.at(-1)).toBe("recovered!");
    expect(texts).not.toContain("stale");
  } finally {
    releaseNote("stale");
    releaseConfig(null);
    releaseWrites();
    vi.mocked(api.readNote).mockResolvedValue("old");
    vi.mocked(api.writeNote).mockResolvedValue(undefined);
    vi.mocked(api.readConfig).mockResolvedValue(null);
    vi.mocked(api.writeConfig).mockResolvedValue(undefined);
  }
});

test("a late vault callback does not replace a page that still belongs to the old vault", async () => {
  vi.useFakeTimers();
  vi.mocked(api.readNote).mockResolvedValue("from-a");
  const notes = editors();
  await notes.load("Same.md");
  const saves = createOwnedSaves(300);
  const owned = saves.attach("Board.canvas");
  owned.setText("kept-canvas");
  owned.touch();
  expect(owned.dirty).toBe(true);
  sealWrites();
  setBackendRoot("/vault-b");
  expect(pageVault()).toBe("/vault-a");
  notes.change("Same.md", { changes: { from: 0, to: 6, insert: "kept-note" } });
  const reads = vi.mocked(api.readNote).mock.calls.length;
  vi.mocked(api.readNote).mockResolvedValue("from-b");
  let dropped = false;
  deliverForeignChange(true, owned.echoing, () => { dropped = true; owned.drop(); }, () => { throw new Error("loaded the new vault"); });
  await notes.reload("Same.md");
  expect(dropped).toBe(false);
  expect(owned.dirty).toBe(true);
  expect(owned.text()).toBe("kept-canvas");
  expect(notes.doc("Same.md")?.toString()).toBe("kept-note");
  expect(api.readNote).toHaveBeenCalledTimes(reads);
  expect(canvasViewSource).toContain("deliverForeignChange");
  expect(drawingViewSource).toContain("deliverForeignChange");
});

test("a path ack on a later turn does not wait out the backoff", async () => {
  vi.useFakeTimers();
  const real = localSaveBus();
  const bus = {
    listen: real.listen.bind(real),
    emit(event: string, payload?: unknown) {
      const body = payload as { id?: string };
      if (event === "grove-path-hold") void real.emit("grove-path-ack", { id: body.id, label: "note-1", ok: true });
      if (event === "grove-path-done") setTimeout(() => { void real.emit("grove-path-done-ack", { id: body.id, label: "note-1", ok: true }); }, 15);
      return real.emit(event, payload);
    },
  };
  usePathPeers({ bus, others: ["note-1"], self: "main" });
  const pending = renameFile(renameWs(editors(), "Old.md"), "Old.md", "New");
  await vi.advanceTimersByTimeAsync(15);
  await pending;
  expect(api.renamePath).toHaveBeenCalledWith("Old.md", "New.md");
});

test("a peer that leaves does not keep the rename waiting or lose its hold", async () => {
  vi.useFakeTimers();
  let gone = false;
  const real = localSaveBus();
  const bus = {
    listen(event: string, handler: (payload: unknown) => void) {
      return real.listen(event, (payload) => {
        if (gone && event === "grove-path-done") return;
        handler(payload);
      });
    },
    emit(event: string, payload?: unknown) {
      if (event === "grove-path-ack") gone = true;
      return real.emit(event, payload);
    },
  };
  const peer = editors();
  await peer.load("Old.md");
  usePathPeers({
    bus,
    others: ["note-1"],
    self: "main",
    listWindows: async () => (gone ? [] : ["main", "note-1"]),
  });
  await installPathBarrier({
    hold: (under) => peer.hold(under),
    release: (under) => peer.release(under),
    flush: async () => true,
    retarget: (under, swap) => peer.move(under, swap),
    discard: (under) => peer.forget(under),
  }, { bus, self: "note-1" });
  let settled = false;
  const pending = renameFile(renameWs(editors(), "Old.md"), "Old.md", "New").then(() => { settled = true; });
  for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(true);
  expect(pathHeld("Old.md")).toBe(true);
  await pending;
});

test("replaying one window does not erase a note the other window acknowledged later", async () => {
  const keep = await realm("keep");
  sealWrites();
  await keep.writeVaultNote("A.md", "only-a");
  const replay = await realm("replay");
  expect(replay.queuedNote("/vault-a", "A.md")).toBe("only-a");
  expect(replay.queuedNote("/vault-a", "B.md")).toBeUndefined();
  await keep.writeVaultNote("B.md", "only-b");
  unsealWrites();
  setBackendRoot("/vault-a");
  setPageVault("/vault-a");
  await replay.flushHandoff();
  expect(api.writeNote).toHaveBeenCalledWith("A.md", "only-a");
  expect(api.writeNote).not.toHaveBeenCalledWith("B.md", "only-b");
  const fresh = await realm("fresh");
  expect(fresh.queuedNote("/vault-a", "B.md")).toBe("only-b");
  expect(fresh.queuedNote("/vault-a", "A.md")).toBeUndefined();
});

test("an earlier drain finishing does not authorize the path a later drain still holds", async () => {
  vi.useFakeTimers();
  const notes = editors();
  await notes.load("X.md");
  await notes.load("Y.md");
  const release = new Map<string, () => void>();
  const real = notes.flush.bind(notes);
  vi.spyOn(notes, "flush").mockImplementation((which) => {
    const onlyX = !!which && which("X.md") && !which("Y.md");
    const onlyY = !!which && which("Y.md") && !which("X.md");
    const path = onlyX ? "X.md" : onlyY ? "Y.md" : "";
    if (!path) return real(which);
    return new Promise((resolve) => {
      release.set(path, () => { void real(which).then(resolve); });
    });
  });
  let releaseRename: () => void = () => {};
  vi.mocked(api.renamePath).mockImplementation((from: string) => {
    if (from !== "X.md") return Promise.resolve();
    return new Promise((resolve) => { releaseRename = () => resolve(undefined); });
  });
  const ws = renameWs(notes, "X.md");
  ws.vault.files.push({ path: "Y.md" } as never);
  const pendingX = renameFile(ws, "X.md", "Moved");
  const pendingY = renameFile(ws, "Y.md", "Other");
  await vi.waitFor(() => expect(release.size).toBe(2));
  release.get("X.md")!();
  await vi.waitFor(() => expect(api.renamePath).toHaveBeenCalledWith("X.md", "Moved.md"));
  notes.change("X.md", { changes: { from: 0, to: 0, insert: "eager" } });
  await notes.flush();
  expect(api.writeNote).not.toHaveBeenCalled();
  expect(pathHeld("X.md")).toBe(true);
  release.get("Y.md")!();
  releaseRename();
  await pendingX;
  await pendingY;
});

test("a peer that fails to flush its queued text refuses the delete", async () => {
  const peer = await realm("peer");
  sealWrites();
  await peer.writeVaultNote("Gone.md", "newest-text");
  unsealWrites();
  vi.mocked(api.writeNote).mockRejectedValue(new Error("full"));
  const bus = localSaveBus();
  usePathPeers({ bus, others: ["note-1"], self: "main", listWindows: async () => ["main", "note-1"] });
  await installPathBarrier({
    hold() {},
    release() {},
    flush: async () => true,
    retarget() {},
    discard() {},
    handoff: () => peer.flushHandoff(),
  }, { bus, self: "note-1" });
  const ws = renameWs(editors(), "Gone.md");
  await expect(deleteFile(ws, "Gone.md")).resolves.toBe(false);
  expect(api.deletePath).not.toHaveBeenCalled();
  expect(peer.queuedNote("/vault-a", "Gone.md")).toBe("newest-text");
  const later = await realm("later");
  expect(later.queuedNote("/vault-a", "Gone.md")).toBe("newest-text");
});

test("a closed note and a canvas copy read the vault the page still belongs to", async () => {
  const notes = editors();
  const ws = copyWs(notes);
  ws.vault.files.push({ path: "Closed.md" } as never, { path: "Board.canvas" } as never);
  const bus = localSaveBus();
  let copyingNote = Promise.resolve("");
  let copyingCanvas = Promise.resolve("");
  await bus.listen("grove-save-barrier", (payload) => {
    const body = payload as { id?: string };
    void bus.emit("grove-save-ack", { id: body.id, label: "note-1", ok: true });
  });
  await bus.listen("grove-save-confirm", async (payload) => {
    const body = payload as { id?: string };
    expect(backendRoot()).toBe("/vault-b");
    expect(pageVault()).toBe("/vault-a");
    const reads = vi.mocked(api.readNote).mock.calls.length;
    copyingNote = copyNote(ws, "Closed.md");
    copyingCanvas = copyNote(ws, "Board.canvas");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(vi.mocked(api.readNote).mock.calls.length).toBe(reads);
    expect(queuedCopy("/vault-a", "Closed.md")).toBe("Closed 1.md");
    expect(queuedCopy("/vault-a", "Board.canvas")).toBe("Board 1.canvas");
    await bus.emit("grove-save-confirm-ack", { id: body.id, label: "note-1", ok: true });
  });
  const reads: string[] = [];
  vi.mocked(api.readNote).mockImplementation(async (path: string) => {
    reads.push(`${backendRoot()} ${path}`);
    return backendRoot() === "/vault-a" ? (path.endsWith(".canvas") ? "canvas-a" : "note-a") : "from-b";
  });
  vi.mocked(api.createNote).mockImplementation(async (path: string) => entry(path));
  const open = vi.fn(async (path: string) => {
    if (path === "/vault-a") throw new Error("restore failed");
    return { path, name: "B" };
  });
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: async () => true,
    dirty: () => false,
    vault: () => "/vault-a",
    open,
    reload: vi.fn(),
  }, { bus, others: ["note-1"], self: "main" })).resolves.toBe(false);
  expect(reads).toEqual([]);
  expect(api.createNote).not.toHaveBeenCalled();
  unsealWrites();
  setBackendRoot("/vault-a");
  setPageVault("/vault-a");
  await flushHandoff();
  await copyingNote;
  await copyingCanvas;
  expect(api.createNote).toHaveBeenCalledWith("Closed 1.md", "note-a");
  expect(api.createNote).toHaveBeenCalledWith("Board 1.canvas", "canvas-a");
  expect(reads.every((line) => line.startsWith("/vault-a"))).toBe(true);
  expect(api.createNote).not.toHaveBeenCalledWith(expect.anything(), "from-b");
});

test("boot waits for recovery and the switch stores bytes before the read root moves", () => {
  const replayAt = mainSource.indexOf("await replayHandoff()");
  const settingsAt = mainSource.indexOf("await settings.load()");
  expect(replayAt).toBeGreaterThan(0);
  expect(settingsAt).toBeGreaterThan(replayAt);
  expect(mainSource).toContain("retargetHandoff(sourceVault()");
  expect(mainSource).toContain("discardHandoff(sourceVault()");
  const preserveAt = switchSource.indexOf("if (oldRoot && !preserveAccepted(oldRoot))");
  const flipAt = switchSource.indexOf("setBackendRoot(info.path || path);");
  expect(preserveAt).toBeGreaterThan(0);
  expect(flipAt).toBeGreaterThan(preserveAt);
});
