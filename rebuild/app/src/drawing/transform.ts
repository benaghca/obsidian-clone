// What a move, resize or rotate writes into each element: plain patches for
// `updateElement`. One element resizes inside its own turned frame; several
// resize inside the upright box around them. Text inside a shape follows the
// shape: it keeps its place in the shape's frame and takes the shape's turn.

import {
  centreOf, elementFrame, isPointType, mapPoint, normalizeAngle, placedPoints, rebase, rotatePoint,
  type Box, type Frame, type Resized,
} from "./geometry";
import type { DrawingElement, Json, LinearElement, Point } from "./scene";

export type Patch = Record<string, Json>;

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function movedPatch(el: DrawingElement, dx: number, dy: number): Patch {
  return { x: r4(el.x + dx), y: r4(el.y + dy) };
}

/** Whether a lone element of this type gets resize handles. Text keeps its size (its font sets it). */
export const resizable = (el: DrawingElement) => el.type !== "text";

/** One element resized from its frame `from` to `to`. */
export function resizedPatch(el: DrawingElement, from: Frame, to: Resized): Patch {
  const f = to.frame;
  if (isPointType(el.type)) {
    const pts = placedPoints(el as LinearElement).map((p) => mapPoint(p, from, f, to.flipX, to.flipY));
    const { x, y, points } = rebase(pts);
    return { x, y, width: r4(f.width), height: r4(f.height), points: points as Json };
  }
  return { x: r4(f.x), y: r4(f.y), width: r4(f.width), height: r4(f.height) };
}

/** A member of a group resized from the upright box `from` to `to`. */
export function groupResizedPatch(el: DrawingElement, from: Box, to: Resized): Patch {
  const g = to.frame;
  const sx = from.width > 1e-9 ? g.width / from.width : 1;
  const sy = from.height > 1e-9 ? g.height / from.height : 1;
  const mirrored = to.flipX !== to.flipY;
  if (isPointType(el.type)) {
    // Points are placed with their turn baked in, so the result is exact; the element ends upright.
    const f = elementFrame(el);
    const c = centreOf(f);
    const pts = placedPoints(el as LinearElement).map((p) => mapPoint(rotatePoint(p, c, f.angle), from, g, to.flipX, to.flipY));
    const { x, y, points } = rebase(pts);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x, y, width: r4(Math.max(...xs) - Math.min(...xs)), height: r4(Math.max(...ys) - Math.min(...ys)), angle: 0, points: points as Json };
  }
  const f = elementFrame(el);
  const keep = el.type === "text";
  const width = keep ? f.width : f.width * sx, height = keep ? f.height : f.height * sy;
  const [cx, cy] = mapPoint(centreOf(f), from, g, to.flipX, to.flipY);
  const patch: Patch = { x: r4(cx - width / 2), y: r4(cy - height / 2) };
  if (!keep) { patch.width = r4(width); patch.height = r4(height); }
  if (mirrored && f.angle) patch.angle = normalizeAngle(-f.angle);
  return patch;
}

/** A member of a group turned by `turn` about `pivot`. */
export function groupRotatedPatch(el: DrawingElement, pivot: Point, turn: number): Patch {
  const c = centreOf(elementFrame(el));
  const [nx, ny] = rotatePoint(c, pivot, turn);
  return { x: r4(el.x + nx - c[0]), y: r4(el.y + ny - c[1]), angle: normalizeAngle(el.angle + turn) };
}

/** Where a shape's label sits relative to the shape, worked out before the shape changes. */
export interface Follow { id: string; owner: string; offset: Point; width: number; height: number; frame: Frame }

export function followOf(text: DrawingElement, container: DrawingElement): Follow {
  const frame = elementFrame(container);
  const c = centreOf(frame);
  const t = centreOf(elementFrame(text));
  // The label's centre in the shape's own unrotated coordinates.
  const local = rotatePoint(t, c, -frame.angle);
  return { id: text.id, owner: container.id, offset: [local[0] - c[0], local[1] - c[1]], width: Math.abs(text.width), height: Math.abs(text.height), frame };
}

/**
 * The label's patch once its shape has the frame `now`.
 * `flipX` / `flipY` mirror the label across the shape's own axes. A resize past
 * the anchor reflects the box; the shape is symmetric, the label is not.
 */
export function followPatch(follow: Follow, now: Frame, flipX = false, flipY = false): Patch {
  const was = follow.frame;
  const sx = was.width > 1e-9 ? now.width / was.width : 1;
  const sy = was.height > 1e-9 ? now.height / was.height : 1;
  let ox = follow.offset[0] * sx, oy = follow.offset[1] * sy;
  if (flipX) ox = -ox;
  if (flipY) oy = -oy;
  const c = centreOf(now);
  const [tx, ty] = rotatePoint([c[0] + ox, c[1] + oy], c, now.angle);
  return { x: r4(tx - follow.width / 2), y: r4(ty - follow.height / 2), angle: now.angle };
}
