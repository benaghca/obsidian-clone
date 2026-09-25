/* Folio — front end. Plain JS, no build step, no network beyond 127.0.0.1. */
'use strict';

// ============================================================ basics

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const TOKEN = $('meta[name=folio-token]').content;
const VAULT = $('meta[name=folio-vault]').content;
const NATIVE = $('meta[name=folio-mode]').content === 'native';
const enc = encodeURIComponent;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isMd = p => /\.md$/i.test(p);
const basename = p => p.split('/').pop();
const dirname = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const noteName = p => { const b = basename(p); return isMd(b) ? b.slice(0, -3) : b; };
const join = (d, n) => d ? `${d}/${n}` : n;
const splitOnce = (s, ch) => { const i = s.indexOf(ch); return i < 0 ? [s, null] : [s.slice(0, i), s.slice(i + 1)]; };
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const DRAWING_EXT = /\.excalidraw(\.md)?$/i;
// Drawings: .excalidraw (Excalidraw JSON) or Obsidian Excalidraw plugin notes (.excalidraw.md / frontmatter flag).
const isDrawing = p => !!p && (DRAWING_EXT.test(p) || (isMd(p) && S.notes.get(p)?.fm?.['excalidraw-plugin'] != null));
const drawingName = p => basename(p).replace(DRAWING_EXT, '').replace(/\.md$/i, '');
const isCanvas = p => !!p && /\.canvas$/i.test(p);
const isBase = p => !!p && /\.base$/i.test(p);
// Files whose ![[embeds]] app.js draws itself rather than as Markdown or an image.
const visualEmbed = p => isDrawing(p) || isCanvas(p) || isBase(p);
const displayName = p => isDrawing(p) ? drawingName(p) : isCanvas(p) || isBase(p) ? basename(p).replace(/\.(canvas|base)$/i, '') : isMd(p) ? noteName(p) : basename(p);
const rawUrl = p => `/api/raw?path=${enc(p)}&t=${TOKEN}`;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function store(key, val) {
  const k = `folio:${VAULT}:${key}`;
  try {
    if (val === undefined) { const v = localStorage.getItem(k); return v == null ? undefined : JSON.parse(v); }
    localStorage.setItem(k, JSON.stringify(val));
  } catch { return undefined; }
}

async function api(path, opts = {}) {
  const mutating = opts.method && opts.method !== 'GET' && !path.startsWith('/api/read');
  if (mutating) S.gen++;
  try { return await apiRaw(path, opts); } finally { if (mutating) S.gen++; }
}

async function apiRaw(path, opts) {
  const r = await fetch(path, { ...opts, headers: { 'X-Folio-Token': TOKEN, ...(opts.headers || {}) } });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch { }
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : r.text();
}

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// ============================================================ settings

const DEFAULTS = {
  newNoteFolder: '',
  dailyFolder: 'Daily',
  dailyTemplate: '',
  templatesFolder: 'Templates',
  attachFolder: 'attachments',
  defaultMode: 'edit',
  livePreview: true,
  readable: true,
  mono: false,
  theme: '',
  palette: 'default',
  fontText: '',          // '' = system font
  fontMono: '',          // '' = JetBrains Mono (bundled)
  vim: false,            // Vim key bindings in the editor
  folderTemplates: '',
  taskInbox: '',         // where quick-added tasks go ('' = today's daily note)
  taskDoneDate: true,    // add ✅ YYYY-MM-DD when a task is ticked
  drawingFormat: 'excalidraw',
  properties: 'visible', // frontmatter as a Properties table, or 'source' for plain YAML
  mathSnippets: true,     // LaTeX Suite-style shortcuts while typing math
  cssFolder: '',          // a vault folder of .css snippets to apply ('' = none)
  screenshotHide: true,   // the desktop window steps aside while you capture
  screenshotDelay: '0',   // seconds before capturing
  screenshotAfter: 'insert', // or 'annotate': open the screenshot in a drawing
};
const cfg = Object.assign({}, DEFAULTS, store('settings') || {});
const saveCfg = () => store('settings', cfg);

