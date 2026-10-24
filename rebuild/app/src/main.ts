import "./styles/theme.css";
import "./styles/base.css";
import "./styles/sidedock.css";
import "./styles/fileTree.css";
import "./styles/sideViews.css";
import "./styles/panes.css";
import "./styles/tabs.css";
import "./styles/noteView.css";
import "./styles/menu.css";
import "./styles/prompt.css";
import "./styles/editor.css";
import "./styles/blocks.css";
import "./styles/properties.css";
import "./styles/motion.css";
import "./styles/settings.css";
import "./styles/graph.css";
import "./styles/canvas.css";
import "./styles/bases.css";
import { isTauri } from "./api";
import { type AppParts, registerAppCommands } from "./appCommands";
import { Bookmarks } from "./bookmarks";
import { commands, fromStored } from "./commands";
import { setEditorConfig } from "./editor/config";
import { countsField } from "./editor/counts";
import { frontmatterField } from "./editor/frontmatter";
import { filesChanged } from "./editor/livePreview";
import { refreshPropertyTypes } from "./editor/properties";
import { fileSettings, newNote } from "./fileOps";
import { updateLinks } from "./links/update";
import { applyAppearance, applyPageSettings } from "./settings/appearance";
import { excluder } from "./settings/exclude";
import { isSettingsOpen, openSettings } from "./settings/modal";
import type { PluginId } from "./settings/schema";
import { settingsSections } from "./settings/sections";
import { type SettingsFile, settings } from "./settings/store";
import { confirmDialog, isConfirmOpen } from "./shell/confirm";
import { installTooltips, h, iconButton } from "./shell/dom";
import { icon, type IconName } from "./shell/icons";
import { installHoverPreviews } from "./shell/hoverPreview";
import { type MenuItems, showMenu } from "./shell/menu";
import { createMenus } from "./shell/menus";
import { createTabLinks } from "./shell/tabLinks";
import { openMergePrompt } from "./shell/mergePrompt";
import { openMovePrompt } from "./shell/movePrompt";
import { createPanes } from "./shell/pane";
import { propertyIndex } from "./shell/propertyIndex";
import { warmUpPromptGlyphs } from "./shell/prompt";
import { loadLayout, loadWorkspace, saveLayout, saveWorkspace } from "./shell/prefs";
import { pathQuery } from "./shell/searchQuery";
import { createRightSidebar } from "./shell/rightSidebar";
import { rememberVault } from "./shell/recentVaults";
import { createSidebar } from "./shell/sidebar";
import { createSidedocks } from "./shell/sidedock";
import { fileName, noteName, parentDir, trimSlashes } from "./paths";
import { tabTitle } from "./tabs";
import { readStored, store } from "./storage";
import { Workspace } from "./workspace";

const ws = new Workspace();
installHoverPreviews(ws);
const bookmarks = new Bookmarks(ws);
ws.propertyHost = propertyIndex(ws).host;

// Commands first: the views show their hotkeys. The views are filled into
// `parts` below; commands only read them when they run.
const parts = {
  ws,
  bookmarks,
  openSettings: (section?: string) => openSettings(sections(), section, () => {
    if (ws.active.path) ws.view.focus();
  }),
  toggleBacklinksInDocument: () => ws.toggleBacklinks(),
  editorMenuAtCaret: () => {
    const view = ws.view;
    const head = view.state.selection.main.head;
    const at = view.coordsAtPos(head);
    if (at) showMenu(menus.editor(view, head), { x: at.left, y: at.bottom }, { keyboard: true });
  },
} as AppParts;
registerAppCommands(parts);
// Modals (settings, confirmations) have the keyboard too: hotkeys wait.
const suspended = commands.suspended;
commands.suspended = () => suspended() || isSettingsOpen() || isConfirmOpen();
commands.pluginEnabled = (plugin) => settings.get("core-plugins.json")[plugin as PluginId] ?? true;
if (import.meta.env.DEV) Object.assign(window, { ws, grove: commands, settings }); // for poking at from devtools

