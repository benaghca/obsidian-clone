// Drawing one frame of the graph on its canvas, as Obsidian's graph was
// observed to look: thin light links, grey nodes that grow with their number
// of links, labels under the nodes that fade in as you zoom in (fully shown
// from 100% zoom, gone below 50%), nodes that shrink more slowly than the
// zoom (by its square root). A hovered node, its links and its neighbours
// take the accent and everything else dims. The current note has the accent
// and a ring.
//
// Each frame clears, strokes the links (one path, or dimmed ones and
// highlighted ones), fills the nodes (one path per colour and brightness),
// then draws the labels in view; anything off screen is skipped. The canvas
// is drawn on the CPU in WebKitGTK (Cairo), where a line costs its length
// times its width in device pixels, so on a high-density screen links at
// the default thickness are one device pixel wide.

import type { GraphSettings } from "../settings/schema";
import type { GraphModel } from "./data";

/** The graph's colours, read from the --graph-* tokens. */
export interface Colors {
  node: string;
  unresolved: string;
  tag: string;
  attachment: string;
  focused: string;
  highlight: string;
  line: string;
  lineHighlight: string;
  text: string;
  arrow: string;
  font: string;
}

/** Everything one frame shows. */
export interface GraphFrame {
  /** Canvas size in CSS pixels, and canvas pixels per CSS pixel. */
  width: number;
  height: number;
  ratio: number;
  background: string;
  colors: Colors;
  cfg: GraphSettings;
  model: GraphModel;
  /** Node positions (world units). */
  x: Float64Array;
  y: Float64Array;
  /** Per node: base radius, colour (index into `palette`), and whether it is lit while hovering. */
  radius: Float64Array;
  colorOf: Int16Array;
  /** Node indices by colour, so each colour is one path. */
  order: Int32Array;
  palette: string[];
  paletteAlpha: number[];
  highlighted: Uint8Array;
  /** View transform: screen = centre of the canvas + offset + world × scale. */
  scale: number;
  offX: number;
  offY: number;
  /** The hovered node (-1: none), how far its highlight has faded in (0 to 1), the current note's node. */
  hover: number;
  fade: number;
  focus: number;
  /** A local graph zoomed to fit its neighbourhood keeps its labels. */
  follow: boolean;
}

const DIM = 0.2;
const LABEL_SIZE = 16;

