// Invisible save-loss holes: a rename that drops a pending edit, a failed
// write that forgets the note is dirty, and a merge that deletes the source
// anyway. These assert the behaviour the app must keep; they do not open a window.
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import mainSource from "./main.ts?raw";
import { api } from "./api";
import { attachCanvas, discardCanvases, trackCanvas } from "./canvas/pending";
import { attachDrawing, discardDrawings, trackDrawing } from "./drawing/pending";
import { deleteFile, mergeNote, renameFile } from "./fileOps";
import { fileSave } from "./fileSave";
import { NoteEditors } from "./noteEditors";
import { bindCloseFlush, flushOpenSaves, QUIT_FLUSH_MS, requestClose } from "./quitFlush";
import { unsealWrites, writesSealed } from "./saveSeal";
import { settings } from "./settings/store";
import { commitVaultSwitch, installVaultSwitch, localSaveBus } from "./vaultSwitch";
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

function editors() {
  return new NoteEditors({} as never, events);
}

beforeEach(() => {
  vi.clearAllMocks();
  events.saved.mockClear();
  // Vitest's node environment has no DOM. Saves schedule through window.setTimeout,
  // forwarded to the global so fake timers still own the clock.
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
  unsealWrites();
  discardCanvases(() => true);
  discardDrawings(() => true);
  vi.useRealTimers();
  if (settings.get("app.json").showLineNumber) {
    vi.mocked(api.writeConfig).mockResolvedValue(undefined);
    settings.set("app.json", "showLineNumber", false);
    await settings.flush();
  }
});

async function drain() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function renameWs(notes: NoteEditors, path: string): Workspace {
  return {
    vault: {
      isFolder: () => false,
      files: [{ path }],
      notes: [],
      fileRefs: () => [],
    },
    editors: notes,
    followMove: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
  } as unknown as Workspace;
}

test("a keystroke waiting out a rename is written to the new path", async () => {
  vi.useFakeTimers();
  const notes = editors();
  await notes.load("Old.md");
  notes.change("Old.md", { changes: { from: 0, to: 3, insert: "typed" } });
  notes.move((path) => path === "Old.md", (path) => (path === "Old.md" ? "New.md" : path));
  await vi.advanceTimersByTimeAsync(300);
  expect(api.writeNote).toHaveBeenCalledWith("New.md", "typed");
  expect(api.writeNote).not.toHaveBeenCalledWith("Old.md", expect.anything());
});

test("an in-flight save still lands the edited text on the new path", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  vi.mocked(api.writeNote).mockImplementation((path: string) => {
    if (path === "Old.md") return new Promise<void>((resolve) => { release = resolve; });
    return Promise.resolve();
  });
  const notes = editors();
  await notes.load("Old.md");
  notes.change("Old.md", { changes: { from: 0, to: 3, insert: "typed" } });
  const saving = notes.flush();
  await vi.waitFor(() => expect(api.writeNote).toHaveBeenCalledWith("Old.md", "typed"));
  notes.move((path) => path === "Old.md", (path) => (path === "Old.md" ? "New.md" : path));
  release();
  await saving;
  expect(api.writeNote).toHaveBeenCalledWith("New.md", "typed");
  expect(notes.doc("New.md")!.toString()).toBe("typed");
});

test("a flush writes text that arrives while the save is in flight", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  let calls = 0;
  vi.mocked(api.writeNote).mockImplementation(() => {
    calls += 1;
    if (calls === 1) return new Promise<void>((resolve) => { release = resolve; });
    return Promise.resolve();
  });
  const notes = editors();
  await notes.load("A.md");
  notes.change("A.md", { changes: { from: 0, to: 3, insert: "one" } });
  const saving = notes.flush();
  await vi.waitFor(() => expect(api.writeNote).toHaveBeenCalledWith("A.md", "one"));
  notes.change("A.md", { changes: { from: 0, to: 3, insert: "two" } });
  release();
  await saving;
  expect(api.writeNote).toHaveBeenCalledWith("A.md", "two");
  expect(notes.doc("A.md")!.toString()).toBe("two");
});

