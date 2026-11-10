// "Automatically update internal links": after a file or folder is renamed
// or moved, the links pointing at it are rewritten in every note that has
// them. That covers embeds of any file, such as ![[Sketch.excalidraw]] or
// ![[photo.png]], not only notes. With the setting off, Grove asks first, as
// Obsidian does.

import type { NoteRef } from "../editor/host";
import { isMoving, movesSettled, updateNoteText } from "../fileOps";
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
 *
 * The work yields to the page, so a note can be typed in, saved, or moved
 * again before its turn comes. Each note is checked just before it is
 * written: if its text changed since it was read, the links are rewritten in
 * the text as it is now. A later rename or move carries this update's paths,
 * targets and snapshots along with it, and no read or write is sent while one runs.
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
  const pairs = before.filter((n) => isUnder(n.path, from)).map((n, order) => ({ old: n.path, now: swap(n.path), note: isNoteFile(n.path), order }));
  if (!pairs.length) return 0;

  // One pass per linking note. Notes resolve among the notes, as before;
  // other files among every file, which after the move are the same files, moved.
  // Each move keeps its place in `before`: a link that both groups resolve takes the earlier move, as before.
  const notesBefore = before.filter((n) => isNoteFile(n.path));
  let notesAfter: NoteRef[] = ws.vault.notes;
  let filesAfter = pairs.some((p) => !p.note) ? before.map((n) => (isUnder(n.path, from) ? { name: noteName(swap(n.path)), path: swap(n.path) } : n)) : [];
  const build = () => {
    const moved = (note: boolean) => new Map(pairs.filter((p) => p.note === note).map((p) => [p.old, { to: p.now, order: p.order }]));
    const out: LinkMoves[] = [];
    if (pairs.some((p) => p.note)) out.push({ moved: moved(true), before: notesBefore, after: notesAfter });
    if (pairs.some((p) => !p.note)) out.push({ moved: moved(false), before, after: filesAfter });
    return out;
  };
  let moves = build();
  // Sources were collected before the rename, so a note that moved with the
  // folder is still named by its old path: links resolve from `src`, and
  // `path` is where the note is now.
  const notes: Source[] = [...new Set(sources)].map((src) => ({ src, path: swap(src), read: null, seen: 0, result: null, generation: 0 }));

  // Moves after this one, and changes to notes on disk (saves, outside edits).
  let generation = 0;
  let changes = 0;
  const changed = new Map<string, number>();
  const stopMoves = ws.onMove((later) => {
    generation++;
    const follow = (n: NoteRef) => {
      const path = later(n.path);
      return path === n.path ? n : { name: noteName(path), path };
    };
    for (const p of pairs) p.now = later(p.now);
    notesAfter = notesAfter.map(follow);
    filesAfter = filesAfter.map(follow);
    moves = build();
    for (const n of notes) n.path = later(n.path);
    const was = [...changed];
    changed.clear();
    for (const [path, at] of was) changed.set(later(path), at);
  });
  const stopChanges = ws.vault.onModified((path) => changed.set(path, ++changes));
  const rewrite = (n: Source, text: string) => {
    n.read = text;
    n.generation = generation;
    return (n.result = rewriteLinks(text, n.src, moves, style, n.path));
  };

  /** The note's text: its editor's if it is loaded, else from disk. Null if it can't be read. */
  const read = async (n: Source): Promise<string | null> => {
    for (;;) {
      while (isMoving()) await movesSettled();
      const at = generation;
      n.seen = changes;
      const live = ws.editors.doc(n.path);
      if (live) return live.toString();
      try {
        const text = await ws.editors.text(n.path);
        return ws.editors.doc(n.path)?.toString() ?? text;
      } catch {
        if (at === generation) return null; // not moved meanwhile: it can't be read
      }
    }
  };

  /** Write the note's rewritten links into its text as it is now. Returns the links changed. */
  const write = async (n: Source): Promise<number> => {
    for (;;) {
      while (isMoving()) await movesSettled();
      const at = generation;
      const stale = () => (changed.get(n.path) ?? 0) > n.seen;
      let text = ws.editors.doc(n.path)?.toString();
      if (text === undefined && stale()) {
        const now = await read(n);
        if (now === null) return 0;
        // A move, or another change while it was being read (that reply may predate it): read again.
        if (at !== generation || isMoving() || stale()) {
          rewrite(n, now);
          continue;
        }
        text = ws.editors.doc(n.path)?.toString() ?? now;
      }
      text ??= n.read!;
      // From here to the write nothing waits, so neither the editor nor the
      // change marks can move on in between.
      const r = text === n.read && n.generation === generation ? n.result! : rewrite(n, text);
      if (!r.count) return 0;
      try {
        await updateNoteText(ws, n.path, r.text);
        return r.count;
      } catch (err) {
        console.warn(`Could not update links in ${n.path}`, err);
        return 0;
      }
    }
  };

  try {
    const edits: Source[] = [];
    let links = 0;
    let slice = performance.now();
    // Reads run off the main thread, so a few go at once; a note that can't be read is skipped.
    for (let i = 0; i < notes.length; i += READ_BATCH) {
      const batch = notes.slice(i, i + READ_BATCH);
      const texts = await Promise.all(batch.map(read));
      for (let k = 0; k < batch.length; k++) {
        const text = texts[k];
        if (text === null) continue;
        const r = rewrite(batch[k], text);
        if (r.count) {
          edits.push(batch[k]);
          links += r.count;
        }
        slice = await breathe(slice);
      }
    }
    if (!links || (ask && !(await ask(links, edits.length)))) return 0;
    // One write at a time: write_note runs on the window's main thread, and the
    // window paints between them.
    let written = 0;
    for (const n of edits) {
      written += await write(n);
      slice = await breathe(slice);
    }
    return written;
  } finally {
    stopMoves();
    stopChanges();
  }
}

interface Source {
  /** The note's path when the links were collected, which they resolve from. */
  src: string;
  /** Where the note is now. */
  path: string;
  /** The text the links were last rewritten in, and the result. */
  read: string | null;
  result: { text: string; count: number } | null;
  /** The change count when it was read, and the move generation it was rewritten for. */
  seen: number;
  generation: number;
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
