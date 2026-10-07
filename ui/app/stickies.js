/* Cinder app — the sticky layout: Cinder in a thin window as a sticky-notes app, as OneNote's Sticky Notes is. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */

// Below STICKY_WIDTH (and with Settings → Editor → "Sticky layout in a thin window" on), the window
// becomes a list of the Inbox's stickies: + New, a search, and the stickies stacked in the board's
// order (📌 Pinned, New, then the lanes). A sticky opens to fill the window, in its colour, with a
// small formatting bar. They're the Inbox's own stickies (files in the inbox folder, arranged in its
// Inbox.canvas), so the board shows the same ones. Notes found with Ctrl+O open full width, with
// ← Stickies to come back. Widening the window brings back the full layout and what was open.

const STICKY_WIDTH = 560;
let stickyBefore = null;   // what was open when the sticky layout came on, to go back to
let stickyOpen = null;     // { path, editor } while a sticky fills the window
let stickySearch = '', stickyFocus = null;
const stickySel = new Set();   // stickies picked in the list, to pin, colour or delete together
let stickySelMode = false, stickyAnchor = null;

const stickyLayoutOn = () => document.body.classList.contains('sticky-layout');
const stickyWanted = () => cfg.stickyLayout !== false && innerWidth < STICKY_WIDTH;

// Turn the sticky layout on or off to fit the window.
async function applyStickyLayout() {
  const on = stickyWanted();
  if (on === stickyLayoutOn()) return;
  document.body.classList.toggle('sticky-layout', on);
  if (on) {
    stickyBefore = { view: S.view, path: S.cur };
    await openStickies();
  } else {
    await closeSticky();
    const b = stickyBefore;
    stickyBefore = null;
    if (S.view === 'stickies') {
      if (b?.path && S.files.has(b.path) && b.view !== 'inbox') await openPath(b.path);
      else if (b?.view === 'inbox') await openInbox();
      else if (S.cur && S.files.has(S.cur)) await openPath(S.cur);
      else showEmpty();
    }
  }
  fitSides();
  updateStatus();
}
addEventListener('resize', debounce(() => applyStickyLayout(), 80));

async function openStickies() {
  flushDocViews();
  await save();
  rememberPos();
  await stopStickyEdit(); // a sticky being edited on the board
  showView('stickies');
  setSaveState('');
  $('#crumbs').innerHTML = '<b>Stickies</b>';
  document.title = `Stickies — ${VAULT} — Cinder`;
  renderStickies();
  updateStatus();
  // The list takes the keys (↓ goes to the first sticky) without a sticky looking selected.
  requestAnimationFrame(() => $('#view-stickies .sk-cards')?.focus({ preventScroll: true }));
}

// The stickies the list shows, in the board's order: [{ lane, stickies: [{ path, color }] }]
function stickySections() {
  const q = stickySearch.trim().toLowerCase();
  const hit = p => !q || noteName(p).toLowerCase().includes(q) || (S.notes.get(p)?.content || '').toLowerCase().includes(q);
  return currentBoard().lanes.map(lane => ({ lane, stickies: lane.stickies.filter(s => hit(s.path)) })).filter(x => x.stickies.length);
}
const stickyColorClass = c => /^[1-6]$/.test(c || '') ? ` c-${c}` : '';
const stickyTint = c => c && !/^[1-6]$/.test(c) ? ` style="--sticky:${esc(c)}"` : '';
const stickyPinned = () => new Set(currentBoard().lanes[0].stickies.map(s => s.path));

