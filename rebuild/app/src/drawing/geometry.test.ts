import { describe, expect, it } from "vitest";
import {
  boxFrom, centreOf, elementFrame, frameAabb, frameCorners, handleAt, handleCursor, handlePoints, hitElement, hitTest,
  mapPoint, marqueeHits, normalizeAngle, rebase, resizeFrame, rotateFrame, rotatePoint, selectionFrame, toLocal,
  type Frame,
} from "./geometry";
import { parseScene, type DrawingElement, type Point } from "./scene";

function elements(list: Record<string, unknown>[]): DrawingElement[] {
  const parsed = parseScene(JSON.stringify({ type: "excalidraw", version: 2, elements: list }));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.scene.elements;
}
const one = (props: Record<string, unknown>) => elements([{ id: "a", strokeWidth: 2, ...props }])[0];
const close = (a: Point, b: Point, digits = 6) => { expect(a[0]).toBeCloseTo(b[0], digits); expect(a[1]).toBeCloseTo(b[1], digits); };
const closeFrame = (a: Frame, b: Partial<Frame>) => { for (const k of Object.keys(b) as (keyof Frame)[]) expect(a[k]).toBeCloseTo(b[k]!, 6); };

describe("frames", () => {
  it("normalizes negative sizes", () => {
    expect(elementFrame(one({ type: "rectangle", x: 100, y: 50, width: -40, height: -20 }))).toEqual({ x: 60, y: 30, width: 40, height: 20, angle: 0 });
  });
  it("uses the point box for lines, like the renderer's pivot", () => {
    const f = elementFrame(one({ type: "line", x: 10, y: 10, points: [[0, 0], [-20, 30], [40, 10]] }));
    expect(f).toEqual({ x: -10, y: 10, width: 60, height: 30, angle: 0 });
  });
  it("turns corners about the centre", () => {
    const corners = frameCorners({ x: 0, y: 0, width: 100, height: 50, angle: Math.PI / 2 });
    close(corners[0], [75, -25]);
    close(corners[2], [25, 75]);
    expect(frameAabb({ x: 0, y: 0, width: 100, height: 50, angle: Math.PI / 2 })).toMatchObject({ width: 50 });
  });
  it("frames several elements upright", () => {
    const list = elements([
      { id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
      { id: "b", type: "rectangle", x: 50, y: 20, width: 10, height: 40, angle: Math.PI / 2 },
    ]);
    expect(selectionFrame(list)).toEqual({ x: 0, y: 0, width: 75, height: 45, angle: 0 });
    expect(selectionFrame([])).toBeNull();
  });
  it("normalizes angles into one turn", () => {
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo(Math.PI * 1.5);
    expect(normalizeAngle(Math.PI * 4)).toBe(0);
    expect(normalizeAngle(Math.PI * 2 - 1e-12)).toBe(0);
  });
});

describe("hit-testing", () => {
  const tol = 4;
  it("hits a filled rectangle inside and an unfilled one only near its stroke", () => {
    const filled = one({ type: "rectangle", x: 0, y: 0, width: 100, height: 50, backgroundColor: "#ff0000" });
    const empty = one({ type: "rectangle", x: 0, y: 0, width: 100, height: 50, backgroundColor: "transparent" });
    expect(hitElement(filled, [50, 25], tol)).toBe(true);
    expect(hitElement(empty, [50, 25], tol)).toBe(false);
    expect(hitElement(empty, [50, 2], tol)).toBe(true);
    expect(hitElement(empty, [104, 25], tol)).toBe(true);
    expect(hitElement(empty, [108, 25], tol)).toBe(false);
  });
  it("follows the element's turn", () => {
    const turned = one({ type: "rectangle", x: 0, y: 40, width: 200, height: 20, angle: Math.PI / 2, backgroundColor: "#000000" });
    // Turned a quarter about (100, 50): it now runs from y=-50 to y=150 at x=90..110.
    expect(hitElement(turned, [100, -40], tol)).toBe(true);
    expect(hitElement(turned, [10, 50], tol)).toBe(false);
  });
  it("hits an ellipse inside its outline, not in the box corner", () => {
    const el = one({ type: "ellipse", x: 0, y: 0, width: 100, height: 60, backgroundColor: "#00ff00" });
    expect(hitElement(el, [50, 30], tol)).toBe(true);
    expect(hitElement(el, [5, 5], tol)).toBe(false);
    const ring = one({ type: "ellipse", x: 0, y: 0, width: 100, height: 60 });
    expect(hitElement(ring, [50, 30], tol)).toBe(false);
    expect(hitElement(ring, [101, 30], tol)).toBe(true);
    expect(hitElement(ring, [50, -3], tol)).toBe(true);
  });
  it("hits a diamond inside its four sides", () => {
    const el = one({ type: "diamond", x: 0, y: 0, width: 100, height: 100, backgroundColor: "#0000ff" });
    expect(hitElement(el, [50, 50], tol)).toBe(true);
    expect(hitElement(el, [8, 8], tol)).toBe(false);
    const outline = one({ type: "diamond", x: 0, y: 0, width: 100, height: 100 });
    expect(hitElement(outline, [25, 25], tol)).toBe(true);
    expect(hitElement(outline, [50, 50], tol)).toBe(false);
  });
  it("hits a line near its segments and a rounded line near its curve", () => {
    const line = one({ type: "line", x: 0, y: 0, points: [[0, 0], [100, 0], [100, 100]] });
    expect(hitElement(line, [50, 3], tol)).toBe(true);
    expect(hitElement(line, [50, 50], tol)).toBe(false);
    const curve = one({ type: "line", x: 0, y: 0, points: [[0, 0], [50, 50], [100, 0]], roundness: { type: 2 } });
    expect(hitElement(curve, [50, 50], tol)).toBe(true);
    expect(hitElement(curve, [50, 20], tol)).toBe(false);
  });
  it("ignores deleted, locked and unknown elements", () => {
    for (const extra of [{ isDeleted: true }, { locked: true }, { type: "embeddable" }]) {
      expect(hitElement(one({ type: "rectangle", x: 0, y: 0, width: 10, height: 10, backgroundColor: "#000000", ...extra }), [5, 5], tol)).toBe(false);
    }
  });
  it("picks the topmost element, and a label's shape", () => {
    const list = elements([
      { id: "under", type: "rectangle", x: 0, y: 0, width: 100, height: 100, backgroundColor: "#000000" },
      { id: "box", type: "rectangle", x: 20, y: 20, width: 60, height: 60 },
      { id: "label", type: "text", x: 30, y: 40, width: 40, height: 20, text: "hi", containerId: "box" },
      { id: "free", type: "text", x: 200, y: 0, width: 40, height: 20, text: "x" },
    ]);
    expect(hitTest(list, [50, 50], tol)?.id).toBe("box");
    expect(hitTest(list, [5, 5], tol)?.id).toBe("under");
    expect(hitTest(list, [210, 10], tol)?.id).toBe("free");
    expect(hitTest(list, [500, 500], tol)).toBeNull();
  });
});

describe("marquee", () => {
  it("takes only elements wholly inside, and not bound labels", () => {
    const list = elements([
      { id: "in", type: "rectangle", x: 10, y: 10, width: 20, height: 20 },
      { id: "half", type: "rectangle", x: 90, y: 10, width: 20, height: 20 },
      { id: "label", type: "text", x: 12, y: 12, width: 10, height: 10, text: "t", containerId: "in" },
      { id: "gone", type: "rectangle", x: 10, y: 10, width: 5, height: 5, isDeleted: true },
    ]);
    expect(marqueeHits(list, boxFrom([100, 100], [0, 0])).map((e) => e.id)).toEqual(["in"]);
  });
});

describe("handles", () => {
  const f: Frame = { x: 0, y: 0, width: 100, height: 60, angle: 0 };
  it("places eight handles and the rotate handle above the top", () => {
    const pts = handlePoints(f, 1);
    close(pts.se!, [100, 60]);
    close(pts.n!, [50, 0]);
    close(pts.rotate!, [50, -22]);
    // At half zoom the rotate handle is twice as far in scene units.
    close(handlePoints(f, 0.5).rotate!, [50, -44]);
  });
  it("turns handles with the frame", () => {
    const pts = handlePoints({ ...f, angle: Math.PI }, 1);
    close(pts.se!, [0, 0]);
    close(pts.rotate!, [50, 82]);
  });
  it("drops side handles on a small box", () => {
    const pts = handlePoints({ x: 0, y: 0, width: 20, height: 20, angle: 0 }, 1);
    expect(pts.n).toBeUndefined();
    expect(pts.ne).toBeDefined();
  });
  it("finds the handle under the pointer", () => {
    expect(handleAt(f, [99, 61], 1)).toBe("se");
    expect(handleAt(f, [50, -20], 1)).toBe("rotate");
    expect(handleAt(f, [50, 30], 1)).toBeNull();
    expect(handleAt(f, [99, 61], 1, false)).toBeNull();
  });
  it("picks a cursor that follows the turn", () => {
    expect(handleCursor("n", 0)).toBe("ns-resize");
    expect(handleCursor("n", Math.PI / 2)).toBe("ew-resize");
    expect(handleCursor("ne", 0)).toBe("nesw-resize");
    expect(handleCursor("ne", Math.PI / 4)).toBe("ew-resize");
  });
});

describe("resize", () => {
  const f: Frame = { x: 0, y: 0, width: 100, height: 50, angle: 0 };
  it("moves the dragged corner and keeps the opposite one", () => {
    expect(resizeFrame(f, "se", [150, 80]).frame).toEqual({ x: 0, y: 0, width: 150, height: 80, angle: 0 });
    expect(resizeFrame(f, "nw", [-10, -20]).frame).toEqual({ x: -10, y: -20, width: 110, height: 70, angle: 0 });
  });
  it("moves only one axis from a side handle", () => {
    expect(resizeFrame(f, "e", [130, 999]).frame).toEqual({ x: 0, y: 0, width: 130, height: 50, angle: 0 });
    expect(resizeFrame(f, "n", [999, 10]).frame).toEqual({ x: 0, y: 10, width: 100, height: 40, angle: 0 });
  });
  it("flips past the anchor", () => {
    const r = resizeFrame(f, "e", [-20, 25]);
    expect(r.frame).toEqual({ x: -20, y: 0, width: 20, height: 50, angle: 0 });
    expect(r.flipX).toBe(true);
    expect(r.flipY).toBe(false);
  });
  it("keeps proportions", () => {
    expect(resizeFrame(f, "se", [200, 60], { keepAspect: true }).frame).toEqual({ x: 0, y: 0, width: 200, height: 100, angle: 0 });
    // A side handle grows the other axis about the centre.
    closeFrame(resizeFrame(f, "e", [200, 0], { keepAspect: true }).frame, { x: 0, y: -25, width: 200, height: 100 });
  });
  it("resizes about the centre", () => {
    expect(resizeFrame(f, "e", [110, 0], { fromCentre: true }).frame).toEqual({ x: -10, y: 0, width: 120, height: 50, angle: 0 });
    expect(resizeFrame(f, "se", [60, 35], { fromCentre: true }).frame).toEqual({ x: 40, y: 15, width: 20, height: 20, angle: 0 });
  });
  it("keeps the opposite corner fixed in the scene when the frame is turned", () => {
    const turned: Frame = { ...f, angle: Math.PI / 3 };
    const anchor = frameCorners(turned)[0];
    // Drag the bottom right corner to a scene point some way out along the frame's own axes.
    const target = rotatePoint([180, 90], centreOf(turned), turned.angle);
    const r = resizeFrame(turned, "se", target);
    closeFrame(r.frame, { width: 180, height: 90, angle: Math.PI / 3 });
    close(frameCorners(r.frame)[0], anchor);
    close(frameCorners(r.frame)[2], target);
  });
  it("sizes a box with no width from a side drag", () => {
    const flat: Frame = { x: 10, y: 0, width: 0, height: 40, angle: 0 };
    expect(resizeFrame(flat, "e", [50, 20]).frame).toEqual({ x: 10, y: 0, width: 40, height: 40, angle: 0 });
    expect(resizeFrame(flat, "e", [0, 20]).flipX).toBe(true);
  });
  it("maps points between boxes, mirrored on a flip", () => {
    const from = { x: 0, y: 0, width: 100, height: 50 };
    const to = { x: 10, y: 10, width: 200, height: 100 };
    close(mapPoint([25, 50], from, to), [60, 110]);
    close(mapPoint([25, 50], from, to, true), [160, 110]);
  });
  it("rebases points onto the first", () => {
    expect(rebase([[10, 20], [30, 25]])).toEqual({ x: 10, y: 20, points: [[0, 0], [20, 5]] });
  });
});

describe("rotate", () => {
  const f: Frame = { x: 0, y: 0, width: 100, height: 100, angle: 0 };
  it("turns by the angle swept about the centre", () => {
    expect(rotateFrame(f, [50, -20], [120, 50])).toBeCloseTo(Math.PI / 2);
    expect(rotateFrame({ ...f, angle: Math.PI / 2 }, [50, -20], [-20, 50])).toBeCloseTo(0);
  });
  it("snaps to 15 degree steps", () => {
    const a = rotateFrame(f, [50, -20], rotatePoint([50, -20], [50, 50], 0.29), true);
    expect(a).toBeCloseTo(Math.PI / 12);
  });
  it("round-trips through local coordinates", () => {
    const turned = { ...f, angle: 1.1 };
    const p: Point = [12, 34];
    close(rotatePoint(toLocal(turned, p), centreOf(turned), turned.angle), p);
  });
});
