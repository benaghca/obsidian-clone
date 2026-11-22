// R2 CZ: the canvas zoom glides toward the cursor, and the board is crisp at rest.
// Native CDP wheel input in the scratch mock vault; per-frame transforms are
// recorded in the page, and the compositor's layer tree is read through CDP.
import { withBrowser, sleep } from './browser.mjs';

const text = 'Sharp words WWW mmm\nA second line of text\n- a list item';
const board = {
  nodes: [
    { id: 'a', type: 'text', x: 0, y: 0, width: 320, height: 200, text },
    { id: 'b', type: 'text', x: 1300, y: 600, width: 320, height: 200, text: '## Far card' },
  ],
  edges: [{ id: 'e', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left', label: 'Edge label' }],
};

await withBrowser(async ({ send, on, run, click, move, point, check, open, press }) => {
  await open('Glide.canvas', board, 600);
  const button = label => `.canvas-controls [aria-label="${label}"]`;
  const view = () => run(() => { const r = document.querySelector('.canvas-view').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const state = () => run(() => { const m = new DOMMatrix(document.querySelector('.canvas-world').style.transform); return { s: m.a, x: m.e, y: m.f }; });
  // Wait until the world has not moved for three frames.
  // Gives up after 3s so a board that never rests fails a check instead of hanging.
  const glided = () => run(() => new Promise(resolve => { let last = '', same = 0; const until = performance.now() + 3000; const frame = () => { if (performance.now() > until) { resolve(); return; } const t = document.querySelector('.canvas-world').style.transform; same = t === last ? same + 1 : 0; last = t; if (same >= 3) resolve(); else requestAnimationFrame(frame); }; requestAnimationFrame(frame); }));
  const atRest = async () => { await glided(); for (let i = 0; i < 40 && await run(() => document.querySelector('.canvas-world').classList.contains('is-moving')); i++) await sleep(25); };
  // Record the world transform on every animation frame, from before the input until it lands.
  const record = () => run(() => {
    window.zoomFrames = [];
    const tick = now => { const m = new DOMMatrix(document.querySelector('.canvas-world').style.transform); zoomFrames.push({ t: now, s: m.a, x: m.e, y: m.f }); window.zoomFrame = requestAnimationFrame(tick); };
    window.zoomFrame = requestAnimationFrame(tick);
  });
  const frames = async () => { await glided(); return run(() => { cancelAnimationFrame(zoomFrame); return zoomFrames; }); };
  const wheel = (p, deltaY, modifiers = 2) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...p, deltaX: 0, deltaY, modifiers });
  // Distinct transforms only: rAF also records frames in which nothing changed.
  const changes = list => list.filter((f, i) => i === 0 || f.s !== list[i - 1].s || f.x !== list[i - 1].x || f.y !== list[i - 1].y);
  const octaves = (a, b) => Math.abs(Math.log2(b / a));

  const v = await view();
  // Whole pixels: a mouse event's clientX/Y are integers.
  const p = { x: Math.round(v.left + v.width * .7), y: Math.round(v.top + v.height * .35) };
  const boardPoint = (f, at) => [(at.x - v.left - f.x) / f.s, (at.y - v.top - f.y) / f.s];

  // One wheel notch glides: several frames, eased at both ends, around the pointer.
  await click(button('Reset zoom')); await move(p); await atRest();
  await record(); await sleep(40); await wheel(p, -100);
  const notch = changes(await frames());
  const start = notch[0], end = notch.at(-1), moves = notch.slice(1);
  const total = octaves(start.s, end.s);
  check(Math.abs(end.s - 2 ** (1 / 3)) < 1e-5, 'A wheel notch still lands on the observed rate (2^(1/3) per 100px) (' + end.s + ')');
  check(moves.length >= 6, 'A wheel notch animates over several frames instead of one jump (' + moves.length + ' frames)');
  // Transforms are read back at float precision, so allow for that in the order.
  check(moves.every((f, i) => f.s >= (i ? moves[i - 1].s : start.s) - 1e-6 && f.s <= end.s + 1e-6), 'The glide moves toward the target on every frame and never overshoots (' + moves.map(f => f.s.toFixed(5)).join(' ') + ')');
  check(octaves(start.s, moves[0].s) < total * .35 && octaves(moves.at(-2).s, end.s) < total * .1, 'The glide eases in and out: no lurch on the first or last frame');
  check(end.t - moves[0].t < 320, 'The glide lands within about 200ms (' + Math.round(end.t - moves[0].t) + 'ms)');
  const anchor = boardPoint(start, p), drift = list => Math.max(...list.map(f => { const [bx, by] = boardPoint(f, p); return Math.hypot(bx - anchor[0], by - anchor[1]); }));
  check(drift(notch) < .01, 'The board point under the cursor stays under it on every frame of the glide (' + drift(notch).toFixed(4) + ' board px)');

  // Rapid ticks merge into one continuous glide: no stop between ticks, one landing.
  await click(button('Reset zoom')); await click(button('Zoom out')); await click(button('Zoom out')); await move(p); await atRest();
  const base = (await state()).s;
  await record(); await sleep(40);
  for (let i = 0; i < 5; i++) { await wheel(p, -60); await sleep(30); }
  const burst = changes(await frames());
  const steps = burst.slice(1).map((f, i) => octaves(burst[i].s, f.s));
  const gaps = (await run(() => zoomFrames)).length;
  check(Math.abs(burst.at(-1).s - base * 2) < 1e-5, 'Five quick ticks land where the ticks add up to (' + burst.at(-1).s + ')');
  check(Math.max(...steps) < .2 * .75, 'No frame jumps by a whole tick (' + Math.max(...steps).toFixed(3) + ' octaves at most)');
  const span = burst.at(-1).t - burst[1].t, idle = await run((from, to) => zoomFrames.filter((f, i) => i && f.t > from && f.t < to && f.s === zoomFrames[i - 1].s).length, burst[1].t, burst.at(-1).t);
  check(idle === 0 && span > 0 && gaps > 0, 'The board never stops between ticks: one continuous glide (' + idle + ' still frames)');
  const burstAnchor = boardPoint(burst[0], p);
  check(burst.every(f => { const [bx, by] = boardPoint(f, p); return Math.abs(bx - burstAnchor[0]) < .01 && Math.abs(by - burstAnchor[1]) < .01; }), 'Merged ticks keep the point under the cursor fixed');

  // A trackpad pinch: many small Ctrl+wheel steps glide smoothly the same way.
  await click(button('Reset zoom')); await move(p); await atRest();
  const pinchBase = (await state()).s;
  await record(); await sleep(40);
  for (let i = 0; i < 40; i++) { await wheel(p, -6); await sleep(8); }
  const pinch = changes(await frames());
  check(Math.abs(pinch.at(-1).s - pinchBase * 2 ** (40 * 6 / 300)) < 1e-5, 'A pinch lands on the sum of its steps');
  check(pinch.slice(1).every((f, i) => f.s >= pinch[i].s - 1e-6), 'A pinch zooms smoothly in one direction');
  const pinchAnchor = boardPoint(pinch[0], p);
  check(pinch.every(f => { const [bx, by] = boardPoint(f, p); return Math.abs(bx - pinchAnchor[0]) < .01 && Math.abs(by - pinchAnchor[1]) < .01; }), 'A pinch keeps the point under the fingers fixed');

  // Limits: a huge wheel glides to exactly 2x or 1/16x and no frame passes them.
  for (const [deltaY, limit, name] of [[-50000, 2, 'maximum 2x'], [50000, 1 / 16, 'minimum 1/16x']]) {
    await record(); await sleep(40); await wheel(p, deltaY);
    const list = changes(await frames());
    check(list.at(-1).s === limit && list.every(f => f.s <= 2 && f.s >= 1 / 16), 'A huge wheel glides to the ' + name + ' and never passes it');
  }

  // Pressing on the board mid-glide stops it where it was painted: no jump to the
  // target, so the press lands on what the browser hit-tested and a drag starts there.
  // The page records the world and the pressed card before and after the board's own
  // pointerdown handlers run.
  const watchPress = () => run(() => {
    const look = e => {
      const m = new DOMMatrix(document.querySelector('.canvas-world').style.transform), card = e.target.closest?.('.canvas-node');
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.canvas-node');
      return { s: m.a, x: m.e, y: m.f, card: card?.dataset.nodeId ?? null, under: under?.dataset.nodeId ?? null, rect: card ? JSON.stringify(card.getBoundingClientRect()) : null };
    };
    window.pressLook = {};
    addEventListener('pointerdown', e => { pressLook.before = look(e); }, { capture: true, once: true });
    addEventListener('pointerdown', e => { pressLook.after = look(e); }, { once: true });
    // The middle press pans, so the bubbling listener may not see it; read after a frame too.
    addEventListener('pointerdown', e => requestAnimationFrame(() => { pressLook.frame = look(e); }), { capture: true, once: true });
  });
  const pressDuring = async (at, button) => {
    await move(p); await atRest();
    await wheel(p, -100); await move(at); await sleep(20);
    await watchPress();
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button, buttons: button === 'middle' ? 4 : 1, clickCount: 1 });
    await sleep(40);
    const held = []; for (let i = 0; i < 5; i++) { held.push((await state()).s); await sleep(30); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button, clickCount: 1 });
    return { look: await run(() => pressLook), held, after: (await state()).s };
  };
  const target = 2 ** (1 / 3), between = s => s > 1 + 1e-3 && s < target - 1e-3;
  // A middle press (a pan) away from the wheel's point.
  await click(button('Reset zoom'));
  const mid = await pressDuring({ x: p.x - 200, y: p.y + 120 }, 'middle');
  check(between(mid.look.before.s) && Math.abs(mid.look.frame.s - mid.look.before.s) < 1e-6, 'A middle press mid-glide keeps the painted zoom instead of jumping to the target (' + mid.look.before.s.toFixed(4) + ' -> ' + mid.look.frame.s.toFixed(4) + ')');
  check(mid.held.every(s => Math.abs(s - mid.look.before.s) < 1e-6) && Math.abs(mid.after - mid.look.before.s) < 1e-6, 'The zoom stays put while the press is held and after it (' + mid.held.map(s => s.toFixed(4)).join(' ') + ')');
  // A left press on a card near its corner, away from the wheel's point: the card the
  // browser hit-tested is still under the pointer, at the same place, after the press.
  // The limit checks left the board far off, so centre card a at 100% first.
  await run(() => import('/src/canvas/navigation.ts').then(({ canvasViewports }) => {
    Object.assign(canvasViewports.get(ws.active), { cx: 160, cy: 100, scale: 1 });
    document.querySelector('.canvas-view').dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, cancelable: true }));
  }));
  await atRest();
  const edgeOfA = await run(() => { const r = document.querySelector('[data-node-id="a"]').getBoundingClientRect(), v = document.querySelector('.canvas-view').getBoundingClientRect(); return { x: Math.round(Math.max(r.left, v.left) + 30), y: Math.round(Math.max(r.top, v.top) + 30) }; });
  const left = await pressDuring(edgeOfA, 'left');
  check(left.look.before.card === 'a' && between(left.look.before.s), 'A left press mid-glide hits the card under the pointer (' + JSON.stringify([left.look.before.card, left.look.before.s.toFixed(4)]) + ')');
  check(left.look.after.s === left.look.before.s && left.look.after.rect === left.look.before.rect && left.look.after.under === 'a', 'The press does not move the board: the pressed card is still under the pointer, where it was hit');
  check(left.held.every(s => Math.abs(s - left.look.before.s) < 1e-6), 'The zoom stays put while the card is held (' + left.held.map(s => s.toFixed(4)).join(' ') + ')');
  await press('Escape'); await atRest();

  // Crisp: while the board moves it is one scaled layer; at rest nothing on it is.
  let layers = [];
  on('LayerTree.layerTreeDidChange', e => { if (e.layers) layers = e.layers; });
  await send('LayerTree.enable');
  const scaledLayers = () => layers.filter(l => l.drawsContent && l.transform && Math.abs(l.transform[0] - 1) > 1e-6);
  const willChange = () => run(() => {
    const world = document.querySelector('.canvas-world');
    return { world: getComputedStyle(world).willChange, inside: [...world.querySelectorAll('*')].filter(e => getComputedStyle(e).willChange !== 'auto').length, label: document.querySelector('.canvas-edge-label') ? getComputedStyle(document.querySelector('.canvas-edge-label')).willChange : 'missing' };
  });
  await click('.canvas-controls .lucide-maximize'); await click(button('Reset zoom')); await move(p); await atRest();
  // Edge labels come back in slices after title mode; wait for this one.
  for (let i = 0; i < 80 && !await run(() => !!document.querySelector('.canvas-edge-label')); i++) await sleep(25);
  for (let i = 0; i < 4; i++) { await wheel(p, -100); await sleep(16); }
  await sleep(40);
  const during = { style: await willChange(), layers: scaledLayers().map(l => l.transform[0]), scale: (await state()).s };
  check(during.style.world === 'transform' && during.style.label === 'transform', 'Mid-zoom the board and its edge labels are composited layers (' + JSON.stringify(during.style) + ')');
  check(during.layers.length >= 1, 'Mid-zoom the compositor scales one board layer (' + JSON.stringify(during.layers) + ')');
  await atRest(); await sleep(250);
  const rest = { style: await willChange(), layers: scaledLayers().map(l => l.transform[0]), scale: (await state()).s };
  check(rest.scale === 2, 'The board is at 2x');
  check(rest.style.world === 'auto' && rest.style.inside === 0 && rest.style.label === 'auto', 'At rest no board element asks to be a layer (' + JSON.stringify(rest.style) + ')');
  check(rest.layers.length === 0, 'At rest no layer is drawn scaled: the board is painted at the zoom it is shown at (' + JSON.stringify(rest.layers) + ')');

  // Text at 2x is as sharp as text at 1x: compare the steepest pixel edges in the card.
  const sharpness = async () => {
    const r = await run(() => { const c = document.querySelector('[data-node-id="a"] .canvas-node-content').getBoundingClientRect(), v = document.querySelector('.canvas-view').getBoundingClientRect(); const x = Math.max(c.x, v.x), y = Math.max(c.y, v.y); return { x, y, width: Math.min(c.right, v.right - 60) - x, height: Math.min(c.bottom, v.bottom, y + 220) - y }; });
    if (!(r.width > 20 && r.height > 20)) throw Error('card text is not on screen: ' + JSON.stringify(r));
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
    return run(async b64 => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), g = canvas.getContext('2d'); g.drawImage(bitmap, 0, 0);
      const { data, width, height } = g.getImageData(0, 0, bitmap.width, bitmap.height);
      const luma = i => .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
      const edges = [];
      for (let y = 0; y < height; y++) for (let x = 0; x + 1 < width; x++) { const d = Math.abs(luma((y * width + x) * 4) - luma((y * width + x + 1) * 4)); if (d > 8) edges.push(d); }
      edges.sort((a, b) => a - b);
      return edges.length ? edges[Math.floor(edges.length * .9)] : 0;
    }, data);
  };
  // Centre the text card at 100%: set the live viewport, then a zero Ctrl+wheel redraws it.
  const centre = scale => run(async scale => {
    const { canvasViewports } = await import('/src/canvas/navigation.ts');
    Object.assign(canvasViewports.get(ws.active), { cx: 160, cy: 100, scale });
    document.querySelector('.canvas-view').dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, cancelable: true }));
  }, scale);
  await centre(1); await atRest();
  for (let i = 0; i < 80 && !await run(() => !!document.querySelector('[data-node-id="a"] .canvas-node-content p, [data-node-id="a"] .canvas-node-content .cm-line')); i++) await sleep(25);
  const words = await run(() => { const r = document.querySelector('[data-node-id="a"] .canvas-node-content').getBoundingClientRect(); return { x: Math.round(r.x + 40), y: Math.round(r.y + 20) }; });
  for (let i = 0; i < 4; i++) { await wheel(words, -100); await sleep(16); }
  await atRest(); await sleep(250);
  const zoomed = await sharpness();
  await centre(1); await atRest(); await sleep(250);
  const plain = await sharpness();
  check(plain > 0 && zoomed >= plain * .85, 'Text at 2x after settling is as sharp as at 100% (' + zoomed.toFixed(0) + ' vs ' + plain.toFixed(0) + ')');

  // A pan at 2x, a selected card and a finished card drag also leave no layer behind.
  for (let i = 0; i < 4; i++) { await wheel(p, -100); await sleep(16); }
  await atRest();
  for (let i = 0; i < 6; i++) { await wheel(p, 40, 0); await sleep(16); }
  check((await willChange()).world === 'transform', 'A wheel pan moves the board as one layer');
  await atRest(); await sleep(200);
  check((await willChange()).world === 'auto' && scaledLayers().length === 0, 'After a pan settles no layer is drawn scaled');
  await click(button('Reset zoom')); await atRest();
  const card = await point('[data-node-id="a"]');
  await click(card);
  check(await run(() => document.querySelector('[data-node-id="a"]').classList.contains('is-selected')) && (await willChange()).inside === 0, 'A selected card at rest is not its own layer');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...card, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 5; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + i * 8, y: card.y + i * 4, button: 'left', buttons: 1 }); await sleep(20); }
  const dragging = await run(() => getComputedStyle(document.querySelector('[data-node-id="a"]')).willChange);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: card.x + 40, y: card.y + 20, button: 'left', clickCount: 1 });
  await sleep(150);
  check(dragging === 'transform' && (await willChange()).inside === 0 && !await run(() => document.querySelector('.canvas-world').classList.contains('is-dragging-cards')), 'A dragged card is a layer only while it moves');
  await send('LayerTree.disable');
}, { height: 900 });