// Picking stickies in the list, without opening them: the ✓ on a card, Ctrl-click, Shift-click
// for a run, Space, a long press on a touch screen, or "Select" in ⋯. While picking, a click
// picks too, and the header becomes a bar to pin, colour or delete them all.
const stickySelecting = () => stickySelMode || stickySel.size > 0;
const listedStickies = () => $$('#view-stickies .sk-card').map(c => c.dataset.path);
const pickedStickies = () => listedStickies().filter(p => stickySel.has(p));
function syncStickySel() {
  const list = $('#view-stickies .sk-list');
  if (!list) return;
  for (const c of $$('.sk-card', list)) { const on = stickySel.has(c.dataset.path); c.classList.toggle('sel', on); c.setAttribute('aria-selected', String(on)); }
  list.classList.toggle('selecting', stickySelecting());
  $('.sk-head', list).outerHTML = stickyHeadHtml();
}
function pickSticky(p, how = 'toggle') {
  const listed = listedStickies(), a = listed.indexOf(stickyAnchor), b = listed.indexOf(p);
  if (how === 'range' && a >= 0 && b >= 0) for (const x of listed.slice(Math.min(a, b), Math.max(a, b) + 1)) stickySel.add(x);
  else { if (stickySel.has(p) && how !== 'add') stickySel.delete(p); else stickySel.add(p); stickyAnchor = p; }
  syncStickySel();
}
function stopPicking() {
  stickySel.clear(); stickySelMode = false; stickyAnchor = null;
  syncStickySel();
}

// To .trash, after asking; the key focus goes on to the sticky after them.
async function deleteStickies(paths) {
  paths = paths.filter(p => S.files.has(p));
  if (!paths.length) return;
  const one = paths.length === 1;
  if (!(await confirmModal(one ? 'Delete this sticky?' : `Delete ${paths.length} stickies?`, `${one ? 'It goes' : 'They go'} to the vault’s .trash folder.`, { ok: 'Delete', danger: true }))) return;
  const listed = listedStickies(), rest = listed.filter(p => !paths.includes(p));
  const next = listed.slice(listed.indexOf(paths[paths.length - 1]) + 1).find(p => rest.includes(p)) || rest[rest.length - 1];
  for (const p of paths) { await deletePath(p, { confirm: false }); stickySel.delete(p); }
  if (!stickySel.size) stickySelMode = false;
  renderStickies();
  if (next) focusStickyCard(next); else $('#view-stickies .sk-cards')?.focus();
}
// Pin them all (keeping their order), or unpin them if they all are.
async function pinStickies(paths) {
  const pinned = stickyPinned(), un = paths.every(p => pinned.has(p));
  for (const p of [...paths].reverse()) await changeBoard(un ? { unpin: p } : { pin: p });
}
function stickyColorMenu(x, y, paths) {
  const set = c => { for (const p of paths) changeBoard({ color: p, value: c }); };
  menu(x, y, [...STICKY_COLORS.map(([c, name]) => [name, () => set(c)]), ['Plain', () => set(null)]]);
}

const TRASH_ICON = '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9"/></svg>';

function stickyHeadHtml() {
  if (stickySelecting()) {
    const n = stickySel.size, pinned = stickyPinned(), un = n > 0 && [...stickySel].every(p => pinned.has(p)), off = n ? '' : ' disabled';
    return `<header class="sk-head sk-selbar">
      <button class="sk-btn" data-sk="unselect" title="Done (Esc)" aria-label="Done selecting"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <b class="sk-count">${n ? `${n} selected` : 'Select stickies'}</b><span class="sk-grow"></span>
      <button class="sk-btn sk-all" data-sk="sel-all" title="Select all (${esc(fmtKey('Mod-a'))})" aria-label="Select all">All</button>
      <button class="sk-btn${un ? ' on' : ''}" data-sk="sel-pin" title="${un ? 'Unpin' : 'Pin to the top'}" aria-label="${un ? 'Unpin' : 'Pin'}"${off}>${PIN_ICON}</button>
      <button class="sk-btn" data-sk="sel-color" title="Colour" aria-label="Colour"${off}><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/><path d="M12 4.5v15" /></svg></button>
      <button class="sk-btn sk-danger" data-sk="sel-delete" title="Delete (Del)" aria-label="Delete"${off}>${TRASH_ICON}</button>
    </header>`;
  }
  return `<header class="sk-head">
      <button class="sk-btn sk-new" data-sk="new" title="New sticky (${esc(fmtKey('Mod-n'))})" aria-label="New sticky"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      <input class="field sk-search" type="search" placeholder="Search stickies" value="${esc(stickySearch)}" spellcheck="false" aria-label="Search stickies">
      ${NATIVE ? `<button class="sk-btn sk-ontop${cfg.keepOnTop ? ' on' : ''}" data-sk="ontop" title="${cfg.keepOnTop ? 'Stop keeping the window on top' : 'Keep the window on top of others'}" aria-pressed="${!!cfg.keepOnTop}" aria-label="Keep on top">${PIN_ICON}</button>` : ''}
      <button class="sk-btn" data-sk="menu" title="More" aria-label="More"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></button>
    </header>`;
}

