import { expect, test } from "vitest";
import type { FileEntry } from "../api";
import { compareFiles, compareNames, type SortOrder } from "../paths";
import { buildTree, type TreeNode } from "./sidebarTree";

function entry(path: string, isDir: boolean, mtime = 0, ctime = 0): FileEntry {
  const slash = path.lastIndexOf("/");
  const base = slash < 0 ? path : path.slice(slash + 1);
  const name = !isDir && base.length > 3 && base.slice(-3).toLowerCase() === ".md" ? base.slice(0, -3) : base;
  return { path, name, is_dir: isDir, mtime_ms: mtime, ctime_ms: ctime, size: 0 };
}

function outline(nodes: TreeNode[]): string[] {
  const lines: string[] = [];
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      lines.push(`${"  ".repeat(depth)}${node.entry.is_dir ? "d" : "f"} ${node.entry.path}`);
      walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return lines;
}

// Listed child before parent. Gone has no folder. Zed exists, Zed/Missing does
// not, so that file stays at the vault root instead of jumping up to Zed.
const nested: FileEntry[] = [
  entry("Zed/Note 10.md", false, 1, 1),
  entry("Root.md", false, 3, 1),
  entry("Zed/Inner/leaf.md", false, 1, 1),
  entry("alpha.md", false, 1, 9),
  entry("Zed", true),
  entry("Zed/Note 2.md", false, 8, 2),
  entry("Midd", true),
  entry("Zed/Inner", true),
  entry("Midd/z.md", false, 4, 4),
  entry("Midd/a.md", false, 2, 5),
  entry("Gone/Orphan.md", false, 1, 1),
  entry("Zed/Missing/x.md", false, 7, 1),
];

test("an empty list is an empty tree", () => {
  expect(buildTree([], "alphabetical")).toEqual([]);
});

test("nested folders and root files keep today's name order when a file is listed before its folder", () => {
  expect(outline(buildTree(nested, "alphabetical"))).toEqual([
    "d Midd",
    "  f Midd/a.md",
    "  f Midd/z.md",
    "d Zed",
    "  d Zed/Inner",
    "    f Zed/Inner/leaf.md",
    "  f Zed/Note 2.md",
    "  f Zed/Note 10.md",
    "f alpha.md",
    "f Gone/Orphan.md",
    "f Root.md",
    "f Zed/Missing/x.md",
  ]);
  expect(outline(buildTree(nested, "alphabeticalReverse"))).toEqual([
    "d Zed",
    "  d Zed/Inner",
    "    f Zed/Inner/leaf.md",
    "  f Zed/Note 10.md",
    "  f Zed/Note 2.md",
    "d Midd",
    "  f Midd/z.md",
    "  f Midd/a.md",
    "f Zed/Missing/x.md",
    "f Root.md",
    "f Gone/Orphan.md",
    "f alpha.md",
  ]);
});

test("time order sorts files and leaves folders A to Z", () => {
  expect(outline(buildTree(nested, "byModifiedTime"))).toEqual([
    "d Midd",
    "  f Midd/z.md",
    "  f Midd/a.md",
    "d Zed",
    "  d Zed/Inner",
    "    f Zed/Inner/leaf.md",
    "  f Zed/Note 2.md",
    "  f Zed/Note 10.md",
    "f Zed/Missing/x.md",
    "f Root.md",
    "f alpha.md",
    "f Gone/Orphan.md",
  ]);
  expect(outline(buildTree(nested, "byModifiedTimeReverse"))).toEqual([
    "d Midd",
    "  f Midd/a.md",
    "  f Midd/z.md",
    "d Zed",
    "  d Zed/Inner",
    "    f Zed/Inner/leaf.md",
    "  f Zed/Note 10.md",
    "  f Zed/Note 2.md",
    "f alpha.md",
    "f Gone/Orphan.md",
    "f Root.md",
    "f Zed/Missing/x.md",
  ]);
});

test("a file is not a folder for the path under it", () => {
  const files = [entry("Notes.md/Child.md", false), entry("Notes.md", false)];
  expect(outline(buildTree(files, "alphabetical"))).toEqual(["f Notes.md/Child.md", "f Notes.md"]);
});

test("equal names keep the listed order", () => {
  const file = (path: string): FileEntry => ({ path, name: "Readme", is_dir: false, mtime_ms: 1, ctime_ms: 1, size: 0 });
  const folder = (path: string): FileEntry => ({ path, name: "Box", is_dir: true, mtime_ms: 0, ctime_ms: 0, size: 0 });
  expect(buildTree([file("b.md"), file("a.md")], "alphabetical").map((node) => node.entry.path)).toEqual(["b.md", "a.md"]);
  expect(buildTree([file("a.md"), file("b.md")], "alphabetical").map((node) => node.entry.path)).toEqual(["a.md", "b.md"]);
  expect(buildTree([folder("B"), folder("A")], "alphabetical").map((node) => node.entry.path)).toEqual(["B", "A"]);
});

