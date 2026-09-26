# Split Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person drag a tab onto the left or right half of the page to show it beside the current note, with the pair living in the tab bar as one group tab that they can leave and come back to.

**Architecture:** Each tab gets a `split` field, its partner file on the right. The existing split pane (`ui/app/split.js`) stops being a global panel and shows the current tab's partner, and the main editor doesn't change. The rules for joining, separating, swapping, closing, renaming, deleting and saving groups are plain functions in a new file, `ui/app/tab-groups.js`, with no page access, so they can be unit-tested. The page wiring (drag and drop, headers, menus) stays in `tabs.js` and `split.js`.

**Tech Stack:** plain browser JavaScript. The `ui/app/*.js` pieces are joined in order into one script by `src/api.rs` and type-checked by TypeScript without a build step. There's also CodeMirror 6 (`ui/editor/editor.js`, bundled by esbuild into `ui/vendor/editor.bundle.js`), and Rust (tao/wry), which serves the UI. Tests run on Node: unit tests are `node ui/test/*.test.js`, and the browser tests are Playwright (`ui/test/e2e/*.js`, run through `ui/test/e2e/run.sh`).

**Spec:** `docs/superpowers/specs/2026-09-26-split-tabs-design.md`

## Global Constraints

- Two panes only: `key` (left) and `split` (right). No stacked or grid layouts, and no "active pane" model.
- The left pane keeps the full editor (`ed`). The right pane keeps `mountCardEditor` (`ui/app/graph.js:109`). Don't change the main editor.
- Plain links, the file tree, search and the switcher still open in the left pane. Only **Ctrl+Alt+click** on a link opens it in the other pane.
- A pane's × closes that note, and the group tab's × closes both. Separating happens only through *Separate tabs* or by dragging a pane's grip onto the tab bar.
- Exact UI text: "Open on the left", "Open on the right", "Separate tabs", "Swap panes", "Close this note", "Close the note on the right". A group tab's names are separated by a `.tab-sep` element and its `aria-label` is "`<left>` and `<right>`".
- A group tab's `max-width` is 320px (a normal tab's is 220px).
- The saved tab list is `store('tabs', { keys, splits, active })`, and state saved without `splits` must still load. The old `store('split')` converts once onto the active tab and is then set to `null`.
- Every new `ui/app/*.js` piece must be added to `APP_JS` in `src/api.rs` (a Rust test and `ui/test/app.test.js` enforce this) and to `files` in `ui/tsconfig.json`.
- Node is a dev tool only. Nothing that ships in `cinder.exe` may need it.
- Comments and UI text follow the repo's style: plain sentences, in the voice of the existing comments.
- Commit and push after each task has passed its tests. Run targeted browser suites in the foreground, and the full regression only in the background (Task 8).

## Review Focus

1. **Quick switching between group tabs.** `showSplit` is async. Clicking between groups quickly must end with the current tab's partner showing and exactly one editor in the right pane, never a leaked second editor or a stale note. The test is in Task 2.
2. **Dropping a tab onto the editor.** CodeMirror accepts text drops, and a dragged tab carries its name as `text/plain`. Dropping onto the page must never insert the tab's name into the note, including drops that aren't allowed. The test is in Task 5.
3. **Unsaved typing in the right pane when it moves left.** Typing on the right and at once swapping (or closing the left pane, or dropping on the left) must keep the typed text on disk and in the main editor. The test is in Task 4.
4. **The grip and the window drag.** With the custom title bar, a mousedown in `#viewbar` starts a window drag and calls `preventDefault`, which would stop the grip from ever starting an HTML5 drag. The grip must be excluded. The test is in Task 6.
5. **Closing the last tab when it's a group.** This must leave one empty tab with the split pane hidden, not an empty left pane beside a stale right pane. The test is in Task 4.

---

## File structure

| File | What changes |
|---|---|
| `ui/app/tab-groups.js` (new) | Plain functions over tabs: saving/restoring, join, separate, swap, close, detach, rename, delete. No page access. |
| `ui/test/tabgroups.test.js` (new) | Unit tests for `tab-groups.js`, loaded on its own with Node's `vm`. |
| `src/api.rs` | Add `tab-groups.js` to `APP_JS`, before `tabs.js`. |
| `ui/tsconfig.json` | Add `app/tab-groups.js` to `files`, before `app/tabs.js`. |
| `ui/app/tabs.js` | `split`/`splitMode` on tabs, saving/restoring through `tab-groups.js`, `syncSplitPane()` after every view change, group rendering and menu, closed groups, and tab bar drops for pane grips. |
| `ui/app/split.js` | Shows the current tab's partner (`showSplit`), `canSplit`, the new close/swap/separate/left-close actions, dropping a tab onto the page, and dragging grips. |
| `ui/app/files.js` | Rename and delete call `syncSplitPane()`, and a deleted left note hands over to its partner. |
| `ui/app/boot.js` | Drop the global split restore. |
| `ui/app/commands.js` | Rename the split commands and add *Separate tabs*. |
| `ui/app/window.js` | Keep `.pane-grip` out of window dragging. |
| `ui/app/core.js`, `ui/app/tasks.js`, `ui/app/markdown.js`, `ui/editor/editor.js` (+ rebuilt `ui/vendor/editor.bundle.js`) | Ctrl+Alt+click. |
| `ui/index.html`, `ui/style.css` | A `#workspace` wrapper so the tab bar spans both panes, the left pane's grip and ×, the group tab, the drop overlay. |
| `ui/test/e2e/splittabs.js` (new), `ui/test/e2e/split.js` | Browser tests. |
| `README.md` | The feature, the suite count and the unit test list. |

---

### Task 1: Plain tab-group functions and their unit tests

**Files:**
- Create: `ui/app/tab-groups.js`
- Create: `ui/test/tabgroups.test.js`
- Modify: `src/api.rs:22` (add a line before `tabs.js`)
- Modify: `ui/tsconfig.json` (`files`, before `"app/tabs.js"`)

**Interfaces:**
- Consumes: nothing.
- Produces, all global functions (the pieces share one scope). A "tab" is any object with `key` (string or null) and `split` (string or null). `exists(path) → bool`, `canSplit(path) → bool` and `make(key) → tab` are passed in.
  - `isFileTabKey(k) → bool`: true for a file path, false for `null`, `':graph'`, `':tasks'`, `':inbox'`.
  - `tabFromSaved(key, split, exists) → { key, split } | null`
  - `tabsToStore(tabs, active) → { keys, splits, active }`
  - `tabsFromStore(saved, exists, legacySplit = null) → { tabs: [{ key, split }], active }`
  - `canDropOnPage(cur, dragged, side, canSplit) → bool`, where `side` is `'left'` or `'right'`
  - `dropOnPage(tabs, cur, dragged, side, make) → tab | null`: mutates `tabs` and `cur`, and returns the tab made for a pushed-out partner
  - `setPartner(tabs, cur, path, make) → tab | null`: same return
  - `separateTab(tabs, cur, make) → tab | null`
  - `swapPanes(cur, canSplit) → bool`
  - `closePane(cur, side) → void`
  - `detachPane(tabs, cur, side, at, make) → tab | null`
  - `groupsAfterRename(tabs, moved) → void`, where `moved` is a `Map` of old path to new path
  - `groupsAfterDelete(tabs, exists) → void`

- [ ] **Step 1: Check the baseline.** Confirm the tools work before changing anything.

Run: `node --version && node ui/test/app.test.js && (cd ui/editor && npm run typecheck) && ui/test/e2e/run.sh split`
Expected: a Node version, `ok 36 pieces`, no type errors, and `✓ split (14 checks)`. If the browser suite can't start, run `cd ui/test/e2e && npm install && npx playwright-core install chromium` once and retry.

- [ ] **Step 2: Write the failing unit tests** in `ui/test/tabgroups.test.js`.

```js
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
```

- [ ] **Step 3: Run the tests to check they fail.**

Run: `node ui/test/tabgroups.test.js`
Expected: FAIL with `ENOENT` for `ui/app/tab-groups.js`.

- [ ] **Step 4: Write `ui/app/tab-groups.js`.**

