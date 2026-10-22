// Markdown drawn once, read-only, the way Reading view draws it: what a
// callout's body, a table's cells or an embedded note show. There is no
// second renderer: a throwaway EditorState of the text is decorated by the
// same code as Live Preview and the block widgets (they register here with
// paintWith), and those decorations are painted into plain DOM, lines as
// .cm-line, marks as spans, widgets as their own DOM. Also what the drawn
// widgets (callouts, tables, embeds) share: letting go of what they drew,
// "Edit this block", and a click that puts the caret in their source.

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type Extension, Facet, type Range, RangeSet } from "@codemirror/state";
import { type Decoration, type DecorationSet, type EditorView, WidgetType } from "@codemirror/view";
import { h, iconButton } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";
import { markdownSyntax } from "./syntax";

/** Reading view: render everything, as if the selection touched nothing. */
export const readingMode = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });

/** The notes an embed is drawn inside of, outermost first (not counting the note on screen): the cycle and depth guard. */
export const embedChain = Facet.define<readonly string[], readonly string[]>({ combine: (v) => v[0] ?? [] });

type Decorator = (state: EditorState, view: EditorView) => Range<Decoration>[];
const decorators: Decorator[] = [];
let extensions: Extension[] = [];

/** Register a source of decorations (and what its state needs) for rendered text. */
export function paintWith(decorate: Decorator, ext: Extension = []) {
  decorators.push(decorate);
  extensions = [...extensions, ext];
}

const cleanups = new WeakMap<Element, () => void>();

/** Run `fn` when `dom`, a DrawnWidget's, is destroyed. */
export function onDestroy(dom: Element, fn: () => void) {
  cleanups.set(dom, fn);
}

/** Clicks on links inside a widget go to Live Preview's link handling; anything else is the widget's. */
export const isLinkEvent = (e: Event) => !!(e.target as Element).closest?.("[data-href]");

/** A widget drawn from plain fields (equal when they are), that lets go of what it drew (onDestroy). */
export abstract class DrawnWidget extends WidgetType {
  eq(other: WidgetType) {
    return other.constructor === this.constructor && JSON.stringify(other) === JSON.stringify(this);
  }
  destroy(dom: HTMLElement) {
    cleanups.get(dom)?.();
    cleanups.delete(dom);
  }
  ignoreEvent(e: Event) {
    return !isLinkEvent(e);
  }
}

export const widgetAction = (label: string, name: IconName) => iconButton(icon(name), label, undefined, "embed-action");
/** "Edit this block" (after an image's "Zoom in"), top right of an image, callout or table on hover. */
export const editButton = (...before: HTMLElement[]) => h("div", { class: "embed-actions" }, ...before, widgetAction("Edit this block", "code-xml"));

/** Put the caret at `pos` in the editor (inside a block widget's source, which then shows). */
export function editAt(view: EditorView, pos: number) {
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  view.focus();
}

/** A callout or a table, drawn in place of its lines (blocks.ts) from their text. */
export abstract class BlockWidget extends DrawnWidget {
  constructor(
    readonly text: string,
    readonly chain: readonly string[],
    /** Bumped to draw it again when files its embeds point at may have changed. */
    readonly files = 0,
  ) {
    super();
  }
  /**
   * Its box, with "Edit this block": a click on it (not on a link, nor one
   * `own` takes) puts the caret in its source at `pos`, outside Reading view.
   */
  protected box(view: EditorView, cls: string, content: HTMLElement, pos: (e: MouseEvent, dom: HTMLElement) => number, own?: (e: MouseEvent) => boolean) {
    const dom = h("div", { class: cls }, content, editButton());
    dom.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || isLinkEvent(e)) return;
      if (!own?.(e)) {
        if (view.state.facet(readingMode)) return;
        editAt(view, pos(e, dom));
      }
      e.preventDefault();
    });
    return dom;
  }
}

/** Decorated text, ready to paint; `widgets` collects what was drawn, so it can be let go of. */
export interface Painted {
  state: EditorState;
  decos: DecorationSet;
  view: EditorView;
  widgets: [WidgetType, HTMLElement][];
  /** Ticking a task's box (by its line, from 0); without it the boxes are disabled. */
  onTask?: (line: number) => void;
}

