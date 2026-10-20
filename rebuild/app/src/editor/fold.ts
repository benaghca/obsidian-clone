// Folding, like Obsidian's "Fold heading" and "Fold indent" settings. There
// is no fold gutter: a chevron appears in the margin beside the line under
// the pointer when that line can fold (worked out for that one line, on
// pointer moves, never per keystroke), and stays beside folded lines. A
// folded stretch shows as "…" after its first line.

import { codeFolding, foldable, foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import { type EditorState, Facet, type Line, type Range, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

interface FoldKinds {
  heading: boolean;
  indent: boolean;
}

const foldKinds = Facet.define<FoldKinds, FoldKinds>({
  combine: (v) => v[0] ?? { heading: false, indent: false },
});

const HEADING = /^#{1,6}(\s|$)/;

/** The range a line folds, if folding that kind of line is on. Headings fold their section; lists, quotes and code fold their block. */
export function foldRangeAt(state: EditorState, line: Line): { from: number; to: number } | null {
  const kinds = state.facet(foldKinds);
  if (HEADING.test(line.text) ? !kinds.heading : !kinds.indent) return null;
  return foldable(state, line.from, line.to);
}

/** A fold that starts on this line, if any. */
function foldedOn(state: EditorState, line: Line): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  foldedRanges(state).between(line.to, line.to, (from, to) => {
    if (from === line.to) found = { from, to };
  });
  return found;
}

/** Fold or unfold the given line. Returns whether anything happened. */
export function toggleFoldAt(view: EditorView, line: Line): boolean {
  const folded = foldedOn(view.state, line);
  if (folded) {
    view.dispatch({ effects: unfoldEffect.of(folded) });
    return true;
  }
  const range = foldRangeAt(view.state, line);
  if (!range) return false;
  view.dispatch({ effects: foldEffect.of(range) });
  return true;
}

/** Fold every heading and list that can fold (outermost first, as Obsidian's "Fold all headings and lists"). */
export function foldAllAllowed(view: EditorView): boolean {
  const { state } = view;
  const effects: StateEffect<unknown>[] = [];
  for (let pos = 0; pos < state.doc.length; ) {
    const line = state.doc.lineAt(pos);
    const range = foldRangeAt(state, line);
    if (range && !foldedOn(state, line)) effects.push(foldEffect.of(range));
    pos = (range ? state.doc.lineAt(range.to).to : line.to) + 1;
  }
  if (effects.length) view.dispatch({ effects });
  return effects.length > 0;
}

export function unfoldEverything(view: EditorView): boolean {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => void effects.push(unfoldEffect.of({ from, to })));
  if (effects.length) view.dispatch({ effects });
  return effects.length > 0;
}

function chevron(): HTMLElement {
  const el = document.createElement("div");
  el.className = "cm-fold-indicator collapse-indicator";
  el.setAttribute("aria-hidden", "true");
  // Lucide's chevron-down, drawn here so the editor needs no shell modules.
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", class: "svg-icon" })) svg.setAttribute(k, v);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "m6 9 6 6 6-6");
  svg.append(path);
  el.append(svg);
  return el;
}

class FoldedMarker extends WidgetType {
  eq() {
    return true;
  }
  toDOM(view: EditorView) {
    const el = chevron();
    el.classList.add("is-collapsed");
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      toggleFoldAt(view, view.state.doc.lineAt(view.posAtDOM(el)));
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}
const foldedMarker = Decoration.widget({ widget: new FoldedMarker(), side: -1 });

// The chevron beside folded lines: only folded ranges in view are walked, so
// with nothing folded this costs nothing.
const foldedMarkers = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || foldedRanges(u.startState) !== foldedRanges(u.state)) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const folds = foldedRanges(view.state);
      if (!folds.size) return Decoration.none;
      const marks: Range<Decoration>[] = [];
      const { from, to } = view.viewport;
      folds.between(from, to, (start) => void marks.push(foldedMarker.range(view.state.doc.lineAt(start).from)));
      return Decoration.set(marks, true);
    }
  },
  { decorations: (v) => v.decorations },
);

// The chevron that appears beside a foldable line under the pointer.
const hoverChevron = ViewPlugin.fromClass(
  class {
    el = chevron();
    line = -1;
    frame = 0;
    x = 0;
    y = 0;
    constructor(readonly view: EditorView) {
      this.el.classList.add("mod-hover");
      this.el.hidden = true;
      this.el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (this.line < 0) return;
        toggleFoldAt(view, view.state.doc.line(this.line));
        this.hide();
      });
      view.dom.append(this.el);
      view.dom.addEventListener("mousemove", this.onMove, { passive: true });
      view.dom.addEventListener("mouseleave", this.onLeave);
    }
    onMove = (e: MouseEvent) => {
      if (e.target === this.el || this.el.contains(e.target as Node)) return;
      this.x = e.clientX;
      this.y = e.clientY;
      this.frame ||= requestAnimationFrame(this.place);
    };
    onLeave = (e: MouseEvent) => {
      if (e.relatedTarget && this.el.contains(e.relatedTarget as Node)) return;
      this.hide();
    };
    place = () => {
      this.frame = 0;
      const { view } = this;
      const block = view.lineBlockAtHeight(this.y - view.documentTop);
      const line = view.state.doc.lineAt(block.from);
      const top = view.documentTop + block.top;
      if (this.y < top || this.y > top + block.height || foldedOn(view.state, line) || !foldRangeAt(view.state, line)) return this.hide();
      // Centred on the line's first row of text.
      const coords = view.coordsAtPos(line.from, 1);
      const rowMid = coords ? (coords.top + coords.bottom) / 2 : top + 12;
      const box = view.dom.getBoundingClientRect();
      this.line = line.number;
      this.el.style.top = `${rowMid - box.top - 9}px`;
      this.el.hidden = false;
    };
    hide() {
      this.line = -1;
      this.el.hidden = true;
    }
    update(u: ViewUpdate) {
      if (u.docChanged && this.line >= 0) this.hide();
    }
    destroy() {
      cancelAnimationFrame(this.frame);
      this.view.dom.removeEventListener("mousemove", this.onMove);
      this.view.dom.removeEventListener("mouseleave", this.onLeave);
      this.el.remove();
    }
  },
);

function placeholder(_view: EditorView, onclick: (e: Event) => void): HTMLElement {
  const el = document.createElement("span");
  el.className = "cm-foldPlaceholder";
  el.textContent = "…";
  el.title = "Unfold";
  el.addEventListener("click", onclick);
  return el;
}

/** Folding with the given kinds of fold turned on. */
export function folding(heading: boolean, indent: boolean) {
  return [foldKinds.of({ heading, indent }), codeFolding({ placeholderDOM: placeholder }), foldedMarkers, hoverChevron];
}
