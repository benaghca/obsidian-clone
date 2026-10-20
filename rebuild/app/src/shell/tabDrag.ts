// Dragging a tab, as in Obsidian: along its own tab bar to reorder it, onto
// another group's tab bar to move it there at that spot, onto a pane's
// centre to move it into that group, or near a pane's edge to split the pane
// there. A translucent accent box shows where the tab will land; it glides
// between places by transform only.
//
// Everything is measured once when the drag starts; each frame only does
// arithmetic and writes two transforms.

import type { Edge } from "../layout";
import { animateOut } from "../motion";
import type { Group, Tab, Workspace } from "../workspace";
import { tabTitle } from "../workspace";
import { h } from "./dom";
import { icon } from "./icons";
import type { GroupView } from "./pane";

const THRESHOLD = 5;
/** How far into a pane (as a fraction of its size) its edges take a drop. */
const EDGE_ZONE = 0.25;
const INSET = 3;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Measured {
  group: Group;
  pane: DOMRect;
  strip: DOMRect;
  /** The tab headers in order: tab and its left/right edges. */
  tabs: { tab: Tab; left: number; right: number }[];
}

export type DropTarget =
  | { kind: "tab"; group: Group; index: number; box: Box }
  | { kind: "pane"; group: Group; edge: Edge | null; box: Box };

/**
 * Which drop a point means, or null for none (a drop that would change
 * nothing shows nothing). Pure, given the measured panes.
 */
export function dropTarget(x: number, y: number, tab: Tab, from: Group, panes: Measured[]): DropTarget | null {
  for (const m of panes) {
    const { strip, pane } = m;
    if (x < pane.left || x > pane.right || y < pane.top || y > pane.bottom) continue;
    if (y <= strip.bottom) {
      // The tab bar: insert before the first tab whose middle is right of the pointer.
      const open = m.tabs;
      let index = open.findIndex((t) => x < (t.left + t.right) / 2);
      if (index < 0) index = open.length;
      const at = index < open.length ? open[index].left : (open[open.length - 1]?.right ?? strip.left + 8);
      if (m.group === from) {
        const i = open.findIndex((t) => t.tab === tab);
        if (index === i || index === i + 1) return null;
      }
      return { kind: "tab", group: m.group, index, box: { x: at - 2, y: strip.top + 6, w: 4, h: strip.height - 10 } };
    }
    if (m.group === from && from.tabs.length === 1) return null;
    const top = strip.bottom;
    const height = pane.bottom - top;
    const rx = (x - pane.left) / pane.width;
    const ry = (y - top) / height;
    const edges: [Edge, number][] = [
      ["left", rx],
      ["right", 1 - rx],
      ["top", ry],
      ["bottom", 1 - ry],
    ];
    const [edge, d] = edges.reduce((a, b) => (b[1] < a[1] ? b : a));
    const whole: Box = { x: pane.left + INSET, y: top + INSET, w: pane.width - 2 * INSET, h: height - 2 * INSET };
    if (d >= EDGE_ZONE) {
      if (m.group === from) return null;
      return { kind: "pane", group: m.group, edge: null, box: whole };
    }
    const half: Box =
      edge === "left" ? { ...whole, w: whole.w / 2 }
      : edge === "right" ? { ...whole, x: whole.x + whole.w / 2, w: whole.w / 2 }
      : edge === "top" ? { ...whole, h: whole.h / 2 }
      : { ...whole, y: whole.y + whole.h / 2, h: whole.h / 2 };
    return { kind: "pane", group: m.group, edge, box: half };
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
  let base = { w: 1, h: 1 };
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
    // The overlay is one box the size of the whole workspace, placed and
    // sized with a transform, so moving between places is compositor work.
    const root = header.closest(".mod-root")?.getBoundingClientRect();
    base = { w: root?.width || innerWidth, h: root?.height || innerHeight };
    overlay = h("div", { class: "workspace-drop-overlay" });
    overlay.style.width = `${base.w}px`;
    overlay.style.height = `${base.h}px`;
    ghost = h(
      "div",
      { class: "drag-ghost" },
      icon(tab.path ? "file-text" : "file", 16),
      h("span", { class: "drag-ghost-title" }, tabTitle(tab)),
    );
    document.body.append(overlay, ghost);
    header.classList.add("is-being-dragged");
    document.body.classList.add("is-grabbing");
  }

  function update() {
    frame = 0;
    if (!ghost || !overlay || !from) return;
    ghost.style.transform = `translate(${x + 10}px, ${y + 10}px)`;
    const next = dropTarget(x, y, tab, from, measured);
    if (!next) {
      overlay.classList.remove("is-visible");
    } else {
      const { box } = next;
      // The first placement jumps there; later moves glide.
      if (!overlay.classList.contains("is-visible") && !target) overlay.classList.add("is-placing");
      overlay.style.transform = `translate(${box.x}px, ${box.y}px) scale(${box.w / base.w}, ${box.h / base.h})`;
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
        if (t.edge) ws.moveTabToEdge(tab, t.group, t.edge);
        else ws.moveTab(tab, t.group, t.group.tabs.length);
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