```js
/* Cinder app — tab groups. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.)
 *
 * A tab can hold a second file, shown in the split pane on its right. Its `key` is the left pane (a
 * file, ':graph', ':tasks', ':inbox' or null) and its `split` is the right pane's file, or null. A
 * tab with a `split` is a group. Only plain functions over tabs live here, with no page access, so
 * ui/test/tabgroups.test.js can load this file on its own. The callers pass `exists(path)`,
 * `canSplit(path)` (can the split pane show it) and `make(key)` (a new ordinary tab). */

const isFileTabKey = k => k != null && !k.startsWith(':');

// One saved tab, checked against the vault: a missing partner is dropped, and a missing left file
// hands its place to the partner. Null when nothing is left to show.
function tabFromSaved(key, split, exists) {
  const sp = isFileTabKey(split) && exists(split) ? split : null;
  if (!isFileTabKey(key) || exists(key)) return { key, split: sp };
  return sp ? { key: sp, split: null } : null;
}

function tabsToStore(tabs, active) {
  return { keys: tabs.map(t => t.key), splits: tabs.map(t => t.split || null), active };
}

// The saved tabs, checked against the vault. `legacySplit` is the one split pane from before tabs
// had partners: it joins the tab that was active then.
function tabsFromStore(saved, exists, legacySplit = null) {
  const keys = saved?.keys || [], splits = saved?.splits;
  const want = saved?.active ?? 0;
  const tabs = [];
  let active = 0;
  keys.forEach((k, i) => {
    const sp = splits ? splits[i] ?? null : i === want ? legacySplit : null;
    const t = tabFromSaved(k, sp, exists);
    if (i === want) active = tabs.length;
    if (t) tabs.push(t);
  });
  return { tabs, active: Math.min(active, Math.max(0, tabs.length - 1)) };
}

// Can the tab `dragged` be dropped on the `side` ('left' or 'right') of the page showing `cur`?
// Not the tab itself, not a group, and only files the split pane can show. On the left, the
// current thing moves right, so it has to be one of those files too.
function canDropOnPage(cur, dragged, side, canSplit) {
  if (!cur || !dragged || dragged === cur || dragged.split) return false;
  if (!canSplit(dragged.key)) return false;
  return side === 'right' || canSplit(cur.key);
}

// Drop `dragged` on `side` of `cur`: the two become one group and the dragged tab leaves `tabs`.
// A partner the drop pushes out gets its own tab right after the group, and is returned.
function dropOnPage(tabs, cur, dragged, side, make) {
  const out = cur.split ? make(cur.split) : null;
  if (side === 'left') { cur.split = cur.key; cur.key = dragged.key; }
  else cur.split = dragged.key;
  tabs.splice(tabs.indexOf(dragged), 1);
  if (out) tabs.splice(tabs.indexOf(cur) + 1, 0, out);
  return out;
}

// Give `cur` the partner `path` (Open to the right). A partner it replaces gets its own tab.
function setPartner(tabs, cur, path, make) {
  if (cur.split === path) return null;
  const out = cur.split ? make(cur.split) : null;
  cur.split = path;
  if (out) tabs.splice(tabs.indexOf(cur) + 1, 0, out);
  return out;
}

// Separate tabs: the partner gets its own tab right after the group.
function separateTab(tabs, cur, make) {
  if (!cur.split) return null;
  const t = make(cur.split);
  cur.split = null;
  tabs.splice(tabs.indexOf(cur) + 1, 0, t);
  return t;
}

// Swap panes. The left side has to be something the split pane can show.
function swapPanes(cur, canSplit) {
  if (!cur.split || !canSplit(cur.key)) return false;
  [cur.key, cur.split] = [cur.split, cur.key];
  return true;
}

// Close one side of a group; the other carries on as an ordinary tab.
function closePane(cur, side) {
  if (!cur.split) return;
  if (side === 'left') cur.key = cur.split;
  cur.split = null;
}

// A pane's grip dropped on the tab bar at position `at` (an index into `tabs`): that side's file
// gets its own tab there, and the group carries on with the other side.
function detachPane(tabs, cur, side, at, make) {
  if (!cur.split) return null;
  const t = make(side === 'left' ? cur.key : cur.split);
  closePane(cur, side);
  tabs.splice(at, 0, t);
  return t;
}

// Files renamed or moved (`moved`: old path -> new path, every file in a moved folder included).
function groupsAfterRename(tabs, moved) {
  for (const t of tabs) if (t.split && moved.has(t.split)) t.split = moved.get(t.split);
}

// Files deleted: a group loses a missing partner, or its missing left file (the partner takes over).
function groupsAfterDelete(tabs, exists) {
  for (const t of tabs) {
    if (t.split && !exists(t.split)) t.split = null;
    if (t.split && isFileTabKey(t.key) && !exists(t.key)) { t.key = t.split; t.split = null; }
  }
}
```

- [ ] **Step 5: Join the new piece into the app.** In `src/api.rs`, add `include_str!("../ui/app/tab-groups.js"),` on the line before `include_str!("../ui/app/tabs.js"),`. In `ui/tsconfig.json`, add `"app/tab-groups.js",` before `"app/tabs.js",`.

- [ ] **Step 6: Run the tests to check they pass.**

Run: `node ui/test/tabgroups.test.js && node ui/test/app.test.js && cargo test -q 2>&1 | tail -3 && (cd ui/editor && npm run typecheck)`
Expected: `ok 18 tests`, `ok 37 pieces`, `test result: ok`, and no type errors.

- [ ] **Step 7: Point the spec at the new test file.** The spec's testing section names `ui/test/app.test.js` for these tests, but that file only checks the joined script's syntax, so they live in their own file instead. In `docs/superpowers/specs/2026-09-26-split-tabs-design.md`, replace `- **Unit tests, \`ui/test/app.test.js\`:**` with `- **Unit tests, \`ui/test/tabgroups.test.js\`** (loads \`ui/app/tab-groups.js\` on its own):`.

- [ ] **Step 8: Commit.**

```bash
git add ui/app/tab-groups.js ui/test/tabgroups.test.js src/api.rs ui/tsconfig.json docs/superpowers/specs/2026-09-26-split-tabs-design.md
git commit -m "Tab groups: plain functions for a tab with a partner file, and their tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 2: Tabs own their partner (switching, saving, renames and deletes)

**Files:**
- Modify: `ui/app/tabs.js` (`newTabObj` at line 10, `syncTab`, `saveTabs`, `tabsAfterRename`, `tabsAfterDelete`, `restoreTabs`)
- Modify: `ui/app/split.js` (replace lines 8–135: `SPLIT`, `openSplit`, `closeSplit`, `swapSplit`, `splitFileMoved`)
- Modify: `ui/app/files.js:146-148` and `:204-207`
- Modify: `ui/app/boot.js:119`
- Create: `ui/test/e2e/splittabs.js`

**Interfaces:**
- Consumes: `tabsToStore`, `tabsFromStore`, `tabFromSaved`, `setPartner`, `swapPanes`, `closePane`, `groupsAfterRename` and `groupsAfterDelete` from Task 1.
- Produces:
  - Tab objects gain `split: string | null` and `splitMode: 'edit' | 'read'`.
  - `canSplit(path) → bool`
  - `showSplit(focus = false) → Promise`: shows the current tab's partner, or hides the pane.
  - `hideSplitPane() → void`
  - `syncSplitPane() → void`: calls `showSplit()` only if the pane shows the wrong thing.
  - `openSplit(path?, { focus }) → Promise`: sets the current tab's partner and shows it.
  - `closeSplit() → Promise`: closes the right note.
  - `swapSplit() → Promise`
  - `SPLIT.seq`
  - `splitFileMoved` is removed.

- [ ] **Step 1: Write the failing browser tests.** Create `ui/test/e2e/splittabs.js`. Later tasks add their blocks just before the `// ---- end` line.

