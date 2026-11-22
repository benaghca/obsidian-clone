// Eased wheel and pinch zoom for the canvas (R2 CZ).
//
// A wheel tick or pinch step no longer jumps: it moves a target, and the board
// glides there over a short, bounded time. The glide runs in log2(scale), so a
// notch feels the same at every zoom level. Each frame zooms around one screen
// point, so the board point under the cursor stays under the cursor.
//
// One glide is a cubic segment from where the board is to the target. It starts
// at the board's current speed and ends at rest, so the speed never jumps:
// - From rest it eases in and out.
// - A tick in the direction the board already moves keeps that speed. The
//   segment never passes the target, so it never leaves the limits.
// - A tick the other way first slows the board to a stop, then heads back. The
//   short run-on while it slows never passes the old target or the limits.
// Rapid ticks therefore merge into one continuous glide instead of stacking jumps.

export const ZOOM_MIN = 1 / 16;
export const ZOOM_MAX = 2;
export const clampZoom = (scale: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale));
const LOG_MIN = Math.log2(ZOOM_MIN), LOG_MAX = Math.log2(ZOOM_MAX);

export interface Glide {
  /** log2(scale) where the segment starts and ends. */
  from: number;
  to: number;
  /** performance.now() at the start, and the length in ms. */
  start: number;
  ms: number;
  /** The speed at the start, in log2 per ms (the board's speed when the input arrived). */
  speed: number;
  /** The exact scale the glide lands on (no log2 round trip). */
  target: number;
}

/** How long a glide for one input step lasts. A pinch's small steps glide briefly, so the board keeps up with the fingers; a full wheel notch (a third of an octave) takes 200 ms. */
export function glideMs(step: number) {
  return 110 + 270 * Math.min(Math.abs(step), 1 / 3);
}

// Hermite cubic over u in [0, 1] from `from` to `from + d`, starting with slope m
// (log2 per unit u) and ending with slope 0.
const offset = (d: number, m: number, u: number) => d * u * u * (3 - 2 * u) + m * u * (1 - u) * (1 - u);
const slope = (d: number, m: number, u: number) => (1 - u) * (6 * d * u + m * (1 - 3 * u));

/** Where a glide is at `now`: log2(scale), its speed in log2 per ms, and whether it has landed. */
export function glideAt(g: Glide, now: number): { log: number; rate: number; done: boolean } {
  const u = Math.max(0, (now - g.start) / g.ms);
  if (u >= 1) return { log: g.to, rate: 0, done: true };
  const d = g.to - g.from, m = g.speed * g.ms;
  const log = Math.max(LOG_MIN, Math.min(LOG_MAX, g.from + offset(d, m, u)));
  return { log, rate: slope(d, m, u) / g.ms, done: false };
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
  let speed = moving ? at!.rate : 0;
  if (Math.abs(d) < 1e-9 && Math.abs(speed * ms) < 1e-9) return undefined;
  if (speed * d > 0) {
    // Same direction: a start slope above 3 would overshoot, so a board that is
    // already fast for this distance lands sooner instead, still at its own speed.
    if (speed * ms / d > 3) ms = 3 * d / speed;
  } else if (speed !== 0) {
    // Turning around: the board runs on while it slows. That run-on peaks at
    // u = m / (3 (m - 2d)) and must not pass the old target (when it lies ahead)
    // or the limits; a shorter segment slows it sooner.
    const ahead = (g!.to - from) * speed > 0;
    const edge = speed > 0 ? (ahead ? Math.min(g!.to, LOG_MAX) : LOG_MAX) : (ahead ? Math.max(g!.to, LOG_MIN) : LOG_MIN);
    const room = Math.abs(edge - from);
    const runOn = (len: number) => { const m = speed * len; return Math.abs(offset(d, m, m / (3 * (m - 2 * d)))); };
    for (let i = 0; i < 40 && runOn(ms) > room; i++) ms *= .8;
    if (runOn(ms) > room) speed = 0;
  }
  return { from, to, start: now, ms, speed, target };
}

/** The camera after zooming to `scale` around board-relative screen point (x, y): the board point under it stays put. */
export function zoomAround(cam: { cx: number; cy: number; scale: number }, scale: number, x: number, y: number, width: number, height: number) {
  return {
    cx: cam.cx + (x - width / 2) * (1 / cam.scale - 1 / scale),
    cy: cam.cy + (y - height / 2) * (1 / cam.scale - 1 / scale),
    scale,
  };
}
