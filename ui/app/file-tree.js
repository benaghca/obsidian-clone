/* Cinder app — the file tree, including keyboard use and multi-select. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ file tree

function buildTree() {
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  const getDir = path => {
    let node = root;
    if (!path) return node;
    let acc = '';
    for (const part of path.split('/')) {
      acc = join(acc, part);
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, path: acc, dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    return node;
  };
  for (const d of S.dirs) getDir(d);
  for (const p of S.files.keys()) getDir(dirname(p)).files.push(p);
  return root;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const CHEV = '<svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';

function renderTree() {
  const root = buildTree();
  const rows = [];
  const walk = (node) => {
    const dirs = [...node.dirs.values()].sort((a, b) => collator.compare(a.name, b.name));
    for (const d of dirs) {
      const open = S.expanded.has(d.path);
      rows.push(`<div class="t-row folder${open ? ' open' : ''}" draggable="true" data-dir="${esc(d.path)}">${CHEV}<span class="name">${esc(d.name)}</span></div>`);
      if (open) { rows.push('<div class="t-kids">'); walk(d); rows.push('</div>'); }
    }
    const files = node.files.sort((a, b) => collator.compare(noteName(a), noteName(b)));
    for (const f of files) {
      const drawing = isDrawing(f), canvas = isCanvas(f), base = isBase(f);
      const ext = drawing ? '<span class="ext">draw</span>' : canvas ? '<span class="ext">canvas</span>' : base ? '<span class="ext">base</span>' : isMd(f) ? '' : `<span class="ext">${esc(f.split('.').pop())}</span>`;
      const name = drawing || canvas || base ? displayName(f) : noteName(isMd(f) ? f : f.replace(/\.[^.]+$/, ''));
      rows.push(`<div class="t-row file" draggable="true" data-path="${esc(f)}"><span class="spacer"></span><span class="name">${esc(name)}</span>${ext}</div>`);
    }
  };
  walk(root);
  $('#tree').innerHTML = rows.join('') + '<div class="tree-root-drop" data-dir=""></div>';
  renderTreeActive();
  if (treeCursor) treeRow(treeCursor)?.classList.add('kb');
  refreshInboxSoon(); // files moved, made or deleted
  updateTreeButtons();
  for (const k of [...treeSel]) { const r = treeRow(k); if (r) r.classList.add('sel'); else treeSel.delete(k); }
}

// ------------------------------------------------------------ expand / collapse all, auto-reveal

function allFolders() {
  const out = new Set();
  const add = d => { for (; d; d = dirname(d)) out.add(d); };
  for (const d of S.dirs) add(d);
  for (const p of S.files.keys()) add(dirname(p));
  return out;
}
const anyExpanded = () => { const all = allFolders(); return [...S.expanded].some(d => all.has(d)); };
function setAllExpanded(open) {
  S.expanded.clear();
  if (open) for (const d of allFolders()) S.expanded.add(d);
  store('expanded', [...S.expanded]);
  renderTree();
  if (open) renderTreeActive(true);
}
function toggleAutoReveal() {
  cfg.autoReveal = !cfg.autoReveal; saveCfg();
  updateTreeButtons();
  toast(cfg.autoReveal ? 'The file tree follows the open file' : 'Auto-reveal is off');
  if (cfg.autoReveal) renderTreeActive(true);
}
// The header's toggle shows what a click does next: collapse when anything is open, else expand.
function updateTreeButtons() {
  const ex = $('#panel-files [data-cmd=toggle-expand]'), ar = $('#panel-files [data-cmd=auto-reveal]');
  if (ex) {
    const open = anyExpanded();
    ex.title = open ? 'Collapse all' : 'Expand all';
    ex.innerHTML = `<svg viewBox="0 0 24 24"><path d="${open ? 'm7 20 5-5 5 5M7 4l5 5 5-5' : 'm7 15 5 5 5-5M7 9l5-5 5 5'}"/></svg>`;
  }
  if (ar) { ar.setAttribute('aria-pressed', String(!!cfg.autoReveal)); ar.title = cfg.autoReveal ? 'Auto-reveal the open file: on' : 'Auto-reveal the open file: off'; }
}

// ------------------------------------------------------------ file tree keyboard

// The row the keyboard is on ('d:<dir>' or 'f:<file>'), kept across re-renders.
let treeCursor = null, treeTyped = '', treeTypedAt = 0;
// Rows picked with Ctrl/Cmd-click, Shift-click or Shift+arrows, to move, group or delete together.
const treeSel = new Set();
const selPaths = () => [...treeSel].map(k => k.slice(2));
function setTreeSel(keys) {
  treeSel.clear();
  for (const k of keys) treeSel.add(k);
  for (const r of $$('#tree .t-row')) r.classList.toggle('sel', treeSel.has(rowKey(r)));
}
// Rows from a to b (in the order shown).
function rowRange(a, b) {
  const rows = $$('#tree .t-row').filter(r => r.offsetParent);
  let i = rows.indexOf(a), j = rows.indexOf(b);
  if (i < 0) i = j;
  if (i > j) [i, j] = [j, i];
  return rows.slice(i, j + 1).map(rowKey);
}
let treeAnchor = null; // where a Shift-selection started
const rowKey = r => r.dataset.dir != null ? 'd:' + r.dataset.dir : 'f:' + r.dataset.path;
const treeRow = k => $(k.startsWith('d:') ? `#tree .t-row[data-dir="${CSS.escape(k.slice(2))}"]` : `#tree .t-row[data-path="${CSS.escape(k.slice(2))}"]`);
function setTreeCursor(r, scroll = true) {
  for (const x of $$('#tree .t-row.kb')) x.classList.remove('kb');
  treeCursor = r ? rowKey(r) : null;
  if (!r) return;
  r.classList.add('kb');
  if (scroll) r.scrollIntoView({ block: 'nearest' });
}
function focusTree() {
  showPanel('files', true); // (true: never toggles the sidebar closed)
  $('#tree').focus({ preventScroll: true });
  setTreeCursor((treeCursor && treeRow(treeCursor)) || $('#tree .t-row.active') || $('#tree .t-row'));
}
// Put the keyboard back on the page that's open.
function focusMain() {
  if (S.view === 'note') { if (S.mode === 'edit') ed.focus(); else $('#preview').focus({ preventScroll: true }); }
  else if (S.view === 'canvas') $('#view-canvas .cv-viewport')?.focus({ preventScroll: true });
  else if (S.view === 'drawing') $('#view-drawing .dr-canvas')?.focus({ preventScroll: true });
  else if (S.view === 'file') fileViewer?.focus();
  else $(`#view-${S.view} [tabindex], #view-${S.view} input, #view-${S.view} button`)?.focus({ preventScroll: true });
}
$('#tree').addEventListener('keydown', e => {
  const rows = $$('#tree .t-row').filter(r => r.offsetParent);
  let r = treeCursor && treeRow(treeCursor);
  if (!r || !r.offsetParent) r = null;
  const i = r ? rows.indexOf(r) : -1;
  const dir = r?.dataset.dir, path = r?.dataset.path;
  const target = path || dir;
  const mod = e.ctrlKey || e.metaKey;
  let done = true;
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') newNote(dir != null ? dir : path ? dirname(path) : '');
  else if (mod && e.key === 'Enter' && path) openInNewTab(path);
  else if (mod && !e.shiftKey && e.key.toLowerCase() === 'a') { setTreeSel(rows.map(rowKey)); }
  else if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && r) {
    // Shift+↑/↓ extends the selection from where it started.
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!treeAnchor || !treeRow(treeAnchor) || !treeSel.size) treeAnchor = rowKey(r);
    setTreeSel(rowRange(treeRow(treeAnchor), next)); setTreeCursor(next);
  }
  else if (e.key === 'Escape' && treeSel.size) setTreeSel([]);
  else if (e.key === 'Delete' && treeSel.size > 1) deleteMany(selPaths());
  else if (mod || e.altKey) done = false;
  else if (e.key === 'ArrowDown') setTreeCursor(rows[Math.min(rows.length - 1, i + 1)]);
  else if (e.key === 'ArrowUp') setTreeCursor(rows[Math.max(0, i - 1)] || rows[0]);
  else if (e.key === 'Home') setTreeCursor(rows[0]);
  else if (e.key === 'End') setTreeCursor(rows[rows.length - 1]);
  else if (e.key === 'PageDown' || e.key === 'PageUp') {
    const step = Math.max(1, Math.floor($('#tree').clientHeight / (r?.offsetHeight || 28)) - 1);
    setTreeCursor(rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'PageDown' ? step : -step)))]);
  }
  else if (e.key === 'ArrowRight' && dir != null) {
    if (!S.expanded.has(dir)) { S.expanded.add(dir); store('expanded', [...S.expanded]); renderTree(); }
    else setTreeCursor(rows[i + 1]);
  }
  else if (e.key === 'ArrowLeft' && r) {
    if (dir != null && S.expanded.has(dir)) { S.expanded.delete(dir); store('expanded', [...S.expanded]); renderTree(); }
    else { const up = dirname(target); if (up) setTreeCursor(treeRow('d:' + up)); }
  }
  else if ((e.key === 'Enter' || e.key === ' ') && r) {
    if (dir != null) { S.expanded.has(dir) ? S.expanded.delete(dir) : S.expanded.add(dir); store('expanded', [...S.expanded]); renderTree(); }
    else if (e.key === ' ') openPath(path).then(() => $('#tree').focus({ preventScroll: true })); // Space previews, staying in the tree
    else openPath(path).then(() => focusMain());
  }
  else if (e.key === 'F2' && r) renameDialog(target);
  else if (e.key === 'Delete' && r) deletePath(target);
  else if (e.key === 'Escape') focusMain();
  else if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && r) {
    const b = r.getBoundingClientRect();
    r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 24, clientY: b.bottom }));
  }
  else if (e.key.length === 1 && e.key !== ' ') {
    // Type the start of a name to jump to it.
    const now = Date.now();
    treeTyped = (now - treeTypedAt < 800 ? treeTyped : '') + e.key.toLowerCase();
    treeTypedAt = now;
    const name = x => x.querySelector('.name')?.textContent.toLowerCase() || '';
    const from = treeTyped.length > 1 ? i : i + 1;
    const hit = [...rows.slice(Math.max(0, from)), ...rows.slice(0, Math.max(0, from))].find(x => name(x).startsWith(treeTyped));
    if (hit) setTreeCursor(hit);
  }
  else done = false;
  if (done) { e.preventDefault(); e.stopPropagation(); }
});

// Mark the open file in the tree. With `reveal` (opening a file) and auto-reveal on, its folders
// open and the tree scrolls to it.
function renderTreeActive(reveal = false) {
  reveal = reveal && cfg.autoReveal;
  if (reveal && S.cur) {
    let d = dirname(S.cur), changed = false;
    while (d) { if (!S.expanded.has(d)) { S.expanded.add(d); changed = true; } d = dirname(d); }
    if (changed) { store('expanded', [...S.expanded]); renderTree(); }
  }
  for (const r of $$('#tree .t-row.active')) r.classList.remove('active');
  if (!S.cur) return;
  const row = $(`#tree .t-row[data-path="${CSS.escape(S.cur)}"]`);
  if (row) { row.classList.add('active'); if (reveal) row.scrollIntoView({ block: 'nearest' }); }
  renderBookmarks(); // (its open-file mark)
}

$('#tree').addEventListener('click', e => {
  const row = e.target.closest('.t-row');
  if (!row) return;
  if (e.ctrlKey || e.metaKey) {
    // Ctrl/Cmd-click picks rows (the open file joins the first time, like a file manager).
    if (!treeSel.size && S.cur && S.files.has(S.cur) && rowKey(row) !== 'f:' + S.cur && treeRow('f:' + S.cur)) treeSel.add('f:' + S.cur);
    const k = rowKey(row);
    treeSel.has(k) ? treeSel.delete(k) : treeSel.add(k);
    setTreeSel([...treeSel]); setTreeCursor(row, false); treeAnchor = k;
    return;
  }
  if (e.shiftKey) {
    const from = (treeAnchor && treeRow(treeAnchor)) || (treeCursor && treeRow(treeCursor)) || $('#tree .t-row.active') || row;
    setTreeSel(rowRange(from, row)); treeAnchor = rowKey(from); setTreeCursor(row, false);
    return;
  }
  if (treeSel.size) setTreeSel([]);
  treeAnchor = rowKey(row);
  setTreeCursor(row, false);
  if (row.dataset.dir != null) {
    const d = row.dataset.dir;
    S.expanded.has(d) ? S.expanded.delete(d) : S.expanded.add(d);
    store('expanded', [...S.expanded]);
    renderTree();
  } else openPath(row.dataset.path);
});

$('#tree').addEventListener('auxclick', e => { const row = e.target.closest('.t-row[data-path]'); if (row && e.button === 1) { e.preventDefault(); openInNewTab(row.dataset.path); } });
$('#tree').addEventListener('contextmenu', e => {
  const row = e.target.closest('.t-row, .tree-root-drop');
  e.preventDefault();
  if (row && treeSel.has(rowKey(row)) && treeSel.size > 1) {
    const paths = selPaths(), n = paths.length, files = paths.filter(p => S.files.has(p));
    return menu(e.clientX, e.clientY, [
      [`Move ${n} items to…`, () => moveManyDialog(paths)],
      [`New folder with ${n} items…`, () => groupIntoFolder(paths)],
      [`Bookmark ${n} items`, () => addBookmarks(paths)],
      ...(files.length ? [[`Open ${files.length} in new tabs`, async () => { for (const p of files) await openInNewTab(p); }]] : []),
      null,
      [`Delete ${n} items`, () => deleteMany(paths), 'danger'],
    ]);
  }
  if (row && !treeSel.has(rowKey(row)) && treeSel.size) setTreeSel([]);
  const dir = row?.dataset.dir, path = row?.dataset.path;
  const folder = dir != null ? dir : path ? dirname(path) : '';
  const items = [
    ['New note', () => newNote(folder)],
    ['New drawing', () => newDrawing(folder)],
    ['New canvas', () => newCanvas(folder)],
    ['New base', () => newBase(folder)],
    ['New folder', () => newFolder(folder)],
  ];
  if (path || dir) {
    const target = path || dir;
    items.push(null,
      ['Rename…', () => renameDialog(target)],
      ['Move to…', () => moveDialog(target)],
      [isBookmarked(target) ? 'Remove bookmark' : 'Bookmark', () => toggleBookmark(target)],
    );
    if (path) items.unshift(['Open in new tab', () => openInNewTab(path)], ['Open to the right', () => openSplit(path)], null);
    if (path && isMd(path) && !isDrawing(path)) items.push(['Open in reading view', () => openPath(path, { mode: 'read' })]);
    if (path && isMd(path) && isDrawing(path)) items.push(['Open as Markdown', () => openPath(path, { raw: true })]);
    if (path) items.push(['Version history…', () => openHistory(path)]);
    items.push(null, ['Delete', () => deletePath(target), 'danger']);
  }
  menu(e.clientX, e.clientY, items);
});

// Drag & drop: move within the vault, or import files from the desktop.
let dragPath = null;
let dragMany = null; // paths when a multi-selection is dragged
$('#tree').addEventListener('dragstart', e => {
  const row = e.target.closest('.t-row');
  dragPath = row ? (row.dataset.path ?? row.dataset.dir) : null;
  dragMany = row && treeSel.has(rowKey(row)) && treeSel.size > 1 ? selPaths() : null;
  if (dragPath) e.dataTransfer.setData('text/plain', dragMany ? dragMany.join('\n') : dragPath);
});
$('#tree').addEventListener('dragover', e => {
  const row = e.target.closest('.t-row, .tree-root-drop');
  if (!row) return;
  e.preventDefault();
  $$('#tree .drop').forEach(x => x.classList.remove('drop'));
  row.classList.add('drop');
});
$('#tree').addEventListener('dragleave', e => e.target.closest?.('.t-row')?.classList.remove('drop'));
$('#tree').addEventListener('drop', async e => {
  e.preventDefault();
  $$('#tree .drop').forEach(x => x.classList.remove('drop'));
  const row = e.target.closest('.t-row, .tree-root-drop');
  if (!row) return;
  const folder = row.dataset.dir != null ? row.dataset.dir : dirname(row.dataset.path);
  if (e.dataTransfer.files.length && !dragPath) {
    for (const f of e.dataTransfer.files) await importFile(f, folder);
    renderTree(); return;
  }
  const src = dragPath; dragPath = null;
  if (dragMany) { const many = dragMany; dragMany = null; return moveMany(many, folder); }
  if (!src || src === folder || dirname(src) === folder) return;
  if (folder === src || folder.startsWith(src + '/')) return toast("Can't move a folder into itself");
  await renamePath(src, join(folder, basename(src)));
});
$('#tree').addEventListener('dragend', () => { dragPath = null; dragMany = null; });

// ------------------------------------------------------------ several files at once

// Leave out anything inside a folder that's also in the list (moving the folder takes it along).
const topLevel = paths => paths.filter(p => !paths.some(q => q !== p && S.dirs.has(q) && p.startsWith(q + '/')));

async function moveMany(paths, folder) {
  const todo = topLevel(paths).filter(p => dirname(p) !== folder);
  const bad = todo.find(p => folder === p || folder.startsWith(p + '/'));
  if (bad) return toast(`Can't move "${basename(bad)}" into itself`);
  const clash = todo.find(p => S.files.has(join(folder, basename(p))) || S.dirs.has(join(folder, basename(p))));
  if (clash) return toast(`"${folder || 'the vault root'}" already has something called "${basename(clash)}"`);
  let n = 0;
  for (const p of todo) { await renamePath(p, join(folder, basename(p))); n++; }
  S.expanded.add(folder); store('expanded', [...S.expanded]);
  setTreeSel(todo.map(p => (S.dirs.has(join(folder, basename(p))) ? 'd:' : 'f:') + join(folder, basename(p))));
  renderTree();
  if (n) toast(`Moved ${n} item${n === 1 ? '' : 's'} to ${folder || 'the vault root'}`);
}

async function moveManyDialog(paths) {
  const top = topLevel(paths);
  const dirs = ['', ...[...S.dirs].sort(collator.compare)].filter(d => !top.some(p => d === p || d.startsWith(p + '/')));
  const dest = await picker({
    placeholder: `Move ${top.length} items to folder…`,
    items: q => rank(dirs, q, d => d || '/').map(d => ({ main: d || '/ (vault root)', value: d })),
  });
  if (dest != null) await moveMany(paths, dest);
}

// Put the selection into a new folder, next to where the items are.
async function groupIntoFolder(paths) {
  const top = topLevel(paths);
  const parents = [...new Set(top.map(dirname))];
  const parent = parents.length === 1 ? parents[0] : '';
  const name = await promptModal(`New folder with ${top.length} items`, `Folder name (in ${parent || 'the vault root'})`, 'New folder');
  if (!name || !name.trim()) return;
  if (/[\\:*?"<>|]/.test(name)) return toast('Folder names can’t contain \\ : * ? " < > |');
  const folder = normPath(join(parent, name.trim()));
  if (S.files.has(folder)) return toast('A file with that name already exists');
  if (!S.dirs.has(folder)) {
    try { await api('/api/mkdir', { method: 'POST', body: JSON.stringify({ path: folder }) }); } catch (e) { return toast('Couldn’t create the folder: ' + e.message); }
    S.dirs.add(folder);
  }
  await moveMany(top, folder);
}

async function deleteMany(paths) {
  const top = topLevel(paths);
  if (!top.length) return;
  if (top.length === 1) return deletePath(top[0]);
  if (!(await confirmModal(`Delete ${top.length} items?`, `They go to the vault's .trash folder.\n\n${top.slice(0, 12).map(p => '• ' + p).join('\n')}${top.length > 12 ? '\n…' : ''}`, { ok: 'Delete', danger: true }))) return;
  for (const p of top) await deletePath(p, { confirm: false });
  setTreeSel([]);
}

async function importFile(file, folder) {
  const path = uniquePath(folder, file.name);
  await writeFile(path, file);
  reindexAll();
  return path;
}