export function drawGraph(ctx: CanvasRenderingContext2D, f: GraphFrame) {
  const { width, height, ratio, colors: c, cfg, model, x, y, radius, colorOf, order, palette, paletteAlpha, highlighted, hover } = f;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = f.background;
  ctx.fillRect(0, 0, width, height);
  const n = model.nodes.length;
  if (!n) return;
  const s = f.scale;
  const ns = Math.sqrt(s); // nodes and labels grow with the square root of the zoom
  const cx = width / 2 + f.offX;
  const cy = height / 2 + f.offY;
  const sizeMult = cfg.nodeSizeMultiplier;
  const fade = hover >= 0 ? f.fade : 0;
  const dim = 1 - (1 - DIM) * fade;
  const focus = f.focus;
  // Off-screen culling margin, in screen pixels.
  const pad = 40;
  const sx = (i: number) => cx + x[i] * s;
  const sy = (i: number) => cy + y[i] * s;

  // Links: one stroke for all of them, or dimmed ones and highlighted ones.
  // One device pixel on a dense screen at the default thickness (see the top).
  const lw = Math.max(0.3, cfg.lineSizeMultiplier * ns);
  ctx.lineWidth = ratio > 1 && lw <= 1.05 ? 1 / ratio : lw;
  const links = model.links;
  const pathLinks = (want: (touches: boolean) => boolean) => {
    ctx.beginPath();
    for (let k = 0; k < links.length; k++) {
      const a = links[k].source;
      const b = links[k].target;
      const touches = hover >= 0 && (a === hover || b === hover);
      if (!want(touches)) continue;
      const x1 = sx(a);
      const y1 = sy(a);
      const x2 = sx(b);
      const y2 = sy(b);
      if ((x1 < -pad && x2 < -pad) || (x1 > width + pad && x2 > width + pad) || (y1 < -pad && y2 < -pad) || (y1 > height + pad && y2 > height + pad)) continue;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
  };
  ctx.strokeStyle = c.line;
  ctx.globalAlpha = hover >= 0 ? dim : 1;
  pathLinks((touches) => hover < 0 || !touches || fade < 1);
  ctx.stroke();
  if (hover >= 0) {
    ctx.globalAlpha = fade;
    ctx.strokeStyle = c.lineHighlight;
    pathLinks((touches) => touches);
    ctx.stroke();
  }

  if (cfg.showArrow) {
    ctx.fillStyle = c.arrow;
    const size = Math.max(3, 6 * lw);
    const arrowTo = (from: number, to: number) => {
      const x2 = sx(to);
      const y2 = sy(to);
      if (x2 < -pad || x2 > width + pad || y2 < -pad || y2 > height + pad) return;
      const dx = x2 - sx(from);
      const dy = y2 - sy(from);
      const len = Math.hypot(dx, dy);
      const r = radius[to] * sizeMult * ns;
      if (len <= r + size) return;
      const ux = dx / len;
      const uy = dy / len;
      const tipX = x2 - ux * r;
      const tipY = y2 - uy * r;
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - ux * size - uy * size * 0.5, tipY - uy * size + ux * size * 0.5);
      ctx.lineTo(tipX - ux * size + uy * size * 0.5, tipY - uy * size - ux * size * 0.5);
      ctx.closePath();
    };
    ctx.globalAlpha = 0.5 * (hover >= 0 ? dim : 1);
    ctx.beginPath();
    for (const l of links) {
      arrowTo(l.source, l.target);
      if (l.both) arrowTo(l.target, l.source);
    }
    ctx.fill();
  }

  // Nodes, one path per colour and brightness.
  let pathColor = -1;
  let pathDim = -1;
  const flush = () => {
    if (pathColor < 0) return;
    ctx.fillStyle = palette[pathColor];
    ctx.globalAlpha = paletteAlpha[pathColor] * (pathDim ? dim : 1);
    ctx.fill();
  };
  for (let k = 0; k < n; k++) {
    const i = order[k];
    if (i === hover || i === focus) continue;
    const r = radius[i] * sizeMult * ns;
    const X = sx(i);
    const Y = sy(i);
    if (X < -r || X > width + r || Y < -r || Y > height + r) continue;
    const dimmed = hover >= 0 && !highlighted[i] ? 1 : 0;
    if (colorOf[i] !== pathColor || dimmed !== pathDim) {
      flush();
      pathColor = colorOf[i];
      pathDim = dimmed;
      ctx.beginPath();
    }
    ctx.moveTo(X + r, Y);
    ctx.arc(X, Y, r, 0, Math.PI * 2);
  }
  flush();
  // The current note: accent, with a ring.
  if (focus >= 0) {
    const r = radius[focus] * sizeMult * ns;
    const X = sx(focus);
    const Y = sy(focus);
    ctx.globalAlpha = hover >= 0 && !highlighted[focus] ? dim : 1;
    ctx.fillStyle = c.focused;
    ctx.beginPath();
    ctx.arc(X, Y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.focused;
    ctx.lineWidth = Math.max(1, 1.5 * ns);
    ctx.beginPath();
    ctx.arc(X, Y, r + Math.max(2, 3 * ns), 0, Math.PI * 2);
    ctx.stroke();
  }
  if (hover >= 0) {
    const r = radius[hover] * sizeMult * ns;
    ctx.globalAlpha = 1;
    ctx.fillStyle = hover === focus ? c.focused : c.highlight;
    ctx.beginPath();
    ctx.arc(sx(hover), sy(hover), r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Labels fade in with the zoom: none below 50%, all from 100% (the
  // text fade threshold shifts that), and the hovered node's always. A
  // local graph zoomed out only to fit its neighbourhood keeps them.
  // The label size is rounded to whole device pixels: while zooming it
  // changes every frame, and text at a size not drawn before is rasterised
  // afresh (in WebKitGTK that was half of a wheel-zoom frame, ~6 ms for
  // 1,000 labels; at a handful of sizes the glyphs are reused).
  const textAlpha = f.follow ? 1 : Math.max(0, Math.min(1, Math.log2(s) + 1 - cfg.textFadeMultiplier));
  const fontSize = Math.round(LABEL_SIZE * (f.follow ? Math.max(ns, 0.75) : ns) * ratio) / ratio;
  ctx.font = `${fontSize}px ${c.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = c.text;
  if (textAlpha > 0.01) {
    let current = -1;
    for (let i = 0; i < n; i++) {
      if (i === hover) continue;
      const X = sx(i);
      const Y = sy(i);
      if (X < -300 || X > width + 300 || Y < -fontSize * 2 || Y > height + 10) continue;
      const a = textAlpha * (hover >= 0 && !highlighted[i] ? dim : 1);
      if (a < 0.01) continue;
      if (a !== current) ctx.globalAlpha = current = a;
      ctx.fillText(model.nodes[i].label, X, Y + radius[i] * sizeMult * ns + 4);
    }
  }
  if (hover >= 0) {
    ctx.globalAlpha = Math.max(textAlpha, fade);
    const shift = 8 * fade * ns;
    ctx.fillText(model.nodes[hover].label, sx(hover), sy(hover) + radius[hover] * sizeMult * ns + 4 + shift);
  }
  ctx.globalAlpha = 1;
}

/** The graph's colours from its element's CSS tokens (empty strings while it is not in the document). */
export function readGraphColors(el: HTMLElement): Colors {
  const style = getComputedStyle(el);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    node: v("--graph-node"),
    unresolved: v("--graph-node-unresolved"),
    tag: v("--graph-node-tag"),
    attachment: v("--graph-node-attachment"),
    focused: v("--graph-node-focused"),
    highlight: v("--graph-node-highlight"),
    line: v("--graph-line"),
    lineHighlight: v("--graph-line-highlight"),
    text: v("--graph-text"),
    arrow: v("--graph-arrow"),
    font: style.fontFamily,
  };
}