```js
// Split tabs: a tab can hold a second file on the right, and the pair lives in the tab bar as one group.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const FIX = __dirname + '/fixtures';
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const rd = p => fs.readFileSync(path.join(VAULT, p), 'utf8');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
(async () => {
  w('Draft.md', '# Draft\n\nWriting here.\n');
  w('Sources.md', '# Sources\n\n- Book one\n');
  w('Extra.md', '# Extra\n');
  w('Links.md', '# Links\n\nGo to [[Sources]] now.\n');
  w('Scratch.md', '# Scratch\n');
  w('Temp.md', '# Temp\n');
  w('Old/Ref.md', '# Ref\n');
  w('notes.txt', 'plain text\n');
  w('pic.png', fs.readFileSync(FIX + '/red.png'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const tabs = () => page.evaluate(() => S.tabs.map(t => [t.key, t.split]));
  const shown = () => page.evaluate(() => $('#split') && !$('#split').hidden ? SPLIT.path : null);
  // Replace every tab with these [left, right] pairs and show the first.
  const reset = async gs => { await page.evaluate(async gs => { S.tabs = gs.map(([k, s]) => Object.assign(newTabObj(k), { split: s })); S.tab = -1; await activateTab(0, { force: true }); }, gs); await sleep(400); };

  // A tab owns its partner: switching away hides it, switching back shows it.
  await page.evaluate(() => openPath('Draft.md')); await sleep(300);
  await page.evaluate(() => openSplit('Sources.md')); await sleep(400);
  assert(same(await tabs(), [['Draft.md', 'Sources.md']]), 'Open to the right gives the current tab a partner');
  await page.evaluate(() => openInNewTab('Extra.md')); await sleep(400);
  assert(await shown() === null, 'a tab without a partner hides the split pane');
  await page.evaluate(() => activateTab(0)); await sleep(400);
  assert(await shown() === 'Sources.md' && await page.evaluate(() => S.cur) === 'Draft.md', 'switching back brings the group back');
  assert(same(await page.evaluate(() => store('tabs')), { keys: ['Draft.md', 'Extra.md'], splits: ['Sources.md', null], active: 0 }), 'partners are saved with the tabs');
  await page.reload(); await sleep(1200);
  assert(same(await tabs(), [['Draft.md', 'Sources.md'], ['Extra.md', null]]) && await shown() === 'Sources.md', 'groups come back after a restart');
  // The old single split pane setting becomes the active tab's partner, once.
  await page.evaluate(() => { store('tabs', { keys: ['Extra.md'], active: 0 }); store('split', 'Draft.md'); });
  await page.reload(); await sleep(1200);
  assert(same(await tabs(), [['Extra.md', 'Draft.md']]) && await page.evaluate(() => store('split')) === null, "the old split pane setting joins the active tab and is cleared");
  // Quick switches between groups end on the right partner, with one editor.
  await reset([['Draft.md', 'Sources.md'], ['Extra.md', 'Links.md'], ['Scratch.md', null]]);
  await page.evaluate(() => { activateTab(1); activateTab(0); activateTab(1); }); await sleep(1000);
  assert(await shown() === 'Links.md' && await page.$$eval('#split .cm-editor', x => x.length) === 1, 'quick tab switches end on the right partner, with one editor');
  // Renames follow a partner, folders included; deletes turn a group back into an ordinary tab.
  await reset([['Scratch.md', 'Old/Ref.md']]);
  await page.evaluate(() => renamePath('Old/Ref.md', 'Old/Ref2.md')); await sleep(800);
  assert(same(await tabs(), [['Scratch.md', 'Old/Ref2.md']]) && await shown() === 'Old/Ref2.md', 'a renamed partner stays in its group');
  await page.evaluate(() => renamePath('Old', 'Archive')); await sleep(800);
  assert(same(await tabs(), [['Scratch.md', 'Archive/Ref2.md']]) && await shown() === 'Archive/Ref2.md', 'and follows a renamed folder');
  await page.evaluate(() => deletePath('Archive/Ref2.md', { confirm: false })); await sleep(700);
  assert(same(await tabs(), [['Scratch.md', null]]) && await shown() === null, 'a deleted partner leaves an ordinary tab');
  await reset([['Temp.md', 'Scratch.md']]);
  await page.evaluate(() => deletePath('Temp.md', { confirm: false })); await sleep(700);
  assert(same(await tabs(), [['Scratch.md', null]]) && await page.evaluate(() => S.cur) === 'Scratch.md' && await shown() === null, 'a deleted left note hands over to its partner');

  // ---- end
  await page.screenshot({ path: OUT + '/splittabs.png' });
  assert(errors.length === 0, 'no page errors ' + errors.join('; '));
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
```

- [ ] **Step 2: Run the new suite to check it fails.**

Run: `ui/test/e2e/run.sh splittabs`
Expected: `✗ splittabs (0 passed before it failed)` with `ASSERT: Open to the right gives the current tab a partner`. Today `S.tabs[0].split` is `undefined`.

- [ ] **Step 3: Give tabs a partner in `ui/app/tabs.js`.**

Replace the comment block above `S.tabs` (lines 4–6) and `newTabObj` (line 10) with:

```js
// Each tab shows one thing: a file, the graph (':graph'), tasks (':tasks'), or nothing (null).
// A tab has its own back/forward history (swapped in and out of S.hist), and a note keeps its
// editor state, undo history included, while it's open in a tab. A tab can also hold a second
// file on the right, its `split` (see tab-groups.js), shown in the split pane.
```
```js
const newTabObj = key => ({ id: ++tabSeq, key, split: null, splitMode: 'edit', hist: key ? [key] : [], histIdx: key ? 0 : -1 });
```

In `syncTab()`, after `saveTabs(); renderTabs();`, add `syncSplitPane();`. It becomes:

```js
function syncTab() {
  if (!S.tabs.length) { S.tabs.push(newTabObj(null)); S.tab = 0; }
  const t = curTab();
  t.key = viewKey(); t.hist = S.hist; t.histIdx = S.histIdx;
  pruneEdStates();
  saveTabs(); renderTabs();
  syncSplitPane();
}
```

Replace `saveTabs`:

```js
function saveTabs() { store('tabs', tabsToStore(S.tabs, S.tab)); }
```

In `tabsAfterRename(moved)`, add `groupsAfterRename(S.tabs, moved);` as its first line. In `tabsAfterDelete()`, add `groupsAfterDelete(S.tabs, p => S.files.has(p));` as its first line.

Replace `restoreTabs`:

```js
// Start with the tabs from last time (or the last file, in one tab). Before tabs had partners
// there was one split pane, saved on its own: it joins the tab that was active, once.
async function restoreTabs() {
  const exists = p => S.files.has(p), legacy = store('split');
  let { tabs, active } = tabsFromStore(store('tabs'), exists, legacy ?? null);
  if (!tabs.length) {
    const last = store('last');
    tabs = [tabFromSaved(last && exists(last) ? last : null, legacy ?? null, exists)];
    active = 0;
  }
  if (legacy != null) store('split', null);
  S.tabs = tabs.map(x => Object.assign(newTabObj(x.key), { split: x.split }));
  S.tab = -1;
  await activateTab(active, { force: true, focus: false });
}
```

- [ ] **Step 4: Make the split pane show the current tab's partner.** In `ui/app/split.js`, replace the file header comment and `const SPLIT = …` with:

```js
/* Cinder app — the split pane: the current tab's partner, beside its main note. (One of the
 * ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.)
 *
 * A tab can hold a second file (its `split`, see tab-groups.js); this pane shows the current
 * tab's. Notes open in their own editor and save as you type; the same note open in both panes
 * stays in step. Images, drawings, canvases and bases show as previews. Links followed from the
 * split pane open in the main one. */

const SPLIT = { path: null, handle: null, mode: 'edit', seq: 0 };
```

After `SPLIT_ICONS`, add:

```js
// Can the split pane show this file? Notes, images, drawings, canvases and bases.
const canSplit = p => !!p && S.files.has(p) && ((isMd(p) && !isDrawing(p) && S.notes.has(p)) || IMG_EXT.test(p) || visualEmbed(p));
```

In `splitDom()`'s click handler, change the `mode` branch to:

```js
    else if (a === 'mode') { const t = curTab(); if (t) { t.splitMode = t.splitMode === 'read' ? 'edit' : 'read'; showSplit(); } }
```

Replace everything from `// Show \`path\` in the split pane` down to the end of `swapSplit` with:

