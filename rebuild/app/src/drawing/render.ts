// A drawing scene drawn as SVG. Geometry, hatch patterns and arrowheads here
// are Grove's. Roughness is ignored: lines stay clean until a later piece
// adds wobble. Freedraw keeps its pressures in the file and paints one
// smoothed stroke. Nothing is fetched; image bytes become object URLs locally.

import {
  type DrawingElement, type FillStyle, type FrameElement, type FreedrawElement, type ImageElement, type LinearElement,
  type Point, type Scene, type ShapeElement, type StrokeStyle, type TextElement,
} from "./scene";

export const isDrawingPath = (path: string) => /\.excalidraw$/i.test(path);

export interface RenderOptions {
  dark?: boolean;
  /** Object URL (or any href) for a file id. Missing images become a labelled box. */
  images?: (fileId: string) => string | undefined;
  /** Unique when more than one drawing is on the page, so pattern ids do not clash. */
  idPrefix?: string;
  /** Display width in px. Height follows the viewBox unless `height` is set. */
  width?: number;
  height?: number;
  /** Omit the height attribute so CSS can use height: auto. For unsized embeds. */
  flexHeight?: boolean;
  /** Draw the paper rect. Default true. A tab paints paper on its own element. */
  paper?: boolean;
  /** Skip joining the full document. Large views paint `shell` plus `chunks`. */
  omitMarkup?: boolean;
}

export interface Bounds { x: number; y: number; width: number; height: number }

export interface DrawingPicture {
  /** Full `<svg>` document. Empty when `omitMarkup` is set. */
  markup: string;
  /** Inner element markup, about 200 elements each, frames already ordered first. */
  chunks: string[];
  /** `<svg>` with defs and the paper rect, ready for chunks to be appended. */
  shell: string;
  background: string;
  grid: number | null;
  bounds: Bounds;
  viewBox: Bounds;
}

const CHUNK = 200;
const PAD = 16;

