#!/usr/bin/env node
// R2 P2b review 1: save to render with the graph and a Base visible, for a
// prose-only edit and an edit that adds one link. Not part of npm test.
//
//   node scripts/bench-link-refresh.mjs [5000,20000,50000]
//   GROVE_BENCH_BASE=links node scripts/bench-link-refresh.mjs ...   (the Base's filter reads links)
//
// The note is edited in its editor (typed, then autosaved). Per case it reports:
// - linksMs: from the save to the "links" refresh (LINK_INDEX_DELAY by design);
// - mockMs: the mock's link_changes (in the app that is Rust, off this thread);
// - graph: each graph rebuild after the refresh: its work (ms) and, since review 2 slices
//   updates across frames, the time from its start to installed (span);
// - base: full Base rebuilds before and after the refresh, and the last one's ms;
// - renderMs: from the refresh to the frame where the last of that work is on screen;
// - long: main-thread tasks over 50 ms from the save on;
// - blockedMs (review 3): the longest the main thread was busy after the "links" refresh, as
//   a message posted to it waited (a probe that keeps one message in flight): the longest
//   task the refresh's work (graph, Base, link copy) left, rendering included;
// - frameMs (review 4): the graph's longest frame of work after the refresh (layout and
//   drawing; a tick too long for one frame is spread over several), and how many it drew.
// GROVE_BENCH_CHECK=1 also asserts this branch's behavior: a prose save rebuilds
// neither view on the refresh, and the added link is in the graph.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const sizes = (process.argv[2] ?? '5000,20000,50000').split(',').map(Number);
const check = process.env.GROVE_BENCH_CHECK === '1';
// A Base that reads links (its rows don't change here, but it must rebuild on a real link change).
const linksBase = process.env.GROVE_BENCH_BASE === 'links';
// GROVE_BENCH_GRAPH=0: no graph, so `blockedMs` is not the graph's layout frames (before
// review 4 each took ~95 ms at 50k after a reheat; now a tick is spread over frames).
const withGraph = process.env.GROVE_BENCH_GRAPH !== '0';
const filter = linksBase ? `'file.inFolder("LR") && !file.hasLink("Nowhere")'` : `'file.inFolder("LR")'`;
const note = 'LR/00000.md';

