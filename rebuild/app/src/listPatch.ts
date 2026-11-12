// A create, rename, or delete already knows its own change. These build the
// next file list from that change so the page does not re-read every path.
// The backend's list is path-sorted. A new array is what drops the link-target
// cache. A missing parent folder is not invented: the reply names only the
// file, and a full read still has to bring the folders it created.

import type { FileEntry } from "./api";
import { fileName, isNoteFile, noteName, parentDir } from "./paths";

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
    if (files[mid].path < entry.path) lo = mid + 1;
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
  const sorted = mapped.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
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
    tokens.add(path.toLowerCase());
    tokens.add(fileName(path).toLowerCase());
    if (isNoteFile(path)) tokens.add(path.slice(0, -3).toLowerCase());
    const slash = path.lastIndexOf("/");
    if (slash > 0) tokens.add(path.slice(0, slash).toLowerCase());
  };
  for (const path of before) if (!after.has(path)) add(path);
  for (const path of after) if (!before.has(path)) add(path);
  if (!tokens.size) return [];
  if (tokens.size > WIDE || [...tokens].some((token) => token.length < 3)) return null;
  return [...tokens];
}

/** Whether an open note can draw a link differently after this file-list change. */
export function docNeedsFileRefresh(text: string, tokens: readonly string[] | null): boolean {
  if (!tokens || tokens.some((token) => token.length < 3)) return true;
  if (!tokens.length) return false;
  const hay = text.toLowerCase();
  return tokens.some((token) => hay.includes(token));
}
