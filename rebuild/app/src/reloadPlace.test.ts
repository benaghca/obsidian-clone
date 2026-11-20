// An outside change to a clean open note (a sync, git, another app) is applied
// as the smallest edit, so the cursor and selection stay on the text they were
// on, and it stays out of undo, so Ctrl+Z cannot bring the old text back and
// save it over the synced file. No window: these run on the note's state.
import { history, historyField, isolateHistory, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { ChangeSet, Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { MAX_LINE_EDITS, minimalChanges, normalizeLineBreaks, REFINE_CHARS, type TextEdit } from "./editor/minimalChange";
import { historyAfter, historySurvives } from "./editor/reloadHistory";
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
    expect(apply(old, minimalChanges(old, now, [], 1))).toBe(now);
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

// ----- undo steps the sync touched (Codex review 1, P1) -----

/** Run one history command on the note's state; the text it would produce, or null when there is nothing to do. */
function step(state: EditorState, command: typeof undo): string | null {
  let out: Transaction | null = null;
  command({ state, dispatch: (tr) => { out = tr; } });
  return out ? (out as Transaction).state.doc.toString() : null;
}

test("a sync that deletes your saved edit leaves nothing to undo, so the old word cannot come back", async () => {
  vi.useFakeTimers();
  const { notes, state, sync } = await opened("status: draft", 0);
  notes.change("A.md", { changes: { from: 8, to: 13, insert: "ready" }, userEvent: "input.type" });
  await notes.flush();
  expect(api.writeNote).toHaveBeenLastCalledWith("A.md", "status: ready");
  await sync("status: ");
  expect(state().doc.toString()).toBe("status: ");
  expect(undoDepth(state())).toBe(0);
  expect(step(state(), undo)).toBeNull();
  expect(notes.hasUnsaved()).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.writeNote).toHaveBeenCalledTimes(1);
});

test("a sync that replaces your saved edit leaves nothing to undo either", async () => {
  const { notes, state, sync } = await opened("status: draft", 0);
  notes.change("A.md", { changes: { from: 8, to: 13, insert: "ready" }, userEvent: "input.type" });
  await notes.flush();
  await sync("status: published");
  expect(undoDepth(state())).toBe(0);
  expect(step(state(), undo)).toBeNull();
  expect(state().doc.toString()).toBe("status: published");
});

test("a redo step the sync touched is dropped too", () => {
  // "draft" -> "ready", then undone: "ready" waits on the redo stack.
  const typed = EditorState.create({ doc: "status: draft", extensions: history() })
    .update({ changes: { from: 8, to: 13, insert: "ready" } }).state;
  let back!: Transaction;
  undo({ state: typed, dispatch: (tr) => { back = tr; } });
  expect(undoDepth(back.state)).toBe(0);
  expect(redoDepth(back.state)).toBe(1);
  expect(historySurvives(back.state, minimalChanges("status: draft", "status: final"))).toBe(false);
  expect(historySurvives(back.state, minimalChanges("status: draft", "intro\nstatus: draft"))).toBe(true);
});

test("an outside insert right next to your edit counts as touching it", async () => {
  const { notes, state, sync } = await opened("todo", 0);
  notes.change("A.md", { changes: { from: 4, insert: " soon" }, userEvent: "input.type" });
  await notes.flush();
  await sync("todo soon!");
  expect(undoDepth(state())).toBe(0);
  expect(state().doc.toString()).toBe("todo soon!");
});

test("a clean history starts again after it was dropped", async () => {
  const { notes, state, sync } = await opened("status: draft", 0);
  notes.change("A.md", { changes: { from: 8, to: 13, insert: "ready" }, userEvent: "input.type" });
  await notes.flush();
  await sync("status: published");
  notes.change("A.md", { changes: { from: 0, insert: "new " }, userEvent: "input.type" });
  expect(undoDepth(state())).toBe(1);
  expect(step(state(), undo)).toBe("status: published");
  await notes.flush();
});

test("history checks replay every step, older ones included", () => {
  let s = EditorState.create({ doc: "one two three", extensions: history() });
  s = s.update({ changes: { from: 4, to: 7, insert: "TWO" } }).state; // older step, touched below
  s = s.update({ changes: { from: 0, insert: "zero " }, annotations: [isolateHistory.of("full")] }).state;
  // A newer step that is far away does not hide the older one under the sync.
  expect(undoDepth(s)).toBe(2);
  expect(historySurvives(s, minimalChanges(s.doc.toString(), s.doc.toString().replace("TWO", "2")))).toBe(false);
  expect(historySurvives(s, minimalChanges(s.doc.toString(), s.doc.toString() + "\nend"))).toBe(true);
});

// ----- unrelated history stays (Codex review 3, P2) -----

/** Undo on the note's main state as Ctrl+Z would, then save what it produced. */
function undoInto(notes: NoteEditors, state: () => EditorState): string | null {
  let tr: Transaction | null = null;
  undo({ state: state(), dispatch: (t) => { tr = t; } });
  if (!tr) return null;
  // The transaction itself, so the history pops the step; saved like any edit.
  (notes as unknown as { states: Map<string, EditorState> }).states.set("A.md", (tr as Transaction).state);
  (notes as unknown as { scheduleSave(path: string): void }).scheduleSave("A.md");
  return (tr as Transaction).state.doc.toString();
}

test("a sync touching an older step keeps the newer, unrelated one: undo takes back only that", async () => {
  vi.useFakeTimers();
  const { notes, state, sync } = await opened("one two three", 0);
  notes.change("A.md", { changes: { from: 4, to: 7, insert: "TWO" }, userEvent: "input.type" });
  notes.change("A.md", { changes: { from: 0, insert: "zero " }, userEvent: "input.type", annotations: [isolateHistory.of("full")] });
  await notes.flush();
  expect(api.writeNote).toHaveBeenLastCalledWith("A.md", "zero one TWO three");
  expect(undoDepth(state())).toBe(2);
  // The sync rewrites the older edit's word.
  await sync("zero one 2 three");
  expect(undoDepth(state())).toBe(1);
  const writes = vi.mocked(api.writeNote).mock.calls.length;
  expect(undoInto(notes, state)).toBe("one 2 three");
  await notes.flush();
  // Only "zero " went, and that is the one write.
  expect(vi.mocked(api.writeNote).mock.calls.length).toBe(writes + 1);
  expect(api.writeNote).toHaveBeenLastCalledWith("A.md", "one 2 three");
  // Nothing left that could bring "TWO" or "two" back.
  expect(undoDepth(state())).toBe(0);
  expect(step(state(), undo)).toBeNull();
  // Redo puts back only the kept step.
  expect(step(state(), redo)).toBe("zero one 2 three");
});

test("redo keeps the steps it reaches before the one the sync touched", async () => {
  const { notes, state, sync } = await opened("one two three", 0);
  notes.change("A.md", { changes: { from: 4, to: 7, insert: "TWO" }, userEvent: "input.type" });
  notes.change("A.md", { changes: { from: 0, insert: "zero " }, userEvent: "input.type", annotations: [isolateHistory.of("full")] });
  await notes.flush();
  // Undo both: redo would first put "TWO" back, then "zero ".
  undoInto(notes, state);
  undoInto(notes, state);
  await notes.flush();
  expect(state().doc.toString()).toBe("one two three");
  expect(redoDepth(state())).toBe(2);
  // The sync touches the place "zero " would go; "TWO" is reached first and is untouched.
  await sync("ZERO one two three");
  expect(redoDepth(state())).toBe(1);
  expect(step(state(), redo)).toBe("ZERO one TWO three");
  await notes.flush();
});

test("a kept history does not join the next typing into its last step", async () => {
  const { notes, state, sync } = await opened("one two three", 0);
  notes.change("A.md", { changes: { from: 4, to: 7, insert: "TWO" }, userEvent: "input.type" });
  notes.change("A.md", { changes: { from: 13, insert: "!" }, userEvent: "input.type", annotations: [isolateHistory.of("full")] });
  await notes.flush();
  await sync("one 2 three!");
  notes.change("A.md", { changes: { from: 11, insert: "?" }, userEvent: "input.type" });
  expect(undoDepth(state())).toBe(2);
  expect(step(state(), undo)).toBe("one 2 three!");
  await notes.flush();
});

// ----- older steps below a touched one (Codex review 4, P2) -----

/** Three saved edits, each its own undo step: "one two three" -> "ONE TWO THREE". */
async function threeSteps() {
  vi.useFakeTimers();
  const opened3 = await opened("one two three", 0);
  const { notes } = opened3;
  for (const [from, to, insert] of [[0, 3, "ONE"], [4, 7, "TWO"], [8, 13, "THREE"]] as const) {
    notes.change("A.md", { changes: { from, to, insert }, userEvent: "input.type", annotations: [isolateHistory.of("full")] });
  }
  await notes.flush();
  expect(api.writeNote).toHaveBeenLastCalledWith("A.md", "ONE TWO THREE");
  return opened3;
}

test("a disjoint step below the one the sync touched can still be undone", async () => {
  const { notes, state, sync } = await threeSteps();
  await sync("ONE published THREE");
  expect(undoDepth(state())).toBe(2);
  const before = vi.mocked(api.writeNote).mock.calls.length;
  expect(undoInto(notes, state)).toBe("ONE published three");
  await notes.flush();
  expect(undoInto(notes, state)).toBe("one published three");
  await notes.flush();
  // The touched step is gone: nothing brings "TWO" or "two" back.
  expect(step(state(), undo)).toBeNull();
  const saved = vi.mocked(api.writeNote).mock.calls.slice(before).map((c) => c[1]);
  expect(saved).toEqual(["ONE published three", "one published three"]);
  expect(saved.every((t) => !/two/i.test(t as string))).toBe(true);
  // Redo walks them back in order.
  let s = state();
  for (const want of ["ONE published three", "ONE published THREE"]) {
    let tr!: Transaction;
    expect(redo({ state: s, dispatch: (t) => { tr = t; } })).toBe(true);
    expect(tr.state.doc.toString()).toBe(want);
    s = tr.state;
  }
});

test("redo keeps disjoint steps on both sides of the one the sync touched", async () => {
  const { notes, state, sync } = await threeSteps();
  for (let i = 0; i < 3; i++) undoInto(notes, state);
  await notes.flush();
  expect(state().doc.toString()).toBe("one two three");
  expect(redoDepth(state())).toBe(3);
  // Redo would run ONE, then TWO (touched: "two" is now "published"), then THREE.
  await sync("one published three");
  expect(redoDepth(state())).toBe(2);
  expect(step(state(), redo)).toBe("ONE published three");
  let tr!: Transaction;
  redo({ state: state(), dispatch: (t) => { tr = t; } });
  expect(step(tr.state, redo)).toBe("ONE published THREE");
  await notes.flush();
});

test("kept steps never touch the synced text and each still makes its own edit (fuzz, both stacks)", () => {
  const next = random(11);
  const letters = "abcdefgh \n";
  const word = (n: number) => Array.from({ length: n }, () => letters[Math.floor(next() * letters.length)]).join("");
  const c = new Compartment();
  let checked = 0, below = 0;
  for (let round = 0; round < 400; round++) {
    let s = EditorState.create({ doc: word(40 + Math.floor(next() * 40)), extensions: c.of(history()) });
    // Local edits, each its own step; remember what each replaced.
    const made: Array<{ gone: string; put: string }> = [];
    for (let i = 0, n = 2 + Math.floor(next() * 5); i < n; i++) {
      const len = s.doc.length, from = Math.floor(next() * len), to = Math.min(len, from + Math.floor(next() * 4));
      const insert = word(Math.floor(next() * 4));
      if (to === from && !insert) continue;
      made.push({ gone: s.doc.sliceString(from, to), put: insert });
      s = s.update({ changes: { from, to, insert }, annotations: [isolateHistory.of("full")] }).state;
    }
    // Some of them undone first, so the redo stack has steps too.
    const undoneFirst = Math.floor(next() * (made.length + 1));
    for (let i = 0; i < undoneFirst; i++) undo({ state: s, dispatch: (t) => { s = t.state; } });
    // The sync: one or two replacements.
    const text = s.doc.toString();
    let synced = text;
    for (let i = 0, n = 1 + Math.floor(next() * 2); i < n; i++) {
      const from = Math.floor(next() * synced.length), to = Math.min(synced.length, from + Math.floor(next() * 5));
      synced = synced.slice(0, from) + word(1 + Math.floor(next() * 3)) + synced.slice(to);
    }
    const edits = minimalChanges(text, synced);
    if (!edits.length) continue;
    const syncSet = ChangeSet.of(edits, text.length);
    s = s.update({ changes: syncSet, annotations: [Transaction.addToHistory.of(false), isolateHistory.of("full")] }).state;
    const value = historyAfter(s, syncSet);
    if (value) s = s.update({ effects: c.reconfigure([]) }).state.update({ effects: c.reconfigure([historyField.init(() => value), history()]) }).state;
    // The synced text, tracked through every step taken from here.
    const put: Array<{ from: number; to: number; text: string }> = [];
    syncSet.iterChanges((_fa, _ta, from, to, ins) => put.push({ from, to, text: ins.toString() }));
    const walk = (command: typeof undo, expected: Array<{ gone: string; put: string }>) => {
      let t = s, at = 0;
      let ranges = put.map((r) => ({ ...r }));
      for (;;) {
        let tr: Transaction | null = null;
        if (!command({ state: t, dispatch: (x) => { tr = x; } }) || !tr) break;
        const changes = (tr as Transaction).changes;
        for (const r of ranges) expect(changes.touchesRange(r.from, r.to)).toBe(false);
        const pieces: Array<{ gone: string; put: string }> = [];
        changes.iterChanges((fa, ta, _fb, _tb, ins) => pieces.push({ gone: t.doc.sliceString(fa, ta), put: ins.toString() }));
        expect(pieces).toHaveLength(1);
        // Each step taken is one of the steps made, in order (some may have been dropped).
        const was = at;
        while (at < expected.length && !(expected[at].gone === pieces[0].gone && expected[at].put === pieces[0].put)) at++;
        expect(at).toBeLessThan(expected.length);
        if (at > was) below++; // kept below a dropped step
        at++;
        ranges = ranges.map((r) => ({ ...r, from: changes.mapPos(r.from, -1), to: changes.mapPos(r.to, 1) }));
        t = (tr as Transaction).state;
        for (const r of ranges) expect(t.doc.sliceString(r.from, r.to)).toBe(r.text);
        checked++;
      }
    };
    // Undo runs the still-done steps newest first, each putting back what it replaced.
    const done = made.slice(0, made.length - undoneFirst).reverse().map((m) => ({ gone: m.put, put: m.gone }));
    // Redo runs the undone steps oldest first.
    const redone = made.slice(made.length - undoneFirst);
    walk(undo, done);
    walk(redo, redone);
  }
  expect(checked).toBeGreaterThan(200);
  // Steps kept below a dropped one were reached, so the rebase is exercised.
  expect(below).toBeGreaterThan(10);
});

// ----- long lines (Codex review 1, P2) -----

test("separate edits around a caret on a 5,000-character line leave the caret on its text", async () => {
  const middle = Array.from({ length: 1700 }, (_, i) => `w${i % 10}`).join(" ");
  const text = `# Head\nstart ${middle} end\nlast`;
  const caret = text.indexOf("w5", 2500);
  const { state, sync } = await opened(text, caret);
  await sync(text.replace("start ", "START here ").replace(" end", " the end"));
  const s = state();
  expect(s.selection.main.head).toBe(caret + "START here ".length - "start ".length);
  expect(s.doc.sliceString(s.selection.main.head, s.selection.main.head + 2)).toBe("w5");
  const edits = minimalChanges(text, s.doc.toString());
  expect(edits.every((e) => e.to - e.from < 10 && e.insert.length < 10)).toBe(true);
});

test("a 60,000-character line with edits at both ends is still refined, quickly", () => {
  const middle = "lorem ipsum ".repeat(5000);
  const old = `a ${middle}z`, next = `A ${middle}Z!`;
  expect(old.length).toBeLessThan(REFINE_CHARS);
  const started = performance.now();
  const edits = minimalChanges(old, next);
  expect(performance.now() - started).toBeLessThan(250);
  expect(apply(old, edits)).toBe(next);
  expect(edits.every((e) => e.to - e.from <= 2 && e.insert.length <= 2)).toBe(true);
});

// ----- fallbacks keep the caret and the scroll line (Codex review 2, P2) -----

test("past the word-edit budget, a caret in surviving text stays on it (1,277 characters)", async () => {
  const text = "alpha ".repeat(105) + "unchanged section" + " alpha".repeat(105);
  const next = text.replaceAll("alpha", "bravo");
  const caret = text.indexOf("unchanged") + 7;
  // Every word around it changed: more word edits than the budget, so the block is a fallback.
  expect(minimalChanges(text, next)).toHaveLength(1);
  const { state, sync } = await opened(text, caret);
  await sync(next);
  const s = state();
  expect(s.doc.toString()).toBe(next);
  expect(s.selection.main.head).toBe(next.indexOf("unchanged") + 7);
});

test("a block too long to compare by word keeps a caret in its unchanged middle (200,001 characters)", async () => {
  const middle = "x".repeat(200_001);
  const text = `ab ${middle} cd`, next = `AB ${middle} CD`;
  expect(middle.length).toBeGreaterThan(REFINE_CHARS);
  const { state, sync } = await opened(text, 100_000);
  await sync(next);
  expect(state().doc.toString()).toBe(next);
  expect(state().selection.main.head).toBe(100_000);
});

test("in repeating text, the caret keeps its own place, not a copy of it nearby", async () => {
  const middle = Array.from({ length: 70_000 }, (_, i) => `w${i % 10}`).join(" ");
  const text = `start ${middle} end`, next = `START here ${middle} the end`;
  const caret = text.indexOf("w7", 100_000);
  const { state, sync } = await opened(text, caret);
  await sync(next);
  expect(state().selection.main.head).toBe(caret + 5);
});

test("past the line-edit limit, the caret line and a scroll line both keep their text", () => {
  const old = lines(3000);
  // Every line changes except 1,490 to 1,510: thousands of line edits, one fallback block.
  const next = old.split("\n").map((line, i) => (i >= 1490 && i <= 1510 ? line : line.replace("lorem", "LOREM"))).join("\n");
  const caret = old.indexOf("line 1500 ") + 7, top = old.indexOf("line 1495 ");
  expect(minimalChanges(old, next)).toHaveLength(1);
  const edits = minimalChanges(old, next, [top, caret]);
  expect(apply(old, edits)).toBe(next);
  const changes = ChangeSet.of(edits, old.length);
  expect(changes.mapPos(caret, -1)).toBe(next.indexOf("line 1500 ") + 7);
  expect(changes.mapPos(top, -1)).toBe(next.indexOf("line 1495 "));
});

test("several kept places in one fallback block each keep their text", () => {
  const word = (i: number) => `k${i}x`;
  const old = Array.from({ length: 600 }, (_, i) => (i % 100 === 50 ? `${word(i)} stays here` : "alpha")).join(" ");
  const next = old.replaceAll("alpha", "bravo");
  const keep = [...old.matchAll(/k\d+x/g)].map((m) => m.index! + 2);
  const edits = minimalChanges(old, next, keep);
  expect(apply(old, edits)).toBe(next);
  const changes = ChangeSet.of(edits, old.length);
  for (const at of keep) {
    const label = old.slice(at - 2, old.indexOf(" ", at));
    expect(next.slice(changes.mapPos(at, -1) - 2).startsWith(label + " stays here")).toBe(true);
  }
});

test("kept places never break the result or split an emoji (fuzz)", () => {
  const next = random(7);
  const pieces = ["alpha ", "bravo ", "😀", "x", "\n", "same text here "];
  const text = (n: number) => Array.from({ length: n }, () => pieces[Math.floor(next() * pieces.length)]).join("");
  for (let round = 0; round < 300; round++) {
    const old = text(80 + Math.floor(next() * 200));
    const now = old.split("").map((c) => (c === "a" && next() < 0.5 ? "o" : c)).join("") + (next() < 0.5 ? text(5) : "");
    const keep = Array.from({ length: 4 }, () => Math.floor(next() * old.length));
    const edits = minimalChanges(old, now, keep, 1);
    expect(apply(old, edits)).toBe(now);
    for (const e of edits) {
      for (const at of [e.from, e.to]) expect(/[\uDC00-\uDFFF]/.test(old[at] ?? "") && /[\uD800-\uDBFF]/.test(old[at - 1] ?? "")).toBe(false);
    }
  }
});

test("keeping places inside a huge fallback stays fast", () => {
  const old = lines(20_000), next = lines(20_000, "other");
  const keep = Array.from({ length: 64 }, (_, i) => Math.floor((old.length * i) / 64));
  const started = performance.now();
  const edits = minimalChanges(old, next, keep);
  expect(performance.now() - started).toBeLessThan(500);
  expect(apply(old, edits)).toBe(next);
});

// ----- any replacement keeps a caret on surviving text (Codex review 3, P2) -----

test("a replaced word that kept its middle keeps the caret in it", async () => {
  const text = "A" + "x".repeat(100) + "A", next = "B" + "x".repeat(100) + "B";
  // One word each side: the word diff replaces it whole.
  expect(minimalChanges(text, next)).toEqual([{ from: 0, to: 102, insert: next }]);
  const { state, sync } = await opened(text, 50);
  await sync(next);
  expect(state().doc.toString()).toBe(next);
  expect(state().selection.main.head).toBe(50);
});

test("a short unique span left in a fallback keeps the caret on it", async () => {
  const text = "alpha ".repeat(105) + " KEY " + "alpha ".repeat(105);
  const next = text.replaceAll("alpha", "bravo");
  const caret = text.indexOf("KEY") + 1;
  const { state, sync } = await opened(text, caret);
  await sync(next);
  expect(state().doc.toString()).toBe(next);
  expect(state().selection.main.head).toBe(next.indexOf("KEY") + 1);
});

test("a short surviving line holding the scroll inside a large fallback keeps its place", () => {
  const n = 3000;
  const old = Array.from({ length: n }, (_, i) => (i === 1500 ? "--" : `${i} a`)).join("\n");
  const next = Array.from({ length: n }, (_, i) => (i === 1500 ? "--" : `b ${i}`)).join("\n");
  const top = old.indexOf("\n--\n") + 1;
  expect(minimalChanges(old, next).length).toBeLessThan(5); // past the limits: large blocks
  const edits = minimalChanges(old, next, [top]);
  expect(apply(old, edits)).toBe(next);
  const at = ChangeSet.of(edits, old.length).mapPos(top, -1);
  expect(at).toBe(next.indexOf("\n--\n") + 1);
});

test("a single unique character left in a replaced word keeps the caret by it", async () => {
  const { state, sync } = await opened("AxA", 1);
  await sync("BxB");
  expect(state().doc.toString()).toBe("BxB");
  expect(state().selection.main.head).toBe(1);
});

test("whole lines inserted right at a kept line start go in after its line break", () => {
  const old = "a\nb\nc\n", next = "a\nX\nY\nb\nc\n";
  const top = old.indexOf("b");
  // Without the position, the plain diff inserts right at the line start.
  expect(minimalChanges(old, next)).toEqual([{ from: top, to: top, insert: "X\nY\n" }]);
  const edits = minimalChanges(old, next, [top]);
  expect(edits).toEqual([{ from: top - 1, to: top - 1, insert: "\nX\nY" }]);
  expect(apply(old, edits)).toBe(next);
  expect(ChangeSet.of(edits, old.length).mapPos(top, -1)).toBe(next.indexOf("b"));
});

test("a caret at the start of its line stays on it when lines are inserted there", async () => {
  const text = lines(20), at = text.indexOf("line 10 ");
  const { state, sync } = await opened(text, at);
  const next = text.replace("line 10 ", "new a\nnew b\nline 10 ");
  await sync(next);
  expect(state().doc.toString()).toBe(next);
  expect(state().selection.main.head).toBe(next.indexOf("line 10 "));
});

test("a short span that appears twice in the new text is not guessed at", () => {
  const text = "alpha ".repeat(105) + " KEY " + "alpha ".repeat(105);
  // " KEY " now appears twice: nothing fixes which copy is the caret's.
  const next = "bravo ".repeat(50) + " KEY " + "bravo ".repeat(55) + " KEY " + "bravo ".repeat(105);
  const caret = text.indexOf("KEY") + 1;
  const edits = minimalChanges(text, next, [caret]);
  expect(apply(text, edits)).toBe(next);
  expect(ChangeSet.of(edits, text.length).mapPos(caret, -1)).toBe(0);
});

// ----- no layout read for a no-op (Codex review 3, P3) -----

test("an unchanged note, or a pure deletion, reads no cursor or scroll positions", async () => {
  const places = vi.spyOn(NoteEditors.prototype as unknown as { places(path: string): number[] }, "places");
  const { sync } = await opened("zero\none\ntwo\n", 2);
  await sync("zero\r\none\r\ntwo\r\n");
  await sync("zero\none\ntwo\n");
  expect(places).not.toHaveBeenCalled();
  await sync("one\ntwo\n");
  expect(places).not.toHaveBeenCalled();
  // Inserted text can land on a kept position, so an insert reads them, once.
  await sync("one\nnew\ntwo\n");
  expect(places).toHaveBeenCalledTimes(1);
  places.mockRestore();
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
