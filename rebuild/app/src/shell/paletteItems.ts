// What the command palette lists for a query. Free of the DOM so it can be
// tested and timed on its own.

import { fuzzyRank } from "./fuzzy";

export interface PaletteCommand {
  id: string;
  name: string;
}

interface PaletteItem<C extends PaletteCommand = PaletteCommand> {
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
  return fuzzyRank(query, cmds, (c) => c.name)
    .sort((a, b) => b.score - a.score || recency(a.item) - recency(b.item) || byName(a.item, b.item))
    .map(({ item, indices }) => ({ cmd: item, indices }));
}

/** Check only enough ranked commands to fill the prompt; cache for this opening.
 * Choosing still rechecks availability after focus returns to the editor. */
export function paletteSource<C extends PaletteCommand>(cmds: C[], recent: string[], available: (cmd: C) => boolean) {
  const checked = new Map<C, boolean>();
  return (query: string) => {
    const items: PaletteItem<C>[] = [];
    for (const item of paletteItems(query, cmds, recent)) {
      if (!checked.has(item.cmd)) checked.set(item.cmd, available(item.cmd));
      if (checked.get(item.cmd)) items.push(item);
      if (items.length === 50) break;
    }
    return items;
  };
}
