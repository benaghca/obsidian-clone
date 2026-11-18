// An outside change to a clean open note (a sync, git, another app) is applied
// as the smallest edit, so the cursor and selection stay on the text they were
// on, and it stays out of undo, so Ctrl+Z cannot bring the old text back and
// save it over the synced file. No window: these run on the note's state.
import { redo, undo, undoDepth } from "@codemirror/commands";
import { EditorSelection, type EditorState, type Transaction } from "@codemirror/state";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { MAX_LINE_EDITS, minimalChanges, normalizeLineBreaks, type TextEdit } from "./editor/minimalChange";
import { NoteEditors } from "./noteEditors";
import { resetBackendRootForTests } from "./vaultRoot";
import { resetHoldsForTests } from "./holdDrain";
import { resetHandoffForTests } from "./vaultWrite";

vi.mock("./api", () => ({
  isTauri: false,
  api: { readNote: vi.fn(), writeNote: vi.fn() },
}));

const events = { shown() {}, loaded() {}, changed() {}, saved: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", {
    setTimeout: (fn: TimerHandler, ms?: number, ...rest: unknown[]) => globalThis.setTimeout(fn, ms, ...rest),
    clearTimeout: (id?: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
    addEventListener() {},
    removeEventListener() {},
  });
  vi.mocked(api.writeNote).mockResolvedValue(undefined);
});