function renderStickies() {
  const box = $('#view-stickies');
  if (stickyOpen) return; // the open sticky has the window; the list redraws on the way back
  for (const p of [...stickySel]) if (!S.files.has(p)) stickySel.delete(p);
  const sections = stickySections(), total = inboxItems().length;
  const act = box.contains(document.activeElement) ? document.activeElement : null;
  const searching = act?.matches('.sk-search'), focusedCard = act?.closest('.sk-card')?.dataset.path, onList = act?.matches('.sk-cards');
  const top = $('.sk-cards', box)?.scrollTop || 0;
  box.innerHTML = `<div class="sk-list${stickySelecting() ? ' selecting' : ''}">
    ${stickyHeadHtml()}
    <div class="sk-cards" role="listbox" aria-label="Stickies" aria-multiselectable="true" tabindex="-1">${sections.map(({ lane, stickies }) =>
      `<section class="sk-lane" data-lane="${esc(lane.id)}">${lane.kind === 'new' && sections.length === 1 ? '' : `<h3 class="sk-sec">${lane.kind === 'pinned' ? '📌 ' : ''}${esc(lane.name)}</h3>`}${stickies.map(s => stickyCardHtml(s)).join('')}</section>`).join('')
      || `<div class="sk-none">${total ? 'No stickies match.' : `No stickies yet. <b>+</b> makes one; they live in <code>${esc(inboxDir())}/</code>.`}</div>`}</div>
    <div class="sk-trash" aria-hidden="true">${TRASH_ICON}Drop here to delete</div>
  </div>`;
  // Text stickies show their note rendered, faded out where it runs long.
  for (const el of $$('.sk-card .sk-text', box)) {
    const p = el.closest('.sk-card').dataset.path, n = S.notes.get(p);
    if (!n || !n.content.slice(n.fmLen).trim()) { el.innerHTML = '<span class="sk-empty">Empty sticky</span>'; continue; }
    renderInto(el, n.content, p, 1);
    if (el.scrollHeight > el.clientHeight + 2) el.classList.add('clipped');
  }
  // Redrawing keeps the place in the list, and the key focus where it was.
  const cardsEl = $('.sk-cards', box);
  cardsEl.scrollTop = top;
  if (searching) { const i = $('.sk-search', box); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  else if (focusedCard && $$('.sk-card', box).some(c => c.dataset.path === focusedCard)) focusStickyCard(focusedCard, false);
  else if (focusedCard || onList) cardsEl.focus({ preventScroll: true });
}
function stickyCardHtml(s) {
  const p = s.path, sel = stickySel.has(p);
  let body;
  if (IMG_EXT.test(p)) body = `<div class="sk-thumb"><img src="${rawUrl(p)}" alt="" loading="lazy" draggable="false"></div>`;
  else if (isMd(p)) body = '<div class="sk-text markdown"></div>';
  else body = `<div class="sk-file">${esc(displayName(p))}</div>`;
  return `<div class="sk-card${stickyColorClass(s.color)}${s.color ? ' tinted' : ''}${sel ? ' sel' : ''}" data-path="${esc(p)}" role="option" aria-selected="${sel}" draggable="true" tabindex="${p === stickyFocus ? 0 : -1}"${stickyTint(s.color)}>
    ${body}<div class="sk-time">${esc(stickyTime(whenOf(p)))}</div>
    <div class="sk-card-tools"><button class="sk-mini sk-danger" data-sk="card-delete" tabindex="-1" title="Delete" aria-label="Delete">${TRASH_ICON}</button><button class="sk-mini sk-check" data-sk="check" tabindex="-1" title="Select (Space)" aria-label="Select">${CHECK_ICON}</button></div></div>`;
}
function focusStickyCard(p = stickyFocus, scroll = true) {
  const cards = $$('#view-stickies .sk-card');
  const c = cards.find(x => x.dataset.path === p) || cards[0];
  if (!c) return $('#view-stickies .sk-search')?.focus();
  stickyFocus = c.dataset.path;
  for (const x of cards) x.tabIndex = x === c ? 0 : -1;
  c.focus({ preventScroll: true });
  if (scroll) c.scrollIntoView({ block: 'nearest' });
}

// A new, empty sticky, opened to write in. (One left empty goes again when it's closed.)
async function newSticky() {
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const path = uniquePath(inboxDir(), `${fmtDate(d, 'YYYY-MM-DD')} ${pad(d.getHours())}${pad(d.getMinutes())}.md`);
  try { await writeFile(path, ''); } catch (e) { return toast('Couldn’t make a sticky: ' + e.message); }
  S.dirs.add(inboxDir());
  store('inboxSeen', Date.now());
  reindexAll(); renderTree();
  await openSticky(path);
}

// A sticky filling the window: its colour as the header (back, colours, pin, delete), the note in
// the live-preview editor, and a formatting bar.
async function openSticky(p) {
  if (S.view !== 'stickies') await openStickies();
  await closeSticky(false);
  if (!isMd(p)) return openPath(p); // a photo or a file opens as itself
  const s = currentBoard().lanes.flatMap(l => l.stickies.map(x => ({ ...x, pinned: l.kind === 'pinned' }))).find(x => x.path === p) || { path: p, color: null, pinned: false };
  const box = $('#view-stickies');
  box.innerHTML = `<div class="sk-page${stickyColorClass(s.color)}${s.color ? ' tinted' : ''}"${stickyTint(s.color)} data-path="${esc(p)}">
    <header class="sk-page-head">
      <button class="sk-btn" data-sk="back" title="Back to the stickies (Esc)" aria-label="Back to the stickies"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button>
      <span class="sk-grow"></span>
      <span class="sk-colors">${STICKY_COLORS.map(([c, name]) => `<button class="ib-dot c-${c}${s.color === c ? ' on' : ''}" data-sk="color" data-color="${c}" title="${name}" aria-label="${name}"></button>`).join('')}<button class="ib-dot plain${s.color ? '' : ' on'}" data-sk="color" data-color="" title="Plain" aria-label="Plain"></button></span>
      <button class="sk-btn${s.pinned ? ' on' : ''}" data-sk="pin" title="${s.pinned ? 'Unpin' : 'Pin to the top'}" aria-pressed="${s.pinned}" aria-label="Pin">${PIN_ICON}</button>
      <button class="sk-btn" data-sk="delete" title="Delete sticky" aria-label="Delete sticky"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg></button>
    </header>
    <div class="sk-page-body markdown"></div>
    <footer class="sk-tools" aria-label="Formatting">
      <button class="sk-btn" data-sk="fmt" data-cmd="bold" title="Bold (${esc(fmtKey('Mod-b'))})" aria-label="Bold"><b>B</b></button>
      <button class="sk-btn" data-sk="fmt" data-cmd="italic" title="Italic (${esc(fmtKey('Mod-i'))})" aria-label="Italic"><i>I</i></button>
      <button class="sk-btn" data-sk="fmt" data-cmd="strikethrough" title="Strikethrough" aria-label="Strikethrough"><s>S</s></button>
      <button class="sk-btn" data-sk="fmt" data-cmd="bullet-list" title="Bullet list" aria-label="Bullet list"><svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg></button>
      <button class="sk-btn" data-sk="fmt" data-cmd="task-list" title="Checklist" aria-label="Checklist"><svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="6" height="6" rx="1"/><path d="m5 7.5 1.2 1.2L8.5 6.3M13 7.5h7.5M3.5 16.5h6M13 16.5h7.5"/></svg></button>
      <button class="sk-btn" data-sk="image" title="Add a picture" aria-label="Add a picture"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 3.5 3 3-2.5L20 17"/></svg></button>
      <span class="sk-grow"></span>
      <span class="sk-when">${esc(stickyTime(whenOf(p)))}</span>
    </footer>
  </div>`;
  const editor = mountCardEditor($('.sk-page-body', box), { notePath: p, onExit: () => closeSticky() });
  if (!editor) return renderStickies();
  stickyOpen = { path: p, editor };
  stickyFocus = p;
  editor.focus();
  document.title = `${noteName(p)} — Stickies — Cinder`;
}

// Back to the list (saving what was typed; a sticky still empty goes to .trash).
async function closeSticky(redraw = true) {
  if (!stickyOpen) return;
  const { path, editor } = stickyOpen;
  stickyOpen = null;
  await editor.destroy();
  const n = S.notes.get(path);
  if (n && !n.content.trim()) await deletePath(path, { confirm: false });
  if (redraw && S.view === 'stickies') { renderStickies(); document.title = `Stickies — ${VAULT} — Cinder`; requestAnimationFrame(() => focusStickyCard(S.files.has(path) ? path : null)); }
}

function setKeepOnTop(on) {
  cfg.keepOnTop = !!on; saveCfg();
  winCmd('ontop:' + (cfg.keepOnTop ? 'on' : 'off'));
  if (S.view === 'stickies' && !stickyOpen) renderStickies();
  toast(cfg.keepOnTop ? 'Cinder stays on top of other windows' : 'Cinder no longer stays on top');
}

$('#view-stickies').addEventListener('click', async e => {
  const b = e.target.closest('[data-sk]'), card = e.target.closest('.sk-card');
  if (skLongPressed) { skLongPressed = false; return; } // (the long press picked it)
  if (!b && card && !e.target.closest('a')) {
    const cp = card.dataset.path;
    if (e.shiftKey) { focusStickyCard(cp, false); return pickSticky(cp, 'range'); }
    if (e.ctrlKey || e.metaKey || stickySelecting()) { focusStickyCard(cp, false); return pickSticky(cp); }
    return openSticky(cp);
  }
  if (!b) return;
  const what = b.dataset.sk, p = stickyOpen?.path;
  if (what === 'check') { const cp = card.dataset.path; focusStickyCard(cp, false); return pickSticky(cp, e.shiftKey ? 'range' : 'toggle'); }
  if (what === 'card-delete') return deleteStickies([card.dataset.path]);
  if (what === 'unselect') { stopPicking(); return $('#view-stickies .sk-cards')?.focus(); }
  if (what === 'sel-all') { for (const x of listedStickies()) stickySel.add(x); return syncStickySel(); }
  if (what === 'sel-delete') return deleteStickies(pickedStickies());
  if (what === 'sel-pin') { const ps = pickedStickies(); stopPicking(); return pinStickies(ps); }
  if (what === 'sel-color') { const r = b.getBoundingClientRect(); return stickyColorMenu(r.left, r.bottom, pickedStickies()); }
  if (what === 'new') return newSticky();
  if (what === 'back') return closeSticky();
  if (what === 'ontop') return setKeepOnTop(!cfg.keepOnTop);
  if (what === 'menu') {
    const r = b.getBoundingClientRect();
    return menu(r.left, r.bottom, [
      ['New sticky', () => newSticky()],
      ['Select stickies', () => { stickySelMode = true; syncStickySel(); }],
      ...(NATIVE ? [[cfg.keepOnTop ? 'Stop keeping on top' : 'Keep on top of other windows', () => setKeepOnTop(!cfg.keepOnTop)]] : []),
      ['Open the inbox board', () => openInbox()],
      ['Find a note…', () => openSwitcher()],
      ['Settings', () => openSettings()],
    ]);
  }
  if (!p) return;
  if (what === 'fmt') { stickyOpen.editor.cm.run(b.dataset.cmd); return; }
  if (what === 'color') {
    await changeBoard({ color: p, value: b.dataset.color || null });
    const page = $('#view-stickies .sk-page'), c = b.dataset.color;
    page.className = `sk-page${stickyColorClass(c)}${c ? ' tinted' : ''}`;
    for (const d of $$('.sk-colors .ib-dot', page)) d.classList.toggle('on', d === b);
    return;
  }
  if (what === 'pin') {
    const was = b.classList.contains('on');
    await changeBoard(was ? { unpin: p } : { pin: p });
    b.classList.toggle('on', !was); b.setAttribute('aria-pressed', String(!was)); b.title = was ? 'Pin to the top' : 'Unpin';
    return;
  }
  if (what === 'delete') {
    if (!(await confirmModal('Delete this sticky?', 'It goes to the vault’s .trash folder.', { ok: 'Delete', danger: true }))) return;
    const { editor } = stickyOpen;
    stickyOpen = null;
    await editor.destroy();
    await deletePath(p, { confirm: false });
    renderStickies(); focusStickyCard();
    return;
  }
  if (what === 'image') {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true });
    inp.onchange = async () => { for (const f of inp.files) await attachAndLink(f, false, stickyOpen.editor.cm); stickyOpen?.editor.focus(); };
    inp.click();
  }
});
$('#view-stickies').addEventListener('input', debounce(e => {
  if (!e.target.matches('.sk-search')) return;
  stickySearch = e.target.value;
  renderStickies();
}, 120));
$('#view-stickies').addEventListener('keydown', e => {
  if (stickyOpen) {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); closeSticky(); }
    return;
  }
  const card = e.target.closest('.sk-card'), cards = $$('#view-stickies .sk-card');
  if (e.key === 'Escape' && stickySelecting() && !e.target.matches('.sk-search')) { e.preventDefault(); stopPicking(); $('#view-stickies .sk-cards')?.focus(); return; }
  if (e.target.matches('.sk-search')) {
    if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); focusStickyCard(cards[0]?.dataset.path); }
    else if (e.key === 'Escape' && stickySearch) { e.preventDefault(); stickySearch = ''; renderStickies(); }
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'a' && (card || e.target.matches('.sk-cards'))) { e.preventDefault(); for (const x of listedStickies()) stickySel.add(x); return syncStickySel(); }
  if (!card) {
    if (e.target.matches('.sk-cards') && e.key === 'ArrowDown') { e.preventDefault(); focusStickyCard(cards[0]?.dataset.path); }
    if (e.target.matches('.sk-cards') && (e.key === 'Delete' || e.key === 'Backspace') && stickySel.size) { e.preventDefault(); deleteStickies(pickedStickies()); }
    return;
  }
  const i = cards.indexOf(card), cp = card.dataset.path;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = cards[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!n) { if (e.key === 'ArrowUp' && !e.shiftKey && !stickySelecting()) $('#view-stickies .sk-search').focus(); return; }
    focusStickyCard(n.dataset.path);
    // Shift with the arrows picks a run from where it started.
    if (e.shiftKey) { if (!stickySel.size) pickSticky(cp); pickSticky(n.dataset.path, 'range'); }
  }
  else if (e.key === ' ') { e.preventDefault(); pickSticky(cp); }
  else if (e.key === 'Enter') { e.preventDefault(); if (stickySelecting()) pickSticky(cp); else openSticky(cp); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteStickies(stickySel.size ? pickedStickies() : [cp]); }
  else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = card.getBoundingClientRect(); stickyCardMenu(card, r.left + 16, r.top + 24); }
});

