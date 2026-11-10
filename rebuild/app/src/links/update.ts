// "Automatically update internal links": after a file or folder is renamed
// or moved, the links pointing at it are rewritten in every note that has
// them. That covers embeds of any file, such as ![[Sketch.excalidraw]] or
// ![[photo.png]], not only notes. With the setting off, Grove asks first, as
// Obsidian does.

import type { NoteRef } from "../editor/host";
import { updateNoteText } from "../fileOps";
import { isNoteFile, isUnder, movedPath, noteName } from "../paths";
import type { Workspace } from "../workspace";
import { type LinkMoves, type LinkStyle, rewriteLinks } from "./internal";

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

  // One pass per linking note. Notes resolve among the notes, as before;
  // other files among every file, which after the move are the same files, moved.
  const moved = (note: boolean) => new Map(pairs.filter((p) => p.note === note).map((p) => [p.old, p.now]));
  const moves: LinkMoves[] = [];
  if (pairs.some((p) => p.note)) moves.push({ moved: moved(true), before: before.filter((n) => isNoteFile(n.path)), after: ws.vault.notes });
  if (pairs.some((p) => !p.note)) moves.push({ moved: moved(false), before, after: before.map((n) => (isUnder(n.path, from) ? { name: noteName(swap(n.path)), path: swap(n.path) } : n)) });
  const edits: { path: string; text: string }[] = [];
  let links = 0;
  let slice = performance.now();
  const unique = [...new Set(sources)];
  // Sources were collected before the rename, so a note that moved with
  // the folder is still named by its old path here. Reads run off the main
  // thread, so a few go at once; a note that can't be read is skipped.
  for (let i = 0; i < unique.length; i += READ_BATCH) {
    const batch = unique.slice(i, i + READ_BATCH);
    const texts = await Promise.all(batch.map((src) => ws.editors.text(swap(src)).catch(() => null)));
    for (let k = 0; k < batch.length; k++) {
      const text = texts[k];
      if (text === null) continue;
      const now = swap(batch[k]);
      const r = rewriteLinks(text, batch[k], moves, style, now);
      if (r.count) {
        edits.push({ path: now, text: r.text });
        links += r.count;
      }
      slice = await breathe(slice);
    }
  }
  if (!links || (ask && !(await ask(links, edits.length)))) return 0;
  // One write at a time: write_note runs on the window's main thread, and the
  // window paints between them.
  for (const e of edits) {
    await updateNoteText(ws, e.path, e.text).catch((err) => console.warn(`Could not update links in ${e.path}`, err));
    slice = await breathe(slice);
  }
  return links;
}

/**
 * Let the page paint between notes. Reads of loaded notes (and the browser
 * mock's replies) settle without a task boundary, so a big folder move would
 * otherwise run as one long task. Returns when the next slice started.
 */
async function breathe(since: number): Promise<number> {
  if (performance.now() - since < SLICE_MS) return since;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return performance.now();
}
const SLICE_MS = 8;
const READ_BATCH = 16;
