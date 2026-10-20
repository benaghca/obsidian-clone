// The main workspace: the split tree of tab groups (layout.ts), drawn like
// Obsidian's. Each group has its own tab strip (the top ones double as the
// title bar), a sub-header with back/forward and breadcrumb, and the
// scrolling note view with its inline title above the editor in a centred
// readable column. Splits get thin draggable dividers; tabs can be dragged
// between groups or onto a pane's edge (tabDrag.ts).
//
// DOM is kept per group and per split and only moved when the tree changes,
// so a split, a close or a tab move never rebuilds an editor.

import { commands } from "../commands";
import type { Direction, LayoutNode, Split } from "../layout";
import { duration, easing } from "../motion";
import { type Group, noteName, parentDir, type Tab, type Workspace } from "../workspace";
import { h, iconButton } from "./dom";
import { icon } from "./icons";
import { showMenu } from "./menu";
import type { Menus } from "./menus";
import type { ColumnHolder } from "./sidedock";
import { startTabDrag } from "./tabDrag";
import { createBacklinksView } from "./backlinksView";
import type { SideView } from "./outlineView";

export interface Panes extends ColumnHolder {
  el: HTMLElement;
  /** Whether backlinks may show under notes (the Backlinks core plugin is on). */
  setBacklinksAllowed(allowed: boolean): void;
  /** Focus the active pane's inline title, selecting it for a rename. */
  focusTitle(selectAll: boolean): void;
}

/**
 * No pane can be dragged smaller than this (px), across or down. 200px
 * across is Obsidian 1.14.4's (measured by dragging a divider as far as it
 * goes); below about that, words start breaking in the text column.
 */
export const MIN_PANE_WIDTH = 200;
export const MIN_PANE_HEIGHT = 120;
const minFor = (direction: Direction) => (direction === "vertical" ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT);

interface GroupView {
  group: Group;
  el: HTMLElement;
  strip: HTMLElement;
  scroller: HTMLElement;
  tabList: HTMLElement;
  /** Tab header elements by tab id, for the drag code to measure. */
  headers: Map<number, HTMLElement>;
  render(): void;
  renderMode(): void;
  renderBacklinks(): void;
  fade(): void;
  holdColumn(delta: number, dock?: Animation): void;
  focusTitle(selectAll: boolean): void;
  dispose(): void;
}

