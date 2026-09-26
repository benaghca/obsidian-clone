// Tests for ui/app/tab-groups.js (a tab with a partner file on the right, and what happens to it).
// Run with plain Node 18+, no packages needed:  node ui/test/tabgroups.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
// The app's pieces are plain scripts sharing one scope; this one has no page access, so it runs alone.
const G = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/tab-groups.js'), 'utf8'), G);

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const tab = (key, split = null) => ({ key, split });
const make = key => tab(key);
const pairs = tabs => tabs.map(x => [x.key, x.split]);
const files = new Set(['A.md', 'B.md', 'C.md', 'D.md', 'pic.png']);
const exists = p => files.has(p);
const canSplit = p => exists(p);

t('isFileTabKey: files, not views or empty tabs', () => {
  assert.equal(G.isFileTabKey('A.md'), true);
  for (const k of [null, ':graph', ':tasks', ':inbox']) assert.equal(G.isFileTabKey(k), false);
});

t('tabsToStore: keys, partners and the active tab', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(G.tabsToStore([tab('A.md', 'B.md'), tab(':graph')], 1))), { keys: ['A.md', ':graph'], splits: ['B.md', null], active: 1 });
});

t('tabsFromStore: round trip', () => {
  const r = G.tabsFromStore({ keys: ['A.md', ':graph', null], splits: ['B.md', null, null], active: 1 }, exists);
  assert.deepEqual(pairs(r.tabs), [['A.md', 'B.md'], [':graph', null], [null, null]]);
  assert.equal(r.active, 1);
});

t('tabsFromStore: state saved before groups existed has no splits', () => {
  const r = G.tabsFromStore({ keys: ['A.md', 'C.md'], active: 0 }, exists);
  assert.deepEqual(pairs(r.tabs), [['A.md', null], ['C.md', null]]);
});

t('tabsFromStore: the old single split pane joins the active tab, only when splits are missing', () => {
  assert.deepEqual(pairs(G.tabsFromStore({ keys: ['A.md', 'C.md'], active: 1 }, exists, 'B.md').tabs), [['A.md', null], ['C.md', 'B.md']]);
  assert.deepEqual(pairs(G.tabsFromStore({ keys: ['A.md'], splits: [null], active: 0 }, exists, 'B.md').tabs), [['A.md', null]]);
  assert.deepEqual(pairs(G.tabsFromStore({ keys: ['A.md'], active: 0 }, exists, 'gone.md').tabs), [['A.md', null]]);
});

t('tabsFromStore: missing files drop out; a missing left file hands over to its partner', () => {
  const r = G.tabsFromStore({ keys: ['gone.md', 'A.md', 'x.md', 'C.md'], splits: [null, 'gone2.md', 'B.md', null], active: 3 }, exists);
  assert.deepEqual(pairs(r.tabs), [['A.md', null], ['B.md', null], ['C.md', null]]);
  assert.equal(r.active, 2);
});

t('tabsFromStore: the active tab dropped out, so the next one is active', () => {
  const r = G.tabsFromStore({ keys: ['A.md', 'gone.md', 'C.md'], splits: [null, null, null], active: 1 }, exists);
  assert.deepEqual(pairs(r.tabs), [['A.md', null], ['C.md', null]]);
  assert.equal(r.active, 1);
  assert.equal(G.tabsFromStore({ keys: ['gone.md'], active: 0 }, exists).active, 0);
  assert.deepEqual(G.tabsFromStore(undefined, exists).tabs, []);
});

t('canDropOnPage: only another ordinary tab holding a file the pane can show', () => {
  const cur = tab('A.md'), other = tab('B.md');
  assert.equal(G.canDropOnPage(cur, other, 'right', canSplit), true);
  assert.equal(G.canDropOnPage(cur, other, 'left', canSplit), true);
  assert.equal(G.canDropOnPage(cur, cur, 'right', canSplit), false, 'the current tab');
  assert.equal(G.canDropOnPage(cur, tab('B.md', 'C.md'), 'right', canSplit), false, 'a group');
  assert.equal(G.canDropOnPage(cur, tab(':graph'), 'right', canSplit), false, 'the graph');
  assert.equal(G.canDropOnPage(cur, tab(null), 'right', canSplit), false, 'an empty tab');
  assert.equal(G.canDropOnPage(cur, tab('notes.txt'), 'right', canSplit), false, "a file the pane can't show");
  assert.equal(G.canDropOnPage(tab(':graph'), other, 'right', canSplit), true, 'beside the graph');
  assert.equal(G.canDropOnPage(tab(':graph'), other, 'left', canSplit), false, 'the graph would have to move right');
  assert.equal(G.canDropOnPage(null, other, 'right', canSplit), false);
});

