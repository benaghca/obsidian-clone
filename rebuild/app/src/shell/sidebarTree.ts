// Folder tree for the file explorer. Free of the DOM, so a test can build it
// without opening a window.

import type { FileEntry } from "../api";
import { compareFiles, compareNames, type SortOrder } from "../paths";

export interface TreeNode {
  entry: FileEntry;
  children: TreeNode[];
}

/**
 * Each folder is recorded before any child is attached, so a file that
 * appears in the list before its folder still nests under it. Sibling lists
 * are then sorted: folders by name (Z to A only when that order is selected),
 * files in the chosen order. Paths are not sorted by depth.
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
  const compare = (a: TreeNode, b: TreeNode) => {
    if (a.entry.is_dir !== b.entry.is_dir) return Number(b.entry.is_dir) - Number(a.entry.is_dir);
    if (a.entry.is_dir) return order === "alphabeticalReverse" ? byName(b, a) : byName(a, b);
    return inOrder(a.entry, b.entry);
  };
  const sortNodes = (list: TreeNode[]) => {
    list.sort(compare);
    for (const n of list) sortNodes(n.children);
  };
  sortNodes(root);
  return root;
}
