// Changing the vault's files: new notes and folders, rename, move, copy,
// merge and delete, and rewriting a note's text from outside its editors.
// Each goes to the backend first; then the editors and the open tabs follow
// (Workspace.followMove, Workspace.forget).

import { api, type FileEntry } from "./api";
import { discardCanvases, holdCanvases, releaseCanvases, retargetCanvases, saveCanvases, snapshotCanvases } from "./canvas/pending";
import { beginHoldDrain } from "./holdDrain";
import { coordinatePaths } from "./pathBarrier";
import { writesSealed } from "./saveSeal";
import { backendRoot, sourceVault } from "./vaultRoot";
import { discardHandoff, flushHandoff, queueVaultCopy, queueVaultCreate, retargetHandoff, writeVaultNote } from "./vaultWrite";
import { discardDrawings, holdDrawings, releaseDrawings, retargetDrawings, saveDrawings, snapshotDrawings } from "./drawing/pending";
import { emptyDrawing } from "./drawing/scene";
import type { ViewMode } from "./editor/editor";
import type { NoteRef } from "./editor/host";
import { fileName, isUnder, movedPath, parentDir, viewFileExt } from "./paths";
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
  /** Told after a move, with the files (`Vault.fileRefs`) and link-source paths from before it (to update links). */
  renamed: (_from: string, _to: string, _before: NoteRef[], _sources: readonly string[]) => {},
};

/** Show `entry` from the create reply. Read the whole list only when a parent folder is not listed yet. */
async function showNewFile(ws: Workspace, entry: FileEntry): Promise<void> {
  if (ws.vault.adoptAdded?.(entry)) return;
  await ws.vault.refreshFiles();
}

async function publish(ws: Workspace, entry: FileEntry): Promise<FileEntry> {
  await showNewFile(ws, entry);
  // A copy or a daily note from a template can already contain links. Without
  // this, the link index waits for a later save and those backlinks never appear.
  ws.vault.written(entry.path);
  return entry;
}

export async function createNote(ws: Workspace, path: string, content = "", source = sourceVault()): Promise<FileEntry> {
  // The vault captured by the caller is checked in the same turn as the create.
  if (writesSealed() || backendRoot() !== source) {
    return publish(ws, await queueVaultCreate("note", path, content, source));
  }
  return publish(ws, await api.createNote(path, content));
}

async function makeFolder(path: string, source = sourceVault()): Promise<FileEntry> {
  if (writesSealed() || backendRoot() !== source) return queueVaultCreate("folder", path, "", source);
  return api.createFolder(path);
}

/**
 * Create "Untitled.md" (or "Untitled 1.md", ...) in a folder (by default
 * where Settings → Files and links puts new notes) and open it for editing.
 */
export async function newNote(ws: Workspace, folder: string = fileSettings.newNoteFolder(), where?: OpenWhere): Promise<string> {
  if (folder && !ws.vault.isFolder(folder)) await makeFolder(folder).catch(() => {});
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
    if (folder && !ws.vault.isFolder(folder)) await makeFolder(folder).catch(() => {});
    const entry = await createNote(ws, freeName(ws, `${folder ? `${folder}/` : ""}Untitled`, `.${kind}`), kind === "base" ? "views:\n  - type: table\n    name: View\n" : '{}');
    await ws.open(entry.path, { where: ws.active.path !== null || ws.active.type ? "tab" : false });
    return entry.path;
  });
  creatingCanvas = next.then(() => {}, () => {});
  return next;
}

/** "Drawing 2026-11-05 14.30.05": a new drawing's name, from when it is made. */
export function drawingStem(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `Drawing ${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}.${two(now.getMinutes())}.${two(now.getSeconds())}`;
}

let creatingDrawing = Promise.resolve();
/** Create an empty drawing in a folder; returns its path. Two at once get different names. */
export function createDrawing(ws: Workspace, folder: string): Promise<string> {
  const next = creatingDrawing.then(async () => {
    if (folder && !ws.vault.isFolder(folder)) await makeFolder(folder).catch(() => {});
    const entry = await createNote(ws, freeName(ws, `${folder ? `${folder}/` : ""}${drawingStem()}`, ".excalidraw"), emptyDrawing());
    return entry.path;
  });
  creatingDrawing = next.then(() => {}, () => {});
  return next;
}

