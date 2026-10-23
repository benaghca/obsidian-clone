// Every menu in the app, built to Obsidian's item order, grouping and icons
// (observed side by side in Obsidian 1.14.4; items Grove can't do are left
// out rather than shown dead; see rebuild/SPLITS_PANES_NOTES.md for the
// comparison). Items that are commands come from the registry, so they carry
// the command's icon, hotkey and availability.

import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { api, type FileEntry } from "../api";
import type { Bookmarks } from "../bookmarks";
import { commands } from "../commands";
import { copyImage, copySelection, paste, writeClipboard } from "../editor/clipboard";
import { IMAGE_EXT, resetSize } from "../editor/embeds";
import type { ImageRef } from "../editor/host";
import { linkAt } from "../editor/linkAt";
import { editTable, type TableOp, tableModel, tableOps } from "../editor/tables";
import { copyNote, deleteFile, newCanvas } from "../fileOps";
import { noteName, systemPath } from "../paths";
import { type Group, linkedWith, type Tab, tabTitle, viewIcon } from "../tabs";
import type { Workspace } from "../workspace";
import { type MenuEntry, type MenuItems, SEPARATOR } from "./menu";
import { pickFrom } from "./prompt";

interface MenuHost {
  ws: Workspace;
  bookmarks: Bookmarks;
  /** Start an inline rename of a file or folder in the file explorer. */
  renameInTree(path: string): void;
  /** Start renaming the open note (its inline title). */
  renameActive(): void;
  newNoteIn(folder: string): void;
  newFolderIn(folder: string): void;
  moveFile(path: string): void;
  /** Pick a note to merge this one into (Obsidian's Note composer). */
  mergeFile(path: string): void;
  /** "Link with tab...": pick the pane whose tab this one links with. */
  linkTab(tab: Tab): void;
  revealInTree(path: string): void;
  /** Show the search view limited to a folder. */
  searchInFolder(folder: string): void;
}

const warn = (what: string) => (err: unknown) => console.warn(`Could not ${what}`, err);

