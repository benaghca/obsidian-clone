/* Cinder app — parsing notes, the vault index, loading, syncing and saving. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ parsing & index

// Notes are read with the editor's own Markdown parser (CinderEditor.scanMarkdown, Lezer), so
// the index agrees with the editor about what's code, what's a heading and what's a link.

// `s` with the given [from, to] ranges turned into spaces (line breaks kept, so offsets hold).
function blankRanges(s, ranges) {
  if (!ranges.length) return s;
  let out = '', at = 0;
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    if (b <= at) continue;
    const from = Math.max(a, at);
    out += s.slice(at, from) + s.slice(from, b).replace(/[^\n]/g, ' ');
    at = b;
  }
  return out + s.slice(at);
}
// Code (fenced, indented, inline), HTML blocks and comments blanked out.
const blankCode = s => blankRanges(s, CinderEditor.scanMarkdown(s).code);

// A note's frontmatter, read by the shared YAML parser (ui/yaml.js). Frontmatter that isn't
// valid YAML is read leniently (flat keys and lists), so its tags and aliases still count;
// `fmValid` says which it was.
function splitFrontmatter(s) {
  const r = CinderYaml.split(s);
  return { fm: r.data, fmLen: r.len, fmValid: r.valid };
}

const asList = v => v == null ? [] : Array.isArray(v) ? v : String(v).split(/[,\s]+/);

function parseNote(content) {
  const { fm, fmLen, fmValid } = splitFrontmatter(content);
  const raw = content.slice(fmLen);
  const scan = CinderEditor.scanMarkdown(raw);
  const body = blankRanges(raw, scan.code);   // no links or tags inside code
  const words = blankRanges(body, scan.urls); // nor tags inside a link's target ("#anchor")
  const links = [], tags = new Set();
  let m;
  const wre = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
  while ((m = wre.exec(body))) {
    const [tgt, alias] = splitOnce(m[2], '|');
    const [name, sub] = splitOnce(tgt, '#');
    links.push({ embed: !!m[1], name: name.trim(), sub: (sub || '').trim(), alias, index: m.index + fmLen, len: m[0].length });
  }
  for (const l of scan.links) {
    let href = l.url.trim().replace(/^<([\s\S]*)>$/, '$1');
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
    try { href = decodeURIComponent(href); } catch { }
    const [name, sub] = splitOnce(href, '#');
    links.push({ embed: l.image, md: true, text: l.text, name, sub: sub || '', index: l.from + fmLen, len: l.to - l.from });
  }
  links.sort((a, b) => a.index - b.index);
  const tre = /(^|[\s(,;])#([\p{L}\p{N}_\-\/]+)/gu;
  while ((m = tre.exec(words))) if (!/^[\d\/]+$/.test(m[2])) tags.add(m[2].toLowerCase());
  const headings = scan.headings.map(h => ({ level: h.level, text: h.text, index: h.from + fmLen }));
  const aliases = [];
  if (fm) {
    for (const t of asList(fm.tags ?? fm.tag)) { const x = String(t).replace(/^#/, '').trim(); if (x) tags.add(x.toLowerCase()); }
    const al = fm.aliases ?? fm.alias;
    for (const a of Array.isArray(al) ? al : al ? [al] : []) if (String(a).trim()) aliases.push(String(a).trim());
  }
  return { links, headings, tags, aliases, fm, fmLen, fmValid };
}

function setNote(path, content, mtime) {
  S.dataGen++;
  const n = { content, mtime, ...parseNote(content) };
  S.notes.set(path, n);
  return n;
}

function rebuildNames() {
  S.byName.clear(); S.byAlias.clear(); S.lowerPath.clear();
  for (const p of S.files.keys()) {
    S.lowerPath.set(p.toLowerCase(), p);
    const k = noteName(p).toLowerCase();
    if (!S.byName.has(k)) S.byName.set(k, []);
    S.byName.get(k).push(p);
  }
  for (const [p, n] of S.notes) for (const a of n.aliases) if (!S.byAlias.has(a.toLowerCase())) S.byAlias.set(a.toLowerCase(), p);
}

function normPath(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}

function resolveLink(name, from) {
  if (!name) return from;
  const n = name.replace(/\\/g, '/').trim();
  if (n.includes('/')) {
    const dir = from ? dirname(from) : '';
    const cands = [n, n + '.md'];
    if (dir) cands.push(`${dir}/${n}`, `${dir}/${n}.md`);
    for (const c of cands) { const p = S.lowerPath.get(normPath(c).toLowerCase()); if (p) return p; }
    const low = n.toLowerCase().replace(/^\/+/, '');
    for (const p of S.files.keys()) { const pl = p.toLowerCase(); if (pl.endsWith('/' + low) || pl.endsWith('/' + low + '.md')) return p; }
    return null;
  }
  let key = n.toLowerCase();
  if (key.endsWith('.md')) key = key.slice(0, -3);
  const arr = S.byName.get(key);
  if (!arr) return S.byAlias.get(n.toLowerCase()) || null;
  if (arr.length === 1) return arr[0];
  const dir = from ? dirname(from) : null;
  return [...arr].sort((a, b) =>
    (+isMd(b) - +isMd(a)) || (+(dirname(b) === dir) - +(dirname(a) === dir)) || (a.length - b.length))[0];
}

function resolveNote(path) {
  const n = S.notes.get(path);
  if (n) n.out = n.links.map(l => resolveLink(l.name, path));
}

function reindexAll() {
  rebuildNames();
  for (const p of S.notes.keys()) resolveNote(p);
  S.version++;
  refreshEditorSoon();
}
const refreshEditorSoon = debounce(() => { if (S.view === 'note' && S.mode === 'edit') ed.refresh(); }, 50);

// ============================================================ loading & sync

async function loadAll() {
  loadPropTypes();
  const l = await api('/api/list');
  await applyList(l);
}

async function readMany(paths) {
  const out = {};
  for (let i = 0; i < paths.length; i += 300) Object.assign(out, await api('/api/read', { method: 'POST', body: JSON.stringify(paths.slice(i, i + 300)) }));
  return out;
}

async function applyList(l, gen) {
  const next = new Map(l.files.map(f => [f.path, { mtime: f.mtime, ctime: f.ctime, size: f.size }]));
  loadUserCss(next);
  const nextDirs = new Set(l.dirs);
  const changed = [], removed = [];
  let structural = nextDirs.size !== S.dirs.size || [...nextDirs].some(d => !S.dirs.has(d));
  for (const [p, f] of next) {
    const old = S.files.get(p);
    if (!old) structural = true;
    if (isMd(p) && (!old || old.mtime !== f.mtime || !S.notes.has(p))) changed.push(p);
  }
  for (const p of S.files.keys()) if (!next.has(p)) { removed.push(p); structural = true; }
  // .excalidraw files aren't indexed like notes, but embeds and the open drawing follow their changes.
  const drawingsChanged = [...next].filter(([p, f]) => !isMd(p) && DRAWING_EXT.test(p) && S.files.get(p) && S.files.get(p).mtime !== f.mtime).map(([p]) => p);
  // Canvases are read too, so the notes on them get backlinks and follow renames.
  const canvasesChanged = [...next].filter(([p, f]) => isCanvas(p) && S.canvases.get(p)?.mtime !== f.mtime).map(([p]) => p);
  const baseChanged = S.view === 'base' && S.baseDoc && !S.dirty && next.get(S.cur) && next.get(S.cur).mtime !== S.baseDoc.mtime;
  if (!structural && !changed.length && !drawingsChanged.length && !canvasesChanged.length && !baseChanged) return false;
  const got = changed.length || canvasesChanged.length ? await readMany([...changed, ...canvasesChanged]) : {};
  if (gen != null && gen !== S.gen) return false; // we wrote something meanwhile; next poll redoes it

  S.files = next; S.dirs = nextDirs; S.dataGen++;
  for (const p of removed) { S.notes.delete(p); S.canvases.delete(p); }
  if (baseChanged) reloadBase();
  for (const p of canvasesChanged) {
    const v = got[p];
    delete got[p];
    if (!v) continue;
    indexCanvas(p, v.content, v.mtime);
    if (p === S.cur && S.view === 'canvas' && !S.dirty && S.canvasDoc && v.mtime !== S.canvasDoc.mtime) loadCanvas(p, v.content, v.mtime, CinderCanvas.getView());
  }
  {
    for (const [p, v] of Object.entries(got)) {
      if (p === S.cur && S.dirty) continue;
      const prev = S.notes.get(p);
      if (prev && prev.content === v.content) { prev.mtime = v.mtime; continue; }
      setNote(p, v.content, v.mtime);
      splitNoteChanged(p, v.content, v.mtime);
      if (p === S.cur && S.view === 'note') reloadEditorFromDisk(v.content);
      else if (p === S.cur && S.view === 'drawing') reloadDrawingFromDisk(v.content, v.mtime);
    }
  }
  if (drawingsChanged.length) {
    S.version++; refreshEditorSoon();
    if (S.view === 'note' && S.mode === 'read') renderPreview();
    const f = next.get(S.cur);
    if (S.view === 'drawing' && S.drawing && drawingsChanged.includes(S.cur) && !S.dirty && f.mtime !== S.drawing.mtime) reloadDrawingFromDisk();
  }
  if (structural) reindexAll(); else { changed.forEach(resolveNote); if (changed.length) { S.version++; refreshEditorSoon(); } }
  // Views built from the notes redraw now that S.notes holds the new contents.
  if (S.view === 'canvas' && (changed.length || structural)) CinderCanvas.refreshFiles();
  if (S.view === 'base' && (changed.length || structural)) baseView?.refresh();
  if (changed.length || structural) { if (S.view === 'tasks') tasksView?.refresh(); updateTaskBadge(); refreshInboxSoon(); }
  if (S.cur && !S.files.has(S.cur)) { S.cur = null; S.dirty = false; showEmpty(); }
  if (structural) { renderTree(); updateConflictBar(); }
  refreshPanels();
  return true;
}

function reloadEditorFromDisk(content) {
  const st = editWrap.scrollTop;
  ed.setSilently(content);
  editWrap.scrollTop = st;
  if (S.mode === 'read') renderPreview();
}

// Changes on disk: the server says when something changed (it watches the vault folder), and
// the page then looks. If it can't watch, the page looks every two seconds instead. Either way
// it also looks now and then, in case a change slipped by.
let pollTimer = null;
async function watchVault() {
  let since = 0, fails = 0;
  const every = ms => { clearInterval(pollTimer); pollTimer = setInterval(poll, ms); };
  every(2000);
  while (true) {
    try {
      const r = await api(`/api/changes?since=${since}`);
      fails = 0;
      if (!r.watching) { every(2000); return; } // no watcher here: keep polling
      every(30000);
      if (since && r.version !== since) setTimeout(poll, 120); // let a burst of changes settle
      since = r.version;
    } catch {
      // The server is gone or restarting: poll, and try again later.
      every(2000);
      await new Promise(r => setTimeout(r, Math.min(30000, 1000 * 2 ** fails++)));
    }
  }
}

async function poll() {
  if (S.saving || document.hidden) return;
  const gen = S.gen;
  try {
    const l = await api('/api/list');
    if (gen !== S.gen) return;
    await applyList(l, gen);
  } catch { /* server gone; ignore */ }
}