export function drawingColor(color: string, dark: boolean): string {
  if (!dark || !color || color === "transparent" || color === "none") return color;
  const parsed = parseHex(color.trim());
  if (!parsed || parsed.a === 0) return color;
  const light = (Math.max(parsed.r, parsed.g, parsed.b) + Math.min(parsed.r, parsed.g, parsed.b)) / 2 / 255;
  // Near-white paper darkens and near-black ink lightens. Colours in between stay.
  let toward: { r: number; g: number; b: number } | null = null;
  let t = 0;
  if (light >= 0.92) {
    toward = { r: 0x1e, g: 0x1e, b: 0x1e };
    t = 0.88 + 0.04 * Math.min(1, (light - 0.92) / 0.08);
  } else if (light <= 0.18) {
    toward = { r: 0xf5, g: 0xf5, b: 0xf5 };
    t = 0.62 + 0.2 * (1 - light / 0.18);
  }
  if (!toward) return color;
  const r = parsed.r + (toward.r - parsed.r) * t;
  const g = parsed.g + (toward.g - parsed.g) * t;
  const b = parsed.b + (toward.b - parsed.b) * t;
  const alpha = parsed.a < 1 ? hexByte(parsed.a * 255) : "";
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}${alpha}`;
}

/** Image files in the scene as object URLs. `revoke` drops them. No network. */
export function openDrawingImages(scene: Scene): { href(id: string): string | undefined; revoke(): void } {
  const urls: string[] = [];
  const byId = new Map<string, string>();
  for (const [id, file] of scene.files) {
    const url = objectUrl(file.dataURL, file.mimeType);
    if (url) { byId.set(id, url); urls.push(url); }
  }
  return {
    href: (id) => byId.get(id),
    revoke() {
      for (const url of urls) { try { URL.revokeObjectURL(url); } catch { /* no URL support */ } }
      urls.length = 0;
      byId.clear();
    },
  };
}

export function renderDrawing(scene: Scene, opts: RenderOptions = {}): DrawingPicture {
  const dark = opts.dark === true;
  const prefix = (opts.idPrefix ?? "dw").replace(/[^A-Za-z0-9_-]/g, "") || "dw";
  const patterns = new Map<string, string>();
  const defs: string[] = [];
  let clips = 0;
  const frames: string[] = [];
  const rest: string[] = [];
  let bounds: Bounds | null = null;

  const hatch = (style: FillStyle, color: string, sw: number) => {
    const gap = Math.max(8, sw * 4);
    const key = `${style}|${color}|${n(gap)}`;
    const known = patterns.get(key);
    if (known) return known;
    const id = `${prefix}f${patterns.size}`;
    patterns.set(key, id);
    defs.push(patternMarkup(id, style, color, gap));
    return id;
  };
  const fillOf = (el: DrawingElement) => {
    const bg = drawingColor(el.backgroundColor, dark);
    if (!bg || bg === "transparent" || bg === "none") return "none";
    if (el.fillStyle === "solid") return esc(bg);
    return `url(#${hatch(el.fillStyle, bg, el.strokeWidth)})`;
  };
  const strokeOf = (el: DrawingElement) => esc(drawingColor(el.strokeColor, dark));
  const clip = (x: number, y: number, w: number, h: number) => {
    const id = `${prefix}c${clips++}`;
    defs.push(`<clipPath id="${id}"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/></clipPath>`);
    return id;
  };

  for (const el of scene.elements) {
    if (el.isDeleted) continue;
    bounds = union(bounds, paddedBox(el));
    const markup = renderElement(el, dark, fillOf, strokeOf, clip, opts.images);
    if (!markup) continue;
    if (el.type === "frame" || el.type === "magicframe") frames.push(markup);
    else rest.push(markup);
  }
  const box = bounds ?? { x: 0, y: 0, width: 240, height: 160 };
  const viewBox = { x: box.x - PAD, y: box.y - PAD, width: Math.max(1, box.width + PAD * 2), height: Math.max(1, box.height + PAD * 2) };
  const background = drawingColor(scene.appState.viewBackgroundColor, dark);
  const parts = frames.concat(rest);
  const chunks: string[] = [];
  for (let i = 0; i < parts.length; i += CHUNK) chunks.push(parts.slice(i, i + CHUNK).join(""));
  const open = svgOpen(viewBox, opts);
  const head = `${open}${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${opts.paper === false ? "" : paperRect(viewBox, background)}`;
  const shell = `${head}</svg>`;
  const markup = opts.omitMarkup ? "" : `${head}${parts.join("")}</svg>`;
  return { markup, chunks, shell, background, grid: scene.appState.gridSize, bounds: box, viewBox };
}

function renderElement(
  el: DrawingElement,
  dark: boolean,
  fillOf: (el: DrawingElement) => string,
  strokeOf: (el: DrawingElement) => string,
  clip: (x: number, y: number, w: number, h: number) => string,
  images: RenderOptions["images"],
): string | null {
  switch (el.type) {
    case "rectangle":
    case "diamond":
    case "ellipse":
      return renderShape(el as ShapeElement, fillOf, strokeOf);
    case "line":
    case "arrow":
      return renderLinear(el as LinearElement, strokeOf);
    case "freedraw":
      return renderFreedraw(el as FreedrawElement, strokeOf);
    case "text":
      return renderText(el as TextElement, dark);
    case "image":
      return renderImage(el as ImageElement, clip, images, strokeOf(el), dark);
    case "frame":
    case "magicframe":
      return renderFrame(el as FrameElement, strokeOf);
    default:
      return labelled(el, el.type || "drawing", strokeOf(el));
  }
}

