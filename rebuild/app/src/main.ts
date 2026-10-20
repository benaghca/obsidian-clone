import "./styles/theme.css";
import "./styles/app.css";
import "./styles/editor.css";
import "./styles/motion.css";
import { countsField } from "./editor/counts";
import { h, iconButton } from "./shell/dom";
import { icon } from "./shell/icons";
import { createPane } from "./shell/pane";
import { openQuickSwitcher } from "./shell/quickSwitcher";
import { createSidebar } from "./shell/sidebar";
import { Workspace } from "./workspace";

const ws = new Workspace();
if (import.meta.env.DEV) Object.assign(window, { ws }); // for poking at from devtools

async function newNote() {
  await ws.newNote();
  pane.focusTitle(true);
}

async function dailyNote() {
  const d = new Date();
  const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await ws.openLink(name);
}

const commands = {
  quickSwitcher: () => openQuickSwitcher(ws),
  newNote: () => void newNote(),
};

const pane = createPane(ws, commands);
const sidebar = createSidebar(ws, commands.newNote);

const ribbon = h(
  "div",
  { class: "workspace-ribbon mod-left" },
  iconButton(icon("panel-left"), "Toggle left sidebar", () => app.classList.toggle("is-left-sidebar-collapsed"), "sidebar-toggle-button"),
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

const app = h("div", { class: "app-container" }, ribbon, sidebar, h("div", { class: "workspace-split mod-root" }, pane.el), statusBar);
document.getElementById("app")!.replaceWith(app);

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
  else handled = false;
  if (handled) e.preventDefault();
});
window.addEventListener("beforeunload", () => void ws.flushAll());

await ws.init();
await ws.open(ws.resolve("Welcome") ?? ws.notes[0]?.path ?? "");