test("a failed write stays dirty, retries, and a later success clears it", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(undefined);
  const notes = editors();
  await notes.load("A.md");
  notes.change("A.md", { changes: { from: 0, to: 3, insert: "kept" } });
  await expect(notes.flush()).resolves.toBe(false);
  expect(events.saved).not.toHaveBeenCalled();
  expect(notes.doc("A.md")!.toString()).toBe("kept");
  await vi.advanceTimersByTimeAsync(499);
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() => expect(api.writeNote).toHaveBeenCalledTimes(2));
  expect(api.writeNote).toHaveBeenLastCalledWith("A.md", "kept");
  expect(events.saved).toHaveBeenCalledWith("A.md");
  await expect(notes.flush()).resolves.toBe(true);
  expect(api.writeNote).toHaveBeenCalledTimes(2);
  spy.mockRestore();
});

test("a reload does not replace text whose save failed", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValueOnce(new Error("denied"));
  const notes = editors();
  await notes.load("A.md");
  notes.change("A.md", { changes: { from: 0, to: 3, insert: "kept" } });
  await notes.flush();
  vi.mocked(api.readNote).mockResolvedValue("from-disk");
  await notes.reload("A.md");
  expect(notes.doc("A.md")!.toString()).toBe("kept");
  spy.mockRestore();
});

test("mergeNote does not delete the source when the target save fails", async () => {
  const saveNow = vi.fn().mockResolvedValue(false);
  const ws = {
    editors: {
      text: async () => "from",
      load: async () => ({ doc: { length: 2, sliceString: () => "o" } }),
      doc: () => ({ length: 2, sliceString: () => "o" }),
      change: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      forget: vi.fn(),
      hold() {},
      release() {},
    },
    saveNow,
    layout: { tabs: () => [] },
    reopen: vi.fn(),
    forget: vi.fn().mockResolvedValue(undefined),
  } as unknown as Workspace;
  await mergeNote(ws, "From.md", "Into.md");
  expect(saveNow).toHaveBeenCalledWith("Into.md");
  expect(api.deletePath).not.toHaveBeenCalled();
  expect(ws.reopen).not.toHaveBeenCalled();
});

test("mergeNote still deletes the source after the target save succeeds", async () => {
  const saveNow = vi.fn().mockResolvedValue(true);
  const ws = {
    editors: {
      text: async () => "from",
      load: async () => ({ doc: { length: 2, sliceString: () => "o" } }),
      doc: () => ({ length: 2, sliceString: () => "o" }),
      change: vi.fn(),
      flush: vi.fn().mockResolvedValue(true),
      forget: vi.fn(),
      hold() {},
      release() {},
    },
    saveNow,
    layout: { tabs: () => [] },
    reopen: vi.fn(),
    forget: vi.fn().mockResolvedValue(undefined),
  } as unknown as Workspace;
  await mergeNote(ws, "From.md", "Into.md");
  expect(api.deletePath).toHaveBeenCalledWith("From.md", false);
  expect(ws.reopen).toHaveBeenCalled();
});

test("flushing settings waits until the write finishes", async () => {
  let release!: () => void;
  vi.mocked(api.writeConfig).mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
  expect(settings.set("app.json", "showLineNumber", true)).toBe(true);
  const pending = settings.flush();
  expect(pending).toBeInstanceOf(Promise);
  let done = false;
  void pending!.then(() => { done = true; });
  await Promise.resolve();
  await Promise.resolve();
  expect(done).toBe(false);
  expect(api.writeConfig).toHaveBeenCalled();
  release();
  await pending;
  expect(done).toBe(true);
  settings.set("app.json", "showLineNumber", false);
  await settings.flush();
});

