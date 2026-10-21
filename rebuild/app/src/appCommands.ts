// Every command Grove has, registered once. Names, ids and default hotkeys
// follow Obsidian's own command list (read from Obsidian 1.14.4's registry):
// core actions are plain ("Toggle bold", "Split right"), the views and tools
// are "Group: Action" ("Backlinks: Show backlinks"). Where Obsidian has no
// default hotkey, neither does Grove (the sidebar toggles keep round 3's).

import { startCompletion } from "@codemirror/autocomplete";
import { addCursorAbove, addCursorBelow, deleteLine, indentLess, indentMore, moveLineDown, moveLineUp } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { StateCommand } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Bookmarks } from "./bookmarks";
import { type Command, commands } from "./commands";
import { foldAllAllowed, toggleFoldAt, unfoldEverything } from "./editor/fold";
import { linkAt } from "./editor/linkAt";
import {
  BLOCKS,
  clearFormatting,
  insertBlock,
  insertFootnote,
  insertMarkdownLink,
  insertText,
  insertWikilink,
  type LineKind,
  setLineKind,
  toggleCheckbox,
  toggleWrap,
} from "./editor/format";
import type { Edge } from "./layout";
import { openCommandPalette } from "./shell/commandPalette";
import type { IconName } from "./shell/icons";
import { isMenuOpen } from "./shell/menu";
import { openMergePrompt } from "./shell/mergePrompt";
import { openMovePrompt } from "./shell/movePrompt";
import type { Panes } from "./shell/pane";
import { isPromptOpen } from "./shell/prompt";
import { openQuickSwitcher } from "./shell/quickSwitcher";
import { currentTheme } from "./settings/appearance";
import { dateNamePattern, fillTemplate, formatDate } from "./settings/dateFormat";
import { settings } from "./settings/store";
import { openTemplatePrompt } from "./shell/templatePrompt";
import type { RightSidebar, RightView } from "./shell/rightSidebar";
import type { LeftSidebar, LeftView } from "./shell/sidebar";
import type { Sidedocks } from "./shell/sidedock";
import { noteName, systemPath, trimSlashes } from "./paths";
import type { OpenWhere } from "./tabs";
import type { Workspace } from "./workspace";

export interface AppParts {
  ws: Workspace;
  panes: Panes;
  docks: Sidedocks;
  left: LeftSidebar;
  right: RightSidebar;
  bookmarks: Bookmarks;
  /** Show the editor menu at the caret (as from the Menu key). */
  editorMenuAtCaret(): void;
  /** Open the settings modal (at a section). */
  openSettings(section?: string): void;
  /** Show or hide the backlinks under the active tab's note. */
  toggleBacklinksInDocument(): void;
}

const mod = (key: string, more: { shift?: boolean; alt?: boolean } = {}) => [{ mod: true, key, ...more }];

