// Left sidebar: icon tabs (Files / Search / Bookmarks), the file explorer
// with Obsidian's header buttons (new note, new folder, sort order, auto-reveal, collapse
// all), and the vault name footer.

import type { FileEntry } from "../api";
import type { Bookmarks } from "../bookmarks";
import { commands } from "../commands";
import { slideHeight } from "../motion";
import { deleteFile, fileSettings, newFolder, renameFile } from "../fileOps";
import { listeners } from "../listeners";
import { compareFiles, compareNames, noteName, parentDir, SORT_ORDERS, type SortOrder } from "../paths";
import { readStored, store } from "../storage";
import { whereFromEvent } from "../tabs";
import type { Workspace } from "../workspace";
import { confirmDialog, isConfirmOpen } from "./confirm";
import { editInPlace, fieldError, h, iconButton } from "./dom";
import { icon } from "./icons";
import { isMenuOpen, type MenuItems, SEPARATOR, showMenu } from "./menu";
import type { Menus } from "./menus";
import { isPromptOpen } from "./prompt";
import { createSearchView } from "./searchView";
import { viewTabs } from "./sideView";
import { startTreeDrag } from "./treeDrag";
import { selectGesture, selectionRange, topLevelPaths, treeKeyAction } from "./treeSelect";
import { mountVaultSwitcher } from "./vaultSwitcher";

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

  const vaultSwitcher = mountVaultSwitcher(ws);
  // Help sits beside the settings gear, which main appends into this row.
  // It stays on this machine: a short note, no network.
  const help = iconButton(icon("circle-help"), "Help", () => {
    void confirmDialog({
      title: "Help",
      message: "This vault is a folder of markdown files on this computer. The gear next to this button opens settings.",
      confirm: "Close",
      cancel: false,
    });
  });
  const actions = h("div", { class: "workspace-drawer-vault-actions" }, help);
  const footer = h("div", { class: "workspace-sidedock-vault-profile" }, vaultSwitcher.el, actions);
  ws.on((change) => {
    if (change === "files") vaultSwitcher.sync();
  });

  const el = h(
    "div",
    { class: "workspace-split mod-sidedock mod-left-split" },
    tabs.header,
    tabs.content,
    footer,
  );
  select("files");
  return {
    el,
    select,
    /** Expand the folders above a path and scroll it into view. */
    reveal: explorer.reveal,
    collapseAll: explorer.collapseAll,
    expandAll: explorer.expandAll,
    /** Start an inline rename of a row. */
    renameInTree(path: string) {
      select("files");
      explorer.reveal(path);
      explorer.startRename(path);
    },
    /** Create an "Untitled" folder and start renaming it. */
    newFolderIn: (parent: string) => void explorer.newFolderIn(parent),
    /** Open the file list and put the keyboard ring on the active file. */
    focusFiles() {
      select("files");
      explorer.focusActive();
    },
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

/** A row's (or the list's) right-click menu. The row keeps an outline until the menu closes. */
function contextMenu(e: MouseEvent, items: MenuItems, row?: HTMLElement) {
  e.preventDefault();
  e.stopPropagation();
  showMenu(items, { x: e.clientX, y: e.clientY }, { highlight: row });
}

function createFileExplorer(ws: Workspace, menus: () => Menus) {
  const expanded = new Set<string>();
  // Expand all until something is opened. Closing folders by hand does not
  // flip it back; only Collapse all does. Same flag Obsidian keeps.
  let allCollapsed = true;
  let foldsVault = "";
  const rows = new Map<string, HTMLElement>();
  const openFolders = new Map<string, () => void>();
  const selected = new Set<string>();
  let anchor: string | null = null;
  /** Keyboard cursor. Independent of the open file (`is-active`) and the selection. */
  let cursor: string | null = null;
  const placed = new Map<string, { node: TreeNode; depth: number }>();
  let cancelDrag: (() => void) | undefined;
  const sorted = listeners();
  let sortOrder: SortOrder = "alphabetical";
  let autoReveal = false;
  const list = h("div", { class: "nav-files-container" });
  list.tabIndex = 0;

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
  // Starts as Expand all. The label follows `allCollapsed`, not whether a
  // folder happens to be open right now.
  const collapseButton = iconButton(icon("chevrons-up-down"), "Expand all", () =>
    commands.run(allCollapsed ? "file-explorer:expand-all" : "file-explorer:collapse-all"),
  );
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
      collapseButton,
    ),
  );

  function setSortOrder(order: SortOrder) {
    if (order === sortOrder) return;
    sortOrder = order;
    render();
    sorted.emit();
  }

  list.addEventListener("contextmenu", (e) => contextMenu(e, menus().vault()));
  // Bubble phase, so a drag's or menu's capturing Escape still wins.
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !selected.size || event.defaultPrevented) return;
    // An inline rename handles its own Escape. The editor is also contenteditable, and Escape there still clears the file selection.
    if ((event.target as HTMLElement | null)?.closest?.(".tree-item-inner[contenteditable]")) return;
    if (isMenuOpen() || isPromptOpen() || isConfirmOpen()) return;
    selected.clear();
    anchor = null;
    paintSelection();
  });

  function visiblePaths(): string[] {
    return [...list.querySelectorAll<HTMLElement>(".tree-item-self[data-path]")].map((row) => row.dataset.path!);
  }

  function paintSelection() {
    for (const [path, row] of rows) {
      row.classList.toggle("is-selected", selected.has(path));
      row.classList.toggle("is-focused", path === cursor);
    }
  }

  /** The pressed row's drag: every selected path when that row is part of a multi-selection. */
  function draggedPaths(entry: FileEntry): string[] {
    if (!selected.has(entry.path) || selected.size < 2) return [entry.path];
    const paths = visiblePaths().filter((path) => selected.has(path));
    return paths.length > 1 ? paths : [entry.path];
  }

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
      const label = entry.is_dir ? entry.name : noteName(entry.path).replace(/\.(canvas|base)$/i, "");
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
          class: `tree-item-self${entry.is_dir ? " nav-folder-title mod-collapsible" : " nav-file-title"}${selected.has(entry.path) ? " is-selected" : ""}`,
          "data-path": entry.path,
          onclick: (e: MouseEvent) => {
            if ((e.target as HTMLElement).isContentEditable) return;
            cursor = entry.path;
            const gesture = selectGesture(e);
            if (gesture === "toggle") {
              if (selected.has(entry.path)) selected.delete(entry.path);
              else selected.add(entry.path);
              anchor = entry.path;
              paintSelection();
              return;
            }
            if (gesture === "range") {
              for (const path of selectionRange(visiblePaths(), anchor, entry.path)) selected.add(path);
              paintSelection();
              return;
            }
            selected.clear();
            anchor = entry.path;
            paintSelection();
            if (entry.is_dir) toggleFolder(node, depth, folder!, chevron!);
            else void ws.open(entry.path, { where: whereFromEvent(e) });
          },
          onpointerdown: (e: PointerEvent) => {
            if (e.button !== 0 || (e.target as HTMLElement).isContentEditable) return;
            cancelDrag?.();
            cancelDrag = startTreeDrag(e, entry, list, ws, (path) => openFolders.get(path)?.(), draggedPaths(entry));
          },
          onauxclick: (e: MouseEvent) => {
            if (e.button === 1 && !entry.is_dir) void ws.open(entry.path, { where: "tab" });
          },
          oncontextmenu: (e: MouseEvent) => {
            const paths = selected.has(entry.path) && selected.size > 1 ? visiblePaths().filter((path) => selected.has(path)) : null;
            contextMenu(e, paths && paths.length > 1 ? menus().selection(paths) : menus().file(entry), self);
          },
        },
        chevron ?? (/\.base$/i.test(entry.path) ? h("div", { class: "tree-item-icon" }, icon("table", 14)) : /\.canvas$/i.test(entry.path) ? h("div", { class: "tree-item-icon" }, icon("layout-dashboard", 14)) : null),
        h("div", { class: "tree-item-inner" }, label),
        !entry.is_dir && !entry.path.endsWith(".md")
          ? h("div", { class: "nav-file-tag" }, entry.path.split(".").pop()!)
          : null,
      );
      self.style.setProperty("--depth", String(depth));
      rows.set(entry.path, self);
      placed.set(entry.path, { node, depth });
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
    if (open) {
      expanded.add(path);
      allCollapsed = false;
    } else expanded.delete(path);
    chevron.classList.toggle("is-collapsed", !open);
    syncCollapseButton();
    rememberFolds();
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
        const path = row.dataset.path!;
        if (rows.get(path) === row) {
          rows.delete(path);
          placed.delete(path);
        }
      }
      for (const field of box.querySelectorAll<HTMLElement>("[aria-invalid]")) fieldError(field, "");
      box.remove();
    });
  }

  function directoryPaths() {
    const paths: string[] = [];
    for (const file of ws.vault.files) if (file.is_dir) paths.push(file.path);
    return paths;
  }

  function pruneExpanded() {
    const dirs = new Set(directoryPaths());
    for (const path of [...expanded]) if (!dirs.has(path)) expanded.delete(path);
  }

  /** Expand all while nothing has been opened since the last Collapse all. */
  function syncCollapseButton() {
    collapseButton.replaceChildren(icon(allCollapsed ? "chevrons-up-down" : "chevrons-down-up"));
    collapseButton.setAttribute("aria-label", allCollapsed ? "Expand all" : "Collapse all");
  }

  const foldKey = (vault: string) => `grove.explorer-unfold:${vault}`;

  /** One read per vault. A reload opens the same folders again. */
  function loadFolds() {
    const vault = ws.vault.path;
    if (!vault || foldsVault === vault) return false;
    foldsVault = vault;
    expanded.clear();
    const saved = readStored(foldKey(vault), []);
    if (Array.isArray(saved)) {
      for (const path of saved) if (typeof path === "string" && path) expanded.add(path);
    }
    return true;
  }

  function rememberFolds() {
    const vault = ws.vault.path;
    if (!vault || foldsVault !== vault) return;
    store(foldKey(vault), [...expanded]);
  }

  /** Close every folder at every depth, at once, and show Expand all. */
  function collapseAll() {
    expanded.clear();
    allCollapsed = true;
    render();
  }

  /** Open every folder at every depth, at once (no slide). */
  function expandAll() {
    for (const path of directoryPaths()) expanded.add(path);
    allCollapsed = false;
    render();
  }

  function render() {
    cancelDrag?.();
    const live = new Set(ws.vault.files.map((file) => file.path));
    const previous = visiblePaths();
    const oldIndex = cursor == null ? -1 : previous.indexOf(cursor);
    for (const path of selected) if (!live.has(path)) selected.delete(path);
    if (anchor && !live.has(anchor)) anchor = null;
    if (cursor && !live.has(cursor)) {
      // The focus ring follows the nearest row that is still there. Selection
      // stays whatever survived the prune, so a move does not select a neighbour.
      cursor = previous.slice(Math.max(oldIndex, 0) + 1).find((path) => live.has(path))
        ?? [...previous.slice(0, Math.max(oldIndex, 0))].reverse().find((path) => live.has(path))
        ?? null;
    }
    const loaded = loadFolds();
    pruneExpanded();
    if (loaded) allCollapsed = expanded.size === 0;
    openFolders.clear();
    for (const field of list.querySelectorAll<HTMLElement>("[aria-invalid]")) fieldError(field, "");
    rows.clear();
    placed.clear();
    const frag = document.createDocumentFragment() as unknown as HTMLElement;
    renderNodes(buildTree(ws.vault.files, sortOrder), 0, frag);
    list.replaceChildren(frag);
    markActive();
    paintSelection();
    syncCollapseButton();
    rememberFolds();
  }

  let activeRow: HTMLElement | undefined;
  function markActive() {
    activeRow?.classList.remove("is-active");
    const path = ws.active.path ?? ws.active.viewFile;
    activeRow = path ? rows.get(path) : undefined;
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
    if (changed) allCollapsed = false;
    if (changed || !rows.has(path)) render();
    else syncCollapseButton();
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

  /** Keyboard ring on the open file, without changing which rows are selected. */
  function focusActive() {
    const path = ws.active.path ?? ws.active.viewFile;
    if (path) expandTo(path);
    if (path && rows.has(path)) {
      cursor = path;
      anchor = path;
      rows.get(path)?.scrollIntoView({ block: "nearest" });
    }
    list.focus({ preventScroll: true });
    paintSelection();
  }

  ws.onMove((swap) => {
    if (!expanded.size) return;
    const next = new Set<string>();
    for (const path of expanded) next.add(swap(path));
    expanded.clear();
    for (const path of next) expanded.add(path);
    rememberFolds();
  });

  ws.on((change) => {
    if (change === "files") render();
    if (change === "tabs") {
      const path = ws.active.path ?? ws.active.viewFile;
      if (autoReveal && path) reveal(path);
      else markActive();
    }
  });

  function parentPath(path: string): string | null {
    const parent = parentDir(path);
    return parent && rows.has(parent) ? parent : null;
  }

  function childPath(path: string): string | null {
    const visible = visiblePaths();
    const next = visible[visible.indexOf(path) + 1];
    return next && parentDir(next) === path ? next : null;
  }

  function focusPath(path: string) {
    cursor = path;
    anchor = path;
    paintSelection();
    rows.get(path)?.scrollIntoView({ block: "nearest" });
  }

  /** With no cursor yet, the first arrow lands on the active file, or the row it points at. */
  function moveCursor(delta: -1 | 1, extend: boolean) {
    const visible = visiblePaths();
    if (!visible.length) return;
    const index = cursor == null ? -1 : visible.indexOf(cursor);
    const active = ws.active.path ?? ws.active.viewFile;
    const landing = index < 0 && active && visible.includes(active) ? active : null;
    const from = index >= 0 ? index : delta > 0 ? -1 : visible.length;
    const next = landing ?? from + delta;
    if (typeof next === "number" && (next < 0 || next >= visible.length)) return;
    const path = typeof next === "string" ? next : visible[next]!;
    cursor = path;
    if (extend) {
      if (anchor == null || !visible.includes(anchor)) anchor = visible[from] ?? path;
      selected.clear();
      for (const item of selectionRange(visible, anchor, path)) selected.add(item);
    } else anchor = path;
    paintSelection();
    rows.get(path)?.scrollIntoView({ block: "nearest" });
  }

  function toggleCursor() {
    if (!cursor) return;
    const info = placed.get(cursor);
    const row = rows.get(cursor);
    if (!info?.node.entry.is_dir || !row) return;
    const chevron = row.querySelector<HTMLElement>(".collapse-icon");
    const folder = row.parentElement;
    if (chevron && folder) toggleFolder(info.node, info.depth, folder, chevron);
  }

  function openCursor() {
    if (!cursor) return;
    if (placed.get(cursor)?.node.entry.is_dir) toggleCursor();
    else void ws.open(cursor);
  }

  function landCursor() {
    if (cursor && rows.has(cursor)) return;
    const visible = visiblePaths();
    const active = ws.active.path ?? ws.active.viewFile;
    cursor =
      (anchor && selected.has(anchor) && rows.has(anchor) ? anchor : null) ??
      visible.find((path) => selected.has(path)) ??
      (active && rows.has(active) ? active : null) ??
      visible[0] ??
      null;
  }

  async function deleteSelection() {
    const visible = visiblePaths();
    const picked = selected.size ? visible.filter((path) => selected.has(path)) : cursor ? [cursor] : [];
    const items = topLevelPaths(picked, (path) => ws.vault.isFolder(path));
    if (!items.length) return;
    if (picked.length === 1) {
      await deleteFile(ws, items[0]!);
      return;
    }
    const where = fileSettings.permanentDelete() ? "They will be permanently deleted." : "They will be moved to the vault's .trash folder.";
    const answer = await confirmDialog({
      title: "Delete",
      message: `Are you sure you want to delete ${picked.length} items? ${where}`,
      confirm: "Delete",
      warning: true,
    });
    if (!answer.ok) return;
    for (const path of items) await deleteFile(ws, path, { confirmed: true });
  }

  const typingTarget = (target: EventTarget | null) => (target as HTMLElement | null)?.closest?.("[contenteditable], input, textarea");
  list.addEventListener("pointerdown", (event) => {
    if (typingTarget(event.target)) return;
    if (document.activeElement !== list) list.focus({ preventScroll: true });
  });
  list.addEventListener("focus", () => {
    landCursor();
    paintSelection();
  });
  list.addEventListener("keydown", (event) => {
    if (typingTarget(event.target) || isMenuOpen() || isPromptOpen() || isConfirmOpen()) return;
    const info = cursor ? placed.get(cursor) : undefined;
    const entry = info?.node.entry;
    const action = treeKeyAction(event.key, event, info && entry ? {
      isFolder: entry.is_dir,
      expanded: expanded.has(entry.path),
      hasParent: parentPath(entry.path) != null,
      hasChild: entry.is_dir && info.node.children.length > 0,
    } : null);
    if (!action) return;
    event.preventDefault();
    if (action.type === "move") moveCursor(action.delta, action.extend);
    else if (action.type === "expand" || action.type === "collapse") toggleCursor();
    else if (action.type === "child") {
      const next = cursor ? childPath(cursor) : null;
      if (next) focusPath(next);
    } else if (action.type === "parent") {
      const next = cursor ? parentPath(cursor) : null;
      const onFile = !!cursor && placed.get(cursor)?.node.entry.is_dir === false;
      if (next) {
        if (onFile && expanded.has(next)) {
          const parent = placed.get(next);
          const row = rows.get(next);
          const chevron = row?.querySelector<HTMLElement>(".collapse-icon");
          const folder = row?.parentElement;
          if (parent && chevron && folder) toggleFolder(parent.node, parent.depth, folder, chevron);
        }
        focusPath(next);
      }
    } else if (action.type === "open") openCursor();
    else void deleteSelection();
  });

  return {
    el: h("div", { class: "nav-files" }, actions, list),
    reveal,
    focusActive,
    collapseAll,
    expandAll,
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
            oncontextmenu: (e: MouseEvent) => contextMenu(e, menus().file(entry), row),
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
