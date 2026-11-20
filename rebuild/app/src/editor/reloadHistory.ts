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
// When something was dropped, the history is rebuilt from the kept steps as
// ordinary transactions on a fresh history.

import { history, historyField, isolateHistory, redo, undo } from "@codemirror/commands";
import { type ChangeDesc, ChangeSet, EditorSelection, EditorState, type StateCommand, type Text, Transaction } from "@codemirror/state";
import type { TextEdit } from "./minimalChange";

type Range = readonly [from: number, to: number];

/** A step that stays: its change, and the document it applies to (only kept steps applied). */
interface Kept {
  changes: ChangeSet;
  doc: Text;
}

/**
 * Replay one stack of `state` with `command` until it is empty. `ranges` is
 * the outside change's text in `state.doc`. Returns the kept steps in replay
 * order, and whether any step was dropped.
 */
function replay(state: EditorState, ranges: readonly Range[], command: StateCommand): { kept: Kept[]; dropped: boolean } {
  const value = state.field(historyField, false);
  if (value === undefined) return { kept: [], dropped: false };
  // `all` is the copy CodeMirror replays on, with every step applied, dropped ones included.
  let all = EditorState.create({ doc: state.doc, selection: state.selection, extensions: historyField.init(() => value) });
  // `doc` has only the kept steps applied. `skip` takes `all`'s coordinates to `doc`'s: the dropped steps put back.
  let doc = state.doc;
  let skip: ChangeDesc = ChangeSet.empty(doc.length).desc;
  let sync = ranges;
  const kept: Kept[] = [];
  let dropped = false;
  for (;;) {
    let step: Transaction | null = null;
    if (!command({ state: all, dispatch: (tr) => { step = tr; } }) || !step) break;
    const changes = (step as Transaction).changes;
    let clear = true;
    changes.iterChangedRanges((from, to) => { if (clear && skip.touchesRange(from, to)) clear = false; });
    const moved = clear ? changes.map(skip) : null;
    if (moved && !sync.some(([from, to]) => moved.touchesRange(from, to))) {
      kept.push({ changes: moved, doc });
      doc = moved.apply(doc);
      sync = sync.map(([from, to]) => [moved.mapPos(from, -1), moved.mapPos(to, 1)] as const);
      skip = skip.mapDesc(changes);
    } else {
      dropped = true;
      // Back from after this step to before it, then the earlier dropped steps.
      skip = changes.invertedDesc.composeDesc(skip);
    }
    all = (step as Transaction).state;
  }
  return { kept, dropped };
}

/** The ranges an edit list changes, in the coordinates of the document it applies to. */
const rangesOf = (edits: readonly TextEdit[]): Range[] => edits.map((e) => [e.from, e.to] as const);

/** True when no undo or redo step of `state` overlaps or touches the ranges `edits` change (offsets in `state.doc`). */
export function historySurvives(state: EditorState, edits: readonly TextEdit[]): boolean {
  if (!edits.length) return true;
  const ranges = rangesOf(edits);
  return !replay(state, ranges, undo).dropped && !replay(state, ranges, redo).dropped;
}

/** Fresh-history transaction options: never joined with a neighbour. */
const alone = [isolateHistory.of("full")];
const quiet = [Transaction.addToHistory.of(false)];

/** Put the cursor where `changes` starts, so its undo returns there; then apply it as its own step. */
function stepped(state: EditorState, changes: ChangeSet): EditorState {
  let at = -1;
  changes.iterChangedRanges((from) => { if (at < 0) at = from; });
  const placed = state.update({ selection: EditorSelection.cursor(Math.max(0, at)), annotations: quiet }).state;
  return placed.update({ changes, annotations: alone }).state;
}

/**
 * The history `state` (taken right after the outside change `sync`) should
 * have, or null when every step can stay as CodeMirror mapped it.
 */
export function historyAfter(state: EditorState, sync: ChangeSet) {
  if (state.field(historyField, false) === undefined || sync.empty) return null;
  const ranges: Range[] = [];
  sync.iterChangedRanges((_fromA, _toA, fromB, toB) => ranges.push([fromB, toB]));
  const done = replay(state, ranges, undo), undone = replay(state, ranges, redo);
  if (!done.dropped && !undone.dropped) return null;
  // Start where every kept undo has run, then make each step again, oldest first.
  const last = done.kept[done.kept.length - 1];
  let rebuilt = EditorState.create({ doc: last ? last.changes.apply(last.doc) : state.doc, extensions: history() });
  for (let i = done.kept.length - 1; i >= 0; i--) rebuilt = stepped(rebuilt, done.kept[i].changes.invert(done.kept[i].doc));
  // The redo stack: make each kept redo, then undo them all, so they wait in the same order.
  for (const { changes } of undone.kept) rebuilt = stepped(rebuilt, changes);
  for (let i = 0; i < undone.kept.length; i++) undo({ state: rebuilt, dispatch: (tr) => { rebuilt = tr.state; } });
  // Never expected; if it happened, a fresh history is the safe answer.
  if (!rebuilt.doc.eq(state.doc)) return EditorState.create({ extensions: history() }).field(historyField);
  return rebuilt.field(historyField);
}
