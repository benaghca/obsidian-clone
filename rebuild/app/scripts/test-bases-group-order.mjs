// K3 (KANBAN_PLAN §2.2, §2.3, §5.3 P8/P9): the toolbar Group menu with real mouse and keys —
// Manual order, drag, show/hide, Show all / Hide all, Add group and remove, back to A → Z;
// "Hide group" on a heading; collapsed headings kept per tab, never written; then
// the menu with 1,000 groups (frame 1, drag frames) and collapse in a 10,000-row table and cards.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const p95 = values => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];

await withBrowser(async ({ run, click, point, move, send, press, key, check }) => {
  const wait = async (test, label, tries = 400) => { for (let i = 0; i < tries; i++) { if (await test()) return; await sleep(25); } assert.fail(label); };
  const ready = () => run(() => document.querySelector('.bases-view')?.getAttribute('aria-busy') !== 'true');
  const read = path => run(async path => { const { api } = await import('/src/api.ts'); return api.readNote(path); }, path);
  const center = selector => run(selector => { const el = typeof selector === 'string' ? document.querySelector(selector) : null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
  const item = title => run(title => { const el = [...document.querySelectorAll('.menu-item')].find(e => e.querySelector('.menu-item-title')?.textContent === title); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, title);
  const choose = async title => { await wait(async () => !!await item(title), `menu item ${title}`); await click(await item(title)); };
  const headings = () => run(() => [...document.querySelectorAll('.bases-b5-toggle')].map(b => b.getAttribute('aria-label')));
  const rows = () => run(() => [...document.querySelectorAll('.bases-group-row')].sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y).map(r => `${r.querySelector('.bases-group-label').textContent}${r.querySelector('input').checked ? '' : '-'}`));
  const row = label => `.bases-group-row[data-group-id='${label}']`;
  const count = () => run(() => document.querySelector('.bases-count span')?.textContent);

  // ----- behaviour, on a small vault -----
  const groupBlock = '    groupBy:\n      property: status\n      direction: ASC\n';
  const source = `# kept head\nfilters: 'file.inFolder("K3")'\nviews:\n  - type: table\n    name: Table\n    order: [file.name, status]\n${groupBlock}    # kept comment\n  - type: cards\n    name: Cards\n    order: [file.name, status]\n    groupBy:\n      property: status\n# kept tail\n`;
  await run(async source => {
    const { api } = await import('/src/api.ts');
    const notes = { A: 'todo', B: 'todo', C: 'doing', D: 'done', E: 'review', F: null };
    for (const [name, status] of Object.entries(notes)) await api.createNote(`K3/${name}.md`, status ? `---\nstatus: ${status}\n---\n` : `# ${name}\n`);
    await api.createNote('K3.base', source); await ws.vault.refreshFiles(); await ws.open('K3.base');
    window.k3Writes = 0; const write = api.writeNote; api.writeNote = (...args) => { if (args[0] === 'K3.base') k3Writes++; return write(...args); };
  }, source);
  await wait(async () => await ready() && (await headings()).length === 5, 'grouped table');
  assert.deepEqual(await headings(), ['doing (1)', 'done (1)', 'review (1)', 'todo (2)', 'Empty (1)']);
  assert.deepEqual(await run(() => [...document.querySelectorAll('.bases-toolbar-actions > button')].map(b => b.getAttribute('aria-label'))), ['Sort', 'Group', 'Filter', 'Properties', 'New']);
  assert.equal(await run(() => document.querySelector('[aria-label="Group"] .bases-group-detail').textContent), 'status');

  // Manual keeps the automatic order as its start.
  await click('.bases-toolbar [aria-label="Group"]');
  assert.equal(await run(() => document.querySelector('.bases-group-property span').textContent), 'status');
  await click('.bases-group-order'); await choose('Manual');
  await wait(async () => (await read('K3.base')).includes('order:'), 'Manual written');
  const manual = groupBlock + '      order:\n        - doing\n        - done\n        - review\n        - todo\n        - null\n';
  assert.equal(await read('K3.base'), source.replace(groupBlock, manual), 'only groupBy changes');
  await wait(async () => (await rows()).length === 5, 'manual rows');
  assert.deepEqual(await rows(), ['doing', 'done', 'review', 'todo', 'Empty']);
  assert.equal(await run(() => document.querySelector('[aria-label="Group"] .bases-group-detail').textContent), 'status · Manual');

  // Untick a group: hidden from the view and the count (D7).
  await click(`${row('s:"done"')} input`);
  await wait(async () => (await headings()).length === 4, 'done hidden');
  assert.equal(await count(), '5 results');
  assert.equal(await run(() => document.querySelector('.bases-count').title), '1 in hidden groups');
  assert.ok((await read('K3.base')).includes('      hidden:\n        - done\n'));
  assert.deepEqual(await rows(), ['doing', 'done-', 'review', 'todo', 'Empty'], 'the menu stays open and redraws in place');

  // Drag "todo" by its grip above "doing" (real mouse).
  const from = await center(`${row('s:"todo"')} .bases-group-grip`), to = await center(row('s:"doing"'));
  await move(from); await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y + (to.y - 10 - from.y) * i / 10, buttons: 1 }); await sleep(16); }
  assert.ok(await run(() => !!document.querySelector('.bases-group-drop') && !!document.querySelector('.bases-group-row.is-lifted')), 'drop line and lifted row while dragging');
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x, y: to.y - 10, button: 'left', buttons: 0, clickCount: 1 });
  await wait(async () => (await headings())[0] === 'todo (2)', 'dragged group first');
  assert.deepEqual(await headings(), ['todo (2)', 'doing (1)', 'review (1)', 'Empty (1)']);

  // Keyboard: Alt+Up moves the focused group; Space shows or hides it.
  await click(`${row('s:"review"')} input`); // hide review (focuses its tick)
  await wait(async () => (await headings()).length === 3, 'review hidden');
  await press(' ');
  await wait(async () => (await headings()).length === 4, 'Space shows it again');
  await key('Alt', 1); await press('ArrowUp', 1); await key('Alt', 0, 'keyUp');
  // One step up, past the hidden "done" (hidden groups keep their place in the order).
  await wait(async () => (await rows()).join() === 'todo,doing,review,done-,Empty', 'Alt+Up moved review');
  assert.ok(await run(() => document.activeElement?.closest('.bases-group-row')?.dataset.groupId === 's:"review"'), 'focus stays on the moved group');

  // Add group: an empty group, no note; ✕ removes it.
  await click('.bases-group-add'); await send('Input.insertText', { text: 'blocked' }); await press('Enter');
  await wait(async () => (await headings()).includes('blocked (0)'), 'added group shown');
  assert.equal(await run(() => document.querySelector(`.bases-group-row[data-group-id='s:"blocked"'] em`)?.textContent), 'empty · added');
  assert.equal(await run(() => ws.vault.files.filter(f => f.path.startsWith('K3/')).length), 6, 'no note created');
  await click(`.bases-group-row[data-group-id='s:"blocked"'] .bases-group-remove`);
  await wait(async () => !(await headings()).includes('blocked (0)'), 'added group removed');
  // Hide all, then Show all.
  await click(await run(() => { const r = [...document.querySelectorAll('.bases-group-actions button')].find(b => b.textContent === 'Hide all').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  await wait(async () => (await headings()).length === 0 && await count() === '0 results', 'all hidden');
  await click(await run(() => { const r = [...document.querySelectorAll('.bases-group-actions button')].find(b => b.textContent === 'Show all').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  await wait(async () => (await headings()).length === 5 && await count() === '6 results', 'all shown');
  assert.ok(!(await read('K3.base')).includes('hidden:'));

  // A → Z restores the automatic order and shows every group: groupBy is back to its original bytes.
  await click('.bases-group-order'); await choose('A → Z');
  await wait(async () => await read('K3.base') === source, 'automatic order restored');
  await wait(async () => (await headings())[0] === 'doing (1)', 'automatic headings');
  await press('Escape');
  check(true, 'Group menu: Manual, untick, drag, Alt+Up, Space, Add group / remove, Hide all / Show all, back to A → Z (only groupBy written)');

  // "Hide group" on a heading switches to Manual, keeping the order shown.
  await wait(async () => await ready() && (await headings()).length === 5, 'headings before Hide group');
  await click('.bases-b5-toggle[data-group-id=\'s:"review"\']', 'right'); await choose('Hide group');
  await wait(async () => (await read('K3.base')).includes('      hidden:\n        - review\n'), 'Hide group written');
  await wait(async () => !(await headings()).includes('review (1)'), 'review hidden from its heading');
  await run(async source => { const { api } = await import('/src/api.ts'); await api.writeNote('K3.base', source); ws.vault.written('K3.base'); }, source);
  await wait(async () => await ready() && (await headings()).length === 5, 'reset');

  // Collapse: local per tab, survives view switches and leaving the base; Alt+Shift+Up/Down; never written.
  const writes = await run(() => k3Writes), before = await read('K3.base');
  await click('.bases-b5-toggle[data-group-id=\'s:"todo"\']');
  assert.equal(await run(() => !!document.querySelector('tr[data-path="K3/A.md"]')), false, 'todo collapsed');
  await click('.bases-view-name'); await choose('Cards');
  await wait(async () => await ready() && await run(() => !!document.querySelector('.bases-b5-section')), 'cards view');
  await click('.bases-view-name'); await choose('Table');
  await wait(async () => await ready() && await run(() => !!document.querySelector('.bases-b5-heading')), 'table again');
  assert.equal(await run(() => document.querySelector('.bases-b5-toggle[data-group-id=\'s:"todo"\']').getAttribute('aria-expanded')), 'false', 'kept across view switches');
  await run(() => ws.open('K3/A.md')); await sleep(200); await run(() => ws.open('K3.base'));
  await wait(async () => await ready() && await run(() => !!document.querySelector('.bases-b5-heading')), 'base reopened in the tab');
  assert.equal(await run(() => document.querySelector('.bases-b5-toggle[data-group-id=\'s:"todo"\']').getAttribute('aria-expanded')), 'false', 'kept when the tab comes back to the base');
  await click('.bases-b5-toggle[data-group-id=\'s:"doing"\']'); // focus in the view
  await key('Alt', 9); await key('Shift', 9); await press('ArrowUp', 9); await key('Shift', 1, 'keyUp'); await key('Alt', 0, 'keyUp');
  assert.deepEqual(await run(() => [...document.querySelectorAll('.bases-b5-toggle')].map(b => b.getAttribute('aria-expanded'))), Array(5).fill('false'), 'Alt+Shift+Up collapses all');
  await key('Alt', 9); await key('Shift', 9); await press('ArrowDown', 9); await key('Shift', 1, 'keyUp'); await key('Alt', 0, 'keyUp');
  assert.deepEqual(await run(() => [...document.querySelectorAll('.bases-b5-toggle')].map(b => b.getAttribute('aria-expanded'))), Array(5).fill('true'), 'Alt+Shift+Down expands all');
  await sleep(100);
  assert.equal(await read('K3.base'), before); assert.equal(await run(() => k3Writes), writes, 'collapsing never writes the base');
  check(true, 'Hide group from a heading; collapse kept per tab (view switch, leaving and coming back), Alt+Shift+Up/Down, never written');

  // ----- performance: 10,000 notes, 1,000 groups -----
  const n = 10000;
  await run(async n => {
    const { api } = await import('/src/api.ts');
    const status = ['todo', 'doing', 'review', 'done'];
    for (let i = 0; i < n; i++) await api.createNote(`K3P/${String(i).padStart(5, '0')}.md`, `---\nstatus: ${status[i % 4]}\nbucket: b${String(i % 1000).padStart(3, '0')}\n---\n`);
    await api.createNote('K3P.base', `filters: 'file.inFolder("K3P")'\nviews:\n  - type: table\n    name: Table\n    order: [file.name, status]\n    groupBy:\n      property: status\n  - type: cards\n    name: Cards\n    order: [file.name, status]\n    groupBy:\n      property: status\n  - type: table\n    name: Buckets\n    order: [file.name, bucket]\n    groupBy:\n      property: bucket\n`);
    await ws.vault.refreshFiles(); await ws.open('K3P.base');
  }, n);
  const full = async () => { await wait(async () => await ready() && await count() === `${n} results`, `${n} rows`, 1200); await sleep(400); };
  await full();

  // P9: collapse and expand in a 10,000-row grouped table and cards.
  const p9 = {};
  for (const view of ['Table', 'Cards']) {
    if (view === 'Cards') { await click('.bases-view-name'); await choose('Cards'); await full(); }
    await run(() => {
      window.k3 = { frames: 0, done: [], long: [] };
      new PerformanceObserver(list => { for (const e of list.getEntries()) k3.long.push(e.duration); }).observe({ type: 'longtask' });
      document.addEventListener('pointerdown', k3.down = () => { k3.pending = { at: performance.now(), frame: k3.frames }; }, true);
      k3.raf = requestAnimationFrame(function tick() { k3.frames++; k3.raf = requestAnimationFrame(tick); });
      k3.obs = new MutationObserver(() => { const k = k3.pending; if (!k) return; k3.pending = null; const work = performance.now() - k.at; requestAnimationFrame(() => k3.done.push({ work, frames: k3.frames - k.frame })); });
      k3.obs.observe(document.querySelector('.bases-scroll'), { childList: true, subtree: true, attributes: true });
    });
    for (let i = 0; i < 6; i++) { await click('.bases-b5-toggle[data-group-id=\'s:"doing"\']'); await sleep(200); }
    p9[view] = await run(() => { cancelAnimationFrame(k3.raf); k3.obs.disconnect(); document.removeEventListener('pointerdown', k3.down, true); return { work: k3.done.map(d => +d.work.toFixed(1)), frames: k3.done.map(d => d.frames), long: k3.long.map(Math.round) }; });
    assert.equal(p9[view].frames.length, 6, `${view}: every press painted`);
    assert.ok(Math.max(...p9[view].frames) <= 2 && Math.max(...p9[view].work) < 16.7 && !p9[view].long.length, `${view}: collapse paints next frame ${JSON.stringify(p9[view])}`);
  }
  console.log('K3_P9', JSON.stringify(p9));
  check(true, `P9: collapse/expand at ${n} rows paints on the next frame (table work median ${median(p9.Table.work)}ms, cards ${median(p9.Cards.work)}ms)`);

  // P8: the Group menu with 1,000 groups opens on frame 1; dragging a row stays under budget.
  await click('.bases-view-name'); await choose('Buckets'); await full();
  await click('.bases-toolbar [aria-label="Group"]'); await click('.bases-group-order'); await choose('Manual');
  await wait(async () => (await read('K3P.base')).includes('        - b999\n'), 'Manual with 1,000 groups written', 1200);
  await wait(async () => await ready() && await run(() => document.querySelectorAll('.bases-group-row').length > 0), 'menu redrawn');
  await press('Escape'); await full();
  const opens = [];
  for (let i = 0; i < 3; i++) {
    await run(() => document.addEventListener('click', () => { window.bt = { visible: 0, max: 0 }; let last = performance.now(), frame = 0; requestAnimationFrame(function tick(now) { frame++; bt.max = Math.max(bt.max, now - last); last = now; if (!bt.visible && document.querySelector('.bases-group-menu')) bt.visible = frame; if (frame < 19) requestAnimationFrame(tick); }); }, { once: true, capture: true }));
    await click('.bases-toolbar [aria-label="Group"]'); await sleep(340);
    opens.push(await run(() => ({ ...bt, rows: document.querySelectorAll('.bases-group-row').length, filter: !!document.querySelector('[aria-label="Filter groups"]') })));
    if (i < 2) { await press('Escape'); await sleep(100); }
  }
  assert.ok(opens.every(o => o.visible === 1 && o.max < 20 && o.rows <= 30 && o.filter), `menu with 1,000 groups opens on frame 1, virtual ${JSON.stringify(opens)}`);
  // Drag the first row down past the list's edge, so it auto-scrolls.
  const grip = await center('.bases-group-row .bases-group-grip'), list = await run(() => { const r = document.querySelector('.bases-group-list').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  await run(() => { window.k3d = { frames: [] }; let last = performance.now(); k3d.raf = requestAnimationFrame(function tick(t) { k3d.frames.push(t - last); last = t; k3d.raf = requestAnimationFrame(tick); }); });
  await move(grip); await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...grip, button: 'left', buttons: 1, clickCount: 1 });
  const moves = 60;
  for (let i = 1; i <= moves; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip.x, y: Math.min(list.bottom - 6, grip.y + i * 6), buttons: 1 }); await sleep(8); }
  await sleep(300);
  const dragFrames = await run(() => { cancelAnimationFrame(k3d.raf); return k3d.frames.slice(2); });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grip.x, y: list.bottom - 6, button: 'left', buttons: 0, clickCount: 1 });
  await wait(async () => !(await read('K3P.base')).includes('      order:\n        - b000\n'), 'dragged b000 written', 1200);
  assert.ok(p95(dragFrames) < 20, `drag p95 ${p95(dragFrames).toFixed(1)}ms`);
  console.log('K3_P8', JSON.stringify({ opens, dragFrames: { count: dragFrames.length, median: +median(dragFrames).toFixed(1), p95: +p95(dragFrames).toFixed(1), max: +Math.max(...dragFrames).toFixed(1) } }));
  check(true, `P8: 1,000-group Group menu opens on frame 1 (max ${Math.max(...opens.map(o => o.max)).toFixed(1)}ms, ${opens[0].rows} rows in the DOM); drag frames p95 ${p95(dragFrames).toFixed(1)}ms`);
}, { height: 900 });
