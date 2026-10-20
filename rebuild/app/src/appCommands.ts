// Every command Grove has, registered once. Names follow Obsidian's command
// palette: core actions are plain ("Toggle bold", "Navigate back"), the
// views and tools are "Group: Action" ("Backlinks: Show backlinks").
// Hotkeys are Obsidian's defaults where it has one.

import { startCompletion } from "@codemirror/autocomplete";
import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import type { Bookmarks } from "./bookmarks";
import { type Command, commands } from "./commands";
import {
  BLOCKS,
  clearFormatting,
  insertBlock,
  insertMarkdownLink,
  insertWikilink,
  type LineKind,
  setLineKind,
  toggleCheckbox,
  toggleWrap,
} from "./editor/format";
import { openCommandPalette } from "./shell/commandPalette";
import type { IconName } from "./shell/icons";
import { isMenuOpen } from "./shell/menu";
import { openMovePrompt } from "./shell/movePrompt";
import type { Pane } from "./shell/pane";
import { isPromptOpen } from "./shell/prompt";
import { openQuickSwitcher } from "./shell/quickSwitcher";
import type { RightSidebar, RightView } from "./shell/rightSidebar";
import type { LeftSidebar, LeftView } from "./shell/sidebar";
import type { Sidedocks } from "./shell/sidedock";
import type { Workspace } from "./workspace";

export interface AppParts {
  ws: Workspace;
  pane: Pane;
  docks: Sidedocks;
  left: LeftSidebar;
  right: RightSidebar;
  bookmarks: Bookmarks;
}

const mod = (key: string, more: { shift?: boolean; alt?: boolean } = {}) => [{ mod: true, key, ...more }];

/**
 * Register everything. Only `ws` and `bookmarks` must exist yet: the views
 * are read from `parts` when a command runs, so commands can be registered
 * before the views that show their hotkeys are built.
 */
