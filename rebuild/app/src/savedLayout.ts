// The layout as saved per vault: the split tree (layout.ts) with each tab
// reduced to what brings it back (its note or view, mode, pin, history and
// place in the note). Reading checks every field, and drops tabs and history
// entries whose notes are gone.

import { EditorSelection } from "@codemirror/state";
import type { ViewMode } from "./editor/editor";
import type { LayoutJSON } from "./layout";
import { mediaKind } from "./media";
import { memoryOf, parseViewEntry, type Tab, type ViewType } from "./tabs";

export interface SavedTab {
  path: string | null;
  type?: ViewType;
  file?: string | null;
  mode: ViewMode;
  pinned: boolean;
  backlinks?: boolean;
  back: string[];
  forward: string[];
  scroll?: number;
  sel?: [number, number];
}

export interface SavedWorkspace {
  v: 1;
  root: LayoutJSON<SavedTab>;
  active: number;
}

/** A tab as saved (its memory should be up to date: see NoteEditors.remember). */
export function saveTab(tab: Tab): SavedTab {
  const saved: SavedTab = { path: tab.path, mode: tab.mode, pinned: tab.pinned, back: tab.back.slice(-20), forward: tab.forward.slice(-20) };
  if (tab.backlinks) saved.backlinks = true;
  if (tab.type) {
    saved.type = tab.type;
    if (tab.type !== "graph") saved.file = tab.viewFile ?? null;
  }
  const memory = memoryOf(tab, tab.path);
  if (memory) {
    if (memory.scrollTop !== null) saved.scroll = Math.round(memory.scrollTop);
    if (memory.selection) saved.sel = [memory.selection.main.anchor, memory.selection.main.head];
  }
  return saved;
}

/** A saved tab, filled into a new `blank` one; null when its note no longer exists. */
export function loadTab(saved: SavedTab, blank: () => Tab, isNote: (path: unknown) => path is string): Tab | null {
  if (!saved || typeof saved !== "object") return null;
  const keptHistory = (entry: unknown): string | null => {
    if (isNote(entry)) return entry;
    if (typeof entry !== "string") return null;
    if (parseViewEntry(entry)) return entry;
    // An older layout stored a recording or PDF as a raw path in the history stacks.
    const kind = mediaKind(entry);
    return kind ? `\0${kind}\0${entry}` : null;
  };
  const history = (entries: unknown): string[] => Array.isArray(entries)
    ? entries.flatMap((entry) => {
      const kept = keptHistory(entry);
      return kept ? [kept] : [];
    })
    : [];
  const named = saved.type === "graph" || saved.type === "localgraph" || saved.type === "image" || saved.type === "canvas" || saved.type === "base" || saved.type === "backlinks" || saved.type === "drawing" || saved.type === "audio" || saved.type === "video" || saved.type === "pdf" ? saved.type : undefined;
  // An older layout stored a recording or PDF as a note path. Open it as that file.
  const type = named ?? (!saved.type && typeof saved.path === "string" ? mediaKind(saved.path) ?? undefined : undefined);
  const path = type || saved.path === null ? null : isNote(saved.path) ? saved.path : undefined;
  if (path === undefined) return null; // its note is gone
  const tab = blank();
  tab.path = path;
  if (type) {
    tab.type = type;
    if (type === "localgraph" || type === "backlinks") tab.viewFile = isNote(saved.file) ? saved.file : null;
    if (type === "image" || type === "canvas" || type === "base" || type === "drawing" || type === "audio" || type === "video" || type === "pdf") {
      tab.viewFile = typeof saved.file === "string" ? saved.file : !saved.type && typeof saved.path === "string" ? saved.path : null;
    }
  }
  tab.mode = saved.mode === "source" || saved.mode === "reading" ? saved.mode : "live";
  tab.pinned = saved.pinned === true;
  tab.backlinks = saved.backlinks === true;
  tab.back = history(saved.back);
  tab.forward = history(saved.forward);
  if (path && typeof saved.scroll === "number") {
    const sel = Array.isArray(saved.sel) ? EditorSelection.single(Number(saved.sel[0]) || 0, Number(saved.sel[1]) || 0) : null;
    tab.memory = { path, scrollTop: saved.scroll, selection: sel };
  }
  return tab;
}
