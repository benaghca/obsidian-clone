// Explorer multi-select and the link text a drop into a note inserts.
// Free of the DOM. Link text uses the same formatter as the suggester.

import { isUnder, parentDir } from "../paths";

/**
 * Alt-click toggles one row into the selection. Shift-click extends it.
 * Ctrl/Cmd-click is not a selection gesture: the row opens in a new tab.
 */
export function selectGesture(e: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): "toggle" | "range" | "open" {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod && e.altKey && !e.shiftKey) return "toggle";
  if (!mod && e.shiftKey) return "range";
  return "open";
}

/** Inclusive visible range from the anchor to the clicked row, in list order. */
export function selectionRange(order: readonly string[], anchor: string | null, path: string): string[] {
  const end = order.indexOf(path);
  const start = anchor == null ? -1 : order.indexOf(anchor);
  if (end < 0 || start < 0) return [path];
  const [from, to] = start < end ? [start, end] : [end, start];
  return order.slice(from, to + 1);
}

/** Selected paths that are not inside another selected folder, in the given order. */
export function topLevelPaths(paths: readonly string[], isFolder: (path: string) => boolean): string[] {
  return paths.filter((path) => !paths.some((other) => other !== path && isFolder(other) && isUnder(path, other)));
}

/**
 * Where "New folder with selection" is created: the deepest folder that
 * already contains every item. Mixed parents land in their common ancestor,
 * so the new folder can hold the whole selection.
 */
export function selectionFolderParent(items: readonly string[]): string {
  if (!items.length) return "";
  let shared = parentDir(items[0]!);
  for (const path of items) {
    const parent = parentDir(path);
    while (shared && parent !== shared && !parent.startsWith(`${shared}/`)) shared = parentDir(shared);
  }
  return shared;
}

/**
 * One link per file, in the given order. Notes use the suggester's link
 * (`[[Note]]`); images and other files are embeds (`![[file.png]]`).
 * Folders add nothing.
 */
export function dropLinkText(
  paths: readonly string[],
  isDir: (path: string) => boolean,
  from: string | null,
  linkTo: (target: string, from: string | null) => string,
): string {
  return paths
    .filter((path) => !isDir(path))
    .map((path) => (path.toLowerCase().endsWith(".md") ? "" : "!") + linkTo(path, from))
    .join("\n");
}