afterEach(() => {
  resetHandoffForTests();
  resetHoldsForTests();
  resetBackendRootForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function apply(old: string, edits: TextEdit[]): string {
  let out = "", at = 0;
  for (const e of edits) {
    expect(e.from).toBeGreaterThanOrEqual(at);
    expect(e.to).toBeGreaterThanOrEqual(e.from);
    out += old.slice(at, e.from) + e.insert;
    at = e.to;
  }
  return out + old.slice(at);
}

/** A small deterministic generator, so a failure reproduces. */
function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

const lines = (n: number, tag = "line") => Array.from({ length: n }, (_, i) => `${tag} ${i} lorem ipsum dolor`).join("\n");

/** A loaded note with the caret (or selection) placed, and the disk text the next reload reads. */
async function opened(text: string, anchor: number, head = anchor) {
  vi.mocked(api.readNote).mockResolvedValue(text);
  const notes = new NoteEditors({} as never, events);
  await notes.load("A.md");
  notes.change("A.md", { selection: EditorSelection.single(anchor, head) });
  const state = () => (notes as unknown as { states: Map<string, EditorState> }).states.get("A.md")!;
  const sync = async (disk: string) => {
    vi.mocked(api.readNote).mockResolvedValue(disk);
    await notes.reload("A.md");
  };
  return { notes, state, sync };
}

// ----- the diff -----

test("equal texts need no edit", () => {
  expect(minimalChanges("a\nb\n", "a\nb\n")).toEqual([]);
  expect(minimalChanges("", "")).toEqual([]);
});

test("an edit is only the characters that changed", () => {
  expect(minimalChanges("one\ntwo\nthree", "one\ntwo!\nthree")).toEqual([{ from: 7, to: 7, insert: "!" }]);
  expect(minimalChanges("one\ntwo\nthree", "zero\none\ntwo\nthree")).toEqual([{ from: 0, to: 0, insert: "zero\n" }]);
  expect(minimalChanges("one\ntwo\nthree", "one\nthree")).toEqual([{ from: 4, to: 8, insert: "" }]);
  expect(minimalChanges("", "new")).toEqual([{ from: 0, to: 0, insert: "new" }]);
  expect(minimalChanges("old", "")).toEqual([{ from: 0, to: 3, insert: "" }]);
});

test("edits far apart stay apart, so the text between them is untouched", () => {
  const old = lines(100);
  const next = old.replace("line 3 ", "LINE 3 ").replace("line 90 ", "LINE 90 ");
  const edits = minimalChanges(old, next);
  expect(edits).toHaveLength(2);
  expect(edits[0].to).toBeLessThan(old.indexOf("line 4 "));
  expect(edits[1].from).toBeGreaterThan(old.indexOf("line 89 "));
});

test("random edits always rebuild the new text exactly", () => {
  const next = random(7);
  const words = ["alpha", "beta", "", "gamma delta", "- [ ] task", "# head", "beta"];
  for (let round = 0; round < 400; round++) {
    const base = Array.from({ length: Math.floor(next() * 30) }, () => words[Math.floor(next() * words.length)]);
    const changed = [...base];
    for (let n = Math.floor(next() * 6); n > 0; n--) {
      const at = Math.floor(next() * (changed.length + 1));
      const pick = next();
      if (pick < 0.33) changed.splice(at, 0, words[Math.floor(next() * words.length)]);
      else if (pick < 0.66) changed.splice(at, 1);
      else if (changed.length) changed[Math.min(at, changed.length - 1)] += "x";
    }
    const tail = () => (next() < 0.5 ? "\n" : "");
    const old = base.join("\n") + tail(), now = changed.join("\n") + tail();
    expect(apply(old, minimalChanges(old, now))).toBe(now);
    // Past the edit limit it falls back to one block, which is still exact.
    expect(apply(old, minimalChanges(old, now, 1))).toBe(now);
  }
});

test("random edits inside lines, emoji included, rebuild the text and never split a pair", () => {
  const next = random(11);
  const chars = ["a", "b", " ", "😀", "😁", "é", "\n", "-", "x"];
  for (let round = 0; round < 400; round++) {
    const base = Array.from({ length: Math.floor(next() * 60) }, () => chars[Math.floor(next() * chars.length)]);
    const changed = [...base];
    for (let n = Math.floor(next() * 5); n > 0; n--) {
      const at = Math.floor(next() * (changed.length + 1));
      if (next() < 0.5) changed.splice(at, 0, chars[Math.floor(next() * chars.length)]);
      else changed.splice(at, 1);
    }
    const old = base.join(""), now = changed.join("");
    const edits = minimalChanges(old, now);
    expect(apply(old, edits)).toBe(now);
    for (const e of edits) {
      for (const at of [e.from, e.to]) expect(at > 0 && at < old.length && /[\udc00-\udfff]/.test(old[at])).toBe(false);
    }
  }
});

test("CRLF text from disk compares as the editor's \\n text", () => {
  expect(normalizeLineBreaks("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  expect(minimalChanges("a\nb", normalizeLineBreaks("a\r\nb"))).toEqual([]);
});

// ----- cursor and selection -----

test("an outside insert above the caret moves the caret with its text", async () => {
  const text = lines(50);
  const caret = text.indexOf("line 30 ") + 5;
  const { state, sync } = await opened(text, caret);
  await sync(text.replace("line 2 ", "new above\nline 2 "));
  const s = state();
  expect(s.doc.toString()).toContain("new above");
  expect(s.selection.main.head).toBe(caret + "new above\n".length);
  expect(s.doc.sliceString(s.selection.main.head - 5, s.selection.main.head + 3)).toBe("line 30 ");
});

test("an outside insert below the caret leaves it alone", async () => {
  const text = lines(50);
  const caret = text.indexOf("line 10 ") + 3;
  const { state, sync } = await opened(text, caret);
  await sync(text.replace("line 40 ", "new below\nline 40 "));
  expect(state().selection.main.head).toBe(caret);
});

test("outside inserts on both sides of the caret keep it between the same characters", async () => {
  const text = lines(50);
  const caret = text.indexOf("line 25 ") + 5;
  const { state, sync } = await opened(text, caret);
  await sync(text.replace("line 24 ", "before\nline 24 ").replace("line 26 ", "after\nline 26 "));
  const s = state();
  expect(s.selection.main.head).toBe(caret + "before\n".length);
  expect(s.doc.sliceString(s.selection.main.head - 5, s.selection.main.head)).toBe("line ");
});

test("a selection keeps both ends when the sync edits inside and around it", async () => {
  const text = lines(50);
  const anchor = text.indexOf("line 20 "), head = text.indexOf("line 30 ");
  const { state, sync } = await opened(text, anchor, head);
  await sync(text.replace("line 5 ", "top\nline 5 ").replace("line 25 lorem", "line 25 LOREM, edited").replace("line 45 ", "bottom\nline 45 "));
  const s = state();
  expect(s.doc.sliceString(s.selection.main.anchor, s.selection.main.anchor + 8)).toBe("line 20 ");
  expect(s.doc.sliceString(s.selection.main.head, s.selection.main.head + 8)).toBe("line 30 ");
  expect(s.sliceDoc(s.selection.main.from, s.selection.main.to)).toContain("LOREM, edited");
});

test("an outside edit on the caret's own line keeps the caret's column", async () => {
  const text = lines(20);
  const lineStart = text.indexOf("line 7 ");
  const caret = lineStart + 6; // "line 7| lorem"
  const { state, sync } = await opened(text, caret);
  // Another app appends to the end of this line and fixes a word earlier on it.
  await sync(text.replace("line 7 lorem ipsum dolor", "Line 7 lorem ipsum dolor sit amet"));
  const s = state();
  expect(s.selection.main.head).toBe(caret);
  expect(s.doc.lineAt(caret).text).toBe("Line 7 lorem ipsum dolor sit amet");
});

test("an outside edit that deletes the caret's line puts it where the line was", async () => {
  const text = lines(20);
  const caret = text.indexOf("line 9 ") + 4;
  const { state, sync } = await opened(text, caret);
  await sync(text.replace("line 9 lorem ipsum dolor\n", ""));
  const s = state();
  expect(s.selection.main.head).toBe(text.indexOf("line 9 "));
  expect(s.doc.lineAt(s.selection.main.head).text).toBe("line 10 lorem ipsum dolor");
});

// ----- undo -----

test("undo after a reload has nothing to undo and never saves", async () => {
  vi.useFakeTimers();
  const text = lines(10);
  const { notes, state, sync } = await opened(text, 3);
  await sync(text + "\nsynced line");
  expect(undoDepth(state())).toBe(0);
  let undone: Transaction | null = null;
  expect(undo({ state: state(), dispatch: (tr) => { undone = tr; } })).toBe(false);
  expect(undone).toBeNull();
  expect(state().doc.toString()).toBe(text + "\nsynced line");
  expect(notes.hasUnsaved()).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.writeNote).not.toHaveBeenCalled();
});

test("undo after a reload takes back your own edit only, mapped past the synced text", async () => {
  vi.useFakeTimers();
  const text = lines(10);
  const { notes, state, sync } = await opened(text, 0);
  const at = text.indexOf("line 8 ");
  notes.change("A.md", { changes: { from: at, insert: "mine " }, userEvent: "input.type" });
  await notes.flush();
  expect(api.writeNote).toHaveBeenLastCalledWith("A.md", expect.stringContaining("mine line 8"));
  const typed = state().doc.toString();
  const synced = typed.replace("line 1 ", "synced\nline 1 ");
  await sync(synced);
  expect(state().doc.toString()).toBe(synced);
  expect(undoDepth(state())).toBe(1);
  let undone!: Transaction;
  expect(undo({ state: state(), dispatch: (tr) => { undone = tr; } })).toBe(true);
  // The pre-sync text does not come back: only "mine " goes.
  expect(undone.state.doc.toString()).toBe(synced.replace("mine ", ""));
  expect(undone.state.doc.toString()).toContain("synced\nline 1 ");
  // Redo after it stays mapped too.
  let redone!: Transaction;
  expect(redo({ state: undone.state, dispatch: (tr) => { redone = tr; } })).toBe(true);
  expect(redone.state.doc.toString()).toBe(synced);
});

test("typing after a reload starts a new undo step, so undo stops at the synced text", async () => {
  const text = lines(5);
  const { notes, state, sync } = await opened(text, 0);
  notes.change("A.md", { changes: { from: 0, insert: "a" }, userEvent: "input.type" });
  await notes.flush();
  await sync("a" + text + "\nsynced");
  notes.change("A.md", { changes: { from: 1, insert: "b" }, userEvent: "input.type" });
  expect(undoDepth(state())).toBe(2);
  let undone!: Transaction;
  undo({ state: state(), dispatch: (tr) => { undone = tr; } });
  expect(undone.state.doc.toString()).toBe("a" + text + "\nsynced");
  await notes.flush();
});

// ----- guards and quiet cases -----

test("a CRLF file with the same text is not a change", async () => {
  const { state, sync } = await opened("one\ntwo\n", 2);
  const before = state();
  await sync("one\r\ntwo\r\n");
  expect(state()).toBe(before);
  expect(events.saved).not.toHaveBeenCalled();
});

test("a reload still waits while an edit is pending its save", async () => {
  vi.useFakeTimers();
  const { notes, state, sync } = await opened("disk", 0);
  notes.change("A.md", { changes: { from: 4, insert: " typed" }, userEvent: "input.type" });
  await sync("outside");
  expect(state().doc.toString()).toBe("disk typed");
  await vi.advanceTimersByTimeAsync(300);
  expect(api.writeNote).toHaveBeenLastCalledWith("A.md", "disk typed");
});

test("the reload marks the note's previews stale and schedules no save", async () => {
  vi.useFakeTimers();
  const { notes, sync } = await opened("one", 0);
  await sync("one two");
  expect(events.saved).toHaveBeenCalledWith("A.md");
  expect(notes.hasUnsaved()).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.writeNote).not.toHaveBeenCalled();
});

// ----- big notes -----

test("a 5k-line note reloads quickly and keeps the caret", async () => {
  const text = lines(5000);
  const caret = text.indexOf("line 4000 ") + 5;
  const { state, sync } = await opened(text, caret);
  const synced = text.replace("line 10 ", "inserted\nline 10 ").replace("line 2500 lorem", "line 2500 LOREM").replace("line 4999 ", "line 4999 end ");
  const started = performance.now();
  await sync(synced);
  const took = performance.now() - started;
  expect(state().doc.toString()).toBe(synced);
  expect(state().selection.main.head).toBe(caret + "inserted\n".length);
  expect(took).toBeLessThan(250);
});

test("a full rewrite of a 5k-line note stays fast and exact", () => {
  const old = lines(5000), next = lines(5000, "other");
  const started = performance.now();
  const edits = minimalChanges(old, next);
  expect(performance.now() - started).toBeLessThan(500);
  expect(apply(old, edits)).toBe(next);
  // More than the limit of line edits: one block in the middle, not a long diff.
  expect(MAX_LINE_EDITS).toBeLessThan(10000);
});

test("many scattered edits in a 5k-line note are each kept small", () => {
  const old = lines(5000);
  const next = old.split("\n").map((line, i) => (i % 50 === 0 ? line + " changed" : line)).join("\n");
  const started = performance.now();
  const edits = minimalChanges(old, next);
  expect(performance.now() - started).toBeLessThan(250);
  expect(edits).toHaveLength(100);
  expect(edits.every((e) => e.insert === " changed" && e.from === e.to)).toBe(true);
  expect(apply(old, edits)).toBe(next);
});