// A chosen font goes first; the default stack (with the Nerd Fonts symbols) stays behind it.
const FONT_MONO_DEFAULT = '"JetBrains Mono", ui-monospace, "Cascadia Code", Consolas, Menlo, monospace, "Symbols Nerd Font Mono"';
const cssFontName = n => '"' + String(n).replace(/["\\;{}<>]/g, '').trim() + '"';
function applyFonts() {
  const root = document.documentElement.style;
  if (cfg.fontText.trim()) root.setProperty('--font-text', `${cssFontName(cfg.fontText)}, var(--font-ui)`); else root.removeProperty('--font-text');
  if (cfg.fontMono.trim()) root.setProperty('--font-mono', `${cssFontName(cfg.fontMono)}, ${FONT_MONO_DEFAULT}`); else root.removeProperty('--font-mono');
}

function applyTheme() {
  const t = cfg.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = t;
  FolioThemes.apply(cfg.palette, t);
  applyFonts();
  document.body.classList.toggle('wide', !cfg.readable);
  document.body.classList.toggle('mono', cfg.mono);
  document.body.classList.toggle('source-mode', !cfg.livePreview);
  if (typeof ed !== 'undefined') { ed.setLive(cfg.livePreview); ed.setVim(cfg.vim); }
  if (window.FolioGraph) FolioGraph.restyle();
  if (window.FolioDraw) FolioDraw.restyle();
  if (typeof S !== 'undefined') { S.version++; refreshEditorSoon(); if (S.view === 'note' && S.mode === 'read') renderPreview(); }
}

// ============================================================ state

const S = {
  files: new Map(),      // path -> {mtime, size}
  dirs: new Set(),
  notes: new Map(),      // md path -> {content, mtime, links, out, tags, headings, aliases, fm, fmLen}
  byName: new Map(),     // lower name -> [paths]
  byAlias: new Map(),    // lower alias -> path
  lowerPath: new Map(),  // lower path -> path
  cur: null,             // current path (note or file)
  view: 'empty',
  mode: cfg.defaultMode,
  dirty: false,
  saving: false,
  hist: [], histIdx: -1,
  recent: store('recentFiles') || [], // files by when they were last opened, newest first (Ctrl+Tab, quick switcher)
  pos: new Map(),        // path -> {sel, scroll, pscroll}
  expanded: new Set(store('expanded') || []),
  gen: 0,                // bumped by every write, so stale polls can be discarded
  version: 0,            // bumped when the index changes, so editor widgets re-render
  savePromise: null,
  drawing: null,         // open drawing: {mtime, info: {format, source, embedded}}
  canvasDoc: null,       // open canvas: {mtime}
  baseDoc: null,         // open base: {mtime, text}
  dataGen: 0,            // bumped whenever notes or files change, so base rows are rebuilt
  canvases: new Map(),   // canvas path -> {mtime, refs: [vault paths of its file cards]}
};

const editWrap = $('#edit-wrap');
// CodeMirror-based editor with live preview (ui/editor/editor.js). Hooks are
// arrow functions so they can use things defined further down this file.
// Render TeX into el with KaTeX (errors show inline, in red; no \href or other "trusted" commands).
function renderMath(el, tex, display) {
  try { katex.render(tex, el, { displayMode: !!display, throwOnError: false, strict: 'ignore', trust: false, maxSize: 50, maxExpand: 1000, output: 'htmlAndMathml' }); }
  catch (e) { el.textContent = tex; el.classList.add('math-error'); el.title = e.message; }
}
// Fill every math placeholder ([data-tex]) inside el.
function renderMathIn(el) {
  for (const m of el.querySelectorAll('[data-tex]')) { renderMath(m, m.dataset.tex, m.classList.contains('math-block') || m.classList.contains('math-display')); m.removeAttribute('data-tex'); }
}

// Hooks for a Markdown editor whose links resolve from the note `from()` returns: the open
// note for the main editor, or the note / canvas behind a canvas card's editor.
function editorHooks(from, extra) {
  return {
    resolve: name => resolveLink(name, from()),
    rawUrl: p => rawUrl(p),
    imageUrl: src => { const t = /^[a-z][a-z0-9+.-]*:/i.test(src) ? null : resolveLink(safeDecode(src), from()); return t ? rawUrl(t) : null; },
    follow: (name, sub) => followLink(name, sub, from()),
    openUrl: url => window.open(url, '_blank', 'noopener'),
    tag: tag => searchFor(`tag:${tag}`),
    renderEmbed: (el, path, sub) => renderEmbedInto(el, path, sub),
    renderMarkdown: (el, text) => { el.innerHTML = markdownToHtml(text, from(), 1); linkifyTags(el); },
    version: () => S.version,
    linkOptions: q => linkOptions(q),
    tagOptions: () => allTags(),
    visualEmbed: p => visualEmbed(p),
    renderVisualEmbed: (el, p, width, sub) => renderVisualEmbed(el, p, width, sub),
    codeBlock: lang => lang === 'base' || lang === 'tasks',
    renderCodeBlock: (el, lang, code) => lang === 'tasks' ? renderTasksBlock(el, code) : renderBaseBlock(el, code, from()),
    toggleTaskLine: text => FolioTasks.parseLine(text) ? FolioTasks.toggle(text, { date: FolioTasks.today(), doneDate: cfg.taskDoneDate }) : null,
    renderMath: (el, tex, display) => renderMath(el, tex, display),
    mathSnippets: () => cfg.mathSnippets,
    propertiesFor: text => cfg.properties !== 'source' && propsOf(text) != null,
    renderProperties: (el, text, ctl) => mountProps(el, text, { ...ctl, from }),
    ...extra,
  };
}

const ed = FolioEditor.create($('#editor'), editorHooks(() => S.cur, {
  onChange: () => markDirty(),
  onCursor: () => cursorMoved(),
  onFiles: (files, pasted) => { (async () => { for (const f of files) await attachAndLink(f, pasted); })(); },
  focusTitle: () => { titleEl.focus(); titleEl.setSelectionRange(titleEl.value.length, titleEl.value.length); },
}), { vim: cfg.vim });
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
const titleEl = $('#title');
const preview = $('#preview');

// ============================================================ parsing & index

function blankCode(s) {
  // Replace fenced + inline code with spaces (same length) so offsets survive.
  return s
    .replace(/^([ \t]*)(```+|~~~+)[^\n]*\n[\s\S]*?(?:^[ \t]*\2[^\n]*$|(?![\s\S]))/gm, m => m.replace(/[^\n]/g, ' '))
    .replace(/(`+)(?!`)[^\n]*?[^`]\1(?!`)|`[^`\n]`/g, m => ' '.repeat(m.length));
}

function splitFrontmatter(s) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(s);
  if (!m) return { fm: null, fmLen: 0 };
  return { fm: parseYaml(m[1]), fmLen: m[0].length };
}

function parseYaml(t) {
  const unq = s => s.trim().replace(/^(["'])(.*)\1$/, '$2');
  const o = {}; let key = null;
  for (const line of t.split(/\r?\n/)) {
    let m;
    if ((m = /^([^\s:#][^:]*):[ \t]*(.*)$/.exec(line))) {
      key = m[1].trim(); const v = m[2].trim();
      if (v === '') o[key] = [];
      else if (/^\[.*\]$/.test(v)) o[key] = v.slice(1, -1).split(',').map(unq).filter(Boolean);
      else o[key] = unq(v);
    } else if ((m = /^\s+-\s+(.*)$|^-\s+(.*)$/.exec(line)) && key) {
      if (!Array.isArray(o[key])) o[key] = o[key] ? [o[key]] : [];
      o[key].push(unq(m[1] ?? m[2]));
    }
  }
  return o;
}

const asList = v => v == null ? [] : Array.isArray(v) ? v : String(v).split(/[,\s]+/);

function parseNote(content) {
  const { fm, fmLen } = splitFrontmatter(content);
  const body = blankCode(content.slice(fmLen));
  const links = [], headings = [], tags = new Set();
  let m;
  const wre = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
  while ((m = wre.exec(body))) {
    const [tgt, alias] = splitOnce(m[2], '|');
    const [name, sub] = splitOnce(tgt, '#');
    links.push({ embed: !!m[1], name: name.trim(), sub: (sub || '').trim(), alias, index: m.index + fmLen, len: m[0].length });
  }
  const mre = /(!?)\[([^\]\n]*)\]\(<?([^)\n>]+?)>?\)/g;
  while ((m = mre.exec(body))) {
    let href = m[3].trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
    try { href = decodeURIComponent(href); } catch { }
    const [name, sub] = splitOnce(href, '#');
    links.push({ embed: !!m[1], md: true, text: m[2], name, sub: sub || '', index: m.index + fmLen, len: m[0].length });
  }
  links.sort((a, b) => a.index - b.index);
  const tre = /(^|[\s(,;])#([\p{L}\p{N}_\-\/]+)/gu;
  while ((m = tre.exec(body))) if (!/^[\d\/]+$/.test(m[2])) tags.add(m[2].toLowerCase());
  const hre = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
  while ((m = hre.exec(body))) headings.push({ level: m[1].length, text: m[2], index: m.index + fmLen });
  const aliases = [];
  if (fm) {
    for (const t of asList(fm.tags ?? fm.tag)) { const x = String(t).replace(/^#/, '').trim(); if (x) tags.add(x.toLowerCase()); }
    const al = fm.aliases ?? fm.alias;
    for (const a of Array.isArray(al) ? al : al ? [al] : []) if (String(a).trim()) aliases.push(String(a).trim());
  }
  return { links, headings, tags, aliases, fm, fmLen };
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
    (isMd(b) - isMd(a)) || ((dirname(b) === dir) - (dirname(a) === dir)) || (a.length - b.length))[0];
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
    if (p === S.cur && S.view === 'canvas' && !S.dirty && S.canvasDoc && v.mtime !== S.canvasDoc.mtime) loadCanvas(p, v.content, v.mtime, FolioCanvas.getView());
  }
  {
    for (const [p, v] of Object.entries(got)) {
      if (p === S.cur && S.dirty) continue;
      const prev = S.notes.get(p);
      if (prev && prev.content === v.content) { prev.mtime = v.mtime; continue; }
      setNote(p, v.content, v.mtime);
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
  if (S.view === 'canvas' && (changed.length || structural)) FolioCanvas.refreshFiles();
  if (S.view === 'base' && (changed.length || structural)) baseView?.refresh();
  if (changed.length || structural) { if (S.view === 'tasks') tasksView?.refresh(); updateTaskBadge(); }
  if (S.cur && !S.files.has(S.cur)) { S.cur = null; S.dirty = false; showEmpty(); }
  if (structural) renderTree();
  refreshPanels();
  return true;
}

function reloadEditorFromDisk(content) {
  const st = editWrap.scrollTop;
  ed.setSilently(content);
  editWrap.scrollTop = st;
  if (S.mode === 'read') renderPreview();
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
  const overwrite = confirm(`"${noteName(p)}" was changed outside Folio.\n\nOK — overwrite it with your version\nCancel — discard your changes and load the version on disk`);
  if (overwrite) return doSave(true);
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

// ============================================================ navigation

function showView(v) {
  S.view = v;
  for (const id of ['note', 'file', 'graph', 'drawing', 'canvas', 'base', 'tasks', 'empty']) $(`#view-${id}`).hidden = id !== v;
  $('#mode-btn').hidden = v !== 'note';
  if (v === 'graph') FolioGraph.show(); else FolioGraph.hide();
  if (v === 'drawing') FolioDraw.show(); else FolioDraw.hide();
  if (v === 'canvas') FolioCanvas.show(); else FolioCanvas.hide();
  updateHistButtons();
  if (S.tabs) syncTab();
  applyNoteClasses();
}

function showEmpty() {
  showView('empty');
  $('#crumbs').textContent = '';
  setSaveState('');
  document.title = `${VAULT} — Folio`;
  renderTreeActive(); refreshPanels(); updateStatus();
}

function rememberPos() {
  if (S.cur && S.view === 'drawing') { S.pos.set(S.cur, { draw: FolioDraw.getView() }); return; }
  if (S.cur && S.view === 'canvas') { S.pos.set(S.cur, { canvas: FolioCanvas.getView() }); return; }
  if (S.cur && S.view === 'base') { if (baseView) S.pos.set(S.cur, { baseView: baseView.viewName() }); return; }
  if (!S.cur || S.view !== 'note') return;
  if (S.tabs.some(t => t.key === S.cur)) edStates.set(S.cur, ed.getState()); // (undo history, per tab)
  S.pos.set(S.cur, { a: ed.selectionStart, b: ed.selectionEnd, scroll: editWrap.scrollTop, pscroll: preview.scrollTop });
}

async function openPath(p, opts = {}) {
  if (!p) return;
  flushDocViews();
  await save();
  rememberPos();
  if (!S.files.has(p)) { toast(`Not found: ${p}`); return; }
  if (opts.push !== false && S.hist[S.histIdx] !== p) {
    S.hist = S.hist.slice(0, S.histIdx + 1); S.hist.push(p); S.histIdx = S.hist.length - 1;
  }
  S.cur = p; S.dirty = false; S.drawing = null; S.canvasDoc = null; S.baseDoc = null;
  store('last', p);
  S.recent = [p, ...S.recent.filter(x => x !== p)].slice(0, 40); store('recentFiles', S.recent);
  if (isDrawing(p) && !opts.raw) return openDrawing(p);
  if (isCanvas(p)) return openCanvas(p);
  if (isBase(p)) return openBase(p);
  if (!isMd(p)) return openAttachment(p);
  const n = S.notes.get(p);
  showView('note');
  titleEl.value = noteName(p);
  const kept = edStates.get(p);
  if (kept && n && kept.doc.toString() === n.content) ed.setState(kept); else ed.load(n ? n.content : '');
  applyNoteClasses();
  setSaveState('');
  const pos = S.pos.get(p);
  setMode(opts.mode || S.mode, true);
  if (pos && pos.a != null) {
    ed.setSelectionRange(pos.a, pos.b); editWrap.scrollTop = pos.scroll; preview.scrollTop = pos.pscroll;
    requestAnimationFrame(() => { editWrap.scrollTop = pos.scroll; });
  } else { editWrap.scrollTop = 0; preview.scrollTop = 0; }
  $('#crumbs').innerHTML = crumbsHtml(p);
  document.title = `${noteName(p)} — ${VAULT} — Folio`;
  renderTreeActive(true);
  refreshPanels();
  updateStatus();
  if (opts.heading) scrollToHeading(opts.heading);
  if (opts.select) selectRange(opts.select[0], opts.select[1]);
  if (opts.focusTitle) { titleEl.focus(); titleEl.select(); }
  else if (S.mode === 'edit' && opts.focus !== false) ed.focus();
}

function crumbsHtml(p) {
  const parts = p.split('/');
  const last = parts.pop();
  return parts.map(x => `${esc(x)} / `).join('') + `<b>${esc(isMd(last) ? last.slice(0, -3) : last)}</b>`;
}

let fileViewer = null;
function openAttachment(p) {
  showView('file');
  const v = $('#view-file');
  const f = S.files.get(p);
  const kb = f ? (f.size / 1024).toFixed(1) + ' KB' : '';
  fileViewer?.destroy(); fileViewer = null;
  if (IMG_EXT.test(p)) {
    // Zoomable, with ← → through the other images in the folder.
    const dir = dirname(p);
    const items = [...S.files.keys()].filter(q => dirname(q) === dir && IMG_EXT.test(q)).sort(collator.compare).map(q => ({ src: rawUrl(q), name: `${basename(q)} · ${((S.files.get(q)?.size || 0) / 1024).toFixed(1)} KB`, path: q }));
    const { onCopy, onCrop, onAnnotate } = imageActions();
    fileViewer = FolioImages.viewer(v, items, items.findIndex(it => it.path === p), { onCopy, onCrop, onAnnotate });
    fileViewer.focus();
  } else v.innerHTML = `<div class="file-info"><p>${esc(p)} · ${kb}</p><p><a class="btn" href="${rawUrl(p)}" target="_blank" rel="noopener">Open in new tab</a></p></div>`;
  $('#crumbs').innerHTML = crumbsHtml(p);
  renderTreeActive(true); refreshPanels(); updateStatus();
}

// ============================================================ drawings

async function openDrawing(p) {
  showView('drawing');
  $('#crumbs').innerHTML = crumbsHtml(p);
  document.title = `${drawingName(p)} — ${VAULT} — Folio`;
  setSaveState('');
  renderTreeActive(true);
  refreshPanels();
  let content, mtime;
  try {
    if (isMd(p) && S.notes.has(p)) ({ content, mtime } = S.notes.get(p));
    else {
      const got = await readMany([p]);
      if (!got[p]) throw new Error('the file couldn’t be read');
      ({ content, mtime } = got[p]);
    }
  } catch (e) { if (S.cur === p) showDrawingError(p, e); return; }
  if (S.cur !== p) return; // navigated away while reading
  loadDrawing(p, content, mtime, S.pos.get(p)?.draw);
}

// Parse and show a drawing; returns false (and shows why) if it can't be read.
function loadDrawing(p, content, mtime, view) {
  let parsed;
  try { parsed = FolioSketch.parseDrawing(content, p); } catch (e) { showDrawingError(p, e); return false; }
  S.drawing = { mtime, info: { format: parsed.format, source: content, embedded: parsed.embedded || {} } };
  if (S.view !== 'drawing') showView('drawing');
  FolioDraw.load(parsed.scene, { fileUrls: drawingFileUrls(parsed.embedded, p), view, relayout: parsed.relayout });
  updateStatus();
  return true;
}

async function reloadDrawingFromDisk(content, mtime) {
  const p = S.cur;
  if (content == null) {
    const got = await readMany([p]).catch(() => ({}));
    if (!got[p] || S.cur !== p || S.dirty) return;
    ({ content, mtime } = got[p]);
  }
  loadDrawing(p, content, mtime, FolioDraw.getView());
}

function showDrawingError(p, e, what = 'a drawing') {
  S.drawing = null; S.canvasDoc = null;
  showView('file');
  $('#view-file').innerHTML = `<div class="file-info"><p>Couldn’t open “${esc(basename(p))}” as ${what}: ${esc(e.message)}</p>` +
    (isMd(p) ? `<p><a class="btn" data-open-raw="${esc(p)}">Open as Markdown</a></p>` : '') + '</div>';
}

// Images in .excalidraw.md drawings are vault files listed under "Embedded Files".
function drawingFileUrls(embedded, from) {
  const out = {};
  for (const [id, link] of Object.entries(embedded || {})) { const t = resolveLink(link, from); if (t) out[id] = rawUrl(t); }
  return out;
}

function drawingChanged() {
  if (S.view !== 'drawing' || !S.drawing) return;
  S.dirty = true;
  setSaveState('Unsaved');
  scheduleSave();
  updateStatus();
}

function dataURLToBlob(u) {
  const [head, data] = u.split(',');
  const mime = /^data:([^;,]+)/.exec(head)?.[1] || 'application/octet-stream';
  const bin = /;base64/.test(head) ? atob(data) : decodeURIComponent(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// .excalidraw.md drawings keep images as vault attachments, like the Obsidian plugin does.
async function storeDrawingImages(d) {
  let added = false;
  for (const [id, f] of Object.entries(FolioDraw.getScene().files)) {
    if (d.info.embedded[id] || !f.dataURL) continue;
    const ext = ((f.mimeType || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const now = new Date();
    const path = uniquePath(cfg.attachFolder, `Pasted image ${fmtDate(now, 'YYYYMMDDHHmm')}${String(now.getSeconds()).padStart(2, '0')}.${ext}`);
    await writeFile(path, dataURLToBlob(f.dataURL));
    if (cfg.attachFolder) S.dirs.add(cfg.attachFolder);
    reindexAll();
    d.info.embedded[id] = linkNameFor(path, [...S.files.keys()]);
    added = true;
  }
  if (added) renderTree();
}

function drawingContent(d) {
  return FolioSketch.serializeDrawing(FolioDraw.getScene(), d.info);
}

async function doSaveDrawing(force) {
  const p = S.cur, d = S.drawing;
  S.dirty = false; setSaveState('Saving…');
  let err = null;
  try {
    if (d.info.format === 'md') await storeDrawingImages(d);
    const content = drawingContent(d);
    const headers = (!force && d.mtime) ? { 'X-Base-Mtime': String(d.mtime) } : {};
    const r = await api(`/api/file?path=${enc(p)}`, { method: 'PUT', body: content, headers });
    d.mtime = r.mtime; d.info.source = content;
    S.files.set(p, { ...S.files.get(p), mtime: r.mtime, size: new Blob([content]).size });
    if (isMd(p)) { setNote(p, content, r.mtime); resolveNote(p); }
    S.version++;
    if (!S.dirty) setSaveState('Saved');
    refreshPanels(true);
  } catch (e) { err = e; S.dirty = true; }
  if (!err) return;
  if (err.status !== 409) { setSaveState('Save failed: ' + err.message, true); return; }
  const overwrite = confirm(`"${basename(p)}" was changed outside Folio.\n\nOK — overwrite it with your version\nCancel — discard your changes and load the version on disk`);
  if (overwrite) return doSaveDrawing(true);
  S.dirty = false;
  await reloadDrawingFromDisk();
  setSaveState('Reloaded from disk');
}

// A new, empty drawing file in `folder`; returns its path.
async function makeDrawingFile(folder) {
  const md = cfg.drawingFormat === 'md';
  const ext = md ? '.excalidraw.md' : '.excalidraw';
  const now = new Date();
  const stem = `Drawing ${fmtDate(now, 'YYYY-MM-DD HH.mm')}.${String(now.getSeconds()).padStart(2, '0')}`;
  let path = join(folder, stem + ext), i = 1;
  while (S.lowerPath.has(path.toLowerCase()) || S.files.has(path)) path = join(folder, `${stem} ${i++}${ext}`);
  const content = FolioSketch.serializeDrawing(FolioSketch.emptyScene(), md ? { format: 'md', source: '' } : { format: 'json' });
  await writeFile(path, content);
  let d = dirname(path);
  while (d) { S.dirs.add(d); d = dirname(d); }
  reindexAll(); renderTree();
  return path;
}

async function newDrawing(folder) {
  if (folder == null) folder = cfg.newNoteFolder;
  try { await openPath(await makeDrawingFile(folder)); } catch (e) { toast('Could not create drawing: ' + e.message); }
}

// Obsidian Excalidraw's "create new drawing and embed it into the active note".
async function newDrawingInNote() {
  if (S.view !== 'note' || !S.cur) return toast('Open a note first');
  if (S.mode !== 'edit') setMode('edit');
  const a = ed.selectionStart, b = ed.selectionEnd;
  let path;
  try { path = await makeDrawingFile(dirname(S.cur)); } catch (e) { return toast('Could not create drawing: ' + e.message); }
  const before = ed.value.slice(0, a);
  const link = `![[${linkNameFor(path, [...S.files.keys()])}]]`;
  insertText(a, b, (before && !before.endsWith('\n') ? '\n' : '') + link + '\n');
  await openPath(path);
}

// SVG of a drawing for embeds, cached by file version and theme.
const drawingSvgCache = new Map();
let virgilPromise = null;
function virgilData() {
  virgilPromise ||= fetch('/vendor/Virgil.woff2').then(r => r.arrayBuffer()).then(buf => {
    const b = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }).catch(() => null);
  return virgilPromise;
}
const blobToDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

function drawingSvgUrl(path) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const key = `${S.files.get(path)?.mtime}|${S.notes.get(path)?.mtime}|${dark}`;
  const hit = drawingSvgCache.get(path);
  if (hit && hit.key === key) return hit.promise;
  const promise = (async () => {
    const content = isMd(path) ? S.notes.get(path)?.content : (await readMany([path]))[path]?.content;
    if (content == null) throw new Error('file not found');
    const { scene, embedded } = FolioSketch.parseDrawing(content, path);
    const data = {};
    for (const el of scene.elements) {
      if (el.type !== 'image' || !el.fileId || data[el.fileId]) continue;
      if (scene.files[el.fileId]?.dataURL) { data[el.fileId] = scene.files[el.fileId].dataURL; continue; }
      const t = embedded?.[el.fileId] && resolveLink(embedded[el.fileId], path);
      if (t) try { data[el.fileId] = await blobToDataURL(await (await fetch(rawUrl(t))).blob()); } catch { }
    }
    const svg = FolioSketch.toSVG(scene.elements, { dark, fontData: await virgilData(), fileData: id => data[id] });
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  })();
  drawingSvgCache.set(path, { key, promise });
  if (hit) hit.promise.then(u => setTimeout(() => URL.revokeObjectURL(u), 10000), () => { });
  promise.catch(() => { if (drawingSvgCache.get(path)?.promise === promise) drawingSvgCache.delete(path); });
  return promise;
}

function renderVisualEmbed(el, path, width, sub) {
  if (isCanvas(path)) return renderCanvasEmbed(el, path, width);
  if (isBase(path)) return renderBaseEmbed(el, path, sub);
  return renderDrawingEmbed(el, path, width);
}

// Render ![[Drawing.excalidraw]] into `el` (reading view, live preview and note embeds).
function renderDrawingEmbed(el, path, width) {
  el.classList.add('drawing-embed');
  el.dataset.drawing = path;
  el.title = `${drawingName(path)} — click to edit`;
  const img = document.createElement('img');
  img.alt = drawingName(path);
  if (width) img.width = width;
  el.replaceChildren(img);
  drawingSvgUrl(path).then(u => { img.src = u; }, e => { el.textContent = `(couldn’t show drawing “${drawingName(path)}”: ${e.message})`; });
}

async function exportDrawing(kind) {
  if (S.view !== 'drawing' || !S.cur) return toast('Open a drawing first');
  const path = S.cur.replace(DRAWING_EXT, '').replace(/\.md$/i, '') + '.' + kind;
  if (S.files.has(path) && !confirm(`Replace the existing "${basename(path)}"?`)) return;
  try {
    const content = kind === 'svg' ? await FolioDraw.exportSVG({ fontData: await virgilData() }) : await FolioDraw.exportPNG();
    await writeFile(path, content, S.files.get(path)?.mtime);
    reindexAll(); renderTree();
    toast(`Saved ${basename(path)}`);
  } catch (e) { toast('Export failed: ' + e.message); }
}

async function copyDrawing(kind, onlySelected) {
  try {
    if (kind === 'png') await navigator.clipboard.write([new ClipboardItem({ 'image/png': FolioDraw.exportPNG({ onlySelected }) })]);
    else await navigator.clipboard.writeText(await FolioDraw.exportSVG({ onlySelected, fontData: await virgilData() }));
    toast(kind === 'png' ? 'Copied as PNG' : 'Copied as SVG');
  } catch (e) { toast('Couldn’t copy: ' + e.message); }
}

// Element links in drawings: [[Note]], a note name, or a web address.
function openDrawingLink(link) {
  const t = String(link).trim();
  const m = /^\[\[([^\]]+)\]\]$/.exec(t);
  if (!m && /^[a-z][a-z0-9+.-]*:/i.test(t)) {
    if (/^(https?:|mailto:)/i.test(t)) window.open(t, '_blank', 'noopener');
    return;
  }
  const [tgt] = splitOnce(m ? m[1] : t, '|');
  const [name, sub] = splitOnce(tgt, '#');
  followLink(name.trim(), sub, S.cur);
}

// ============================================================ tabs

// Each tab shows one thing: a file, the graph (':graph'), tasks (':tasks'), or nothing (null).
// A tab has its own back/forward history (swapped in and out of S.hist), and a note keeps its
// editor state, undo history included, while it's open in a tab.
S.tabs = []; S.tab = -1;
const edStates = new Map(); // note path -> editor state
const closedTabs = [];      // keys, for "Reopen closed tab"
let tabSeq = 0;
const newTabObj = key => ({ id: ++tabSeq, key, hist: key ? [key] : [], histIdx: key ? 0 : -1 });
const curTab = () => S.tabs[S.tab];
const viewKey = () => S.view === 'graph' ? ':graph' : S.view === 'tasks' ? ':tasks' : S.view === 'empty' ? null : S.cur;
const tabName = k => k == null ? 'New tab' : k === ':graph' ? 'Graph' : k === ':tasks' ? 'Tasks' : displayName(k);

// The page changed what it shows (see showView): the current tab follows.
function syncTab() {
  if (!S.tabs.length) { S.tabs.push(newTabObj(null)); S.tab = 0; }
  const t = curTab();
  t.key = viewKey(); t.hist = S.hist; t.histIdx = S.histIdx;
  pruneEdStates();
  saveTabs(); renderTabs();
}
function pruneEdStates() { const open = new Set(S.tabs.map(t => t.key)); for (const k of edStates.keys()) if (!open.has(k)) edStates.delete(k); }
function saveTabs() { store('tabs', { keys: S.tabs.map(t => t.key), active: S.tab }); }

// Show tab i: its history comes back and its thing reopens.
async function activateTab(i, opts = {}) {
  if (i < 0 || i >= S.tabs.length) return;
  if (i === S.tab && !opts.force) return focusMain();
  const t = S.tabs[i];
  const old = curTab();
  if (old) { old.hist = S.hist; old.histIdx = S.histIdx; }
  S.tab = i; S.hist = t.hist; S.histIdx = t.histIdx;
  await openKey(t.key, opts);
}
async function openKey(k, opts = {}) {
  if (k === ':graph') return openGraph(false);
  if (k === ':tasks') return openTasks();
  if (k && S.files.has(k)) return openPath(k, { push: false, ...opts });
  flushDocViews(); await save(); rememberPos();
  S.cur = null; showEmpty();
}

// Open something in a new tab next to the current one (or at the end).
async function openInNewTab(k, opts = {}) {
  const old = curTab();
  if (old) { old.hist = S.hist; old.histIdx = S.histIdx; }
  const t = newTabObj(null);
  S.tabs.splice(S.tab + 1, 0, t);
  S.tab = S.tab + 1; S.hist = []; S.histIdx = -1;
  if (k == null) { await openKey(null); if (opts.switcher) openSwitcher(); return; }
  if (k.startsWith(':')) return openKey(k);
  await openPath(k, opts);
}

async function closeTab(i = S.tab) {
  const t = S.tabs[i];
  if (!t) return;
  if (i === S.tab) await save();
  if (t.key) closedTabs.push(t.key);
  if (S.tabs.length === 1) { S.tabs[0] = newTabObj(null); S.tab = 0; S.hist = []; S.histIdx = -1; return openKey(null); }
  S.tabs.splice(i, 1);
  if (i === S.tab) { S.tab = -1; await activateTab(Math.min(i, S.tabs.length - 1), { force: true }); }
  else { if (i < S.tab) S.tab--; saveTabs(); renderTabs(); }
  pruneEdStates();
}
async function closeTabs(keep) {
  const keepTabs = S.tabs.filter((t, i) => keep(t, i));
  if (!keepTabs.length) return;
  const cur = curTab();
  for (const t of S.tabs) if (!keepTabs.includes(t) && t.key) closedTabs.push(t.key);
  S.tabs = keepTabs;
  const i = S.tabs.indexOf(cur);
  if (i >= 0) { S.tab = i; saveTabs(); renderTabs(); pruneEdStates(); }
  else { S.tab = -1; await activateTab(0, { force: true }); }
}
function reopenClosedTab() {
  while (closedTabs.length) {
    const k = closedTabs.pop();
    if (k.startsWith(':') || S.files.has(k)) return openInNewTab(k);
  }
  toast('No closed tabs to reopen');
}
const cycleTab = d => S.tabs.length > 1 && activateTab((S.tab + d + S.tabs.length) % S.tabs.length);

// Files renamed or deleted: tabs follow, or close.
function tabsAfterRename(moved) {
  for (const t of S.tabs) { if (moved.has(t.key)) t.key = moved.get(t.key); t.hist = t.hist.map(h => moved.get(h) || h); }
  for (const [a, b] of moved) if (edStates.has(a)) { edStates.set(b, edStates.get(a)); edStates.delete(a); }
  saveTabs(); renderTabs();
}
function tabsAfterDelete() {
  const gone = k => k && !k.startsWith(':') && !S.files.has(k);
  for (const t of S.tabs) { t.hist = t.hist.filter(h => !gone(h)); t.histIdx = Math.min(t.histIdx, t.hist.length - 1); }
  const cur = curTab();
  S.tabs = S.tabs.filter(t => t === cur || !gone(t.key));
  S.tab = S.tabs.indexOf(cur);
  if (gone(cur?.key)) cur.key = null;
  pruneEdStates(); saveTabs(); renderTabs();
}

function renderTabs() {
  const bar = $('#tabbar .tabs-list');
  bar.innerHTML = S.tabs.map((t, i) => `<div class="tab${i === S.tab ? ' active' : ''}" data-i="${i}" draggable="true" title="${esc(t.key && !t.key.startsWith(':') ? t.key : tabName(t.key))}" role="tab" aria-selected="${i === S.tab}"><span class="tab-name">${esc(tabName(t.key))}</span><button class="tab-x" tabindex="-1" title="Close (Ctrl+W)">×</button></div>`).join('');
  bar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

let dragTab = null;
$('#tabbar').addEventListener('mousedown', e => { if (e.button === 1 && e.target.closest('.tab')) e.preventDefault(); }); // no autoscroll
$('#tabbar').addEventListener('click', e => {
  if (e.target.closest('.tab-new')) return openInNewTab(null, { switcher: true });
  const tab = e.target.closest('.tab');
  if (!tab) return;
  if (e.target.closest('.tab-x')) return closeTab(+tab.dataset.i);
  activateTab(+tab.dataset.i);
});
$('#tabbar').addEventListener('auxclick', e => { const tab = e.target.closest('.tab'); if (tab && e.button === 1) closeTab(+tab.dataset.i); });
$('#tabbar').addEventListener('dblclick', e => { if (!e.target.closest('.tab, button')) openInNewTab(null, { switcher: true }); });
$('#tabbar').addEventListener('contextmenu', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  e.preventDefault();
  const i = +tab.dataset.i, t = S.tabs[i];
  menu(e.clientX, e.clientY, [
    ['Close', () => closeTab(i)],
    ['Close other tabs', () => closeTabs(x => x === t)],
    ['Close tabs to the right', () => closeTabs((x, j) => j <= i)],
    null,
    ['Duplicate tab', () => { activateTab(i).then(() => openInNewTab(t.key)); }],
    ...(t.key && !t.key.startsWith(':') ? [['Reveal in file tree', () => revealInTree(t.key)], ['Copy path', () => navigator.clipboard?.writeText(t.key).then(() => toast('Path copied'))]] : []),
  ]);
});
$('#tabbar').addEventListener('dragstart', e => { const tab = e.target.closest('.tab'); if (!tab) return; dragTab = S.tabs[+tab.dataset.i]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tabName(dragTab.key)); });
$('#tabbar').addEventListener('dragover', e => {
  if (!dragTab) return;
  const tab = e.target.closest('.tab');
  e.preventDefault();
  $$('#tabbar .tab.drop-before, #tabbar .tab.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  if (tab) { const r = tab.getBoundingClientRect(); tab.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after'); }
});
$('#tabbar').addEventListener('drop', e => {
  if (!dragTab) return;
  e.preventDefault();
  const tab = e.target.closest('.tab'), cur = curTab(), moving = dragTab;
  let to = S.tabs.length;
  if (tab) { const r = tab.getBoundingClientRect(); to = +tab.dataset.i + (e.clientX < r.left + r.width / 2 ? 0 : 1); }
  const from = S.tabs.indexOf(moving);
  S.tabs.splice(from, 1);
  S.tabs.splice(to > from ? to - 1 : to, 0, moving);
  S.tab = S.tabs.indexOf(cur);
  dragTab = null; saveTabs(); renderTabs();
});
$('#tabbar').addEventListener('dragend', () => { dragTab = null; $$('#tabbar .drop-before, #tabbar .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); });

// Start with the tabs from last time (or the last file, in one tab).
async function restoreTabs() {
  const saved = store('tabs');
  const keys = (saved?.keys || []).filter(k => k == null || k.startsWith(':') || S.files.has(k));
  if (!keys.length) {
    const last = store('last');
    S.tabs = [newTabObj(last && S.files.has(last) ? last : null)];
  } else S.tabs = keys.map(newTabObj);
  S.tab = -1;
  await activateTab(Math.max(0, Math.min(saved?.active ?? 0, S.tabs.length - 1)), { force: true, focus: false });
}

// ============================================================ canvases

// Leave a drawing or canvas cleanly: finish any text being typed.
function flushDocViews() {
  if (S.view === 'drawing') FolioDraw.flush();
  if (S.view === 'canvas') FolioCanvas.flush();
}

function indexCanvas(p, content, mtime) {
  let refs = [];
  try { refs = FolioCanvas.fileRefs(FolioCanvas.parseCanvas(content)); } catch { }
  S.canvases.set(p, { mtime, refs });
}

async function openCanvas(p) {
  FolioCanvas.load({ nodes: [], edges: [] }, { path: p }); // don't show the previous canvas while this one loads
  showView('canvas');
  $('#crumbs').innerHTML = crumbsHtml(p);
  document.title = `${displayName(p)} — ${VAULT} — Folio`;
  setSaveState('');
  renderTreeActive(true);
  refreshPanels();
  const got = await readMany([p]).catch(e => ({ error: e }));
  if (S.cur !== p) return;
  if (!got[p]) return showDrawingError(p, got.error || new Error('the file couldn’t be read'), 'a canvas');
  loadCanvas(p, got[p].content, got[p].mtime, S.pos.get(p)?.canvas);
}

function loadCanvas(p, content, mtime, view) {
  let data;
  try { data = FolioCanvas.parseCanvas(content); } catch (e) { showDrawingError(p, e, 'a canvas'); return false; }
  S.canvasDoc = { mtime };
  if (S.view !== 'canvas') showView('canvas');
  FolioCanvas.load(data, { view, path: p });
  indexCanvas(p, content, mtime);
  updateStatus();
  return true;
}

function canvasChanged() {
  if (S.view !== 'canvas' || !S.canvasDoc) return;
  S.dirty = true;
  setSaveState('Unsaved');
  scheduleSave();
  updateStatus();
}

async function doSaveCanvas(force) {
  const p = S.cur, d = S.canvasDoc;
  S.dirty = false; setSaveState('Saving…');
  const content = FolioCanvas.serializeCanvas(FolioCanvas.getData());
  try {
    const headers = (!force && d.mtime) ? { 'X-Base-Mtime': String(d.mtime) } : {};
    const r = await api(`/api/file?path=${enc(p)}`, { method: 'PUT', body: content, headers });
    d.mtime = r.mtime;
    S.files.set(p, { ...S.files.get(p), mtime: r.mtime, size: new Blob([content]).size });
    indexCanvas(p, content, r.mtime);
    S.version++;
    if (!S.dirty) setSaveState('Saved');
    refreshPanels(true);
    return;
  } catch (e) {
    S.dirty = true;
    if (e.status !== 409) { setSaveState('Save failed: ' + e.message, true); return; }
  }
  if (confirm(`"${basename(p)}" was changed outside Folio.\n\nOK — overwrite it with your version\nCancel — discard your changes and load the version on disk`)) return doSaveCanvas(true);
  S.dirty = false;
  const got = (await readMany([p]).catch(() => ({})))[p];
  if (got && S.cur === p) loadCanvas(p, got.content, got.mtime, FolioCanvas.getView());
  setSaveState('Reloaded from disk');
}

async function newCanvas(folder) {
  if (folder == null) folder = cfg.newNoteFolder;
  const path = uniquePath(folder, 'Untitled.canvas');
  await createNote(path, FolioCanvas.serializeCanvas({ nodes: [], edges: [] }));
}

// What a file card on a canvas shows.
function renderCanvasFile(el, path, sub) {
  if (!S.files.has(path)) { el.innerHTML = `<p class="cv-empty">Missing: ${esc(path)}</p>`; return; }
  if (IMG_EXT.test(path)) { el.classList.add('cv-image'); el.innerHTML = `<img src="${rawUrl(path)}" alt="" draggable="false">`; return; }
  if (visualEmbed(path)) { const d = document.createElement('div'); el.append(d); renderVisualEmbed(d, path); return; }
  if (isMd(path)) {
    const n = S.notes.get(path);
    el.classList.add('markdown');
    const h = sub ? sub.replace(/^#/, '') : '';
    renderInto(el, n ? (h ? extractSection(n, h) : n.content) : '', path, 1);
    return;
  }
  const f = S.files.get(path);
  el.innerHTML = `<div class="cv-link"><div class="cv-link-host">${esc(basename(path))}</div><div class="cv-empty">${f ? (f.size / 1024).toFixed(1) + ' KB' : ''}</div></div>`;
}

// A picture of the canvas for ![[Board.canvas]] embeds, cached by file version and theme.
const canvasSvgCache = new Map();
function canvasSvgUrl(path) {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  const theme = `${document.documentElement.dataset.theme}|${document.documentElement.dataset.palette}`;
  const key = `${S.files.get(path)?.mtime}|${theme}|${S.version}`;
  const hit = canvasSvgCache.get(path);
  if (hit && hit.key === key) return hit.promise;
  const promise = (async () => {
    const content = (await readMany([path]))[path]?.content;
    if (content == null) throw new Error('file not found');
    const data = FolioCanvas.parseCanvas(content);
    const colors = { 1: v('--cv-red'), 2: v('--cv-orange'), 3: v('--cv-yellow'), 4: v('--cv-green'), 5: v('--cv-cyan'), 6: v('--cv-purple') };
    const svg = FolioCanvas.toSVG(data, {
      colors, text: v('--text'), muted: v('--muted'), bg: v('--bg'), border: v('--border'),
      noteText: p => S.notes.get(p)?.content ?? null, name: p => displayName(p),
    });
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  })();
  canvasSvgCache.set(path, { key, promise });
  if (hit) hit.promise.then(u => setTimeout(() => URL.revokeObjectURL(u), 10000), () => { });
  promise.catch(() => { if (canvasSvgCache.get(path)?.promise === promise) canvasSvgCache.delete(path); });
  return promise;
}
function renderCanvasEmbed(el, path, width) {
  el.classList.add('canvas-embed');
  el.dataset.canvas = path;
  el.title = `${displayName(path)} — click to open the canvas`;
  const img = document.createElement('img');
  img.alt = displayName(path);
  if (width) img.width = width;
  el.replaceChildren(img);
  canvasSvgUrl(path).then(u => { img.src = u; }, e => { el.textContent = `(couldn’t show canvas “${displayName(path)}”: ${e.message})`; });
}

// ============================================================ bases

let baseView = null;
let rowsCache = { gen: -1, rows: [] };
const propsCache = new WeakMap();
function noteProps(n) {
  let p = propsCache.get(n);
  if (!p) { p = FolioBases.frontmatter(n.content); propsCache.set(n, p); }
  return p;
}
// Every file in the vault as a base row: file.* fields plus the note's properties.
function baseRows() {
  if (rowsCache.gen === S.dataGen) return rowsCache.rows;
  const rows = [];
  for (const [p, f] of S.files) {
    const n = S.notes.get(p), name = basename(p);
    rows.push({
      path: p, name, basename: isMd(name) ? name.slice(0, -3) : name.replace(/\.[^.]+$/, ''), folder: dirname(p),
      ext: name.includes('.') ? name.split('.').pop().toLowerCase() : '', size: f.size || 0, ctime: f.ctime || f.mtime || 0, mtime: f.mtime || 0,
      tags: n ? [...n.tags] : [], links: n ? [...new Set((n.out || []).filter(Boolean))] : [], props: n ? noteProps(n) : {},
    });
  }
  rowsCache = { gen: S.dataGen, rows };
  return rows;
}

function baseHooks(basePath, thisPath) {
  return {
    rows: baseRows,
    thisRow: () => baseRows().find(r => r.path === thisPath) || null,
    backlinks: p => [...backlinksOf(p).keys()],
    openFile: p => openPath(p),
    openLink: name => followLink(name, null, thisPath),
    imageUrl: (v, from) => {
      const s = String(v).replace(/^!?\[\[|\]\]$/g, '').split('|')[0].trim();
      if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // Folio never loads images from the web
      const t = resolveLink(s, from);
      return t && IMG_EXT.test(t) ? rawUrl(t) : null;
    },
    setProperty: (p, k, v) => setNoteProperty(p, k, v),
    createNote: (folder, props) => createNoteWithProps(folder, props),
    save: b => saveBaseFile(basePath, b),
    menu: (x, y, items) => menu(x, y, items),
    prompt: (title, label, value) => promptModal(title, label, value),
    toast: msg => toast(msg),
  };
}

async function openBase(p) {
  showView('base');
  $('#view-base').replaceChildren();
  $('#crumbs').innerHTML = crumbsHtml(p);
  document.title = `${displayName(p)} — ${VAULT} — Folio`;
  setSaveState('');
  renderTreeActive(true);
  refreshPanels();
  const got = await readMany([p]).catch(e => ({ error: e }));
  if (S.cur !== p) return;
  if (!got[p]) return showDrawingError(p, got.error || new Error('the file couldn’t be read'), 'a base');
  loadBase(p, got[p].content, got[p].mtime);
}
function loadBase(p, text, mtime) {
  let base;
  try { base = FolioBases.parseBase(text); } catch (e) { showDrawingError(p, e, 'a base'); return; }
  S.baseDoc = { mtime, text };
  if (S.view !== 'base') showView('base');
  const el = document.createElement('div');
  $('#view-base').replaceChildren(el);
  baseView = FolioBases.mount(el, { base, path: p, editable: true, view: S.pos.get(p)?.baseView, hooks: baseHooks(p, p) });
  updateStatus();
}
async function reloadBase() {
  const p = S.cur;
  const got = (await readMany([p]).catch(() => ({})))[p];
  if (got && S.cur === p && S.view === 'base' && !S.dirty) {
    const name = baseView?.viewName();
    S.pos.set(p, { baseView: name });
    loadBase(p, got.content, got.mtime);
  }
}

// A base's view settings changed in the UI: save the .base file.
async function saveBaseFile(path, base) {
  const text = FolioBases.serializeBase(base);
  if (S.view === 'base' && S.cur === path && S.baseDoc) {
    S.baseDoc.text = text;
    S.dirty = true; setSaveState('Unsaved'); scheduleSave();
    return;
  }
  try { await writeFile(path, text, S.files.get(path)?.mtime); } catch (e) { toast('Couldn’t save the base: ' + e.message); }
}
async function doSaveBase(force) {
  const p = S.cur, d = S.baseDoc;
  S.dirty = false; setSaveState('Saving…');
  try {
    const r = await api(`/api/file?path=${enc(p)}`, { method: 'PUT', body: d.text, headers: (!force && d.mtime) ? { 'X-Base-Mtime': String(d.mtime) } : {} });
    d.mtime = r.mtime;
    S.files.set(p, { ...S.files.get(p), mtime: r.mtime, size: new Blob([d.text]).size });
    if (!S.dirty) setSaveState('Saved');
    return;
  } catch (e) {
    S.dirty = true;
    if (e.status !== 409) { setSaveState('Save failed: ' + e.message, true); return; }
  }
  if (confirm(`"${basename(p)}" was changed outside Folio.\n\nOK — overwrite it with your version\nCancel — discard your changes and load the version on disk`)) return doSaveBase(true);
  S.dirty = false;
  await reloadBase();
  setSaveState('Reloaded from disk');
}

// Change one frontmatter property of a note (from a base's table, board or checkbox).
async function setNoteProperty(path, key, value) {
  if (!S.notes.has(path)) return toast('Only notes have properties');
  if (path === S.cur && S.view === 'note') await save();
  const n = S.notes.get(path);
  const text = FolioBases.setFrontmatter(n.content, key, value);
  if (text === n.content) return;
  try { await writeFile(path, text, n.mtime); } catch (e) { toast(`Couldn’t update ${noteName(path)}: ${e.message}`); return; }
  resolveNote(path);
  if (path === S.cur && S.view === 'note') reloadEditorFromDisk(text);
  refreshBases();
  refreshPanels(true);
}
function refreshBases() {
  if (S.view === 'base') baseView?.refresh();
  else if (S.view === 'note') { S.version++; refreshEditorSoon(); if (S.mode === 'read') renderPreview(); }
}

async function createNoteWithProps(folder, props) {
  let text = '';
  for (const [k, v] of Object.entries(props || {})) text = FolioBases.setFrontmatter(text, k, v);
  await createNote(uniquePath(folder ?? cfg.newNoteFolder, 'Untitled.md'), text, { focusTitle: true, mode: 'edit' });
}

async function newBase(folder) {
  if (folder == null) folder = cfg.newNoteFolder;
  await createNote(uniquePath(folder, 'Untitled.base'), 'views:\n  - type: table\n    name: Table\n');
}

// ![[Books.base]] or ![[Books.base#View name]]: a live base inside a note.
function renderBaseEmbed(el, path, sub) {
  el.classList.add('base-embed');
  const host = document.createElement('div');
  el.replaceChildren(host);
  const thisPath = S.cur;
  readMany([path]).then(got => {
    if (!got[path]) throw new Error('file not found');
    const base = FolioBases.parseBase(got[path].content);
    FolioBases.mount(host, { base, path, editable: true, embedded: true, view: sub || undefined, stateKey: `${thisPath}|${path}|${sub || ''}`, hooks: baseHooks(path, thisPath) });
  }).catch(e => { host.innerHTML = `<div class="bs-error">Couldn’t show ${esc(displayName(path))}: ${esc(e.message)}</div>`; });
}

// ```base blocks inside a note: view changes are written back into the block.
function renderBaseBlock(el, code, notePath) {
  el.classList.add('base-embed');
  let base;
  try { base = FolioBases.parseBase(code); } catch (e) { el.innerHTML = `<div class="bs-error">This base block has a problem: ${esc(e.message)}</div>`; return; }
  let current = code;
  FolioBases.mount(el, {
    // The UI state follows the block by its view names (they survive sorting and filtering).
    base, path: notePath, editable: true, embedded: true, stateKey: `${notePath}|block|${base.views.map(v => v.name).join('|')}`,
    hooks: { ...baseHooks(notePath, notePath), save: b => { const next = FolioBases.serializeBase(b).replace(/\n$/, ''); saveBaseBlock(notePath, current, next); current = next; } },
  });
}
async function saveBaseBlock(notePath, oldCode, newCode) {
  // Find the block's code after any fence the editor treats as "base": ``` or ~~~, any length and case.
  const escRe = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\n)([ \\t]*(\`{3,}|~{3,})[ \\t]*base[ \\t]*\\r?\\n)${escRe(oldCode)}${oldCode ? '\\r?\\n' : ''}[ \\t]*\\3`, 'i');
  const find = src => { const m = re.exec(src); return m ? m.index + m[1].length + m[2].length : -1; };
  if (S.cur === notePath && S.view === 'note') {
    const i = find(ed.value);
    if (i < 0) return toast('Couldn’t find that base block to update');
    // Keep the cursor where it was (outside the block), shifted by the change in length.
    const delta = newCode.length - oldCode.length, shift = x => x >= i + oldCode.length ? x + delta : x;
    ed.insert(i, i + oldCode.length, newCode, shift(ed.selectionStart), shift(ed.selectionEnd));
    return;
  }
  const n = S.notes.get(notePath), i = n ? find(n.content) : -1;
  if (i < 0) return toast('Couldn’t find that base block to update');
  try { await writeFile(notePath, n.content.slice(0, i) + newCode + n.content.slice(i + oldCode.length), n.mtime); resolveNote(notePath); } catch (e) { toast('Couldn’t save the base block: ' + e.message); }
}

// ============================================================ tasks

let tasksView = null;
let tasksCache = { gen: -1, tasks: [] };
function allTasks() {
  if (tasksCache.gen === S.dataGen) return tasksCache.tasks;
  const tasks = [];
  // Template notes hold example tasks, not real ones.
  const tpl = cfg.templatesFolder ? cfg.templatesFolder + '/' : null;
  for (const [p, n] of S.notes) if (!isDrawing(p) && !(tpl && p.startsWith(tpl))) tasks.push(...FolioTasks.parseNote(p, n.content));
  tasksCache = { gen: S.dataGen, tasks };
  return tasks;
}
const findTask = (path, line) => allTasks().find(x => x.path === path && x.line === line);

// Rewrite one task's line (fn: line -> [lines]) wherever the note is: the editor or disk.
async function modifyTaskLine(x, fn) {
  const inEditor = x.path === S.cur && S.view === 'note';
  const content = inEditor ? ed.value : S.notes.get(x.path)?.content;
  if (content == null) return;
  const lines = content.split('\n');
  let li = x.line;
  if ((lines[li] || '').replace(/\r$/, '') !== x.raw) li = lines.findIndex(l => l.replace(/\r$/, '') === x.raw);
  if (li < 0) { toast('That task has changed since the list was drawn'); refreshTasks(); return; }
  const cr = lines[li].endsWith('\r') ? '\r' : '';
  const text = fn(lines[li].replace(/\r$/, '')).map(l => l + cr).join('\n');
  let start = 0;
  for (let k = 0; k < li; k++) start += lines[k].length + 1;
  const end = start + lines[li].length;
  if (inEditor) {
    const delta = text.length - (end - start), shift = v => v > end ? v + delta : v;
    ed.insert(start, end, text, shift(ed.selectionStart), shift(ed.selectionEnd));
    // The editor holds the newest text; index it now so task lists redraw from it (saving follows).
    const n = S.notes.get(x.path);
    if (n) { setNote(x.path, ed.value, n.mtime); resolveNote(x.path); }
  } else {
    try { await writeFile(x.path, content.slice(0, start) + text + content.slice(end), S.notes.get(x.path).mtime); resolveNote(x.path); }
    catch (e) { toast(`Couldn’t update ${noteName(x.path)}: ${e.message}`); return; }
  }
  refreshTasks();
}
const toggleTaskItem = x => modifyTaskLine(x, l => FolioTasks.toggle(l, { date: FolioTasks.today(), doneDate: cfg.taskDoneDate }));
const setTaskField = (x, f, v) => modifyTaskLine(x, l => [FolioTasks.setField(l, f, v)]);
const cancelTask = x => modifyTaskLine(x, l => [FolioTasks.setStatus(l, '-')]);

function refreshTasks() {
  if (S.view === 'tasks') tasksView?.refresh();
  else if (S.view === 'note') { S.version++; refreshEditorSoon(); if (S.mode === 'read') renderPreview(); }
  updateTaskBadge();
  updateStatus();
}

// The ribbon's Tasks button shows how many open tasks are due today or overdue.
function updateTaskBadge() {
  const b = $('[data-cmd=tasks] .rb-badge');
  if (!b) return;
  const t = FolioTasks.today();
  const n = allTasks().filter(x => !x.done && !x.cancelled && (x.due || x.scheduled) && (x.due || x.scheduled) <= t).length;
  b.textContent = n > 99 ? '99+' : String(n);
  b.hidden = !n;
}

function taskInboxPath() {
  const p = String(cfg.taskInbox || '').trim().replace(/^\/+/, '');
  if (!p) return join(cfg.dailyFolder, FolioTasks.today() + '.md');
  return isMd(p) ? p : p + '.md';
}

// Append a task line to the inbox note (creating it if needed).
async function addTask(line) {
  const path = taskInboxPath();
  try {
    if (path === S.cur && S.view === 'note') {
      const v = ed.value, pre = v && !v.endsWith('\n') ? '\n' : '';
      ed.insert(v.length, v.length, pre + line + '\n', ed.selectionStart, ed.selectionEnd);
      await save();
    } else if (S.notes.has(path)) {
      const n = S.notes.get(path), pre = n.content && !n.content.endsWith('\n') ? '\n' : '';
      await writeFile(path, n.content + pre + line + '\n', n.mtime);
      resolveNote(path);
    } else {
      await writeFile(path, line + '\n');
      let d = dirname(path);
      while (d) { S.dirs.add(d); d = dirname(d); }
      reindexAll(); renderTree();
    }
  } catch (e) { toast('Couldn’t add the task: ' + e.message); return; }
  toast(`Added to ${noteName(path)}`);
  refreshTasks();
}

function taskHooks() {
  return {
    tasks: allTasks,
    find: findTask,
    inline: (text, path) => {
      const prev = RC;
      RC = { from: path, depth: 1 };
      const div = document.createElement('div');
      try { div.innerHTML = DOMPurify.sanitize(marked.parseInline(text), { FORBID_TAGS: ['style', 'form', 'button', 'iframe', 'object', 'embed', 'img', 'input'] }); } finally { RC = prev; }
      linkifyTags(div);
      renderMathIn(div);
      return div.innerHTML;
    },
    toggle: x => toggleTaskItem(x),
    setField: (x, f, v) => setTaskField(x, f, v),
    cancel: x => cancelTask(x),
    open: (path, line) => {
      const c = S.notes.get(path)?.content || '';
      let off = 0;
      for (let k = 0, i = 0; k < line && i >= 0; k++) { i = c.indexOf('\n', off); off = i < 0 ? c.length : i + 1; }
      const end = c.indexOf('\n', off);
      openPath(path, { mode: 'edit', select: [off, end < 0 ? c.length : end] });
    },
    menu: (x, y, items) => menu(x, y, items),
    add: line => addTask(line),
    inboxLabel: () => noteName(taskInboxPath()) + (cfg.taskInbox ? '' : ' (today’s daily note)'),
  };
}

async function openTasks() {
  flushDocViews();
  await save();
  rememberPos();
  showView('tasks');
  setSaveState('');
  $('#crumbs').innerHTML = '<b>Tasks</b>';
  document.title = `Tasks — ${VAULT} — Folio`;
  if (!tasksView) tasksView = FolioTasks.mountView($('#view-tasks'), taskHooks());
  else tasksView.refresh();
  updateStatus();
  requestAnimationFrame(() => $('#view-tasks .tk-add')?.focus());
}

// A small quick-add box usable from anywhere.
function quickAddTask() {
  const back = modal(`<div class="form tk-quick"><h3>Add a task</h3><input class="field" placeholder="e.g. “Call the dentist friday !high”" spellcheck="false"><div class="tk-preview"></div><div class="tk-inbox">Adds to ${esc(taskHooks().inboxLabel())}</div></div>`);
  const input = $('input', back), pv = $('.tk-preview', back);
  input.focus();
  input.addEventListener('input', () => {
    const q = FolioTasks.parseQuick(input.value);
    pv.textContent = input.value.trim() ? [q.text, q.due && FolioTasks.friendly(q.due), q.priority && q.priority + ' priority', q.recur && 'repeats ' + q.recur].filter(Boolean).join(' · ') : '';
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') back.remove();
    if (e.key === 'Enter' && input.value.trim()) { const q = FolioTasks.parseQuick(input.value); back.remove(); if (q.text) addTask(FolioTasks.formatTask(q)); }
  });
  back.addEventListener('mousedown', e => { if (e.target === back) back.remove(); });
}

// ```tasks blocks: a live query of tasks across the vault.
function renderTasksBlock(el, code) {
  el.classList.add('tasks-embed');
  FolioTasks.mountQuery(el, code, taskHooks());
}

function goHist(d) {
  const i = S.histIdx + d;
  if (i < 0 || i >= S.hist.length) return;
  S.histIdx = i;
  openPath(S.hist[i], { push: false });
}
function updateHistButtons() {
  $('[data-cmd=back]').disabled = S.histIdx <= 0;
  $('[data-cmd=forward]').disabled = S.histIdx >= S.hist.length - 1;
}

async function followLink(name, sub, from, opts = {}) {
  const target = resolveLink(name, from);
  if (target) {
    if (target === S.cur && sub) return scrollToHeading(sub);
    return openPath(target, { heading: sub || undefined });
  }
  // Unresolved: create it (Obsidian behaviour).
  const clean = name.replace(/\.md$/i, '');
  const path = clean.includes('/') ? normPath(clean) + '.md' : join(cfg.newNoteFolder, clean + '.md');
  await createNote(path, '', { mode: 'edit', ...opts });
}

function setMode(m, silent = false) {
  if (S.view !== 'note') return;
  if (!silent && S.mode === 'edit') rememberPos();
  S.mode = m;
  const reading = m === 'read';
  $('#edit-wrap').hidden = reading;
  preview.hidden = !reading;
  $('#mode-btn').innerHTML = reading
    ? '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M3 5.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H3zM21 5.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H21z"/></svg>';
  $('#mode-btn').title = reading ? 'Edit (Ctrl+E)' : 'Reading view (Ctrl+E)';
  if (reading) renderPreview();
  else { ed.refresh(); if (!silent) ed.focus(); }
}

function scrollToHeading(h) {
  const n = S.notes.get(S.cur); if (!n) return;
  const want = h.replace(/^\^/, '').trim().toLowerCase();
  const hd = n.headings.find(x => x.text.trim().toLowerCase() === want) || n.headings.find(x => slug(x.text) === slug(want));
  if (S.mode === 'read') {
    const el = hd ? preview.querySelector(`#${CSS.escape('h-' + slug(hd.text))}`) : null;
    if (el) el.scrollIntoView({ block: 'start' });
  } else if (hd) {
    selectRange(hd.index, hd.index);
  }
}

function selectRange(a, b) {
  if (S.mode !== 'edit') setMode('edit');
  ed.focus();
  ed.setSelectionRange(a, b, true);
}

// ============================================================ markdown rendering

const slug = s => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
let RC = { from: null, depth: 0 }; // render context for link resolution

marked.use({
  gfm: true,
  breaks: true,
  extensions: [
    {
      // $$ … $$ on their own lines
      name: 'blockMath', level: 'block',
      start(src) { const i = src.search(/^ {0,3}\$\$/m); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^ {0,3}\$\$([\s\S]*?)\$\$[ \t]*(?:\n|$)/.exec(src);
        if (m) return { type: 'blockMath', raw: m[0], tex: m[1].trim() };
      },
      renderer(t) { return `<div class="math math-block" data-tex="${esc(t.tex)}"></div>\n`; },
    },
    {
      // $x$ (not "$5 and $10") and $$display$$ inside text
      name: 'inlineMath', level: 'inline',
      start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
      tokenizer(src) {
        let m = /^\$\$((?:\\.|[^\\$])+?)\$\$/.exec(src);
        if (m) return { type: 'inlineMath', raw: m[0], tex: m[1], display: true };
        m = /^\$(?![\s$])((?:\\.|[^\\$\n])*?[^\s\\])\$(?!\d)/.exec(src);
        if (m) return { type: 'inlineMath', raw: m[0], tex: m[1] };
      },
      renderer(t) { return `<span class="math${t.display ? ' math-display' : ''}" data-tex="${esc(t.tex)}"></span>`; },
    },
    {
      name: 'wiki', level: 'inline',
      start(src) { const i = src.search(/!?\[\[/); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^(!?)\[\[([^\[\]\n]+?)\]\]/.exec(src);
        if (m) return { type: 'wiki', raw: m[0], embed: !!m[1], inner: m[2] };
      },
      renderer(t) { return renderWiki(t); },
    },
    {
      name: 'hl', level: 'inline',
      start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^==(?=\S)([^\n]*?\S)==/.exec(src);
        if (m) return { type: 'hl', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
    },
  ],
});

function renderWiki(t) {
  const [tgt, alias] = splitOnce(t.inner, '|');
  const [name, sub] = splitOnce(tgt, '#');
  const target = resolveLink(name.trim(), RC.from);
  if (t.embed) {
    if (target && visualEmbed(target)) {
      const w = alias && /^\d+/.test(alias.trim()) ? parseInt(alias) : '';
      return `<span class="visual-embed" data-path="${esc(target)}" data-width="${w}" data-sub="${esc(sub || '')}"></span>`;
    }
    if (target && IMG_EXT.test(target)) {
      const w = alias && /^\d+(x\d+)?$/.test(alias.trim()) ? ` width="${alias.split('x')[0]}"` : '';
      return `<img src="${rawUrl(target)}" alt="${esc(noteName(target))}" data-path="${esc(target)}"${w}>`;
    }
    if (target && isMd(target)) {
      return `<span class="embed" data-embed="${esc(target)}" data-sub="${esc(sub || '')}"></span>`;
    }
    if (target) return `<a class="internal-link" data-href="${esc(target)}" data-path="1">${esc(basename(target))}</a>`;
  }
  const label = alias != null ? alias : (sub ? `${name}${name ? ' › ' : ''}${sub.replace(/^\^/, '')}` : name);
  return `<a class="internal-link${target ? '' : ' unresolved'}" data-href="${esc(name.trim())}" data-sub="${esc(sub || '')}" data-from="${esc(RC.from || '')}">${esc(label)}</a>`;
}

function markdownToHtml(md, from, depth = 0) {
  const prev = RC;
  RC = { from, depth };
  try {
    const html = marked.parse(md);
    return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'button', 'iframe', 'object', 'embed'] });
  } finally { RC = prev; }
}

// Renders `md` (a note body) into container element `el` and wires up everything.
function renderInto(el, content, from, depth) {
  const { fm, fmLen } = splitFrontmatter(content);
  let html = '';
  const liveProps = depth === 0 && el === preview && fmLen && cfg.properties !== 'source' && propsOf(content.slice(0, fmLen)) != null;
  if (liveProps) html += '<div class="props pp-host"></div>';
  else if (fm && depth === 0 && Object.keys(fm).length) {
    html += '<div class="props">' + Object.entries(fm).map(([k, v]) => {
      const val = Array.isArray(v) ? v.map(x => /^tags?$/.test(k) ? `<a class="tag" data-tag="${esc(String(x).replace(/^#/, ''))}">#${esc(String(x).replace(/^#/, ''))}</a>` : esc(x)).join(', ') : esc(v);
      return `<div><span class="k">${esc(k)}</span><span>${val}</span></div>`;
    }).join('') + '</div>';
  }
  html += markdownToHtml(content.slice(fmLen), from, depth);
  el.innerHTML = html;
  // Reading view edits properties too; changes go through the note's editor, then redraw.
  if (liveProps) mountProps($('.pp-host', el), content.slice(0, fmLen), {
    from: () => S.cur,
    edit: f => { const next = f(ed.value); if (next !== ed.value) { ed.value = next; renderPreview(); } },
    exit: dir => dir === 'down' ? preview.focus({ preventScroll: true }) : titleEl.focus(),
  });
  linkifyTags(el);
  renderMathIn(el);
  for (const tb of $$('table', el)) { const w = document.createElement('div'); w.className = 'table-wrap'; tb.replaceWith(w); w.append(tb); }
  // Headings get ids for [[Note#Heading]] links.
  for (const h of $$('h1,h2,h3,h4,h5,h6', el)) h.id = 'h-' + slug(h.textContent);
  // Relative markdown links/images point into the vault.
  for (const a of $$('a[href]', el)) {
    const href = a.getAttribute('href');
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; continue; }
    if (href.startsWith('#')) { a.classList.add('internal-link'); a.dataset.href = ''; a.dataset.sub = href.slice(1); a.dataset.from = from; a.removeAttribute('href'); continue; }
    let h = href; try { h = decodeURIComponent(href); } catch { }
    const [name, sub] = splitOnce(h, '#');
    a.classList.add('internal-link'); a.dataset.href = name; a.dataset.sub = sub || ''; a.dataset.from = from;
    if (!resolveLink(name, from)) a.classList.add('unresolved');
    a.removeAttribute('href');
  }
  for (const img of $$('img', el)) {
    const src = img.getAttribute('src') || '';
    if (/^(data:|blob:|\/api\/raw)/.test(src)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) { img.removeAttribute('src'); img.alt = `[blocked external image: ${src}]`; continue; }
    let s = src; try { s = decodeURIComponent(src); } catch { }
    const t = resolveLink(s, from);
    if (t) { img.src = rawUrl(t); img.dataset.path = t; }
    const w = /^(.*?)\|(\d+)(?:x\d+)?$/.exec(img.alt); // ![alt|300](img.png)
    if (w) { img.alt = w[1]; img.width = +w[2]; }
  }
  // Task list items (only the top-level note is toggleable).
  $$('li > input[type=checkbox]', el).forEach((cb, i) => {
    const li = cb.parentElement;
    li.classList.add('task'); li.classList.toggle('done', cb.checked);
    if (depth === 0) { cb.disabled = false; cb.dataset.task = i; } else cb.disabled = true;
  });
  // Callouts: > [!note] Title
  for (const bq of $$('blockquote', el)) {
    const p = bq.firstElementChild;
    if (!p || p.tagName !== 'P') continue;
    const m = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n<]*)(?:<br>\n?)?/.exec(p.innerHTML);
    if (!m) continue;
    const type = m[1].toLowerCase();
    const box = document.createElement('div');
    box.className = `callout c-${type}`;
    const title = document.createElement('div');
    title.className = 'callout-title';
    title.textContent = m[3].trim() || type;
    p.innerHTML = p.innerHTML.slice(m[0].length);
    if (!p.innerHTML.trim()) p.remove();
    box.append(title, ...bq.childNodes);
    bq.replaceWith(box);
  }
  for (const sp of $$('span.visual-embed[data-path]', el)) renderVisualEmbed(sp, sp.dataset.path, +sp.dataset.width || null, sp.dataset.sub);
  for (const code of $$('pre > code.language-tasks', el)) {
    const div = document.createElement('div');
    code.parentElement.replaceWith(div);
    renderTasksBlock(div, code.textContent.replace(/\n$/, ''));
  }
  // ```base blocks become live views.
  for (const code of $$('pre > code.language-base', el)) {
    const div = document.createElement('div');
    code.parentElement.replaceWith(div);
    renderBaseBlock(div, code.textContent.replace(/\n$/, ''), from);
  }
  // Note embeds (transclusion), limited depth.
  for (const sp of $$('span.embed[data-embed]', el)) {
    if (depth >= 2 || sp.dataset.embed === from) { sp.textContent = '(embed depth limit)'; continue; }
    renderEmbedInto(sp, sp.dataset.embed, sp.dataset.sub, depth + 1);
  }
}

function renderEmbedInto(el, target, sub, depth = 1) {
  if (visualEmbed(target)) return renderVisualEmbed(el, target, null, sub);
  const n = S.notes.get(target);
  el.innerHTML = `<div class="embed-head"><a class="internal-link" data-href="${esc(target)}" data-path="1">${esc(noteName(target))}${sub ? ' › ' + esc(sub) : ''}</a></div>`;
  const body = document.createElement('div');
  body.className = 'markdown';
  if (!n) body.textContent = '(missing)';
  else renderInto(body, sub ? extractSection(n, sub) : n.content, target, depth);
  el.append(body);
}

// Turn #tags in text into tag pills (skipping code, links and existing pills).
function linkifyTags(el) {
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement.closest('code, pre, a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const texts = [];
  while (tw.nextNode()) if (tw.currentNode.data.includes('#')) texts.push(tw.currentNode);
  const re = /(^|[\s(,;])#([\p{L}\p{N}_\-\/]+)/gu;
  for (const t of texts) {
    const frag = document.createDocumentFragment();
    let last = 0, m, any = false;
    re.lastIndex = 0;
    while ((m = re.exec(t.data))) {
      if (/^[\d\/]+$/.test(m[2])) continue;
      const at = m.index + m[1].length;
      frag.append(t.data.slice(last, at));
      const a = document.createElement('a');
      a.className = 'tag'; a.dataset.tag = m[2]; a.textContent = '#' + m[2];
      frag.append(a);
      last = at + 1 + m[2].length; any = true;
    }
    if (any) { frag.append(t.data.slice(last)); t.replaceWith(frag); }
  }
}

function extractSection(n, sub) {
  const want = sub.trim().toLowerCase();
  const i = n.headings.findIndex(h => h.text.trim().toLowerCase() === want);
  if (i < 0) return `*Heading "${sub}" not found.*`;
  const h = n.headings[i];
  const end = n.headings.slice(i + 1).find(x => x.level <= h.level);
  return n.content.slice(h.index, end ? end.index : undefined);
}

function renderPreview() {
  if (!S.cur) return;
  const st = preview.scrollTop;
  renderInto(preview, ed.value, S.cur, 0);
  // Inline title, unless the note already opens with the same H1.
  const first = preview.querySelector(':scope > h1:first-child, :scope > .props + h1');
  if (!first || first.textContent.trim().toLowerCase() !== noteName(S.cur).toLowerCase()) {
    const t = document.createElement('h1');
    t.className = 'preview-title'; t.textContent = noteName(S.cur);
    preview.prepend(t);
  } else first.classList.add('preview-title');
  preview.scrollTop = st;
}

// Tick the i-th checkbox in reading view (adds the done date; recurring tasks roll forward).
function toggleTask(i) {
  const body = blankCode(ed.value);
  const re = /^[ \t]*(?:>[ \t]?)*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\]/gm;
  let m, k = 0;
  while ((m = re.exec(body))) {
    if (k++ === i) {
      const a = m.index, e = ed.value.indexOf('\n', a) < 0 ? ed.value.length : ed.value.indexOf('\n', a);
      const next = FolioTasks.toggle(ed.value.slice(a, e).replace(/\r$/, ''), { date: FolioTasks.today(), doneDate: cfg.taskDoneDate }).join('\n');
      const cr = ed.value[e - 1] === '\r' ? '\r' : '';
      ed.insert(a, e, next + cr, ed.selectionStart, ed.selectionEnd);
      renderPreview();
      return;
    }
  }
}

// Clicks on links anywhere (preview, embeds, panels).
document.addEventListener('click', e => {
  const cb = e.target.closest('#preview input[data-task]');
  if (cb) { toggleTask(+cb.dataset.task); return; }
  const de = e.target.closest('.drawing-embed[data-drawing], .canvas-embed[data-canvas]');
  if (de && !e.target.closest('a') && !e.target.closest('.cv-node')) { e.preventDefault(); return openPath(de.dataset.drawing || de.dataset.canvas); }
  const raw = e.target.closest('[data-open-raw]');
  if (raw) { e.preventDefault(); return openPath(raw.dataset.openRaw, { raw: true }); }
  const a = e.target.closest('a.internal-link');
  if (a) {
    e.preventDefault();
    if (a.dataset.path) return openPath(a.dataset.href);
    return followLink(a.dataset.href, a.dataset.sub, a.dataset.from || S.cur);
  }
  const tg = e.target.closest('a.tag');
  if (tg) { e.preventDefault(); searchFor(`tag:${tg.dataset.tag}`); }
});

// Middle-click a link (reading view, live preview, panels) to open it in a new tab.
document.addEventListener('mousedown', e => { if (e.button === 1 && e.target.closest('a.internal-link, .cm-editor [data-link]')) e.preventDefault(); });
document.addEventListener('auxclick', e => {
  if (e.button !== 1) return;
  const a = e.target.closest('a.internal-link, .cm-editor [data-link]');
  if (!a) return;
  e.preventDefault();
  const name = a.dataset.href ?? a.dataset.link;
  const target = a.dataset.path ? name : resolveLink(name, a.dataset.from || S.cur);
  if (target) openInNewTab(target, { heading: a.dataset.sub || undefined });
});

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
  for (const k of [...treeSel]) { const r = treeRow(k); if (r) r.classList.add('sel'); else treeSel.delete(k); }
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

function renderTreeActive(reveal = false) {
  if (reveal && S.cur) {
    let d = dirname(S.cur), changed = false;
    while (d) { if (!S.expanded.has(d)) { S.expanded.add(d); changed = true; } d = dirname(d); }
    if (changed) { store('expanded', [...S.expanded]); return renderTree(); }
  }
  for (const r of $$('#tree .t-row.active')) r.classList.remove('active');
  if (!S.cur) return;
  const row = $(`#tree .t-row[data-path="${CSS.escape(S.cur)}"]`);
  if (row) { row.classList.add('active'); if (reveal) row.scrollIntoView({ block: 'nearest' }); }
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
    );
    if (path) items.unshift(['Open in new tab', () => openInNewTab(path)], null);
    if (path && isMd(path) && !isDrawing(path)) items.push(['Open in reading view', () => openPath(path, { mode: 'read' })]);
    if (path && isMd(path) && isDrawing(path)) items.push(['Open as Markdown', () => openPath(path, { raw: true })]);
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
  if (!confirm(`Move ${top.length} items to the vault's .trash folder?\n\n${top.slice(0, 12).map(p => '• ' + p).join('\n')}${top.length > 12 ? '\n…' : ''}`)) return;
  for (const p of top) await deletePath(p, { confirm: false });
  setTreeSel([]);
}

async function importFile(file, folder) {
  const path = uniquePath(folder, file.name);
  await writeFile(path, file);
  reindexAll();
  return path;
}

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
    const r = await applyTemplate(tpl.text, path, { templatePath: tpl.from });
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
        FolioCanvas.renameRefs(FolioCanvas.getData(), moved);
        indexCanvas(cp, FolioCanvas.serializeCanvas(FolioCanvas.getData()), c.mtime);
        canvasChanged(); FolioCanvas.refreshFiles();
      } else {
        const got = (await readMany([cp]))[cp];
        const data = FolioCanvas.parseCanvas(got.content);
        if (!FolioCanvas.renameRefs(data, moved)) continue;
        const text = FolioCanvas.serializeCanvas(data);
        await writeFile(cp, text, got.mtime);
        indexCanvas(cp, text, S.files.get(cp).mtime);
      }
      n++;
    } catch (e) { toast(`Couldn’t update canvas ${cp}: ${e.message}`); }
  }
  reindexAll();
  renderTree();
  if (curMoved) { titleEl.value = noteName(S.cur); $('#crumbs').innerHTML = crumbsHtml(S.cur); document.title = `${noteName(S.cur)} — ${VAULT} — Folio`; store('last', S.cur); }
  renderTreeActive(true);
  refreshPanels();
  if (n) toast(`Updated links in ${n} file${n > 1 ? 's' : ''}`);
}

async function deletePath(path, opts = {}) {
  const isDir = S.dirs.has(path);
  const what = isDir ? `folder "${path}" and everything in it` : `"${basename(path)}"`;
  if (opts.confirm !== false && !confirm(`Move ${what} to the vault's .trash folder?`)) return;
  if (S.cur === path || (isDir && S.cur?.startsWith(path + '/'))) { S.dirty = false; }
  try { await api('/api/delete', { method: 'POST', body: JSON.stringify({ path }) }); }
  catch (e) { return toast('Delete failed: ' + e.message); }
  for (const p of [...S.files.keys()]) if (p === path || p.startsWith(path + '/')) { S.files.delete(p); S.notes.delete(p); }
  for (const d of [...S.dirs]) if (d === path || d.startsWith(path + '/')) S.dirs.delete(d);
  S.hist = S.hist.filter(h => S.files.has(h)); S.histIdx = S.hist.length - 1;
  reindexAll(); renderTree();
  tabsAfterDelete();
  if (S.cur && !S.files.has(S.cur)) { S.cur = null; showEmpty(); }
  refreshPanels();
}

// ============================================================ daily notes & templates

function fmtDate(d, f) {
  const p = n => String(n).padStart(2, '0');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const map = {
    YYYY: d.getFullYear(), MMMM: months[d.getMonth()], MMM: months[d.getMonth()].slice(0, 3), MM: p(d.getMonth() + 1),
    DD: p(d.getDate()), dddd: days[d.getDay()], ddd: days[d.getDay()].slice(0, 3), HH: p(d.getHours()), mm: p(d.getMinutes()),
  };
  return f.replace(/YYYY|MMMM|MMM|MM|DD|dddd|ddd|HH|mm/g, t => map[t]);
}

function fillTemplate(text, title) {
  const now = new Date();
  return text
    .replace(/\{\{\s*date:([^}]+)\}\}/g, (_, f) => fmtDate(now, f.trim()))
    .replace(/\{\{\s*time:([^}]+)\}\}/g, (_, f) => fmtDate(now, f.trim()))
    .replace(/\{\{\s*date\s*\}\}/g, fmtDate(now, 'YYYY-MM-DD'))
    .replace(/\{\{\s*time\s*\}\}/g, fmtDate(now, 'HH:mm'))
    .replace(/\{\{\s*title\s*\}\}/g, title);
}

async function openDaily() {
  const name = fmtDate(new Date(), 'YYYY-MM-DD');
  const path = join(cfg.dailyFolder, name + '.md');
  if (S.files.has(path)) return openPath(path);
  const t = cfg.dailyTemplate && resolveLink(cfg.dailyTemplate, null);
  const template = t && S.notes.has(t) ? { text: S.notes.get(t).content, from: t, optional: true } : undefined;
  const r = await createNote(path, '', { mode: 'edit', template });
  if (r && r.cursor < 0 && S.cur === path) ed.setSelectionRange(ed.value.length, ed.value.length, true);
}

// ============================================================ templates (core {{date}} syntax + Templater's <% %>)

function templateList() {
  const folder = cfg.templatesFolder;
  return [...S.notes.keys()].filter(p => (folder ? p.startsWith(folder + '/') : true) && !isDrawing(p));
}
async function pickTemplate(placeholder) {
  const list = templateList();
  if (!list.length) { toast(`No templates found in "${cfg.templatesFolder}/"`); return null; }
  return picker({ placeholder, items: q => rank(list, q, noteName).map(p => ({ main: noteName(p), sub: dirname(p), value: p })) });
}

// What tp.* sees when a template is applied to the note at `path`.
function templateEnv(path, selection, templatePath) {
  const n = S.notes.get(path), f = S.files.get(path);
  return {
    path, title: noteName(path), folder: dirname(path), content: n?.content ?? '', selection,
    frontmatter: n?.fm || {}, tags: n ? [...n.tags] : [], vaultPath: S.vaultPath || '',
    ctime: f?.ctime || f?.mtime || Date.now(), mtime: f?.mtime || Date.now(), templatePath,
    prompt: (text, def, multiline) => promptModal('Template', text || 'Value', def, { multiline, raw: true }),
    suggest: async (labels, values, placeholder) => {
      const i = await picker({ placeholder: placeholder || 'Choose…', items: q => rank(labels.map((l, k) => ({ l, k })), q, x => x.l).map(x => ({ main: x.l, value: x.k })) });
      return i == null ? null : values[i];
    },
    clipboard: async () => { try { return await navigator.clipboard.readText(); } catch { return ''; } },
    read: link => { const t = resolveLink(splitOnce(splitOnce(link, '|')[0], '#')[0].trim(), path); return t && S.notes.has(t) ? S.notes.get(t).content : null; },
    exists: link => !!resolveLink(link.trim(), path),
  };
}

// Fill a template for the note at `path`. Returns {text, cursor, actions}, or null if it
// failed or was cancelled (the reason is shown as a toast).
async function applyTemplate(text, path, { selection = '', templatePath = '' } = {}) {
  text = fillTemplate(text, noteName(path));
  if (!FolioTemplater.hasTemplaterSyntax(text)) return { text, cursor: -1, actions: [] };
  try {
    const r = await FolioTemplater.render(text, templateEnv(path, selection, templatePath));
    if (r.aborted) { toast('Template cancelled'); return null; }
    return r;
  } catch (e) { toast(`Template error${templatePath ? ` in ${noteName(templatePath)}` : ''}: ${e.message}`, 6000); return null; }
}

// tp.file.rename / move / create_new run after the text is in place.
async function runTemplateActions(path, actions) {
  let cur = path;
  for (const a of actions || []) {
    try {
      if (a.type === 'rename' || a.type === 'move') {
        const name = a.type === 'rename' ? a.name : basename(a.path);
        if (!name.trim() || BAD_NAME.test(name)) throw new Error(`"${name}" isn't a valid note name`);
        const to = a.type === 'rename' ? join(dirname(cur), name + '.md') : normPath(a.path) + '.md';
        if (to !== cur) { await renamePath(cur, to); if (S.files.has(to)) cur = to; }
      } else if (a.type === 'create') {
        const p = uniquePath(dirname(a.path), basename(a.path));
        const r = await applyTemplate(a.content, p);
        await writeFile(p, r ? r.text : a.content);
        let d = dirname(p);
        while (d) { S.dirs.add(d); d = dirname(d); }
        reindexAll(); renderTree();
        if (a.open) await openPath(p);
      }
    } catch (e) { toast('Template: ' + e.message, 5000); }
  }
  return cur;
}

// The template for new notes in `path`'s folder: the most specific "folder: template" line wins.
function folderTemplateFor(path) {
  const dir = dirname(path);
  let best = null, bestLen = -1;
  for (const line of String(cfg.folderTemplates || '').split('\n')) {
    const m = /^\s*([^:→]*?)\s*(?::|→)\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const folder = m[1].replace(/^\/+|\/+$/g, '');
    if ((folder === '' || dir === folder || dir.startsWith(folder + '/')) && folder.length > bestLen) { best = m[2]; bestLen = folder.length; }
  }
  if (!best) return null;
  const t = resolveLink(best.replace(/^\[\[|\]\]$/g, ''), null);
  return t && S.notes.has(t) ? t : null;
}

async function insertTemplate() {
  if (S.view !== 'note') return toast('Open a note first');
  const pick = await pickTemplate('Insert template…');
  if (!pick) return;
  if (S.mode !== 'edit') setMode('edit');
  const target = S.cur, a = ed.selectionStart, b = ed.selectionEnd;
  const r = await applyTemplate(S.notes.get(pick).content, target, { selection: ed.value.slice(a, b), templatePath: pick });
  if (!r || S.cur !== target) return;
  insertText(a, b, r.text);
  if (r.cursor >= 0) ed.setSelectionRange(a + r.cursor, a + r.cursor, true);
  await runTemplateActions(target, r.actions);
}

async function newNoteFromTemplate() {
  const pick = await pickTemplate('New note from template…');
  if (!pick) return;
  const path = uniquePath(cfg.newNoteFolder, 'Untitled.md');
  await createNote(path, '', { mode: 'edit', template: { text: S.notes.get(pick).content, from: pick } });
}

// Run the template commands written in the current note itself.
async function replaceTemplatesInNote() {
  if (S.view !== 'note') return toast('Open a note first');
  const target = S.cur, src = ed.value;
  if (!FolioTemplater.hasTemplaterSyntax(src) && !/\{\{\s*(date|time|title)/.test(src)) return toast('This note has no template commands');
  const r = await applyTemplate(src, target);
  if (!r || S.cur !== target || ed.value !== src) return;
  if (S.mode !== 'edit') setMode('edit');
  insertText(0, src.length, r.text);
  if (r.cursor >= 0) ed.setSelectionRange(r.cursor, r.cursor, true);
  await runTemplateActions(target, r.actions);
}

// ============================================================ editor glue

function insertText(a, b, text, selA, selB) { ed.insert(a, b, text, selA, selB); }

const cursorMoved = debounce(() => updateStatus(), 150);

// [[ completion: notes and attachments, aliases, and headings after '#'.
function linkOptions(q) {
  const files = [...S.files.keys()];
  const [nm, hd] = splitOnce(q, '#');
  if (hd != null) {
    const target = nm ? resolveLink(nm, S.cur) : S.cur;
    const n = target && S.notes.get(target);
    if (!n) return [];
    return rank(n.headings.map(h => h.text), hd).slice(0, 30).map(h => ({ label: h, detail: '#', insert: `${nm}#${h}` }));
  }
  const out = rank(files, q, p => noteName(p)).slice(0, 30)
    .map(p => ({ label: noteName(p), detail: dirname(p), insert: linkNameFor(p, files) }));
  if (q) for (const [a, p] of S.byAlias) {
    if (out.length >= 40) break;
    if (a.includes(q.toLowerCase())) out.push({ label: a, detail: '→ ' + noteName(p), insert: `${linkNameFor(p, files)}|${a}` });
  }
  return out;
}

function allTags() {
  const set = new Set();
  for (const n of S.notes.values()) for (const t of n.tags) set.add(t);
  return [...set].sort(collator.compare);
}

async function attachAndLink(file, pasted, editor = ed) {
  let name = file.name;
  if (pasted || !name || name === 'image.png') {
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    name = `Pasted image ${fmtDate(new Date(), 'YYYYMMDDHHmm')}${String(new Date().getSeconds()).padStart(2, '0')}.${ext}`;
  }
  const path = uniquePath(cfg.attachFolder, name);
  try { await writeFile(path, file); } catch (e) { return toast('Attach failed: ' + e.message); }
  if (cfg.attachFolder) S.dirs.add(cfg.attachFolder);
  reindexAll(); renderTree();
  const link = `![[${linkNameFor(path, [...S.files.keys()])}]]`, at = editor.selectionStart;
  if (editor === ed) insertText(ed.selectionStart, ed.selectionEnd, link);
  else editor.insert(editor.selectionStart, editor.selectionEnd, link);
  return { path, from: at, to: at + link.length };
}

// ============================================================ properties

// Property types by name, shared by the whole vault like Obsidian's: .obsidian/types.json when the
// vault has an .obsidian folder, otherwise Folio's own settings.
S.propTypes = { ...(cfg.propTypes || {}) };
let obsidianTypes = false;
async function loadPropTypes() {
  try { const r = await api('/api/prop-types'); S.propTypes = { ...(cfg.propTypes || {}), ...r.types }; obsidianTypes = !!r.obsidian; }
  catch { obsidianTypes = false; }
}
async function savePropType(key, type) {
  S.propTypes[key] = type;
  if (obsidianTypes) {
    try { await api('/api/prop-types', { method: 'PUT', body: JSON.stringify({ [key]: type }) }); return; } catch { obsidianTypes = false; }
  }
  cfg.propTypes = { ...(cfg.propTypes || {}), [key]: type }; saveCfg();
}
const propType = (key, value) => S.propTypes[key] || FolioProps.inferType(key, value);

// A frontmatter block's properties, or null if it isn't a YAML mapping (then it shows as text).
function propsOf(fmText) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*$/.exec(fmText.replace(/\s+$/, ''));
  if (!m) return null;
  try { const v = FolioBases.parseYaml(m[1]); return v == null ? {} : typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

// Names in use across the vault (commonest first), and the values a property already has.
function knownProps() {
  const n = new Map();
  for (const note of S.notes.values()) for (const k of Object.keys(note.fm || {})) {
    const e = n.get(k) || { name: k, count: 0, note };
    e.count++; n.set(k, e);
  }
  // Types come from a typed reading of one note that has the property (5, not "5").
  return [...n.values()].sort((a, b) => b.count - a.count || collator.compare(a.name, b.name))
    .map(e => ({ name: e.name, get type() { return propType(e.name, FolioBases.frontmatter(e.note.content)[e.name]); } }));
}
function knownValues(key) {
  const c = new Map();
  for (const note of S.notes.values()) {
    const v = note.fm?.[key];
    for (const x of Array.isArray(v) ? v : v == null || v === '' ? [] : [v]) { const s = String(x).replace(key === 'tags' ? /^#/ : /$^/, ''); c.set(s, (c.get(s) || 0) + 1); }
  }
  if (key === 'tags') for (const t of allTags()) if (!c.has(t)) c.set(t, 0);
  return [...c].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

// Draw a note's properties. edit(f) applies f(content) -> content to the note; exit(dir) hands
// the keyboard back (up: the title, down: the text).
function mountProps(el, fmText, { edit, exit, from }) {
  const props = propsOf(fmText) || {};
  const redraw = () => { S.version++; refreshEditorSoon(); if (S.view === 'note' && S.mode === 'read') renderPreview(); };
  return FolioProps.render(el, {
    props,
    typeOf: (k, v) => propType(k, v),
    set: (k, v) => edit(c => FolioBases.setFrontmatter(c, k, v)),
    rename: (a, b) => {
      if (S.propTypes[a] && !S.propTypes[b]) savePropType(b, S.propTypes[a]);
      edit(c => FolioBases.renameFrontmatter(c, a, b));
    },
    setType: async (k, t) => {
      await savePropType(k, t);
      const v = FolioProps.coerce(props[k], t);
      if (JSON.stringify(v) !== JSON.stringify(props[k] ?? null)) edit(c => FolioBases.setFrontmatter(c, k, v));
      redraw();
    },
    keys: () => knownProps(),
    adopt: (k, t) => { if (!S.propTypes[k]) savePropType(k, t); },
    values: k => knownValues(k),
    inline: (d, text) => { d.innerHTML = markdownToHtml(String(text), from()).replace(/^\s*<p>|<\/p>\s*$/g, ''); renderMathIn(d); },
    tag: t => searchFor(`tag:${t}`),
    menu: (x, y, items) => menu(x, y, items),
    collapsed: !!store('propsCollapsed'),
    onCollapse: c => { store('propsCollapsed', c); redraw(); },
    onExit: exit,
  });
}

// ------------------------------------------------------------ All properties panel

// Every property in the vault: its type, how many notes use it and, opened, its values. Click
// a name or value to search for it; right-click to rename, retype or remove it everywhere.
const propsOpen = new Set();
function renderPropsPanel() {
  const box = $('#props-list'), f = ($('#props-filter').value || '').trim().toLowerCase();
  const had = box.contains(document.activeElement) ? document.activeElement.dataset.k + '|' + (document.activeElement.dataset.v ?? '') : null;
  const all = knownPropsCounted().filter(p => !f || p.name.toLowerCase().includes(f));
  box.innerHTML = all.length ? all.map(p => {
    const open = propsOpen.has(p.name);
    const vals = open ? knownValueCounts(p.name) : [];
    return `<div class="pr-name${open ? ' open' : ''}" tabindex="-1" data-k="${esc(p.name)}" title="${esc(p.type)}">${CHEV}<span class="pr-icon">${PROP_ICON[p.type] || PROP_ICON.text}</span><span class="pr-label">${esc(p.name)}</span><span class="n">${p.count}</span></div>` +
      (open ? `<div class="pr-vals">${vals.slice(0, 100).map(([v, c]) => `<div class="pr-val" tabindex="-1" data-k="${esc(p.name)}" data-v="${esc(v)}"><span>${esc(v === '' ? '(empty)' : v)}</span><span class="n">${c}</span></div>`).join('')}${vals.length > 100 ? `<div class="none">${vals.length - 100} more…</div>` : ''}</div>` : '');
  }).join('') : `<div class="none">${f ? 'No matching properties.' : 'No properties yet. Add them at the top of a note (Ctrl+;).'}</div>`;
  if (had) $$('.pr-name, .pr-val', box).find(x => x.dataset.k + '|' + (x.dataset.v ?? '') === had)?.focus({ preventScroll: true });
}
const PROP_ICON = Object.fromEntries(['text', 'multitext', 'number', 'checkbox', 'date', 'datetime', 'tags', 'aliases'].map(t => [t, `<svg viewBox="0 0 24 24">${{
  text: '<path d="M5 7h14M5 12h14M5 17h9"/>', multitext: '<path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01"/>',
  number: '<path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16"/>', checkbox: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
  date: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>', datetime: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  tags: '<path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/>', aliases: '<path d="M15 4l4 4-4 4M19 8H9a5 5 0 0 0 0 10h2"/>',
}[t]}</svg>`]));
function knownPropsCounted() {
  const n = new Map();
  for (const note of S.notes.values()) for (const k of Object.keys(note.fm || {})) {
    const e = n.get(k) || { name: k, count: 0, note };
    e.count++; n.set(k, e);
  }
  return [...n.values()].sort((a, b) => collator.compare(a.name, b.name)).map(e => ({ name: e.name, count: e.count, type: propType(e.name, FolioBases.frontmatter(e.note.content)[e.name]) }));
}
function knownValueCounts(key) {
  const c = new Map();
  for (const note of S.notes.values()) {
    if (!note.fm || !(key in note.fm)) continue;
    const v = note.fm[key];
    const list = Array.isArray(v) ? v : [v ?? ''];
    for (const x of list.length ? list : ['']) { const s = String(x ?? ''); c.set(s, (c.get(s) || 0) + 1); }
  }
  return [...c].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
}
const quoteProp = s => /[\s\]"]/.test(s) ? `"${s.replace(/"/g, '')}"` : s;

$('#props-filter').addEventListener('input', () => renderPropsPanel());
$('#props-list').addEventListener('click', e => {
  const val = e.target.closest('.pr-val');
  if (val) return searchFor(`[${quoteProp(val.dataset.k)}:${quoteProp(val.dataset.v)}]`);
  const nm = e.target.closest('.pr-name');
  if (!nm) return;
  if (e.target.closest('.chev')) { togglePropOpen(nm.dataset.k); return; }
  searchFor(`[${quoteProp(nm.dataset.k)}]`);
});
function togglePropOpen(k, open) {
  if (open ?? !propsOpen.has(k)) propsOpen.add(k); else propsOpen.delete(k);
  renderPropsPanel();
  $(`#props-list .pr-name[data-k="${CSS.escape(k)}"]`)?.focus({ preventScroll: true });
}
$('#props-list').addEventListener('keydown', e => {
  const nm = e.target.closest?.('.pr-name');
  if (nm && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); e.stopPropagation(); togglePropOpen(nm.dataset.k, e.key === 'ArrowRight'); }
  else if (nm && (e.key === 'F2' || e.key === 'ContextMenu')) { e.preventDefault(); const b = nm.getBoundingClientRect(); propMenu(nm.dataset.k, b.left + 20, b.bottom); }
});
$('#props-list').addEventListener('contextmenu', e => {
  const nm = e.target.closest('.pr-name, .pr-val');
  if (!nm) return;
  e.preventDefault();
  propMenu(nm.dataset.k, e.clientX, e.clientY);
});
function propMenu(k, x, y) {
  const cur = knownPropsCounted().find(p => p.name === k)?.type;
  menu(x, y, [
    [`Show notes with “${k}”`, () => searchFor(`[${quoteProp(k)}]`)],
    ['Rename everywhere…', () => renamePropEverywhere(k)],
    null,
    ...FolioProps.TYPES.map(([t, name]) => [`Type: ${name}${t === cur ? '  ✓' : ''}`, async () => { await savePropType(k, t); S.version++; refreshEditorSoon(); if (S.view === 'note' && S.mode === 'read') renderPreview(); renderPropsPanel(); }]),
    null,
    ['Remove from every note…', () => removePropEverywhere(k), 'danger'],
  ]);
}

// Change the text of every note that has property k (the open note through its editor, so undo works).
async function editPropEverywhere(k, f) {
  let n = 0, skipped = [];
  for (const [p, note] of S.notes) {
    if (!note.fm || !(k in note.fm)) continue;
    const open = p === S.cur && S.view === 'note';
    const before = open ? ed.value : note.content, after = f(before, p);
    if (after == null) { skipped.push(p); continue; }
    if (after === before) continue;
    if (open) ed.value = after;
    else { try { await writeFile(p, after, note.mtime); } catch (e) { toast(`Couldn’t update ${noteName(p)}: ${e.message}`); continue; } }
    n++;
  }
  reindexAll(); refreshPanels(); renderPropsPanel();
  if (S.view === 'note' && S.mode === 'read') renderPreview();
  return { n, skipped };
}
async function renamePropEverywhere(k) {
  const to = (await promptModal(`Rename “${k}” in every note`, 'New name', k))?.trim();
  if (!to || to === k) return;
  const { n, skipped } = await editPropEverywhere(k, (text, p) => S.notes.get(p)?.fm && to in S.notes.get(p).fm ? null : FolioBases.renameFrontmatter(text, k, to));
  if (S.propTypes[k] && !S.propTypes[to]) await savePropType(to, S.propTypes[k]);
  propsOpen.delete(k);
  renderPropsPanel();
  toast(`Renamed in ${n} note${n === 1 ? '' : 's'}${skipped.length ? ` · skipped ${skipped.length} that already have “${to}”` : ''}`, 4000);
}
async function removePropEverywhere(k) {
  const count = [...S.notes.values()].filter(n => n.fm && k in n.fm).length;
  if (!confirm(`Remove the property “${k}” from ${count} note${count === 1 ? '' : 's'}?`)) return;
  const { n } = await editPropEverywhere(k, text => FolioBases.setFrontmatter(text, k, undefined));
  toast(`Removed from ${n} note${n === 1 ? '' : 's'}`);
}

// ============================================================ images: viewer, resize, crop, annotate, screenshots

// Editors by their .cm-editor element, so image clicks and grips know whose text to change.
const EDITORS = new WeakMap(); // dom -> { ed, from() }
const regEditor = (e, from) => { EDITORS.set(e.view.dom, { ed: e, from }); return e; };
regEditor(ed, () => S.cur);

// The vault path behind an image URL we produced with rawUrl().
const pathOfUrl = src => { try { const u = new URL(src, location.href); return u.pathname === '/api/raw' ? u.searchParams.get('path') : null; } catch { return null; } };

// Every vault image embedded in `text`, in order, for browsing with ← → in the viewer.
function imagesIn(text, from) {
  const out = [], seen = new Set();
  for (const l of parseNote(text || '').links) {
    if (!l.embed) continue;
    const p = resolveLink(l.name, from);
    if (p && IMG_EXT.test(p) && !seen.has(p)) { seen.add(p); out.push({ src: rawUrl(p), name: basename(p), path: p }); }
  }
  return out;
}

function viewImages(path, list, ctx = {}) {
  const items = list.length ? list : [];
  let i = items.findIndex(it => it.path === path);
  if (i < 0) { items.unshift({ src: rawUrl(path), name: basename(path), path }); i = 0; }
  return FolioImages.lightbox(items, i, imageActions(ctx));
}

// What the viewer's buttons do. ctx.retarget(newPath) repoints the embed the image came from.
function imageActions(ctx = {}) {
  return {
    onOpen: it => openPath(it.path),
    onCopy: it => copyImage(it.path),
    onCrop: it => cropImage(it.path, ctx),
    onAnnotate: it => annotateImage(it.path, ctx),
  };
}

const imageBlob = async p => { const r = await fetch(rawUrl(p)); if (!r.ok) throw new Error(r.statusText); return r.blob(); };

async function copyImage(p) {
  try {
    let blob = await imageBlob(p);
    if (blob.type !== 'image/png') { // the clipboard reliably takes PNG only
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      blob = await new Promise(r => c.toBlob(r, 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Image copied');
  } catch (e) { toast('Couldn’t copy the image: ' + e.message); }
}

// Save `blob` next to `like` as "<name> (<suffix>).<ext>" and return the new path.
async function saveBeside(like, suffix, blob, ext) {
  const stem = basename(like).replace(/\.[^.]+$/, '');
  const path = uniquePath(dirname(like), `${stem} (${suffix}).${ext}`);
  await writeFile(path, blob);
  reindexAll(); renderTree();
  return path;
}

// Crop into a copy (the original stays), then point the embed at the copy.
async function cropImage(p, ctx = {}) {
  const blob = await FolioImages.crop(rawUrl(p));
  if (!blob) return;
  let np;
  try { np = await saveBeside(p, 'cropped', blob, 'png'); } catch (e) { return toast('Couldn’t save the cropped image: ' + e.message); }
  if (ctx.retarget) ctx.retarget(np); else openPath(np);
  toast(`Saved ${basename(np)}`);
}

// Turn an image into a drawing with the image locked underneath, swap the embed for the
// drawing, and open it for marking up.
async function annotateImage(p, ctx = {}) {
  let blob;
  try { blob = await imageBlob(p); } catch (e) { return toast('Couldn’t read the image: ' + e.message); }
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) return toast('Couldn’t read the image');
  const md = cfg.drawingFormat === 'md';
  const scene = FolioSketch.emptyScene(), id = FolioSketch.randomId(40);
  scene.elements.push(FolioSketch.newElement('image', { x: 0, y: 0, width: bmp.width, height: bmp.height, fileId: id, locked: true, strokeColor: 'transparent', backgroundColor: 'transparent' }));
  const embedded = {};
  // .excalidraw.md points at the vault file (like the Obsidian plugin); .excalidraw carries the image.
  if (md) embedded[id] = p;
  else scene.files[id] = { mimeType: blob.type || 'image/png', id, dataURL: await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); }), created: Date.now() };
  const stem = basename(p).replace(/\.[^.]+$/, '');
  const path = uniquePath(dirname(p), `${stem} (annotated).${md ? 'excalidraw.md' : 'excalidraw'}`);
  try { await writeFile(path, FolioSketch.serializeDrawing(scene, md ? { format: 'md', source: '', embedded } : { format: 'json' })); }
  catch (e) { return toast('Couldn’t create the drawing: ' + e.message); }
  reindexAll(); renderTree();
  if (ctx.retarget) { ctx.retarget(path); await save(); }
  await openPath(path);
}

// The embed on `line` that overlaps [from, to] (or starts at `from` when it's a point); an embed
// that merely ends where the range starts doesn't count.
function embedAt(line, from, to) {
  return parseNote(line.text).links.find(k => {
    const s = line.from + k.index, e = s + k.len;
    return k.embed && s < Math.max(to, from + 1) && e > from;
  });
}

// Rewrite the image embed covering [from, to] in editor `e`: a new target and/or width.
// width: a number, null to remove it, undefined to keep it.
function editImageEmbed(e, from, to, { target, width } = {}) {
  const doc = e.view.state.doc, line = doc.lineAt(from), text = line.text;
  const l = embedAt(line, from, to);
  if (!l) return false;
  const raw = text.slice(l.index, l.index + l.len);
  let out;
  if (!l.md || (target && !IMG_EXT.test(target))) {
    // Wiki embed (a drawing always becomes one, since ![](…) can't show it).
    const inner = l.md ? null : raw.slice(3, -2);
    const [tgt, alias] = inner ? splitOnce(inner, '|') : [null, null];
    const oldW = l.md ? altWidthOf(l.text) : (alias && /^\d+(x\d+)?$/.test(alias.trim()) ? alias.trim() : null);
    const w = width === undefined ? oldW : width;
    const name = target ? linkNameFor(target, [...S.files.keys()]) : tgt;
    out = `![[${name}${w ? '|' + w : ''}]]`;
  } else {
    const m = /^!\[([^\]]*)\]\((.*)\)$/s.exec(raw);
    if (!m) return false;
    const base = m[1].replace(/\|\d+(x\d+)?$/, ''), oldW = altWidthOf(m[1]);
    const w = width === undefined ? oldW : width;
    const href = target ? relPath(dirname(e === ed ? S.cur : EDITORS.get(e.view.dom)?.from() || ''), target).split('/').map(enc).join('/') : m[2];
    out = `![${base}${w ? '|' + w : ''}](${href})`;
  }
  if (out !== raw) e.view.dispatch({ changes: { from: line.from + l.index, to: line.from + l.index + l.len, insert: out } });
  return true;
}
const altWidthOf = alt => /\|(\d+(?:x\d+)?)$/.exec(alt || '')?.[1] || null;

// The editor, range and path behind an image widget element.
function imageWidgetInfo(wrap) {
  const reg = EDITORS.get(wrap.closest('.cm-editor'));
  if (!reg) return null;
  let pos;
  try { pos = reg.ed.view.posAtDOM(wrap); } catch { return null; }
  const block = wrap.classList.contains('cm-image-block');
  const line = reg.ed.view.state.doc.lineAt(pos);
  const img = wrap.querySelector('img');
  return { ...reg, from: block ? line.from : pos, to: block ? line.to : pos, path: pathOfUrl(img?.src), img, note: reg.from() };
}

function revealInTree(p) {
  showPanel('files', true);
  for (let d = dirname(p); d; d = dirname(d)) S.expanded.add(d);
  store('expanded', [...S.expanded]);
  renderTree();
  const r = $(`#tree .t-row[data-path="${CSS.escape(p)}"]`);
  if (!r) return;
  r.scrollIntoView({ block: 'center' });
  r.classList.add('flash');
  setTimeout(() => r.classList.remove('flash'), 1200);
}

function imageMenu(x, y, path, ctx) {
  const items = [
    ['Open in viewer', () => ctx.view()],
    ['Open image file', () => openPath(path)],
    ['Copy image', () => copyImage(path)],
  ];
  if (ctx.resize) items.push(null, ['Small (240 px)', () => ctx.resize(240)], ['Medium (480 px)', () => ctx.resize(480)], ['Large (800 px)', () => ctx.resize(800)], ['Original size', () => ctx.resize(null)]);
  items.push(null, ['Crop…', () => cropImage(path, ctx)], ['Annotate in a drawing', () => annotateImage(path, ctx)]);
  items.push(null, ['Reveal in file tree', () => revealInTree(path)],
    ['Rename image…', async () => { const n = await promptModal('Rename image', 'New name', basename(path).replace(/\.[^.]+$/, '')); if (n && n.trim()) renamePath(path, join(dirname(path), n.trim() + (/\.[^.]+$/.exec(path)?.[0] || ''))); }]);
  if (ctx.remove) items.push(['Remove from note', () => ctx.remove()]);
  items.push(['Delete image file…', () => deletePath(path)]);
  menu(x, y, items);
}

// Live-preview images: click to view, right-click for the menu, drag the corner grip to resize.
function editorImageCtx(info) {
  const e = info.ed;
  const at = () => { // the widget may have moved since the menu opened
    const i = imageWidgetInfo(info.wrap);
    return i || info;
  };
  return {
    view: () => viewImages(info.path, imagesIn(e.value, info.note), editorImageCtx(info)),
    resize: w => { const i = at(); editImageEmbed(e, i.from, i.to, { width: w }); },
    retarget: np => { const i = at(); editImageEmbed(e, i.from, i.to, { target: np }); },
    remove: () => { const i = at(); const doc = e.view.state.doc, line = doc.lineAt(i.from); const l = embedAt(line, i.from, i.to); if (l) e.view.dispatch({ changes: { from: line.from + l.index, to: line.from + l.index + l.len, insert: '' } }); },
  };
}

document.addEventListener('click', e => {
  const wrap = e.target.closest('.cm-editor .cm-image');
  if (!wrap || e.target.closest('.cm-img-grip') || e.button !== 0) return;
  const info = imageWidgetInfo(wrap);
  if (!info?.path) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) return openPath(info.path);
  editorImageCtx({ ...info, wrap }).view();
});
document.addEventListener('contextmenu', e => {
  const wrap = e.target.closest('.cm-editor .cm-image');
  if (wrap) {
    const info = imageWidgetInfo(wrap);
    if (!info?.path) return;
    e.preventDefault();
    return imageMenu(e.clientX, e.clientY, info.path, editorImageCtx({ ...info, wrap }));
  }
  const img = e.target.closest('#preview img[data-path], .embed img[data-path], .cv-content img[data-path]');
  if (img) { e.preventDefault(); imageMenu(e.clientX, e.clientY, img.dataset.path, { view: () => viewImages(img.dataset.path, readingImages(img)) }); }
});
document.addEventListener('pointerdown', e => {
  const grip = e.target.closest('.cm-editor .cm-img-grip');
  if (!grip || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const wrap = grip.closest('.cm-image'), img = wrap.querySelector('img');
  const info = imageWidgetInfo(wrap);
  if (!info) return;
  const x0 = e.clientX, w0 = img.getBoundingClientRect().width;
  const max = wrap.closest('.cm-content').clientWidth;
  let w = w0;
  wrap.classList.add('resizing');
  grip.setPointerCapture(e.pointerId);
  const move = ev => { w = Math.round(Math.max(32, Math.min(max, w0 + ev.clientX - x0))); img.style.width = w + 'px'; img.style.height = 'auto'; grip.dataset.w = w; };
  const up = () => {
    grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
    wrap.classList.remove('resizing');
    if (Math.abs(w - w0) >= 2) editImageEmbed(info.ed, info.from, info.to, { width: w });
  };
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
}, true);

// Reading view (and embeds, canvas cards): click an image to view it, with ← → through the rest.
function readingImages(img) {
  const scope = img.closest('#preview, .embed, .cv-content') || document;
  const seen = new Set();
  return $$('img[data-path]', scope).filter(i => !seen.has(i.dataset.path) && seen.add(i.dataset.path)).map(i => ({ src: i.src, name: basename(i.dataset.path), path: i.dataset.path }));
}
document.addEventListener('click', e => {
  const img = e.target.closest('#preview img[data-path], .embed img[data-path]');
  if (!img || e.target.closest('a') || e.button !== 0) return;
  e.preventDefault();
  viewImages(img.dataset.path, readingImages(img));
});

// Insert screenshot: the system's region picker (via the app), else the browser's screen capture.
// o.screen: the whole screen rather than a region; o.annotate: open it in a drawing right away
// (also Settings → "After a screenshot"). The desktop app can step out of the way first, and
// Settings can add a delay for catching menus.
let shooting = false;
async function insertScreenshot(o = {}) {
  if (S.view !== 'note' && S.view !== 'canvas') return toast('Open a note or canvas first');
  if (shooting) return;
  const into = S.view, cur = S.cur;
  const annotate = o.annotate ?? cfg.screenshotAfter === 'annotate';
  const delay = Math.max(0, Math.min(10, +cfg.screenshotDelay || 0));
  let blob = null;
  shooting = true;
  if (delay) countdown(delay);
  try {
    const q = new URLSearchParams({ mode: o.screen ? 'screen' : 'region', hide: cfg.screenshotHide ? '1' : '0', delay: String(delay) });
    const r = await fetch(`/api/screenshot?${q}`, { method: 'POST', headers: { 'X-Folio-Token': TOKEN } });
    if (r.status === 204) return;
    if (r.ok) blob = await r.blob();
    else {
      const msg = (await r.json().catch(() => ({}))).error || r.statusText;
      if (r.status !== 501 || !FolioImages.canCaptureScreen()) return toast('Screenshot failed: ' + msg, 5000);
      blob = await FolioImages.captureScreen({ crop: !o.screen });
    }
  } catch (e) { return toast('Screenshot failed: ' + e.message, 5000); }
  finally { shooting = false; }
  if (!blob) return;
  if (S.cur !== cur || S.view !== into) return toast('The screenshot wasn’t inserted because another file was opened');
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const file = new File([blob], `Screenshot ${fmtDate(d, 'YYYY-MM-DD')} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`, { type: 'image/png' });
  if (into === 'note') {
    setMode('edit');
    const got = await attachAndLink(file, false);
    if (!got) return;
    if (annotate) return annotateImage(got.path, { retarget: np => editImageEmbed(ed, got.from, got.to, { target: np }) });
    ed.focus();
    return;
  }
  const path = uniquePath(cfg.attachFolder, file.name);
  try { await writeFile(path, file); } catch (e) { return toast('Couldn’t save the screenshot: ' + e.message); }
  if (cfg.attachFolder) S.dirs.add(cfg.attachFolder);
  reindexAll(); renderTree();
  const card = FolioCanvas.addFile(path);
  if (annotate && card) annotateImage(path, { retarget: np => FolioCanvas.setFile(card.id, np) });
}

// "3… 2… 1…" while a delayed screenshot waits.
function countdown(n) {
  const t = document.createElement('div');
  t.className = 'toast shot-countdown';
  document.body.append(t);
  const tick = () => { if (n <= 0) return t.remove(); t.textContent = `Screenshot in ${n}…`; n--; setTimeout(tick, 1000); };
  tick();
}

titleEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); ed.focus(); ed.setSelectionRange(0, 0); }
  if (e.key === 'Escape') { titleEl.value = noteName(S.cur); ed.focus(); }
});
titleEl.addEventListener('blur', async () => {
  if (!S.cur || !isMd(S.cur)) return;
  const name = titleEl.value.trim();
  if (!name || name === noteName(S.cur)) { titleEl.value = noteName(S.cur); return; }
  if (BAD_NAME.test(name)) { toast('Names can’t contain \\ / : * ? " < > | # ^ [ ]'); titleEl.value = noteName(S.cur); return; }
  await renamePath(S.cur, join(dirname(S.cur), name + '.md'));
});

// ============================================================ fuzzy ranking

function score(q, s) {
  if (!q) return 0;
  const t = s.toLowerCase(); q = q.toLowerCase();
  const i = t.indexOf(q);
  if (i >= 0) return 1000 - i * 3 - t.length * 0.2 + (i === 0 || /[\s\/_\-.]/.test(t[i - 1]) ? 200 : 0) + (t === q ? 500 : 0);
  let sc = 0, j = 0, last = -2;
  for (const c of q) {
    if (c === ' ') continue;
    j = t.indexOf(c, j);
    if (j < 0) return -Infinity;
    sc += j === last + 1 ? 6 : (j === 0 || /[\s\/_\-.]/.test(t[j - 1])) ? 4 : 1;
    last = j; j++;
  }
  return sc - t.length * 0.2;
}
function rank(list, q, key = x => x) {
  if (!q) return [...list].sort((a, b) => collator.compare(key(a), key(b)));
  return list.map(x => [x, score(q, key(x))]).filter(([, s]) => s > -Infinity).sort((a, b) => b[1] - a[1]).map(([x]) => x);
}

// ============================================================ modals, pickers, menus

// When the last dialog closes, focus goes back where it was (the tree, the editor…), unless
// the dialog's action already moved it somewhere.
let focusBeforeModal = null;
new MutationObserver(() => {
  if ($('#modal-root').children.length || !focusBeforeModal) return;
  const f = focusBeforeModal;
  focusBeforeModal = null;
  const a = document.activeElement;
  if (f.isConnected && (!a || a === document.body || !a.isConnected)) f.focus({ preventScroll: true });
}).observe($('#modal-root'), { childList: true });

function modal(html) {
  if (!$('#modal-root').children.length && document.activeElement !== document.body) focusBeforeModal = document.activeElement;
  const back = document.createElement('div');
  back.className = 'backdrop';
  back.innerHTML = `<div class="modal">${html}</div>`;
  $('#modal-root').append(back);
  return back;
}

// items(q) -> [{main, sub, value}] ; resolves with value or null.
// onHighlight(value) is called as the selection moves (for live previews); `initial` preselects a value.
// Whether the last picker choice was made with Ctrl/Cmd held (the quick switcher opens a new tab).
let pickedWithMod = false;
function picker({ placeholder, items, onCreate, foot, onHighlight, initial }) {
  pickedWithMod = false;
  return new Promise(resolve => {
    const back = modal(`<input class="field" placeholder="${esc(placeholder)}" spellcheck="false"><div class="pick-list"></div><div class="pick-foot">${foot || '<span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>'}</div>`);
    const input = $('input', back), list = $('.pick-list', back);
    let cur = [], sel = 0, first = true;
    const draw = () => {
      cur = items(input.value).slice(0, 60);
      if (first && initial !== undefined) { const i = cur.findIndex(c => c.value === initial); if (i >= 0) sel = i; }
      first = false;
      if (onCreate && input.value.trim() && !cur.some(c => c.main.toLowerCase() === input.value.trim().toLowerCase()))
        cur.push({ main: `Create “${input.value.trim()}”`, sub: '⇧↵', create: true });
      sel = Math.min(sel, Math.max(0, cur.length - 1));
      list.innerHTML = cur.map((c, i) => `<div class="pick${i === sel ? ' sel' : ''}" data-i="${i}"><span class="main">${esc(c.main)}</span>${c.sub ? `<span class="sub">${esc(c.sub)}</span>` : ''}</div>`).join('') || '<div class="none">No matches</div>';
      list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
      if (onHighlight && cur[sel] && !cur[sel].create) onHighlight(cur[sel].value);
    };
    const done = v => { back.remove(); resolve(v); };
    const choose = (i, create) => {
      const c = cur[i];
      if (create || c?.create) { if (onCreate && input.value.trim()) { back.remove(); onCreate(input.value.trim()); resolve(null); } return; }
      if (c) done(c.value);
    };
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, cur.length - 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); pickedWithMod = e.ctrlKey || e.metaKey; choose(sel, e.shiftKey); }
      else if (e.key === 'Escape') { e.preventDefault(); done(null); }
    });
    list.addEventListener('mousemove', e => { const d = e.target.closest('.pick'); if (d && +d.dataset.i !== sel) { sel = +d.dataset.i; draw(); } });
    list.addEventListener('click', e => { const d = e.target.closest('.pick'); if (d) { pickedWithMod = e.ctrlKey || e.metaKey; choose(+d.dataset.i); } });
    back.addEventListener('mousedown', e => { if (e.target === back) done(null); });
    draw(); input.focus();
  });
}

// opts.multiline: a text box (Ctrl+Enter submits); opts.raw: don't trim the answer.
function promptModal(title, label, value, opts = {}) {
  return new Promise(resolve => {
    const field = opts.multiline ? '<textarea class="field" name="v" rows="6" spellcheck="false"></textarea>' : '<input class="field" name="v" spellcheck="false" autocomplete="off">';
    const back = modal(`<form class="form"><h3>${esc(title)}</h3><label>${esc(label)}${field}</label><div class="row"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">OK</button></div></form>`);
    const input = $('[name=v]', back); input.value = value ?? ''; input.focus(); input.select();
    const done = v => { back.remove(); resolve(v); };
    $('form', back).addEventListener('submit', e => { e.preventDefault(); done(opts.raw ? input.value : input.value.trim()); });
    $('[data-x]', back).onclick = () => done(null);
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') done(null);
      if (opts.multiline && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(opts.raw ? input.value : input.value.trim()); }
    });
    back.addEventListener('mousedown', e => { if (e.target === back) done(null); });
  });
}

