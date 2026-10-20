import "./styles/theme.css";
import "./styles/app.css";
import "./styles/editor.css";
import "./styles/motion.css";
import { isTauri } from "./api";
import { countsField } from "./editor/counts";
import { h, iconButton } from "./shell/dom";
import { icon } from "./shell/icons";
import { createPane } from "./shell/pane";
import { loadLayout, saveLayout } from "./shell/prefs";
import { openQuickSwitcher } from "./shell/quickSwitcher";
import { createRightSidebar } from "./shell/rightSidebar";
import { createSidebar } from "./shell/sidebar";
import { createSidedocks } from "./shell/sidedock";
import { Workspace } from "./workspace";

const ws = new Workspace();

async function newNote() {
  await ws.newNote();
  pane.focusTitle(true);
}

async function dailyNote() {
  const d = new Date();
  const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await ws.openLink(name);
}

function showRightView(view: "backlinks" | "outline") {
  rightSidebar.select(view);
  docks.setCollapsed("right", false);
}

const commands = {
  quickSwitcher: () => openQuickSwitcher(ws),
  newNote: () => void newNote(),
  toggleLeftSidebar: () => docks.toggle("left"),
  toggleRightSidebar: () => docks.toggle("right"),
  showBacklinks: () => showRightView("backlinks"),
  showOutline: () => showRightView("outline"),
};
if (import.meta.env.DEV) Object.assign(window, { ws, grove: commands }); // for poking at from devtools

const pane = createPane(ws, commands);
const sidebar = createSidebar(ws, commands.newNote);
const rightSidebar = createRightSidebar(ws, () => !docks.isCollapsed("right"));

const ribbon = h(
  "div",
  { class: "workspace-ribbon mod-left" },
  iconButton(icon("panel-left"), "Toggle left sidebar", commands.toggleLeftSidebar, "sidebar-toggle-button"),
  h(
    "div",
    { class: "side-dock-actions" },
    iconButton(icon("switch-files"), "Open quick switcher", commands.quickSwitcher),
    iconButton(icon("calendar"), "Open today's daily note", () => void dailyNote()),
    iconButton(icon("square-pen"), "Create new note", commands.newNote),
  ),
);

// Floating status bar: backlinks, word and character counts for the open note.
const backlinks = h("div", { class: "status-bar-item" });
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
  backlinks.textContent = plural(from.size, "backlink");
}
ws.on((change) => {
  if (change === "doc" || change === "tabs") renderCounts();
  if (change === "links" || change === "tabs") renderBacklinks();
});

// The right sidebar starts closed; the vault's saved layout is applied once it is open.
const app = h(
  "div",
  { class: "app-container is-right-sidebar-collapsed" },
  ribbon,
  sidebar,
  h("div", { class: "workspace-split mod-root" }, pane.el),
  rightSidebar.el,
  statusBar,
);
document.getElementById("app")!.replaceWith(app);

const docks = createSidedocks(app, pane);
rightSidebar.el.append(docks.resizeHandle("right"));

function rememberLayout() {
  if (!ws.vault.path) return;
  saveLayout(ws.vault.path, {
    rightOpen: !docks.isCollapsed("right"),
    rightWidth: docks.width("right"),
    rightView: rightSidebar.view,
  });
}
docks.onChange((side) => {
  if (side !== "right") return;
  rightSidebar.sync();
  rememberLayout();
});
rightSidebar.onSelect(rememberLayout);

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
      iconButton(icon("minus", 16), "Minimize", () => void win.minimize(), "titlebar-button"),
      iconButton(icon("square", 14), "Maximize", () => void win.toggleMaximize(), "titlebar-button"),
      iconButton(icon("x", 16), "Close", () => void win.close(), "titlebar-button mod-close"),
    ),
  );
}

// Global shortcuts (Obsidian defaults). Editor keys are handled by CodeMirror.
document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  let handled = true;
  if (mod && !e.shiftKey && !e.altKey && key === "o") commands.quickSwitcher();
  else if (mod && !e.shiftKey && !e.altKey && key === "n") commands.newNote();
  else if (mod && !e.shiftKey && key === "t") ws.newTab();
  else if (mod && !e.shiftKey && key === "w") ws.closeTab(ws.active);
  else if (mod && key === "tab") ws.cycleTab(e.shiftKey ? -1 : 1);
  else if (mod && e.altKey && key === "arrowleft") void ws.goBack();
  else if (mod && e.altKey && key === "arrowright") void ws.goForward();
  else if (mod && e.altKey && e.code === "BracketLeft") commands.toggleLeftSidebar();
  else if (mod && e.altKey && e.code === "BracketRight") commands.toggleRightSidebar();
  else handled = false;
  if (handled) e.preventDefault();
});
window.addEventListener("beforeunload", () => void ws.flushAll());

await ws.init();
const layout = loadLayout(ws.vault.path);
docks.setWidth("right", layout.rightWidth);
rightSidebar.select(layout.rightView);
docks.setCollapsed("right", !layout.rightOpen, false);
await ws.open(ws.resolve("Welcome") ?? ws.notes[0]?.path ?? "");
