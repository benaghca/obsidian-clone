// Vault paths and note names: vault-relative, forward slashes, notes end in
// ".md". Free of the DOM and of the workspace, so any module can use them.

/** The last part of a path ("Folder/Note.md" → "Note.md"). */
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
/** A note's name: its file name without ".md". */
export const noteName = (path: string) => fileName(path).replace(/\.md$/, "");
/** The folder a path is in ("" at the vault root). */
export const parentDir = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
/** A folder as typed in a setting ("/Daily/ ") as a vault path ("Daily"). */
export const trimSlashes = (folder: string) => folder.trim().replace(/^\/+|\/+$/g, "");

/** Whether `path` is `folder` itself or anything inside it. */
export const isUnder = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);
/** Where `path` is after `from` moved to `to` (unchanged when it is not under `from`). */
export const movedPath = (path: string, from: string, to: string) => (isUnder(path, from) ? to + path.slice(from.length) : path);

/** A vault path from the system root, with the system's separator. */
export function systemPath(vault: string, path: string): string {
  const sep = vault.includes("\\") ? "\\" : "/";
  return `${vault}${sep}${path.split("/").join(sep)}`;
}

/** Names in Obsidian's order: case ignored, numbers by value ("Note 2" before "Note 10"). */
export const compareNames = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