```js
// Give the current tab `path` as its partner and show it (asking which file when none is given).
// A partner it replaces gets a tab of its own.
async function openSplit(path, { focus = false } = {}) {
  if (!path) {
    const files = [...S.files.keys()];
    path = await picker({ placeholder: 'Open beside this one…', items: q => rank(files, q, displayName).map(p => ({ main: displayName(p), sub: dirname(p), value: p })) });
    if (!path) return;
    focus = true;
  }
  if (!S.files.has(path)) return toast('Not found: ' + path);
  const t = curTab();
  if (!t) return;
  if (t.split !== path) t.splitMode = 'edit';
  setPartner(S.tabs, t, path, newTabObj);
  saveTabs(); renderTabs();
  await showSplit(focus);
}

// Show the current tab's partner, or hide the pane when it has none. The editor it replaces saves
// first. Only the latest call finishes, so quick tab switches can't leave two editors behind.
async function showSplit(focus = false) {
  const seq = ++SPLIT.seq;
  const old = SPLIT.handle;
  SPLIT.handle = null;
  await old?.destroy?.();
  if (seq !== SPLIT.seq) return;
  const t = curTab(), path = t?.split || null;
  SPLIT.path = path;
  if (!path) return hideSplitPane();
  SPLIT.mode = t.splitMode || 'edit';
  const el = splitDom(), body = $('.split-body', el);
  el.hidden = false; $('#resize-split').hidden = false;
  document.body.classList.add('has-split');
  $('.split-title', el).textContent = displayName(path);
  $('.split-title', el).title = path;
  const note = isMd(path) && !isDrawing(path) && S.notes.has(path);
  const mb = $('[data-split=mode]', el);
  mb.hidden = !note;
  mb.innerHTML = SPLIT.mode === 'edit' ? SPLIT_ICONS.read : SPLIT_ICONS.edit;
  mb.title = SPLIT.mode === 'edit' ? 'Reading view' : 'Edit';
  body.innerHTML = '';
  if (note && SPLIT.mode === 'edit') {
    const page = document.createElement('div');
    page.className = 'page split-page split-editor';
    body.append(page);
    SPLIT.handle = mountCardEditor(page, {
      notePath: path,
      onExit: () => focusMain(),
      // What's saved here shows in the main pane too, if it has the same note open.
      onSaved: text => { if (S.cur === path && S.view === 'note' && !S.dirty && ed.value !== text) { reloadEditorFromDisk(text); } },
    });
    if (focus) SPLIT.handle?.focus();
  } else if (note) {
    const box = document.createElement('div');
    box.className = 'markdown split-read page';
    renderInto(box, S.notes.get(path).content, path, 1);
    body.append(box);
  } else if (IMG_EXT.test(path)) {
    body.innerHTML = `<div class="split-media"><img src="${rawUrl(path)}" alt=""></div>`;
  } else if (visualEmbed(path)) {
    const box = document.createElement('div');
    box.className = 'split-media';
    body.append(box);
    renderVisualEmbed(box, path);
  } else body.innerHTML = '<div class="none">This kind of file can’t be shown in the split pane.</div>';
  if (S.view === 'graph') CinderGraph.resize();
}

function hideSplitPane() {
  const el = $('#split');
  if (el) { el.hidden = true; $('#resize-split').hidden = true; }
  document.body.classList.remove('has-split');
  if (S.view === 'graph') CinderGraph.resize();
}

// After anything that may have changed the current tab's partner: a tab switch, a rename, a delete.
function syncSplitPane() {
  const want = curTab()?.split || null, el = $('#split');
  if (want !== (el && !el.hidden ? SPLIT.path : null)) showSplit();
}

// Close the note on the right; the tab carries on with its left one.
async function closeSplit() {
  const t = curTab();
  if (!t?.split) return;
  closePane(t, 'right');
  saveTabs(); renderTabs();
  await showSplit();
}

// Swap the two panes' notes. The right one moves into the main editor, so its edits save first.
async function swapSplit() {
  const t = curTab();
  if (!t?.split) return toast('Nothing is open in the split pane');
  if (!canSplit(t.key)) return toast('This can’t be shown in the split pane');
  await SPLIT.handle?.save?.();
  await save();
  swapPanes(t, canSplit);
  saveTabs(); renderTabs();
  await openPath(t.key);
}
```

Keep `splitNoteChanged` and `splitFollowMain` as they are. Delete `splitFileMoved` (the last function in the file).

- [ ] **Step 5: Renames and deletes sync the pane.** In `ui/app/files.js` `renamePath`, replace `splitFileMoved(from, to);` with `syncSplitPane();`. In `deletePath`, replace:

```js
  splitFileMoved(path, null);
  if (S.cur && !S.files.has(S.cur)) { S.cur = null; showEmpty(); }
```
with:
```js
  // A deleted left note hands over to its partner (tabsAfterDelete); otherwise the tab empties.
  if (S.cur && !S.files.has(S.cur)) {
    const k = curTab()?.key;
    if (k && S.files.has(k)) await openPath(k); else { S.cur = null; showEmpty(); }
  }
  syncSplitPane();
```

- [ ] **Step 6: Stop restoring the global split at startup.** In `ui/app/boot.js`, delete the line `{ const sp = store('split'); if (sp && S.files.has(sp)) openSplit(sp); }`. `restoreTabs` now handles it.

- [ ] **Step 7: Run the new suite and the old split suite.**

Run: `node ui/test/app.test.js && (cd ui/editor && npm run typecheck) && ui/test/e2e/run.sh splittabs split`
Expected: `✓ splittabs (12 checks)` and `✓ split (14 checks)`. The old suite's swap button now calls the new `swapSplit`, and its close button calls `closeSplit`, so it passes unchanged.

- [ ] **Step 8: Commit.**

