// Left sidebar: icon tabs (Files / Search / Bookmarks), the file explorer
// with Obsidian's header buttons (new note, new folder, sort order, auto-reveal, collapse
// all), and the vault name footer.

import type { FileEntry } from "../api";
import type { Bookmarks } from "../bookmarks";
import { commands } from "../commands";
import { slideHeight } from "../motion";
import { newFolder, renameFile } from "../fileOps";
import { listeners } from "../listeners";
import { compareFiles, compareNames, noteName, SORT_ORDERS, type SortOrder } from "../paths";
import { whereFromEvent } from "../tabs";
import type { Workspace } from "../workspace";
import { editInPlace, fieldError, h, iconButton } from "./dom";
import { icon } from "./icons";
import { type MenuItems, SEPARATOR, showMenu } from "./menu";
import type { Menus } from "./menus";
import { createSearchView } from "./searchView";
import { viewTabs } from "./sideView";
import { startTreeDrag } from "./treeDrag";

export type LeftView = "files" | "search" | "bookmarks";

export type LeftSidebar = ReturnType<typeof createSidebar>;

/** `menus` is read when a menu opens (it is built after the sidebar). */
export function createSidebar(ws: Workspace, bookmarks: Bookmarks, menus: () => Menus) {
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
  const tabs = viewTabs(
    [
      ["files", "folder-closed", "Files"],
      ["search", "search", "Search"],
      ["bookmarks", "bookmark", "Bookmarks"],
    ],
    (name: LeftView) => views[name],
    select,
  );

  function select(name: LeftView) {
    tabs.show(name);
    if (name === "search") views.search.querySelector("input")?.focus();
  }

  const vaultName = h("div", { class: "workspace-drawer-vault-name" });
  const footer = h("div", { class: "workspace-sidedock-vault-profile" }, vaultName);
  ws.on((change) => {
    if (change === "files") vaultName.textContent = ws.vault.name;
  });

  const el = h(
    "div",
    { class: "workspace-split mod-sidedock mod-left-split" },
    tabs.header,
    tabs.content,
    // The vault name, and Obsidian's settings button at the right. (Obsidian
    // also has help here; help would mean the network, so Grove has none.)
    footer,
  );
  select("files");
  return {
    el,
    select,
    /** Expand the folders above a path and scroll it into view. */
    reveal: explorer.reveal,
    collapseAll: explorer.collapseAll,
    /** Start an inline rename of a row. */
    renameInTree(path: string) {
      select("files");
      explorer.reveal(path);
      explorer.startRename(path);
    },
    /** Create an "Untitled" folder and start renaming it. */
    newFolderIn: (parent: string) => void explorer.newFolderIn(parent),
    /** Show the search view running this query. */
    searchFor(query: string) {
      select("search");
      searchView.search(query);
    },
    get sortOrder() {
      return explorer.sortOrder;
    },
    setSortOrder: explorer.setSortOrder,
    onSortChange: explorer.onSortChange,
    /** Show or remove the Bookmarks view (its core plugin turned on or off). */
    setBookmarksEnabled(enabled: boolean) {
      tabs.buttons.get("bookmarks")!.hidden = !enabled;
      if (!enabled && tabs.content.firstElementChild === views.bookmarks) select("files");
    },
    /** The footer under the views (vault name; the settings button goes here). */
    footer,
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
  const byName = (a: TreeNode, b: TreeNode) => compareNames(a.entry.name, b.entry.name);
  const inOrder = compareFiles(order);
  // Folders first, by name (reversed for Z to A); files in the chosen order.
  const compare = (a: TreeNode, b: TreeNode) => {
    if (a.entry.is_dir !== b.entry.is_dir) return Number(b.entry.is_dir) - Number(a.entry.is_dir);
    if (a.entry.is_dir) return order === "alphabeticalReverse" ? byName(b, a) : byName(a, b);
    return inOrder(a.entry, b.entry);
  };
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort(compare);
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(root);
  return root;
}

/** A row's (or the list's) right-click menu. */
function contextMenu(e: MouseEvent, items: MenuItems) {
  e.preventDefault();
  e.stopPropagation();
  showMenu(items, { x: e.clientX, y: e.clientY });
}

function createFileExplorer(ws: Workspace, menus: () => Menus) {
  const expanded = new Set<string>();
  const rows = new Map<string, HTMLElement>();
  const openFolders = new Map<string, () => void>();
  let cancelDrag: (() => void) | undefined;
  const sorted = listeners();
  let sortOrder: SortOrder = "alphabetical";
  let autoReveal = false;
  const list = h("div", { class: "nav-files-container" });

  const sortButton = iconButton(icon("arrow-up-narrow-wide"), "Change sort order", () => {
    showMenu(
      // In pairs (name, modified, created), as in Obsidian.
      SORT_ORDERS.flatMap(([order, title], i) => [i % 2 ? null : SEPARATOR, { title, checked: order === sortOrder, action: () => setSortOrder(order) }]),
      sortButton,
    );
  });
  const revealButton = iconButton(icon("gallery-vertical"), "Auto-reveal current file", () => {
    autoReveal = !autoReveal;
    revealButton.classList.toggle("is-active", autoReveal);
    revealButton.setAttribute("aria-pressed", String(autoReveal));
    if (autoReveal && ws.active.path) reveal(ws.active.path);
  });
  revealButton.setAttribute("aria-pressed", "false");
  const actions = h(
    "div",
    { class: "nav-header" },
    h(
      "div",
      { class: "nav-buttons-container" },
      iconButton(icon("square-pen"), "New note", () => commands.run("file-explorer:new-file")),
      iconButton(icon("folder-plus"), "New folder", () => commands.run("file-explorer:new-folder")),
      sortButton,
      revealButton,
      iconButton(icon("chevrons-down-up"), "Collapse all", () => commands.run("file-explorer:collapse-all")),
    ),
  );

  function setSortOrder(order: SortOrder) {
    if (order === sortOrder) return;
    sortOrder = order;
    render();
    sorted.emit();
  }

  list.addEventListener("contextmenu", (e) => contextMenu(e, menus().vault()));

  function startRename(path: string) {
    const label = rows.get(path)?.querySelector<HTMLElement>(".tree-item-inner");
    if (label) editInPlace(label, (name) => renameFile(ws, path, name));
  }

  async function newFolderIn(parent: string) {
    try {
      const path = await newFolder(ws, parent);
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
            else void ws.open(entry.path, { where: whereFromEvent(e) });
          },
          onpointerdown: (e: PointerEvent) => {
            if (e.button !== 0 || (e.target as HTMLElement).isContentEditable) return;
            cancelDrag?.();
            cancelDrag = startTreeDrag(e, entry, list, ws, (path) => openFolders.get(path)?.());
          },
          onauxclick: (e: MouseEvent) => {
            if (e.button === 1 && !entry.is_dir) void ws.open(entry.path, { where: "tab" });
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
      if (folder) openFolders.set(entry.path, () => {
        if (!expanded.has(entry.path)) toggleFolder(node, depth, folder, chevron!, true);
      });
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

  function toggleFolder(node: TreeNode, depth: number, folder: HTMLElement, chevron: HTMLElement, instant = false) {
    const path = node.entry.path;
    const open = !expanded.has(path);
    if (open) expanded.add(path);
    else expanded.delete(path);
    chevron.classList.toggle("is-collapsed", !open);
    let box = childrenOf(folder);
    if (open && !box) {
      folder.append((box = renderChildren(node, depth)));
      markActive();
      if (!instant) void slideHeight(box, true, true);
    } else if (box) slideAndDrop(box, open);
  }

  /** Slide a children box open or closed; once fully closed, drop its rows. */
  function slideAndDrop(box: HTMLElement, open: boolean) {
    void slideHeight(box, open).then((finished) => {
      if (!finished || open) return;
      for (const row of box.querySelectorAll<HTMLElement>("[data-path]")) {
        if (rows.get(row.dataset.path!) === row) rows.delete(row.dataset.path!);
      }
      for (const field of box.querySelectorAll<HTMLElement>("[aria-invalid]")) fieldError(field, "");
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
    cancelDrag?.();
    openFolders.clear();
    for (const field of list.querySelectorAll<HTMLElement>("[aria-invalid]")) fieldError(field, "");
    rows.clear();
    const frag = document.createDocumentFragment() as unknown as HTMLElement;
    renderNodes(buildTree(ws.vault.files, sortOrder), 0, frag);
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
      const path = ws.active.path;
      if (autoReveal && path) reveal(path);
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
    onSortChange: sorted.on,
  };
}

/** Bookmarked notes and folders: a click opens a note or reveals a folder. */
function createBookmarksView(ws: Workspace, bookmarks: Bookmarks, menus: () => Menus, revealFolder: (path: string) => void) {
  const list = h("div", { class: "nav-files-container bookmarks-list" });
  function render() {
    const paths = bookmarks.list();
    list.replaceChildren(
      ...paths.map((path) => {
        const entry = ws.vault.files.find((f) => f.path === path)!;
        const row = h(
          "div",
          {
            class: "tree-item-self bookmark",
            "data-path": path,
            onclick: (e: MouseEvent) => {
              if (entry.is_dir) revealFolder(path);
              else void ws.open(path, { where: whereFromEvent(e) });
            },
            oncontextmenu: (e: MouseEvent) => contextMenu(e, menus().file(entry)),
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
