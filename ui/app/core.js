/* Cinder — front end. Plain JS, no build step, no network beyond 127.0.0.1.
 * This is the first of the ui/app/*.js pieces; src/api.rs joins them, in order, into /app.js,
 * where they share one scope. This one: helpers, settings (cfg) and app state. */
'use strict';

// ============================================================ basics

/** The first element matching a selector (typed loosely: the app knows what its selectors find).
 * @param {string} s @param {ParentNode} [el] @returns {any} */
const $ = (s, el = document) => el.querySelector(s);
/** Every element matching a selector. @param {string} s @param {ParentNode} [el] @returns {any[]} */
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const TOKEN = $('meta[name=cinder-token]').content;
const VAULT = $('meta[name=cinder-vault]').content;
const NATIVE = $('meta[name=cinder-mode]').content === 'native';
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
  const k = `folio:${VAULT}:${key}`; // (the app's old name: kept so saved settings survive the rename)
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
  const r = await fetch(path, { ...opts, headers: { 'X-Cinder-Token': TOKEN, ...(opts.headers || {}) } });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch { }
    const e = /** @type {Error & {status?: number}} */ (new Error(msg)); e.status = r.status; throw e;
  }
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : r.text();
}

// A short message at the bottom of the window, optionally with a button (action: {label, run}).
function toast(msg, ms = 2600, action) {
  if (action) $$('.toast.has-action').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status');
  const span = document.createElement('span'); span.textContent = msg; t.append(span);
  if (action) {
    t.classList.add('has-action');
    const b = document.createElement('button'); b.textContent = action.label;
    b.onclick = () => { t.remove(); action.run(); };
    t.append(b);
  }
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// ============================================================ settings

const DEFAULTS = {
  newNoteFolder: '',
  dailyFolder: 'Daily',
  dailyFormat: 'YYYY-MM-DD',      // daily notes' names (moment.js format)
  weeklyFolder: '', weeklyFormat: 'GGGG-[W]WW', weeklyTemplate: '',   // '' folder = the daily notes folder
  monthlyFolder: '', monthlyFormat: 'YYYY-MM', monthlyTemplate: '',
  weekStart: 'monday',            // the calendar's first column
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
  focusMode: false,      // hide the side bars and dim all but the paragraph being written
  typewriter: false,     // keep the line being typed on in the middle of the window
  statusChars: false,    // the status bar counts characters rather than words
  folderTemplates: '',
  taskInbox: '',         // where quick-added tasks go ('' = today's daily note)
  taskDoneDate: true,    // add ✅ YYYY-MM-DD when a task is ticked
  drawingFormat: 'excalidraw',
  windowFrame: 'custom',  // desktop app: Cinder's own title bar, or the system's ('native'); lives in the app config
  properties: 'visible', // frontmatter as a Properties table, or 'source' for plain YAML
  mathSnippets: true,     // LaTeX Suite-style shortcuts while typing math
  autoReveal: true,       // opening a file expands its folders in the file tree and scrolls to it
  inboxFolder: 'Inbox',   // where things captured elsewhere arrive (the Inbox view)
  webEmbeds: 'auto',      // ![](https://…) pages: 'auto' load, 'click' to load, 'off' (show the link)
  hoverPreview: true,     // hover a link to preview the note (Ctrl in the editor; Ctrl for web pages)
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
  CinderThemes.apply(cfg.palette, t);
  applyFonts();
  document.body.classList.toggle('wide', !cfg.readable);
  document.body.classList.toggle('mono', cfg.mono);
  document.body.classList.toggle('source-mode', !cfg.livePreview);
  if (typeof ed !== 'undefined') { ed.setLive(cfg.livePreview); ed.setVim(cfg.vim); ed.setFocusMode(cfg.focusMode); ed.setTypewriter(cfg.typewriter); }
  document.body.classList.toggle('focus-mode', !!cfg.focusMode);
  if (window.CinderGraph) CinderGraph.restyle();
  if (window.CinderDraw) CinderDraw.restyle();
  if (typeof S !== 'undefined') { S.version++; refreshEditorSoon(); if (S.view === 'note' && S.mode === 'read') renderPreview(); }
  // The desktop window's own frame (when the system draws it) follows light / dark too.
  if (window.ipc && $('meta[name=cinder-mode]')?.content === 'native') window.ipc.postMessage('win:theme:' + t);
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
    toggleTaskLine: text => CinderTasks.parseLine(text) ? CinderTasks.toggle(text, { date: CinderTasks.today(), doneDate: cfg.taskDoneDate }) : null,
    renderMath: (el, tex, display) => renderMath(el, tex, display),
    templaterOptions: (kind, path) => templaterOptions(kind, path),
    mathSnippets: () => cfg.mathSnippets,
    renderWebEmbed: (el, url, alt) => cfg.webEmbeds === 'off' ? (el.innerHTML = `<a class="cm-url" data-url="${esc(url)}">${esc(url)}</a>`) : renderWebEmbed(el, url, alt),
    sizeWebEmbed: (el, alt) => sizeWebEmbed(el, alt),
    propertiesFor: text => cfg.properties !== 'source' && propsOf(text) != null,
    renderProperties: (el, text, ctl) => mountProps(el, text, { ...ctl, from }),
    ...extra,
  };
}

const ed = CinderEditor.create($('#editor'), editorHooks(() => S.cur, {
  onChange: () => markDirty(),
  onCursor: () => cursorMoved(),
  onFiles: (files, pasted) => { (async () => { for (const f of files) await attachAndLink(f, pasted); })(); },
  focusTitle: () => { titleEl.focus(); titleEl.setSelectionRange(titleEl.value.length, titleEl.value.length); },
}), { vim: cfg.vim, focus: cfg.focusMode, typewriter: cfg.typewriter });
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
const titleEl = $('#title');
const preview = $('#preview');

