// The main workspace: the split tree of tab groups (layout.ts), drawn like
// Obsidian's. Each group has its own tab strip (tabStrip.ts; the top ones
// double as the title bar), a sub-header with back/forward and breadcrumb,
// and the scrolling note view with its inline title above the editor in a
// centred readable column, or a graph. Splits get thin draggable dividers;
// tabs can be dragged between groups or onto a pane's edge (tabDrag.ts).
//
// DOM is kept per group and per split and only moved when the tree changes,
// so a split, a close or a tab move never rebuilds an editor.

import { canvasViewports } from "../canvas/navigation";
import { createCanvasView } from "../canvas/view";
import { createBaseView } from "../bases/view";
import { commands } from "../commands";
import type { Direction, LayoutNode, Split } from "../layout";
import { duration, easing } from "../motion";
import { createGraphView, type GraphView } from "../graph/view";
import { renameError, renameFile } from "../fileOps";
import { EditorView } from "@codemirror/view";
import { editAt, readingMode } from "../editor/render";
import { noteName, parentDir } from "../paths";
import { type Group, type Tab, tabTitle, type ViewType } from "../tabs";
import type { Workspace } from "../workspace";
import { dragPointer, fieldError, h, iconButton } from "./dom";
import { icon, type IconName } from "./icons";
import { showMenu } from "./menu";
import type { Menus } from "./menus";
import { createBacklinksView } from "./backlinksView";
import type { SideView } from "./sideView";
import { createTabStrip, type TabStrip } from "./tabStrip";

export type Panes = ReturnType<typeof createPanes>;

/**
 * No pane can be dragged smaller than this (px), across or down. 200px
 * across is Obsidian 1.14.4's (measured by dragging a divider as far as it
 * goes); below about that, words start breaking in the text column.
 */
const MIN_PANE_WIDTH = 200;
const MIN_PANE_HEIGHT = 120;
const minFor = (direction: Direction) => (direction === "vertical" ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT);

interface GroupView {
  group: Group;
  el: HTMLElement;
  strip: TabStrip;
  scroller: HTMLElement;
  render(): void;
  renderMode(): void;
  renderBacklinks(): void;
  fade(): void;
  holdColumn(delta: number, dock?: Animation): void;
  focusTitle(selectAll: boolean): void;
  dispose(): void;
}

/** What panes need from the rest of the app. */
interface PaneExtras {
  /** Search the vault for a tag (a tag node was clicked). */
  searchTag(tag: string): void;
}

