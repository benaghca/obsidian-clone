// Whether a note's undo history can be kept across an outside change.
//
// The outside change itself is never recorded (addToHistory: false), and
// CodeMirror maps the existing undo and redo steps across it. That mapping
// is exact only when a step does not overlap or touch what the outside
// change edited. When it does, the mapped step can drop its deletion but
// keep its insertion: undoing "draft" -> "ready" after a sync deleted
// "ready" would put "draft" back, and the undo would then save it over the
// synced file. So every step is replayed on a light copy (document and
// history only, none of the editor's other extensions) and checked first.

import { historyField, redo, undo } from "@codemirror/commands";
import { EditorState, type StateCommand, type Transaction } from "@codemirror/state";
import type { TextEdit } from "./minimalChange";

/**
 * True when no undo or redo step of `state` overlaps or touches the ranges
 * `edits` change (offsets in `state.doc`). Then the history can stay.
 */
export function historySurvives(state: EditorState, edits: readonly TextEdit[]): boolean {
  const value = state.field(historyField, false);
  if (value === undefined || !edits.length) return true;
  const light = EditorState.create({ doc: state.doc, selection: state.selection, extensions: historyField.init(() => value) });
  return clear(light, edits, undo) && clear(light, edits, redo);
}

/** Run `command` until its stack is empty; false as soon as a step reaches an edited range. */
function clear(start: EditorState, edits: readonly TextEdit[], command: StateCommand): boolean {
  let state = start;
  // The edited ranges, in the coordinates of the document each step applies to.
  let ranges = edits.map((e) => [e.from, e.to] as const);
  for (;;) {
    let step: Transaction | null = null;
    if (!command({ state, dispatch: (tr) => { step = tr; } }) || !step) return true;
    const changes = (step as Transaction).changes;
    if (ranges.some(([from, to]) => changes.touchesRange(from, to))) return false;
    ranges = ranges.map(([from, to]) => [changes.mapPos(from, -1), changes.mapPos(to, 1)] as const);
    state = (step as Transaction).state;
  }
}