function renderShape(el: ShapeElement, fillOf: (el: DrawingElement) => string, strokeOf: (el: DrawingElement) => string): string {
  const paint = `${mark(el)} fill="${fillOf(el)}" stroke="${strokeOf(el)}" stroke-width="${n(el.strokeWidth)}"${dashAttr(el)}${tail(el)}`;
  if (el.type === "ellipse") {
    return `<ellipse ${paint} cx="${n(el.x + el.width / 2)}" cy="${n(el.y + el.height / 2)}" rx="${n(Math.abs(el.width) / 2)}" ry="${n(Math.abs(el.height) / 2)}"/>`;
  }
  if (el.type === "diamond") return `<path ${paint} d="${diamondPath(el)}"/>`;
  const radius = rectRadius(el.width, el.height, el.roundness);
  const rounded = radius > 0 ? ` rx="${n(radius)}" ry="${n(radius)}"` : "";
  return `<rect ${paint} x="${n(el.x)}" y="${n(el.y)}" width="${n(Math.abs(el.width))}" height="${n(Math.abs(el.height))}"${rounded}/>`;
}

function renderLinear(el: LinearElement, strokeOf: (el: DrawingElement) => string): string | null {
  if (el.points.length < 2) return null;
  const pts = placed(el);
  const color = strokeOf(el);
  const size = 6 + el.strokeWidth * 3;
  const startCut = insetFor(el.startArrowhead, size);
  const endCut = insetFor(el.endArrowhead, size);
  const shaft = shorten(pts, startCut, endCut);
  const smooth = !!el.roundness && !el.elbowed && shaft.length >= 3;
  const d = smooth ? smoothPath(shaft) : linePath(shaft);
  const stroke = `stroke="${color}" stroke-width="${n(el.strokeWidth)}" fill="none"${dashAttr(el)}`;
  const heads = [
    el.startArrowhead ? arrowHead(el.startArrowhead, pts[0], dir(pts[1], pts[0]), size, color, el.strokeWidth, "start") : "",
    el.endArrowhead ? arrowHead(el.endArrowhead, pts[pts.length - 1], dir(pts[pts.length - 2], pts[pts.length - 1]), size, color, el.strokeWidth, "end") : "",
  ].join("");
  if (!heads) return `<path ${mark(el)} ${stroke} d="${d}"${tail(el)}/>`;
  return `<g ${mark(el)}${tail(el)}><path data-part="shaft" ${stroke} d="${d}"/>${heads}</g>`;
}

function renderFreedraw(el: DrawingElement & { type: "freedraw"; points: Point[] }, strokeOf: (el: DrawingElement) => string): string | null {
  const pts = placed(el);
  const color = strokeOf(el);
  const stroke = `stroke="${color}" stroke-width="${n(el.strokeWidth)}" fill="none"${dashAttr(el)}`;
  if (pts.length === 1) {
    return `<circle ${mark(el)} ${stroke} cx="${n(pts[0][0])}" cy="${n(pts[0][1])}" r="${n(Math.max(1.5, el.strokeWidth))}"${tail(el)}/>`;
  }
  if (pts.length < 2) return null;
  // One width for the whole stroke. Pressures stay in the file.
  return `<path ${mark(el)} ${stroke} d="${smoothPath(pts)}"${tail(el)}/>`;
}

function renderText(el: TextElement, dark: boolean): string | null {
  if (!el.text) return null;
  const lines = el.text.split(/\r?\n/);
  const lineH = el.fontSize * (el.lineHeight > 0 ? el.lineHeight : 1.25);
  const block = lines.length * lineH;
  const top = el.verticalAlign === "middle" ? el.y + (el.height - block) / 2 : el.verticalAlign === "bottom" ? el.y + el.height - block : el.y;
  const anchor = el.textAlign === "center" ? "middle" : el.textAlign === "right" ? "end" : "start";
  const x = el.textAlign === "center" ? el.x + el.width / 2 : el.textAlign === "right" ? el.x + el.width : el.x;
  const tspans = lines.map((line, i) => i === 0
    ? `<tspan x="${n(x)}" y="${n(top)}">${escText(line)}</tspan>`
    : `<tspan x="${n(x)}" dy="${n(lineH)}">${escText(line)}</tspan>`).join("");
  const family = el.fontFamily === 1 ? "cursive" : el.fontFamily === 3 ? "ui-monospace, 'JetBrains Mono', monospace" : "sans-serif";
  return `<text ${mark(el)} fill="${esc(drawingColor(el.strokeColor, dark))}" stroke="none" font-size="${n(el.fontSize)}" font-family="${family}" text-anchor="${anchor}" dominant-baseline="text-before-edge" xml:space="preserve"${tail(el)}>${tspans}</text>`;
}

