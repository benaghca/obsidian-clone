#!/usr/bin/env node
// R2 P2b review 1: save to render with the graph and a Base visible, for a
// prose-only edit and an edit that adds one link. Not part of npm test.
//
//   node scripts/bench-link-refresh.mjs [5000,20000,50000]
//
// The note is edited in its editor (typed, then autosaved). Per case it reports:
// - linksMs: from the save to the "links" refresh (LINK_INDEX_DELAY by design);
// - mockMs: the mock's link_changes (in the app that is Rust, off this thread);
// - graph: each graph rebuild after the refresh (ms);
// - base: full Base rebuilds before and after the refresh, and the last one's ms;
// - renderMs: from the refresh to the frame where the last of that work is on screen;
// - long: main-thread tasks over 50 ms from the save on.
// GROVE_BENCH_CHECK=1 also asserts this branch's behavior: a prose save rebuilds
// neither view on the refresh, and the added link is in the graph.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const sizes = (process.argv[2] ?? '5000,20000,50000').split(',').map(Number);
const check = process.env.GROVE_BENCH_CHECK === '1';
const note = 'LR/00000.md';

for (const n of sizes) await withBrowser(async ({ run, send, click, chord }) => {
  await run(async n => {
    const { api } = await import('/src/api.ts');
    const pad = i => String(i).padStart(5, '0');
    for (let i = 0; i < n; i++) await api.createNote(`LR/${pad(i)}.md`, `---\nstatus: s${i % 4}\n---\nsee [[${pad((i + 1) % n)}]] and [[${pad((i * 7 + 3) % n)}]]\nbody ${i}\n`);
    await api.createNote('LR.base', `filters: 'file.inFolder("LR")'\nviews:\n  - type: table\n    name: Table\n    order: [file.name, status]\n`);
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    const write = api.writeNote;
    api.writeNote = async (...args) => { if (window.lr) lr.saved ??= performance.now(); return write(...args); };
    ws.on(change => { if (change === 'links' && window.lr && lr.saved) lr.links ??= performance.now(); });
    new PerformanceObserver(list => { for (const e of list.getEntries()) if (window.lr?.saved) lr.long.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  }, n);
  await run(async note => { await ws.open(note); await ws.open('LR.base', { where: 'right' }); ws.openView('graph', 'down'); }, note);
  const ready = () => run(n => (window.__graphProbe?.().nodes ?? 0) >= n && (document.querySelector('.bases-view')?.reconcile?.full ?? 0) >= 1, n);
  for (let i = 0; i < 2400 && !(await ready()); i++) await sleep(50);
  assert.ok(await ready(), `${n}: graph and base did not paint`);
  // Let the layout settle, so its frames don't count against the save.
  for (let i = 0; i < 600 && (await run(() => window.__graphRunning)); i++) await sleep(100);

  const measure = async (label, text) => {
    await run(() => {
      const base = document.querySelector('.bases-view');
      window.__mockLinkMs = [];
      window.lr = { long: [], saved: null, links: null, builds: (window.__graphBuilds ?? []).length, base: base.reconcile.full, baseAtLinks: null, lastWork: 0, edges: window.__graphProbe().links };
      const frame = () => {
        if (!window.lr) return;
        const full = base.reconcile.full;
        if (lr.links && lr.baseAtLinks === null) lr.baseAtLinks = full;
        if (full !== lr.seenFull || (window.__graphBuilds ?? []).length !== lr.seenBuilds) {
          lr.seenFull = full; lr.seenBuilds = (window.__graphBuilds ?? []).length; lr.lastWork = performance.now();
        }
        requestAnimationFrame(frame);
      };
      lr.seenFull = base.reconcile.full; lr.seenBuilds = lr.builds;
      requestAnimationFrame(frame);
    });
    await click('.workspace-leaf .cm-content');
    await chord('End');
    await send('Input.insertText', { text });
    for (let i = 0; i < 200 && !(await run(() => !!lr.links)); i++) await sleep(50);
    await sleep(2500);
    const row = await run((label, n) => {
      const base = document.querySelector('.bases-view');
      const builds = (window.__graphBuilds ?? []).slice(lr.builds).filter(b => b.at >= lr.links).map(b => +b.ms.toFixed(1));
      const out = {
        notes: n, case: label,
        linksMs: lr.links ? Math.round(lr.links - lr.saved) : null,
        mockMs: (window.__mockLinkMs ?? []).map(ms => +ms.toFixed(1)),
        graph: builds,
        baseBefore: (lr.baseAtLinks ?? base.reconcile.full) - lr.base,
        baseAfter: base.reconcile.full - (lr.baseAtLinks ?? base.reconcile.full),
        baseLastMs: +base.reconcile.lastMs.toFixed(1),
        renderMs: lr.lastWork > lr.links ? Math.round(lr.lastWork - lr.links) : 0,
        edgesAdded: window.__graphProbe().links - lr.edges,
        long: lr.long,
      };
      window.lr = null;
      return out;
    }, label, n);
    console.log('LINK_REFRESH', JSON.stringify(row));
    return row;
  };
  const prose = await measure('prose', ' more words');
  const edge = await measure('one link', ' [[00500]]');
  if (check) {
    assert.ok(prose.linksMs !== null && edge.linksMs !== null, 'both saves refreshed the links');
    assert.deepEqual(prose.graph, [], 'a prose save does not rebuild the graph');
    assert.equal(prose.baseAfter, 0, 'a prose save does not rebuild the base on the link refresh');
    assert.equal(edge.graph.length, 1, 'the added link rebuilds the graph once');
    assert.equal(edge.edgesAdded, 1, 'the added link is in the graph');
    assert.equal(edge.baseAfter, 0, 'a base that reads no links skips the link refresh');
  }
});
