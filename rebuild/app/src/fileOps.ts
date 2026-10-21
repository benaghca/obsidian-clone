// Changing the vault's files: new notes and folders, rename, move, copy,
// merge and delete, and rewriting a note's text from outside its editors.
// Each goes to the backend first; then the editors and the open tabs follow
// (Workspace.followMove, Workspace.forget).

import { api, type FileEntry } from "./api";
import { fileName, isUnder, movedPath, noteName, parentDir } from "./paths";
import type { OpenWhere } from "./tabs";
import type { Workspace } from "./workspace";

export async function createNote(ws: Workspace, path: string, content = ""): Promise<FileEntry> {
  const entry = await api.createNote(path, content);
  await ws.refreshFiles();
  return entry;
}

/**
 * Create "Untitled.md" (or "Untitled 1.md", ...) in a folder (by default
 * where Settings → Files and links puts new notes) and open it for editing.
 */
export async function newNote(ws: Workspace, folder: string = ws.newNoteFolder(), where?: OpenWhere): Promise<string> {
  if (folder && !ws.isFolder(folder)) await api.createFolder(folder).catch(() => {});
  const entry = await createNote(ws, freeName(ws, folder, ".md"));
  await ws.open(entry.path, { where: where ?? (ws.active.path !== null || ws.active.type ? "tab" : false) });
  // A new note is for writing in, even when new tabs open in Reading view.
  if (ws.active.path === entry.path && ws.active.mode === "reading") ws.setMode(ws.editingMode());
  return entry.path;
}

/** Create an empty "Untitled" folder; returns its path. */
export async function newFolder(ws: Workspace, parent = ""): Promise<string> {
  const entry = await api.createFolder(freeName(ws, parent, ""));
  await ws.refreshFiles();
  return entry.path;
}

/** A free "Untitled" name in a folder: "Untitled", "Untitled 1", ... */
function freeName(ws: Workspace, folder: string, ext: string) {
  const taken = new Set(ws.files.map((f) => f.path.toLowerCase()));
  const at = (name: string) => `${folder ? folder + "/" : ""}${name}${ext}`;
  let name = "Untitled";
  for (let i = 1; taken.has(at(name).toLowerCase()); i++) name = `Untitled ${i}`;
  return at(name);
}

/** Rename a note (keeping its folder and .md) or a folder. */
export async function renameFile(ws: Workspace, path: string, newName: string) {
  newName = newName.trim().replace(/[\\/:]/g, "");
  const isDir = ws.isFolder(path);
  if (!newName || newName === (isDir ? fileName(path) : noteName(path))) return;
  const dir = parentDir(path);
  await relocate(ws, path, `${dir ? dir + "/" : ""}${newName}${isDir ? "" : ".md"}`);
}

/** Move a note or folder into another folder ("" for the vault root). */
export async function moveFile(ws: Workspace, path: string, folder: string) {
  const to = folder ? `${folder}/${fileName(path)}` : fileName(path);
  if (to !== path) await relocate(ws, path, to);
}

/** Move a file or folder; the loaded notes and everything open follow. */
async function relocate(ws: Workspace, from: string, to: string) {
  const clash = ws.files.find((f) => f.path.toLowerCase() === to.toLowerCase());
  if (clash && clash.path !== from) throw new Error(`"${to}" already exists`);
  const under = (p: string) => isUnder(p, from);
  await ws.editors.flush(under);
  const before = ws.notes;
  await api.renamePath(from, to);
  const swap = (p: string) => movedPath(p, from, to);
  ws.editors.move(under, swap);
  await ws.followMove(swap);
  ws.onRenamed?.(from, to, before);
}

/** Obsidian's "Make a copy": "Name 1.md" beside the note, opened in the active tab. */
export async function copyNote(ws: Workspace, path: string): Promise<string> {
  await ws.saveNow(path);
  const content = await ws.editors.text(path);
  const taken = new Set(ws.files.map((f) => f.path.toLowerCase()));
  const base = path.replace(/\.md$/, "");
  let n = 1;
  while (taken.has(`${base} ${n}.md`.toLowerCase())) n++;
  const entry = await createNote(ws, `${base} ${n}.md`, content);
  await ws.open(entry.path);
  return entry.path;
}

/**
 * Obsidian's "Merge entire file with...": append this note's text to
 * another note (after a blank line), then delete this one. The other note
 * opens where this one was.
 */
export async function mergeNote(ws: Workspace, path: string, into: string) {
  if (path === into) return;
  if (ws.confirmMerge && !(await ws.confirmMerge(path, into))) return;
  const [text, target] = await Promise.all([ws.editors.text(path), ws.editors.load(into)]);
  if (!target) return;
  const doc = ws.editors.doc(into) ?? target.doc;
  const sep = !doc.length ? "" : doc.sliceString(doc.length - 1) === "\n" ? "\n" : "\n\n";
  ws.editors.change(into, { changes: { from: doc.length, insert: sep + text } });
  await ws.saveNow(into);
  const showing = ws.layout.tabs().filter((t) => t.path === path);
  await deleteFile(ws, path, { confirmed: true });
  ws.reopen(showing, into);
}

/**
 * Delete a note or folder: to the vault's .trash, or for good, as Settings
 * → Files and links says, after asking if it says to ask. Returns whether
 * it was deleted.
 */
export async function deleteFile(ws: Workspace, path: string, opts: { confirmed?: boolean } = {}): Promise<boolean> {
  if (!opts.confirmed && ws.confirmDelete && !(await ws.confirmDelete(path))) return false;
  const under = (p: string) => isUnder(p, path);
  await ws.editors.flush(under);
  await api.deletePath(path, ws.permanentDelete());
  ws.editors.forget(under);
  await ws.forget(under);
  return true;
}

/**
 * Change a note's text from outside its editors (link updates after a
 * rename): only the lines that differ are replaced, through the editor if
 * the note is loaded (so it is undoable and saved as usual), else on disk.
 */
export async function updateNoteText(ws: Workspace, path: string, next: string) {
  const doc = ws.editors.doc(path);
  if (!doc) {
    await api.writeNote(path, next);
    ws.touch(path);
    return;
  }
  const lines = next.split("\n");
  if (lines.length !== doc.lines) {
    ws.editors.change(path, { changes: { from: 0, to: doc.length, insert: next } });
    return;
  }
  const changes: { from: number; to: number; insert: string }[] = [];
  lines.forEach((text, i) => {
    const line = doc.line(i + 1);
    if (line.text !== text) changes.push({ from: line.from, to: line.to, insert: text });
  });
  if (changes.length) ws.editors.change(path, { changes });
}