function menu(x, y, items) {
  const root = $('#menu-root');
  root.innerHTML = '';
  const m = document.createElement('div');
  m.className = 'menu';
  items.forEach((it, i) => {
    if (!it) { m.append(document.createElement('hr')); return; }
    const d = document.createElement('div');
    d.textContent = it[0]; if (it[2]) d.className = it[2];
    d.onclick = () => { root.innerHTML = ''; it[1](); };
    m.append(d);
  });
  root.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!m.contains(e.target)) { root.innerHTML = ''; document.removeEventListener('mousedown', h); } }), 0);
}

function openSwitcher() {
  const files = [...S.files.keys()];
  picker({
    placeholder: 'Find or create a note…',
    foot: '<span>↑↓ navigate</span><span>↵ open</span><span>ctrl ↵ new tab</span><span>⇧↵ create</span><span>esc close</span>',
    items: q => {
      const r = rank(files, q, p => isMd(p) ? noteName(p) : basename(p)).map(p => ({ main: isMd(p) ? noteName(p) : basename(p), sub: dirname(p), value: p }));
      if (q) for (const [a, p] of S.byAlias) if (a.includes(q.toLowerCase())) r.push({ main: a, sub: '→ ' + noteName(p), value: p });
      if (!q) { const recent = S.recent.filter(p => S.files.has(p)); return [...recent.map(p => ({ main: noteName(p), sub: dirname(p) || 'recent', value: p })), ...r.filter(x => !recent.includes(x.value))]; }
      return r;
    },
    onCreate: name => followLink(name, null, null),
  }).then(p => p && (pickedWithMod ? openInNewTab(p) : openPath(p)));
}

