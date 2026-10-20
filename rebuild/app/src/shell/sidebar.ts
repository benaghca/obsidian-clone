// Left sidebar: icon tabs (Files / Search / Bookmarks), the file explorer
// with Obsidian's header buttons (new note, new folder, sort order, collapse
// all), and the vault name footer.

import { api, type FileEntry } from "../api";
import type { Bookmarks } from "../bookmarks";
import { commands } from "../commands";
import { slideHeight } from "../motion";
import { noteName, type Workspace } from "../workspace";
import { h, iconButton } from "./dom";
import { icon, type IconName } from "./icons";
import { type MenuItems, showMenu } from "./menu";
import type { Menus } from "./menus";

export type LeftView = "files" | "search" | "bookmarks";

export type SortOrder = "alphabetical" | "alphabeticalReverse" | "byModifiedTime" | "byModifiedTimeReverse";

export const SORT_ORDERS: [SortOrder, string][] = [
  ["alphabetical", "File name (A to Z)"],
  ["alphabeticalReverse", "File name (Z to A)"],
  ["byModifiedTime", "Modified time (new to old)"],
  ["byModifiedTimeReverse", "Modified time (old to new)"],
];

export interface LeftSidebar {
  el: HTMLElement;
  select(view: LeftView): void;
  /** Expand the folders above a path and scroll it into view. */
  reveal(path: string): void;
  collapseAll(): void;
  /** Start an inline rename of a row. */
  renameInTree(path: string): void;
  /** Create an "Untitled" folder and start renaming it. */
  newFolderIn(parent: string): void;
  /** Show the search view running this query. */
  searchFor(query: string): void;
  readonly sortOrder: SortOrder;
  setSortOrder(order: SortOrder): void;
  onSortChange(fn: () => void): void;
}

/** `menus` is read when a menu opens (it is built after the sidebar). */
export function createSidebar(ws: Workspace, bookmarks: Bookmarks, menus: () => Menus): LeftSidebar {
  const explorer = createFileExplorer(ws, menus);
  const searchView = createSearchView(ws);
  const views = {
    files: explorer.el,
    search: searchView.el,
    bookmarks: createBookmarksView(ws, bookmarks, menus, (path) => {
      select("files");
      explorer.reveal(path);
    }),
  };
  const tabButtons = new Map<LeftView, HTMLElement>();
  const content = h("div", { class: "workspace-leaf-content" });

  const tab = (name: LeftView, iconName: IconName, label: string) => {
    const button = iconButton(icon(iconName), label, () => select(name), "workspace-tab-header");
    tabButtons.set(name, button);
    return button;
  };

  function select(name: LeftView) {
    for (const [n, b] of tabButtons) b.classList.toggle("is-active", n === name);
    if (content.firstElementChild !== views[name]) content.replaceChildren(views[name]);
    if (name === "search") views.search.querySelector("input")?.focus();
  }

  const vaultName = h("div", { class: "workspace-drawer-vault-name" });
  ws.on((change) => {
    if (change === "files") vaultName.textContent = ws.vault.name;
  });

  const el = h(
    "div",
    { class: "workspace-split mod-sidedock mod-left-split" },
    h(
      "div",
      { class: "workspace-tab-header-container", "data-tauri-drag-region": "" },
      tab("files", "folder-closed", "Files"),
      tab("search", "search", "Search"),
      tab("bookmarks", "bookmark", "Bookmarks"),
    ),
    content,
    // Obsidian's help and settings buttons live here too; Grove has neither
    // (help would mean the network), so the footer is just the vault name.
    h("div", { class: "workspace-sidedock-vault-profile" }, vaultName),
  );
  select("files");
  return {
    el,
    select,
    reveal: (path) => explorer.reveal(path),
    collapseAll: () => explorer.collapseAll(),
    renameInTree: (path) => {
      select("files");
      explorer.reveal(path);
      explorer.startRename(path);
    },
    newFolderIn: (parent) => void explorer.newFolderIn(parent),
    searchFor: (query) => {
      select("search");
      searchView.search(query);
    },
    get sortOrder() {
      return explorer.sortOrder;
    },
    setSortOrder: (order) => explorer.setSortOrder(order),
    onSortChange: (fn) => explorer.onSortChange(fn),
  };
}

