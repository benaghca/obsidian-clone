/* Cinder graph view: canvas + a small force-directed layout. */
'use strict';

window.CinderGraph = (() => {
  let canvas, ctx, opts;
  let nodes = [], edges = [], byId = new Map(), adj = new Map();
  let current = null, visible = false, raf = 0, dirty = true, fitted = false;
  let view = { x: 0, y: 0, k: 1 };
  // The layout: d3-force (its 3D build), stepped from our own animation frames. Links are soft and
  // a grab warms the layout only a little, so linked notes trail a dragged one and a dropped note
  // stays near where it lands. A new layout cools slowly enough to come fully to rest; one that
  // stopped short would lurch the rest of the way the moment anything is grabbed.
  const LINK = 90, REPEL = 400, GRAVITY = 0.02, LINK_SOFTNESS = 0.2, DRAG_HEAT = 0.1;
  const SETTLE_TICKS = 1200, SETTLE_MS = 300, COOL_MS = 15000;
  const pull = n => adj.get(n)?.size ? GRAVITY : GRAVITY * 2.5; // unlinked notes stay closer in
  const linkForce = d3Force.forceLink([]).distance(LINK);
  const linkStrength = linkForce.strength(); // d3's own: weaker for links to well-linked notes
  linkForce.strength((l, i, ls) => linkStrength(l, i, ls) * LINK_SOFTNESS);
  const sim = d3Force.forceSimulation([], 2).stop().velocityDecay(0.3)
    .force('link', linkForce)
    .force('charge', d3Force.forceManyBody().strength(-REPEL).distanceMax(1200))
    .force('x', d3Force.forceX(0).strength(pull))
    .force('y', d3Force.forceY(0).strength(pull));
  const DECAY = sim.alphaDecay();
  // Rings by depth (local graph): the open note is pinned in the middle and every other node is
  // pulled to its ring's radius, a circle in 2D and a sphere's shell in 3D. The link and (softened)
  // charge forces still choose where on the ring, so linked notes end up side by side.
  // Each ring starts RING beyond the last. One with more notes than fit SPACING apart grows lanes
  // (up to MAX_LANES, LANE apart) and then a larger radius, so a busy note's ring stays a ring.
  const RING = 150, RING_PULL = 0.9, RING_REPEL = 0.3, SPACING = 30, LANE = 28, MAX_LANES = 4;
  let rings = false, pinned = null, ringRadii = [];
  function layoutRings() {
    ringRadii = [];
    if (!rings) return;
    const byRing = [];
    for (const n of nodes) if (n.ring > 0) (byRing[n.ring] ||= []).push(n);
    const fits = r => mode3d ? 4 * Math.PI * r * r / (SPACING * SPACING) : 2 * Math.PI * r / SPACING;
    let edge = 0;
    for (let d = 1; d < byRing.length; d++) {
      const list = (byRing[d] || []).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      let r = edge + RING;
      const lanes = Math.min(MAX_LANES, Math.max(1, Math.ceil(list.length / fits(r))));
      while (list.length > lanes * fits(r)) r += SPACING;
      list.forEach((n, i) => { n.ringR = r + (i % lanes) * LANE; });
      ringRadii.push([r, r + (lanes - 1) * LANE]);
      edge = r + (lanes - 1) * LANE;
    }
  }
  function ringForce(alpha) {
    if (!rings || !current) return;
    const cx = current.x, cy = current.y, cz = current.z || 0;
    for (const n of nodes) {
      if (n === current || !(n.ring > 0)) continue;
      let dx = n.x - cx, dy = n.y - cy, dz = mode3d ? (n.z || 0) - cz : 0, d = Math.hypot(dx, dy, dz);
      if (d < 1e-6) { dx = Math.random() - .5; dy = Math.random() - .5; d = Math.hypot(dx, dy); }
      const k = ((n.ringR || n.ring * RING) - d) / d * RING_PULL * alpha;
      n.vx += dx * k; n.vy += dy * k; if (mode3d) n.vz += dz * k;
    }
  }
  sim.force('rings', ringForce);
  // After each step, a note more than RING_SLACK off its lane is put back on its edge: forces
  // alone lose to a busy note's links, which drag the inner ring out towards the outer one. A note
  // being dragged is left alone until it's let go.
  const RING_SLACK = 8;
  function clampRings() {
    if (!rings || !current) return;
    const cx = current.x, cy = current.y, cz = current.z || 0;
    for (const n of nodes) {
      if (n === current || n === drag || !(n.ringR > 0)) continue;
      const dx = n.x - cx, dy = n.y - cy, dz = mode3d ? (n.z || 0) - cz : 0, d = Math.hypot(dx, dy, dz);
      const to = d < n.ringR - RING_SLACK ? n.ringR - RING_SLACK : d > n.ringR + RING_SLACK ? n.ringR + RING_SLACK : 0;
      if (!to || d < 1e-6) continue;
      const k = to / d;
      n.x = cx + dx * k; n.y = cy + dy * k; if (mode3d) n.z = cz + dz * k;
    }
  }
  // Pins the open note at the origin while rings are on (and lets go of one pinned before).
  function pin() {
    const want = rings ? current : null;
    if (pinned && pinned !== want && pinned !== drag) pinned.fx = pinned.fy = pinned.fz = null;
    pinned = want;
    if (want && want !== drag) { want.x = want.y = want.z = 0; want.vx = want.vy = want.vz = 0; want.fx = want.fy = want.fz = 0; }
  }
  // How long a tick takes here, as they run (a big vault's are slow: ~60ms for 15,000 notes).
  let tickMs = 0;
  const tick = () => { const t = performance.now(); sim.tick(); clampRings(); const d = performance.now() - t; tickMs = tickMs ? tickMs * 0.9 + d * 0.1 : d; };
  // How fast a warmed-up layout cools: over SETTLE_TICKS, but within COOL_MS when ticks are slow
  // (never in fewer than d3's own 300), so a big graph doesn't keep the processor busy for minutes.
  const settleDecay = () => 1 - Math.pow(0.001, 1 / (tickMs ? Math.max(300, Math.min(SETTLE_TICKS, COOL_MS / tickMs)) : SETTLE_TICKS));
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
      if (n) { drag = n; n.fx = n.x; n.fy = n.y; n.fz = n.z; drag.grab = mode3d ? { mx, my, p: toCam(n.x, n.y, n.z, basis()), s: proj(n, basis()).s } : null; sim.alphaTarget(DRAG_HEAT); }
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
        drag.fx = w[0]; drag.fy = w[1]; drag.fz = w[2]; moved = true; kick();
      } else if (drag) {
        const [wx, wy] = toWorld(mx, my);
        drag.fx = wx; drag.fy = wy; moved = true; kick();
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
        n.fx = n.fy = n.fz = null; n.grab = null; sim.alphaTarget(0);
        if (n === pinned) { pinned = null; pin(); } // a dragged middle goes back to the middle
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
      const node = o ? Object.assign(o, { label: n.label, kind: n.kind, deg: n.deg, ring: n.ring }) : { ...n, x: NaN, y: NaN, z: 0, vx: 0, vy: 0, vz: 0 };
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
    pin(); layoutRings();
    if (hover && !byId.has(hover.id)) hover = null;
    if (selected) { const again = byId.get(selected.id); selected = null; if (again) select(again); else opts.onSelect?.(null); }
    sim.nodes(nodes);
    linkForce.links(edges.map(([source, target]) => ({ source, target })));
    const fresh = refit || !fitted || old.size === 0;
    sim.alphaDecay(settleDecay()).alpha(fresh ? 1 : Math.max(sim.alpha(), 0.3));
    if (fresh) { settle(); fit(); fitted = true; }
    dirty = true; kick();
  }

  // As much of the slow cool-down as fits in SETTLE_MS, so the first frame looks sane; the rest
  // plays out on screen.
  function settle() {
    const t0 = performance.now();
    for (let s = 0; s < SETTLE_TICKS && performance.now() - t0 < SETTLE_MS; s++) tick();
    sim.alphaDecay(settleDecay()); // now that it's known how long ticks take
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
    if (rings && current && current._p.s > 0) {
      // The rings' outlines: each shell's silhouette, near enough a circle around the middle.
      ctx.strokeStyle = colors.faint; ctx.lineWidth = 1; ctx.globalAlpha = 0.4; ctx.setLineDash([4, 6]);
      for (const b of ringRadii) for (const r of new Set(b)) { ctx.beginPath(); ctx.arc(current._p.sx, current._p.sy, r * current._p.s, 0, Math.PI * 2); ctx.stroke(); }
      ctx.setLineDash([]);
    }
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

    if (rings && current) {
      ctx.strokeStyle = colors.faint; ctx.lineWidth = 1 / view.k; ctx.globalAlpha = 0.4; ctx.setLineDash([4 / view.k, 6 / view.k]);
      for (const b of ringRadii) for (const r of new Set(b)) { ctx.beginPath(); ctx.arc(current.x, current.y, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.setLineDash([]);
    }
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

  const hot = () => sim.alpha() >= sim.alphaMin() || sim.alphaTarget() > 0;
  function frame() {
    raf = 0;
    if (!visible) return;
    if (hot()) { tick(); dirty = true; }
    else sim.alphaDecay(DECAY); // settled: later warm-ups (a drag) cool at the usual pace
    const spinning = mode3d && spin && !drag && !pan;
    if (spinning) { cam.yaw += 0.0035; dirty = true; }
    if (dirty) draw();
    if (hot() || drag || pan || spinning) kick();
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
      sim.numDimensions(on ? 3 : 2).force('z', on ? d3Force.forceZ(0).strength(pull) : null);
      layoutRings(); // a shell holds more than a circle
      sim.alphaDecay(settleDecay()).alpha(1);
      settle(); fit(); dirty = true; kick();
    },
    is3d: () => mode3d,
    // Rings by depth on or off. Re-settles the layout, like switching to 3D, unless the caller is
    // about to refresh it anyway (quiet).
    setRings(on, quiet = false) {
      on = !!on;
      if (on === rings) return;
      rings = on; pin(); layoutRings();
      sim.force('charge').strength(on ? -REPEL * RING_REPEL : -REPEL);
      if (!visible || quiet) return;
      sim.alphaDecay(settleDecay()).alpha(1);
      settle(); fit(); dirty = true; kick();
    },
    rings: () => rings,
    // Each ring's inner and outer radius (they differ when a busy ring has lanes).
    ringBands: () => ringRadii.map(b => [...b]),
    // Where a node is in the layout itself (for tests), or null when it isn't shown.
    worldPos: id => { const n = byId.get(id); return n ? [n.x, n.y, n.z || 0] : null; },
    setSpin(on) { spin = !!on; kick(); },
    show() { visible = true; resize(); },
    hide() { visible = false; hover = null; },
  };
})();