// Every command, for the palette, hotkeys and the shortcuts sheet. `key` is the default binding
// in CodeMirror notation (Mod = Ctrl, or Cmd on a Mac); Settings → Hotkeys overrides it
// (cfg.hotkeys: id -> key, '' for none). Editor commands come from FolioEditor and are bound in
// the editor's own keymap, so they work while typing and never leak out of it.
const MAC = /Mac|iP(hone|ad)/.test(navigator.platform);
const inNote = f => () => S.view === 'note' ? f() : toast('Open a note first');
const APP_COMMANDS = [
  ['switcher', 'Open quick switcher', 'Mod-o', () => openSwitcher()],
  ['palette', 'Open command palette', 'Mod-p', () => openPalette()],
  ['shortcuts', 'Show keyboard shortcuts', 'Mod-/', () => showShortcuts()],
  ['hotkeys', 'Customize hotkeys…', '', () => openHotkeys()],
  ['new-note', 'Create new note', 'Mod-n', () => newNote()],
  ['save', 'Save', 'Mod-s', () => save()],
  ['new-folder', 'Create new folder', '', () => newFolder(S.cur ? dirname(S.cur) : '')],
  ['new-drawing', 'Create new drawing', '', () => newDrawing()],
  ['new-canvas', 'Create new canvas', '', () => newCanvas()],
  ['new-base', 'Create new base', '', () => newBase()],
  ['drawing-in-note', 'Create new drawing and embed it in the current note', '', () => newDrawingInNote()],
  ['export-svg', 'Export drawing as SVG', '', () => exportDrawing('svg')],
  ['export-png', 'Export drawing as PNG', '', () => exportDrawing('png')],
  ['copy-drawing', 'Copy drawing as PNG', '', () => S.view === 'drawing' ? copyDrawing('png', false) : toast('Open a drawing first')],
  ['drawing-md', 'Open drawing as Markdown', '', () => S.cur && isMd(S.cur) && isDrawing(S.cur) ? openPath(S.cur, { raw: true }) : toast('Only .excalidraw.md drawings have a Markdown view')],
  ['daily', "Open today's daily note", '', () => openDaily()],
  ['insert-template', 'Insert template', '', () => insertTemplate()],
  ['note-from-template', 'Create new note from template', '', () => newNoteFromTemplate()],
  ['run-templates', 'Replace template commands in current note', '', () => replaceTemplatesInNote()],
  ['toggle-mode', 'Toggle reading / editing view', 'Mod-e', () => { if (S.view === 'note') setMode(S.mode === 'edit' ? 'read' : 'edit'); }],
  ['search', 'Search in all notes', 'Mod-Shift-f', () => showPanel('search', true)],
  ['files', 'Focus the file tree', 'Mod-Shift-e', () => focusTree()],
  ['graph', 'Open graph view', 'Mod-g', () => openGraph(false)],
  ['local-graph', 'Open local graph of current note', '', () => openGraph(true)],
  ['back', 'Go back', 'Alt-ArrowLeft', () => goHist(-1)],
  ['forward', 'Go forward', 'Alt-ArrowRight', () => goHist(1)],
  ['rename', 'Rename current file', 'F2', () => S.cur && renameDialog(S.cur)],
  ['move', 'Move current file to folder…', '', () => S.cur && moveDialog(S.cur)],
  ['delete', 'Delete current file', '', () => S.cur && deletePath(S.cur)],
  ['reveal', 'Reveal current file in file tree', '', () => S.cur && revealInTree(S.cur)],
  ['toggle-left', 'Toggle left sidebar', 'Mod-\\', () => toggleSide('left')],
  ['backlinks', 'Show backlinks', 'Mod-Shift-b', () => showRight('backlinks')],
  ['all-properties', 'Show all properties', '', () => showPanel('props', true)],
  ['outline', 'Show outline', 'Mod-Shift-o', () => showRight('outline')],
  ['outgoing', 'Show outgoing links', '', () => showRight('outgoing')],
  ['new-tab', 'New tab', 'Mod-t', () => openInNewTab(null, { switcher: true })],
  ['close-tab', 'Close tab', 'Mod-w', () => closeTab()],
  ['reopen-tab', 'Reopen closed tab', '', () => reopenClosedTab()],
  ['next-tab', 'Next tab', 'Mod-PageDown', () => cycleTab(1)],
  ['prev-tab', 'Previous tab', 'Mod-PageUp', () => cycleTab(-1)],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => [`tab-${n}`, `Go to tab ${n}`, `Alt-${n}`, () => activateTab(n - 1)]),
  ['tab-last', 'Go to the last tab', 'Alt-9', () => activateTab(S.tabs.length - 1)],
  ['open-new-tab', 'Open current file in a new tab', '', () => openInNewTab(viewKey())],
  ['recent', 'Switch to a recent file', MAC ? 'Ctrl-Tab' : 'Mod-Tab', () => recentSwitcher(1)],
  ['recent-back', 'Switch to a recent file (backwards)', MAC ? 'Ctrl-Shift-Tab' : 'Mod-Shift-Tab', () => recentSwitcher(-1)],
  ['toggle-right', 'Toggle right sidebar', 'Mod-Shift-\\', () => toggleSide('right')],
  ['tasks', 'Open tasks', 'Mod-Shift-t', () => openTasks()],
  ['add-task', 'Add task…', '', () => quickAddTask()],
  ['screenshot', 'Insert screenshot', 'Mod-Shift-s', () => insertScreenshot()],
  ['screenshot-annotate', 'Insert screenshot and annotate it', 'Mod-Alt-s', () => insertScreenshot({ annotate: true })],
  ['screenshot-screen', 'Insert screenshot of the whole screen', '', () => insertScreenshot({ screen: true })],
  ['live-preview', 'Toggle live preview / source mode', '', () => { cfg.livePreview = !cfg.livePreview; saveCfg(); applyTheme(); toast(cfg.livePreview ? 'Live preview' : 'Source mode'); }],
  ['find', 'Find in current note', 'Mod-f', inNote(() => { setMode('edit'); ed.openSearch(); })],
  ['toggle-theme', 'Toggle light / dark theme', '', () => toggleTheme()],
  ['insert-icon', 'Insert icon (Nerd Fonts)…', '', () => insertIcon()],
  ['choose-theme', 'Change colour theme…', '', () => chooseTheme()],
  ['random', 'Open random note', '', () => { const n = [...S.notes.keys()]; n.length && openPath(n[Math.floor(Math.random() * n.length)]); }],
  ['reload', 'Reload vault from disk', '', () => loadAll().then(() => toast('Reloaded'))],
  ['vault', 'Open another vault…', '', () => switchVault()],
  ['settings', 'Settings', 'Mod-,', () => openSettings()],
].map(([id, name, key, run]) => ({ id, name, key, run }));
const EDITOR_COMMANDS = Object.entries(FolioEditor.commands).map(([id, c]) => ({
  id: 'editor:' + id, name: id === 'add-property' ? c.name : `Format: ${c.name}`, key: c.key, editor: id,
  run: inNote(() => { setMode('edit'); ed.run(id); }),
}));
const COMMANDS = [...APP_COMMANDS, ...EDITOR_COMMANDS];
const CMD_BY_ID = new Map(COMMANDS.map(c => [c.id, c]));

