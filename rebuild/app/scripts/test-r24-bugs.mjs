// Round 24 confirmed-bug regressions. Pointer and keys are CDP Input events.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const failures = [];
const check = (ok, message) => {
  if (ok) console.log('PASS', message);
  else { console.log('FAIL', message); failures.push(message); }
};

const drag = async (send, move, p, dx, dy) => {
  await move(p);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + dx * i / 8, y: p.y + dy * i / 8, buttons: 1 });
    await sleep(16);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + dx, y: p.y + dy, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(40);
};

await withBrowser(async ({ send, run, move, point, click, press, chord, double, read, open: openFile }) => {
  const open = (path, text) => openFile(path, text, 120);

  await open('Cover.canvas', JSON.stringify({
    nodes: [
      { id: 'g', type: 'group', x: 0, y: 0, width: 420, height: 300, label: 'Group' },
      { id: 'overlap', type: 'text', x: 200, y: -40, width: 140, height: 90, text: 'Crosses' },
    ],
    edges: [],
  }));
  await click('[data-node-id="g"] .canvas-group-label');
  const groupSelected = await run(() => document.querySelector('[data-node-id="g"]').classList.contains('is-selected'));
  const hit = await run(() => {
    const card = document.querySelector('[data-node-id="overlap"]');
    const r = card.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height * 0.55;
    const el = document.elementFromPoint(x, y);
    return { x, y, resize: el?.closest?.('[data-resize]')?.getAttribute('data-resize') || null, id: el?.closest?.('.canvas-node')?.dataset.nodeId || null };
  });
  check(groupSelected && !hit.resize && hit.id === 'overlap', `a card crossing a selected group's edge is the hit target, got ${JSON.stringify(hit)}`);
  await drag(send, move, hit, 0, 48);
  await sleep(420);
  const covered = JSON.parse(await read());
  const group = covered.nodes.find(n => n.id === 'g');
  const overlap = covered.nodes.find(n => n.id === 'overlap');
  check(overlap.y !== -40 && group.y === 0 && group.width === 420 && group.height === 300,
    `dragging that card moves it and leaves the group, overlap ${JSON.stringify(overlap)} group ${JSON.stringify(group)}`);

  await open('Edges.canvas', JSON.stringify({
    nodes: [
      { id: 'from', type: 'text', x: 40, y: 80, width: 160, height: 80, text: 'From' },
      { id: 'to', type: 'text', x: 380, y: 80, width: 160, height: 80, text: 'To' },
    ],
    edges: [{ id: 'e', fromNode: 'from', toNode: 'to', label: 'Lab' }],
  }));
  const label = await run(() => {
    const el = document.querySelector('.canvas-edge-label');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: el.textContent };
  });
  const nodesBefore = await run(() => document.querySelectorAll('.canvas-node').length);
  if (!label) check(false, 'edge label is on screen to double-click');
  else {
    await double(label);
    await sleep(200);
    const added = await run(() => ({
      nodes: document.querySelectorAll('.canvas-node').length,
      editing: !!document.querySelector('.canvas-node.is-editing'),
    }));
    check(added.nodes === nodesBefore && !added.editing, `double-click on an edge label does not create a text card, got ${JSON.stringify(added)} from ${nodesBefore}`);
    await press('Escape');
  }

  await open('Drag.canvas', JSON.stringify({
    nodes: [{ id: 'mid', type: 'text', x: 80, y: 80, width: 160, height: 80, text: 'Middle' }],
    edges: [],
  }));
  const mid = await point('[data-node-id="mid"]');
  await click(mid);
  const beforeDrag = await run(() => {
    const el = document.querySelector('[data-node-id="mid"]');
    return { left: el.style.left, top: el.style.top, selected: el.classList.contains('is-selected') };
  });
  await move(mid);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...mid, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mid.x + 36 * i / 6, y: mid.y + 16 * i / 6, buttons: 1 });
  await sleep(40);
  await press('Escape');
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mid.x + 36, y: mid.y + 16, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(80);
  const afterDrag = await run(() => {
    const el = document.querySelector('[data-node-id="mid"]');
    return { left: el.style.left, top: el.style.top, selected: el.classList.contains('is-selected') };
  });
  check(beforeDrag.selected && afterDrag.selected && afterDrag.left === beforeDrag.left && afterDrag.top === beforeDrag.top,
    `Escape during a move restores the card and keeps it selected, before ${JSON.stringify(beforeDrag)} after ${JSON.stringify(afterDrag)}`);

  await open('Empty.canvas', '{}');
  const spot = await run(() => {
    const r = document.querySelector('.canvas-view').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await double(spot);
  await send('Input.insertText', { text: 'a' });
  await press('Backspace');
  await press('Escape');
  await sleep(420);
  const edited = await read();
  check(edited !== '{}' && edited.includes('"text":""'), `reverted text session leaves the new card, got ${JSON.stringify(edited.slice(0, 180))}`);
  await chord('z');
  await sleep(420);
  const undone = await read();
  check(undone === '{}', `one Ctrl+Z after a reverted text session undoes the added card, got ${JSON.stringify(undone.slice(0, 220))}`);

  await open('Media.canvas', '{}');
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Odd.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="300"><rect width="100" height="300" fill="#8b6cef"/></svg>');
    await ws.vault.refreshFiles();
  });
  await click('.canvas-card-menu [aria-label="Drag to add media from vault"]');
  await send('Input.insertText', { text: 'Odd.svg' });
  await sleep(80);
  const suggestion = await run(() => !!document.querySelector('.suggestion-item'));
  if (!suggestion) check(false, 'media picker lists Odd.svg');
  else {
    await click('.suggestion-item');
    await sleep(500);
    const media = JSON.parse(await read()).nodes.at(-1);
    check(Number.isInteger(media.x) && Number.isInteger(media.y) && Number.isInteger(media.width) && Number.isInteger(media.height),
      `odd-dimension media is saved on whole board coordinates, got ${JSON.stringify({ x: media.x, y: media.y, width: media.width, height: media.height })}`);
  }

  const tagged = '{\n\t"nodes":[\n\t\t{"id":"a","type":"text","text":"A","x":0,"y":0,"width":140,"height":80}\n\t],\n\t"edges":[],\n\t"tags":[1,2,3]\n}';
  await open('Tagged.canvas', tagged);
  const origin = await point('[data-node-id="a"]');
  await drag(send, move, origin, 48, 12);
  await sleep(420);
  const saved = await read();
  const moved = JSON.parse(saved).nodes.find(n => n.id === 'a');
  check(moved.x !== 0 && /"tags":\[1,2,3\]/.test(saved), `an untouched root scalar array stays on one line after a card move, x=${moved.x} tags=${JSON.stringify(saved.slice(saved.indexOf('"tags"')))}`);
}, { height: 800 });

assert.deepEqual(failures, []);
