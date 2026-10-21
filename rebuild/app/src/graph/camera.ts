// The graph's view transform: screen = centre of the canvas + offset +
// world × scale. Zooming eases to its target around the point it was aimed
// at (one wheel notch zooms to about 71%, as in Obsidian), and hit-testing
// finds the node under a point in one pass over the nodes.

/** A zoom in progress keeps world point (wx, wy) under screen point (sx, sy). */
interface ZoomAnchor {
  sx: number;
  sy: number;
  wx: number;
  wy: number;
}

export interface Camera {
  /** The canvas's size in CSS pixels. */
  width: number;
  height: number;
  scale: number;
  /** Where the zoom is easing to. */
  target: number;
  offX: number;
  offY: number;
  zoomAt: ZoomAnchor | null;
}

export const MIN_SCALE = 1 / 128;
export const MAX_SCALE = 8;
/** Wheel zoom: one notch (100px) zooms to about 71%, as in Obsidian. */
const WHEEL_ZOOM = 0.0034;
const PINCH_ZOOM = 0.01;

export const camera = (scale: number): Camera => ({ width: 0, height: 0, scale, target: scale, offX: 0, offY: 0, zoomAt: null });

const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

/** The world point under a screen point (canvas CSS pixels). */
export function toWorld(cam: Camera, px: number, py: number): [number, number] {
  const cx = cam.width / 2 + cam.offX;
  const cy = cam.height / 2 + cam.offY;
  return [(px - cx) / cam.scale, (py - cy) / cam.scale];
}

/** The screen point of a world point. */
export function toScreen(cam: Camera, wx: number, wy: number): [number, number] {
  return [cam.width / 2 + cam.offX + wx * cam.scale, cam.height / 2 + cam.offY + wy * cam.scale];
}

/** A wheel event at (px, py): aim the zoom at it. A pinch arrives as a wheel event with Ctrl held, in small steps. */
export function wheelZoom(cam: Camera, px: number, py: number, e: { deltaY: number; deltaMode: number; ctrlKey: boolean }) {
  const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * cam.height : e.deltaY;
  cam.target = clampScale(cam.target * Math.exp(-delta * (e.ctrlKey ? PINCH_ZOOM : WHEEL_ZOOM)));
  const [wx, wy] = toWorld(cam, px, py);
  cam.zoomAt = { sx: px, sy: py, wx, wy };
}

/** Move the zoom towards its target for a frame `dt` ms long (all the way if `instant`). */
export function easeZoom(cam: Camera, dt: number, instant: boolean) {
  const ease = instant ? 1 : 1 - Math.pow(0.7, dt / 16);
  cam.scale += (cam.target - cam.scale) * ease;
  if (Math.abs(cam.target - cam.scale) < cam.target * 1e-3) cam.scale = cam.target;
  const at = cam.zoomAt;
  if (at) {
    cam.offX = at.sx - cam.width / 2 - at.wx * cam.scale;
    cam.offY = at.sy - cam.height / 2 - at.wy * cam.scale;
  }
  if (cam.scale === cam.target) cam.zoomAt = null;
}

export function panBy(cam: Camera, dx: number, dy: number) {
  cam.offX += dx;
  cam.offY += dy;
  cam.zoomAt = null;
}

/**
 * Node `f` in the middle, zoomed out (never in past `maxScale`) so that
 * every node fits, with room for labels: how the local graph frames its
 * note, which matters in the narrow sidebar.
 */
export function fitAround(cam: Camera, x: Float64Array, y: Float64Array, count: number, f: number, maxScale: number) {
  let reach = 0;
  for (let i = 0; i < count; i++) reach = Math.max(reach, Math.abs(x[i] - x[f]), Math.abs(y[i] - y[f]));
  const room = Math.max(40, Math.min(cam.width / 2 - 50, cam.height / 2 - 40));
  cam.scale = cam.target = Math.max(MIN_SCALE, Math.min(maxScale, reach ? room / reach : maxScale));
  cam.zoomAt = null;
  cam.offX = -x[f] * cam.scale;
  cam.offY = -y[f] * cam.scale;
}

/**
 * The node under a screen point, or -1: the nearest whose circle (drawn
 * `radius[i] × sizeMult × √scale` pixels wide, with 2px to spare) holds it.
 */
export function hitTest(cam: Camera, px: number, py: number, x: Float64Array, y: Float64Array, radius: Float64Array, sizeMult: number): number {
  const s = cam.scale;
  const [wx, wy] = toWorld(cam, px, py);
  const mult = sizeMult * Math.sqrt(s);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < radius.length; i++) {
    const r = (radius[i] * mult + 2) / s; // world units
    const dx = x[i] - wx;
    const dy = y[i] - wy;
    const d = dx * dx + dy * dy;
    if (d <= r * r && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}