const tabLinks = createTabLinks(ws);
const menus = createMenus({
  ws,
  bookmarks,
  renameInTree: (path) => {
    docks.setCollapsed("left", false);
    sidebar.renameInTree(path);
  },
  renameActive: () => panes.focusTitle(true),
  newNoteIn: (folder) =>
    void newNote(ws, folder)
      .then(() => panes.focusTitle(true))
      .catch((err) => console.warn("Could not create a note", err)),
  newFolderIn: (folder) => {
    docks.setCollapsed("left", false);
    sidebar.newFolderIn(folder);
  },
  moveFile: (path) => openMovePrompt(ws, path),
  mergeFile: (path) => openMergePrompt(ws, path),
  linkTab: (tab) => tabLinks.start(tab),
  searchInFolder: (folder) => searchVault(pathQuery(folder)),
  revealInTree: (path) => {
    sidebar.select("files");
    docks.setCollapsed("left", false);
    sidebar.reveal(path);
  },
});
ws.editorMenu = (view, at, pos, keyboard, image) => showMenu(image ? menus.image(view, image) : menus.editor(view, pos), at, { keyboard });

const searchVault = (query: string) => {
  sidebar.searchFor(query);
  docks.setCollapsed("left", false);
};
const panes = createPanes(ws, () => menus, { searchTag: (tag) => searchVault(`tag:${tag}`) });
const sidebar = createSidebar(ws, bookmarks, () => menus);
const rightSidebar = createRightSidebar(
  ws,
  () => !docks.isCollapsed("right"),
  searchVault,
  (path, at) => showMenu(menus.graphNode(path), at),
);

// ----- ribbon -----

// Obsidian's ribbon: its actions are commands, and right-clicking it lists
// them with a check to show or hide each one. These are Obsidian's, in its
// order and with its glyphs, where Grove has the feature (Bases comes later).
// A core plugin that is off takes its button away too.
const RIBBON: { id: string; label: string; icon: IconName; plugin?: PluginId }[] = [
  { id: "switcher:open", label: "Open quick switcher", icon: "file-search", plugin: "switcher" },
  { id: "graph:open", label: "Open graph view", icon: "git-fork", plugin: "graph" },
  { id: "canvas:new-file", label: "Create new canvas", icon: "layout-dashboard" },
  { id: "daily-notes", label: "Open today's daily note", icon: "calendar", plugin: "daily-notes" },
  { id: "templates:insert-template", label: "Insert template", icon: "files", plugin: "templates" },
  { id: "command-palette:open", label: "Open command palette", icon: "terminal", plugin: "command-palette" },
];
const RIBBON_HIDDEN = "grove.ribbon.hidden";
const savedHidden = readStored(RIBBON_HIDDEN, []);
const ribbonHidden = new Set<string>(Array.isArray(savedHidden) ? savedHidden.map(String) : []);
const ribbonActions = RIBBON.map((a) => iconButton(icon(a.icon), a.label, () => commands.run(a.id), "side-dock-ribbon-action"));
const ribbonPluginOn = (a: (typeof RIBBON)[number]) => !a.plugin || commands.pluginEnabled(a.plugin);
function renderRibbon() {
  RIBBON.forEach((a, i) => (ribbonActions[i].hidden = ribbonHidden.has(a.id) || !ribbonPluginOn(a)));
}
function setRibbonShown(id: string, shown: boolean) {
  if (shown) ribbonHidden.delete(id);
  else ribbonHidden.add(id);
  renderRibbon();
  store(RIBBON_HIDDEN, [...ribbonHidden]);
}
function ribbonMenu(e: MouseEvent) {
  e.preventDefault();
  const items: MenuItems = RIBBON.filter(ribbonPluginOn).map((a) => ({
    title: a.label,
    icon: a.icon,
    checked: !ribbonHidden.has(a.id),
    action: () => setRibbonShown(a.id, ribbonHidden.has(a.id)),
  }));
  showMenu(items, { x: e.clientX, y: e.clientY });
}
// Settings: Obsidian's gear sits at the right of the vault footer under the
// left sidebar; while that sidebar is closed, at the foot of the ribbon.
const settingsButton = () => iconButton(icon("settings"), "Settings", () => commands.run("app:open-settings"), "side-dock-settings-button");
const ribbon = h(
  "div",
  { class: "workspace-ribbon mod-left", oncontextmenu: ribbonMenu },
  iconButton(icon("panel-left"), "Toggle left sidebar", () => commands.run("app:toggle-left-sidebar"), "sidebar-toggle-button"),
  h("div", { class: "side-dock-actions" }, ...ribbonActions),
  h("div", { class: "side-dock-settings" }, settingsButton()),
);
sidebar.footer.querySelector(".workspace-drawer-vault-actions")!.append(settingsButton());

