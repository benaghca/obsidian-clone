// KANBAN-EDGE-TESTS: 10,000-row list scroll, then board / list / table switches.
// Headless only. Not wired into package.json. Frame ceilings match the K8 list scroll.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const p95 = values => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];

await withBrowser(async ({ run, click, point, move, send, press, check }) => {
  const wait = async (test, label, tries = 800) => {
    for (let i = 0; i < tries; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const item = title => run(title => {
    const el = [...document.querySelectorAll('.menu-item')].find(e => e.querySelector('.menu-item-title')?.textContent === title);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, title);
  const choose = async title => { await wait(async () => !!await item(title), `menu item ${title}`); await click(await item(title)); };
  const view = async name => {
    if (await run(() => !!document.querySelector('.menu'))) await press('Escape');
    await click('.bases-view-name');
    await choose(name);
    await wait(() => run(name => document.querySelector('.bases-view-name span')?.textContent === name, name), name, 1200);
  };
  await send('Performance.enable');
  const n = 10000;
  await run(async n => {
    const { api } = await import('/src/api.ts');
    for (let i = 0; i < n; i++) {
      const status = ['todo', 'doing', 'review', 'done'][i % 4];
      await api.createNote(`KS/${String(i).padStart(5, '0')}.md`, `---\nstatus: ${status}\nrank: ${i}\n---\n`);
    }
    await api.createNote('KS/.md', '---\nstatus: todo\n---\nnot a note\n');
    await api.createNote('KS.base', `filters: 'file.inFolder("KS")'
views:
  - type: list
    name: List
    markers: numbers
    order:
      - file.name
      - status
      - rank
  - type: kanban
    name: Board
    order:
      - file.name
      - status
    groupBy:
      property: status
      order: [todo, doing, review, done]
    sort:
      - property: file.name
        direction: ASC
  - type: table
    name: Table
    order:
      - file.name
      - status
      - rank
    groupBy:
      property: status
      direction: ASC
`);
    await ws.vault.refreshFiles();
    await ws.open('KS.base');
  }, n);
  await wait(() => run(() => document.querySelector('.bases-count span')?.textContent === '10000 results' && !!document.querySelector('.bases-list-item')), '10k list', 1200);
  assert.equal(await run(() => !!document.querySelector('.bases-list-item[data-path="KS/.md"]')), false, 'a file named .md is not a row');
  const dom0 = await run(() => document.querySelectorAll('.bases-list-item').length);
  assert.ok(dom0 > 0 && dom0 <= 80, `list mounts ${dom0} rows`);
  await sleep(400);
  const wheel = await point('.bases-scroll');
  await move(wheel);
  const topBefore = await run(() => document.querySelector('.bases-scroll').scrollTop);
  await run(() => {
    window.kEdge = { frames: [], rows: 0, long: [] };
    let last = performance.now();
    kEdge.obs = new PerformanceObserver(list => { for (const entry of list.getEntries()) kEdge.long.push(entry.duration); });
    kEdge.obs.observe({ type: 'longtask' });
    kEdge.raf = requestAnimationFrame(function tick(now) {
      kEdge.frames.push(now - last); last = now;
      kEdge.rows = Math.max(kEdge.rows, document.querySelectorAll('.bases-list-item').length);
      kEdge.raf = requestAnimationFrame(tick);
    });
  });
  for (let t = 0; t < 40; t++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheel, deltaX: 0, deltaY: t % 30 < 24 ? 5000 : -5000 });
    await sleep(25);
  }
  const scroll = await run(() => {
    cancelAnimationFrame(kEdge.raf); kEdge.obs.disconnect();
    const frames = kEdge.frames.slice(2);
    const item = [...document.querySelectorAll('.bases-list-item')].find(el => Number(el.dataset.index) > 50);
    return { frames, rows: kEdge.rows, long: kEdge.long.map(Math.round), top: document.querySelector('.bases-scroll').scrollTop, index: item?.dataset.index, marker: item?.querySelector('.bases-list-marker')?.textContent, height: item?.offsetHeight };
  });
  const max = Math.max(...scroll.frames);
  const tail = p95(scroll.frames);
  console.log('KEDGE_SCROLL', JSON.stringify({ n, max: +max.toFixed(1), p95: +tail.toFixed(1), median: +median(scroll.frames).toFixed(1), rows: scroll.rows, top: Math.round(scroll.top), long: scroll.long }));
  assert.ok(tail <= 20 && max <= 25, `10k list scroll p95 ${tail.toFixed(1)} max ${max.toFixed(1)}`);
  assert.ok(scroll.top > topBefore && scroll.top > 1000, `scrolled (${scroll.top})`);
  assert.equal(scroll.marker, `${Number(scroll.index) + 1}.`);
  assert.equal(scroll.height, 28);
  assert.ok(scroll.rows <= 80, `DOM rows ${scroll.rows}`);
  assert.ok(!scroll.long.some(d => d > 50), `long tasks ${scroll.long}`);
  check(true, `10,000-row list scroll p95 ${tail.toFixed(1)}ms, max ${max.toFixed(1)}ms, ${scroll.rows} rows mounted`);

  const watch = async (label, fn) => {
    await run(() => {
      window.kEdgeLong = [];
      window.kEdgeObs = new PerformanceObserver(list => { for (const entry of list.getEntries()) kEdgeLong.push(entry.duration); });
      kEdgeObs.observe({ type: 'longtask' });
      window.kEdgeFrames = [];
      let last = performance.now();
      window.kEdgeRaf = requestAnimationFrame(function tick(now) {
        kEdgeFrames.push(now - last); last = now;
        window.kEdgeRaf = requestAnimationFrame(tick);
      });
    });
    const started = performance.now();
    await fn();
    await sleep(350);
    const sample = await run(() => {
      cancelAnimationFrame(kEdgeRaf); kEdgeObs.disconnect();
      const frames = kEdgeFrames.slice(2);
      return { ms: 0, long: kEdgeLong.map(Math.round), max: frames.length ? Math.max(...frames) : 0, count: document.querySelector('.bases-count span')?.textContent };
    });
    sample.ms = Math.round(performance.now() - started);
    console.log('KEDGE_SWITCH', label, JSON.stringify(sample));
    assert.equal(sample.count, '10000 results', label);
    assert.ok(!sample.long.some(d => d > 50), `${label} long tasks ${sample.long}`);
    assert.ok(sample.max <= 50, `${label} max frame ${sample.max.toFixed(1)}ms`);
    return sample;
  };

  await watch('board', async () => {
    await view('Board');
    await wait(() => run(() => document.querySelectorAll('.bases-kanban-col').length === 4 && !!document.querySelector('.bases-kanban-card')), '10k board');
  });
  const mounted = await run(() => document.querySelectorAll('.bases-kanban-card').length);
  assert.ok(mounted > 0 && mounted < 200, `board mounts ${mounted} cards`);
  assert.equal(await run(() => !!document.querySelector('.bases-kanban-card[data-path="KS/.md"]')), false);
  check(true, `Board of 10,000 notes mounts ${mounted} cards`);

  await watch('table', async () => {
    await view('Table');
    await wait(() => run(() => !!document.querySelector('.bases-table:not([hidden]) tbody tr[data-path]')), '10k table');
  });
  const tableRows = await run(() => document.querySelectorAll('.bases-table tbody tr[data-path]').length);
  assert.ok(tableRows > 0 && tableRows < 120, `table mounts ${tableRows} rows`);
  check(true, `Table of 10,000 notes mounts ${tableRows} rows`);

  await watch('list', async () => {
    await view('List');
    await wait(() => run(() => !!document.querySelector('.bases-list-item[data-path^="KS/"]')), 'list again');
  });
  const dom1 = await run(() => document.querySelectorAll('.bases-list-item').length);
  assert.ok(dom1 > 0 && dom1 <= 80, `list mounts ${dom1} after the round trip`);
  const wheel2 = await point('.bases-scroll');
  await move(wheel2);
  const top2 = await run(() => document.querySelector('.bases-scroll').scrollTop);
  const again = await watch('list scroll', async () => {
    for (let t = 0; t < 12; t++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheel2, deltaX: 0, deltaY: 4000 });
      await sleep(25);
    }
  });
  const top3 = await run(() => document.querySelector('.bases-scroll').scrollTop);
  assert.ok(again.max <= 25, `second scroll max frame ${again.max.toFixed(1)}ms`);
  assert.ok(top3 > top2, `second scroll moved (${Math.round(top2)} -> ${Math.round(top3)})`);
  check(true, 'List, board and table switch on 10,000 notes without a long task, then the list still scrolls');
}, { height: 900 });
