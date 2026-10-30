// The block widgets of Live Preview and Reading view: callouts, tables and
// ```base blocks drawn in place of their lines (callouts.ts, tables.ts,
// embeds.ts), and %%comment%%
// blocks hidden in Reading view. While the selection is in a
// callout (in the focused editor) its source shows instead. Tables stay drawn.
//
// Replacing whole lines has to come from a state field, so the blocks are
// kept in one: found among the syntax tree's top-level nodes, then mapped
// through each change, with only the stretch the change touched (and the
// top-level nodes around it, before and after) looked at again, and the
// tree's newly parsed part once the parser gets further. Typing doesn't walk
// the document, and a widget is drawn again only when its own text changes.

import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateEffect, StateField, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type WidgetType } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { CalloutWidget, calloutHeader } from "./callouts";
import { BaseWidget, baseBlockYaml } from "./embeds";
import { frontmatterField } from "./frontmatter";
import { filesChanged } from "./livePreview";
import { embedChain, paintWith, readingMode } from "./render";
import { tableSource, TableWidget } from "./tables";

interface Block {
  from: number;
  to: number;
  /** null: a comment block (hidden in Reading view, dimmed text in Live Preview). */
  widget: WidgetType | null;
  deco: Decoration;
}

const hiddenBlock = Decoration.replace({ block: true });
/** Counts the vault's file changes: a block drawn with embeds in it is drawn again after one (its targets may have come or gone). */
let files = 0;

/** The blocks among the top-level nodes overlapping `from`–`to`. */
function scan(state: EditorState, from: number, to: number): Block[] {
  const doc = state.doc;
  const chain = state.facet(embedChain);
  const bodyFrom = (state.field(frontmatterField, false)?.end ?? -1) + 1;
  const out: Block[] = [];
  syntaxTree(state).iterate({
    from: Math.max(from, bodyFrom),
    to,
    enter(n) {
      if (n.name === "Document") return;
      const start = doc.lineAt(n.from).from;
      const end = doc.lineAt(n.to).to;
      const text = doc.sliceString(start, end);
      let widget: WidgetType | null = null;
      const version = text.includes("![") ? files : 0;
      const base = n.name === "FencedCode" ? baseBlockYaml(text) : null;
      if (n.name === "Table") widget = new TableWidget(text, chain, version);
      else if (n.name === "Blockquote" && calloutHeader(doc.lineAt(n.from).text)) widget = new CalloutWidget(text, chain, version);
      else if (base !== null) widget = new BaseWidget(base, null, "", chain);
      else if (n.name !== "CommentBlock") return false;
      out.push({ from: start, to: end, widget, deco: widget ? Decoration.replace({ widget, block: true }) : hiddenBlock });
      return false;
    },
  });
  return out;
}

/** The extent of each top-level node overlapping `from`–`to` (or next to it). */
function topLevel(tree: Tree, from: number, to: number, fn: (from: number, to: number) => void) {
  tree.iterate({ from: Math.max(0, from - 1), to: to + 1, enter: (n) => (n.name === "Document" ? undefined : (fn(n.from, n.to), false)) });
}

interface Blocks {
  list: Block[];
  /** How far the tree had been parsed when the list was last brought up to date. */
  scanned: number;
  focused: boolean;
  deco: DecorationSet;
}

const focusEffect = StateEffect.define<boolean>();

function decorations(state: EditorState, list: Block[], focused: boolean): DecorationSet {
  const reading = state.facet(readingMode);
  const sel = reading || !focused ? [] : state.selection.ranges;
  const out: Range<Decoration>[] = [];
  for (const b of list) {
    if (b.widget ? (!(b.widget instanceof TableWidget) || state.field(tableSource, false) === b.from) && sel.some((r) => r.from <= b.to && r.to >= b.from) : !reading) continue;
    out.push(b.deco.range(b.from, b.to));
  }
  return Decoration.set(out);
}