installTooltips();

// ----- status bar: backlinks, word and character counts for the open note -----

// Clicking the backlink count opens the Backlinks view, like Obsidian.
// Text only: Obsidian's status bar does not put an icon on this count.
const backlinkCount = h("span");
const backlinks = h(
  "div",
  { class: "status-bar-item mod-clickable", "aria-label": "Show backlinks", onclick: () => commands.run("backlink:open") },
  backlinkCount,
);
// "N properties": the open note's, as in Obsidian (not shown without
// frontmatter); a click shows them in the File properties view.
const propertyCount = h("div", { class: "status-bar-item mod-clickable", onclick: () => commands.run("properties:open-local") });
propertyCount.hidden = true;
// Words and characters share one item, as Obsidian's word-count plugin draws
// them (two segments inside the one status-bar item).
const words = h("span", { class: "status-bar-item-segment" });
const chars = h("span", { class: "status-bar-item-segment" });
const wordCount = h("div", { class: "status-bar-item plugin-word-count" }, words, chars);
// The editing mode (Settings → Editor → Show editing mode in status bar).
// The installed Obsidian editor-status menu lists Reading, then Source mode,
// then Live Preview, so Reading stays.
const MODES: { mode: "reading" | "source" | "live"; title: string; icon: IconName }[] = [
  { mode: "reading", title: "Reading", icon: "book-open" },
  { mode: "source", title: "Source mode", icon: "code-xml" },
  { mode: "live", title: "Live Preview", icon: "pen-line" },
];
const editorStatus = h("div", { class: "status-bar-item mod-clickable plugin-editor-status" });
editorStatus.addEventListener("click", () => {
  const tab = ws.active;
  showMenu(
    MODES.map((m) => ({ title: m.title, icon: m.icon, checked: tab.mode === m.mode, action: () => ws.setMode(m.mode, tab) })),
    editorStatus,
  );
});
let shownMode = "";
function renderEditorStatus() {
  const mode = ws.active.path ? ws.active.mode : "";
  editorStatus.hidden = !mode || !commands.pluginEnabled("editor-status");
  if (mode === shownMode || !mode) return;
  shownMode = mode;
  const m = MODES.find((x) => x.mode === mode)!;
  editorStatus.replaceChildren(icon(m.icon, 14));
  editorStatus.setAttribute("aria-label", m.title);
}
// Backlinks, then properties (hidden when the note has none), then the
// editing-mode icon, then words and characters together. No sync item.
const statusBar = h("div", { class: "status-bar" }, backlinks, propertyCount, editorStatus, wordCount);
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function renderCounts() {
  const path = ws.active.path;
  // A tab whose note is still loading shows no counts until it is on screen.
  const counts = path ? ws.view.state.field(countsField, false) : undefined;
  if (!counts) {
    statusBar.hidden = !path || [backlinks, propertyCount, editorStatus, wordCount].every((el) => el.hidden);
    return;
  }
  const { words: w, chars: c } = counts;
  words.textContent = plural(w, "word");
  chars.textContent = plural(c, "character");
  const props = ws.view.state.field(frontmatterField, false)?.props?.length ?? 0;
  propertyCount.hidden = !props || !commands.pluginEnabled("properties");
  propertyCount.textContent = `${props.toLocaleString()} ${props === 1 ? "property" : "properties"}`;
  statusBar.hidden = !path || [backlinks, propertyCount, editorStatus, wordCount].every((el) => el.hidden);
}
function renderBacklinks() {
  const path = ws.active.path;
  if (!path) return;
  const from = new Set((ws.vault.links.backlinks[path] ?? []).map((b) => b.from));
  backlinkCount.textContent = plural(from.size, "backlink");
}
ws.on((change) => {
  // Links to notes that were just created (or deleted) are drawn again.
  if (change === "files") for (const g of ws.groups()) ws.editors.viewOf(g).dispatch({ effects: filesChanged.of(null) });
  if (change === "doc" || change === "tabs" || change === "show") renderCounts();
  if (change === "links" || change === "tabs" || change === "show") renderBacklinks();
  if (change === "tabs" || change === "show" || change === "mode") renderEditorStatus();
});

