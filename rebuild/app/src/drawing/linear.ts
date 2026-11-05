// Point maths for lines, arrows and freedraw: their points in the scene with
// the turn baked in, the patch that writes such points back, angle snapping,
// point handles and midpoints, and the point halfway along a path (where an
// arrow's label sits). Pure: no DOM, no scene edits.

import { centreOf, elementFrame, placedPoints, rebase, rotatePoint } from "./geometry";
import type { DrawingElement, Json, LinearElement, Point } from "./scene";

export type Patch = Record<string, Json>;

const SNAP = Math.PI / 12;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Lines and arrows: the types with editable points. Freedraw is a stroke, not a path to edit. */
export const isLinear = (el: DrawingElement): el is DrawingElement & LinearElement => el.type === "line" || el.type === "arrow";

/** The element's points where they show in the scene, its turn applied. */
export function worldPoints(el: DrawingElement): Point[] {
  const pts = placedPoints(el as LinearElement);
  if (!el.angle) return pts;
  const c = centreOf(elementFrame(el));
  return pts.map((p) => rotatePoint(p, c, el.angle));
}

/** What to write so the element's points are `pts` (scene points, no turn): first point at the origin, size from the points. */
export function pointsPatch(pts: Point[]): Patch {
  const { x, y, points } = rebase(pts);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of points) {
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  return { x: r4(x), y: r4(y), width: r4(maxX - minX), height: r4(maxY - minY), angle: 0, points: points as Json };
}

/** `p` moved onto the nearest 15° ray from `from`, keeping its distance. */
export function snapAngle(from: Point, p: Point): Point {
  const dx = p[0] - from[0], dy = p[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [p[0], p[1]];
  const a = Math.round(Math.atan2(dy, dx) / SNAP) * SNAP;
  return [from[0] + Math.cos(a) * len, from[1] + Math.sin(a) * len];
}

/** The point halfway between each pair of neighbours: where a drag adds a point. */
export function midpoints(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < pts.length - 1; i++) out.push([(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]);
  return out;
}

/** The index of the point within `reach` of `p`, or -1. The last one wins, so an end on top of the start is the end. */
export function pointAt(pts: Point[], p: Point, reach: number): number {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]);
    if (d <= reach && d <= bestD) { best = i; bestD = d; }
  }
  return best;
}

/** The point halfway along the path, by length. */
export function pathMidpoint(pts: Point[]): Point {
  if (pts.length === 0) return [0, 0];
  if (pts.length === 1) return [pts[0][0], pts[0][1]];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  let left = total / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= len || i === pts.length - 2) {
      const t = len > 1e-9 ? Math.min(1, left / len) : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    left -= len;
  }
  return [pts[0][0], pts[0][1]];
}

/** A freedraw stroke so far: its origin is the first point, its size the points' box. */
export function strokePatch(origin: Point, pts: Point[], pressures: number[] | null): Patch {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const local: Point[] = pts.map(([x, y]) => {
    const p: Point = [r4(x - origin[0]), r4(y - origin[1])];
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    return p;
  });
  const patch: Patch = { x: r4(origin[0]), y: r4(origin[1]), width: r4(maxX - minX), height: r4(maxY - minY), points: local as Json };
  if (pressures) patch.pressures = pressures.map((v) => Math.round(v * 1000) / 1000);
  return patch;
}
