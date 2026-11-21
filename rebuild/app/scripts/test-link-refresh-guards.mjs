#!/usr/bin/env node
// R2 P2b review 2: the views that skip a link refresh must not skip one they need.
// Real saves in headless Chromium against the mock, whose link_changes sends deltas.
//
// 1. A local graph for A.md (depth 2, missing notes shown) has A → ?missing. An existing
//    note B.md, outside the graph and with no file-list change, is saved with [[missing]]:
//    a fresh build reaches B through the missing node, so the refresh must rebuild.
// 2. A Base filtered by 'file. hasLink("Hub")' (valid: the parser takes the space). An
//    already-open note gains [[Hub]] in its editor; the row must appear after the link
//    refresh, which the Base must not skip.
// 3. Review 4: a Base sorted by a column that mixes numbers and text (-2, "-3", -10, which
//    compare in a cycle), with a limit of 2, reading links. Its first paint (one pass) and
//    the refresh after a real link change (sliced, as every pass after the first) both show
//    the rows the browser's own sort picks.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const until = async (run, what, fn, arg, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await run(fn, arg)) return;
    await sleep(50);
  }
  assert.fail(`timed out: ${what}`);
};

await withBrowser(async ({ run, send, click, chord }) => {
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('A.md', 'see [[Missing]]\n');
    // Each already has a link of the kind it gains, so the mock answers with a delta (its
    // maps keep their keys) rather than the whole index.
    await api.createNote('B.md', 'plain text [[Elsewhere]]\n');
    await api.createNote('C.md', 'other words [[B]]\n');
    await api.createNote('Hub.md', 'hub\n');
    await api.createNote('Links.base', `filters: 'file. hasLink("Hub")'\nviews:\n  - type: table\n    name: Table\n    order: [file.name]\n`);
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    const { setGraphSetting } = await import('/src/graph/settings.ts');
    setGraphSetting(true, 'localJumps', 2);
    setGraphSetting(true, 'localBacklinks', true);
    setGraphSetting(true, 'localForelinks', true);
    await ws.open('A.md');
    ws.openView('localgraph', 'right', 'A.md');
  });
  await until(run, 'the local graph shows A and the missing note', n => (window.__graphProbe?.().nodes ?? -1) === n, 2);

  // 1. B.md gains [[missing]], saved the way the app saves (write, then the vault's delayed link refresh).
  const touched = await run(async () => {
    const { api } = await import('/src/api.ts');
    window.__linkTouch = null;
    ws.on(change => { if (change === 'links') window.__linkTouch = ws.vault.linkTouch && [...ws.vault.linkTouch]; });
    await api.writeNote('B.md', 'plain text [[Elsewhere]] [[missing]]\n');
    ws.vault.written('B.md');
    for (let i = 0; i < 100 && !window.__linkTouch; i++) await new Promise(r => setTimeout(r, 50));
    return window.__linkTouch;
  });
  assert.deepEqual(touched, ['B.md'], 'the refresh was a delta naming B.md');
  await until(run, 'the local graph reaches B through the missing note', n => (window.__graphProbe?.().nodes ?? -1) === n, 3);
  console.log('PASS local graph: an outside note linking to a shown missing note joins it');

  // 2. The Base in the main pane, C.md open beside it; type [[Hub]] into C.md.
  await run(async () => { window.__linkTouch = null; await ws.open('Links.base'); await ws.open('C.md', { where: 'right' }); });
  await until(run, 'the base painted', () => !!document.querySelector('.bases-view')?.reconcile?.full);
  assert.equal(await run(() => document.querySelectorAll('.bases-view tbody tr[data-path]').length), 0, 'no row links to Hub yet');
  await click('.workspace-tabs.mod-active .cm-content');
  await chord('End');
  await send('Input.insertText', { text: ' [[Hub]]' });
  await until(run, 'C.md joins the base once its link is in the index', () => !!document.querySelector('.bases-view tbody tr[data-path="C.md"]'));
  assert.deepEqual(await run(() => window.__linkTouch), ['C.md'], 'that refresh was a delta naming C.md');
  console.log('PASS base: file. hasLink("Hub") picks up a link an open note gains');

  // 3. Mixed kinds in a sort column, with a limit: the order is the native sort's.
  // The Links base stays open in the other pane: this one is the view named Mixed.
  await run(() => { window.__mixed = () => [...document.querySelectorAll('.bases-view')].find(v => v.querySelector('.bases-view-name')?.textContent.includes('Mixed')); });
  const shown = () => run(() => [...(__mixed()?.querySelectorAll('tbody tr[data-path]') ?? [])].map(tr => tr.dataset.path));
  const native = await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('M/a.md', '---\nv: -2\n---\na\n');
    await api.createNote('M/b.md', '---\nv: "-3"\n---\nb\n');
    await api.createNote('M/c.md', '---\nv: -10\n---\nc\n');
    await api.createNote('Mixed.base', `filters: 'file.inFolder("M") && !file.hasLink("Nowhere")'\nviews:\n  - type: table\n    name: Mixed\n    order: [file.name, v]\n    sort:\n      - property: v\n    limit: 2\n`);
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    await ws.open('Mixed.base');
    // What this engine's own sort makes of the three values, compared as the table compares them.
    const { compareNames } = await import('/src/paths.ts');
    const rows = [['M/a.md', -2], ['M/b.md', '-3'], ['M/c.md', -10]];
    rows.sort(([, x], [, y]) => (typeof x === 'number' && typeof y === 'number' ? x - y : compareNames(String(x), String(y))));
    return rows.slice(0, 2).map(([path]) => path);
  });
  await until(run, 'the mixed base painted', () => __mixed()?.querySelectorAll('tbody tr[data-path]').length === 2);
  assert.deepEqual(native, ['M/a.md', 'M/b.md'], 'the cycle this check is about (V8 orders -2, "-3", -10)');
  assert.deepEqual(await shown(), native, 'first paint: the native order');
  const full = await run(() => __mixed().reconcile.full);
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.writeNote('M/c.md', '---\nv: -10\n---\nc [[a]]\n');
    ws.vault.written('M/c.md');
  });
  await until(run, 'the mixed base refreshed on the link change', f => __mixed().reconcile.full > f, full);
  assert.deepEqual(await shown(), native, 'after the link refresh: the native order');
  console.log('PASS base: a sort column mixing numbers and text keeps the native order, limit included');
});