/** Decorate `doc` as Reading view would, for the editor `view` (its links and files), inside the embeds in `chain`. */
export function decorate(doc: string, view: EditorView, chain: readonly string[], onTask?: (line: number) => void): Painted {
  const state = EditorState.create({ doc, extensions: [markdownSyntax, embedChain.of(chain), extensions] });
  ensureSyntaxTree(state, doc.length, 1000);
  return { state, decos: RangeSet.of(decorators.flatMap((d) => d(state, view)), true), view, widgets: [], onTask };
}

/** Let go of everything a painting drew (images, watched notes). */
export function release(p: Painted) {
  for (const [widget, dom] of p.widgets) widget.destroy(dom);
  p.widgets = [];
}

function widgetDom(p: Painted, widget: WidgetType, pos: number): HTMLElement {
  const dom = widget.toDOM(p.view);
  // A task's checkbox would toggle the note on screen, not this text: it goes to onTask, ahead of the widget's own handler.
  const { onTask } = p;
  if (dom instanceof HTMLInputElement && !onTask) dom.disabled = true;
  else if (dom instanceof HTMLInputElement && onTask) {
    dom.addEventListener(
      "mousedown",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        onTask(p.state.doc.lineAt(pos).number - 1);
      },
      true,
    );
  }
  p.widgets.push([widget, dom]);
  return dom;
}

/** Paint `from`–`to` (within one line) into `parent`: text, marks as nested spans, widgets in place of what they replace. */
export function paintRange(p: Painted, parent: HTMLElement, from: number, to: number) {
  const items: { from: number; to: number; deco: Decoration }[] = [];
  p.decos.between(from, to, (f, t, deco) => {
    if (f === t ? deco.spec.widget && !deco.spec.block : t > from && f < to && !deco.spec.block) items.push({ from: f, to: t, deco });
  });
  items.sort((a, b) => a.from - b.from || b.to - a.to);
  const stack: { el: HTMLElement; to: number }[] = [{ el: parent, to }];
  const top = () => stack[stack.length - 1].el;
  let pos = from;
  // Write the text up to `upto`, closing the marks that end on the way.
  const text = (upto: number) => {
    for (;;) {
      const open = stack[stack.length - 1];
      const end = Math.min(open.to, upto);
      if (end > pos) {
        open.el.append(p.state.sliceDoc(pos, end));
        pos = end;
      }
      if (stack.length > 1 && open.to <= upto) stack.pop();
      else return;
    }
  };
  for (const { from: f, to: t, deco } of items) {
    const spec = deco.spec;
    if (f === t) {
      text(f);
      top().append(widgetDom(p, spec.widget, f));
    } else if (spec.class !== undefined) {
      text(Math.max(f, from));
      const span = h("span", { class: spec.class });
      for (const [k, v] of Object.entries(spec.attributes ?? {})) span.setAttribute(k, v as string);
      top().append(span);
      stack.push({ el: span, to: Math.min(t, to) });
    } else if (t > pos) {
      text(f);
      if (spec.widget) top().append(widgetDom(p, spec.widget, f));
      pos = Math.min(t, to);
    }
  }
  text(to);
}

/** Paint the lines of `p` into `parent`, block widgets in place of the lines they cover. */
export function paintLines(p: Painted, parent: HTMLElement) {
  const doc = p.state.doc;
  for (let n = 1; n <= doc.lines; ) {
    const line = doc.line(n);
    const el = h("div", { class: "cm-line" });
    let blockEnd = -1;
    p.decos.between(line.from, line.from, (f, t, deco) => {
      if (f !== line.from) return;
      if (deco.spec.block) {
        blockEnd = t;
        if (deco.spec.widget) parent.append(widgetDom(p, deco.spec.widget, f));
        return false;
      }
      if (f === t && !deco.spec.widget && deco.spec.class) el.classList.add(...deco.spec.class.split(" "));
    });
    if (blockEnd >= 0) {
      n = doc.lineAt(blockEnd).number + 1;
      continue;
    }
    paintRange(p, el, line.from, line.to);
    if (!el.firstChild) el.append(h("br"));
    parent.append(el);
    n++;
  }
}

/** Markdown rendered into `parent`; returns the painting, to `release` when the DOM goes. */
export function render(parent: HTMLElement, doc: string, view: EditorView, chain: readonly string[], onTask?: (line: number) => void): Painted {
  const p = decorate(doc, view, chain, onTask);
  paintLines(p, parent);
  return p;
}
