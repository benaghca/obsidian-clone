// Builds the EditorState for a note. Each open note keeps its own state (and
// undo history); panes swap states with view.setState, which is instant.

import { completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView, keymap, layer, RectangleMarker, type ViewUpdate } from "@codemirror/view";
import { blocks } from "./blocks";
import { codeHighlight } from "./codeHighlight";
import { configExtensions } from "./config";
import { type Counts, countsField } from "./counts";
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
const redraw = (u: ViewUpdate) => u.docChanged || u.selectionSet || u.viewportChanged || u.geometryChanged;
const drawnSelection = [
  layer({
    above: false,
    class: "cm-selectionLayer",
    update: redraw,
    markers: (view) => {
      const { ranges, main } = view.state.selection;
      return ranges.flatMap((r) => (r === main ? [] : RectangleMarker.forRange(view, "cm-selectionBackground", r)));
    },
  }),
  layer({
    above: true,
    class: "cm-cursorLayer",
    update: redraw,
    markers: (view) => {
      const { ranges, main } = view.state.selection;
      return ranges.flatMap((r) => (r === main && r.empty ? [] : RectangleMarker.forRange(view, "cm-cursor", EditorSelection.cursor(r.head, r.head > r.anchor ? -1 : 1))));
    },
  }),
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

export interface NoteStateOptions {
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
      wikilinkCompletion,
      counts ? countsField.init(() => counts) : countsField,
      keymap.of([
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      baseTheme,
      extensions,
    ],
  });
}