t('dropOnPage right: the dragged tab becomes the partner and leaves the bar', () => {
  const a = tab('A.md'), b = tab('B.md'), c = tab('C.md'), tabs = [a, b, c];
  assert.equal(G.dropOnPage(tabs, a, c, 'right', make), null);
  assert.deepEqual(pairs(tabs), [['A.md', 'C.md'], ['B.md', null]]);
});

t('dropOnPage left: the dragged tab takes the left and the current file moves right', () => {
  const a = tab('A.md'), b = tab('B.md'), tabs = [a, b];
  G.dropOnPage(tabs, a, b, 'left', make);
  assert.deepEqual(pairs(tabs), [['B.md', 'A.md']]);
});

t('dropOnPage onto a group: the file pushed out gets its own tab right after the group', () => {
  let a = tab('A.md', 'B.md'), c = tab('C.md'), d = tab('D.md'), tabs = [c, a, d];
  const out = G.dropOnPage(tabs, a, d, 'right', make);
  assert.deepEqual(pairs(tabs), [['C.md', null], ['A.md', 'D.md'], ['B.md', null]]);
  assert.equal(out, tabs[2]);
  a = tab('A.md', 'B.md'); c = tab('C.md'); tabs = [a, c];
  G.dropOnPage(tabs, a, c, 'left', make);
  assert.deepEqual(pairs(tabs), [['C.md', 'A.md'], ['B.md', null]]);
});

t('setPartner: sets or replaces; a replaced partner gets its own tab; the same file changes nothing', () => {
  const a = tab('A.md'), tabs = [a];
  assert.equal(G.setPartner(tabs, a, 'B.md', make), null);
  assert.deepEqual(pairs(tabs), [['A.md', 'B.md']]);
  assert.equal(G.setPartner(tabs, a, 'B.md', make), null);
  assert.deepEqual(pairs(tabs), [['A.md', 'B.md']]);
  G.setPartner(tabs, a, 'C.md', make);
  assert.deepEqual(pairs(tabs), [['A.md', 'C.md'], ['B.md', null]]);
});

t('separateTab: the partner gets its own tab right after', () => {
  const a = tab('A.md', 'B.md'), c = tab('C.md'), tabs = [a, c];
  G.separateTab(tabs, a, make);
  assert.deepEqual(pairs(tabs), [['A.md', null], ['B.md', null], ['C.md', null]]);
  assert.equal(G.separateTab(tabs, a, make), null);
});

t('swapPanes: only a group whose left side the split pane can show', () => {
  const a = tab('A.md', 'B.md');
  assert.equal(G.swapPanes(a, canSplit), true);
  assert.deepEqual([a.key, a.split], ['B.md', 'A.md']);
  assert.equal(G.swapPanes(tab(':graph', 'B.md'), canSplit), false);
  assert.equal(G.swapPanes(tab('A.md'), canSplit), false);
});

t('closePane: the other side carries on as an ordinary tab', () => {
  const a = tab('A.md', 'B.md'); G.closePane(a, 'right');
  assert.deepEqual([a.key, a.split], ['A.md', null]);
  const b = tab('A.md', 'B.md'); G.closePane(b, 'left');
  assert.deepEqual([b.key, b.split], ['B.md', null]);
  const c = tab('A.md'); G.closePane(c, 'left');
  assert.deepEqual([c.key, c.split], ['A.md', null], 'not a group: nothing to close');
});

t('detachPane: that side gets its own tab at the drop position', () => {
  let a = tab('A.md', 'B.md'), c = tab('C.md'), tabs = [a, c];
  G.detachPane(tabs, a, 'right', 2, make);
  assert.deepEqual(pairs(tabs), [['A.md', null], ['C.md', null], ['B.md', null]]);
  a = tab('A.md', 'B.md'); c = tab('C.md'); tabs = [a, c];
  G.detachPane(tabs, a, 'left', 0, make);
  assert.deepEqual(pairs(tabs), [['A.md', null], ['B.md', null], ['C.md', null]]);
  assert.equal(tabs[1], a, 'the group itself stays, now holding the former right file');
  assert.equal(G.detachPane(tabs, c, 'right', 0, make), null);
});

t('groupsAfterRename: partners follow their files', () => {
  const tabs = [tab('A.md', 'Old/B.md'), tab('C.md')];
  G.groupsAfterRename(tabs, new Map([['Old/B.md', 'New/B.md']]));
  assert.deepEqual(pairs(tabs), [['A.md', 'New/B.md'], ['C.md', null]]);
});

t('groupsAfterDelete: a missing partner goes; a missing left file hands over to its partner', () => {
  const tabs = [tab('A.md', 'gone.md'), tab('gone.md', 'B.md'), tab(':graph', 'gone.md'), tab('gone.md', 'gone2.md')];
  G.groupsAfterDelete(tabs, exists);
  assert.deepEqual(pairs(tabs), [['A.md', null], ['B.md', null], [':graph', null], ['gone.md', null]]);
});

console.log(`ok ${n} tests`);
