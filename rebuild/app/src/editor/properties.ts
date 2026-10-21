// Properties in document: a note's frontmatter shown as Obsidian's
// Properties block at the top of Live Preview and Reading view (observed in
// Obsidian 1.14.4). A "Properties" heading that folds the block, one row per
// property (its type's icon, the key, an editor for the value) and "Add
// property". Settings → Editor → Properties in document: Visible, Hidden (no
// frontmatter shown at all) or Source (the YAML as text in Live Preview;
// Reading view still shows the block, as Obsidian's does).
//
// The block replaces the frontmatter's lines with one widget, built only
// when the frontmatter changes (frontmatter.ts reads it again only when an
// edit touches it), so typing in the body costs nothing. Edits are written
// on Enter or when a field is left, as ordinary undoable changes to the
// note, rewriting only that property's lines. A frontmatter Grove can't read
// line by line is shown as source instead, and a value it can't edit (a
// nested map, multi-line text) is shown as written, read-only.

import { Facet, Prec, StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, WidgetType } from "@codemirror/view";
import { h } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";
import { showMenu } from "../shell/menu";
import { addProperty, type Change, type Frontmatter, frontmatterField, type Property, type PropertyType, removeProperty, renameKey, setValue } from "./frontmatter";
import { editorHost } from "./host";
import { readingMode } from "./livePreview";

export type PropertiesDisplay = "visible" | "hidden" | "source";

/** Settings → Editor → Properties in document. */
export const propertiesDisplay = Facet.define<PropertiesDisplay, PropertiesDisplay>({ combine: (values) => values[0] ?? "visible" });

const TYPE_ICONS: Record<PropertyType, IconName> = {
  text: "text-align-start",
  list: "list",
  number: "binary",
  checkbox: "square-check-big",
  date: "calendar",
  datetime: "clock",
  tags: "tags",
  aliases: "forward",
  unknown: "file-question-mark",
};

/** Show the (empty) block on a note without frontmatter, for "Add file property". */
const showEmpty = StateEffect.define<boolean>();

/** What the frontmatter's place shows: the block, nothing, or the YAML as source. */
function build(state: EditorState, empty: boolean): DecorationSet {
  const fm = state.field(frontmatterField);
  const display = state.facet(propertiesDisplay);
  if (display === "hidden") return fm ? Decoration.set(Decoration.replace({ block: true }).range(0, fm.end)) : Decoration.none;
  if (!fm) return empty ? Decoration.set(Decoration.widget({ widget: new PropertiesWidget(""), block: true, side: -1 }).range(0)) : Decoration.none;
  if (fm.props && (display === "visible" || state.facet(readingMode))) {
    return Decoration.set(Decoration.replace({ widget: new PropertiesWidget(state.doc.sliceString(0, fm.end)), block: true }).range(0, fm.end));
  }
  const lines: Range<Decoration>[] = [];
  for (let n = 1; n <= fm.lines.length + 2; n++) lines.push(sourceLine.range(state.doc.line(n).from));
  return Decoration.set(lines);
}
const sourceLine = Decoration.line({ class: "cm-frontmatter" });

/** Whether the frontmatter's lines are out of sight (the block, or hidden): the caret stays below them. */
const covered = (state: EditorState) => {
  const fm = state.field(frontmatterField);
  const display = state.facet(propertiesDisplay);
  return fm && (display === "hidden" || (fm.props && (display === "visible" || state.facet(readingMode)))) ? fm : null;
};

