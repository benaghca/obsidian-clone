/* Cinder app — tab groups. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.)
 *
 * A tab can hold a second file, shown in the split pane on its right. Its `key` is the left pane (a
 * file, ':graph', ':tasks', ':inbox' or null) and its `split` is the right pane's file, or null. A
 * tab with a `split` is a group. Only plain functions over tabs live here, with no page access, so
 * ui/test/tabgroups.test.js can load this file on its own. The callers pass `exists(path)`,
 * `canSplit(path)` (can the split pane show it) and `make(key)` (a new ordinary tab). */

function isFileTabKey(k) { return k != null && !k.startsWith(":"); }

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

// Can the file `path`, dragged from the file tree, be dropped on the `side` of the page showing
// `cur`? Only a file the split pane can show, and not onto the side that already shows it.
function canDropPathOnPage(cur, path, side, canSplit) {
  if (!cur || !canSplit(path)) return false;
  if (side === 'left') return path !== cur.key && canSplit(cur.key);
  return path !== cur.split;
}

// Drop the file `path` on `side` of `cur`: on the right it becomes the partner, on the left it
// takes the left and the current file moves right. A partner pushed out gets its own tab, returned.
function dropPathOnPage(tabs, cur, path, side, make) {
  if (side === 'right') return setPartner(tabs, cur, path, make);
  const out = cur.split ? make(cur.split) : null;
  cur.split = cur.key; cur.key = path;
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