function renderImage(el: ImageElement, clip: (x: number, y: number, w: number, h: number) => string, images: RenderOptions["images"], color: string, dark: boolean): string {
  const href = el.fileId ? images?.(el.fileId) : undefined;
  if (!href) return labelled(el, "image", color && color !== "transparent" && color !== "none" ? color : (dark ? "#d0d0d0" : "#1e1e1e"));
  const crop = readCrop(el.crop);
  let x = el.x, y = el.y, w = el.width, h = el.height, clipped = "";
  if (crop && w > 0 && h > 0) {
    w = el.width / crop.w;
    h = el.height / crop.h;
    x = el.x - crop.x * w;
    y = el.y - crop.y * h;
    clipped = ` clip-path="url(#${clip(el.x, el.y, el.width, el.height)})"`;
  }
  let flip = "";
  if (el.scale[0] !== 1 || el.scale[1] !== 1) {
    const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
    flip = `translate(${n(cx)} ${n(cy)}) scale(${n(el.scale[0])} ${n(el.scale[1])}) translate(${n(-cx)} ${n(-cy)})`;
  }
  return `<image ${mark(el)} href="${esc(href)}" x="${n(x)}" y="${n(y)}" width="${n(Math.abs(w))}" height="${n(Math.abs(h))}" preserveAspectRatio="none"${clipped}${tail(el, flip)}/>`;
}

function renderFrame(el: FrameElement, strokeOf: (el: DrawingElement) => string): string {
  const color = strokeOf(el);
  const name = el.name
    ? `<text data-part="name" x="${n(el.x)}" y="${n(el.y - 16)}" fill="${color}" stroke="none" font-size="14" font-family="sans-serif" dominant-baseline="text-before-edge">${escText(el.name)}</text>`
    : "";
  return `<g ${mark(el)}${tail(el)}><rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.width)}" height="${n(el.height)}" fill="none" stroke="${color}" stroke-width="${n(el.strokeWidth)}"${dashAttr(el)}/>${name}</g>`;
}

function labelled(el: DrawingElement, label: string, color: string): string {
  const box = layoutBox(el);
  const sw = el.strokeWidth > 0 ? el.strokeWidth : 1;
  return `<g ${mark(el)}${tail(el)}><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" fill="none" stroke="${color}" stroke-width="${n(sw)}" stroke-dasharray="${n(sw * 3)} ${n(sw * 2)}"/><text x="${n(box.x + 8)}" y="${n(box.y + 8)}" fill="${color}" stroke="none" font-size="14" font-family="sans-serif" dominant-baseline="text-before-edge">${escText(label)}</text></g>`;
}

function rectRadius(w: number, h: number, roundness: ShapeElement["roundness"]): number {
  if (!roundness) return 0;
  const cap = Math.min(Math.abs(w), Math.abs(h)) / 2;
  if (roundness.value !== undefined && roundness.value > 0) return Math.min(roundness.value, cap);
  return Math.min(32, Math.min(Math.abs(w), Math.abs(h)) / 4, cap);
}

