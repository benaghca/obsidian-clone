// The tab model: what a tab shows (a note, the graph, or a local graph), its
// own back/forward history and where it left its note, and how a tab follows
// files that move or go. Pure data and helpers; the workspace (workspace.ts)
// decides which tabs change and draws nothing.

import type { EditorSelection } from "@codemirror/state";
import type { ViewMode } from "./editor/editor";
import type { TabGroup } from "./layout";
import { fileName, noteName } from "./paths";

export interface Tab {
  id: number;
  path: string | null;
  back: string[];
  forward: string[];
  /** Live Preview, Source mode or Reading view, per tab like Obsidian's. */
  mode: ViewMode;
  /** A pinned tab keeps its note: links followed from it open in a new tab. */
  pinned: boolean;
  /** Backlinks shown under the note (Obsidian's "Backlinks in document"). */
  backlinks: boolean;
  /** Where this tab left its note (scroll, selection), restored when it shows that note again. */
  memory: TabMemory | null;
  /** A view instead of a note: the graph, the local graph of `viewFile`, or the image `viewFile` (path is null then). */
  type?: ViewType;
  /** The note a local graph shows (it follows the note open in the active pane), or the image an image tab shows. */
  viewFile?: string | null;
  /** "Link with tab...": tabs with the same link show the same note. */
  link?: number;
}

/** The views a tab can show instead of a note. */
export type ViewType = "graph" | "localgraph" | "image" | "canvas";

interface TabMemory {
  path: string;
  /** null: no position to restore (a split places its pane by a line instead). */
  scrollTop: number | null;
  selection: EditorSelection | null;
}

export type Group = TabGroup<Tab>;

/** The tab's memory of `path`, if that is the note it remembers. */
export const memoryOf = (tab: Tab, path: string | null) => (tab.memory?.path === path ? tab.memory : null);

/**
 * Back/forward history entries are note paths, or one of these for a view
 * ("\0graph", "\0localgraph\0Note.md", "\0image\0pic.png"); no path starts with a NUL.
 */
export function viewEntry(tab: { type?: ViewType; viewFile?: string | null }): string {
  return tab.type === "graph" ? "\0graph" : `\0${tab.type}\0${tab.viewFile ?? ""}`;
}

export function parseViewEntry(entry: string): { type: ViewType; file: string | null } | null {
  if (!entry.startsWith("\0")) return null;
  const [, type, file] = entry.split("\0");
  return { type: type as ViewType, file: file || null };
}

/** The tab is about to show something else: what it shows now (if anything) goes on its back history. */
export function pushBack(tab: Tab) {
  const entry = tab.type ? viewEntry(tab) : tab.path;
  if (!entry) return;
  tab.back.push(entry);
  tab.forward = [];
}

let links = 0;

/** The other tabs linked with `tab`. */
export const linkedWith = (tab: Tab, all: readonly Tab[]) => (tab.link ? all.filter((t) => t !== tab && t.link === tab.link) : []);

/** "Link with tab...": `tab` joins `to`, and the tabs `to` is linked with already. */
export function linkTabs(tab: Tab, to: Tab, all: readonly Tab[]) {
  unlinkTab(tab, all);
  to.link ??= ++links;
  tab.link = to.link;
}

/** "Unlink tab": and a link left with one tab goes. */
export function unlinkTab(tab: Tab, all: readonly Tab[]) {
  const rest = linkedWith(tab, all);
  tab.link = undefined;
  if (rest.length === 1) rest[0].link = undefined;
}

/** The tabs linked with `tab` that don't show the note it shows (views stay as they are). */
export const behindLink = (tab: Tab, all: readonly Tab[]) => (tab.path ? linkedWith(tab, all).filter((t) => !t.type && t.path !== tab.path) : []);

/** A file or folder moved (`swap` maps old paths to new): the tab's note, view, history and memory follow. */
export function tabFollowsMove(tab: Tab, swap: (path: string) => string) {
  const swapEntry = (e: string) => {
    const view = parseViewEntry(e);
    return !view ? swap(e) : view.file ? viewEntry({ type: view.type, viewFile: swap(view.file) }) : e;
  };
  if (tab.path) tab.path = swap(tab.path);
  if (tab.viewFile) tab.viewFile = swap(tab.viewFile);
  tab.back = tab.back.map(swapEntry);
  tab.forward = tab.forward.map(swapEntry);
  if (tab.memory) tab.memory.path = swap(tab.memory.path);
}

/** Files were deleted (`under` picks them): a tab showing one goes empty, and they leave its history. */
export function tabForgets(tab: Tab, under: (path: string) => boolean) {
  tab.back = tab.back.filter((p) => !under(p));
  tab.forward = tab.forward.filter((p) => !under(p));
  if (tab.path && under(tab.path)) tab.path = null;
  if (tab.viewFile && under(tab.viewFile)) tab.viewFile = null;
}

/** The icon a view's tab shows (a note's tab has none). */
export const viewIcon = (tab: Tab) => (tab.type === "canvas" ? "layout-dashboard" : tab.type === "image" ? "image" : tab.type ? "git-fork" : null);

/** A tab's title: its note's name, the view's name, or "New tab". */
export function tabTitle(tab: Tab): string {
  if (tab.type === "graph") return "Graph view";
  if (tab.type === "localgraph") return tab.viewFile ? `Graph of ${noteName(tab.viewFile)}` : "Local graph";
  if (tab.type === "image" || tab.type === "canvas") return fileName(tab.viewFile ?? "").replace(/\.[^.]+$/, "");
  return tab.path ? noteName(tab.path) : "New tab";
}

/**
 * Where to open a note, like Obsidian's: in the tab (false), a new tab, or a
 * new tab group to the right of (or below) the pane.
 */
export type OpenWhere = false | "tab" | "right" | "down";

/** Ctrl/Cmd+Alt+click opens to the right, Ctrl/Cmd+click in a new tab, as in Obsidian. */
export function whereFromEvent(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): Exclude<OpenWhere, "down"> {
  const mod = e.ctrlKey || e.metaKey;
  return mod && e.altKey ? "right" : mod ? "tab" : false;
}
