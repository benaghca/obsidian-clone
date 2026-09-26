/* Cinder app — bookmarks, shared with Obsidian through .obsidian/bookmarks.json. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ bookmarks

// Items use Obsidian's shapes: {type:'file', path, subpath?:'#Heading', title?}, {type:'folder', path},
// {type:'search', query}, {type:'url', url, title}, {type:'graph'}, and {type:'group', title, items}.
// Every item has a ctime, which also names groups for their open/closed state.
const BM = { items: [], obsidian: false, loaded: false };
let bmClosed = new Set(store('bookmarkClosed') || []);

async function loadBookmarks() {
  try {
    const r = await api('/api/bookmarks');
    BM.obsidian = !!r.obsidian;
    BM.items = BM.obsidian ? r.items : (store('bookmarks') || []);
  } catch { BM.items = store('bookmarks') || []; }
  BM.loaded = true;
  renderBookmarks();
}

async function saveBookmarks() {
  renderBookmarks();
  if (!BM.obsidian) { store('bookmarks', BM.items); return; }
  try { await api('/api/bookmarks', { method: 'PUT', body: JSON.stringify({ items: BM.items }) }); }
  catch (e) { toast('Couldn’t save bookmarks: ' + e.message); }
}

// Every item with the list it sits in: [{item, list, index}], groups before their contents.
function bmAll(list = BM.items, out = []) {
  list.forEach((item, index) => { out.push({ item, list, index }); if (item.type === 'group') bmAll(item.items || (item.items = []), out); });
  return out;
}
// Item from its address, "2" or "2.0.1" (indexes through groups).
function bmAt(addr) {
  let list = BM.items, item = null;
  for (const i of String(addr).split('.').map(Number)) { item = list[i]; if (!item) return null; list = item.items || []; }
  return item;
}
function bmParentList(addr) {
  const parts = String(addr).split('.').map(Number);
  parts.pop();
  return parts.length ? bmAt(parts.join('.')).items : BM.items;
}
const bmIsFile = (it, p) => (it.type === 'file' || it.type === 'folder') && it.path === p && !it.subpath;
const isBookmarked = p => bmAll().some(({ item }) => bmIsFile(item, p));

function bmTitle(it) {
  if (it.title) return it.title;
  switch (it.type) {
    case 'file': {
      const name = S.files.has(it.path) && (isDrawing(it.path) || isCanvas(it.path) || isBase(it.path)) ? displayName(it.path) : noteName(isMd(it.path) ? it.path : it.path.replace(/\.[^.]+$/, ''));
      return it.subpath ? `${name} › ${it.subpath.replace(/^#\^?/, '')}` : name;
    }
    case 'folder': return basename(it.path) || it.path;
    case 'search': return it.query;
    case 'url': return it.url;
    case 'graph': return 'Graph view';
    case 'group': return 'Group';
    default: return it.type;
  }
}

const BM_ICONS = {
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  url: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5"/>',
  graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="10" cy="18" r="2.5"/><path d="M8 7.5l7.5 1M16.5 10l-5 6M7 8.5l2.5 7"/>',
};
const bmIcon = it => `<svg class="bm-ic" viewBox="0 0 24 24">${BM_ICONS[it.type === 'file' && it.subpath ? 'heading' : it.type] || BM_ICONS.file}</svg>`;
const bmMissing = it => (it.type === 'file' && !S.files.has(it.path)) || (it.type === 'folder' && !S.dirs.has(it.path));
const bmGroupId = it => String(it.ctime ?? it.title);

function renderBookmarks() {
  const el = $('#bookmark-list');
  if (!el) return;
  const rows = [];
  const walk = (list, prefix, depth) => list.forEach((it, i) => {
    const addr = prefix + i, pad = `style="padding-left:${6 + depth * 14}px"`;
    if (it.type === 'group') {
      const open = !bmClosed.has(bmGroupId(it));
      rows.push(`<div class="t-row bm-row bm-group${open ? ' open' : ''}" draggable="true" tabindex="-1" data-bm="${addr}" ${pad}>${CHEV}<span class="name">${esc(it.title || 'Group')}</span><span class="bm-count">${(it.items || []).length}</span></div>`);
      if (open) walk(it.items || [], addr + '.', depth + 1);
    } else {
      const active = it.type === 'file' && it.path === S.cur && !it.subpath;
      rows.push(`<div class="t-row bm-row${active ? ' active' : ''}${bmMissing(it) ? ' missing' : ''}" draggable="true" tabindex="-1" data-bm="${addr}" ${pad} title="${esc(it.path || it.query || it.url || '')}">${bmIcon(it)}<span class="name">${esc(bmTitle(it))}</span></div>`);
    }
  });
  walk(BM.items, '', 0);
  el.innerHTML = rows.join('') || `<div class="none bm-empty">No bookmarks yet.<br>Bookmark the open file with the button above, from a file’s right-click menu or the note’s ⋯ menu, or drag files here.</div>`;
  el.insertAdjacentHTML('beforeend', '<div class="bm-end" data-bm-end></div>');
  const b = $('#panel-bookmarks [data-cmd=bookmark]');
  if (b) { const on = !!S.cur && isBookmarked(S.cur); b.setAttribute('aria-pressed', String(on)); b.title = on ? 'Remove the bookmark on the open file' : 'Bookmark the open file'; }
}

function toggleBookmark(p = S.cur) {
  if (!p) return;
  if (isBookmarked(p)) {
    for (const { item, list } of bmAll().reverse()) if (bmIsFile(item, p)) list.splice(list.indexOf(item), 1);
    toast('Bookmark removed');
  } else {
    BM.items.push({ type: S.dirs.has(p) && !S.files.has(p) ? 'folder' : 'file', ctime: Date.now(), path: p });
    toast('Bookmarked');
  }
  saveBookmarks();
}
function addBookmarks(paths) {
  let n = 0;
  for (const p of paths) {
    if (!p || isBookmarked(p) || (!S.files.has(p) && !S.dirs.has(p))) continue;
    BM.items.push({ type: S.files.has(p) ? 'file' : 'folder', ctime: Date.now() + n, path: p }); n++;
  }
  if (n) { saveBookmarks(); toast(`Bookmarked ${n} item${n > 1 ? 's' : ''}`); }
}
function bookmarkHeading(heading, p = S.cur) {
  if (!p || !heading) return;
  if (bmAll().some(({ item }) => item.type === 'file' && item.path === p && item.subpath === '#' + heading)) return toast('Already bookmarked');
  BM.items.push({ type: 'file', ctime: Date.now(), path: p, subpath: '#' + heading });
  saveBookmarks(); toast('Heading bookmarked');
}
function bookmarkSearch(q = $('#search-input')?.value.trim()) {
  if (!q) return toast('Search for something first');
  if (bmAll().some(({ item }) => item.type === 'search' && item.query === q)) return toast('Already bookmarked');
  BM.items.push({ type: 'search', ctime: Date.now(), query: q });
  saveBookmarks(); toast('Search bookmarked');
}
async function newBookmarkGroup(into = BM.items) {
  const title = await promptModal('New bookmark group', 'Name', '');
  if (!title) return;
  const g = { type: 'group', ctime: Date.now(), title, items: [] };
  into.push(g);
  saveBookmarks();
  return g;
}

async function openBookmark(it, newTab = false) {
  switch (it.type) {
    case 'file': {
      if (!S.files.has(it.path)) return toast(`Not found: ${it.path}`);
      const heading = it.subpath && !it.subpath.startsWith('#^') ? it.subpath.slice(1) : null;
      if (newTab) await openInNewTab(it.path); else await openPath(it.path);
      if (heading) scrollToHeading(heading);
      return;
    }
    case 'folder': return S.dirs.has(it.path) ? revealFolder(it.path) : toast(`Not found: ${it.path}`);
    case 'search': return searchFor(it.query);
    case 'url': return window.open(it.url, '_blank', 'noopener');
    case 'graph': return openGraph(false);
  }
}

// A folder bookmark opens the folder in the file tree and scrolls to it.
function revealFolder(dir) {
  showPanel('files', true);
  for (let d = dir; d; d = dirname(d)) S.expanded.add(d);
  store('expanded', [...S.expanded]);
  renderTree();
  const r = $(`#tree .t-row[data-dir="${CSS.escape(dir)}"]`);
  if (!r) return;
  r.scrollIntoView({ block: 'center' });
  r.classList.add('flash');
  setTimeout(() => r.classList.remove('flash'), 1200);
}

// Keep bookmarks pointing at files that move, and drop the ones whose file is deleted.
function bookmarksAfterRename(moved, from, to, isDir) {
  if (!BM.loaded) return;
  let changed = false;
  for (const { item } of bmAll()) {
    if (item.type === 'file' && moved.has(item.path)) { item.path = moved.get(item.path); changed = true; }
    else if (item.type === 'folder' && isDir && (item.path === from || item.path.startsWith(from + '/'))) { item.path = to + item.path.slice(from.length); changed = true; }
  }
  if (changed) saveBookmarks(); else renderBookmarks();
}
function bookmarksAfterDelete(path) {
  if (!BM.loaded) return;
  const gone = p => p === path || p.startsWith(path + '/');
  let changed = false;
  for (const { item, list } of bmAll().reverse()) {
    if ((item.type === 'file' || item.type === 'folder') && gone(item.path)) { list.splice(list.indexOf(item), 1); changed = true; }
  }
  if (changed) saveBookmarks();
}

$('#bookmark-list').addEventListener('click', e => {
  const row = e.target.closest('.bm-row');
  if (!row) return;
  const it = bmAt(row.dataset.bm);
  if (!it) return;
  if (it.type === 'group') {
    const id = bmGroupId(it);
    bmClosed.has(id) ? bmClosed.delete(id) : bmClosed.add(id);
    store('bookmarkClosed', [...bmClosed]);
    return renderBookmarks();
  }
  openBookmark(it, e.ctrlKey || e.metaKey);
});
$('#bookmark-list').addEventListener('auxclick', e => {
  const row = e.target.closest('.bm-row');
  if (e.button !== 1 || !row) return;
  const it = bmAt(row.dataset.bm);
  if (it?.type === 'file') { e.preventDefault(); openBookmark(it, true); }
});
$('#bookmark-list').addEventListener('keydown', e => {
  const row = e.target.closest('.bm-row');
  if (!row) { if (e.key === 'ArrowDown') { $('#bookmark-list .bm-row')?.focus(); e.preventDefault(); } return; }
  const rows = $$('#bookmark-list .bm-row'), i = rows.indexOf(row);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus(); e.preventDefault(); }
  else if (e.key === 'Enter' || e.key === ' ') { row.click(); e.preventDefault(); }
  else if (e.key === 'Delete') { const list = bmParentList(row.dataset.bm); list.splice(list.indexOf(bmAt(row.dataset.bm)), 1); saveBookmarks(); e.preventDefault(); }
  else if (e.key === 'F2') { renameBookmark(row.dataset.bm); e.preventDefault(); }
});

async function renameBookmark(addr) {
  const it = bmAt(addr);
  if (!it) return;
  const group = it.type === 'group';
  const v = await promptModal(group ? 'Rename group' : 'Bookmark title', group ? 'Name' : 'Title (empty: use the file’s name)', it.title || (group ? '' : bmTitle(it)));
  if (v == null) return;
  if (group && !v) return;
  if (!group && (!v || v === bmTitle({ ...it, title: '' }))) delete it.title; else it.title = v;
  saveBookmarks();
}
async function removeBookmark(addr) {
  const it = bmAt(addr), list = bmParentList(addr);
  if (!it) return;
  if (it.type === 'group' && it.items?.length && !(await confirmModal(`Remove the group “${it.title}”?`, `Its ${it.items.length} bookmark${it.items.length > 1 ? 's go' : ' goes'} too. The files themselves stay.`, { ok: 'Remove', danger: true }))) return;
  list.splice(list.indexOf(it), 1);
  saveBookmarks();
}

$('#bookmark-list').addEventListener('contextmenu', e => {
  e.preventDefault();
  const row = e.target.closest('.bm-row');
  if (!row) {
    return menu(e.clientX, e.clientY, [
      ...(S.cur && !isBookmarked(S.cur) ? [['Bookmark the open file', () => toggleBookmark()]] : []),
      ['New group…', () => newBookmarkGroup()],
    ]);
  }
  const addr = row.dataset.bm, it = bmAt(addr);
  if (!it) return;
  const items = [];
  if (it.type === 'group') {
    if (S.cur) items.push(['Add the open file here', () => { it.items.push({ type: 'file', ctime: Date.now(), path: S.cur }); bmClosed.delete(bmGroupId(it)); saveBookmarks(); }]);
    items.push(['New group inside…', () => newBookmarkGroup(it.items)], ['Rename…', () => renameBookmark(addr)], null, ['Remove group', () => removeBookmark(addr), 'danger']);
  } else {
    items.push(['Open', () => openBookmark(it)]);
    if (it.type === 'file') items.push(['Open in new tab', () => openBookmark(it, true)], ['Reveal in file tree', () => S.files.has(it.path) && revealInTree(it.path)]);
    items.push(null, ['Edit title…', () => renameBookmark(addr)]);
    const groups = bmAll().filter(x => x.item.type === 'group' && x.item !== it);
    if (groups.length || bmParentList(addr) !== BM.items) {
      items.push(['Move to group…', async () => {
        const choice = await picker({ placeholder: 'Move to group…', items: q => rank([{ main: '(top level)', value: -1 }, ...groups.map((g, i) => ({ main: g.item.title || 'Group', value: i }))], q, x => x.main) });
        if (choice == null) return;
        const list = bmParentList(addr);
        list.splice(list.indexOf(it), 1);
        (choice === -1 ? BM.items : groups[choice].item.items).push(it);
        saveBookmarks();
      }]);
    }
    items.push(null, ['Remove bookmark', () => removeBookmark(addr), 'danger']);
  }
  menu(e.clientX, e.clientY, items);
});

// Drag to reorder: the top half of a row drops before it, the bottom half after it; on a group,
// all but its top edge drops inside. The empty space below puts it last. Files dragged in from the
// file tree become bookmarks.
let bmDrag = null;
const bmClear = () => $$('#bookmark-list .drop, #bookmark-list .drop-after, #bookmark-list .drop-in').forEach(x => x.classList.remove('drop', 'drop-after', 'drop-in'));
function bmZone(row, e) {
  if (!row || !row.matches('.bm-row')) return null;
  const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
  if (row.classList.contains('bm-group')) return y < 0.3 ? 'before' : 'in';
  return y < 0.5 ? 'before' : 'after';
}
$('#bookmark-list').addEventListener('dragstart', e => {
  const row = e.target.closest('.bm-row');
  if (!row) return;
  bmDrag = row.dataset.bm;
  e.dataTransfer.setData('application/x-cinder-bookmark', bmDrag);
  e.dataTransfer.effectAllowed = 'move';
});
$('#bookmark-list').addEventListener('dragend', () => { bmDrag = null; bmClear(); });
$('#bookmark-list').addEventListener('dragover', e => {
  if (bmDrag == null && !e.dataTransfer.types.includes('text/plain')) return;
  e.preventDefault();
  bmClear();
  const row = e.target.closest('.bm-row, [data-bm-end]'), zone = bmZone(row, e);
  if (row) row.classList.add(zone === 'in' ? 'drop-in' : zone === 'after' ? 'drop-after' : 'drop');
});
$('#bookmark-list').addEventListener('drop', e => {
  e.preventDefault();
  bmClear();
  const row = e.target.closest('.bm-row'), zone = bmZone(row, e);
  const target = row && bmAt(row.dataset.bm);
  const dest = !target ? BM.items : zone === 'in' ? target.items : bmParentList(row.dataset.bm);
  // Where in `dest` to put things, worked out after the dragged item has left its old place.
  const place = () => !target || zone === 'in' ? dest.length : dest.indexOf(target) + (zone === 'after' ? 1 : 0);
  if (bmDrag != null) {
    const it = bmAt(bmDrag), from = bmParentList(bmDrag);
    bmDrag = null;
    if (!it || it === target) return;
    // A group can't go inside itself.
    if (it.type === 'group' && bmAll(it.items).some(x => x.item === target)) return;
    from.splice(from.indexOf(it), 1);
    dest.splice(place(), 0, it);
    if (zone === 'in') bmClosed.delete(bmGroupId(target));
    return saveBookmarks();
  }
  const paths = (e.dataTransfer.getData('text/plain') || '').split('\n').map(s => s.trim()).filter(p => S.files.has(p) || S.dirs.has(p));
  let n = 0, at = place();
  for (const p of paths) {
    if (bmAll().some(({ item }) => bmIsFile(item, p))) continue;
    dest.splice(at++, 0, { type: S.files.has(p) ? 'file' : 'folder', ctime: Date.now() + n, path: p }); n++;
  }
  if (n) saveBookmarks();
});
