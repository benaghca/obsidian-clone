// K4 (KANBAN_PLAN §2.1, §5.3 P1–P3, P11): the read-only Kanban board with real mouse and keys —
// columns from groups (No value last, Manual order, hidden groups), fixed card height, open,
// keyboard, the column ⋯ menu (Hide, Move → Manual) and +, the ungrouped prompt, Search,
// Configure view's Layout; then a 10,000-note board (open, a 10,000-card column, 200 columns)
// and a board embedded in a note.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const p95 = values => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];

await withBrowser(async ({ run, click, point, move, send, press, key, check }) => {
  const wait = async (test, label, tries = 400) => { for (let i = 0; i < tries; i++) { if (await test()) return; await sleep(25); } assert.fail(label); };
  const ready = () => run(() => document.querySelector('.bases-view')?.getAttribute('aria-busy') !== 'true' && !!document.querySelector('.bases-kanban:not([hidden])'));
  const read = path => run(async path => { const { api } = await import('/src/api.ts'); return api.readNote(path); }, path);
  const columns = () => run(() => [...document.querySelectorAll('.bases-kanban-col')].sort((a, b) => a.offsetLeft - b.offsetLeft).map(c => `${c.querySelector('.bases-kanban-label').textContent} ${c.querySelector('.bases-kanban-count').textContent}`));
  const item = title => run(title => { const el = [...document.querySelectorAll('.menu-item')].find(e => e.querySelector('.menu-item-title')?.textContent === title); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, title);
  const choose = async title => { await wait(async () => !!await item(title), `menu item ${title}`); await click(await item(title)); };
  const col = id => `.bases-kanban-col[data-group-id='${id}']`;

  // ----- behaviour -----
  const source = `filters: 'file.inFolder("KB")'\nviews:\n  - type: kanban\n    name: Board\n    order: [file.name, due, priority, tags]\n    groupBy:\n      property: status\n      direction: ASC\n    sort:\n      - property: due\n        direction: ASC\n  - type: kanban\n    name: Ungrouped\n    order: [file.name, due]\n`;
  await run(async source => {
    const { api } = await import('/src/api.ts');
    const status = ['todo', 'doing', 'review', 'done'];
    for (let i = 0; i < 24; i++) await api.createNote(`KB/Task ${String(i).padStart(2, '0')}.md`, i % 8 === 7 ? `# none\n` : `---\nstatus: ${status[i % 4]}\npriority: ${i % 5}\ndue: 2026-11-${String(1 + i).padStart(2, '0')}\ntags: [work, t${i % 3}]\n---\n`);
    await api.createNote('KB.base', source); await ws.vault.refreshFiles(); await ws.open('KB.base');
  }, source);
  await wait(async () => await ready() && (await columns()).length === 5, 'board');
  assert.deepEqual(await columns(), ['doing 6', 'done 3', 'review 6', 'todo 6', 'No value 3'], 'automatic order, No value last');
  assert.equal(await run(() => document.querySelector('.bases-view').getAttribute('aria-label')), 'Base board');
  assert.ok(await run(() => !!document.querySelector('.bases-view-name svg.lucide-square-kanban')), 'kanban icon on the view button');
  // Every card has the arithmetic height: 2 + 16 + 20 + 4 + 3 × 20 = 102 px, placed 110 px apart.
  assert.deepEqual(await run(() => { const cards = [...document.querySelectorAll(`.bases-kanban-col[data-group-id='s:"doing"'] .bases-kanban-card`)]; return [...new Set(cards.map(c => c.offsetHeight))].concat(cards[1].getBoundingClientRect().y - cards[0].getBoundingClientRect().y); }), [102, 110]);
  assert.deepEqual(await run(() => [...document.querySelectorAll(`.bases-kanban-col[data-group-id='s:"doing"'] .bases-kanban-title`)].map(t => t.textContent)), ['Task 01', 'Task 05', 'Task 09', 'Task 13', 'Task 17', 'Task 21'], 'cards follow the view sort');

  // Keyboard: arrows within and across columns, Enter opens.
  await run(() => document.querySelector(`.bases-kanban-col[data-group-id='s:"doing"'] .bases-kanban-card`).focus());
  await press('ArrowDown'); await press('ArrowDown');
  assert.equal(await run(() => document.activeElement.dataset.path), 'KB/Task 09.md');
  await press('ArrowRight');
  assert.equal(await run(() => document.activeElement.closest('.bases-kanban-col').dataset.groupId), 's:"done"', 'Right moves to the next column');
  await press('End');
  assert.equal(await run(() => document.activeElement.dataset.path), 'KB/Task 19.md');
  assert.equal(await run(() => document.querySelectorAll('.bases-kanban-card[tabindex="0"]').length), 1, 'one card in the tab order');
  await press('Enter');
  await wait(() => run(() => ws.active.path === 'KB/Task 19.md'), 'Enter opens the note');
  await run(() => ws.open('KB.base'));
  await wait(async () => await ready() && (await columns()).length === 5, 'board again');
  await click(`${col('s:"review"')} .bases-kanban-card`);
  await wait(() => run(() => ws.active.path === 'KB/Task 02.md'), 'a click opens the note');
  await run(() => ws.open('KB.base'));
  await wait(async () => await ready() && (await columns()).length === 5, 'board after click');
  check(true, 'Kanban columns (No value last), fixed card height, view sort, arrows / End / Enter and click open');

  // The column ⋯ menu writes Manual order; nothing in any note changes.
  await click(`${col('s:"done"')} .bases-kanban-more`); await choose('Move left');
  await wait(async () => (await read('KB.base')).includes('order:'), 'Move left wrote Manual order');
  assert.equal(await read('KB.base'), source.replace('      direction: ASC\n    sort', '      direction: ASC\n      order:\n        - done\n        - doing\n        - review\n        - todo\n        - null\n    sort'));
  await wait(async () => (await columns())[0] === 'done 3', 'done first');
  await click(`${col('s:"review"')} .bases-kanban-more`); await choose('Hide group');
  await wait(async () => !(await columns()).includes('review 6'), 'review hidden');
  assert.equal(await run(() => document.querySelector('.bases-count span').textContent), '18 results', 'hidden cards are not counted');
  await run(async source => { const { api } = await import('/src/api.ts'); await api.writeNote('KB.base', source); ws.vault.written('KB.base'); }, source);
  await wait(async () => (await columns()).length === 5 && (await columns())[0] === 'doing 6', 'reset');
  // + makes a note seeded with the column's value.
  await click(`${col('s:"review"')} .bases-kanban-add`);
  await wait(() => run(() => /^KB\/Untitled/.test(ws.active.path ?? '')), 'new note opened');
  const created = await run(() => ws.active.path);
  await wait(async () => /status: review/.test(await read(created)), 'seeded with status: review');
  await run(() => ws.open('KB.base'));
  await wait(async () => await ready() && (await columns()).includes('review 7'), 'the new note is in review');
  check(true, 'column ⋯: Move left and Hide group write Manual order; + makes a note seeded with the column value');

  // Search narrows cards and keeps every column.
  await click('.bases-search-toggle'); await send('Input.insertText', { text: 't2' });
  await wait(async () => await run(() => document.querySelector('.bases-count span').textContent) === '7 results', 'search narrows');
  assert.deepEqual((await columns()).map(c => c.replace(/ \d+$/, '')), ['doing', 'done', 'review', 'todo', 'No value'], 'every column stays while searching');
  assert.equal((await columns()).reduce((sum, c) => sum + Number(c.match(/\d+$/)[0]), 0), 7);
  await press('Escape');
  await wait(async () => (await columns()).includes('doing 6'), 'search cleared');
  // No groupBy: one column and a prompt that opens the Group menu.
  await click('.bases-view-name'); await choose('Ungrouped');
  await wait(async () => await ready() && (await columns()).join() === 'All results 25', 'ungrouped board');
  assert.ok(await run(() => getComputedStyle(document.querySelector('.bases-kanban-prompt')).display === 'flex'));
  await click('.bases-kanban-prompt button');
  await wait(() => run(() => !!document.querySelector('.bases-group-menu')), 'prompt opens the Group menu');
  await press('Escape');
  // Configure view: Layout Kanban ↔ Table writes only `type`.
  await click('.bases-view-name'); await click(await run(() => { const r = [...document.querySelectorAll('.bases-view-option')].find(o => o.textContent.includes('Ungrouped')).querySelector('.bases-view-options').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  assert.equal(await run(() => document.querySelector('[aria-label="Layout"]').value), 'kanban');
  await run(() => { const s = document.querySelector('[aria-label="Layout"]'); s.value = 'table'; s.dispatchEvent(new Event('change')); });
  await wait(async () => (await read('KB.base')).includes('  - type: table\n    name: Ungrouped'), 'Layout writes type');
  await wait(() => run(() => !!document.querySelector('.bases-table:not([hidden]) tbody tr[data-path]')), 'table drawn');
  assert.equal(await read('KB.base'), source.replace('  - type: kanban\n    name: Ungrouped', '  - type: table\n    name: Ungrouped'));
  await run(() => { const s = document.querySelector('[aria-label="Layout"]'); s.value = 'kanban'; s.dispatchEvent(new Event('change')); });
  await wait(async () => await read('KB.base') === source && await ready(), 'back to kanban');
  await press('Escape');
  check(true, 'Search keeps columns; the ungrouped prompt; Configure view Layout writes only type');

  // ----- P11: a board in a note -----
  const embed = '# Plan\n\n```base\nfilters: \'file.inFolder("KB")\'\nviews:\n  - type: kanban\n    name: Board\n    order: [file.name, due]\n    groupBy:\n      property: status\n```\n\nafter the board\n';
  await run(async embed => { const { api } = await import('/src/api.ts'); await api.createNote('KB Plan.md', embed); await ws.vault.refreshFiles(); }, embed);
  const p11 = await run(async () => {
    const start = performance.now(); void ws.open('KB Plan.md');
    while (!document.querySelector('.bases-embed .bases-kanban-card')) await new Promise(requestAnimationFrame);
    const ms = performance.now() - start;
    const line = () => [...document.querySelectorAll('.cm-line')].find(l => l.textContent === 'after the board')?.getBoundingClientRect().top;
    const first = line(); await new Promise(r => setTimeout(r, 600));
    return { ms, first, later: line(), height: document.querySelector('.bases-embed .bases-kanban').getBoundingClientRect().height };
  });
  assert.ok(p11.ms <= 100, `embedded board in ${p11.ms.toFixed(1)}ms`);
  assert.ok(p11.first !== undefined && p11.first === p11.later, `editor geometry unchanged ${JSON.stringify(p11)}`);
  assert.equal(p11.height, 400, 'the board has the embed height');
  check(true, `P11: embedded board drawn in ${p11.ms.toFixed(1)}ms; the line after it never moved`);

  // ----- P1–P3: 10,000 notes -----
  const n = 10000;
  await run(async n => {
    const { api } = await import('/src/api.ts');
    const status = ['todo', 'doing', 'review', 'done'];
    for (let i = 0; i < n; i++) await api.createNote(`KP/${String(i).padStart(5, '0')}.md`, `---\nstatus: ${status[i % 4]}\nkind: task\nproject: p${String(i % 200).padStart(3, '0')}\npriority: ${i % 5}\ndue: 2026-11-${String(1 + i % 28).padStart(2, '0')}\n---\n`);
    await api.createNote('KP.base', `filters: 'file.inFolder("KP")'\nviews:\n  - type: kanban\n    name: Board\n    order: [file.name, due, priority]\n    groupBy:\n      property: status\n  - type: kanban\n    name: Tall\n    order: [file.name, due, priority]\n    groupBy:\n      property: kind\n  - type: kanban\n    name: Wide\n    order: [file.name, due]\n    groupBy:\n      property: project\n`);
    await ws.vault.refreshFiles();
  }, n);
  const open = () => run(async () => {
    window.k4Long = [];
    const observer = new PerformanceObserver(list => { for (const e of list.getEntries()) k4Long.push(e.duration); }); observer.observe({ type: 'longtask' });
    // The board left before must be gone, so the first card found is this open's.
    const stale = document.querySelectorAll('.bases-kanban-card[data-path^="KP/"]').length;
    const start = performance.now(); void ws.open('KP.base');
    while (!document.querySelector('.bases-kanban-card[data-path^="KP/"]')) await new Promise(requestAnimationFrame);
    const ms = performance.now() - start;
    await new Promise(r => setTimeout(r, 300)); observer.disconnect();
    return { ms: +ms.toFixed(1), long: k4Long.map(Math.round), stale };
  });
  const cold = await open();
  await sleep(500); await run(() => ws.open('KB.base')); await sleep(500);
  const warm = [];
  for (let i = 0; i < 3; i++) { warm.push(await open()); await sleep(300); await run(() => ws.open('KB.base')); await sleep(400); }
  console.log('K4_P1', JSON.stringify({ cold, warm }));
  assert.ok(median(warm.map(w => w.ms)) <= 150 && warm.every(w => !w.stale && !w.long.some(d => d > 50)), `P1 warm open ${JSON.stringify(warm)}`);
  check(true, `P1: warm open of a 10,000-note board in ${median(warm.map(w => w.ms))}ms (cold ${cold.ms}ms), no long task over 50ms`);

  await run(() => ws.open('KP.base'));
  const view = async name => { await click('.bases-view-name'); await choose(name); await wait(async () => await ready() && await run(() => document.querySelector('.bases-view-name span').textContent) === name, name, 1200); await sleep(600); };
  const frames = () => run(() => { window.k4f = { frames: [], cards: 0, columns: 0, far: 0, long: [] }; let last = performance.now(); k4f.obs = new PerformanceObserver(l => { for (const e of l.getEntries()) k4f.long.push(e.duration); }); k4f.obs.observe({ type: 'longtask' }); k4f.raf = requestAnimationFrame(function tick(t) { k4f.frames.push(t - last); last = t; k4f.cards = Math.max(k4f.cards, ...[...document.querySelectorAll('.bases-kanban-col')].map(c => c.querySelectorAll('.bases-kanban-card').length)); k4f.columns = Math.max(k4f.columns, document.querySelectorAll('.bases-kanban-col').length); k4f.far = Math.max(k4f.far, document.querySelector('.bases-kanban').scrollLeft); k4f.raf = requestAnimationFrame(tick); }); });
  const stop = () => run(() => { cancelAnimationFrame(k4f.raf); k4f.obs.disconnect(); return { ...k4f, frames: k4f.frames.slice(2) }; });
  const summary = r => ({ far: Math.round(r.far), count: r.frames.length, median: +median(r.frames).toFixed(1), p95: +p95(r.frames).toFixed(1), max: +Math.max(...r.frames).toFixed(1), cards: r.cards, columns: r.columns, long: r.long.map(Math.round) });

  // Wheel deltas of 5,000 px, as test-bases-groups.mjs uses: headless Chromium animates a small
  // delta (100–600 px) as a smooth scroll at 30 fps, which drops the same frames for the
  // 10,000-row table as for the board (NOTES_K4), so it measures the harness, not the page.
  // P2: one 10,000-card column, wheel-scrolled for 3 s.
  await view('Tall');
  assert.deepEqual(await columns(), ['task 10,000']);
  const body = await point('.bases-kanban-body'); await move(body);
  await frames();
  for (let t = 0; t < 120; t++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...body, deltaX: 0, deltaY: t % 80 < 60 ? 5000 : -5000 }); await sleep(25); }
  const tall = summary(await stop());
  console.log('K4_P2', JSON.stringify(tall));
  assert.ok(tall.p95 <= 20 && tall.max <= 25 && tall.cards <= 40 && !tall.long.length, `P2 ${JSON.stringify(tall)}`);
  assert.ok(await run(() => document.querySelector('.bases-kanban-body').scrollTop > 100_000), 'scrolled deep into the column');
  check(true, `P2: a 10,000-card column scrolls at p95 ${tall.p95}ms (max ${tall.max}ms) with at most ${tall.cards} cards in the DOM`);

  // P3: 200 columns, scrolled sideways for 3 s.
  await view('Wide');
  assert.equal((await columns()).length <= 8, true, 'only the columns in view are mounted');
  const board = await point('.bases-kanban'); await move(board);
  await frames();
  for (let t = 0; t < 120; t++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...board, deltaX: t % 20 < 10 ? 5000 : -5000, deltaY: 0 }); await sleep(25); }
  const wide = summary(await stop());
  const visible = await run(() => Math.ceil(document.querySelector('.bases-kanban').clientWidth / (272 + 12)) + 1);
  console.log('K4_P3', JSON.stringify({ ...wide, visible }));
  assert.ok(wide.p95 <= 20 && wide.max <= 25 && wide.columns <= visible + 2 && !wide.long.length, `P3 ${JSON.stringify({ ...wide, visible })}`);
  assert.ok(wide.far > 40_000, `scrolled far across the board (${wide.far}px)`);
  check(true, `P3: 200 columns scroll sideways at p95 ${wide.p95}ms (max ${wide.max}ms) with at most ${wide.columns} columns mounted`);
}, { height: 900 });
