// Explorer multi-select and the link text a drop into a note inserts.
// Free of the DOM. Link text uses the same formatter as the suggester.

import { isUnder } from "../paths";

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
