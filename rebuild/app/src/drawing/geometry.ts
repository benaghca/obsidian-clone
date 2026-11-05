// Editor maths for drawings: an element's frame (its unrotated box and its
// turn about the box centre), hit-testing, the marquee, the selection's
// handles, and resizing and rotating a frame. Pure: no DOM, no scene edits.
// Coordinates are scene units; tolerances come in already divided by zoom.

import { arrowSize, curveControls } from "./render";
import type { DrawingElement, LinearElement, Point } from "./scene";

export interface Box { x: number; y: number; width: number; height: number }
export interface Frame extends Box { angle: number }
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

/** Screen pixels from the top edge to the rotate handle, and a handle's hit radius. */
export const ROTATE_GAP = 22;
export const HANDLE_HIT = 7;
const TAU = Math.PI * 2;
const SNAP = Math.PI / 12;

export const isPointType = (type: string) => type === "line" || type === "arrow" || type === "freedraw";
/** Types the editor moves, resizes and rotates. Unknown types and locked or deleted elements stay put. */
export const isEditable = (el: DrawingElement) => el.known && !el.isDeleted && !el.locked;

export function centreOf(b: Box): Point { return [b.x + b.width / 2, b.y + b.height / 2]; }

export function rotatePoint(p: Point, c: Point, angle: number): Point {
  if (!angle) return [p[0], p[1]];
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos];
}

export function normalizeAngle(angle: number): number {
  const a = angle % TAU;
  const out = a < 0 ? a + TAU : a;
  // Values a hair under a full turn read as none.
  return Math.abs(out - TAU) < 1e-9 || Math.abs(out) < 1e-9 ? 0 : out;
}

/** The element's points placed in the scene, before its turn. */
export function placedPoints(el: { x: number; y: number; points: Point[] }): Point[] {
  return el.points.map((p) => [el.x + p[0], el.y + p[1]]);
}

