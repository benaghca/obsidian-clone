// A mocked failing save, driven through the real editors and the real notice.
// Vitest's node environment has no window; the document here is only a stub.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { NoteEditors } from "./noteEditors";
import { SAVE_NOTICE_COALESCE_MS } from "./saveNotices";
import { resetHoldsForTests } from "./holdDrain";
import { sealWrites, unsealWrites } from "./saveSeal";
import { resetBackendRootForTests } from "./vaultRoot";
import { resetHandoffForTests, writeVaultNote } from "./vaultWrite";

vi.mock("./api", () => ({
  isTauri: false,
  api: {
    readNote: vi.fn(),
    writeNote: vi.fn(),
    writeConfig: vi.fn(),
  },
}));

const events = { shown() {}, loaded() {}, changed() {}, saved: vi.fn() };
const handoffDisk = new Map<string, string>();

class El {
  className = "";
  children: Array<El | string> = [];
  parent: El | null = null;
  private attrs = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  getAttribute(name: string) { return this.attrs.get(name); }
  addEventListener() {}
  append(...nodes: Array<El | string>) {
    for (const node of nodes) {
      if (typeof node !== "string") node.parent = this;
      this.children.push(node);
    }
  }
  remove() {
    const at = this.parent?.children.indexOf(this) ?? -1;
    if (at >= 0) this.parent?.children.splice(at, 1);
    this.parent = null;
  }
  get childElementCount() {
    return this.children.filter((child) => typeof child !== "string").length;
  }
}

function query(node: El, sel: string): El | null {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    const classes = child.className.split(/\s+/);
    if (sel.startsWith(".") && classes.includes(sel.slice(1))) return child;
    const found = query(child, sel);
    if (found) return found;
  }
  return null;
}

function textOf(node: El | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}

let body: El;

function noticeTexts(): string[] {
  const out: string[] = [];
  const walk = (node: El) => {
    if (node.className.split(/\s+/).includes("notice")) out.push(textOf(node));
    for (const child of node.children) if (typeof child !== "string") walk(child);
  };
  walk(body);
  return out;
}

function editors() {
  return new NoteEditors({} as never, events);
}

beforeEach(() => {
  vi.clearAllMocks();
  events.saved.mockClear();
  handoffDisk.clear();
  body = new El();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => handoffDisk.get(key) ?? null,
    setItem: (key: string, value: string) => { handoffDisk.set(key, value); },
    removeItem: (key: string) => { handoffDisk.delete(key); },
    key: (index: number) => [...handoffDisk.keys()][index] ?? null,
    get length() { return handoffDisk.size; },
    clear: () => { handoffDisk.clear(); },
  });
  vi.stubGlobal("document", {
    body,
    createElement: () => new El(),
    querySelector: (sel: string) => query(body, sel),
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
});

afterEach(() => {
  unsealWrites();
  resetHandoffForTests();
  resetHoldsForTests();
  resetBackendRootForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const denied = "Permission denied (os error 13)";
const told = `Couldn\u2019t save \u201CDaily\u201D: Permission denied. Grove will keep trying.`;

test("a failing save is retried on the same backoff, and the notice waits for the streak", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValue(denied);
  const notes = editors();
  await notes.load("Daily.md");
  notes.change("Daily.md", { changes: { from: 0, to: 3, insert: "kept" } });
  await notes.flush();
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  expect(api.writeNote).toHaveBeenCalledWith("Daily.md", "kept");
  expect(noticeTexts()).toEqual([]);
  await vi.advanceTimersByTimeAsync(499);
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(api.writeNote).toHaveBeenCalledTimes(2);
  expect(noticeTexts()).toEqual([]);
  await vi.advanceTimersByTimeAsync(SAVE_NOTICE_COALESCE_MS);
  expect(noticeTexts()).toEqual([told]);
  expect(document.querySelector(".notice")?.getAttribute("role")).toBe("status");
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.writeNote).toHaveBeenCalledTimes(3);
  expect(noticeTexts()).toEqual([told]);
  expect(spy).not.toHaveBeenCalledWith("Could not show a save notice", expect.anything());
  spy.mockRestore();
});