function diamondPath(el: ShapeElement): string {
  const x = el.x, y = el.y, w = el.width, h = el.height;
  const verts: Point[] = [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];
  if (!el.roundness) return linePath(verts, true);
  const edge = Math.hypot(w / 2, h / 2);
  const cut = Math.min(Math.min(Math.abs(w), Math.abs(h)) * 0.18, edge * 0.45);
  const along = (i: number, toward: number): Point => {
    const a = verts[i], b = verts[toward];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.min(Math.max(cut, 0), len * 0.45) / len;
    return [a[0] + dx * t, a[1] + dy * t];
  };
  let d = `M${n(along(0, 1)[0])} ${n(along(0, 1)[1])}`;
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    const arrive = along(next, i);
    const leave = along(next, (next + 1) % 4);
    d += ` L${n(arrive[0])} ${n(arrive[1])} Q${n(verts[next][0])} ${n(verts[next][1])} ${n(leave[0])} ${n(leave[1])}`;
  }
  return d + " Z";
}

function smoothPath(pts: Point[]): string {
  if (pts.length < 2) return "";
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  if (pts.length === 2) return `${d} L${n(pts[1][0])} ${n(pts[1][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
}

function linePath(pts: Point[], close = false): string {
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += ` L${n(pts[i][0])} ${n(pts[i][1])}`;
  return close ? d + " Z" : d;
}

function arrowHead(kind: string, tip: Point, direction: Point, size: number, color: string, sw: number, part: "start" | "end"): string {
  const [ux, uy] = unit(direction[0], direction[1]);
  const px = -uy, py = ux;
  const name = kind.toLowerCase();
  const outline = name.endsWith("_outline");
  const base = outline ? name.slice(0, -"_outline".length) : name;
  if (base === "bar") {
    const half = size * 0.45;
    return `<line data-part="${part}" fill="none" stroke="${color}" stroke-width="${n(sw)}" x1="${n(tip[0] - px * half)}" y1="${n(tip[1] - py * half)}" x2="${n(tip[0] + px * half)}" y2="${n(tip[1] + py * half)}"/>`;
  }
  const paint = outline ? `fill="none" stroke="${color}" stroke-width="${n(sw)}"` : `fill="${color}" stroke="${color}" stroke-width="1"`;
  const at = `data-part="${part}" ${paint}`;
  if (base === "dot" || base === "circle") {
    return `<circle ${at} cx="${n(tip[0])}" cy="${n(tip[1])}" r="${n(size * (base === "dot" ? 0.28 : 0.36))}"/>`;
  }
  if (base === "diamond") {
    const back: Point = [tip[0] - ux * size, tip[1] - uy * size];
    const mid: Point = [tip[0] - ux * size / 2, tip[1] - uy * size / 2];
    const a: Point = [mid[0] + px * size * 0.45, mid[1] + py * size * 0.45];
    const b: Point = [mid[0] - px * size * 0.45, mid[1] - py * size * 0.45];
    return `<path ${at} d="M${n(tip[0])} ${n(tip[1])} L${n(a[0])} ${n(a[1])} L${n(back[0])} ${n(back[1])} L${n(b[0])} ${n(b[1])} Z"/>`;
  }
  const back: Point = [tip[0] - ux * size, tip[1] - uy * size];
  const a: Point = [back[0] + px * size * 0.42, back[1] + py * size * 0.42];
  const b: Point = [back[0] - px * size * 0.42, back[1] - py * size * 0.42];
  if (base === "arrow") {
    return `<path data-part="${part}" fill="none" stroke="${color}" stroke-width="${n(sw)}" d="M${n(a[0])} ${n(a[1])} L${n(tip[0])} ${n(tip[1])} L${n(b[0])} ${n(b[1])}"/>`;
  }
  return `<path ${at} d="M${n(tip[0])} ${n(tip[1])} L${n(a[0])} ${n(a[1])} L${n(b[0])} ${n(b[1])} Z"/>`;
}

function insetFor(kind: string | null, size: number): number {
  if (!kind) return 0;
  const name = kind.toLowerCase().replace(/_outline$/, "");
  if (name === "bar" || name === "arrow") return 0;
  if (name === "dot") return size * 0.28;
  if (name === "circle") return size * 0.36;
  if (name === "diamond") return size;
  return size * 0.85;
}

function shorten(pts: Point[], startCut: number, endCut: number): Point[] {
  const out = pts.map((p) => [p[0], p[1]] as Point);
  if (out.length < 2) return out;
  if (startCut > 0) out[0] = cutPoint(out[0], out[1], startCut);
  if (endCut > 0) out[out.length - 1] = cutPoint(out[out.length - 1], out[out.length - 2], endCut);
  return out;
}

function cutPoint(from: Point, toward: Point, dist: number): Point {
  const dx = toward[0] - from[0], dy = toward[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.min(Math.max(dist, 0), len * 0.45) / len;
  return [from[0] + dx * t, from[1] + dy * t];
}

function patternMarkup(id: string, style: FillStyle, color: string, gap: number): string {
  const g = n(gap);
  const stroke = `stroke="${esc(color)}" stroke-width="1" fill="none"`;
  const hachure = `M-1 1 L1 -1 M0 ${g} L${g} 0 M${n(gap - 1)} ${n(gap + 1)} L${n(gap + 1)} ${n(gap - 1)}`;
  const cross = `M-1 ${n(gap - 1)} L1 ${n(gap + 1)} M0 0 L${g} ${g} M${n(gap - 1)} -1 L${n(gap + 1)} 1`;
  const d = style === "cross-hatch" ? `${hachure} ${cross}` : style === "zigzag"
    ? `M0 ${n(gap * 0.65)} L${n(gap * 0.25)} ${n(gap * 0.35)} L${n(gap * 0.5)} ${n(gap * 0.65)} L${n(gap * 0.75)} ${n(gap * 0.35)} L${g} ${n(gap * 0.65)}`
    : hachure;
  return `<pattern id="${id}" width="${g}" height="${g}" patternUnits="userSpaceOnUse"><path ${stroke} d="${d}"/></pattern>`;
}

function dashAttr(el: DrawingElement): string {
  return dashOf(el.strokeStyle, el.strokeWidth);
}

function dashOf(style: StrokeStyle, sw: number): string {
  if (style === "dashed") return ` stroke-dasharray="${n(sw * 3)} ${n(sw * 2)}"`;
  if (style === "dotted") return ` stroke-dasharray="${n(Math.max(sw, 0.8))} ${n(sw * 1.75)}"`;
  return "";
}

function layoutBox(el: DrawingElement): { x: number; y: number; w: number; h: number } {
  let x = el.x, y = el.y, w = el.width, h = el.height;
  if (!el.known) {
    if (w <= 0) w = 160;
    if (h <= 0) h = 80;
  }
  if (el.type === "text") {
    const text = el as TextElement;
    const lines = text.text.split(/\r?\n/).length || 1;
    const block = lines * text.fontSize * (text.lineHeight > 0 ? text.lineHeight : 1.25);
    if (block > h) {
      const extra = block - h;
      if (text.verticalAlign === "middle") { y -= extra / 2; h += extra; }
      else if (text.verticalAlign === "bottom") { y -= extra; h += extra; }
      else h += extra;
    }
  }
  if ((el.type === "frame" || el.type === "magicframe") && (el as FrameElement).name) { y -= 18; h += 18; }
  return { x, y, w: Math.abs(w), h: Math.abs(h) };
}

function paddedBox(el: DrawingElement): Bounds {
  const b = layoutBox(el);
  const aabb = rotatedAabb(b.x, b.y, b.w, b.h, el.angle);
  const pad = Math.max(el.strokeWidth, 1) / 2 + (el.type === "arrow" || el.type === "line" || el.type === "freedraw" ? 8 : 2);
  return { x: aabb.x - pad, y: aabb.y - pad, width: aabb.width + pad * 2, height: aabb.height + pad * 2 };
}

function rotatedAabb(x: number, y: number, w: number, h: number, angle: number): Bounds {
  if (!angle) return { x, y, width: w, height: h };
  const cx = x + w / 2, cy = y + h / 2;
  const c = Math.cos(angle), s = Math.sin(angle);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) {
    const dx = px - cx, dy = py - cy;
    const rx = cx + dx * c - dy * s, ry = cy + dx * s + dy * c;
    minX = Math.min(minX, rx); minY = Math.min(minY, ry);
    maxX = Math.max(maxX, rx); maxY = Math.max(maxY, ry);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function union(a: Bounds | null, b: Bounds): Bounds {
  if (!a) return b;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

function placed(el: { x: number; y: number; points: Point[] }): Point[] {
  return el.points.map((p) => [el.x + p[0], el.y + p[1]]);
}

function dir(from: Point, to: Point): Point {
  return [to[0] - from[0], to[1] - from[1]];
}

function unit(dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

function readCrop(crop: ImageElement["crop"]): { x: number; y: number; w: number; h: number } | null {
  if (!crop) return null;
  const vals = [crop.x, crop.y, crop.width, crop.height];
  if (!vals.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) return null;
  const [x, y, w, h] = vals as number[];
  if (w <= 0 || h <= 0 || (x === 0 && y === 0 && w === 1 && h === 1)) return null;
  return { x, y, w, h };
}

function mark(el: DrawingElement): string {
  return `data-id="${esc(el.id)}" data-type="${esc(el.type)}"`;
}

function tail(el: DrawingElement, extra = ""): string {
  const opacity = el.opacity < 100 ? ` opacity="${n(el.opacity / 100)}"` : "";
  return `${opacity}${transformAttr(el, extra)}`;
}

function transformAttr(el: DrawingElement, extra: string): string {
  const parts: string[] = [];
  if (el.angle) {
    const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
    parts.push(`rotate(${n((el.angle * 180) / Math.PI)} ${n(cx)} ${n(cy)})`);
  }
  if (extra) parts.push(extra);
  return parts.length ? ` transform="${parts.join(" ")}"` : "";
}

function svgOpen(viewBox: Bounds, opts: RenderOptions): string {
  const flex = opts.flexHeight === true && opts.width == null && opts.height == null;
  let w = opts.width ?? viewBox.width;
  let h = opts.height ?? viewBox.height;
  if (opts.width != null && opts.height == null) h = w * (viewBox.height / viewBox.width);
  else if (opts.height != null && opts.width == null) w = h * (viewBox.width / viewBox.height);
  const size = flex ? ` width="${n(viewBox.width)}"` : ` width="${n(w)}" height="${n(h)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(viewBox.x)} ${n(viewBox.y)} ${n(viewBox.width)} ${n(viewBox.height)}"${size} fill="none" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision" text-rendering="geometricPrecision">`;
}