// ============================================================ saving

const scheduleSave = debounce(() => save(), 700);

function markDirty() {
  if (!S.cur || S.view !== 'note') return;
  S.dirty = true;
  setSaveState('Unsaved');
  scheduleSave();
  liveReindex();
  noteClassesSoon();
  splitFollowMain();
}

// ------------------------------------------------------------ cssclasses and CSS snippets

// A note's `cssclasses` property (Obsidian's) goes on its view, for the built-in classes (wide,
// narrow, small, large, serif, no-title, center-images) and for the user's own CSS snippets.
let noteClassList = [];
function applyNoteClasses() {
  const v = $('#view-note');
  for (const c of noteClassList) v.classList.remove(c);
  noteClassList = [];
  if (S.view !== 'note' || !S.cur) return;
  const fm = splitFrontmatter(ed.value).fm || {};
  const raw = fm.cssclasses ?? fm.cssclass ?? fm.cssClasses;
  noteClassList = [...new Set([raw].flat().flatMap(x => String(x ?? '').split(/[\s,]+/)).filter(c => /^[A-Za-z_][\w-]*$/.test(c) && !['view', 'hidden'].includes(c)))];
  for (const c of noteClassList) v.classList.add(c);
}
const noteClassesSoon = debounce(applyNoteClasses, 250);