const keyFor = c => (cfg.hotkeys && c.id in cfg.hotkeys ? cfg.hotkeys[c.id] : c.key) || '';
// Editor key overrides by the editor's own command ids, for FolioEditor.create / setKeys.
const editorKeys = () => Object.fromEntries(EDITOR_COMMANDS.map(c => [c.editor, keyFor(c)]));
let HOTKEYS = new Map(); // key -> app command
function rebuildHotkeys() {
  HOTKEYS = new Map();
  for (const c of APP_COMMANDS) { const k = keyFor(c); if (k && !HOTKEYS.has(k)) HOTKEYS.set(k, c); }
  ed.setKeys(editorKeys());
  for (const el of $$('[data-cmd][title]')) {
    const c = CMD_BY_ID.get(el.dataset.hk || el.dataset.cmd);
    if (!c) continue;
    const k = keyFor(c), base = el.title.replace(/\s*\([^)]*\)$/, '');
    el.title = k ? `${base} (${fmtKey(k)})` : base;
  }
}

// Punctuation keys by position, so Shift+key names the key rather than the shifted character.
const PUNCT_CODES = { Backslash: '\\', Slash: '/', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Backquote: '`' };
// A keydown as a key string: [Mod-][Ctrl-/Meta-][Alt-][Shift-]key, letters lower case.
function keyOf(e) {
  const k = e.key;
  if (!k || k === 'Dead' || k === 'Unidentified' || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'].includes(k)) return null;
  let name = k.length === 1 ? k.toLowerCase() : k;
  if (/^Digit\d$/.test(e.code)) name = e.code.slice(5); // Shift+1 is "1", not "!"
  else if (e.shiftKey && PUNCT_CODES[e.code]) name = PUNCT_CODES[e.code]; // Shift+\ is "\", not "|"
  else if (/^Key[A-Z]$/.test(e.code) && !/^[a-z]$/.test(name)) name = e.code.slice(3).toLowerCase(); // Alt+letter on a Mac
  if (name === ' ') name = 'Space';
  const mod = MAC ? e.metaKey : e.ctrlKey, other = MAC ? e.ctrlKey : e.metaKey;
  return `${mod ? 'Mod-' : ''}${other ? (MAC ? 'Ctrl-' : 'Meta-') : ''}${e.altKey ? 'Alt-' : ''}${e.shiftKey ? 'Shift-' : ''}${name}`;
}
const KEY_NAMES = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Enter', Escape: 'Esc', Space: 'Space', Backspace: 'Backspace', Delete: 'Del' };
function fmtKey(k) {
  if (!k) return '';
  const parts = k.split(/-(?!$)/), key = parts.pop();
  const mods = parts.map(m => MAC ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }[m] : { Mod: 'Ctrl', Meta: 'Win' }[m] || m);
  const name = KEY_NAMES[key] || (key.length === 1 ? key.toUpperCase() : key);
  return MAC ? mods.join('') + name : [...mods, name].join('+');
}

