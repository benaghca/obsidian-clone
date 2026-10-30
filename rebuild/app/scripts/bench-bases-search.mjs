#!/usr/bin/env node
// Bases B6: the toolbar Search box over 5,000 and 50,000 rows in the scratch
// browser mock. For a table, a grouped table with summaries and cards it types
// a query with real key events (one key every 100 ms), then deletes it, and
// reports for each keystroke: the work (key down to the rows' DOM changed),
// how many frames until the one that paints it (1 is the next frame), and an
// upper bound on key to paint (to a task after that frame); plus the long
// tasks (over 50 ms) and the longest frame meanwhile.
//
//   node scripts/bench-bases-search.mjs [5000,50000]
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const sizes = (process.argv[2] ?? '5000,50000').split(',').map(Number);
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta'];
const QUERY = 'task 12';
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

for (const n of sizes) await withBrowser(async ({ run, send, click }) => {
  await run(async (n, words) => {
    const { api } = await import('/src/api.ts');
    const status = ['open', 'done', 'waiting'];
    for (let i = 0; i < n; i++) await api.createNote(`B6Perf/${String(i).padStart(5, '0')}.md`, `---\ntitle: Task ${i} ${words[i % 7]}\nstatus: ${status[i % 3]}\npriority: ${i % 5}\n---\n# Note ${i}\n`);
    await api.createNote('B6Perf.base', `filters: 'file.inFolder("B6Perf")'\nviews:\n  - type: table\n    name: Table\n    order: [file.name, title, status, priority]\n  - type: table\n    name: Grouped\n    order: [file.name, title, status, priority]\n    groupBy:\n      property: status\n      direction: ASC\n    summaries:\n      priority: Sum\n      file.name: Count\n  - type: cards\n    name: Cards\n    order: [title, status]\n`);
    await ws.vault.refreshFiles();
    await ws.open('B6Perf.base');
  }, n, WORDS);
  const ready = async (label) => { for (let i = 0; i < 600; i++) { if (await run(n => document.querySelector('.bases-count span')?.textContent === `${n} results` && document.querySelector('.bases-view')?.getAttribute('aria-busy') !== 'true', n)) return; await sleep(50); } assert.fail(`${label}: ${n} rows`); };
  await ready('open');
  const results = {};
  for (const name of ['Table', 'Grouped', 'Cards']) {
    if (name !== 'Table') {
      await click('.bases-view-name');
      await click(await run(name => { const r = [...document.querySelectorAll('.menu-item')].find(el => el.querySelector('.menu-item-title')?.textContent === name).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, name));
      await sleep(300); await ready(name);
    }
    await sleep(500);
    await run(() => {
      window.b6 = { keys: [], longTasks: [], frames: [], pending: null, frameNo: 0 };
      if (!window.b6Installed) {
        window.b6Installed = true;
        new PerformanceObserver(list => { for (const e of list.getEntries()) b6.longTasks.push(e.duration); }).observe({ type: 'longtask' });
        document.addEventListener('keydown', e => { if (e.target.matches?.('.bases-search-input')) b6.pending = { at: performance.now(), frame: b6.frameNo }; }, { capture: true });
      }
      let last = performance.now();
      b6.frame = requestAnimationFrame(function tick(t) { b6.frames.push(t - last); last = t; b6.frameNo++; b6.frame = requestAnimationFrame(tick); });
      // A keystroke's result is painted on the first frame after the rows' DOM next changes.
      const scroller = document.querySelector('.bases-scroll');
      b6.observer = new MutationObserver(() => {
        const k = b6.pending; if (!k) return; b6.pending = null;
        const work = performance.now() - k.at;
        requestAnimationFrame(() => { const frames = b6.frameNo - k.frame; setTimeout(() => b6.keys.push({ work, frames, upper: performance.now() - k.at }), 0); });
      });
      b6.observer.observe(scroller, { childList: true, subtree: true });
    });
    await click('.bases-search-toggle');
    const key = async (k, text) => {
      const code = k === 'Backspace' ? 8 : k === ' ' ? 32 : k.toUpperCase().charCodeAt(0);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, ...(text ? { text, unmodifiedText: text } : {}), windowsVirtualKeyCode: code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: code });
      await sleep(100);
    };
    for (const ch of QUERY) await key(ch, ch);
    await sleep(300);
    const narrowed = await run(() => document.querySelector('.bases-count span').textContent);
    for (const _ of QUERY) await key('Backspace');
    await sleep(500);
    await ready(`${name} cleared`);
    const out = await run(() => { cancelAnimationFrame(b6.frame); b6.observer.disconnect(); return b6; });
    const of = key => out.keys.map(k => k[key]);
    results[name] = { narrowed, keys: out.keys.length, workMedianMs: +median(of('work')).toFixed(1), workMaxMs: +Math.max(...of('work')).toFixed(1), framesToPaint: of('frames'), upperMedianMs: +median(of('upper')).toFixed(1), upperMaxMs: +Math.max(...of('upper')).toFixed(1), longTasks: out.longTasks.map(d => +d.toFixed(0)), maxFrameMs: +Math.max(...out.frames.slice(1)).toFixed(1) };
    await click('.bases-search-toggle'); // close the empty box
  }
  console.log('B6_SEARCH_BENCH', JSON.stringify({ rows: n, ...results }));
}, { height: 900 });
