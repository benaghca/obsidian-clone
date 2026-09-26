/* Cinder app — creating, renaming, moving and deleting files. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ create / rename / delete

function uniquePath(folder, filename) {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename, ext = dot > 0 ? filename.slice(dot) : '';
  let p = join(folder, filename), i = 1;
  while (S.lowerPath.has(p.toLowerCase()) || S.files.has(p)) p = join(folder, `${stem} ${i++}${ext}`);
  return p;
}

const BAD_NAME = /[\\/:*?"<>|#^\[\]]/;

// Create and open a note. opts.template = {text, from} fills it from a template; otherwise
// an empty new note gets its folder's template (Settings → Folder templates), if any.
// Returns {cursor} (-1 if the template didn't place one), or undefined if nothing was created.
async function createNote(path, content = '', opts = {}) {
  if (S.files.has(path)) return openPath(path, opts);
  let tpl = opts.template;
  if (!tpl && !content && isMd(path) && !DRAWING_EXT.test(path)) {
    const t = folderTemplateFor(path);
    if (t) tpl = { text: S.notes.get(t).content, from: t, optional: true };
  }
  let cursor = -1, actions = [];
  if (tpl) {
    const r = await applyTemplate(tpl.text, path, { templatePath: tpl.from, now: tpl.now });
    if (!r && !tpl.optional) return;
    if (r) ({ text: content, cursor, actions } = r);
  }
  try {
    await writeFile(path, content);
  } catch (e) { toast('Could not create note: ' + e.message); return; }
  let d = dirname(path);
  while (d) { S.dirs.add(d); d = dirname(d); }
  reindexAll(); renderTree();
  await openPath(path, cursor >= 0 ? { ...opts, focusTitle: false } : opts);
  if (cursor >= 0 && S.cur === path) { if (S.mode !== 'edit') setMode('edit'); ed.focus(); ed.setSelectionRange(cursor, cursor, true); }
  await runTemplateActions(path, actions);
  return { cursor };
}

async function newNote(folder) {
  if (folder == null) folder = cfg.newNoteFolder;
  const path = uniquePath(folder, 'Untitled.md');
  await createNote(path, '', { focusTitle: true, mode: 'edit' });
}

async function newFolder(parent = '') {
  const name = await promptModal('New folder', 'Folder name', '');
  if (!name) return;
  if (/[\\:*?"<>|]/.test(name)) return toast('Folder names can’t contain \\ : * ? " < > |');
  const path = normPath(join(parent, name));
  await api('/api/mkdir', { method: 'POST', body: JSON.stringify({ path }) });
  S.dirs.add(path); S.expanded.add(parent); store('expanded', [...S.expanded]);
  renderTree();
}

async function renameDialog(path) {
  const isDir = S.dirs.has(path);
  const cur = isDir ? basename(path) : noteName(path);
  const name = await promptModal(isDir ? 'Rename folder' : 'Rename', 'New name', cur);
  if (!name || name === cur) return;
  if (BAD_NAME.test(name)) return toast('Names can’t contain \\ / : * ? " < > | # ^ [ ]');
  const ext = isDir || isMd(path) ? (isDir ? '' : '.md') : '';
  await renamePath(path, join(dirname(path), name + ext));
}

async function moveDialog(path) {
  const dirs = ['', ...[...S.dirs].sort(collator.compare)].filter(d => d !== path && !d.startsWith(path + '/') && d !== dirname(path));
  const dest = await picker({
    placeholder: `Move "${basename(path)}" to folder…`,
    items: q => rank(dirs, q, d => d || '/').map(d => ({ main: d || '/ (vault root)', value: d })),
  });
  if (dest == null) return;
  await renamePath(path, join(dest, basename(path)));
}

function relPath(fromDir, to) {
  const a = fromDir ? fromDir.split('/') : [], b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

function linkNameFor(path, files) {
  // Shortest form that still resolves uniquely (Obsidian's default).
  const nm = noteName(path).toLowerCase();
  let count = 0;
  for (const p of files) if (noteName(p).toLowerCase() === nm) count++;
  return count > 1 ? (isMd(path) ? path.slice(0, -3) : path) : noteName(path);
}

async function renamePath(from, to) {
  if (from === to) return;
  await save();
  const isDir = S.dirs.has(from);
  if (!isDir && S.files.has(to) && from.toLowerCase() !== to.toLowerCase()) return toast('A file with that name already exists');
  const moved = new Map(isDir
    ? [...S.files.keys()].filter(p => p.startsWith(from + '/')).map(p => [p, to + p.slice(from.length)])
    : [[from, to]]);
  const afterFiles = [...S.files.keys()].map(p => moved.get(p) || p);

  // Work out link rewrites using the pre-move index.
  const edits = [];
  for (const [q, n] of S.notes) {
    const reps = [];
    const newQ = moved.get(q) || q;
    n.links.forEach((l, i) => {
      const t = n.out?.[i];
      if (!t) return;
      // Wiki links only change when their target moves; relative markdown links
      // also change when the note containing them moves.
      const relMd = l.md && l.name.includes('/');
      if (!moved.has(t) && !(relMd && moved.has(q))) return;
      const np = moved.get(t) || t;
      const sub = l.sub ? '#' + l.sub : '';
      let txt;
      if (l.md) {
        const href = relPath(dirname(newQ), np).split('/').map(enc).join('/');
        txt = `${l.embed ? '!' : ''}[${l.text}](${href}${sub})`;
      } else {
        txt = `${l.embed ? '!' : ''}[[${linkNameFor(np, afterFiles)}${sub}${l.alias != null ? '|' + l.alias : ''}]]`;
      }
      if (txt !== n.content.slice(l.index, l.index + l.len)) reps.push({ l, txt });
    });
    if (reps.length) {
      let s = n.content;
      for (const { l, txt } of reps.sort((a, b) => b.l.index - a.l.index)) s = s.slice(0, l.index) + txt + s.slice(l.index + l.len);
      edits.push([moved.get(q) || q, s]);
    }
  }

  try {
    await api('/api/rename', { method: 'POST', body: JSON.stringify({ from, to }) });
  } catch (e) { toast('Rename failed: ' + e.message); return; }

  // Update local state to the post-move world.
  for (const [a, b] of moved) {
    const f = S.files.get(a); S.files.delete(a); if (f) S.files.set(b, f);
    const n = S.notes.get(a); S.notes.delete(a); if (n) S.notes.set(b, n);
    const pos = S.pos.get(a); if (pos) S.pos.set(b, pos);
    const cv = S.canvases.get(a); S.canvases.delete(a); if (cv) S.canvases.set(b, cv);
    S.hist = S.hist.map(h => h === a ? b : h);
    S.recent = S.recent.map(h => h === a ? b : h);
  }
  tabsAfterRename(moved);
  bookmarksAfterRename(moved, from, to, isDir);
  if (isDir) {
    const dirs = [...S.dirs];
    S.dirs = new Set(dirs.map(d => d === from ? to : d.startsWith(from + '/') ? to + d.slice(from.length) : d));
    if (S.expanded.has(from)) S.expanded.add(to);
  }
  let d = dirname(to);
  while (d) { S.dirs.add(d); d = dirname(d); }
  const curMoved = S.cur && moved.has(S.cur);
  if (curMoved) S.cur = moved.get(S.cur);
  reindexAll();

  let n = 0;
  for (const [p, content] of edits) {
    try { await writeFile(p, content, S.notes.get(p)?.mtime); n++; } catch (e) { toast(`Couldn’t update links in ${p}: ${e.message}`); }
    if (p === S.cur && S.view === 'drawing') reloadDrawingFromDisk(content, S.notes.get(p)?.mtime);
    else if (p === S.cur) reloadEditorFromDisk(content);
  }
  // Canvases point at files by path, so their cards follow the move too.
  for (const [cp, c] of S.canvases) {
    if (!c.refs.some(r => moved.has(r))) continue;
    try {
      if (cp === S.cur && S.view === 'canvas' && S.canvasDoc) {
        CinderCanvas.renameRefs(CinderCanvas.getData(), moved);
        indexCanvas(cp, CinderCanvas.serializeCanvas(CinderCanvas.getData()), c.mtime);
        canvasChanged(); CinderCanvas.refreshFiles();
      } else {
        const got = (await readMany([cp]))[cp];
        const data = CinderCanvas.parseCanvas(got.content);
        if (!CinderCanvas.renameRefs(data, moved)) continue;
        const text = CinderCanvas.serializeCanvas(data);
        await writeFile(cp, text, got.mtime);
        indexCanvas(cp, text, S.files.get(cp).mtime);
      }
      n++;
    } catch (e) { toast(`Couldn’t update canvas ${cp}: ${e.message}`); }
  }
  reindexAll();
  renderTree();
  if (curMoved) { titleEl.value = noteName(S.cur); $('#crumbs').innerHTML = crumbsHtml(S.cur); document.title = `${noteName(S.cur)} — ${VAULT} — Cinder`; store('last', S.cur); }
  renderTreeActive(true);
  refreshPanels();
  if (n) toast(`Updated links in ${n} file${n > 1 ? 's' : ''}`);
}

async function deletePath(path, opts = {}) {
  const isDir = S.dirs.has(path);
  const what = isDir ? `the folder “${path}” and everything in it` : `“${basename(path)}”`;
  if (opts.confirm !== false && !(await confirmModal(`Delete ${what}?`, "It goes to the vault's .trash folder.", { ok: 'Delete', danger: true }))) return;
  if (S.cur === path || (isDir && S.cur?.startsWith(path + '/'))) { S.dirty = false; }
  try { await api('/api/delete', { method: 'POST', body: JSON.stringify({ path }) }); }
  catch (e) { return toast('Delete failed: ' + e.message); }
  for (const p of [...S.files.keys()]) if (p === path || p.startsWith(path + '/')) { S.files.delete(p); S.notes.delete(p); }
  for (const d of [...S.dirs]) if (d === path || d.startsWith(path + '/')) S.dirs.delete(d);
  S.hist = S.hist.filter(h => S.files.has(h)); S.histIdx = S.hist.length - 1;
  reindexAll(); renderTree();
  tabsAfterDelete();
  bookmarksAfterDelete(path);
  if (S.cur && !S.files.has(S.cur)) { S.cur = null; showEmpty(); }
  refreshPanels();
}