for (const n of sizes) await withBrowser(async ({ run, send, click, chord }) => {
  await run(async (n, filter) => {
    const { api } = await import('/src/api.ts');
    const pad = i => String(i).padStart(5, '0');
    for (let i = 0; i < n; i++) await api.createNote(`LR/${pad(i)}.md`, `---\nstatus: s${i % 4}\n---\nsee [[${pad((i + 1) % n)}]] and [[${pad((i * 7 + 3) % n)}]]\nbody ${i}\n`);
    await api.createNote('LR.base', `filters: ${filter}\nviews:\n  - type: table\n    name: Table\n    order: [file.name, status]\n`);
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    const write = api.writeNote;
    api.writeNote = async (...args) => { if (window.lr) lr.saved ??= performance.now(); return write(...args); };
    ws.on(change => { if (change === 'links' && window.lr && lr.saved) lr.links ??= performance.now(); });
    new PerformanceObserver(list => { for (const e of list.getEntries()) if (window.lr?.saved) lr.long.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  }, n, filter);
  await run(async (note, withGraph) => { await ws.open(note); await ws.open('LR.base', { where: 'right' }); if (withGraph) ws.openView('graph', 'down'); }, note, withGraph);
  const ready = () => run((n, withGraph) => (!withGraph || (window.__graphProbe?.().nodes ?? 0) >= n) && (document.querySelector('.bases-view')?.reconcile?.full ?? 0) >= 1, n, withGraph);
  for (let i = 0; i < 2400 && !(await ready()); i++) await sleep(50);
  assert.ok(await ready(), `${n}: graph and base did not paint`);
  // Let the layout settle, so its frames don't count against the save.
  for (let i = 0; i < 600 && (await run(() => window.__graphRunning)); i++) await sleep(100);

  const measure = async (label, text) => {
    await run(() => {
      const base = document.querySelector('.bases-view');
      window.__mockLinkMs = [];
      window.lr = { long: [], saved: null, links: null, builds: (window.__graphBuilds ?? []).length, base: base.reconcile.full, baseAtLinks: null, lastWork: 0, edges: window.__graphProbe?.().links ?? 0, frames: null };
      const frame = () => {
        if (!window.lr) return;
        const full = base.reconcile.full;
        if (lr.links && lr.baseAtLinks === null) lr.baseAtLinks = full;
        if (lr.links && lr.frames === null) lr.frames = (window.__graphWork ?? []).length;
        if (full !== lr.seenFull || (window.__graphBuilds ?? []).length !== lr.seenBuilds) {
          lr.seenFull = full; lr.seenBuilds = (window.__graphBuilds ?? []).length; lr.lastWork = performance.now();
        }
        requestAnimationFrame(frame);
      };
      lr.seenFull = base.reconcile.full; lr.seenBuilds = lr.builds;
      requestAnimationFrame(frame);
      // The longest wait of a message posted to this thread, once the links refresh is in.
      const probe = new MessageChannel(), me = window.lr;
      let sent = performance.now();
      me.blocked = 0;
      probe.port1.onmessage = () => {
        const now = performance.now();
        // Only waits that began after the refresh: the mock's own walk (Rust, off this
        // thread in the app) runs before it.
        if (me.links && sent >= me.links) me.blocked = Math.max(me.blocked, now - sent);
        if (window.lr !== me) return probe.port1.close();
        sent = now;
        probe.port2.postMessage(0);
      };
      probe.port2.postMessage(0);
    });
    await click('.workspace-leaf .cm-content');
    await chord('End');
    await send('Input.insertText', { text });
    for (let i = 0; i < 200 && !(await run(() => !!lr.links)); i++) await sleep(50);
    await sleep(2500);
    const row = await run((label, n, linksBase) => {
      const base = document.querySelector('.bases-view');
      const builds = (window.__graphBuilds ?? []).slice(lr.builds).filter(b => b.at >= lr.links).map(b => b.span === undefined ? +b.ms.toFixed(1) : { ms: +b.ms.toFixed(1), span: +b.span.toFixed(1), slice: +b.slice.toFixed(1), install: +b.install.toFixed(1) });
      const out = {
        notes: n, case: label, base: linksBase ? 'reads links' : 'no links',
        linksMs: lr.links ? Math.round(lr.links - lr.saved) : null,
        mockMs: (window.__mockLinkMs ?? []).map(ms => +ms.toFixed(1)),
        graph: builds,
        baseBefore: (lr.baseAtLinks ?? base.reconcile.full) - lr.base,
        baseAfter: base.reconcile.full - (lr.baseAtLinks ?? base.reconcile.full),
        baseLastMs: +base.reconcile.lastMs.toFixed(1),
        baseSlice: +(base.reconcile.slice ?? 0).toFixed(1),
        renderMs: lr.lastWork > lr.links ? Math.round(lr.lastWork - lr.links) : 0,
        edgesAdded: (window.__graphProbe?.().links ?? 0) - lr.edges,
        long: lr.long,
        blockedMs: +lr.blocked.toFixed(1),
        frameMs: +Math.max(0, ...(window.__graphWork ?? []).slice(lr.frames ?? Infinity)).toFixed(1),
        frames: (window.__graphWork ?? []).slice(lr.frames ?? Infinity).length,
      };
      window.lr = null;
      return out;
    }, label, n, linksBase);
    console.log('LINK_REFRESH', JSON.stringify(row));
    return row;
  };
  const prose = await measure('prose', ' more words');
  const edge = await measure('one link', ' [[00500]]');
  if (check) {
    assert.ok(prose.linksMs !== null && edge.linksMs !== null, 'both saves refreshed the links');
    assert.deepEqual(prose.graph, [], 'a prose save does not rebuild the graph');
    assert.equal(prose.baseAfter, 0, 'a prose save does not rebuild the base on the link refresh');
    if (withGraph) {
      assert.equal(edge.graph.length, 1, 'the added link rebuilds the graph once');
      assert.equal(edge.edgesAdded, 1, 'the added link is in the graph');
    }
    if (linksBase) assert.equal(edge.baseAfter, 1, 'a base that reads links rebuilds once on a real link change');
    else assert.equal(edge.baseAfter, 0, 'a base that reads no links skips the link refresh');
  }
});
