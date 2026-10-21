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
  /** Whether a link target (from the note in `view`) points at a file: links to missing notes are drawn faded. */
  linkExists?(target: string, view: EditorView): boolean;
  /** What the Properties block knows of the vault's properties (null until the app has the index). */
  properties?(): PropertyHost | null;
  /** The files `![[embeds]]` show. */
  embeds?: EmbedHost;
}

/** Embedded notes and images, read only when drawn and cached by the app. */
export interface EmbedHost {
  /** The vault file a link target points at from the note in `view` (images by their name with its extension), or null. */
  resolve(target: string, view: EditorView): string | null;
  /** The note on screen in `view`. */
  pathOf(view: EditorView): string | null;
  /** A note's text: from its editor when it is open, else from disk (cached by path and modified time). */
  read(path: string): Promise<string>;
  /** An image file as a blob: URL, held until `release` (revoked once nothing holds it). */
  image(path: string): { url: Promise<string>; release(): void };
  /** Call `fn` when the file changes (on disk, or saved from an editor); returns a function that stops. */
  watch(path: string, fn: () => void): () => void;
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
