/* Cinder app — the Inbox: a sticky-note board for things you jot or capture away from here. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */

// Everything in the inbox folder (Settings; "Inbox" by default) is a sticky: notes show their
// text on a card tinted with its colour, photos and other files as tiles. Stickies sit in lanes:
// 📌 Pinned, New (where everything arriving lands) and lanes you name. The arrangement is kept in
// <inbox>/Inbox.canvas (ui/inboxboard.js), a JSON Canvas file Obsidian opens as the same board;
// it's only written when you arrange something, so arrivals don't touch it. Any selection, or a
// lane, can become one note (text as sections, photos embedded in the order they were taken), be
// appended to a note, filed to a folder or deleted. Typing at the top or dropping files adds to
// New. Below the board: photos elsewhere that no note uses yet.

const inboxDir = () => (cfg.inboxFolder || 'Inbox').replace(/^\/+|\/+$/g, '');
const inboxBoardPath = () => inboxDir() + '/Inbox.canvas';
const inboxSel = new Set();
let inboxFocus = null, inboxOrphansOpen = false;
// When something was made (its modified time, which sync keeps: a photo from Monday's trip that
// syncs on Wednesday still belongs to Monday), and when it arrived here (its creation time on this
// disk), which is what makes it "new".
const whenOf = p => { const f = S.files.get(p); return (f && (f.mtime || f.ctime)) || 0; };
const arrivedOf = p => { const f = S.files.get(p); return (f && Math.max(f.ctime || 0, f.mtime || 0)) || 0; };

function inboxItems() {
  const dir = inboxDir(), board = inboxBoardPath();
  return [...S.files.keys()].filter(p => p.startsWith(dir + '/') && p !== board).sort((a, b) => whenOf(b) - whenOf(a));
}
// Images in the vault (outside the inbox) that no note, canvas or drawing uses.
function orphanImages() {
  const used = new Set();
  for (const n of S.notes.values()) for (const t of n.out || []) if (t) used.add(t);
  for (const c of S.canvases.values()) for (const r of c.refs) used.add(r);
  const dir = inboxDir();
  return [...S.files.keys()].filter(p => IMG_EXT.test(p) && !used.has(p) && !p.startsWith(dir + '/')).sort((a, b) => whenOf(b) - whenOf(a));
}

// ------------------------------------------------------------ the board

// The board file's text, loaded when it changes on disk (meanwhile the last version read is used,
// and the board redraws once the new one is in).
let boardFile = { mtime: null, text: '' }, boardLoading = null;
const stickyMeta = p => ({ mtime: whenOf(p), kind: IMG_EXT.test(p) ? 'picture' : isMd(p) ? 'text' : 'file', length: S.notes.get(p)?.content.length || 0 });
function boardTextNow() {
  const p = inboxBoardPath(), f = S.files.get(p);
  if (!f) { boardFile = { mtime: null, text: '' }; return ''; }
  if (boardFile.mtime !== f.mtime && !boardLoading) {
    const want = f.mtime;
    boardLoading = fetch(rawUrl(p), { cache: 'no-store' }).then(r => r.ok ? r.text() : '').then(text => {
      boardFile = { mtime: want, text };
      boardLoading = null;
      if (S.files.get(p)?.mtime === want) refreshInboxSoon();
    }, () => { boardLoading = null; });
  }
  return boardFile.text;
}
const currentBoard = () => CinderInboxBoard.readBoard(boardTextNow(), inboxItems(), stickyMeta, inboxDir());

// Arrange the board: apply one change (see CinderInboxBoard.applyChange), save the file, redraw.
// Changes run one at a time; if the file changed elsewhere meanwhile, it's re-read and the change
// made again on top, so nothing done in another window is lost.
let boardChain = Promise.resolve();
function changeBoard(change) {
  boardChain = boardChain.then(async () => {
    const p = inboxBoardPath();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (boardLoading) await boardLoading;
      const board = currentBoard(), next = CinderInboxBoard.applyChange(board, change);
      if (next === board && !board.broken) return;
      const text = CinderInboxBoard.writeBoard(next, stickyMeta), existed = S.files.has(p);
      try {
        const r = await writeFile(p, text, existed ? S.files.get(p).mtime : undefined);
        boardFile = { mtime: r.mtime, text };
        indexCanvas(p, text, r.mtime);
        if (!existed) { S.dirs.add(inboxDir()); renderTree(); }
        break;
      } catch (e) {
        if (e.status !== 409 || attempt) { toast('Couldn’t save the board: ' + e.message); break; }
        const got = (await readMany([p]))[p];
        if (got) { S.files.set(p, { ...S.files.get(p), mtime: got.mtime }); boardFile = { mtime: got.mtime, text: got.content }; }
      }
    }
    renderInbox();
  });
  return boardChain;
}