test("a canvas or drawing write stays dirty and retries until it succeeds", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  let body = "board";
  const write = vi.fn<(text: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error("full"))
    .mockResolvedValueOnce(undefined);
  const saved = vi.fn();
  const disk = fileSave({
    delay: 300,
    text: () => body,
    write,
    onSaved: saved,
    onError: (err) => console.error("save failed", err),
  });
  disk.touch();
  await vi.advanceTimersByTimeAsync(300);
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith("board");
  expect(disk.dirty).toBe(true);
  expect(saved).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(499);
  expect(write).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(write).toHaveBeenCalledTimes(2);
  expect(disk.dirty).toBe(false);
  expect(saved).toHaveBeenCalledOnce();
  body = "later";
  await disk.flush();
  expect(write).toHaveBeenCalledTimes(2);
  spy.mockRestore();
});

test("a close request waits for a pending note, canvas, drawing and settings write", async () => {
  vi.useFakeTimers();
  const notes = editors();
  await notes.load("Note.md");
  notes.change("Note.md", { changes: { from: 0, to: 3, insert: "typed" } });
  let releaseNote!: () => void;
  vi.mocked(api.writeNote).mockReturnValue(new Promise((resolve) => { releaseNote = resolve; }));
  let releaseCanvas!: () => void;
  const untrackCanvas = trackCanvas({ path: "Board.canvas", save: () => new Promise((resolve) => { releaseCanvas = resolve; }) });
  let releaseDrawing!: () => void;
  const untrackDrawing = trackDrawing({ path: "Sketch.excalidraw", save: () => new Promise((resolve) => { releaseDrawing = resolve; }) });
  let releaseConfig!: () => void;
  vi.mocked(api.writeConfig).mockReturnValue(new Promise((resolve) => { releaseConfig = resolve; }));
  expect(settings.set("app.json", "showLineNumber", true)).toBe(true);

  const destroy = vi.fn().mockResolvedValue(undefined);
  let prevented = false;
  let handler!: (event: { preventDefault(): void }) => void | Promise<void>;
  await bindCloseFlush({
    onCloseRequested: async (next) => { handler = next; },
    destroy,
  }, () => flushOpenSaves(() => notes.flush()));

  const closing = handler({ preventDefault() { prevented = true; } });
  await Promise.resolve();
  await Promise.resolve();
  expect(prevented).toBe(true);
  expect(destroy).not.toHaveBeenCalled();
  expect(api.writeNote).toHaveBeenCalledWith("Note.md", "typed");
  expect(api.writeConfig).toHaveBeenCalled();

  // Enough turns for a finished write to reach destroy(). Each release leaves the others holding the close.
  const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  releaseNote();
  await drain();
  expect(destroy).not.toHaveBeenCalled();
  releaseCanvas();
  await drain();
  expect(destroy).not.toHaveBeenCalled();
  releaseDrawing();
  await drain();
  expect(destroy).not.toHaveBeenCalled();
  releaseConfig();
  await closing;
  expect(destroy).toHaveBeenCalledOnce();

  untrackCanvas();
  untrackDrawing();
  settings.set("app.json", "showLineNumber", false);
  vi.mocked(api.writeConfig).mockResolvedValue(undefined);
  await settings.flush();
});

test("a close request stops waiting after a short timeout", async () => {
  vi.useFakeTimers();
  const destroy = vi.fn().mockResolvedValue(undefined);
  let handler!: (event: { preventDefault(): void }) => void | Promise<void>;
  await bindCloseFlush({
    onCloseRequested: async (next) => { handler = next; },
    destroy,
  }, () => new Promise(() => {}), QUIT_FLUSH_MS);
  const closing = handler({ preventDefault() {} });
  await vi.advanceTimersByTimeAsync(QUIT_FLUSH_MS - 1);
  expect(destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await closing;
  expect(destroy).toHaveBeenCalledOnce();
});

test("a vault switch writes a pending note before the new vault opens", async () => {
  vi.useFakeTimers();
  const notes = editors();
  await notes.load("Note.md");
  notes.change("Note.md", { changes: { from: 0, to: 3, insert: "from-a" } });
  const seen: number[] = [];
  const open = vi.fn(async () => {
    seen.push(vi.mocked(api.writeNote).mock.calls.length);
    return { path: "/vault-b", name: "B" };
  });
  const reload = vi.fn();
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: () => notes.flush(),
    dirty: () => notes.hasUnsaved(),
    open,
    reload,
  })).resolves.toBe(true);
  expect(api.writeNote).toHaveBeenCalledWith("Note.md", "from-a");
  expect(seen).toEqual([1]);
  const landed = vi.mocked(api.writeNote).mock.calls.length;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(api.writeNote).toHaveBeenCalledTimes(landed);
  expect(reload).toHaveBeenCalledOnce();
  expect(writesSealed()).toBe(true);
});

