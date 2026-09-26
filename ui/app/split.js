/* Cinder app — the split pane: a second note beside the main one, to read or write in while
 * working in the other. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.)
 *
 * Notes open in their own editor and save as you type; the same note open in both panes stays
 * in step. Images, drawings, canvases and bases show as previews. Links followed from the split
 * pane open in the main one. */

const SPLIT = { path: null, handle: null, mode: 'edit' };
const SPLIT_ICONS = {
  swap: '<svg viewBox="0 0 24 24"><path d="M7 7h12l-3-3M17 17H5l3 3"/></svg>',
  main: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9 12h6M12 9l3 3-3 3"/></svg>',
  read: '<svg viewBox="0 0 24 24"><path d="M3 5.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H3zM21 5.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H21z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>',
};

function splitDom() {
  let el = $('#split');
  if (el) return el;
  el = document.createElement('section');
  el.id = 'split'; el.setAttribute('aria-label', 'Split pane');
  el.innerHTML = `<header class="split-head"><span class="split-title"></span>
    <button class="ib" data-split="mode"></button><button class="ib" data-split="swap" title="Swap the panes">${SPLIT_ICONS.swap}</button>
    <button class="ib" data-split="main" title="Open in the main pane">${SPLIT_ICONS.main}</button><button class="ib" data-split="close" title="Close the split pane">${SPLIT_ICONS.close}</button></header>
    <div class="split-body"></div>`;
  const handle = document.createElement('div');
  handle.className = 'resizer'; handle.id = 'resize-split';
  $('#main').after(handle, el);
  const w = store('w-split'); if (w) el.style.flex = `0 0 ${w}px`;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const x0 = e.clientX, w0 = el.getBoundingClientRect().width;
    handle.classList.add('drag');
    const mv = ev => { el.style.flex = `0 0 ${Math.max(260, Math.min(innerWidth - 420, w0 - (ev.clientX - x0)))}px`; if (S.view === 'graph') CinderGraph.resize(); };
    const up = () => { handle.classList.remove('drag'); store('w-split', Math.round(el.getBoundingClientRect().width)); removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-split]'); if (!b) return;
    const a = b.dataset.split;
    if (a === 'close') closeSplit();
    else if (a === 'main') { const p = SPLIT.path; closeSplit().then(() => openPath(p)); }
    else if (a === 'swap') swapSplit();
    else if (a === 'mode') { SPLIT.mode = SPLIT.mode === 'edit' ? 'read' : 'edit'; openSplit(SPLIT.path, { keepMode: true }); }
  });
  return el;
}

// Show `path` in the split pane (asking which note when none is given).
async function openSplit(path, { keepMode = false, focus = false } = {}) {
  if (!path) {
    const files = [...S.files.keys()];
    path = await picker({ placeholder: 'Open beside this one…', items: q => rank(files, q, displayName).map(p => ({ main: displayName(p), sub: dirname(p), value: p })) });
    if (!path) return;
    focus = true;
  }
  if (!S.files.has(path)) return toast('Not found: ' + path);
  if (!keepMode) SPLIT.mode = 'edit';
  await SPLIT.handle?.destroy?.();
  SPLIT.handle = null;
  const el = splitDom(), body = $('.split-body', el);
  el.hidden = false; $('#resize-split').hidden = false;
  document.body.classList.add('has-split');
  SPLIT.path = path;
  store('split', path);
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

async function closeSplit() {
  await SPLIT.handle?.destroy?.();
  SPLIT.handle = null; SPLIT.path = null;
  store('split', null);
  const el = $('#split');
  if (el) { el.hidden = true; $('#resize-split').hidden = true; }
  document.body.classList.remove('has-split');
  if (S.view === 'graph') CinderGraph.resize();
}

// Main ↔ split.
async function swapSplit() {
  const a = SPLIT.path, b = S.cur;
  if (!a) return;
  await save();
  if (b && S.files.has(b)) await openSplit(b); else await closeSplit();
  await openPath(a);
}

// Keep the split pane in step with edits made elsewhere to the same note.
function splitNoteChanged(path, text, mtime) {
  if (SPLIT.path !== path || !$('#split') || $('#split').hidden) return;
  if (SPLIT.handle?.reload) SPLIT.handle.reload(text, mtime);
  else if (SPLIT.mode === 'read') openSplit(path, { keepMode: true });
}
const splitFollowMain = debounce(() => { if (S.view === 'note' && S.cur === SPLIT.path) splitNoteChanged(S.cur, ed.value); }, 400);

// A renamed or deleted file.
function splitFileMoved(from, to) {
  if (!SPLIT.path) return;
  if (SPLIT.path === from || SPLIT.path.startsWith(from + '/')) {
    const p = to ? to + SPLIT.path.slice(from.length) : null;
    if (p && S.files.has(p)) openSplit(p, { keepMode: true }); else closeSplit();
  }
}
