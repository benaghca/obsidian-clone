// Builds the EditorState for a note. Each open note keeps its own state (and
// undo history); panes swap states with view.setState, which is instant.

import { acceptCompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { getSearchQuery, search, searchKeymap, searchPanelOpen } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension, type SelectionRange, type Text } from "@codemirror/state";
import { EditorView, keymap, layer, RectangleMarker, ViewPlugin } from "@codemirror/view";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { blocks } from "./blocks";
import { clipboard } from "./clipboard";
import { codeHighlight } from "./codeHighlight";
import { configExtensions } from "./config";
import { type Counts, countsField } from "./counts";
import { indentList, markdownHome } from "./format";
import { frontmatterField } from "./frontmatter";
import { type EditorHost, editorHost } from "./host";
import { livePreview } from "./livePreview";
import { propertiesBlock } from "./properties";
import { readingMode } from "./render";
import { sourceMode } from "./sourceMode";
import { markdownSyntax } from "./syntax";
import { tableKeys } from "./tables";
import { wikilinkCompletion } from "./wikilinkComplete";

const baseTheme = EditorView.theme({
  "&": { color: "var(--text-normal)", backgroundColor: "transparent", fontSize: "var(--font-text-size)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-text)", lineHeight: "var(--line-height)", overflow: "visible" },
  ".cm-content": { padding: "0 0 50vh", caretColor: "var(--text-normal)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text-normal)", borderLeftWidth: "1.5px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--text-selection) !important",
  },
});

// The browser draws the selection and the caret, as in Obsidian, so a
// selection hugs the text (no full-width bars on blank or wrapped lines, no
// tint over list bullets). Drawn here is only what the browser can't show:
// the other ranges of a multiple selection, and a cursor at the head of
// every range but a plain caret.
const drawn = (cls: string, above: boolean, mark: (view: EditorView, r: SelectionRange, main: boolean) => readonly RectangleMarker[]) =>
  layer({
    above,
    class: cls,
    update: (u) => u.docChanged || u.selectionSet || u.viewportChanged || u.geometryChanged,
    markers: (view) => view.state.selection.ranges.flatMap((r) => mark(view, r, r === view.state.selection.main)),
  });
const drawnSelection = [
  drawn("cm-selectionLayer", false, (view, r, main) => (main ? [] : RectangleMarker.forRange(view, "cm-selectionBackground", r))),
  drawn("cm-cursorLayer", true, (view, r, main) => (main && r.empty ? [] : RectangleMarker.forRange(view, "cm-cursor", EditorSelection.cursor(r.head, r.head > r.anchor ? -1 : 1)))),
];

/**
 * How a tab shows its note, like Obsidian's: Live Preview (the default),
 * Source mode (raw markdown) or Reading view (everything rendered, read-only).
 */
export type ViewMode = "live" | "source" | "reading";

export const viewModeCompartment = new Compartment();

export const VIEW_MODES: Record<ViewMode, Extension> = {
  live: [livePreview, blocks, propertiesBlock, tableKeys],
  source: [EditorView.editorAttributes.of({ class: "is-source-mode" }), sourceMode],
  reading: [
    livePreview,
    blocks,
    propertiesBlock,
    readingMode.of(true),
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    EditorView.editorAttributes.of({ class: "is-reading-mode" }),
  ],
};

/** The mode a note's state is configured for. */
export function viewModeOf(state: EditorState): ViewMode {
  const ext = viewModeCompartment.get(state);
  return (Object.keys(VIEW_MODES) as ViewMode[]).find((m) => VIEW_MODES[m] === ext) ?? "live";
}

// Right-click: put the caret where the click was (unless it was inside the
// selection), then let the app show its menu. From the keyboard (the Menu
// key, Shift+F10) the menu opens at the caret instead, highlight on its
// first item.
const contextMenu = EditorView.domEventHandlers({
  contextmenu(event, view) {
    const host = view.state.facet(editorHost);
    if (!host?.contextMenu) return false;
    event.preventDefault();
    const keyboard = event.button !== 2;
    if (keyboard) {
      const head = view.state.selection.main.head;
      const at = view.coordsAtPos(head);
      host.contextMenu(view, { x: at?.left ?? event.clientX, y: at?.bottom ?? event.clientY }, head, true);
      return true;
    }
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos !== null && !view.state.selection.ranges.some((r) => r.from <= pos && r.to >= pos)) {
      view.dispatch({ selection: { anchor: pos } });
    }
    host.contextMenu(view, { x: event.clientX, y: event.clientY }, pos ?? view.state.selection.main.head, false);
    return true;
  },
});

/** Use the search query's own cursor so case, regex and word options agree with navigation. */
export function searchMatches(state: EditorState) {
  const query = getSearchQuery(state);
  const matches: { from: number; to: number }[] = [];
  if (query.valid) {
    const cursor = query.getCursor(state);
    for (let next = cursor.next(); !next.done; next = cursor.next()) matches.push(next.value);
  }
  return matches;
}

export function searchMatchIndex(matches: ReturnType<typeof searchMatches>, { from, to }: { from: number; to: number }) {
  return matches.findIndex((m) => (m.from === from && m.to === to) || (from === to && m.from <= from && from < m.to));
}

