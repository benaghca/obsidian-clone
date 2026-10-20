// What the command palette lists for a query. Free of the DOM so it can be
// tested and timed on its own.

import { fuzzyMatch } from "./fuzzy";

export interface PaletteCommand {
  id: string;
  name: string;
}

export interface PaletteItem<C extends PaletteCommand = PaletteCommand> {
  cmd: C;
  /** Matched characters in the name, for bolding. */
  indices: number[];
}

// A plain comparison: command names are short English strings, and
// localeCompare's first call builds a collator, which would cost the first
// palette opening a frame.
const byName = (a: PaletteCommand, b: PaletteCommand) => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Empty query: recently used commands (most recent first), then the rest
 * alphabetically, like Obsidian. Otherwise fuzzy matches, best first; equal
 * scores go to the more recently used, then alphabetical.
 */
export function paletteItems<C extends PaletteCommand>(query: string, cmds: C[], recent: string[]): PaletteItem<C>[] {
  const rank = new Map(recent.map((id, i) => [id, i]));
  const recency = (c: C) => rank.get(c.id) ?? Infinity;
  if (!query.trim()) {
    const used = cmds.filter((c) => rank.has(c.id)).sort((a, b) => recency(a) - recency(b));
    const rest = cmds.filter((c) => !rank.has(c.id)).sort(byName);
    return [...used, ...rest].map((cmd) => ({ cmd, indices: [] }));
  }
  const scored: (PaletteItem<C> & { score: number })[] = [];
  for (const cmd of cmds) {
    const m = fuzzyMatch(query, cmd.name);
    if (m) scored.push({ cmd, indices: m.indices, score: m.score });
  }
  scored.sort((a, b) => b.score - a.score || recency(a.cmd) - recency(b.cmd) || byName(a.cmd, b.cmd));
  return scored;
}