test("the notice clears when the note saves, and a keystroke keeps the streak", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValue(denied);
  const notes = editors();
  await notes.load("Daily.md");
  notes.change("Daily.md", { changes: { from: 0, to: 3, insert: "one" } });
  await notes.flush();
  notes.change("Daily.md", { changes: { from: 0, to: 3, insert: "two" } });
  await vi.advanceTimersByTimeAsync(300 + SAVE_NOTICE_COALESCE_MS);
  expect(api.writeNote).toHaveBeenLastCalledWith("Daily.md", "two");
  expect(noticeTexts()).toEqual([told]);
  vi.mocked(api.writeNote).mockResolvedValue(undefined);
  await vi.advanceTimersByTimeAsync(500 + SAVE_NOTICE_COALESCE_MS);
  expect(events.saved).toHaveBeenCalledWith("Daily.md");
  expect(noticeTexts()).toEqual([told, "Saved \u201CDaily\u201D."]);
  vi.mocked(api.writeNote).mockRejectedValue(denied);
  notes.change("Daily.md", { changes: { from: 0, to: 3, insert: "three" } });
  await notes.flush();
  expect(noticeTexts()).toEqual([told, "Saved \u201CDaily\u201D."]);
  spy.mockRestore();
});

test("one rejected write that then saves stays quiet", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValueOnce(denied);
  const notes = editors();
  await notes.load("Daily.md");
  notes.change("Daily.md", { changes: { from: 0, to: 3, insert: "kept" } });
  await notes.flush();
  await vi.advanceTimersByTimeAsync(500 + SAVE_NOTICE_COALESCE_MS);
  expect(api.writeNote).toHaveBeenCalledTimes(2);
  expect(events.saved).toHaveBeenCalledWith("Daily.md");
  expect(noticeTexts()).toEqual([]);
  spy.mockRestore();
});

test("a sealed write is not reported as a failed save", async () => {
  vi.useFakeTimers();
  sealWrites();
  const notes = editors();
  await notes.load("Daily.md");
  notes.change("Daily.md", { changes: { from: 0, to: 3, insert: "kept" } });
  await notes.flush();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(api.writeNote).not.toHaveBeenCalled();
  expect(noticeTexts()).toEqual([]);
  expect(notes.hasUnsaved()).toBe(true);
});

test("notes that fail together share one notice", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValue(denied);
  const notes = editors();
  for (const path of ["A.md", "B.md", "C.md", "D.md"]) {
    await notes.load(path);
    notes.change(path, { changes: { from: 0, to: 3, insert: "x" } });
  }
  await notes.flush();
  expect(noticeTexts()).toEqual([]);
  await vi.advanceTimersByTimeAsync(500 + SAVE_NOTICE_COALESCE_MS);
  expect(noticeTexts()).toEqual([
    "Couldn\u2019t save \u201CA\u201D, \u201CB\u201D, and 2 more: Permission denied. Grove will keep trying.",
  ]);
  expect(api.writeNote).toHaveBeenCalledTimes(8);
  spy.mockRestore();
});

test("a rejection whose message cannot be read still retries", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const broken = {};
  Object.defineProperty(broken, "message", { get() { throw new Error("no message"); } });
  vi.mocked(api.writeNote).mockRejectedValue(broken);
  const notes = editors();
  await notes.load("Daily.md");
  notes.change("Daily.md", { changes: { from: 0, to: 3, insert: "kept" } });
  await expect(notes.flush()).resolves.toBe(false);
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  expect(notes.hasUnsaved()).toBe(true);
  await vi.advanceTimersByTimeAsync(499);
  expect(api.writeNote).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(api.writeNote).toHaveBeenCalledTimes(2);
  expect(api.writeNote).toHaveBeenLastCalledWith("Daily.md", "kept");
  expect(noticeTexts()).toEqual([]);
  expect(spy).toHaveBeenCalledWith("Could not show a save notice", expect.anything());
  spy.mockRestore();
});

