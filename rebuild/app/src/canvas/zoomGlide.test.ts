import { describe, expect, it } from "vitest";
import { ZOOM_MAX, ZOOM_MIN, clampZoom, glideAt, glideMs, retarget, zoomAround, type Glide } from "./zoomGlide";

const W = 1280, H = 800;
// The board point under board-relative screen point (x, y).
const under = (cam: { cx: number; cy: number; scale: number }, x: number, y: number) =>
  [cam.cx + (x - W / 2) / cam.scale, cam.cy + (y - H / 2) / cam.scale];
// Run a glide frame by frame (16.7 ms), zooming around (x, y) like navigation.ts does.
function play(cam: { cx: number; cy: number; scale: number }, g: Glide, x: number, y: number, from = g.start, until = Infinity) {
  const frames: { t: number; scale: number }[] = [];
  for (let t = from + 16.7; ; t += 16.7) {
    if (t > until) return { cam, frames, glide: g as Glide | undefined };
    const at = glideAt(g, t);
    cam = zoomAround(cam, at.done ? g.target : 2 ** at.log, x, y, W, H);
    frames.push({ t, scale: cam.scale });
    if (at.done) return { cam, frames, glide: undefined };
  }
}

describe("canvas zoom glide", () => {
  it("keeps the board point under the cursor fixed on every frame", () => {
    const start = { cx: 300, cy: -120, scale: .7 }, x = 910, y = 233;
    const fixed = under(start, x, y);
    const g = retarget(undefined, start.scale, clampZoom(start.scale * 2 ** (1 / 3)), 0, glideMs(1 / 3))!;
    let cam = start;
    for (let t = 16.7; t < 400; t += 16.7) {
      cam = zoomAround(cam, 2 ** glideAt(g, t).log, x, y, W, H);
      const [wx, wy] = under(cam, x, y);
      expect(wx).toBeCloseTo(fixed[0], 9);
      expect(wy).toBeCloseTo(fixed[1], 9);
    }
  });

  it("lands exactly on the target with zero speed, without overshoot, in bounded time", () => {
    for (const step of [1 / 3, -1 / 3, .02, -.05, 4, -4]) {
      const from = 1, target = clampZoom(from * 2 ** step), ms = glideMs(step);
      const g = retarget(undefined, from, target, 0, ms)!;
      expect(ms).toBeGreaterThanOrEqual(110);
      expect(ms).toBeLessThanOrEqual(200);
      const { cam, frames } = play({ cx: 0, cy: 0, scale: from }, g, 100, 100);
      expect(cam.scale).toBe(target);
      expect(frames.at(-1)!.t).toBeLessThanOrEqual(ms + 16.7);
      // Monotone: each frame moves toward the target and none passes it.
      const sign = Math.sign(target - from);
      let last = from;
      for (const f of frames) {
        expect(sign * (f.scale - last)).toBeGreaterThanOrEqual(-1e-12);
        expect(sign * (target - f.scale)).toBeGreaterThanOrEqual(-1e-12);
        last = f.scale;
      }
      // Eased at both ends: the first frame takes a fraction of the way, and the speed falls to zero.
      expect(Math.abs(Math.log2(frames[0].scale / from))).toBeLessThan(Math.abs(Math.log2(target / from)) * .35);
      expect(Math.abs(glideAt(g, ms * .999).rate)).toBeLessThan(Math.abs(glideAt(g, 0).rate) * .01);
      expect(glideAt(g, ms).done).toBe(true);
    }
  });

  it("merges rapid ticks into one continuous glide that ends where the ticks add up to", () => {
    let cam = { cx: 50, cy: 50, scale: .5 }, g: Glide | undefined, target = cam.scale, now = 0;
    const x = 400, y = 300, fixed = under(cam, x, y);
    let lastScale = cam.scale, biggest = 0;
    const burst: number[] = [];
    for (let tick = 0; tick < 6; tick++) {
      // The new segment starts where the old one is at that moment: no jump.
      if (g) expect(retargetedLog(g, target, now)).toBeCloseTo(glideAt(g, now).log, 12);
      target = clampZoom(target * 2 ** (1 / 3));
      g = retarget(g, cam.scale, target, now, glideMs(1 / 3))!;
      const run = play(cam, g, x, y, now, now + 40);
      cam = run.cam;
      for (const f of run.frames) { const step = Math.abs(Math.log2(f.scale / lastScale)); burst.push(step); biggest = Math.max(biggest, step); lastScale = f.scale; }
      now += 40;
    }
    const end = play(cam, g!, x, y, now);
    for (const f of end.frames) { biggest = Math.max(biggest, Math.abs(Math.log2(f.scale / lastScale))); lastScale = f.scale; }
    expect(end.cam.scale).toBe(target);
    expect(target).toBeCloseTo(.5 * 2 ** 2, 12);
    // No frame jumps by a whole notch, and the board never stops between ticks:
    // the six ticks became one glide, not six jumps.
    expect(biggest).toBeLessThan(1 / 3 * .6);
    const mean = burst.reduce((a, b) => a + b) / burst.length;
    expect(Math.min(...burst.slice(1))).toBeGreaterThan(mean * .3);
    const [wx, wy] = under(end.cam, x, y);
    expect(wx).toBeCloseTo(fixed[0], 9);
    expect(wy).toBeCloseTo(fixed[1], 9);
  });

  it("keeps its speed when a tick in the same direction arrives mid-glide", () => {
    const g = retarget(undefined, 1, 2 ** (1 / 3), 0, 200)!;
    const before = glideAt(g, 60);
    const next = retarget(g, 1, 2 ** (2 / 3), 60, 200)!;
    expect(glideAt(next, 60).rate).toBeGreaterThanOrEqual(before.rate - 1e-12);
    // A tick back the other way starts a fresh ease-out toward the new target.
    const back = retarget(g, 1, 1, 60, 200)!;
    expect(glideAt(back, 60).log).toBeCloseTo(before.log, 12);
    expect(glideAt(back, 70).log).toBeLessThan(before.log);
  });

  it("respects the zoom limits, and a wheel at the limit changes nothing", () => {
    expect(clampZoom(50)).toBe(ZOOM_MAX);
    expect(clampZoom(1e-6)).toBe(ZOOM_MIN);
    expect([ZOOM_MIN, ZOOM_MAX]).toEqual([1 / 16, 2]);
    // From the cap, more zoom-in is nowhere to go.
    expect(retarget(undefined, ZOOM_MAX, clampZoom(ZOOM_MAX * 2), 0, 200)).toBeUndefined();
    // Mid-glide toward the cap, more capped ticks leave the glide as it is.
    const g = retarget(undefined, 1.5, ZOOM_MAX, 0, 200)!;
    expect(retarget(g, 1.5, clampZoom(ZOOM_MAX * 2 ** (1 / 3)), 50, 200)).toBe(g);
    // A long burst toward either limit never leaves them on any frame.
    for (const dir of [1, -1]) {
      let cam = { cx: 0, cy: 0, scale: 1 }, glide: Glide | undefined, target = 1;
      for (let t = 0; t < 2000; t += 16.7) {
        if (t < 1200) { target = clampZoom(target * 2 ** (dir / 3)); glide = retarget(glide, cam.scale, target, t, glideMs(1 / 3)) ?? glide; }
        if (!glide) continue;
        const at = glideAt(glide, t + 16.7);
        cam = zoomAround(cam, at.done ? glide.target : 2 ** at.log, 640, 400, W, H);
        expect(cam.scale).toBeGreaterThanOrEqual(ZOOM_MIN);
        expect(cam.scale).toBeLessThanOrEqual(ZOOM_MAX);
        if (at.done) glide = undefined;
      }
      expect(cam.scale).toBe(dir > 0 ? ZOOM_MAX : ZOOM_MIN);
    }
  });
});

function retargetedLog(g: Glide, target: number, now: number) {
  return glideAt(retarget(g, 1, clampZoom(target * 2 ** (1 / 3)), now, 200)!, now).log;
}