const blockField = StateField.define<{ deco: DecorationSet; empty: boolean }>({
  create: (state) => ({ deco: build(state, false), empty: false }),
  update(value, tr) {
    let empty = value.empty;
    for (const e of tr.effects) if (e.is(showEmpty)) empty = e.value;
    if (tr.state.field(frontmatterField)) empty = false;
    const same =
      empty === value.empty &&
      tr.state.field(frontmatterField) === tr.startState.field(frontmatterField) &&
      tr.state.facet(propertiesDisplay) === tr.startState.facet(propertiesDisplay) &&
      tr.state.facet(readingMode) === tr.startState.facet(readingMode);
    return same ? { deco: value.deco.map(tr.changes), empty } : { deco: build(tr.state, empty), empty };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

// The caret never rests inside the covered lines (where typing would land
// in the YAML): it moves to the first line of the body. Backspace there
// doesn't join the body to the closing "---".
const caretGuard = ViewPlugin.define((view) => {
  const check = () => {
    const fm = covered(view.state);
    const sel = view.state.selection.main;
    if (!fm || !sel.empty || sel.head > fm.end || fm.end >= view.state.doc.length) return;
    queueMicrotask(() => {
      if (view.state.selection.main.head <= fm.end && covered(view.state) === fm) view.dispatch({ selection: { anchor: fm.end + 1 } });
    });
  };
  check(); // a note just shown
  return { update: (u) => (u.selectionSet || u.docChanged || u.focusChanged) && check() };
});
const keepClosingLine = (view: EditorView) => {
  const fm = covered(view.state);
  const sel = view.state.selection.main;
  return !!fm && sel.empty && sel.head === fm.end + 1;
};
const guardKeys = Prec.high(keymap.of([{ key: "Backspace", run: keepClosingLine }, { key: "Mod-Backspace", run: keepClosingLine }]));

/** The block, in Live Preview and Reading view. */
export const propertiesBlock = [blockField, caretGuard, guardKeys];

/**
 * "Add file property": a new row in the block with its key field focused
 * (nothing is written until a key is typed). False when the block isn't
 * shown, so the caller can edit the YAML instead.
 */
export function openNewProperty(view: EditorView): boolean {
  const state = view.state;
  if (!state.field(blockField, false)) return false;
  const fm = state.field(frontmatterField);
  const display = state.facet(propertiesDisplay);
  if (display === "hidden" || (fm && !fm.props) || (display === "source" && !state.facet(readingMode))) return false;
  if (!fm) view.dispatch({ effects: showEmpty.of(true) });
  const block = view.dom.querySelector<HTMLElement>(".properties");
  const ctl = block && blocks.get(block);
  if (!ctl) return false;
  ctl.newRow();
  return true;
}

class PropertiesWidget extends WidgetType {
  /** `source`: the frontmatter as written (what makes two widgets the same). */
  constructor(readonly source: string) {
    super();
  }
  eq(other: PropertiesWidget) {
    return other.source === this.source;
  }
  toDOM(view: EditorView) {
    const block = new Block(view);
    block.render();
    return block.el;
  }
  updateDOM(dom: HTMLElement) {
    const block = blocks.get(dom);
    block?.render();
    return !!block;
  }
  ignoreEvent() {
    return true;
  }
}

const blocks = new WeakMap<HTMLElement, Block>();
/** Folded blocks, per pane's editor. */
const folded = new WeakSet<EditorView>();

/** Which field had focus, so it can have it again once its row is redrawn. */
type FocusAt = { key: string; part: string };

class Block {
  readonly el: HTMLElement;
  private readonly rows: HTMLElement;
  /** A row added with "Add property" whose key isn't written yet. */
  private pending: HTMLElement | null = null;
  private focusNext: FocusAt | null = null;

  constructor(private readonly view: EditorView) {
    this.rows = h("div", { class: "properties-rows" });
    const heading = h(
      "div",
      { class: "properties-heading", tabindex: "0", onclick: () => this.fold(), onkeydown: (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), this.fold()) },
      h("div", { class: "properties-fold" }, icon("chevron-down")),
      h("div", { class: "properties-title" }, "Properties"),
    );
    const add = h("div", { class: "properties-add", tabindex: "0", onclick: () => this.newRow(), onkeydown: (e: KeyboardEvent) => e.key === "Enter" && this.newRow() }, icon("plus"), "Add property");
    this.el = h("div", { class: "properties" }, heading, h("div", { class: "properties-content" }, this.rows, add));
    this.el.classList.toggle("is-collapsed", folded.has(view));
    // Select all in a field selects that field only. The block sits inside the
    // editor's contenteditable, so the browser's own select-all would take the
    // whole note and the next keys would land in its body.
    this.el.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== "a" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (t instanceof HTMLInputElement) t.select();
      else if (t.isContentEditable) getSelection()?.selectAllChildren(t);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    blocks.set(this.el, this);
  }

  private fold() {
    if (folded.has(this.view)) folded.delete(this.view);
    else folded.add(this.view);
    this.el.classList.toggle("is-collapsed", folded.has(this.view));
  }

  private get fm(): Frontmatter | null {
    return this.view.state.field(frontmatterField);
  }

  private dispatch(change: Change, focus: FocusAt | null) {
    this.focusNext = focus;
    this.view.dispatch({ changes: change, userEvent: "input.property" });
    this.focusNext = null;
  }

  /** Draw the rows for the note's frontmatter now, keeping the ones that didn't change (and their focus). */
  render() {
    const fm = this.fm;
    const props = fm?.props ?? [];
    const active = document.activeElement as HTMLElement | null;
    const focusAt =
      this.focusNext ?? (active && this.rows.contains(active) ? { key: active.closest<HTMLElement>(".property")!.dataset.key!, part: active.dataset.part ?? "row" } : null);
    const old = new Map<string, HTMLElement>();
    for (const row of this.rows.querySelectorAll<HTMLElement>(":scope > .property:not(.is-new)")) old.set(row.dataset.sig!, row);
    const next = props.map((p) => {
      const sig = `${p.key}\u0000${p.type}\u0000${JSON.stringify(p.value)}`;
      const row = old.get(sig) ?? this.row(p);
      old.delete(sig);
      row.dataset.sig = sig;
      return row;
    });
    for (const row of old.values()) row.remove();
    next.forEach((row, i) => {
      if (this.rows.children[i] !== row) this.rows.insertBefore(row, this.rows.children[i] ?? null);
    });
    if (this.pending) this.rows.append(this.pending);
    this.el.classList.toggle("is-empty", !props.length && !this.pending);
    if (focusAt && !this.rows.contains(document.activeElement)) this.focus(focusAt);
  }

  private focus({ key, part }: FocusAt) {
    const row = [...this.rows.children].find((r) => (r as HTMLElement).dataset.key === key) as HTMLElement | undefined;
    if (!row) return;
    const target = part === "row" ? row : (row.querySelector<HTMLElement>(`[data-part="${part}"]`) ?? row);
    target.focus();
  }

  /** "Add property": a row with an empty key, focused; written once it has a key. */
  newRow() {
    this.el.classList.remove("is-collapsed");
    folded.delete(this.view);
    if (!this.pending) {
      const input = keyInput("", (key) => {
        const row = this.pending;
        this.pending = null;
        row?.remove();
        const fm = this.fm;
        const existing = fm?.props?.find((p) => p.key === key);
        if (!key) {
          if (!fm) this.view.dispatch({ effects: showEmpty.of(false) });
          this.render();
        } else if (existing) this.focus({ key, part: "value" });
        else this.dispatch(addProperty(fm, key), { key, part: "value" });
      });
      this.pending = h("div", { class: "property is-new", "data-key": "" }, h("div", { class: "property-key" }, h("span", { class: "property-icon" }, icon(TYPE_ICONS.text)), input), h("div", { class: "property-value" }));
      this.rows.append(this.pending);
      this.el.classList.remove("is-empty");
    }
    this.pending.querySelector("input")!.focus();
  }

  /** The property now in the note under `key` (the note may have changed since its row was drawn). */
  private current(key: string): { fm: Frontmatter; p: Property } | null {
    const fm = this.fm;
    const p = fm?.props?.find((q) => q.key === key);
    return fm && p ? { fm, p } : null;
  }

  private set(key: string, value: Property["value"], part: string) {
    const at = this.current(key);
    if (at && JSON.stringify(at.p.value) !== JSON.stringify(value)) this.dispatch(setValue(at.fm, at.p, value), { key, part });
  }

  private row(p: Property): HTMLElement {
    const key = p.key;
    const iconEl = h("span", { class: "property-icon", title: p.type === "unknown" ? "Grove can't edit this value here" : undefined }, icon(TYPE_ICONS[p.type]));
    iconEl.addEventListener("click", () =>
      showMenu([{ title: "Remove property", icon: "trash-2", action: () => this.remove(key) }], iconEl),
    );
    const input = keyInput(key, (next) => {
      const at = this.current(key);
      if (!at || !next || next === key || this.fm?.props?.some((q) => q.key === next)) input.value = key;
      else this.dispatch(renameKey(at.fm, at.p, next), { key: next, part: "value" });
    });
    const row = h("div", { class: "property", tabindex: "0", "data-key": key, "data-part": "row" }, h("div", { class: "property-key" }, iconEl, input), this.value(p));
    row.addEventListener("keydown", (e) => {
      if (e.target !== row) return;
      if (e.key === "Delete" || e.key === "Backspace") this.remove(key);
      else if (e.key === "Enter") row.querySelector<HTMLElement>('[data-part="value"]')?.focus();
      else return;
      e.preventDefault();
    });
    return row;
  }

  private remove(key: string) {
    const at = this.current(key);
    if (at) this.dispatch(removeProperty(at.fm, at.p), null);
    this.view.focus();
  }

  /** The value's editor for its type. */
  private value(p: Property): HTMLElement {
    const key = p.key;
    const box = h("div", { class: "property-value", "data-type": p.type });
    const leave = (el: HTMLElement) => el.closest<HTMLElement>(".property")?.focus();
    switch (p.type) {
      case "checkbox": {
        const check = h("input", { class: "cm-task-checkbox", "data-part": "value" });
        check.type = "checkbox";
        check.checked = p.value === true;
        check.addEventListener("change", () => this.set(key, check.checked, "value"));
        box.append(check);
        break;
      }
      case "number":
      case "date":
      case "datetime": {
        const input = h("input", { class: "property-input", "data-part": "value" });
        input.type = p.type === "datetime" ? "datetime-local" : p.type;
        if (p.type === "number") input.step = "any";
        input.value = p.value as string;
        input.placeholder = "Empty";
        input.addEventListener("change", () => input.validity.valid && this.set(key, input.value, "value"));
        input.addEventListener("keydown", (e) => e.key === "Enter" && leave(input));
        box.append(input);
        break;
      }
      case "list":
      case "tags":
      case "aliases":
        this.list(box, key, p.type, p.value as string[]);
        break;
      case "unknown":
        box.append(h("span", { class: "property-unknown", "data-part": "value", tabindex: "0" }, p.value as string));
        break;
      default: {
        const text = editable(p.value as string, (next) => this.set(key, next, "row"), leave);
        box.append(text);
      }
    }
    return box;
  }

  /** Items as pills (× removes one), and a field that adds one on Enter. */
  private list(box: HTMLElement, key: string, type: PropertyType, items: string[]) {
    const host = this.view.state.facet(editorHost);
    items.forEach((item, i) => {
      const link = /^\[\[([^\]|#]+)[^\]|]*(?:\|([^\]]*))?\]\]$/.exec(item);
      const label = h("span", { class: link ? "property-link" : undefined }, link ? (link[2] ?? link[1]) : item);
      if (link) label.addEventListener("click", (e) => host?.openLink(link[1].trim(), e.ctrlKey || e.metaKey ? "tab" : false, this.view));
      const remove = h("span", { class: "property-pill-remove", "aria-label": "Remove" }, icon("x"));
      remove.addEventListener("click", () => this.set(key, items.filter((_, k) => k !== i), "add"));
      box.append(h("span", { class: `property-pill${type === "tags" ? " is-tag" : ""}` }, label, remove));
    });
    const add = editable("", () => {}, () => {});
    add.dataset.part = "add";
    const commit = () => {
      let item = add.textContent!.trim();
      if (type === "tags") item = item.replace(/^#/, "");
      add.textContent = "";
      if (item) this.set(key, [...items, item], "add");
    };
    add.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        commit();
      } else if (e.key === "Backspace" && !add.textContent && items.length) this.set(key, items.slice(0, -1), "add");
    });
    add.addEventListener("blur", commit);
    box.append(add);
  }
}

/** A key field: written on Enter or when left; Escape gives the old key back. */
function keyInput(key: string, commit: (key: string) => void) {
  const input = h("input", { class: "property-key-input", "data-part": "key", "aria-label": key || "New property" });
  input.value = key;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    commit(input.value.trim());
    done = false;
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish();
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.value = key;
      finish();
    }
  });
  input.addEventListener("blur", finish);
  return input;
}

/** A one-line text field (a plain-text editable span): `commit` on Enter or when left, Escape undoes. */
function editable(text: string, commit: (text: string) => void, leave: (el: HTMLElement) => void) {
  const el = h("div", { class: "property-text", "data-part": "value" });
  el.contentEditable = "plaintext-only";
  el.textContent = text;
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      if (e.key === "Escape") el.textContent = text;
      leave(el);
    }
  });
  el.addEventListener("blur", () => {
    const next = el.textContent!.replace(/\s*\n\s*/g, " ");
    if (next !== text) commit(next);
  });
  return el;
}