interface TreeNode {
  entry: FileEntry;
  children: TreeNode[];
}

function buildTree(files: FileEntry[], order: SortOrder): TreeNode[] {
  const root: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();
  const sorted = [...files].sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  for (const entry of sorted) {
    const node: TreeNode = { entry, children: [] };
    const slash = entry.path.lastIndexOf("/");
    const parent = slash < 0 ? null : dirs.get(entry.path.slice(0, slash));
    (parent ? parent.children : root).push(node);
    if (entry.is_dir) dirs.set(entry.path, node);
  }
  const byName = (a: TreeNode, b: TreeNode) =>
    a.entry.name.localeCompare(b.entry.name, undefined, { numeric: true, sensitivity: "base" });
  // Folders first, by name (reversed for Z to A); files in the chosen order.
  const compare = (a: TreeNode, b: TreeNode) => {
    if (a.entry.is_dir !== b.entry.is_dir) return Number(b.entry.is_dir) - Number(a.entry.is_dir);
    if (a.entry.is_dir || order === "alphabetical") return order === "alphabeticalReverse" ? byName(b, a) : byName(a, b);
    if (order === "alphabeticalReverse") return byName(b, a);
    const age = b.entry.mtime_ms - a.entry.mtime_ms;
    return (order === "byModifiedTime" ? age : -age) || byName(a, b);
  };
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort(compare);
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(root);
  return root;
}

