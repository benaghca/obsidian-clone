// What the editor needs from the surrounding app, supplied as a facet so the
// editor modules never import the workspace.

import { Facet, type ChangeSpec, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { PropertyType } from "./frontmatter";

export interface NoteRef {
  name: string;
  path: string;
}

/** Where a followed link opens: the same tab, a new tab, or a new pane to the right. */
type LinkTarget = false | "tab" | "right";

export interface LinkDocument { path: string | null; state: EditorState; current: boolean }

export interface EditorHost {
  /** Follow a [[wikilink]] target (note name, optionally with #heading), from the pane of `view`. */
  openLink(target: string, where: LinkTarget, view?: EditorView): void;
  openUrl(url: string): void;
  /** Link candidates, recent files first, including attachments and unresolved targets. */
  linkCandidates(): NoteRef[];
  /** A note's frontmatter aliases, for [[ suggestions. Absent when the host has no property index. */
  linkAliases?(): Promise<{ path: string; name: string; alias: string }[]>;
  /** A new link to the note at `target` from the note in `view`, as the link settings ask ([[wikilink]] or [markdown](link)). */
  formatLink(target: string, view: EditorView, display?: string, subpath?: string): string;
  /** Read a link target's current editor state, including unsaved edits. Empty target means this editor. */
  linkDocument?(target: string, view: EditorView): Promise<LinkDocument | null>;
  /** Insert an ID only while the suggested document is unchanged; saves through its editor. */
  insertBlockId?(target: LinkDocument, change: ChangeSpec, view: EditorView): boolean;
  /** Show the editor menu at `at` for document position `pos` (the caret is already there), or an image's menu. */
  contextMenu?(view: EditorView, at: { x: number; y: number }, pos: number, keyboard: boolean, image?: ImageRef): void;
  /** Whether a link target (from the note in `view`) points at a file: links to missing notes are drawn faded. */
  linkExists?(target: string, view: EditorView): boolean;
  /** What the Properties block knows of the vault's properties (null until the app has the index). */
  properties?(): PropertyHost | null;
  /** Open or create the daily note for an ISO date (`YYYY-MM-DD`). Empty and invalid dates do nothing. */
  openDaily?(isoDate: string): void;
  /** The files `![[embeds]]` show. */
  embeds?: EmbedHost;
  /**
   * Save clipboard images or dropped files into the vault and insert one embed per file.
   * `at` is a drop position; a paste uses the selection. `keepNames` retains a dropped file's name, including "image.png".
   * True when the event is consumed.
   */
  saveAttachments?(view: EditorView, files: File[], at?: number | null, keepNames?: boolean): Promise<boolean>;
}

/** An image right-clicked in a note: its file and element, where its embed is, and its alt text or alias (from the embed's start). */
export interface ImageRef {
  path: string;
  img: HTMLImageElement;
  from: number;
  to: number;
  sizeAt: number;
  sizeText: string | null;
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
  /** Tick or untick the task on line `line` (from 0) of a note, through its editor (so it is saved as usual). */
  toggleTask(path: string, line: number): void;
  /** Call `fn` when the file changes (on disk, or saved from an editor); returns a function that stops. */
  watch(path: string, fn: () => void): () => void;
  /** Draw a base into `parent` (bases/embed.ts); `update` gives a ```base block its new text. */
  base?(parent: HTMLElement, embed: BaseEmbed, view: EditorView): { update(embed: BaseEmbed): void; destroy(): void };
}

/** A base drawn in a note: a ```base block's YAML, or a .base file's view (![[X.base#View]]). */
export interface BaseEmbed {
  /** A ```base block's YAML; absent for a .base file. */
  yaml?: string;
  /** The .base file. */
  path?: string;
  /** The view to show first, by name. */
  view?: string;
  /** The note `this` is: the one the base is drawn in. */
  host: string | null;
  /** Put a block's new YAML in the note; false when it can't be (drawn inside another embed). */
  write?(yaml: string): boolean;
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