// Every .css file in the snippets folder (Settings) is applied, and re-read when it changes.
let userCssKey = '';
async function loadUserCss(files = S.files) {
  const dir = (cfg.cssFolder || '').replace(/^\/+|\/+$/g, '');
  const paths = dir ? [...files.keys()].filter(p => dirname(p) === dir && /\.css$/i.test(p)).sort(collator.compare) : [];
  const key = paths.map(p => `${p}@${files.get(p)?.mtime}`).join('|');
  if (key === userCssKey) return;
  userCssKey = key;
  let el = document.getElementById('user-css');
  if (!paths.length) { el?.remove(); return; }
  let got = {};
  try { got = await readMany(paths); } catch (e) { toast('Couldn’t read the CSS snippets: ' + e.message); return; }
  if (!el) { el = document.createElement('style'); el.id = 'user-css'; document.head.append(el); }
  el.textContent = paths.map(p => `/* ${p.replace(/\*\//g, '')} */\n${got[p]?.content || ''}`).join('\n\n');
}

const liveReindex = debounce(() => {
  if (!S.cur || !S.notes.has(S.cur)) return;
  const n = S.notes.get(S.cur);
  Object.assign(n, parseNote(ed.value));
  n.content = ed.value;
  resolveNote(S.cur);
  refreshPanels(true);
}, 400);

