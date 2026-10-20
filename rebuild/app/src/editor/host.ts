// What the editor needs from the surrounding app, supplied as a facet so the
// editor modules never import the workspace.

import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface NoteRef {
  name: string;
  path: string;
}

/** Where a followed link opens: the same tab, a new tab, or a new pane to the right. */
export type LinkTarget = false | "tab" | "right";

export interface EditorHost {
  /** Follow a [[wikilink]] target (note name, optionally with #heading), from the pane of `view`. */
  openLink(target: string, where: LinkTarget, view?: EditorView): void;
  openUrl(url: string): void;
  notes(): NoteRef[];
  /** A new link to the note at `target` from the note in `view`, as the link settings ask ([[wikilink]] or [markdown](link)). */
  formatLink(target: string, view: EditorView, display?: string): string;
  /** Show the editor menu at `at` for document position `pos` (the caret is already there). */
  contextMenu?(view: EditorView, at: { x: number; y: number }, pos: number, keyboard: boolean): void;
}

export const editorHost = Facet.define<EditorHost, EditorHost | null>({
  combine: (values) => values[0] ?? null,
});
