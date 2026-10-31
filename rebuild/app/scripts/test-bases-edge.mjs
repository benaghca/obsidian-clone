// Bases edge cases exercised in the scratch vault with real pointer and key
// input. Covers what the unit tests cannot: a column rename stays in that
// base, search commits a pending cell and flushes a pending note save, a
// file named ".md" is not a note row, an embed's host or .base can be
// deleted, and a 10,000-row table scrolls and sorts inside the existing ceilings.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const NOTES = {
  'Edge/Alpha.md': '---\nstatus: open\npoints: 1\nlabel: plain\n---\n',
  'Edge/Beta.md': '---\nstatus: done\npoints: 10\nlabel: secret\n---\n',
  'Edge/Empty.md': '---\npoints: 8\nlabel: blank\n---\n',
  'Edge/Emoji.md': '---\nstatus: 🎉\npoints: 5\nlabel: Naïve\n---\n',
  'Edge/Low.md': '---\nstatus: open\npoints: 3\nlabel: low\n---\n',
  'Edge/OpenCase.md': '---\nstatus: Open\npoints: 2\nlabel: Title\n---\n',
  'Edge/Quote.md': '---\nstatus: open\npoints: 4\nlabel: "he said \\"hi\\",\\r\\nthen 🎉"\n---\n',
  'Edge/Zero.md': '---\nstatus: open\npoints: 0\nlabel: zero\n---\n',
};
const BASE = `filters: 'file.inFolder("Edge")'
formulas:
  boom: '1 / points'
  bad: 'note.points.lower()'
views:
  - type: table
    name: Table
    order: [file.name, status, points, label, formula.boom, formula.bad]
    summaries:
      points: Sum
      formula.boom: Sum
  - type: table
    name: Grouped
    order: [file.name, status]
    groupBy:
      property: status
      direction: ASC
    summaries:
      file.name: Count
  - type: table
    name: Filtered
    filters: 'status == "open"'
    order: [file.name, status, points, label, formula.boom]
    summaries:
      points: Sum
      formula.boom: Sum
`;
const OTHER = `filters: 'file.inFolder("Edge")'
views:
  - type: table
    name: Other
    order: [file.name, status]
`;

