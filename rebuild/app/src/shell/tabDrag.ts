// Dragging a tab, as in Obsidian (observed in 1.14.4): along a tab bar to put
// it at that spot (a marker between the tabs), onto a pane's middle to move
// it into that group (the marker after its last tab), or into the outer
// third of a pane's left, right or bottom side to split the pane there (that
// third of the group is lit; there is no top zone). A translucent accent box
// marks where the tab will land and glides between places; a dark ghost with
// the tab's icon and title follows the pointer.
//
// Everything is measured once when the drag starts; each frame only does
// arithmetic and writes the ghost's and the box's place.

import type { Edge } from "../layout";
import { animateOut } from "../motion";
import { type Group, type Tab, tabTitle } from "../tabs";
import type { Workspace } from "../workspace";
import { h } from "./dom";
import { icon } from "./icons";
import type { GroupView } from "./pane";

const THRESHOLD = 5;
/** How far into a pane (as a fraction of its size) its edges take a drop. */
const EDGE_ZONE = 1 / 3;
/** The marker for a drop between tabs: this wide, from this far below the tab bar's top. */
const MARKER = 10;
const MARKER_TOP = 6;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Measured {
  group: Group;
  pane: DOMRect;
  strip: DOMRect;
  /** The tab headers in order: tab and its left/right edges. */
  tabs: { tab: Tab; left: number; right: number }[];
}

export type DropTarget =
  | { kind: "tab"; group: Group; index: number; box: Box }
  | { kind: "pane"; group: Group; edge: Edge; box: Box };

/**
 * Which drop a point means, or null for none (a drop that would change
 * nothing shows nothing). Pure, given the measured panes.
 */
export function dropTarget(x: number, y: number, tab: Tab, from: Group, panes: Measured[]): DropTarget | null {
  for (const m of panes) {
    const { strip, pane } = m;
    if (x < pane.left || x > pane.right || y < pane.top || y > pane.bottom) continue;
    const top = strip.bottom;
    const rx = (x - pane.left) / pane.width;
    const ry = (y - top) / (pane.bottom - top);
    const edges: [Edge, number][] = [
      ["left", rx],
      ["right", 1 - rx],
      ["bottom", 1 - ry],
    ];
    const [edge, d] = edges.reduce((a, b) => (b[1] < a[1] ? b : a));
    if (y > strip.bottom && d < EDGE_ZONE) {
      if (m.group === from && from.tabs.length === 1) return null;
      const third: Box =
        edge === "left" ? { x: pane.left, y: pane.top, w: pane.width / 3, h: pane.height }
        : edge === "right" ? { x: pane.right - pane.width / 3, y: pane.top, w: pane.width / 3, h: pane.height }
        : { x: pane.left, y: pane.bottom - pane.height / 3, w: pane.width, h: pane.height / 3 };
      return { kind: "pane", group: m.group, edge, box: third };
    }
    // The tab bar: before the first tab whose middle is right of the pointer.
    // The rest of the pane: after its last tab.
    const open = m.tabs;
    let index = y <= strip.bottom ? open.findIndex((t) => x < (t.left + t.right) / 2) : -1;
    if (index < 0) index = open.length;
    if (m.group === from) {
      const i = open.findIndex((t) => t.tab === tab);
      if (index === i || index === i + 1) return null;
    }
    const at = index < open.length ? open[index].left : (open[open.length - 1]?.right ?? strip.left + 8);
    return { kind: "tab", group: m.group, index, box: { x: at - MARKER / 2, y: strip.top + MARKER_TOP, w: MARKER, h: strip.height - MARKER_TOP } };
  }
  return null;
}

export function startTabDrag(down: PointerEvent, tab: Tab, ws: Workspace, views: () => GroupView[]) {
  const header = down.currentTarget as HTMLElement;
  const x0 = down.clientX;
  const y0 = down.clientY;
  let dragging = false;
  let measured: Measured[] = [];
  let from: Group | undefined;
  let ghost: HTMLElement | null = null;
  let overlay: HTMLElement | null = null;
  let target: DropTarget | null = null;
  let x = x0;
  let y = y0;
  let frame = 0;

  function begin() {
    dragging = true;
    from = ws.groupOf(tab);
    measured = views().map((v) => ({
      group: v.group,
      pane: v.el.getBoundingClientRect(),
      strip: v.strip.getBoundingClientRect(),
      tabs: v.group.tabs.flatMap((t) => {
        const el = v.headers.get(t.id);
        if (!el) return [];
        const r = el.getBoundingClientRect();
        return [{ tab: t, left: r.left, right: r.right }];
      }),
    }));
    overlay = h("div", { class: "workspace-drop-overlay" });
    ghost = h(
      "div",
      { class: "drag-ghost" },
      icon(tab.type ? "git-fork" : "file", 16),
      h("span", { class: "drag-ghost-title" }, tabTitle(tab)),
    );
    document.body.append(overlay, ghost);
    header.classList.add("is-being-dragged");
    document.body.classList.add("is-grabbing");
  }

  function update() {
    frame = 0;
    if (!ghost || !overlay || !from) return;
    ghost.style.transform = `translate(${x}px, ${y}px)`;
    const next = dropTarget(x, y, tab, from, measured);
    if (!next) {
      overlay.classList.remove("is-visible");
    } else {
      const { box } = next;
      // The first placement jumps there; later moves glide.
      if (!overlay.classList.contains("is-visible") && !target) overlay.classList.add("is-placing");
      // A real size, not a scale, so the corners keep their radius (one
      // fixed element: its size costs nothing to lay out).
      overlay.style.transform = `translate(${box.x}px, ${box.y}px)`;
      overlay.style.width = `${box.w}px`;
      overlay.style.height = `${box.h}px`;
      overlay.classList.add("is-visible");
      if (overlay.classList.contains("is-placing")) {
        void overlay.offsetWidth;
        overlay.classList.remove("is-placing");
      }
    }
    target = next;
  }

  function move(e: PointerEvent) {
    x = e.clientX;
    y = e.clientY;
    if (!dragging) {
      if (Math.hypot(x - x0, y - y0) < THRESHOLD) return;
      begin();
    }
    frame ||= requestAnimationFrame(update);
  }

  function finish(drop: boolean) {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    cancelAnimationFrame(frame);
    if (!dragging) return;
    if (drop) {
      update();
      const t = target;
      if (t?.kind === "tab") {
        header.classList.add("is-moving");
        ws.moveTab(tab, t.group, t.index);
      } else if (t?.kind === "pane") {
        header.classList.add("is-moving");
        ws.moveTabToEdge(tab, t.group, t.edge);
      }
    }
    header.classList.remove("is-being-dragged", "is-moving");
    document.body.classList.remove("is-grabbing");
    if (overlay) void animateOut(overlay);
    if (ghost) void animateOut(ghost);
  }

  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
}
