// What the editor needs from the surrounding app, supplied as a facet so the
// editor modules never import the workspace.

import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { PropertyType } from "./frontmatter";

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
  /** What the Properties block knows of the vault's properties (null until the app has the index). */
  properties?(): PropertyHost | null;
}

/** The vault's properties, as the Properties block uses them. */
export interface PropertyHost {
  /** The type chosen for a property name in the vault, or null (automatic: from its value). */
  typeOf(key: string): PropertyType | null;
  setType(key: string, type: PropertyType | null): void;
  /** The property names in the vault with their types, most used first. */
  names(): Promise<{ key: string; type: PropertyType }[]>;
  /** The values a name has across the vault, sorted (for tags: the vault's tags). */
  values(key: string): Promise<string[]>;
}

export const editorHost = Facet.define<EditorHost, EditorHost | null>({
  combine: (values) => values[0] ?? null,
});