test("a failed save blocks the vault switch and the retry stays on the old vault", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValueOnce(new Error("full")).mockResolvedValue(undefined);
  const notes = editors();
  await notes.load("Note.md");
  notes.change("Note.md", { changes: { from: 0, to: 3, insert: "from-a" } });
  const open = vi.fn();
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: () => notes.flush(),
    dirty: () => notes.hasUnsaved(),
    open,
    reload() {},
  })).resolves.toBe(false);
  expect(open).not.toHaveBeenCalled();
  expect(writesSealed()).toBe(false);
  // The flush ran before the switch was refused. A stuck switch flag would
  // skip it and only the later debounce would write.
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(499);
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() => expect(api.writeNote).toHaveBeenCalledTimes(2));
  expect(api.writeNote).toHaveBeenLastCalledWith("Note.md", "from-a");
  spy.mockRestore();
});

test("a vault switch does not open when a pop-out save fails", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValue(new Error("full"));
  const bus = localSaveBus();
  const popout = editors();
  await popout.load("Note.md");
  popout.change("Note.md", { changes: { from: 0, to: 3, insert: "from-popout" } });
  const reload = vi.fn();
  await installVaultSwitch({
    flushNotes: () => popout.flush(),
    dirty: () => popout.hasUnsaved(),
    reload,
  }, { bus, self: "note-1" });
  const open = vi.fn(async () => ({ path: "/vault-b", name: "B" }));
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: async () => true,
    dirty: () => false,
    open,
    reload() {},
  }, { bus, others: ["note-1"], self: "main" })).resolves.toBe(false);
  expect(api.writeNote).toHaveBeenCalledWith("Note.md", "from-popout");
  expect(open).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  expect(writesSealed()).toBe(false);
  spy.mockRestore();
});

test("a vault switch writes a pop-out's pending note before opening", async () => {
  vi.useFakeTimers();
  const bus = localSaveBus();
  const popout = editors();
  await popout.load("Note.md");
  popout.change("Note.md", { changes: { from: 0, to: 3, insert: "from-popout" } });
  const reload = vi.fn();
  await installVaultSwitch({
    flushNotes: () => popout.flush(),
    dirty: () => popout.hasUnsaved(),
    reload,
  }, { bus, self: "note-1" });
  const seen: number[] = [];
  const open = vi.fn(async () => {
    seen.push(vi.mocked(api.writeNote).mock.calls.length);
    return { path: "/vault-b", name: "B" };
  });
  await expect(commitVaultSwitch("/vault-b", false, {
    flushNotes: async () => true,
    dirty: () => false,
    open,
    reload() {},
  }, { bus, others: ["note-1"], self: "main" })).resolves.toBe(true);
  expect(api.writeNote).toHaveBeenCalledWith("Note.md", "from-popout");
  expect(seen).toEqual([1]);
  expect(reload).toHaveBeenCalledOnce();
});

test("a vault switch aborts when another window never answers", async () => {
  vi.useFakeTimers();
  const open = vi.fn();
  const pending = commitVaultSwitch("/vault-b", false, {
    flushNotes: async () => true,
    dirty: () => false,
    open,
    reload() {},
  }, { bus: localSaveBus(), others: ["ghost"], self: "main" });
  await vi.advanceTimersByTimeAsync(1_999);
  expect(open).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).resolves.toBe(false);
  expect(open).not.toHaveBeenCalled();
  expect(writesSealed()).toBe(false);
});