// ----- layout -----

// A note's own window (Open in new window): just its tabs, and nothing it
// does is saved over the main window's layout.
const popoutNote = new URLSearchParams(location.search).get("note");

// The right sidebar starts closed; the vault's saved layout is applied once it is open.
const app = h(
  "div",
  { class: "app-container is-right-sidebar-collapsed" },
  ribbon,
  sidebar.el,
  panes.el,
  rightSidebar.el,
  statusBar,
);
document.getElementById("app")!.replaceWith(app);
if (popoutNote) app.classList.add("is-popout");

const docks = createSidedocks(app, panes);
rightSidebar.el.append(docks.resizeHandle("right"));
Object.assign(parts, { panes, docks, left: sidebar, right: rightSidebar });

// ----- settings -----

const sections = () =>
  settingsSections({
    ws,
    ribbon: { actions: RIBBON.filter(ribbonPluginOn), isShown: (id) => !ribbonHidden.has(id), setShown: setRibbonShown },
  });

const appSettings = () => settings.get("app.json");
ws.newTabMode = () => (appSettings().defaultViewMode === "preview" ? "reading" : appSettings().livePreview ? "live" : "source");
fileSettings.editingMode = () => (appSettings().livePreview ? "live" : "source");
ws.newTabBacklinks = () => commands.pluginEnabled("backlink") && settings.get("backlink.json").backlinkInDocument;
fileSettings.newNoteFolder = () => {
  const a = appSettings();
  if (a.newFileLocation === "current") return parentDir(ws.active.path ?? ws.active.viewFile ?? "");
  if (a.newFileLocation === "folder") return trimSlashes(a.newFileFolderPath);
  return "";
};
fileSettings.permanentDelete = () => appSettings().trashOption === "none";
ws.linkStyle = () => ({ format: appSettings().newLinkFormat, wikilinks: !appSettings().useMarkdownLinks });
fileSettings.confirmDelete = async (path) => {
  if (!appSettings().promptDelete) return true;
  const folder = ws.vault.isFolder(path);
  const name = fileName(path);
  const where = fileSettings.permanentDelete() ? "It will be permanently deleted." : "It will be moved to the vault's .trash folder.";
  const r = await confirmDialog({
    title: folder ? "Delete folder" : "Delete file",
    message: h(
      "div",
      null,
      h("p", null, `Are you sure you want to delete “${name}”${folder ? " and everything in it" : ""}?`),
      h("p", null, where),
    ),
    confirm: "Delete",
    warning: true,
    dontAskAgain: true,
  });
  if (r.dontAskAgain) settings.set("app.json", "promptDelete", false);
  return r.ok;
};
fileSettings.confirmMerge = async (from, into) => {
  if (!settings.get("note-composer.json").askBeforeMerging) return true;
  const r = await confirmDialog({
    title: "Merge file",
    message: `Merge “${noteName(from)}” into “${noteName(into)}”? Its text is added to the end of “${noteName(into)}”, and “${noteName(from)}” is deleted.`,
    confirm: "Merge",
    dontAskAgain: true,
  });
  if (r.dontAskAgain) settings.set("note-composer.json", "askBeforeMerging", false);
  return r.ok;
};
fileSettings.renamed = (from, to, before) => {
  const ask = appSettings().alwaysUpdateLinks
    ? null
    : async (links: number, notes: number) => {
        const r = await confirmDialog({
          title: "Update links?",
          message: `Update ${links} ${links === 1 ? "link" : "links"} in ${notes} ${notes === 1 ? "file" : "files"} to point at the new name?`,
          confirm: "Update",
          cancel: "Don't update",
          dontAskAgain: true,
        });
        if (r.dontAskAgain) settings.set("app.json", "alwaysUpdateLinks", true);
        return r.ok;
      };
  void updateLinks(ws, from, to, before, ws.linkStyle(), ask).catch((err) => console.warn("Could not update links", err));
};

