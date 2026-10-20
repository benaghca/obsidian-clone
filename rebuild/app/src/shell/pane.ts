// The main pane: tab strip (doubling as the title bar), the sub-header with
// back/forward and breadcrumb, and the scrolling note view with its inline
// title above the editor in a centered readable column.

import { isTauri } from "../api";
import { noteName, parentDir, type Workspace } from "../workspace";
import { h, iconButton } from "./dom";
import { icon } from "./icons";
import { showMenu } from "./menu";

export interface PaneCommands {
  quickSwitcher(): void;
  newNote(): void;
}

export interface Pane {
  el: HTMLElement;
  /** Focus the inline title, selecting it for a rename. */
  focusTitle(selectAll: boolean): void;
}

export function createPane(ws: Workspace, commands: PaneCommands): Pane {
  // ----- tab strip -----
  const tabList = h("div", { class: "workspace-tab-header-container-inner" });
  const tabListButton = iconButton(icon("chevron-down", 16), "Show tab list", (e) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    showMenu(
      ws.tabs.map((tab) => ({
        title: tab.path ? noteName(tab.path) : "New tab",
        checked: tab === ws.active,
        action: () => ws.activate(tab),
      })),
      rect.left,
      rect.bottom + 4,
    );
  });
  const strip = h(
    "div",
    { class: "workspace-tab-header-container", "data-tauri-drag-region": "" },
    tabList,
    iconButton(icon("plus", 16), "New tab", () => ws.newTab(), "workspace-tab-header-new-tab"),
    h("div", { class: "workspace-tab-header-spacer", "data-tauri-drag-region": "" }),
    h("div", { class: "workspace-tab-header-tab-list" }, tabListButton),
  );
  if (isTauri) void addWindowControls(strip);

  function renderTabs() {
    tabList.replaceChildren(
      ...ws.tabs.map((tab) =>
        h(
          "div",
          {
            class: `workspace-tab-header${tab === ws.active ? " is-active" : ""}`,
            "aria-label": tab.path ?? "New tab",
            onmousedown: (e: MouseEvent) => {
              if (e.button === 1) {
                e.preventDefault();
                ws.closeTab(tab);
              } else if (e.button === 0) ws.activate(tab);
            },
          },
          h(
            "div",
            { class: "workspace-tab-header-inner" },
            h("div", { class: "workspace-tab-header-inner-title" }, tab.path ? noteName(tab.path) : "New tab"),
            h(
              "div",
              {
                class: "workspace-tab-header-inner-close-button",
                "aria-label": "Close",
                onmousedown: (e: MouseEvent) => e.stopPropagation(),
                onclick: () => ws.closeTab(tab),
              },
              icon("x", 14),
            ),
          ),
        ),
      ),
    );
  }

  // ----- sub-header -----
  const back = iconButton(icon("arrow-left", 16), "Navigate back", () => void ws.goBack());
  const forward = iconButton(icon("arrow-right", 16), "Navigate forward", () => void ws.goForward());
  const breadcrumb = h("div", { class: "view-header-title-container" });
  const more = iconButton(icon("more-vertical", 16), "More options", (e) => {
    const path = ws.active.path;
    if (!path) return;
    showMenu(
      [
        { title: "Rename...", action: () => focusTitle(true) },
        { title: "Open in new tab", action: () => void ws.open(path, { newTab: true }) },
        { title: "Delete file", danger: true, action: () => void ws.remove(path) },
      ],
      e.clientX - 150,
      e.clientY + 12,
    );
  });
  const header = h(
    "div",
    { class: "view-header" },
    h("div", { class: "view-header-nav-buttons" }, back, forward),
    breadcrumb,
    h(
      "div",
      { class: "view-actions" },
      iconButton(icon("book-open", 16), "Reading view is not available yet", undefined, "is-disabled"),
      more,
    ),
  );

  function renderHeader() {
    const path = ws.active.path;
    back.classList.toggle("is-disabled", ws.active.back.length === 0);
    forward.classList.toggle("is-disabled", ws.active.forward.length === 0);
    breadcrumb.replaceChildren();
    if (!path) return;
    const dir = parentDir(path);
    for (const part of dir ? dir.split("/") : []) {
      breadcrumb.append(
        h("span", { class: "view-header-breadcrumb" }, part),
        h("span", { class: "view-header-breadcrumb-separator" }, "/"),
      );
    }
    breadcrumb.append(h("span", { class: "view-header-title" }, noteName(path)));
  }

  // ----- note view -----
  const title = h("div", { class: "inline-title", "aria-label": "Note title" });
  title.spellcheck = false;
  title.contentEditable = "plaintext-only";
  const sizer = h("div", { class: "markdown-sizer" }, title, ws.view.dom);
  const scroller = h("div", { class: "view-content" }, sizer);
  ws.scroller = scroller;

  const emptyAction = (label: string, hotkey: string, action: () => void) =>
    h("div", { class: "empty-state-action", onclick: action }, `${label}${hotkey ? ` (${hotkey})` : ""}`);
  const empty = h(
    "div",
    { class: "empty-state" },
    h("div", { class: "empty-state-title" }, "No file is open"),
    emptyAction("Create new note", "Ctrl + N", () => commands.newNote()),
    emptyAction("Go to file", "Ctrl + O", () => commands.quickSwitcher()),
    emptyAction("Close", "", () => ws.closeTab(ws.active)),
  );

  function renderView() {
    const path = ws.active.path;
    scroller.hidden = !path;
    empty.hidden = !!path;
    if (path && document.activeElement !== title) title.textContent = noteName(path);
  }

  function focusTitle(selectAll: boolean) {
    title.focus();
    const range = document.createRange();
    range.selectNodeContents(title);
    if (!selectAll) range.collapse(false);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }

  async function commitTitle() {
    const path = ws.active.path;
    if (!path) return;
    const name = (title.textContent ?? "").replace(/\n/g, "");
    try {
      await ws.rename(path, name);
    } catch (err) {
      console.warn(err);
      title.textContent = noteName(path);
    }
  }

  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      ws.view.focus();
      ws.view.dispatch({ selection: { anchor: 0 } });
    } else if (e.key === "Escape") {
      title.textContent = ws.active.path ? noteName(ws.active.path) : "";
      ws.view.focus();
    }
  });
  title.addEventListener("blur", () => void commitTitle());
  // Clicking the empty space below the text puts the caret at the end, like Obsidian.
  scroller.addEventListener("mousedown", (e) => {
    if (e.target === scroller || e.target === sizer) {
      e.preventDefault();
      ws.view.focus();
      ws.view.dispatch({ selection: { anchor: ws.view.state.doc.length }, scrollIntoView: true });
    }
  });

  ws.on((change) => {
    if (change === "tabs" || change === "files") {
      renderTabs();
      renderHeader();
      renderView();
    }
  });
  renderTabs();
  renderHeader();
  renderView();

  return { el: h("div", { class: "workspace-leaf" }, strip, header, scroller, empty), focusTitle };
}

async function addWindowControls(strip: HTMLElement) {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  strip.append(
    h(
      "div",
      { class: "titlebar-buttons" },
      iconButton(icon("minus", 16), "Minimize", () => void win.minimize(), "titlebar-button"),
      iconButton(icon("square", 14), "Maximize", () => void win.toggleMaximize(), "titlebar-button"),
      iconButton(icon("x", 16), "Close", () => void win.close(), "titlebar-button mod-close"),
    ),
  );
}