/** The blocks after a change: unaffected ones mapped, the changed stretch scanned again. */
function remap(list: Block[], tr: Transaction): Block[] {
  const tree = syntaxTree(tr.state);
  const oldTree = syntaxTree(tr.startState);
  let lo = Infinity;
  let hi = -Infinity;
  const widen = (from: number, to: number) => {
    lo = Math.min(lo, from);
    hi = Math.max(hi, to);
  };
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    widen(fromB, toB);
    topLevel(oldTree, fromA, toA, (f, t) => widen(tr.changes.mapPos(f, -1), tr.changes.mapPos(t, 1)));
    topLevel(tree, fromB, toB, widen);
  });
  const kept = list
    .map((b) => ({ ...b, from: tr.changes.mapPos(b.from, 1), to: tr.changes.mapPos(b.to, -1) }))
    .filter((b) => b.to < lo || b.from > hi);
  return [...kept, ...scan(tr.state, lo, Math.min(hi, tree.length))].sort((a, b) => a.from - b.from);
}

const blocksField = StateField.define<Blocks>({
  create(state) {
    const list = scan(state, 0, syntaxTree(state).length);
    return { list, scanned: syntaxTree(state).length, focused: false, deco: decorations(state, list, false) };
  },
  update(value, tr) {
    let { list, scanned, focused } = value;
    for (const e of tr.effects) if (e.is(focusEffect)) focused = e.value;
    const length = syntaxTree(tr.state).length;
    if (tr.docChanged) {
      list = remap(list, tr);
      scanned = Math.min(tr.changes.mapPos(scanned), length);
    }
    if (tr.effects.some((e) => e.is(filesChanged))) {
      files++;
      list = list.flatMap((b) => (b.widget && tr.state.sliceDoc(b.from, b.to).includes("![") ? scan(tr.state, b.from, b.to) : [b]));
    }
    if (length > scanned) {
      list = [...list.filter((b) => b.to < scanned), ...scan(tr.state, scanned, length)].sort((a, b) => a.from - b.from);
      scanned = length;
    }
    const same =
      list === value.list &&
      focused === value.focused &&
      !tr.selection &&
      tr.startState.field(tableSource, false) === tr.state.field(tableSource, false) &&
      tr.startState.facet(readingMode) === tr.state.facet(readingMode);
    return same ? value : { list, scanned, focused, deco: decorations(tr.state, list, focused) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

// The field follows the editor's focus (a pane you're not typing in shows its blocks drawn).
const focusSync = ViewPlugin.define((view) => ({
  update(u) {
    if (u.state.field(blocksField).focused !== view.hasFocus) {
      queueMicrotask(() => {
        if (view.state.field(blocksField, false)?.focused === !view.hasFocus) view.dispatch({ effects: focusEffect.of(view.hasFocus) });
      });
    }
  },
}));

// Arrow keys step into a block from the line above or below it (its source
// then shows), as in Obsidian, instead of jumping over it.
const enter = (dir: 1 | -1) => (view: EditorView) => {
  const { state } = view;
  const head = state.selection.main;
  const line = state.doc.lineAt(head.head);
  const next = dir > 0 ? line.to + 1 : line.from - 1;
  const block = head.empty && !state.facet(readingMode) && state.field(blocksField).list.find((b) => b.widget && b.from <= next && b.to >= next);
  if (!block || next < 0 || next > state.doc.length) return false;
  const target = state.doc.lineAt(dir > 0 ? block.from : block.to);
  view.dispatch({ selection: { anchor: Math.min(target.to, target.from + head.head - line.from) }, scrollIntoView: true });
  return true;
};

// Rendered text draws its blocks too (a table in a callout, a callout in an embedded note).
paintWith((state) => scan(state, 0, state.doc.length).map((b) => b.deco.range(b.from, b.to)));

export const blocks = [
  blocksField,
  focusSync,
  keymap.of([
    { key: "ArrowDown", run: enter(1) },
    { key: "ArrowUp", run: enter(-1) },
  ]),
];
