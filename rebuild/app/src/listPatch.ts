// A create, rename, or delete already knows its own change. These build the
// next file list from that change so the page does not re-read every path.
// The backend's list is path-sorted. A new array is what drops the link-target
// cache. A missing parent folder is not invented: the reply names only the
// file, and a full read still has to bring the folders it created.

import type { FileEntry } from "./api";
import { linkSpellings, markdownURL } from "./links/internal";
import { fileName, isNoteFile, noteName, parentDir } from "./paths";

/**
 * Path order of the backend's file map: Unicode scalar values, which is the
 * byte order of well-formed UTF-8. JavaScript `<` compares UTF-16 code units
 * and sorts emoji before fullwidth letters.
 */
export function pathCmp(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(j)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  if (i === a.length && j === b.length) return 0;
  return i === a.length ? -1 : 1;
}

function dirsOf(files: readonly FileEntry[]): Set<string> {
  const dirs = new Set<string>();
  for (const file of files) if (file.is_dir) dirs.add(file.path);
  return dirs;
}

function parentsPresent(dirs: Set<string>, path: string): boolean {
  let dir = parentDir(path);
  while (dir) {
    if (!dirs.has(dir)) return false;
    dir = parentDir(dir);
  }
  return true;
}

/** Insert `entry` in path order. The same array when that path is already listed. Null when a parent folder is not. */
export function addEntry(files: readonly FileEntry[], entry: FileEntry): FileEntry[] | null {
  if (files.some((file) => file.path === entry.path)) return files as FileEntry[];
  if (!parentsPresent(dirsOf(files), entry.path)) return null;
  let lo = 0;
  let hi = files.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pathCmp(files[mid].path, entry.path) < 0) lo = mid + 1;
    else hi = mid;
  }
  const next = files.slice();
  next.splice(lo, 0, entry);
  return next;
}

/** Move paths with `swap`. The same array when nothing moves. Null when two paths collide or a parent folder is not listed. */
export function mapEntries(files: readonly FileEntry[], swap: (path: string) => string): FileEntry[] | null {
  let changed = false;
  const mapped = files.map((file) => {
    const path = swap(file.path);
    if (path === file.path) return file;
    changed = true;
    return { ...file, path, name: file.is_dir ? fileName(path) : noteName(path) };
  });
  if (!changed) return files as FileEntry[];
  const sorted = mapped.slice().sort((a, b) => pathCmp(a.path, b.path));
  for (let i = 1; i < sorted.length; i++) if (sorted[i].path === sorted[i - 1].path) return null;
  const dirs = dirsOf(sorted);
  for (const file of sorted) if (!parentsPresent(dirs, file.path)) return null;
  return sorted;
}

/** Drop paths `under` matches. The same array when none do. */
export function dropEntries(files: readonly FileEntry[], under: (path: string) => boolean): FileEntry[] {
  const next = files.filter((file) => !under(file.path));
  return next.length === files.length ? (files as FileEntry[]) : next;
}

const WIDE = 48;

/**
 * Lowercased path pieces added or removed. Empty when the paths are the same.
 * Null when the previous list was empty, a name is too short to search for,
 * or too many paths changed to check note by note.
 */
export function listTokens(prev: readonly { path: string }[], next: readonly { path: string }[]): readonly string[] | null {
  if (!prev.length) return null;
  const before = new Set(prev.map((file) => file.path));
  const after = new Set(next.map((file) => file.path));
  const tokens = new Set<string>();
  const add = (path: string) => {
    const pieces = [path, fileName(path)];
    if (isNoteFile(path)) {
      pieces.push(path.slice(0, -3), noteName(path));
    }
    const slash = path.lastIndexOf("/");
    if (slash > 0) pieces.push(path.slice(0, slash));
    for (const piece of pieces) {
      for (const spelling of linkSpellings(piece)) tokens.add(spelling.toLowerCase());
      if (/%[0-9a-f]{2}/i.test(piece)) {
        try {
          const decoded = decodeURIComponent(piece);
          if (decoded !== piece) for (const spelling of linkSpellings(decoded)) tokens.add(spelling.toLowerCase());
        } catch {
          // The piece is not percent-encoded. The literal spelling stays.
        }
      }
    }
  };
  for (const path of before) if (!after.has(path)) add(path);
  for (const path of after) if (!before.has(path)) add(path);
  if (!tokens.size) return [];
  if (tokens.size > WIDE || [...tokens].some((token) => token.length < 3)) return null;
  return [...tokens];
}

/**
 * Markdown destinations are unescaped, then percent-decoded, before a link
 * resolves (`bareTarget`). A mixed encoding such as `%43af%C3%A9` is not one
 * spelling of `Café`, so the decoded text is compared too.
 */
function decodedHay(text: string): string {
  return markdownURL(text).replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  }).toLowerCase();
}

/**
 * Whether an open note can draw a link differently after this file-list change.
 * An embed (`![`) draws another document, so the host source is not enough to
 * prove its links are unchanged. `filesChanged` then rebuilds decorations and
 * rescans missing embeds.
 */
export function docNeedsFileRefresh(text: string, tokens: readonly string[] | null): boolean {
  if (!tokens || tokens.some((token) => token.length < 3)) return true;
  if (!tokens.length) return false;
  if (text.includes("![")) return true;
  const hay = text.toLowerCase();
  if (tokens.some((token) => hay.includes(token))) return true;
  if (!/%[0-9a-f]{2}/i.test(text)) return false;
  const decoded = decodedHay(text);
  return tokens.some((token) => decoded.includes(token));
}
