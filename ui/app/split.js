/* Cinder app — the split pane: the current tab's partner, beside its main note. (One of the
 * ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.)
 *
 * A tab can hold a second file (its `split`, see tab-groups.js); this pane shows the current
 * tab's. Notes open in their own editor and save as you type; the same note open in both panes
 * stays in step. Images, drawings, canvases and bases show as previews. Links followed from the
 * split pane open in the main one. */

const SPLIT = { path: null, handle: null, mode: 'edit', seq: 0 };
const SPLIT_ICONS = {
  read: '<svg viewBox="0 0 24 24"><path d="M3 5.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H3zM21 5.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H21z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>',
};

// Can the split pane show this file? Notes, images, drawings, canvases and bases.
const canSplit = p => !!p && S.files.has(p) && ((isMd(p) && !isDrawing(p) && S.notes.has(p)) || IMG_EXT.test(p) || visualEmbed(p));

function splitDom() {
  let el = $('#split');
  if (el) return el;
  el = document.createElement('section');
  el.id = 'split'; el.setAttribute('aria-label', 'Split pane');
  el.innerHTML = `<header class="split-head"><span class="split-title"></span>
    <button class="ib" data-split="mode"></button><button class="ib" data-split="close" title="Close this note">${SPLIT_ICONS.close}</button></header>
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
    else if (a === 'mode') { const t = curTab(); if (t) { t.splitMode = t.splitMode === 'read' ? 'edit' : 'read'; showSplit(); } }
  });
  return el;
}

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

// Keep the split pane in step with edits made elsewhere to the same note.
function splitNoteChanged(path, text, mtime) {
  if (SPLIT.path !== path || !$('#split') || $('#split').hidden) return;
  if (SPLIT.handle?.reload) SPLIT.handle.reload(text, mtime);
  else if (SPLIT.mode === 'read') showSplit();
}
const splitFollowMain = debounce(() => { if (S.view === 'note' && S.cur === SPLIT.path) splitNoteChanged(S.cur, ed.value); }, 400);

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
