// Outline view for the right sidebar: the open note's headings as an
// indented tree. Click one to glide to it. Like Obsidian's, it doesn't track
// the heading being read; rows only get a hover.
//
// Nothing here runs on a keystroke. Edits only (re)start a 300ms idle timer;
// then the headings are read from the syntax tree, which CodeMirror re-parses
// incrementally, so only the edited stretch is parsed again. A long note
// whose tree does not reach the end yet (CodeMirror parses ahead of the
// viewport only so far) is parsed to the end in small idle slices first.

import { ensureSyntaxTree } from "@codemirror/language";
import type { Text } from "@codemirror/state";
import { type Heading, headingsFromTree, outlineDepths } from "../editor/outline";
import type { Workspace } from "../workspace";
import { h } from "./dom";
import { afterPaint, type SideView } from "./sideView";

const IDLE_MS = 300;
const SLICE_MS = 4;

export function createOutlineView(ws: Workspace): SideView {
  const list = h("div", { class: "outline-list" });
  const empty = h("div", { class: "pane-empty" });
  const el = h("div", { class: "outline-view" }, list, empty);

  let active = false;
  let headings: Heading[] = [];
  let shownDoc: Text | null = null;
  let lastEdit = 0;
  let timer = 0;

  function schedule(ms: number) {
    clearTimeout(timer);
    timer = window.setTimeout(update, ms);
  }

  function update() {
    if (!active) return;
    const path = ws.active.path;
    const state = ws.view.state;
    if (!path) return show([], "No file is open.");
    if (state.doc === shownDoc) return;
    const sinceEdit = performance.now() - lastEdit;
    if (sinceEdit < IDLE_MS) return schedule(IDLE_MS - sinceEdit);
    // null until the parse reaches the end; each call parses a few more ms.
    const tree = ensureSyntaxTree(state, state.doc.length, SLICE_MS);
    if (!tree) return schedule(0);
    shownDoc = state.doc;
    show(headingsFromTree(tree, state.doc), "No headings in this note.");
  }

  // Rows are rebuilt only when the list of headings changes; edits that just
  // move headings around update the positions behind them.
  function show(next: Heading[], emptyText: string) {
    const same = next.length === headings.length && next.every((hd, i) => hd.level === headings[i].level && hd.text === headings[i].text);
    headings = next;
    if (!same) {
      const depths = outlineDepths(next);
      list.replaceChildren(
        ...next.map((hd, i) => {
          const row = h("div", { class: "tree-item-self outline-item", "data-level": String(hd.level), onclick: () => jump(i) }, hd.text);
          row.style.setProperty("--depth", String(depths[i]));
          return row;
        }),
      );
    }
    empty.textContent = emptyText;
    empty.hidden = next.length > 0;
  }

  function jump(i: number) {
    const hd = headings[i];
    if (hd) ws.jumpTo({ anchor: Math.min(hd.from, ws.view.state.doc.length) });
  }

  ws.on((change) => {
    if (!active) return;
    if (change === "doc") {
      lastEdit = performance.now();
      schedule(IDLE_MS);
    } else if (change === "show") {
      clearTimeout(timer);
      afterPaint(update);
    }
  });

  return {
    el,
    setActive(next) {
      if (next === active) return;
      active = next;
      if (active) {
        shownDoc = null;
        afterPaint(update);
      } else clearTimeout(timer);
    },
  };
}