const ORDERS: SortOrder[] = [
  "alphabetical",
  "alphabeticalReverse",
  "byModifiedTime",
  "byModifiedTimeReverse",
  "byCreatedTime",
  "byCreatedTimeReverse",
];

/** Previous builder: sort every path by slash count, then attach. The comparator splits each path. */
function depthSortedTree(files: FileEntry[], order: SortOrder): TreeNode[] {
  const root: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();
  const sorted = [...files].sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  for (const file of sorted) {
    const node: TreeNode = { entry: file, children: [] };
    const slash = file.path.lastIndexOf("/");
    const parent = slash < 0 ? undefined : dirs.get(file.path.slice(0, slash));
    (parent ? parent.children : root).push(node);
    if (file.is_dir) dirs.set(file.path, node);
  }
  const byName = (a: TreeNode, b: TreeNode) => compareNames(a.entry.name, b.entry.name);
  const inOrder = compareFiles(order);
  const compare = (a: TreeNode, b: TreeNode) => {
    if (a.entry.is_dir !== b.entry.is_dir) return Number(b.entry.is_dir) - Number(a.entry.is_dir);
    if (a.entry.is_dir) return order === "alphabeticalReverse" ? byName(b, a) : byName(a, b);
    return inOrder(a.entry, b.entry);
  };
  const sortNodes = (list: TreeNode[]) => {
    list.sort(compare);
    for (const node of list) sortNodes(node.children);
  };
  sortNodes(root);
  return root;
}

function slashSplits(run: () => void): number {
  const orig = String.prototype.split as (this: string, separator?: string | RegExp, limit?: number) => string[];
  let count = 0;
  String.prototype.split = function (this: string, separator?: string | RegExp, limit?: number): string[] {
    if (separator === "/") count += 1;
    return orig.call(this, separator, limit);
  } as typeof String.prototype.split;
  try {
    run();
  } finally {
    String.prototype.split = orig as typeof String.prototype.split;
  }
  return count;
}

function firstDifference(actual: TreeNode[], expected: TreeNode[]): string | null {
  const walk = (left: TreeNode[], right: TreeNode[], depth: number): string | null => {
    const n = Math.max(left.length, right.length);
    for (let i = 0; i < n; i++) {
      const a = left[i];
      const b = right[i];
      if (!a || !b || a.entry.path !== b.entry.path || a.entry.is_dir !== b.entry.is_dir) {
        return `depth ${depth} index ${i}: ${a?.entry.path ?? "(missing)"} vs ${b?.entry.path ?? "(missing)"}`;
      }
      const child = walk(a.children, b.children, depth + 1);
      if (child) return child;
    }
    return null;
  };
  return walk(actual, expected, 0);
}

function largeList(): FileEntry[] {
  const files: FileEntry[] = [];
  for (let f = 0; f < 400; f++) {
    const folder = `F${String(f).padStart(3, "0")}`;
    // The deep note is pushed before either folder, so attachment cannot rely on list order.
    files.push(entry(`${folder}/Sub/Deep.md`, false, f, 1));
    files.push(entry(folder, true));
    for (let i = 0; i < 4; i++) files.push(entry(`${folder}/N${i}.md`, false, i, 4 - i));
    files.push(entry(`${folder}/Sub`, true));
  }
  files.push(entry("Root.md", false, 5, 5));
  for (let i = files.length - 1; i > 0; i--) {
    const j = (i * 17 + 3) % (i + 1);
    const swap = files[i]!;
    files[i] = files[j]!;
    files[j] = swap;
  }
  return files;
}

test("a large file list matches the depth-sorted tree and does not split paths to sort", () => {
  const files = largeList();
  const at = new Map(files.map((file, index) => [file.path, index]));
  const childBeforeParent = files.some((file) => {
    const slash = file.path.lastIndexOf("/");
    if (slash < 0) return false;
    const parentAt = at.get(file.path.slice(0, slash));
    return parentAt !== undefined && at.get(file.path)! < parentAt;
  });
  expect(childBeforeParent).toBe(true);

  const legacySplits = slashSplits(() => {
    depthSortedTree(files, "alphabetical");
  });
  expect(legacySplits).toBeGreaterThan(files.length);

  for (const order of ORDERS) {
    let built: TreeNode[] = [];
    const splits = slashSplits(() => {
      built = buildTree(files, order);
    });
    expect(splits, order).toBe(0);
    expect(firstDifference(built, depthSortedTree(files, order)), order).toBeNull();
  }
});
