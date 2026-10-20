// What the editor needs from the surrounding app, supplied as a facet so the
// editor modules never import the workspace.

import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface NoteRef {
  name: string;
  path: string;
}

export interface EditorHost {
  /** Follow a [[wikilink]] target (note name, optionally with #heading). */
  openLink(target: string, newTab: boolean): void;
  openUrl(url: string): void;
  notes(): NoteRef[];
  /** Show the editor menu at `at` for document position `pos` (the caret is already there). */
  contextMenu?(view: EditorView, at: { x: number; y: number }, pos: number, keyboard: boolean): void;
}

export const editorHost = Facet.define<EditorHost, EditorHost | null>({
  combine: (values) => values[0] ?? null,
});