async function save(force = false) {
  while (S.saving) await S.savePromise;
  if (!S.cur || !S.dirty) return;
  if (S.view !== 'note' && !(S.view === 'drawing' && S.drawing) && !(S.view === 'canvas' && S.canvasDoc) && !(S.view === 'base' && S.baseDoc)) return;
  S.saving = true;
  S.savePromise = (S.view === 'drawing' ? doSaveDrawing(force) : S.view === 'canvas' ? doSaveCanvas(force) : S.view === 'base' ? doSaveBase(force) : doSave(force)).finally(() => { S.saving = false; });
  return S.savePromise;
}

async function doSave(force) {
  const p = S.cur, content = ed.value, note = S.notes.get(p);
  S.dirty = false; setSaveState('Saving…');
  let err = null;
  try {
    const headers = (!force && note && note.mtime) ? { 'X-Base-Mtime': String(note.mtime) } : {};
    const r = await api(`/api/file?path=${enc(p)}`, { method: 'PUT', body: content, headers });
    setNote(p, content, r.mtime);
    S.files.set(p, { ...S.files.get(p), mtime: r.mtime, size: new Blob([content]).size });
    resolveNote(p);
    if (!S.dirty) setSaveState('Saved');
    refreshPanels(true);
  } catch (e) { err = e; S.dirty = true; }
  if (!err) return;
  if (err.status !== 409) { setSaveState('Save failed: ' + err.message, true); return; }
  const r = await resolveDiskConflict(p, S.cur === p ? ed.value : content);
  if (r === null) { S.dirty = true; setSaveState('Not saved: changed on disk', true); return; }
  if (r === 'mine') return doSave(true);
  if (r.text != null) {
    if (S.cur === p && S.view === 'note') ed.insert(0, ed.value.length, r.text, Math.min(ed.selectionStart, r.text.length));
    return doSave(true);
  }
  S.dirty = false;
  const got = await readMany([p]);
  if (got[p]) { setNote(p, got[p].content, got[p].mtime); resolveNote(p); if (S.cur === p) reloadEditorFromDisk(got[p].content); }
  setSaveState('Reloaded from disk');
}

function setSaveState(t, err = false) {
  const el = $('#save-state');
  el.textContent = t; el.classList.toggle('err', err);
}

async function writeFile(path, content, base) {
  const headers = base ? { 'X-Base-Mtime': String(base) } : {};
  const r = await api(`/api/file?path=${enc(path)}`, { method: 'PUT', body: content, headers });
  S.files.set(path, { ...S.files.get(path), mtime: r.mtime, size: typeof content === 'string' ? content.length : content.size });
  S.dataGen++;
  if (isMd(path)) setNote(path, content, r.mtime);
  return r;
}

