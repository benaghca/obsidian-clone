// The tab model: what a tab shows (a note, the graph, or a local graph), its
// own back/forward history and where it left its note. Pure data and
// helpers; the workspace (workspace.ts) changes tabs and draws nothing.

import type { EditorSelection } from "@codemirror/state";
import type { ViewMode } from "./editor/editor";
import type { TabGroup } from "./layout";
import { noteName } from "./paths";

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
  /** A view instead of a note: the graph, or the local graph of `graphFile` (path is null then). */
  type?: ViewType;
  /** The note a local graph shows (it follows the note open in the active pane). */
  graphFile?: string | null;
}

/** The views a tab can show instead of a note. */
export type ViewType = "graph" | "localgraph";

export interface TabMemory {
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
 * ("\0graph", "\0localgraph\0Note.md"); no path starts with a NUL.
 */
export function viewEntry(tab: { type?: ViewType; graphFile?: string | null }): string {
  return tab.type === "localgraph" ? `\0localgraph\0${tab.graphFile ?? ""}` : "\0graph";
}

export function parseViewEntry(entry: string): { type: ViewType; file: string | null } | null {
  if (!entry.startsWith("\0")) return null;
  if (entry.startsWith("\0localgraph\0")) return { type: "localgraph", file: entry.slice(12) || null };
  return { type: "graph", file: null };
}

/** A tab's title: its note's name, the view's name, or "New tab". */
export function tabTitle(tab: Tab): string {
  if (tab.type === "graph") return "Graph view";
  if (tab.type === "localgraph") return tab.graphFile ? `Graph of ${noteName(tab.graphFile)}` : "Local graph";
  return tab.path ? noteName(tab.path) : "New tab";
}

/**
 * Where to open a note, like Obsidian's: in the tab (false), a new tab, or a
 * new tab group to the right of (or below) the pane.
 */
export type OpenWhere = false | "tab" | "right" | "down";

/** Ctrl/Cmd+Alt+click opens to the right, Ctrl/Cmd+click in a new tab, as in Obsidian. */
export function whereFromEvent(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): OpenWhere {
  const mod = e.ctrlKey || e.metaKey;
  return mod && e.altKey ? "right" : mod ? "tab" : false;
}
