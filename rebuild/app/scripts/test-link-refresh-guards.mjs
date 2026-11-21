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
});