function pointsBox(pts: Point[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The box an element turns about. Shapes use their stored box (a negative
 * size counts from the other side); lines, arrows and freedraw use the box of
 * their points, which is also where the renderer turns them.
 */
export function elementFrame(el: DrawingElement): Frame {
  if (isPointType(el.type)) return { ...pointsBox(placedPoints(el as LinearElement)), angle: el.angle };
  const x = el.width < 0 ? el.x + el.width : el.x;
  const y = el.height < 0 ? el.y + el.height : el.y;
  return { x, y, width: Math.abs(el.width), height: Math.abs(el.height), angle: el.angle };
}

/** The frame's corners in the scene, clockwise from the top left. */
export function frameCorners(f: Frame): Point[] {
  const c = centreOf(f);
  return ([[f.x, f.y], [f.x + f.width, f.y], [f.x + f.width, f.y + f.height], [f.x, f.y + f.height]] as Point[])
    .map((p) => rotatePoint(p, c, f.angle));
}

export function frameAabb(f: Frame): Box {
  if (!f.angle) return { x: f.x, y: f.y, width: f.width, height: f.height };
  return pointsBox(frameCorners(f));
}

/** A scene point in the frame's own unrotated coordinates. */
export function toLocal(f: Frame, p: Point): Point { return rotatePoint(p, centreOf(f), -f.angle); }

/** The frame around everything selected: one element's own frame, or the upright box around several. */
export function selectionFrame(elements: DrawingElement[]): Frame | null {
  if (!elements.length) return null;
  if (elements.length === 1) return elementFrame(elements[0]);
  let box: Box | null = null;
  for (const el of elements) box = unionBox(box, frameAabb(elementFrame(el)));
  return { ...box!, angle: 0 };
}

export function unionBox(a: Box | null, b: Box): Box {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** A box from two corners, in any order. */
export function boxFrom(a: Point, b: Point): Box {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

function polylineDistance(p: Point, pts: Point[]): number {
  if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, segmentDistance(p, pts[i], pts[i + 1]));
  return best;
}

// The curve the renderer draws through a rounded line's points, as short segments.
function sampledCurve(pts: Point[]): Point[] {
  const out: Point[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [p1, c1, c2, p2] = curveControls(pts, i);
    for (let s = 1; s <= 8; s++) {
      const t = s / 8, mt = 1 - t;
      const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
      out.push([a * p1[0] + b * c1[0] + c * c2[0] + d * p2[0], a * p1[1] + b * c1[1] + c * c2[1] + d * p2[1]]);
    }
  }
  return out;
}

// An arrowhead is a triangle back from its tip, as wide as the renderer draws it.
function headHit(el: LinearElement, pts: Point[], q: Point, edge: number): boolean {
  const size = arrowSize(el.strokeWidth);
  const ends: [string | null, Point, Point][] = [[el.startArrowhead, pts[0], pts[1]], [el.endArrowhead, pts[pts.length - 1], pts[pts.length - 2]]];
  for (const [kind, tip, from] of ends) {
    if (!kind) continue;
    const len = Math.hypot(tip[0] - from[0], tip[1] - from[1]);
    if (len < 1e-9) continue;
    const ux = (tip[0] - from[0]) / len, uy = (tip[1] - from[1]) / len;
    const back: Point = [tip[0] - ux * size, tip[1] - uy * size];
    const a: Point = [back[0] - uy * size * 0.45, back[1] + ux * size * 0.45];
    const b: Point = [back[0] + uy * size * 0.45, back[1] - ux * size * 0.45];
    if (insideTriangle(q, tip, a, b) || polylineDistance(q, [tip, a, b, tip]) <= edge) return true;
  }
  return false;
}

function insideTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const side = (u: Point, v: Point) => (v[0] - u[0]) * (p[1] - u[1]) - (v[1] - u[1]) * (p[0] - u[0]);
  const d1 = side(a, b), d2 = side(b, c), d3 = side(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

const filled = (el: DrawingElement) => el.backgroundColor !== "transparent" && el.backgroundColor !== "none" && el.backgroundColor !== "";

/** Distance to a sampled outline. Step count follows the longer radius so a flat ellipse's side is still dense. */
function ellipseRimDistance(q: Point, cx: number, cy: number, rx: number, ry: number): number {
  const steps = Math.min(180, Math.max(24, Math.ceil((rx + ry) * 2)));
  let best = Infinity;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * TAU;
    const d = Math.hypot(q[0] - (cx + rx * Math.cos(t)), q[1] - (cy + ry * Math.sin(t)));
    if (d < best) best = d;
  }
  return best;
}

/**
 * Whether scene point `p` touches element `el`. A filled shape is hit
 * anywhere inside; an unfilled one, lines and frames only near their stroke.
 * Text and images are hit anywhere in their box. `tol` is in scene units.
 */
export function hitElement(el: DrawingElement, p: Point, tol: number): boolean {
  if (!isEditable(el)) return false;
  const f = elementFrame(el);
  const q = toLocal(f, p);
  const edge = tol + el.strokeWidth / 2;
  if (isPointType(el.type)) {
    const pts = placedPoints(el as LinearElement);
    const curved = pts.length >= 3 && (el.type === "freedraw" || (!!el.roundness && !(el as LinearElement).elbowed));
    if (polylineDistance(q, curved ? sampledCurve(pts) : pts) <= edge) return true;
    return el.type !== "freedraw" && pts.length >= 2 && headHit(el as LinearElement, pts, q, edge);
  }
  const l = f.x, t = f.y, r = f.x + f.width, b = f.y + f.height;
  const inside = q[0] >= l && q[0] <= r && q[1] >= t && q[1] <= b;
  switch (el.type) {
    case "ellipse": {
      const [cx, cy] = centreOf(f);
      const rx = f.width / 2, ry = f.height / 2;
      if (rx < 1e-6 || ry < 1e-6) return segmentDistance(q, [l, t], [r, b]) <= edge;
      const dx = q[0] - cx, dy = q[1] - cy;
      const e = Math.hypot(dx / rx, dy / ry);
      if (filled(el) && e <= 1) return true;
      if (q[0] < l - edge || q[0] > r + edge || q[1] < t - edge || q[1] > b + edge) return false;
      // Along-the-ray distance is an upper bound (exact on the axes). A flat ellipse is much
      // closer to a point beside its tip than that ray says, so the outline is sampled too.
      const radial = e === 0 ? Math.min(rx, ry) : Math.hypot(dx, dy) * Math.abs(1 - 1 / e);
      if (radial <= edge) return true;
      return ellipseRimDistance(q, cx, cy, rx, ry) <= edge;
    }
    case "diamond": {
      const [cx, cy] = centreOf(f);
      const verts: Point[] = [[cx, t], [r, cy], [cx, b], [l, cy]];
      if (filled(el) && f.width > 0 && f.height > 0 && Math.abs(q[0] - cx) / (f.width / 2) + Math.abs(q[1] - cy) / (f.height / 2) <= 1) return true;
      return polylineDistance(q, [...verts, verts[0]]) <= edge;
    }
    case "rectangle": {
      if (filled(el) && inside) return true;
      return polylineDistance(q, [[l, t], [r, t], [r, b], [l, b], [l, t]]) <= edge;
    }
    case "frame":
    case "magicframe":
      return polylineDistance(q, [[l, t], [r, t], [r, b], [l, b], [l, t]]) <= edge;
    default:
      return q[0] >= l - tol && q[0] <= r + tol && q[1] >= t - tol && q[1] <= b + tol;
  }
}

/**
 * The topmost element at `p`, or null. Text inside a shape (`containerId`)
 * answers for its shape, so a click on a label picks the box.
 */
export function hitTest(elements: readonly DrawingElement[], p: Point, tol: number): DrawingElement | null {
  let byId: Map<string, DrawingElement> | null = null;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!hitElement(el, p, tol)) continue;
    const container = el.type === "text" ? (el as DrawingElement & { containerId: string | null }).containerId : null;
    if (!container) return el;
    byId ??= new Map(elements.map((e) => [e.id, e]));
    const box = byId.get(container);
    return box && isEditable(box) ? box : el;
  }
  return null;
}

/** Elements the marquee holds completely. Text bound to a shape goes with the shape. */
export function marqueeHits(elements: readonly DrawingElement[], box: Box): DrawingElement[] {
  const right = box.x + box.width, bottom = box.y + box.height;
  return elements.filter((el) => {
    if (!isEditable(el) || (el.type === "text" && (el as DrawingElement & { containerId: string | null }).containerId)) return false;
    const a = frameAabb(elementFrame(el));
    return a.x >= box.x && a.y >= box.y && a.x + a.width <= right && a.y + a.height <= bottom;
  });
}

const SIDES: Record<Exclude<Handle, "rotate">, [number, number]> = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

/** Where each handle sits in the scene for a frame drawn at `scale` (screen px per scene unit). */
export function handlePoints(f: Frame, scale: number, resizable = true): Partial<Record<Handle, Point>> {
  const c = centreOf(f);
  const out: Partial<Record<Handle, Point>> = {};
  if (resizable) {
    for (const [name, [sx, sy]] of Object.entries(SIDES) as [Exclude<Handle, "rotate">, [number, number]][]) {
      // Side handles go when the box is too small on screen to grab them apart from the corners.
      if ((sx === 0 && f.width * scale < 30) || (sy === 0 && f.height * scale < 30)) continue;
      out[name] = rotatePoint([c[0] + sx * f.width / 2, c[1] + sy * f.height / 2], c, f.angle);
    }
  }
  out.rotate = rotatePoint([c[0], f.y - ROTATE_GAP / scale], c, f.angle);
  return out;
}

/** The handle under scene point `p`, if any. Rotate wins, then corners, then sides. */
export function handleAt(f: Frame, p: Point, scale: number, resizable = true): Handle | null {
  const points = handlePoints(f, scale, resizable);
  const reach = HANDLE_HIT / scale;
  for (const name of ["rotate", "nw", "ne", "se", "sw", "n", "e", "s", "w"] as Handle[]) {
    const at = points[name];
    if (at && Math.hypot(p[0] - at[0], p[1] - at[1]) <= reach) return name;
  }
  return null;
}

/** The resize cursor for a handle on a frame turned by `angle`. */
export function handleCursor(handle: Handle, angle: number): string {
  if (handle === "rotate") return "grab";
  const order: Handle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  const step = Math.round(normalizeAngle(angle) / (Math.PI / 4));
  const name = order[(order.indexOf(handle) + step) % 8];
  return name === "n" || name === "s" ? "ns-resize" : name === "e" || name === "w" ? "ew-resize" : name === "ne" || name === "sw" ? "nesw-resize" : "nwse-resize";
}

export interface ResizeOptions { keepAspect?: boolean; fromCentre?: boolean }
export interface Resized { frame: Frame; flipX: boolean; flipY: boolean }

/**
 * Drag `handle` of frame `f` to scene point `p`. The opposite side (or the
 * centre, with `fromCentre`) stays where it is on screen, also when the
 * frame is turned. Dragging past the anchor flips the box.
 */
export function resizeFrame(f: Frame, handle: Exclude<Handle, "rotate">, p: Point, opts: ResizeOptions = {}): Resized {
  const [hx, hy] = SIDES[handle];
  const c = centreOf(f);
  const q = toLocal(f, p);
  const centred = !!opts.fromCentre;
  const ax = hx === 0 || centred ? c[0] : hx > 0 ? f.x : f.x + f.width;
  const ay = hy === 0 || centred ? c[1] : hy > 0 ? f.y : f.y + f.height;
  const reachX = centred ? f.width / 2 : f.width;
  const reachY = centred ? f.height / 2 : f.height;
  // Signed distances from the anchor toward the handle, as multiples of the old ones.
  const along = (d: number, reach: number) => reach > 1e-9 ? d / reach : d >= 0 ? 1 : -1;
  let kx = hx ? along((q[0] - ax) * hx, reachX) : 1;
  let ky = hy ? along((q[1] - ay) * hy, reachY) : 1;
  // A side drag on a box with no width (or height) sets that size directly.
  const freeX = hx !== 0 && reachX <= 1e-9, freeY = hy !== 0 && reachY <= 1e-9;
  if (opts.keepAspect) {
    const sign = (v: number) => v < 0 ? -1 : 1;
    if (hx && hy) {
      const k = Math.max(Math.abs(kx), Math.abs(ky));
      kx = sign(kx) * k; ky = sign(ky) * k;
    } else if (hx) ky = Math.abs(kx);
    else kx = Math.abs(ky);
  }
  const span = (anchor: number, h: number, k: number, reach: number, free: boolean, d: number, start: number, size: number): [number, number] => {
    if (h === 0 || centred) {
      const half = free || (h !== 0 && !opts.keepAspect) ? d : (size / 2) * k;
      const mid = h === 0 ? start + size / 2 : anchor;
      return [mid - half, mid + half];
    }
    // Without proportions the far side is simply where the pointer is.
    const far = anchor + h * (free || !opts.keepAspect ? d : reach * k);
    return [anchor, far];
  };
  const [x1, x2] = span(ax, hx, kx, reachX, freeX, (q[0] - ax) * hx, f.x, f.width);
  const [y1, y2] = span(ay, hy, ky, reachY, freeY, (q[1] - ay) * hy, f.y, f.height);
  const flipX = kx < 0 || (freeX && (q[0] - ax) * hx < 0);
  const flipY = ky < 0 || (freeY && (q[1] - ay) * hy < 0);
  const local: Box = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  if (!f.angle) return { frame: { ...local, angle: 0 }, flipX, flipY };
  // The new box was worked out in the old frame's coordinates; turn its centre back into the scene.
  const mid = rotatePoint(centreOf(local), c, f.angle);
  return { frame: { x: mid[0] - local.width / 2, y: mid[1] - local.height / 2, width: local.width, height: local.height, angle: f.angle }, flipX, flipY };
}

/**
 * The angle after dragging the rotate handle from `start` to `p` about the
 * frame's centre. `snap` rounds to 15° steps.
 */
export function rotateFrame(f: Frame, start: Point, p: Point, snap = false): number {
  const [cx, cy] = centreOf(f);
  const turn = Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(start[1] - cy, start[0] - cx);
  let angle = normalizeAngle(f.angle + turn);
  if (snap) angle = normalizeAngle(Math.round(angle / SNAP) * SNAP);
  return angle;
}

/** A point of box `from` moved to the same place in box `to`, mirrored by the flips. */
export function mapPoint(p: Point, from: Box, to: Box, flipX = false, flipY = false): Point {
  let u = from.width > 1e-9 ? (p[0] - from.x) / from.width : 0.5;
  let v = from.height > 1e-9 ? (p[1] - from.y) / from.height : 0.5;
  if (flipX) u = 1 - u;
  if (flipY) v = 1 - v;
  return [to.x + u * to.width, to.y + v * to.height];
}

/** Points rebased so the first sits at [0, 0], with the origin they now hang from. */
export function rebase(pts: Point[]): { x: number; y: number; points: Point[] } {
  const [x, y] = pts[0] ?? [0, 0];
  return { x, y, points: pts.map((p) => [round(p[0] - x), round(p[1] - y)] as Point) };
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