// Keys belong to text fields while typing unless they use Ctrl/Cmd/Alt or are function keys.
const typingIn = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
// Registered at boot, after the canvas and drawing views, so their own keys (Ctrl+G to group,
// Alt+arrows between cards…) win while they're open.
function onHotkey(e) {
  if ($('#modal-root').children.length || e.defaultPrevented) return;
  const k = keyOf(e);
  const c = k && HOTKEYS.get(k);
  if (!c) return;
  if (!/(^|-)(Mod|Ctrl|Meta|Alt)-/.test(k) && !/^(Shift-)?F\d+$/.test(k) && typingIn(e.target)) return;
  e.preventDefault();
  c.run();
}

function openPalette() {
  const recent = store('recentCmds') || [];
  const order = c => { const i = recent.indexOf(c.id); return i < 0 ? 1e9 : i; };
  picker({
    placeholder: 'Type a command…',
    items: q => (q.trim() ? rank(COMMANDS, q, c => c.name) : [...COMMANDS].sort((a, b) => order(a) - order(b)))
      .map(c => ({ main: c.name, sub: fmtKey(keyFor(c)), value: c })),
    foot: '<span>↑↓ navigate</span><span>↵ run</span><span>esc close</span><span>recent commands first</span>',
  }).then(c => {
    if (!c) return;
    store('recentCmds', [c.id, ...recent.filter(x => x !== c.id)].slice(0, 12));
    c.run();
  });
}

rebuildHotkeys();

// ------------------------------------------------------------ Settings → Hotkeys

function openHotkeys(filter = '') {
  const back = modal(`<div class="hk"><div class="hk-head"><h3>Hotkeys</h3><input class="field hk-q" placeholder="Filter commands or keys…" spellcheck="false"></div>
    <div class="hk-list" tabindex="-1"></div>
    <div class="hk-foot"><span>Click a shortcut to change it. Press the new keys, <kbd>Backspace</kbd> to clear, <kbd>Esc</kbd> to cancel.</span><button class="btn" data-x>Done</button></div></div>`);
  back.querySelector('.modal').classList.add('wide');
  const q = $('.hk-q', back), list = $('.hk-list', back);
  let recording = null;
  const conflictsOf = c => {
    const k = keyFor(c);
    if (!k) return [];
    return COMMANDS.filter(o => o !== c && keyFor(o) === k && (!!o.editor === !!c.editor || !o.editor || !c.editor)).map(o => o.name);
  };
  const draw = () => {
    const f = q.value.trim().toLowerCase();
    const rows = COMMANDS.filter(c => !f || c.name.toLowerCase().includes(f) || fmtKey(keyFor(c)).toLowerCase().includes(f));
    list.innerHTML = rows.map(c => {
      const k = keyFor(c), custom = cfg.hotkeys && c.id in cfg.hotkeys, clash = conflictsOf(c);
      return `<div class="hk-row${clash.length ? ' clash' : ''}" data-id="${esc(c.id)}"><span class="hk-name">${esc(c.name)}${clash.length ? `<small>Also used by: ${esc(clash.join(', '))}</small>` : ''}</span>
        <button class="hk-key${recording === c.id ? ' rec' : ''}${k ? '' : ' none'}" data-rec>${recording === c.id ? 'Press keys…' : k ? esc(fmtKey(k)) : 'Blank'}</button>
        <button class="ib hk-reset" data-reset title="Restore the default${c.key ? ` (${esc(fmtKey(c.key))})` : ' (none)'}" ${custom ? '' : 'disabled'}>↺</button></div>`;
    }).join('') || '<div class="none">No matching commands</div>';
  };
  // Redraw, keeping the keyboard on the row just changed.
  const redraw = id => { draw(); if (id) $(`.hk-row[data-id="${CSS.escape(id)}"] .hk-key`, list)?.focus(); };
  const setKey = (id, k) => {
    cfg.hotkeys = { ...(cfg.hotkeys || {}) };
    const c = CMD_BY_ID.get(id);
    if (k === c.key) delete cfg.hotkeys[id]; else cfg.hotkeys[id] = k;
    saveCfg(); rebuildHotkeys();
  };
  list.addEventListener('click', e => {
    const row = e.target.closest('.hk-row');
    if (!row) return;
    if (e.target.closest('[data-rec]')) { recording = recording === row.dataset.id ? null : row.dataset.id; redraw(row.dataset.id); }
    else if (e.target.closest('[data-reset]')) { setKey(row.dataset.id, CMD_BY_ID.get(row.dataset.id).key); redraw(row.dataset.id); }
  });
  back.addEventListener('keydown', e => {
    if (!recording) { if (e.key === 'Escape') { e.preventDefault(); back.remove(); } return; }
    e.preventDefault(); e.stopPropagation();
    const id = recording;
    if (e.key === 'Escape') { recording = null; redraw(id); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey) { setKey(id, ''); recording = null; redraw(id); return; }
    const k = keyOf(e);
    if (!k) return; // a lone modifier: keep waiting
    setKey(id, k); recording = null; redraw(id);
  }, true);
  back.addEventListener('mousedown', e => { if (e.target === back) back.remove(); });
  $('[data-x]', back).onclick = () => back.remove();
  q.value = filter;
  q.addEventListener('input', draw);
  draw(); q.focus();
}

// ------------------------------------------------------------ shortcuts sheet

// Everything bound, plus the fixed keys of each view (canvas and drawing keys live in their help).
function showShortcuts() {
  const bound = cs => cs.filter(c => keyFor(c)).map(c => `<p><span>${esc(c.name.replace(/^Format: /, ''))}</span><kbd>${esc(fmtKey(keyFor(c)))}</kbd></p>`).join('');
  const fixed = rows => rows.map(([n, k]) => `<p><span>${esc(n)}</span><span class="keys">${k.split(' / ').map(x => `<kbd>${esc(x)}</kbd>`).join(' ')}</span></p>`).join('');
  const M = MAC ? '⌘' : 'Ctrl+', A = MAC ? '⌥' : 'Alt+', S_ = MAC ? '⇧' : 'Shift+';
  const back = modal(`<div class="dr-help shortcuts"><h3>Keyboard shortcuts</h3><div class="dr-help-cols">
    <div><h4>App</h4>${bound(APP_COMMANDS.filter(c => !/^tab-(\d|last)$/.test(c.id)))}${fixed([['Go to tab 1–8 / the last', `${A}1…${A}8 / ${A}9`]])}</div>
    <div><h4>Editing</h4>${bound(EDITOR_COMMANDS)}${fixed([['Move line up / down', `${A}↑ / ${A}↓`], ['Copy line', `${S_}${A}↑ / ${S_}${A}↓`], ['Select next match', `${M}D`], ['Indent / outdent list', `Tab / ${S_}Tab`], ['Follow link under cursor', `${M}click`], ['Undo / redo', `${M}Z / ${M}${S_}Z`]])}</div>
    <div><h4>File tree</h4>${fixed([['Move', '↑ / ↓'], ['Expand / collapse', '→ / ←'], ['Open', 'Enter'], ['Open in a new tab', `${M}Enter / middle-click`], ['Select several', `${S_}↑↓ / ${M}click / ${S_}click`], ['Rename', 'F2'], ['Delete', 'Del'], ['New note here', `${M}N`], ['Back to the page', 'Esc']])}
      <h4>Lists (search, tasks)</h4>${fixed([['Move', '↑ / ↓'], ['Open', 'Enter'], ['Tick a task', 'Space / X'], ['Due today / tomorrow', 'T / M']])}
      <h4>Backlinks / outline pane</h4>${fixed([['Switch tab', '← / →'], ['Preview a heading', 'Space'], ['Link an unlinked mention', 'L']])}
      <h4>Recent files</h4>${fixed([['Step through (hold Ctrl)', 'Tab / Shift+Tab'], ['Open', 'release Ctrl']])}
      <h4>Viewer</h4>${fixed([['Previous / next image', '← / →'], ['Zoom', '+ / - / 0 / 1']])}</div>
  </div><div class="shortcuts-foot"><button class="btn" data-hk>Customize hotkeys…</button><span>Canvas and drawing shortcuts: press <kbd>?</kbd> in those views.</span></div></div>`);
  back.tabIndex = -1; back.focus();
  back.addEventListener('mousedown', e => { if (e.target === back) back.remove(); });
  back.addEventListener('keydown', e => { if (e.key === 'Escape' || keyOf(e) === keyFor(CMD_BY_ID.get('shortcuts'))) { e.preventDefault(); back.remove(); } });
  $('[data-hk]', back).onclick = () => { back.remove(); openHotkeys(); };
}

