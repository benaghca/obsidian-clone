// Invisible save-loss holes: a rename that drops a pending edit, a failed
// write that forgets the note is dirty, and a merge that deletes the source
// anyway. These assert the behaviour the app must keep; they do not open a window.
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { trackCanvas } from "./canvas/pending";
import { trackDrawing } from "./drawing/pending";
import { fileSave } from "./fileSave";
import { mergeNote } from "./fileOps";
import { NoteEditors } from "./noteEditors";
import { bindCloseFlush, flushOpenSaves, QUIT_FLUSH_MS } from "./quitFlush";
import { settings } from "./settings/store";
import type { Workspace } from "./workspace";

vi.mock("./api", () => ({
  api: {
    readNote: vi.fn(),
    writeNote: vi.fn(),
    writeConfig: vi.fn(),
    deletePath: vi.fn(),
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
});

afterEach(() => {
  vi.useRealTimers();
});

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
  const pending = settings.flush() as Promise<void> | undefined;
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
