/* Cinder drawing view: an Excalidraw-style whiteboard on a canvas.
 * Scene model, rendering and file formats live in draw-render.js (CinderSketch). */
'use strict';

window.CinderDraw = (() => {
  const K = CinderSketch;
  const TAU = Math.PI * 2;

  let root, canvas, ctx, hooks, hintEl, toolsEl, propsEl, zoomLabel, fileInput, lockBtn;
  let scene = K.emptyScene();
  let els = scene.elements;
  let fileUrls = {};           // fileId -> URL for images stored in the vault (.excalidraw.md)
  const images = new Map();    // fileId -> {img, ok}
  let visible = false, raf = 0, dark = false, accent = '#8f73ff', pageBg = '#ffffff';
  let view = { sx: 0, sy: 0, zoom: 1 }; // screen = (world + s) * zoom
  let selected = new Set();
  let tool = 'selection', locked = false;
  // Laser pointer: strokes of [x, y, time] in scene coordinates, fading out; nothing is saved.
  const laser = [];
  let laserAt = null; // the pointer on screen, for the laser's dot
  const LASER_FADE = 1100;
  let action = null;           // the pointer interaction in progress
  let multi = null;            // a line/arrow being placed click by click
  let editing = null;          // {el, ta, container, isNew}
  let eraseSet = new Set();
  let bindHint = null;         // shape an arrow end would attach to
  let spaceDown = false, pointerWorld = [0, 0];
  let hist = { undo: [], redo: [], cur: '[]' };
  let clip = null;             // internal clipboard fallback

  const DEFAULT_STYLE = {
    strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
    roughness: 1, opacity: 100, roundness: 'round', fontSize: 20, fontFamily: 1, textAlign: 'left',
    startArrowhead: null, endArrowhead: 'arrow', arrowType: 'round',
  };
  let style = { ...DEFAULT_STYLE };

  const TOOLS = [
    ['selection', 'Select', 'V or 1', '<path d="M6 3.5l11.5 8.6-5.3 1.1-3 5.3z"/>'],
    ['rectangle', 'Rectangle', 'R or 2', '<rect x="4" y="5.5" width="16" height="13" rx="2.5"/>'],
    ['diamond', 'Diamond', 'D or 3', '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/>'],
    ['ellipse', 'Ellipse', 'O or 4', '<circle cx="12" cy="12" r="8.5"/>'],
    ['arrow', 'Arrow', 'A or 5', '<path d="M5 19L19 5M10.5 5H19v8.5"/>'],
    ['line', 'Line', 'L or 6', '<path d="M4.5 19.5l15-15"/>'],
    ['freedraw', 'Draw', 'P or 7', '<path d="M4.5 19.5l1-4.2L16.2 4.6a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.7 18.5z"/><path d="M14.5 6.5l3 3"/>'],
    ['text', 'Text', 'T or 8', '<path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6"/>'],
    ['image', 'Insert image', '9', '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="M20.5 16l-5-5L5 19.5"/>'],
    ['eraser', 'Eraser', 'E or 0', '<path d="M8.5 19.5H20M5.6 14.6l8.2-8.2a2 2 0 0 1 2.8 0l2.5 2.5a2 2 0 0 1 0 2.8l-7.6 7.8H9z"/><path d="M9.5 10.5l5 5"/>'],
    ['laser', 'Laser pointer', 'K', '<circle cx="17.5" cy="6.5" r="2.5"/><path d="M15.7 8.3L4 20"/><path d="M17.5 1.5v1.5M22.5 6.5H21M20.9 3.1l-1 1M20.9 9.9l-1-1"/>'],
    ['hand', 'Hand (pan)', 'H or Space', '<path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5M11 10.5V4.5a1.5 1.5 0 0 1 3 0v6M14 10.5V6a1.5 1.5 0 0 1 3 0v5.5M17 9.5a1.5 1.5 0 0 1 3 0V14a6.5 6.5 0 0 1-6.5 6.5H12a6 6 0 0 1-4.9-2.6l-3-4.5a1.5 1.5 0 0 1 2.4-1.8L8 13.5"/>'],
  ];
  const TOOL_KEYS = { v: 'selection', 1: 'selection', r: 'rectangle', 2: 'rectangle', d: 'diamond', 3: 'diamond', o: 'ellipse', 4: 'ellipse', a: 'arrow', 5: 'arrow', l: 'line', 6: 'line', p: 'freedraw', x: 'freedraw', 7: 'freedraw', t: 'text', 8: 'text', 9: 'image', e: 'eraser', 0: 'eraser', k: 'laser', h: 'hand' };
  const ICON = p => `<svg viewBox="0 0 24 24">${p}</svg>`;

  // ============================================================ setup

  function init(container, h) {
    root = container; hooks = h;
    root.innerHTML = `
      <canvas class="dr-canvas" tabindex="0"></canvas>
      <div class="dr-top"><div class="dr-island dr-tools"></div></div>
      <div class="dr-island dr-props" hidden></div>
      <div class="dr-bottom">
        <div class="dr-island dr-row"><button class="dr-btn" data-act="zoom-out" title="Zoom out (Ctrl+-)">${ICON('<path d="M6 12h12"/>')}</button><button class="dr-btn dr-zoom" data-act="zoom-reset" title="Reset zoom (Ctrl+0)">100%</button><button class="dr-btn" data-act="zoom-in" title="Zoom in (Ctrl+=)">${ICON('<path d="M6 12h12M12 6v12"/>')}</button></div>
        <div class="dr-island dr-row"><button class="dr-btn" data-act="undo" title="Undo (Ctrl+Z)">${ICON('<path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>')}</button><button class="dr-btn" data-act="redo" title="Redo (Ctrl+Y)">${ICON('<path d="M15 14l4.5-4.5L15 5"/><path d="M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3"/>')}</button></div>
      </div>
      <div class="dr-island dr-row dr-menu"><button class="dr-btn" data-act="menu" title="Drawing menu">${ICON('<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>')}</button><button class="dr-btn" data-act="help" title="Keyboard shortcuts (?)">${ICON('<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.6a2.3 2.3 0 1 1 3.3 2.1c-.7.4-1.1.9-1.1 1.7v.4M12 16.8v.2"/>')}</button></div>
      <div class="dr-hint"></div>
      <input type="file" accept="image/*" hidden>`;
    canvas = root.querySelector('canvas');
    ctx = canvas.getContext('2d');
    hintEl = root.querySelector('.dr-hint');
    toolsEl = root.querySelector('.dr-tools');
    propsEl = root.querySelector('.dr-props');
    zoomLabel = root.querySelector('.dr-zoom');
    fileInput = root.querySelector('input[type=file]');
    try { Object.assign(style, hooks.store?.('drawStyle') || {}); } catch { }

    toolsEl.innerHTML = `<button class="dr-btn dr-lock" data-act="lock" title="Keep the selected tool active after drawing (Q)">${ICON('<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.7"/>')}</button><span class="dr-sep"></span>` +
      TOOLS.map(([id, label, key, path]) => `<button class="dr-btn" data-tool="${id}" title="${label} — ${key}">${ICON(path)}<small>${key.match(/\d/)?.[0] || ''}</small></button>`).join('');
    lockBtn = toolsEl.querySelector('.dr-lock');

    new ResizeObserver(() => resize()).observe(canvas);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('mousedown', e => e.preventDefault()); // onDown manages focus (the text editor keeps it)
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', () => { if (laserAt) { laserAt = null; requestRender(); } });
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', onDouble);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('dragover', e => { e.preventDefault(); });
    canvas.addEventListener('drop', onDrop);
    root.addEventListener('click', onUiClick);
    propsEl.addEventListener('input', onPropInput);
    propsEl.addEventListener('mousedown', e => { if (editing && !e.target.closest('input, select')) e.preventDefault(); }); // keep the text editor focused
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      fileInput.value = '';
      if (f) addImageFile(f, fileInput._at);
    });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', e => { if (e.key === ' ' && spaceDown) { spaceDown = false; updateCursor(); } });
    document.addEventListener('copy', e => onClipboard(e, 'copy'));
    document.addEventListener('cut', e => onClipboard(e, 'cut'));
    document.addEventListener('paste', onPaste);
    document.fonts?.load?.('20px Virgil').then(() => { requestRender(); }).catch(() => { });
    restyle();
    setTool('selection');
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // id -> element, rebuilt whenever the element array is replaced or changes length.
  let idIndex = new Map(), idIndexOf = null, idIndexLen = -1;
  const byId = id => {
    if (idIndexOf !== els || idIndexLen !== els.length) { idIndex = new Map(els.map(e => [e.id, e])); idIndexOf = els; idIndexLen = els.length; }
    return idIndex.get(id);
  };
  const dpr = () => window.devicePixelRatio || 1;
  const cw = () => canvas.clientWidth, ch = () => canvas.clientHeight;
  const toWorld = (mx, my) => [mx / view.zoom - view.sx, my / view.zoom - view.sy];
  const toScreen = (x, y) => [(x + view.sx) * view.zoom, (y + view.sy) * view.zoom];
  const mouse = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const gridSize = () => (scene.appState.gridModeEnabled !== false && scene.appState.gridSize) || 0;
  const snap = (v, e) => { const g = gridSize(); return g && !(e && (e.ctrlKey || e.metaKey)) ? Math.round(v / g) * g : v; };

  function restyle() {
    dark = document.documentElement.dataset.theme === 'dark';
    const cs = getComputedStyle(document.documentElement);
    accent = cs.getPropertyValue('--accent').trim() || '#8f73ff';
    pageBg = cs.getPropertyValue('--bg').trim() || (dark ? '#121212' : '#ffffff');
    renderProps();
    requestRender();
  }

  function resize() {
    if (!canvas) return;
    const w = Math.max(1, Math.round(cw() * dpr())), h = Math.max(1, Math.round(ch() * dpr()));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    requestRender();
  }

  // ============================================================ loading & saving

  function load(sc, opts = {}) {
    cancelEditing();
    scene = sc; els = scene.elements;
    fileUrls = opts.fileUrls || {};
    images.clear();
    selected = new Set(); action = null; multi = null; eraseSet = new Set(); bindHint = null;
    // Texts whose content came from the note's Markdown need measuring again.
    for (const id of opts.relayout || []) {
      const t = byId(id), c = t?.containerId && byId(t.containerId);
      if (c) K.layoutBoundText(t, c); else if (t) K.refreshText(t);
    }
    hist = { undo: [], redo: [], cur: JSON.stringify(els) };
    if (opts.view) view = { ...opts.view };
    else fitView(false);
    renderProps();
    requestRender();
  }

  // The scene to write to disk: only files that elements still use.
  // The scene to write: only the image data that elements use. scene.files itself keeps
  // everything, so undoing the deletion of an image brings its data back too.
  function getScene() {
    const used = new Set(els.filter(e => e.type === 'image' && e.fileId).map(e => e.fileId));
    const files = {};
    for (const [id, f] of Object.entries(scene.files || {})) if (used.has(id)) files[id] = f;
    return { ...scene, elements: els, files };
  }

  function changed() { hooks.onChange?.(); }

  // Record an undo step if anything changed since the last one.
  function commit() {
    const s = JSON.stringify(els);
    if (s === hist.cur) return false;
    hist.undo.push(hist.cur);
    if (hist.undo.length > 150) hist.undo.shift();
    hist.cur = s; hist.redo = [];
    changed();
    return true;
  }
  function restoreSnapshot(s) {
    cancelEditing();
    hist.cur = s;
    scene.elements = els = JSON.parse(s);
    selected = new Set([...selected].filter(id => byId(id)));
    changed(); renderProps(); requestRender();
  }
  function undo() { if (finishMulti() || !hist.undo.length) return; hist.redo.push(hist.cur); restoreSnapshot(hist.undo.pop()); }
  function redo() { if (!hist.redo.length) return; hist.undo.push(hist.cur); restoreSnapshot(hist.redo.pop()); }

  // ============================================================ element helpers

  function boundTextOf(c) {
    const b = c.boundElements?.find(x => x.type === 'text');
    return b ? byId(b.id) : null;
  }
  function addBound(target, id, type) {
    target.boundElements = [...(target.boundElements || []).filter(b => b.id !== id), { id, type }];
  }
  function removeBound(target, id) {
    if (!target?.boundElements) return;
    target.boundElements = target.boundElements.filter(b => b.id !== id);
    if (!target.boundElements.length) target.boundElements = null;
  }
  // Selected elements plus the labels that travel with them.
  function withBound(list) {
    const out = new Set(list);
    for (const el of list) { const t = boundTextOf(el); if (t) out.add(t); }
    return [...out];
  }
  const selectedEls = () => els.filter(e => selected.has(e.id));
  function groupMembers(el) {
    const g = el.groupIds?.[el.groupIds.length - 1];
    if (!g) return [el.id];
    return els.filter(e => e.groupIds?.includes(g) && !e.containerId).map(e => e.id);
  }
  function styleFor(type) {
    const s = {
      strokeColor: style.strokeColor, backgroundColor: style.backgroundColor, fillStyle: style.fillStyle,
      strokeWidth: style.strokeWidth, strokeStyle: style.strokeStyle, roughness: style.roughness, opacity: style.opacity,
    };
    if (type === 'rectangle' || type === 'diamond') s.roundness = style.roundness === 'round' ? { type: type === 'rectangle' ? 3 : 2 } : null;
    if (K.isLinear({ type })) s.roundness = style.arrowType === 'round' ? { type: 2 } : null;
    if (type === 'arrow') { s.startArrowhead = style.startArrowhead; s.endArrowhead = style.endArrowhead; }
    if (type === 'text') Object.assign(s, { fontSize: style.fontSize, fontFamily: style.fontFamily, textAlign: style.textAlign, backgroundColor: 'transparent' });
    if (type === 'line' || type === 'arrow' || type === 'freedraw') s.backgroundColor = type === 'arrow' ? 'transparent' : s.backgroundColor;
    return s;
  }

  // Keep labels and attached arrows in step with the elements that changed.
  function afterChange(list) {
    const arrows = new Set();
    for (const el of list) {
      if (!el || el.isDeleted) continue;
      const t = boundTextOf(el);
      if (t && !K.isLinear(el)) K.layoutBoundText(t, el);
      for (const b of el.boundElements || []) if (b.type === 'arrow') { const a = byId(b.id); if (a && !list.includes(a)) arrows.add(a); }
      if (el.type === 'arrow') arrows.add(el);
    }
    for (const a of arrows) {
      updateArrowEnds(a);
      const t = boundTextOf(a);
      if (t) K.layoutBoundText(t, a);
    }
  }

  function updateArrowEnds(arrow) {
    const s = arrow.startBinding && byId(arrow.startBinding.elementId);
    const e = arrow.endBinding && byId(arrow.endBinding.elementId);
    if (!s && !e) return;
    const pts = K.absPoints(arrow), n = pts.length;
    if (n < 2) return;
    const centre = el => { const b = K.absBox(el); return [b.cx, b.cy]; };
    if (s) { const p = K.outlinePoint(s, n === 2 && e ? centre(e) : pts[1], arrow.startBinding.gap ?? 4); if (p) pts[0] = p; }
    if (e) { const p = K.outlinePoint(e, n === 2 && s ? pts[0] : pts[n - 2], arrow.endBinding.gap ?? 4); if (p) pts[n - 1] = p; }
    K.setAbsPoints(arrow, pts);
  }

  function bindableAt(p, except) {
    const tol = 8 / view.zoom;
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (el === except || el.locked || !K.isBindable(el) || el.containerId === except?.id) continue;
      if (K.hitTest(el, p[0], p[1], tol, { inside: true })) return el;
    }
    return null;
  }

  function unbind(arrow, which) {
    const b = arrow[which + 'Binding'];
    if (!b) return;
    const other = arrow[(which === 'start' ? 'end' : 'start') + 'Binding'];
    if (!other || other.elementId !== b.elementId) removeBound(byId(b.elementId), arrow.id);
    arrow[which + 'Binding'] = null;
  }

  // Attach an arrow end to the shape under it, if any.
  function bindEnd(arrow, which) {
    if (arrow.type !== 'arrow') return;
    const pts = K.absPoints(arrow);
    const p = which === 'start' ? pts[0] : pts[pts.length - 1];
    unbind(arrow, which);
    const target = bindableAt(p, arrow);
    if (!target) return;
    const other = arrow[(which === 'start' ? 'end' : 'start') + 'Binding'];
    if (other && other.elementId === target.id && pts.length === 2) return;
    arrow[which + 'Binding'] = { elementId: target.id, focus: 0, gap: 4 };
    addBound(target, arrow.id, 'arrow');
    updateArrowEnds(arrow);
  }

  // Remove elements, tidying labels and arrow bindings that pointed at them.
  function deleteIds(ids) {
    const kill = new Set(ids);
    for (const id of ids) { const el = byId(id); const t = el && boundTextOf(el); if (t) kill.add(t.id); }
    for (const el of els) {
      if (kill.has(el.id)) {
        if (el.containerId) removeBound(byId(el.containerId), el.id);
        if (el.startBinding) removeBound(byId(el.startBinding.elementId), el.id);
        if (el.endBinding) removeBound(byId(el.endBinding.elementId), el.id);
        continue;
      }
      if (el.startBinding && kill.has(el.startBinding.elementId)) el.startBinding = null;
      if (el.endBinding && kill.has(el.endBinding.elementId)) el.endBinding = null;
      if (el.boundElements) { el.boundElements = el.boundElements.filter(b => !kill.has(b.id)); if (!el.boundElements.length) el.boundElements = null; }
    }
    scene.elements = els = els.filter(e => !kill.has(e.id));
    for (const id of kill) selected.delete(id);
  }

  // Deep-copy elements with fresh ids, keeping links between the copies.
  function cloneElements(list, dx, dy) {
    const idMap = new Map(), groupMap = new Map();
    for (const el of list) idMap.set(el.id, K.randomId());
    return list.map(el => {
      const c = JSON.parse(JSON.stringify(el));
      c.id = idMap.get(el.id); c.seed = K.randomInt(); c.x += dx; c.y += dy;
      c.groupIds = (c.groupIds || []).map(g => { if (!groupMap.has(g)) groupMap.set(g, K.randomId()); return groupMap.get(g); });
      if (c.containerId) c.containerId = idMap.get(c.containerId) || null;
      if (c.boundElements) { c.boundElements = c.boundElements.filter(b => idMap.has(b.id)).map(b => ({ ...b, id: idMap.get(b.id) })); if (!c.boundElements.length) c.boundElements = null; }
      for (const k of ['startBinding', 'endBinding']) if (c[k]) c[k] = idMap.has(c[k].elementId) ? { ...c[k], elementId: idMap.get(c[k].elementId) } : null;
      K.mutate(c);
      return c;
    });
  }

  // Keep each label directly above its container.
  function fixTextOrder() {
    const texts = new Map();
    for (const el of els) if (el.containerId && byId(el.containerId)) texts.set(el.containerId, el);
    if (!texts.size) return;
    const moved = new Set([...texts.values()].map(t => t.id));
    const out = [];
    for (const el of els) {
      if (moved.has(el.id)) continue;
      out.push(el);
      const t = texts.get(el.id);
      if (t) out.push(t);
    }
    scene.elements = els = out;
  }

  // ============================================================ tools

  function setTool(t) {
    if (t === 'image') { fileInput._at = null; fileInput.click(); return; }
    finishMulti();
    commitText();
    tool = t;
    if (t !== 'selection' && t !== 'hand') { if (t !== 'eraser' && t !== 'laser') selected = new Set(); }
    for (const b of toolsEl.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === t);
    renderProps(); updateCursor(); requestRender();
  }
  function toolDone(el) {
    if (!locked && tool !== 'freedraw' && tool !== 'eraser' && tool !== 'laser') {
      tool = 'selection';
      for (const b of toolsEl.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === 'selection');
    }
    selected = el && tool === 'selection' ? new Set([el.id]) : new Set();
    renderProps(); updateCursor();
  }

  function updateCursor() {
    let c = 'default';
    if (spaceDown || tool === 'hand') c = action?.type === 'pan' ? 'grabbing' : 'grab';
    else if (tool === 'text') c = 'text';
    else if (tool === 'eraser') c = 'cell';
    else if (tool === 'laser') c = 'none'; // the laser's own dot is the pointer
    else if (tool !== 'selection') c = 'crosshair';
    canvas.style.cursor = c;
  }

  // ============================================================ pointer input

  function onDown(e) {
    if (e.button === 2) return;
    canvas.focus({ preventScroll: true });
    const [mx, my] = mouse(e);
    const [wx, wy] = toWorld(mx, my);
    pointerWorld = [wx, wy];
    if (editing) { commitText(); if (tool === 'text' || tool === 'selection') return; }
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || spaceDown || tool === 'hand') {
      action = { type: 'pan', mx, my, sx: view.sx, sy: view.sy };
      updateCursor();
      return;
    }
    if (multi) return multiClick(wx, wy, mx, my, e);
    switch (tool) {
      case 'selection': return downSelect(e, wx, wy, mx, my);
      case 'eraser': action = { type: 'erase' }; eraseAt(wx, wy); return;
      case 'laser': action = { type: 'laser' }; laser.push({ pts: [[wx, wy, performance.now()]] }); requestRender(); return;
      case 'rectangle': case 'diamond': case 'ellipse': return startShape(tool, wx, wy, e);
      case 'arrow': case 'line': return startLinear(tool, wx, wy, e);
      case 'freedraw': return startFreedraw(wx, wy, e);
      case 'text': return textAt(wx, wy, e);
    }
  }

  function onMove(e) {
    const [mx, my] = mouse(e);
    const [wx, wy] = toWorld(mx, my);
    pointerWorld = [wx, wy];
    if (multi && !action) {
      const el = multi.el, pts = K.absPoints(el);
      pts[pts.length - 1] = angleSnap(pts[pts.length - 2], [snap(wx, e), snap(wy, e)], e.shiftKey);
      K.setAbsPoints(el, pts);
      bindHint = el.type === 'arrow' ? bindableAt(pts[pts.length - 1], el) : null;
      requestRender();
      return;
    }
    if (!action) { hoverCursor(mx, my, wx, wy); if (tool === 'laser') { laserAt = [mx, my]; requestRender(); } return; }
    if (action.type === 'laser') laserAt = [mx, my];
    switch (action.type) {
      case 'pan':
        view.sx = action.sx + (mx - action.mx) / view.zoom; view.sy = action.sy + (my - action.my) / view.zoom;
        break;
      case 'create': dragShape(wx, wy, e); break;
      case 'createLinear': dragLinear(wx, wy, mx, my, e); break;
      case 'freedraw': {
        const el = action.el;
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of evs.length ? evs : [e]) {
          const [cx, cy] = toWorld(...mouse(ev));
          el.points.push([cx - el.x, cy - el.y]);
          if (!el.simulatePressure) el.pressures.push(ev.pressure || 0.5);
        }
        K.syncPointsSize(el); K.mutate(el);
        break;
      }
      case 'move': dragMove(wx, wy, mx, my, e); break;
      case 'resize': dragResize(wx, wy, e); break;
      case 'rotate': dragRotate(wx, wy, e); break;
      case 'point': dragPoint(wx, wy, e); break;
      case 'marquee': {
        action.x1 = wx; action.y1 = wy;
        const x1 = Math.min(action.x0, wx), x2 = Math.max(action.x0, wx), y1 = Math.min(action.y0, wy), y2 = Math.max(action.y0, wy);
        const next = new Set(action.base);
        for (const el of els) {
          if (el.containerId || el.locked) continue;
          const [a, b, c, d] = K.bounds(el);
          if (a >= x1 && c <= x2 && b >= y1 && d <= y2) for (const id of groupMembers(el)) next.add(id);
        }
        selected = next;
        break;
      }
      case 'erase': eraseAt(wx, wy); break;
      case 'laser': {
        const stroke = laser[laser.length - 1], evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        for (const ev of evs.length ? evs : [e]) { const [cx, cy] = toWorld(...mouse(ev)); stroke.pts.push([cx, cy, performance.now()]); }
        break;
      }
    }
    requestRender();
  }

  function onUp(e) {
    const a = action;
    action = null;
    if (!a) return;
    try { canvas.releasePointerCapture(e.pointerId); } catch { }
    switch (a.type) {
      case 'pan': updateCursor(); return;
      case 'create': {
        const el = a.el;
        if (Math.abs(el.width) * view.zoom < 3 && Math.abs(el.height) * view.zoom < 3) { deleteIds([el.id]); toolDone(null); requestRender(); return; }
        commit(); toolDone(el);
        break;
      }
      case 'createLinear': {
        const el = a.el;
        if (!a.dragged) {
          // A click without dragging starts click-by-click placement.
          multi = { el };
          const pts = K.absPoints(el);
          pts[1] = [...pts[0]];
          K.setAbsPoints(el, pts);
          requestRender();
          return;
        }
        bindEnd(el, 'start'); bindEnd(el, 'end'); bindHint = null;
        commit(); toolDone(el);
        break;
      }
      case 'freedraw': {
        const el = a.el;
        if (el.points.length === 1) el.points.push([0.01, 0.01]);
        K.syncPointsSize(el); K.mutate(el);
        commit(); toolDone(null);
        break;
      }
      case 'move': {
        if (!a.moved && !a.shift && a.hit && selected.size > 1 && a.wasSelected) {
          // Plain click on part of a multi-selection selects just that item.
          selected = new Set(groupMembers(a.hit));
        }
        if (a.moved) commit();
        break;
      }
      case 'point': {
        const el = a.el;
        if (el.type === 'arrow' && (a.index === 0 || a.index === el.points.length - 1)) bindEnd(el, a.index === 0 ? 'start' : 'end');
        bindHint = null;
        afterChange([el]);
        commit();
        break;
      }
      case 'resize': case 'rotate': commit(); break;
      case 'marquee': break;
      case 'erase': {
        if (eraseSet.size) { deleteIds([...eraseSet]); eraseSet = new Set(); commit(); }
        break;
      }
    }
    renderProps();
    requestRender();
  }

  function downSelect(e, wx, wy, mx, my) {
    const h = handleAt(mx, my);
    if (h) {
      const sel = selectedEls();
      const orig = new Map(withBound(sel).map(el => [el.id, JSON.parse(JSON.stringify(el))]));
      if (h.type === 'point' || h.type === 'mid') {
        const el = h.el;
        let index = h.index;
        if (h.type === 'mid') {
          const pts = K.absPoints(el);
          pts.splice(index, 0, [wx, wy]);
          K.setAbsPoints(el, pts);
        }
        action = { type: 'point', el, index, orig: K.absPoints(el) };
        if (el.type === 'arrow' && (index === 0 || index === el.points.length - 1)) unbind(el, index === 0 ? 'start' : 'end');
        return;
      }
      const f = selectionFrame();
      if (h.type === 'rotate') { action = { type: 'rotate', frame: f, orig, start: Math.atan2(wy - f.cy, wx - f.cx) }; return; }
      // Where the pointer sits relative to the edge being dragged, so the box doesn't jump.
      const [lx, ly] = K.rotate(wx, wy, f.cx, f.cy, -f.angle);
      const grab = [h.name.includes('e') ? lx - f.x2 : h.name.includes('w') ? lx - f.x1 : 0, h.name.includes('s') ? ly - f.y2 : h.name.includes('n') ? ly - f.y1 : 0];
      action = { type: 'resize', handle: h.name, frame: f, orig, grab };
      return;
    }
    const badge = linkBadgeAt(mx, my);
    if (badge) { openLink(badge.link); return; }
    const hit = elementAt(wx, wy);
    if (hit) {
      if ((e.ctrlKey || e.metaKey) && linkOf(hit)) { openLink(linkOf(hit)); return; }
      const ids = groupMembers(hit);
      const wasSelected = selected.has(hit.id);
      if (e.shiftKey) {
        if (ids.every(id => selected.has(id))) for (const id of ids) selected.delete(id);
        else for (const id of ids) selected.add(id);
      } else if (!wasSelected) selected = new Set(ids);
      if (!selected.has(hit.id)) { renderProps(); requestRender(); return; }
      let moving = withBound(selectedEls());
      if (e.altKey) {
        // Alt-drag leaves a copy behind and moves the duplicate.
        const copies = cloneElements(moving, 0, 0);
        els.push(...copies);
        fixTextOrder();
        selected = new Set(copies.filter(c => !c.containerId).map(c => c.id));
        moving = copies;
      }
      action = {
        type: 'move', start: [wx, wy], mx, my, moved: false, hit, shift: e.shiftKey, wasSelected,
        orig: new Map(moving.map(el => [el.id, { x: el.x, y: el.y }])),
      };
      renderProps();
      return;
    }
    if (!e.shiftKey) selected = new Set();
    action = { type: 'marquee', x0: wx, y0: wy, x1: wx, y1: wy, base: new Set(selected) };
    renderProps();
  }

  function dragMove(wx, wy, mx, my, e) {
    const a = action;
    if (!a.moved && Math.hypot(mx - a.mx, my - a.my) < 3) return;
    if (!a.moved) {
      // Arrows dragged away on their own let go of the shapes they were attached to.
      for (const id of a.orig.keys()) {
        const el = byId(id);
        if (el?.type === 'arrow') for (const w of ['start', 'end']) { const b = el[w + 'Binding']; if (b && !a.orig.has(b.elementId)) unbind(el, w); }
      }
    }
    a.moved = true;
    let dx = wx - a.start[0], dy = wy - a.start[1];
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const first = a.orig.values().next().value;
    if (first && gridSize()) { dx = snap(first.x + dx, e) - first.x; dy = snap(first.y + dy, e) - first.y; }
    const moved = [];
    for (const [id, o] of a.orig) {
      const el = byId(id);
      if (!el) continue;
      K.mutate(el, { x: o.x + dx, y: o.y + dy });
      moved.push(el);
    }
    afterChange(moved.filter(el => !el.containerId));
  }

  function elementAt(wx, wy) {
    const tol = 10 / view.zoom;
    // Selected elements can be grabbed anywhere inside their box.
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (selected.has(el.id) && !el.locked && K.hitTest(el, wx, wy, tol, { inside: !K.hasPoints(el) })) return el;
    }
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (el.locked) continue;
      if (K.hitTest(el, wx, wy, tol)) {
        if (el.containerId) { const c = byId(el.containerId); if (c) return c; }
        return el;
      }
      const t = boundTextOf(el);
      if (t && K.hitTest(t, wx, wy, tol)) return el;
    }
    return null;
  }

  function hoverCursor(mx, my, wx, wy) {
    if (spaceDown || tool !== 'selection') return;
    const h = handleAt(mx, my);
    let c = 'default';
    if (h) c = h.type === 'rotate' ? 'grab' : h.type === 'point' || h.type === 'mid' ? 'pointer' : resizeCursor(h.name, selectionFrame()?.angle || 0);
    else if (linkBadgeAt(mx, my)) c = 'pointer';
    else { const hit = elementAt(wx, wy); if (hit) c = selected.has(hit.id) ? 'move' : 'pointer'; }
    canvas.style.cursor = c;
  }

  function onDouble(e) {
    if (tool !== 'selection' || multi) { if (multi) finishMulti(); return; }
    const [mx, my] = mouse(e);
    const [wx, wy] = toWorld(mx, my);
    const hit = elementAt(wx, wy);
    if (hit && hit.type === 'text') return editText(hit, false);
    if (hit && K.canContainText(hit)) return editContainerText(hit);
    if (hit && hit.type === 'line') {
      // Double-click a line to add a bend point there.
      const pts = K.absPoints(hit);
      let best = 1, bd = Infinity;
      for (let i = 1; i < pts.length; i++) { const d = K.distToPolyline([wx, wy], [pts[i - 1], pts[i]]); if (d < bd) { bd = d; best = i; } }
      pts.splice(best, 0, [wx, wy]);
      K.setAbsPoints(hit, pts);
      commit(); requestRender();
      return;
    }
    if (!hit) newTextAt(wx, wy);
  }

  function onWheel(e) {
    e.preventDefault();
    const [mx, my] = mouse(e);
    const mult = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || e.metaKey) {
      zoomAt(mx, my, view.zoom * Math.exp(-e.deltaY * mult * (Math.abs(e.deltaY) < 20 ? 0.01 : 0.0025)));
    } else {
      let dx = e.deltaX * mult, dy = e.deltaY * mult;
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      view.sx -= dx / view.zoom; view.sy -= dy / view.zoom;
      if (editing) positionEditor();
      requestRender();
    }
  }

  function zoomAt(mx, my, z) {
    z = Math.max(0.1, Math.min(30, z));
    const [wx, wy] = toWorld(mx, my);
    view.zoom = z;
    view.sx = mx / z - wx; view.sy = my / z - wy;
    if (editing) positionEditor();
    requestRender();
  }
  const zoomBy = f => zoomAt(cw() / 2, ch() / 2, view.zoom * f);

  function fitView(render = true, only) {
    const list = only && only.length ? only : els;
    const b = K.commonBounds(list);
    if (!b || !cw()) { view = { sx: cw() / 2 || 0, sy: ch() / 2 || 0, zoom: 1 }; if (!b) { view.sx = (cw() || 800) / 2 - 200; view.sy = (ch() || 600) / 2 - 150; } }
    else {
      const w = Math.max(40, b[2] - b[0]), h = Math.max(40, b[3] - b[1]);
      const z = Math.max(0.1, Math.min(1, (cw() - 120) / w, (ch() - 160) / h));
      view.zoom = z;
      view.sx = cw() / 2 / z - (b[0] + b[2]) / 2;
      view.sy = ch() / 2 / z - (b[1] + b[3]) / 2;
    }
    if (render) requestRender();
  }

  // ============================================================ creating

  function startShape(type, wx, wy, e) {
    const el = K.newElement(type, { x: snap(wx, e), y: snap(wy, e), ...styleFor(type) });
    els.push(el);
    selected = new Set([el.id]);
    action = { type: 'create', el, x0: el.x, y0: el.y };
  }
  function dragShape(wx, wy, e) {
    const { el, x0, y0 } = action;
    let w = snap(wx, e) - x0, h = snap(wy, e) - y0;
    if (e.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
    let x = w < 0 ? x0 + w : x0, y = h < 0 ? y0 + h : y0;
    if (e.altKey) { x = x0 - Math.abs(w); y = y0 - Math.abs(h); w *= 2; h *= 2; }
    K.mutate(el, { x, y, width: Math.abs(w), height: Math.abs(h) });
  }

  function angleSnap(from, to, on) {
    if (!on || !from) return to;
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12), r = Math.hypot(dx, dy);
    return [from[0] + Math.cos(a) * r, from[1] + Math.sin(a) * r];
  }

  function startLinear(type, wx, wy, e) {
    const el = K.newElement(type, { x: snap(wx, e), y: snap(wy, e), ...styleFor(type), points: [[0, 0], [0, 0]] });
    els.push(el);
    selected = new Set([el.id]);
    action = { type: 'createLinear', el, dragged: false, mx0: e.clientX, my0: e.clientY };
  }
  function dragLinear(wx, wy, mx, my, e) {
    const el = action.el;
    if (!action.dragged && Math.hypot(e.clientX - action.mx0, e.clientY - action.my0) < 4) return;
    action.dragged = true;
    const p = angleSnap([el.x, el.y], [snap(wx, e), snap(wy, e)], e.shiftKey);
    K.setAbsPoints(el, [[el.x, el.y], p]);
    bindHint = el.type === 'arrow' ? bindableAt(p, el) : null;
  }

  function multiClick(wx, wy, mx, my, e) {
    const el = multi.el;
    const pts = K.absPoints(el);
    const n = pts.length;
    const prev = pts[n - 2];
    const [px, py] = toScreen(prev[0], prev[1]);
    if (Math.hypot(px - mx, py - my) < 6) { finishMulti(); return; } // clicked the last point again
    const [fx, fy] = toScreen(pts[0][0], pts[0][1]);
    if (el.type === 'line' && n > 3 && Math.hypot(fx - mx, fy - my) < 10) {
      pts[n - 1] = [...pts[0]]; // close the shape; finishMulti drops the extra floating point
      K.setAbsPoints(el, [...pts, [...pts[0]]]);
      finishMulti(true);
      return;
    }
    pts[n - 1] = angleSnap(prev, [snap(wx, e), snap(wy, e)], e.shiftKey);
    pts.push([...pts[n - 1]]);
    K.setAbsPoints(el, pts);
    requestRender();
  }

  // Finish click-by-click placement; returns true if there was one.
  function finishMulti(closed = false) {
    if (!multi) return false;
    const el = multi.el;
    multi = null; bindHint = null;
    const pts = K.absPoints(el);
    pts.pop(); // the point following the mouse
    while (pts.length > 2 && K.dist(pts[pts.length - 1], pts[pts.length - 2]) < 1) pts.pop();
    if (pts.length < 2 || (pts.length === 2 && K.dist(pts[0], pts[1]) < 1)) {
      deleteIds([el.id]);
      toolDone(null);
      requestRender();
      return true;
    }
    K.setAbsPoints(el, pts);
    if (!closed) { bindEnd(el, 'start'); bindEnd(el, 'end'); }
    commit(); toolDone(el); requestRender();
    return true;
  }

  function startFreedraw(wx, wy, e) {
    const pen = e.pointerType === 'pen';
    const el = K.newElement('freedraw', {
      x: wx, y: wy, ...styleFor('freedraw'), backgroundColor: 'transparent', points: [[0, 0]],
      pressures: pen ? [e.pressure || 0.5] : [], simulatePressure: !pen,
    });
    els.push(el);
    action = { type: 'freedraw', el };
  }

  function eraseAt(wx, wy) {
    const tol = 8 / view.zoom;
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (el.locked || eraseSet.has(el.id)) continue;
      if (K.hitTest(el, wx, wy, tol, { inside: el.type === 'text' || el.type === 'image' })) {
        const target = el.containerId ? byId(el.containerId) || el : el;
        for (const id of groupMembers(target)) eraseSet.add(id);
        eraseSet.add(target.id);
        const t = boundTextOf(target); if (t) eraseSet.add(t.id);
      }
    }
  }

  // ============================================================ text editing

  function textAt(wx, wy, e) {
    const hit = elementAt(wx, wy);
    if (hit && hit.type === 'text') return editText(hit, false);
    if (hit && K.isShape(hit)) return editContainerText(hit);
    newTextAt(wx, wy, e);
  }

  function newTextAt(wx, wy, e) {
    const s = styleFor('text');
    const el = K.newElement('text', { ...s, x: snap(wx, e), y: snap(wy, e) - s.fontSize * 1.25 / 2, text: '', originalText: '', width: 1, height: s.fontSize * 1.25 });
    els.push(el);
    editText(el, true);
  }

  function editContainerText(c) {
    let t = boundTextOf(c);
    if (!t) {
      const s = styleFor('text');
      t = K.newElement('text', {
        ...s, strokeColor: c.strokeColor, opacity: c.opacity, textAlign: 'center', verticalAlign: 'middle', containerId: c.id,
        groupIds: [...(c.groupIds || [])], text: '', originalText: '',
      });
      const i = els.indexOf(c);
      els.splice(i + 1, 0, t);
      addBound(c, t.id, 'text');
      K.layoutBoundText(t, c);
      return editText(t, true, c);
    }
    editText(t, false, c);
  }

  function editText(el, isNew, container = el.containerId ? byId(el.containerId) : null) {
    commitText();
    selected = new Set();
    const ta = document.createElement('textarea');
    ta.className = 'dr-textedit';
    ta.spellcheck = false;
    ta.value = el.rawText ?? el.originalText ?? el.text;
    ta.wrap = container ? 'soft' : 'off';
    root.append(ta);
    editing = { el, ta, container, isNew };
    positionEditor();
    const focus = () => { if (editing?.ta === ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } };
    focus();
    setTimeout(focus, 0); // again once the click that started this has finished moving focus to the canvas
    ta.addEventListener('input', () => {
      if (!editing) return;
      el.originalText = ta.value;
      if (el.rawText != null) el.rawText = ta.value;
      if (container) K.layoutBoundText(el, container);
      else { el.text = ta.value; K.refreshText(el); }
      positionEditor();
      requestRender();
    });
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); commitText(); canvas.focus(); }
      if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    });
    ta.addEventListener('blur', () => setTimeout(() => { if (editing && editing.ta === ta && document.activeElement !== ta) commitText(); }, 0));
    renderProps();
    requestRender();
  }

  function positionEditor() {
    if (!editing) return;
    const { el, ta, container } = editing;
    const z = view.zoom;
    let x = el.x, w = Math.max(el.width, 1) + el.fontSize * 0.5;
    if (container && !K.isLinear(container)) {
      const b = K.absBox(container), maxW = Math.max(el.fontSize, K.boundTextMaxWidth(container));
      w = maxW; x = b.cx - maxW / 2;
    } else if (el.textAlign === 'center') x = el.x - el.fontSize * 0.25;
    else if (el.textAlign === 'right') x = el.x - el.fontSize * 0.5;
    const [sx, sy] = toScreen(x, el.y);
    Object.assign(ta.style, {
      left: sx + 'px', top: sy + 'px', width: w * z + 'px', height: Math.max(el.height, el.fontSize * K.lineHeightOf(el)) * z + 'px',
      font: `${el.fontSize * z}px ${K.fontCss(el.fontFamily)}`, lineHeight: String(K.lineHeightOf(el)),
      color: K.themeColor(el.strokeColor, dark), textAlign: el.textAlign || 'left',
      transform: el.angle ? `rotate(${el.angle}rad)` : '', transformOrigin: `${el.width * z / 2}px ${el.height * z / 2}px`,
      whiteSpace: container ? 'pre-wrap' : 'pre', opacity: String((el.opacity ?? 100) / 100),
    });
  }

  function commitText() {
    if (!editing) return;
    const { el, ta, container } = editing;
    editing = null;
    ta.remove();
    if (!byId(el.id)) return;
    if (!(el.originalText ?? el.text).trim()) {
      deleteIds([el.id]);
      if (container) selected = new Set([container.id]);
    } else {
      if (container) K.layoutBoundText(el, container); else { el.text = el.originalText; K.refreshText(el); }
      selected = new Set([container ? container.id : el.id]);
    }
    commit();
    toolDone(container || (byId(el.id) ? el : null));
    requestRender();
  }
  function cancelEditing() { if (editing) { editing.ta.remove(); editing = null; } }

  // ============================================================ transforming

  // The selection's frame in scene coordinates: rotated box for one element, bounds for many.
  function selectionFrame() {
    const sel = selectedEls();
    if (!sel.length) return null;
    if (sel.length === 1) {
      const el = sel[0];
      if (K.isLinear(el) && el.points.length <= 2) return { linear: el };
      const b = K.absBox(el);
      return { single: el, ...b, angle: el.angle || 0, linear: K.isLinear(el) ? el : null };
    }
    const cb = K.commonBounds(withBound(sel));
    return { x1: cb[0], y1: cb[1], x2: cb[2], y2: cb[3], cx: (cb[0] + cb[2]) / 2, cy: (cb[1] + cb[3]) / 2, angle: 0, multi: true };
  }

  function handles() {
    if (action && action.type !== 'resize' && action.type !== 'rotate' && action.type !== 'point') return [];
    if (tool !== 'selection' || editing) return [];
    const f = selectionFrame();
    if (!f) return [];
    const out = [];
    const lin = f.linear;
    if (lin) {
      const pts = K.absPoints(lin);
      pts.forEach((p, i) => out.push({ type: 'point', el: lin, index: i, p: toScreen(p[0], p[1]) }));
      for (let i = 1; i < pts.length; i++) {
        const a = toScreen(...pts[i - 1]), b = toScreen(...pts[i]);
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 36 && !K.isCurved(lin)) out.push({ type: 'mid', el: lin, index: i, p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
      }
      if (!f.single) return out;
    }
    if (f.single?.locked) return out;
    const pad = 6 / view.zoom;
    const x1 = f.x1 - pad, y1 = f.y1 - pad, x2 = f.x2 + pad, y2 = f.y2 + pad, cx = f.cx, cy = f.cy;
    const sw = (x2 - x1) * view.zoom, sh = (y2 - y1) * view.zoom;
    const pos = { nw: [x1, y1], ne: [x2, y1], se: [x2, y2], sw: [x1, y2] };
    const text = f.single?.type === 'text';
    if (!f.multi && !text && !lin) {
      if (sw > 40) { pos.n = [cx, y1]; pos.s = [cx, y2]; }
      if (sh > 40) { pos.e = [x2, cy]; pos.w = [x1, cy]; }
    }
    if (!lin) for (const [name, [x, y]] of Object.entries(pos)) out.push({ type: 'resize', name, p: toScreen(...K.rotate(x, y, cx, cy, f.angle)) });
    out.push({ type: 'rotate', p: toScreen(...K.rotate(cx, y1 - 22 / view.zoom, cx, cy, f.angle)) });
    return out;
  }

  function handleAt(mx, my) {
    let best = null, bd = 9;
    for (const h of handles()) {
      const d = Math.hypot(h.p[0] - mx, h.p[1] - my);
      if (d < bd || (h.type === 'point' && d < bd + 2)) { best = h; bd = d; }
    }
    return best;
  }

  function resizeCursor(name, angle) {
    const base = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 }[name] ?? 0;
    const a = ((base + angle * 180 / Math.PI) % 180 + 180) % 180;
    return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(a / 45) % 4];
  }

  function dragResize(wx, wy, e) {
    const { frame: f, handle, orig, grab } = action;
    const keepText = f.single?.type === 'text' || f.single?.type === 'image';
    if (f.multi) return resizeMulti(wx - grab[0], wy - grab[1], e);
    const el = f.single, o = orig.get(el.id), a = f.angle;
    const ob = K.absBox(o);
    let [lx, ly] = K.rotate(wx, wy, ob.cx, ob.cy, -a);
    lx -= grab[0]; ly -= grab[1];
    const ow = (ob.x2 - ob.x1) || 1, oh = (ob.y2 - ob.y1) || 1;
    let x1 = ob.x1, y1 = ob.y1, x2 = ob.x2, y2 = ob.y2;
    if (handle.includes('e')) x2 = snap(lx, e); if (handle.includes('w')) x1 = snap(lx, e);
    if (handle.includes('s')) y2 = snap(ly, e); if (handle.includes('n')) y1 = snap(ly, e);
    if (e.altKey) {
      if (handle.includes('e')) x1 = 2 * ob.cx - x2; if (handle.includes('w')) x2 = 2 * ob.cx - x1;
      if (handle.includes('s')) y1 = 2 * ob.cy - y2; if (handle.includes('n')) y2 = 2 * ob.cy - y1;
    }
    let sx = (x2 - x1) / ow, sy = (y2 - y1) / oh;
    if (e.shiftKey !== keepText) {
      // Keep the aspect ratio.
      if (handle === 'n' || handle === 's') sx = Math.abs(sy) * Math.sign(sx || 1);
      else if (handle === 'e' || handle === 'w') sy = Math.abs(sx) * Math.sign(sy || 1);
      else { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = s * Math.sign(sx || 1); sy = s * Math.sign(sy || 1); }
      const ax = e.altKey ? ob.cx : handle.includes('w') ? ob.x2 : handle.includes('e') ? ob.x1 : ob.cx;
      const ay = e.altKey ? ob.cy : handle.includes('n') ? ob.y2 : handle.includes('s') ? ob.y1 : ob.cy;
      const fx = ax === ob.cx ? 0.5 : ax === ob.x2 ? 1 : 0, fy = ay === ob.cy ? 0.5 : ay === ob.y2 ? 1 : 0;
      x1 = ax - ow * sx * fx; x2 = x1 + ow * sx;
      y1 = ay - oh * sy * fy; y2 = y1 + oh * sy;
    }
    if (el.type === 'text') {
      // Text scales uniformly from the opposite corner and never flips.
      const k = Math.max(0.05, Math.abs(sx), Math.abs(sy));
      sx = sy = k;
      x1 = handle.includes('w') ? ob.x2 - ow * k : ob.x1; x2 = x1 + ow * k;
      y1 = handle.includes('n') ? ob.y2 - oh * k : ob.y1; y2 = y1 + oh * k;
    }
    const nx1 = Math.min(x1, x2), ny1 = Math.min(y1, y2), nw = Math.abs(x2 - x1), nh = Math.abs(y2 - y1);
    const ncx = nx1 + nw / 2, ncy = ny1 + nh / 2;
    const [wcx, wcy] = K.rotate(ncx, ncy, ob.cx, ob.cy, a);
    const dx = wcx - ncx, dy = wcy - ncy;
    if (K.hasPoints(el)) {
      const abs = o.points.map(([px, py]) => [x1 + (o.x + px - ob.x1) * sx + dx, y1 + (o.y + py - ob.y1) * sy + dy]);
      const [px0, py0] = abs[0];
      K.mutate(el, { x: px0, y: py0, points: abs.map(([px, py]) => [px - px0, py - py0]), angle: a });
      K.syncPointsSize(el);
    } else {
      const props = { x: nx1 + dx, y: ny1 + dy, width: nw, height: nh };
      if (el.type === 'image') props.scale = [(o.scale?.[0] ?? 1) * (x2 < x1 ? -1 : 1), (o.scale?.[1] ?? 1) * (y2 < y1 ? -1 : 1)];
      if (el.type === 'text') { props.fontSize = Math.max(1, o.fontSize * Math.abs(sy)); }
      K.mutate(el, props);
    }
    afterChange([el]);
  }

  function resizeMulti(wx, wy, e) {
    const { frame: f, handle, orig } = action;
    const ax = handle.includes('w') ? f.x2 : f.x1, ay = handle.includes('n') ? f.y2 : f.y1;
    const hx = handle.includes('w') ? f.x1 : f.x2, hy = handle.includes('n') ? f.y1 : f.y2;
    const s = Math.max(0.02, Math.max((wx - ax) / (hx - ax || 1), (wy - ay) / (hy - ay || 1)));
    const changedEls = [];
    for (const [id, o] of orig) {
      const el = byId(id);
      if (!el) continue;
      const props = { x: ax + (o.x - ax) * s, y: ay + (o.y - ay) * s, width: o.width * s, height: o.height * s };
      if (o.points) props.points = o.points.map(([px, py]) => [px * s, py * s]);
      if (o.type === 'text') props.fontSize = Math.max(1, o.fontSize * s);
      K.mutate(el, props);
      changedEls.push(el);
    }
    afterChange(changedEls.filter(el => !el.containerId));
  }

  function dragRotate(wx, wy, e) {
    const { frame: f, orig, start } = action;
    let delta = Math.atan2(wy - f.cy, wx - f.cx) - start;
    if (f.single) {
      let ang = ((orig.get(f.single.id).angle || 0) + delta) % TAU;
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      K.mutate(f.single, { angle: (ang + TAU) % TAU });
      afterChange([f.single]);
      return;
    }
    if (e.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
    const changedEls = [];
    for (const [id, o] of orig) {
      const el = byId(id);
      if (!el || el.containerId) continue;
      const b = K.absBox(o);
      const [ncx, ncy] = K.rotate(b.cx, b.cy, f.cx, f.cy, delta);
      K.mutate(el, { x: o.x + ncx - b.cx, y: o.y + ncy - b.cy, angle: ((o.angle || 0) + delta + TAU) % TAU });
      changedEls.push(el);
    }
    afterChange(changedEls);
  }

  function dragPoint(wx, wy, e) {
    const { el, index } = action;
    const pts = K.absPoints(el);
    const nb = pts[index === 0 ? 1 : index - 1];
    pts[index] = angleSnap(nb, [snap(wx, e), snap(wy, e)], e.shiftKey);
    K.setAbsPoints(el, pts);
    const end = index === 0 || index === pts.length - 1;
    bindHint = el.type === 'arrow' && end ? bindableAt(pts[index], el) : null;
    afterChange([el]);
  }

  // ============================================================ commands

  function deleteSelected() {
    if (!selected.size) return;
    deleteIds([...selected]);
    commit(); renderProps(); requestRender();
  }
  function selectAll() {
    finishMulti();
    setTool('selection');
    selected = new Set(els.filter(e => !e.containerId && !e.locked).map(e => e.id));
    renderProps(); requestRender();
  }
  function duplicate() {
    const list = withBound(selectedEls());
    if (!list.length) return;
    const copies = cloneElements(list, 10, 10);
    els.push(...copies);
    fixTextOrder();
    selected = new Set(copies.filter(c => !c.containerId).map(c => c.id));
    afterChange(copies);
    commit(); renderProps(); requestRender();
  }
  function group() {
    const list = withBound(selectedEls());
    if (list.length < 2) return;
    const g = K.randomId();
    for (const el of list) K.mutate(el, { groupIds: [...(el.groupIds || []), g] });
    commit(); renderProps(); requestRender();
  }
  function ungroup() {
    const list = withBound(selectedEls());
    let any = false;
    for (const el of list) if (el.groupIds?.length) { K.mutate(el, { groupIds: el.groupIds.slice(0, -1) }); any = true; }
    if (any) { commit(); renderProps(); requestRender(); }
  }
  function reorder(where) {
    const moving = new Set(withBound(selectedEls()).map(e => e.id));
    if (!moving.size) return;
    const inSel = e => moving.has(e.id);
    if (where === 'front') scene.elements = els = [...els.filter(e => !inSel(e)), ...els.filter(inSel)];
    else if (where === 'back') scene.elements = els = [...els.filter(inSel), ...els.filter(e => !inSel(e))];
    else if (where === 'forward') {
      for (let i = els.length - 2; i >= 0; i--) if (inSel(els[i]) && !inSel(els[i + 1])) { let j = i; while (j >= 0 && inSel(els[j])) j--; const next = els.splice(i + 1, 1)[0]; els.splice(j + 1, 0, next); }
    } else if (where === 'backward') {
      for (let i = 1; i < els.length; i++) if (inSel(els[i]) && !inSel(els[i - 1])) { let j = i; while (j < els.length && inSel(els[j])) j++; const prev = els.splice(i - 1, 1)[0]; els.splice(j - 1, 0, prev); }
    }
    fixTextOrder();
    commit(); requestRender();
  }
  function align(how) {
    const sel = selectedEls();
    if (sel.length < 2) return;
    const units = new Map();
    for (const el of sel) { const g = el.groupIds?.[el.groupIds.length - 1] || el.id; if (!units.has(g)) units.set(g, []); units.get(g).push(el); }
    if (units.size < 2) return;
    const cb = K.commonBounds(withBound(sel));
    for (const list of units.values()) {
      const all = withBound(list), b = K.commonBounds(all);
      let dx = 0, dy = 0;
      if (how === 'left') dx = cb[0] - b[0];
      if (how === 'right') dx = cb[2] - b[2];
      if (how === 'hcenter') dx = (cb[0] + cb[2]) / 2 - (b[0] + b[2]) / 2;
      if (how === 'top') dy = cb[1] - b[1];
      if (how === 'bottom') dy = cb[3] - b[3];
      if (how === 'vcenter') dy = (cb[1] + cb[3]) / 2 - (b[1] + b[3]) / 2;
      for (const el of all) K.mutate(el, { x: el.x + dx, y: el.y + dy });
      afterChange(list);
    }
    commit(); requestRender();
  }
  function nudge(dx, dy) {
    const list = withBound(selectedEls());
    if (!list.length) return;
    for (const el of list) K.mutate(el, { x: el.x + dx, y: el.y + dy });
    afterChange(list.filter(el => !el.containerId));
    commit(); requestRender();
  }
  function toggleGrid() {
    const on = !gridSize();
    // Newer Excalidraw files keep gridSize and switch gridModeEnabled; older ones use gridSize: null.
    if ('gridModeEnabled' in scene.appState) { scene.appState.gridModeEnabled = on; if (on && !scene.appState.gridSize) scene.appState.gridSize = 20; }
    else scene.appState.gridSize = on ? 20 : null;
    changed(); requestRender();
  }
  function toggleLock() {
    const sel = selectedEls();
    if (!sel.length) return;
    const lock = !sel.every(e => e.locked);
    for (const el of withBound(sel)) K.mutate(el, { locked: lock });
    if (lock) selected = new Set();
    commit(); renderProps(); requestRender();
  }
  function unlockAll() {
    let any = false;
    for (const el of els) if (el.locked) { K.mutate(el, { locked: false }); any = true; }
    if (any) { commit(); requestRender(); }
  }
  async function editLink() {
    const sel = selectedEls();
    if (!sel.length) return;
    const cur = sel[0].link || '';
    const v = await hooks.prompt?.('Link', 'A [[note]], note name or https:// address (empty to remove)', cur);
    if (v == null) return;
    for (const el of sel) K.mutate(el, { link: v.trim() || null });
    commit(); requestRender();
  }
  async function clearCanvas() {
    if (!els.length) return;
    const ok = hooks.confirm ? await hooks.confirm('Clear the whole drawing?', 'Undo can bring it back.', { ok: 'Clear', danger: true }) : confirm('Clear the whole drawing?');
    if (!ok) return;
    deleteIds(els.map(e => e.id));
    commit(); renderProps(); requestRender();
  }

  function escape() {
    if (finishMulti()) return;
    if (selected.size) { selected = new Set(); renderProps(); requestRender(); return; }
    if (tool !== 'selection') setTool('selection');
  }

  // ============================================================ links

  function linkOf(el) {
    if (el.link) return el.link;
    const t = el.type === 'text' ? el : boundTextOf(el);
    const m = t && /\[\[([^\]]+)\]\]/.exec(t.originalText ?? t.text);
    return m ? `[[${m[1]}]]` : null;
  }
  function openLink(link) { hooks.openLink?.(link); }
  function linkBadges() {
    const out = [];
    for (const el of els) {
      if (!el.link || el.isDeleted) continue;
      const b = K.bounds(el);
      const [x, y] = toScreen(b[2], b[1]);
      out.push({ link: el.link, x: x + 4, y: y - 20 });
    }
    return out;
  }
  function linkBadgeAt(mx, my) {
    return linkBadges().find(b => mx >= b.x && mx <= b.x + 18 && my >= b.y && my <= b.y + 18) || null;
  }

  // ============================================================ images

  function imageFor(el) {
    const id = el.fileId;
    if (!id) return null;
    let rec = images.get(id);
    if (!rec) {
      const src = scene.files?.[id]?.dataURL || fileUrls[id];
      if (!src) return null;
      const img = new Image();
      rec = { img, ok: false };
      images.set(id, rec);
      img.onload = () => { rec.ok = true; requestRender(); };
      img.src = src;
    }
    return rec.ok ? rec.img : null;
  }

  const readDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

  async function addImageFile(file, at) {
    if (!/^image\//.test(file.type)) { hooks.toast?.('Only images can be added to a drawing'); return; }
    if (file.size > 20 * 1024 * 1024) { hooks.toast?.('That image is too large (over 20 MB)'); return; }
    const dataURL = await readDataURL(file);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataURL; }).catch(() => null);
    if (!img.naturalWidth) { hooks.toast?.('Couldn’t read that image'); return; }
    const id = K.randomId(40);
    scene.files[id] = { mimeType: file.type || 'image/png', id, dataURL, created: Date.now(), lastRetrieved: Date.now() };
    images.set(id, { img, ok: true });
    const max = Math.min(600, cw() * 0.6 / view.zoom);
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > max) { h *= max / w; w = max; }
    const [cx, cy] = at || toWorld(cw() / 2, ch() / 2);
    const el = K.newElement('image', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, fileId: id, strokeColor: 'transparent', backgroundColor: 'transparent' });
    els.push(el);
    setTool('selection');
    selected = new Set([el.id]);
    commit(); renderProps(); requestRender();
  }

  async function onDrop(e) {
    e.preventDefault();
    const at = toWorld(...mouse(e));
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) { for (const f of files) await addImageFile(f, at); return; }
    const path = e.dataTransfer?.getData('text/plain');
    if (path && hooks.fetchVaultImage) {
      const blob = await hooks.fetchVaultImage(path);
      if (blob) await addImageFile(blob, at);
    }
  }

  // ============================================================ clipboard

  // Keys belong to the drawing unless focus is in a field, a dialog or another pane (file tree, sidebars).
  const activeFor = e => visible && !editing && !(e.target && (e.target.closest?.('input, textarea, select, [contenteditable], #left, #right, #ribbon'))) && !hooks.modalOpen?.();

  function clipboardPayload() {
    const list = withBound(selectedEls());
    const files = {};
    for (const el of list) if (el.type === 'image' && scene.files[el.fileId]) files[el.fileId] = scene.files[el.fileId];
    return { type: 'excalidraw/clipboard', elements: list, files };
  }
  function onClipboard(e, kind) {
    if (!activeFor(e) || !selected.size) return;
    const payload = clipboardPayload();
    clip = JSON.parse(JSON.stringify(payload));
    e.clipboardData.setData('text/plain', JSON.stringify(payload));
    e.preventDefault();
    if (kind === 'cut') deleteSelected();
  }
  function pasteData(data, at) {
    if (!data?.elements?.length) return false;
    Object.assign(scene.files, data.files || {});
    const b = K.commonBounds(data.elements);
    const [px, py] = at || pointerWorld;
    const copies = cloneElements(data.elements.filter(e => e && e.type && !e.isDeleted), px - (b[0] + b[2]) / 2, py - (b[1] + b[3]) / 2);
    els.push(...copies);
    fixTextOrder();
    setTool('selection');
    selected = new Set(copies.filter(c => !c.containerId).map(c => c.id));
    afterChange(copies);
    commit(); renderProps(); requestRender();
    return true;
  }
  function onPaste(e) {
    if (!activeFor(e)) return;
    const files = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); files.forEach(f => addImageFile(f, pointerWorld)); return; }
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    try {
      const data = JSON.parse(text);
      if (data && (data.type === 'excalidraw/clipboard' || data.type === 'excalidraw') && pasteData(data)) return;
    } catch { }
    const s = styleFor('text');
    const el = K.newElement('text', { ...s, x: pointerWorld[0], y: pointerWorld[1], text: text.replace(/\r\n?/g, '\n'), originalText: text.replace(/\r\n?/g, '\n') });
    K.refreshText(el);
    els.push(el);
    setTool('selection');
    selected = new Set([el.id]);
    commit(); renderProps(); requestRender();
  }

  // ============================================================ keyboard

  function onKey(e) {
    if (!visible || editing || e.altKey || !activeFor(e)) return; // Alt+←/→ is Cinder's back/forward
    const mod = e.ctrlKey || e.metaKey, k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let handled = true;
    if (mod && k === 'z' && !e.shiftKey) undo();
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) redo();
    else if (mod && k === 'a') selectAll();
    else if (mod && k === 'd') duplicate();
    else if (mod && k === 'g') e.shiftKey ? ungroup() : group();
    else if (mod && (k === '=' || k === '+')) zoomBy(1.2);
    else if (mod && k === '-') zoomBy(1 / 1.2);
    else if (mod && k === '0') zoomAt(cw() / 2, ch() / 2, 1);
    else if (mod && k === "'") toggleGrid();
    else if (mod && k === ']') reorder(e.shiftKey ? 'front' : 'forward');
    else if (mod && k === '[') reorder(e.shiftKey ? 'back' : 'backward');
    else if (mod && e.shiftKey && k === 'l') toggleLock();
    else if (mod && k === 'k') editLink();
    else if (mod) handled = false;
    else if (e.shiftKey && e.code === 'Digit1') fitView();
    else if (e.shiftKey && e.code === 'Digit2') fitView(true, withBound(selectedEls()));
    else if (k === 'Delete' || k === 'Backspace') deleteSelected();
    else if (k.startsWith('Arrow')) {
      const step = e.shiftKey ? 5 * (gridSize() ? gridSize() / 5 : 1) : (gridSize() || 1);
      nudge(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
    }
    else if (k === 'Escape') escape();
    else if (k === 'Enter') {
      if (!finishMulti()) {
        const sel = selectedEls();
        if (sel.length === 1 && sel[0].type === 'text') editText(sel[0], false);
        else if (sel.length === 1 && K.canContainText(sel[0])) editContainerText(sel[0]);
        else handled = false;
      }
    }
    else if (k === ' ') { if (!spaceDown) { spaceDown = true; updateCursor(); } }
    else if (k === 'q') toggleToolLock();
    else if (k === '?') showHelp();
    else if (TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }
  function toggleToolLock() { locked = !locked; lockBtn.classList.toggle('active', locked); }

  // ============================================================ menus

  function onContext(e) {
    e.preventDefault();
    if (!hooks.menu) return;
    const [mx, my] = mouse(e);
    const [wx, wy] = toWorld(mx, my);
    pointerWorld = [wx, wy];
    const hit = elementAt(wx, wy);
    if (hit && !selected.has(hit.id)) { selected = new Set(groupMembers(hit)); renderProps(); requestRender(); }
    else if (!hit && selected.size) { selected = new Set(); renderProps(); requestRender(); }
    const sel = selectedEls();
    const items = [];
    if (sel.length) {
      items.push(
        ['Cut', () => { clip = clipboardPayload(); deleteSelected(); }],
        ['Copy', () => { clip = clipboardPayload(); }],
      );
    }
    if (clip) items.push(['Paste', () => pasteData(JSON.parse(JSON.stringify(clip)), [wx, wy])]);
    if (sel.length) {
      items.push(
        ['Duplicate', () => duplicate()],
        null,
        ['Bring to front', () => reorder('front')], ['Bring forward', () => reorder('forward')],
        ['Send backward', () => reorder('backward')], ['Send to back', () => reorder('back')],
        null,
      );
      if (sel.length > 1) items.push(['Group', () => group()]);
      if (sel.some(e => e.groupIds?.length)) items.push(['Ungroup', () => ungroup()]);
      items.push(
        [sel.every(e => e.locked) ? 'Unlock' : 'Lock', () => toggleLock()],
        [sel[0].link ? 'Edit link…' : 'Add link…', () => editLink()],
      );
      if (linkOf(sel[0])) items.push(['Open link', () => openLink(linkOf(sel[0]))]);
      items.push(null, ['Copy as PNG', () => hooks.copyPNG?.(true)], ['Copy as SVG', () => hooks.copySVG?.(true)], null, ['Delete', () => deleteSelected(), 'danger']);
    } else {
      items.push(['Select all', () => selectAll()]);
      if (els.some(e => e.locked)) items.push(['Unlock all', () => unlockAll()]);
      items.push(
        [gridSize() ? 'Hide grid' : 'Show grid', () => toggleGrid()],
        ['Zoom to fit', () => fitView()],
        null,
        ['Copy drawing as PNG', () => hooks.copyPNG?.(false)],
        ['Copy drawing as SVG', () => hooks.copySVG?.(false)],
      );
    }
    hooks.menu(e.clientX, e.clientY, items.filter((x, i, a) => x || (i > 0 && a[i - 1] && i < a.length - 1)));
  }

  function showMenu(btn) {
    const r = btn.getBoundingClientRect();
    hooks.menu?.(r.left, r.bottom + 6, [
      ['Export as SVG', () => hooks.exportFile?.('svg')],
      ['Export as PNG', () => hooks.exportFile?.('png')],
      ['Copy drawing as PNG', () => hooks.copyPNG?.(false)],
      ['Copy drawing as SVG', () => hooks.copySVG?.(false)],
      null,
      [gridSize() ? 'Hide grid' : 'Show grid', () => toggleGrid()],
      ['Zoom to fit', () => fitView()],
      ['Keyboard shortcuts', () => showHelp()],
      null,
      ['Clear canvas', () => clearCanvas(), 'danger'],
    ]);
  }

  function showHelp() {
    hooks.help?.(`<div class="dr-help"><h3>Drawing shortcuts</h3><div class="dr-help-cols">
      <div><h4>Tools</h4>${TOOLS.map(([, l, k]) => `<p><span>${esc(l)}</span><kbd>${esc(k)}</kbd></p>`).join('')}<p><span>Keep tool active</span><kbd>Q</kbd></p></div>
      <div><h4>Editing</h4>
        <p><span>Undo / redo</span><kbd>Ctrl Z</kbd> <kbd>Ctrl Y</kbd></p><p><span>Duplicate</span><kbd>Ctrl D</kbd> or <kbd>Alt</kbd>-drag</p>
        <p><span>Group / ungroup</span><kbd>Ctrl G</kbd> <kbd>Ctrl Shift G</kbd></p><p><span>Bring forward / to front</span><kbd>Ctrl ]</kbd> <kbd>Ctrl Shift ]</kbd></p>
        <p><span>Send backward / to back</span><kbd>Ctrl [</kbd> <kbd>Ctrl Shift [</kbd></p><p><span>Add link</span><kbd>Ctrl K</kbd></p>
        <p><span>Lock selection</span><kbd>Ctrl Shift L</kbd></p><p><span>Edit text / label</span><kbd>Enter</kbd> or double-click</p>
        <p><span>Square / straight / 15°</span>hold <kbd>Shift</kbd></p><p><span>Resize from centre</span>hold <kbd>Alt</kbd></p>
        <p><span>Finish a line</span><kbd>Enter</kbd> <kbd>Esc</kbd></p></div>
      <div><h4>View</h4>
        <p><span>Pan</span><kbd>Space</kbd>-drag, wheel</p><p><span>Zoom</span><kbd>Ctrl</kbd> + wheel</p>
        <p><span>Zoom in / out / 100%</span><kbd>Ctrl =</kbd> <kbd>Ctrl -</kbd> <kbd>Ctrl 0</kbd></p>
        <p><span>Zoom to fit / selection</span><kbd>Shift 1</kbd> <kbd>Shift 2</kbd></p><p><span>Grid</span><kbd>Ctrl '</kbd></p>
        <p><span>Follow a link</span><kbd>Ctrl</kbd>-click</p></div>
      </div></div>`);
  }

  function onUiClick(e) {
    const t = e.target.closest('[data-tool]');
    if (t) { setTool(t.dataset.tool); if (!hooks.modalOpen?.()) canvas.focus(); return; }
    const b = e.target.closest('[data-act]');
    if (b) {
      const act = b.dataset.act;
      ({
        'zoom-in': () => zoomBy(1.2), 'zoom-out': () => zoomBy(1 / 1.2), 'zoom-reset': () => zoomAt(cw() / 2, ch() / 2, 1),
        undo, redo, lock: toggleToolLock, menu: () => showMenu(b), help: showHelp,
        delete: deleteSelected, duplicate, group, ungroup, link: editLink,
        front: () => reorder('front'), back: () => reorder('back'), forward: () => reorder('forward'), backward: () => reorder('backward'),
        'al-left': () => align('left'), 'al-hcenter': () => align('hcenter'), 'al-right': () => align('right'),
        'al-top': () => align('top'), 'al-vcenter': () => align('vcenter'), 'al-bottom': () => align('bottom'),
      })[act]?.();
      if (!editing && !hooks.modalOpen?.()) canvas.focus(); // not away from a dialog it opened
      return;
    }
    const p = e.target.closest('[data-prop]');
    if (p && p.tagName === 'BUTTON') {
      let v = p.dataset.value;
      v = v === 'null' ? null : /^-?\d+(\.\d+)?$/.test(v) ? +v : v;
      applyProp(p.dataset.prop, v);
      if (editing) editing.ta.focus();
    }
  }

  // ============================================================ properties panel

  // What the panel edits: the selection, the text being edited, or the next thing the tool draws.
  function propTargets() {
    if (editing) return [editing.el];
    const sel = selectedEls();
    if (sel.length) return sel;
    if (['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text'].includes(tool)) return [{ ...K.newElement(tool, styleFor(tool)), _proto: true }];
    return [];
  }

  function applyProp(key, value) {
    style[key] = value;
    try { hooks.store?.('drawStyle', style); } catch { }
    const targets = propTargets().filter(t => !t._proto);
    const touched = [];
    for (const el of targets) {
      const text = el.type === 'text' ? el : boundTextOf(el);
      switch (key) {
        case 'fontSize': case 'fontFamily': case 'textAlign':
          if (text) { K.mutate(text, { [key]: value }); touched.push(text); if (!text.containerId) K.refreshText(text); }
          break;
        case 'roundness':
          if (el.type === 'rectangle' || el.type === 'diamond') K.mutate(el, { roundness: value === 'round' ? { type: el.type === 'rectangle' ? 3 : 2 } : null });
          break;
        case 'arrowType':
          if (K.isLinear(el)) K.mutate(el, { roundness: value === 'round' ? { type: 2 } : null });
          break;
        case 'startArrowhead': case 'endArrowhead':
          if (el.type === 'arrow') K.mutate(el, { [key]: value });
          break;
        case 'strokeColor': case 'opacity':
          if (el.type === 'image' && key === 'strokeColor') break;
          K.mutate(el, { [key]: value });
          if (text && text !== el) K.mutate(text, { [key]: value });
          break;
        default:
          if (el.type !== 'text' || key === 'strokeColor') K.mutate(el, { [key]: value });
      }
      touched.push(el);
    }
    afterChange(touched.map(el => el.containerId ? byId(el.containerId) || el : el));
    if (editing) positionEditor();
    if (targets.length) commit();
    renderProps(); requestRender();
  }

  function onPropInput(e) {
    const inp = e.target;
    if (!inp.dataset.prop || inp.tagName === 'SELECT') return; // selects are handled on change
    const v = inp.type === 'range' ? +inp.value : inp.value;
    if (inp.type === 'range' || inp.type === 'color') {
      // Live preview while dragging; one undo step when released.
      style[inp.dataset.prop] = v;
      const key = inp.dataset.prop;
      for (const el of propTargets().filter(t => !t._proto)) {
        if (el.type === 'text' && key === 'backgroundColor') continue;
        K.mutate(el, { [key]: v });
        const t = boundTextOf(el);
        if (t && (key === 'strokeColor' || key === 'opacity')) K.mutate(t, { [key]: v });
      }
      inp.onchange = () => { applyProp(inp.dataset.prop, v); };
      requestRender();
      return;
    }
    applyProp(inp.dataset.prop, v);
  }

  function renderProps() {
    if (!propsEl) return;
    const targets = propTargets();
    if (!targets.length) { propsEl.hidden = true; return; }
    const types = new Set(targets.map(t => t.type));
    const has = (...ts) => ts.some(t => types.has(t));
    const texts = targets.map(t => t.type === 'text' ? t : boundTextOf(t)).filter(Boolean);
    const val = (key, list = targets) => { const vs = new Set(list.map(t => key === 'roundness' ? (t.roundness ? 'round' : 'sharp') : key === 'arrowType' ? (t.roundness ? 'round' : 'sharp') : t[key])); return vs.size === 1 ? [...vs][0] : undefined; };
    const swatch = (key, colors) => {
      const cur = val(key);
      return `<div class="dr-swatches">${colors.map(c => `<button class="dr-sw${cur === c ? ' on' : ''}${c === 'transparent' ? ' none' : ''}" data-prop="${key}" data-value="${c}" title="${c}" style="--c:${K.themeColor(c, dark)}"></button>`).join('')}<span class="dr-vsep"></span><input type="color" data-prop="${key}" value="${/^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#000000'}" title="Custom colour"></div>`;
    };
    const opts = (key, list, cur = val(key)) => `<div class="dr-opts">${list.map(([v, label, icon]) => `<button class="dr-opt${cur === v || (cur == null && v == null && cur !== undefined) ? ' on' : ''}" data-prop="${key}" data-value="${v}" title="${esc(label)}">${icon}</button>`).join('')}</div>`;
    const sec = (title, body) => `<div class="dr-sec"><h5>${title}</h5>${body}</div>`;
    const icon = p => `<svg viewBox="0 0 24 24">${p}</svg>`;
    const onlyImages = [...types].every(t => t === 'image');
    let h = '';
    if (!onlyImages) h += sec('Stroke', swatch('strokeColor', K.COLORS.stroke));
    if (has('rectangle', 'diamond', 'ellipse', 'line', 'freedraw') && !editing) h += sec('Background', swatch('backgroundColor', K.COLORS.bg));
    if (has('rectangle', 'diamond', 'ellipse', 'line') && targets.some(t => !K.isTransparent(t.backgroundColor))) {
      h += sec('Fill', opts('fillStyle', [
        ['hachure', 'Hachure', icon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 13l9-9M4 20L20 4M11 20l9-9"/>')],
        ['cross-hatch', 'Cross-hatch', icon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 13l9-9M4 20L20 4M11 20l9-9M11 4l9 9M4 4l16 16M4 11l9 9"/>')],
        ['solid', 'Solid', icon('<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/>')],
      ]));
    }
    if (has('rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw') && !editing) {
      h += sec('Stroke width', opts('strokeWidth', [[1, 'Thin', icon('<path d="M4 12h16" stroke-width="1.2"/>')], [2, 'Bold', icon('<path d="M4 12h16" stroke-width="2.6"/>')], [4, 'Extra bold', icon('<path d="M4 12h16" stroke-width="4.5"/>')]]));
    }
    if (has('rectangle', 'diamond', 'ellipse', 'line', 'arrow') && !editing) {
      h += sec('Stroke style', opts('strokeStyle', [['solid', 'Solid', icon('<path d="M4 12h16"/>')], ['dashed', 'Dashed', icon('<path d="M4 12h4M10 12h4M16 12h4"/>')], ['dotted', 'Dotted', icon('<path d="M4 12h.5M8 12h.5M12 12h.5M16 12h.5M20 12h.5" stroke-width="2.4"/>')]]));
      h += sec('Sloppiness', opts('roughness', [[0, 'Architect', icon('<path d="M4 16c4-8 12-8 16 0"/>')], [1, 'Artist', icon('<path d="M4 16c3-7 5-9 8-8s5 4 8 8M5 15c3-6 6-8 9-6"/>')], [2, 'Cartoonist', icon('<path d="M4 16c2-5 4-9 7-8s3 6 5 5 3-4 4-3M4 13c3-6 6-8 8-5"/>')]]));
    }
    if (has('rectangle', 'diamond') && !editing) h += sec('Edges', opts('roundness', [['sharp', 'Sharp', icon('<path d="M5 19V5h14"/>')], ['round', 'Round', icon('<path d="M5 19V11a6 6 0 0 1 6-6h8"/>')]]));
    if (has('arrow', 'line') && !editing) h += sec(has('arrow') ? 'Arrow type' : 'Line type', opts('arrowType', [['sharp', 'Straight', icon('<path d="M4 18l6-10 10 8"/>')], ['round', 'Curved', icon('<path d="M4 18c3-12 9-12 16-2"/>')]]));
    if (has('arrow') && !editing) {
      const heads = [[null, 'None', 'None'], ['arrow', 'Arrow', 'Arrow'], ['triangle', 'Triangle', 'Triangle'], ['triangle_outline', 'Triangle (outline)', 'Triangle ○'], ['bar', 'Bar', 'Bar'], ['dot', 'Dot', 'Dot'], ['circle_outline', 'Circle (outline)', 'Circle ○'], ['diamond', 'Diamond', 'Diamond'], ['diamond_outline', 'Diamond (outline)', 'Diamond ○']];
      const sel = key => { const cur = val(key); return `<select class="dr-select" data-prop="${key}">${heads.map(([v, l]) => `<option value="${v}"${(cur ?? null) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`; };
      h += sec('Arrowheads', `<div class="dr-row2">${sel('startArrowhead')}${sel('endArrowhead')}</div>`);
    }
    if (texts.length || has('text')) {
      const tl = texts.length ? texts : targets;
      h += sec('Font size', opts('fontSize', [[16, 'Small', 'S'], [20, 'Medium', 'M'], [28, 'Large', 'L'], [36, 'Extra large', 'XL']], val('fontSize', tl)));
      h += sec('Font', opts('fontFamily', [[1, 'Hand-drawn', icon('<path d="M5 18c2-8 4-12 6-12s1 9 3 9 3-5 5-7"/>')], [2, 'Normal', '<b style="font:600 14px system-ui">Aa</b>'], [3, 'Code', '<b style="font:600 12px ui-monospace,monospace">&lt;/&gt;</b>']], val('fontFamily', tl)));
      h += sec('Text align', opts('textAlign', [['left', 'Left', icon('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>')], ['center', 'Centre', icon('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>')], ['right', 'Right', icon('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>')]], val('textAlign', tl)));
    }
    if (!editing) h += sec('Opacity', `<input type="range" class="dr-range" min="0" max="100" step="10" data-prop="opacity" value="${val('opacity') ?? 100}">`);
    const sel = selectedEls();
    if (sel.length && !editing) {
      const b = (act, title, p) => `<button class="dr-opt" data-act="${act}" title="${title}">${icon(p)}</button>`;
      h += sec('Layers', `<div class="dr-opts">${b('back', 'Send to back (Ctrl+Shift+[)', '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>')}${b('backward', 'Send backward (Ctrl+[)', '<path d="M12 5v12M7 12l5 5 5-5"/>')}${b('forward', 'Bring forward (Ctrl+])', '<path d="M12 19V7M7 12l5-5 5 5"/>')}${b('front', 'Bring to front (Ctrl+Shift+])', '<path d="M12 20V8M7 13l5-5 5 5M5 4h14"/>')}</div>`);
      if (sel.length > 1) h += sec('Align', `<div class="dr-opts">${b('al-left', 'Align left', '<path d="M4 4v16M8 7h10v4H8zM8 14h6v4H8z"/>')}${b('al-hcenter', 'Centre horizontally', '<path d="M12 4v16M6 7h12v4H6zM8 14h8v4H8z"/>')}${b('al-right', 'Align right', '<path d="M20 4v16M6 7h10v4H6zM10 14h6v4h-6z"/>')}${b('al-top', 'Align top', '<path d="M4 4h16M7 8v10h4V8zM14 8v6h4V8z"/>')}${b('al-vcenter', 'Centre vertically', '<path d="M4 12h16M7 6v12h4V6zM14 8v8h4V8z"/>')}${b('al-bottom', 'Align bottom', '<path d="M4 20h16M7 6v10h4V6zM14 10v6h4v-6z"/>')}</div>`);
      h += sec('Actions', `<div class="dr-opts">${b('duplicate', 'Duplicate (Ctrl+D)', '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>')}${b('delete', 'Delete (Del)', '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>')}${b('link', 'Link (Ctrl+K)', '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>')}${sel.length > 1 ? b('group', 'Group (Ctrl+G)', '<rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke-dasharray="3 3"/><rect x="7" y="7" width="5" height="5"/><rect x="12" y="12" width="5" height="5"/>') : ''}${sel.some(e => e.groupIds?.length) ? b('ungroup', 'Ungroup (Ctrl+Shift+G)', '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>') : ''}</div>`);
    }
    propsEl.innerHTML = h;
    propsEl.hidden = !h;
    propsEl.onchange = ev => {
      const s = ev.target.closest('select[data-prop]');
      if (s) applyProp(s.dataset.prop, s.value === 'null' ? null : s.value);
    };
  }

  // ============================================================ rendering

  function requestRender() { if (visible && !raf) raf = requestAnimationFrame(render); }

  function render() {
    raf = 0;
    if (!visible) return;
    const r = dpr(), z = view.zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    // A plain white (default) or transparent background follows the app theme's page colour.
    const vbg = (scene.appState.viewBackgroundColor || '#ffffff').toLowerCase();
    ctx.fillStyle = vbg === '#ffffff' || vbg === '#fff' || K.isTransparent(vbg) ? pageBg : K.themeColor(vbg, dark);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const g = gridSize();
    if (g && g * z >= 6) drawGrid(g);
    ctx.setTransform(r * z, 0, 0, r * z, r * z * view.sx, r * z * view.sy);
    const [vx1, vy1] = toWorld(0, 0), [vx2, vy2] = toWorld(cw(), ch());
    const env = { dark, image: imageFor, label: boundTextOf };
    for (const el of els) {
      if (editing && editing.el === el) continue;
      const b = K.bounds(el);
      if (b[2] < vx1 - 50 || b[0] > vx2 + 50 || b[3] < vy1 - 50 || b[1] > vy2 + 50) continue;
      ctx.globalAlpha = eraseSet.has(el.id) ? 0.2 : 1;
      K.drawElement(ctx, el, env);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    drawOverlay();
    if (laser.length || tool === 'laser') drawLaser();
    hintEl.textContent = els.length || editing ? '' : 'Pick a tool above and start drawing — double-click anywhere to write text';
    zoomLabel.textContent = Math.round(z * 100) + '%';
    root.querySelector('[data-act=undo]').disabled = !hist.undo.length;
    root.querySelector('[data-act=redo]').disabled = !hist.redo.length;
  }

  // The laser: a glowing red line whose tail fades, plus a dot at the pointer. Keeps redrawing
  // until the trail has faded.
  function drawLaser() {
    const now = performance.now();
    for (let i = laser.length - 1; i >= 0; i--) {
      const pts = laser[i].pts;
      while (pts.length > 1 && now - pts[0][2] > LASER_FADE) pts.shift();
      if (now - pts[pts.length - 1][2] > LASER_FADE && !(i === laser.length - 1 && action?.type === 'laser')) laser.splice(i, 1);
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const { pts } of laser) {
      for (let j = 1; j < pts.length; j++) {
        const a = 1 - Math.min(1, (now - pts[j][2]) / LASER_FADE);
        if (a <= 0) continue;
        const [x1, y1] = toScreen(pts[j - 1][0], pts[j - 1][1]), [x2, y2] = toScreen(pts[j][0], pts[j][1]);
        ctx.globalAlpha = a * 0.35; ctx.strokeStyle = '#ff2d2d'; ctx.lineWidth = 9;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.globalAlpha = a; ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
    if (tool === 'laser' && laserAt) {
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#ff2d2d';
      ctx.beginPath(); ctx.arc(laserAt[0], laserAt[1], 8, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#ff4040';
      ctx.beginPath(); ctx.arc(laserAt[0], laserAt[1], 3.5, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    if (laser.length) requestRender();
  }

  function drawGrid(g) {
    const r = dpr(), z = view.zoom;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    const [x0, y0] = toWorld(0, 0);
    const step = g * z;
    ctx.lineWidth = 1;
    const faint = K.themeColor('#e5e5e5', dark), strong = K.themeColor('#dddddd', dark);
    const sx = Math.floor(x0 / g), sy = Math.floor(y0 / g);
    for (let i = 0, x = (sx * g + view.sx) * z; x < cw(); i++, x += step) {
      ctx.strokeStyle = (sx + i) % 5 === 0 ? strong : faint;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, ch()); ctx.stroke();
    }
    for (let i = 0, y = (sy * g + view.sy) * z; y < ch(); i++, y += step) {
      ctx.strokeStyle = (sy + i) % 5 === 0 ? strong : faint;
      ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(cw(), Math.round(y) + 0.5); ctx.stroke();
    }
  }

  function rotatedBox(x1, y1, x2, y2, cx, cy, angle, pad) {
    return [[x1 - pad, y1 - pad], [x2 + pad, y1 - pad], [x2 + pad, y2 + pad], [x1 - pad, y2 + pad]].map(([x, y]) => toScreen(...K.rotate(x, y, cx, cy, angle)));
  }
  function strokePoly(pts, dash) {
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawOverlay() {
    ctx.lineWidth = 1;
    ctx.strokeStyle = accent;
    // Shape an arrow end will attach to.
    if (bindHint) {
      const b = K.absBox(bindHint);
      ctx.lineWidth = 3; ctx.globalAlpha = 0.45;
      strokePoly(rotatedBox(b.x1, b.y1, b.x2, b.y2, b.cx, b.cy, bindHint.angle || 0, 4 / view.zoom));
      ctx.lineWidth = 1; ctx.globalAlpha = 1;
    }
    const sel = selectedEls();
    const pad = 4 / view.zoom;
    if (sel.length > 1 || (sel.length === 1 && !(K.isLinear(sel[0]) && sel[0].points.length <= 2))) {
      for (const el of sel) {
        if (K.isLinear(el) && sel.length === 1) continue;
        const b = K.absBox(el);
        strokePoly(rotatedBox(b.x1, b.y1, b.x2, b.y2, b.cx, b.cy, el.angle || 0, pad), sel.length > 1 ? [4, 3] : null);
      }
      // Groups get one dashed box.
      const groups = new Set(sel.map(e => e.groupIds?.[e.groupIds.length - 1]).filter(Boolean));
      for (const gid of groups) {
        const cb = K.commonBounds(els.filter(e => e.groupIds?.includes(gid)));
        if (cb) strokePoly(rotatedBox(cb[0], cb[1], cb[2], cb[3], 0, 0, 0, pad * 2), [6, 4]);
      }
      if (sel.length > 1) {
        const f = selectionFrame();
        strokePoly(rotatedBox(f.x1, f.y1, f.x2, f.y2, 0, 0, 0, 6 / view.zoom));
      }
    }
    for (const h of handles()) {
      ctx.fillStyle = dark ? '#1e1e1e' : '#ffffff';
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (h.type === 'resize') { ctx.roundRect ? ctx.roundRect(h.p[0] - 4, h.p[1] - 4, 8, 8, 2) : ctx.rect(h.p[0] - 4, h.p[1] - 4, 8, 8); }
      else if (h.type === 'mid') { ctx.globalAlpha = 0.6; ctx.arc(h.p[0], h.p[1], 3.5, 0, TAU); }
      else ctx.arc(h.p[0], h.p[1], h.type === 'rotate' ? 4.5 : 5, 0, TAU);
      ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const b of linkBadges()) {
      ctx.fillStyle = dark ? '#2e2e2e' : '#f1f0ff';
      ctx.strokeStyle = accent; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(b.x, b.y, 18, 18, 4) : ctx.rect(b.x, b.y, 18, 18); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b.x + 6, b.y + 12); ctx.lineTo(b.x + 12, b.y + 6); ctx.moveTo(b.x + 8, b.y + 6); ctx.lineTo(b.x + 12, b.y + 6); ctx.lineTo(b.x + 12, b.y + 10); ctx.stroke();
    }
    if (action?.type === 'marquee') {
      const [ax, ay] = toScreen(action.x0, action.y0), [bx, by] = toScreen(action.x1, action.y1);
      ctx.fillStyle = accent; ctx.globalAlpha = 0.08;
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.globalAlpha = 1; ctx.strokeStyle = accent;
      ctx.strokeRect(Math.min(ax, bx) + 0.5, Math.min(ay, by) + 0.5, Math.abs(bx - ax), Math.abs(by - ay));
    }
  }

  // ============================================================ export

  // Data URLs for every image the elements use (vault images are fetched).
  async function fileDataMap(list) {
    const out = {};
    for (const el of list) {
      if (el.type !== 'image' || !el.fileId || out[el.fileId]) continue;
      const f = scene.files?.[el.fileId];
      if (f?.dataURL) { out[el.fileId] = f.dataURL; continue; }
      const url = fileUrls[el.fileId];
      if (!url) continue;
      try { out[el.fileId] = await readDataURL(await (await fetch(url)).blob()); } catch { }
    }
    return out;
  }

  const exportList = onlySelected => {
    const list = onlySelected && selected.size ? withBound(selectedEls()) : els;
    return list.filter(e => !e.isDeleted);
  };

  async function exportSVG({ onlySelected = false, background = true, fontData = null } = {}) {
    const list = exportList(onlySelected);
    const data = await fileDataMap(list);
    return K.toSVG(list, { background: background ? (scene.appState.viewBackgroundColor || '#ffffff') : null, fontData, fileData: id => data[id] });
  }

  function exportPNG({ onlySelected = false, background = true, scale = 2 } = {}) {
    const list = exportList(onlySelected);
    const b = K.commonBounds(list) || [0, 0, 1, 1], pad = 10;
    const w = b[2] - b[0] + pad * 2, h = b[3] - b[1] + pad * 2;
    const s = Math.min(scale, 16000 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * s)); c.height = Math.max(1, Math.ceil(h * s));
    const x = c.getContext('2d');
    if (background && !K.isTransparent(scene.appState.viewBackgroundColor)) { x.fillStyle = scene.appState.viewBackgroundColor || '#ffffff'; x.fillRect(0, 0, c.width, c.height); }
    x.setTransform(s, 0, 0, s, (pad - b[0]) * s, (pad - b[1]) * s);
    for (const el of list) K.drawElement(x, el, { dark: false, image: imageFor, label: boundTextOf });
    return new Promise(res => c.toBlob(res, 'image/png'));
  }

  return {
    init, restyle, resize, load, getScene, exportSVG, exportPNG,
    // Opening a drawing takes the keyboard, so tool keys work straight away.
    show() { visible = true; resize(); renderProps(); requestRender(); if (!hooks.modalOpen?.()) canvas.focus({ preventScroll: true }); },
    hide() { visible = false; commitText(); finishMulti(); action = null; },
    getView: () => ({ ...view }),
    count: () => els.length,
    isEditingText: () => !!editing,
    flush() { commitText(); finishMulti(); },
  };
})();
