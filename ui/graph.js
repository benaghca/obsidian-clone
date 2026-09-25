/* Cinder graph view: canvas + a small force-directed layout. */
'use strict';

window.CinderGraph = (() => {
  let canvas, ctx, opts;
  let nodes = [], edges = [], byId = new Map(), adj = new Map();
  let current = null, visible = false, raf = 0, alpha = 0, dirty = true, fitted = false;
  let view = { x: 0, y: 0, k: 1 };
  let hover = null, drag = null, pan = null, moved = false;
  // A clicked node stays selected: it and its links stay lit (opts.onSelect gets its details).
  let selected = null;
  // 3D: the layout gains depth and a camera orbits it (yaw/pitch around a target, at a distance).
  let mode3d = false, spin = false, orbit = null;
  const cam = { yaw: 0.6, pitch: 0.35, dist: 800, tx: 0, ty: 0, tz: 0 };
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
      if (mode3d) { cam.dist = Math.max(60, Math.min(20000, cam.dist * Math.exp(e.deltaY * 0.0015))); dirty = true; kick(); return; }
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
      if (n) { drag = n; n.fx = n.x; n.fy = n.y; n.fz = n.z; drag.grab = mode3d ? { mx, my, p: toCam(n.x, n.y, n.z, basis()), s: proj(n, basis()).s } : null; alpha = Math.max(alpha, 0.3); }
      else if (mode3d && !(e.shiftKey || e.button === 2)) { orbit = { x: mx, y: my, yaw: cam.yaw, pitch: cam.pitch }; pan = { x: mx, y: my, orbit: true }; }
      else pan = { x: mx, y: my, vx: view.x, vy: view.y, cam: { ...cam } };
      canvas.classList.add('dragging');
      kick();
    });
    window.addEventListener('mousemove', e => {
      if (!visible) return;
      const [mx, my] = mouse(e);
      if (drag && drag.grab) {
        // 3D: the node moves across the screen at its own depth.
        const g = drag.grab, B = basis();
        const w = fromCam(g.p[0] + (mx - g.mx) / g.s, g.p[1] + (my - g.my) / g.s, g.p[2], B);
        drag.fx = w[0]; drag.fy = w[1]; drag.fz = w[2]; moved = true; alpha = Math.max(alpha, 0.3); kick();
      } else if (drag) {
        const [wx, wy] = toWorld(mx, my);
        drag.fx = wx; drag.fy = wy; moved = true; alpha = Math.max(alpha, 0.3); kick();
      } else if (pan && pan.orbit) {
        cam.yaw = orbit.yaw + (mx - orbit.x) * 0.008;
        cam.pitch = Math.max(-1.45, Math.min(1.45, orbit.pitch + (my - orbit.y) * 0.008));
        if (Math.abs(mx - pan.x) + Math.abs(my - pan.y) > 3) moved = true;
        dirty = true; kick();
      } else if (pan && mode3d) {
        // Pan: the target slides along the camera's right and up directions.
        const B = basis(), k = cam.dist / focal(), dx = (mx - pan.x) * k, dy = (my - pan.y) * k;
        const r = fromCam(1, 0, 0, B, true), u = fromCam(0, 1, 0, B, true);
        cam.tx = pan.cam.tx - r[0] * dx - u[0] * dy; cam.ty = pan.cam.ty - r[1] * dx - u[1] * dy; cam.tz = pan.cam.tz - r[2] * dx - u[2] * dy;
        if (Math.abs(mx - pan.x) + Math.abs(my - pan.y) > 3) moved = true;
        dirty = true; kick();
      } else if (pan) {
        view.x = pan.vx + mx - pan.x; view.y = pan.vy + my - pan.y;
        if (Math.abs(mx - pan.x) + Math.abs(my - pan.y) > 3) moved = true;
        dirty = true; kick();
      } else if (e.target === canvas) {
        const h = pick(mx, my);
        if (h !== hover) { hover = h; canvas.style.cursor = h ? 'pointer' : ''; dirty = true; kick(); }
      }
    });
    window.addEventListener('mouseup', e => {
      if (!visible) return;
      canvas.classList.remove('dragging');
      if (drag) {
        const n = drag; drag = null;
        n.fx = n.fy = n.fz = null; n.grab = null;
        // A click selects (again: clears); with "click opens" on, or Ctrl/Cmd-click, it opens.
        if (!moved) { if (opts.clickOpens?.() || e.ctrlKey || e.metaKey) opts.open(n.id, e); else select(selected === n ? null : n); }
      } else if (pan && !moved && selected) select(null); // a click on empty space
      pan = null; orbit = null;
    });
    canvas.addEventListener('contextmenu', e => { if (mode3d) e.preventDefault(); });
    canvas.addEventListener('dblclick', e => {
      const n = pick(...mouse(e));
      if (n) opts.open(n.id, e); else { fit(); kick(); }
    });
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', e => {
      if (e.key === 'Escape' && selected) { e.preventDefault(); select(null); }
      else if (e.key === 'Enter' && selected) { e.preventDefault(); opts.open(selected.id, e); }
    });
  }

  // What a node links to and what links to it, for the selection card.
  function info(n) {
    const out = [], inn = [];
    for (const [a, b] of edges) { if (a === n) out.push(b); else if (b === n) inn.push(a); }
    const brief = m => ({ id: m.id, label: m.label, kind: m.kind });
    const byName = (x, y) => x.label.localeCompare(y.label, undefined, { numeric: true });
    return { ...brief(n), out: out.map(brief).sort(byName), in: inn.map(brief).sort(byName) };
  }
  function select(n, o = {}) {
    selected = n || null;
    if (selected && o.center) {
      if (mode3d) { cam.tx = selected.x; cam.ty = selected.y; cam.tz = selected.z || 0; }
      else { view.x = -selected.x * view.k; view.y = -selected.y * view.k; }
    }
    dirty = true; kick();
    opts.onSelect?.(selected ? info(selected) : null);
  }

  const cw = () => canvas.clientWidth, ch = () => canvas.clientHeight;
  function mouse(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function toWorld(mx, my) { return [(mx - cw() / 2 - view.x) / view.k, (my - ch() / 2 - view.y) / view.k]; }
  function radius(n) { return Math.min(16, 3.5 + Math.sqrt(n.deg) * 1.7); }

  // 3D camera: world point → camera space (yaw about the vertical, then pitch), and back.
  const focal = () => Math.min(cw(), ch()) * 0.9;
  function basis() { return { cy: Math.cos(cam.yaw), sy: Math.sin(cam.yaw), cp: Math.cos(cam.pitch), sp: Math.sin(cam.pitch) }; }
  function toCam(x, y, z, B) {
    x -= cam.tx; y -= cam.ty; z -= cam.tz;
    const x1 = x * B.cy - z * B.sy, z1 = x * B.sy + z * B.cy;
    return [x1, y * B.cp - z1 * B.sp, y * B.sp + z1 * B.cp];
  }
  // (vector: a direction, without the target added back)
  function fromCam(X, Y, Z, B, vector = false) {
    const y = Y * B.cp + Z * B.sp, z1 = -Y * B.sp + Z * B.cp;
    const x = X * B.cy + z1 * B.sy, z = -X * B.sy + z1 * B.cy;
    return vector ? [x, y, z] : [x + cam.tx, y + cam.ty, z + cam.tz];
  }
  function proj(n, B) {
    const [X, Y, Z] = toCam(n.x, n.y, n.z || 0, B), D = cam.dist + Z, s = D > 1 ? focal() / D : 0;
    return { sx: cw() / 2 + X * s, sy: ch() / 2 + Y * s, s, D };
  }
  function pick(mx, my) {
    if (mode3d) {
      // the nearest node under the pointer
      const B = basis();
      let best = null, bd = Infinity;
      for (const n of nodes) {
        const p = proj(n, B);
        if (p.s <= 0) continue;
        if (Math.hypot(p.sx - mx, p.sy - my) < radius(n) * p.s * 1.5 + 4 && p.D < bd) { best = n; bd = p.D; }
      }
      return best;
    }
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
      const node = o ? Object.assign(o, { label: n.label, kind: n.kind, deg: n.deg }) : { ...n, x: NaN, y: NaN, z: 0, vx: 0, vy: 0, vz: 0 };
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
      if (nb) { n.x = nb.x + (Math.random() - .5) * 40; n.y = nb.y + (Math.random() - .5) * 40; n.z = mode3d ? (nb.z || 0) + (Math.random() - .5) * 40 : 0; }
      else { const a = i * 2.4, r = 12 * Math.sqrt(i + 1); n.x = Math.cos(a) * r; n.y = Math.sin(a) * r; n.z = mode3d ? (Math.random() - .5) * r : 0; i++; }
    }
    current = d.current ? byId.get(d.current) : null;
    if (hover && !byId.has(hover.id)) hover = null;
    if (selected) { const again = byId.get(selected.id); selected = null; if (again) select(again); else opts.onSelect?.(null); }
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
          let dx = b.x - a.x, dy = b.y - a.y, dz = mode3d ? b.z - a.z : 0, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
          const m = rep / d2;
          a.vx -= dx * m; a.vy -= dy * m; b.vx += dx * m; b.vy += dy * m;
          if (mode3d) { a.vz -= dz * m; b.vz += dz * m; }
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
            let dx = b.x - a.x, dy = b.y - a.y, dz = mode3d ? b.z - a.z : 0, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
            const m = rep / d2 / 2;
            a.vx -= dx * m; a.vy -= dy * m; b.vx += dx * m; b.vy += dy * m;
            if (mode3d) { a.vz -= dz * m; b.vz += dz * m; }
          }
        }
      }
    }
    const L = 55, K = 0.06 * alpha;
    for (const [a, b] of edges) {
      const dx = b.x - a.x, dy = b.y - a.y, dz = mode3d ? b.z - a.z : 0, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const f = (d - L) / d * K;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      if (mode3d) { a.vz += dz * f; b.vz -= dz * f; }
    }
    const G = 0.012 * alpha;
    for (const a of nodes) {
      const g = adj.get(a).size ? G : G * 2.5;
      a.vx -= a.x * g; a.vy -= a.y * g;
      if (mode3d) a.vz = (a.vz || 0) - (a.z || 0) * g;
      if (a.fx != null) { a.x = a.fx; a.y = a.fy; if (a.fz != null) a.z = a.fz; a.vx = a.vy = a.vz = 0; continue; }
      a.vx *= 0.55; a.vy *= 0.55; a.vz = mode3d ? (a.vz || 0) * 0.55 : 0;
      const sp = Math.hypot(a.vx, a.vy, a.vz);
      if (sp > 40) { a.vx *= 40 / sp; a.vy *= 40 / sp; a.vz *= 40 / sp; }
      a.x += a.vx; a.y += a.vy; a.z = mode3d ? (a.z || 0) + a.vz : 0;
    }
    alpha *= 0.985;
    dirty = true;
  }

  function fit() {
    if (mode3d) return fit3d();
    if (!nodes.length) { view = { x: 0, y: 0, k: 1 }; return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const w = Math.max(80, x1 - x0), h = Math.max(80, y1 - y0);
    const k = Math.min(2.2, Math.min((cw() - 220) / w, (ch() - 120) / h));
    view.k = Math.max(0.05, k || 1);
    view.x = -(x0 + x1) / 2 * view.k; view.y = -(y0 + y1) / 2 * view.k;
    dirty = true;
  }

  // Aim at the middle of the nodes, from far enough back to see them all.
  function fit3d() {
    if (!nodes.length) { Object.assign(cam, { tx: 0, ty: 0, tz: 0, dist: 800 }); dirty = true; return; }
    let cx = 0, cy = 0, cz = 0;
    for (const n of nodes) { cx += n.x; cy += n.y; cz += n.z || 0; }
    cx /= nodes.length; cy /= nodes.length; cz /= nodes.length;
    let R = 60;
    for (const n of nodes) R = Math.max(R, Math.hypot(n.x - cx, n.y - cy, (n.z || 0) - cz));
    Object.assign(cam, { tx: cx, ty: cy, tz: cz, dist: R * 2.1 + 40 });
    dirty = true;
  }

  function draw3d() {
    const r = dpr();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(r, 0, 0, r, 0, 0);
    const B = basis();
    let Dmin = Infinity, Dmax = -Infinity;
    for (const n of nodes) { n._p = proj(n, B); if (n._p.s > 0) { Dmin = Math.min(Dmin, n._p.D); Dmax = Math.max(Dmax, n._p.D); } }
    const span = Math.max(1, Dmax - Dmin);
    const fog = D => 1 - 0.72 * Math.max(0, Math.min(1, (D - Dmin) / span)); // far things fade
    const focus = drag || selected || hover;
    const near = focus ? adj.get(focus) : null;
    const dim = n => focus && n !== focus && !near.has(n);
    // Edges in a few fog bands (one path each), then the focused node's in the accent.
    const bands = [[], [], [], [], []];
    for (const e of edges) {
      const [a, b] = e;
      if (a._p.s <= 0 || b._p.s <= 0 || (focus && (a === focus || b === focus))) continue;
      bands[Math.min(4, Math.floor((1 - fog((a._p.D + b._p.D) / 2)) / 0.72 * 5))].push(e);
    }
    ctx.lineWidth = 1; ctx.strokeStyle = colors.faint;
    bands.forEach((list, i) => {
      if (!list.length) return;
      ctx.globalAlpha = (focus ? 0.12 : 0.5) * (1 - i * 0.15);
      ctx.beginPath();
      for (const [a, b] of list) { ctx.moveTo(a._p.sx, a._p.sy); ctx.lineTo(b._p.sx, b._p.sy); }
      ctx.stroke();
    });
    if (focus) {
      ctx.globalAlpha = 0.95; ctx.strokeStyle = colors.accent; ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (const [a, b] of edges) if ((a === focus || b === focus) && a._p.s > 0 && b._p.s > 0) { ctx.moveTo(a._p.sx, a._p.sy); ctx.lineTo(b._p.sx, b._p.sy); }
      ctx.stroke();
    }
    // Nodes back to front, as small shaded spheres.
    const order = nodes.filter(n => n._p.s > 0).sort((a, b) => b._p.D - a._p.D);
    for (const n of order) {
      const p = n._p, rr = Math.max(1.5, radius(n) * p.s * 1.5);
      const f = fog(p.D);
      ctx.globalAlpha = (dim(n) ? 0.18 : 1) * f;
      ctx.fillStyle = n === current || n === focus ? colors.accent : colors[n.kind] || colors.note;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rr, 0, Math.PI * 2); ctx.fill();
      if (rr > 3) { ctx.globalAlpha *= 0.35; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.sx - rr * 0.35, p.sy - rr * 0.35, rr * 0.35, 0, Math.PI * 2); ctx.fill(); }
      if (n === selected || n === current) { ctx.globalAlpha = f; ctx.strokeStyle = n === selected ? colors.text : colors.accent; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.sx, p.sy, rr + 4, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const n of order) {
      const p = n._p, important = n === focus || (near && near.has(n)) || n === current;
      const a = important ? fog(p.D) : Math.max(0, Math.min(1, (p.s - 0.35) / 0.35)) * fog(p.D) * (dim(n) ? 0.2 : 0.85);
      if (a <= 0.03) continue;
      ctx.globalAlpha = a;
      ctx.font = `${Math.max(10, Math.min(15, 11 * p.s))}px system-ui, sans-serif`;
      ctx.fillStyle = important ? colors.text : colors.muted;
      const label = n.label.length > 40 ? n.label.slice(0, 38) + '…' : n.label;
      ctx.fillText(label, p.sx, p.sy + radius(n) * p.s * 1.5 + 3);
    }
    ctx.globalAlpha = 1;
    if (!nodes.length) {
      ctx.fillStyle = colors.muted; ctx.font = '14px system-ui, sans-serif';
      ctx.fillText('Nothing to show — link some notes with [[double brackets]].', cw() / 2, ch() / 2);
    }
    dirty = false;
  }

  function draw() {
    if (mode3d) return draw3d();
    const W = canvas.width, H = canvas.height, r = dpr();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(r * view.k, 0, 0, r * view.k, r * (cw() / 2 + view.x), r * (ch() / 2 + view.y));
    const focus = drag || selected || hover;
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
      if (n === selected) { ctx.strokeStyle = colors.text; ctx.lineWidth = 1.5 / view.k; ctx.beginPath(); ctx.arc(n.x, n.y, radius(n) + 5 / view.k, 0, Math.PI * 2); ctx.stroke(); }
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
    const spinning = mode3d && spin && !drag && !pan;
    if (spinning) { cam.yaw += 0.0035; dirty = true; }
    if (dirty) draw();
    if (alpha > 0.01 || drag || pan || spinning) kick();
  }
  function kick() { if (visible && !raf) raf = requestAnimationFrame(frame); }

  return {
    init, restyle, resize, refresh,
    select: (id, o) => select(byId.get(id) || null, o),
    selected: () => selected?.id ?? null,
    // Where a node is on the canvas (CSS px from its top-left), e.g. to point at it.
    screenPos: id => {
      const n = byId.get(id);
      if (!n) return null;
      if (mode3d) { const p = proj(n, basis()); return [p.sx, p.sy]; }
      return [cw() / 2 + view.x + n.x * view.k, ch() / 2 + view.y + n.y * view.k];
    },
    // 2D or 3D. Switching spreads the layout into depth (or flattens it) and re-settles it.
    set3d(on) {
      on = !!on;
      if (on === mode3d) return;
      mode3d = on;
      for (const n of nodes) { n.z = on ? (Math.random() - .5) * 300 : 0; n.vz = 0; }
      alpha = 1;
      for (let s = 0; s < (nodes.length > 1500 ? 60 : 180); s++) tick();
      fit(); dirty = true; kick();
    },
    is3d: () => mode3d,
    setSpin(on) { spin = !!on; kick(); },
    show() { visible = true; resize(); },
    hide() { visible = false; hover = null; },
  };
})();
