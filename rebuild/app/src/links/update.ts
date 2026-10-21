// "Automatically update internal links": after a note or folder is renamed
// or moved, the links pointing at it are rewritten in every note that has
// them. With the setting off, Grove asks first, as Obsidian does.

import { api } from "../api";
import type { NoteRef } from "../editor/host";
import { isUnder, movedPath } from "../paths";
import type { Workspace } from "../workspace";
import { type LinkStyle, rewriteLinks } from "./internal";

const SEARCH_LIMIT = 500;

/**
 * Rewrite links after `from` moved to `to`. `before` is the vault's notes as
 * they were. `ask` gets the number of links and notes and decides (it is
 * skipped when nothing links there). Returns the number of links changed.
 */
export async function updateLinks(
  ws: Workspace,
  from: string,
  to: string,
  before: NoteRef[],
  style: LinkStyle,
  ask: ((links: number, notes: number) => Promise<boolean>) | null,
): Promise<number> {
  const swap = (p: string) => movedPath(p, from, to);
  const pairs = before.filter((n) => isUnder(n.path, from)).map((n) => ({ old: n.path, now: swap(n.path), name: n.name }));
  if (!pairs.length) return 0;

  // Which notes may link there: the link index's backlinks (wikilinks; read
  // now, before it refreshes) and a search for the names (markdown links).
  const sources = new Set<string>();
  for (const p of pairs) for (const b of ws.links.backlinks[p.old] ?? []) sources.add(b.from);
  for (const p of pairs.slice(0, 20)) {
    for (const q of new Set([p.name, p.name.replace(/ /g, "%20")])) {
      const hits = await api.search(q, SEARCH_LIMIT).catch(() => []);
      // Search already sees the new paths: map them back to where they were.
      for (const h of hits) if (h.line > 0) sources.add(movedPath(h.path, to, from));
    }
  }

  const after = ws.notes;
  const edits: { path: string; text: string }[] = [];
  let links = 0;
  for (const src of sources) {
    const now = swap(src);
    let text: string;
    try {
      text = await ws.text(now);
    } catch {
      continue;
    }
    let count = 0;
    for (const p of pairs) {
      const r = rewriteLinks(text, src, p.old, p.now, before, after, style, now);
      text = r.text;
      count += r.count;
    }
    if (count) {
      edits.push({ path: now, text });
      links += count;
    }
  }
  if (!links || (ask && !(await ask(links, edits.length)))) return 0;
  for (const e of edits) await ws.updateText(e.path, e.text).catch((err) => console.warn(`Could not update links in ${e.path}`, err));
  return links;
}
