// Vault paths and note names: vault-relative, forward slashes, notes end in
// ".md". Free of the DOM and of the workspace, so any module can use them.

/** The last part of a path ("Folder/Note.md" → "Note.md"). */
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
/** A note's name: its file name without ".md". */
export const noteName = (path: string) => fileName(path).replace(/\.md$/i, "");
/** Whether a vault path is a note. `.md` matches in any case, as the vault's note list does. */
export const isNoteFile = (path: string) => path.toLowerCase().endsWith(".md");
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

/** Names in Obsidian's order: case ignored, numbers by value ("Note 2" before "Note 10"). One collator, made once (fast for sorting a vault). */
export const compareNames = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

export type SortOrder = "alphabetical" | "alphabeticalReverse" | "byModifiedTime" | "byModifiedTimeReverse" | "byCreatedTime" | "byCreatedTimeReverse";

/** Obsidian's file orders, as its file explorer's sort menu and search view name them. */
export const SORT_ORDERS: [SortOrder, string][] = [
  ["alphabetical", "File name (A to Z)"],
  ["alphabeticalReverse", "File name (Z to A)"],
  ["byModifiedTime", "Modified time (new to old)"],
  ["byModifiedTimeReverse", "Modified time (old to new)"],
  ["byCreatedTime", "Created time (new to old)"],
  ["byCreatedTimeReverse", "Created time (old to new)"],
];

/** Files in `order`: by name, or by time with ties by name. */
export function compareFiles(order: SortOrder) {
  return (a: { name: string; mtime_ms: number; ctime_ms: number }, b: typeof a) => {
    if (order === "alphabetical") return compareNames(a.name, b.name);
    if (order === "alphabeticalReverse") return compareNames(b.name, a.name);
    const age = order.startsWith("byCreated") ? b.ctime_ms - a.ctime_ms : b.mtime_ms - a.mtime_ms;
    return (order.endsWith("Reverse") ? -age : age) || compareNames(a.name, b.name);
  };
}
