// The main pane: tab strip (doubling as the title bar), the sub-header with
// back/forward and breadcrumb, and the scrolling note view with its inline
// title above the editor in a centered readable column.

import { commands } from "../commands";
import { duration, easing } from "../motion";
import { noteName, parentDir, type Tab, type Workspace } from "../workspace";
import { h, iconButton } from "./dom";
import { icon } from "./icons";
import { showMenu } from "./menu";
import type { Menus } from "./menus";
import type { ColumnHolder } from "./sidedock";

export interface Pane extends ColumnHolder {
  el: HTMLElement;
  /** Focus the inline title, selecting it for a rename. */
  focusTitle(selectAll: boolean): void;
}

/** `menus` is read when a menu opens (it is built after the pane). */
export function createPane(ws: Workspace, menus: () => Menus): Pane {
  // ----- tab strip -----
  const tabList = h("div", { class: "workspace-tab-header-container-inner" });
  const tabListButton = iconButton(icon("chevron-down"), "Show tab list", () =>
    showMenu(menus().tabList(), tabListButton, { align: "right" }),
  );
  const strip = h(
    "div",
    { class: "workspace-tab-header-container", "data-tauri-drag-region": "" },
    tabList,
    iconButton(icon("plus"), "New tab", () => commands.run("workspace:new-tab"), "workspace-tab-header-new-tab"),
    h("div", { class: "workspace-tab-header-spacer", "data-tauri-drag-region": "" }),
    h("div", { class: "workspace-tab-header-tab-list" }, tabListButton),
    iconButton(icon("panel-right"), "Toggle right sidebar", () => commands.run("app:toggle-right-sidebar"), "sidebar-toggle-button mod-right"),
  );

  // Tab headers are kept per tab id and updated in place, so a switch only
  // flips classes, and opening/closing a tab can animate its own header.
  const tabHeaders = new Map<number, { el: HTMLElement; title: HTMLElement; close: HTMLElement }>();
  let tabsRendered = false;

  function tabHeader(tab: Tab) {
    const title = h("div", { class: "workspace-tab-header-inner-title" });
    // Close button; on a pinned tab, a pin that unpins it (as in Obsidian).
    const close = h("div", {
      class: "workspace-tab-header-inner-close-button",
      onmousedown: (e: MouseEvent) => e.stopPropagation(),
      onclick: () => (tab.pinned ? ws.togglePin(tab) : ws.closeTab(tab)),
    });
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
        oncontextmenu: (e: MouseEvent) => {
          e.preventDefault();
          showMenu(menus().tab(tab), { x: e.clientX, y: e.clientY });
        },
      },
      h("div", { class: "workspace-tab-header-inner" }, title, close),
    );
    return { el, title, close };
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
      const { el, title, close } = header;
      const name = tab.path ? noteName(tab.path) : "New tab";
      if (title.textContent !== name) title.textContent = name;
      el.setAttribute("aria-label", tab.path ?? "New tab");
      el.classList.toggle("is-active", tab === ws.active);
      if (el.classList.contains("is-pinned") !== tab.pinned || !close.firstChild) {
        el.classList.toggle("is-pinned", tab.pinned);
        close.replaceChildren(icon(tab.pinned ? "pin" : "x", 14));
        close.setAttribute("aria-label", tab.pinned ? "Unpin" : "Close");
      }
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
  const back = iconButton(icon("arrow-left"), "Navigate back", () => commands.run("app:go-back"));
  const forward = iconButton(icon("arrow-right"), "Navigate forward", () => commands.run("app:go-forward"));
  const breadcrumb = h("div", { class: "view-header-title-container" });
  // Obsidian's mode button shows where a click takes you: the book while
  // editing, the pen while reading.
  const modeButton = iconButton(icon("book-open"), "", () => commands.run("markdown:toggle-preview"));
  const more = iconButton(icon("ellipsis-vertical"), "More options", () =>
    showMenu(menus().moreOptions(), more, { align: "right" }),
  );
  const actions = h("div", { class: "view-actions" }, modeButton, more);
  const header = h(
    "div",
    { class: "view-header" },
    h("div", { class: "view-header-nav-buttons" }, back, forward),
    breadcrumb,
    actions,
  );

  let shownMode = "";
  function renderMode() {
    const reading = ws.active.mode === "reading";
    const mode = reading ? "reading" : "editing";
    if (mode === shownMode) return;
    shownMode = mode;
    modeButton.replaceChildren(icon(reading ? "pen-line" : "book-open"));
    const label = reading ? "Current view: reading\nClick to edit" : "Current view: editing\nClick to read";
    modeButton.setAttribute("aria-label", label);
    modeButton.title = label;
  }

  function renderHeader() {
    const path = ws.active.path;
    back.classList.toggle("is-disabled", ws.active.back.length === 0);
    forward.classList.toggle("is-disabled", ws.active.forward.length === 0);
    actions.hidden = !path;
    renderMode();
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

  const emptyAction = (label: string, id: string) => {
    const hotkey = commands.hotkey(id);
    return h("div", { class: "empty-state-action", onclick: () => commands.run(id) }, `${label}${hotkey ? ` (${hotkey})` : ""}`);
  };
  const empty = h(
    "div",
    { class: "empty-state" },
    h("div", { class: "empty-state-title" }, "No file is open"),
    emptyAction("Create new note", "file-explorer:new-file"),
    emptyAction("Go to file", "switcher:open"),
    h("div", { class: "empty-state-action", onclick: () => ws.closeTab(ws.active) }, "Close"),
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

  // While a side dock opens or closes, the column keeps the narrower of its
  // start and end widths, so the text never re-wraps mid-move, and its left
  // margin eases from where it is to its final centred value in step with
  // the dock (same timing, same start time). Margin and pane edge then move
  // on the same curve, so the column's left edge travels straight from its
  // old place to its new one, and the one re-wrap at the end (or start) only
  // moves line ends.
  let hold: Animation | null = null;
  function holdColumn(delta: number, dock?: Animation) {
    hold?.cancel();
    hold = null;
    sizer.style.width = "";
    sizer.style.marginLeft = "";
    const timing = dock?.effect?.getComputedTiming();
    const ms = typeof timing?.duration === "number" ? timing.duration : duration("sidebar");
    if (scroller.hidden || ms <= 0) return;
    const style = getComputedStyle(scroller);
    const padLeft = parseFloat(style.paddingLeft);
    const avail = scroller.clientWidth - padLeft - parseFloat(style.paddingRight);
    const rect = sizer.getBoundingClientRect();
    const fromMargin = rect.left - scroller.getBoundingClientRect().left - padLeft;
    const endWidth = Math.min(parseFloat(getComputedStyle(sizer).maxWidth) || Infinity, avail + delta);
    const toMargin = Math.max(0, (avail + delta - endWidth) / 2);
    sizer.style.width = `${Math.min(rect.width, endWidth)}px`;
    sizer.style.marginLeft = `${toMargin}px`;
    const anim = sizer.animate([{ marginLeft: `${fromMargin}px` }, { marginLeft: `${toMargin}px` }], {
      duration: ms,
      easing: (dock?.effect?.getTiming().easing as string | undefined) ?? easing("out"),
    });
    if (dock?.startTime != null) anim.startTime = dock.startTime;
    hold = anim;
    anim.finished.then(
      () => {
        if (hold !== anim) return;
        hold = null;
        sizer.style.width = "";
        sizer.style.marginLeft = "";
      },
      () => {},
    );
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
    if (change === "mode") renderMode();
    if (change === "tabs" || change === "files") {
      renderTabs();
      renderHeader();
      renderView();
    }
  });
  renderTabs();
  renderHeader();
  renderView();

  return { el: h("div", { class: "workspace-leaf" }, strip, header, scroller, empty), focusTitle, holdColumn };
}
