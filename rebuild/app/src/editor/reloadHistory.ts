// A note's undo history across an outside change.
//
// The outside change itself is never recorded (addToHistory: false), and
// CodeMirror maps the existing undo and redo steps across it. That mapping
// is exact only when a step does not overlap or touch what the outside
// change edited. When it does, the mapped step can drop its deletion but
// keep its insertion: undoing "draft" -> "ready" after a sync deleted
// "ready" would put "draft" back, and the undo would then save it over the
// synced file. So every step is replayed on a light copy (document and
// history only, none of the editor's other extensions) and checked first.
//
// Each stack is replayed newest first, the order Ctrl+Z (or Ctrl+Y) would
// run it. The steps before the first one the change touches stay: each sits
// on top of the older ones, so dropping the older ones leaves it exact. The
// step the change touches goes, with everything older on that stack, since
// those could only be reached by undoing it first.

import { historyField, redo, undo } from "@codemirror/commands";
import { EditorState, type StateCommand, type Transaction } from "@codemirror/state";
import type { TextEdit } from "./minimalChange";

/** How many of the newest steps of each stack to keep (Infinity: all of them). */
export interface HistoryKeep {
  done: number;
  undone: number;
}

/**
 * Null when no undo or redo step of `state` overlaps or touches the ranges
 * `edits` change (offsets in `state.doc`): the whole history can stay.
 * Otherwise how many of the newest steps of each stack can.
 */
export function historyKeep(state: EditorState, edits: readonly TextEdit[]): HistoryKeep | null {
  const value = state.field(historyField, false);
  if (value === undefined || !edits.length) return null;
  const light = EditorState.create({ doc: state.doc, selection: state.selection, extensions: historyField.init(() => value) });
  const keep = { done: clear(light, edits, undo), undone: clear(light, edits, redo) };
  return keep.done === Infinity && keep.undone === Infinity ? null : keep;
}

/** True when the history can stay as it is. */
export function historySurvives(state: EditorState, edits: readonly TextEdit[]): boolean {
  return historyKeep(state, edits) === null;
}

/** Run `command` until its stack is empty (Infinity) or a step reaches an edited range (the steps before it). */
function clear(start: EditorState, edits: readonly TextEdit[], command: StateCommand): number {
  let state = start;
  // The edited ranges, in the coordinates of the document each step applies to.
  let ranges = edits.map((e) => [e.from, e.to] as const);
  for (let steps = 0; ; steps++) {
    let step: Transaction | null = null;
    if (!command({ state, dispatch: (tr) => { step = tr; } }) || !step) return Infinity;
    const changes = (step as Transaction).changes;
    if (ranges.some(([from, to]) => changes.touchesRange(from, to))) return steps;
    ranges = ranges.map(([from, to]) => [changes.mapPos(from, -1), changes.mapPos(to, 1)] as const);
    state = (step as Transaction).state;
  }
}

interface HistoryJSON {
  done: unknown[];
  undone: unknown[];
}

/**
 * The history value of `state` (taken after the outside change, so the kept
 * steps are already mapped across it) with only the newest `keep` steps of
 * each stack. Uses the field's own JSON form, the public way to read and
 * build a history.
 */
export function keptHistory(state: EditorState, keep: HistoryKeep) {
  const value = state.field(historyField);
  const json = EditorState.create({ extensions: historyField.init(() => value) }).toJSON({ history: historyField }).history as HistoryJSON;
  const newest = (branch: unknown[], n: number) => (n >= branch.length ? branch : branch.slice(branch.length - n));
  const history: HistoryJSON = { done: newest(json.done, keep.done), undone: newest(json.undone, keep.undone) };
  return EditorState.fromJSON({ doc: "", selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 }, history }, {}, { history: historyField }).field(historyField);
}