function openSettings() {
  const back = modal(`<form class="form">
    <h3>Settings</h3>
    <label>Vault<div style="display:flex;gap:8px"><input class="field" id="vault-path" readonly><button type="button" class="btn" data-x-vault>Change…</button></div></label>
    <label>Default folder for new notes<input class="field" name="newNoteFolder" placeholder="(vault root)"></label>
    <label>Daily notes folder<input class="field" name="dailyFolder"></label>
    <label>Daily note template (note name or path)<input class="field" name="dailyTemplate" placeholder="e.g. Templates/Daily"></label>
    <label>Templates folder<input class="field" name="templatesFolder"></label>
    <label><span>Folder templates — new notes in a folder start from its template. One per line, e.g. <code>Meetings: Templates/Meeting</code> (<code>/</code> means every folder)</span><textarea class="field" name="folderTemplates" rows="3" spellcheck="false" placeholder="Meetings: Templates/Meeting"></textarea></label>
    <label>Attachments folder<input class="field" name="attachFolder"></label>
    <label>New tasks go to (a note path; empty means today's daily note)<input class="field" name="taskInbox" placeholder="(today's daily note)"></label>
    <label class="check"><input type="checkbox" name="taskDoneDate"> Add a done date (✅) when ticking a task</label>
    <label>New drawings are saved as<select class="field" name="drawingFormat"><option value="excalidraw">.excalidraw (Excalidraw file; also opens on excalidraw.com)</option><option value="md">.excalidraw.md (Obsidian Excalidraw plugin)</option></select></label>
    <label>Default view for notes<select class="field" name="defaultMode"><option value="edit">Editing</option><option value="read">Reading</option></select></label>
    <label>Light or dark<select class="field" name="theme"><option value="">Follow system</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
    <label>Colour theme<select class="field" name="palette">${FolioThemes.list.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" name="livePreview"> Live preview (hide Markdown syntax except where you're editing)</label>
    <label class="check"><input type="checkbox" name="readable"> Readable line length</label>
    <label class="check"><input type="checkbox" name="mono"> Monospace editor font</label>
    <label class="check"><input type="checkbox" name="vim"> Vim key bindings in the editor</label>
    <label class="check"><input type="checkbox" name="mathSnippets"> Math shortcuts while typing equations (<code>//</code> fraction, <code>@a</code> α, <code>mk</code>+Tab inline math…)</label>
    <label class="check"><input type="checkbox" name="screenshotHide"> Hide Folio while taking a screenshot (desktop app)</label>
    <div class="row" style="justify-content:flex-start;gap:12px"><label>Screenshot delay<select class="field" name="screenshotDelay"><option value="0">None</option><option value="3">3 seconds</option><option value="5">5 seconds</option><option value="10">10 seconds</option></select></label>
    <label>After a screenshot<select class="field" name="screenshotAfter"><option value="insert">Insert it</option><option value="annotate">Open it in a drawing to annotate</option></select></label></div>
    <label>CSS snippets folder (every <code>.css</code> file in it styles Folio; pair with a note's <code>cssclasses</code>)<input class="field" name="cssFolder" placeholder="e.g. Snippets (empty: none)"></label>
    <label>Properties at the top of notes<select class="field" name="properties"><option value="visible">Show as a table you can edit</option><option value="source">Show the YAML frontmatter as text</option></select></label>
    <div class="row" style="justify-content:flex-start"><button type="button" class="btn" data-x-hotkeys>Hotkeys…</button><button type="button" class="btn" data-x-shortcuts>Keyboard shortcuts</button></div>
    <label>Text font (any font installed on this computer; empty for the system font)<input class="field" name="fontText" list="font-text-list" placeholder="System font" spellcheck="false"></label>
    <label>Code font (empty for JetBrains Mono, which comes with Folio)<input class="field" name="fontMono" list="font-mono-list" placeholder="JetBrains Mono" spellcheck="false"></label>
    <datalist id="font-text-list"><option>Inter</option><option>Segoe UI</option><option>Noto Sans</option><option>Ubuntu</option><option>Georgia</option><option>Iowan Old Style</option><option>Literata</option><option>JetBrains Mono</option></datalist>
    <datalist id="font-mono-list"><option>JetBrains Mono</option><option>JetBrainsMono Nerd Font</option><option>FiraCode Nerd Font</option><option>Hack Nerd Font</option><option>Iosevka</option><option>Fira Code</option><option>Cascadia Code</option><option>Consolas</option><option>Menlo</option><option>Ubuntu Mono</option></datalist>
    <div class="font-preview">Preview: <span class="fp-text">The quick brown fox — 0O 1lI</span> <code class="fp-mono">fn main() { 0O 1lI =&gt; }</code> <span class="fp-icons">\uf09b \ue7a8 \uf0e7 \uf011 \udb80\ude0c</span></div>
    <div class="row"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Save</button></div>
  </form>`);
  const f = $('form', back);
  for (const [k, v] of Object.entries(cfg)) { const el = f.elements[k]; if (!el) continue; if (el.type === 'checkbox') el.checked = v; else el.value = v; }
  // Live font preview while typing a font name.
  const fp = () => {
    $('.fp-text', back).style.fontFamily = f.elements.fontText.value.trim() ? `${cssFontName(f.elements.fontText.value)}, var(--font-ui)` : 'var(--font-ui)';
    $('.fp-mono', back).style.fontFamily = f.elements.fontMono.value.trim() ? `${cssFontName(f.elements.fontMono.value)}, ${FONT_MONO_DEFAULT}` : FONT_MONO_DEFAULT;
  };
  f.elements.fontText.addEventListener('input', fp); f.elements.fontMono.addEventListener('input', fp); fp();
  const close = () => back.remove();
  $('[data-x]', back).onclick = close;
  api('/api/info').then(i => { $('#vault-path', back).value = i.vault; }).catch(() => { });
  $('[data-x-vault]', back).onclick = () => { close(); switchVault(); };
  $('[data-x-hotkeys]', back).onclick = () => { close(); openHotkeys(); };
  $('[data-x-shortcuts]', back).onclick = () => { close(); showShortcuts(); };
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  f.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  f.addEventListener('submit', e => {
    e.preventDefault();
    for (const k of Object.keys(DEFAULTS)) {
      const el = f.elements[k]; if (!el) continue;
      cfg[k] = el.type === 'checkbox' ? el.checked : el.tagName === 'TEXTAREA' ? el.value.trim() : el.value.trim().replace(/^\/+|\/+$/g, '');
    }
    saveCfg(); applyTheme(); close();
    S.version++; ed.refresh(); if (S.view === 'note' && S.mode === 'read') renderPreview(); // (properties display)
    userCssKey = null; loadUserCss();
  });
}

async function switchVault() {
  let info;
  try { info = await api('/api/info'); } catch (e) { return toast(e.message); }
  const p = await promptModal('Open another vault', 'Full path to a folder of notes (created if it doesn’t exist)', info.vault);
  if (!p || p === info.vault) return;
  await save();
  try { await api('/api/vault', { method: 'POST', body: JSON.stringify({ path: p }) }); }
  catch (e) { return toast('Couldn’t open that folder: ' + e.message); }
  location.reload();
}

// ============================================================ Nerd Font icons

let nerdIcons = null;
async function loadNerdIcons() {
  if (nerdIcons) return nerdIcons;
  const text = await (await fetch('/vendor/nerd-icons.txt')).text();
  const SETS = { cod: 'Codicons', dev: 'Devicons', fa: 'Font Awesome', fae: 'Font Awesome ext.', iec: 'Power', linux: 'Logos', md: 'Material', oct: 'Octicons', pl: 'Powerline', ple: 'Powerline ext.', pom: 'Pomicons', seti: 'Seti', custom: 'Nerd Fonts', weather: 'Weather' };
  nerdIcons = text.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
    const [name, hex] = l.split(' ');
    const dash = name.indexOf('-');
    return { name: name.slice(dash + 1).replace(/_/g, ' '), full: name, set: SETS[name.slice(0, dash)] || name.slice(0, dash), char: String.fromCodePoint(parseInt(hex, 16)) };
  });
  return nerdIcons;
}
// Search the Nerd Fonts icons by name and insert one (or copy it when no note is open).
async function insertIcon() {
  let icons;
  try { icons = await loadNerdIcons(); } catch (e) { return toast('Couldn’t load the icon list: ' + e.message); }
  const target = S.view === 'note' ? S.cur : null;
  const pick = await picker({
    placeholder: `Search ${icons.length.toLocaleString()} icons… (e.g. github, rust, calendar)`,
    items: q => (q ? rank(icons, q, x => x.full) : icons.slice(0, 60)).map(x => ({ main: `${x.char}   ${x.name}`, sub: x.set, value: x })),
  });
  if (!pick) return;
  if (target && S.cur === target && S.view === 'note') {
    if (S.mode !== 'edit') setMode('edit');
    insertText(ed.selectionStart, ed.selectionEnd, pick.char);
  } else {
    try { await navigator.clipboard.writeText(pick.char); toast(`Copied ${pick.full}`); } catch { toast('Open a note to insert icons'); }
  }
}

// Pick a colour theme, previewing each one as you move through the list.
async function chooseTheme() {
  const orig = cfg.palette;
  const v = await picker({
    placeholder: 'Choose a colour theme…',
    items: q => rank(FolioThemes.list, q, t => t.name).map(t => ({ main: t.name, sub: t.id === orig ? 'current' : '', value: t.id })),
    initial: orig,
    onHighlight: id => { if (cfg.palette !== id) { cfg.palette = id; applyTheme(); } },
  });
  cfg.palette = v || orig;
  saveCfg(); applyTheme();
}

function toggleTheme() {
  cfg.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  saveCfg(); applyTheme();
}

// ============================================================ left panels: search & tags

function showPanel(name, focus = false) {
  const hidden = document.body.classList.contains('app-no-left');
  const current = $$('#left .panel').find(p => !p.hidden)?.id;
  if (!focus && !hidden && current === 'panel-' + name) { toggleSide('left'); return; }
  if (hidden) toggleSide('left');
  for (const p of $$('#left .panel')) p.hidden = p.id !== 'panel-' + name;
  for (const b of $$('#ribbon .rb[data-cmd^=panel-]')) b.classList.toggle('active', b.dataset.cmd === 'panel-' + name);
  if (name === 'search') { const i = $('#search-input'); i.focus(); i.select(); }
  if (name === 'tags') renderTags();
  if (name === 'props') { renderPropsPanel(); if (focus) $('#props-filter').focus(); }
}

function toggleSide(which) {
  document.body.classList.toggle(`app-no-${which}`);
  store('layout', { left: !document.body.classList.contains('app-no-left'), right: !document.body.classList.contains('app-no-right') });
  if (S.view === 'graph') FolioGraph.resize();
}

function searchFor(q) {
  showPanel('search', true);
  $('#search-input').value = q;
  runSearch();
}

// Does frontmatter `fm` have property k (any case), with a value containing v (or any value if v is empty)?
function propMatches(fm, k, v) {
  const key = Object.keys(fm || {}).find(x => x.toLowerCase() === k);
  if (key == null) return false;
  const vals = [fm[key]].flat().filter(x => x != null && x !== '').map(x => String(x).toLowerCase());
  return v ? vals.some(x => x.includes(v) || x.replace(/^#/, '') === v.replace(/^#/, '')) : true;
}
function parseQuery(q) {
  const terms = [];
  // [key] or [key:value] (Obsidian's property search), or op:"text" / op:text / plain words.
  const re = /(-?)(?:\[([^\]:]+)(?::\s*(?:"([^"]*)"|([^\]]*)))?\]|(?:(tag|path|file|line):)?(?:"([^"]*)"|(\S+)))/g; let m;
  while ((m = re.exec(q))) {
    if (m[2] != null) { terms.push({ neg: !!m[1], op: 'prop', k: m[2].trim().toLowerCase(), v: (m[3] ?? m[4] ?? '').trim().toLowerCase() }); continue; }
    m = [m[0], m[1], m[5], m[6], m[7]];
    const v = (m[3] ?? m[4] ?? '').toLowerCase();
    if (!v) continue;
    terms.push({ neg: !!m[1], op: m[2] || 'text', v: m[2] === 'tag' ? v.replace(/^#/, '') : v });
  }
  return terms;
}

function runSearch() {
  const q = $('#search-input').value.trim();
  const out = $('#search-results'), meta = $('#search-meta');
  if (!q) { out.innerHTML = ''; meta.textContent = ''; return; }
  const terms = parseQuery(q);
  const texts = terms.filter(t => t.op === 'text' && !t.neg).map(t => t.v);
  const results = [];
  for (const [p, n] of S.notes) {
    // Leave out a drawing note's hidden %% data %% (its JSON), as Obsidian hides it too.
    const text = isDrawing(p) ? n.content.replace(/%%[\s\S]*?(?:%%|$)/g, m => ' '.repeat(m.length)) : n.content;
    const low = text.toLowerCase(), pl = p.toLowerCase();
    let ok = true;
    for (const t of terms) {
      let hit;
      if (t.op === 'tag') hit = [...n.tags].some(x => x === t.v || x.startsWith(t.v + '/'));
      else if (t.op === 'path') hit = pl.includes(t.v);
      else if (t.op === 'file') hit = noteName(p).toLowerCase().includes(t.v);
      else if (t.op === 'prop') hit = propMatches(n.fm, t.k, t.v);
      else hit = low.includes(t.v) || noteName(p).toLowerCase().includes(t.v);
      if (hit === t.neg) { ok = false; break; }
    }
    if (!ok) continue;
    const snips = [];
    let hits = 0;
    for (const t of texts) {
      let i = low.indexOf(t);
      while (i >= 0) {
        hits++;
        if (snips.length < 4 && !snips.some(s => Math.abs(s.i - i) < 60)) snips.push({ i, len: t.length });
        i = low.indexOf(t, i + t.length);
      }
    }
    const titleHit = texts.some(t => noteName(p).toLowerCase().includes(t));
    results.push({ p, snips, hits, titleHit });
  }
  results.sort((a, b) => (b.titleHit - a.titleHit) || (b.hits - a.hits) || collator.compare(a.p, b.p));
  meta.textContent = `${results.length} note${results.length === 1 ? '' : 's'}`;
  out.innerHTML = results.slice(0, 300).map(r => {
    const c = S.notes.get(r.p).content;
    const sn = r.snips.map(s => {
      const a = Math.max(0, s.i - 50), b = Math.min(c.length, s.i + s.len + 70);
      return `<div class="s-snip" tabindex="-1" data-path="${esc(r.p)}" data-i="${s.i}" data-len="${s.len}">${a > 0 ? '…' : ''}${esc(c.slice(a, s.i))}<mark>${esc(c.slice(s.i, s.i + s.len))}</mark>${esc(c.slice(s.i + s.len, b))}${b < c.length ? '…' : ''}</div>`;
    }).join('');
    return `<div class="s-file"><div class="s-file-name" tabindex="-1" data-path="${esc(r.p)}">${esc(noteName(r.p))}<small>${esc(dirname(r.p))}</small>${r.hits ? `<small>${r.hits}</small>` : ''}</div>${sn}</div>`;
  }).join('');
}
$('#search-input').addEventListener('input', debounce(runSearch, 120));
$('#search-results').addEventListener('click', e => {
  const s = e.target.closest('.s-snip');
  if (s) { const i = +s.dataset.i; return openPath(s.dataset.path, { mode: 'edit', select: [i, i + +s.dataset.len] }); }
  const f = e.target.closest('.s-file-name');
  if (f) openPath(f.dataset.path);
});

// Focusable items in the right pane (backlinks, outgoing links, outline).
const RIGHT_ITEMS = '.bl-file, .bl-ctx, .o-item, a.tag';

// ↑↓ through a panel's items, Enter opens one, Esc goes back (to the search box, or the page).
function listKeys(box, sel, back) {
  box.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const items = $$(sel, box), i = items.indexOf(document.activeElement);
    let n = null;
    if (e.key === 'ArrowDown') n = items[Math.min(items.length - 1, i + 1)];
    else if (e.key === 'ArrowUp') { if (i <= 0) { e.preventDefault(); return back(); } n = items[i - 1]; }
    else if (e.key === 'Home') n = items[0];
    else if (e.key === 'End') n = items[items.length - 1];
    else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); items[i].click(); return; }
    else if (e.key === 'Escape') { e.preventDefault(); return back(); }
    else return;
    e.preventDefault();
    n?.focus(); n?.scrollIntoView({ block: 'nearest' });
  });
}
listKeys($('#search-results'), '.s-file-name, .s-snip', () => $('#search-input').focus());
listKeys($('#right-body'), RIGHT_ITEMS, () => focusMain());
// In the right pane: ←/→ switch between Backlinks, Outgoing and Outline; Space previews a
// heading; L links an unlinked mention.
const RTABS = ['backlinks', 'outgoing', 'outline'];
function showRight(tab) {
  if (document.body.classList.contains('app-no-right')) toggleSide('right');
  rtab = tab; store('rtab', rtab); refreshPanels();
  const first = $(`#right-body :is(${RIGHT_ITEMS})`);
  if (first) first.focus(); else $(`#right .tabs [data-rtab="${tab}"]`).focus();
}
$('#right').addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !typingIn(e.target)) {
    e.preventDefault();
    showRight(RTABS[(RTABS.indexOf(rtab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3]);
  } else if (e.key === ' ' && e.target.matches?.('.o-item[data-heading]')) {
    // Space scrolls the page to a heading without leaving the outline (Enter goes there).
    e.preventDefault();
    const it = e.target;
    scrollToHeading(it.dataset.heading);
    it.focus({ preventScroll: true });
  } else if (e.key.toLowerCase() === 'l' && e.target.matches?.('.bl-ctx')) {
    const b = e.target.querySelector('[data-link]');
    if (b) { e.preventDefault(); b.click(); }
  } else if (e.key === 'ArrowDown' && e.target.matches?.('.tabs button')) {
    e.preventDefault(); $(`#right-body :is(${RIGHT_ITEMS})`)?.focus();
  } else if (e.key === 'Escape' && e.target.matches?.('.tabs button')) { e.preventDefault(); focusMain(); }
});
listKeys($('#tag-list'), '.tag-row', () => focusMain());
listKeys($('#props-list'), '.pr-name, .pr-val', () => $('#props-filter').focus());
$('#props-filter').addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); $('#props-list :is(.pr-name, .pr-val)')?.focus(); } else if (e.key === 'Escape') { e.preventDefault(); focusMain(); } });
$('#search-input').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.isComposing)) {
    const first = $('#search-results .s-file-name');
    if (!first) return;
    e.preventDefault();
    if (e.key === 'Enter') first.click(); else first.focus();
  } else if (e.key === 'Escape' && !e.target.value) { e.preventDefault(); focusMain(); }
});

// Ctrl+Tab: hold Ctrl and press Tab to step through recently opened files (Shift+Tab goes back);
// letting go of Ctrl opens the one selected. Enter or a click opens too; Esc cancels.
let recentBox = null;
function recentSwitcher(step) {
  if (recentBox) return recentBox.move(step);
  const list = S.recent.filter(p => S.files.has(p));
  if (list.length < 2 && !(list.length === 1 && list[0] !== S.cur)) return toast('No other recent files');
  let i = list[0] === S.cur ? (step > 0 ? 1 : list.length - 1) : 0;
  const back = modal(`<div class="rs"><div class="rs-head">Recent files</div><div class="rs-list">${list.map((p, j) => `<div class="rs-item" data-i="${j}"><span>${esc(displayName(p))}</span><small>${esc(dirname(p))}</small></div>`).join('')}</div><div class="pick-foot"><span>hold Ctrl, Tab to move</span><span>release to open</span><span>esc cancel</span></div></div>`);
  back.classList.add('rs-back');
  back.tabIndex = -1; back.focus();
  const draw = () => $$('.rs-item', back).forEach((x, j) => { x.classList.toggle('sel', j === i); if (j === i) x.scrollIntoView({ block: 'nearest' }); });
  const close = open => {
    window.removeEventListener('keyup', up, true);
    back.remove(); recentBox = null;
    if (open) openPath(list[i]).then(() => focusMain());
  };
  const up = e => { if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt') close(true); };
  window.addEventListener('keyup', up, true);
  back.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); recentBox.move(e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1); }
    else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    else if (e.key === 'Escape') { e.preventDefault(); close(false); }
  });
  back.addEventListener('mousedown', e => { const it = e.target.closest('.rs-item'); if (it) { i = +it.dataset.i; close(true); } else if (e.target === back) close(false); });
  recentBox = { move(d) { i = (i + d + list.length) % list.length; draw(); } };
  draw();
}

function renderTags() {
  const counts = new Map();
  for (const n of S.notes.values()) for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
  const list = [...counts].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
  $('#tag-list').innerHTML = list.length
    ? list.map(([t, c]) => `<div class="tag-row" tabindex="-1" data-tag="${esc(t)}"><span>#${esc(t)}</span><span class="n">${c}</span></div>`).join('')
    : '<div class="none">No tags yet. Add #tags to notes or a <code>tags:</code> list in frontmatter.</div>';
}
$('#tag-list').addEventListener('click', e => { const r = e.target.closest('.tag-row'); if (r) searchFor(`tag:${r.dataset.tag}`); });

// ============================================================ right panel

let rtab = store('rtab') || 'backlinks';

function lineAround(content, index) {
  const s = content.lastIndexOf('\n', index - 1) + 1;
  let e = content.indexOf('\n', index); if (e < 0) e = content.length;
  let line = content.slice(s, e).trim();
  if (line.length > 220) { const off = Math.max(0, index - s - 80); line = (off ? '…' : '') + content.slice(s + off, s + off + 200).trim() + '…'; }
  return line;
}

function backlinksOf(p) {
  const res = new Map();
  for (const [q, c] of S.canvases) if (q !== p && c.refs.includes(p)) res.set(q, [{ index: 0, line: `A card on the canvas “${displayName(q)}”` }]);
  for (const [q, n] of S.notes) {
    if (q === p || !n.out) continue;
    n.out.forEach((t, i) => {
      if (t !== p) return;
      if (!res.has(q)) res.set(q, []);
      res.get(q).push({ index: n.links[i].index, line: lineAround(n.content, n.links[i].index) });
    });
  }
  return res;
}

function unlinkedMentions(p) {
  const names = [noteName(p), ...(S.notes.get(p)?.aliases || [])].filter(x => x.length >= 3);
  if (!names.length) return new Map();
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  const res = new Map();
  for (const [q, n] of S.notes) {
    if (q === p) continue;
    const body = blankCode(n.content);
    let m; re.lastIndex = n.fmLen;
    while ((m = re.exec(body))) {
      const i = m.index;
      if (n.links.some(l => i >= l.index && i < l.index + l.len)) continue;
      if (!res.has(q)) res.set(q, []);
      const list = res.get(q);
      if (list.length < 5) list.push({ index: i, len: m[0].length, line: lineAround(n.content, i) });
    }
  }
  return res;
}