function createFileExplorer(ws: Workspace, menus: () => Menus) {
  const expanded = new Set<string>();
  const rows = new Map<string, HTMLElement>();
  const sortListeners = new Set<() => void>();
  let sortOrder: SortOrder = "alphabetical";
  const list = h("div", { class: "nav-files-container" });

  const sortButton = iconButton(icon("arrow-up-narrow-wide"), "Change sort order", () => {
    showMenu(
      SORT_ORDERS.map(([order, title]) => ({ title, checked: order === sortOrder, action: () => setSortOrder(order) })),
      sortButton,
    );
  });
  const actions = h(
    "div",
    { class: "nav-header" },
    h(
      "div",
      { class: "nav-buttons-container" },
      iconButton(icon("square-pen"), "New note", () => commands.run("file-explorer:new-file")),
      iconButton(icon("folder-plus"), "New folder", () => commands.run("file-explorer:new-folder")),
      sortButton,
      iconButton(icon("chevrons-down-up"), "Collapse all", () => commands.run("file-explorer:collapse-all")),
    ),
  );

  function setSortOrder(order: SortOrder) {
    if (order === sortOrder) return;
    sortOrder = order;
    render();
    for (const fn of sortListeners) fn();
  }

  function contextMenu(e: MouseEvent, items: MenuItems) {
    e.preventDefault();
    e.stopPropagation();
    showMenu(items, { x: e.clientX, y: e.clientY });
  }
  list.addEventListener("contextmenu", (e) => contextMenu(e, menus().vault()));

  function startRename(path: string) {
    const label = rows.get(path)?.querySelector<HTMLElement>(".tree-item-inner");
    if (!label) return;
    const shown = label.textContent ?? "";
    label.contentEditable = "plaintext-only";
    label.focus();
    getSelection()?.selectAllChildren(label);
    const finish = (commit: boolean) => {
      label.contentEditable = "false";
      const name = label.textContent ?? "";
      label.textContent = shown;
      if (commit) ws.rename(path, name).catch((err) => console.warn(err));
    };
    label.addEventListener("blur", () => finish(true), { once: true });
    label.onkeydown = (ev) => {
      if (ev.key === "Enter" || ev.key === "Escape") {
        ev.preventDefault();
        label.onkeydown = null;
        if (ev.key === "Escape") label.textContent = shown;
        label.blur();
      }
    };
  }

  async function newFolderIn(parent: string) {
    try {
      const path = await ws.newFolder(parent);
      if (parent) expandTo(path);
      startRename(path);
    } catch (err) {
      console.warn("Could not create a folder", err);
    }
  }

  // Folders are a title row plus, while open, a children box holding their
  // rows. Toggling slides that one box; the rest of the tree is untouched.
  function renderNodes(nodes: TreeNode[], depth: number, into: HTMLElement) {
    for (const node of nodes) {
      const { entry } = node;
      const label = entry.is_dir ? entry.name : noteName(entry.path);
      const chevron = entry.is_dir
        ? h(
            "div",
            { class: `tree-item-icon collapse-icon${expanded.has(entry.path) ? "" : " is-collapsed"}` },
            icon("chevron-down", 14),
          )
        : null;
      const self = h(
        "div",
        {
          class: `tree-item-self${entry.is_dir ? " nav-folder-title mod-collapsible" : " nav-file-title"}`,
          "data-path": entry.path,
          onclick: (e: MouseEvent) => {
            if ((e.target as HTMLElement).isContentEditable) return;
            if (entry.is_dir) toggleFolder(node, depth, folder!, chevron!);
            else void ws.open(entry.path, { newTab: e.ctrlKey || e.metaKey });
          },
          onauxclick: (e: MouseEvent) => {
            if (e.button === 1 && !entry.is_dir) void ws.open(entry.path, { newTab: true });
          },
          oncontextmenu: (e: MouseEvent) => contextMenu(e, menus().file(entry)),
        },
        chevron,
        h("div", { class: "tree-item-inner" }, label),
        !entry.is_dir && !entry.path.endsWith(".md")
          ? h("div", { class: "nav-file-tag" }, entry.path.split(".").pop()!)
          : null,
      );
      self.style.setProperty("--depth", String(depth));
      rows.set(entry.path, self);
      const folder = entry.is_dir ? h("div", { class: "tree-item nav-folder" }, self) : null;
      if (folder && expanded.has(entry.path)) folder.append(renderChildren(node, depth));
      into.append(folder ?? self);
    }
  }

  function renderChildren(node: TreeNode, depth: number) {
    const box = h("div", { class: "tree-item-children" });
    renderNodes(node.children, depth + 1, box);
    return box;
  }

  const childrenOf = (folder: HTMLElement) => folder.querySelector<HTMLElement>(":scope > .tree-item-children");

  function toggleFolder(node: TreeNode, depth: number, folder: HTMLElement, chevron: HTMLElement) {
    const path = node.entry.path;
    const open = !expanded.has(path);
    if (open) expanded.add(path);
    else expanded.delete(path);
    chevron.classList.toggle("is-collapsed", !open);
    let box = childrenOf(folder);
    if (open && !box) {
      folder.append((box = renderChildren(node, depth)));
      markActive();
      void slideHeight(box, true, true);
    } else if (box) slideAndDrop(box, open);
  }

  /** Slide a children box open or closed; once fully closed, drop its rows. */
  function slideAndDrop(box: HTMLElement, open: boolean) {
    void slideHeight(box, open).then((finished) => {
      if (!finished || open) return;
      for (const row of box.querySelectorAll<HTMLElement>("[data-path]")) {
        if (rows.get(row.dataset.path!) === row) rows.delete(row.dataset.path!);
      }
      box.remove();
    });
  }

  function collapseAll() {
    expanded.clear();
    for (const chevron of list.querySelectorAll(".collapse-icon")) chevron.classList.add("is-collapsed");
    for (const folder of list.querySelectorAll<HTMLElement>(":scope > .nav-folder")) {
      const box = childrenOf(folder);
      if (box) slideAndDrop(box, false);
    }
  }

  function render() {
    rows.clear();
    const frag = document.createDocumentFragment() as unknown as HTMLElement;
    renderNodes(buildTree(ws.files, sortOrder), 0, frag);
    list.replaceChildren(frag);
    markActive();
  }

  let activeRow: HTMLElement | undefined;
  function markActive() {
    activeRow?.classList.remove("is-active");
    activeRow = ws.active.path ? rows.get(ws.active.path) : undefined;
    activeRow?.classList.add("is-active");
  }

  /** Expand every folder above a path (re-rendering if one was closed). */
  function expandTo(path: string) {
    const parts = path.split("/");
    let changed = false;
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (expanded.has(dir)) continue;
      expanded.add(dir);
      changed = true;
    }
    if (changed || !rows.has(path)) render();
  }

  function reveal(path: string) {
    expandTo(path);
    const row = rows.get(path);
    if (!row) return;
    row.scrollIntoView({ block: "center" });
    row.classList.remove("is-revealed");
    void row.offsetWidth; // restart the flash
    row.classList.add("is-revealed");
  }

  ws.on((change) => {
    if (change === "files") render();
    if (change === "tabs") {
      // Reveal the active note's folder, as Obsidian does.
      const path = ws.active.path;
      if (path && !rows.has(path)) expandTo(path);
      else markActive();
    }
  });

  return {
    el: h("div", { class: "nav-files" }, actions, list),
    reveal,
    collapseAll,
    startRename,
    newFolderIn,
    get sortOrder() {
      return sortOrder;
    },
    setSortOrder,
    onSortChange: (fn: () => void) => void sortListeners.add(fn),
  };
}