```bash
git add ui/app/tabs.js ui/app/split.js ui/app/files.js ui/app/boot.js ui/test/e2e/splittabs.js
git commit -m "Split tabs: each tab owns its partner file, saved with the tabs

Switching tabs shows or hides the split pane, groups survive a restart,
the old global split converts once, and renames and deletes follow.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 3: The tab bar spans both panes

**Files:**
- Modify: `ui/index.html:77-78` and `:140-141` (wrap the tab bar and `#main`)
- Modify: `ui/style.css:160` (layout) and `:1462` (remove the split header's window-button padding)
- Modify: `ui/test/e2e/splittabs.js` (add a block before `// ---- end`)

**Interfaces:**
- Consumes: `showSplit`/`openSplit` from Task 2.
- Produces: `#workspace` (a column: `#tabbar`, then `#panes`) and `#panes` (a row: `#main`, `#resize-split`, `#split`). Tasks 5 and 6 attach drag handlers to `#panes`.

- [ ] **Step 1: Write the failing test.** In `ui/test/e2e/splittabs.js`, add before `// ---- end`:

```js
  // The tab bar spans both panes, with the split pane below it.
  await reset([['Draft.md', 'Sources.md']]);
  const [tb, sp] = await page.evaluate(() => [$('#tabbar'), $('#split')].map(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
  assert(tb.r >= sp.r - 1 && sp.t >= tb.b - 1 && tb.l <= sp.l, 'the tab bar spans both panes, with the split pane below it');
```

- [ ] **Step 2: Run it to check it fails.**

Run: `ui/test/e2e/run.sh splittabs`
Expected: `ASSERT: the tab bar spans both panes`. Today the tab bar ends where `#main` ends.

- [ ] **Step 3: Wrap the markup.** In `ui/index.html`, move the `<nav id="tabbar">…</nav>` line out of `<main id="main">` and wrap it:

```html
  <div id="workspace">
    <nav id="tabbar">…unchanged…</nav>
    <div id="panes">
  <main id="main">
    <header id="viewbar">
```
Close both wrappers after `</main>`:
```html
    <footer id="statusbar"><span id="status-left"></span><span id="status-right"></span></footer>
  </main>
    </div>
  </div>
```
`splitDom()` already does `$('#main').after(handle, el)`, which now places the divider and the split pane inside `#panes`.

- [ ] **Step 4: Lay it out.** In `ui/style.css`, replace line 160 (`#main { … }`) with:

```css
#workspace { flex: 1; display: flex; flex-direction: column; min-width: 0; }
#panes { flex: 1; display: flex; min-height: 0; position: relative; }
#main { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; }
```
Delete the rule `.frame-custom.app-no-right .split-head { padding-right: 124px; }`. The window buttons now sit over the tab bar, which already reserves room for them (`.frame-custom.app-no-right #tabbar`).

- [ ] **Step 5: Run the suite and the ones that touch the layout.**

Run: `ui/test/e2e/run.sh splittabs split e2e1 e2e2 e2e3 keys keys2 focus present nativeui`
Expected: every line starts with `✓`.

- [ ] **Step 6: Commit.**

```bash
git add ui/index.html ui/style.css ui/test/e2e/splittabs.js
git commit -m "Layout: the tab bar spans the main and split panes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 4: The group tab, its menu, closing panes, and reopening groups

**Files:**
- Modify: `ui/app/tabs.js` (`renderTabs`, the context menu, `closeTab`, `closeTabs`, `reopenClosedTab`, `closedTabs`)
- Modify: `ui/app/split.js` (`splitDom` header and click handler, `SPLIT_ICONS`, plus new `closeLeftPane` and `separateSplit`)
- Modify: `ui/app/commands.js:152-153` (split commands)
- Modify: `ui/index.html` (`#viewbar`: add `#pane-close-left` at its end)
- Modify: `ui/style.css` (group tab, `#pane-close-left`, split header padding)
- Modify: `ui/test/e2e/splittabs.js`, `ui/test/e2e/split.js`

**Interfaces:**
- Consumes: `separateTab`, `closePane`, `tabFromSaved` (Task 1), and `showSplit`, `swapSplit`, `closeSplit` (Task 2).
- Produces:
  - `closeLeftPane() → Promise`
  - `separateSplit() → Promise`
  - `tabHtml(t, i) → string`
  - `closedTabs` entries become `{ key, split }`.

- [ ] **Step 1: Write the failing tests.** In `ui/test/e2e/splittabs.js`, add before `// ---- end`:

```js
  // A group is one tab with both names.
  const tab0 = '#tabbar .tab[data-i="0"]';
  await reset([['Draft.md', 'Sources.md'], ['Extra.md', null]]);
  assert(await page.$eval(tab0, el => el.classList.contains('group') && !!el.querySelector('.tab-sep') && [...el.querySelectorAll('.tab-name')].map(n => n.textContent).join('|') === 'Draft|Sources'), 'a group shows as one tab with both names');
  assert(await page.getAttribute(tab0, 'title') === 'Draft.md\nSources.md' && await page.getAttribute(tab0, 'aria-label') === 'Draft and Sources', 'its tooltip and label name both notes');
  assert(!(await page.$('[data-split=swap]')) && !(await page.$('[data-split=main]')), 'the split header has no swap or open-in-main buttons');
  assert(await page.isVisible('#pane-close-left'), 'the left pane has a close button in a group');
  await page.evaluate(() => activateTab(1)); await sleep(300);
  assert(!(await page.isVisible('#pane-close-left')), 'but not in an ordinary tab');
  await page.evaluate(() => activateTab(0)); await sleep(400);
  // Its menu swaps and separates.
  await page.click(tab0, { button: 'right' }); await sleep(150);
  await page.click('.menu >> text=Swap panes'); await sleep(600);
  assert(same(await tabs(), [['Sources.md', 'Draft.md'], ['Extra.md', null]]) && await page.evaluate(() => S.cur) === 'Sources.md' && await shown() === 'Draft.md', 'Swap panes trades the two notes');
  await page.click(tab0, { button: 'right' }); await sleep(150);
  await page.click('.menu >> text=Separate tabs'); await sleep(500);
  assert(same(await tabs(), [['Sources.md', null], ['Draft.md', null], ['Extra.md', null]]) && await shown() === null, 'Separate tabs gives the partner its own tab, right after');
  // Typing on the right, then swapping at once, keeps the typing.
  await reset([['Draft.md', 'Sources.md']]);
  await page.click('#split .cm-content'); await page.keyboard.press('Control+End'); await page.keyboard.type('\n- Typed then swapped');
  await page.evaluate(() => swapSplit()); await sleep(1500);
  assert(rd('Sources.md').includes('- Typed then swapped') && (await page.evaluate(() => ed.value)).includes('- Typed then swapped'), 'edits on the right survive a swap straight after typing');
  // Each pane's × closes that note.
  await reset([['Draft.md', 'Sources.md']]);
  await page.click('#split [data-split=close]'); await sleep(400);
  assert(same(await tabs(), [['Draft.md', null]]) && await shown() === null, "the right pane's × closes the right note");
  await reset([['Draft.md', 'Sources.md']]);
  await page.click('#pane-close-left'); await sleep(500);
  assert(same(await tabs(), [['Sources.md', null]]) && await page.evaluate(() => S.cur) === 'Sources.md' && await shown() === null, "the left pane's × closes the left note and the right one moves over");
  // The group's × closes both, and Reopen closed tab brings the group back.
  await reset([['Draft.md', 'Sources.md'], ['Extra.md', null]]);
  await page.click(`${tab0} .tab-x`); await sleep(400);
  assert(same(await tabs(), [['Extra.md', null]]), "the group tab's × closes both notes");
  await page.evaluate(() => reopenClosedTab()); await sleep(600);
  assert(same(await tabs(), [['Extra.md', null], ['Draft.md', 'Sources.md']]) && await shown() === 'Sources.md', 'Reopen closed tab brings the whole group back');
  // Closing the last tab when it's a group leaves one empty tab.
  await reset([['Draft.md', 'Sources.md']]);
  await page.evaluate(() => closeTab()); await sleep(400);
  assert(same(await tabs(), [[null, null]]) && await shown() === null, 'closing the last tab, a group, leaves one empty tab');
```

- [ ] **Step 2: Run it to check it fails.**

Run: `ui/test/e2e/run.sh splittabs`
Expected: `ASSERT: a group shows as one tab with both names`.

- [ ] **Step 3: Draw the group tab.** In `ui/app/tabs.js`, replace `renderTabs` with:

```js
// A tab in the bar. A group shows both names, "Draft │ Sources", each shortened on its own.
function tabHtml(t, i) {
  const title = k => k && !k.startsWith(':') ? k : tabName(k);
  const name = k => `<span class="tab-name">${esc(tabName(k))}</span>`;
  const names = t.split ? `${name(t.key)}<span class="tab-sep" aria-hidden="true"></span>${name(t.split)}` : name(t.key);
  const label = t.split ? ` aria-label="${esc(`${tabName(t.key)} and ${tabName(t.split)}`)}"` : '';
  return `<div class="tab${t.split ? ' group' : ''}${i === S.tab ? ' active' : ''}" data-i="${i}" draggable="true" title="${esc(t.split ? `${title(t.key)}\n${t.split}` : title(t.key))}"${label} role="tab" aria-selected="${i === S.tab}">${names}<button class="tab-x" tabindex="-1" title="Close (Ctrl+W)">×</button></div>`;
}
function renderTabs() {
  const bar = $('#tabbar .tabs-list');
  bar.innerHTML = S.tabs.map(tabHtml).join('');
  bar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
```

In the tab context menu, add after the `Duplicate tab` item:

```js
    ...(t.split ? [['Separate tabs', () => activateTab(i).then(() => separateSplit())], ['Swap panes', () => activateTab(i).then(() => swapSplit())]] : []),
```

- [ ] **Step 4: Closed groups come back whole.** In `ui/app/tabs.js`, change the `closedTabs` comment to `// { key, split }, for "Reopen closed tab"`. In `closeTab`, replace `if (t.key) closedTabs.push(t.key);` with `if (t.key || t.split) closedTabs.push({ key: t.key, split: t.split });`. In `closeTabs`, replace `&& t.key) closedTabs.push(t.key);` with `&& (t.key || t.split)) closedTabs.push({ key: t.key, split: t.split });`. Replace `reopenClosedTab` with:

```js
async function reopenClosedTab() {
  while (closedTabs.length) {
    const c = closedTabs.pop();
    const t = tabFromSaved(c.key, c.split, p => S.files.has(p));
    if (!t || (t.key == null && !t.split)) continue;
    await openInNewTab(t.key);
    if (t.split) await openSplit(t.split);
    return;
  }
  toast('No closed tabs to reopen');
}
```

- [ ] **Step 5: Close the left pane, separate, and a leaner split header.** In `ui/app/split.js`:
  - Remove `swap` and `main` from `SPLIT_ICONS`.
  - In `splitDom()`, set the header markup to:
    ```js
      el.innerHTML = `<header class="split-head"><span class="split-title"></span>
        <button class="ib" data-split="mode"></button><button class="ib" data-split="close" title="Close this note">${SPLIT_ICONS.close}</button></header>
        <div class="split-body"></div>`;
    ```
  - In its click handler, delete the `main` and `swap` branches.
  - After `closeSplit`, add:

```js
// Close the note on the left: the right one moves over and the tab carries on with it.
async function closeLeftPane() {
  const t = curTab();
  if (!t?.split) return;
  await SPLIT.handle?.save?.();
  await save();
  closePane(t, 'left');
  saveTabs(); renderTabs();
  await openPath(t.key);
}

// Separate tabs: the note on the right gets its own tab, right after this one.
async function separateSplit() {
  const t = curTab();
  if (!t?.split) return toast('Nothing is open in the split pane');
  separateTab(S.tabs, t, newTabObj);
  saveTabs(); renderTabs();
  await showSplit();
}

$('#pane-close-left').addEventListener('click', () => closeLeftPane());
```

- [ ] **Step 6: Add the left pane's × and the styles.** In `ui/index.html`, add as the last child of `<header id="viewbar">`:

```html
      <button class="ib" id="pane-close-left" title="Close this note"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button>
```
In `ui/style.css`, after the `.tab-x` rules, add:
```css
.tab.group { max-width: 320px; }
.tab.group .tab-name { flex: 1 1 0; }
.tab-sep { flex: none; width: 1px; height: 14px; margin: 0 4px; background: var(--faint); opacity: .7; }
#pane-close-left { display: none; }
body.has-split #pane-close-left { display: grid; }
```

- [ ] **Step 7: Rename the commands.** In `ui/app/commands.js`, replace the `split-close` and `split-swap` lines with:

```js
  ['split-close', 'Close the note on the right', '', () => closeSplit()],
  ['split-swap', 'Swap panes', '', () => swapSplit()],
  ['split-separate', 'Separate tabs', '', () => separateSplit()],
```

- [ ] **Step 8: Update the old split suite for the removed swap button.** In `ui/test/e2e/split.js`, replace `await page.click('[data-split=swap]'); await sleep(600);` with:

```js
  await page.click('#tabbar .tab.active', { button: 'right' }); await sleep(150);
  await page.click('.menu >> text=Swap panes'); await sleep(600);
```

- [ ] **Step 9: Run the suites.**

Run: `node ui/test/app.test.js && (cd ui/editor && npm run typecheck) && ui/test/e2e/run.sh splittabs split keys`
Expected: `✓ splittabs (26 checks)`, `✓ split (14 checks)` and `✓ keys (…)`.

- [ ] **Step 10: Commit.**

```bash
git add ui/app/tabs.js ui/app/split.js ui/app/commands.js ui/index.html ui/style.css ui/test/e2e/splittabs.js ui/test/e2e/split.js
git commit -m "Split tabs: one tab for a group, Separate tabs and Swap panes, close either pane

Closing a group and reopening it brings both notes back.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 5: Drag a tab onto the page

**Files:**
- Modify: `ui/app/split.js` (a new section at the end)
- Modify: `ui/app/tabs.js` (the `#tabbar` `dragend` listener)
- Modify: `ui/style.css` (after the split pane rules)
- Modify: `ui/test/e2e/splittabs.js`

**Interfaces:**
- Consumes: `canDropOnPage`, `dropOnPage` (Task 1), `canSplit`, `showSplit` (Task 2), `#panes` (Task 3), and `dragTab` (`ui/app/tabs.js:110`, the tab being dragged, or null).
- Produces:
  - `dropSide(e) → 'left' | 'right'`
  - `showDropOverlay(side | null) → void`
  - `joinByDrop(t, moving, side) → Promise`
  - `#drop-overlay` (classes `left`/`right`)

- [ ] **Step 1: Write the failing tests.** In `ui/test/e2e/splittabs.js`, add before `// ---- end`:

```js
  // Dragging a tab over the page lights up the half it will land in; dropping makes a group.
  const tabAt = i => page.$eval(`#tabbar .tab[data-i="${i}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const paneAt = fx => page.$eval('#panes', (el, fx) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height / 2 }; }, fx);
  const overlay = () => page.evaluate(() => { const o = $('#drop-overlay'); return o && !o.hidden ? `${o.className}:${o.textContent}` : null; });
  const dragFrom = async p => { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 20, p.y + 40, { steps: 5 }); };
  const moveTo = async p => { await page.mouse.move(p.x, p.y, { steps: 10 }); await sleep(150); };
  await reset([['Draft.md', null], ['Sources.md', null], ['Extra.md', null], [':graph', null], ['notes.txt', null]]);
  const draftText = await page.evaluate(() => ed.value);
  await dragFrom(await tabAt(1)); await moveTo(await paneAt(0.75));
  assert(await overlay() === 'right:Open on the right', 'dragging a tab over the right half lights it up');
  await moveTo(await paneAt(0.25));
  assert(await overlay() === 'left:Open on the left', 'and the left half');
  await moveTo(await paneAt(0.75)); await page.mouse.up(); await sleep(700);
  assert(same(await tabs(), [['Draft.md', 'Sources.md'], ['Extra.md', null], [':graph', null], ['notes.txt', null]]) && await shown() === 'Sources.md' && await overlay() === null, 'dropping on the right half makes a group, and the dragged tab leaves the bar');
  assert(await page.evaluate(() => ed.value) === draftText, "the dropped tab's name isn't typed into the note");
  // Onto a group's left half: the tab goes left, the left note moves right, the right note gets its own tab.
  await dragFrom(await tabAt(1)); await moveTo(await paneAt(0.25)); await page.mouse.up(); await sleep(700);
  assert(same(await tabs(), [['Extra.md', 'Draft.md'], ['Sources.md', null], [':graph', null], ['notes.txt', null]]) && await page.evaluate(() => S.cur) === 'Extra.md' && await shown() === 'Draft.md', "dropping on a group's left half pushes its right note out into its own tab");
  // No drop for the current tab, the graph, or a file the split pane can't show.
  for (const [i, what] of [[0, 'the tab you are on'], [2, 'the graph'], [3, 'a text file']]) {
    await dragFrom(await tabAt(i)); await moveTo(await paneAt(0.75));
    const o = await overlay(); await page.mouse.up(); await sleep(300);
    assert(o === null && same(await tabs(), [['Extra.md', 'Draft.md'], ['Sources.md', null], [':graph', null], ['notes.txt', null]]), `no drop for ${what}`);
  }
  // Beside the graph only the right half takes a drop.
  await page.evaluate(() => activateTab(2)); await sleep(500);
  await dragFrom(await tabAt(1)); await moveTo(await paneAt(0.25));
  const overGraphLeft = await overlay();
  await moveTo(await paneAt(0.75)); await page.mouse.up(); await sleep(700);
  assert(overGraphLeft === null && same(await tabs(), [['Extra.md', 'Draft.md'], [':graph', 'Sources.md'], ['notes.txt', null]]) && await shown() === 'Sources.md', 'beside the graph only the right half takes a drop');