export function searchMatchAtOrAfter(matches: ReturnType<typeof searchMatches>, from: number) {
  return matches.find((m) => m.from >= from) ?? matches[0];
}

/** Rearrange the stock panel once, preserving its fields, handlers and keyboard scope. */
function styleSearchPanel(panel: HTMLElement, field: HTMLInputElement) {
  const focused = document.activeElement === field;
  const selection = [field.selectionStart, field.selectionEnd] as const;
  const button = (name: string, label: string, glyph: Parameters<typeof icon>[0]) => {
    const el = panel.querySelector<HTMLButtonElement>(`button[name=${name}]`)!;
    el.className = "clickable-icon";
    el.setAttribute("aria-label", label);
    el.removeAttribute("title");
    el.replaceChildren(icon(glyph));
    return el;
  };
  const count = h("span", { class: "cm-search-count", "aria-live": "polite" });
  const options = [...panel.querySelectorAll("label")].map((label, i) => {
    const input = label.querySelector("input")!;
    const title = ["Match case", "Regular expression", "Whole word"][i];
    input.setAttribute("aria-label", title);
    label.className = "cm-search-option clickable-icon";
    label.setAttribute("aria-label", title);
    label.removeAttribute("title");
    label.replaceChildren(input, icon((["case-sensitive", "regex", "whole-word"] as const)[i]));
    return label;
  });
  const replace = panel.querySelector<HTMLInputElement>("[name=replace]");
  const toggle = h("button", { type: "button", class: "clickable-icon", "aria-label": "Replace", "aria-expanded": "false", onclick: () => {
    toggle.setAttribute("aria-expanded", String(panel.classList.toggle("is-replacing")));
  } }, icon("chevron-right"));
  toggle.setAttribute("name", "toggle-replace");
  const row = h("div", { class: "cm-search-row" }, replace && toggle,
    h("div", { class: "cm-search-input" }, field, count),
    button("prev", "Previous match", "arrow-up"), button("next", "Next match", "arrow-down"), ...options, button("close", "Close find", "x"));
  const replacement = replace && h("div", { class: "cm-search-replace cm-search-row" }, replace,
    panel.querySelector<HTMLButtonElement>("button[name=replace]")!,
    panel.querySelector<HTMLButtonElement>("button[name=replaceAll]")!);
  panel.replaceChildren(row, ...(replacement ? [replacement] : []));
  if (focused) { field.focus(); field.setSelectionRange(...selection); }
}

const searchCounter = ViewPlugin.define((view) => {
  let doc: Text | null = null;
  let query: ReturnType<typeof getSearchQuery> | null = null;
  let matches: ReturnType<typeof searchMatches> = [];
  return { update(u) {
    if (!searchPanelOpen(u.state)) return;
    const next = getSearchQuery(u.state);
    const changed = !query?.eq(next);
    if (doc !== u.state.doc || changed) {
      doc = u.state.doc;
      query = next;
      matches = searchMatches(u.state);
    }
    // Panels mount after plugins update. Keep CodeMirror's panel and its keyboard handling.
    queueMicrotask(() => {
      if (view.state !== u.state) return;
      const field = view.dom.querySelector<HTMLInputElement>(".cm-search [name=search]");
      if (!field) return;
      const selection = view.state.selection.main;
      if (changed && matches.length) {
        const match = searchMatchAtOrAfter(matches, selection.from);
        if (selection.from !== match.from || selection.to !== match.to) {
          view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true });
          return;
        }
      }
      const panel = field.closest<HTMLElement>(".cm-search")!;
      if (!panel.querySelector(".cm-search-input")) styleSearchPanel(panel, field);
      const count = panel.querySelector(".cm-search-count")!;
      count.textContent = `${searchMatchIndex(matches, selection) + 1} / ${matches.length}`;
    });
  } };
});

interface NoteStateOptions {
  doc: string | Text;
  host: EditorHost;
  /** Extra extensions from the workspace, e.g. a mirror's undo keys. */
  extensions?: Extension;
  /**
   * A note's main state keeps its undo history. A mirror (the same note in
   * a second pane) has none: its undo acts on the main state.
   */
  history?: boolean;
  selection?: EditorSelection;
  /** The word and character counts, when already known (a mirror copies its main state's). */
  counts?: Counts;
}

export function createNoteState({ doc, host, extensions = [], history: withHistory = true, selection, counts }: NoteStateOptions): EditorState {
  return EditorState.create({
    doc,
    selection,
    extensions: [
      editorHost.of(host),
      withHistory ? history() : [],
      drawnSelection,
      EditorView.lineWrapping,
      EditorState.allowMultipleSelections.of(true),
      markdownSyntax,
      codeHighlight,
      frontmatterField,
      // Settings → Editor: line numbers, folding, spellcheck, pairing, lists, indentation.
      configExtensions(),
      viewModeCompartment.of(VIEW_MODES.live),
      contextMenu,
      clipboard,
      search({ top: true }),
      searchCounter,
      wikilinkCompletion,
      counts ? countsField.init(() => counts) : countsField,
      keymap.of([
        ...completionKeymap,
        { key: "Tab", run: acceptCompletion },
        { key: "Home", run: markdownHome(), shift: markdownHome(true) },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        { key: "Tab", run: indentList(), shift: indentList(true) },
      ]),
      baseTheme,
      extensions,
    ],
  });
}
