// Builds the EditorState for a note. Each open note keeps its own state (and
// undo history); panes swap states with view.setState, which is instant.

import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { countsField } from "./counts";
import { type EditorHost, editorHost } from "./host";
import { livePreview } from "./livePreview";
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
      markdown({ base: markdownLanguage, extensions: [WikiLink, Tag] }),
      livePreview,
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