function updateInboxBadge() {
  const b = $('[data-cmd=inbox] .rb-badge');
  if (!b) return;
  const n = currentBoard().lanes[1].stickies.length; // what's still to sort, not pinned reminders
  b.textContent = n > 99 ? '99+' : String(n);
  b.hidden = !n;
}

async function openInbox() {
  flushDocViews();
  await save();
  rememberPos();
  showView('inbox');
  setSaveState('');
  $('#crumbs').innerHTML = '<b>Inbox</b>';
  document.title = `Inbox — ${VAULT} — Cinder`;
  await stopStickyEdit();
  renderInbox();
  updateStatus();
  requestAnimationFrame(() => ($('#view-inbox .ib-card.focus') || $('#view-inbox .ib-capture input'))?.focus());
}
// Leaving the inbox marks everything in it as seen (the "new" outlines are for what came since).
const leaveInbox = () => { if (S.view !== 'inbox') store('inboxSeen', Date.now()); };

const timeLabel = t => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
// Today: the time. Before: the day ("Sep 25", with the year if it isn't this one).
const stickyTime = t => {
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return timeLabel(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
};

// Obsidian's canvas colours, named as the canvas view names them.
const STICKY_COLORS = [['1', 'Red'], ['2', 'Orange'], ['3', 'Yellow'], ['4', 'Green'], ['5', 'Cyan'], ['6', 'Purple']];
const PIN_ICON = '<svg viewBox="0 0 24 24"><path d="M9 3h6l-1 6 4 4v2H6v-2l4-4z"/><path d="M12 15v6"/></svg>';
function stickyHtml(s, lane, seen) {
  const p = s.path, sel = inboxSel.has(p), isNew = lane.kind === 'new' && arrivedOf(p) > seen, pinned = lane.kind === 'pinned';
  const preset = /^[1-6]$/.test(s.color || '') ? ` c-${s.color}` : '';
  const tint = s.color && !preset ? ` style="--sticky:${esc(s.color)}"` : '';
  let kind, body;
  if (IMG_EXT.test(p)) { kind = 'picture'; body = `<div class="ib-thumb"><img src="${rawUrl(p)}" alt="" loading="lazy" draggable="false"></div>`; }
  else if (isMd(p)) { kind = 'text'; body = '<div class="ib-text markdown"></div>'; }
  else { kind = 'file'; body = `<div class="ib-file"><span>${esc((p.split('.').pop() || '').toUpperCase())}</span></div>`; }
  return `<div class="ib-card ib-st is-${kind}${preset}${s.color ? ' tinted' : ''}${sel ? ' sel' : ''}${isNew ? ' new' : ''}${p === inboxFocus ? ' focus' : ''}" data-path="${esc(p)}" draggable="true" tabindex="${p === inboxFocus ? 0 : -1}" role="option" aria-selected="${sel}"${tint}>
    ${body}
    <div class="ib-meta"><span class="ib-name">${kind === 'text' ? '' : esc(displayName(p))}</span><span class="ib-time">${esc(stickyTime(whenOf(p)))}</span><div class="ib-tools"><button class="ib-pin${pinned ? ' on' : ''}" data-ib="pin" tabindex="-1" title="${pinned ? 'Unpin' : 'Pin'} (P)">${PIN_ICON}</button>${STICKY_COLORS.map(([c, name]) => `<button class="ib-dot c-${c}" data-ib="color" data-color="${c}" tabindex="-1" title="${name}"></button>`).join('')}<button class="ib-dot plain" data-ib="color" data-color="" tabindex="-1" title="Plain"></button><button class="ib-check" tabindex="-1" title="Select (Space)">${sel ? '✓' : ''}</button></div></div>
  </div>`;
}
const laneHtml = (lane, seen) => `<section class="ib-lane" data-lane="${esc(lane.id)}" data-kind="${lane.kind}">
  <header class="ib-lane-head"><span class="ib-lane-name">${lane.kind === 'pinned' ? '📌 ' : ''}${esc(lane.name)}</span><small class="ib-lane-n">${lane.stickies.length}</small>${lane.kind === 'pinned' ? '' : '<button class="ib-lane-menu" data-ib="lanemenu" title="Lane options">⋯</button>'}</header>
  <div class="ib-stack" role="listbox" aria-multiselectable="true" aria-label="${esc(lane.name)}">${lane.stickies.map(s => stickyHtml(s, lane, seen)).join('') || '<div class="ib-lane-empty">Drag stickies here</div>'}</div>
</section>`;

function renderInbox() {
  if (stickyEdit) { inboxRenderPending = true; return; } // don't pull the editor out from under the typing
  const box = $('#view-inbox');
  const items = inboxItems(), seen = store('inboxSeen') || 0, board = currentBoard();
  for (const p of [...inboxSel]) if (!S.files.has(p)) inboxSel.delete(p);
  const order = board.lanes.flatMap(l => l.stickies.map(s => s.path));
  if (inboxFocus && !S.files.has(inboxFocus)) inboxFocus = null;
  if (!inboxFocus && order.length) inboxFocus = order[0];
  const orphans = orphanImages();
  const fresh = items.filter(p => arrivedOf(p) > seen).length;
  const had = box.contains(document.activeElement) ? (document.activeElement.closest('.ib-card') ? 'card' : document.activeElement.matches('.ib-capture input') ? 'capture' : null) : null;
  const scroll = $('.ib-lanes', box)?.scrollLeft || 0, tops = new Map($$('.ib-lane', box).map(l => [l.dataset.lane, $('.ib-stack', l).scrollTop]));
  box.innerHTML = `<div class="inbox ib-board">
    <header class="ib-head">
      <div><h2>Inbox</h2><p>${items.length ? `${items.length} ${items.length === 1 ? 'sticky' : 'stickies'}${fresh ? ` · <b>${fresh} new</b>` : ''} in <code>${esc(inboxDir())}/</code>` : `Things you jot or capture away from here land in <code>${esc(inboxDir())}/</code>.`}</p></div>
      <form class="ib-capture"><input class="field" placeholder="Jot a thought… (Enter adds a sticky to New)" spellcheck="true"><span class="ib-hint">or drop photos and files here · ${esc(fmtKey('Mod-Shift-j'))} jots from anywhere</span></form>
    </header>
    ${board.broken ? `<p class="ib-broken">${esc(inboxBoardPath())} couldn’t be read, so everything is shown in New. It’ll be written afresh the next time you arrange the board (its version history keeps the old one).</p>` : ''}
    <div class="ib-bar"${inboxSel.size ? '' : ' hidden'}><b>${inboxSel.size} selected</b>
      <button class="btn primary" data-ib="combine">Make a note</button><button class="btn" data-ib="append">Add to a note…</button><button class="btn" data-ib="move">File to folder…</button><button class="btn" data-ib="delete">Delete</button><button class="btn ib-clear" data-ib="clear">Clear</button></div>
    <div class="ib-lanes">${board.lanes.map(l => laneHtml(l, seen)).join('')}<button class="ib-addlane" data-ib="addlane">+ Lane</button></div>
    ${orphans.length ? `<section class="ib-orphans${inboxOrphansOpen ? ' open' : ''}"><h3><button class="ib-fold" data-ib="orphans">${CHEV}Photos no note uses yet <small>${orphans.length}</small></button></h3>
      ${inboxOrphansOpen ? `<div class="ib-grid">${orphans.slice(0, 120).map(p => orphanCard(p)).join('')}</div>` : ''}</section>` : ''}
  </div>`;
  $('.ib-lanes', box).scrollLeft = scroll;
  for (const l of $$('.ib-lane', box)) $('.ib-stack', l).scrollTop = tops.get(l.dataset.lane) || 0;
  // Text stickies show their note rendered, faded out if it runs long.
  for (const el of $$('.ib-lane .ib-text', box)) {
    const p = el.closest('.ib-card').dataset.path, content = S.notes.get(p)?.content || '';
    if (!content.slice(S.notes.get(p)?.fmLen || 0).trim()) { el.innerHTML = '<span class="ib-empty">Empty note</span>'; continue; }
    renderInto(el, content, p, 1);
    if (el.scrollHeight > el.clientHeight + 2) el.classList.add('clipped');
  }
  if (had === 'card') box.querySelector('.ib-card.focus')?.focus({ preventScroll: true });
  else if (had === 'capture') box.querySelector('.ib-capture input').focus();
  updateInboxBadge();
}
// A photo elsewhere in the vault, below the board.
const orphanCard = p => `<div class="ib-card" data-path="${esc(p)}" tabindex="-1" role="option"><div class="ib-thumb"><img src="${rawUrl(p)}" alt="" loading="lazy" draggable="false"></div><div class="ib-meta"><span class="ib-name">${esc(displayName(p))}</span><span class="ib-time">${esc(stickyTime(whenOf(p)))}</span></div></div>`;
const refreshInboxSoon = debounce(() => { if (S.view === 'inbox') renderInbox(); else updateInboxBadge(); }, 150);

// Editing a text sticky right on the board, with the live-preview editor canvas cards use.
let stickyEdit = null, inboxRenderPending = false;
function startStickyEdit(p) {
  if (stickyEdit?.path === p) return;
  if (stickyEdit) { stopStickyEdit().then(() => startStickyEdit(p)); return; }
  const card = $(`#view-inbox .ib-lane .ib-card[data-path="${CSS.escape(p)}"]`), text = card && $('.ib-text', card);
  if (!text) return;
  const host = document.createElement('div');
  host.className = 'ib-edit';
  text.replaceWith(host);
  card.classList.add('editing'); card.draggable = false;
  const editor = mountCardEditor(host, { notePath: p, onExit: () => stopStickyEdit(true) });
  if (!editor) { card.classList.remove('editing'); return renderInbox(); }
  stickyEdit = { path: p, editor };
  inboxFocus = p;
  editor.focus();
}
async function stopStickyEdit(keepFocus = false) {
  if (!stickyEdit) return;
  const { path, editor } = stickyEdit;
  stickyEdit = null;
  await editor.destroy(); // saves what was typed
  inboxRenderPending = false;
  if (S.view === 'inbox') { renderInbox(); if (keepFocus) setInboxFocus(path); }
}
// A click anywhere else finishes editing.
document.addEventListener('mousedown', e => { if (stickyEdit && !e.target.closest?.('.ib-card.editing')) stopStickyEdit(); }, true);

function laneMenu(id, btn) {
  const board = currentBoard(), i = board.lanes.findIndex(l => l.id === id), lane = board.lanes[i];
  if (!lane) return;
  const r = btn.getBoundingClientRect(), n = lane.stickies.length;
  menu(r.left - 170, r.bottom + 4, [
    ['Make a note from this lane', () => inboxCombine(lane.stickies.map(s => s.path))],
    ...(lane.kind === 'lane' ? [null,
      ['Rename…', async () => { const name = await promptModal('Rename lane', 'Name', lane.name); if (name) changeBoard({ renameLane: id, name }); }],
      ...(i > 2 ? [['Move left', () => changeBoard({ moveLane: id, by: -1 })]] : []),
      ...(i < board.lanes.length - 1 ? [['Move right', () => changeBoard({ moveLane: id, by: 1 })]] : []),
      null,
      ['Delete lane', async () => {
        if (n && !await confirmModal(`Delete the lane “${lane.name}”?`, `Its ${n === 1 ? 'sticky goes' : n + ' stickies go'} back to New.`, { ok: 'Delete lane', danger: true })) return;
        changeBoard({ deleteLane: id });
      }, 'danger'],
    ] : []),
  ]);
}
// Ctrl+Shift+J from anywhere: jot a sticky into New without leaving what you're doing.
function jotSticky() {
  const back = modal(`<div class="form ib-jot"><h3>Jot a sticky</h3><textarea class="field" rows="4" spellcheck="true" placeholder="A thought, a reminder…"></textarea><div class="ib-hint">Enter adds it to the Inbox (New) · Shift+Enter for a new line · Esc cancels</div></div>`);
  const ta = $('textarea', back);
  ta.focus();
  const close = () => back.remove();
  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      const text = ta.value;
      close();
      if (text.trim()) inboxCapture(text).then(() => { if (S.view !== 'inbox') toast('Added to the Inbox'); });
    }
  });
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
}
const togglePin = p => { const l = CinderInboxBoard.laneOf(currentBoard(), p); if (l) changeBoard(l.kind === 'pinned' ? { unpin: p } : { pin: p }); };

