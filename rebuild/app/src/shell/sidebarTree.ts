// Folder tree for the file explorer. Free of the DOM, so a test can build it
// without opening a window.

import type { FileEntry } from "../api";
import { compareFiles, compareNames, type SortOrder } from "../paths";

export interface TreeNode {
  entry: FileEntry;
  children: TreeNode[];
}

/** Slashes in a path. Used only as a tie-break, so the list is not sorted by depth. */
function slashCount(path: string): number {
  let count = 0;
  for (let i = 0; i < path.length; i++) if (path.charCodeAt(i) === 47) count += 1;
  return count;
}

/**
 * Each folder is recorded before any child is attached, so a file that
 * appears in the list before its folder still nests under it. Sibling lists
 * are then sorted: folders by name (Z to A only when that order is selected),
 * files in the chosen order. When that comparison ties, the shallower path
 * comes first. Paths are not sorted by depth.
 */
export function buildTree(files: FileEntry[], order: SortOrder): TreeNode[] {
  const root: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();
  const nodes: TreeNode[] = [];
  for (const entry of files) {
    const node: TreeNode = { entry, children: [] };
    nodes.push(node);
    if (entry.is_dir) dirs.set(entry.path, node);
  }
  for (const node of nodes) {
    const slash = node.entry.path.lastIndexOf("/");
    const parent = slash < 0 ? undefined : dirs.get(node.entry.path.slice(0, slash));
    (parent ? parent.children : root).push(node);
  }
  const byName = (a: TreeNode, b: TreeNode) => compareNames(a.entry.name, b.entry.name);
  const inOrder = compareFiles(order);
  // Folders first, by name (reversed for Z to A); files in the chosen order.
  // A tie keeps the shallower path first, which the old stable depth sort left
  // in place when a parent folder was missing. Equal depths stay in listed order.
  const compare = (a: TreeNode, b: TreeNode) => {
    if (a.entry.is_dir !== b.entry.is_dir) return Number(b.entry.is_dir) - Number(a.entry.is_dir);
    const primary = a.entry.is_dir
      ? order === "alphabeticalReverse" ? byName(b, a) : byName(a, b)
      : inOrder(a.entry, b.entry);
    return primary || slashCount(a.entry.path) - slashCount(b.entry.path);
  };
  const sortNodes = (list: TreeNode[]) => {
    list.sort(compare);
    for (const n of list) sortNodes(n.children);
  };
  sortNodes(root);
  return root;
}
