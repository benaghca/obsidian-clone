/* Cinder drawings: the scene model, the hand-drawn renderer, hit testing, SVG
 * export and file formats. Scenes use Excalidraw's own element schema, so
 * `.excalidraw` files open in excalidraw.com, and `.excalidraw.md` files are
 * read and written in the layout used by Obsidian's Excalidraw plugin.
 * No DOM access at load time, so the pure parts can be tested under Node.
 *
 * roughLine/roughEllipsePath are adapted from rough.js (Copyright (c) 2019 Preet Shihn) and
 * lzDecompress from lz-string (Copyright (c) 2013 pieroxy), both under the MIT License:
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions: The above copyright notice and this
 * permission notice shall be included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. See ui/vendor/draw-ports.LICENSE. */
'use strict';

(function (root) {
  // ============================================================ ids & randomness

  const randomInt = () => Math.floor(Math.random() * 2 ** 31);
  const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  // 8 alphanumeric characters, like the Obsidian Excalidraw plugin's ids: they double as
  // block refs (^id) in .excalidraw.md files, and the plugin re-ids anything longer.
  function randomId(n = 8) { let s = ''; for (let i = 0; i < n; i++) s += ID_CHARS[Math.floor(Math.random() * 62)]; return s; }

  // The same generator rough.js uses, so a seed always gives the same wobble.
  function rng(seed) {
    let s = seed || 1;
    return () => { s = Math.imul(48271, s); return ((2 ** 31 - 1) & s) / 2 ** 31; };
  }

  // ============================================================ elements

  const COLORS = {
    stroke: ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00'],
    bg: ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99'],
  };

  function newElement(type, props = {}) {
    const el = {
      id: randomId(), type, x: 0, y: 0, width: 0, height: 0, angle: 0,
      strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2,
      strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null,
      seed: randomInt(), version: 1, versionNonce: randomInt(), isDeleted: false, boundElements: null,
      updated: Date.now(), link: null, locked: false,
    };
    if (type === 'text') Object.assign(el, { text: '', fontSize: 20, fontFamily: 1, textAlign: 'left', verticalAlign: 'top', containerId: null, originalText: '', autoResize: true, lineHeight: 1.25 });
    if (type === 'line' || type === 'arrow') Object.assign(el, { points: [[0, 0]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: type === 'arrow' ? 'arrow' : null });
    if (type === 'arrow') el.elbowed = false;
    if (type === 'freedraw') Object.assign(el, { points: [[0, 0]], pressures: [], simulatePressure: true, lastCommittedPoint: null });
    if (type === 'image') Object.assign(el, { fileId: null, status: 'saved', scale: [1, 1], crop: null });
    if (type === 'frame') el.name = null;
    return Object.assign(el, props);
  }

  // Every change goes through here so render caches (keyed on version) stay correct.
  function mutate(el, props) {
    if (props) Object.assign(el, props);
    el.version = (el.version || 0) + 1;
    el.versionNonce = randomInt();
    el.updated = Date.now();
    return el;
  }

  const isLinear = el => el.type === 'line' || el.type === 'arrow';
  const hasPoints = el => isLinear(el) || el.type === 'freedraw';
  const isShape = el => el.type === 'rectangle' || el.type === 'diamond' || el.type === 'ellipse';
  const canContainText = el => isShape(el) || el.type === 'arrow';
  const isBindable = el => isShape(el) || el.type === 'text' && !el.containerId || el.type === 'image' || el.type === 'frame';
  const isTransparent = c => !c || c === 'transparent' || /^#[0-9a-f]{6}00$/i.test(c) || /^#[0-9a-f]{3}0$/i.test(c);

  // ============================================================ geometry

  function rotate(x, y, cx, cy, a) {
    if (!a) return [x, y];
    const c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function pointsBox(pts) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [x, y] of pts) { if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y; }
    if (x1 === Infinity) return { x1: 0, y1: 0, x2: 0, y2: 0 };
    return { x1, y1, x2, y2 };
  }

  // The unrotated box of an element in scene coordinates plus its rotation centre.
  // Like Excalidraw, linear elements rotate about the centre of their points' box.
  function absBox(el) {
    let x1, y1, x2, y2;
    if (hasPoints(el) && el.points && el.points.length) {
      const b = pointsBox(curvePoints(el));
      x1 = el.x + b.x1; y1 = el.y + b.y1; x2 = el.x + b.x2; y2 = el.y + b.y2;
    } else {
      x1 = Math.min(el.x, el.x + el.width); x2 = Math.max(el.x, el.x + el.width);
      y1 = Math.min(el.y, el.y + el.height); y2 = Math.max(el.y, el.y + el.height);
    }
    return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
  }

  // Axis-aligned bounds of the element as drawn (rotation included).
  function bounds(el) {
    const b = absBox(el);
    const pad = el.type === 'freedraw' ? el.strokeWidth * 1.5 : 0;
    if (!el.angle) return [b.x1 - pad, b.y1 - pad, b.x2 + pad, b.y2 + pad];
    let pts;
    if (hasPoints(el)) pts = curvePoints(el).map(([x, y]) => rotate(el.x + x, el.y + y, b.cx, b.cy, el.angle));
    else if (el.type === 'ellipse') {
      const rx = (b.x2 - b.x1) / 2, ry = (b.y2 - b.y1) / 2, c = Math.cos(el.angle), s = Math.sin(el.angle);
      const hw = Math.hypot(rx * c, ry * s), hh = Math.hypot(rx * s, ry * c);
      return [b.cx - hw, b.cy - hh, b.cx + hw, b.cy + hh];
    } else pts = [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]].map(([x, y]) => rotate(x, y, b.cx, b.cy, el.angle));
    const r = pointsBox(pts);
    return [r.x1 - pad, r.y1 - pad, r.x2 + pad, r.y2 + pad];
  }

  function commonBounds(els) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const el of els) {
      const [a, b, c, d] = bounds(el);
      if (a < x1) x1 = a; if (b < y1) y1 = b; if (c > x2) x2 = c; if (d > y2) y2 = d;
    }
    return x1 === Infinity ? null : [x1, y1, x2, y2];
  }

  // Scene-space points of a linear/freedraw element, rotation applied.
  function absPoints(el) {
    const b = absBox(el);
    return el.points.map(([x, y]) => rotate(el.x + x, el.y + y, b.cx, b.cy, el.angle));
  }

  // Set a linear element from scene-space points (clears rotation, which the points absorb).
  function setAbsPoints(el, pts, extra) {
    const [x0, y0] = pts[0];
    const points = pts.map(([x, y]) => [x - x0, y - y0]);
    const b = pointsBox(points);
    mutate(el, { x: x0, y: y0, points, angle: 0, width: b.x2 - b.x1, height: b.y2 - b.y1, ...extra });
  }

  function syncPointsSize(el) {
    const b = pointsBox(el.points);
    el.width = b.x2 - b.x1; el.height = b.y2 - b.y1;
  }

  // Catmull-Rom spline through points -> cubic Bézier segments [p0, c1, c2, p1].
  function catmull(pts, closed = false) {
    const n = pts.length, segs = [];
    const at = i => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      segs.push([p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2]);
    }
    return segs;
  }
  function bezierAt([p0, c1, c2, p1], t) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]];
  }
  const isCurved = el => isLinear(el) && !!el.roundness && el.points.length > 2 && !el.elbowed;

  // Local points of the element's centre line (curves sampled), used for bounds and hit tests.
  function curvePoints(el) {
    if (!isCurved(el)) return el.points;
    const out = [el.points[0]];
    for (const seg of catmull(el.points)) for (let i = 1; i <= 10; i++) out.push(bezierAt(/** @type {any} */ (seg), i / 10));
    return out;
  }

  function polylineLength(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]); return l; }
  function pointAlong(pts, frac) {
    const total = polylineLength(pts);
    let want = total * frac;
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i - 1], pts[i]);
      if (want <= d && d > 0) { const t = want / d; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; }
      want -= d;
    }
    return pts[pts.length - 1] || [0, 0];
  }
  // Scene-space midpoint of an arrow, where its label sits.
  function linearMidpoint(el) {
    const [x, y] = pointAlong(curvePoints(el), 0.5);
    const b = absBox(el);
    return rotate(el.x + x, el.y + y, b.cx, b.cy, el.angle);
  }

  function distToSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  function distToPolyline(p, pts, closed = false) {
    let d = pts.length === 1 ? dist(p, pts[0]) : Infinity;
    for (let i = 1; i < pts.length; i++) d = Math.min(d, distToSegment(p, pts[i - 1], pts[i]));
    if (closed && pts.length > 2) d = Math.min(d, distToSegment(p, pts[pts.length - 1], pts[0]));
    return d;
  }
  function insidePolygon(p, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  const diamondPoints = (w, h) => [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];

  // Scene point -> the element's local, unrotated frame (origin at el.x, el.y).
  function toLocal(el, x, y) {
    const b = absBox(el);
    const [ux, uy] = rotate(x, y, b.cx, b.cy, -(el.angle || 0));
    return [ux - el.x, uy - el.y];
  }

  // Does scene point (x, y) touch the element? `tol` is in scene units.
  // Unfilled shapes only count near their outline, like Excalidraw.
  function hitTest(el, x, y, tol, { inside = false } = {}) {
    const [lx, ly] = toLocal(el, x, y);
    const p = [lx, ly];
    const w = el.width, h = el.height;
    const filled = inside || !isTransparent(el.backgroundColor);
    const inBox = lx >= Math.min(0, w) - tol && lx <= Math.max(0, w) + tol && ly >= Math.min(0, h) - tol && ly <= Math.max(0, h) + tol;
    switch (el.type) {
      case 'rectangle': case 'frame': case 'embeddable': case 'iframe': case 'magicframe': {
        if (!inBox) return false;
        if (filled && el.type === 'rectangle') return true;
        const box = [[0, 0], [w, 0], [w, h], [0, h]];
        if (el.type !== 'rectangle' && ly <= 0 && ly >= -20 - tol && lx >= 0 && lx <= Math.min(Math.abs(w), 200)) return true; // name label
        return distToPolyline(p, box, true) <= tol + el.strokeWidth / 2;
      }
      case 'diamond': {
        if (!inBox) return false;
        const pts = diamondPoints(w, h);
        return (filled && insidePolygon(p, pts)) || distToPolyline(p, pts, true) <= tol + el.strokeWidth / 2;
      }
      case 'ellipse': {
        const rx = Math.abs(w) / 2, ry = Math.abs(h) / 2;
        if (!rx || !ry) return dist(p, [w / 2, h / 2]) <= tol;
        const nx = (lx - w / 2) / rx, ny = (ly - h / 2) / ry, r = Math.hypot(nx, ny);
        if (filled && r <= 1) return true;
        return Math.abs(r - 1) * Math.min(rx, ry) <= tol + el.strokeWidth / 2;
      }
      case 'line': case 'arrow': case 'freedraw': {
        const pts = curvePoints(el);
        const closed = el.type !== 'arrow' && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 8;
        if (closed && !isTransparent(el.backgroundColor) && insidePolygon(p, pts)) return true;
        const extra = el.type === 'freedraw' ? el.strokeWidth * 1.2 : el.strokeWidth / 2;
        return distToPolyline(p, pts) <= tol + extra;
      }
      default: // text, image and anything unknown: the box
        return inBox;
    }
  }

  // Where a ray from scene point `from` towards the element's centre crosses its outline,
  // pushed `gap` back out. Used to attach arrow ends to shapes.
  function outlinePoint(el, from, gap = 4) {
    const b = absBox(el);
    const [qx, qy] = rotate(from[0], from[1], b.cx, b.cy, -(el.angle || 0));
    const dx = b.cx - qx, dy = b.cy - qy, len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    const hw = (b.x2 - b.x1) / 2, hh = (b.y2 - b.y1) / 2;
    let t = null; // parameter along from->centre where the outline is hit
    if (el.type === 'ellipse') {
      // solve ((ox + t dx)/rx)^2 + ((oy + t dy)/ry)^2 = 1, with o relative to the centre
      const ox = qx - b.cx, oy = qy - b.cy, rx = hw || 1, ry = hh || 1;
      const A = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      const B = 2 * ((ox * dx) / (rx * rx) + (oy * dy) / (ry * ry));
      const C = (ox * ox) / (rx * rx) + (oy * oy) / (ry * ry) - 1;
      const disc = B * B - 4 * A * C;
      if (disc >= 0) t = (-B - Math.sqrt(disc)) / (2 * A);
    } else {
      const poly = el.type === 'diamond'
        ? [[b.cx, b.y1], [b.x2, b.cy], [b.cx, b.y2], [b.x1, b.cy]]
        : [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]];
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
        const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const tt = ((ax - qx) * ey - (ay - qy) * ex) / den;
        const u = ((ax - qx) * dy - (ay - qy) * dx) / den;
        if (u >= 0 && u <= 1 && (t == null || tt < t)) t = tt;
      }
    }
    if (t == null || t < 0 || t > 1) return null; // `from` is inside the shape
    const hx = qx + dx * t - dx / len * gap, hy = qy + dy * t - dy / len * gap;
    return rotate(hx, hy, b.cx, b.cy, el.angle || 0);
  }

  // ============================================================ text

  // Each ends with the Nerd Fonts symbols so icon glyphs render in drawings too.
  const NERD = ', "Symbols Nerd Font Mono"';
  const FONTS = {
    1: 'Virgil, "Segoe Print", "Comic Sans MS", cursive' + NERD,
    2: 'Helvetica, Arial, "Segoe UI", sans-serif' + NERD,
    3: '"Cascadia Code", Cascadia, "JetBrains Mono", Consolas, "Courier New", monospace' + NERD,
    5: 'Excalifont, Virgil, "Segoe Print", "Comic Sans MS", cursive' + NERD,
    6: 'Nunito, "Segoe UI", Helvetica, Arial, sans-serif' + NERD,
    7: '"Lilita One", Impact, sans-serif' + NERD,
    8: '"Comic Shanns", "Cascadia Code", Consolas, monospace' + NERD,
  };
  const fontCss = f => FONTS[f] || FONTS[1];
  const fontString = el => `${el.fontSize}px ${fontCss(el.fontFamily)}`;
  const lineHeightOf = el => el.lineHeight || 1.25;

  let measureCtx = null;
  function textWidth(line, font) {
    if (measureCtx === null) {
      try {
        // A document canvas, so web fonts loaded by the page (Virgil) are measured correctly.
        measureCtx = (typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1)).getContext('2d');
      } catch { measureCtx = false; }
    }
    if (!measureCtx) return line.length * (parseFloat(font) || 20) * 0.55; // no canvas (tests)
    measureCtx.font = font;
    return measureCtx.measureText(line).width;
  }

  function measureText(text, font, lineHeight) {
    const lines = text.split('\n');
    let w = 0;
    for (const l of lines) w = Math.max(w, textWidth(l, font));
    return { width: w, height: lines.length * (parseFloat(font) || 20) * lineHeight };
  }

  function wrapText(text, font, maxWidth) {
    if (!(maxWidth > 0)) return text;
    const out = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const w of para.split(/(\s+)/)) {
        if (!w) continue;
        if (textWidth(line + w, font) <= maxWidth) { line += w; continue; }
        if (/^\s+$/.test(w)) { out.push(line); line = ''; continue; }
        if (line.trim()) out.push(line.trimEnd());
        line = '';
        if (textWidth(w, font) <= maxWidth) { line = w; continue; }
        for (const ch of w) { // a word wider than the box: break it
          if (line && textWidth(line + ch, font) > maxWidth) { out.push(line); line = ''; }
          line += ch;
        }
      }
      out.push(line.trimEnd());
    }
    return out.join('\n');
  }

  // Re-measure a free-standing text element, keeping its alignment anchor in place.
  function refreshText(el) {
    const m = measureText(el.text, fontString(el), lineHeightOf(el));
    let x = el.x;
    if (el.textAlign === 'center') x = el.x + (el.width - m.width) / 2;
    else if (el.textAlign === 'right') x = el.x + el.width - m.width;
    mutate(el, { x, width: m.width, height: m.height });
  }

  const BOUND_PAD = 5;
  function boundTextMaxWidth(c) {
    const w = Math.abs(c.width);
    if (c.type === 'ellipse') return Math.round(w / 2 * Math.SQRT2) - BOUND_PAD * 2;
    if (c.type === 'diamond') return Math.round(w / 2) - BOUND_PAD * 2;
    if (c.type === 'arrow') return Math.max(220, w * 0.7);
    return w - BOUND_PAD * 2;
  }
  // How much height the inner text box of a container has.
  function innerHeight(c) {
    const h = Math.abs(c.height);
    if (c.type === 'ellipse') return h / 2 * Math.SQRT2 - BOUND_PAD * 2;
    if (c.type === 'diamond') return h / 2 - BOUND_PAD * 2;
    return h - BOUND_PAD * 2;
  }

  // Wrap and position a container's label; grows the container if the text doesn't fit.
  function layoutBoundText(text, container) {
    const font = fontString(text), lh = lineHeightOf(text);
    const maxW = Math.max(text.fontSize, boundTextMaxWidth(container));
    const wrapped = wrapText(text.originalText ?? text.text, font, maxW);
    const m = measureText(wrapped, font, lh);
    if (isLinear(container)) {
      const [mx, my] = linearMidpoint(container);
      mutate(text, { text: wrapped, width: m.width, height: m.height, x: mx - m.width / 2, y: my - m.height / 2, angle: 0 });
      return;
    }
    const need = m.height + BOUND_PAD * 2;
    if (innerHeight(container) + BOUND_PAD * 2 < need) {
      const factor = container.type === 'ellipse' ? Math.SQRT2 : container.type === 'diamond' ? 2 : 1;
      const h = need * factor + (factor > 1 ? BOUND_PAD * 2 : 0);
      mutate(container, { y: container.y - (h - container.height) / 2, height: h });
    }
    const b = absBox(container);
    let x = b.cx - m.width / 2;
    if (text.textAlign === 'left') x = b.cx - maxW / 2;
    else if (text.textAlign === 'right') x = b.cx + maxW / 2 - m.width;
    let y = b.cy - m.height / 2;
    const ih = innerHeight(container);
    if (text.verticalAlign === 'top') y = b.cy - ih / 2;
    else if (text.verticalAlign === 'bottom') y = b.cy + ih / 2 - m.height;
    // Rotate the label's centre with the container, then place the box around it.
    const [tx, ty] = rotate(x + m.width / 2, y + m.height / 2, b.cx, b.cy, container.angle || 0);
    mutate(text, { text: wrapped, width: m.width, height: m.height, x: tx - m.width / 2, y: ty - m.height / 2, angle: container.angle || 0 });
  }

  // Where each line of a text element sits, in its local frame.
  function textLines(el) {
    const size = el.fontSize, lh = size * lineHeightOf(el);
    const anchor = el.textAlign === 'center' ? el.width / 2 : el.textAlign === 'right' ? el.width : 0;
    return el.text.split('\n').map((t, i) => ({ t, x: anchor, y: i * lh + lh / 2 + size * 0.3 }));
  }

  // ============================================================ hand-drawn shapes

  const f2 = v => Math.round(v * 100) / 100;

  function adjustRoughness(el) {
    const r = el.roughness ?? 1;
    const w = Math.abs(el.width), h = Math.abs(el.height);
    const mx = Math.max(w, h), mn = Math.min(w, h);
    if ((mn >= 20 && mx >= 50) || !r || hasPoints(el)) return r;
    return Math.min(r / (mx < 10 ? 3 : 2), 2.5);
  }

  function opts(el) {
    return {
      roughness: adjustRoughness(el), bowing: 1, maxOffset: 2, curveFitting: 0.95, curveStepCount: 9,
      rand: rng(el.seed), multi: (el.strokeStyle || 'solid') === 'solid',
    };
  }
  const off = (min, max, o, gain = 1) => o.roughness * gain * (o.rand() * (max - min) + min);

  // One sketchy stroke from (x1,y1) to (x2,y2) (port of rough.js' _line).
  function roughLine(x1, y1, x2, y2, o, overlay, out) {
    const lenSq = (x1 - x2) ** 2 + (y1 - y2) ** 2, len = Math.sqrt(lenSq);
    const gain = len < 200 ? 1 : len > 500 ? 0.4 : -0.0016668 * len + 1.233334;
    let offset = o.maxOffset;
    if (offset * offset * 100 > lenSq) offset = len / 10;
    const r = overlay ? offset / 2 : offset;
    const diverge = 0.2 + o.rand() * 0.2;
    let mx = o.bowing * o.maxOffset * (y2 - y1) / 200, my = o.bowing * o.maxOffset * (x1 - x2) / 200;
    mx = off(-mx, mx, o, gain); my = off(-my, my, o, gain);
    const j = () => off(-r, r, o, gain);
    out.push(`M${f2(x1 + j())} ${f2(y1 + j())}C${f2(mx + x1 + (x2 - x1) * diverge + j())} ${f2(my + y1 + (y2 - y1) * diverge + j())} ${f2(mx + x1 + 2 * (x2 - x1) * diverge + j())} ${f2(my + y1 + 2 * (y2 - y1) * diverge + j())} ${f2(x2 + j())} ${f2(y2 + j())}`);
  }
  function sketchLine(x1, y1, x2, y2, o, out) {
    if (!o.roughness) { out.push(`M${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}`); return; }
    roughLine(x1, y1, x2, y2, o, false, out);
    if (o.multi) roughLine(x1, y1, x2, y2, o, true, out);
  }

  // A polygon whose corners are rounded with radius r, as line and quadratic segments.
  function roundedSegments(pts, r) {
    const n = pts.length;
    if (!r) return pts.map((p, i) => ({ l: [p, pts[(i + 1) % n]] }));
    const segs = [], cut = [];
    for (let i = 0; i < n; i++) {
      const v = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      const ta = Math.min(0.5, r / (dist(v, a) || 1)), tb = Math.min(0.5, r / (dist(v, b) || 1));
      cut.push({ v, p1: [v[0] + (a[0] - v[0]) * ta, v[1] + (a[1] - v[1]) * ta], p2: [v[0] + (b[0] - v[0]) * tb, v[1] + (b[1] - v[1]) * tb] });
    }
    for (let i = 0; i < n; i++) {
      const c = cut[i], next = cut[(i + 1) % n];
      segs.push({ q: [c.p1, c.v, c.p2] });
      segs.push({ l: [c.p2, next.p1] });
    }
    return segs;
  }
  function segmentsPath(segs) {
    const s = segs[0].l ? segs[0].l[0] : segs[0].q[0];
    let d = `M${f2(s[0])} ${f2(s[1])}`;
    for (const g of segs) d += g.l ? `L${f2(g.l[1][0])} ${f2(g.l[1][1])}` : `Q${f2(g.q[1][0])} ${f2(g.q[1][1])} ${f2(g.q[2][0])} ${f2(g.q[2][1])}`;
    return d + 'Z';
  }
  function sketchSegments(segs, o) {
    if (!o.roughness) return [segmentsPath(segs)];
    const out = [];
    for (let pass = 0; pass < (o.multi ? 2 : 1); pass++) {
      for (const g of segs) {
        if (g.l) { if (dist(g.l[0], g.l[1]) > 0.5) roughLine(g.l[0][0], g.l[0][1], g.l[1][0], g.l[1][1], o, pass === 1, out); continue; }
        const j = () => off(-1, 1, o) * (pass ? 0.5 : 1);
        const [a, c, b] = g.q;
        out.push(`M${f2(a[0] + j())} ${f2(a[1] + j())}Q${f2(c[0] + j())} ${f2(c[1] + j())} ${f2(b[0] + j())} ${f2(b[1] + j())}`);
      }
    }
    return out;
  }
  function flattenSegments(segs) {
    const out = [];
    for (const g of segs) {
      if (g.l) { out.push(g.l[0]); continue; }
      const [a, c, b] = g.q;
      for (let i = 0; i < 4; i++) { const t = i / 4, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); }
    }
    return out;
  }

  // Excalidraw's corner radius rules (roundness type 3 = adaptive, 1/2 = proportional).
  function cornerRadius(size, el) {
    if (!el.roundness) return 0;
    if (el.roundness.type === 3) {
      const fixed = el.roundness.value ?? 32;
      return size <= fixed / 0.25 ? size * 0.25 : fixed;
    }
    return size * 0.25;
  }

  function roughEllipsePath(cx, cy, w, h, o) {
    if (!o.roughness) {
      const rx = Math.abs(w / 2), ry = Math.abs(h / 2);
      return [`M${f2(cx - rx)} ${f2(cy)}A${f2(rx)} ${f2(ry)} 0 1 0 ${f2(cx + rx)} ${f2(cy)}A${f2(rx)} ${f2(ry)} 0 1 0 ${f2(cx - rx)} ${f2(cy)}Z`];
    }
    let rx = Math.abs(w / 2), ry = Math.abs(h / 2);
    const psq = Math.sqrt(Math.PI * 2 * Math.sqrt((rx * rx + ry * ry) / 2));
    const steps = Math.ceil(Math.max(o.curveStepCount, o.curveStepCount / Math.sqrt(200) * psq));
    const inc = Math.PI * 2 / steps;
    rx += off(-rx * (1 - o.curveFitting), rx * (1 - o.curveFitting), o);
    ry += off(-ry * (1 - o.curveFitting), ry * (1 - o.curveFitting), o);
    const pass = (offset, overlap) => {
      const start = o.rand() * Math.PI * 2 - Math.PI / 2, pts = [];
      const j = () => off(-offset, offset, o);
      pts.push([j() + cx + 0.9 * rx * Math.cos(start - inc), j() + cy + 0.9 * ry * Math.sin(start - inc)]);
      for (let a = start; a < Math.PI * 2 + start - 0.01; a += inc) pts.push([j() + cx + rx * Math.cos(a), j() + cy + ry * Math.sin(a)]);
      pts.push([j() + cx + rx * Math.cos(start + Math.PI * 2 + overlap * 0.5), j() + cy + ry * Math.sin(start + Math.PI * 2 + overlap * 0.5)]);
      pts.push([j() + cx + 0.98 * rx * Math.cos(start + overlap), j() + cy + 0.98 * ry * Math.sin(start + overlap)]);
      pts.push([j() + cx + 0.9 * rx * Math.cos(start + overlap * 0.5), j() + cy + 0.9 * ry * Math.sin(start + overlap * 0.5)]);
      return curveThrough(pts);
    };
    const out = [pass(1, inc * off(0.1, off(0.4, 1, o), o))];
    if (o.multi) out.push(pass(1.5, 0));
    return out;
  }
  function curveThrough(pts) {
    if (pts.length < 3) return pts.length === 2 ? `M${f2(pts[0][0])} ${f2(pts[0][1])}L${f2(pts[1][0])} ${f2(pts[1][1])}` : '';
    let d = `M${f2(pts[1][0])} ${f2(pts[1][1])}`;
    for (let i = 1; i + 2 < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2];
      d += `C${f2(p1[0] + (p2[0] - p0[0]) / 6)} ${f2(p1[1] + (p2[1] - p0[1]) / 6)} ${f2(p2[0] - (p3[0] - p1[0]) / 6)} ${f2(p2[1] - (p3[1] - p1[1]) / 6)} ${f2(p2[0])} ${f2(p2[1])}`;
    }
    return d;
  }
  function splinePath(pts) {
    let d = `M${f2(pts[0][0])} ${f2(pts[0][1])}`;
    for (const [, c1, c2, p] of catmull(pts)) d += `C${f2(c1[0])} ${f2(c1[1])} ${f2(c2[0])} ${f2(c2[1])} ${f2(p[0])} ${f2(p[1])}`;
    return d;
  }

  // Hachure: parallel lines clipped to a polygon, at `angle` degrees.
  function hatchLines(poly, gap, angle) {
    const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const rp = poly.map(([x, y]) => [x * c + y * s, -x * s + y * c]);
    let y1 = Infinity, y2 = -Infinity;
    for (const [, y] of rp) { y1 = Math.min(y1, y); y2 = Math.max(y2, y); }
    const lines = [];
    for (let y = y1 + gap / 2; y < y2; y += gap) {
      const xs = [];
      for (let i = 0; i < rp.length; i++) {
        const p = rp[i], q = rp[(i + 1) % rp.length];
        if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) xs.push(p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
      }
      xs.sort((m, n) => m - n);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        lines.push([[xs[i] * c - y * s, xs[i] * s + y * c], [xs[i + 1] * c - y * s, xs[i + 1] * s + y * c]]);
      }
    }
    return lines;
  }

  // Fill items for a closed outline: `poly` for hachures, `solidPath` for solid fills.
  function fillItems(el, poly, solidPath, o) {
    if (isTransparent(el.backgroundColor)) return [];
    const style = el.fillStyle || 'hachure';
    if (style === 'solid') return [{ kind: 'fill', color: 'bg', d: solidPath }];
    const gap = Math.max(2, el.strokeWidth * 4), width = Math.max(0.5, el.strokeWidth / 2);
    const out = [];
    const fo = { ...o, multi: o.roughness > 0 };
    const angles = style === 'cross-hatch' ? [-41, 49] : [-41];
    for (const ang of angles) for (const [p, q] of hatchLines(poly, gap, ang)) sketchLine(p[0], p[1], q[0], q[1], fo, out);
    return out.length ? [{ kind: 'stroke', color: 'bg', width, d: out.join('') }] : [];
  }

  function strokeItem(el, d) {
    const w = el.strokeWidth || 1;
    const dash = el.strokeStyle === 'dashed' ? [8, 8 + w] : el.strokeStyle === 'dotted' ? [1.5, 6 + w] : null;
    return { kind: 'stroke', color: 'stroke', width: el.strokeStyle === 'solid' || !el.strokeStyle ? w : w + 0.5, dash, d };
  }

  function arrowheadItems(el, pts, which, o) {
    const type = el[which + 'Arrowhead'];
    if (!type || pts.length < 2) return [];
    const n = pts.length, end = which === 'end';
    const tip = end ? pts[n - 1] : pts[0];
    const nb = end ? pts[n - 2] : pts[1];
    let from = nb;
    if (isCurved(el)) {
      const segs = catmull(pts);
      const s = end ? segs[segs.length - 1] : segs[0];
      from = end ? s[2] : s[1];
      if (dist(from, tip) < 1) from = nb;
    }
    const len = dist(tip, nb) || 1, dl = dist(tip, from) || 1;
    const dir = [(tip[0] - from[0]) / dl, (tip[1] - from[1]) / dl];
    const base = { arrow: 25, diamond: 12, diamond_outline: 12 }[type] ?? 15;
    const size = Math.min(base, len * (type.startsWith('diamond') ? 0.25 : 0.5));
    const deg = { bar: 90, arrow: 20 }[type] ?? 25;
    const back = [tip[0] - dir[0] * size, tip[1] - dir[1] * size];
    const a = deg * Math.PI / 180;
    const p3 = rotate(back[0], back[1], tip[0], tip[1], -a), p4 = rotate(back[0], back[1], tip[0], tip[1], a);
    const out = [];
    const lines = [];
    const ho = { ...o, multi: o.multi };
    if (type === 'arrow' || type === 'bar') {
      sketchLine(p3[0], p3[1], tip[0], tip[1], ho, lines);
      sketchLine(p4[0], p4[1], tip[0], tip[1], ho, lines);
      out.push({ ...strokeItem(el, lines.join('')), dash: null });
    } else if (type.startsWith('triangle')) {
      const d = `M${f2(tip[0])} ${f2(tip[1])}L${f2(p3[0])} ${f2(p3[1])}L${f2(p4[0])} ${f2(p4[1])}Z`;
      out.push({ kind: 'fill', color: type === 'triangle' ? 'stroke' : 'bg', d });
      out.push({ ...strokeItem(el, d), dash: null });
    } else if (type.startsWith('diamond')) {
      const far = [tip[0] - dir[0] * size * 2, tip[1] - dir[1] * size * 2];
      const mid = [tip[0] - dir[0] * size, tip[1] - dir[1] * size];
      const side = [-dir[1] * size * 0.5, dir[0] * size * 0.5];
      const d = `M${f2(tip[0])} ${f2(tip[1])}L${f2(mid[0] + side[0])} ${f2(mid[1] + side[1])}L${f2(far[0])} ${f2(far[1])}L${f2(mid[0] - side[0])} ${f2(mid[1] - side[1])}Z`;
      out.push({ kind: 'fill', color: type === 'diamond' ? 'stroke' : 'bg', d });
      out.push({ ...strokeItem(el, d), dash: null });
    } else { // dot, circle, circle_outline
      const r = Math.max(2, (size + el.strokeWidth - 2) / 2);
      const d = `M${f2(tip[0] - r)} ${f2(tip[1])}A${f2(r)} ${f2(r)} 0 1 0 ${f2(tip[0] + r)} ${f2(tip[1])}A${f2(r)} ${f2(r)} 0 1 0 ${f2(tip[0] - r)} ${f2(tip[1])}Z`;
      out.push({ kind: 'fill', color: type === 'circle_outline' ? 'bg' : 'stroke', d });
      out.push({ ...strokeItem(el, d), dash: null });
    }
    return out;
  }

  // Outline of a pressure-sensitive pen stroke, filled with the stroke colour.
  function freedrawPath(el) {
    const raw = el.points;
    if (!raw.length) return '';
    const size = (el.strokeWidth || 2) * 1.9 + 0.8;
    const pts = [raw[0]], prs = [el.pressures?.[0]];
    for (let i = 1; i < raw.length; i++) {
      const last = pts[pts.length - 1];
      if (dist(raw[i], last) < 0.6 && i < raw.length - 1) continue;
      pts.push(i === raw.length - 1 ? raw[i] : [last[0] + (raw[i][0] - last[0]) * 0.65, last[1] + (raw[i][1] - last[1]) * 0.65]);
      prs.push(el.pressures?.[i]);
    }
    let prev = 0.5;
    const radii = pts.map((p, i) => {
      let pr;
      if (!el.simulatePressure && prs[i] != null) pr = prs[i];
      else {
        const d = i ? dist(p, pts[i - 1]) : 0, sp = Math.min(1, d / size), rp = Math.min(1, 1 - sp);
        pr = Math.min(1, prev + (rp - prev) * (sp * 0.275));
      }
      prev = pr;
      return size / 2 * (0.55 + 0.9 * pr);
    });
    const circle = (c, r) => `M${f2(c[0] - r)} ${f2(c[1])}A${f2(r)} ${f2(r)} 0 1 0 ${f2(c[0] + r)} ${f2(c[1])}A${f2(r)} ${f2(r)} 0 1 0 ${f2(c[0] - r)} ${f2(c[1])}Z`;
    if (pts.length < 2 || polylineLength(pts) < 1) return circle(pts[0], radii[0]);
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const l = dist(a, b) || 1, nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
      left.push([pts[i][0] + nx * radii[i], pts[i][1] + ny * radii[i]]);
      right.push([pts[i][0] - nx * radii[i], pts[i][1] - ny * radii[i]]);
    }
    const smooth = (arr, first) => {
      let d = first ? `M${f2(arr[0][0])} ${f2(arr[0][1])}` : `L${f2(arr[0][0])} ${f2(arr[0][1])}`;
      for (let i = 1; i < arr.length - 1; i++) {
        const m = [(arr[i][0] + arr[i + 1][0]) / 2, (arr[i][1] + arr[i + 1][1]) / 2];
        d += `Q${f2(arr[i][0])} ${f2(arr[i][1])} ${f2(m[0])} ${f2(m[1])}`;
      }
      const z = arr[arr.length - 1];
      return d + `L${f2(z[0])} ${f2(z[1])}`;
    };
    const rEnd = radii[radii.length - 1], rStart = radii[0];
    const r1 = right.slice().reverse();
    // Round caps: half circles from one side of the stroke to the other.
    return smooth(left, true) + `A${f2(rEnd)} ${f2(rEnd)} 0 0 0 ${f2(r1[0][0])} ${f2(r1[0][1])}` + smooth(r1, false).replace(/^L[^A-Z]*/, '') +
      `A${f2(rStart)} ${f2(rStart)} 0 0 0 ${f2(left[0][0])} ${f2(left[0][1])}Z`;
  }

  // Build the drawable items of an element in its local frame:
  // [{kind: 'stroke'|'fill', color: 'stroke'|'bg', width, dash, d}]
  function buildShape(el) {
    const o = opts(el), w = el.width, h = el.height, items = [];
    switch (el.type) {
      case 'rectangle': case 'diamond': {
        const x0 = Math.min(0, w), y0 = Math.min(0, h), aw = Math.abs(w), ah = Math.abs(h);
        const corners = el.type === 'rectangle'
          ? [[x0, y0], [x0 + aw, y0], [x0 + aw, y0 + ah], [x0, y0 + ah]]
          : diamondPoints(aw, ah).map(([x, y]) => [x0 + x, y0 + y]);
        const r = el.type === 'rectangle' ? cornerRadius(Math.min(aw, ah), el) : el.roundness ? Math.min(aw, ah) * 0.12 : 0;
        const segs = roundedSegments(corners, r);
        items.push(...fillItems(el, r ? flattenSegments(segs) : corners, segmentsPath(segs), o));
        items.push(strokeItem(el, sketchSegments(segs, o).join('')));
        break;
      }
      case 'ellipse': {
        const cx = w / 2, cy = h / 2, rx = Math.abs(w / 2), ry = Math.abs(h / 2);
        const poly = [];
        for (let i = 0; i < 48; i++) poly.push([cx + rx * Math.cos(i / 48 * Math.PI * 2), cy + ry * Math.sin(i / 48 * Math.PI * 2)]);
        const clean = roughEllipsePath(cx, cy, w, h, { ...o, roughness: 0 })[0];
        items.push(...fillItems(el, poly, clean, o));
        items.push(strokeItem(el, roughEllipsePath(cx, cy, w, h, o).join('')));
        break;
      }
      case 'line': case 'arrow': {
        const pts = el.points;
        if (pts.length < 2) break;
        const curved = isCurved(el);
        const closed = el.type === 'line' && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 8;
        if (closed) {
          const poly = curvePoints(el);
          items.push(...fillItems(el, poly, (curved ? splinePath(pts) : 'M' + pts.map(p => `${f2(p[0])} ${f2(p[1])}`).join('L')) + 'Z', o));
        }
        let d;
        if (!o.roughness) d = curved ? splinePath(pts) : 'M' + pts.map(p => `${f2(p[0])} ${f2(p[1])}`).join('L');
        else if (curved) {
          const passes = [];
          for (const k of o.multi ? [1 + o.roughness * 0.2, 1.5 * (1 + o.roughness * 0.22)] : [1 + o.roughness * 0.2]) {
            passes.push(splinePath(pts.map(([x, y]) => [x + off(-k, k, o), y + off(-k, k, o)])));
          }
          d = passes.join('');
        } else {
          const out = [];
          for (let i = 1; i < pts.length; i++) sketchLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], o, out);
          d = out.join('');
        }
        items.push(strokeItem(el, d));
        if (el.type === 'arrow') items.push(...arrowheadItems(el, pts, 'start', o), ...arrowheadItems(el, pts, 'end', o));
        break;
      }
      case 'freedraw': {
        if (!isTransparent(el.backgroundColor) && el.points.length > 2) {
          items.push({ kind: 'fill', color: 'bg', d: 'M' + el.points.map(p => `${f2(p[0])} ${f2(p[1])}`).join('L') + 'Z' });
        }
        items.push({ kind: 'fill', color: 'stroke', d: freedrawPath(el) });
        break;
      }
      case 'frame': case 'magicframe': case 'embeddable': case 'iframe': {
        const r = el.type === 'frame' || el.type === 'magicframe' ? 8 : cornerRadius(Math.min(Math.abs(w), Math.abs(h)), el);
        const segs = roundedSegments([[0, 0], [w, 0], [w, h], [0, h]], r);
        items.push({ kind: 'stroke', color: el.type.endsWith('frame') ? 'frame' : 'stroke', width: el.type.endsWith('frame') ? 1 : el.strokeWidth, d: segmentsPath(segs) });
        break;
      }
    }
    return items;
  }

  const shapeCache = new WeakMap();
  function shapeOf(el) {
    const key = `${el.version}:${el.versionNonce}:${el.width}:${el.height}:${el.points ? el.points.length : 0}`;
    const c = shapeCache.get(el);
    if (c && c.key === key) return c.items;
    const items = buildShape(el);
    shapeCache.set(el, { key, items });
    return items;
  }

  // ============================================================ colours & themes

  function parseColor(c) {
    let m;
    if ((m = /^#([0-9a-f]{3,8})$/i.exec(c))) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(c))) {
      const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
      return [+m[1], +m[2], +m[3], a];
    }
    return null;
  }

  // Excalidraw's dark mode is `invert(93%) hue-rotate(180deg)` over the light
  // drawing. Apply the same maths per colour so images aren't inverted too.
  const themeCache = new Map();
  function themeColor(c, dark) {
    if (!dark || !c || c === 'transparent') return c;
    const hit = themeCache.get(c);
    if (hit) return hit;
    const p = parseColor(c);
    if (!p) return c;
    const [R, G, B] = p.slice(0, 3).map(v => 0.93 - 0.86 * (v / 255));
    const ch = v => Math.round(Math.max(0, Math.min(1, v)) * 255);
    const r = ch(-0.574 * R + 1.43 * G + 0.144 * B), g = ch(0.426 * R + 0.43 * G + 0.144 * B), b = ch(0.426 * R + 1.43 * G - 0.856 * B);
    const out = p[3] < 1 ? `rgba(${r},${g},${b},${p[3]})` : '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    themeCache.set(c, out);
    return out;
  }

  const FRAME_COLOR = '#bbbbbb';
  function itemColor(item, el, dark) {
    const c = item.color === 'bg' ? el.backgroundColor : item.color === 'frame' ? FRAME_COLOR : el.strokeColor;
    return themeColor(c, dark);
  }

  // ============================================================ canvas rendering

  // The box an arrow leaves open around its label, in scene coordinates.
  function labelGap(t) { return [t.x - 4, t.y - 2, t.width + 8, t.height + 4]; }

  // env: {dark, image(el) -> HTMLImageElement|null, label(el) -> bound text element|null}
  function drawElement(ctx, el, env) {
    const b = absBox(el);
    ctx.save();
    const label = el.type === 'arrow' && env.label && env.label(el);
    if (label) {
      // Arrows break around their label, like Excalidraw.
      const [gx, gy, gw, gh] = labelGap(label);
      ctx.beginPath(); ctx.rect(b.x1 - 1e4, b.y1 - 1e4, b.x2 - b.x1 + 2e4, b.y2 - b.y1 + 2e4); ctx.rect(gx, gy, gw, gh);
      ctx.clip('evenodd');
    }
    if (el.angle) { ctx.translate(b.cx, b.cy); ctx.rotate(el.angle); ctx.translate(-b.cx, -b.cy); }
    ctx.translate(el.x, el.y);
    ctx.globalAlpha *= (el.opacity ?? 100) / 100;
    if (el.type === 'text') {
      ctx.fillStyle = themeColor(el.strokeColor, env.dark);
      ctx.font = fontString(el);
      ctx.textAlign = el.textAlign === 'center' ? 'center' : el.textAlign === 'right' ? 'right' : 'left';
      ctx.textBaseline = 'alphabetic';
      for (const l of textLines(el)) ctx.fillText(l.t, l.x, l.y);
    } else if (el.type === 'image') {
      const img = env.image && env.image(el);
      const w = el.width, h = el.height, sx = el.scale?.[0] ?? 1, sy = el.scale?.[1] ?? 1;
      if (img) {
        ctx.save();
        ctx.translate(sx < 0 ? w : 0, sy < 0 ? h : 0);
        ctx.scale(sx < 0 ? -1 : 1, sy < 0 ? -1 : 1);
        ctx.drawImage(img, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.fillStyle = env.dark ? '#2a2a2a' : '#eeeeee';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = env.dark ? '#555' : '#bbb'; ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, w, h);
      }
    } else {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const item of shapeOf(el)) {
        if (!item.d) continue;
        const p = item.p || (item.p = new Path2D(item.d));
        const color = itemColor(item, el, env.dark);
        if (item.kind === 'fill') { ctx.fillStyle = color; ctx.fill(p); }
        else { ctx.strokeStyle = color; ctx.lineWidth = item.width; ctx.setLineDash(item.dash || []); ctx.stroke(p); }
      }
      ctx.setLineDash([]);
      if (el.type === 'frame' || el.type === 'magicframe') {
        ctx.fillStyle = themeColor('#666666', env.dark);
        ctx.font = '14px system-ui, sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText(el.name || 'Frame', 0, -4);
      } else if (el.type === 'embeddable' || el.type === 'iframe') {
        ctx.fillStyle = themeColor('#888888', env.dark);
        ctx.font = '13px system-ui, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(el.link || 'Embedded content', 8, 8, Math.max(20, el.width - 16));
      }
    }
    ctx.restore();
  }

  // ============================================================ SVG export

  const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // opts: {dark, background: color|null, padding, scale, fontData: base64 woff2, fileData(fileId) -> dataURL}
  function toSVG(elements, o = {}) {
    const els = elements.filter(e => !e.isDeleted && e.type !== 'selection');
    const pad = o.padding ?? 10, scale = o.scale ?? 1, dark = !!o.dark;
    const cb = commonBounds(els) || [0, 0, 0, 0];
    const x = cb[0] - pad, y = cb[1] - pad, w = Math.max(1, cb[2] - cb[0] + pad * 2), h = Math.max(1, cb[3] - cb[1] + pad * 2);
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)}" width="${f2(w * scale)}" height="${f2(h * scale)}">`];
    if (o.fontData && els.some(e => e.type === 'text' && (e.fontFamily === 1 || e.fontFamily === 5 || !FONTS[e.fontFamily]))) {
      out.push(`<defs><style>@font-face{font-family:Virgil;src:url(data:font/woff2;base64,${o.fontData}) format("woff2")}@font-face{font-family:Excalifont;src:url(data:font/woff2;base64,${o.fontData}) format("woff2")}</style></defs>`);
    }
    if (o.background) out.push(`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="${xmlEsc(themeColor(o.background, dark))}"/>`);
    const byId = new Map(els.map(e => [e.id, e]));
    els.forEach((el, i) => {
      const b = absBox(el);
      const tf = (el.angle ? `rotate(${f2(el.angle * 180 / Math.PI)} ${f2(b.cx)} ${f2(b.cy)}) ` : '') + `translate(${f2(el.x)} ${f2(el.y)})`;
      const op = (el.opacity ?? 100) < 100 ? ` opacity="${(el.opacity ?? 100) / 100}"` : '';
      const lb = el.type === 'arrow' && el.boundElements?.find(e => e.type === 'text');
      const label = lb && byId.get(lb.id);
      if (label) {
        const [gx, gy, gw, gh] = labelGap(label);
        out.push(`<mask id="gap${i}" maskUnits="userSpaceOnUse" x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}"><rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="#fff"/><rect x="${f2(gx)}" y="${f2(gy)}" width="${f2(gw)}" height="${f2(gh)}" fill="#000"/></mask><g mask="url(#gap${i})">`);
      }
      out.push(`<g transform="${tf}"${op}>`);
      if (el.type === 'text') {
        const anchor = el.textAlign === 'center' ? 'middle' : el.textAlign === 'right' ? 'end' : 'start';
        for (const l of textLines(el)) {
          out.push(`<text x="${f2(l.x)}" y="${f2(l.y)}" font-family="${xmlEsc(fontCss(el.fontFamily))}" font-size="${el.fontSize}px" fill="${xmlEsc(themeColor(el.strokeColor, dark))}" text-anchor="${anchor}" style="white-space:pre">${xmlEsc(l.t)}</text>`);
        }
      } else if (el.type === 'image') {
        let data = o.fileData && o.fileData(el.fileId);
        if (data && isEquation(el)) data = tintSvg(data, equationColor(el, dark));
        const sx = el.scale?.[0] ?? 1, sy = el.scale?.[1] ?? 1;
        const flip = sx < 0 || sy < 0 ? ` transform="translate(${sx < 0 ? f2(el.width) : 0} ${sy < 0 ? f2(el.height) : 0}) scale(${sx < 0 ? -1 : 1} ${sy < 0 ? -1 : 1})"` : '';
        if (data) out.push(`<image href="${xmlEsc(data)}" width="${f2(el.width)}" height="${f2(el.height)}" preserveAspectRatio="none"${flip}/>`);
        else out.push(`<rect width="${f2(el.width)}" height="${f2(el.height)}" fill="${dark ? '#2a2a2a' : '#eeeeee'}"/>`);
      } else {
        for (const item of shapeOf(el)) {
          if (!item.d) continue;
          const color = xmlEsc(itemColor(item, el, dark));
          if (item.kind === 'fill') out.push(`<path d="${item.d}" fill="${color}" stroke="none"/>`);
          else out.push(`<path d="${item.d}" fill="none" stroke="${color}" stroke-width="${item.width}" stroke-linecap="round" stroke-linejoin="round"${item.dash ? ` stroke-dasharray="${item.dash.join(' ')}"` : ''}/>`);
        }
        if (el.type === 'frame' || el.type === 'magicframe') {
          out.push(`<text x="0" y="-4" font-family="system-ui, sans-serif" font-size="14px" fill="${themeColor('#666666', dark)}">${xmlEsc(el.name || 'Frame')}</text>`);
        }
      }
      out.push(label ? '</g></g>' : '</g>');
    });
    out.push('</svg>');
    return out.join('');
  }

  // ============================================================ files

  // The files the live elements still refer to (edited equations leave their old SVG behind).
  function usedFiles(scene) {
    const ids = new Set(scene.elements.filter(e => e.type === 'image' && !e.isDeleted).map(e => e.fileId));
    return Object.fromEntries(Object.entries(scene.files || {}).filter(([id]) => ids.has(id)));
  }

  // ============================================================ equations
  // A LaTeX equation is an image element whose SVG (from MathJax) is drawn in the element's
  // stroke colour; its source is kept in customData.latex. In .excalidraw.md notes it's also
  // listed under "Embedded Files" as `fileId: $$latex$$`, the way the Obsidian plugin does it.
  const isEquation = el => el?.type === 'image' && typeof el.customData?.latex === 'string';
  const equationColor = (el, dark) => themeColor(!el.strokeColor || isTransparent(el.strokeColor) ? '#1e1e1e' : el.strokeColor, dark);
  const svgDataURL = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  function svgFromDataURL(url) {
    const i = url.indexOf(',');
    if (i < 0) return '';
    return /;base64$/.test(url.slice(0, i)) ? atob(url.slice(i + 1)) : decodeURIComponent(url.slice(i + 1));
  }
  // The SVG with its currentColor set to `color`.
  function tintSvg(url, color) {
    const svg = svgFromDataURL(url).replace(/^(\s*(?:<\?xml[^>]*>\s*)?<svg)(?:\s+color="[^"]*")?/, `$1 color="${xmlEsc(color)}"`);
    return svgDataURL(svg);
  }

  function emptyScene() {
    return { elements: [], appState: { gridSize: null, viewBackgroundColor: '#ffffff' }, files: {}, rest: {} };
  }

  function fixElement(el) {
    const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
    el.x = num(el.x, 0); el.y = num(el.y, 0); el.width = num(el.width, 0); el.height = num(el.height, 0);
    el.angle = num(el.angle, 0); el.opacity = num(el.opacity, 100); el.strokeWidth = num(el.strokeWidth, 2);
    el.roughness = num(el.roughness, 1); el.seed = num(el.seed, randomInt()); el.version = num(el.version, 1);
    el.strokeColor = el.strokeColor || '#1e1e1e'; el.backgroundColor = el.backgroundColor || 'transparent';
    if (!Array.isArray(el.groupIds)) el.groupIds = [];
    if (!el.id) el.id = randomId();
    // Upgrade fields from older Excalidraw files, as Excalidraw's own restore() does.
    if (el.type === 'draw') el.type = 'line';
    if (el.roundness === undefined) {
      el.roundness = el.strokeSharpness === 'round' ? { type: ['rectangle', 'image', 'embeddable', 'iframe'].includes(el.type) ? 3 : 2 } : null;
    }
    if (el.boundElements === undefined && Array.isArray(el.boundElementIds)) el.boundElements = el.boundElementIds.map(id => ({ id, type: 'arrow' }));
    if (hasPoints(el) && (!Array.isArray(el.points) || !el.points.length)) el.points = [[0, 0]];
    if (el.type === 'text') {
      el.text = String(el.text ?? '');
      if (el.originalText == null) el.originalText = el.text;
      el.fontSize = num(el.fontSize, 20); el.fontFamily = num(el.fontFamily, 1);
      el.lineHeight = num(el.lineHeight, 1.25);
    }
    return el;
  }

  function restore(data) {
    const { type, version, source, elements, appState, files, ...rest } = data;
    return {
      elements: (elements || []).filter(e => e && typeof e === 'object' && !e.isDeleted && e.type).map(fixElement),
      appState: { gridSize: null, viewBackgroundColor: '#ffffff', ...(appState || {}) },
      files: files && typeof files === 'object' ? files : {},
      rest,
    };
  }

  /** @param {string | number} [indent] */
  function sceneJSON(scene, files = usedFiles(scene), indent = 2) {
    return JSON.stringify({ ...scene.rest, type: 'excalidraw', version: 2, source: 'cinder', elements: scene.elements, appState: scene.appState, files }, null, indent);
  }

  // `.excalidraw.md` (Obsidian Excalidraw plugin): JSON lives in a fenced block under a "Drawing" heading.
  const DRAWING_BLOCK = /(^|\n)(#{1,2} Drawing[ \t]*\r?\n)```(compressed-json|json)[ \t]*\r?\n([\s\S]*?)\r?\n```/;
  const TEXT_HEADING = /(^|\n)#{1,2} Text Elements[ \t]*\r?\n/;
  const EMBED_HEADING = /(^|\n)#{1,2} Embedded Files[ \t]*\r?\n/;
  const LINKS_HEADING = /(^|\n)#{1,2} Element Links[ \t]*\r?\n/;
  const EQ_LINE = /^([\w-]+):[ \t]*\$\$([\s\S]*?)\$\$[ \t]*(?:\r?\n)*/m;
  const SECTION_END = /\n(?=#{1,2} (?:Text Elements|Element Links|Embedded Files|Drawing)[ \t]*\r?\n|%%)/;

  function sectionRange(text, heading) {
    const m = heading.exec(text);
    if (!m) return null;
    const start = m.index + m[0].length;
    const rest = text.slice(start - 1);
    const e = SECTION_END.exec(rest);
    return { start, end: e ? start - 1 + e.index + 1 : text.length };
  }

  function parseDrawing(text, path = '') {
    if (!/\.md$/i.test(path)) {
      if (!text.trim()) return { scene: emptyScene(), format: 'json' };
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.elements)) throw new Error('This file isn’t an Excalidraw drawing.');
      return { scene: restore(data), format: 'json' };
    }
    const embedded = {}, equations = {};
    const er = sectionRange(text, EMBED_HEADING);
    if (er) {
      const re = /^([\w-]+):\s*!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/gm;
      let m;
      const body = text.slice(er.start, er.end);
      while ((m = re.exec(body))) embedded[m[1]] = m[2].trim();
      const eq = new RegExp(EQ_LINE.source, 'gm');
      while ((m = eq.exec(body))) equations[m[1]] = m[2].trim();
    }
    const m = DRAWING_BLOCK.exec(text);
    if (!m) return { scene: emptyScene(), format: 'md', embedded, equations };
    let json = m[4];
    if (m[3] === 'compressed-json') {
      json = lzDecompressFromBase64(json.replace(/\s+/g, ''));
      if (json == null) throw new Error('Couldn’t decompress the drawing data.');
    }
    const data = JSON.parse(json);
    if (!data || !Array.isArray(data.elements)) throw new Error('The drawing data in this note is not valid.');
    const scene = restore(data);
    for (const el of scene.elements) {
      if (el.type === 'image' && el.fileId && el.fileId in equations) el.customData = { ...(el.customData || {}), latex: equations[el.fileId] };
    }
    // Like the plugin, treat the Markdown "Text Elements" as the source of each text's
    // content, so edits made to the note (e.g. links rewritten on rename) are kept.
    const relayout = [];
    const tr = sectionRange(text, TEXT_HEADING);
    if (tr) {
      const byId = new Map(scene.elements.filter(e => e.type === 'text').map(e => [e.id, e]));
      const re = /([\s\S]*?) \^([A-Za-z0-9_-]+)[ \t]*(?:\r?\n|$)/g;
      const body = text.slice(tr.start, tr.end);
      let t;
      while ((t = re.exec(body))) {
        const el = byId.get(t[2]), val = t[1].replace(/^(\r?\n)+/, '').replace(/\r\n/g, '\n');
        if (!el || val === (el.rawText ?? el.originalText ?? el.text)) continue;
        el.originalText = val;
        if (el.rawText != null) el.rawText = val;
        if (!el.containerId) el.text = val;
        relayout.push(el.id);
      }
    }
    // Element links listed in the note win over the JSON too.
    const lr = sectionRange(text, LINKS_HEADING);
    if (lr) {
      const byId = new Map(scene.elements.map(e => [e.id, e]));
      const re = /^([A-Za-z0-9_-]+):[ \t]*(\S.*?)[ \t]*$/gm;
      const body = text.slice(lr.start, lr.end);
      let l;
      while ((l = re.exec(body))) { const el = byId.get(l[1]); if (el) el.link = l[2]; }
    }
    return { scene, format: 'md', embedded, equations, relayout };
  }

  const MD_HEADER = `---

excalidraw-plugin: parsed
tags: [excalidraw]

---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== You can decompress Drawing data with the command palette: 'Decompress current Excalidraw file'. For more info check in plugin settings under 'Saving'


# Excalidraw Data

## Text Elements
`;

  // Rewrite an .excalidraw.md note: new JSON in the drawing block, regenerated
  // "Text Elements" and "Element Links" (the plugin prefers these over the JSON),
  // and any new "Embedded Files" entries. Everything else is kept.
  function serializeMd(scene, source, embedded = {}) {
    const json = sceneJSON(scene, {}, '\t');
    const fence = '```json\n' + json + '\n```';
    let text = source && source.trim() ? source : MD_HEADER + '%%\n## Drawing\n```json\n{}\n```\n%%';
    const m = DRAWING_BLOCK.exec(text);
    if (m) {
      const at = m.index + m[1].length + m[2].length;
      text = text.slice(0, at) + fence + text.slice(m.index + m[0].length);
    } else {
      text = text.replace(/\s*$/, '') + '\n\n%%\n## Drawing\n' + fence + '\n%%\n';
    }
    const texts = scene.elements.filter(e => e.type === 'text' && !e.isDeleted);
    const body = texts.map(t => `${t.rawText ?? t.originalText ?? t.text} ^${t.id}\n\n`).join('');
    const tr = sectionRange(text, TEXT_HEADING);
    if (tr) text = text.slice(0, tr.start) + body + text.slice(tr.end);
    const links = scene.elements.filter(e => e.link && !e.isDeleted).map(e => `${e.id}: ${e.link}\n\n`).join('');
    const lr = sectionRange(text, LINKS_HEADING);
    if (lr) text = text.slice(0, lr.start) + links + text.slice(lr.end);
    else if (links) {
      const after = sectionRange(text, TEXT_HEADING);
      if (after) text = text.slice(0, after.end) + '## Element Links\n' + links + text.slice(after.end);
    }
    // Equations are rewritten from the elements each time, so edited or deleted ones don't linger.
    const er = sectionRange(text, EMBED_HEADING);
    if (er) text = text.slice(0, er.start) + text.slice(er.start, er.end).replace(new RegExp(EQ_LINE.source, 'gm'), '') + text.slice(er.end);
    const known = parseDrawingEmbedded(text), eqs = new Map();
    for (const el of scene.elements) if (!el.isDeleted && isEquation(el) && el.fileId) eqs.set(el.fileId, el.customData.latex);
    const add = Object.entries(embedded).filter(([id]) => !(id in known) && !eqs.has(id)).map(([id, link]) => `${id}: [[${link}]]\n\n`)
      .concat([...eqs].map(([id, tex]) => `${id}: $$${tex}$$\n\n`));
    if (add.length) {
      const r = sectionRange(text, EMBED_HEADING);
      if (r) text = text.slice(0, r.end).replace(/\n*$/, '\n') + (r.end > r.start ? '\n' : '') + add.join('') + text.slice(r.end);
      else {
        const d = /\n%%\r?\n#{1,2} Drawing/.exec(text) || DRAWING_BLOCK.exec(text);
        const at = d ? d.index + 1 : text.length;
        text = text.slice(0, at) + '## Embedded Files\n' + add.join('') + text.slice(at);
      }
    }
    return text;
  }
  function parseDrawingEmbedded(text) {
    const out = {}, r = sectionRange(text, EMBED_HEADING);
    if (!r) return out;
    const re = /^([\w-]+):/gm;
    let m;
    const body = text.slice(r.start, r.end);
    while ((m = re.exec(body))) out[m[1]] = true;
    return out;
  }

  function serializeDrawing(scene, info) {
    return info && info.format === 'md' ? serializeMd(scene, info.source, info.embedded) : sceneJSON(scene) + '\n';
  }

  // lz-string's decompressFromBase64 (MIT), used by the Obsidian plugin's "compressed-json".
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  function lzDecompressFromBase64(input) {
    if (input == null) return '';
    if (input === '') return null;
    const rev = {};
    for (let i = 0; i < B64.length; i++) rev[B64[i]] = i;
    return lzDecompress(input.length, 32, i => rev[input.charAt(i)]);
  }
  function lzDecompress(length, resetValue, next) {
    /** @type {any[]} */
    const dict = [0, 1, 2], result = [];
    let enlargeIn = 4, dictSize = 4, numBits = 3, w, c;
    const data = { val: next(0), position: resetValue, index: 1 };
    const bits = n => {
      let b = 0, power = 1;
      const max = 2 ** n;
      while (power !== max) {
        const resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0) { data.position = resetValue; data.val = next(data.index++); }
        b |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }
      return b;
    };
    switch (bits(2)) {
      case 0: c = String.fromCharCode(bits(8)); break;
      case 1: c = String.fromCharCode(bits(16)); break;
      default: return '';
    }
    dict[3] = c; w = c; result.push(c);
    for (;;) {
      if (data.index > length) return '';
      let cc = bits(numBits);
      if (cc === 0 || cc === 1) {
        dict[dictSize++] = String.fromCharCode(bits(cc === 0 ? 8 : 16));
        cc = dictSize - 1;
        enlargeIn--;
      } else if (cc === 2) return result.join('');
      if (enlargeIn === 0) { enlargeIn = 2 ** numBits; numBits++; }
      let entry;
      if (dict[cc]) entry = dict[cc];
      else if (cc === dictSize) entry = w + w.charAt(0);
      else return null;
      result.push(entry);
      dict[dictSize++] = w + entry.charAt(0);
      enlargeIn--;
      w = entry;
      if (enlargeIn === 0) { enlargeIn = 2 ** numBits; numBits++; }
    }
  }

  const api = {
    COLORS, FONTS, BOUND_PAD,
    randomId, randomInt, rng, newElement, mutate,
    isLinear, hasPoints, isShape, canContainText, isBindable, isTransparent, isCurved,
    rotate, dist, absBox, bounds, commonBounds, absPoints, setAbsPoints, syncPointsSize, curvePoints,
    linearMidpoint, pointAlong, hitTest, toLocal, outlinePoint, distToPolyline, insidePolygon,
    fontCss, fontString, lineHeightOf, measureText, wrapText, textWidth, refreshText, layoutBoundText, boundTextMaxWidth, textLines,
    shapeOf, buildShape, hatchLines, themeColor, parseColor, drawElement, toSVG,
    isEquation, equationColor, tintSvg, svgDataURL, svgFromDataURL,
    emptyScene, restore, sceneJSON, parseDrawing, serializeDrawing, serializeMd, lzDecompressFromBase64,
  };
  root.CinderSketch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
