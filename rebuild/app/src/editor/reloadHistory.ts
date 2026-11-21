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
// run it. A step that touches the outside change is dropped: its current
// text stays in the document. A step below it is still kept when it can be
// moved past every dropped step: its change is mapped across them, and it
// must not touch them or the outside change. Anything that touches either
// is dropped too, so no kept step can bring back text the sync replaced.
// When something was dropped, the history is rebuilt from the kept steps,
// each with the selections CodeMirror stored for it (review round 5): the
// selection its undo (or redo) restores, and the selections you moved
// through after making it, which selection undo walks back and the opposite
// command restores. Selections never change text, so carrying them cannot
// bring back anything the sync replaced.

import { history, historyField, redoSelection, undoSelection } from "@codemirror/commands";
import { type ChangeDesc, ChangeSet, EditorSelection, EditorState, type StateCommand, type Text, type Transaction } from "@codemirror/state";
import type { TextEdit } from "./minimalChange";

type Range = readonly [from: number, to: number];

/**
 * A step that stays: its change, the document it applies to (only kept steps
 * applied), and its selections in kept coordinates. `selection` is what the
 * step itself sets (in the document after it); `after` lists, oldest first,
 * the selections stored after the step was made (in the document before it).
 */
interface Kept {
  changes: ChangeSet;
  doc: Text;
  selection: EditorSelection;
  after: EditorSelection[];
}

/** One stack as replayed: its kept steps newest first, the selections below its last change, and whether a step was dropped. */
interface Stack {
  kept: Kept[];
  rest: EditorSelection[];
  dropped: boolean;
}

/**
 * Replay one stack of `state` with `command` (selection undo or redo, which
 * runs the same steps as plain undo or redo but first walks back each step's
 * stored selections) until it is empty. `ranges` is the outside change's text
 * in `state.doc`.
 */
function replay(state: EditorState, ranges: readonly Range[], command: StateCommand): Stack {
  const value = state.field(historyField, false);
  if (value === undefined) return { kept: [], rest: [], dropped: false };
  // `all` is the copy CodeMirror replays on, with every step applied, dropped ones included.
  let all = EditorState.create({ doc: state.doc, selection: state.selection, extensions: historyField.init(() => value) });
  // `doc` has only the kept steps applied. `skip` takes `all`'s coordinates to `doc`'s: the dropped steps put back.
  let doc = state.doc;
  let skip: ChangeDesc = ChangeSet.empty(doc.length).desc;
  let sync = ranges;
  const kept: Kept[] = [];
  // Stored selections walked back since the last step, newest first, in `doc`'s coordinates.
  let walked: EditorSelection[] = [];
  let dropped = false;
  for (;;) {
    let step: Transaction | null = null;
    if (!command({ state: all, dispatch: (tr) => { step = tr; } }) || !step) break;
    const tr = step as Transaction;
    all = tr.state;
    if (tr.isUserEvent("select")) {
      walked.push(tr.newSelection.map(skip));
      continue;
    }
    const changes = tr.changes;
    let clear = true;
    changes.iterChangedRanges((from, to) => { if (clear && skip.touchesRange(from, to)) clear = false; });
    const moved = clear ? changes.map(skip) : null;
    if (moved && !sync.some(([from, to]) => moved.touchesRange(from, to))) {
      const before = doc;
      doc = moved.apply(doc);
      sync = sync.map(([from, to]) => [moved.mapPos(from, -1), moved.mapPos(to, 1)] as const);
      skip = skip.mapDesc(changes);
      kept.push({ changes: moved, doc: before, selection: tr.newSelection.map(skip), after: walked.reverse() });
    } else {
      dropped = true;
      // Back from after this step to before it, then the earlier dropped steps.
      skip = changes.invertedDesc.composeDesc(skip);
    }
    // A dropped step's selections go with it.
    walked = [];
  }
  // Selections left once no step remains: the stack's bottom, a selection-only entry.
  return { kept, rest: walked.reverse(), dropped };
}

/** The ranges an edit list changes, in the coordinates of the document it applies to. */
const rangesOf = (edits: readonly TextEdit[]): Range[] => edits.map((e) => [e.from, e.to] as const);

/** True when no undo or redo step of `state` overlaps or touches the ranges `edits` change (offsets in `state.doc`). */
export function historySurvives(state: EditorState, edits: readonly TextEdit[]): boolean {
  if (!edits.length) return true;
  const ranges = rangesOf(edits);
  return !replay(state, ranges, undoSelection).dropped && !replay(state, ranges, redoSelection).dropped;
}

/** True when every range of `selection` lies inside a document of `length`. */
const fits = (selection: EditorSelection, length: number) => selection.ranges.every((r) => r.to <= length);

/**
 * One stack in the history field's JSON form, oldest first: a selection-only
 * entry at the bottom when there is one, then each kept step. A step stores
 * the change its undo (or redo) applies and the selection that restores, as
 * CodeMirror does. Null if anything doesn't fit its document (never expected).
 */
function branch({ kept, rest }: Stack, bottom: Text) {
  const out: object[] = [];
  if (rest.length) {
    if (!rest.every((s) => fits(s, bottom.length))) return null;
    out.push({ selectionsAfter: rest.map((s) => s.toJSON()) });
  }
  for (let i = kept.length - 1; i >= 0; i--) {
    const { changes, doc, selection, after } = kept[i];
    if (changes.length !== doc.length || !fits(selection, changes.newLength) || !after.every((s) => fits(s, doc.length))) return null;
    out.push({ changes: changes.toJSON(), startSelection: selection.toJSON(), selectionsAfter: after.map((s) => s.toJSON()) });
  }
  return out;
}

/** A history value from its JSON form, read through a throwaway state. */
const historyOf = (json: unknown) =>
  EditorState.fromJSON({ doc: "", selection: EditorSelection.single(0).toJSON(), history: json }, { extensions: history() }, { history: historyField }).field(historyField);

/**
 * The history `state` (taken right after the outside change `sync`) should
 * have, or null when every step can stay as CodeMirror mapped it.
 */
export function historyAfter(state: EditorState, sync: ChangeSet) {
  if (state.field(historyField, false) === undefined || sync.empty) return null;
  const ranges: Range[] = [];
  sync.iterChangedRanges((_fromA, _toA, fromB, toB) => ranges.push([fromB, toB]));
  const done = replay(state, ranges, undoSelection), undone = replay(state, ranges, redoSelection);
  if (!done.dropped && !undone.dropped) return null;
  const end = (stack: Stack) => {
    const last = stack.kept[stack.kept.length - 1];
    return last ? last.changes.apply(last.doc) : state.doc;
  };
  const json = { done: branch(done, end(done)), undone: branch(undone, end(undone)) };
  // Never expected; if it happened, a fresh history is the safe answer.
  if (!json.done || !json.undone) return historyOf({ done: [], undone: [] });
  return historyOf(json);
}