```

- [ ] **Step 2: Run it to check it fails.**

Run: `ui/test/e2e/run.sh splittabs`
Expected: `ASSERT: dragging a tab over the right half lights it up`.

- [ ] **Step 3: Handle drops on the page.** At the end of `ui/app/split.js`, add:

```js
// ------------------------------------------------------------ dragging a tab onto the page

// The half of the panes the pointer is over.
function dropSide(e) {
  const r = $('#panes').getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? 'left' : 'right';
}
function showDropOverlay(side) {
  let o = $('#drop-overlay');
  if (!o && !side) return;
  if (!o) { o = document.createElement('div'); o.id = 'drop-overlay'; $('#panes').append(o); }
  o.hidden = !side;
  if (side) { o.className = side; o.textContent = side === 'left' ? 'Open on the left' : 'Open on the right'; }
}
// In the capture phase, so the editors and canvases under the pointer never see a dragged tab
// (CodeMirror would type its name into the note).
$('#panes').addEventListener('dragover', e => {
  if (!dragTab) return;
  e.stopPropagation();
  const side = dropSide(e);
  if (!canDropOnPage(curTab(), dragTab, side, canSplit)) return showDropOverlay(null);
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  showDropOverlay(side);
}, true);
$('#panes').addEventListener('dragleave', e => { if (dragTab && !$('#panes').contains(e.relatedTarget)) showDropOverlay(null); }, true);
$('#panes').addEventListener('drop', e => {
  if (!dragTab) return;
  e.stopPropagation(); e.preventDefault();
  showDropOverlay(null);
  const t = curTab(), moving = dragTab, side = dropSide(e);
  dragTab = null;
  if (canDropOnPage(t, moving, side, canSplit)) joinByDrop(t, moving, side);
}, true);

// The tab `moving` dropped on `side` of the current tab `t`: they become one group.
async function joinByDrop(t, moving, side) {
  await SPLIT.handle?.save?.();
  if (side === 'left') await save();
  const before = t.key;
  t.splitMode = 'edit';
  dropOnPage(S.tabs, t, moving, side, newTabObj);
  S.tab = S.tabs.indexOf(t);
  pruneEdStates(); saveTabs(); renderTabs();
  if (t.key !== before) await openPath(t.key); else await showSplit();
}
```

In `ui/app/tabs.js`, change the `#tabbar` `dragend` listener so it also clears the overlay:

```js
$('#tabbar').addEventListener('dragend', () => { dragTab = null; showDropOverlay(null); $$('#tabbar .drop-before, #tabbar .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); });
```

- [ ] **Step 4: Style the overlay.** In `ui/style.css`, after the split pane rules, add:

```css
#drop-overlay { position: absolute; top: 8px; bottom: 8px; width: calc(50% - 12px); z-index: 50; display: grid; place-items: center; border: 2px dashed var(--accent); border-radius: var(--radius-lg); background: var(--accent-soft); color: var(--accent); font-size: var(--text-ui); font-weight: 600; pointer-events: none; }
#drop-overlay.left { left: 8px; }
#drop-overlay.right { right: 8px; }
#drop-overlay[hidden] { display: none; }
```

- [ ] **Step 5: Run the suites.**

Run: `(cd ui/editor && npm run typecheck) && ui/test/e2e/run.sh splittabs split canvas`
Expected: `✓ splittabs (35 checks)`, `✓ split` and `✓ canvas`. The canvas suite covers the other drop targets inside `#panes`.

- [ ] **Step 6: Commit.**

```bash
git add ui/app/split.js ui/app/tabs.js ui/style.css ui/test/e2e/splittabs.js
git commit -m "Split tabs: drag a tab onto the left or right half of the page to split it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 6: Drag a pane's grip onto the tab bar

**Files:**
- Modify: `ui/app/split.js` (the split header grip, grip dragging, `detachByDrop`, blocking grip drops on the page)
- Modify: `ui/app/tabs.js` (the `#tabbar` `dragover`, `drop` and `dragend` listeners, plus a new `tabDropIndex`)
- Modify: `ui/app/window.js:55` (keep grips out of window dragging)
- Modify: `ui/index.html` (`#viewbar`: a grip as its first child)
- Modify: `ui/style.css` (`.pane-grip`, split header padding)
- Modify: `ui/test/e2e/splittabs.js`