test("a superseded retry retires the streak without saying the note saved", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValueOnce(denied);
  const notes = editors();
  await notes.load("Daily.md");
  notes.change("Daily.md", { changes: { from: 0, to: 3, insert: "kept" } });
  await notes.flush();
  expect(notes.hasUnsaved()).toBe(true);
  vi.mocked(api.writeNote).mockResolvedValueOnce(undefined);
  await writeVaultNote("Daily.md", "newer");
  await vi.advanceTimersByTimeAsync(500 + SAVE_NOTICE_COALESCE_MS);
  expect(api.writeNote).toHaveBeenCalledTimes(2);
  expect(api.writeNote).toHaveBeenNthCalledWith(1, "Daily.md", "kept");
  expect(api.writeNote).toHaveBeenNthCalledWith(2, "Daily.md", "newer");
  expect(notes.hasUnsaved()).toBe(false);
  expect(noticeTexts()).toEqual([]);
  vi.mocked(api.writeNote).mockRejectedValue(denied);
  notes.change("Daily.md", { changes: { from: 0, to: 4, insert: "again" } });
  await notes.flush();
  await vi.advanceTimersByTimeAsync(SAVE_NOTICE_COALESCE_MS);
  expect(noticeTexts()).toEqual([]);
  await vi.advanceTimersByTimeAsync(400);
  expect(noticeTexts()).toEqual([]);
  await vi.advanceTimersByTimeAsync(SAVE_NOTICE_COALESCE_MS);
  expect(noticeTexts()).toEqual([told]);
  spy.mockRestore();
});

test("an announced streak retired by a newer write can speak again", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValue(denied);
  const notes = editors();
  await notes.load("Daily.md");
  notes.change("Daily.md", { changes: { from: 0, to: 3, insert: "kept" } });
  await notes.flush();
  await vi.advanceTimersByTimeAsync(500 + SAVE_NOTICE_COALESCE_MS);
  expect(noticeTexts()).toEqual([told]);
  vi.mocked(api.writeNote).mockResolvedValueOnce(undefined);
  await writeVaultNote("Daily.md", "newer");
  await vi.advanceTimersByTimeAsync(1000 + SAVE_NOTICE_COALESCE_MS);
  expect(noticeTexts()).toEqual([told]);
  expect(notes.hasUnsaved()).toBe(false);
  vi.mocked(api.writeNote).mockRejectedValue(denied);
  notes.change("Daily.md", { changes: { from: 0, to: 4, insert: "again" } });
  await notes.flush();
  await vi.advanceTimersByTimeAsync(500 + SAVE_NOTICE_COALESCE_MS);
  expect(noticeTexts()).toEqual([
    told,
    "Couldn\u2019t save \u201CDaily\u201D: Permission denied. Grove will keep trying.",
  ]);
  spy.mockRestore();
});

test("a rename keeps one streak and the notice uses the new name", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(api.writeNote).mockRejectedValue(denied);
  const notes = editors();
  await notes.load("Old.md");
  notes.change("Old.md", { changes: { from: 0, to: 3, insert: "kept" } });
  await notes.flush();
  notes.move((path) => path === "Old.md", (path) => (path === "Old.md" ? "New.md" : path));
  await vi.advanceTimersByTimeAsync(500 + SAVE_NOTICE_COALESCE_MS);
  expect(api.writeNote).toHaveBeenLastCalledWith("New.md", "kept");
  expect(noticeTexts()).toEqual([
    "Couldn\u2019t save \u201CNew\u201D: Permission denied. Grove will keep trying.",
  ]);
  spy.mockRestore();
});