/**
 * Create an empty drawing in a folder (by default where new notes go) and
 * open it in a new tab when this one shows something. Returns its path.
 */
export async function newDrawing(ws: Workspace, folder = fileSettings.newNoteFolder()): Promise<string> {
  const path = await createDrawing(ws, folder);
  await ws.open(path, { where: ws.active.path !== null || ws.active.type ? "tab" : false });
  return path;
}

/** Create an empty "Untitled" folder; returns its path. */
export async function newFolder(ws: Workspace, parent = ""): Promise<string> {
  const entry = await makeFolder(freeName(ws, `${parent ? `${parent}/` : ""}Untitled`, ""));
  await showNewFile(ws, entry);
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
  const ext = isDir ? "" : viewFileExt(path) || ".md";
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
  const ext = isDir ? "" : viewFileExt(path) || ".md";
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

// A move waits for note writes already sent, and a link update holds its next
// read or write while a move runs, so neither works on a path that is moving.
const moving = new Set<Promise<unknown>>();
const writing = new Set<Promise<unknown>>();
function track<T>(set: Set<Promise<unknown>>, task: Promise<T>): Promise<T> {
  set.add(task);
  const done = () => void set.delete(task);
  task.then(done, done);
  return task;
}

/** Whether a rename or move is under way. Check it just before sending a read or write. */
export const isMoving = () => moving.size > 0;

/** Settles once no rename or move is under way. */
export async function movesSettled() {
  while (moving.size) await Promise.allSettled([...moving]);
}

/** Move a file or folder; the loaded notes and everything open follow. */
function relocate(ws: Workspace, from: string, to: string): Promise<void> {
  return track(moving, (async () => {
    while (writing.size) await Promise.allSettled([...writing]);
    await relocateNow(ws, from, to);
  })());
}

function staleRoot(vault: string): boolean {
  return writesSealed() || backendRoot() !== vault;
}

async function relocateNow(ws: Workspace, from: string, to: string) {
  const vault = sourceVault();
  if (writesSealed()) {
    console.warn("Could not rename while a vault switch is saving");
    return;
  }
  if (ws.vault.isFolder(from) && isUnder(parentDir(to).toLowerCase(), from.toLowerCase())) throw new Error("A folder cannot move into itself.");
  const clash = ws.vault.files.find((f) => f.path.toLowerCase() === to.toLowerCase());
  if (clash && clash.path !== from) throw new Error(`"${to}" already exists`);
  // Other windows flush and hold this path before the rename. A failed peer
  // save aborts quietly: there is no dialog, and the file stays where it is.
  // The vault captured here is checked again in the same turn as renamePath.
  await coordinatePaths(from, to, () => relocateHeld(ws, from, to, vault));
}

async function relocateHeld(ws: Workspace, from: string, to: string, vault: string): Promise<boolean> {
  const under = (p: string) => isUnder(p, from);
  // Hold before the gap, after draining writes that already left. A keystroke
  // or a retry during linkSources/renamePath stays dirty and does not recreate
  // the source once the rename has removed it. Only this drain may write through the hold.
  holdSaves(ws, under);
  let moved = false;
  try {
    const endDrain = beginHoldDrain(under);
    try { await flushSaves(ws, under); await flushHandoff(); } finally { endDrain(); }
    // A failed queue stays put and is retargeted with the file. It cannot recreate the source.
    const before = ws.vault.fileRefs();
    // Old-name links can stop resolving as soon as renamePath returns.
    const targets = before.filter((n) => under(n.path)).map((n) => n.path);
    const sources = targets.length ? await api.linkSources(targets) : [];
    if (staleRoot(vault)) {
      releaseSaves(ws, under);
      console.warn("Could not rename while a vault switch is saving");
      return false;
    }
    await api.renamePath(from, to);
    const swap = (p: string) => movedPath(p, from, to);
    ws.editors.move(under, swap);
    retargetCanvases(under, swap);
    retargetDrawings(under, swap);
    retargetHandoff(vault, under, swap);
    moved = true;
    releaseSaves(ws, under);
    // The hold blocked a retry of the old path. The queue now names the new one.
    await flushHandoff();
    await flushSaves(ws, (p) => isUnder(p, to));
    await ws.followMove(swap);
    fileSettings.renamed(from, to, before, sources);
    return true;
  } catch (err) {
    if (!moved) releaseSaves(ws, under);
    throw err;
  }
}

function holdSaves(ws: Workspace, under: (path: string) => boolean) {
  ws.editors.hold(under);
  holdCanvases(under);
  holdDrawings(under);
}

function releaseSaves(ws: Workspace, under: (path: string) => boolean) {
  ws.editors.release(under);
  releaseCanvases(under);
  releaseDrawings(under);
}

async function flushSaves(ws: Workspace, which: (path: string) => boolean): Promise<boolean> {
  const results = await Promise.all([ws.editors.flush(which), saveCanvases(which), saveDrawings(which)]);
  return results.every((ok) => ok !== false);
}

/** Text this page already holds for `path`, so a copy does not read another vault. */
function loadedCopy(ws: Workspace, path: string, ext: string): string | undefined {
  if (ext === ".md") return ws.editors.doc(path)?.toString();
  const rows = ext === ".canvas" ? snapshotCanvases() : snapshotDrawings();
  return rows.find((row) => row.path === path)?.text;
}

/** Obsidian's "Make a copy": number the name beside the file, keeping its extension and exact contents. */
export async function copyNote(ws: Workspace, path: string): Promise<string> {
  const source = sourceVault();
  await Promise.all([ws.saveNow(path), saveCanvases((p) => p === path), saveDrawings((p) => p === path)]);
  const ext = viewFileExt(path) || ".md";
  const dest = freeName(ws, path.slice(0, -ext.length), ext, true);
  const snap = loadedCopy(ws, path, ext);
  // A loaded note or canvas is this page's text, even while a switch is sealed.
  if (snap !== undefined) {
    const entry = await createNote(ws, dest, snap, source);
    await ws.open(entry.path);
    return entry.path;
  }
  // A closed file is read only while `source` is still the backend, in the
  // same turn as the read. Otherwise the read waits until that vault is current.
  let content: string | null = null;
  if (backendRoot() === source && !writesSealed()) content = await api.readNote(path);
  if (content === null || backendRoot() !== source || writesSealed()) {
    const entry = await queueVaultCopy(source, path, dest);
    await showNewFile(ws, entry);
    ws.vault.written(entry.path);
    await ws.open(entry.path);
    return entry.path;
  }
  const entry = await createNote(ws, dest, content, source);
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
  // A failed save leaves the merged text in the target and the source on disk.
  if (!(await ws.saveNow(into))) return;
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
  const vault = sourceVault();
  if (writesSealed()) return false;
  const under = (p: string) => isUnder(p, path);
  // Peers flush first. A failed flush here does not delete: the newest text
  // would be missing from the trash. The hold stops a retry from recreating
  // the file only after the delete has succeeded.
  return coordinatePaths(path, null, () => deleteHeld(ws, path, under, vault));
}

async function deleteHeld(ws: Workspace, path: string, under: (p: string) => boolean, vault: string): Promise<boolean> {
  holdSaves(ws, under);
  try {
    const endDrain = beginHoldDrain(under);
    let flushed = false;
    try {
      // The queued snapshot first, so a newer direct write is in the file before it is trashed.
      const handed = await flushHandoff();
      flushed = handed && await flushSaves(ws, under);
    } finally { endDrain(); }
    if (!flushed) {
      releaseSaves(ws, under);
      return false;
    }
    if (staleRoot(vault)) {
      releaseSaves(ws, under);
      console.warn("Could not delete while a vault switch is saving");
      return false;
    }
    await api.deletePath(path, fileSettings.permanentDelete());
  } catch (err) {
    releaseSaves(ws, under);
    throw err;
  }
  ws.editors.forget(under);
  discardCanvases(under);
  discardDrawings(under);
  discardHandoff(vault, under);
  releaseSaves(ws, under);
  await ws.forget(under);
  return true;
}

/**
 * Change a note's text from outside its editors (link updates after a
 * rename): only the lines that differ are replaced, through the editor if
 * the note is loaded (so it is undoable and saved as usual), else on disk.
 */
export async function updateNoteText(ws: Workspace, path: string, next: string) {
  const source = sourceVault();
  const doc = ws.editors.doc(path);
  if (!doc) {
    await track(writing, writeVaultNote(path, next, () => ws.vault.written(path), undefined, source));
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