/** A core plugin turned on or off: its views, ribbon buttons, status bar items and hints follow. */
function applyPlugins() {
  const on = (id: PluginId) => commands.pluginEnabled(id);
  renderRibbon();
  let anyRight = false;
  for (const [view, plugin] of [["backlinks", "backlink"], ["outgoing", "outgoing-link"], ["tags", "tag-pane"], ["properties", "properties"], ["outline", "outline"], ["fileprops", "properties"], ["localgraph", "graph"]] as const) {
    anyRight = rightSidebar.setEnabled(view, on(plugin));
  }
  // Graph view off: its tabs close, as Obsidian closes the plugin's views.
  if (!on("graph")) {
    const graphTabs = ws.layout.tabs().filter((t) => t.type);
    if (graphTabs.length) ws.closeTabs(graphTabs);
  }
  if (!anyRight) docks.setCollapsed("right", true);
  app.classList.toggle("is-right-sidebar-empty", !anyRight);
  sidebar.setBookmarksEnabled(on("bookmarks"));
  backlinks.hidden = !on("backlink");
  wordCount.hidden = !on("word-count");
  renderEditorStatus();
  panes.setBacklinksAllowed(on("backlink"));
  renderCounts();
  commands.changed();
}

let shownMetrics = "";

/** Apply one settings file (or all of them, after loading): each change lands in this frame. */
function applySettings(file: SettingsFile | null) {
  const all = file === null;
  if (all || file === "appearance.json") {
    const a = settings.get("appearance.json");
    applyAppearance(a);
    // Text size and fonts change line heights, which CodeMirror re-measures
    // when asked; a colour change (the scheme, the accent) needs nothing.
    const metrics = [a.baseFontSize, a.textFontFamily, a.interfaceFontFamily, a.monospaceFontFamily].join("|");
    if (metrics !== shownMetrics) {
      shownMetrics = metrics;
      for (const g of ws.groups()) ws.editors.viewOf(g).requestMeasure();
    }
  }
  if (all || file === "app.json") {
    const a = appSettings();
    applyPageSettings(a);
    if (setEditorConfig(a)) ws.editors.reconfigure();
    const test = excluder(a.userIgnoreFilters);
    if (ws.vault.isExcluded !== test) ws.vault.isExcluded = test;
  }
  if (all || file === "hotkeys.json") {
    commands.setCustomHotkeys(Object.fromEntries(Object.entries(settings.hotkeys).map(([id, list]) => [id, list.map(fromStored)])));
  }
  if (all || file === "core-plugins.json") applyPlugins();
  if (all || file === "types.json") refreshPropertyTypes(ws.groups().map((g) => ws.editors.viewOf(g)));
}
settings.on((file) => applySettings(file));
applySettings(null);