// Right-click on a sticky (or on the picked ones): open, pin, colour, pick, delete.
function stickyCardMenu(card, x, y) {
  const p = card.dataset.path, paths = stickySel.has(p) ? pickedStickies() : [p], many = paths.length > 1;
  const pinned = stickyPinned(), un = paths.every(q => pinned.has(q));
  menu(x, y, [
    ...(many ? [] : [['Open', () => openSticky(p)]]),
    [un ? 'Unpin' : 'Pin to the top', () => { if (many) stopPicking(); pinStickies(paths); }],
    ['Colour…', () => stickyColorMenu(x, y, paths)],
    ...(many ? [] : [[stickySel.has(p) ? 'Unselect' : 'Select', () => pickSticky(p)]]),
    null,
    [many ? `Delete ${paths.length} stickies` : 'Delete', () => deleteStickies(paths), 'danger'],
  ]);
}
$('#view-stickies').addEventListener('contextmenu', e => {
  const card = !stickyOpen && e.target.closest('.sk-card');
  if (!card || e.target.closest('a')) return;
  e.preventDefault();
  focusStickyCard(card.dataset.path, false);
  stickyCardMenu(card, e.clientX, e.clientY);
});

// A long press on a touch screen picks a sticky (and starts picking).
let skPress = null, skLongPressed = false;
$('#view-stickies').addEventListener('pointerdown', e => {
  const card = e.pointerType === 'touch' && !stickyOpen && !e.target.closest('button, a') && e.target.closest('.sk-card');
  if (!card) return;
  const x0 = e.clientX, y0 = e.clientY;
  const done = () => { clearTimeout(skPress?.t); skPress = null; removeEventListener('pointerup', done); removeEventListener('pointercancel', done); removeEventListener('pointermove', moved); };
  const moved = ev => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) done(); };
  skPress = { t: setTimeout(() => { done(); skLongPressed = true; navigator.vibrate?.(15); pickSticky(card.dataset.path, 'add'); }, 450) };
  addEventListener('pointerup', done); addEventListener('pointercancel', done); addEventListener('pointermove', moved);
});

