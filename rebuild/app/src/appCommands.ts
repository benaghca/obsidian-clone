// Every command Grove has, registered once. Names, ids and default hotkeys
// follow Obsidian's own command list (read from Obsidian 1.14.4's registry):
// core actions are plain ("Toggle bold", "Split right"), the views and tools
// are "Group: Action" ("Backlinks: Show backlinks"). Where Obsidian has no
// default hotkey, neither does Grove (the sidebar toggles keep round 3's).

import { startCompletion } from "@codemirror/autocomplete";
import { addCursorAbove, addCursorBelow, deleteLine, indentLess, indentMore, moveLineDown, moveLineUp } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { api } from "./api";
import type { Bookmarks } from "./bookmarks";
import { type Command, commands } from "./commands";
import { writeClipboard } from "./editor/clipboard";
import { foldAllAllowed, toggleFoldAt, unfoldEverything } from "./editor/fold";
import { copyNote, createNote, deleteFile, newNote } from "./fileOps";
import { linkAt } from "./editor/linkAt";
import { openNewProperty } from "./editor/properties";
import {
  BLOCKS,
  clearFormatting,
  HIGHLIGHT_COLORS,
  type HighlightColor,
  insertBlock,
  insertFootnote,
  insertMarkdownLink,
  insertText,
  insertWikilink,
  type LineKind,
  setLineKind,
  toggleCheckbox,
  toggleHighlight,
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

  // Focus is in some other text field (the inline title, a search box, a
  // field in the Properties block): editor hotkeys leave it alone.
  const typingElsewhere = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === ws.view.contentDOM) return false;
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

  async function createNewNote(where?: OpenWhere) {
    await newNote(ws, "", where);
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
    for (const n of ws.vault.notes) {
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
    const existing = ws.vault.notes.find((n) => n.path.toLowerCase() === path.toLowerCase());
    if (existing) return ws.open(existing.path);
    const template = daily().template.trim() ? ws.resolve(daily().template.trim(), null) : null;
    const entry = await createNote(ws, path, await templateText(template, noteName(path)));
    await ws.open(entry.path);
  }

  // ----- templates -----
  const templateFolder = () => trimSlashes(templates().folder);
  const templateNotes = () => (templateFolder() ? ws.vault.notes.filter((n) => n.path.startsWith(`${templateFolder()}/`)) : []);
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

  // Obsidian's "Add file property": a new row in the Properties block with
  // its key field focused. Where the block isn't shown (Source mode, or
  // "Properties in document" set to Source or Hidden): a new, empty line in
  // the YAML (created if missing) with the caret on it.
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

  // Export to PDF: the note as Reading view shows it (in the light scheme),
  // printed through the webview, whose print dialog writes the PDF ("Print to
  // File"). Only that pane is printed, all of it (base.css, @media print).
  const exportPdf = () => {
    const tab = ws.active;
    const { mode } = tab;
    const root = document.documentElement;
    const dark = root.classList.contains("theme-dark");
    const target = ws.view.dom.closest<HTMLElement>(".view-content");
    const path: HTMLElement[] = [];
    for (let el = target?.parentElement; el && el !== document.body; el = el.parentElement) path.push(el);
    if (mode !== "reading") ws.setMode("reading", tab);
    if (dark) root.classList.replace("theme-dark", "theme-light");
    document.body.classList.add("is-printing");
    target?.classList.add("print-target");
    for (const el of path) el.classList.add("print-path");
    let printing = true;
    const done = () => {
      if (!printing) return;
      printing = false;
      document.body.classList.remove("is-printing");
      target?.classList.remove("print-target");
      for (const el of path) el.classList.remove("print-path");
      if (dark) root.classList.replace("theme-light", "theme-dark");
      if (mode !== "reading") ws.setMode(mode, tab);
    };
    window.addEventListener("afterprint", done, { once: true });
    window.print();
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
  const lineKind = (id: string, name: string, icon: IconName, kind: LineKind) => editorCommand(id, name, icon, setLineKind(kind));

  // Pane navigation shares availability and direction handling.
  const paneCommand = (id: string, name: string, edge: Edge, move = false): Command => ({
    id,
    name,
    when: () => !!ws.neighbour(edge),
    run: () => move ? ws.moveToNeighbour(edge) : ws.focusNeighbour(edge),
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

  const action = (id: string, name: string, icon: IconName | undefined, run: Command["run"], hotkeys?: Command["hotkeys"]): Command =>
    ({ id, name, icon, run, hotkeys });
  const conditionalAction = (id: string, name: string, icon: IconName | undefined, run: Command["run"], when = hasNote, hotkeys?: Command["hotkeys"]): Command =>
    ({ ...action(id, name, icon, run, hotkeys), when });

  const pluginAction = (plugin: string, id: string, name: string, icon: IconName, run: Command["run"], when?: Command["when"], hotkeys?: Command["hotkeys"]): Command =>
    ({ ...action(id, name, icon, run, hotkeys), plugin, when });

  commands.register(
    // ----- app and workspace -----
    action("app:open-settings", "Open settings", "settings", () => parts.openSettings(), mod(",")),
    pluginAction("command-palette", "command-palette:open", "Command palette: Open command palette", "square-terminal",
      () => openCommandPalette(commands), undefined, mod("p")),
    pluginAction("switcher", "switcher:open", "Quick switcher: Open quick switcher", "navigation",
      () => openQuickSwitcher(ws), undefined, mod("o")),
    { id: "file-explorer:new-file", name: "Create new note", icon: "file-plus", hotkeys: mod("n"), run: () => createNewNote() },
    { id: "file-explorer:new-file-in-current-tab", name: "Create new note in current tab", icon: "file-plus", run: () => createNewNote(false) },
    action(
      "file-explorer:new-file-in-new-pane",
      "Create note to the right",
      "file-plus",
      () => createNewNote("right"),
      mod("n", { shift: true }),
    ),
    { id: "file-explorer:new-folder", name: "Files: Create new folder", icon: "folder-plus", run: () => parts.left.newFolderIn("") },
    { id: "daily-notes", name: "Daily notes: Open today's daily note", plugin: "daily-notes", icon: "calendar-days", run: () => openDailyNote() },
    pluginAction("daily-notes", "daily-notes:goto-prev", "Daily notes: Open previous daily note", "calendar-minus",
      () => ws.open(adjacentDaily(-1)!), () => !!adjacentDaily(-1)),
    pluginAction("daily-notes", "daily-notes:goto-next", "Daily notes: Open next daily note", "calendar-plus",
      () => ws.open(adjacentDaily(1)!), () => !!adjacentDaily(1)),
    {
      id: "random-note",
      name: "Random note: Open random note",
      plugin: "random-note",
      icon: "dices",
      when: () => ws.vault.includedNotes().length > 0,
      run: () => {
        const notes = ws.vault.includedNotes();
        const others = notes.filter((n) => n.path !== ws.active.path);
        const pick = others[Math.floor(Math.random() * others.length)] ?? notes[0];
        void ws.open(pick.path);
      },
    },
    { id: "workspace:new-tab", name: "New tab", hotkeys: mod("t"), run: () => ws.newTab() },
    { id: "workspace:close", name: "Close current tab", icon: "x", hotkeys: mod("w"), run: () => ws.closeTab(ws.active) },
    conditionalAction("workspace:close-others", "Close all other tabs", "x",
      () => ws.closeAllOthers(), () => ws.groups().some((g) => g.tabs.some((t) => t !== ws.active && !t.pinned))),
    conditionalAction("workspace:close-others-tab-group", "Close others in tab group", "x",
      () => ws.closeOthers(ws.active), () => ws.tabs.some((t) => t !== ws.active && !t.pinned)),
    { id: "workspace:close-tab-group", name: "Close this tab group", icon: "x", run: () => ws.closeGroup() },
    conditionalAction("workspace:undo-close-pane", "Undo close tab", "undo-2",
      () => ws.undoCloseTab(), () => ws.canUndoClose(), mod("t", { shift: true })),
    conditionalAction("workspace:next-tab", "Go to next tab", "arrow-right",
      () => ws.cycleTab(1), () => ws.tabs.length > 1, [...mod("tab"), ...mod("pagedown")]),
    conditionalAction("workspace:previous-tab", "Go to previous tab", "arrow-left",
      () => ws.cycleTab(-1), () => ws.tabs.length > 1, [...mod("tab", { shift: true }), ...mod("pageup")]),
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
    { id: "workspace:open-in-new-window", name: "Open current tab in new window", icon: "picture-in-picture-2", when: hasNote, run: () => api.openNoteWindow(ws.active.path!) },
    { id: "workspace:move-to-new-window", name: "Move current tab to new window", icon: "picture-in-picture", when: hasNote, run: () => ws.moveToWindow(ws.active) },
    { id: "workspace:export-pdf", name: "Export to PDF...", icon: "file-down", when: hasNote, run: exportPdf },
    { id: "workspace:split-horizontal", name: "Split down", icon: "separator-horizontal", run: () => ws.split(ws.active, "bottom") },
    paneCommand("editor:focus-left", "Focus on tab group to the left", "left"),
    paneCommand("editor:focus-right", "Focus on tab group to the right", "right"),
    paneCommand("editor:focus-top", "Focus on tab group above", "top"),
    paneCommand("editor:focus-bottom", "Focus on tab group below", "bottom"),
    // Grove's own (Obsidian moves tabs between groups only by dragging).
    paneCommand("workspace:move-tab-left", "Move current tab to the tab group to the left", "left", true),
    paneCommand("workspace:move-tab-right", "Move current tab to the tab group to the right", "right", true),
    paneCommand("workspace:move-tab-up", "Move current tab to the tab group above", "top", true),
    paneCommand("workspace:move-tab-down", "Move current tab to the tab group below", "bottom", true),
    conditionalAction("app:go-back", "Navigate back", "arrow-left",
      () => ws.travel(-1), () => ws.active.back.length > 0, mod("arrowleft", { alt: true })),
    conditionalAction("app:go-forward", "Navigate forward", "arrow-right",
      () => ws.travel(1), () => ws.active.forward.length > 0, mod("arrowright", { alt: true })),
    // Obsidian has no default hotkeys for these two; Ctrl+Alt+[ / ] are Grove's.
    action("app:toggle-left-sidebar", "Toggle left sidebar", "panel-left", () => parts.docks.toggle("left"), mod("[", { alt: true })),
    action("app:toggle-right-sidebar", "Toggle right sidebar", "panel-right", () => parts.docks.toggle("right"), mod("]", { alt: true })),
    { id: "app:toggle-ribbon", name: "Toggle ribbon", run: () => settings.set("appearance.json", "showRibbon", !appearance().showRibbon) },
    action(
      "theme:toggle-light-dark",
      "Toggle light/dark mode",
      "sun-moon",
      () => settings.set("appearance.json", "theme", currentTheme() === "dark" ? "light" : "dark"),
    ),
    { id: "window:zoom-in", name: "Zoom in", icon: "zoom-in", hotkeys: [...mod("="), ...mod("+", { shift: true })], run: () => setZoom(appearance().zoomLevel + 0.5) },
    { id: "window:zoom-out", name: "Zoom out", icon: "zoom-out", hotkeys: mod("-"), run: () => setZoom(appearance().zoomLevel - 0.5) },
    { id: "window:reset-zoom", name: "Reset zoom", hotkeys: mod("0"), run: () => setZoom(0) },
    { id: "editor:toggle-line-numbers", name: "Toggle line numbers", icon: "list-ordered", run: () => settings.set("app.json", "showLineNumber", !app().showLineNumber) },
    { id: "editor:toggle-spellcheck", name: "Toggle spellcheck", icon: "type", run: () => settings.set("app.json", "spellcheck", !app().spellcheck) },
    conditionalAction("markdown:toggle-preview", "Toggle reading view", "book-open",
      () => ws.setMode(ws.active.mode === "reading" ? "live" : "reading"), hasNote, mod("e")),
    conditionalAction("editor:toggle-source", "Toggle Live Preview/Source mode", "code-xml",
      () => ws.setMode(ws.active.mode === "source" ? "live" : "source"), () => hasNote() && ws.active.mode !== "reading"),
    action(
      "editor:toggle-readable-line-length",
      "Toggle readable line length",
      "ruler",
      () => settings.set("app.json", "readableLineLength", !app().readableLineLength),
    ),
    { id: "app:increase-font-size", name: "Increase font size", icon: "a-large-small", run: () => setFontSize(1) },
    { id: "app:decrease-font-size", name: "Decrease font size", icon: "a-large-small", run: () => setFontSize(-1) },

    // ----- the open file -----
    conditionalAction("workspace:edit-file-title", "Rename file", "pen-line",
      () => parts.panes.focusTitle(true), hasNote, [{ key: "f2" }]),
    conditionalAction(
      "app:delete-file",
      "Delete current file",
      "trash-2",
      () => deleteFile(ws, note()).catch((err) => console.warn("Could not delete", err)),
    ),
    conditionalAction(
      "file-explorer:duplicate-file",
      "Make a copy of the current file",
      "files",
      () => copyNote(ws, note()).catch((err) => console.warn("Could not copy", err)),
    ),
    conditionalAction("file-explorer:move-file", "Move current file to another folder", "folder-tree", () => openMovePrompt(ws, note())),
    pluginAction("note-composer", "note-composer:merge-file", "Note composer: Merge current file with another file...", "git-merge",
      () => openMergePrompt(ws, note()), () => hasNote() && ws.vault.notes.length > 1),
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
    conditionalAction("workspace:copy-path", "Copy current file path from vault folder", "copy", () => writeClipboard(note())),
    conditionalAction("workspace:copy-full-path", "Copy current file path from system root", "hard-drive", () => writeClipboard(systemPath(ws.vault.path, note()))),
    { id: "editor:save-file", name: "Save current file", hotkeys: mod("s"), when: hasNote, run: () => ws.saveNow() },
    pluginAction("bookmarks", "bookmarks:bookmark-current-file", "Bookmarks: Bookmark current file", "bookmark",
      () => bookmarks.toggle(note()), () => hasNote() && !bookmarks.has(note())),
    pluginAction("bookmarks", "bookmarks:unbookmark-current-file", "Bookmarks: Remove bookmark for current file", "bookmark-minus",
      () => bookmarks.toggle(note()), () => bookmarks.has(ws.active.path)),
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
    action("global-search:open", "Search: Search in all files", "search", () => showLeft("search"), mod("f", { shift: true })),
    { id: "bookmarks:open", name: "Bookmarks: Show bookmarks",
      plugin: "bookmarks", icon: "bookmark", run: () => showLeft("bookmarks") },
    { id: "backlink:open", name: "Backlinks: Show backlinks", plugin: "backlink", icon: "link", run: () => showRight("backlinks") },
    pluginAction("backlink", "backlink:toggle-backlinks-in-document", "Backlinks: Toggle backlinks in document", "link",
      () => parts.toggleBacklinksInDocument(), hasNote),
    { id: "outgoing-links:open", name: "Outgoing links: Show outgoing links", plugin: "outgoing-link", icon: "link-2", run: () => showRight("outgoing") },
    { id: "tag-pane:open", name: "Tags view: Show tags", plugin: "tag-pane", icon: "tags", run: () => showRight("tags") },
    { id: "properties:open", name: "Properties view: Show all properties", plugin: "properties", icon: "archive", run: () => showRight("properties") },
    { id: "outline:open", name: "Outline: Show outline", plugin: "outline", icon: "list", run: () => showRight("outline") },
    // Graph view: the global graph in a tab (Obsidian's Ctrl/Cmd+G), and the
    // open note's local graph to the right (as Obsidian opens it).
    { id: "graph:open", name: "Graph view: Open graph view", plugin: "graph", icon: "git-fork", hotkeys: mod("g"), run: () => ws.openView("graph") },
    pluginAction("graph", "graph:open-local", "Graph view: Open local graph", "git-fork",
      () => ws.openView("localgraph", "right", note()), hasNote),
    { id: "graph:show-local", name: "Graph view: Show local graph in sidebar", plugin: "graph", icon: "git-fork", run: () => showRight("localgraph") },

    // ----- editing -----
    editorCommand("editor:toggle-bold", "Toggle bold", "bold", toggleWrap("**"), mod("b")),
    editorCommand("editor:toggle-italics", "Toggle italic", "italic", toggleWrap("*"), mod("i")),
    editorCommand("editor:toggle-strikethrough", "Toggle strikethrough", "strikethrough", toggleWrap("~~")),
    editorCommand("editor:toggle-highlight", "Toggle highlight", "highlighter", toggleHighlight(null)),
    ...(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((c) =>
      editorCommand(`editor:toggle-highlight-${c}`, `Toggle ${c} highlight`, "highlighter", toggleHighlight(c)),
    ),
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
    {
      id: "markdown:add-metadata-property",
      name: "Add file property",
      icon: "list-plus",
      hotkeys: mod(";"),
      // Also from Reading view and from a field in the block, as in Obsidian.
      when: () => hasNote() && (!typingElsewhere() || ws.view.dom.contains(document.activeElement)),
      run: () => {
        if (openNewProperty(ws.view) || ws.active.mode === "reading") return;
        addProperty(ws.view);
        ws.view.focus();
      },
    },
    {
      ...editorCommand("editor:toggle-fold", "Toggle fold on the current line", "chevrons-down-up", (v) => toggleFoldAt(v, lineAtCaret())),
      when: () => canEdit() && (app().foldHeading || app().foldIndent),
    },
    {
      ...editorCommand("editor:fold-all", "Fold all headings and lists", "chevrons-down-up", foldAllAllowed),
      when: () => hasNote() && (app().foldHeading || app().foldIndent),
    },
    { ...editorCommand("editor:unfold-all", "Unfold all headings and lists", "chevrons-down-up", unfoldEverything), when: hasNote },
    editorCommand("editor:swap-line-up", "Move line up", "corner-right-up", moveLineUp),
    editorCommand("editor:swap-line-down", "Move line down", "corner-right-down", moveLineDown),
    editorCommand("editor:add-cursor-above", "Add cursor above", "mouse-pointer-click", addCursorAbove),
    editorCommand("editor:add-cursor-below", "Add cursor below", "mouse-pointer-click", addCursorBelow),
    editorCommand("editor:delete-paragraph", "Delete paragraph", "scissors", deleteLine, mod("d")),
    editorCommand("editor:indent-list", "Indent list item", "indent-increase", indentMore),
    editorCommand("editor:unindent-list", "Unindent list item", "indent-decrease", indentLess),
    followLink("editor:follow-link", "Follow link under cursor", false, [{ alt: true, key: "enter" }]),
    followLink("editor:open-link-in-new-leaf", "Open link under cursor in new tab", "tab", mod("enter")),
    followLink("editor:open-link-in-new-split", "Open link under cursor to the right", "right", mod("enter", { alt: true })),
    conditionalAction("editor:context-menu", "Show context menu under cursor", "menu",
      () => parts.editorMenuAtCaret(), () => hasNote() && !typingElsewhere()),
    conditionalAction("editor:focus", "Focus on last note", undefined,
      () => ws.view.focus(), hasNote),
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
