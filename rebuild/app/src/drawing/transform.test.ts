import { describe, expect, it } from "vitest";
import { centreOf, elementFrame, frameCorners, resizeFrame, rotatePoint, selectionFrame } from "./geometry";
import { parseScene, type DrawingElement } from "./scene";
import { followOf, followPatch, groupResizedPatch, groupRotatedPatch, movedPatch, resizedPatch } from "./transform";

function elements(list: Record<string, unknown>[]): DrawingElement[] {
  const parsed = parseScene(JSON.stringify({ type: "excalidraw", version: 2, elements: list }));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.scene.elements;
}

describe("element patches", () => {
  it("moves by the drag", () => {
    const [el] = elements([{ id: "a", type: "rectangle", x: 10, y: 20, width: 5, height: 5 }]);
    expect(movedPatch(el, 3.5, -4)).toEqual({ x: 13.5, y: 16 });
  });

  it("resizes a shape to the new frame", () => {
    const [el] = elements([{ id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50 }]);
    const from = elementFrame(el);
    expect(resizedPatch(el, from, resizeFrame(from, "se", [200, 100]))).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it("scales a line's points, keeps the first at the origin, and mirrors on a flip", () => {
    const [el] = elements([{ id: "l", type: "line", x: 10, y: 10, points: [[0, 0], [100, 50]] }]);
    const from = elementFrame(el);
    const wide = resizedPatch(el, from, resizeFrame(from, "e", [210, 0]));
    expect(wide).toEqual({ x: 10, y: 10, width: 200, height: 50, points: [[0, 0], [200, 50]] });
    const flipped = resizedPatch(el, from, resizeFrame(from, "e", [-90, 0]));
    expect(flipped).toEqual({ x: 10, y: 10, width: 100, height: 50, points: [[0, 0], [-100, 50]] });
  });

  it("resizes a group about its anchor", () => {
    const list = elements([
      { id: "a", type: "rectangle", x: 0, y: 0, width: 50, height: 50 },
      { id: "b", type: "ellipse", x: 50, y: 50, width: 50, height: 50 },
      { id: "t", type: "text", x: 0, y: 80, width: 20, height: 20, text: "x" },
    ]);
    const box = selectionFrame(list)!;
    const r = resizeFrame(box, "se", [200, 200]);
    expect(groupResizedPatch(list[0], box, r)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(groupResizedPatch(list[1], box, r)).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    // Text keeps its size and moves with its centre.
    expect(groupResizedPatch(list[2], box, r)).toEqual({ x: 10, y: 170 });
  });

  it("bakes a turned line's angle into its points in a group resize", () => {
    const [line, box] = elements([
      { id: "l", type: "line", x: 0, y: 50, angle: Math.PI / 2, points: [[0, 0], [100, 0]] },
      { id: "r", type: "rectangle", x: 0, y: 0, width: 100, height: 100 },
    ]);
    const frame = selectionFrame([line, box])!;
    const patch = groupResizedPatch(line, frame, resizeFrame(frame, "se", [200, 200]));
    expect(patch.angle).toBe(0);
    expect(patch.points).toEqual([[0, 0], [0, 200]]);
    expect([patch.x, patch.y]).toEqual([100, 0]);
  });

  it("turns group members about the group centre", () => {
    const [el] = elements([{ id: "a", type: "rectangle", x: 90, y: 0, width: 20, height: 20 }]);
    const patch = groupRotatedPatch(el, [100, 100], Math.PI / 2);
    // Its centre (100, 10) swings to (190, 100).
    expect(patch.x).toBeCloseTo(180);
    expect(patch.y).toBeCloseTo(90);
    expect(patch.angle).toBeCloseTo(Math.PI / 2);
  });

  it("keeps a label in place inside its shape through a resize and a turn", () => {
    const [box, label] = elements([
      { id: "b", type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
      { id: "t", type: "text", x: 30, y: 10, width: 40, height: 20, text: "hi", containerId: "b" },
    ]);
    const follow = followOf(label, box);
    expect(follow.offset).toEqual([0, -10]);
    const turned = { ...elementFrame(box), x: 0, y: 0, width: 200, height: 120, angle: Math.PI / 2 };
    const patch = followPatch(follow, turned);
    // Offset doubles to (0, -20) and turns a quarter about the centre (100, 60).
    const want = rotatePoint([100, 40], centreOf(turned), Math.PI / 2);
    expect((patch.x as number) + 20).toBeCloseTo(want[0]);
    expect((patch.y as number) + 10).toBeCloseTo(want[1]);
    expect(patch.angle).toBeCloseTo(Math.PI / 2);
    // The label's centre is inside the turned shape.
    const corners = frameCorners(turned);
    const xs = corners.map((p) => p[0]);
    expect(want[0]).toBeGreaterThan(Math.min(...xs));
    expect(want[0]).toBeLessThan(Math.max(...xs));
  });
});
