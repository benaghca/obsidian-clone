// Changing the vault's files: new notes and folders, rename, move, copy,
// merge and delete, and rewriting a note's text from outside its editors.
// Each goes to the backend first; then the editors and the open tabs follow
// (Workspace.followMove, Workspace.forget).

import { api, type Backlink, type FileEntry } from "./api";
import type { ViewMode } from "./editor/editor";
import type { NoteRef } from "./editor/host";
import { fileName, isUnder, movedPath, parentDir } from "./paths";
import type { OpenWhere } from "./tabs";
import type { Workspace } from "./workspace";

/** What these ask of the settings (Settings → Editor, Files and links, Note composer); set by the app. */
export const fileSettings = {
  /** Where "Create new note" puts a note when no folder is given. */
  newNoteFolder: () => "",
  /** The editing mode new notes open in (Live Preview or Source mode). */
  editingMode: (): ViewMode => "live",
  /** Whether deleting removes for good instead of moving to the vault's .trash. */
  permanentDelete: () => false,
  /** Asked before a delete that wasn't confirmed already; false cancels it. */
  confirmDelete: (_path: string): Promise<boolean> => Promise.resolve(true),
  /** Asked before merging one note into another; false cancels. */
  confirmMerge: (_from: string, _into: string): Promise<boolean> => Promise.resolve(true),
  /** Told after a move, with the notes and backlink snapshot from before it (to update links). */
  renamed: (_from: string, _to: string, _before: NoteRef[], _backlinks: Record<string, Backlink[]>) => {},
};

export async function createNote(ws: Workspace, path: string, content = ""): Promise<FileEntry> {
  const entry = await api.createNote(path, content);
  await ws.vault.refreshFiles();
  // A copy or a daily note from a template can already contain links. Without
  // this, the link index waits for a later save and those backlinks never appear.
  ws.vault.written(entry.path);
  return entry;
}

/**
 * Create "Untitled.md" (or "Untitled 1.md", ...) in a folder (by default
 * where Settings → Files and links puts new notes) and open it for editing.
 */
export async function newNote(ws: Workspace, folder: string = fileSettings.newNoteFolder(), where?: OpenWhere): Promise<string> {
  if (folder && !ws.vault.isFolder(folder)) await api.createFolder(folder).catch(() => {});
  const entry = await createNote(ws, freeName(ws, `${folder ? `${folder}/` : ""}Untitled`, ".md"));
  await ws.open(entry.path, { where: where ?? (ws.active.path !== null || ws.active.type ? "tab" : false) });
  // A new note is for writing in, even when new tabs open in Reading view.
  if (ws.active.path === entry.path && ws.active.mode === "reading") ws.setMode(fileSettings.editingMode());
  return entry.path;
}

// Serialize creation so two stationary clicks cannot choose the same free name.
let creatingCanvas = Promise.resolve();
export function newCanvas(ws: Workspace, folder = fileSettings.newNoteFolder(), kind: "canvas" | "base" = "canvas"): Promise<string> {
  const next = creatingCanvas.then(async () => {
    if (folder && !ws.vault.isFolder(folder)) await api.createFolder(folder).catch(() => {});
    const entry = await createNote(ws, freeName(ws, `${folder ? `${folder}/` : ""}Untitled`, `.${kind}`), kind === "base" ? "views:\n  - type: table\n    name: View\n" : '{}');
    await ws.open(entry.path, { where: ws.active.path !== null || ws.active.type ? "tab" : false });
    return entry.path;
  });
  creatingCanvas = next.then(() => {}, () => {});
  return next;
}

/** Create an empty "Untitled" folder; returns its path. */
export async function newFolder(ws: Workspace, parent = ""): Promise<string> {
  const entry = await api.createFolder(freeName(ws, `${parent ? `${parent}/` : ""}Untitled`, ""));
  await ws.vault.refreshFiles();
  return entry.path;
}

/** A path no file has: `stem` and `ext`, else with " 1", " 2", ... after the stem (only those, if `numbered`). */
function freeName(ws: Workspace, stem: string, ext: string, numbered = false) {
  const taken = new Set(ws.vault.files.map((f) => f.path.toLowerCase()));
  for (let i = Number(numbered); ; i++) {
    const path = `${stem}${i ? ` ${i}` : ""}${ext}`;
    if (!taken.has(path.toLowerCase())) return path;
  }
}