// ------------------------------------------------------------ acting on items

const inboxCards = () => $$('#view-inbox .ib-card');
function setInboxFocus(p, scroll = true) {
  inboxFocus = p;
  for (const c of inboxCards()) { const on = c.dataset.path === p; c.classList.toggle('focus', on); c.tabIndex = on ? 0 : -1; if (on) { c.focus({ preventScroll: !scroll }); if (scroll) c.scrollIntoView({ block: 'nearest' }); } }
}
function toggleInboxSel(p, on) {
  if (on ?? !inboxSel.has(p)) inboxSel.add(p); else inboxSel.delete(p);
  renderInbox();
}
function openInboxItem(p) {
  if (IMG_EXT.test(p)) return viewImages(p, inboxItems().filter(q => IMG_EXT.test(q)).map(q => ({ src: rawUrl(q), name: basename(q), path: q })));
  openPath(p);
}
const inboxTargets = () => inboxSel.size ? [...inboxSel] : inboxFocus ? [inboxFocus] : [];

// The Markdown for some items: text notes as sections (their own frontmatter left out), photos
// and other files embedded, oldest first.
function inboxMarkdown(paths) {
  return paths.slice().sort((a, b) => whenOf(a) - whenOf(b)).map(p => {
    if (isMd(p)) {
      const text = (S.notes.get(p)?.content || '').replace(/^---[\s\S]*?\n---\s*/, '').trim();
      return `## ${noteName(p)}\n\n${text}`;
    }
    return `![[${linkNameFor(p, [...S.files.keys()])}]]`;
  }).join('\n\n') + '\n';
}