await withBrowser(async ({ run, send, click, press, fill, check }) => {
  const wait = async (test, label, tries = 200) => { for (let i = 0; i < tries; i++) { if (await test()) return; await sleep(20); } assert.fail(label); };
  const source = path => run(async p => { const { api } = await import('/src/api.ts'); return api.readNote(p); }, path);
  const ready = () => run(() => document.querySelector('.bases-view')?.getAttribute('aria-busy') === 'false' && !!document.querySelector('.bases-count span')?.textContent);
  const count = () => run(() => document.querySelector('.bases-count span')?.textContent);
  const cell = (path, key) => run((path, key) => document.querySelector(`tr[data-path="${path}"] td[data-property="${key}"]`)?.dataset.value ?? null, path, key);
  const menuItem = title => run(title => {
    const el = [...document.querySelectorAll('.menu-item')].find(el => el.querySelector('.menu-item-title')?.textContent === title);
    if (!el) throw Error('No menu item ' + title);
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, title);
  const view = async name => {
    await click('.bases-view-name');
    await click(await menuItem(name));
    await wait(async () => await run(() => document.querySelector('.bases-view-name span')?.textContent) === name && await run(() => document.querySelector('.bases-view')?.getAttribute('aria-busy') === 'false'), `view ${name}`);
  };
  const type = async text => {
    for (const ch of text) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, windowsVirtualKeyCode: ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0) });
    }
  };
  const search = async text => {
    if (await run(() => document.querySelector('.bases-search-input')?.hidden !== false)) await click('.bases-search-toggle');
    await wait(() => run(() => document.activeElement?.matches('.bases-search-input')), 'search focused');
    await type(text);
  };
  const clearSearch = async () => {
    // Escape closes the box only while it is focused. Exporting moves focus to the menu.
    if (await run(() => document.querySelector('.bases-search-input')?.hidden !== false)) return;
    await click('.bases-search-input');
    await press('Escape');
    await wait(() => run(() => document.querySelector('.bases-search-input')?.hidden !== false), 'search closed');
  };

  await run(async (notes, base, other) => {
    const { api } = await import('/src/api.ts');
    for (const [path, text] of Object.entries({ ...notes, 'Edge.base': base, 'EdgeOther.base': other })) await api.createNote(path, text);
    await ws.vault.refreshFiles();
    await ws.open('Edge.base');
  }, NOTES, BASE, OTHER);
  await wait(ready, 'edge base ready');
  assert.equal(await count(), '8 results');
  assert.equal(await cell('Edge/Zero.md', 'formula.boom'), '#ERROR: Division by zero');
  assert.equal(await cell('Edge/Alpha.md', 'formula.boom'), '1');
  assert.equal(await cell('Edge/Alpha.md', 'formula.bad'), '#ERROR: Expected text');
  assert.equal(await cell('Edge/Emoji.md', 'status'), '🎉');
  assert.equal(await cell('Edge/Quote.md', 'label'), 'he said "hi",\r\nthen 🎉');
  assert.equal(await cell('Edge/OpenCase.md', 'status'), 'Open');
  assert.equal(await cell('Edge/Low.md', 'status'), 'open');
  check(true, 'divide by zero, a number used as text, emoji and a quoted newline render in the table');

  // Filtered view, then a search on top of that filter. Summaries and CSV follow the search.
  await view('Filtered');
  await wait(async () => await count() === '4 results', 'filtered to status open');
  assert.equal(await run(() => document.querySelector('tfoot [data-property="points"]')?.dataset.value), '8');
  assert.equal(await run(() => document.querySelector('tfoot [data-property="formula.boom"]')?.dataset.value), '#ERROR!');
  await run(() => {
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { if (String(blob.type).startsWith('text/csv')) window.__csvBlob = blob; return orig(blob); };
    document.addEventListener('click', e => {
      const a = e.target instanceof Element && e.target.closest('a[download]');
      if (!a) return;
      e.preventDefault();
      window.__csvName = a.download;
    }, true);
  });
  await search('plain');
  await wait(async () => await ready() && await count() === '1 results' && await run(() => document.querySelector('tfoot [data-property="points"]')?.dataset.value) === '1', 'search plain');
  assert.equal(await run(() => document.querySelector('tfoot [data-property="formula.boom"]')?.dataset.value), '1', 'the formula sum drops the divide-by-zero row the search hid');
  await click('.bases-count');
  await click(await menuItem('Export CSV...'));
  assert.deepEqual(await run(async () => ({ name: window.__csvName, text: await window.__csvBlob.text() })), {
    name: 'Filtered.csv',
    text: 'file name,status,points,label,boom\nAlpha,open,1,plain,1',
  });
  await clearSearch();
  await search('hi');
  await wait(async () => await count() === '1 results' && await cell('Edge/Quote.md', 'file.name') === 'Quote', 'search hi');
  await click('.bases-count');
  await click(await menuItem('Export CSV...'));
  assert.equal(await run(async () => window.__csvBlob.text()), 'file name,status,points,label,boom\nQuote,open,4,"he said ""hi"",\r\nthen 🎉",0.25');
  assert.equal(await source('Edge.base'), BASE, 'searching and exporting write nothing');
  check(true, 'summaries and CSV follow the search on a filtered view, including quotes, CR/LF and emoji');

  await clearSearch();
  await view('Grouped');
  const headings = () => run(() => [...document.querySelectorAll('.bases-b5-toggle')].map(b => b.getAttribute('aria-label')).sort());
  await wait(async () => (await headings()).includes('Empty (1)'), 'groups drawn');
  assert.deepEqual(await headings(), ['🎉 (1)', 'done (1)', 'Empty (1)', 'open (4)', 'Open (1)'].sort());
  check(true, 'empty, missing, emoji and case-only statuses are separate groups, with one empty group');

  // Renaming a column changes its display name in this base only.
  await view('Table');
  const beta = await source('Edge/Beta.md');
  const otherBefore = await source('EdgeOther.base');
  await click('th[data-property="status"]', 'right');
  await click(await menuItem('Edit property...'));
  await type('State');
  await press('Enter');
  const named = BASE.replace('views:', 'properties:\n  note.status:\n    displayName: State\nviews:');
  await wait(async () => await source('Edge.base') === named, 'display name written');
  await wait(() => run(() => document.querySelector('th[data-property="status"] span')?.textContent === 'State'), 'header renamed');
  assert.equal(await cell('Edge/Beta.md', 'status'), 'done');
  assert.equal(await source('Edge/Beta.md'), beta, 'the note key is still status');
  await run(() => ws.open('EdgeOther.base'));
  await wait(async () => await count() === '8 results', 'other base');
  assert.equal(await run(() => document.querySelector('th[data-property="status"] span')?.textContent), 'status');
  assert.equal(await source('EdgeOther.base'), otherBefore);
  await run(() => ws.open('Edge.base'));
  await wait(() => run(() => document.querySelector('th[data-property="status"] span')?.textContent === 'State'), 'renamed base restored');
  await click('th[data-property="formula.boom"]', 'right');
  await click(await menuItem('Edit property...'));
  await type('Broken');
  await press('Enter');
  await wait(() => run(() => document.querySelector('th[data-property="formula.boom"] span')?.textContent === 'Broken'), 'formula header renamed');
  assert.equal(await source('Edge/Beta.md'), beta);
  assert.equal(await source('EdgeOther.base'), otherBefore);
  assert.match(await source('Edge.base'), /formula\.boom:\n    displayName: Broken/);
  check(true, 'a column rename is a display name in that base only');

  // A pending cell edit is committed when search takes focus, so the search sees it.
  await clearSearch();
  await fill('tr[data-path="Edge/Alpha.md"] td[data-property="status"] [data-part="value"]', 'zedword');
  assert.equal(await source('Edge/Alpha.md'), NOTES['Edge/Alpha.md'], 'the cell edit is still pending');
  await search('zedword');
  await wait(async () => (await source('Edge/Alpha.md')).includes('status: zedword') && await count() === '1 results', 'search saved the cell then matched it');
  assert.equal(await cell('Edge/Alpha.md', 'status'), 'zedword');
  assert.doesNotMatch(await source('Edge.base'), /zedword/);
  check(true, 'bases search commits the pending cell edit before matching');

  // Vault search flushes a note save before it queries.
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Edge/Pending.md', '# Pending\n');
    await ws.vault.refreshFiles();
    await ws.open('Edge/Pending.md');
    ws.setMode('source');
    window.edgeOrder = [];
    const write = api.writeNote, searchNotes = api.searchNotes, flush = ws.editors.flush.bind(ws.editors);
    api.writeNote = (path, text) => { edgeOrder.push(['write', path]); return write(path, text); };
    api.searchNotes = (query, matchCase) => { edgeOrder.push(['search', query]); return searchNotes(query, matchCase); };
    ws.editors.flush = (...args) => { edgeOrder.push(['flush']); return flush(...args); };
    const view = ws.view;
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\nEDGEPENDINGTOKEN\n' }, userEvent: 'input' });
  });
  await run(() => grove.run('global-search:open'));
  await fill('.search-view .search-input', 'EDGEPENDINGTOKEN');
  await wait(() => run(() => [...document.querySelectorAll('.search-result-file-name')].some(el => el.textContent === 'Pending')), 'pending note is found', 300);
  const order = await run(() => edgeOrder);
  const flushAt = order.findIndex(step => step[0] === 'flush');
  const searchAt = order.findIndex(step => step[0] === 'search');
  const writeAt = order.findIndex(step => step[0] === 'write' && step[1] === 'Edge/Pending.md');
  assert.ok(flushAt >= 0 && searchAt > flushAt, `flush runs before the query: ${JSON.stringify(order)}`);
  assert.ok(writeAt >= 0 && writeAt < searchAt, `the pending save lands before the query: ${JSON.stringify(order)}`);
  assert.match(await source('Edge/Pending.md'), /EDGEPENDINGTOKEN/);
  check(true, 'vault search saves the pending edit before it queries');

  // A file whose name is only ".md" is on disk and is not a note.
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('.md', '---\nstatus: ghost\n---\n# ghost\n');
    await api.createNote('Edge/.md', '---\nstatus: ghost\n---\n');
    await api.createNote('Edge/.MD', '---\nstatus: ghost\n---\n');
    await ws.vault.refreshFiles();
    await ws.open('Edge.base');
  });
  // Reopening builds a fresh view, so the earlier "zedword" query is gone. Escape anyway, so a leftover box cannot hide the new rows.
  await clearSearch();
  await wait(async () => await ready() && await count() === '9 results', 'base recounts after the dot files', 400);
  const paths = await run(() => ({
    rows: [...document.querySelectorAll('.bases-table tbody tr[data-path]')].map(tr => tr.dataset.path),
    notes: ws.vault.notes.map(n => n.path),
    files: ws.vault.files.map(f => f.path),
  }));
  for (const ghost of ['.md', 'Edge/.md', 'Edge/.MD']) {
    assert.equal(paths.rows.includes(ghost), false, `${ghost} is not a base row`);
    assert.equal(paths.notes.includes(ghost), false, `${ghost} is not a note`);
    assert.equal(paths.files.includes(ghost), true, `${ghost} is still a file`);
  }
  assert.ok(paths.rows.includes('Edge/Pending.md'));
  // Search had replaced the file list. The explorer shows ".md" as a file, with a tag, which notes do not get.
  await run(() => grove.run('file-explorer:open'));
  await wait(() => run(() => document.querySelector('.tree-item-self[data-path=".md"] .nav-file-tag')?.textContent === 'md'), 'explorer lists .md as a file');
  check(true, 'a file named .md is kept as a file and is not a note or a base row');

  // Deleting the note that holds an embed releases it. Deleting the .base file leaves the note up.
  const host = '# Host\n\n```base\nfilters: \'file.inFolder("Edge")\'\nviews:\n  - type: table\n    name: Inside\n    order: [file.name]\n```\n';
  const stay = '# Stay\n\n![[EdgeFile.base]]\n';
  const edgeFile = 'filters: \'file.inFolder("Edge")\'\nviews:\n  - type: table\n    name: File\n    order: [file.name]\n';
  await run(async (host, stay, edgeFile) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('EdgeHost.md', host);
    await api.createNote('EdgeStay.md', stay);
    await api.createNote('EdgeFile.base', edgeFile);
    await ws.vault.refreshFiles();
    await ws.open('EdgeHost.md');
    ws.setMode('live');
  }, host, stay, edgeFile);
  await wait(() => run(() => document.querySelectorAll('.bases-embed tbody tr[data-path]').length >= 8), 'host embed rows', 400);
  await run(async () => { const { deleteFile } = await import('/src/fileOps.ts'); await deleteFile(ws, 'EdgeHost.md', { confirmed: true }); });
  await wait(() => run(() => ws.active.path !== 'EdgeHost.md' && !document.querySelector('.bases-embed')), 'deleted host drops the embed');
  assert.equal(await run(async () => { const { api } = await import('/src/api.ts'); return api.listFiles(); }).then(files => files.some(f => f.path === 'EdgeHost.md')), false);
  await run(() => { ws.open('EdgeStay.md'); ws.setMode('live'); });
  await wait(() => run(() => document.querySelectorAll('.bases-embed tbody tr[data-path]').length >= 8), 'file embed rows', 400);
  await run(async () => { const { deleteFile } = await import('/src/fileOps.ts'); await deleteFile(ws, 'EdgeFile.base', { confirmed: true }); });
  await wait(() => run(() => ws.active.path === 'EdgeStay.md' && [...document.querySelectorAll('.internal-embed')].some(el => el.classList.contains('mod-empty') && el.textContent?.includes('EdgeFile.base') && el.textContent.includes('could not be found'))), 'deleted .base leaves the note and shows the file is missing', 400);
  assert.equal(await source('EdgeStay.md'), stay);
  assert.equal(await run(async () => { const { api } = await import('/src/api.ts'); return (await api.listFiles()).some(f => f.path === 'EdgeFile.base'); }), false);
  check(true, 'deleting the host note releases its embed; deleting the .base file leaves the note and shows the link is missing');

  // 10,000-row table: scroll frames stay inside the existing 10k ceiling, and the sort work stays under 50ms.
  const n = 10000;
  await run(async n => {
    const { api } = await import('/src/api.ts');
    // Rank is not the file name: 00001 is 9999, 00000 is 0. Name order and rank order then disagree.
    for (let i = 0; i < n; i++) await api.createNote(`Edge10/${String(i).padStart(5, '0')}.md`, `---\nrank: ${i === 0 ? 0 : n - i}\n---\n`);
    await api.createNote('Edge10.base', 'filters: \'file.inFolder("Edge10")\'\nviews:\n  - type: table\n    name: Ten\n    order:\n      - file.name\n      - rank\n');
    await ws.vault.refreshFiles();
    await ws.open('Edge10.base');
  }, n);
  await wait(() => run(() => document.querySelector('.bases-count span')?.textContent === '10000 results'), '10000 results', 800);
  await sleep(400);
  assert.ok(await run(() => document.querySelectorAll('.bases-table tbody tr[data-path]').length < 80), '10k table mounts only the visible rows');
  await run(() => {
    const view = document.querySelector('.bases-view');
    let current = view.reconcile.lastMs, max = 0;
    Object.defineProperty(view.reconcile, 'lastMs', { configurable: true, get: () => current, set: value => { current = value; if (value > max) max = value; } });
    window.edgeSort = { get max() { return max; }, long: [] };
    window.edgeSortObs = new PerformanceObserver(list => { for (const entry of list.getEntries()) edgeSort.long.push(entry.duration); });
    edgeSortObs.observe({ type: 'longtask' });
  });
  await click('th[data-property="rank"]', 'right');
  await click(await menuItem('Sort Z → A'));
  await wait(() => run(() => document.querySelector('.bases-table tbody tr[data-path]')?.dataset.path === 'Edge10/00001.md'), 'sorted by rank descending', 400);
  assert.equal(await cell('Edge10/00001.md', 'rank'), '9999');
  const sort = await run(() => { edgeSortObs.disconnect(); return { max: edgeSort.max, long: edgeSort.long.map(ms => Math.round(ms)) }; });
  console.log('EDGE_SORT', JSON.stringify(sort));
  assert.ok(sort.max > 0 && sort.max <= 50, `10k sort work ${sort.max.toFixed(1)}ms`);
  assert.ok(!sort.long.some(ms => ms > 50), `10k sort long tasks ${sort.long}`);
  check(true, `10,000-row sort work ${sort.max.toFixed(1)}ms`);

  const wheel = await run(() => { const r = document.querySelector('.bases-scroll').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 200 }; });
  await run(() => {
    window.edgeScroll = { frames: [], long: [], rows: 0 };
    let last = performance.now();
    edgeScroll.obs = new PerformanceObserver(list => { for (const entry of list.getEntries()) edgeScroll.long.push(entry.duration); });
    edgeScroll.obs.observe({ type: 'longtask' });
    edgeScroll.raf = requestAnimationFrame(function tick(now) {
      edgeScroll.frames.push(now - last); last = now;
      edgeScroll.rows = Math.max(edgeScroll.rows, document.querySelectorAll('.bases-table tbody tr[data-path]').length);
      edgeScroll.raf = requestAnimationFrame(tick);
    });
  });
  for (let i = 0; i < 40; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheel, deltaX: 0, deltaY: 4000 });
    await sleep(25);
  }
  const scroll = await run(() => {
    cancelAnimationFrame(edgeScroll.raf); edgeScroll.obs.disconnect();
    const frames = edgeScroll.frames.slice(2);
    const deep = [...document.querySelectorAll('.bases-table tbody tr[data-path]')].some(tr => Number(tr.dataset.path.match(/(\d+)\.md$/)?.[1]) > 100);
    return { frames, rows: edgeScroll.rows, long: edgeScroll.long.map(ms => Math.round(ms)), top: document.querySelector('.bases-scroll').scrollTop, deep };
  });
  const max = Math.max(...scroll.frames);
  const p95 = scroll.frames.slice().sort((a, b) => a - b)[Math.min(scroll.frames.length - 1, Math.floor(scroll.frames.length * 0.95))];
  console.log('EDGE_SCROLL', JSON.stringify({ max: +max.toFixed(1), p95: +p95.toFixed(1), rows: scroll.rows, top: Math.round(scroll.top), long: scroll.long }));
  assert.ok(scroll.top > 1000 && scroll.deep, `scrolled into later rows (${scroll.top})`);
  assert.ok(scroll.rows < 80, `DOM rows ${scroll.rows}`);
  assert.ok(p95 <= 20 && max <= 25, `10k scroll p95 ${p95.toFixed(1)} max ${max.toFixed(1)}`);
  assert.ok(!scroll.long.some(ms => ms > 50), `10k scroll long tasks ${scroll.long}`);
  check(true, `10,000-row scroll p95 ${p95.toFixed(1)}ms max ${max.toFixed(1)}ms, ${scroll.rows} rows mounted`);
  console.log('PASS bases edge cases');
});
