// Pointer input on the graph's canvas, as in Obsidian: drag empty space to
// pan, drag a node to move it, click a node to open it (a middle click or
// Ctrl/Cmd opens a new tab), the wheel or a pinch to zoom around the pointer,
// right-click a node for its menu; hovering a node lights it. Positions are
// in canvas CSS pixels. What each gesture does is up to the view (view.ts).

import { type OpenWhere, whereFromEvent } from "../tabs";

const CLICK_SLOP = 4;

export interface GraphGestures {
  /** The node under a point, or -1. */
  nodeAt(x: number, y: number): number;
  hover(node: number): void;
  /** A node is dragged to a point (`first`: it just started moving). */
  dragNode(node: number, x: number, y: number, first: boolean): void;
  /** A node that was dragged is let go. */
  dropNode(node: number): void;
  click(node: number, where: OpenWhere): void;
  /** Empty space is pressed (a pan starts), then dragged by a distance. */
  panStart(): void;
  panBy(dx: number, dy: number): void;
  /** The pan ended: the last frame is drawn at full resolution. */
  panEnd(): void;
  wheel(x: number, y: number, e: WheelEvent): void;
  menu(node: number, at: { x: number; y: number }): void;
}

export interface GraphInput {
  /** The node being dragged (`moved` once past the click slop), or null. */
  readonly drag: { node: number; moved: boolean } | null;
  readonly panning: boolean;
  /** Where the pointer is over the canvas, or null when it is outside. */
  readonly pointer: { x: number; y: number } | null;
}

export function graphInput(canvas: HTMLCanvasElement, g: GraphGestures): GraphInput {
  let drag: { node: number; pointerId: number; startX: number; startY: number; moved: boolean; button: number } | null = null;
  let pan: { pointerId: number; x: number; y: number } | null = null;
  let pointer: { x: number; y: number } | null = null;

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 1) e.preventDefault(); // no autoscroll
    if (e.button !== 0 && e.button !== 1) return;
    const p = local(e);
    const node = g.nodeAt(p.x, p.y);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic event: moves still arrive while over the canvas
    }
    if (node >= 0) {
      drag = { node, pointerId: e.pointerId, startX: p.x, startY: p.y, moved: false, button: e.button };
      g.hover(node);
    } else if (e.button === 0) {
      pan = { pointerId: e.pointerId, x: p.x, y: p.y };
      g.panStart();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = local(e);
    pointer = p;
    if (drag && e.pointerId === drag.pointerId) {
      if (!drag.moved && Math.hypot(p.x - drag.startX, p.y - drag.startY) < CLICK_SLOP) return;
      g.dragNode(drag.node, p.x, p.y, !drag.moved);
      drag.moved = true;
      return;
    }
    if (pan && e.pointerId === pan.pointerId) {
      g.panBy(p.x - pan.x, p.y - pan.y);
      pan.x = p.x;
      pan.y = p.y;
      return;
    }
    // Hover: one cheap pass over the nodes; a frame is drawn only if it changed.
    g.hover(g.nodeAt(p.x, p.y));
  });

  const endPointer = (e: PointerEvent, cancelled: boolean) => {
    if (drag && e.pointerId === drag.pointerId) {
      const d = drag;
      drag = null;
      if (d.moved) g.dropNode(d.node);
      else if (!cancelled) g.click(d.node, d.button === 1 ? "tab" : whereFromEvent(e)); // middle or Ctrl/Cmd: a new tab
    }
    if (pan && e.pointerId === pan.pointerId) {
      pan = null;
      g.panEnd();
    }
  };
  canvas.addEventListener("pointerup", (e) => endPointer(e, false));
  canvas.addEventListener("pointercancel", (e) => endPointer(e, true));
  canvas.addEventListener("pointerleave", () => {
    pointer = null;
    if (!drag) g.hover(-1);
  });
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault();
  });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const p = local(e);
    g.menu(g.nodeAt(p.x, p.y), { x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = local(e);
      g.wheel(p.x, p.y, e);
    },
    { passive: false },
  );

  return {
    get drag() {
      return drag;
    },
    get panning() {
      return pan !== null;
    },
    get pointer() {
      return pointer;
    },
  };
}
