/* Folio graph view: canvas + a small force-directed layout. */
'use strict';

window.FolioGraph = (() => {
  let canvas, ctx, opts;
  let nodes = [], edges = [], byId = new Map(), adj = new Map();
  let current = null, visible = false, raf = 0, alpha = 0, dirty = true, fitted = false;
  let view = { x: 0, y: 0, k: 1 };
  let hover = null, drag = null, pan = null, moved = false;
  let colors = {};
  const dpr = () => window.devicePixelRatio || 1;

  function restyle() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    colors = {
      bg: v('--bg'), text: v('--text'), muted: v('--muted'), faint: v('--faint'),
      accent: v('--accent'), border: v('--border'),
      note: v('--muted'), tag: v('--c-green') || '#3fb27f', file: v('--c-yellow') || '#d9a53f', drawing: v('--c-blue') || '#4a8fe0', canvas: v('--c-purple') || '#b07bd8', unresolved: v('--faint'),
    };
    dirty = true;
  }

  function init(c, o) {
    canvas = c; opts = o; ctx = c.getContext('2d');
    restyle();
    new ResizeObserver(() => resize()).observe(canvas);

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const [mx, my] = mouse(e);
      const k2 = Math.max(0.05, Math.min(6, view.k * Math.exp(-e.deltaY * 0.0015)));
      // keep the point under the cursor fixed
      const wx = (mx - cw() / 2 - view.x) / view.k, wy = (my - ch() / 2 - view.y) / view.k;
      view.k = k2;
      view.x = mx - cw() / 2 - wx * k2; view.y = my - ch() / 2 - wy * k2;
      dirty = true; kick();
    }, { passive: false });

    canvas.addEventListener('mousedown', e => {
      const [mx, my] = mouse(e);
      moved = false;
      const n = pick(mx, my);
      if (n) { drag = n; n.fx = n.x; n.fy = n.y; alpha = Math.max(alpha, 0.3); }
      else pan = { x: mx, y: my, vx: view.x, vy: view.y };
      canvas.classList.add('dragging');
      kick();
    });
    window.addEventListener('mousemove', e => {
      if (!visible) return;
      const [mx, my] = mouse(e);
      if (drag) {
        const [wx, wy] = toWorld(mx, my);
        drag.fx = wx; drag.fy = wy; moved = true; alpha = Math.max(alpha, 0.3); kick();
      } else if (pan) {
        view.x = pan.vx + mx - pan.x; view.y = pan.vy + my - pan.y;
        if (Math.abs(mx - pan.x) + Math.abs(my - pan.y) > 3) moved = true;
        dirty = true; kick();
      } else if (e.target === canvas) {
        const h = pick(mx, my);
        if (h !== hover) { hover = h; canvas.style.cursor = h ? 'pointer' : ''; dirty = true; kick(); }
      }
    });
    window.addEventListener('mouseup', () => {
      if (!visible) return;
      canvas.classList.remove('dragging');
      if (drag) {
        const n = drag; drag = null;
        n.fx = n.fy = null;
        if (!moved) opts.open(n.id);
      }
      pan = null;
    });
    canvas.addEventListener('dblclick', e => { if (!pick(...mouse(e))) { fit(); kick(); } });
  }

  const cw = () => canvas.clientWidth, ch = () => canvas.clientHeight;
  function mouse(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function toWorld(mx, my) { return [(mx - cw() / 2 - view.x) / view.k, (my - ch() / 2 - view.y) / view.k]; }
  function radius(n) { return Math.min(16, 3.5 + Math.sqrt(n.deg) * 1.7); }
  function pick(mx, my) {
    const [wx, wy] = toWorld(mx, my);
    let best = null, bd = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - wx, n.y - wy);
      const r = radius(n) + 4 / view.k;
      if (d < r && d < bd) { best = n; bd = d; }
    }
    return best;
  }

  function resize() {
    if (!canvas) return;
    const w = Math.max(1, cw() * dpr()), h = Math.max(1, ch() * dpr());
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    dirty = true; kick();
  }

  function refresh(refit = false) {
    if (!visible) return;
    const d = opts.data();
    const old = byId;
    byId = new Map();
    nodes = d.nodes.map(n => {
      const o = old.get(n.id);
      const node = o ? Object.assign(o, { label: n.label, kind: n.kind, deg: n.deg }) : { ...n, x: NaN, y: NaN, vx: 0, vy: 0 };
      byId.set(n.id, node);
      return node;
    });
    edges = d.edges.map(([a, b]) => [byId.get(a), byId.get(b)]);
    adj = new Map(nodes.map(n => [n, new Set()]));
    for (const [a, b] of edges) { adj.get(a).add(b); adj.get(b).add(a); }
    // Place new nodes next to an already-placed neighbour, or on a spiral.
    let i = 0;
    for (const n of nodes) {
      if (!isNaN(n.x)) continue;
      const nb = [...adj.get(n)].find(m => !isNaN(m.x));
      if (nb) { n.x = nb.x + (Math.random() - .5) * 40; n.y = nb.y + (Math.random() - .5) * 40; }
      else { const a = i * 2.4, r = 12 * Math.sqrt(i + 1); n.x = Math.cos(a) * r; n.y = Math.sin(a) * r; i++; }
    }
    current = d.current ? byId.get(d.current) : null;
    if (hover && !byId.has(hover.id)) hover = null;
    const fresh = refit || !fitted || old.size === 0;
    alpha = 1;
    if (fresh) {
      // Settle most of the layout up-front so the first frame looks sane.
      const steps = nodes.length > 2000 ? 60 : nodes.length > 600 ? 150 : 300;
      for (let s = 0; s < steps; s++) tick();
      fit(); fitted = true;
    }
    dirty = true; kick();
  }

  function tick() {
    const n = nodes.length;
    if (!n) return;
    const rep = 900 * alpha;
    if (n <= 700) {
      for (let i = 0; i < n; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < n; j++) {
          const b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
          const m = rep / d2;
          a.vx -= dx * m; a.vy -= dy * m; b.vx += dx * m; b.vy += dy * m;
        }
      }
    } else {
      // Grid-bucketed repulsion with a cutoff for big vaults.
      const C = 160, grid = new Map();
      for (const a of nodes) {
        const key = Math.floor(a.x / C) + ',' + Math.floor(a.y / C);
        (grid.get(key) || grid.set(key, []).get(key)).push(a);
      }
      for (const a of nodes) {
        const gx = Math.floor(a.x / C), gy = Math.floor(a.y / C);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const cell = grid.get((gx + ox) + ',' + (gy + oy));
          if (!cell) continue;
          for (const b of cell) {
            if (b === a) continue;
            let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
            const m = rep / d2 / 2;
            a.vx -= dx * m; a.vy -= dy * m; b.vx += dx * m; b.vy += dy * m;
          }
        }
      }
    }
    const L = 55, K = 0.06 * alpha;
    for (const [a, b] of edges) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - L) / d * K;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    const G = 0.012 * alpha;
    for (const a of nodes) {
      const g = adj.get(a).size ? G : G * 2.5;
      a.vx -= a.x * g; a.vy -= a.y * g;
      if (a.fx != null) { a.x = a.fx; a.y = a.fy; a.vx = a.vy = 0; continue; }
      a.vx *= 0.55; a.vy *= 0.55;
      const sp = Math.hypot(a.vx, a.vy);
      if (sp > 40) { a.vx *= 40 / sp; a.vy *= 40 / sp; }
      a.x += a.vx; a.y += a.vy;
    }
    alpha *= 0.985;
    dirty = true;
  }

  function fit() {
    if (!nodes.length) { view = { x: 0, y: 0, k: 1 }; return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const w = Math.max(80, x1 - x0), h = Math.max(80, y1 - y0);
    const k = Math.min(2.2, Math.min((cw() - 220) / w, (ch() - 120) / h));
    view.k = Math.max(0.05, k || 1);
    view.x = -(x0 + x1) / 2 * view.k; view.y = -(y0 + y1) / 2 * view.k;
    dirty = true;
  }

  function draw() {
    const W = canvas.width, H = canvas.height, r = dpr();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(r * view.k, 0, 0, r * view.k, r * (cw() / 2 + view.x), r * (ch() / 2 + view.y));
    const focus = hover || drag;
    const near = focus ? adj.get(focus) : null;
    const dim = n => focus && n !== focus && !near.has(n);

    ctx.lineWidth = 1 / view.k;
    ctx.strokeStyle = colors.faint; ctx.globalAlpha = focus ? 0.15 : 0.45;
    ctx.beginPath();
    for (const [a, b] of edges) { if (focus && (a === focus || b === focus)) continue; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke();
    if (focus) {
      ctx.globalAlpha = 0.9; ctx.strokeStyle = colors.accent; ctx.lineWidth = 1.6 / view.k;
      ctx.beginPath();
      for (const [a, b] of edges) if (a === focus || b === focus) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    }

    for (const n of nodes) {
      ctx.globalAlpha = dim(n) ? 0.2 : 1;
      ctx.fillStyle = n === current ? colors.accent : n === focus ? colors.accent : colors[n.kind] || colors.note;
      ctx.beginPath(); ctx.arc(n.x, n.y, radius(n), 0, Math.PI * 2); ctx.fill();
      if (n === current) { ctx.strokeStyle = colors.accent; ctx.lineWidth = 2 / view.k; ctx.beginPath(); ctx.arc(n.x, n.y, radius(n) + 3 / view.k, 0, Math.PI * 2); ctx.stroke(); }
    }

    const labelAlpha = Math.max(0, Math.min(1, (view.k - 0.45) / 0.35));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = `${12 / Math.max(view.k, 0.8)}px system-ui, sans-serif`;
    for (const n of nodes) {
      const important = n === focus || (near && near.has(n)) || n === current;
      let a = important ? 1 : labelAlpha * (dim(n) ? 0.2 : 0.85);
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = important ? colors.text : colors.muted;
      const label = n.label.length > 40 ? n.label.slice(0, 38) + '…' : n.label;
      ctx.fillText(label, n.x, n.y + radius(n) + 3 / view.k);
    }
    ctx.globalAlpha = 1;
    if (!nodes.length) {
      ctx.setTransform(r, 0, 0, r, 0, 0);
      ctx.fillStyle = colors.muted; ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Nothing to show — link some notes with [[double brackets]].', cw() / 2, ch() / 2);
    }
    dirty = false;
  }

  function frame() {
    raf = 0;
    if (!visible) return;
    if (alpha > 0.01) tick();
    if (dirty) draw();
    if (alpha > 0.01 || drag || pan) kick();
  }
  function kick() { if (visible && !raf) raf = requestAnimationFrame(frame); }

  return {
    init, restyle, resize, refresh,
    show() { visible = true; resize(); },
    hide() { visible = false; hover = null; },
  };
})();