**Interfaces:**
- Consumes: `detachPane` (Task 1), `showSplit` (Task 2), `showDropOverlay` (Task 5).
- Produces:
  - `dragPane: 'left' | 'right' | null`
  - `tabDropIndex(e) → number`
  - `detachByDrop(side, at) → Promise`
  - `.pane-grip[data-pane]`

- [ ] **Step 1: Write the failing tests.** In `ui/test/e2e/splittabs.js`, add before `// ---- end`:

```js
  // Each pane of a group has a grip; dragging it onto the tab bar gives that note its own tab there.
  const gripAt = sel => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const barEdge = (i, end) => page.$eval(`#tabbar .tab[data-i="${i}"]`, (el, end) => { const r = el.getBoundingClientRect(); return { x: end ? r.right - 4 : r.left + 4, y: r.top + r.height / 2 }; }, end);
  await reset([['Draft.md', 'Sources.md'], ['Extra.md', null]]);
  assert(await page.isVisible('#viewbar .pane-grip') && await page.isVisible('#split .pane-grip'), 'both panes of a group have a grip');
  await dragFrom(await gripAt('#split .pane-grip')); await moveTo(await barEdge(1, true)); await page.mouse.up(); await sleep(600);
  assert(same(await tabs(), [['Draft.md', null], ['Extra.md', null], ['Sources.md', null]]) && await shown() === null, "dragging the right pane's grip onto the tab bar gives that note its own tab where it's dropped");
  assert(!(await page.isVisible('#viewbar .pane-grip')), 'an ordinary tab shows no grip');
  await reset([['Draft.md', 'Sources.md'], ['Extra.md', null]]);
  await dragFrom(await gripAt('#viewbar .pane-grip')); await moveTo(await barEdge(0, false)); await page.mouse.up(); await sleep(700);
  assert(same(await tabs(), [['Draft.md', null], ['Sources.md', null], ['Extra.md', null]]) && await page.evaluate(() => [S.tab, S.cur]).then(x => same(x, [1, 'Sources.md'])), "dragging the left pane's grip out leaves the group showing its right note");
  // A grip dropped on the page does nothing, and types nothing.
  await reset([['Draft.md', 'Sources.md']]);
  const before = await page.evaluate(() => ed.value);
  await dragFrom(await gripAt('#split .pane-grip')); await moveTo(await paneAt(0.25)); await page.mouse.up(); await sleep(400);
  assert(same(await tabs(), [['Draft.md', 'Sources.md']]) && await page.evaluate(() => ed.value) === before, 'a grip dropped on the page does nothing');
  // With the custom title bar, pressing a grip doesn't start a window drag (which would block the drag).
  const blocked = await page.evaluate(() => { document.body.classList.add('frame-custom'); const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }); $('#viewbar .pane-grip').dispatchEvent(ev); document.body.classList.remove('frame-custom'); return ev.defaultPrevented; });
  assert(blocked === false, "a grip isn't a window-drag area");
```

- [ ] **Step 2: Run it to check it fails.**

Run: `ui/test/e2e/run.sh splittabs`
Expected: `ASSERT: both panes of a group have a grip`.

- [ ] **Step 3: Add the grips.** In `ui/index.html`, add as the first child of `<header id="viewbar">`:

```html
      <span class="pane-grip" data-pane="left" draggable="true" title="Drag onto the tab bar to give this note its own tab">⠿</span>
```
In `ui/app/split.js` `splitDom()`, put the same grip first in the header, with `data-pane="right"`:
```js
  el.innerHTML = `<header class="split-head"><span class="pane-grip" data-pane="right" draggable="true" title="Drag onto the tab bar to give this note its own tab">⠿</span><span class="split-title"></span>
    <button class="ib" data-split="mode"></button><button class="ib" data-split="close" title="Close this note">${SPLIT_ICONS.close}</button></header>
    <div class="split-body"></div>`;
```
In `ui/style.css`, add after the `#pane-close-left` rules, and change `.split-head`'s `padding: 0 6px 0 14px` to `padding: 0 6px`:
```css
.pane-grip { display: none; flex: none; width: 18px; height: 24px; place-items: center; color: var(--faint); font-size: 13px; cursor: grab; user-select: none; }
.pane-grip:hover { color: var(--text); }
body.has-split .pane-grip { display: grid; }
```

- [ ] **Step 4: Keep grips out of window dragging.** In `ui/app/window.js`, add `.pane-grip` to the list of things that don't drag the window:

```js
  if (!e.target.closest(DRAG_AREAS) || e.target.closest('button, input, select, a, .tab, .pane-grip, #crumbs, [contenteditable]')) return;
```

- [ ] **Step 5: Drag grips, and drop them on the tab bar.** At the end of `ui/app/split.js`, add:

```js
// ------------------------------------------------------------ dragging a pane's grip onto the tab bar

let dragPane = null; // 'left' or 'right' while a pane's grip is being dragged
document.addEventListener('dragstart', e => {
  const g = e.target.closest?.('.pane-grip');
  if (!g) return;
  dragPane = g.dataset.pane;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('application/x-cinder-pane', dragPane);
});
document.addEventListener('dragend', () => { dragPane = null; });

// A pane's grip dropped on the tab bar at `at`: that pane's note gets its own tab there.
async function detachByDrop(side, at) {
  const t = curTab();
  if (!t?.split) return;
  await SPLIT.handle?.save?.();
  if (side === 'left') await save();
  const before = t.key;
  detachPane(S.tabs, t, side, at, newTabObj);
  S.tab = S.tabs.indexOf(t);
  saveTabs(); renderTabs();
  if (t.key !== before) await openPath(t.key); else await showSplit();
}
```

In the Task 5 `#panes` listeners, stop grip drags from reaching the editors too. Replace the first lines of the `dragover` and `drop` handlers:

```js
$('#panes').addEventListener('dragover', e => {
  if (!dragTab && !dragPane) return;
  e.stopPropagation();
  if (dragPane) return;
  const side = dropSide(e);
```
```js
$('#panes').addEventListener('drop', e => {
  if (!dragTab && !dragPane) return;
  e.stopPropagation(); e.preventDefault();
  showDropOverlay(null);
  if (dragPane) return;
  const t = curTab(), moving = dragTab, side = dropSide(e);
```

In `ui/app/tabs.js`, replace the `#tabbar` `dragover`, `drop` and `dragend` listeners with:

```js
// Where a drop on the tab bar lands: an index into S.tabs.
function tabDropIndex(e) {
  const tab = e.target.closest('.tab');
  if (!tab) return S.tabs.length;
  const r = tab.getBoundingClientRect();
  return +tab.dataset.i + (e.clientX < r.left + r.width / 2 ? 0 : 1);
}
$('#tabbar').addEventListener('dragover', e => {
  if (!dragTab && !dragPane) return;
  const tab = e.target.closest('.tab');
  e.preventDefault();
  $$('#tabbar .tab.drop-before, #tabbar .tab.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  if (tab) { const r = tab.getBoundingClientRect(); tab.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after'); }
});
$('#tabbar').addEventListener('drop', e => {
  if (!dragTab && !dragPane) return;
  e.preventDefault();
  const to = tabDropIndex(e);
  $$('#tabbar .drop-before, #tabbar .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  // A pane's grip: that note leaves its group for a tab of its own here.
  if (dragPane) { const side = dragPane; dragPane = null; return detachByDrop(side, to); }
  const cur = curTab(), moving = dragTab;
  const from = S.tabs.indexOf(moving);
  S.tabs.splice(from, 1);
  S.tabs.splice(to > from ? to - 1 : to, 0, moving);
  S.tab = S.tabs.indexOf(cur);
  dragTab = null; saveTabs(); renderTabs();
});
$('#tabbar').addEventListener('dragend', () => { dragTab = null; showDropOverlay(null); $$('#tabbar .drop-before, #tabbar .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); });
```

- [ ] **Step 6: Run the suites.**

Run: `(cd ui/editor && npm run typecheck) && ui/test/e2e/run.sh splittabs split nativeui`
Expected: `✓ splittabs (41 checks)`, `✓ split` and `✓ nativeui`.

- [ ] **Step 7: Commit.**

```bash
git add ui/app/split.js ui/app/tabs.js ui/app/window.js ui/index.html ui/style.css ui/test/e2e/splittabs.js
git commit -m "Split tabs: drag a pane's grip onto the tab bar to give that note its own tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 7: Ctrl+Alt+click opens a link in the other pane

**Files:**
- Modify: `ui/editor/editor.js:713`, then rebuild `ui/vendor/editor.bundle.js`
- Modify: `ui/app/core.js:218-223` (the main editor's hooks)
- Modify: `ui/app/tasks.js:217-227` (`followLink`)
- Modify: `ui/app/markdown.js:272-276` (link clicks in reading view)
- Modify: `docs/superpowers/specs/2026-09-26-split-tabs-design.md` (unresolved links; see step 6)
- Modify: `ui/test/e2e/splittabs.js`

**Interfaces:**
- Consumes: `openSplit` (Task 2).
- Produces: `followLink(name, sub, from, { split })`. The editor hook `follow(name, sub, { other })` gets `other: true` for Ctrl+Alt+click. The canvas-card editor (the right pane) ignores it, so links there still open on the left.

- [ ] **Step 1: Write the failing tests.** In `ui/test/e2e/splittabs.js`, add before `// ---- end`:

