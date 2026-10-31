// K8 (KANBAN_PLAN §2.3): list layout — bullets or numbers, the note name plus inline
// properties, group headings that collapse with K3's state, opening a note from a row.
// Then an ungrouped list at 1,000 notes (warm open, scroll) and 10,000 notes.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const p95 = values => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];

await withBrowser(async ({ run, click, point, move, send, press, key, check }) => {
  const wait = async (test, label, tries = 400) => { for (let i = 0; i < tries; i++) { if (await test()) return; await sleep(25); } assert.fail(label); };
  const ready = () => run(() => document.querySelector('.bases-view')?.getAttribute('aria-busy') !== 'true');
  const read = path => run(async path => { const { api } = await import('/src/api.ts'); return api.readNote(path); }, path);
  const item = title => run(title => { const el = [...document.querySelectorAll('.menu-item')].find(e => e.querySelector('.menu-item-title')?.textContent === title); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, title);
  const choose = async title => { await wait(async () => !!await item(title), `menu item ${title}`); await click(await item(title)); };
  const view = async name => { await click('.bases-view-name'); await choose(name); await wait(async () => await ready() && await run(() => document.querySelector('.bases-view-name span')?.textContent) === name, name); };
  const rows = () => run(() => [...document.querySelectorAll('.bases-list-item')].map(el => el.dataset.path));
  const heading = id => run(id => { const el = document.querySelector(`.bases-b5-toggle[data-group-id='${id}']`); return el && { expanded: el.getAttribute('aria-expanded'), label: el.getAttribute('aria-label'), count: el.querySelector('.bases-b5-count')?.textContent, height: el.offsetHeight, chevron: el.querySelector('svg')?.className?.baseVal ?? '' }; }, id);

  const source = `filters: 'file.inFolder("List")'\nviews:\n  - type: list\n    name: Bullets\n    markers: bullets\n    order:\n      - file.name\n      - status\n      - due\n      - priority\n      - flag\n  - type: list\n    name: Numbers\n    markers: numbers\n    order:\n      - file.name\n      - status\n      - due\n  - type: list\n    name: Grouped\n    markers: numbers\n    order:\n      - file.name\n      - status\n      - due\n    groupBy:\n      property: status\n      direction: ASC\n  - type: table\n    name: Table\n    markers: rainbow\n    indentProperties: true\n    order:\n      - file.name\n      - status\n    groupBy:\n      property: status\n      direction: ASC\n  - type: list\n    name: Odd\n    markers: rainbow\n    indentProperties: true\n    order:\n      - file.name\n`;
  await run(async source => {
    const { api } = await import('/src/api.ts');
    const notes = {
      A: 'status: todo\ndue: 2026-01-01\n',
      B: 'status: doing\ndue: 2026-02-02\n',
      C: 'status: doing\ndue: 2026-03-03\n',
      D: 'status: review\ndue: 2026-04-04\n',
      E: 'status: todo\ndue: 2026-05-05\npriority: 0\nflag: false\n',
    };
    for (const [name, body] of Object.entries(notes)) await api.createNote(`List/${name}.md`, `---\n${body}---\n`);
    await api.createNote('List.base', source);
    await ws.vault.refreshFiles();
    await ws.open('List.base');
    window.k8Writes = 0;
    const write = api.writeNote;
    api.writeNote = (...args) => { if (args[0] === 'List.base') k8Writes++; return write(...args); };
  }, source);
  await wait(async () => await ready() && (await rows()).length === 5, 'bulleted list');

  const bullets = await run(() => {
    const root = document.querySelector('.bases-list');
    const item = document.querySelector('.bases-list-item[data-path="List/A.md"]');
    const odd = document.querySelector('.bases-list-item[data-path="List/E.md"]');
    const style = item ? getComputedStyle(item) : null;
    return {
      label: document.querySelector('.bases-view')?.getAttribute('aria-label'),
      icon: !!document.querySelector('.bases-view-name svg.lucide-list'),
      markers: root?.dataset.markers,
      count: root?.getAttribute('aria-rowcount'),
      height: root?.getBoundingClientRect().height,
      paths: [...document.querySelectorAll('.bases-list-item')].map(el => el.dataset.path),
      marks: [...document.querySelectorAll('.bases-list-marker')].map(el => el.textContent),
      rowHeight: item?.offsetHeight,
      margin: style ? [style.marginTop, style.marginBottom] : null,
      name: item?.querySelector('.bases-list-name')?.textContent,
      href: item?.querySelector('a.bases-list-name')?.getAttribute('href'),
      seps: [...(item?.querySelectorAll('.bases-list-sep') ?? [])].map(el => el.textContent),
      props: [...(item?.querySelectorAll('.bases-list-prop') ?? [])].map(el => `${el.dataset.property}=${el.dataset.value}`),
      odd: [...(odd?.querySelectorAll('.bases-list-prop') ?? [])].map(el => `${el.dataset.property}=${el.dataset.value}`),
      tableHidden: document.querySelector('.bases-table')?.hidden,
      listed: !root?.hidden,
    };
  });
  assert.equal(bullets.label, 'Base list');
  assert.equal(bullets.icon, true, 'list icon on the view button');
  assert.equal(bullets.markers, 'bullets');
  assert.equal(bullets.count, '5');
  assert.ok(bullets.height > 100, `list has a height (${bullets.height})`);
  assert.deepEqual(bullets.paths, ['List/A.md', 'List/B.md', 'List/C.md', 'List/D.md', 'List/E.md']);
  assert.deepEqual(bullets.marks, ['•', '•', '•', '•', '•']);
  assert.equal(bullets.rowHeight, 28);
  assert.deepEqual(bullets.margin, ['0px', '0px']);
  assert.equal(bullets.name, 'A');
  assert.equal(bullets.href, 'List/A.md');
  assert.deepEqual(bullets.seps, [', ', ', ']);
  assert.deepEqual(bullets.props, ['status=todo', 'due=2026-01-01']);
  assert.deepEqual(bullets.odd, ['status=todo', 'due=2026-05-05', 'priority=0', 'flag=false']);
  assert.equal(bullets.tableHidden, true);
  assert.equal(bullets.listed, true);
  check(true, 'Bullets: note name, inline properties (0 and false kept, empties skipped), 28px rows');

  await view('Numbers');
  await wait(async () => (await run(() => document.querySelector('.bases-list-marker')?.textContent)) === '1.', 'numbers');
  assert.deepEqual(await run(() => [...document.querySelectorAll('.bases-list-marker')].map(el => el.textContent)), ['1.', '2.', '3.', '4.', '5.']);
  assert.deepEqual(await run(() => [...document.querySelectorAll('.bases-list-item')].map(el => el.getAttribute('aria-posinset'))), ['1', '2', '3', '4', '5']);
  await click('.bases-list-item[data-path="List/C.md"]');
  await wait(() => run(() => ws.active.path === 'List/C.md'), 'a click opens the note');
  await run(() => ws.open('List.base'));
  await wait(async () => await ready() && await run(() => document.querySelector('.bases-view-name span')?.textContent) === 'Numbers' && (await rows()).includes('List/C.md'), 'list restored in the same tab');
  check(true, 'Numbers 1–5 follow the file name; a row click opens the note and the list comes back');

  await view('Grouped');
  await wait(async () => await ready() && await run(() => document.querySelectorAll('.bases-list > .bases-b5-toggle').length) === 3, 'grouped headings');
  assert.deepEqual(await run(() => [...document.querySelectorAll('.bases-b5-toggle')].map(b => b.getAttribute('aria-label'))), ['doing (2)', 'review (1)', 'todo (2)']);
  assert.equal((await heading('s:"doing"')).height, 32);
  // Numbering starts again in each group: doing is B, C; review is D; todo is A, E.
  assert.deepEqual(await run(() => [...document.querySelectorAll('.bases-list-item')].map(el => `${el.querySelector('.bases-list-marker').textContent} ${el.dataset.path}`)), ['1. List/B.md', '2. List/C.md', '1. List/D.md', '1. List/A.md', '2. List/E.md']);
  const writes = await run(() => k8Writes), before = await read('List.base');
  await click(`.bases-b5-toggle[data-group-id='s:"doing"']`);
  await wait(async () => !(await rows()).includes('List/B.md') && (await heading('s:"doing"')).expanded === 'false', 'doing collapsed');
  const shut = await heading('s:"doing"');
  assert.equal(shut.label, 'doing (2)');
  assert.equal(shut.count, '2');
  assert.match(shut.chevron, /chevron-right/);
  assert.equal(await run(() => document.querySelector('.bases-count span')?.textContent), '5 results', 'collapsing does not change the count');
  await view('Table');
  await wait(() => run(() => !!document.querySelector('.bases-table:not([hidden]) tbody tr[data-path]') && !document.querySelector('.bases-notice:not([hidden])')?.textContent), 'table, and a table ignores list-only keys');
  await view('Grouped');
  await wait(async () => (await heading('s:"doing"')).expanded === 'false', 'collapse kept across a view switch');
  await run(() => ws.open('List/A.md'));
  await sleep(200);
  await run(() => ws.open('List.base'));
  await wait(async () => await ready() && await run(() => document.querySelector('.bases-view-name span')?.textContent) === 'Grouped' && (await heading('s:"doing"')).expanded === 'false', 'collapse kept when the tab returns');
  assert.equal(await run(() => !!document.querySelector('.bases-list-item[data-path="List/B.md"]')), false);
  await click(`.bases-b5-toggle[data-group-id='s:"review"']`);
  await key('Alt', 9); await key('Shift', 9); await press('ArrowUp', 9); await key('Shift', 1, 'keyUp'); await key('Alt', 0, 'keyUp');
  assert.deepEqual(await run(() => [...document.querySelectorAll('.bases-b5-toggle')].map(b => b.getAttribute('aria-expanded'))), ['false', 'false', 'false'], 'Alt+Shift+Up collapses all');
  assert.equal(await run(() => document.querySelectorAll('.bases-list-item').length), 0);
  await key('Alt', 9); await key('Shift', 9); await press('ArrowDown', 9); await key('Shift', 1, 'keyUp'); await key('Alt', 0, 'keyUp');
  assert.deepEqual(await run(() => [...document.querySelectorAll('.bases-b5-toggle')].map(b => b.getAttribute('aria-expanded'))), ['true', 'true', 'true'], 'Alt+Shift+Down expands all');
  await wait(async () => (await rows()).length === 5, 'rows return');
  await sleep(100);
  assert.equal(await read('List.base'), before);
  assert.equal(await run(() => k8Writes), writes, 'collapsing never writes the base');
  check(true, 'Grouped numbers restart per group; collapse stays for the tab and is not written');

  await view('Odd');
  await wait(() => run(() => (document.querySelector('.bases-notice')?.textContent ?? '').includes("isn't supported yet")), 'indent notice');
  const odd = await run(() => ({ notice: document.querySelector('.bases-notice')?.textContent, mark: document.querySelector('.bases-list-marker')?.textContent, markers: document.querySelector('.bases-list')?.dataset.markers }));
  assert.match(odd.notice, /Unsupported list markers: rainbow/);
  assert.match(odd.notice, /Indent properties isn't supported yet/);
  assert.equal(odd.mark, '•');
  assert.equal(odd.markers, 'bullets');
  check(true, 'Unknown markers fall back to bullets; indent properties is named and not drawn');

  await view('Bullets');
  await click('.bases-view-name');
  await click(await run(() => { const r = [...document.querySelectorAll('.bases-view-option')].find(o => o.textContent.includes('Bullets')).querySelector('.bases-view-options').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  assert.deepEqual(await run(() => [...document.querySelectorAll('[aria-label="Layout"] option')].map(o => o.value)), ['table', 'cards', 'list', 'kanban']);
  assert.equal(await run(() => document.querySelector('[aria-label="Layout"]').value), 'list');
  assert.equal(await run(() => document.querySelector('[aria-label="Markers"]').value), 'bullets');
  assert.equal(await run(() => document.querySelector('[aria-label="Markers"]').closest('label').hidden), false);
  await run(() => { const s = document.querySelector('[aria-label="Markers"]'); s.value = 'none'; s.dispatchEvent(new Event('change')); });
  await wait(async () => (await read('List.base')).includes('markers: none'), 'markers written');
  await wait(() => run(() => document.querySelector('.bases-list')?.dataset.markers === 'none' && !document.querySelector('.bases-list-marker')), 'none draws no marker');
  await run(() => { const s = document.querySelector('[aria-label="Markers"]'); s.value = 'numbers'; s.dispatchEvent(new Event('change')); });
  await wait(async () => (await read('List.base')).includes('markers: numbers') && await run(() => document.querySelector('.bases-list-marker')?.textContent === '1.'), 'numbers from Configure view');
  const markersHidden = await run(() => { const s = document.querySelector('[aria-label="Layout"]'); s.value = 'table'; s.dispatchEvent(new Event('change')); return document.querySelector('[aria-label="Markers"]').closest('label').hidden; });
  assert.equal(markersHidden, true, 'markers hidden as soon as the layout is not a list');
  await wait(async () => (await read('List.base')).includes('  - type: table\n    name: Bullets'), 'Layout writes type');
  await press('Escape');
  check(true, 'Configure view: List is a layout, Markers writes bullets / numbers / none');

  // 1,000 notes. The property index is warm before the timed open, as test-bases.mjs does.
  await run(async () => {
    const { api } = await import('/src/api.ts');
    for (let i = 0; i < 1000; i++) await api.createNote(`L8/${String(i).padStart(4, '0')}.md`, `---\nrank: ${i}\n---\n`);
    await api.createNote('L8.base', 'filters: \'file.inFolder("L8")\'\nviews:\n  - type: list\n    name: List\n    markers: numbers\n    order:\n      - file.name\n      - rank\n');
    await ws.vault.refreshFiles();
    const { propertyIndex } = await import('/src/shell/propertyIndex.ts');
    await propertyIndex(ws).notes();
  });
  const opening = await run(async () => {
    const begin = performance.now();
    void ws.open('L8.base');
    while (!document.querySelector('.bases-list-item[data-path^="L8/"]')) await new Promise(requestAnimationFrame);
    return performance.now() - begin;
  });
  await wait(() => run(() => document.querySelector('.bases-count span')?.textContent === '1000 results'), '1000 results', 800);
  const dom = await run(() => document.querySelectorAll('.bases-list-item').length);
  assert.ok(opening < 100, `warm 1000-note open ${opening.toFixed(1)}ms`);
  assert.ok(dom <= 80 && dom > 0, `1000-note list mounts ${dom} rows`);
  await sleep(1200);
  const wheel = await point('.bases-scroll');
  await move(wheel);
  const topBefore = await run(() => document.querySelector('.bases-scroll').scrollTop);
  await run(() => { window.k8f = { frames: [], rows: 0, long: [] }; let last = performance.now(); k8f.obs = new PerformanceObserver(l => { for (const e of l.getEntries()) k8f.long.push(e.duration); }); k8f.obs.observe({ type: 'longtask' }); k8f.raf = requestAnimationFrame(function tick(t) { k8f.frames.push(t - last); last = t; k8f.rows = Math.max(k8f.rows, document.querySelectorAll('.bases-list-item').length); k8f.raf = requestAnimationFrame(tick); }); });
  for (let t = 0; t < 40; t++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheel, deltaX: 0, deltaY: t % 30 < 24 ? 5000 : -5000 }); await sleep(25); }
  const scroll1k = await run(() => { cancelAnimationFrame(k8f.raf); k8f.obs.disconnect(); const frames = k8f.frames.slice(2); const item = [...document.querySelectorAll('.bases-list-item')].find(el => Number(el.dataset.index) > 100); return { frames, rows: k8f.rows, long: k8f.long.map(Math.round), top: document.querySelector('.bases-scroll').scrollTop, index: item?.dataset.index, marker: item?.querySelector('.bases-list-marker')?.textContent, height: item?.offsetHeight }; });
  const max1k = Math.max(...scroll1k.frames);
  console.log('K8_OPEN', JSON.stringify({ n: 1000, ms: +opening.toFixed(1), dom }));
  console.log('K8_SCROLL', JSON.stringify({ n: 1000, max: +max1k.toFixed(1), p95: +p95(scroll1k.frames).toFixed(1), rows: scroll1k.rows, top: scroll1k.top, long: scroll1k.long }));
  assert.ok(max1k < 20, `1000-row scroll max frame ${max1k.toFixed(1)}ms`);
  assert.ok(scroll1k.top > topBefore && scroll1k.top > 1000, `scrolled (${scroll1k.top})`);
  assert.equal(scroll1k.marker, `${Number(scroll1k.index) + 1}.`);
  assert.equal(scroll1k.height, 28);
  assert.ok(scroll1k.rows <= 80, `DOM rows ${scroll1k.rows}`);
  assert.ok(!scroll1k.long.some(d => d > 50), `long tasks ${scroll1k.long}`);
  check(true, `1,000 notes: warm open ${opening.toFixed(1)}ms, scroll max ${max1k.toFixed(1)}ms, ${scroll1k.rows} rows mounted`);

  // 10,000 notes. Cold open, then the warm median, then a deep scroll.
  const n = 10000;
  await run(async n => {
    const { api } = await import('/src/api.ts');
    for (let i = 0; i < n; i++) await api.createNote(`L8K/${String(i).padStart(5, '0')}.md`, `---\nrank: ${i}\n---\n`);
    await api.createNote('L8K.base', 'filters: \'file.inFolder("L8K")\'\nviews:\n  - type: list\n    name: List\n    markers: numbers\n    order:\n      - file.name\n      - rank\n');
    await ws.vault.refreshFiles();
  }, n);
  const open = () => run(async () => {
    window.k8Long = [];
    const observer = new PerformanceObserver(list => { for (const e of list.getEntries()) k8Long.push(e.duration); });
    observer.observe({ type: 'longtask' });
    const stale = document.querySelectorAll('.bases-list-item[data-path^="L8K/"]').length;
    const start = performance.now();
    void ws.open('L8K.base');
    while (!document.querySelector('.bases-list-item[data-path^="L8K/"]')) await new Promise(requestAnimationFrame);
    const ms = performance.now() - start;
    await new Promise(r => setTimeout(r, 300));
    observer.disconnect();
    return { ms: +ms.toFixed(1), long: k8Long.map(Math.round), stale, dom: document.querySelectorAll('.bases-list-item').length };
  });
  const cold = await open();
  await sleep(500);
  await run(() => ws.open('L8.base'));
  await sleep(500);
  const warm = [];
  for (let i = 0; i < 3; i++) { warm.push(await open()); await sleep(300); await run(() => ws.open('L8.base')); await sleep(400); }
  const warmMs = median(warm.map(w => w.ms));
  console.log('K8_OPEN', JSON.stringify({ n, cold, warm }));
  assert.ok(warmMs <= 150 && warm.every(w => !w.stale && w.dom <= 80 && !w.long.some(d => d > 50)), `10k warm open ${JSON.stringify(warm)}`);
  check(true, `10,000 notes: warm open ${warmMs}ms (cold ${cold.ms}ms), no long task over 50ms`);

  await run(() => ws.open('L8K.base'));
  await wait(() => run(() => document.querySelector('.bases-count span')?.textContent === '10000 results'), '10000 results', 800);
  await sleep(600);
  const wheel2 = await point('.bases-scroll');
  await move(wheel2);
  await run(() => { window.k8f = { frames: [], rows: 0, long: [] }; let last = performance.now(); k8f.obs = new PerformanceObserver(l => { for (const e of l.getEntries()) k8f.long.push(e.duration); }); k8f.obs.observe({ type: 'longtask' }); k8f.raf = requestAnimationFrame(function tick(t) { k8f.frames.push(t - last); last = t; k8f.rows = Math.max(k8f.rows, document.querySelectorAll('.bases-list-item').length); k8f.raf = requestAnimationFrame(tick); }); });
  for (let t = 0; t < 80; t++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheel2, deltaX: 0, deltaY: t % 30 < 24 ? 5000 : -5000 }); await sleep(25); }
  const scroll10 = await run(() => { cancelAnimationFrame(k8f.raf); k8f.obs.disconnect(); const frames = k8f.frames.slice(2); const item = [...document.querySelectorAll('.bases-list-item')].find(el => Number(el.dataset.index) > 1000); return { frames, rows: k8f.rows, long: k8f.long.map(Math.round), top: document.querySelector('.bases-scroll').scrollTop, index: item?.dataset.index, marker: item?.querySelector('.bases-list-marker')?.textContent, height: item?.offsetHeight }; });
  const max10 = Math.max(...scroll10.frames);
  const p95_10 = p95(scroll10.frames);
  console.log('K8_SCROLL', JSON.stringify({ n, max: +max10.toFixed(1), p95: +p95_10.toFixed(1), rows: scroll10.rows, top: Math.round(scroll10.top), long: scroll10.long }));
  assert.ok(p95_10 <= 20 && max10 <= 25, `10k scroll p95 ${p95_10.toFixed(1)} max ${max10.toFixed(1)}`);
  assert.ok(scroll10.rows <= 80, `DOM rows ${scroll10.rows}`);
  assert.ok(scroll10.top > 100_000, `scrolled deep (${scroll10.top})`);
  assert.equal(scroll10.marker, `${Number(scroll10.index) + 1}.`);
  assert.equal(scroll10.height, 28);
  assert.ok(!scroll10.long.some(d => d > 50), `long tasks ${scroll10.long}`);
  check(true, `10,000 notes scroll at p95 ${p95_10.toFixed(1)}ms (max ${max10.toFixed(1)}ms) with ${scroll10.rows} rows mounted`);
}, { height: 900 });
