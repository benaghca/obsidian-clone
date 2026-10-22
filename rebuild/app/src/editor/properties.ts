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
//
// A row's icon opens Obsidian's menu: Property type (chosen per name for
// the whole vault; nothing is rewritten, a value that doesn't fit is shown
// as it is with a warning, which offers to show it in the chosen type),
// Cut, Copy, Paste and Remove. Name and value fields (propertyFields.ts)
// suggest what the vault already uses (names with their type, a name's
// values, the vault's tags).

import { Facet, Prec, StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, WidgetType } from "@codemirror/view";
import { confirmDialog } from "../shell/confirm";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { type MenuItems, SEPARATOR, showMenu } from "../shell/menu";
import type { SuggestItem } from "../shell/suggest";
import {
  addLines,
  addProperty,
  asType,
  type Change,
  fits,
  type Frontmatter,
  frontmatterField,
  type Property,
  type PropertyType,
  readProperties,
  removeProperty,
  renameKey,
  replaceLines,
  setValue,
  STORED_TYPES,
} from "./frontmatter";
import { editorHost, type PropertyHost } from "./host";
import { readingMode } from "./render";
import { editable, keyInput, TYPE_ICONS, TYPE_NAMES, typeItems } from "./propertyFields";

export type PropertiesDisplay = "visible" | "hidden" | "source";

/** Settings → Editor → Properties in document. */
export const propertiesDisplay = Facet.define<PropertiesDisplay, PropertiesDisplay>({ combine: (values) => values[0] ?? "visible" });

/** The vault's chosen property types changed (refreshPropertyTypes): blocks draw their rows again. */
const typesChanged = StateEffect.define<null>();
let typesVersion = 0;

export function refreshPropertyTypes(views: EditorView[]) {
  typesVersion++;
  for (const view of views) view.dispatch({ effects: typesChanged.of(null) });
}

/** Show the (empty) block on a note without frontmatter, for "Add file property". */
const showEmpty = StateEffect.define<boolean>();

/** Whether the frontmatter (if Grove can read it) shows as the block: Visible, or Source in Reading view. */
function showsBlock(state: EditorState, fm = state.field(frontmatterField)) {
  const display = state.facet(propertiesDisplay);
  return display !== "hidden" && (!fm || !!fm.props) && (display === "visible" || state.facet(readingMode));
}

/** What the frontmatter's place shows: the block, nothing, or the YAML as source. */
function build(state: EditorState, empty: boolean): DecorationSet {
  const fm = state.field(frontmatterField);
  if (state.facet(propertiesDisplay) === "hidden") return fm ? Decoration.set(Decoration.replace({ block: true }).range(0, fm.end)) : Decoration.none;
  if (!fm) return empty ? Decoration.set(Decoration.widget({ widget: new PropertiesWidget("", typesVersion), block: true, side: -1 }).range(0)) : Decoration.none;
  if (showsBlock(state, fm)) {
    return Decoration.set(Decoration.replace({ widget: new PropertiesWidget(state.doc.sliceString(0, fm.end), typesVersion), block: true }).range(0, fm.end));
  }
  const lines: Range<Decoration>[] = [];
  for (let n = 1; n <= fm.lines.length + 2; n++) lines.push(sourceLine.range(state.doc.line(n).from));
  return Decoration.set(lines);
}
const sourceLine = Decoration.line({ class: "cm-frontmatter" });

/** Whether the frontmatter's lines are out of sight (the block, or hidden): the caret stays below them. */
const covered = (state: EditorState) => {
  const fm = state.field(frontmatterField);
  return fm && (state.facet(propertiesDisplay) === "hidden" || showsBlock(state, fm)) ? fm : null;
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
      tr.state.facet(readingMode) === tr.startState.facet(readingMode) &&
      !tr.effects.some((e) => e.is(typesChanged));
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
  if (!showsBlock(state, fm)) return false;
  if (!fm) view.dispatch({ effects: showEmpty.of(true) });
  const block = view.dom.querySelector<HTMLElement>(".properties");
  const ctl = block && blocks.get(block);
  if (!ctl) return false;
  ctl.newRow();
  return true;
}

/** The File properties view's rows: `view`'s note's properties, as its block shows them but without the heading (`render` again when they change). */
export function propertyRows(view: EditorView): { el: HTMLElement; render(): void } {
  const block = new Block(view, false);
  block.render();
  return block;
}

