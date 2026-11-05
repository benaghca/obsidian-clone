import type { CanvasNode } from "./model";

/** A camera in board coordinates. The view size is not part of the camera. */
export interface Camera {
  cx: number;
  cy: number;
  scale: number;
}

const MIN_SCALE = 1 / 16;
const MAX_SCALE = 4;
const PAD = 1.1;
// Unscaled label box in canvas.css: 22.5px font, 8px of vertical padding, 4px gap.
// Zoomed out, the label scales so the font stays about 14px on screen.
const GROUP_LIFT = 36;
const FILE_LIFT = 22;
const LABEL_BOX = 22.5 + 8;
const LABEL_GAP = 4;
const LABEL_SCREEN = 14;

function frameFor(node: CanvasNode, width: number, height: number, lift: number): Camera {
  const top = node.y - lift;
  const boxW = node.width * PAD;
  const boxH = (node.height + lift) * PAD;
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, width / boxW, height / boxH));
  return { cx: node.x + node.width / 2, cy: top + (node.height + lift) / 2, scale };
}

function groupLift(scale: number): number {
  const board = LABEL_BOX * Math.max(1, (LABEL_SCREEN / 22.5) / scale) + LABEL_GAP;
  return Math.max(GROUP_LIFT, board);
}

/**
 * Fit one slide into the view. Groups with a label leave room above the box,
 * including when the label scales up to stay readable. Scale may pass the
 * normal zoom cap (2) so a small card can fill the view, and it stops at 4.
 */
export function slideFrame(node: CanvasNode, width: number, height: number): Camera | null {
  if (!(width > 0) || !(height > 0) || !(node.width > 0) || !(node.height > 0)) return null;
  const labeled = node.type === "group" && !!node.label;
  let lift = labeled ? GROUP_LIFT : node.type === "file" || node.type === "link" ? FILE_LIFT : 0;
  let camera = frameFor(node, width, height, lift);
  if (!labeled) return camera;
  // A taller lift can shrink the scale, which grows the label again.
  for (let pass = 0; pass < 2; pass++) {
    const next = groupLift(camera.scale);
    if (next <= lift + 0.5) break;
    lift = next;
    camera = frameFor(node, width, height, lift);
  }
  return camera;
}

/** The slide plus every node fully inside it, when the slide is a group. */
export function slideMembers(slide: CanvasNode, nodes: readonly CanvasNode[]): CanvasNode[] {
  if (slide.type !== "group") return [slide];
  const right = slide.x + slide.width, bottom = slide.y + slide.height;
  return nodes.filter(n => n.x >= slide.x && n.y >= slide.y && n.x + n.width <= right && n.y + n.height <= bottom);
}

export type PresentAction = "next" | "prev" | "first" | "last" | "exit" | "ignore";

/** Keys the presentation owns. Modifier chords stay with the rest of the app. */
export function presentAction(e: { key: string; ctrl?: boolean; meta?: boolean; alt?: boolean }): PresentAction {
  if (e.ctrl || e.meta || e.alt) return "ignore";
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
    case "Space":
    case "Enter":
    case "n":
      return "next";
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
    case "p":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Escape":
      return "exit";
    default:
      return "ignore";
  }
}

export function stepIndex(index: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, index + delta));
}

export function easeInOutCubic(p: number): number {
  const t = Math.max(0, Math.min(1, p));
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

/** Geometric zoom, linear center, cubic ease. p of 0 and 1 are the endpoints. */
export function glideCamera(from: Camera, to: Camera, p: number): Camera {
  const e = easeInOutCubic(p);
  const ratio = from.scale > 0 ? to.scale / from.scale : 1;
  return {
    cx: from.cx + (to.cx - from.cx) * e,
    cy: from.cy + (to.cy - from.cy) * e,
    scale: from.scale * ratio ** e,
  };
}

export const PRESENT_GLIDE_MS = 520;