function rememberLayout() {
  if (!ws.vault.path || popoutNote) return;
  saveLayout(ws.vault.path, {
    rightOpen: !docks.isCollapsed("right"),
    rightWidth: docks.width("right"),
    rightView: rightSidebar.view,
    fileSort: sidebar.sortOrder,
  });
}
docks.onChange((side) => {
  if (side !== "right") return;
  rightSidebar.sync();
  rememberLayout();
});
rightSidebar.onSelect(rememberLayout);
sidebar.onSortChange(rememberLayout);

// Frameless window: the controls float over the top-right corner, above
// whichever header is rightmost (the tab strip, or the open right sidebar).
if (isTauri) void addWindowControls();
async function addWindowControls() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  app.classList.add("is-frameless");
  app.append(
    h(
      "div",
      { class: "titlebar-buttons" },
      iconButton(icon("minus"), "Minimize", () => void win.minimize(), "titlebar-button"),
      iconButton(icon("square"), "Maximize", () => void win.toggleMaximize(), "titlebar-button mod-maximize"),
      // Unsaved edits are written first, so closing a window loses nothing.
      iconButton(icon("x"), "Close", () => void ws.editors.flush().finally(() => win.close()), "titlebar-button mod-close"),
    ),
  );
  // The headers under the buttons leave exactly their width free (it varies
  // with the platform's fonts: 98px in WebKitGTK, where 92 was assumed).
  const buttons = app.querySelector<HTMLElement>(".titlebar-buttons")!;
  requestAnimationFrame(() => app.style.setProperty("--titlebar-buttons-width", `${Math.ceil(buttons.getBoundingClientRect().width)}px`));
}

// Hotkeys go through the command registry. Capture phase, so a command's
// hotkey wins over the editor's own binding for the same keys (Ctrl+I is
// italics, as in Obsidian, not CodeMirror's select-parent). Plain typing
// returns at the first check inside.
window.addEventListener("keydown", (e) => commands.handleKeydown(e), true);
// No browser context menu anywhere in the app chrome; text fields keep theirs.
document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement;
  if (!e.defaultPrevented && !target.closest("input, textarea")) e.preventDefault();
});
// The panes (split tree, sizes, tabs, active pane) are saved per vault a
// moment after they change, and when the window closes.
let workspaceTimer = 0;
let restored = false;
const rememberWorkspace = () => {
  clearTimeout(workspaceTimer);
  if (restored && ws.vault.path) saveWorkspace(ws.vault.path, ws.saveLayout());
};
const tauriWindow = isTauri ? import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow()) : null;

/** "Note - vault - Grove", for the browser tab and the Tauri window. */
function syncTitle() {
  const title = [tabTitle(ws.active), ws.vault.name, "Grove"].filter(Boolean).join(" - ");
  document.title = title;
  void tauriWindow?.then((win) => win.setTitle(title));
}

ws.on((change) => {
  if (change === "show" || change === "tabs") syncTitle();
  if (!restored || (change !== "tabs" && change !== "layout" && change !== "mode")) return;
  clearTimeout(workspaceTimer);
  workspaceTimer = window.setTimeout(rememberWorkspace, 500);
});
window.addEventListener("beforeunload", () => {
  rememberWorkspace();
  settings.flush();
  void ws.editors.flush();
});

await ws.vault.open(!!popoutNote);
if (ws.vault.path) rememberVault({ path: ws.vault.path, name: ws.vault.name });
// The vault's own settings (its .grove folder) before the first note shows.
await settings.load();
bookmarks.load();
if (popoutNote) await ws.open(popoutNote);
else await restoreLayout();
syncTitle();
warmUpPromptGlyphs();

async function restoreLayout() {
  const layout = loadLayout(ws.vault.path);
  docks.setWidth("right", layout.rightWidth);
  rightSidebar.select(layout.rightView);
  docks.setCollapsed("right", !layout.rightOpen, false);
  sidebar.setSortOrder(layout.fileSort);
  if (!(await ws.restoreLayout(loadWorkspace(ws.vault.path)))) {
    await ws.open(ws.resolve("Welcome") ?? ws.vault.notes[0]?.path ?? "");
  }
  restored = true;
}