// Dragging a sticky: up or down the list to move it (into another section too: onto 📌 Pinned pins
// it), or onto the bin that shows at the bottom to delete it (with the others picked, if it's one).
let skDrag = null;
function skDropAt(e) {
  const lanes = $$('#view-stickies .sk-lane');
  if (!lanes.length) return null;
  const lane = e.target.closest?.('.sk-lane') || lanes.filter(l => l.getBoundingClientRect().top <= e.clientY).pop() || lanes[0];
  const others = $$('.sk-card', lane).filter(c => c.dataset.path !== skDrag);
  const before = others.find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; }) || null;
  // Where among all the lane's stickies (the search may be hiding some) it goes.
  const all = currentBoard().lanes.find(l => l.id === lane.dataset.lane)?.stickies.map(s => s.path).filter(q => q !== skDrag) || [];
  const index = before ? all.indexOf(before.dataset.path) : others.length ? all.indexOf(others[others.length - 1].dataset.path) + 1 : all.length;
  return { lane, before, index };
}
const skClearDrag = () => {
  $('#view-stickies .sk-drop')?.remove();
  $('#view-stickies .sk-list')?.classList.remove('dragging');
  $('#view-stickies .sk-trash')?.classList.remove('over');
  $$('#view-stickies .sk-card.dragging').forEach(c => c.classList.remove('dragging'));
};
$('#view-stickies').addEventListener('dragstart', e => {
  const card = !stickyOpen && e.target.closest?.('.sk-card');
  if (!card) return;
  skDrag = card.dataset.path;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(STICKY_DRAG, skDrag);
  e.dataTransfer.setData('text/plain', displayName(skDrag)); // WebKitGTK only tracks drags that carry text
  requestAnimationFrame(() => { card.classList.add('dragging'); $('#view-stickies .sk-list')?.classList.add('dragging'); });
});
$('#view-stickies').addEventListener('dragover', e => {
  if (!skDrag) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const trash = e.target.closest?.('.sk-trash');
  $('#view-stickies .sk-trash')?.classList.toggle('over', !!trash);
  const at = !trash && skDropAt(e);
  if (!at) { $('#view-stickies .sk-drop')?.remove(); return; }
  const mark = $('#view-stickies .sk-drop') || Object.assign(document.createElement('div'), { className: 'sk-drop' });
  if (at.before) { if (mark.nextSibling !== at.before) at.lane.insertBefore(mark, at.before); } else if (at.lane.lastElementChild !== mark) at.lane.append(mark);
});
$('#view-stickies').addEventListener('drop', e => {
  if (!skDrag) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const p = skDrag, trash = e.target.closest?.('.sk-trash'), at = !trash && skDropAt(e);
  skDrag = null;
  skClearDrag();
  if (trash) deleteStickies(stickySel.has(p) ? pickedStickies() : [p]);
  else if (at) changeBoard({ move: p, to: at.lane.dataset.lane, index: at.index });
});
$('#view-stickies').addEventListener('dragend', () => { if (skDrag === null && !$('#view-stickies .sk-drop')) return; skDrag = null; skClearDrag(); });
// Pasting or dropping pictures and files on the list adds them as stickies, as on the board.
$('#view-stickies').addEventListener('paste', async e => {
  if (stickyOpen || e.target.matches('.sk-search')) return;
  const files = await pastedFiles(e);
  if (files) { await addToInbox(files); renderStickies(); }
});
$('#view-stickies').addEventListener('dragover', e => { if (!stickyOpen && e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
$('#view-stickies').addEventListener('drop', async e => {
  if (stickyOpen || !e.dataTransfer?.files.length) return;
  e.preventDefault();
  await addToInbox([...e.dataTransfer.files]);
  renderStickies();
});