function paperRect(viewBox: Bounds, color: string): string {
  return `<rect data-part="paper" x="${n(viewBox.x)}" y="${n(viewBox.y)}" width="${n(viewBox.width)}" height="${n(viewBox.height)}" fill="${esc(color)}" stroke="none"/>`;
}

function n(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const rounded = Math.round(v * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function hexByte(v: number): string {
  return Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
}

function parseHex(color: string): { r: number; g: number; b: number; a: number } | null {
  const match = /^#([0-9a-f]{3,8})$/i.exec(color);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((ch) => ch + ch).join("");
  if (hex.length !== 6 && hex.length !== 8) return null;
  const value = parseInt(hex.slice(0, 6), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255, a: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 };
}

function objectUrl(dataURL: string, mimeType: string): string | undefined {
  try {
    const comma = dataURL.indexOf(",");
    if (!dataURL.startsWith("data:") || comma < 0) return;
    const meta = dataURL.slice(5, comma);
    const body = dataURL.slice(comma + 1);
    const mime = mimeType || meta.split(";")[0] || "application/octet-stream";
    let blob: Blob;
    if (/;base64/i.test(meta)) {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 255;
      blob = new Blob([bytes], { type: mime });
    } else blob = new Blob([decodeURIComponent(body)], { type: mime });
    return URL.createObjectURL(blob);
  } catch {
    return;
  }
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
