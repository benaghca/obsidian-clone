import { describe, expect, it } from "vitest";
import { camera, easeZoom, fitAround, hitTest, MAX_SCALE, panBy, toScreen, toWorld, wheelZoom } from "./camera";

const cam = (scale = 1) => ({ ...camera(scale), width: 400, height: 300 });

describe("graph camera", () => {
  it("maps screen to world and back, through pans", () => {
    const c = cam(2);
    panBy(c, 30, -10);
    const [wx, wy] = toWorld(c, 250, 140);
    expect(toScreen(c, wx, wy)).toEqual([250, 140]);
    expect(toWorld(c, 230, 140)).toEqual([0, 0]);
  });

  it("a wheel notch zooms to about 71% around the pointer, easing there", () => {
    const c = cam(1);
    const [wx, wy] = toWorld(c, 100, 50);
    wheelZoom(c, 100, 50, { deltaY: 100, deltaMode: 0, ctrlKey: false });
    expect(c.target).toBeCloseTo(0.712, 3);
    for (let i = 0; i < 100 && c.scale !== c.target; i++) easeZoom(c, 16, false);
    expect(c.scale).toBe(c.target);
    expect(c.zoomAt).toBeNull();
    const [sx, sy] = toScreen(c, wx, wy);
    expect(sx).toBeCloseTo(100, 6);
    expect(sy).toBeCloseTo(50, 6);
    for (let i = 0; i < 20; i++) wheelZoom(c, 0, 0, { deltaY: -500, deltaMode: 0, ctrlKey: false });
    expect(c.target).toBe(MAX_SCALE);
  });

  it("fits a node's neighbourhood around it, never zooming in past the limit", () => {
    const c = cam(1);
    const x = Float64Array.from([0, 300, -50]);
    const y = Float64Array.from([0, 0, 600]);
    fitAround(c, x, y, 3, 0, 1);
    expect(c.scale).toBeCloseTo(110 / 600, 6);
    expect(toScreen(c, 0, 0)).toEqual([200, 150]);
    fitAround(c, Float64Array.from([5]), Float64Array.from([5]), 1, 0, 1);
    expect(c.scale).toBe(1);
  });

  it("hit-tests the nearest node within its drawn radius", () => {
    const c = cam(1);
    const x = Float64Array.from([0, 20]);
    const y = Float64Array.from([0, 0]);
    const r = Float64Array.from([8, 8]);
    expect(hitTest(c, 200 + 12, 150, x, y, r, 1)).toBe(1);
    expect(hitTest(c, 200 + 9, 150, x, y, r, 1)).toBe(0);
    expect(hitTest(c, 200, 150 + 11, x, y, r, 1)).toBe(-1);
  });
});