export function registerAppCommands(parts: AppParts) {
  const { ws, bookmarks } = parts;
  const hasNote = () => !!ws.active.path;
  const note = () => ws.active.path!;

  // Focus is in some other text field (the inline title, a search box):
  // editor hotkeys leave it alone.
  const typingElsewhere = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || ws.view.dom.contains(el)) return false;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
  };
  const canEdit = () => hasNote() && ws.active.mode !== "reading" && !typingElsewhere();

  const showLeft = (view: LeftView) => {
    parts.left.select(view);
    parts.docks.setCollapsed("left", false);
  };
  const showRight = (view: RightView) => {
    parts.right.select(view);
    parts.docks.setCollapsed("right", false);
  };

  async function dailyNote() {
    const d = new Date();
    const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await ws.openLink(name);
  }

  async function newNote() {
    await ws.newNote();
    parts.pane.focusTitle(true);
  }

  const editorCommand = (id: string, name: string, icon: IconName | undefined, run: (view: EditorView) => boolean, hotkeys?: Command["hotkeys"]): Command => ({
    id,
    name,
    icon,
    hotkeys,
    when: canEdit,
    run: () => {
      run(ws.view);
      ws.view.focus();
    },
  });

  const lineKind = (id: string, name: string, icon: IconName, kind: LineKind) => editorCommand(id, name, icon, setLineKind(kind));

  // While a menu or a prompt has the keyboard, hotkeys wait.
  commands.suspended = () => isPromptOpen() || isMenuOpen();

  commands.register(
    // ----- app and workspace -----
    {
      id: "command-palette:open",
      name: "Command palette: Open command palette",
      icon: "square-terminal",
      hotkeys: mod("p"),
      run: () => openCommandPalette(commands),
    },
    {
      id: "switcher:open",
      name: "Quick switcher: Open quick switcher",
      icon: "arrow-left-right",
      hotkeys: mod("o"),
      run: () => openQuickSwitcher(ws),
    },
    { id: "file-explorer:new-file", name: "Create new note", icon: "square-pen", hotkeys: mod("n"), run: newNote },
    { id: "file-explorer:new-folder", name: "Create new folder", icon: "folder-plus", run: () => parts.left.newFolderIn("") },
    { id: "daily-notes", name: "Daily notes: Open today's daily note", icon: "calendar-days", run: dailyNote },
    { id: "workspace:new-tab", name: "New tab", icon: "plus", hotkeys: mod("t"), run: () => ws.newTab() },
    { id: "workspace:close", name: "Close current tab", icon: "x", hotkeys: mod("w"), run: () => ws.closeTab(ws.active) },
    {
      id: "workspace:close-others",
      name: "Close all other tabs",
      icon: "circle-x",
      when: () => ws.tabs.some((t) => t !== ws.active && !t.pinned),
      run: () => ws.closeOthers(ws.active),
    },
    {
      id: "workspace:next-tab",
      name: "Go to next tab",
      hotkeys: mod("tab"),
      when: () => ws.tabs.length > 1,
      run: () => ws.cycleTab(1),
    },
    {
      id: "workspace:previous-tab",
      name: "Go to previous tab",
      hotkeys: mod("tab", { shift: true }),
      when: () => ws.tabs.length > 1,
      run: () => ws.cycleTab(-1),
    },
    { id: "workspace:toggle-pin", name: "Toggle pin", icon: "pin", run: () => ws.togglePin() },
    {
      id: "app:go-back",
      name: "Navigate back",
      icon: "arrow-left",
      hotkeys: mod("arrowleft", { alt: true }),
      when: () => ws.active.back.length > 0,
      run: () => ws.goBack(),
    },
    {
      id: "app:go-forward",
      name: "Navigate forward",
      icon: "arrow-right",
      hotkeys: mod("arrowright", { alt: true }),
      when: () => ws.active.forward.length > 0,
      run: () => ws.goForward(),
    },
    // Obsidian has no default hotkeys for these two; Ctrl+Alt+[ / ] are Grove's.
    {
      id: "app:toggle-left-sidebar",
      name: "Toggle left sidebar",
      icon: "panel-left",
      hotkeys: mod("[", { alt: true }),
      run: () => parts.docks.toggle("left"),
    },
    {
      id: "app:toggle-right-sidebar",
      name: "Toggle right sidebar",
      icon: "panel-right",
      hotkeys: mod("]", { alt: true }),
      run: () => parts.docks.toggle("right"),
    },
    {
      id: "markdown:toggle-preview",
      name: "Toggle reading view",
      icon: "book-open",
      hotkeys: mod("e"),
      when: hasNote,
      run: () => ws.setMode(ws.active.mode === "reading" ? "live" : "reading"),
    },
    {
      id: "editor:toggle-source",
      name: "Toggle Live Preview/Source mode",
      icon: "code",
      when: () => hasNote() && ws.active.mode !== "reading",
      run: () => ws.setMode(ws.active.mode === "source" ? "live" : "source"),
    },

    // ----- the open file -----
    {
      id: "workspace:edit-file-title",
      name: "Rename file",
      icon: "pencil",
      hotkeys: [{ key: "f2" }],
      when: hasNote,
      run: () => parts.pane.focusTitle(true),
    },
    {
      id: "app:delete-file",
      name: "Delete current file",
      icon: "trash",
      when: hasNote,
      run: () => ws.remove(note()).catch((err) => console.warn("Could not delete", err)),
    },
    {
      id: "file-explorer:duplicate-file",
      name: "Make a copy of the current file",
      icon: "files",
      when: hasNote,
      run: () => ws.makeCopy(note()).catch((err) => console.warn("Could not copy", err)),
    },
    {
      id: "file-explorer:move-file",
      name: "Move current file to another folder",
      icon: "folder-input",
      when: hasNote,
      run: () => openMovePrompt(ws, note()),
    },
    {
      id: "file-explorer:reveal-active-file",
      name: "Files: Reveal current file in navigation",
      icon: "folder-open",
      when: hasNote,
      run: () => {
        showLeft("files");
        parts.left.reveal(note());
      },
    },
    {
      id: "workspace:copy-path",
      name: "Copy file path",
      icon: "copy",
      when: hasNote,
      run: () => navigator.clipboard.writeText(note()).catch((err) => console.warn("Could not copy", err)),
    },
    {
      id: "bookmarks:bookmark-current-file",
      name: "Bookmarks: Bookmark current file",
      icon: "bookmark",
      when: () => hasNote() && !bookmarks.has(note()),
      run: () => bookmarks.toggle(note()),
    },
    {
      id: "bookmarks:unbookmark-current-file",
      name: "Bookmarks: Remove bookmark for current file",
      icon: "bookmark-minus",
      when: () => bookmarks.has(ws.active.path),
      run: () => bookmarks.toggle(note()),
    },

    // ----- views -----
    { id: "file-explorer:open", name: "Files: Show file explorer", icon: "folder-closed", run: () => showLeft("files") },
    { id: "file-explorer:collapse-all", name: "Files: Collapse all", icon: "chevrons-down-up", run: () => parts.left.collapseAll() },
    {
      id: "global-search:open",
      name: "Search: Search in all files",
      icon: "search",
      hotkeys: mod("f", { shift: true }),
      run: () => showLeft("search"),
    },
    { id: "bookmarks:open", name: "Bookmarks: Show bookmarks", icon: "bookmark", run: () => showLeft("bookmarks") },
    { id: "backlink:open", name: "Backlinks: Show backlinks", icon: "link", run: () => showRight("backlinks") },
    { id: "outgoing-links:open", name: "Outgoing links: Show outgoing links", icon: "link-2", run: () => showRight("outgoing") },
    { id: "tag-pane:open", name: "Tags: Show tags", icon: "tags", run: () => showRight("tags") },
    { id: "outline:open", name: "Outline: Show outline", icon: "list", run: () => showRight("outline") },

    // ----- editing -----
    editorCommand("editor:toggle-bold", "Toggle bold", "bold", toggleWrap("**"), mod("b")),
    editorCommand("editor:toggle-italics", "Toggle italics", "italic", toggleWrap("*"), mod("i")),
    editorCommand("editor:toggle-strikethrough", "Toggle strikethrough", "strikethrough", toggleWrap("~~")),
    editorCommand("editor:toggle-highlight", "Toggle highlight", "highlighter", toggleWrap("==")),
    editorCommand("editor:toggle-code", "Toggle code", "code", toggleWrap("`")),
    editorCommand("editor:toggle-inline-math", "Toggle math", "sigma", toggleWrap("$")),
    editorCommand("editor:toggle-comments", "Toggle comment", "percent", toggleWrap("%%"), mod("/")),
    {
      ...editorCommand("editor:clear-formatting", "Clear formatting", "eraser", clearFormatting),
      when: () => canEdit() && ws.view.state.selection.ranges.some((r) => !r.empty),
    },
    editorCommand("editor:insert-link", "Insert Markdown link", "link-2", insertMarkdownLink, mod("k")),
    {
      ...editorCommand("editor:insert-wikilink", "Add internal link", "link", insertWikilink),
      run: () => {
        const empty = ws.view.state.selection.main.empty;
        insertWikilink(ws.view);
        ws.view.focus();
        if (empty) startCompletion(ws.view);
      },
    },
    lineKind("editor:toggle-bullet-list", "Toggle bullet list", "list", "bullet"),
    lineKind("editor:toggle-numbered-list", "Toggle numbered list", "list-ordered", "numbered"),
    lineKind("editor:toggle-task-list", "Toggle task list", "list-checks", "task"),
    editorCommand("editor:toggle-checklist-status", "Toggle checkbox status", "square-check-big", toggleCheckbox, mod("l")),
    lineKind("editor:toggle-blockquote", "Toggle blockquote", "quote", "quote"),
    ...([1, 2, 3, 4, 5, 6] as const).map((n) =>
      lineKind(`editor:set-heading-${n}`, `Set heading ${n}`, `heading-${n}`, `h${n}`),
    ),
    lineKind("editor:set-body", "Set as body text", "pilcrow", "body"),
    editorCommand("editor:insert-table", "Insert table", "table", insertBlock(BLOCKS.table.text, BLOCKS.table.caret)),
    editorCommand("editor:insert-callout", "Insert callout", "message-square-quote", insertBlock(BLOCKS.callout.text, BLOCKS.callout.caret)),
    editorCommand("editor:insert-codeblock", "Insert code block", "square-code", insertBlock(BLOCKS.codeBlock.text, BLOCKS.codeBlock.caret)),
    editorCommand("editor:insert-mathblock", "Insert math block", "square-sigma", insertBlock(BLOCKS.mathBlock.text, BLOCKS.mathBlock.caret)),
    editorCommand("editor:insert-horizontal-rule", "Insert horizontal rule", "separator-horizontal", insertBlock(BLOCKS.rule.text, BLOCKS.rule.caret)),
    editorCommand("editor:open-search", "Search current file", "search", openSearchPanel, mod("f")),
    {
      ...editorCommand("editor:open-search-replace", "Search & replace in current file", "replace", openSearchPanel, mod("h")),
      run: () => {
        openSearchPanel(ws.view);
        // CodeMirror's panel has one form for both; put the caret in the replace field.
        requestAnimationFrame(() => ws.view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]")?.focus());
      },
    },
  );
}