/** Why a rename is refused, or "" when it can be committed. An empty draft is only an error on commit. */
export function renameError(ws: Workspace, path: string, newName: string, commit = false): string {
  const name = newName.trim();
  if (!name || name === "." || name === "..") return commit ? "Enter a file or folder name." : "";
  if (/[\\/:\x00-\x1f]/.test(name)) return "File name cannot contain any of these characters: \\ / :";
  const isDir = ws.vault.isFolder(path);
  const ext = isDir ? "" : /\.(canvas|base)$/i.test(path) ? path.slice(path.lastIndexOf(".")) : ".md";
  if (name === (isDir ? fileName(path) : fileName(path).slice(0, -ext.length))) return "";
  const dir = parentDir(path);
  const to = `${dir ? dir + "/" : ""}${name}${ext}`;
  const clash = ws.vault.files.find((f) => f.path.toLowerCase() === to.toLowerCase());
  if (clash && clash.path !== path) return "There's already a file with the same name";
  return "";
}

/** Rename a note/canvas (keeping its folder and extension) or a folder. */
export async function renameFile(ws: Workspace, path: string, newName: string) {
  const problem = renameError(ws, path, newName, true);
  if (problem) throw new Error(problem);
  const name = newName.trim();
  const isDir = ws.vault.isFolder(path);
  const ext = isDir ? "" : /\.(canvas|base)$/i.test(path) ? path.slice(path.lastIndexOf(".")) : ".md";
  if (name === (isDir ? fileName(path) : fileName(path).slice(0, -ext.length))) return;
  const dir = parentDir(path);
  await relocate(ws, path, `${dir ? dir + "/" : ""}${name}${ext}`);
}

/** Move a note or folder into another folder ("" for the vault root). */
export async function moveFile(ws: Workspace, path: string, folder: string) {
  if (folder === parentDir(path)) return;
  const isDir = ws.vault.isFolder(path);
  if (isDir && isUnder(folder.toLowerCase(), path.toLowerCase())) return;
  const name = fileName(path);
  const to = folder ? `${folder}/${name}` : name;
  const clash = ws.vault.files.some((f) => f.path.toLowerCase() === to.toLowerCase());
  const ext = isDir ? "" : /\.[^.]+$/.exec(name)?.[0] ?? "";
  await relocate(ws, path, clash ? freeName(ws, to.slice(0, to.length - ext.length), ext, true) : to);
}

/** Move a file or folder; the loaded notes and everything open follow. */
async function relocate(ws: Workspace, from: string, to: string) {
  if (ws.vault.isFolder(from) && isUnder(parentDir(to).toLowerCase(), from.toLowerCase())) throw new Error("A folder cannot move into itself.");
  const clash = ws.vault.files.find((f) => f.path.toLowerCase() === to.toLowerCase());
  if (clash && clash.path !== from) throw new Error(`"${to}" already exists`);
  const under = (p: string) => isUnder(p, from);
  await ws.editors.flush(under);
  const before = ws.vault.notes;
  // The backend resolves links against the new paths as soon as renamePath returns.
  // Snapshot every moved note first; otherwise old-name links can disappear.
  const targets = before.filter((n) => under(n.path)).map((n) => n.path);
  const backlinks = targets.length ? await api.backlinks(targets) : {};
  await api.renamePath(from, to);
  const swap = (p: string) => movedPath(p, from, to);
  ws.editors.move(under, swap);
  await ws.followMove(swap);
  fileSettings.renamed(from, to, before, backlinks);
}

/** Obsidian's "Make a copy": number the name beside the file, keeping its extension and exact contents. */
export async function copyNote(ws: Workspace, path: string): Promise<string> {
  await ws.saveNow(path);
  const ext = /\.canvas$/i.test(path) ? path.slice(-7) : ".md";
  const content = await (ext.toLowerCase() === ".canvas" ? api.readNote(path) : ws.editors.text(path));
  const entry = await createNote(ws, freeName(ws, path.slice(0, -ext.length), ext, true), content);
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
  if (!(await fileSettings.confirmMerge(path, into))) return;
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
  if (!opts.confirmed && !(await fileSettings.confirmDelete(path))) return false;
  const under = (p: string) => isUnder(p, path);
  await ws.editors.flush(under);
  await api.deletePath(path, fileSettings.permanentDelete());
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
    ws.vault.written(path);
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
