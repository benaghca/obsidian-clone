#!/usr/bin/env node
// K6: own-write reconcile on a kanban, against the full rebuild the same
// write takes when the view reads file.backlinks. Sizes default to
// 1,000, 10,000 and 50,000. Not part of npm test.
//
//   node scripts/bench-bases-kanban.mjs [1000,10000,50000]
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const sizes = (process.argv[2] ?? '1000,10000,50000').split(',').map(Number);
const card = 'K6B/00000.md';

for (const n of sizes) await withBrowser(async ({ run, press }) => {
  await run(async n => {
    const { api } = await import('/src/api.ts');
    const status = ['todo', 'doing', 'review', 'done'];
    for (let i = 0; i < n; i++) await api.createNote(`K6B/${String(i).padStart(5, '0')}.md`, `---\nstatus: ${status[i % 4]}\npriority: ${i % 7}\n---\nbody ${i}\n`);
    const order = `order: [file.name, status]\n    groupBy:\n      property: status\n      order: [todo, doing, review, done]\n    sort:\n      - property: file.name\n        direction: ASC\n`;
    await api.createNote('K6B.base', `filters: 'file.inFolder("K6B")'\nviews:\n  - type: kanban\n    name: Board\n    ${order}`);
    await api.createNote('K6BLinks.base', `filters: 'file.inFolder("K6B")'\nformulas:\n  n: file.backlinks.length\nviews:\n  - type: kanban\n    name: Links\n    order: [file.name, formula.n]\n    groupBy:\n      property: status\n      order: [todo, doing, review, done]\n    sort:\n      - property: file.name\n`);
    await ws.vault.refreshFiles();
    const original = api.setProperty;
    api.setProperty = async (...args) => {
      const result = await original(...args);
      if (!args[2] && window.k6m) k6m.mark = performance.now();
      return result;
    };
    if (!window.k6obs) {
      window.k6obs = new PerformanceObserver(list => { for (const entry of list.getEntries()) if (window.k6m) k6m.long.push(entry.duration); });
      window.k6obs.observe({ type: 'longtask' });
    }
  }, n);
  const ready = async () => {
    for (let i = 0; i < 1200; i++) {
      if (await run(card => document.querySelector(`.bases-kanban-card[data-path="${card}"]`)?.classList.contains('is-movable'), card)) return;
      await sleep(50);
    }
    assert.fail(`${n} board did not paint ${card}`);
  };
  const measure = async mode => {
    await ready();
    await sleep(200);
    await run(() => {
      window.k6m = { long: [], mark: 0, before: { ...document.querySelector('.bases-view').reconcile }, col: document.querySelector('.bases-kanban-col') };
    });
    await run(card => document.querySelector(`.bases-kanban-card[data-path="${card}"]`).focus(), card);
    await press(' '); await press('ArrowRight'); await press(' ');
    const hit = await run(() => new Promise(resolve => {
      const started = performance.now();
      const timer = setInterval(() => {
        const now = document.querySelector('.bases-view').reconcile;
        if (now.skip === k6m.before.skip && now.full === k6m.before.full) {
          if (performance.now() - started > 3000) { clearInterval(timer); resolve(null); }
          return;
        }
        clearInterval(timer);
        resolve({ reconcileMs: k6m.mark ? performance.now() - k6m.mark : null, lastMs: now.lastMs, full: now.full - k6m.before.full, skip: now.skip - k6m.before.skip, remounted: !k6m.col.isConnected });
      }, 10);
    }));
    assert.ok(hit, `${mode} ${n}: reconcile did not finish`);
    await sleep(400);
    const settled = await run(() => {
      const now = document.querySelector('.bases-view').reconcile;
      return { lastMs: now.lastMs, full: now.full - k6m.before.full, skip: now.skip - k6m.before.skip, remounted: !k6m.col.isConnected, long: k6m.long.filter(d => d > 50).map(d => Math.round(d)) };
    });
    const row = { rows: n, mode, reconcileMs: hit.reconcileMs === null ? null : +hit.reconcileMs.toFixed(1), lastMs: +hit.lastMs.toFixed(1), remounted: settled.remounted, full: settled.full, skip: settled.skip, long: settled.long };
    console.log('K6_RECONCILE', JSON.stringify(row));
    return row;
  };
  await run(() => ws.open('K6B.base'));
  const skip = await measure('skip');
  assert.equal(skip.remounted, false);
  assert.equal(skip.full, 0);
  assert.ok(skip.skip >= 1);
  assert.deepEqual(skip.long, []);
  assert.ok(skip.lastMs < 50, JSON.stringify(skip));
  // The write schedules a link refresh a second later. Let it land on this board before opening the other.
  await sleep(900);
  await run(() => ws.open('K6BLinks.base'));
  const full = await measure('full');
  assert.equal(full.remounted, true);
  assert.ok(full.full >= 1);
  // A view that reads file.backlinks still takes the old rebuild. At 50k that select can exceed 50 ms; the cost is B7, and this bench reports it.
});
