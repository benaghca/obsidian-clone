// Dev builds only: what the measuring harness reads from the graph views on
// the page (window.__graphWork and friends, window.__graphProbe). Release
// builds compile all of it out.

import { type Camera, toScreen } from "./camera";
import type { GraphModel } from "./data";

type DevWindow = { __graphWork?: number[]; __graphNodes?: number; __graphRunning?: boolean; __graphProbe?: () => unknown };
const dev = window as unknown as DevWindow;

/** Each frame's work (ms). */
export const devStats = import.meta.env.DEV
  ? (ms: number, nodes: number, running: boolean) => {
      (dev.__graphWork ??= []).push(ms);
      dev.__graphNodes = nodes;
      dev.__graphRunning = running;
    }
  : null;

/** Make this graph the one `__graphProbe()` reads: a node's and an empty spot's client coordinates. */
export function setProbe(canvas: HTMLCanvasElement, cam: Camera, view: () => { model: GraphModel; x: Float64Array; y: Float64Array }, nodeAt: (x: number, y: number) => number) {
  if (!import.meta.env.DEV) return;
  dev.__graphProbe = () => {
    const { model, x, y } = view();
    const rect = canvas.getBoundingClientRect();
    const at = (i: number) => {
      const [sx, sy] = toScreen(cam, x[i], y[i]);
      return [rect.left + sx, rect.top + sy];
    };
    // The most linked node on screen (clear of the settings panel).
    let best = -1;
    for (let i = 0; i < model.nodes.length; i++) {
      const [cx, cy] = at(i);
      if (cx < rect.left + 60 || cx > rect.right - 300 || cy < rect.top + 60 || cy > rect.bottom - 60) continue;
      if (best < 0 || model.nodes[i].weight > model.nodes[best].weight) best = i;
    }
    let empty: number[] | null = null;
    for (let gy = 40; gy < cam.height - 40 && !empty; gy += 20) {
      for (let gx = 40; gx < cam.width - 300 && !empty; gx += 20) if (nodeAt(gx, gy) < 0) empty = [rect.left + gx, rect.top + gy];
    }
    return { node: best >= 0 ? at(best) : null, empty, scale: cam.scale, nodes: model.nodes.length, links: model.links.length };
  };
}
