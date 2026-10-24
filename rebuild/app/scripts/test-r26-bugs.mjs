// Round 26 confirmed-bug regressions. Pointer and keys are CDP Input events.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const failures = [];
const check = (ok, message) => {
  if (ok) console.log('PASS', message);
  else { console.log('FAIL', message); failures.push(message); }
};

await withBrowser(async ({ send, run, click, press, double, read, open, key }) => {
  const data = async () => JSON.parse(await read());
  const move = async p => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); await sleep(40); };
  const drag = async (a, b) => {
    await move(a);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 10; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * i / 10, y: a.y + (b.y - a.y) * i / 10, buttons: 1 });
      await sleep(16);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(400);
  };
  const ctrl = async k => { await key('Control', 2); await press(k, 2); await key('Control', 0, 'keyUp'); };
  const mid = () => run(() => {
    const edge = document.querySelector('path.canvas-edge');
    const p = edge.getPointAtLength(edge.getTotalLength() / 2);
    const q = new DOMPoint(p.x, p.y).matrixTransform(edge.getScreenCTM());
    return { x: q.x, y: q.y };
  });

  await open('Dots.canvas', { nodes: [
    { id: 'a', type: 'text', x: 80, y: 200, width: 200, height: 120, text: 'Alpha' },
    { id: 'b', type: 'text', x: 480, y: 200, width: 200, height: 120, text: 'Beta' },
  ], edges: [] });
  await click('[aria-label="Reset zoom"]');
  await sleep(40);
  const beta = await run(() => { const r = document.querySelector('[data-node-id="b"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await click(beta);
  const outer = await run(() => {
    const dot = document.querySelector('[data-node-id="b"] [data-side="left"]');
    const card = document.querySelector('[data-node-id="b"]').getBoundingClientRect();
    const r = dot.getBoundingClientRect();
    const x = Math.round(r.left + 2), y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    return { x, y, cardLeft: card.left, shown: getComputedStyle(dot).display, hit: hit?.getAttribute('aria-label') || hit?.className || null };
  });
  const alpha = await run(() => { const r = document.querySelector('[data-node-id="a"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await move(alpha);
  const from = await run(() => { const r = document.querySelector('[data-node-id="a"] [data-side="right"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; });
  check(outer.shown === 'block' && outer.x < outer.cardLeft - 4 && from.w > 10 && outer.hit === 'Connect left', `outer-half target is on the visible left handle, got ${JSON.stringify({ outer, from })}`);
  await drag(from, { x: outer.x, y: outer.y });
  let edges = (await data()).edges;
  check(edges.some(e => e.fromNode === 'a' && e.fromSide === 'right' && e.toNode === 'b' && e.toSide === 'left'), `dropping on the outer half of the target connection dot creates the edge, got ${JSON.stringify(edges)}`);
  const inner = await run(() => {
    const card = document.querySelector('[data-node-id="b"]').getBoundingClientRect();
    return { x: Math.round(card.left + 6), y: Math.round(card.top + card.height / 2) };
  });
  if (edges.length) await ctrl('z');
  await sleep(200);
  await move(alpha);
  const fromInner = await run(() => { const r = document.querySelector('[data-node-id="a"] [data-side="right"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await drag(fromInner, inner);
  edges = (await data()).edges;
  check(edges.some(e => e.toNode === 'b' && e.toSide === 'left'), `dropping 6px inside the card still creates the edge, got ${JSON.stringify(edges)}`);

  await open('Top.canvas', { nodes: [
    { id: 'a', type: 'text', x: 80, y: 80, width: 180, height: 80, text: 'A' },
    { id: 'b', type: 'text', x: 420, y: 80, width: 180, height: 80, text: 'B' },
  ], edges: [{ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', label: 'Gap' }] });
  await click('[aria-label="Reset zoom"]');
  await sleep(40);
  const start = await mid();
  await click(start);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(40);
  await drag(start, { x: start.x, y: 90 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(150);
  await click(await mid());
  const bar = await run(() => {
    const menu = document.querySelector('.canvas-selection-menu');
    const view = document.querySelector('.canvas-view').getBoundingClientRect();
    const color = menu?.querySelector('[aria-label="Set color"]');
    const r = menu?.getBoundingClientRect();
    const cr = color?.getBoundingClientRect();
    const at = cr ? { x: cr.x + cr.width / 2, y: cr.y + cr.height / 2 } : null;
    const hit = at ? document.elementFromPoint(at.x, at.y) : null;
    const owner = hit?.closest?.('[aria-label]') || hit;
    return { top: r?.top ?? null, bottom: r?.bottom ?? null, viewTop: view.top, at, hit: owner?.getAttribute?.('aria-label') || owner?.className?.baseVal || owner?.className || null };
  });
  check(bar.bottom > bar.viewTop && bar.hit === 'Set color', `edge toolbar stays inside the canvas when the edge is at the top, got ${JSON.stringify(bar)}`);
  if (bar.at) await click(bar.at);
  await sleep(150);
  check(await run(() => !!document.querySelector('.canvas-color-menu')), 'Set color opens after the edge is panned to the top of the view');

  await open('Tight.canvas', { nodes: [
    { id: 'd', type: 'text', x: 80, y: 240, width: 180, height: 80, text: 'Dee' },
    { id: 'f', type: 'text', x: 270, y: 240, width: 180, height: 80, text: 'Eff' },
  ], edges: [{ id: 'short', fromNode: 'd', fromSide: 'right', toNode: 'f', toSide: 'left', label: 'X' }] });
  await click('[aria-label="Reset zoom"]');
  await sleep(40);
  const before = (await data()).nodes.length;
  const labelAt = await run(() => {
    const label = document.querySelector('.canvas-edge-label');
    const r = label.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await double(labelAt);
  await sleep(300);
  const after = await data();
  const editing = await run(() => ({
    label: document.activeElement?.matches('.canvas-edge-label.is-editing') || false,
    card: document.querySelector('.canvas-node.is-editing')?.dataset.nodeId || null,
  }));
  check(after.nodes.length === before && editing.label && !editing.card, `double-clicking a short edge label edits it and adds no card, got ${JSON.stringify({ nodes: after.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, text: n.text })), editing })}`);
}, { height: 860 });

assert.deepEqual(failures, []);