```js
  // Ctrl+Alt+click on a link opens it in the other pane: reading view, then the editor.
  await reset([['Links.md', null]]);
  await page.evaluate(() => setMode('read')); await sleep(300);
  await page.click('#preview a.internal-link', { modifiers: ['Control', 'Alt'] }); await sleep(600);
  assert(same(await tabs(), [['Links.md', 'Sources.md']]) && await page.evaluate(() => S.cur) === 'Links.md', 'Ctrl+Alt+click on a link in reading view opens it on the right');
  await reset([['Links.md', null]]);
  await page.evaluate(() => setMode('edit')); await sleep(300);
  await page.click('#editor .cm-content [data-link="Sources"]', { modifiers: ['Control', 'Alt'] }); await sleep(600);
  assert(same(await tabs(), [['Links.md', 'Sources.md']]) && await page.evaluate(() => S.cur) === 'Links.md', 'and in the editor');
  // From the right pane, it opens on the left, like a plain click.
  await reset([['Extra.md', 'Links.md']]);
  await page.evaluate(() => { curTab().splitMode = 'read'; return showSplit(); }); await sleep(400);
  await page.click('#split a.internal-link', { modifiers: ['Control', 'Alt'] }); await sleep(600);
  assert(await page.evaluate(() => S.cur) === 'Sources.md' && await shown() === 'Links.md', 'from the right pane, Ctrl+Alt+click opens the link on the left');
```

- [ ] **Step 2: Run it to check it fails.**

Run: `ui/test/e2e/run.sh splittabs`
Expected: `ASSERT: Ctrl+Alt+click on a link in reading view opens it on the right`. Today the click opens Sources on the left.

- [ ] **Step 3: Tell the hook about Ctrl+Alt.** In `ui/editor/editor.js`, change line 713:

```js
    if (el.dataset.link != null) h.follow(el.dataset.link, el.dataset.sub || '', { other: e.altKey && (e.ctrlKey || e.metaKey) });
```
Rebuild the bundle:

Run: `cd ui/editor && npm run build && cd ../.. && git diff --stat ui/vendor/editor.bundle.js`
Expected: esbuild finishes, and the bundle shows as changed on one or a few lines (it's minified).

- [ ] **Step 4: The main editor sends Ctrl+Alt links to the right; followLink opens them there.** In `ui/app/core.js`, add a `follow` hook to the main editor's extras:

```js
const ed = CinderEditor.create($('#editor'), editorHooks(() => S.cur, {
  onChange: () => markDirty(),
  onCursor: () => cursorMoved(),
  // Ctrl+Alt+click opens the link in the other pane (the canvas-card editors don't have one).
  follow: (name, sub, o) => followLink(name, sub, S.cur, { split: !!o?.other }),
  onFiles: (files, pasted) => { (async () => { for (const f of files) await attachAndLink(f, pasted); })(); },
  focusTitle: () => { titleEl.focus(); titleEl.setSelectionRange(titleEl.value.length, titleEl.value.length); },
}), { vim: cfg.vim, focus: cfg.focusMode, typewriter: cfg.typewriter });
```
In `ui/app/tasks.js`, replace `followLink` with:
```js
// `split`: open it in the split pane, beside this note (Ctrl+Alt+click). A link to a note that
// doesn't exist yet creates it and opens it here either way.
async function followLink(name, sub, from, { split = false, ...opts } = {}) {
  const target = resolveLink(name, from);
  if (target) {
    if (split) return openSplit(target);
    if (target === S.cur && sub) return scrollToHeading(sub);
    return openPath(target, { heading: sub || undefined });
  }
  // Unresolved: create it (Obsidian behaviour).
  const clean = name.replace(/\.md$/i, '');
  const path = clean.includes('/') ? normPath(clean) + '.md' : join(cfg.newNoteFolder, clean + '.md');
  await createNote(path, '', { mode: 'edit', ...opts });
}
```
In `ui/app/markdown.js`'s document click handler, replace the `if (a) { … }` block with:
```js
  if (a) {
    e.preventDefault();
    // Ctrl+Alt+click: the other pane. From the split pane the other pane is the main one, where links open anyway.
    const split = e.altKey && (e.ctrlKey || e.metaKey) && !a.closest('#split');
    if (a.dataset.path) return split ? openSplit(a.dataset.href) : openPath(a.dataset.href);
    return followLink(a.dataset.href, a.dataset.sub, a.dataset.from || S.cur, { split });
  }
```

- [ ] **Step 5: Run the suites.**

Run: `node ui/test/app.test.js && (cd ui/editor && npm run typecheck) && ui/test/e2e/run.sh splittabs e2e1 embeds`
Expected: `✓ splittabs (44 checks)`, `✓ e2e1` and `✓ embeds`. The last two cover plain and Ctrl link clicks.

- [ ] **Step 6: Record the one change from the spec.** The spec says Ctrl+Alt+click on an unresolved link "creates the note as a plain click would, then opens it on the right". Creating a note always opens it in the main pane, so this plan keeps plain-click behaviour for unresolved links. In the spec's commands table, replace that sentence with: "An unresolved link creates the note and opens it on the left, as a plain click does."

- [ ] **Step 7: Commit.**

```bash
git add ui/editor/editor.js ui/vendor/editor.bundle.js ui/app/core.js ui/app/tasks.js ui/app/markdown.js ui/test/e2e/splittabs.js docs/superpowers/specs/2026-09-26-split-tabs-design.md
git commit -m "Split tabs: Ctrl+Alt+click on a link opens it in the other pane

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 8: README, the full regression, and a check in the real window

**Files:**
- Modify: `README.md:218` (the split pane paragraph), `:278` (the suite count), `:290` (the unit test list)

**Interfaces:**
- Consumes: everything above.
- Produces: user-facing docs.

- [ ] **Step 1: Describe the feature.** In `README.md`, replace the paragraph that starts `- **Split pane**:` with:

```markdown
- **Split tabs**: drag a tab onto the page to see it beside the note you're on. Drop it on the right half to put it on the right, or on the left half to put it on the left. The two become one tab, "Draft │ Sources", which you can switch away from and back to, and which comes back after a restart. You can also use *Open to the right* (a tab's or the file tree's right-click menu, or **Ctrl+Alt+\\** to pick a file), or **Ctrl+Alt+click** a link to open it in the other pane. Other links open in the left pane. A note on the right has its own editor and saves as you type, and the same note open on both sides stays in step. Images, drawings, canvases and bases show as previews. Each pane's × closes that note, and the tab's × closes both. Drag a pane's ⠿ grip onto the tab bar to give that note its own tab again, or right-click the tab for *Separate tabs* and *Swap panes*. Drag the divider to resize.
```
In the **Browser tests** paragraph, change `46 suites` to `47 suites`. In the paragraph that starts `` `cargo test` runs the Rust tests. The front-end tests run under plain Node: ``, add `` `node ui/test/tabgroups.test.js` `` to the list of test commands.

- [ ] **Step 2: Run the fast checks.**

Run: `cargo test -q 2>&1 | tail -2 && for f in ui/test/*.test.js; do node "$f" || exit 1; done && (cd ui/editor && npm run typecheck)`
Expected: `test result: ok`, an `ok …` line for every unit test file, and no type errors.

- [ ] **Step 3: Commit and push.**

```bash
git add README.md
git commit -m "README: split tabs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 4: Start the full browser regression in the background.** It takes about ten minutes, so run it in the background and don't wait on it.

Run (in the background): `ui/test/e2e/run.sh`
Expected: every suite shows `✓`. Fix anything that fails, rerun that suite alone, then commit and push.

- [ ] **Step 5: Check it in the native window (WebKitGTK).** The browser tests fire real mouse drags in Chromium only. Build and open the real window on the example vault, then have the user try it by hand:

Run: `cargo build && target/debug/cinder "$HOME/Documents/Cinder Example"`

Ask the user to check:
1. Dragging a tab onto each half of the page, including the overlay.
2. Dragging each pane's grip back onto the tab bar.
3. Ctrl+Alt+click on a link.
4. That both still work with **Settings → Window frame** set to Cinder's own title bar.

Record anything that fails here and fix it before merging.
```

