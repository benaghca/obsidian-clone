import "./styles/theme.css";
import "./styles/app.css";
import "./styles/editor.css";
import "./styles/motion.css";
import { isTauri } from "./api";
import { type AppParts, registerAppCommands } from "./appCommands";
import { Bookmarks } from "./bookmarks";
import { commands } from "./commands";
import { countsField } from "./editor/counts";
import { h, iconButton } from "./shell/dom";
import { icon, type IconName } from "./shell/icons";
import { type MenuItems, showMenu } from "./shell/menu";
import { createMenus } from "./shell/menus";
import { openMovePrompt } from "./shell/movePrompt";
import { createPane } from "./shell/pane";
import { warmUpPromptGlyphs } from "./shell/prompt";
import { loadLayout, saveLayout } from "./shell/prefs";
import { createRightSidebar } from "./shell/rightSidebar";
import { createSidebar } from "./shell/sidebar";
import { createSidedocks } from "./shell/sidedock";
import { Workspace } from "./workspace";

const ws = new Workspace();
const bookmarks = new Bookmarks(ws);

// Commands first: the views show their hotkeys. The views are filled into
// `parts` below; commands only read them when they run.
const parts = { ws, bookmarks } as AppParts;
registerAppCommands(parts);
if (import.meta.env.DEV) Object.assign(window, { ws, grove: commands }); // for poking at from devtools

const menus = createMenus({
  ws,
  bookmarks,
  renameInTree: (path) => {
    docks.setCollapsed("left", false);
    sidebar.renameInTree(path);
  },
  renameActive: () => pane.focusTitle(true),
  newNoteIn: (folder) =>
    void ws
      .newNote(folder)
      .then(() => pane.focusTitle(true))
      .catch((err) => console.warn("Could not create a note", err)),
  newFolderIn: (folder) => {
    docks.setCollapsed("left", false);
    sidebar.newFolderIn(folder);
  },
  moveFile: (path) => openMovePrompt(ws, path),
  revealInTree: (path) => {
    sidebar.select("files");
    docks.setCollapsed("left", false);
    sidebar.reveal(path);
  },
});
ws.editorMenu = (view, at, pos, keyboard) => showMenu(menus.editor(view, pos), at, { keyboard });

const pane = createPane(ws, () => menus);
const sidebar = createSidebar(ws, bookmarks, () => menus);
const rightSidebar = createRightSidebar(
  ws,
  () => !docks.isCollapsed("right"),
  (query) => {
    sidebar.searchFor(query);
    docks.setCollapsed("left", false);
  },
);

// ----- ribbon -----

// Obsidian's ribbon: its actions are commands, and right-clicking it lists
// them with a check to show or hide each one.
const RIBBON: { id: string; label: string; icon: IconName }[] = [
  { id: "switcher:open", label: "Open quick switcher", icon: "arrow-left-right" },
  { id: "daily-notes", label: "Open today's daily note", icon: "calendar-days" },
  { id: "file-explorer:new-file", label: "Create new note", icon: "square-pen" },
  { id: "command-palette:open", label: "Open command palette", icon: "square-terminal" },
];
const RIBBON_HIDDEN = "grove.ribbon.hidden";
const ribbonHidden = new Set<string>();
try {
  for (const id of JSON.parse(localStorage.getItem(RIBBON_HIDDEN) ?? "[]")) ribbonHidden.add(String(id));
} catch {
  // no storage: every action shows
}
const ribbonActions = RIBBON.map((a) => {
  const button = iconButton(icon(a.icon), a.label, () => commands.run(a.id), "side-dock-ribbon-action");
  button.hidden = ribbonHidden.has(a.id);
  return button;
});
function ribbonMenu(e: MouseEvent) {
  e.preventDefault();
  const items: MenuItems = RIBBON.map((a, i) => ({
    title: a.label,
    icon: a.icon,
    checked: !ribbonHidden.has(a.id),
    action: () => {
      if (ribbonHidden.has(a.id)) ribbonHidden.delete(a.id);
      else ribbonHidden.add(a.id);
      ribbonActions[i].hidden = ribbonHidden.has(a.id);
      try {
        localStorage.setItem(RIBBON_HIDDEN, JSON.stringify([...ribbonHidden]));
      } catch {
        // not remembered
      }
    },
  }));
  showMenu(items, { x: e.clientX, y: e.clientY });
}
const ribbon = h(
  "div",
  { class: "workspace-ribbon mod-left", oncontextmenu: ribbonMenu },
  iconButton(icon("panel-left"), "Toggle left sidebar", () => commands.run("app:toggle-left-sidebar"), "sidebar-toggle-button"),
  h("div", { class: "side-dock-actions" }, ...ribbonActions),
);

// ----- status bar: backlinks, word and character counts for the open note -----

// Clicking the backlink count opens the Backlinks view, like Obsidian.
const backlinkCount = h("span");
const backlinks = h(
  "div",
  { class: "status-bar-item mod-clickable", title: "Show backlinks", onclick: () => commands.run("backlink:open") },
  icon("link", 14),
  backlinkCount,
);
const words = h("div", { class: "status-bar-item" });
const chars = h("div", { class: "status-bar-item" });
const statusBar = h("div", { class: "status-bar" }, backlinks, words, chars);
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function renderCounts() {
  const path = ws.active.path;
  statusBar.hidden = !path;
  if (!path) return;
  const { words: w, chars: c } = ws.view.state.field(countsField);
  words.textContent = plural(w, "word");
  chars.textContent = plural(c, "character");
}
function renderBacklinks() {
  const path = ws.active.path;
  if (!path) return;
  const from = new Set((ws.links.backlinks[path] ?? []).map((b) => b.from));
  backlinkCount.textContent = plural(from.size, "backlink");
}
ws.on((change) => {
  if (change === "doc" || change === "tabs") renderCounts();
  if (change === "links" || change === "tabs") renderBacklinks();
});

// ----- layout -----

// The right sidebar starts closed; the vault's saved layout is applied once it is open.
const app = h(
  "div",
  { class: "app-container is-right-sidebar-collapsed" },
  ribbon,
  sidebar.el,
  h("div", { class: "workspace-split mod-root" }, pane.el),
  rightSidebar.el,
  statusBar,
);
document.getElementById("app")!.replaceWith(app);

const docks = createSidedocks(app, pane);
rightSidebar.el.append(docks.resizeHandle("right"));
Object.assign(parts, { pane, docks, left: sidebar, right: rightSidebar });

function rememberLayout() {
  if (!ws.vault.path) return;
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
      iconButton(icon("x"), "Close", () => void win.close(), "titlebar-button mod-close"),
    ),
  );
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
window.addEventListener("beforeunload", () => void ws.flushAll());

await ws.init();
bookmarks.load();
const layout = loadLayout(ws.vault.path);
docks.setWidth("right", layout.rightWidth);
rightSidebar.select(layout.rightView);
docks.setCollapsed("right", !layout.rightOpen, false);
sidebar.setSortOrder(layout.fileSort);
await ws.open(ws.resolve("Welcome") ?? ws.notes[0]?.path ?? "");
warmUpPromptGlyphs();