/** Bookmarked notes and folders: a click opens a note or reveals a folder. */
function createBookmarksView(ws: Workspace, bookmarks: Bookmarks, menus: () => Menus, revealFolder: (path: string) => void) {
  const list = h("div", { class: "nav-files-container bookmarks-list" });
  function render() {
    const paths = bookmarks.list();
    list.replaceChildren(
      ...paths.map((path) => {
        const entry = ws.files.find((f) => f.path === path)!;
        const row = h(
          "div",
          {
            class: "tree-item-self bookmark",
            "data-path": path,
            onclick: (e: MouseEvent) => {
              if (entry.is_dir) revealFolder(path);
              else void ws.open(path, { newTab: e.ctrlKey || e.metaKey });
            },
            oncontextmenu: (e: MouseEvent) => {
              e.preventDefault();
              showMenu(menus().file(entry), { x: e.clientX, y: e.clientY });
            },
          },
          h("div", { class: "tree-item-icon" }, icon(entry.is_dir ? "folder-closed" : "file-text", 16)),
          h("div", { class: "tree-item-inner" }, entry.is_dir ? entry.name : noteName(path)),
        );
        row.classList.toggle("is-active", path === ws.active.path);
        return row;
      }),
    );
    if (!paths.length) list.append(h("div", { class: "pane-empty" }, "No bookmarks yet."));
  }
  bookmarks.onChange(render);
  ws.on((change) => {
    if (change === "files" || change === "tabs") render();
  });
  return h("div", { class: "nav-files" }, list);
}

function createSearchView(ws: Workspace): { el: HTMLElement; search(query: string): void } {
  const input = h("input", { class: "search-input", "aria-label": "Search" });
  input.placeholder = "Search...";
  input.type = "search";
  const results = h("div", { class: "search-results" });
  let seq = 0;

  input.addEventListener("input", async () => {
    const query = input.value.trim();
    const mine = ++seq;
    const hits = query ? await api.search(query, 100) : [];
    if (mine !== seq) return;
    const byFile = new Map<string, typeof hits>();
    for (const hit of hits) byFile.set(hit.path, [...(byFile.get(hit.path) ?? []), hit]);
    results.replaceChildren(
      ...[...byFile].map(([path, fileHits]) =>
        h(
          "div",
          { class: "search-result" },
          h(
            "div",
            { class: "search-result-file-title", onclick: () => void ws.open(path) },
            noteName(path),
            h("span", { class: "search-result-count" }, String(fileHits.length)),
          ),
          ...fileHits.slice(0, 5).map((hit) =>
            h(
              "div",
              { class: "search-result-file-match", onclick: () => void ws.open(path, { line: hit.line }) },
              markMatch(hit.text.trim(), query),
            ),
          ),
        ),
      ),
    );
    if (query && !hits.length) results.append(h("div", { class: "pane-empty" }, "No matches found."));
  });

  return {
    el: h("div", { class: "search-view" }, h("div", { class: "search-input-container" }, input), results),
    search(query) {
      input.value = query;
      input.dispatchEvent(new Event("input"));
    },
  };
}

function markMatch(text: string, query: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) {
    frag.append(text);
    return frag;
  }
  const start = Math.max(0, i - 40);
  frag.append(
    (start ? "…" : "") + text.slice(start, i),
    h("span", { class: "search-result-file-matched-text" }, text.slice(i, i + query.length)),
    text.slice(i + query.length),
  );
  return frag;
}