function refreshPanels(light = false) {
  const body = $('#right-body');
  // Redrawing the pane shouldn't throw the keyboard out of it.
  const had = body.contains(document.activeElement) ? $$(RIGHT_ITEMS, body).indexOf(document.activeElement) : -1;
  try { drawRight(body, light); } finally {
    for (const x of $$(RIGHT_ITEMS, body)) x.tabIndex = -1;
    if (had >= 0) { const items = $$(RIGHT_ITEMS, body); items[Math.min(had, items.length - 1)]?.focus({ preventScroll: true }); }
  }
}
function drawRight(body, light) {
  for (const b of $$('#right .tabs button')) b.classList.toggle('active', b.dataset.rtab === rtab);
  if (!$('#panel-tags').hidden && !light) renderTags();
  if (!$('#panel-props').hidden && !light) renderPropsPanel();
  if (!$('#panel-search').hidden && $('#search-input').value && !light) runSearch();
  if (S.view === 'graph' && !light) FolioGraph.refresh();
  updateStatus();
  if (!S.cur) { body.innerHTML = '<div class="none">No file open.</div>'; return; }
  const n = S.notes.get(S.cur);
  if (rtab === 'backlinks') {
    const bl = backlinksOf(S.cur);
    let html = `<div class="r-sec"><h4>Linked mentions <span>${[...bl.values()].reduce((a, b) => a + b.length, 0)}</span></h4>`;
    html += bl.size ? [...bl].sort((a, b) => collator.compare(a[0], b[0])).map(([q, items]) =>
      `<div class="bl-file" data-path="${esc(q)}">${esc(noteName(q))}</div>` +
      items.map(it => `<div class="bl-ctx" data-path="${esc(q)}" data-i="${it.index}">${esc(it.line)}</div>`).join('')).join('')
      : '<div class="none">No backlinks.</div>';
    html += '</div>';
    if (isMd(S.cur)) {
      const um = light ? null : unlinkedMentions(S.cur);
      if (um) {
        html += `<div class="r-sec"><h4>Unlinked mentions <span>${um.size}</span></h4>`;
        html += um.size ? [...um].map(([q, items]) =>
          `<div class="bl-file" data-path="${esc(q)}">${esc(noteName(q))}</div>` +
          items.map(it => `<div class="bl-ctx" data-path="${esc(q)}" data-i="${it.index}" data-len="${it.len}"><button data-link>Link</button>${esc(it.line)}</div>`).join('')).join('')
          : '<div class="none">None.</div>';
        html += '</div>';
      } else if (body.dataset.tab === 'backlinks' && body.dataset.for === S.cur) {
        const old = body.querySelectorAll('.r-sec')[1];
        if (old) html += old.outerHTML;
      }
    }
    body.innerHTML = html;
  } else if (rtab === 'outgoing') {
    if (!n) { body.innerHTML = '<div class="none">Not a note.</div>'; }
    else {
      const seen = new Set(), res = [], unres = [];
      n.links.forEach((l, i) => {
        const t = n.out?.[i];
        const key = t || l.name.toLowerCase();
        if (!l.name || seen.has(key) || t === S.cur) return; seen.add(key);
        (t ? res : unres).push(t ? `<div class="o-item" data-path="${esc(t)}">${esc(isMd(t) ? noteName(t) : basename(t))}</div>` : `<div class="o-item unresolved" data-create="${esc(l.name)}" title="Click to create">${esc(l.name)}</div>`);
      });
      const tags = [...n.tags].map(t => `<a class="tag" data-tag="${esc(t)}">#${esc(t)}</a>`).join(' ');
      body.innerHTML = `<div class="r-sec"><h4>Links <span>${res.length}</span></h4>${res.join('') || '<div class="none">None.</div>'}</div>` +
        (unres.length ? `<div class="r-sec"><h4>Unresolved <span>${unres.length}</span></h4>${unres.join('')}</div>` : '') +
        `<div class="r-sec markdown" style="font-size:13px"><h4>Tags</h4>${tags || '<div class="none">None.</div>'}</div>`;
    }
  } else {
    body.innerHTML = n && n.headings.length
      ? '<div class="r-sec">' + n.headings.map(h => `<div class="o-item" style="padding-left:${6 + (h.level - 1) * 14}px" data-heading="${esc(h.text)}">${esc(h.text)}</div>`).join('') + '</div>'
      : '<div class="none">No headings.</div>';
  }
  body.dataset.tab = rtab; body.dataset.for = S.cur;
}

$('#right .tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-rtab]'); if (!b) return;
  rtab = b.dataset.rtab; store('rtab', rtab); refreshPanels();
});
$('#right-body').addEventListener('click', async e => {
  const link = e.target.closest('[data-link]');
  if (link) {
    // Convert an unlinked mention into a [[link]].
    const ctx = link.closest('.bl-ctx');
    const q = ctx.dataset.path, i = +ctx.dataset.i, len = +ctx.dataset.len;
    const n = S.notes.get(q);
    const word = n.content.slice(i, i + len);
    const nm = linkNameFor(S.cur, [...S.files.keys()]);
    const txt = word === nm ? `[[${nm}]]` : `[[${nm}|${word}]]`;
    await writeFile(q, n.content.slice(0, i) + txt + n.content.slice(i + len), n.mtime);
    resolveNote(q); refreshPanels();
    return;
  }
  const c = e.target.closest('.bl-ctx');
  if (c) { const i = +c.dataset.i; return openPath(c.dataset.path, { mode: 'edit', select: [i, i + (+c.dataset.len || 0)] }); }
  const f = e.target.closest('[data-path]');
  if (f) return openPath(f.dataset.path);
  const cr = e.target.closest('[data-create]');
  if (cr) return followLink(cr.dataset.create, null, S.cur);
  const h = e.target.closest('[data-heading]');
  if (h) scrollToHeading(h.dataset.heading);
});

function updateStatus() {
  const left = $('#status-left'), right = $('#status-right');
  if (S.view === 'tasks') {
    const open = allTasks().filter(x => !x.done && !x.cancelled).length;
    left.textContent = '';
    right.textContent = `${open.toLocaleString()} open task${open === 1 ? '' : 's'}`;
  } else if (S.view === 'base' && S.cur) {
    left.textContent = '';
    right.textContent = 'Base';
  } else if (S.view === 'canvas' && S.cur) {
    const bl = [...backlinksOf(S.cur).values()].reduce((a, b) => a + b.length, 0);
    const n = FolioCanvas.count();
    left.textContent = `${bl} backlink${bl === 1 ? '' : 's'}`;
    right.textContent = `Canvas · ${n.toLocaleString()} card${n === 1 ? '' : 's'}`;
  } else if (S.view === 'drawing' && S.cur) {
    const bl = [...backlinksOf(S.cur).values()].reduce((a, b) => a + b.length, 0);
    const n = FolioDraw.count();
    left.textContent = `${bl} backlink${bl === 1 ? '' : 's'}`;
    right.textContent = `Drawing · ${n.toLocaleString()} element${n === 1 ? '' : 's'}`;
  } else if (S.view === 'note' && S.cur) {
    const text = ed.value.slice(splitFrontmatter(ed.value).fmLen);
    const words = (text.match(/[\p{L}\p{N}'’_-]+/gu) || []).length;
    const bl = [...backlinksOf(S.cur).values()].reduce((a, b) => a + b.length, 0);
    left.textContent = `${bl} backlink${bl === 1 ? '' : 's'}`;
    right.textContent = `${words.toLocaleString()} words · ${text.length.toLocaleString()} characters`;
  } else {
    left.textContent = '';
    right.textContent = `${S.notes.size.toLocaleString()} notes · ${(S.files.size - S.notes.size).toLocaleString()} attachments`;
  }
}

// ============================================================ graph

function graphData({ local, depth, tags, unresolved, orphans, attach, filter }) {
  const nodes = new Map(), edges = [];
  const add = (id, label, kind) => { if (!nodes.has(id)) nodes.set(id, { id, label, kind, deg: 0 }); return nodes.get(id); };
  const f = (filter || '').toLowerCase();
  const allowFile = p => (isMd(p) || attach || DRAWING_EXT.test(p) || isCanvas(p)) && (!f || p.toLowerCase().includes(f));
  for (const p of S.files.keys()) if (allowFile(p)) add(p, displayName(p), isDrawing(p) ? 'drawing' : isCanvas(p) ? 'canvas' : isMd(p) ? 'note' : 'file');
  for (const [p, c] of S.canvases) {
    if (!nodes.has(p)) continue;
    for (const t of c.refs) if (nodes.has(t) && t !== p) edges.push([p, t]);
  }
  for (const [p, n] of S.notes) {
    if (!nodes.has(p)) continue;
    const seen = new Set();
    n.links.forEach((l, i) => {
      let t = n.out?.[i];
      if (!t) { if (!unresolved || !l.name) return; t = 'unresolved:' + l.name.toLowerCase(); add(t, l.name, 'unresolved'); }
      if (!nodes.has(t) || t === p || seen.has(t)) return;
      seen.add(t); edges.push([p, t]);
    });
    if (tags) for (const tg of n.tags) { const id = 'tag:' + tg; add(id, '#' + tg, 'tag'); edges.push([p, id]); }
  }
  for (const [a, b] of edges) { nodes.get(a).deg++; nodes.get(b).deg++; }
  if (local && S.cur && nodes.has(S.cur)) {
    const adj = new Map();
    for (const [a, b] of edges) { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); }
    const keep = new Set([S.cur]); let frontier = [S.cur];
    for (let d = 0; d < depth; d++) {
      const nx = [];
      for (const x of frontier) for (const y of adj.get(x) || []) if (!keep.has(y)) { keep.add(y); nx.push(y); }
      frontier = nx;
    }
    for (const id of [...nodes.keys()]) if (!keep.has(id)) nodes.delete(id);
  } else if (!orphans) {
    for (const [id, nd] of [...nodes]) if (!nd.deg) nodes.delete(id);
  }
  return { nodes: [...nodes.values()], edges: edges.filter(([a, b]) => nodes.has(a) && nodes.has(b)), current: S.cur };
}

function graphOptions() {
  return {
    local: $('#g-local').checked, depth: +$('#g-depth').value, tags: $('#g-tags').checked,
    unresolved: $('#g-unresolved').checked, orphans: $('#g-orphans').checked, attach: $('#g-attach').checked,
    filter: $('#g-filter').value.trim(),
  };
}

async function openGraph(local) {
  flushDocViews();
  await save();
  rememberPos();
  $('#g-local').checked = !!local;
  showView('graph');
  setSaveState('');
  $('#crumbs').innerHTML = `<b>${local && S.cur ? 'Local graph · ' + esc(noteName(S.cur)) : 'Graph view'}</b>`;
  FolioGraph.refresh(true);
}

FolioGraph.init($('#graph-canvas'), {
  data: () => graphData(graphOptions()),
  open: id => {
    if (id.startsWith('tag:')) return searchFor('tag:' + id.slice(4));
    if (id.startsWith('unresolved:')) return;
    openPath(id);
  },
});
// A live-preview editor inside a canvas card. A text card's editor reports its text through
// onChange; a note card's edits the note itself and saves it as you type, like the main editor.
function mountCardEditor(host, o) {
  const note = o.notePath;
  if (note && !S.notes.has(note)) return null;
  let mtime = note ? S.notes.get(note).mtime : 0, timer = null, dirty = false, chain = Promise.resolve();
  const save = () => {
    clearTimeout(timer); timer = null;
    if (!dirty) return chain;
    dirty = false;
    const body = cm.value;
    chain = chain.then(async () => {
      try {
        const r = await api(`/api/file?path=${enc(note)}`, { method: 'PUT', body, headers: mtime ? { 'X-Base-Mtime': String(mtime) } : {} });
        mtime = r.mtime;
        setNote(note, body, r.mtime);
        S.files.set(note, { ...S.files.get(note), mtime: r.mtime, size: new Blob([body]).size });
        resolveNote(note);
        FolioCanvas.refreshFiles();
      } catch (e) {
        if (e.status !== 409) { toast('Save failed: ' + e.message); dirty = true; return; }
        // Changed elsewhere: take the version on disk rather than overwrite it.
        const got = await readMany([note]);
        if (got[note]) { setNote(note, got[note].content, got[note].mtime); resolveNote(note); mtime = got[note].mtime; if (alive) cm.setSilently(got[note].content); }
        toast(`"${noteName(note)}" changed on disk, so the card now shows that version.`, 4000);
      }
    });
    return chain;
  };
  let alive = true;
  const from = () => note || o.from || S.cur;
  const cm = FolioEditor.create(host, editorHooks(from, {
    onChange: () => {
      if (note) { dirty = true; clearTimeout(timer); timer = setTimeout(save, 700); }
      else o.onChange?.(cm.value);
    },
    onFiles: (files, pasted) => { (async () => { for (const f of files) await attachAndLink(f, pasted, cm); })(); },
    ...(note ? {} : { codeBlock: lang => lang === 'tasks' }), // a base block in a text card has no note to save to
  }), {
    vim: cfg.vim,
    keys: editorKeys(),
    placeholder: o.placeholder || '',
    extraKeys: [
      // Tab on a plain line makes a connected card (as on the canvas); in lists it still indents.
      ...(o.onTab ? [{ key: 'Tab', run: v => /^\s*([-*+]|\d+[.)])\s/.test(v.state.doc.lineAt(v.state.selection.main.head).text) ? false : o.onTab() }] : []),
    ],
  });
  cm.load(note ? S.notes.get(note).content : o.text || '');
  regEditor(cm, from);
  // Escape finishes editing unless the editor needs it (a popup, search, Vim insert mode). Caught
  // before the editor sees it, since Vim and the completion keymap claim Escape unconditionally.
  host.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || cm.escapeBusy) return;
    e.preventDefault(); e.stopPropagation();
    o.onExit?.();
  }, true);
  return {
    focus() { cm.focus(); if (!note) cm.setSelectionRange(cm.value.length); },
    destroy() { alive = false; const p = save(); cm.destroy(); return p; },
  };
}

FolioCanvas.init($('#view-canvas'), {
  onChange: () => canvasChanged(),
  renderMarkdown: (el, text, from) => { renderInto(el, text, from || S.cur, 1); for (const cb of $$('input[type=checkbox]', el)) cb.disabled = false; },
  renderFile: (el, p, sub) => renderCanvasFile(el, p, sub),
  fileVersion: p => `${S.files.get(p)?.mtime}|${S.notes.get(p)?.mtime}`,
  fileName: p => displayName(p),
  openFile: (p, sub) => S.files.has(p) ? openPath(p, { heading: sub ? sub.replace(/^#/, '') : undefined }) : toast(`Not found: ${p}`),
  openUrl: url => { if (/^(https?:|mailto:)/i.test(url || '')) window.open(url, '_blank', 'noopener'); },
  pickFile: kind => {
    const files = [...S.files.keys()].filter(p => kind === 'note' ? isMd(p) && !isDrawing(p) : !isMd(p) || isDrawing(p));
    return picker({ placeholder: kind === 'note' ? 'Add a note to the canvas…' : 'Add an image or file to the canvas…', items: q => rank(files, q, displayName).map(p => ({ main: displayName(p), sub: dirname(p), value: p })) });
  },
  importFile: async f => {
    const path = uniquePath(cfg.attachFolder, f.name || `Pasted image ${Date.now()}.png`);
    try { await writeFile(path, f); } catch (e) { toast('Import failed: ' + e.message); return null; }
    if (cfg.attachFolder) S.dirs.add(cfg.attachFolder);
    reindexAll(); renderTree();
    return path;
  },
  fileExists: p => S.files.has(p),
  mountEditor: (host, o) => mountCardEditor(host, o),
  viewImage: (p, all) => viewImages(p, all.map(q => ({ src: rawUrl(q), name: basename(q), path: q }))),
  createNoteFromText: async text => {
    const first = (text.split('\n').find(l => l.trim()) || 'Untitled').replace(/^#+\s*/, '').replace(/[\\/:*?"<>|#^[\]]/g, '').trim().slice(0, 60) || 'Untitled';
    const name = await promptModal('Convert card to note', 'Note name', first);
    if (!name) return null;
    if (BAD_NAME.test(name)) { toast('Names can’t contain \\ / : * ? " < > | # ^ [ ]'); return null; }
    const path = uniquePath(cfg.newNoteFolder, name + '.md');
    try { await writeFile(path, text); } catch (e) { toast('Could not create note: ' + e.message); return null; }
    reindexAll(); renderTree();
    return path;
  },
  prompt: (title, label, value) => promptModal(title, label, value),
  menu: (x, y, items) => menu(x, y, items),
  help: html => { const back = modal(html); back.addEventListener('mousedown', e => { if (e.target === back) back.remove(); }); back.tabIndex = -1; back.focus(); back.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === '?') back.remove(); }); },
  toast: msg => toast(msg),
  store: (k, v) => store(k, v),
  modalOpen: () => $('#modal-root').children.length > 0,
});

FolioDraw.init($('#view-drawing'), {
  onChange: () => drawingChanged(),
  openLink: link => openDrawingLink(link),
  menu: (x, y, items) => menu(x, y, items),
  prompt: (title, label, value) => promptModal(title, label, value),
  help: html => { const back = modal(html); back.addEventListener('mousedown', e => { if (e.target === back) back.remove(); }); back.tabIndex = -1; back.focus(); back.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === '?') back.remove(); }); },
  toast: msg => toast(msg),
  store: (k, v) => store(k, v),
  modalOpen: () => $('#modal-root').children.length > 0,
  exportFile: kind => exportDrawing(kind),
  copyPNG: onlySelected => copyDrawing('png', onlySelected),
  copySVG: onlySelected => copyDrawing('svg', onlySelected),
  fetchVaultImage: async p => {
    if (!IMG_EXT.test(p) || !S.files.has(p)) return null;
    const blob = await (await fetch(rawUrl(p))).blob();
    return new File([blob], basename(p), { type: blob.type });
  },
});

for (const id of ['g-local', 'g-depth', 'g-tags', 'g-unresolved', 'g-orphans', 'g-attach']) $('#' + id).addEventListener('input', () => FolioGraph.refresh(id === 'g-local' || id === 'g-depth'));
$('#g-filter').addEventListener('input', debounce(() => FolioGraph.refresh(), 200));

// ============================================================ commands & keys

const CMD = {
  'panel-files': () => showPanel('files'),
  'panel-search': () => showPanel('search'),
  'panel-tags': () => showPanel('tags'),
  'panel-props': () => showPanel('props'),
  switcher: openSwitcher,
  palette: openPalette,
  daily: openDaily,
  graph: () => openGraph(false),
  theme: toggleTheme,
  settings: openSettings,
  'new-note': () => newNote(),
  'new-drawing': () => newDrawing(),
  'new-canvas': () => newCanvas(),
  'new-base': () => newBase(),
  tasks: () => openTasks(),
  'new-folder': () => newFolder(''),
  'collapse-all': () => { S.expanded.clear(); store('expanded', []); renderTree(); },
  back: () => goHist(-1),
  forward: () => goHist(1),
  'toggle-mode': () => setMode(S.mode === 'edit' ? 'read' : 'edit'),
  'toggle-right': () => toggleSide('right'),
  'note-menu': () => {
    if (!S.cur) return;
    const r = $('[data-cmd=note-menu]').getBoundingClientRect();
    const drawing = S.view === 'drawing';
    menu(r.left - 150, r.bottom + 4, [
      ['Rename…', () => renameDialog(S.cur)],
      ['Move to…', () => moveDialog(S.cur)],
      ['Open local graph', () => openGraph(true)],
      ...(drawing ? [['Export as SVG', () => exportDrawing('svg')], ['Export as PNG', () => exportDrawing('png')]] : [['Insert template', () => insertTemplate()]]),
      ...(drawing && isMd(S.cur) ? [['Open as Markdown', () => openPath(S.cur, { raw: true })]] : []),
      ...(S.view === 'note' ? [['New drawing embedded here', () => newDrawingInNote()]] : []),
      ['Copy path', () => navigator.clipboard?.writeText(S.cur).then(() => toast('Copied'))],
      null,
      ['Delete', () => deletePath(S.cur), 'danger'],
    ]);
  },
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cmd]');
  if (b && CMD[b.dataset.cmd]) { e.preventDefault(); CMD[b.dataset.cmd](); }
});

window.addEventListener('keydown', onHotkey);


// ============================================================ layout: sidebar resizing

function makeResizer(handle, side) {
  const panel = $('#' + side);
  const saved = store('w-' + side); if (saved) panel.style.width = saved + 'px';
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const x0 = e.clientX, w0 = panel.getBoundingClientRect().width;
    handle.classList.add('drag');
    const mv = ev => {
      const w = Math.max(180, Math.min(600, w0 + (side === 'left' ? 1 : -1) * (ev.clientX - x0)));
      panel.style.width = w + 'px';
      if (S.view === 'graph') FolioGraph.resize();
    };
    const up = () => {
      handle.classList.remove('drag');
      store('w-' + side, parseInt(panel.style.width));
      removeEventListener('mousemove', mv); removeEventListener('mouseup', up);
    };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
}

// ============================================================ boot

const WELCOME = `Folio is a local notes app. Your notes are plain Markdown files in this folder, so the same vault opens in Obsidian or any text editor.

## The basics
- Link notes with double brackets: [[Getting around]]. Clicking a link to a note that doesn't exist creates it.
- Tag with #hashtags, or with a \`tags:\` list in frontmatter.
- Paste or drag an image into a note to save it into \`attachments/\` and embed it.
- Sketch diagrams with the drawing tool (the shapes icon on the left). Embed one in a note with \`![[Drawing name.excalidraw]]\`.
- Markdown formatting renders as you type. Put the cursor on a line to see its raw syntax.
- **Ctrl+E** switches between editing and reading view.

## Getting around
| Keys | Does |
| --- | --- |
| Ctrl+O | Quick switcher (Shift+Enter creates) |
| Ctrl+P | Command palette |
| Ctrl+N | New note |
| Ctrl+Shift+F | Search all notes |
| Ctrl+G | Graph view |
| Alt+← / Alt+→ | Back / forward |
| Ctrl+Enter | Toggle a checkbox |
| Ctrl+/ | All keyboard shortcuts |
| Ctrl+Shift+E | File tree (arrows, Enter) |
| Ctrl+click | Follow a [[link]] while editing |

- [ ] Try ticking this box in reading view
- [ ] Make a daily note from the calendar icon

> [!tip] Nothing leaves this machine
> Folio only listens on 127.0.0.1 and has no plugin system, so it can't reach the network or run third-party code.
`;

async function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  $('#vault-name').textContent = VAULT;
  $('#vault-name').title = 'Switch vault';
  $('#vault-name').onclick = () => switchVault();
  const layout = store('layout');
  if (layout && !layout.left) document.body.classList.add('app-no-left');
  if (layout && !layout.right) document.body.classList.add('app-no-right');
  makeResizer($('#resize-left'), 'left');
  makeResizer($('#resize-right'), 'right');
  showPanel('files', true);
  try { await loadAll(); } catch (e) { document.body.innerHTML = `<p style="padding:2em">Couldn't reach the Folio server: ${esc(e.message)}. Is it still running?</p>`; return; }
  renderTree();
  setInterval(poll, 2000);
  updateTaskBadge();
  api('/api/info').then(i => { S.vaultPath = i.vault; }).catch(() => { });
  if (S.files.size === 0 && !store('welcomed')) {
    store('welcomed', true);
    await createNote('Welcome.md', WELCOME, { mode: 'read' });
    return;
  }
  await restoreTabs();
}

document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else poll(); });
// Native window: Rust asks us to flush edits before it closes.
window.__folioClose = async () => {
  window.ipc.postMessage('close-ack');
  flushDocViews();
  try { await save(); } catch { }
  if (S.dirty && !confirm('Folio couldn’t save your latest changes.\n\nClose anyway and lose them?')) {
    window.ipc.postMessage('close-cancel');
    return;
  }
  window.ipc.postMessage('close-ok');
};

window.addEventListener('beforeunload', e => {
  if (NATIVE || !S.dirty || !S.cur) return;
  let body, base;
  if (S.view === 'drawing' && S.drawing) { FolioDraw.flush(); body = drawingContent(S.drawing); base = S.drawing.mtime; }
  else if (S.view === 'canvas' && S.canvasDoc) { FolioCanvas.flush(); body = FolioCanvas.serializeCanvas(FolioCanvas.getData()); base = S.canvasDoc.mtime; }
  else if (S.view === 'base' && S.baseDoc) { body = S.baseDoc.text; base = S.baseDoc.mtime; }
  else if (S.view === 'note') { body = ed.value; base = S.notes.get(S.cur)?.mtime; }
  else return;
  fetch(`/api/file?path=${enc(S.cur)}`, { method: 'PUT', body, keepalive: true, headers: { 'X-Folio-Token': TOKEN, ...(base ? { 'X-Base-Mtime': String(base) } : {}) } });
});

boot();