// Make one note from items (a day, or a selection).
async function inboxCombine(paths) {
  if (!paths.length) return;
  const first = new Date(Math.min(...paths.map(whenOf)));
  const photos = paths.filter(p => !isMd(p)), texts = paths.filter(isMd);
  const back = modal(`<form class="form ib-combine"><h3>Make a note from ${paths.length} item${paths.length === 1 ? '' : 's'}</h3>
    <label>Title<input class="field" name="t" spellcheck="false" value="${esc('Field notes ' + fmtDate(first, 'YYYY-MM-DD'))}"></label>
    <label>Folder<input class="field" name="f" list="ib-dirs" spellcheck="false" value="${esc(cfg.newNoteFolder || '')}" placeholder="(vault root)"></label>
    <datalist id="ib-dirs">${[...S.dirs].sort(collator.compare).map(d => `<option value="${esc(d)}">`).join('')}</datalist>
    ${photos.length ? `<label class="check"><input type="checkbox" name="m" checked> Move the ${photos.length} photo${photos.length === 1 ? '' : 's'} and file${photos.length === 1 ? '' : 's'} to <code>${esc(cfg.attachFolder || '/')}</code></label>` : ''}
    ${texts.length ? `<label class="check"><input type="checkbox" name="d" checked> Clear the ${texts.length} note${texts.length === 1 ? '' : 's'} from the inbox once ${texts.length === 1 ? 'it’s' : 'they’re'} in (to the vault's .trash)</label>` : ''}
    <div class="row"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Make the note</button></div></form>`);
  const f = $('form', back);
  f.elements.t.focus(); f.elements.t.select();
  const close = () => back.remove();
  $('[data-x]', back).onclick = close;
  back.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  f.onsubmit = async e => {
    e.preventDefault();
    const title = f.elements.t.value.trim() || 'Field notes';
    if (BAD_NAME.test(title)) return toast('Names can’t contain \\ / : * ? " < > | # ^ [ ]');
    const folder = normPath(f.elements.f.value.trim());
    const movePhotos = f.elements.m?.checked, dropTexts = f.elements.d?.checked;
    close();
    // Photos move first, so the note links to where they end up.
    const final = [];
    for (const p of paths.slice().sort((a, b) => whenOf(a) - whenOf(b))) {
      if (!isMd(p) && movePhotos && dirname(p) !== (cfg.attachFolder || '')) {
        const to = uniquePath(cfg.attachFolder || '', basename(p));
        await renamePath(p, to);
        final.push(S.files.has(to) ? to : p);
      } else final.push(p);
    }
    const body = inboxMarkdown(final);
    const path = uniquePath(folder, title + '.md');
    if (dropTexts) for (const p of texts) await deletePath(p, { confirm: false });
    inboxSel.clear();
    await createNote(path, body, { mode: 'edit' });
    toast(`Made “${noteName(path)}” from ${paths.length} item${paths.length === 1 ? '' : 's'}`);
  };
}

// Add items to the end of an existing note.
async function inboxAppend(paths) {
  if (!paths.length) return;
  const notes = [...S.notes.keys()].filter(p => !isDrawing(p) && !p.startsWith(inboxDir() + '/'));
  const target = await picker({ placeholder: `Add ${paths.length} item${paths.length === 1 ? '' : 's'} to the end of…`, items: q => rank(notes, q, noteName).map(p => ({ main: noteName(p), sub: dirname(p), value: p })) });
  if (!target) return;
  const texts = paths.filter(isMd);
  const add = inboxMarkdown(paths);
  const n = S.notes.get(target), cur = target === S.cur && S.view === 'note' ? ed.value : n.content;
  const next = cur.replace(/\s*$/, '') + '\n\n' + add;
  try {
    if (target === S.cur && S.view === 'note') ed.value = next;
    else await writeFile(target, next, n.mtime);
  } catch (e) { return toast('Couldn’t add to it: ' + e.message); }
  for (const p of texts) await deletePath(p, { confirm: false }); // their text is in the note now
  inboxSel.clear();
  reindexAll(); renderTree();
  toast(`Added to “${noteName(target)}”`);
}

async function inboxAct(what) {
  const paths = inboxTargets();
  if (what === 'clear') { inboxSel.clear(); return renderInbox(); }
  if (!paths.length) return;
  if (what === 'combine') return inboxCombine(paths);
  if (what === 'append') return inboxAppend(paths);
  if (what === 'move') { await moveManyDialog(paths); inboxSel.clear(); return renderInbox(); }
  if (what === 'delete') { await deleteMany(paths); inboxSel.clear(); return renderInbox(); }
}

// Quick capture: a note in the inbox named for the moment.
async function inboxCapture(text) {
  text = text.trim();
  if (!text) return;
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const path = uniquePath(inboxDir(), `${fmtDate(d, 'YYYY-MM-DD')} ${pad(d.getHours())}${pad(d.getMinutes())}.md`);
  try { await writeFile(path, text + '\n'); } catch (e) { return toast('Couldn’t add it: ' + e.message); }
  S.dirs.add(inboxDir());
  store('inboxSeen', Date.now());
  reindexAll(); renderTree();
  renderInbox();
  if (S.view === 'inbox') $('#view-inbox .ib-capture input')?.focus();
}

// ------------------------------------------------------------ events

$('#view-inbox').addEventListener('click', async e => {
  const act = e.target.closest('[data-ib]');
  const card = e.target.closest('.ib-card');
  if (act) {
    const a = act.dataset.ib, p = card?.dataset.path;
    if (a === 'orphans') { inboxOrphansOpen = !inboxOrphansOpen; return renderInbox(); }
    if (a === 'pin') return togglePin(p);
    if (a === 'color') return changeBoard({ color: p, value: act.dataset.color || null });
    if (a === 'lanemenu') return laneMenu(act.closest('.ib-lane').dataset.lane, act);
    if (a === 'addlane') { const name = await promptModal('New lane', 'Name', ''); if (name) changeBoard({ addLane: name }); return; }
    return inboxAct(a);
  }
  if (!card || card.classList.contains('editing')) return;
  const p = card.dataset.path;
  if (e.target.closest('.ib-check') || e.ctrlKey || e.metaKey) { setInboxFocus(p, false); return toggleInboxSel(p); }
  if (e.shiftKey && inboxFocus) {
    const all = inboxCards().map(c => c.dataset.path), a = all.indexOf(inboxFocus), b = all.indexOf(p);
    for (const q of all.slice(Math.min(a, b), Math.max(a, b) + 1)) inboxSel.add(q);
    inboxFocus = p;
    return renderInbox();
  }
  setInboxFocus(p, false);
  if (inboxSel.size) return toggleInboxSel(p); // while picking several, a click adds or removes
  if (card.classList.contains('is-text')) return startStickyEdit(p);
  openInboxItem(p);
});
// Double-click a text sticky: the note in a tab.
$('#view-inbox').addEventListener('dblclick', async e => {
  const card = e.target.closest('.ib-lane .ib-card.is-text');
  if (!card || e.target.closest('.ib-tools')) return;
  e.preventDefault();
  await stopStickyEdit();
  openPath(card.dataset.path);
});
$('#view-inbox').addEventListener('submit', e => {
  if (!e.target.matches('.ib-capture')) return;
  e.preventDefault();
  const inp = $('input', e.target);
  const v = inp.value;
  inp.value = '';
  inboxCapture(v);
});
// Arrows move between stickies (up/down in a lane, left/right to the nearest in the next lane),
// Enter edits a text sticky (or opens anything else), P pins, Space selects, Del deletes,
// C makes a note, A adds to a note, M files, Ctrl+A selects all, Esc clears.
$('#view-inbox').addEventListener('keydown', e => {
  if (e.target.closest?.('.ib-edit')) return; // typing in a sticky
  const card = e.target.closest?.('.ib-card');
  if (e.target.matches?.('.ib-capture input')) {
    if (e.key === 'ArrowDown' && inboxCards().length) { e.preventDefault(); setInboxFocus(inboxFocus || inboxCards()[0].dataset.path); }
    else if (e.key === 'Escape') { e.target.value = ''; }
    return;
  }
  if (!card) return;
  const k = e.key, p = card.dataset.path;
  const stack = card.closest('.ib-stack'), mates = stack ? [...stack.querySelectorAll('.ib-card')] : inboxCards(), i = mates.indexOf(card);
  const nextLane = dir => {
    const lanes = $$('#view-inbox .ib-lane'), at = lanes.indexOf(card.closest('.ib-lane'));
    const y = card.getBoundingClientRect().top;
    for (let j = at + dir; j >= 0 && j < lanes.length; j += dir) {
      const cs = [...lanes[j].querySelectorAll('.ib-card')];
      if (cs.length) return cs.reduce((a, b) => Math.abs(b.getBoundingClientRect().top - y) < Math.abs(a.getBoundingClientRect().top - y) ? b : a);
    }
    return null;
  };
  let done = true;
  if (k === 'ArrowDown') { if (mates[i + 1]) setInboxFocus(mates[i + 1].dataset.path); }
  else if (k === 'ArrowUp') { if (mates[i - 1]) setInboxFocus(mates[i - 1].dataset.path); else $('#view-inbox .ib-capture input').focus(); }
  else if (k === 'ArrowRight' || k === 'ArrowLeft') { const n = stack ? nextLane(k === 'ArrowRight' ? 1 : -1) : mates[i + (k === 'ArrowRight' ? 1 : -1)]; if (n) setInboxFocus(n.dataset.path); }
  else if (k === ' ') toggleInboxSel(p);
  else if (k === 'Enter') { if (card.classList.contains('is-text')) startStickyEdit(p); else openInboxItem(p); }
  else if (k === 'Delete') inboxAct('delete');
  else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') { for (const c of inboxCards()) inboxSel.add(c.dataset.path); renderInbox(); }
  else if (e.ctrlKey || e.metaKey || e.altKey) done = false;
  else if (k.toLowerCase() === 'p' && stack) togglePin(p);
  else if (k.toLowerCase() === 'c') inboxAct('combine');
  else if (k.toLowerCase() === 'a') inboxAct('append');
  else if (k.toLowerCase() === 'm') inboxAct('move');
  else if (k === 'Escape' && inboxSel.size) { inboxSel.clear(); renderInbox(); }
  else done = false;
  if (done) { e.preventDefault(); e.stopPropagation(); }
});

// Moving around the board: each lane scrolls on its own; the wheel anywhere else on the board
// (over a lane too short to scroll, or with Shift) scrolls it sideways, and dragging empty board pans it.
$('#view-inbox').addEventListener('wheel', e => {
  const lanes = e.target.closest?.('.ib-lanes'), stack = e.target.closest('.ib-stack');
  if (!lanes || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // trackpads scroll sideways themselves
  if (stack && !e.shiftKey && stack.scrollHeight > stack.clientHeight) return;
  e.preventDefault();
  lanes.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? lanes.clientWidth : 1);
}, { passive: false });
$('#view-inbox').addEventListener('pointerdown', e => {
  const lanes = e.target.closest?.('.ib-lanes');
  if (!lanes || e.button !== 0 || e.pointerType === 'touch' || e.target.closest('.ib-card, button, input, a, .ib-lane-empty')) return;
  e.preventDefault();
  const x0 = e.clientX, left0 = lanes.scrollLeft;
  lanes.setPointerCapture(e.pointerId); lanes.classList.add('panning');
  const move = ev => { lanes.scrollLeft = left0 - (ev.clientX - x0); };
  const up = () => { lanes.classList.remove('panning'); lanes.removeEventListener('pointermove', move); lanes.removeEventListener('pointerup', up); lanes.removeEventListener('pointercancel', up); };
  lanes.addEventListener('pointermove', move); lanes.addEventListener('pointerup', up); lanes.addEventListener('pointercancel', up);
});

// Dragging a sticky: within its lane to reorder, onto another lane to move it there. A placeholder
// shows where it will land. (Only drags that started on a sticky; files from outside are below.)
const STICKY_DRAG = 'application/x-cinder-sticky';
let dragSticky = null;
const dropMark = () => $('#view-inbox .ib-drop') || Object.assign(document.createElement('div'), { className: 'ib-drop' });
// Where in a lane's stack a drop at clientY lands: [the sticky it goes before (or null), index
// among the lane's other stickies].
function dropSpot(stackEl, y) {
  const others = [...stackEl.querySelectorAll('.ib-card')].filter(c => c.dataset.path !== dragSticky);
  const i = others.findIndex(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
  return i < 0 ? [null, others.length] : [others[i], i];
}
$('#view-inbox').addEventListener('dragstart', e => {
  const card = e.target.closest?.('.ib-lane .ib-card');
  if (!card || card.classList.contains('editing')) return;
  dragSticky = card.dataset.path;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(STICKY_DRAG, dragSticky);
  e.dataTransfer.setData('text/plain', displayName(dragSticky)); // WebKitGTK only tracks drags that carry text
  requestAnimationFrame(() => card.classList.add('dragging'));
});
$('#view-inbox').addEventListener('dragover', e => {
  const stackEl = dragSticky && e.target.closest?.('.ib-lane')?.querySelector('.ib-stack');
  if (!stackEl) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const [before] = dropSpot(stackEl, e.clientY), mark = dropMark();
  if (before) { if (mark.nextSibling !== before) stackEl.insertBefore(mark, before); } else if (stackEl.lastElementChild !== mark) stackEl.append(mark);
});
$('#view-inbox').addEventListener('drop', e => {
  const stackEl = dragSticky && e.target.closest?.('.ib-lane')?.querySelector('.ib-stack');
  if (!stackEl) return;
  e.preventDefault(); e.stopPropagation();
  const [, index] = dropSpot(stackEl, e.clientY), p = dragSticky;
  dragSticky = null;
  changeBoard({ move: p, to: stackEl.closest('.ib-lane').dataset.lane, index });
}, true);
$('#view-inbox').addEventListener('dragend', () => {
  if (!dragSticky && !$('#view-inbox .ib-drop')) return;
  dragSticky = null;
  $('#view-inbox .ib-drop')?.remove();
  $$('#view-inbox .ib-card.dragging').forEach(c => c.classList.remove('dragging'));
  renderInbox();
});

// Drop photos or files anywhere on the view: they go into the inbox (New).
$('#view-inbox').addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); $('#view-inbox').classList.add('dropping'); } });
$('#view-inbox').addEventListener('dragleave', e => { if (!e.relatedTarget || !$('#view-inbox').contains(e.relatedTarget)) $('#view-inbox').classList.remove('dropping'); });
$('#view-inbox').addEventListener('drop', async e => {
  $('#view-inbox').classList.remove('dropping');
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  for (const f of files) { try { await importFile(f, inboxDir()); } catch (err) { toast(`Couldn’t add ${f.name}: ${err.message}`); } }
  S.dirs.add(inboxDir());
  store('inboxSeen', Date.now());
  renderTree(); renderInbox();
});