const templates = () => settings.get("templates.json");
const today = () => formatDate(new Date(), templates().dateFormat || "YYYY-MM-DD");
const nowTime = () => formatDate(new Date(), templates().timeFormat || "HH:mm");
const folderPrefix = (folder: string) => (trimSlashes(folder) ? `${trimSlashes(folder)}/` : "");

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
  // An internal link at the caret, for the "link under cursor" commands.
  const linkUnderCursor = () => {
    if (!hasNote() || typingElsewhere()) return null;
    const link = linkAt(ws.view.state, ws.view.state.selection.main.head);
    return link?.kind === "internal" ? link : null;
  };

  const showLeft = (view: LeftView) => {
    parts.left.select(view);
    parts.docks.setCollapsed("left", false);
  };
  const showRight = (view: RightView) => {
    parts.right.select(view);
    parts.docks.setCollapsed("right", false);
  };

  async function newNote(where?: OpenWhere) {
    await ws.newNote("", where);
    parts.panes.focusTitle(true);
  }

  // ----- daily notes (Settings → Daily notes: date format, folder, template) -----
  const daily = () => settings.get("daily-notes.json");
  const dailyPath = (d: Date) => `${folderPrefix(daily().folder)}${formatDate(d, daily().format || "YYYY-MM-DD")}.md`;
  /** Daily notes, oldest first: notes in the daily notes folder whose names fit the date format. */
  const dailyNotes = () => {
    const prefix = folderPrefix(daily().folder);
    const pattern = dateNamePattern(daily().format || "YYYY-MM-DD");
    const out: { path: string; time: number }[] = [];
    for (const n of ws.notes) {
      if (!n.path.startsWith(prefix)) continue;
      const time = pattern.parse(n.path.slice(prefix.length, -3));
      if (time !== null) out.push({ path: n.path, time });
    }
    return out.sort((a, b) => a.time - b.time);
  };
  const adjacentDaily = (dir: 1 | -1) => {
    const path = ws.active.path;
    if (!path) return null;
    const list = dailyNotes();
    const i = list.findIndex((n) => n.path === path);
    return i < 0 ? null : (list[i + dir]?.path ?? null);
  };
  /** A template note's text with its variables filled in for a note titled `title`. */
  const templateText = async (templatePath: string | null, title: string) => {
    if (!templatePath) return "";
    const text = await ws.editors.text(templatePath).catch(() => "");
    return fillTemplate(text, title, new Date(), templates().dateFormat || "YYYY-MM-DD", templates().timeFormat || "HH:mm");
  };
  async function openDailyNote() {
    const path = dailyPath(new Date());
    const existing = ws.notes.find((n) => n.path.toLowerCase() === path.toLowerCase());
    if (existing) return ws.open(existing.path);
    const template = daily().template.trim() ? ws.resolve(daily().template.trim(), null) : null;
    const entry = await ws.createNote(path, await templateText(template, noteName(path)));
    await ws.open(entry.path);
  }

  // ----- templates -----
  const templateFolder = () => trimSlashes(templates().folder);
  const templateNotes = () => (templateFolder() ? ws.notes.filter((n) => n.path.startsWith(`${templateFolder()}/`)) : []);
  async function insertTemplate(path: string) {
    const view = ws.view;
    const text = await templateText(path, ws.active.path ? noteName(ws.active.path) : "");
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true, userEvent: "input.template" });
    view.focus();
  }

  // ----- appearance shortcuts, through the settings (so they are saved per vault) -----
  const appearance = () => settings.get("appearance.json");
  const setFontSize = (delta: number) => settings.set("appearance.json", "baseFontSize", Math.min(30, Math.max(10, appearance().baseFontSize + delta)));
  const setZoom = (level: number) => settings.set("appearance.json", "zoomLevel", Math.min(3, Math.max(-2.5, level)));
  const app = () => settings.get("app.json");

  // Obsidian's "Add file property": a properties block at the top of the
  // note (created if missing) with the caret on a new, empty line in it.
  const addProperty = (view: EditorView) => {
    const doc = view.state.doc;
    const first = doc.line(1);
    if (first.text === "---") {
      for (let i = 2; i <= doc.lines; i++) {
        const line = doc.line(i);
        if (line.text !== "---") continue;
        view.dispatch({ changes: { from: line.from, insert: "\n" }, selection: { anchor: line.from }, scrollIntoView: true, userEvent: "input" });
        return true;
      }
    }
    view.dispatch({ changes: { from: 0, insert: "---\n\n---\n" }, selection: { anchor: 4 }, scrollIntoView: true, userEvent: "input" });
    return true;
  };

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
  // A StateCommand run on the active pane's editor.
  const stateCommand = (cmd: StateCommand) => (view: EditorView) => cmd(view);

  const lineKind = (id: string, name: string, icon: IconName, kind: LineKind) => editorCommand(id, name, icon, setLineKind(kind));

  const focusPane = (id: string, name: string, edge: Edge): Command => ({
    id,
    name,
    when: () => !!ws.neighbour(edge),
    run: () => ws.focusNeighbour(edge),
  });
  const moveToPane = (id: string, name: string, edge: Edge): Command => ({
    id,
    name,
    when: () => !!ws.neighbour(edge),
    run: () => ws.moveToNeighbour(edge),
  });
  const followLink = (id: string, name: string, where: OpenWhere, hotkeys: Command["hotkeys"]): Command => ({
    id,
    name,
    icon: "link",
    hotkeys,
    when: () => !!linkUnderCursor(),
    run: () => {
      const link = linkUnderCursor();
      if (link) void ws.openLink(link.target, where);
    },
  });

  // While a menu or a prompt has the keyboard, hotkeys wait.
  commands.suspended = () => isPromptOpen() || isMenuOpen();

  const lineAtCaret = () => ws.view.state.doc.lineAt(ws.view.state.selection.main.head);

  commands.register(
    // ----- app and workspace -----
    {
      id: "app:open-settings",
      name: "Open settings",
      icon: "settings",
      hotkeys: mod(","),
      run: () => parts.openSettings(),
    },
    {
      id: "command-palette:open",
      name: "Command palette: Open command palette",
      plugin: "command-palette",
      icon: "square-terminal",
      hotkeys: mod("p"),
      run: () => openCommandPalette(commands),
    },
    {
      id: "switcher:open",
      name: "Quick switcher: Open quick switcher",
      plugin: "switcher",
      icon: "navigation",
      hotkeys: mod("o"),
      run: () => openQuickSwitcher(ws),
    },
    { id: "file-explorer:new-file", name: "Create new note", icon: "file-plus", hotkeys: mod("n"), run: () => newNote() },
    { id: "file-explorer:new-file-in-current-tab", name: "Create new note in current tab", icon: "file-plus", run: () => newNote(false) },
    {
      id: "file-explorer:new-file-in-new-pane",
      name: "Create note to the right",
      icon: "file-plus",
      hotkeys: mod("n", { shift: true }),
      run: () => newNote("right"),
    },
    { id: "file-explorer:new-folder", name: "Files: Create new folder", icon: "folder-plus", run: () => parts.left.newFolderIn("") },
    { id: "daily-notes", name: "Daily notes: Open today's daily note", plugin: "daily-notes", icon: "calendar-days", run: () => openDailyNote() },
    {
      id: "daily-notes:goto-prev",
      name: "Daily notes: Open previous daily note",
      plugin: "daily-notes",
      icon: "calendar-minus",
      when: () => !!adjacentDaily(-1),
      run: () => ws.open(adjacentDaily(-1)!),
    },
    {
      id: "daily-notes:goto-next",
      name: "Daily notes: Open next daily note",
      plugin: "daily-notes",
      icon: "calendar-plus",
      when: () => !!adjacentDaily(1),
      run: () => ws.open(adjacentDaily(1)!),
    },
    {
      id: "random-note",
      name: "Random note: Open random note",
      plugin: "random-note",
      icon: "dices",
      when: () => ws.includedNotes().length > 0,
      run: () => {
        const notes = ws.includedNotes();
        const others = notes.filter((n) => n.path !== ws.active.path);
        const pick = others[Math.floor(Math.random() * others.length)] ?? notes[0];
        void ws.open(pick.path);
      },
    },
    { id: "workspace:new-tab", name: "New tab", hotkeys: mod("t"), run: () => ws.newTab() },
    { id: "workspace:close", name: "Close current tab", icon: "x", hotkeys: mod("w"), run: () => ws.closeTab(ws.active) },
    {
      id: "workspace:close-others",
      name: "Close all other tabs",
      icon: "x",
      when: () => ws.groups().some((g) => g.tabs.some((t) => t !== ws.active && !t.pinned)),
      run: () => ws.closeAllOthers(),
    },
    {
      id: "workspace:close-others-tab-group",
      name: "Close others in tab group",
      icon: "x",
      when: () => ws.tabs.some((t) => t !== ws.active && !t.pinned),
      run: () => ws.closeOthers(ws.active),
    },
    { id: "workspace:close-tab-group", name: "Close this tab group", icon: "x", run: () => ws.closeGroup() },
    {
      id: "workspace:undo-close-pane",
      name: "Undo close tab",
      icon: "undo-2",
      hotkeys: mod("t", { shift: true }),
      when: () => ws.canUndoClose(),
      run: () => ws.undoCloseTab(),
    },
    {
      id: "workspace:next-tab",
      name: "Go to next tab",
      icon: "arrow-right",
      hotkeys: [...mod("tab"), ...mod("pagedown")],
      when: () => ws.tabs.length > 1,
      run: () => ws.cycleTab(1),
    },
    {
      id: "workspace:previous-tab",
      name: "Go to previous tab",
      icon: "arrow-left",
      hotkeys: [...mod("tab", { shift: true }), ...mod("pageup")],
      when: () => ws.tabs.length > 1,
      run: () => ws.cycleTab(-1),
    },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(
      (n): Command => ({
        id: `workspace:goto-tab-${n}`,
        name: `Go to tab #${n}`,
        hotkeys: mod(String(n)),
        when: () => ws.tabs.length >= n,
        run: () => ws.gotoTab(n),
      }),
    ),
    { id: "workspace:goto-last-tab", name: "Go to last tab", hotkeys: mod("9"), run: () => ws.gotoTab(0) },
    { id: "workspace:toggle-pin", name: "Toggle pin", icon: "pin", run: () => ws.togglePin() },
    // Splits. Obsidian has no default hotkeys for these.
    { id: "workspace:split-vertical", name: "Split right", icon: "separator-vertical", run: () => ws.split(ws.active, "right") },
    { id: "workspace:split-horizontal", name: "Split down", icon: "separator-horizontal", run: () => ws.split(ws.active, "bottom") },
    focusPane("editor:focus-left", "Focus on tab group to the left", "left"),
    focusPane("editor:focus-right", "Focus on tab group to the right", "right"),
    focusPane("editor:focus-top", "Focus on tab group above", "top"),
    focusPane("editor:focus-bottom", "Focus on tab group below", "bottom"),
    // Grove's own (Obsidian moves tabs between groups only by dragging).
    moveToPane("workspace:move-tab-left", "Move current tab to the tab group to the left", "left"),
    moveToPane("workspace:move-tab-right", "Move current tab to the tab group to the right", "right"),
    moveToPane("workspace:move-tab-up", "Move current tab to the tab group above", "top"),
    moveToPane("workspace:move-tab-down", "Move current tab to the tab group below", "bottom"),
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
    { id: "app:toggle-ribbon", name: "Toggle ribbon", run: () => settings.set("appearance.json", "showRibbon", !appearance().showRibbon) },
    {
      id: "theme:toggle-light-dark",
      name: "Toggle light/dark mode",
      icon: "sun-moon",
      run: () => settings.set("appearance.json", "theme", currentTheme() === "dark" ? "light" : "dark"),
    },
    { id: "window:zoom-in", name: "Zoom in", icon: "zoom-in", hotkeys: [...mod("="), ...mod("+", { shift: true })], run: () => setZoom(appearance().zoomLevel + 0.5) },
    { id: "window:zoom-out", name: "Zoom out", icon: "zoom-out", hotkeys: mod("-"), run: () => setZoom(appearance().zoomLevel - 0.5) },
    { id: "window:reset-zoom", name: "Reset zoom", hotkeys: mod("0"), run: () => setZoom(0) },
    { id: "editor:toggle-line-numbers", name: "Toggle line numbers", icon: "list-ordered", run: () => settings.set("app.json", "showLineNumber", !app().showLineNumber) },
    { id: "editor:toggle-spellcheck", name: "Toggle spellcheck", icon: "type", run: () => settings.set("app.json", "spellcheck", !app().spellcheck) },
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
      icon: "code-xml",
      when: () => hasNote() && ws.active.mode !== "reading",
      run: () => ws.setMode(ws.active.mode === "source" ? "live" : "source"),
    },
    {
      id: "editor:toggle-readable-line-length",
      name: "Toggle readable line length",
      icon: "ruler",
      run: () => settings.set("app.json", "readableLineLength", !app().readableLineLength),
    },
    { id: "app:increase-font-size", name: "Increase font size", icon: "a-large-small", run: () => setFontSize(1) },
    { id: "app:decrease-font-size", name: "Decrease font size", icon: "a-large-small", run: () => setFontSize(-1) },

    // ----- the open file -----
    {
      id: "workspace:edit-file-title",
      name: "Rename file",
      icon: "pen-line",
      hotkeys: [{ key: "f2" }],
      when: hasNote,
      run: () => parts.panes.focusTitle(true),
    },
    {
      id: "app:delete-file",
      name: "Delete current file",
      icon: "trash-2",
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
      icon: "folder-tree",
      when: hasNote,
      run: () => openMovePrompt(ws, note()),
    },
    {
      id: "note-composer:merge-file",
      name: "Note composer: Merge current file with another file...",
      plugin: "note-composer",
      icon: "git-merge",
      when: () => hasNote() && ws.notes.length > 1,
      run: () => openMergePrompt(ws, note()),
    },
    {
      id: "file-explorer:reveal-active-file",
      name: "Files: Reveal current file in navigation",
      icon: "navigation",
      when: hasNote,
      run: () => {
        showLeft("files");
        parts.left.reveal(note());
      },
    },
    {
      id: "workspace:copy-path",
      name: "Copy current file path from vault folder",
      icon: "copy",
      when: hasNote,
      run: () => navigator.clipboard.writeText(note()).catch((err) => console.warn("Could not copy", err)),
    },
    {
      id: "workspace:copy-full-path",
      name: "Copy current file path from system root",
      icon: "hard-drive",
      when: hasNote,
      run: () => navigator.clipboard.writeText(systemPath(ws.vault.path, note())).catch((err) => console.warn("Could not copy", err)),
    },
    { id: "editor:save-file", name: "Save current file", hotkeys: mod("s"), when: hasNote, run: () => ws.saveNow() },
    {
      id: "bookmarks:bookmark-current-file",
      name: "Bookmarks: Bookmark current file",
      plugin: "bookmarks",
      icon: "bookmark",
      when: () => hasNote() && !bookmarks.has(note()),
      run: () => bookmarks.toggle(note()),
    },
    {
      id: "bookmarks:unbookmark-current-file",
      name: "Bookmarks: Remove bookmark for current file",
      plugin: "bookmarks",
      icon: "bookmark-minus",
      when: () => bookmarks.has(ws.active.path),
      run: () => bookmarks.toggle(note()),
    },
    {
      id: "bookmarks:bookmark-all-tabs",
      name: "Bookmarks: Bookmark all tabs",
      plugin: "bookmarks",
      icon: "bookmark-plus",
      when: () => ws.groups().some((g) => g.tabs.some((t) => t.path && !bookmarks.has(t.path))),
      run: () => {
        const paths = new Set(ws.groups().flatMap((g) => g.tabs.flatMap((t) => (t.path ? [t.path] : []))));
        for (const p of paths) if (!bookmarks.has(p)) bookmarks.toggle(p);
      },
    },

    // ----- views -----
    { id: "file-explorer:open", name: "Files: Show file explorer", icon: "files", run: () => showLeft("files") },
    { id: "file-explorer:collapse-all", name: "Files: Collapse all", icon: "chevrons-down-up", run: () => parts.left.collapseAll() },
    {
      id: "global-search:open",
      name: "Search: Search in all files",
      icon: "search",
      hotkeys: mod("f", { shift: true }),
      run: () => showLeft("search"),
    },
    { id: "bookmarks:open", name: "Bookmarks: Show bookmarks",
      plugin: "bookmarks", icon: "bookmark", run: () => showLeft("bookmarks") },
    { id: "backlink:open", name: "Backlinks: Show backlinks", plugin: "backlink", icon: "link", run: () => showRight("backlinks") },
    {
      id: "backlink:toggle-backlinks-in-document",
      name: "Backlinks: Toggle backlinks in document",
      plugin: "backlink",
      icon: "link",
      when: hasNote,
      run: () => parts.toggleBacklinksInDocument(),
    },
    { id: "outgoing-links:open", name: "Outgoing links: Show outgoing links", plugin: "outgoing-link", icon: "link-2", run: () => showRight("outgoing") },
    { id: "tag-pane:open", name: "Tags view: Show tags", plugin: "tag-pane", icon: "tags", run: () => showRight("tags") },
    { id: "outline:open", name: "Outline: Show outline", plugin: "outline", icon: "list", run: () => showRight("outline") },
    // Graph view: the global graph in a tab (Obsidian's Ctrl/Cmd+G), and the
    // open note's local graph to the right (as Obsidian opens it).
    { id: "graph:open", name: "Graph view: Open graph view", plugin: "graph", icon: "git-fork", hotkeys: mod("g"), run: () => ws.openView("graph") },
    {
      id: "graph:open-local",
      name: "Graph view: Open local graph",
      plugin: "graph",
      icon: "git-fork",
      when: hasNote,
      run: () => ws.openView("localgraph", "right", note()),
    },
    { id: "graph:show-local", name: "Graph view: Show local graph in sidebar", plugin: "graph", icon: "git-fork", run: () => showRight("localgraph") },

    // ----- editing -----
    editorCommand("editor:toggle-bold", "Toggle bold", "bold", toggleWrap("**"), mod("b")),
    editorCommand("editor:toggle-italics", "Toggle italic", "italic", toggleWrap("*"), mod("i")),
    editorCommand("editor:toggle-strikethrough", "Toggle strikethrough", "strikethrough", toggleWrap("~~")),
    editorCommand("editor:toggle-highlight", "Toggle highlight", "highlighter", toggleWrap("==")),
    editorCommand("editor:toggle-code", "Toggle code", "code-xml", toggleWrap("`")),
    editorCommand("editor:toggle-inline-math", "Toggle inline math", "sigma", toggleWrap("$")),
    editorCommand("editor:toggle-comments", "Toggle comment", "percent", toggleWrap("%%"), mod("/")),
    {
      ...editorCommand("editor:clear-formatting", "Clear formatting", "eraser", clearFormatting),
      when: () => canEdit() && ws.view.state.selection.ranges.some((r) => !r.empty),
    },
    editorCommand("editor:insert-link", "Insert Markdown link", "link", insertMarkdownLink, mod("k")),
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
      lineKind(`editor:set-heading-${n}`, `Set as heading ${n}`, `heading-${n}`, `h${n}`),
    ),
    lineKind("editor:set-heading-0", "Remove heading", "pilcrow", "body"),
    editorCommand("editor:insert-footnote", "Insert footnote", "file-signature", insertFootnote),
    editorCommand("editor:insert-table", "Insert table", "table", insertBlock(BLOCKS.table.text, BLOCKS.table.caret)),
    editorCommand("editor:insert-callout", "Insert callout", "message-square-quote", insertBlock(BLOCKS.callout.text, BLOCKS.callout.caret)),
    editorCommand("editor:insert-codeblock", "Insert code block", "square-code", insertBlock(BLOCKS.codeBlock.text, BLOCKS.codeBlock.caret)),
    editorCommand("editor:insert-mathblock", "Insert math block", "square-sigma", insertBlock(BLOCKS.mathBlock.text, BLOCKS.mathBlock.caret)),
    editorCommand("editor:insert-horizontal-rule", "Insert horizontal rule", "separator-horizontal", insertBlock(BLOCKS.rule.text, BLOCKS.rule.caret)),
    { ...editorCommand("insert-current-date", "Templates: Insert current date", "calendar-days", insertText(() => today())), plugin: "templates" },
    { ...editorCommand("insert-current-time", "Templates: Insert current time", "clock", insertText(() => nowTime())), plugin: "templates" },
    {
      id: "templates:insert-template",
      name: "Templates: Insert template",
      plugin: "templates",
      icon: "files",
      when: canEdit,
      run: () => {
        if (!templateFolder()) return parts.openSettings("templates");
        openTemplatePrompt(templateNotes(), (path) => void insertTemplate(path));
      },
    },
    editorCommand("markdown:add-metadata-property", "Add file property", "list-plus", addProperty, mod(";")),
    {
      ...editorCommand("editor:toggle-fold", "Toggle fold on the current line", "chevrons-down-up", (v) => toggleFoldAt(v, lineAtCaret())),
      when: () => canEdit() && (app().foldHeading || app().foldIndent),
    },
    {
      ...editorCommand("editor:fold-all", "Fold all headings and lists", "chevrons-down-up", foldAllAllowed),
      when: () => hasNote() && (app().foldHeading || app().foldIndent),
    },
    { ...editorCommand("editor:unfold-all", "Unfold all headings and lists", "chevrons-down-up", unfoldEverything), when: hasNote },
    editorCommand("editor:swap-line-up", "Move line up", "corner-right-up", stateCommand(moveLineUp)),
    editorCommand("editor:swap-line-down", "Move line down", "corner-right-down", stateCommand(moveLineDown)),
    editorCommand("editor:add-cursor-above", "Add cursor above", "mouse-pointer-click", addCursorAbove),
    editorCommand("editor:add-cursor-below", "Add cursor below", "mouse-pointer-click", addCursorBelow),
    editorCommand("editor:delete-paragraph", "Delete paragraph", "scissors", deleteLine, mod("d")),
    editorCommand("editor:indent-list", "Indent list item", "indent-increase", stateCommand(indentMore)),
    editorCommand("editor:unindent-list", "Unindent list item", "indent-decrease", stateCommand(indentLess)),
    followLink("editor:follow-link", "Follow link under cursor", false, [{ alt: true, key: "enter" }]),
    followLink("editor:open-link-in-new-leaf", "Open link under cursor in new tab", "tab", mod("enter")),
    followLink("editor:open-link-in-new-split", "Open link under cursor to the right", "right", mod("enter", { alt: true })),
    {
      id: "editor:context-menu",
      name: "Show context menu under cursor",
      icon: "menu",
      when: () => hasNote() && !typingElsewhere(),
      run: () => parts.editorMenuAtCaret(),
    },
    {
      id: "editor:focus",
      name: "Focus on last note",
      when: hasNote,
      run: () => ws.view.focus(),
    },
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