test("typing while a rename is in flight is written only to the new path", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  vi.mocked(api.renamePath).mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const notes = editors();
  await notes.load("Old.md");
  const pending = renameFile(renameWs(notes, "Old.md"), "Old.md", "New");
  await vi.waitFor(() => expect(api.renamePath).toHaveBeenCalledWith("Old.md", "New.md"));
  notes.change("Old.md", { changes: { from: 0, to: 3, insert: "newest" } });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(api.writeNote).not.toHaveBeenCalled();
  release();
  await pending;
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  expect(api.writeNote).toHaveBeenCalledWith("New.md", "newest");
});

test("a failed rename keeps the pending edit on the old path", async () => {
  vi.useFakeTimers();
  let fail!: (err: Error) => void;
  vi.mocked(api.renamePath).mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
  const notes = editors();
  await notes.load("Old.md");
  const pending = renameFile(renameWs(notes, "Old.md"), "Old.md", "New");
  await vi.waitFor(() => expect(api.renamePath).toHaveBeenCalled());
  notes.change("Old.md", { changes: { from: 0, to: 3, insert: "newest" } });
  fail(new Error("no"));
  await expect(pending).rejects.toThrow("no");
  await vi.advanceTimersByTimeAsync(300);
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  expect(api.writeNote).toHaveBeenCalledWith("Old.md", "newest");
});

test("a canvas edited during rename is written only to the new path", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  vi.mocked(api.renamePath).mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const notes = editors();
  const board = attachCanvas("Old.canvas");
  const pending = renameFile(renameWs(notes, "Old.canvas"), "Old.canvas", "New");
  await vi.waitFor(() => expect(api.renamePath).toHaveBeenCalledWith("Old.canvas", "New.canvas"));
  board.setText('{"nodes":2}');
  board.touch();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(api.writeNote).not.toHaveBeenCalled();
  release();
  await pending;
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  expect(api.writeNote).toHaveBeenCalledWith("New.canvas", '{"nodes":2}');
});

test("a failed canvas or drawing save does not recreate the file after delete", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValue(new Error("full"));
  const notes = editors();
  for (const [attach, path] of [[attachCanvas, "Gone.canvas"], [attachDrawing, "Gone.excalidraw"]] as const) {
    vi.mocked(api.writeNote).mockClear();
    const owned = attach(path);
    owned.setText("v1");
    owned.touch();
    await vi.advanceTimersByTimeAsync(300);
    expect(api.writeNote).toHaveBeenCalledTimes(1);
    await deleteFile(renameWs(notes, path), path, { confirmed: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.writeNote).toHaveBeenCalledTimes(1);
    expect(api.deletePath).toHaveBeenCalledWith(path, false);
  }
  spy.mockRestore();
});

test("a closed canvas keeps a failed save and a reopen uses that writer", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValue(new Error("full"));
  const board = attachCanvas("Board.canvas");
  board.setText("v1");
  board.touch();
  await vi.advanceTimersByTimeAsync(300);
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  board.detach();
  await drain();
  expect(api.writeNote).toHaveBeenCalledTimes(2);
  const again = attachCanvas("Board.canvas");
  expect(again.dirty).toBe(true);
  expect(again.text()).toBe("v1");
  again.setText("v2");
  again.touch();
  vi.mocked(api.writeNote).mockResolvedValue(undefined);
  await vi.advanceTimersByTimeAsync(300);
  expect(api.writeNote).toHaveBeenCalledTimes(3);
  expect(api.writeNote).toHaveBeenLastCalledWith("Board.canvas", "v2");
  spy.mockRestore();
});

test("closing the window retries a canvas whose tab already closed", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote)
    .mockRejectedValueOnce(new Error("full"))
    .mockRejectedValueOnce(new Error("full"))
    .mockRejectedValueOnce(new Error("full"))
    .mockResolvedValueOnce(undefined);
  const board = attachCanvas("Board.canvas");
  board.setText("v1");
  board.touch();
  await vi.advanceTimersByTimeAsync(300);
  board.detach();
  await drain();
  expect(api.writeNote).toHaveBeenCalledTimes(2);
  const destroy = vi.fn().mockResolvedValue(undefined);
  let handler!: (event: { preventDefault(): void }) => void | Promise<void>;
  await bindCloseFlush({
    onCloseRequested: async (next) => { handler = next; },
    destroy,
  }, () => flushOpenSaves(() => Promise.resolve(true)));
  const closing = handler({ preventDefault() {} });
  await drain();
  expect(destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(499);
  expect(destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await closing;
  expect(destroy).toHaveBeenCalledOnce();
  expect(api.writeNote).toHaveBeenLastCalledWith("Board.canvas", "v1");
  spy.mockRestore();
});

