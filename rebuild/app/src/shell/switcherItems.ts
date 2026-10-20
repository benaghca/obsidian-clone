// What the quick switcher lists for a query. Kept free of the DOM so it can
// be tested on its own.

import type { NoteRef } from "../editor/host";
import { fuzzyMatch, isStrongMatch } from "./fuzzy";

export interface SwitcherItem {
  /** null for the "create a note with this name" row. */
  path: string | null;
  name: string;
  indices: number[];
}

const MAX_RESULTS = 50;

/**
 * Empty query: recent notes, then the rest, never the open note. Otherwise
 * fuzzy matches, best first. Like Obsidian, a row offering to create the
 * note appears only when nothing matches well (Shift+Enter creates anyway).
 */
export function switcherItems(query: string, notes: NoteRef[], recent: string[], activePath: string | null): SwitcherItem[] {
  const q = query.trim();
  if (!q) {
    const byPath = new Map(notes.map((n) => [n.path, n]));
    const seen = new Set<string>();
    const out: SwitcherItem[] = [];
    for (const path of [...recent, ...byPath.keys()]) {
      const note = byPath.get(path);
      if (!note || path === activePath || seen.has(path)) continue;
      seen.add(path);
      out.push({ path, name: note.name, indices: [] });
      if (out.length === MAX_RESULTS) break;
    }
    return out;
  }
  const scored: (SwitcherItem & { score: number })[] = [];
  for (const note of notes) {
    const m = fuzzyMatch(q, note.name);
    if (m) scored.push({ path: note.path, name: note.name, indices: m.indices, score: m.score });
  }
  scored.sort((a, b) => b.score - a.score);
  const out: SwitcherItem[] = scored.slice(0, MAX_RESULTS);
  const good = scored.some((r) => isStrongMatch(r.name, r.indices));
  const exact = scored.some((r) => r.name.toLowerCase() === q.toLowerCase());
  if (!good && !exact) out.push({ path: null, name: q, indices: [] });
  return out;
}
