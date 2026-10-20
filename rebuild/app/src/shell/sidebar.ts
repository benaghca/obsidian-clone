// Left sidebar: icon tabs (Files / Search / Bookmarks), the file explorer,
// and the vault name footer.

import { api, type FileEntry } from "../api";
import { slideHeight } from "../motion";
import { noteName, type Workspace } from "../workspace";
import { h, iconButton } from "./dom";
import { icon, type IconName } from "./icons";
import { showMenu } from "./menu";

export function createSidebar(ws: Workspace, newNote: () => void): HTMLElement {
  const views = {
    files: createFileExplorer(ws, newNote),
    search: createSearchView(ws),
    bookmarks: h("div", { class: "pane-empty" }, "No bookmarks yet."),
  };
  type ViewName = keyof typeof views;
  const tabButtons = new Map<ViewName, HTMLElement>();
  const content = h("div", { class: "workspace-leaf-content" });

  const tab = (name: ViewName, iconName: IconName, label: string) => {
    const button = iconButton(icon(iconName, 16), label, () => select(name), "workspace-tab-header");
    tabButtons.set(name, button);
    return button;
  };

  function select(name: ViewName) {
    for (const [n, b] of tabButtons) b.classList.toggle("is-active", n === name);
    content.replaceChildren(views[name]);
    if (name === "search") views.search.querySelector("input")?.focus();
  }

  const vaultName = h("div", { class: "workspace-drawer-vault-name" });
  ws.on((change) => {
    if (change === "files") vaultName.textContent = ws.vault.name;
  });

  const sidebar = h(
    "div",
    { class: "workspace-split mod-left-split" },
    h(
      "div",
      { class: "workspace-tab-header-container", "data-tauri-drag-region": "" },
      tab("files", "files", "Files"),
      tab("search", "search", "Search"),
      tab("bookmarks", "bookmark", "Bookmarks"),
    ),
    content,
    h(
      "div",
      { class: "workspace-sidedock-vault-profile" },
      vaultName,
      h(
        "div",
        { class: "vault-profile-actions" },
        iconButton(icon("help-circle", 16), "Help is not available yet", undefined, "is-disabled"),
        iconButton(icon("settings", 16), "Settings are not available yet", undefined, "is-disabled"),
      ),
    ),
  );
  select("files");
  return sidebar;
}

interface TreeNode {
  entry: FileEntry;
  children: TreeNode[];
}

function buildTree(files: FileEntry[]): TreeNode[] {
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
  const order = (nodes: TreeNode[]) => {
    nodes.sort(
      (a, b) =>
        Number(b.entry.is_dir) - Number(a.entry.is_dir) ||
        a.entry.name.localeCompare(b.entry.name, undefined, { numeric: true, sensitivity: "base" }),
    );
    for (const n of nodes) order(n.children);
  };
  order(root);
  return root;
}

function createFileExplorer(ws: Workspace, newNote: () => void): HTMLElement {
  const expanded = new Set<string>();
  const rows = new Map<string, HTMLElement>();
  const list = h("div", { class: "nav-files-container" });

  const actions = h(
    "div",
    { class: "nav-header" },
    h(
      "div",
      { class: "nav-buttons-container" },
      iconButton(icon("square-pen", 16), "New note", newNote),
      iconButton(icon("chevrons-down-up", 16), "Collapse all", collapseAll),
    ),
  );

  function fileMenu(e: MouseEvent, entry: FileEntry) {
    e.preventDefault();
    const items = entry.is_dir
      ? [{ title: "Delete", danger: true, action: () => void ws.remove(entry.path) }]
      : [
          { title: "Open in new tab", action: () => void ws.open(entry.path, { newTab: true }) },
          { title: "Rename...", action: () => startRename(entry) },
          { title: "Delete", danger: true, action: () => void ws.remove(entry.path) },
        ];
    showMenu(items, e.clientX, e.clientY);
  }

  function startRename(entry: FileEntry) {
    const label = rows.get(entry.path)?.querySelector<HTMLElement>(".tree-item-inner");
    if (!label) return;
    label.contentEditable = "plaintext-only";
    label.focus();
    getSelection()?.selectAllChildren(label);
    const finish = (commit: boolean) => {
      label.contentEditable = "false";
      const name = label.textContent ?? "";
      label.textContent = noteName(entry.path);
      if (commit) ws.rename(entry.path, name).catch((err) => console.warn(err));
    };
    label.addEventListener("blur", () => finish(true), { once: true });
    label.onkeydown = (ev) => {
      if (ev.key === "Enter" || ev.key === "Escape") {
        ev.preventDefault();
        label.onkeydown = null;
        if (ev.key === "Escape") label.textContent = noteName(entry.path);
        label.blur();
      }
    };
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
            if (entry.is_dir) toggleFolder(node, depth, folder!, chevron!);
            else if (!(e.target as HTMLElement).isContentEditable) {
              void ws.open(entry.path, { newTab: e.ctrlKey || e.metaKey });
            }
          },
          onauxclick: (e: MouseEvent) => {
            if (e.button === 1 && !entry.is_dir) void ws.open(entry.path, { newTab: true });
          },
          oncontextmenu: (e: MouseEvent) => fileMenu(e, entry),
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
    renderNodes(buildTree(ws.files), 0, frag);
    list.replaceChildren(frag);
    markActive();
  }

  let activeRow: HTMLElement | undefined;
  function markActive() {
    activeRow?.classList.remove("is-active");
    activeRow = ws.active.path ? rows.get(ws.active.path) : undefined;
    activeRow?.classList.add("is-active");
  }

  ws.on((change) => {
    if (change === "files") render();
    if (change === "tabs") {
      // Reveal the active note's folder, as Obsidian does.
      const path = ws.active.path;
      if (path && !rows.has(path)) {
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join("/"));
        render();
      } else markActive();
    }
  });

  return h("div", { class: "nav-files" }, actions, list);
}

function createSearchView(ws: Workspace): HTMLElement {
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

  return h("div", { class: "search-view" }, h("div", { class: "search-input-container" }, input), results);
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