test("a close waits for a save that fails once and then succeeds", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValueOnce(new Error("full")).mockResolvedValue(undefined);
  const notes = editors();
  await notes.load("Note.md");
  notes.change("Note.md", { changes: { from: 0, to: 3, insert: "kept" } });
  const destroy = vi.fn().mockResolvedValue(undefined);
  let handler!: (event: { preventDefault(): void }) => void | Promise<void>;
  await bindCloseFlush({
    onCloseRequested: async (next) => { handler = next; },
    destroy,
  }, () => flushOpenSaves(() => notes.flush()));
  const closing = handler({ preventDefault() {} });
  await drain();
  expect(destroy).not.toHaveBeenCalled();
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(499);
  expect(destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await closing;
  expect(destroy).toHaveBeenCalledOnce();
  expect(api.writeNote).toHaveBeenLastCalledWith("Note.md", "kept");
  spy.mockRestore();
});

test("the titlebar close starts the deadline instead of waiting on a flush that never ends", async () => {
  vi.useFakeTimers();
  const destroy = vi.fn().mockResolvedValue(undefined);
  let handler!: (event: { preventDefault(): void }) => void | Promise<void>;
  const win = {
    onCloseRequested: async (next: typeof handler) => { handler = next; },
    destroy,
    close() { void handler({ preventDefault() {} }); },
  };
  await bindCloseFlush(win, () => new Promise(() => {}));
  requestClose(win);
  await vi.advanceTimersByTimeAsync(QUIT_FLUSH_MS - 1);
  expect(destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(destroy).toHaveBeenCalledOnce();
  expect(mainSource).toContain("requestClose(win)");
  expect(mainSource).not.toContain("flushOpenSaves(() => ws.editors.flush()).finally");
});

test("settings flush writes the value changed while the previous write was in flight", async () => {
  vi.useFakeTimers();
  const writes: string[] = [];
  let release!: () => void;
  vi.mocked(api.writeConfig).mockImplementation((_file: string, text: string) => {
    writes.push(text);
    if (writes.length === 1) return new Promise<void>((resolve) => { release = resolve; });
    return Promise.resolve();
  });
  try {
    expect(settings.set("app.json", "showLineNumber", true)).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('"showLineNumber": true');
    expect(settings.set("app.json", "showLineNumber", false)).toBe(true);
    const pending = settings.flush();
    let done = false;
    void pending.then(() => { done = true; });
    await drain();
    expect(done).toBe(false);
    release();
    await pending;
    expect(done).toBe(true);
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes.at(-1)).not.toContain('"showLineNumber": true');
    expect(settings.get("app.json").showLineNumber).toBe(false);
    const landed = writes.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(writes).toHaveLength(landed);
  } finally {
    if (settings.get("app.json").showLineNumber) settings.set("app.json", "showLineNumber", false);
    vi.mocked(api.writeConfig).mockResolvedValue(undefined);
    await settings.flush();
  }
});

test("a keystroke during a save keeps the rest of its debounce", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  vi.mocked(api.writeNote).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const notes = editors();
  await notes.load("A.md");
  notes.change("A.md", { changes: { from: 0, to: 3, insert: "one" } });
  await vi.advanceTimersByTimeAsync(300);
  await vi.waitFor(() => expect(api.writeNote).toHaveBeenCalledTimes(1));
  notes.change("A.md", { changes: { from: 0, to: 3, insert: "two" } });
  notes.move((path) => path === "A.md", (path) => (path === "A.md" ? "B.md" : path));
  release();
  await drain();
  await vi.advanceTimersByTimeAsync(299);
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() => expect(api.writeNote).toHaveBeenLastCalledWith("B.md", "two"));
});