/** `menus` is read when a menu opens (it is built after the panes). */
export function createPanes(ws: Workspace, menus: () => Menus): Panes {
  const root = h("div", { class: "workspace-split mod-vertical mod-root" });
  const views = new Map<Group, GroupView>();
  let backlinksAllowed = true;
  const splitEls = new Map<number, HTMLElement>();

  /** Group views made since the last layout pass; they get their scroll position once attached. */
  const fresh = new Set<GroupView>();
  const viewFor = (group: Group) => {
    let v = views.get(group);
    if (!v) {
      views.set(group, (v = createGroupView(ws, group, menus)));
      fresh.add(v);
    }
    return v;
  };

  // ----- the split tree -----

  // The top split is drawn by the root element itself, so splitting a lone
  // pane (or adding to the top row) never moves the panes already there.
  // Moving an element in the DOM resets its scroll, so whatever does move is
  // noted and gets its scroll position back.
  const splitIds = new WeakMap<HTMLElement, number>();
  let moved: HTMLElement[] = [];

  /** Put `wanted` in `parent` in order, moving only what is out of place. */
  function arrange(parent: HTMLElement, wanted: HTMLElement[]) {
    wanted.forEach((el, i) => {
      const at = parent.children[i] ?? null;
      if (at === el) return;
      if (el.isConnected) moved.push(el);
      parent.insertBefore(el, at);
    });
    while (parent.children.length > wanted.length) parent.lastElementChild!.remove();
  }

  function nodeEl(node: LayoutNode<Tab>, size: number): HTMLElement {
    const el = node.kind === "group" ? viewFor(node).el : splitEl(node);
    el.style.flexGrow = String(size);
    return el;
  }

  function splitEl(split: Split<Tab>, el = splitEls.get(split.id)): HTMLElement {
    if (!el) splitEls.set(split.id, (el = h("div", { class: "workspace-split" })));
    splitIds.set(el, split.id);
    el.classList.toggle("mod-vertical", split.direction === "vertical");
    el.classList.toggle("mod-horizontal", split.direction === "horizontal");
    const kids = split.children.map((c, i) => nodeEl(c, split.sizes[i]));
    const handles = split.children.slice(0, -1).map((_, i) => resizeHandle(i, el!));
    arrange(el, [...kids, ...handles]);
    placeHandles(split, handles);
    return el;
  }

  /** Dividers sit on the boundaries between children, at their fractional offsets. */
  function placeHandles(split: Split<Tab>, handles: HTMLElement[]) {
    let at = 0;
    handles.forEach((handle, i) => {
      at += split.sizes[i];
      handle.style.setProperty("--at", `${at * 100}%`);
    });
  }

  const handleEls = new WeakMap<HTMLElement, HTMLElement[]>();

  function resizeHandle(index: number, container: HTMLElement): HTMLElement {
    const list = handleEls.get(container) ?? [];
    handleEls.set(container, list);
    let handle = list[index];
    if (!handle) {
      handle = list[index] = h("div", { class: "workspace-leaf-resize-handle mod-split" });
      handle.addEventListener("pointerdown", (e) => onResizeStart(e, container, index));
    }
    return handle;
  }

  // The split a container element draws (looked up at drag time, so a
  // handle always resizes the tree as it is now).
  function splitOf(container: HTMLElement): Split<Tab> | null {
    const id = splitIds.get(container);
    const find = (n: LayoutNode<Tab>): Split<Tab> | null =>
      n.kind === "group" ? null : n.id === id ? n : n.children.reduce<Split<Tab> | null>((f, c) => f ?? find(c), null);
    return id === undefined ? null : find(ws.layout.root);
  }

  // Dragging a divider: the container's size is read once; each frame then
  // only writes the two neighbours' flex-grow and the divider's offset.
  function onResizeStart(down: PointerEvent, container: HTMLElement, index: number) {
    const split = splitOf(container);
    if (down.button !== 0 || !split) return;
    down.preventDefault();
    const handle = down.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(down.pointerId);
    } catch {
      // not a live pointer (a synthetic event): the moves still reach the handle while over it
    }
    const vertical = split.direction === "vertical";
    const rect = container.getBoundingClientRect();
    const total = vertical ? rect.width : rect.height;
    const start = [...split.sizes];
    const from = vertical ? down.clientX : down.clientY;
    const kids = split.children.map((c) => (c.kind === "group" ? viewFor(c).el : (splitEls.get(c.id) ?? container)));
    const handles = handleEls.get(container) ?? [];
    let pos = from;
    let frame = 0;
    document.body.classList.add(vertical ? "is-resizing-x" : "is-resizing-y");
    handle.classList.add("is-dragging");
    const apply = () => {
      frame = 0;
      split.sizes = [...start];
      const sizes = ws.layout.resize(split, index, pos - from, total, minFor(split.direction));
      kids[index].style.flexGrow = String(sizes[index]);
      kids[index + 1].style.flexGrow = String(sizes[index + 1]);
      placeHandles(split, handles.slice(0, split.children.length - 1));
    };
    const move = (e: PointerEvent) => {
      pos = vertical ? e.clientX : e.clientY;
      frame ||= requestAnimationFrame(apply);
    };
    const up = () => {
      cancelAnimationFrame(frame);
      apply();
      handle.classList.remove("is-dragging");
      document.body.classList.remove("is-resizing-x", "is-resizing-y");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      ws.resized();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  function renderLayout() {
    // Scroll positions are read before anything moves (cheap: nothing has
    // changed the layout since it was last computed).
    const scrolls = new Map<GroupView, number>();
    for (const v of views.values()) if (v.scroller.scrollTop) scrolls.set(v, v.scroller.scrollTop);
    moved = [];
    const top = ws.layout.root;
    if (top.kind === "split") {
      splitEls.set(top.id, root);
      splitEl(top, root);
    } else {
      root.classList.add("mod-vertical");
      root.classList.remove("mod-horizontal");
      arrange(root, [nodeEl(top, 1)]);
    }
    root.classList.add("workspace-split", "mod-root");
    const live = new Set(ws.groups());
    for (const [group, v] of views) {
      if (live.has(group)) continue;
      v.dispose();
      views.delete(group);
    }
    for (const [id, el] of splitEls) if (!el.isConnected || splitIds.get(el) !== id) splitEls.delete(id);
    for (const [v, top] of scrolls) {
      if (views.get(v.group) === v && moved.some((el) => el.contains(v.el))) v.scroller.scrollTop = top;
    }
    moved = [];
    for (const v of fresh) if (views.get(v.group) === v) ws.setScroller(v.group, v.scroller);
    fresh.clear();
    renderPlaces();
  }

  /**
   * Which groups touch the top of the window (their tab strips are the
   * title bar), and which one is in the top-right corner (it holds the
   * right-sidebar button and leaves room for the window buttons).
   */
  function renderPlaces() {
    const rects = ws.layout.rects();
    let corner: Group | null = null;
    for (const [group, r] of rects) {
      const v = viewFor(group);
      const top = r.y < 1e-6;
      v.el.classList.toggle("mod-top", top);
      if (top && r.x + r.w > 1 - 1e-6) corner = group;
      // The empty parts of a top strip move the window (Tauri reads the attribute on the element pressed).
      for (const el of [v.strip, v.strip.querySelector(".workspace-tab-header-spacer")!]) el.toggleAttribute("data-tauri-drag-region", top);
    }
    for (const [group, v] of views) v.el.classList.toggle("mod-top-right-space", group === corner);
  }

  function renderActive() {
    for (const [group, v] of views) v.el.classList.toggle("mod-active", group === ws.activeGroup);
    root.classList.toggle("mod-has-splits", views.size > 1);
  }

  ws.on((change, group) => {
    if (change === "layout") renderLayout();
    if (change === "pane" && group) views.get(group)?.fade();
    if (change === "mode") for (const v of views.values()) v.renderMode();
    if (change === "tabs" || change === "pane") for (const v of views.values()) v.renderBacklinks();
    if (change === "tabs" || change === "files" || change === "layout") {
      for (const v of views.values()) v.render();
      renderActive();
    }
  });
  renderLayout();
  for (const v of views.values()) v.render();
  renderActive();

  // The empty state's hotkey hints follow Settings → Hotkeys.
  commands.onChange(() => {
    for (const v of views.values()) v.render();
  });

  return {
    el: root,
    setBacklinksAllowed(allowed) {
      backlinksAllowed = allowed;
      for (const v of views.values()) v.renderBacklinks();
    },
    focusTitle: (selectAll) => viewFor(ws.activeGroup).focusTitle(selectAll),
    // Every pane's width scales with the workspace's (sizes are fractions),
    // so each holds its own column for its share of the change.
    holdColumn(delta, dock) {
      const rects = ws.layout.rects();
      for (const [group, r] of rects) viewFor(group).holdColumn(delta * r.w, dock);
    },
  };

  // ----- one tab group -----

  function createGroupView(ws: Workspace, group: Group, menus: () => Menus): GroupView {
    const tabList = h("div", { class: "workspace-tab-header-container-inner" });
    const tabListButton = iconButton(icon("chevron-down"), "Show tab list", () =>
      showMenu(menus().tabList(group), tabListButton, { align: "right" }),
    );
    const strip = h(
      "div",
      { class: "workspace-tab-header-container" },
      tabList,
      iconButton(icon("plus"), "New tab", () => ws.newTab(group), "workspace-tab-header-new-tab"),
      h("div", { class: "workspace-tab-header-spacer" }),
      h("div", { class: "workspace-tab-header-tab-list" }, tabListButton),
      iconButton(icon("panel-right"), "Toggle right sidebar", () => commands.run("app:toggle-right-sidebar"), "sidebar-toggle-button mod-right"),
    );

    // Tab headers are kept per tab id and updated in place, so a switch only
    // flips classes, and opening/closing a tab can animate its own header.
    const tabHeaders = new Map<number, { el: HTMLElement; title: HTMLElement; close: HTMLElement; tab: Tab }>();
    const headers = new Map<number, HTMLElement>();
    let tabsRendered = false;

    function tabHeader(tab: Tab) {
      const title = h("div", { class: "workspace-tab-header-inner-title" });
      // Close button; on a pinned tab, a pin that unpins it (as in Obsidian).
      const close = h("div", {
        class: "workspace-tab-header-inner-close-button",
        onpointerdown: (e: PointerEvent) => e.stopPropagation(),
        onmousedown: (e: MouseEvent) => e.stopPropagation(),
        onclick: () => (tab.pinned ? ws.togglePin(tab) : ws.closeTab(tab)),
      });
      const el = h(
        "div",
        {
          class: "workspace-tab-header",
          onpointerdown: (e: PointerEvent) => {
            if (e.button === 1) {
              e.preventDefault();
              ws.closeTab(tab);
            } else if (e.button === 0) {
              ws.activate(tab);
              startTabDrag(e, tab, ws, () => [...views.values()]);
            }
          },
          // Middle-click must not paste or autoscroll.
          onmousedown: (e: MouseEvent) => {
            if (e.button === 1) e.preventDefault();
          },
          oncontextmenu: (e: MouseEvent) => {
            e.preventDefault();
            showMenu(menus().tab(tab), { x: e.clientX, y: e.clientY });
          },
        },
        h("div", { class: "workspace-tab-header-inner" }, title, close),
      );
      return { el, title, close, tab };
    }

    function renderTabs() {
      const open = new Set(group.tabs.map((tab) => tab.id));
      for (const [id, { el }] of tabHeaders) {
        if (open.has(id)) continue;
        tabHeaders.delete(id);
        headers.delete(id);
        closeTabHeader(el);
      }
      let prev: Element | null = null;
      const added: HTMLElement[] = [];
      for (const tab of group.tabs) {
        let header = tabHeaders.get(tab.id);
        if (!header) {
          tabHeaders.set(tab.id, (header = tabHeader(tab)));
          headers.set(tab.id, header.el);
          if (tabsRendered) added.push(header.el);
        }
        const { el, title, close } = header;
        const name = tab.path ? noteName(tab.path) : "New tab";
        if (title.textContent !== name) title.textContent = name;
        el.setAttribute("aria-label", tab.path ?? "New tab");
        el.classList.toggle("is-active", tab === group.active);
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
    // last third of the width to vanish in a single frame. A tab that moved
    // to another group just goes.
    function closeTabHeader(el: HTMLElement) {
      el.classList.add("is-closing");
      const ms = duration("moderate");
      if (ms <= 0 || !el.isConnected || el.classList.contains("is-moving")) return el.remove();
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
    // editing, the pen while reading. Ctrl/Cmd+click opens that view of the
    // note to the right instead.
    const modeButton = iconButton(icon("book-open"), "", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return void commands.run("markdown:toggle-preview");
      const tab = group.active;
      if (!tab.path) return;
      ws.split(tab, "right");
      ws.setMode(tab.mode === "reading" ? "live" : "reading");
    });
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
      const reading = group.active.mode === "reading";
      const mode = reading ? "reading" : "editing";
      if (mode === shownMode) return;
      shownMode = mode;
      modeButton.replaceChildren(icon(reading ? "pen-line" : "book-open"));
      const label = reading
        ? "Current view: reading\nClick to edit\nCtrl+Click to open to the right"
        : "Current view: editing\nClick to read\nCtrl+Click to open to the right";
      modeButton.setAttribute("aria-label", label);
      modeButton.title = label;
    }

    let shownCrumb = "";
    function renderHeader() {
      const tab = group.active;
      const path = tab.path;
      back.classList.toggle("is-disabled", tab.back.length === 0);
      forward.classList.toggle("is-disabled", tab.forward.length === 0);
      actions.hidden = !path;
      renderMode();
      if ((path ?? "") === shownCrumb) return;
      shownCrumb = path ?? "";
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
    const sizer = h("div", { class: "markdown-sizer" }, title, ws.viewOf(group).dom);
    const scroller = h("div", { class: "view-content" }, sizer);

    const emptyActions: [HTMLElement, string, string][] = [];
    const emptyAction = (label: string, id: string) => {
      const el = h("div", { class: "empty-state-action", onclick: () => commands.run(id) });
      emptyActions.push([el, label, id]);
      return el;
    };
    // Labels carry the current hotkey; a command whose core plugin is off is left out.
    function renderEmpty() {
      for (const [el, label, id] of emptyActions) {
        const hotkey = commands.hotkey(id);
        const text = `${label}${hotkey ? ` (${hotkey})` : ""}`;
        if (el.textContent !== text) el.textContent = text;
        el.hidden = !commands.isEnabled(id);
      }
    }
    const empty = h(
      "div",
      { class: "empty-state" },
      h("div", { class: "empty-state-title" }, "No file is open"),
      emptyAction("Create new note", "file-explorer:new-file"),
      emptyAction("Go to file", "switcher:open"),
      h("div", { class: "empty-state-action", onclick: () => ws.closeTab(group.active) }, "Close"),
    );

    function renderView() {
      const path = group.active.path;
      scroller.hidden = !path;
      empty.hidden = !!path;
      if (path && document.activeElement !== title) title.textContent = noteName(path);
      // The editor may have moved here from another group (a tab dragged out).
      const dom = ws.viewOf(group).dom;
      if (dom.parentElement !== sizer) sizer.insertBefore(dom, backlinksBox);
    }

    function render() {
      renderTabs();
      renderHeader();
      renderView();
      if (empty.hidden === false) renderEmpty();
    }

    // Backlinks under the note (Obsidian's "Backlinks in document"): built
    // the first time a tab here asks for them; only works while shown.
    let backlinks: SideView | null = null;
    let backlinksBox: HTMLElement | null = null;
    function renderBacklinks() {
      const tab = group.active;
      const want = backlinksAllowed && !!tab.path && tab.backlinks;
      if (want && !backlinks) {
        backlinks = createBacklinksView(ws, () => group.active.path);
        backlinksBox = h("div", { class: "embedded-backlinks" }, backlinks.el);
        sizer.append(backlinksBox);
      }
      if (!backlinks || !backlinksBox) return;
      backlinksBox.hidden = !want;
      backlinks.setActive(want);
    }

    // A note switch eases the new text in from slightly transparent. The text
    // is painted on the first frame either way; swapping between two identical
    // animations restarts it without forcing a style flush.
    let fadeFlip: boolean | null = null;
    function fade() {
      if (!group.active.path) return;
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
      // With the inline title turned off, it shows just for the rename.
      title.classList.add("is-renaming");
      title.focus();
      const range = document.createRange();
      range.selectNodeContents(title);
      if (!selectAll) range.collapse(false);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }

    async function commitTitle() {
      const path = group.active.path;
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
      const view = ws.viewOf(group);
      if (e.key === "Enter" || e.key === "ArrowDown") {
        e.preventDefault();
        view.focus();
        view.dispatch({ selection: { anchor: 0 } });
      } else if (e.key === "Escape") {
        title.textContent = group.active.path ? noteName(group.active.path) : "";
        view.focus();
      }
    });
    title.addEventListener("blur", () => {
      title.classList.remove("is-renaming");
      void commitTitle();
    });
    // Clicking the empty space below the text puts the caret at the end, like Obsidian.
    scroller.addEventListener("mousedown", (e) => {
      if (e.target === scroller || e.target === sizer) {
        e.preventDefault();
        const view = ws.viewOf(group);
        view.focus();
        view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
      }
    });

    const leaf = h("div", { class: "workspace-leaf" }, header, scroller, empty);
    const el = h("div", { class: "workspace-tabs" }, strip, leaf);
    // A press or focus anywhere in a pane makes it the active one.
    const activate = () => ws.focusGroup(group);
    el.addEventListener("pointerdown", activate, true);
    el.addEventListener("focusin", activate);

    return {
      group,
      el,
      strip,
      scroller,
      tabList,
      headers,
      render,
      renderMode,
      renderBacklinks,
      fade,
      holdColumn,
      focusTitle,
      dispose() {
        hold?.cancel();
        backlinks?.setActive(false);
        el.remove();
      },
    };
  }
}

export type { GroupView };
