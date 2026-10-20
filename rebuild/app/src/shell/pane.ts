// The main pane: tab strip (doubling as the title bar), the sub-header with
// back/forward and breadcrumb, and the scrolling note view with its inline
// title above the editor in a centered readable column.

import { isTauri } from "../api";
import { duration, easing } from "../motion";
import { noteName, parentDir, type Tab, type Workspace } from "../workspace";
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

  // Tab headers are kept per tab id and updated in place, so a switch only
  // flips classes, and opening/closing a tab can animate its own header.
  const tabHeaders = new Map<number, { el: HTMLElement; title: HTMLElement }>();
  let tabsRendered = false;

  function tabHeader(tab: Tab) {
    const title = h("div", { class: "workspace-tab-header-inner-title" });
    const el = h(
      "div",
      {
        class: "workspace-tab-header",
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
        title,
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
    );
    return { el, title };
  }

  function renderTabs() {
    const open = new Set(ws.tabs.map((tab) => tab.id));
    for (const [id, { el }] of tabHeaders) {
      if (open.has(id)) continue;
      tabHeaders.delete(id);
      closeTabHeader(el);
    }
    let prev: Element | null = null;
    const added: HTMLElement[] = [];
    for (const tab of ws.tabs) {
      let header = tabHeaders.get(tab.id);
      if (!header) {
        tabHeaders.set(tab.id, (header = tabHeader(tab)));
        if (tabsRendered) added.push(header.el);
      }
      const { el, title } = header;
      const name = tab.path ? noteName(tab.path) : "New tab";
      if (title.textContent !== name) title.textContent = name;
      el.setAttribute("aria-label", tab.path ?? "New tab");
      el.classList.toggle("is-active", tab === ws.active);
      // Headers still shrinking away keep their place; order around them.
      let at: Element | null = prev ? prev.nextElementSibling : tabList.firstElementChild;
      while (at && at !== el && at.classList.contains("is-closing")) at = at.nextElementSibling;
      if (at !== el) tabList.insertBefore(el, at);
      prev = el;
    }
    for (const el of added) openTabHeader(el);
    tabsRendered = true;
  }

  // A new tab grows from nothing to the width it has in the settled strip,
  // which is measured first, so the last frame lands exactly on the layout
  // and the neighbours give up their room smoothly as it grows. Only this
  // tab's max-width animates; the strip is a small fixed-height box.
  function openTabHeader(el: HTMLElement) {
    const ms = duration("moderate");
    if (ms <= 0) return;
    const width = el.getBoundingClientRect().width;
    el.style.overflow = "hidden";
    el.animate(
      [
        { maxWidth: "0px", minWidth: "0px", opacity: 0 },
        { maxWidth: `${width}px`, minWidth: "0px", opacity: 1 },
      ],
      { duration: ms, easing: easing("out") },
    ).finished.then(
      () => (el.style.overflow = ""),
      () => {},
    );
  }

  // A closed tab shrinks from its current width to nothing, then goes. Like
  // a closing folder it eases in and out: a plain ease-in would leave the
  // last third of the width to vanish in a single frame.
  function closeTabHeader(el: HTMLElement) {
    el.classList.add("is-closing");
    const ms = duration("moderate");
    if (ms <= 0) return el.remove();
    const width = el.getBoundingClientRect().width;
    el.style.overflow = "hidden";
    el.animate(
      [
        { maxWidth: `${width}px`, minWidth: "0px", opacity: 1 },
        { maxWidth: "0px", minWidth: "0px", opacity: 0 },
      ],
      { duration: ms, easing: easing("in-out"), fill: "forwards" },
    ).finished.then(
      () => el.remove(),
      () => el.remove(),
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

  // A note switch eases the new text in from slightly transparent. The text
  // is painted on the first frame either way; swapping between two identical
  // animations restarts it without forcing a style flush.
  let fadeFlip: boolean | null = null;
  function fadeInNote() {
    if (!ws.active.path) return;
    if (fadeFlip !== null) {
      sizer.classList.toggle("mod-note-in-a", fadeFlip);
      sizer.classList.toggle("mod-note-in-b", !fadeFlip);
    }
    fadeFlip = !fadeFlip;
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
    if (change === "show") fadeInNote();
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
