// Eased wheel and pinch zoom for the canvas (R2 CZ).
//
// A wheel tick or pinch step no longer jumps: it moves a target, and the board
// glides there over a short, bounded time. The glide runs in log2(scale), so a
// notch feels the same at every zoom level. Each frame zooms around one screen
// point, so the board point under the cursor stays under the cursor.
//
// One glide is a cubic segment from where the board is to the target. It ends
// with zero speed (no lurch at the end) and never passes the target, so a zoom
// never leaves the limits. A tick that arrives mid-glide starts a new segment
// from the current position and speed, so rapid ticks merge into one
// continuous glide instead of stacking jumps.

export const ZOOM_MIN = 1 / 16;
export const ZOOM_MAX = 2;
export const clampZoom = (scale: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale));

export interface Glide {
  /** log2(scale) where the segment starts and ends. */
  from: number;
  to: number;
  /** performance.now() at the start, and the length in ms. */
  start: number;
  ms: number;
  /** Starting speed as a multiple of the average speed (to - from) / ms: 0 is ease-in-out, 2 ease-out, 3 the most before it would overshoot. */
  slope: number;
  /** The exact scale the glide lands on (no log2 round trip). */
  target: number;
}

// A glide from rest, or one that turns around, starts as a quadratic ease-out:
// it answers the tick at once but does not jolt.
const FRESH = 2;
const MAX_SLOPE = 3;

/** How long a glide for one input step lasts. A pinch's small steps glide briefly, so the board keeps up with the fingers; a full wheel notch (a third of an octave) takes 200 ms. */
export function glideMs(step: number) {
  return 110 + 270 * Math.min(Math.abs(step), 1 / 3);
}

/** Where a glide is at `now`: log2(scale), its speed in log2 per ms, and whether it has landed. */
export function glideAt(g: Glide, now: number): { log: number; rate: number; done: boolean } {
  const d = g.to - g.from;
  const u = Math.max(0, (now - g.start) / g.ms);
  if (u >= 1 || d === 0) return { log: g.to, rate: 0, done: true };
  const k = g.slope;
  // Hermite cubic with p(0) = 0, p(1) = 1, p'(0) = k, p'(1) = 0.
  const p = (((k - 2) * u + 3 - 2 * k) * u + k) * u;
  const dp = (3 * (k - 2) * u + 2 * (3 - 2 * k)) * u + k;
  return { log: g.from + d * p, rate: (d / g.ms) * dp, done: false };
}

/**
 * Aim the glide at `target`. `scale` is the board's scale now, used when no glide
 * is running. Returns the same glide when the target has not moved (a wheel at the
 * zoom limit), and undefined when there is nowhere to go.
 */
export function retarget(g: Glide | undefined, scale: number, target: number, now: number, ms: number): Glide | undefined {
  const at = g ? glideAt(g, now) : undefined;
  const moving = !!at && !at.done;
  if (moving && g!.target === target) return g;
  const from = moving ? at!.log : Math.log2(scale);
  const to = Math.log2(target);
  const d = to - from;
  if (Math.abs(d) < 1e-9) return undefined;
  // Keep the current speed when it already heads for the target; a glide that turns around starts afresh.
  const carried = moving ? (at!.rate * ms) / d : 0;
  const slope = carried > 0 ? Math.min(MAX_SLOPE, Math.max(FRESH, carried)) : FRESH;
  return { from, to, start: now, ms, slope, target };
}

/** The camera after zooming to `scale` around board-relative screen point (x, y): the board point under it stays put. */
export function zoomAround(cam: { cx: number; cy: number; scale: number }, scale: number, x: number, y: number, width: number, height: number) {
  return {
    cx: cam.cx + (x - width / 2) * (1 / cam.scale - 1 / scale),
    cy: cam.cy + (y - height / 2) * (1 / cam.scale - 1 / scale),
    scale,
  };
}
