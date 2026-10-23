// What the quick switcher lists for a query. Kept free of the DOM so it can
// be tested on its own.

import type { NoteRef } from "../editor/host";
import { fuzzyRank, isStrongMatch } from "./fuzzy";

export interface SwitcherItem {
  /** null for the "create a note with this name" row. */
  path: string | null;
  name: string;
  indices: number[];
}

const MAX_RESULTS = 50;

/** Take recents once in their given order, leaving the other candidates in the map. */
export function recentNotes(notes: Map<string, NoteRef>, recent: string[]): NoteRef[] {
  return recent.flatMap(path => {
    const note = notes.get(path);
    notes.delete(path);
    return note ? [note] : [];
  });
}

/**
 * Empty query: only recent notes, never the open note. Otherwise
 * fuzzy matches, best first. Like Obsidian, a row offering to create the
 * note appears only when nothing matches well (Shift+Enter creates anyway).
 */
export function switcherItems(query: string, notes: NoteRef[], recent: string[], activePath: string | null): SwitcherItem[] {
  const q = query.trim();
  if (!q) {
    const byPath = new Map(notes.filter(n => n.path !== activePath).map(n => [n.path, n]));
    return recentNotes(byPath, recent).slice(0, MAX_RESULTS).map(n => ({ path: n.path, name: n.name, indices: [] }));
  }
  const scored = fuzzyRank(q, notes, (n) => n.name).map(({ item, indices }) => ({ path: item.path, name: item.name, indices }));
  const out: SwitcherItem[] = scored.slice(0, MAX_RESULTS);
  const good = scored.some((r) => isStrongMatch(r.name, r.indices));
  const exact = scored.some((r) => r.name.toLowerCase() === q.toLowerCase());
  if (!good && !exact) out.push({ path: null, name: q, indices: [] });
  return out;
}
