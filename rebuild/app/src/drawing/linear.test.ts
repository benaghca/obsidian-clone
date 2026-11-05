import { describe, expect, it } from "vitest";
import { hitElement } from "./geometry";
import { midpoints, pathMidpoint, pointAt, pointsPatch, snapAngle, strokePatch, worldPoints } from "./linear";
import { hasPressure, pressureWidth, renderDrawing } from "./render";
import { parseScene, type DrawingElement, type Point, type Scene } from "./scene";

function sceneOf(list: Record<string, unknown>[]): Scene {
  const parsed = parseScene(JSON.stringify({ type: "excalidraw", version: 2, elements: list }));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.scene;
}
const one = (props: Record<string, unknown>): DrawingElement => sceneOf([{ id: "a", strokeWidth: 2, ...props }]).elements[0];
const close = (a: Point, b: Point, digits = 6) => { expect(a[0]).toBeCloseTo(b[0], digits); expect(a[1]).toBeCloseTo(b[1], digits); };

describe("line points", () => {
  it("places points in the scene, turned about their box", () => {
    const flat = one({ type: "line", x: 10, y: 20, points: [[0, 0], [100, 0]] });
    expect(worldPoints(flat)).toEqual([[10, 20], [110, 20]]);
    const turned = one({ type: "line", x: 10, y: 20, angle: Math.PI / 2, points: [[0, 0], [100, 0]] });
    const [a, b] = worldPoints(turned);
    close(a, [60, -30]);
    close(b, [60, 70]);
  });

  it("writes points back with the first at the origin and the turn baked in", () => {
    expect(pointsPatch([[60, -30], [60, 70], [0, 70]])).toEqual({ x: 60, y: -30, width: 60, height: 100, angle: 0, points: [[0, 0], [0, 100], [-60, 100]] });
    // What a turned line shows is what its baked points show.
    const turned = one({ type: "line", x: 10, y: 20, angle: Math.PI / 2, points: [[0, 0], [100, 0], [100, 40]] });
    const baked = one({ type: "line", ...pointsPatch(worldPoints(turned)) });
    worldPoints(baked).forEach((p, i) => close(p, worldPoints(turned)[i], 3));
  });

  it("snaps to 15° steps and keeps the length", () => {
    const p = snapAngle([0, 0], [100, 8]);
    close(p, [Math.hypot(100, 8), 0]);
    const q = snapAngle([10, 10], [60, 62]);
    expect(Math.atan2(q[1] - 10, q[0] - 10)).toBeCloseTo(Math.PI / 4, 9);
    expect(snapAngle([5, 5], [5, 5])).toEqual([5, 5]);
  });

  it("finds point handles, the last one winning a tie, and midpoints between them", () => {
    const pts: Point[] = [[0, 0], [100, 0], [100, 0.5]];
    expect(pointAt(pts, [100, 0.25], 3)).toBe(2);
    expect(pointAt(pts, [98, 0], 3)).toBe(1);
    expect(pointAt(pts, [50, 0], 3)).toBe(-1);
    expect(midpoints([[0, 0], [100, 0], [100, 50]])).toEqual([[50, 0], [100, 25]]);
  });

  it("finds the middle of a path by length", () => {
    expect(pathMidpoint([[0, 0], [100, 0]])).toEqual([50, 0]);
    expect(pathMidpoint([[0, 0], [100, 0], [100, 100]])).toEqual([100, 0]);
    expect(pathMidpoint([[0, 0], [30, 0], [30, 90]])).toEqual([30, 30]);
    expect(pathMidpoint([[7, 7]])).toEqual([7, 7]);
  });
});

describe("freedraw strokes", () => {
  it("hangs a stroke from its first point, with the box of its points", () => {
    expect(strokePatch([10, 10], [[10, 10], [20, 5], [0, 30]], null)).toEqual({ x: 10, y: 10, width: 20, height: 25, points: [[0, 0], [10, -5], [-10, 20]] });
    expect(strokePatch([0, 0], [[0, 0], [1, 1]], [0.25, 0.7777])).toMatchObject({ pressures: [0.25, 0.778] });
  });

  it("draws a pen stroke as a filled outline whose width follows the pressure", () => {
    const pen = { id: "p", type: "freedraw", x: 0, y: 0, strokeWidth: 4, strokeColor: "#123456", simulatePressure: false, points: [[0, 0], [50, 0], [100, 0]], pressures: [0.1, 0.5, 1] };
    const el = sceneOf([pen]).elements[0];
    expect(hasPressure(el as never)).toBe(true);
    const markup = renderDrawing(sceneOf([pen])).markup;
    const path = markup.match(/<path data-id="p"[^>]*>/)![0];
    expect(path).toContain('fill="#123456"');
    expect(path).toContain('stroke="none"');
    // The sides sit half the pressured width from the centre line: 2.4 at the start, 4 in the middle, 6 at the end.
    const d = path.match(/ d="([^"]+)"/)![1];
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(nums.slice(0, 2)).toEqual([0, pressureWidth(4, 0.1) / 2]);
    expect(d).toMatch(/ A3 3 0 0 0 100 -3/);
    expect(pressureWidth(4, 0.5)).toBe(4);
    // Bounds take the widest part in.
    expect(renderDrawing(sceneOf([pen])).bounds.height).toBeGreaterThanOrEqual(6);
  });

  it("keeps a mouse stroke at one width", () => {
    const mouse = { id: "m", type: "freedraw", x: 0, y: 0, strokeWidth: 2, simulatePressure: true, points: [[0, 0], [50, 0], [100, 10]], pressures: [] };
    const path = renderDrawing(sceneOf([mouse])).markup.match(/<path data-id="m"[^>]*>/)![0];
    expect(path).toContain('stroke-width="2"');
    expect(path).toContain('fill="none"');
    // Pressures that don't cover every point aren't trusted either.
    expect(hasPressure(sceneOf([{ ...mouse, simulatePressure: false, pressures: [0.5] }]).elements[0] as never)).toBe(false);
  });

  it("draws a single pen point as a dot", () => {
    const dot = { id: "d", type: "freedraw", x: 5, y: 5, strokeWidth: 2, simulatePressure: false, points: [[0, 0], [0, 0]], pressures: [0.5, 0.5] };
    expect(renderDrawing(sceneOf([dot])).markup).toMatch(/<path data-id="d"[^>]* d="M4 5 A1 1 0 1 0 6 5 A1 1 0 1 0 4 5 Z"/);
  });
});

describe("arrowheads", () => {
  it("are hit across their whole head, not only along the shaft", () => {
    const arrow = one({ type: "arrow", x: 0, y: 0, points: [[0, 0], [100, 0]], endArrowhead: "triangle", startArrowhead: null });
    // arrowSize(2) is 12: the head runs 12 back from the tip and about 5 to each side.
    expect(hitElement(arrow, [90, 4], 0.5)).toBe(true);
    expect(hitElement(arrow, [5, 4], 0.5)).toBe(false);
    expect(hitElement(arrow, [90, 9], 0.5)).toBe(false);
    const line = one({ type: "line", x: 0, y: 0, points: [[0, 0], [100, 0]] });
    expect(hitElement(line, [90, 4], 0.5)).toBe(false);
  });
});
