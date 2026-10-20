// Builds the EditorState for a note. Each open note keeps its own state (and
// undo history); panes swap states with view.setState, which is instant.

import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension, Prec } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { countsField } from "./counts";
import { type EditorHost, editorHost } from "./host";
import { livePreview, readingMode } from "./livePreview";
import { Tag, WikiLink } from "./syntax";
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

/**
 * How a tab shows its note, like Obsidian's: Live Preview (the default),
 * Source mode (raw markdown) or Reading view (everything rendered, read-only).
 */
export type ViewMode = "live" | "source" | "reading";

export const viewModeCompartment = new Compartment();

export const VIEW_MODES: Record<ViewMode, Extension> = {
  live: livePreview,
  source: EditorView.editorAttributes.of({ class: "is-source-mode" }),
  reading: [
    livePreview,
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

// Enter on an empty list item ends the list (or steps out one level) without
// leaving a blank line behind, as Obsidian does. CodeMirror's default would
// first turn a tight list loose.
const listKeymap = Prec.high(
  keymap.of([
    { key: "Enter", run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
    { key: "Backspace", run: deleteMarkupBackward },
  ]),
);

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
  doc: string;
  host: EditorHost;
  /** Extra extensions from the pane, e.g. an update listener. */
  extensions?: Extension;
}

export function createNoteState({ doc, host, extensions = [] }: NoteStateOptions): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      editorHost.of(host),
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      EditorState.allowMultipleSelections.of(true),
      indentUnit.of("    "),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{"] } }]),
      closeBrackets(),
      markdown({ base: markdownLanguage, extensions: [WikiLink, Tag], addKeymap: false }),
      listKeymap,
      viewModeCompartment.of(VIEW_MODES.live),
      contextMenu,
      wikilinkCompletion,
      countsField,
      keymap.of([
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "on", autocapitalize: "sentences" }),
      baseTheme,
      extensions,
    ],
  });
}