class PropertiesWidget extends WidgetType {
  /** `source`: the frontmatter as written; with the types' version, what makes two widgets the same. */
  constructor(
    readonly source: string,
    readonly version: number,
  ) {
    super();
  }
  eq(other: PropertiesWidget) {
    return other.source === this.source && other.version === this.version;
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
  /** Values shown in their chosen type after "Display as ...?" (that type, by name). */
  private readonly updated = new Map<string, PropertyType>();

  /** `heading`: the "Properties" heading that folds it (the File properties view has none). */
  constructor(
    private readonly view: EditorView,
    heading = true,
  ) {
    this.rows = h("div", { class: "properties-rows" });
    const title = heading && h(
      "div",
      { class: "properties-heading", tabindex: "0", onclick: () => this.fold(), onkeydown: (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), this.fold()) },
      h("div", { class: "properties-fold" }, icon("chevron-down")),
      h("div", { class: "properties-title" }, "Properties"),
    );
    const add = h("div", { class: "properties-add", tabindex: "0", onclick: () => this.newRow(), onkeydown: (e: KeyboardEvent) => e.key === "Enter" && this.newRow() }, icon("plus"), "Add property");
    this.el = h("div", { class: "properties" }, title, h("div", { class: "properties-content" }, this.rows, add));
    this.el.classList.toggle("is-collapsed", heading && folded.has(view));
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

  private get vault(): PropertyHost | null {
    return this.view.state.facet(editorHost)?.properties?.() ?? null;
  }

  /** How a property is shown: in its chosen type when its value fits (or after "Update"), else as it is, flagged. */
  private shownAs(p: Property): { type: PropertyType; value: Property["value"]; want: PropertyType | null; mismatch: boolean } {
    const want = p.type === "unknown" ? null : (this.vault?.typeOf(p.key) ?? null);
    if (!want || want === p.type) return { type: p.type, value: p.value, want, mismatch: false };
    if (fits(p, want) || this.updated.get(p.key) === want) return { type: want, value: asType(p, want), want, mismatch: false };
    return { type: p.type, value: p.value, want, mismatch: true };
  }

  /** Suggestions for a name field: the vault's names the note doesn't have yet, with their types' icons. */
  private names = async (): Promise<SuggestItem[]> => {
    const own = new Set(this.fm?.props?.map((p) => p.key));
    return ((await this.vault?.names()) ?? []).filter((n) => !own.has(n.key)).map((n) => ({ text: n.key, icon: TYPE_ICONS[n.type] }));
  };

  /** Suggestions for a value: what the name has elsewhere in the vault (less what is there already). */
  private values = async (key: string, except: string[] = []): Promise<SuggestItem[]> => {
    const skip = new Set(except.map((v) => v.toLowerCase()));
    return ((await this.vault?.values(key)) ?? []).filter((v) => !skip.has(v.toLowerCase())).map((text) => ({ text }));
  };

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
      const shown = this.shownAs(p);
      const sig = [p.key, p.type, JSON.stringify(p.value), shown.type, shown.want, shown.mismatch].join("\u0000");
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
      const input = keyInput("", this.names, (key) => {
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

  /** Write a value, in the type it is shown as. */
  private set(key: string, value: Property["value"], part: string, type: PropertyType) {
    const at = this.current(key);
    if (at && (JSON.stringify(at.p.value) !== JSON.stringify(value) || at.p.type !== type)) this.dispatch(setValue(at.fm, at.p, value, type), { key, part });
  }

  private row(p: Property): HTMLElement {
    const key = p.key;
    const shown = this.shownAs(p);
    const iconEl = h(
      "span",
      { class: "property-icon", title: p.type === "unknown" ? "Grove can't edit this value here" : undefined },
      icon(TYPE_ICONS[shown.want ?? p.type]),
    );
    iconEl.addEventListener("click", () => showMenu(this.menu(p), iconEl));
    const input = keyInput(key, this.names, (next) => {
      const at = this.current(key);
      if (!at || !next || next === key || this.fm?.props?.some((q) => q.key === next)) input.value = key;
      else this.dispatch(renameKey(at.fm, at.p, next), { key: next, part: "value" });
    });
    // A value that doesn't fit the type chosen for its name: Obsidian's warning, which offers to show it in that type.
    const want = shown.want!;
    const warning =
      shown.mismatch &&
      h(
        "span",
        { class: "property-warning", title: `Type mismatch, expected ${TYPE_NAMES[want]}`, onclick: () => void this.adapt(key, p.type, want) },
        icon("triangle-alert"),
      );
    const row = h(
      "div",
      { class: "property", tabindex: "0", "data-key": key, "data-part": "row" },
      h("div", { class: "property-key" }, iconEl, input),
      this.value(key, shown.type, shown.value),
      warning || null,
    );
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

  /** The row icon's menu, as Obsidian's. */
  private menu(p: Property): MenuItems {
    const key = p.key;
    return [
      { title: "Property type", icon: "info", submenu: typeItems(key, p.type, this.vault) },
      { title: "Cut", icon: "scissors", action: () => void this.copy(key, true) },
      { title: "Copy", icon: "copy", action: () => void this.copy(key, false) },
      { title: "Paste", icon: "clipboard-check", action: () => void this.paste() },
      SEPARATOR,
      { title: "Remove", icon: "trash-2", danger: true, action: () => this.remove(key) },
    ];
  }

  /** Copy a property's lines as written (Cut also removes it). */
  private async copy(key: string, cut: boolean) {
    const at = this.current(key);
    if (!at) return;
    try {
      await navigator.clipboard.writeText(`${at.fm.lines.slice(at.p.line, at.p.line + at.p.count).join("\n")}\n`);
    } catch (err) {
      console.warn("Could not copy", err);
      return;
    }
    if (cut) this.remove(key);
  }

  /** Paste copied properties (YAML): a name the note has takes the pasted value, a new one is added at the end. */
  private async paste() {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch (err) {
      console.warn("Grove could not read the clipboard", err);
      return;
    }
    const lines = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n");
    const pasted = readProperties(lines);
    const fm = this.fm;
    if (!pasted?.length || (fm && !fm.props)) return;
    const changes: Change[] = [];
    const added: string[] = [];
    for (const p of pasted) {
      const own = lines.slice(p.line, p.line + p.count).join("\n");
      const old = fm?.props?.find((q) => q.key === p.key);
      if (old) changes.push(replaceLines(fm!, old, own));
      else added.push(own);
    }
    if (added.length) changes.push(addLines(fm, added.join("\n")));
    this.view.dispatch({ changes: changes.sort((a, b) => a.from - b.from), userEvent: "input.paste" });
  }

  /** "Display as ...?": show a value that doesn't fit its chosen type in that type (written once it is edited). */
  private async adapt(key: string, from: PropertyType, to: PropertyType) {
    const { ok } = await confirmDialog({
      title: `Display as ${STORED_TYPES[to]}?`,
      message: `Your ${STORED_TYPES[from]} data is not compatible. It will be adapted to fit the new format.`,
      confirm: "Update",
    });
    if (!ok) return;
    this.updated.set(key, to);
    this.render();
  }

  /** The value's editor for its type. */
  private value(key: string, type: PropertyType, value: Property["value"]): HTMLElement {
    const box = h("div", { class: "property-value", "data-type": type });
    const leave = (el: HTMLElement) => el.closest<HTMLElement>(".property")?.focus();
    const set = (v: Property["value"], part: string) => this.set(key, v, part, type);
    switch (type) {
      case "checkbox": {
        const check = h("input", { class: "cm-task-checkbox", type: "checkbox", "data-part": "value" });
        check.checked = value === true;
        check.addEventListener("change", () => set(check.checked, "value"));
        box.append(check);
        break;
      }
      case "number":
      case "date":
      case "datetime": {
        const input = h("input", { class: "property-input", type: type === "datetime" ? "datetime-local" : type, value: value as string, placeholder: "Empty", "data-part": "value" });
        if (type === "number") input.step = "any";
        input.addEventListener("change", () => input.validity.valid && set(input.value, "value"));
        input.addEventListener("keydown", (e) => e.key === "Enter" && leave(input));
        box.append(input);
        break;
      }
      case "list":
      case "tags":
      case "aliases":
        this.list(box, key, type, value as string[]);
        break;
      case "unknown":
        box.append(h("span", { class: "property-unknown", "data-part": "value", tabindex: "0" }, value as string));
        break;
      default: {
        const text = editable(value as string, (next) => set(next, "row"), leave, () => this.values(key));
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
      remove.addEventListener("click", () => this.set(key, items.filter((_, k) => k !== i), "add", type));
      box.append(h("span", { class: `property-pill${type === "tags" ? " is-tag" : ""}` }, label, remove));
    });
    const commit = () => {
      let item = add.textContent!.trim();
      if (type === "tags") item = item.replace(/^#/, "");
      add.textContent = "";
      if (item) this.set(key, [...items, item], "add", type);
    };
    const add = editable("", () => {}, () => {}, () => this.values(key, items), (item) => {
      add.textContent = item.text;
      commit();
    });
    add.dataset.part = "add";
    add.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        commit();
      } else if (e.key === "Backspace" && !add.textContent && items.length) this.set(key, items.slice(0, -1), "add", type);
    });
    add.addEventListener("blur", commit);
    box.append(add);
  }
}