export function createMenus(host: MenuHost) {
  const { ws, bookmarks } = host;

  /** "Copy path" with Obsidian's two choices. */
  function copyPath(path: string): MenuEntry {
    return {
      title: "Copy path",
      icon: "clipboard",
      submenu: [
        { title: "From vault folder", action: () => writeClipboard(path) },
        { title: "From system root", action: () => writeClipboard(systemPath(ws.vault.path, path)) },
      ],
    };
  }

  // A core plugin that is off takes its menu items with it.
  const on = (plugin: string) => commands.pluginEnabled(plugin);

  // Obsidian's "Bookmark..." opens a dialog; Grove bookmarks at once, so no ellipsis.
  function bookmarkItem(path: string): MenuEntry | false {
    if (!on("bookmarks")) return false;
    return bookmarks.has(path)
      ? { title: "Remove bookmark", icon: "bookmark-minus", action: () => bookmarks.toggle(path) }
      : { title: "Bookmark", icon: "bookmark", action: () => bookmarks.toggle(path) };
  }

  const deleteItem = (path: string, title = "Delete"): MenuEntry => ({
    title,
    icon: "trash-2",
    danger: true,
    action: () => deleteFile(ws, path).catch(warn(`delete ${path}`)),
  });

  const renameItem = (action: () => void): MenuEntry => ({ title: "Rename...", icon: "pen-line", action });
  const moveItem = (path: string, folder = false): MenuEntry => ({
    title: folder ? "Move folder to..." : "Move file to...",
    icon: "folder-tree",
    action: () => host.moveFile(path),
  });
  const mergeItem = (path: string): MenuEntry | false =>
    on("note-composer") && { title: "Merge entire file with...", icon: "git-merge", action: () => host.mergeFile(path) };
  const revealItem = (path: string): MenuEntry => ({ title: "Reveal file in navigation", icon: "folder-open", action: () => host.revealInTree(path) });
  const openItems = (open: (where: "tab" | "right") => void): MenuEntry[] => [
    { title: "Open in new tab", icon: "file-plus", action: () => open("tab") },
    { title: "Open to the right", icon: "separator-vertical", action: () => open("right") },
  ];
  const openFile = (path: string) => openItems((where) => void ws.open(path, { where }));
  const splitItems = (t: Tab) => [
    commands.menuItem("workspace:split-vertical", { action: () => ws.split(t, "right") }),
    commands.menuItem("workspace:split-horizontal", { action: () => ws.split(t, "bottom") }),
  ];
  const openInNewWindow = (path: string): MenuEntry => ({
    title: "Open in new window",
    icon: "picture-in-picture-2",
    action: () => void api.openNoteWindow(path).catch(warn(`open ${path} in a new window`)),
  });

  /** File explorer (and bookmarks): right-click on a note, a folder, or the empty space. */
  function file(entry: FileEntry): MenuItems {
    const { path } = entry;
    if (entry.is_dir) {
      return [
        { title: "New note", icon: "square-pen", action: () => host.newNoteIn(path) },
        { title: "New folder", icon: "folder-plus", action: () => host.newFolderIn(path) },
        { title: "New canvas", icon: "layout-dashboard", action: () => newCanvas(ws, path) },
        SEPARATOR,
        moveItem(path, true),
        { title: "Search in folder", icon: "folder-search", action: () => host.searchInFolder(path) },
        bookmarkItem(path),
        SEPARATOR,
        copyPath(path),
        SEPARATOR,
        renameItem(() => host.renameInTree(path)),
        deleteItem(path),
      ];
    }
    const isNote = path.endsWith(".md");
    return [
      ...(isNote ? [...openFile(path), openInNewWindow(path)] : []),
      SEPARATOR,
      isNote && { title: "Make a copy", icon: "files", action: () => copyNote(ws, path).catch(warn(`copy ${path}`)) },
      moveItem(path),
      bookmarkItem(path),
      isNote && mergeItem(path),
      SEPARATOR,
      copyPath(path),
      SEPARATOR,
      isNote && renameItem(() => host.renameInTree(path)),
      deleteItem(path),
    ];
  }

  function vault(): MenuItems {
    return [
      { title: "New note", icon: "square-pen", action: () => host.newNoteIn("") },
      { title: "New folder", icon: "folder-plus", action: () => host.newFolderIn("") },
      { title: "New canvas", icon: "layout-dashboard", action: () => newCanvas(ws, "") },
    ];
  }

  /**
   * The editor's right-click menu. On an internal link: where to open it,
   * then the usual items, then the linked note's file items. On an external
   * link: open and copy the URL first.
   */
  function editor(view: EditorView, pos: number): MenuItems {
    const group = ws.editors.groupOfView(view) ?? ws.activeGroup;
    const reading = group.active.mode === "reading";
    const hasSelection = view.state.selection.ranges.some((r) => !r.empty);
    const link = linkAt(view.state, pos);
    const table = !reading && tableModel(view.state, pos);
    const cmd = (id: string, overrides?: Partial<MenuEntry>) => commands.menuItem(id, overrides);
    const linked = link?.kind === "internal" ? ws.resolve(link.target) : null;
    const linkItems: MenuItems = !link
      ? []
      : link.kind === "internal"
        ? [
            ...openItems((where) => void ws.openLink(link.target, where, group)),
            !!linked && openInNewWindow(linked),
          ]
        : [
            { title: "Open link", icon: "external-link", action: () => api.openExternal(link.url).catch(warn(`open ${link.url}`)) },
            { title: "Copy URL", icon: "copy", action: () => writeClipboard(link.url) },
          ];
    const editLink: MenuEntry | false = link?.kind === "internal" && !reading && {
      title: "Edit link",
      icon: "text-cursor-input",
      action: () => {
        view.focus();
        view.dispatch({ selection: { anchor: link.from, head: link.to } });
      },
    };
    return [
      ...linkItems,
      SEPARATOR,
      !reading && cmd("editor:insert-wikilink", { title: "Add link", icon: "link" }),
      !reading && cmd("editor:insert-link", { title: "Add external link", icon: "external-link" }),
      SEPARATOR,
      editLink,
      !reading &&
        link?.kind !== "internal" && {
          title: "Format",
          icon: "paintbrush",
          // Obsidian's short labels here; the palette has the full command names.
          submenu: () => [
            cmd("editor:toggle-bold", { title: "Bold" }),
            cmd("editor:toggle-italics", { title: "Italic" }),
            cmd("editor:toggle-strikethrough", { title: "Strikethrough" }),
            cmd("editor:toggle-highlight", { title: "Highlight" }),
            SEPARATOR,
            cmd("editor:toggle-code", { title: "Code" }),
            cmd("editor:toggle-inline-math", { title: "Math" }),
            cmd("editor:toggle-comments", { title: "Comment" }),
            SEPARATOR,
            cmd("editor:clear-formatting"),
          ],
        },
      !reading && {
        title: "Paragraph",
        icon: "pilcrow",
        disabled: !!table,
        submenu: () => [
          cmd("editor:toggle-bullet-list", { title: "Bullet list" }),
          cmd("editor:toggle-numbered-list", { title: "Numbered list" }),
          cmd("editor:toggle-task-list", { title: "Task list", icon: "square-check-big" }),
          SEPARATOR,
          ...[1, 2, 3, 4, 5, 6].map((n) => cmd(`editor:set-heading-${n}`, { title: `Heading ${n}` })),
          cmd("editor:set-heading-0", { title: "Body", icon: "text-align-start" }),
          SEPARATOR,
          cmd("editor:toggle-blockquote", { title: "Quote" }),
        ],
      },
      !reading && {
        title: "Insert",
        icon: "list-plus",
        disabled: !!table,
        submenu: () => [
          cmd("editor:insert-footnote", { title: "Footnote" }),
          cmd("editor:insert-table", { title: "Table" }),
          cmd("editor:insert-callout", { title: "Callout", icon: "quote" }),
          cmd("editor:insert-horizontal-rule", { title: "Horizontal rule", icon: "minus" }),
          SEPARATOR,
          cmd("editor:insert-codeblock", { title: "Code block", icon: "code" }),
          cmd("editor:insert-mathblock", { title: "Math block" }),
        ],
      },
      SEPARATOR,
      !reading && { title: "Cut", icon: "scissors", disabled: !hasSelection, action: () => copySelection(view, true).catch(warn("cut")) },
      { title: "Copy", icon: "copy", disabled: !hasSelection, action: () => copySelection(view, false).catch(warn("copy")) },
      !reading && { title: "Paste", icon: "clipboard-check", action: () => void paste(view, false) },
      !reading && { title: "Paste as plain text", icon: "clipboard-type", action: () => void paste(view, true) },
      {
        title: "Select all",
        icon: "square-dashed",
        action: () => {
          view.focus();
          view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        },
      },
      ...(table ? tableItems(view, pos, table) : []),
      ...(linked
        ? [
            SEPARATOR,
            copyPath(linked),
            SEPARATOR,
            renameItem(() => host.renameInTree(linked)),
            moveItem(linked),
            bookmarkItem(linked),
            SEPARATOR,
            revealItem(linked),
          ]
        : []),
    ];
  }

  /** Right-click on an image in a note (Obsidian's image menu, without Open in default app and Show in system explorer, as everywhere in Grove). */
  function image(view: EditorView, { path, img, from, to, sizeAt, sizeText }: ImageRef): MenuItems {
    const edit = !view.state.readOnly;
    const reset = resetSize(view.state.sliceDoc(from, to), sizeAt, sizeText);
    const replace = (start: number, end: number, insert: string) => view.dispatch({ changes: { from: start, to: end, insert }, userEvent: "input" });
    // Swap: another image in its place, linked as the link settings say, keeping its alt text or alias and size.
    const swap = () => {
      const images = ws.vault.files.filter((f) => IMAGE_EXT.test(f.path) && f.path !== path).map((f) => f.path);
      pickFrom(images, (p) => p, {
        placeholder: "Choose a file...",
        emptyText: "No images found.",
        enter: "to select",
        choose: (p) => replace(from, to, "!" + ws.linkTo(p, ws.editors.pathOf(view), sizeText ?? undefined)),
      });
    };
    return [
      { title: "Copy image", icon: "copy", action: () => void copyImage(img).catch(warn("copy the image")) },
      edit && { title: "Swap file...", icon: "arrow-left-right", action: swap },
      edit && { title: "Remove image", icon: "image-minus", action: () => replace(from, to, "") },
      edit && { title: "Reset size", icon: "rotate-ccw", disabled: !reset, action: () => reset && replace(from + reset.from, from + reset.to, reset.insert) },
      SEPARATOR,
      ...openFile(path),
      openInNewWindow(path),
      SEPARATOR,
      renameItem(() => host.renameInTree(path)),
      moveItem(path),
      bookmarkItem(path),
      SEPARATOR,
      copyPath(path),
      SEPARATOR,
      revealItem(path),
      SEPARATOR,
      deleteItem(path, "Delete image"),
    ];
  }

  /** A table's rows and columns (Obsidian's table menu, at the end of the editor's). */
  function tableItems(view: EditorView, pos: number, { table: model, cell }: NonNullable<ReturnType<typeof tableModel>>): MenuItems {
    // An item that can't apply here (Move row up on the header) isn't shown, as in Obsidian.
    const item = (title: string, icon: MenuEntry["icon"], op: TableOp): MenuEntry | false =>
      !!op(model, cell) && { title, icon, action: () => void editTable(view, op, false, pos) };
    const ops = tableOps;
    return [
      SEPARATOR,
      {
        title: "Row",
        icon: "table",
        submenu: () => [
          item("Add row above", "panel-top-close", ops.rowAbove),
          item("Add row below", "panel-bottom-close", ops.rowBelow),
          SEPARATOR,
          item("Move row up", "arrow-up", ops.moveRowUp),
          item("Move row down", "arrow-down", ops.moveRowDown),
          SEPARATOR,
          item("Duplicate row", "copy", ops.duplicateRow),
          item("Delete row", "trash-2", ops.deleteRow),
        ],
      },
      {
        title: "Column",
        icon: "table",
        submenu: () => [
          item("Add column to the left", "panel-left-close", ops.colLeft),
          item("Add column to the right", "panel-right-close", ops.colRight),
          SEPARATOR,
          item("Move column left", "arrow-left", ops.moveColLeft),
          item("Move column right", "arrow-right", ops.moveColRight),
          SEPARATOR,
          item("Align left", "text-align-start", ops.alignLeft),
          item("Align center", "text-align-center", ops.alignCenter),
          item("Align right", "text-align-end", ops.alignRight),
          SEPARATOR,
          item("Duplicate column", "copy", ops.duplicateCol),
          item("Delete column", "trash-2", ops.deleteCol),
        ],
      },
      SEPARATOR,
      item("Sort by column (A to Z)", "arrow-down-a-z", ops.sortAsc),
      item("Sort by column (Z to A)", "arrow-up-z-a", ops.sortDesc),
    ];
  }

  /**
   * The file and view items shared by the active tab's menu and "More
   * options": view modes, splits, file actions, find, linked views.
   */
  function viewItems(tab: Tab, path: string, tabMenu = false): MenuItems {
    const reading = tab.mode === "reading";
    const onTab = (fn: () => void) => () => {
      ws.activate(tab);
      fn();
    };
    const linkedViews = [
      on("backlink") && commands.menuItem("backlink:open", { title: "Open backlinks" }),
      on("outgoing-link") && commands.menuItem("outgoing-links:open", { title: "Open outgoing links" }),
      on("tag-pane") && commands.menuItem("tag-pane:open", { title: "Open tags" }),
      on("graph") && commands.menuItem("graph:open-local", { title: "Open local graph", action: onTab(() => commands.run("graph:open-local")) }),
      on("outline") && commands.menuItem("outline:open", { title: "Open outline" }),
    ].filter((x): x is MenuEntry => !!x);
    return [
      on("backlink") && {
        title: "Backlinks in document",
        icon: "link",
        checked: tab.backlinks,
        action: () => ws.toggleBacklinks(tab),
      },
      commands.menuItem("markdown:toggle-preview", {
        title: reading ? "Editing view" : "Reading view",
        icon: reading ? "pen-line" : "book-open",
        action: onTab(() => commands.run("markdown:toggle-preview")),
      }),
      !reading &&
        commands.menuItem("editor:toggle-source", {
          title: "Source mode",
          icon: "code-xml",
          checked: tab.mode === "source",
          action: onTab(() => commands.run("editor:toggle-source")),
        }),
      SEPARATOR,
      // The tab's own menu can also move it (Obsidian's tab menu has this; More options doesn't).
      tabMenu && commands.menuItem("workspace:move-to-new-window", { title: "Move to new window", action: () => void ws.moveToWindow(tab).catch(warn(`move ${path} to a new window`)) }),
      ...splitItems(tab),
      openInNewWindow(path),
      SEPARATOR,
      renameItem(onTab(() => host.renameActive())),
      moveItem(path),
      bookmarkItem(path),
      mergeItem(path),
      commands.menuItem("markdown:add-metadata-property", { action: onTab(() => commands.run("markdown:add-metadata-property")) }),
      commands.menuItem("workspace:export-pdf", { action: onTab(() => commands.run("workspace:export-pdf")) }),
      SEPARATOR,
      !reading && { title: "Find...", icon: "file-search", hotkey: commands.hotkey("editor:open-search"), action: onTab(() => openSearchPanel(ws.view)) },
      !reading && commands.menuItem("editor:open-search-replace", { title: "Replace...", icon: "file-search", action: onTab(() => commands.run("editor:open-search-replace")) }),
      SEPARATOR,
      copyPath(path),
      SEPARATOR,
      linkedViews.length > 0 && { title: "Open linked view", icon: "link", submenu: () => linkedViews },
      SEPARATOR,
      revealItem(path),
      SEPARATOR,
      deleteItem(path, "Delete file"),
    ];
  }

  /**
   * Right-click on a tab header. Like Obsidian's, every tab gets the close
   * and pin items; the active tab of its group also gets the view, split and
   * file items.
   */
  function tab(t: Tab): MenuItems {
    const group = ws.groupOf(t);
    const tabs = group?.tabs ?? [t];
    const i = tabs.indexOf(t);
    const others = tabs.some((o) => o !== t && !o.pinned);
    const after = tabs.slice(i + 1).some((o) => !o.pinned);
    const isActive = group?.active === t;
    return [
      { title: "Close", icon: "x", hotkey: t === ws.active ? commands.hotkey("workspace:close") : undefined, action: () => ws.closeTab(t) },
      { title: "Close others", icon: "x", disabled: !others, action: () => ws.closeOthers(t) },
      { title: "Close tabs after", icon: "x", disabled: !after, action: () => ws.closeToRight(t) },
      { title: "Close all", icon: "x", action: () => ws.closeAll(group) },
      SEPARATOR,
      t.pinned ? { title: "Unpin", icon: "pin-off", action: () => ws.togglePin(t) } : { title: "Pin", icon: "pin", action: () => ws.togglePin(t) },
      linkedWith(t, ws.layout.tabs()).length
        ? { title: "Unlink tab", icon: "link", action: () => ws.setLink(t, null) }
        : { title: "Link with tab...", icon: "link", action: () => host.linkTab(t) },
      ...(isActive && t.path ? viewItems(t, t.path, true) : []),
      ...(isActive && !t.path ? [SEPARATOR, ...(t.type ? graphViewItems(t) : splitItems(t))] : []),
    ];
  }

  /** The tab bar's chevron: actions on the group's tabs, then the tabs. */
  function tabList(group: Group = ws.activeGroup): MenuItems {
    const notes = [...new Set(group.tabs.flatMap((t) => (t.path ? [t.path] : [])))];
    const unmarked = notes.filter((p) => !bookmarks.has(p));
    return [
      on("bookmarks") &&
        unmarked.length > 0 && {
        title: `Bookmark ${unmarked.length} ${unmarked.length === 1 ? "tab" : "tabs"}`,
        icon: "bookmark",
        action: () => unmarked.forEach((p) => bookmarks.toggle(p)),
      },
      SEPARATOR,
      { title: "Close all", icon: "x", action: () => ws.closeAll(group) },
      SEPARATOR,
      ...group.tabs.map(
        (t): MenuEntry => ({
          title: tabTitle(t),
          icon: viewIcon(t) ?? (t.path ? "file-text" : "file"),
          checked: t === group.active,
          action: () => ws.activate(t),
        }),
      ),
    ];
  }

  /** A graph tab's view items: splits, and the local graph's note. */
  function graphViewItems(t: Tab): MenuItems {
    const file = t.type === "localgraph" ? t.viewFile : null;
    return [
      ...splitItems(t),
      SEPARATOR,
      !!file && { title: `Open ${noteName(file)}`, icon: "file-text", action: () => void ws.open(file, { where: "tab" }) },
      !!file && revealItem(file),
    ];
  }

  /** The view header's "More options" (three dots), for the active pane. */
  function moreOptions(): MenuItems {
    const t = ws.active;
    if (t.type) return graphViewItems(t);
    return t.path ? viewItems(t, t.path) : [];
  }

  /**
   * Right-click on a node in the graph (observed in Obsidian 1.14.4: the
   * note's name, then where to open it and the file items).
   */
  function graphNode(path: string): MenuItems {
    return [
      { title: noteName(path), label: true },
      SEPARATOR,
      ...openFile(path),
      SEPARATOR,
      moveItem(path),
      bookmarkItem(path),
      mergeItem(path),
      SEPARATOR,
      copyPath(path),
      SEPARATOR,
      on("graph") && { title: "Open local graph", icon: "git-fork", action: () => ws.openView("localgraph", "right", path) },
      revealItem(path),
      SEPARATOR,
      deleteItem(path, "Delete file"),
    ];
  }

  return { file, vault, editor, image, tab, tabList, moreOptions, graphNode };
}

export type Menus = ReturnType<typeof createMenus>;
