// Bases on a canvas: file cards, the note picker, explorer drag, the connect picker,
// a markdown embed, save/reload, and no view for a card that is off screen.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const baseYaml = `filters:
  and:
    - file.inFolder("BC")
views:
  - type: table
    name: All
    order:
      - note
      - tags
      - labels
      - file.name
      - status
    sort:
      - property: file.name
        direction: ASC
  - type: table
    name: Open
    filters:
      and:
        - 'status == "open"'
    order:
      - file.name
`;

const board = {
  nodes: [
    { id: 'near', type: 'file', file: 'Board.base', x: 0, y: 0, width: 460, height: 320, extra: 'keep' },
    { id: 'open', type: 'file', file: 'Board.base', subpath: '#Open', x: 500, y: 0, width: 460, height: 320 },
    { id: 'embed', type: 'text', x: 0, y: 360, width: 460, height: 320, text: '![[Board.base]]\n' },
    { id: 'other', type: 'file', file: 'Other.txt', x: 500, y: 360, width: 220, height: 120 },
    { id: 'far', type: 'file', file: 'Board.base', x: 8000, y: 0, width: 460, height: 320 },
  ],
  edges: [],
};

await withBrowser(async ({ run, send, click, point, move, press, chord, check, read }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 800; i++) { if (await test()) return; await sleep(15); }
    assert.fail(label);
  };
  const settle = () => wait(() => run(() => window.__canvasProbe?.().pending === 0), 'canvas work drains');
  const data = async () => JSON.parse(await read());
  const rows = (id) => run((id) => [...document.querySelectorAll(`[data-node-id="${id}"] .bases-table tbody tr[data-path]`)].map((tr) => tr.dataset.path), id);
  const jump = async (cx, cy, scale = 1) => {
    await wait(() => run(() => !!window.__groveViewports.canvasViewports.get(ws.active)), 'canvas viewport is ready');
    await run((cx, cy, scale) => {
      const { canvasViewports } = window.__groveViewports;
      const state = canvasViewports.get(ws.active);
      state.cx = cx;
      state.cy = cy;
      state.scale = scale;
      const el = document.querySelector('.canvas-view');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, cancelable: true, deltaY: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    }, cx, cy, scale);
    await sleep(240);
    await settle();
  };
  const menu = async (title) => {
    const at = await run((title) => {
      const el = [...document.querySelectorAll('.menu-item')].find((item) => item.querySelector('.menu-item-title')?.textContent === title);
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, title);
    await click(at);
  };
  const drag = async (from, to) => {
    await move(from);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 12; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / 12, y: from.y + (to.y - from.y) * i / 12, button: 'left', buttons: 1 });
      await sleep(16);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', clickCount: 1 });
    await sleep(350);
  };

  await run(async (yaml) => {
    const { api } = await import('/src/api.ts');
    const { canvasViewports } = await import('/src/canvas/navigation.ts');
    window.__groveViewports = { canvasViewports };
    await api.createNote('BC/One.md', '---\nstatus: open\nnote: hello\ntags:\n  - alpha\nlabels:\n  - one\n---\n# One\n');
    await api.createNote('BC/Two.md', '---\nstatus: done\nnote: there\ntags:\n  - beta\nlabels:\n  - two\n---\n# Two\n');
    await api.createNote('Board.base', yaml);
    await api.createNote('Other.txt', 'plain\n');
    await ws.vault.refreshFiles();
    const readNote = api.readNote.bind(api);
    window.baseReads = [];
    api.readNote = (path, ...rest) => {
      if (typeof path === 'string' && /\.base$/i.test(path)) window.baseReads.push(path);
      return readNote(path, ...rest);
    };
  }, baseYaml);

  const original = JSON.stringify(board);
  await run(async (text) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Board.canvas', text);
    await ws.vault.refreshFiles();
    await ws.open('Board.canvas');
  }, original);
  await wait(() => run(() => window.__canvasProbe?.().built && document.querySelector('.canvas-world')?.classList.contains('is-zoomed-out')), 'fitted board is in title mode');
  check(await read() === original, 'opening the canvas does not rewrite the file');
  check(await run(() => document.querySelectorAll('.bases-view').length === 0), 'title mode mounts no base view');

  await jump(480, 340);
  await wait(() => run(() => document.querySelector('[data-node-id="near"] .bases-view-name')?.textContent?.includes('All')), 'near card shows the All view');
  await wait(() => run(() => document.querySelector('[data-node-id="open"] .bases-view-name')?.textContent?.includes('Open')), 'subpath card shows the Open view');
  await wait(async () => (await rows('near')).join('|') === 'BC/One.md|BC/Two.md', 'on-screen base lists both notes');
  await wait(async () => (await rows('open')).join('|') === 'BC/One.md', 'Open view lists the open note');
  await wait(() => run(() => !!document.querySelector('[data-node-id="embed"] .bases-embed .bases-view')), 'text card embed mounts the base');
  await wait(async () => (await rows('embed')).join('|') === 'BC/One.md|BC/Two.md', 'text card embed lists both notes');
  check(await run(() => document.querySelector('[data-node-id="other"]').textContent.includes('Unsupported file: Other.txt')), 'a plain file stays unsupported');
  check(await run(() => !document.querySelector('[data-node-id="far"] .bases-view') && document.querySelector('[data-node-id="far"]').classList.contains('is-culled')), 'the off-screen base card is culled and has no view');
  const readsNear = await run(() => window.baseReads.length);
  check(readsNear > 0, 'on-screen cards read the base');

  await jump(8230, 160);
  await wait(() => run(() => !!document.querySelector('[data-node-id="far"] .canvas-node-content > .bases-view')), 'the far card mounts when it comes on screen');
  await wait(async () => (await rows('far')).length === 2, 'the far card lists both notes once shown');
  const readsFar = await run(() => window.baseReads.length);
  check(readsFar > readsNear, 'the off-screen card reads the base only after it is shown');
  check(await run(() => !document.querySelector('[data-node-id="near"] .bases-view')), 'the near card is not left mounted while the camera is on the far card');

  await jump(480, 340);
  await wait(() => run(() => !!document.querySelector('[data-node-id="near"] .bases-view') && !document.querySelector('[data-node-id="far"] .bases-view')), 'panning back detaches the far view and restores the near one');
  check(await read() === original, 'rendering and panning leave the canvas bytes unchanged');

  const source = (path) => run(async (path) => {
    const { api } = await import('/src/api.ts');
    return api.readNote(path);
  }, path);
  // A base scroller is contain:strict inside the transformed canvas, so
  // getBoundingClientRect of a cell does not match what the pointer hits.
  await send('DOM.enable');
  const fieldAt = async (selector) => {
    await run((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }), selector);
    await sleep(30);
    const found = await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
    const model = await send('DOM.getBoxModel', { objectId: found.result.objectId });
    const q = model.model.content;
    const left = Math.min(q[0], q[2], q[4], q[6]);
    const right = Math.max(q[0], q[2], q[4], q[6]);
    const top = Math.min(q[1], q[3], q[5], q[7]);
    const bottom = Math.max(q[1], q[3], q[5], q[7]);
    return { x: left + Math.min(8, (right - left) / 2), y: (top + bottom) / 2 };
  };
  const cell = (path, key, part) => `[data-node-id="near"] tr[data-path="${path}"] td[data-property="${key}"] [data-part="${part}"]`;
  const baseBytes = await source('Board.base');
  const canvasBytes = await read();
  const otherBefore = await source('Other.txt');
  await click(await fieldAt(cell('BC/One.md', 'note', 'value')));
  await send('Input.insertText', { text: 'bctext' });
  check(!(await source('BC/One.md')).includes('bctext'), 'typing a text cell does not write before commit');
  await press('Enter');
  await wait(async () => (await source('BC/One.md')).includes('bctext'), 'the text cell commits into the row note');
  check(!(await source('BC/Two.md')).includes('bctext'), 'the other row note is unchanged');
  check(await source('Board.base') === baseBytes, 'a text cell edit does not rewrite the base');
  check(await read() === canvasBytes, 'a text cell edit does not rewrite the canvas');

  await click(await fieldAt(cell('BC/One.md', 'tags', 'add')));
  await send('Input.insertText', { text: 'newtag' });
  await press('Enter');
  await wait(async () => (await source('BC/One.md')).includes('  - newtag'), 'tag entry commits into the row note');
  check(!(await source('BC/Two.md')).includes('newtag'), 'the tag stays on the edited row');
  await click(await fieldAt(cell('BC/One.md', 'labels', 'add')));
  await send('Input.insertText', { text: 'bclist' });
  await press('Enter');
  await wait(async () => (await source('BC/One.md')).includes('  - bclist'), 'list entry commits into the row note');
  check(!(await source('BC/Two.md')).includes('bclist'), 'the list item stays on the edited row');
  check(await source('Board.base') === baseBytes && await read() === canvasBytes, 'tag and list entry do not rewrite the base or the canvas');

  await click(await fieldAt(cell('BC/Two.md', 'note', 'value')));
  await send('Input.insertText', { text: 'bczoom' });
  check(!(await source('BC/Two.md')).includes('bczoom'), 'the zoom edit is still uncommitted');
  await jump(480, 340, 0.2);
  await wait(() => run(() => !document.querySelector('[data-node-id="near"] .bases-view')), 'title mode detaches the base view');
  await wait(async () => (await source('BC/Two.md')).includes('bczoom'), 'title mode commits the focused cell into the row note');
  check(!(await source('BC/One.md')).includes('bczoom') && await source('Board.base') === baseBytes && await read() === canvasBytes && await source('Other.txt') === otherBefore, 'title mode writes no other file');
  await jump(480, 340);
  await wait(() => run(() => !!document.querySelector('[data-node-id="near"] .bases-view')), 'leaving title mode restores the base view');

  await click(await fieldAt(cell('BC/Two.md', 'tags', 'add')));
  await send('Input.insertText', { text: 'bccull' });
  check(!(await source('BC/Two.md')).includes('bccull'), 'the cull edit is still uncommitted');
  await jump(8230, 160);
  await wait(() => run(() => !document.querySelector('[data-node-id="near"] .bases-view') && !!document.querySelector('[data-node-id="far"] .bases-view')), 'panning away culls the edited card');
  await wait(async () => (await source('BC/Two.md')).includes('bccull'), 'culling commits the focused cell into the row note');
  check((await source('BC/Two.md')).includes('bczoom') && !(await source('BC/One.md')).includes('bccull') && await source('Board.base') === baseBytes && await read() === canvasBytes && await source('Other.txt') === otherBefore, 'culling writes no other file');
  await jump(480, 340);
  await wait(() => run(() => !!document.querySelector('[data-node-id="near"] .bases-view')), 'panning back restores the edited card');

  await click(await fieldAt(cell('BC/One.md', 'note', 'value')));
  await send('Input.insertText', { text: 'bcbye' });
  check(!(await source('BC/One.md')).includes('bcbye'), 'the disposal edit is still uncommitted');
  const welcomeBefore = await source('Welcome.md');
  await run(async () => { await ws.open('Welcome.md'); });
  await wait(async () => (await source('BC/One.md')).includes('bcbye'), 'closing the canvas commits the focused cell');
  check((await source('BC/Two.md')).includes('bczoom') && (await source('BC/Two.md')).includes('bccull'), 'disposal keeps the other row');
  check(await source('Board.base') === baseBytes && await source('Board.canvas') === canvasBytes && await source('Other.txt') === otherBefore && await source('Welcome.md') === welcomeBefore, 'disposal writes no other file');
  await run(async () => { await ws.open('Board.canvas'); });
  await wait(() => run(() => window.__canvasProbe?.().built), 'canvas restored after disposal');
  await jump(480, 340);
  await wait(() => run(() => !!document.querySelector('[data-node-id="near"] .bases-view')), 'the base view returns after disposal');

  await click('[data-node-id="near"] .bases-toolbar [aria-label="Sort"]');
  await wait(() => run(() => !!document.querySelector('.bases-sort-menu')), 'sort menu opens from the card');
  await click('.bases-sort-row button:nth-of-type(2)');
  await menu('Z → A');
  await wait(async () => (await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('Board.base'); })).includes('direction: DESC'), 'the card writes the base through the normal path');
  const written = await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('Board.base'); });
  check(written.includes('name: Open') && written.includes('direction: DESC'), 'the saved base keeps the other view');
  check(await read() === original, 'editing the base does not rewrite the canvas');
  await press('Escape');

  const label = await point('[data-node-id="near"] .canvas-file-label');
  await drag(label, { x: label.x + 48, y: label.y + 36 });
  const moved = (await data()).nodes.find((node) => node.id === 'near');
  check(moved.type === 'file' && moved.file === 'Board.base' && moved.extra === 'keep' && (moved.x !== 0 || moved.y !== 0), `dragging the card moves the file node (${moved.x}, ${moved.y})`);
  const handle = await point('[data-node-id="near"] [data-resize="bottomright"]');
  await drag(handle, { x: handle.x + 50, y: handle.y + 40 });
  const sized = (await data()).nodes.find((node) => node.id === 'near');
  check(sized.width !== 460 && sized.height !== 320 && sized.subpath === undefined && (await data()).nodes.find((node) => node.id === 'open').subpath === '#Open', 'resizing keeps a file node and the other card’s subpath');
  check(await run(() => !!document.querySelector('[data-node-id="near"] .bases-view')), 'the view stays mounted after the move and resize');

  await click('.canvas-card-menu [aria-label="Drag to add note from vault"]');
  await wait(() => run(() => !!document.querySelector('.prompt')), 'note picker opens');
  await send('Input.insertText', { text: 'Welcome' });
  await wait(() => run(() => [...document.querySelectorAll('.suggestion-item')].some((item) => item.textContent.includes('Welcome'))), 'the picker still lists notes');
  await chord('a');
  await send('Input.insertText', { text: 'Board.base' });
  await wait(() => run(() => [...document.querySelectorAll('.suggestion-item')].some((item) => item.textContent.includes('Board.base'))), 'the picker lists the base');
  await click(await run(() => {
    const el = [...document.querySelectorAll('.suggestion-item')].find((item) => item.textContent.includes('Board.base'));
    const r = el.getBoundingClientRect();
    return { x: r.x + 24, y: r.y + r.height / 2 };
  }));
  await sleep(400);
  await wait(async () => (await data()).nodes.filter((node) => node.file === 'Board.base').length === 4, 'picker adds a file node for the base');
  const picked = (await data()).nodes.find((node) => node.file === 'Board.base' && !['near', 'open', 'far'].includes(node.id));
  check(picked.type === 'file' && picked.width === 400 && picked.height === 400, 'the picked card is a 400×400 file node');
  await wait(() => run((id) => !!document.querySelector(`[data-node-id="${id}"] .bases-view`), picked.id), 'the picked card renders the view');

  const row = '.nav-files .tree-item-self[data-path="Board.base"]';
  await run((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'center' }), row);
  await sleep(30);
  const from = await point(row);
  const dropAt = await run(() => {
    const r = document.querySelector('.canvas-view').getBoundingClientRect();
    return { x: Math.round(r.right - 70), y: Math.round(r.bottom - 80) };
  });
  await drag(from, dropAt);
  await wait(async () => (await data()).nodes.filter((node) => node.file === 'Board.base').length === 5, 'explorer drag adds a file node for the base');
  const dropped = (await data()).nodes.filter((node) => node.type === 'file' && node.file === 'Board.base').at(-1);
  check(dropped.width === 400 && dropped.height === 400, 'the dropped card is a 400×400 file node');

  // The picked card covers the near card's center. The label and top edge stay clear,
  // and selecting the card is what shows its connection dots.
  await click('[data-node-id="near"] .canvas-file-label');
  const dot = await point('[data-node-id="near"] [data-side="top"]');
  const out = { x: dot.x, y: dot.y - 90 };
  await drag(dot, out);
  const addMenu = await run(() => [...document.querySelectorAll('.canvas-add-menu .menu-item-title')].map((el) => el.textContent).join('|'));
  check(addMenu === 'Add card|Add note from vault', `a connection still offers the note picker (${addMenu})`);
  await click('.canvas-add-menu .menu-item:nth-child(2)');
  await wait(() => run(() => !!document.querySelector('.prompt')), 'connect picker opens');
  await send('Input.insertText', { text: 'Board.base' });
  await click(await run(() => {
    const el = [...document.querySelectorAll('.suggestion-item')].find((item) => item.textContent.includes('Board.base'));
    const r = el.getBoundingClientRect();
    return { x: r.x + 24, y: r.y + r.height / 2 };
  }));
  await sleep(400);
  const connected = await data();
  const linked = connected.nodes.filter((node) => node.file === 'Board.base');
  check(linked.length === 6 && connected.edges.length === 1 && linked.some((node) => node.id === connected.edges[0].toNode), 'connect picker adds a file node and an edge');

  const saved = await read();
  const parsed = JSON.parse(saved);
  check(parsed.nodes.filter((node) => String(node.file || '').endsWith('.base')).every((node) => node.type === 'file'), 'every base card is a file node');
  check(parsed.nodes.find((node) => node.id === 'open').subpath === '#Open' && parsed.nodes.find((node) => node.id === 'near').extra === 'keep', 'reload keeps the subpath and unknown keys');
  await run(async () => { await ws.open('Welcome.md'); await ws.open('Board.canvas'); });
  await wait(() => run(() => window.__canvasProbe?.().built), 'canvas reloaded');
  await jump(480, 340);
  await wait(() => run(() => !!document.querySelector('[data-node-id="near"] .bases-view') && document.querySelector('[data-node-id="open"] .bases-view-name')?.textContent?.includes('Open')), 'reload renders the saved file cards');
  check(await read() === saved, 'reloading does not rewrite the canvas');
});
