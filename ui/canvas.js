/* Folio canvas: an infinite board of cards (text, notes, images, links, groups) joined by
 * arrows. Files are JSON Canvas (https://jsoncanvas.org), the format Obsidian's Canvas
 * uses, so the same .canvas file opens in both. Cards are DOM elements in a transformed
 * "world" layer; arrows are SVG. Pure helpers (parse/serialize/geometry/toSVG) don't
 * touch the DOM, so they can be tested under Node. */
'use strict';

(function (root) {
  // ============================================================ model & geometry

  const PRESETS = { 1: 'red', 2: 'orange', 3: 'yellow', 4: 'green', 5: 'cyan', 6: 'purple' };
  const PRESET_HEX = { 1: '#e03131', 2: '#f08c00', 3: '#e0b000', 4: '#2f9e44', 5: '#0c8599', 6: '#7048e8' };
  const SIDES = ['top', 'right', 'bottom', 'left'];
  const NORMAL = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

  function randomId() {
    const b = new Uint8Array(8);
    (globalThis.crypto || require('crypto').webcrypto).getRandomValues(b);
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  function parseCanvas(text) {
    if (!text || !text.trim()) return { nodes: [], edges: [] };
    const d = JSON.parse(text);
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('This file isn’t a canvas.');
    const num = (v, dflt) => (typeof v === 'number' && isFinite(v) ? v : dflt);
    const nodes = (Array.isArray(d.nodes) ? d.nodes : []).filter(n => n && typeof n === 'object' && n.id && n.type).map(n => ({
      ...n, x: num(n.x, 0), y: num(n.y, 0), width: Math.max(1, num(n.width, 250)), height: Math.max(1, num(n.height, 60)),
    }));
    const ids = new Set(nodes.map(n => n.id));
    const edges = (Array.isArray(d.edges) ? d.edges : []).filter(e => e && e.id && ids.has(e.fromNode) && ids.has(e.toNode));
    return { ...d, nodes, edges };
  }
  // Obsidian writes tab-indented JSON.
  const serializeCanvas = data => JSON.stringify(data, null, '\t');

  const sidePoint = (n, side) => {
    switch (side) {
      case 'top': return [n.x + n.width / 2, n.y];
      case 'bottom': return [n.x + n.width / 2, n.y + n.height];
      case 'left': return [n.x, n.y + n.height / 2];
      default: return [n.x + n.width, n.y + n.height / 2];
    }
  };
  // The sides two cards should connect through when the file doesn't say.
  function autoSides(a, b) {
    const dx = (b.x + b.width / 2) - (a.x + a.width / 2), dy = (b.y + b.height / 2) - (a.y + a.height / 2);
    if (Math.abs(dx) * (a.height + b.height) >= Math.abs(dy) * (a.width + b.width)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
    return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  }
  function sideToward(n, p) {
    const cx = n.x + n.width / 2, cy = n.y + n.height / 2, dx = p[0] - cx, dy = p[1] - cy;
    if (Math.abs(dx) / (n.width || 1) > Math.abs(dy) / (n.height || 1)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'bottom' : 'top';
  }

  // Cubic Bézier for an edge: [p0, c1, c2, p3] plus the sides used.
  function edgeCurve(e, byId, toPoint) {
    const a = byId.get(e.fromNode), b = toPoint ? null : byId.get(e.toNode);
    if (!a || (!b && !toPoint)) return null;
    let [fs, ts] = b ? autoSides(a, b) : [sideToward(a, toPoint), null];
    if (e.fromSide) fs = e.fromSide;
    if (b && e.toSide) ts = e.toSide;
    const p0 = sidePoint(a, fs), p3 = b ? sidePoint(b, ts) : toPoint;
    const d = Math.min(160, Math.max(30, Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / 2));
    const n0 = NORMAL[fs], n3 = ts ? NORMAL[ts] : [-n0[0], -n0[1]];
    const c1 = [p0[0] + n0[0] * d, p0[1] + n0[1] * d];
    const c2 = b || ts ? [p3[0] + n3[0] * d, p3[1] + n3[1] * d] : [p3[0] - n0[0] * d * 0.3, p3[1] - n0[1] * d * 0.3];
    return { p0, c1, c2, p3, fs, ts };
  }
  function bez(c, t) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, d = t * t * t;
    return [a * c.p0[0] + b * c.c1[0] + cc * c.c2[0] + d * c.p3[0], a * c.p0[1] + b * c.c1[1] + cc * c.c2[1] + d * c.p3[1]];
  }
  const f1 = v => Math.round(v * 10) / 10;
  // Path data for the curve, pulled back from an arrow end so the line meets the arrowhead.
  function curvePath(c, startArrow, endArrow, size) {
    const back = (p, q) => { const l = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1; return [p[0] + (q[0] - p[0]) / l * size * 0.8, p[1] + (q[1] - p[1]) / l * size * 0.8]; };
    const p0 = startArrow ? back(c.p0, c.c1) : c.p0, p3 = endArrow ? back(c.p3, c.c2) : c.p3;
    return `M${f1(p0[0])} ${f1(p0[1])}C${f1(c.c1[0])} ${f1(c.c1[1])} ${f1(c.c2[0])} ${f1(c.c2[1])} ${f1(p3[0])} ${f1(p3[1])}`;
  }
  function arrowHead(tip, from, size) {
    const l = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1, ux = (tip[0] - from[0]) / l, uy = (tip[1] - from[1]) / l;
    const bx = tip[0] - ux * size, by = tip[1] - uy * size, w = size * 0.55;
    return `M${f1(tip[0])} ${f1(tip[1])}L${f1(bx - uy * w)} ${f1(by + ux * w)}L${f1(bx + uy * w)} ${f1(by - ux * w)}Z`;
  }
  const hasEndArrow = e => (e.toEnd ?? 'arrow') === 'arrow';
  const hasStartArrow = e => e.fromEnd === 'arrow';

  function boundsOf(nodes) {
    if (!nodes.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const n of nodes) { x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x + n.width); y2 = Math.max(y2, n.y + n.height); }
    return { x1, y1, x2, y2 };
  }
  const inside = (n, g) => n !== g && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height;

  // Every vault file a canvas points at (file cards), for backlinks and renames.
  const fileRefs = data => [...new Set(data.nodes.filter(n => n.type === 'file' && n.file).map(n => n.file))];

  // Rewrite file cards after a rename/move (map: old path -> new path). Returns true if changed.
  function renameRefs(data, map) {
    let changed = false;
    for (const n of data.nodes) if (n.type === 'file' && map.has(n.file)) { n.file = map.get(n.file); changed = true; }
    return changed;
  }

  // Plain text of a Markdown card, for previews.
  function plainText(md) {
    return String(md || '')
      .replace(/^---\n[\s\S]*?\n---\n?/, '')
      .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*/g, ''))
      .replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a)
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, '☐ ').replace(/^\s*[-*+]\s+/gm, '• ')
      .replace(/(\*\*|__|==|~~|`)/g, '').replace(/^>\s?(\[!\w+\]\s*)?/gm, '');
  }
  function wrapLines(text, maxChars, maxLines) {
    const out = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const w of para.split(/\s+/)) {
        if (!w) continue;
        if ((line + ' ' + w).trim().length > maxChars && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
        while (line.length > maxChars) { out.push(line.slice(0, maxChars)); line = line.slice(maxChars); }
      }
      out.push(line);
      if (out.length > maxLines) break;
    }
    while (out.length && !out[out.length - 1]) out.pop();
    if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] += '…'; } // there was more
    return out;
  }

  const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // A static picture of a canvas for ![[x.canvas]] embeds.
  // o: {colors: {1..6: hex}, text, muted, bg, border, accent, noteText(path) -> string|null, name(path) -> string}
  function toSVG(data, o = {}) {
    const nodes = data.nodes || [], byId = new Map(nodes.map(n => [n.id, n]));
    const b = boundsOf(nodes) || { x1: 0, y1: 0, x2: 200, y2: 100 };
    const pad = 40, x = b.x1 - pad, y = b.y1 - pad - 20, w = b.x2 - b.x1 + pad * 2, h = b.y2 - b.y1 + pad * 2 + 20;
    const col = c => !c ? null : o.colors?.[c] || PRESET_HEX[c] || (/^#[0-9a-f]{3,8}$/i.test(c) ? c : null);
    const text = o.text || '#222', muted = o.muted || '#666', border = o.border || '#bbb', bg = o.bg || '#fff';
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f1(x)} ${f1(y)} ${f1(w)} ${f1(h)}" width="${f1(w)}" height="${f1(h)}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`];
    for (const n of nodes) {
      const c = col(n.color);
      if (n.type === 'group') {
        out.push(`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="12" fill="${c || border}" fill-opacity="0.07" stroke="${c || border}" stroke-width="2"/>`);
        if (n.label) out.push(`<text x="${n.x + 4}" y="${n.y - 8}" font-size="16" font-weight="600" fill="${c || muted}">${xmlEsc(n.label)}</text>`);
      }
    }
    for (const e of data.edges || []) {
      const cv = edgeCurve(e, byId);
      if (!cv) continue;
      const c = col(e.color) || muted, sz = 12;
      out.push(`<path d="${curvePath(cv, hasStartArrow(e), hasEndArrow(e), sz)}" fill="none" stroke="${c}" stroke-width="2"/>`);
      if (hasEndArrow(e)) out.push(`<path d="${arrowHead(cv.p3, cv.c2, sz)}" fill="${c}"/>`);
      if (hasStartArrow(e)) out.push(`<path d="${arrowHead(cv.p0, cv.c1, sz)}" fill="${c}"/>`);
      if (e.label) { const [mx, my] = bez(cv, 0.5); out.push(`<rect x="${f1(mx - e.label.length * 3.8 - 6)}" y="${f1(my - 11)}" width="${f1(e.label.length * 7.6 + 12)}" height="22" rx="5" fill="${bg}"/><text x="${f1(mx)}" y="${f1(my + 5)}" font-size="13" text-anchor="middle" fill="${muted}">${xmlEsc(e.label)}</text>`); }
    }
    for (const n of nodes) {
      if (n.type === 'group') continue;
      const c = col(n.color);
      out.push(`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10" fill="${bg}"/>`);
      if (c) out.push(`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10" fill="${c}" fill-opacity="0.08"/>`);
      out.push(`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10" fill="none" stroke="${c || border}" stroke-width="2"/>`);
      let body = '', title = null;
      if (n.type === 'text') body = plainText(n.text);
      else if (n.type === 'file') { title = o.name ? o.name(n.file) : n.file; const t = o.noteText && o.noteText(n.file); body = t == null ? n.file : plainText(t); }
      else if (n.type === 'link') { title = 'Link'; body = n.url || ''; }
      let ty = n.y + 26;
      if (title) {
        out.push(`<text x="${n.x}" y="${n.y - 8}" font-size="14" fill="${muted}">${xmlEsc(title)}</text>`);
      }
      const lines = wrapLines(body, Math.max(4, Math.floor((n.width - 28) / 7.4)), Math.max(1, Math.floor((n.height - 20) / 20)));
      for (const line of lines) { out.push(`<text x="${n.x + 14}" y="${ty}" font-size="14" fill="${text}">${xmlEsc(line)}</text>`); ty += 20; }
    }
    out.push('</svg>');
    return out.join('');
  }

  const pure = { PRESETS, PRESET_HEX, randomId, parseCanvas, serializeCanvas, autoSides, sideToward, sidePoint, edgeCurve, boundsOf, inside, fileRefs, renameRefs, plainText, wrapLines, toSVG };

  if (typeof document === 'undefined') { // Node: the pure parts only
    if (typeof module !== 'undefined' && module.exports) module.exports = pure;
    return;
  }

  // ============================================================ editor

  let rootEl, viewport, bgEl, world, svg, labels, guidesEl, marquee, selBar, minimap, mm, hintEl, zoomLabel, hooks;
  let data = { nodes: [], edges: [] };
  let byId = new Map();
  let view = { x: 0, y: 0, z: 1 };
  let sel = new Set(), selEdge = null;
  let action = null, editing = null, visible = false, raf = 0, spaceDown = false, showMap = true;
  let hist = { undo: [], redo: [], cur: '' };
  let fromPath = '';
  let pointerWorld = [0, 0];
  const nodeEls = new Map(); // id -> {el, key}

  const $ = (s, el = rootEl) => el.querySelector(s);
  const esc = xmlEsc;
  const ICON = p => `<svg viewBox="0 0 24 24">${p}</svg>`;

  function init(container, h) {
    rootEl = container; hooks = h;
    rootEl.innerHTML = `
      <div class="cv-viewport" tabindex="0">
        <div class="cv-bg"></div>
        <div class="cv-world"><svg class="cv-edges"></svg><div class="cv-nodes"></div><div class="cv-labels"></div><svg class="cv-guides"></svg></div>
        <div class="cv-marquee" hidden></div>
        <div class="cv-hint"></div>
      </div>
      <div class="cv-selbar dr-island" hidden></div>
      <div class="cv-toolbar dr-island">
        <button class="dr-btn" data-act="add-text" title="Add card (double-click the canvas)">${ICON('<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M8 10h8M8 14h5"/>')}</button>
        <button class="dr-btn" data-act="add-note" title="Add note from vault">${ICON('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>')}</button>
        <button class="dr-btn" data-act="add-media" title="Add image or file from vault">${ICON('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="M20.5 16l-5-5L5 19.5"/>')}</button>
        <button class="dr-btn" data-act="add-link" title="Add web link card">${ICON('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>')}</button>
        <button class="dr-btn" data-act="add-group" title="Add group (Ctrl+G groups the selection)">${ICON('<rect x="3.5" y="5.5" width="17" height="14" rx="2" stroke-dasharray="3 2.5"/><path d="M3.5 5.5h7"/>')}</button>
      </div>
      <div class="dr-bottom cv-bottom">
        <div class="dr-island dr-row"><button class="dr-btn" data-act="zoom-out" title="Zoom out (Ctrl+-)">${ICON('<path d="M6 12h12"/>')}</button><button class="dr-btn dr-zoom" data-act="zoom-reset" title="Reset zoom (Ctrl+0)">100%</button><button class="dr-btn" data-act="zoom-in" title="Zoom in (Ctrl+=)">${ICON('<path d="M6 12h12M12 6v12"/>')}</button><button class="dr-btn" data-act="fit" title="Zoom to fit (Shift+1)">${ICON('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}</button></div>
        <div class="dr-island dr-row"><button class="dr-btn" data-act="undo" title="Undo (Ctrl+Z)">${ICON('<path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>')}</button><button class="dr-btn" data-act="redo" title="Redo (Ctrl+Y)">${ICON('<path d="M15 14l4.5-4.5L15 5"/><path d="M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3"/>')}</button></div>
        <div class="dr-island dr-row"><button class="dr-btn" data-act="map" title="Show or hide the minimap">${ICON('<path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>')}</button><button class="dr-btn" data-act="help" title="Canvas shortcuts (?)">${ICON('<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.6a2.3 2.3 0 1 1 3.3 2.1c-.7.4-1.1.9-1.1 1.7v.4M12 16.8v.2"/>')}</button></div>
      </div>
      <canvas class="cv-minimap dr-island" width="200" height="130"></canvas>`;
    viewport = $('.cv-viewport'); bgEl = $('.cv-bg'); world = $('.cv-world'); svg = $('.cv-edges');
    labels = $('.cv-labels'); guidesEl = $('.cv-guides'); marquee = $('.cv-marquee'); selBar = $('.cv-selbar');
    minimap = $('.cv-minimap'); mm = minimap.getContext('2d'); hintEl = $('.cv-hint'); zoomLabel = $('.dr-zoom');
    try { showMap = hooks.store?.('canvasMinimap') ?? true; } catch { }

    viewport.addEventListener('pointerdown', onDown);
    viewport.addEventListener('pointermove', onMove);
    viewport.addEventListener('pointerup', onUp);
    viewport.addEventListener('pointercancel', onUp);
    viewport.addEventListener('dblclick', onDouble);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('contextmenu', onContext);
    viewport.addEventListener('dragover', e => e.preventDefault());
    viewport.addEventListener('drop', onDrop);
    viewport.addEventListener('click', onContentClick);
    rootEl.addEventListener('click', onUiClick);
    minimap.addEventListener('pointerdown', onMapDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });
    document.addEventListener('copy', e => onClip(e, false));
    document.addEventListener('cut', e => onClip(e, true));
    document.addEventListener('paste', onPaste);
    new ResizeObserver(() => request()).observe(viewport);
  }

  // ------------------------------------------------------------ state

  const rebuildIndex = () => { byId = new Map(data.nodes.map(n => [n.id, n])); };
  const snapshot = () => JSON.stringify({ nodes: data.nodes, edges: data.edges });

  function load(d, opts = {}) {
    stopEditing(false);
    data = d; rebuildIndex();
    fromPath = opts.path || '';
    sel = new Set(); selEdge = null; action = null;
    for (const { el } of nodeEls.values()) el.remove();
    nodeEls.clear();
    hist = { undo: [], redo: [], cur: snapshot() };
    if (opts.view) view = { ...opts.view };
    else fit(false);
    request();
  }
  const getData = () => data;

  function commit() {
    rebuildIndex();
    const s = snapshot();
    if (s === hist.cur) return;
    hist.undo.push(hist.cur);
    if (hist.undo.length > 200) hist.undo.shift();
    hist.cur = s; hist.redo = [];
    hooks.onChange?.();
    request();
  }
  function restore(s) {
    stopEditing(false);
    hist.cur = s;
    const d = JSON.parse(s);
    data.nodes = d.nodes; data.edges = d.edges;
    rebuildIndex();
    sel = new Set([...sel].filter(id => byId.has(id)));
    if (selEdge && !data.edges.some(e => e.id === selEdge)) selEdge = null;
    hooks.onChange?.();
    request();
  }
  function undo() { if (hist.undo.length) { hist.redo.push(hist.cur); restore(hist.undo.pop()); } }
  function redo() { if (hist.redo.length) { hist.undo.push(hist.cur); restore(hist.redo.pop()); } }

  // ------------------------------------------------------------ coordinates

  const vw = () => viewport.clientWidth, vh = () => viewport.clientHeight;
  function toWorld(cx, cy) { const r = viewport.getBoundingClientRect(); return [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z]; }
  function zoomAt(sx, sy, z) {
    z = Math.max(0.1, Math.min(4, z));
    const wx = (sx - view.x) / view.z, wy = (sy - view.y) / view.z;
    view.z = z; view.x = sx - wx * z; view.y = sy - wy * z;
    request();
  }
  function fit(render = true, only) {
    const b = boundsOf(only && only.length ? only : data.nodes);
    if (!b || !vw()) { view = { x: (vw() || 800) / 2, y: (vh() || 600) / 3, z: 1 }; if (render) request(); return; }
    const w = b.x2 - b.x1, h = b.y2 - b.y1;
    const z = Math.max(0.1, Math.min(1, (vw() - 120) / (w || 1), (vh() - 160) / (h || 1)));
    view = { z, x: vw() / 2 - (b.x1 + w / 2) * z, y: vh() / 2 - (b.y1 + h / 2) * z };
    if (render) request();
  }
  function viewCenter() { return [(vw() / 2 - view.x) / view.z, (vh() / 2 - view.y) / view.z]; }

  // ------------------------------------------------------------ node operations

  function addNode(props, at, { edit = false, select = true } = {}) {
    const n = { id: randomId(), x: 0, y: 0, width: 260, height: 70, ...props };
    if (at) { n.x = Math.round(at[0] - n.width / 2); n.y = Math.round(at[1] - n.height / 2); }
    if (n.type === 'group') data.nodes.unshift(n); else data.nodes.push(n);
    rebuildIndex();
    if (select) { sel = new Set([n.id]); selEdge = null; }
    commit();
    if (edit) startEditing(n.id);
    return n;
  }
  function addEdge(from, fromSide, to, toSide) {
    if (from === to) return null;
    const e = { id: randomId(), fromNode: from, fromSide, toNode: to, toSide };
    data.edges.push(e);
    commit();
    return e;
  }
  function deleteSelection() {
    if (selEdge) { data.edges = data.edges.filter(e => e.id !== selEdge); selEdge = null; commit(); return; }
    if (!sel.size) return;
    data.nodes = data.nodes.filter(n => !sel.has(n.id));
    data.edges = data.edges.filter(e => !sel.has(e.fromNode) && !sel.has(e.toNode));
    sel = new Set();
    commit();
  }
  const selectedNodes = () => data.nodes.filter(n => sel.has(n.id));

  function cloneNodes(nodes, edges, dx, dy) {
    const map = new Map(nodes.map(n => [n.id, randomId()]));
    const ns = nodes.map(n => ({ ...JSON.parse(JSON.stringify(n)), id: map.get(n.id), x: n.x + dx, y: n.y + dy }));
    const es = edges.filter(e => map.has(e.fromNode) && map.has(e.toNode)).map(e => ({ ...JSON.parse(JSON.stringify(e)), id: randomId(), fromNode: map.get(e.fromNode), toNode: map.get(e.toNode) }));
    return { nodes: ns, edges: es };
  }
  function insertClones({ nodes, edges }) {
    data.nodes.unshift(...nodes.filter(n => n.type === 'group'));
    data.nodes.push(...nodes.filter(n => n.type !== 'group'));
    data.edges.push(...edges);
    sel = new Set(nodes.map(n => n.id)); selEdge = null;
    commit();
  }
  function duplicate() {
    const ns = selectedNodes();
    if (!ns.length) return;
    insertClones(cloneNodes(ns, data.edges, 30, 30));
  }

  function groupSelection() {
    const ns = selectedNodes();
    if (!ns.length) return;
    const b = boundsOf(ns), p = 30;
    const g = addNode({ type: 'group', label: 'Group', x: b.x1 - p, y: b.y1 - p - 10, width: b.x2 - b.x1 + p * 2, height: b.y2 - b.y1 + p * 2 + 10 }, null, { select: true });
    startEditing(g.id);
  }

  function setColor(color) {
    for (const n of selectedNodes()) { if (color) n.color = color; else delete n.color; }
    if (selEdge) { const e = data.edges.find(x => x.id === selEdge); if (e) { if (color) e.color = color; else delete e.color; } }
    commit();
  }

  function reorder(front) {
    const moving = data.nodes.filter(n => sel.has(n.id)), rest = data.nodes.filter(n => !sel.has(n.id));
    data.nodes = front ? [...rest, ...moving] : [...moving, ...rest];
    commit();
  }

  // Tab: a new card to the right, connected (mind-map style). Children stack downward.
  function addChild() {
    const ns = selectedNodes();
    if (ns.length !== 1) return;
    const p = ns[0];
    const kids = data.edges.filter(e => e.fromNode === p.id).map(e => byId.get(e.toNode)).filter(k => k && k.x > p.x + p.width);
    const y = kids.length ? Math.max(...kids.map(k => k.y + k.height)) + 30 : p.y + (p.height - 70) / 2;
    const n = addNode({ type: 'text', text: '', x: p.x + p.width + 100, y, width: 260, height: 70, ...(p.color ? { color: p.color } : {}) }, null, { select: true });
    data.edges.push({ id: randomId(), fromNode: p.id, fromSide: 'right', toNode: n.id, toSide: 'left' });
    commit();
    ensureVisible(n);
    startEditing(n.id);
  }
  // Alt+arrow: jump to the nearest card in that direction, preferring connected ones.
  function jump(dir) {
    const ns = selectedNodes();
    if (ns.length !== 1) return;
    const a = ns[0], ax = a.x + a.width / 2, ay = a.y + a.height / 2;
    const linked = new Set(data.edges.flatMap(e => e.fromNode === a.id ? [e.toNode] : e.toNode === a.id ? [e.fromNode] : []));
    let best = null, bd = Infinity;
    for (const n of data.nodes) {
      if (n === a || n.type === 'group') continue;
      const dx = n.x + n.width / 2 - ax, dy = n.y + n.height / 2 - ay;
      const along = dir === 'ArrowRight' ? dx : dir === 'ArrowLeft' ? -dx : dir === 'ArrowDown' ? dy : -dy;
      const across = dir === 'ArrowRight' || dir === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
      if (along <= 0) continue;
      const score = (along + across * 2) * (linked.has(n.id) ? 0.5 : 1);
      if (score < bd) { bd = score; best = n; }
    }
    if (best) { sel = new Set([best.id]); selEdge = null; ensureVisible(best); request(); }
  }
  function ensureVisible(n) {
    const m = 60, sx1 = n.x * view.z + view.x, sy1 = n.y * view.z + view.y, sx2 = sx1 + n.width * view.z, sy2 = sy1 + n.height * view.z;
    if (sx1 < m) view.x += m - sx1; else if (sx2 > vw() - m) view.x -= sx2 - (vw() - m);
    if (sy1 < m) view.y += m - sy1; else if (sy2 > vh() - 90) view.y -= sy2 - (vh() - 90);
    request();
  }

  async function convertToNote() {
    const ns = selectedNodes();
    if (ns.length !== 1 || ns[0].type !== 'text') return;
    const n = ns[0];
    const path = await hooks.createNoteFromText?.(n.text || '');
    if (!path) return;
    delete n.text;
    n.type = 'file'; n.file = path;
    commit();
  }

  // ------------------------------------------------------------ editing text / labels

  const isNoteCard = n => n?.type === 'file' && /\.md$/i.test(n.file || '') && !!hooks.mountEditor && hooks.fileExists?.(n.file) !== false;

  // Text and note cards get the live-preview Markdown editor (hooks.mountEditor). A note card
  // edits the note itself, which saves as you type; a text card saves when editing ends.
  function startCardEditor(n, rec) {
    const host = document.createElement('div');
    host.className = 'cv-cm';
    host.addEventListener('pointerdown', e => e.stopPropagation());
    rec.el.append(host);
    const exit = () => { stopEditing(true); viewport.focus({ preventScroll: true }); return true; };
    const text = n.type === 'text';
    const ctl = hooks.mountEditor(host, text
      ? { text: n.text || '', from: fromPath, placeholder: 'Write… (Esc when done)', onChange: t => { if (editing?.host === host) { editing.value = t; growToFit(n, host); } }, onExit: exit, onTab: () => { stopEditing(true); addChild(); return true; } }
      : { notePath: n.file, onExit: exit });
    if (!ctl) { host.remove(); return false; }
    rec.el.classList.add('editing');
    editing = { id: n.id, type: n.type, host, ctl, value: n.text || '' };
    sel = new Set([n.id]);
    // Focus leaving the card (other than into the editor's own popups) finishes editing.
    host.addEventListener('focusout', () => setTimeout(() => {
      const a = document.activeElement;
      if (editing?.host === host && !host.contains(a) && !a?.closest?.('.cm-tooltip, .modal, .menu, .modal-bg')) stopEditing(true);
    }, 0));
    setTimeout(() => ctl.focus(), 0);
    request();
    return true;
  }

  function startEditing(id) {
    stopEditing(true);
    const n = byId.get(id);
    if (!n) return;
    const rec = nodeEls.get(id) || (render(), nodeEls.get(id));
    if (!rec) return;
    if ((n.type === 'text' && hooks.mountEditor) || isNoteCard(n)) { if (startCardEditor(n, rec)) return; }
    if (n.type !== 'text' && n.type !== 'group' && n.type !== 'link') return;
    const ta = document.createElement(n.type === 'text' ? 'textarea' : 'input');
    ta.className = n.type === 'text' ? 'cv-editor' : 'cv-label-editor';
    ta.spellcheck = n.type === 'text';
    ta.value = n.type === 'text' ? n.text || '' : n.type === 'group' ? n.label || '' : n.url || '';
    if (n.type === 'link') ta.placeholder = 'https://…';
    rec.el.classList.add('editing');
    (n.type === 'group' ? rec.el.querySelector('.cv-label') : rec.el).append(ta);
    editing = { id, ta, type: n.type };
    sel = new Set([id]);
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (n.type !== 'text' || e.ctrlKey || e.metaKey))) { e.preventDefault(); stopEditing(true); viewport.focus(); }
      if (n.type === 'text' && e.key === 'Tab') { e.preventDefault(); stopEditing(true); addChild(); }
    });
    ta.addEventListener('blur', () => setTimeout(() => { if (editing?.ta === ta && document.activeElement !== ta) stopEditing(true); }, 0));
    ta.addEventListener('pointerdown', e => e.stopPropagation());
    ta.addEventListener('input', () => { if (n.type === 'text') growToFit(n, ta); });
    // Card text: cursor at the end. Labels and links: selected, so typing replaces them.
    setTimeout(() => { ta.focus(); if (n.type === 'text') ta.setSelectionRange(ta.value.length, ta.value.length); else ta.select(); }, 0);
    request();
  }
  function stopEditing(save) {
    if (!editing) return;
    const { id, ta, type, host, ctl } = editing;
    const value = ta ? ta.value : editing.value;
    editing = null;
    if (ctl) { ctl.destroy(); host.remove(); } else ta.remove();
    const rec = nodeEls.get(id);
    rec?.el.classList.remove('editing');
    const n = byId.get(id);
    if (!n) return;
    if (type === 'file') { if (rec) rec.key = null; request(); return; } // the note saved itself
    if (save) {
      if (type === 'text') {
        if (!value.trim() && !n.text) { data.nodes = data.nodes.filter(x => x !== n); data.edges = data.edges.filter(e => e.fromNode !== id && e.toNode !== id); sel.delete(id); }
        else { n.text = value; }
      } else if (type === 'group') n.label = value.trim() || undefined;
      else if (type === 'link') n.url = value.trim();
      commit();
      if (type === 'text' && byId.has(id)) requestAnimationFrame(() => fitHeight(byId.get(id)));
    }
    request();
  }
  // Text cards grow to fit what's typed into them (they never shrink on their own).
  function growToFit(n, el) {
    const cm = el.querySelector?.('.cm-content');
    const need = cm ? cm.offsetHeight + 16 : el.scrollHeight + 4;
    if (need > n.height) { n.height = Math.min(4000, Math.ceil(need)); request(); }
  }
  function fitHeight(n) {
    const rec = n && nodeEls.get(n.id);
    const c = rec?.el.querySelector('.cv-content');
    if (!c) return;
    const need = c.scrollHeight + 2;
    if (need > n.height + 1) { n.height = Math.min(4000, Math.ceil(need)); commit(); }
  }

  function editEdgeLabel(e) {
    Promise.resolve(hooks.prompt?.('Arrow label', 'Label (empty to remove)', e.label || '')).then(v => {
      if (v == null) return;
      if (v.trim()) e.label = v.trim(); else delete e.label;
      commit();
    });
  }

  // ------------------------------------------------------------ pointer input

  const hitNode = target => target.closest?.('.cv-node');

  function onDown(e) {
    if (e.button === 2) return;
    if (e.target.closest('.cv-editor, .cv-label-editor, .cv-cm')) return;
    viewport.focus({ preventScroll: true });
    pointerWorld = toWorld(e.clientX, e.clientY);
    const [wx, wy] = pointerWorld;
    if (editing) stopEditing(true);
    if (e.button === 1 || spaceDown) { action = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; viewport.setPointerCapture(e.pointerId); viewport.classList.add('panning'); return; }
    const side = e.target.closest('.cv-side');
    if (side) {
      const id = side.closest('.cv-node').dataset.id;
      action = { type: 'connect', from: id, side: side.dataset.side, to: [wx, wy] };
      viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const rz = e.target.closest('.cv-resize');
    if (rz) {
      const n = byId.get(rz.closest('.cv-node').dataset.id);
      action = { type: 'resize', n, dir: rz.dataset.dir, start: [wx, wy], orig: { x: n.x, y: n.y, w: n.width, h: n.height } };
      viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const edgeEl = e.target.closest('[data-edge]');
    if (edgeEl) { selEdge = edgeEl.dataset.edge; sel = new Set(); request(); return; }
    const nodeEl = hitNode(e.target);
    if (nodeEl) {
      const id = nodeEl.dataset.id, n = byId.get(id);
      // Interactive bits inside a selected card (links, checkboxes, scrolling) work normally.
      if (sel.has(id) && sel.size === 1 && e.target.closest('a, input, button, .cv-content img') && !e.target.closest('.cv-label')) return;
      selEdge = null;
      if (e.shiftKey || e.ctrlKey || e.metaKey) { sel.has(id) ? sel.delete(id) : sel.add(id); request(); if (!sel.has(id)) return; }
      else if (!sel.has(id)) sel = new Set([id]);
      // Moving a group carries what's inside it.
      const moving = new Set(sel);
      for (const g of selectedNodes()) if (g.type === 'group') for (const m of data.nodes) if (inside(m, g)) moving.add(m.id);
      action = { type: 'move', start: [wx, wy], sx: e.clientX, sy: e.clientY, moved: false, clicked: id, orig: new Map([...moving].map(i => [i, { x: byId.get(i).x, y: byId.get(i).y }])) };
      viewport.setPointerCapture(e.pointerId);
      request();
      if (n.type !== 'text' || !sel.has(id)) e.preventDefault();
      return;
    }
    if (!e.shiftKey) { sel = new Set(); selEdge = null; }
    action = { type: 'marquee', x0: wx, y0: wy, base: new Set(sel), sx: e.clientX, sy: e.clientY };
    viewport.setPointerCapture(e.pointerId);
    request();
  }

  function onMove(e) {
    pointerWorld = toWorld(e.clientX, e.clientY);
    if (!action) return;
    const [wx, wy] = pointerWorld;
    switch (action.type) {
      case 'pan': view.x = action.vx + e.clientX - action.sx; view.y = action.vy + e.clientY - action.sy; break;
      case 'move': {
        if (!action.moved && Math.hypot(e.clientX - action.sx, e.clientY - action.sy) < 4) return;
        action.moved = true;
        let dx = wx - action.start[0], dy = wy - action.start[1];
        if (!(e.ctrlKey || e.metaKey)) [dx, dy] = snapMove(dx, dy);
        for (const [id, o] of action.orig) { const n = byId.get(id); if (n) { n.x = Math.round(o.x + dx); n.y = Math.round(o.y + dy); } }
        break;
      }
      case 'resize': {
        const { n, dir, start, orig } = action;
        const dx = wx - start[0], dy = wy - start[1];
        if (dir.includes('e')) n.width = Math.max(60, Math.round(orig.w + dx));
        if (dir.includes('s')) n.height = Math.max(36, Math.round(orig.h + dy));
        if (dir.includes('w')) { const w = Math.max(60, Math.round(orig.w - dx)); n.x = orig.x + orig.w - w; n.width = w; }
        if (dir.includes('n')) { const h = Math.max(36, Math.round(orig.h - dy)); n.y = orig.y + orig.h - h; n.height = h; }
        break;
      }
      case 'connect': action.to = [wx, wy]; action.over = targetAt(e, action.from); break;
      case 'marquee': {
        action.x1 = wx; action.y1 = wy;
        const x1 = Math.min(action.x0, wx), x2 = Math.max(action.x0, wx), y1 = Math.min(action.y0, wy), y2 = Math.max(action.y0, wy);
        sel = new Set(action.base);
        for (const n of data.nodes) if (n.x >= x1 && n.y >= y1 && n.x + n.width <= x2 && n.y + n.height <= y2) sel.add(n.id);
        break;
      }
    }
    request();
  }

  function targetAt(e, from) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const nodeEl = el?.closest?.('.cv-node');
    if (!nodeEl || nodeEl.dataset.id === from) return null;
    return { id: nodeEl.dataset.id, side: el.closest('.cv-side')?.dataset.side || null };
  }

  function onUp(e) {
    const a = action;
    action = null;
    viewport.classList.remove('panning');
    try { viewport.releasePointerCapture(e.pointerId); } catch { }
    guidesEl.innerHTML = '';
    if (!a) return;
    if (a.type === 'move') {
      if (a.moved) commit();
      else if (!e.shiftKey && !e.ctrlKey && !e.metaKey && sel.size > 1) { sel = new Set([a.clicked]); request(); }
    } else if (a.type === 'resize') commit();
    else if (a.type === 'connect') {
      const t = targetAt(e, a.from);
      if (t) {
        const to = byId.get(t.id), from = byId.get(a.from);
        const toSide = t.side || sideToward(to, sidePoint(from, a.side));
        addEdge(a.from, a.side, t.id, toSide);
      } else if (Math.hypot(a.to[0] - sidePoint(byId.get(a.from), a.side)[0], a.to[1] - sidePoint(byId.get(a.from), a.side)[1]) > 30) {
        // Dropped on empty canvas: a new card there, connected.
        const opp = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[a.side];
        const w = 260, h = 70, [x, y] = a.to;
        const pos = { right: [x, y - h / 2], left: [x - w, y - h / 2], bottom: [x - w / 2, y], top: [x - w / 2, y - h] }[a.side];
        const n = addNode({ type: 'text', text: '', x: Math.round(pos[0]), y: Math.round(pos[1]), width: w, height: h }, null);
        data.edges.push({ id: randomId(), fromNode: a.from, fromSide: a.side, toNode: n.id, toSide: opp });
        commit();
        ensureVisible(n);
        startEditing(n.id);
      }
    }
    request();
  }

  // Alignment guides: snap the moving selection's edges/centres to other cards'.
  function snapMove(dx, dy) {
    const moving = [...action.orig.keys()].map(id => byId.get(id)).filter(Boolean);
    const others = data.nodes.filter(n => !action.orig.has(n.id));
    if (!moving.length || !others.length) { guidesEl.innerHTML = ''; return [dx, dy]; }
    const o = boundsOf(moving.map(n => ({ ...n, x: action.orig.get(n.id).x, y: action.orig.get(n.id).y })));
    const tol = 6 / view.z;
    const xs = [o.x1 + dx, (o.x1 + o.x2) / 2 + dx, o.x2 + dx], ys = [o.y1 + dy, (o.y1 + o.y2) / 2 + dy, o.y2 + dy];
    let bx = null, by = null;
    for (const n of others) {
      const cx = [n.x, n.x + n.width / 2, n.x + n.width], cy = [n.y, n.y + n.height / 2, n.y + n.height];
      for (const a of xs) for (const c of cx) { const d = c - a; if (Math.abs(d) < tol && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, at: c, n }; }
      for (const a of ys) for (const c of cy) { const d = c - a; if (Math.abs(d) < tol && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, at: c, n }; }
    }
    let g = '';
    const iz = 1 / view.z;
    if (bx) { dx += bx.d; const y1 = Math.min(o.y1 + dy, bx.n.y) - 20, y2 = Math.max(o.y2 + dy, bx.n.y + bx.n.height) + 20; g += `<line x1="${bx.at}" y1="${y1}" x2="${bx.at}" y2="${y2}" stroke-width="${iz}"/>`; }
    if (by) { dy += by.d; const x1 = Math.min(o.x1 + dx, by.n.x) - 20, x2 = Math.max(o.x2 + dx, by.n.x + by.n.width) + 20; g += `<line x1="${x1}" y1="${by.at}" x2="${x2}" y2="${by.at}" stroke-width="${iz}"/>`; }
    guidesEl.innerHTML = g;
    return [dx, dy];
  }

  function onDouble(e) {
    // Pointer capture during the clicks retargets dblclick to the viewport; find what's really there.
    const target = e.target === viewport ? document.elementFromPoint(e.clientX, e.clientY) || viewport : e.target;
    if (target.closest('.cv-editor, .cv-label-editor, .cv-cm')) return;
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const edgeEl = target.closest('[data-edge]');
    if (edgeEl) { const ed = data.edges.find(x => x.id === edgeEl.dataset.edge); if (ed) editEdgeLabel(ed); return; }
    const nodeEl = hitNode(target);
    if (nodeEl) {
      const n = byId.get(nodeEl.dataset.id);
      if (!n) return;
      if (n.type === 'file') return isNoteCard(n) ? startEditing(n.id) : openFileCard(n);
      if (n.type === 'group' && !target.closest('.cv-label')) return addNode({ type: 'text', text: '' }, [wx, wy], { edit: true });
      if (n.type === 'link' && !target.closest('.cv-label')) return hooks.openUrl?.(n.url);
      return startEditing(n.id);
    }
    addNode({ type: 'text', text: '' }, [wx, wy], { edit: true });
  }

  function onWheel(e) {
    if (e.target.closest('.cv-cm') && !(e.ctrlKey || e.metaKey)) return; // scroll inside the card editor
    const content = e.target.closest('.cv-content');
    if (content && !(e.ctrlKey || e.metaKey) && content.scrollHeight > content.clientHeight + 1) {
      const n = byId.get(content.closest('.cv-node').dataset.id);
      const atEnd = e.deltaY > 0 ? content.scrollTop + content.clientHeight >= content.scrollHeight - 1 : content.scrollTop <= 0;
      if (n && sel.has(n.id) && !atEnd) return; // scroll the selected card's contents
    }
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    const mult = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, view.z * Math.exp(-e.deltaY * mult * (Math.abs(e.deltaY) < 20 ? 0.01 : 0.0022)));
    else { let dx = e.deltaX * mult, dy = e.deltaY * mult; if (e.shiftKey && !dx) { dx = dy; dy = 0; } view.x -= dx; view.y -= dy; request(); }
  }

  // Checkboxes in text cards tick the card's own Markdown.
  function onContentClick(e) {
    const cb = e.target.closest('.cv-node input[type=checkbox]');
    if (!cb) return;
    const n = byId.get(cb.closest('.cv-node').dataset.id);
    if (!n || n.type !== 'text') return;
    const boxes = [...cb.closest('.cv-content').querySelectorAll('input[type=checkbox]')];
    const idx = boxes.indexOf(cb);
    let k = 0;
    n.text = n.text.replace(/^([ \t]*(?:>[ \t]?)*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])\]/gm, (m, pre, c) => k++ === idx ? pre + (c === ' ' ? 'x' : ' ') + ']' : m);
    nodeEls.get(n.id).key = null;
    commit();
  }

  async function onDrop(e) {
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) {
      let i = 0;
      for (const f of files) {
        const path = await hooks.importFile?.(f);
        if (path) addFileNode(path, [at[0] + i * 30, at[1] + i * 30]);
        i++;
      }
      return;
    }
    const path = e.dataTransfer?.getData('text/plain');
    if (path && hooks.fileExists?.(path)) addFileNode(path, at);
  }
  // Images open in the viewer (← → through the canvas's other images); other files open as pages.
  function openFileCard(n) {
    if (IMG_RE.test(n.file) && hooks.viewImage) {
      const imgs = [...new Set(data.nodes.filter(x => x.type === 'file' && IMG_RE.test(x.file) && hooks.fileExists?.(x.file) !== false).sort((a, b) => a.y - b.y || a.x - b.x).map(x => x.file))];
      return hooks.viewImage(n.file, imgs);
    }
    hooks.openFile?.(n.file, n.subpath);
  }
  const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

  function addFileNode(path, at) {
    const img = IMG_RE.test(path);
    const note = /\.md$/i.test(path);
    return addNode({ type: 'file', file: path, width: note ? 400 : img ? 360 : 300, height: note ? 400 : img ? 260 : 80 }, at || viewCenter());
  }

  function onMapDown(e) {
    e.preventDefault();
    const go = ev => {
      const m = mapGeom();
      if (!m) return;
      const r = minimap.getBoundingClientRect();
      const wx = (ev.clientX - r.left - m.ox) / m.s, wy = (ev.clientY - r.top - m.oy) / m.s;
      view.x = vw() / 2 - wx * view.z; view.y = vh() / 2 - wy * view.z;
      request();
    };
    go(e);
    const up = () => { window.removeEventListener('pointermove', go); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', go);
    window.addEventListener('pointerup', up);
  }

  // ------------------------------------------------------------ keyboard, clipboard, menus

  // Keys belong to the canvas unless focus is in a field, a dialog or another pane (file tree, sidebars).
  const activeFor = e => visible && !editing && !e.target.closest?.('input, textarea, select, [contenteditable], #left, #right, #ribbon') && !hooks.modalOpen?.();

  function onKey(e) {
    if (!activeFor(e)) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    let handled = true;
    if (mod && k.toLowerCase() === 'z' && !e.shiftKey) undo();
    else if (mod && (k.toLowerCase() === 'y' || (k.toLowerCase() === 'z' && e.shiftKey))) redo();
    else if (mod && k.toLowerCase() === 'a') { sel = new Set(data.nodes.map(n => n.id)); request(); }
    else if (mod && k.toLowerCase() === 'd') duplicate();
    else if (mod && k.toLowerCase() === 'g') groupSelection();
    else if (mod && (k === '=' || k === '+')) zoomAt(vw() / 2, vh() / 2, view.z * 1.2);
    else if (mod && k === '-') zoomAt(vw() / 2, vh() / 2, view.z / 1.2);
    else if (mod && k === '0') zoomAt(vw() / 2, vh() / 2, 1);
    else if (mod) handled = false;
    else if (e.altKey && k.startsWith('Arrow')) jump(k);
    else if (e.altKey) handled = false;
    else if (e.shiftKey && e.code === 'Digit1') fit();
    else if (e.shiftKey && e.code === 'Digit2') fit(true, selectedNodes());
    else if (k === 'Delete' || k === 'Backspace') deleteSelection();
    else if (k === 'Enter') {
      const ns = selectedNodes(), n = ns[0];
      if (ns.length !== 1) handled = false;
      else if (n.type === 'file' && e.shiftKey) hooks.openFile?.(n.file, n.subpath); // Shift+Enter opens the note
      else if (n.type === 'file' && !isNoteCard(n)) openFileCard(n);
      else startEditing(n.id);
    }
    else if (k === 'Tab') addChild();
    else if (k === 'Escape') { sel = new Set(); selEdge = null; request(); }
    else if (k.startsWith('Arrow') && sel.size) {
      const step = e.shiftKey ? 50 : 10;
      for (const n of selectedNodes()) { if (k === 'ArrowLeft') n.x -= step; if (k === 'ArrowRight') n.x += step; if (k === 'ArrowUp') n.y -= step; if (k === 'ArrowDown') n.y += step; }
      commit();
    }
    else if (k === ' ') spaceDown = true;
    else if (k === '?') showHelp();
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  let clip = null;
  function clipPayload() {
    const ns = selectedNodes();
    return { type: 'folio/canvas', nodes: ns, edges: data.edges.filter(e => sel.has(e.fromNode) && sel.has(e.toNode)) };
  }
  function onClip(e, cut) {
    if (!activeFor(e) || !sel.size) return;
    clip = JSON.parse(JSON.stringify(clipPayload()));
    e.clipboardData.setData('text/plain', JSON.stringify(clip));
    e.preventDefault();
    if (cut) deleteSelection();
  }
  function pastePayload(p, at) {
    const b = boundsOf(p.nodes);
    const [x, y] = at || pointerWorld;
    insertClones(cloneNodes(p.nodes, p.edges || [], x - (b.x1 + b.x2) / 2, y - (b.y1 + b.y2) / 2));
  }
  async function onPaste(e) {
    if (!activeFor(e)) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      for (const f of files) { const p = await hooks.importFile?.(f); if (p) addFileNode(p, pointerWorld); }
      return;
    }
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    try { const p = JSON.parse(text); if (p && Array.isArray(p.nodes) && p.nodes.length) return pastePayload(p); } catch { }
    if (/^https?:\/\/\S+$/.test(text.trim())) return addNode({ type: 'link', url: text.trim(), width: 360, height: 120 }, pointerWorld);
    addNode({ type: 'text', text, width: 320, height: 120 }, pointerWorld);
    requestAnimationFrame(() => fitHeight(byId.get([...sel][0])));
  }

  function colorItems() {
    return [
      ...Object.entries(PRESETS).map(([k, name]) => [`Colour: ${name}`, () => setColor(k)]),
      ['Colour: none', () => setColor(null)],
    ];
  }
  function onContext(e) {
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    const edgeEl = e.target.closest('[data-edge]');
    if (edgeEl) {
      const ed = data.edges.find(x => x.id === edgeEl.dataset.edge);
      if (!ed) return;
      selEdge = ed.id; sel = new Set(); request();
      return hooks.menu?.(e.clientX, e.clientY, [
        [ed.label ? 'Edit label…' : 'Add label…', () => editEdgeLabel(ed)],
        ['Arrow at end only', () => { delete ed.fromEnd; delete ed.toEnd; commit(); }],
        ['Arrows at both ends', () => { ed.fromEnd = 'arrow'; delete ed.toEnd; commit(); }],
        ['No arrowheads', () => { delete ed.fromEnd; ed.toEnd = 'none'; commit(); }],
        ['Reverse direction', () => { [ed.fromNode, ed.toNode] = [ed.toNode, ed.fromNode]; [ed.fromSide, ed.toSide] = [ed.toSide, ed.fromSide]; for (const k of ['fromSide', 'toSide']) if (ed[k] == null) delete ed[k]; commit(); }],
        null, ...colorItems(), null,
        ['Delete', () => deleteSelection(), 'danger'],
      ]);
    }
    const nodeEl = hitNode(e.target);
    if (nodeEl && !sel.has(nodeEl.dataset.id)) { sel = new Set([nodeEl.dataset.id]); selEdge = null; request(); }
    if (!nodeEl && sel.size) { sel = new Set(); request(); }
    const ns = selectedNodes();
    const items = [];
    if (ns.length) {
      const one = ns.length === 1 ? ns[0] : null;
      if (one?.type === 'text' || one?.type === 'group' || one?.type === 'link') items.push([one.type === 'group' ? 'Rename group' : one.type === 'link' ? 'Edit link' : 'Edit', () => startEditing(one.id)]);
      if (isNoteCard(one)) items.push(['Edit here', () => startEditing(one.id)]);
      if (one?.type === 'file' && IMG_RE.test(one.file)) items.push(['View image', () => openFileCard(one)]);
      if (one?.type === 'file') items.push(['Open', () => hooks.openFile?.(one.file, one.subpath)]);
      if (one?.type === 'link') items.push(['Open link', () => hooks.openUrl?.(one.url)]);
      if (one?.type === 'text') items.push(['Convert to note…', () => convertToNote()]);
      if (one && one.type !== 'group') items.push(['Add connected card (Tab)', () => addChild()]);
      items.push(null, ...colorItems(), null,
        ['Group (Ctrl+G)', () => groupSelection()], ['Duplicate', () => duplicate()],
        ['Bring to front', () => reorder(true)], ['Send to back', () => reorder(false)],
        ['Zoom to selection', () => fit(true, ns)],
        null, ['Delete', () => deleteSelection(), 'danger']);
    } else {
      items.push(
        ['Add card', () => addNode({ type: 'text', text: '' }, at, { edit: true })],
        ['Add note from vault…', () => pickAndAdd('note', at)],
        ['Add image or file…', () => pickAndAdd('media', at)],
        ['Add web link…', () => addLink(at)],
      );
      if (clip) items.push(['Paste', () => pastePayload(JSON.parse(JSON.stringify(clip)), at)]);
      items.push(null, ['Select all', () => { sel = new Set(data.nodes.map(n => n.id)); request(); }], ['Zoom to fit', () => fit()]);
    }
    hooks.menu?.(e.clientX, e.clientY, items);
  }

  async function pickAndAdd(kind, at) {
    const path = await hooks.pickFile?.(kind);
    if (path) addFileNode(path, at);
  }
  async function addLink(at) {
    const url = await hooks.prompt?.('Web link', 'Address (https://…)', 'https://');
    if (url && url.trim() && url.trim() !== 'https://') addNode({ type: 'link', url: url.trim(), width: 360, height: 120 }, at || viewCenter());
  }

  function showHelp() {
    hooks.help?.(`<div class="dr-help"><h3>Canvas shortcuts</h3><div class="dr-help-cols">
      <div><h4>Cards</h4><p><span>New card</span>double-click</p><p><span>Edit a card or note in place</span><kbd>Enter</kbd> or double-click</p><p><span>Open a note card</span><kbd>Shift Enter</kbd></p><p><span>Finish editing</span><kbd>Esc</kbd></p>
      <p><span>New connected card</span><kbd>Tab</kbd></p><p><span>Connect cards</span>drag a side dot</p><p><span>Card from a connection</span>drop it on empty space</p>
      <p><span>Add a note or image</span>drag it from the file tree</p><p><span>Group selection</span><kbd>Ctrl G</kbd></p><p><span>Duplicate</span><kbd>Ctrl D</kbd></p></div>
      <div><h4>Selection</h4><p><span>Jump to nearby card</span><kbd>Alt</kbd> + arrows</p><p><span>Move</span>arrows (<kbd>Shift</kbd> = faster)</p><p><span>Add to selection</span><kbd>Shift</kbd>-click</p>
      <p><span>Select all</span><kbd>Ctrl A</kbd></p><p><span>Delete</span><kbd>Del</kbd></p><p><span>Ignore alignment guides</span>hold <kbd>Ctrl</kbd> while dragging</p></div>
      <div><h4>View</h4><p><span>Pan</span>wheel, <kbd>Space</kbd>-drag</p><p><span>Zoom</span><kbd>Ctrl</kbd> + wheel</p><p><span>Zoom to fit / selection</span><kbd>Shift 1</kbd> <kbd>Shift 2</kbd></p>
      <p><span>Undo / redo</span><kbd>Ctrl Z</kbd> <kbd>Ctrl Y</kbd></p></div></div></div>`);
  }

  function onUiClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const at = viewCenter();
    ({
      'add-text': () => addNode({ type: 'text', text: '' }, at, { edit: true }),
      'add-note': () => pickAndAdd('note', at),
      'add-media': () => pickAndAdd('media', at),
      'add-link': () => addLink(at),
      'add-group': () => { if (sel.size) groupSelection(); else { const g = addNode({ type: 'group', label: 'Group', width: 500, height: 360 }, at); startEditing(g.id); } },
      'zoom-in': () => zoomAt(vw() / 2, vh() / 2, view.z * 1.2), 'zoom-out': () => zoomAt(vw() / 2, vh() / 2, view.z / 1.2),
      'zoom-reset': () => zoomAt(vw() / 2, vh() / 2, 1), fit: () => fit(),
      undo, redo, help: showHelp,
      map: () => { showMap = !showMap; try { hooks.store?.('canvasMinimap', showMap); } catch { } request(); },
      'sel-edit': () => { const n = selectedNodes()[0]; if (n) startEditing(n.id); },
      'sel-open': () => { const n = selectedNodes()[0]; if (n?.type === 'file') hooks.openFile?.(n.file, n.subpath); else if (n?.type === 'link') hooks.openUrl?.(n.url); },
      'sel-note': () => convertToNote(), 'sel-child': () => addChild(), 'sel-group': () => groupSelection(),
      'sel-delete': () => deleteSelection(), 'sel-fit': () => fit(true, selectedNodes()),
      'sel-color': () => { const r = b.getBoundingClientRect(); hooks.menu?.(r.left, r.bottom + 6, colorItems()); },
    })[b.dataset.act]?.();
    if (!editing && !hooks.modalOpen?.()) viewport.focus({ preventScroll: true }); // not away from a dialog it opened
  }

  // ------------------------------------------------------------ rendering

  function request() { if (visible && !raf) raf = requestAnimationFrame(render); }

  const colorVar = c => !c ? '' : PRESETS[c] ? `var(--cv-${PRESETS[c]})` : /^#[0-9a-f]{3,8}$/i.test(c) ? c : '';

  function nodeKey(n) {
    const v = n.type === 'file' ? hooks.fileVersion?.(n.file) : '';
    return `${n.type}|${n.text ?? ''}|${n.file ?? ''}|${n.subpath ?? ''}|${n.url ?? ''}|${n.label ?? ''}|${v}`;
  }

  function fillNode(el, n) {
    el.querySelectorAll('.cv-content, .cv-label').forEach(x => x.remove());
    const label = document.createElement('div');
    label.className = 'cv-label';
    const content = document.createElement('div');
    content.className = 'cv-content';
    if (n.type === 'text') {
      content.classList.add('markdown');
      hooks.renderMarkdown?.(content, n.text || '', fromPath);
      if (!n.text) content.innerHTML = '<p class="cv-empty">Empty card</p>';
      label.remove();
    } else if (n.type === 'group') {
      label.textContent = n.label || '';
      content.remove();
    } else if (n.type === 'link') {
      label.textContent = 'Link';
      let host = n.url || '';
      try { host = new URL(n.url).host; } catch { }
      content.innerHTML = `<div class="cv-link"><div class="cv-link-host">${esc(host)}</div><a class="cv-link-url" href="${esc(/^https?:/i.test(n.url || '') ? n.url : '#')}" target="_blank" rel="noopener noreferrer">${esc(n.url || '(no address)')}</a></div>`;
    } else if (n.type === 'file') {
      label.textContent = hooks.fileName?.(n.file) || n.file;
      label.title = n.file + (n.subpath || '');
      hooks.renderFile?.(content, n.file, n.subpath);
    }
    if (label.isConnected || n.type !== 'text') el.prepend(label);
    if (n.type !== 'group') el.append(content);
  }

  function ensureNode(n) {
    let rec = nodeEls.get(n.id);
    if (!rec) {
      const el = document.createElement('div');
      el.className = 'cv-node';
      el.dataset.id = n.id;
      el.innerHTML = SIDES.map(s => `<div class="cv-side" data-side="${s}"></div>`).join('') +
        ['se', 'e', 's', 'w', 'n', 'nw', 'ne', 'sw'].map(d => `<div class="cv-resize r-${d}" data-dir="${d}"></div>`).join('');
      rec = { el, key: null };
      nodeEls.set(n.id, rec);
    }
    const key = nodeKey(n);
    if (rec.key !== key && !(editing && editing.id === n.id)) { fillNode(rec.el, n); rec.key = key; }
    const el = rec.el;
    el.className = `cv-node cv-${n.type}${sel.has(n.id) ? ' selected' : ''}${editing?.id === n.id ? ' editing' : ''}`;
    el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${n.width}px;height:${n.height}px;${n.color ? `--cc:${colorVar(n.color)}` : ''}`;
    return el;
  }

  function render() {
    raf = 0;
    if (!visible) return;
    const z = view.z;
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${z})`;
    world.style.setProperty('--iz', String(1 / z));
    const step = 24 * z;
    bgEl.style.backgroundSize = `${step}px ${step}px`;
    bgEl.style.backgroundPosition = `${view.x % step}px ${view.y % step}px`;
    bgEl.style.opacity = z < 0.35 ? '0' : '';
    // nodes (DOM order = z-order)
    const holder = $('.cv-nodes');
    const seen = new Set();
    let prev = null;
    for (const n of data.nodes) {
      const el = ensureNode(n);
      seen.add(n.id);
      if ((prev ? prev.nextSibling : holder.firstChild) !== el) holder.insertBefore(el, prev ? prev.nextSibling : holder.firstChild);
      prev = el;
    }
    for (const [id, rec] of nodeEls) if (!seen.has(id)) { rec.el.remove(); nodeEls.delete(id); }
    // edges
    let paths = '', lbl = '';
    const sz = 12;
    for (const e of data.edges) {
      const c = edgeCurve(e, byId);
      if (!c) continue;
      const color = colorVar(e.color) || 'var(--muted)';
      const on = selEdge === e.id || sel.has(e.fromNode) || sel.has(e.toNode);
      paths += `<g class="cv-edge${selEdge === e.id ? ' selected' : ''}${on ? ' related' : ''}" style="--ec:${color}" data-edge="${e.id}">` +
        `<path class="cv-edge-hit" d="${curvePath(c, false, false, 0)}"/>` +
        `<path class="cv-edge-line" d="${curvePath(c, hasStartArrow(e), hasEndArrow(e), sz)}"/>` +
        (hasEndArrow(e) ? `<path class="cv-edge-head" d="${arrowHead(c.p3, c.c2, sz)}"/>` : '') +
        (hasStartArrow(e) ? `<path class="cv-edge-head" d="${arrowHead(c.p0, c.c1, sz)}"/>` : '') + '</g>';
      if (e.label) { const [mx, my] = bez(c, 0.5); lbl += `<div class="cv-edge-label${selEdge === e.id ? ' selected' : ''}" data-edge="${e.id}" style="left:${mx}px;top:${my}px">${esc(e.label)}</div>`; }
    }
    if (action?.type === 'connect') {
      const from = byId.get(action.from);
      const tgt = action.over && byId.get(action.over.id);
      const tmp = { fromNode: action.from, fromSide: action.side, toNode: tgt ? tgt.id : null, toSide: tgt ? action.over.side || sideToward(tgt, sidePoint(from, action.side)) : null };
      const c = tgt ? edgeCurve(tmp, byId) : edgeCurve({ fromNode: action.from, fromSide: action.side }, byId, action.to);
      if (c) paths += `<g class="cv-edge selected" style="--ec:var(--accent)"><path class="cv-edge-line" d="${curvePath(c, false, true, sz)}"/><path class="cv-edge-head" d="${arrowHead(c.p3, c.c2, sz)}"/></g>`;
    }
    svg.innerHTML = paths;
    labels.innerHTML = lbl;
    // marquee
    if (action?.type === 'marquee' && action.x1 != null) {
      const x1 = Math.min(action.x0, action.x1) * z + view.x, y1 = Math.min(action.y0, action.y1) * z + view.y;
      Object.assign(marquee.style, { left: x1 + 'px', top: y1 + 'px', width: Math.abs(action.x1 - action.x0) * z + 'px', height: Math.abs(action.y1 - action.y0) * z + 'px' });
      marquee.hidden = false;
    } else marquee.hidden = true;
    renderSelBar();
    renderMinimap();
    hintEl.textContent = data.nodes.length ? '' : 'Double-click to add a card · drag notes in from the file tree';
    zoomLabel.textContent = Math.round(z * 100) + '%';
    $('[data-act=undo]').disabled = !hist.undo.length;
    $('[data-act=redo]').disabled = !hist.redo.length;
  }

  // A small toolbar floating above the selection.
  function renderSelBar() {
    const ns = selectedNodes();
    if (!ns.length || action?.type === 'move' || action?.type === 'resize' || action?.type === 'marquee' || editing) { selBar.hidden = true; return; }
    const b = boundsOf(ns), one = ns.length === 1 ? ns[0] : null;
    const btn = (act, title, p) => `<button class="dr-btn" data-act="${act}" title="${title}">${ICON(p)}</button>`;
    let h = btn('sel-color', 'Colour', '<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5v15" stroke-width="7" stroke-opacity=".35"/>');
    if (one && (one.type === 'text' || one.type === 'group' || one.type === 'link' || isNoteCard(one))) h += btn('sel-edit', one.type === 'file' ? 'Edit the note here (Enter)' : 'Edit (Enter)', '<path d="M4 20h4L19 9l-4-4L4 16z"/>');
    if (one && (one.type === 'file' || one.type === 'link')) h += btn('sel-open', isNoteCard(one) ? 'Open the note (Shift+Enter)' : 'Open', '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>');
    if (one && one.type === 'text') h += btn('sel-note', 'Convert to note', '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>');
    if (one && one.type !== 'group') h += btn('sel-child', 'Add connected card (Tab)', '<rect x="3" y="8" width="8" height="8" rx="1.5"/><rect x="15" y="8" width="6" height="8" rx="1.5"/><path d="M11 12h4"/>');
    if (ns.length > 1) h += btn('sel-group', 'Group (Ctrl+G)', '<rect x="3.5" y="5.5" width="17" height="14" rx="2" stroke-dasharray="3 2.5"/>');
    h += btn('sel-fit', 'Zoom to selection', '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>');
    h += btn('sel-delete', 'Delete', '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>');
    if (selBar.innerHTML !== h) selBar.innerHTML = h;
    selBar.hidden = false;
    const sx = ((b.x1 + b.x2) / 2) * view.z + view.x, sy = b.y1 * view.z + view.y;
    const w = selBar.offsetWidth;
    selBar.style.left = Math.max(8, Math.min(vw() - w - 8, sx - w / 2)) + 'px';
    selBar.style.top = Math.max(62, sy - 52 - (ns.some(n => n.type !== 'text') ? 22 : 0)) + 'px'; // stays below the top toolbar
  }

  function mapGeom() {
    const b = boundsOf(data.nodes);
    if (!b) return null;
    const v = { x1: -view.x / view.z, y1: -view.y / view.z, x2: (vw() - view.x) / view.z, y2: (vh() - view.y) / view.z };
    const x1 = Math.min(b.x1, v.x1), y1 = Math.min(b.y1, v.y1), x2 = Math.max(b.x2, v.x2), y2 = Math.max(b.y2, v.y2);
    const W = minimap.width, H = minimap.height, pad = 8;
    const s = Math.min((W - pad * 2) / (x2 - x1 || 1), (H - pad * 2) / (y2 - y1 || 1));
    return { s, ox: pad - x1 * s + ((W - pad * 2) - (x2 - x1) * s) / 2, oy: pad - y1 * s + ((H - pad * 2) - (y2 - y1) * s) / 2, v };
  }
  function renderMinimap() {
    minimap.hidden = !showMap || data.nodes.length < 2;
    if (minimap.hidden) return;
    const m = mapGeom(), cs = getComputedStyle(document.documentElement);
    mm.clearRect(0, 0, minimap.width, minimap.height);
    for (const n of data.nodes) {
      mm.fillStyle = n.type === 'group' ? 'rgba(128,128,128,.15)' : sel.has(n.id) ? cs.getPropertyValue('--accent') : cs.getPropertyValue('--faint');
      mm.fillRect(n.x * m.s + m.ox, n.y * m.s + m.oy, Math.max(2, n.width * m.s), Math.max(2, n.height * m.s));
    }
    mm.strokeStyle = cs.getPropertyValue('--accent'); mm.lineWidth = 1.5;
    mm.strokeRect(m.v.x1 * m.s + m.ox, m.v.y1 * m.s + m.oy, (m.v.x2 - m.v.x1) * m.s, (m.v.y2 - m.v.y1) * m.s);
  }

  // Note/image cards re-render when their files change.
  function refreshFiles() { for (const rec of nodeEls.values()) rec.key = null; request(); }

  root.FolioCanvas = {
    ...pure,
    init, load, getData,
    // Opening a canvas takes the keyboard, so card shortcuts work straight away.
    show() { visible = true; request(); if (!hooks.modalOpen?.()) viewport.focus({ preventScroll: true }); },
    hide() { visible = false; stopEditing(true); action = null; },
    getView: () => ({ ...view }),
    count: () => data.nodes.length,
    flush() { stopEditing(true); },
    addFile: path => addFileNode(path),
    refreshFiles,
  };
})(typeof window !== 'undefined' ? window : globalThis);