/** `menus` is read when a menu opens (it is built after the panes). */
export function createPanes(ws: Workspace, menus: () => Menus, extras: PaneExtras) {
  const root = h("div", { class: "workspace-split mod-vertical mod-root" });
  const views = new Map<Group, GroupView>();
  let pressedTag: HTMLElement | null = null;
  let tagPress = { x: 0, y: 0 };
  root.addEventListener("mousedown", (event) => {
    pressedTag = null;
    const tag = (event.target as Element).closest<HTMLElement>(".cm-tag");
    const view = tag && EditorView.findFromDOM(tag);
    if (event.button !== 0 || !tag || !view) return;
    const from = view.posAtDOM(tag);
    const to = from + (tag.textContent?.length ?? 0);
    if (!view.state.facet(readingMode) && view.state.selection.ranges.some((r) => r.from <= to && r.to >= from)) return;
    pressedTag = tag;
    tagPress = { x: event.clientX, y: event.clientY };
  }, true);
  root.addEventListener("mousemove", (event) => {
    if (pressedTag && Math.hypot(event.clientX - tagPress.x, event.clientY - tagPress.y) > 3) pressedTag = null;
  });
  root.addEventListener("click", (event) => {
    const tag = (event.target as Element).closest<HTMLElement>(".cm-tag");
    const pressed = pressedTag;
    pressedTag = null;
    if (event.button !== 0 || !event.isTrusted || !tag || tag !== pressed) return;
    event.preventDefault();
    extras.searchTag(tag.textContent ?? "");
  });

  // ----- graph tabs -----

  // One graph view per graph tab, kept while the tab shows it (so switching
  // back to it is instant, zoom and layout as they were), and working only
  // while it is the active tab of its pane.
  const graphs = new Map<Tab, { view: GraphView; type: ViewType; file: string | null }>();
  /** The pane that last showed a note while active: a local graph tab opens notes there. */
  let notePane: Group | null = null;

  function graphFor(tab: Tab): GraphView {
    let g = graphs.get(tab);
    if (g && g.type !== tab.type) {
      g.view.dispose();
      graphs.delete(tab);
      g = undefined;
    }
    if (!g) {
      const local = tab.type === "localgraph";
      const view = createGraphView({
        ws,
        local,
        file: () => tab.viewFile ?? null,
        open: (path, where) => {
          const own = ws.groupOf(tab);
          const target = local && notePane && notePane !== own && ws.groups().includes(notePane) ? notePane : own;
          void ws.open(path, { where: local && target === own && !where ? "tab" : where, group: target });
        },
        openMissing: (name, where) => void ws.openLink(name, where || (local ? "tab" : false), ws.groupOf(tab)),
        searchTag: (tag) => extras.searchTag(tag),
        menu: (path, at) => showMenu(menus().graphNode(path), at),
      });
      g = { view, type: tab.type!, file: tab.viewFile ?? null };
      graphs.set(tab, g);
    }
    return g.view;
  }

  /** Drop the views of closed graph tabs, and wake only the ones on screen. */
  function syncGraphs() {
    const live = new Set(ws.layout.tabs());
    for (const [tab, g] of graphs) {
      if (live.has(tab) && tab.type === g.type) continue;
      g.view.dispose();
      graphs.delete(tab);
    }
    const shown = new Set(ws.groups().map((g) => g.active));
    for (const [tab, g] of graphs) {
      if (g.file !== (tab.viewFile ?? null)) {
        g.file = tab.viewFile ?? null;
        g.view.refresh();
      }
      g.view.setActive(shown.has(tab) && g.view.el.isConnected);
    }
  }
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
    const vertical = split.direction === "vertical";
    const rect = container.getBoundingClientRect();
    const total = vertical ? rect.width : rect.height;
    const start = [...split.sizes];
    const from = vertical ? down.clientX : down.clientY;
    const kids = split.children.map((c) => (c.kind === "group" ? viewFor(c).el : (splitEls.get(c.id) ?? container)));
    const handles = handleEls.get(container) ?? [];
    document.body.classList.add(vertical ? "is-resizing-x" : "is-resizing-y");
    handle.classList.add("is-dragging");
    const apply = (e: PointerEvent) => {
      split.sizes = [...start];
      const sizes = ws.layout.resize(split, index, (vertical ? e.clientX : e.clientY) - from, total, minFor(split.direction));
      kids[index].style.flexGrow = String(sizes[index]);
      kids[index + 1].style.flexGrow = String(sizes[index + 1]);
      placeHandles(split, handles.slice(0, split.children.length - 1));
    };
    dragPointer(down, handle, apply, () => {
      handle.classList.remove("is-dragging");
      document.body.classList.remove("is-resizing-x", "is-resizing-y");
      ws.resized();
    });
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
    for (const v of fresh) if (views.get(v.group) === v) ws.editors.setScroller(v.group, v.scroller);
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
      // The empty parts of a top strip move the window. Tauri only drags on a
      // press on an element that carries the attribute itself (not on its
      // children), so it goes on each empty part: the strip, the band above
      // and between the tabs (the tab row's own box), and the spacer.
      for (const el of [v.strip.el, v.strip.tabList, v.strip.el.querySelector(".workspace-tab-header-spacer")!]) el.toggleAttribute("data-tauri-drag-region", top);
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
    if (change === "tabs" || change === "layout" || change === "pane") syncGraphs();
    // Local graph tabs follow the note open in the active pane.
    if (change === "show" && ws.active.path) {
      notePane = ws.activeGroup;
      for (const tab of graphs.keys()) if (tab.type === "localgraph") ws.setGraphFile(tab, ws.active.path);
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
    /** Whether backlinks may show under notes (the Backlinks core plugin is on). */
    setBacklinksAllowed(allowed: boolean) {
      backlinksAllowed = allowed;
      for (const v of views.values()) v.renderBacklinks();
    },
    /** Focus the active pane's inline title, selecting it for a rename. */
    focusTitle: (selectAll: boolean) => viewFor(ws.activeGroup).focusTitle(selectAll),
    /**
     * The panes are about to change width by `delta` px, following `dock`'s
     * width transition: keep the note columns from re-wrapping on the way.
     * Every pane's width scales with the workspace's (sizes are fractions),
     * so each holds its own column for its share of the change.
     */
    holdColumn(delta: number, dock?: Animation) {
      const rects = ws.layout.rects();
      for (const [group, r] of rects) viewFor(group).holdColumn(delta * r.w, dock);
    },
  };

  // ----- one tab group -----

  function createGroupView(ws: Workspace, group: Group, menus: () => Menus): GroupView {
    const strip = createTabStrip(ws, group, menus, () => [...views.values()]);

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
      const label = `Current view: ${reading ? "reading\nClick to edit" : "editing\nClick to read"}\nCtrl+Click to open to the right`;
      modeButton.setAttribute("aria-label", label);
    }

    let shownCrumb = "";
    function renderHeader() {
      const tab = group.active;
      const path = tab.type === "canvas" || tab.type === "base" ? tab.viewFile : tab.path;
      back.classList.toggle("is-disabled", tab.back.length === 0);
      forward.classList.toggle("is-disabled", tab.forward.length === 0);
      actions.hidden = !path && !tab.type;
      modeButton.hidden = !!tab.type;
      renderMode();
      const crumb = tab.type && tab.type !== "canvas" && tab.type !== "base" ? `\0${tab.type}\0${tab.viewFile ?? ""}` : (path ?? "\0new-tab");
      if (crumb === shownCrumb) return;
      shownCrumb = crumb;
      breadcrumb.replaceChildren();
      if (tab.type && tab.type !== "canvas" && tab.type !== "base") {
        const title = tab.type === "image" || tab.type === "backlinks" ? tabTitle(tab) : tab.type === "graph" ? "Graph view" : "Local graph";
        breadcrumb.append(h("span", { class: "view-header-title" }, title));
        return;
      }
      if (!path) {
        breadcrumb.append(h("span", { class: "view-header-title" }, "New tab"));
        return;
      }
      const dir = parentDir(path);
      for (const part of dir ? dir.split("/") : []) {
        breadcrumb.append(
          h("span", { class: "view-header-breadcrumb" }, part),
          h("span", { class: "view-header-breadcrumb-separator" }, "/"),
        );
      }
      breadcrumb.append(h("span", { class: "view-header-title" }, tab.type === "canvas" || tab.type === "base" ? tabTitle(tab) : noteName(path)));
    }

    // ----- note view -----
    const title = h("div", { class: "inline-title", contenteditable: "plaintext-only", spellcheck: "false", "aria-label": "Note title" });
    let titlePath: string | null = null;
    const sizer = h("div", { class: "markdown-sizer" }, title, ws.editors.viewOf(group).dom);
    const scroller = h("div", { class: "view-content" }, sizer);

    const emptyActions: { el: HTMLElement; id: string; hotkey: HTMLElement }[] = [];
    const emptyAction = (label: string, id: string, iconName: IconName) => {
      const hotkey = h("span", { class: "empty-state-hotkey" });
      const el = h(
        "div",
        { class: "empty-state-action", onclick: () => commands.run(id) },
        icon(iconName, 16),
        h("span", { class: "empty-state-action-label" }, label),
        hotkey,
      );
      emptyActions.push({ el, id, hotkey });
      return el;
    };
    // The shortcut is its own muted span. A command whose core plugin is off is left out.
    function renderEmpty() {
      for (const { el, id, hotkey } of emptyActions) {
        const text = commands.hotkey(id) ?? "";
        if (hotkey.textContent !== text) hotkey.textContent = text;
        hotkey.hidden = !text;
        el.hidden = !commands.isEnabled(id);
      }
      fitEmptyLabels();
    }
    const empty = h(
      "div",
      { class: "empty-state" },
      h(
        "div",
        { class: "empty-state-actions" },
        emptyAction("New note", "file-explorer:new-file", "square-pen"),
        emptyAction("New canvas", "canvas:new-file", "layout-dashboard"),
        emptyAction("New base", "bases:new-file", "table"),
        emptyAction("Go to file", "switcher:open", "search"),
      ),
    );
    // A short label that is a fraction of a pixel over its slot is widened to
    // its text. Only a label that is more than a pixel over ellipsizes.
    function fitEmptyLabels() {
      if (empty.hidden) return;
      for (const label of empty.querySelectorAll<HTMLElement>(".empty-state-action-label")) {
        label.classList.remove("is-ellipsized");
        const over = label.scrollWidth - label.clientWidth;
        if (over > 1) {
          label.style.minWidth = "";
          label.classList.add("is-ellipsized");
        } else if (over > 0) label.style.minWidth = `${label.scrollWidth}px`;
      }
    }
    new ResizeObserver(() => fitEmptyLabels()).observe(empty);
    new MutationObserver(() => fitEmptyLabels()).observe(empty, { subtree: true, characterData: true, childList: true });

    // An image tab: the picture at its own size, centred, through the same blob: URLs as embeds.
    const picture = h("img", { alt: "" });
    const imageView = h("div", { class: "view-content image-container" }, picture);
    let shownImage: { path: string; held: ReturnType<typeof ws.embeds.image> } | null = null;
    function renderImage(path: string | null) {
      if (shownImage?.path === path) return;
      shownImage?.held.release();
      shownImage = null;
      picture.removeAttribute("src");
      if (!path) return;
      const held = ws.embeds.image(path);
      shownImage = { path, held };
      void held.url.then((url) => shownImage?.held === held && (picture.src = url), () => {});
    }

    let canvas: { el: HTMLElement; dispose(): void } | null = null;
    let canvasPath: string | null = null;
    let canvasTab: Tab | null = null;
    function renderView() {
      const tab = group.active;
      const path = tab.path;
      const image = tab.type === "image" ? (tab.viewFile ?? null) : null;
      const board = tab.type === "canvas" || tab.type === "base" ? tab.viewFile ?? null : null;
      if (tab.type !== "canvas") canvasViewports.delete(tab);
      if (board !== canvasPath || tab !== canvasTab) {
        canvas?.dispose();
        canvasPath = board;
        canvasTab = tab;
        canvas = board ? tab.type === "base" ? createBaseView(ws, board, group) : createCanvasView(ws, board, group, tab) : null;
        if (canvas) { leaf.append(canvas.el); canvas.el.focus({ preventScroll: true }); }
      }
      const graph = tab.type === "graph" || tab.type === "localgraph" ? graphFor(tab) : null;
      const links = tab.type === "backlinks" ? (tab.viewFile ?? null) : undefined;
      showBacklinksTab(links);
      scroller.hidden = !path || !!graph || links !== undefined;
      empty.hidden = !!path || !!graph || !!image || !!board || links !== undefined;
      imageView.hidden = !image;
      renderImage(image);
      for (const child of [...leaf.children]) if (child.classList.contains("graph-view") && child !== graph?.el) child.remove();
      if (graph && graph.el.parentElement !== leaf) leaf.append(graph.el);
      if (path !== titlePath) { titlePath = path; fieldError(title, ""); }
      if (path && document.activeElement !== title && !title.hasAttribute("aria-invalid")) title.textContent = noteName(path);
      // The editor may have moved here from another group (a tab dragged out).
      const dom = ws.editors.viewOf(group).dom;
      if (dom.parentElement !== sizer) sizer.insertBefore(dom, backlinksBox);
    }

    function render() {
      strip.render();
      renderHeader();
      renderView();
      if (empty.hidden === false) renderEmpty();
    }

    // A backlinks tab is pinned to the note it was opened for, unlike the sidebar.
    let linksTab: SideView | null = null;
    let linksBox: HTMLElement | null = null;
    let linksFile: string | null = null;
    let linksOn = false;
    function showBacklinksTab(file: string | null | undefined) {
      if (file === undefined) {
        linksOn = false;
        if (linksBox) linksBox.hidden = true;
        linksTab?.setActive(false);
        return;
      }
      if (!linksTab) {
        linksTab = createBacklinksView(ws, () => linksFile);
        linksBox = h("div", { class: "view-content backlinks-tab" }, linksTab.el);
        leaf.append(linksBox);
      }
      linksBox!.hidden = false;
      const changed = !linksOn || linksFile !== file;
      linksOn = true;
      linksFile = file;
      if (!changed) linksTab.setActive(true);
      else {
        linksTab.setActive(false);
        linksTab.setActive(true);
      }
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

    let renaming = false;
    async function commitTitle() {
      const path = group.active.path;
      if (!path || renaming) return false;
      renaming = true;
      try {
        await renameFile(ws, path, title.textContent ?? "");
        title.textContent = group.active.path ? noteName(group.active.path) : "";
        fieldError(title, "");
        return true;
      } catch (err) {
        if (group.active.path === path) fieldError(title, String(err instanceof Error ? err.message : err), cancelTitle);
        return false;
      } finally { renaming = false; }
    }

    function cancelTitle() {
      title.textContent = group.active.path ? noteName(group.active.path) : "";
      title.classList.remove("is-renaming");
      fieldError(title, "");
      ws.editors.viewOf(group).focus();
    }
    title.addEventListener("keydown", (e) => {
      const view = ws.editors.viewOf(group);
      if (e.key === "Enter" || e.key === "ArrowDown") {
        e.preventDefault();
        void commitTitle().then((ok) => {
          if (!ok) return;
          title.blur();
          view.focus();
          view.dispatch({ selection: { anchor: 0 } });
        });
      } else if (e.key === "Escape") {
        cancelTitle();
      }
    });
    title.addEventListener("blur", () => {
      void commitTitle().then((ok) => { if (ok) title.classList.remove("is-renaming"); });
    });
    title.addEventListener("input", () => {
      const path = group.active.path;
      fieldError(title, path ? renameError(ws, path, title.textContent ?? "") : "");
    });
    // Margins place the caret beside the line; only space below the text goes to the end.
    scroller.addEventListener("mousedown", (e) => {
      const view = ws.editors.viewOf(group);
      // (The editor's own box reaches into the left margin, for the fold chevron.)
      if (e.target === scroller || e.target === sizer || e.target === view.dom) {
        e.preventDefault();
        editAt(view, { x: e.clientX, y: e.clientY });
      }
    });

    const leaf = h("div", { class: "workspace-leaf" }, header, scroller, empty, imageView);
    const el = h("div", { class: "workspace-tabs" }, strip.el, leaf);
    // A press or focus anywhere in a pane makes it the active one.
    const activate = () => ws.focusGroup(group);
    el.addEventListener("pointerdown", activate, true);
    el.addEventListener("focusin", activate);

    return {
      group,
      el,
      strip,
      scroller,
      render,
      renderMode,
      renderBacklinks,
      fade,
      holdColumn,
      focusTitle,
      dispose() {
        fieldError(title, "");
        hold?.cancel();
        backlinks?.setActive(false);
        linksTab?.setActive(false);
        renderImage(null);
        canvas?.dispose();
        el.remove();
      },
    };
  }
}

export type { GroupView };
