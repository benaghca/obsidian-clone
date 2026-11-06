// "Automatically update internal links": after a file or folder is renamed
// or moved, the links pointing at it are rewritten in every note that has
// them. That covers embeds of any file, such as ![[Sketch.excalidraw]] or
// ![[photo.png]], not only notes. With the setting off, Grove asks first, as
// Obsidian does.

import type { NoteRef } from "../editor/host";
import { updateNoteText } from "../fileOps";
import { isNoteFile, isUnder, movedPath, noteName } from "../paths";
import type { Workspace } from "../workspace";
import { type LinkStyle, rewriteLinks } from "./internal";

/**
 * Rewrite links after `from` moved to `to`. `before` is the vault's files as
 * they were (`Vault.fileRefs`; a list of only notes works for a note). `sources`
 * is every note that might link there, fetched with `link_sources` before the
 * backend rename. `ask` gets the number of links and notes and decides (it is
 * skipped when nothing links there). Returns the number of links changed.
 *
 * A link to a note resolves among the notes, as before. A link to another
 * file resolves among every file, by its whole name ("Sketch.excalidraw").
 */
export async function updateLinks(
  ws: Workspace,
  from: string,
  to: string,
  before: NoteRef[],
  sources: readonly string[],
  style: LinkStyle,
  ask: ((links: number, notes: number) => Promise<boolean>) | null,
): Promise<number> {
  const swap = (p: string) => movedPath(p, from, to);
  const pairs = before.filter((n) => isUnder(n.path, from)).map((n) => ({ old: n.path, now: swap(n.path), note: isNoteFile(n.path) }));
  if (!pairs.length) return 0;

  const after = ws.vault.notes;
  const notesBefore = before.filter((n) => isNoteFile(n.path));
  // Other files resolve among every file. After the move they are the same files, moved.
  const files = pairs.some((p) => !p.note)
    ? { before, after: before.map((n) => (isUnder(n.path, from) ? { name: noteName(swap(n.path)), path: swap(n.path) } : n)) }
    : null;
  const edits: { path: string; text: string }[] = [];
  let links = 0;
  const seen = new Set<string>();
  for (const src of sources) {
    if (seen.has(src)) continue;
    seen.add(src);
    // Sources were collected before the rename, so a note that moved with
    // the folder is still named by its old path here.
    const now = swap(src);
    let text: string;
    try {
      text = await ws.editors.text(now);
    } catch {
      continue;
    }
    let count = 0;
    for (const p of pairs) {
      const r = p.note ? rewriteLinks(text, src, p.old, p.now, notesBefore, after, style, now) : rewriteLinks(text, src, p.old, p.now, files!.before, files!.after, style, now);
      text = r.text;
      count += r.count;
    }
    if (count) {
      edits.push({ path: now, text });
      links += count;
    }
  }
  if (!links || (ask && !(await ask(links, edits.length)))) return 0;
  for (const e of edits) await updateNoteText(ws, e.path, e.text).catch((err) => console.warn(`Could not update links in ${e.path}`, err));
  return links;
}
