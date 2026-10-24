// Outline view for the right sidebar: the open note's headings as an
// indented tree. Click one to glide to it. The heading at the top of the
// editor stays highlighted whether or not Auto-scroll is on. Auto-scroll
// only scrolls the list to keep that heading in view, and it starts off.
// A heading with children folds them; Collapse all folds every such heading.
// The filter hides rows whose text does not contain it.
//
// The tree is not rebuilt on a keystroke. Edits only (re)start a 300ms idle
// timer; then the headings are read from the syntax tree, which CodeMirror
// re-parses incrementally, so only the edited stretch is parsed again. A long
// note whose tree does not reach the end yet (CodeMirror parses ahead of the
// viewport only so far) is parsed to the end in small idle slices first.

import { ensureSyntaxTree } from "@codemirror/language";
import type { Text } from "@codemirror/state";
import { frontmatterField } from "../editor/frontmatter";
import { type Heading, headingsFromTree, outlineDepths } from "../editor/outline";
import type { Workspace } from "../workspace";
import { h, iconButton } from "./dom";
import { autoScrollGlyph, icon } from "./icons";
import { afterPaint, type SideView } from "./sideView";

const IDLE_MS = 300;
const SLICE_MS = 4;

export function createOutlineView(ws: Workspace): SideView {
  const query = h("input", { class: "outline-filter", type: "search", placeholder: "Filter...", "aria-label": "Filter outline" });
  query.hidden = true;
  let followOn = false;
  const filterBtn = iconButton(icon("search", 16), "Show search filter", () => {
    const on = query.hidden !== false;
    filterBtn.classList.toggle("is-active", on);
    query.hidden = !on;
    if (!on) {
      query.value = "";
      paint();
    } else query.focus();
  });
  const followBtn = iconButton(autoScrollGlyph(), "Auto-scroll to current section", () => {
    followOn = !followOn;
    followBtn.classList.toggle("is-active", followOn);
    if (followOn) follow();
  });
  const toggle = iconButton(icon("chevrons-down-up", 16), "Collapse all", () => foldAll());
  const list = h("div", { class: "outline-list" });
  const empty = h("div", { class: "pane-empty" });
  const el = h(
    "div",
    { class: "outline-view" },
    h("div", { class: "nav-header" }, h("div", { class: "nav-buttons-container outline-toolbar" }, filterBtn, followBtn, toggle), query),
    list,
    empty,
  );

  let active = false;
  let headings: Heading[] = [];
  let emptyText = "No headings in this note.";
  let shownDoc: Text | null = null;
  let lastEdit = 0;
  let timer = 0;
  /** Indexes of headings whose children are folded. */
  const collapsed = new Set<number>();
  let scroller: HTMLElement | null = null;

  function schedule(ms: number) {
    clearTimeout(timer);
    timer = window.setTimeout(update, ms);
  }

  function update() {
    if (!active) return;
    const path = ws.active.path;
    const state = ws.view.state;
    if (!path) return show([], "No file is open.");
    if (state.doc === shownDoc) return follow();
    const sinceEdit = performance.now() - lastEdit;
    if (sinceEdit < IDLE_MS) return schedule(IDLE_MS - sinceEdit);
    // null until the parse reaches the end; each call parses a few more ms.
    const tree = ensureSyntaxTree(state, state.doc.length, SLICE_MS);
    if (!tree) return schedule(0);
    shownDoc = state.doc;
    // The closing --- of a frontmatter is a setext underline to the parser. It is not a heading.
    const body = state.field(frontmatterField, false)?.end ?? 0;
    show(headingsFromTree(tree, state.doc).filter((hd) => hd.from >= body), "No headings in this note.");
  }

  const hasChildren = (i: number) => {
    const level = headings[i]?.level ?? 0;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= level) return false;
      return true;
    }
    return false;
  };

  // Rows are rebuilt only when the list of headings changes; edits that just
  // move headings around update the positions behind them.
  function show(next: Heading[], nextEmpty: string) {
    const same = next.length === headings.length && next.every((hd, i) => hd.level === headings[i].level && hd.text === headings[i].text);
    headings = next;
    emptyText = nextEmpty;
    if (same) return follow();
    collapsed.clear();
    paint();
  }

  function paint() {
    const depths = outlineDepths(headings);
    const words = query.value.trim().toLowerCase();
    const hidden = new Set<number>();
    if (!words) {
      for (const i of collapsed) {
        const level = headings[i]?.level;
        if (level === undefined) continue;
        for (let j = i + 1; j < headings.length && headings[j].level > level; j++) hidden.add(j);
      }
    }
    const rows: HTMLElement[] = [];
    for (let i = 0; i < headings.length; i++) {
      if (hidden.has(i) || (words && !headings[i].text.toLowerCase().includes(words))) continue;
      const kids = !words && hasChildren(i);
      const row = h(
        "div",
        { class: "tree-item-self outline-item", "data-level": String(headings[i].level), "data-index": String(i), onclick: () => jump(i) },
        kids ? chevron(i) : null,
        h("span", { class: "tree-item-inner" }, headings[i].text),
      );
      row.style.setProperty("--depth", String(depths[i]));
      rows.push(row);
    }
    list.replaceChildren(...rows);
    const none = rows.length === 0;
    empty.textContent = words && headings.length ? "No matches." : emptyText;
    empty.hidden = !none;
    follow();
  }

  function chevron(i: number) {
    return h(
      "div",
      {
        class: `tree-item-icon collapse-icon${collapsed.has(i) ? " is-collapsed" : ""}`,
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          if (collapsed.has(i)) collapsed.delete(i);
          else collapsed.add(i);
          paint();
        },
      },
      icon("chevron-down", 14),
    );
  }

  function foldAll() {
    const parents = headings.map((_, i) => i).filter(hasChildren);
    const all = parents.length > 0 && parents.every((i) => collapsed.has(i));
    collapsed.clear();
    if (!all) for (const i of parents) collapsed.add(i);
    toggle.setAttribute("aria-label", all ? "Collapse all" : "Expand all");
    toggle.replaceChildren(icon(all ? "chevrons-down-up" : "chevrons-up-down", 16));
    paint();
  }

  function jump(i: number) {
    const hd = headings[i];
    if (hd) ws.jumpTo({ anchor: Math.min(hd.from, ws.view.state.doc.length) });
  }

  /** The last heading at or above the line at the top of the note. Highlight always; scroll only while auto-scroll is on. */
  function follow() {
    if (!active || !headings.length) return;
    const view = ws.view;
    // The note scrolls in .view-content. .cm-scroller is overflow: visible, so its scrollTop stays 0.
    const scroller = view.dom.closest<HTMLElement>(".view-content") ?? view.scrollDOM;
    const docTop = view.documentTop - scroller.getBoundingClientRect().top;
    const pos = docTop >= 0 ? 0 : view.lineBlockAtHeight(-docTop).from;
    let current = 0;
    for (let n = 0; n < headings.length; n++) if (headings[n].from <= pos) current = n;
    let marked: HTMLElement | null = null;
    for (const row of list.querySelectorAll<HTMLElement>(".outline-item")) {
      const on = Number(row.dataset.index) === current;
      row.classList.toggle("is-active", on);
      if (on) marked = row;
    }
    if (!followOn || !marked) return;
    const box = list.getBoundingClientRect();
    const r = marked.getBoundingClientRect();
    if (r.top < box.top) list.scrollTop -= box.top - r.top;
    else if (r.bottom > box.bottom) list.scrollTop += r.bottom - box.bottom;
  }

  function watchScroll() {
    const next = active ? ws.view.dom.closest<HTMLElement>(".view-content") ?? ws.view.scrollDOM : null;
    if (next === scroller) return;
    scroller?.removeEventListener("scroll", follow);
    scroller = next;
    scroller?.addEventListener("scroll", follow, { passive: true });
  }

  query.addEventListener("input", paint);
  ws.on((change) => {
    if (!active) return;
    watchScroll();
    if (change === "doc") {
      lastEdit = performance.now();
      schedule(IDLE_MS);
    } else if (change === "show") {
      clearTimeout(timer);
      shownDoc = null;
      afterPaint(update);
    } else if (change === "mode") follow();
  });

  return {
    el,
    setActive(next) {
      if (next === active) return;
      active = next;
      watchScroll();
      if (active) {
        shownDoc = null;
        afterPaint(update);
      } else clearTimeout(timer);
    },
  };
}
