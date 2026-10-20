// Every menu in the app, built to Obsidian's item order and grouping
// (observed in Obsidian; items Grove can't do yet are left out rather than
// shown dead; see rebuild/ICONS_MENUS_NOTES.md for the comparison). Items
// that are commands come from the registry, so they carry the command's
// icon, hotkey and availability.

import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { api, type FileEntry } from "../api";
import type { Bookmarks } from "../bookmarks";
import { commands } from "../commands";
import { copySelection, paste } from "../editor/clipboard";
import { linkAt } from "../editor/linkAt";
import { noteName, type Tab, type Workspace } from "../workspace";
import { type MenuEntry, type MenuItems, SEPARATOR } from "./menu";

export interface MenuHost {
  ws: Workspace;
  bookmarks: Bookmarks;
  /** Start an inline rename of a file or folder in the file explorer. */
  renameInTree(path: string): void;
  /** Start renaming the open note (its inline title). */
  renameActive(): void;
  newNoteIn(folder: string): void;
  newFolderIn(folder: string): void;
  moveFile(path: string): void;
  revealInTree(path: string): void;
}

const warn = (what: string) => (err: unknown) => console.warn(`Could not ${what}`, err);

export function createMenus(host: MenuHost) {
  const { ws, bookmarks } = host;

  function copyText(text: string) {
    navigator.clipboard.writeText(text).catch(warn("copy to the clipboard"));
  }

  /** "Copy path" with Obsidian's two choices. */
  function copyPath(path: string): MenuEntry {
    const sep = ws.vault.path.includes("\\") ? "\\" : "/";
    return {
      title: "Copy path",
      icon: "copy",
      submenu: [
        { title: "From vault folder", action: () => copyText(path) },
        { title: "From system root", action: () => copyText(`${ws.vault.path}${sep}${path.split("/").join(sep)}`) },
      ],
    };
  }

  function bookmarkItem(path: string): MenuEntry {
    return bookmarks.has(path)
      ? { title: "Remove bookmark", icon: "bookmark-minus", action: () => bookmarks.toggle(path) }
      : { title: "Bookmark", icon: "bookmark", action: () => bookmarks.toggle(path) };
  }

  const deleteItem = (path: string, title = "Delete"): MenuEntry => ({
    title,
    icon: "trash",
    danger: true,
    action: () => ws.remove(path).catch(warn(`delete ${path}`)),
  });

  /** File explorer (and bookmarks): right-click on a note, a folder, or the empty space. */
  function file(entry: FileEntry): MenuItems {
    const { path } = entry;
    if (entry.is_dir) {
      return [
        { title: "New note", icon: "square-pen", action: () => host.newNoteIn(path) },
        { title: "New folder", icon: "folder-plus", action: () => host.newFolderIn(path) },
        SEPARATOR,
        { title: "Move folder to...", icon: "folder-input", action: () => host.moveFile(path) },
        bookmarkItem(path),
        SEPARATOR,
        copyPath(path),
        SEPARATOR,
        { title: "Rename...", icon: "pencil", action: () => host.renameInTree(path) },
        deleteItem(path),
      ];
    }
    const isNote = path.endsWith(".md");
    return [
      isNote && { title: "Open in new tab", icon: "file-plus", action: () => void ws.open(path, { newTab: true }) },
      SEPARATOR,
      isNote && { title: "Make a copy", icon: "files", action: () => ws.makeCopy(path).catch(warn(`copy ${path}`)) },
      { title: "Move file to...", icon: "folder-input", action: () => host.moveFile(path) },
      bookmarkItem(path),
      SEPARATOR,
      copyPath(path),
      SEPARATOR,
      isNote && { title: "Rename...", icon: "pencil", action: () => host.renameInTree(path) },
      deleteItem(path),
    ];
  }

  function vault(): MenuItems {
    return [
      { title: "New note", icon: "square-pen", action: () => host.newNoteIn("") },
      { title: "New folder", icon: "folder-plus", action: () => host.newFolderIn("") },
    ];
  }

  /** The editor's right-click menu: link actions first when on a link, then formatting, then the clipboard. */
  function editor(view: EditorView, pos: number): MenuItems {
    const reading = ws.active.mode === "reading";
    const hasSelection = view.state.selection.ranges.some((r) => !r.empty);
    const link = linkAt(view.state, pos);
    const linkItems: MenuItems = !link
      ? []
      : link.kind === "internal"
        ? [
            { title: "Open link", icon: "file-text", action: () => void ws.openLink(link.target) },
            { title: "Open in new tab", icon: "file-plus", action: () => void ws.openLink(link.target, true) },
          ]
        : [
            { title: "Open link", icon: "external-link", action: () => api.openExternal(link.url).catch(warn(`open ${link.url}`)) },
            { title: "Copy URL", icon: "copy", action: () => copyText(link.url) },
          ];
    const cmd = (id: string) => commands.menuItem(id);
    return [
      ...linkItems,
      SEPARATOR,
      !reading && !link && cmd("editor:insert-wikilink"),
      !reading && !link && cmd("editor:insert-link"),
      SEPARATOR,
      !reading && {
        title: "Format",
        icon: "type",
        submenu: () => [
          cmd("editor:toggle-bold"),
          cmd("editor:toggle-italics"),
          cmd("editor:toggle-strikethrough"),
          cmd("editor:toggle-highlight"),
          cmd("editor:toggle-code"),
          cmd("editor:toggle-inline-math"),
          cmd("editor:toggle-comments"),
          SEPARATOR,
          cmd("editor:clear-formatting"),
        ],
      },
      !reading && {
        title: "Paragraph",
        icon: "pilcrow",
        submenu: () => [
          cmd("editor:toggle-bullet-list"),
          cmd("editor:toggle-numbered-list"),
          cmd("editor:toggle-task-list"),
          SEPARATOR,
          ...[1, 2, 3, 4, 5, 6].map((n) => cmd(`editor:set-heading-${n}`)),
          cmd("editor:set-body"),
          SEPARATOR,
          cmd("editor:toggle-blockquote"),
        ],
      },
      !reading && {
        title: "Insert",
        icon: "plus",
        submenu: () => [
          cmd("editor:insert-table"),
          cmd("editor:insert-callout"),
          cmd("editor:insert-codeblock"),
          cmd("editor:insert-mathblock"),
          cmd("editor:insert-horizontal-rule"),
        ],
      },
      SEPARATOR,
      !reading && { title: "Cut", icon: "scissors", disabled: !hasSelection, action: () => copySelection(view, true).catch(warn("cut")) },
      { title: "Copy", icon: "copy", disabled: !hasSelection, action: () => copySelection(view, false).catch(warn("copy")) },
      !reading && { title: "Paste", icon: "clipboard-paste", action: () => void paste(view, false) },
      !reading && { title: "Paste as plain text", icon: "clipboard-type", action: () => void paste(view, true) },
      {
        title: "Select all",
        icon: "square-dashed-text",
        action: () => {
          view.focus();
          view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        },
      },
    ];
  }

  /** The file items shared by the tab menu and "More options". */
  function noteItems(path: string): MenuItems {
    return [
      { title: "Rename...", icon: "pencil", action: () => host.renameActive() },
      { title: "Move file to...", icon: "folder-input", action: () => host.moveFile(path) },
      bookmarkItem(path),
    ];
  }

  /** Right-click on a tab header. */
  function tab(t: Tab): MenuItems {
    const i = ws.tabs.indexOf(t);
    const others = ws.tabs.some((o) => o !== t && !o.pinned);
    const toRight = ws.tabs.slice(i + 1).some((o) => !o.pinned);
    const path = t.path;
    const onTab = (fn: () => void) => () => {
      ws.activate(t);
      fn();
    };
    return [
      { title: "Close", icon: "x", hotkey: t === ws.active ? commands.hotkey("workspace:close") : undefined, action: () => ws.closeTab(t) },
      { title: "Close others", icon: "circle-x", disabled: !others, action: () => ws.closeOthers(t) },
      { title: "Close tabs to the right", icon: "arrow-right-to-line", disabled: !toRight, action: () => ws.closeToRight(t) },
      { title: "Close all", icon: "square-x", action: () => ws.closeAll() },
      SEPARATOR,
      t.pinned
        ? { title: "Unpin", icon: "pin-off", action: () => ws.togglePin(t) }
        : { title: "Pin", icon: "pin", action: () => ws.togglePin(t) },
      SEPARATOR,
      ...(path
        ? [
            { title: "Rename...", icon: "pencil", action: onTab(() => host.renameActive()) } as MenuEntry,
            { title: "Move file to...", icon: "folder-input", action: () => host.moveFile(path) } as MenuEntry,
            bookmarkItem(path),
            SEPARATOR,
            copyPath(path),
            { title: "Reveal file in navigation", icon: "folder-open", action: () => host.revealInTree(path) } as MenuEntry,
            SEPARATOR,
            deleteItem(path, "Delete file"),
          ]
        : []),
    ];
  }

  /** The tab bar's chevron: the open tabs, then actions on them. */
  function tabList(): MenuItems {
    return [
      ...ws.tabs.map(
        (t): MenuEntry => ({
          title: t.path ? noteName(t.path) : "New tab",
          icon: t.path ? "file-text" : "file",
          checked: t === ws.active,
          action: () => ws.activate(t),
        }),
      ),
      SEPARATOR,
      { title: "Close all", icon: "square-x", action: () => ws.closeAll() },
    ];
  }

  /** The view header's "More options" (three dots). */
  function moreOptions(): MenuItems {
    const path = ws.active.path;
    if (!path) return [];
    const reading = ws.active.mode === "reading";
    return [
      commands.menuItem("markdown:toggle-preview", {
        title: reading ? "Editing view" : "Reading view",
        icon: reading ? "pen-line" : "book-open",
      }),
      !reading && commands.menuItem("editor:toggle-source", { title: "Source mode", icon: undefined, checked: ws.active.mode === "source" }),
      SEPARATOR,
      ...noteItems(path),
      SEPARATOR,
      !reading && { title: "Find...", icon: "search", hotkey: commands.hotkey("editor:open-search"), action: () => openSearchPanel(ws.view) },
      !reading && commands.menuItem("editor:open-search-replace", { title: "Replace..." }),
      SEPARATOR,
      copyPath(path),
      {
        title: "Open linked view",
        icon: "link",
        submenu: () => [
          commands.menuItem("backlink:open", { title: "Open backlinks" }),
          commands.menuItem("outgoing-links:open", { title: "Open outgoing links" }),
          commands.menuItem("tag-pane:open", { title: "Open tags" }),
          commands.menuItem("outline:open", { title: "Open outline" }),
        ],
      },
      SEPARATOR,
      { title: "Reveal file in navigation", icon: "folder-open", action: () => host.revealInTree(path) },
      SEPARATOR,
      deleteItem(path, "Delete file"),
    ];
  }

  return { file, vault, editor, tab, tabList, moreOptions };
}

export type Menus = ReturnType<typeof createMenus>;
