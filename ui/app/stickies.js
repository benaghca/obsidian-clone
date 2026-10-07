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
const listedStickies = () => $$('#view-stickies .sk-cards .sk-card').map(c => c.dataset.path);
const pickedStickies = () => listedStickies().filter(p => stickySel.has(p));
function syncStickySel() {
  const list = $('#view-stickies .sk-list');
  if (!list) return;
  for (const c of $$('.sk-card', list)) { const on = stickySel.has(c.dataset.path); c.classList.toggle('sel', on); c.setAttribute('aria-selected', String(on)); }
  list.classList.toggle('selecting', stickySelecting());
  syncStickyHead(list);
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

// Deleting goes straight ahead (to .trash), with Undo on the note that says so (or Ctrl+Z), which
// puts the stickies back where they were on the board, in their colours. The key focus goes on to
// the sticky after them.
let stickyUndo = null;
async function deleteStickies(paths) {
  paths = paths.filter(p => S.files.has(p));
  if (!paths.length) return;
  const board = currentBoard(), kept = [];
  for (const p of paths) {
    const lane = board.lanes.find(l => l.stickies.some(s => s.path === p)), i = lane ? lane.stickies.findIndex(s => s.path === p) : -1;
    let data = S.notes.get(p)?.content ?? null;
    if (data == null) data = await fetch(rawUrl(p), { cache: 'no-store' }).then(r => r.ok ? r.blob() : null, () => null);
    kept.push({ path: p, data, lane: lane?.id, index: i, color: lane?.stickies[i].color || null });
  }
  const listed = listedStickies(), rest = listed.filter(p => !paths.includes(p));
  const next = listed.slice(listed.indexOf(paths[paths.length - 1]) + 1).find(p => rest.includes(p)) || rest[rest.length - 1];
  for (const p of paths) { await deletePath(p, { confirm: false }); stickySel.delete(p); }
  if (!stickySel.size) stickySelMode = false;
  renderStickies();
  if (S.view === 'stickies' && !stickyOpen) { if (next) focusStickyCard(next); else $('#view-stickies .sk-cards')?.focus(); }
  const undo = stickyUndo = () => { stickyUndo = null; $$('.toast.has-action').forEach(t => t.remove()); return restoreStickies(kept); };
  toast(paths.length === 1 ? 'Sticky deleted' : `${paths.length} stickies deleted`, 8000, { label: 'Undo', run: () => { if (stickyUndo === undo) undo(); } });
}
async function restoreStickies(kept) {
  for (const k of kept) {
    if (k.data == null || S.files.has(k.path)) continue;
    try { await writeFile(k.path, k.data); } catch (e) { toast('Couldn’t put it back: ' + e.message); }
  }
  reindexAll(); renderTree();
  for (const k of [...kept].sort((a, b) => a.index - b.index)) {
    if (!S.files.has(k.path)) continue;
    if (k.lane) await changeBoard({ move: k.path, to: k.lane, index: k.index });
    if (k.color) await changeBoard({ color: k.path, value: k.color });
  }
  renderStickies();
  if (S.view === 'stickies' && !stickyOpen && S.files.has(kept[0].path)) focusStickyCard(kept[0].path);
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
      <input class="field sk-search" type="search" placeholder="Search stickies" spellcheck="false" aria-label="Search stickies">
      ${NATIVE ? `<button class="sk-btn sk-ontop${cfg.keepOnTop ? ' on' : ''}" data-sk="ontop" title="${cfg.keepOnTop ? 'Stop keeping the window on top' : 'Keep the window on top of others'}" aria-pressed="${!!cfg.keepOnTop}" aria-label="Keep on top">${PIN_ICON}</button>` : ''}
      <button class="sk-btn" data-sk="menu" title="More" aria-label="More"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></button>
    </header>`;
}
// The header is only rebuilt when it changes, so the search keeps its focus and caret.
let stickyHeadNow = '';
function syncStickyHead(list) {
  const html = stickyHeadHtml(), head = $('.sk-head', list);
  if (html === stickyHeadNow && head.childElementCount) return;
  stickyHeadNow = html;
  const searching = head.contains(document.activeElement);
  head.outerHTML = html;
  const s = $('.sk-search', list);
  if (s) { s.value = stickySearch; if (searching) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
}

// The list stays in the view while a sticky is open (covered by it, keeping its place). Redrawing
// keeps each card that hasn't changed, and what moved slides to its new place.
function stickyListEl() {
  const box = $('#view-stickies');
  let list = $('.sk-list', box);
  if (!list) {
    box.insertAdjacentHTML('afterbegin', `<div class="sk-list"><header class="sk-head"></header>
      <div class="sk-cards" role="listbox" aria-label="Stickies" aria-multiselectable="true" tabindex="-1"></div>
      <div class="sk-trash" aria-hidden="true">${TRASH_ICON}<span>Drop here to delete</span></div></div>`);
    list = $('.sk-list', box);
  }
  return list;
}
const stickySig = s => `${s.color || ''}|${whenOf(s.path)}|${S.notes.get(s.path)?.content ?? S.files.get(s.path)?.mtime}`;

function renderStickies({ slide = true } = {}) {
  if (skDragging) return; // (it redraws when the drag ends)
  const list = stickyListEl(), cardsEl = $('.sk-cards', list);
  for (const p of [...stickySel]) if (!S.files.has(p)) stickySel.delete(p);
  const sections = stickySections(), total = inboxItems().length;
  const act = list.contains(document.activeElement) ? document.activeElement : null;
  const focusedCard = act?.closest('.sk-card')?.dataset.path, onList = act === cardsEl;
  const shown = slide && !stickyOpen && list.offsetParent !== null;
  const old = new Map($$('.sk-card', cardsEl).map(c => [c.dataset.path, c]));
  const before = shown ? new Map([...old.values()].map(c => [c, c.getBoundingClientRect()])) : null;
  const top = cardsEl.scrollTop;
  list.classList.toggle('selecting', stickySelecting());
  syncStickyHead(list);
  const frag = document.createDocumentFragment(), fresh = [];
  for (const { lane, stickies } of sections) {
    const sec = document.createElement('section');
    sec.className = 'sk-lane'; sec.dataset.lane = lane.id;
    if (!(lane.kind === 'new' && sections.length === 1)) sec.innerHTML = `<h3 class="sk-sec">${lane.kind === 'pinned' ? '📌 ' : ''}${esc(lane.name)}</h3>`;
    for (const s of stickies) {
      const sig = stickySig(s);
      let c = old.get(s.path);
      if (!c || c.dataset.sig !== sig) { c = stickyCardEl(s); c.dataset.sig = sig; fresh.push(c); }
      const sel = stickySel.has(s.path);
      c.classList.toggle('sel', sel); c.setAttribute('aria-selected', String(sel));
      c.tabIndex = s.path === stickyFocus ? 0 : -1;
      sec.append(c);
    }
    frag.append(sec);
  }
  if (!sections.length) frag.append(Object.assign(document.createElement('div'), { className: 'sk-none', innerHTML: total ? 'No stickies match.' : `No stickies yet. <b>+</b> makes one; they live in <code>${esc(inboxDir())}/</code>.` }));
  cardsEl.replaceChildren(frag);
  for (const c of fresh) fillStickyCard(c);
  cardsEl.scrollTop = top;
  if (focusedCard && old.has(focusedCard) && $$('.sk-card', cardsEl).some(c => c.dataset.path === focusedCard)) focusStickyCard(focusedCard, false);
  else if (focusedCard || onList) cardsEl.focus({ preventScroll: true });
  if (before) slideStickies(before, fresh.filter(c => !old.has(c.dataset.path)));
}
function stickyCardEl(s) {
  const p = s.path;
  let body;
  if (IMG_EXT.test(p)) body = `<div class="sk-thumb"><img src="${rawUrl(p)}" alt="" loading="lazy" draggable="false"></div>`;
  else if (isMd(p)) body = '<div class="sk-text markdown"></div>';
  else body = `<div class="sk-file">${esc(displayName(p))}</div>`;
  const t = document.createElement('template');
  t.innerHTML = `<div class="sk-card${stickyColorClass(s.color)}${s.color ? ' tinted' : ''}" data-path="${esc(p)}" role="option" aria-selected="false" tabindex="-1"${stickyTint(s.color)}>
    ${body}<div class="sk-foot"><span class="sk-card-tools"><button class="sk-mini sk-check" data-sk="check" tabindex="-1" title="Select (Space)" aria-label="Select">${CHECK_ICON}</button><button class="sk-mini sk-danger" data-sk="card-delete" tabindex="-1" title="Delete (Del)" aria-label="Delete">${TRASH_ICON}</button></span><span class="sk-time">${esc(stickyTime(whenOf(p)))}</span></div></div>`;
  return /** @type {HTMLElement} */ (t.content.firstElementChild);
}
// Text stickies show their note rendered, faded out where it runs long.
function fillStickyCard(c) {
  const el = $('.sk-text', c);
  if (!el) return;
  const p = c.dataset.path, n = S.notes.get(p);
  if (!n || !n.content.slice(n.fmLen).trim()) { el.innerHTML = '<span class="sk-empty">Empty sticky</span>'; return; }
  renderInto(el, n.content, p, 1);
  el.classList.toggle('clipped', el.scrollHeight > el.clientHeight + 2);
}
// Each element in `before` (element → where it was) slides from there to where it is now; `arrived`
// ones fade in.
function slideStickies(before, arrived = []) {
  const moving = [];
  for (const [el, was] of before) {
    if (!el.isConnected || el.classList.contains('lifted')) continue;
    const r = el.getBoundingClientRect(), dx = was.left - r.left, dy = was.top - r.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    moving.push(el);
  }
  for (const el of arrived) { el.classList.remove('sk-arrive'); el.classList.add('sk-arrive'); }
  if (!moving.length) return;
  void document.body.offsetWidth; // (they start from where they were)
  for (const el of moving) {
    el.style.transition = 'transform var(--dur) var(--ease)';
    el.style.transform = '';
    el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
  }
}
function focusStickyCard(p = stickyFocus, scroll = true) {
  const cards = $$('#view-stickies .sk-cards .sk-card');
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

// A sticky filling the window, over the list: its colour as the header (back, colours, pin,
// delete), the note in the live-preview editor, and a formatting bar.
async function openSticky(p) {
  if (S.view !== 'stickies') await openStickies();
  await closeSticky(false);
  if (!isMd(p)) return openPath(p); // a photo or a file opens as itself
  const s = currentBoard().lanes.flatMap(l => l.stickies.map(x => ({ ...x, pinned: l.kind === 'pinned' }))).find(x => x.path === p) || { path: p, color: null, pinned: false };
  const box = $('#view-stickies'), list = stickyListEl();
  box.insertAdjacentHTML('beforeend', `<div class="sk-page sk-enter${stickyColorClass(s.color)}${s.color ? ' tinted' : ''}"${stickyTint(s.color)} data-path="${esc(p)}">
    <header class="sk-page-head">
      <button class="sk-btn" data-sk="back" title="Back to the stickies (Esc)" aria-label="Back to the stickies"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button>
      <span class="sk-grow"></span>
      <span class="sk-colors">${STICKY_COLORS.map(([c, name]) => `<button class="ib-dot c-${c}${s.color === c ? ' on' : ''}" data-sk="color" data-color="${c}" title="${name}" aria-label="${name}"></button>`).join('')}<button class="ib-dot plain${s.color ? '' : ' on'}" data-sk="color" data-color="" title="Plain" aria-label="Plain"></button></span>
      <button class="sk-btn${s.pinned ? ' on' : ''}" data-sk="pin" title="${s.pinned ? 'Unpin' : 'Pin to the top'}" aria-pressed="${s.pinned}" aria-label="Pin">${PIN_ICON}</button>
      <button class="sk-btn" data-sk="delete" title="Delete sticky" aria-label="Delete sticky">${TRASH_ICON}</button>
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
  </div>`);
  const page = /** @type {HTMLElement} */ (box.lastElementChild);
  const editor = mountCardEditor($('.sk-page-body', page), { notePath: p, onExit: () => closeSticky() });
  if (!editor) { page.remove(); return; }
  stickyOpen = { path: p, editor };
  stickyFocus = p;
  // The list goes out of reach under it (and out of sight once the sticky has come in).
  list.inert = true;
  page.addEventListener('animationend', () => { page.classList.remove('sk-enter'); if (stickyOpen?.path === p) list.classList.add('covered'); }, { once: true });
  setTimeout(() => { if (stickyOpen?.path === p) list.classList.add('covered'); }, 400);
  editor.focus();
  document.title = `${noteName(p)} — Stickies — Cinder`;
}
// Takes the open sticky's page away (fading it out), uncovering the list.
function dropStickyPage(fade = true) {
  const box = $('#view-stickies'), list = $('.sk-list', box);
  if (list) { list.inert = false; list.classList.remove('covered'); }
  for (const page of $$('.sk-page', box)) {
    if (!fade) { page.remove(); continue; }
    page.classList.add('sk-leave');
    const gone = () => page.remove();
    page.addEventListener('animationend', gone, { once: true });
    setTimeout(gone, 400);
  }
}

// Back to the list (saving what was typed; a sticky still empty goes to .trash).
async function closeSticky(redraw = true) {
  if (!stickyOpen) return;
  const { path, editor } = stickyOpen;
  stickyOpen = null;
  await editor.destroy();
  dropStickyPage(redraw);
  const n = S.notes.get(path);
  if (n && !n.content.trim()) await deletePath(path, { confirm: false });
  if (redraw && S.view === 'stickies') { renderStickies(); document.title = `Stickies — ${VAULT} — Cinder`; focusStickyCard(S.files.has(path) ? path : null); }
}

function setKeepOnTop(on) {
  cfg.keepOnTop = !!on; saveCfg();
  winCmd('ontop:' + (cfg.keepOnTop ? 'on' : 'off'));
  if (S.view === 'stickies') renderStickies();
  toast(cfg.keepOnTop ? 'Cinder stays on top of other windows' : 'Cinder no longer stays on top');
}

$('#view-stickies').addEventListener('click', async e => {
  const b = e.target.closest('[data-sk]'), card = e.target.closest('.sk-cards .sk-card');
  if (skLongPressed || skJustDragged) { skLongPressed = skJustDragged = false; return; } // (the long press picked it; the drag moved it)
  if (!b && card && !e.target.closest('a')) {
    const cp = card.dataset.path;
    if (e.shiftKey) { focusStickyCard(cp, false); return pickSticky(cp, 'range'); }
    if (e.ctrlKey || e.metaKey || stickySelecting()) { focusStickyCard(cp, false); return pickSticky(cp); }
    return openSticky(cp);
  }
  if (!b) return;
  const what = b.dataset.sk, p = stickyOpen?.path;
  if (what === 'check') { const cp = card.dataset.path; focusStickyCard(cp, false); return pickSticky(cp, e.shiftKey ? 'range' : 'toggle'); }
  if (what === 'card-delete') return deleteStickies(stickySel.has(card.dataset.path) ? pickedStickies() : [card.dataset.path]);
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
    const { editor } = stickyOpen;
    stickyOpen = null;
    await editor.destroy();
    dropStickyPage();
    document.title = `Stickies — ${VAULT} — Cinder`;
    return deleteStickies([p]);
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
  renderStickies({ slide: false });
}, 120));
$('#view-stickies').addEventListener('keydown', e => {
  if (stickyOpen) {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); closeSticky(); }
    return;
  }
  const card = e.target.closest('.sk-cards .sk-card'), cards = $$('#view-stickies .sk-cards .sk-card');
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape' && stickySelecting() && !e.target.matches('.sk-search')) { e.preventDefault(); stopPicking(); $('#view-stickies .sk-cards')?.focus(); return; }
  if (e.target.matches('.sk-search')) {
    if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); focusStickyCard(cards[0]?.dataset.path); }
    else if (e.key === 'Escape' && stickySearch) { e.preventDefault(); stickySearch = ''; e.target.value = ''; renderStickies({ slide: false }); }
    return;
  }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && stickyUndo) { e.preventDefault(); stickyUndo(); return; }
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
  const card = !stickyOpen && e.target.closest('.sk-cards .sk-card');
  if (!card || e.target.closest('a')) return;
  e.preventDefault();
  focusStickyCard(card.dataset.path, false);
  stickyCardMenu(card, e.clientX, e.clientY);
});

// A long press on a touch screen picks a sticky (and starts picking).
let skPress = null, skLongPressed = false;
$('#view-stickies').addEventListener('pointerdown', e => {
  const card = e.pointerType === 'touch' && !stickyOpen && !e.target.closest('button, a') && e.target.closest('.sk-cards .sk-card');
  if (!card) return;
  const x0 = e.clientX, y0 = e.clientY;
  const done = () => { clearTimeout(skPress?.t); skPress = null; removeEventListener('pointerup', done); removeEventListener('pointercancel', done); removeEventListener('pointermove', moved); };
  const moved = ev => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) done(); };
  skPress = { t: setTimeout(() => { done(); skLongPressed = true; navigator.vibrate?.(15); pickSticky(card.dataset.path, 'add'); }, 450) };
  addEventListener('pointerup', done); addEventListener('pointercancel', done); addEventListener('pointermove', moved);
});

// Dragging a sticky with the mouse: it lifts and follows the pointer up and down, and the others make room
// where it would land (in another section too: under 📌 Pinned pins it). A bin shows at the bottom
// to drop it on to delete it (with the others picked, if it's one of them). Near the top or the
// bottom the list scrolls; Esc puts it back.
let skDragging = null, skJustDragged = false;
$('#view-stickies').addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' || e.button !== 0 || stickyOpen || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const card = e.target.closest('.sk-cards .sk-card');
  if (!card || e.target.closest('button, a, input')) return;
  const x0 = e.clientX, y0 = e.clientY;
  const move = ev => {
    if (!skDragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) startStickyDrag(card, x0, y0);
    if (skDragging) { ev.preventDefault(); dragStickyTo(ev.clientX, ev.clientY); }
  };
  const off = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); removeEventListener('keydown', esc, true); };
  const up = ev => { off(); if (skDragging) endStickyDrag(ev.type === 'pointerup'); };
  const esc = ev => { if (ev.key === 'Escape' && skDragging) { ev.preventDefault(); ev.stopPropagation(); off(); endStickyDrag(false); } };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up); addEventListener('keydown', esc, true);
});
function startStickyDrag(card, x0, y0) {
  const r = card.getBoundingClientRect(), list = $('#view-stickies .sk-list');
  const ph = Object.assign(document.createElement('div'), { className: 'sk-ph' });
  ph.style.height = r.height + 'px';
  card.before(ph);
  Object.assign(card.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', margin: '0', transition: 'none', transform: '' });
  card.classList.add('lifted');
  list.classList.add('dragging');
  skDragging = { card, ph, path: card.dataset.path, oy: y0 - r.top, x: x0, y: y0, scroll: 0 };
  const tick = () => {
    const d = skDragging;
    if (!d) return;
    if (d.scroll) { $('#view-stickies .sk-cards').scrollTop += d.scroll; placeStickyDrag(); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function dragStickyTo(x, y) {
  const d = skDragging;
  d.x = x; d.y = y;
  d.card.style.top = y - d.oy + 'px'; // (it stays in its column)
  // Near the edges the list scrolls, faster the nearer.
  const cr = $('#view-stickies .sk-cards').getBoundingClientRect(), bin = $('#view-stickies .sk-trash').getBoundingClientRect();
  const lo = Math.min(cr.bottom, bin.top), edge = 48;
  d.scroll = y < cr.top + edge ? -Math.ceil((cr.top + edge - y) / 4) : y > lo - edge && y < bin.top ? Math.ceil((y - (lo - edge)) / 4) : 0;
  placeStickyDrag();
}
// Moves the gap to where the dragged sticky would land, the others sliding out of its way.
function placeStickyDrag() {
  const d = skDragging, { x, y } = d;
  const bin = $('#view-stickies .sk-trash'), b = bin.getBoundingClientRect();
  const overBin = x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  bin.classList.toggle('over', overBin);
  d.card.classList.toggle('to-bin', overBin);
  if (overBin) return;
  const lanes = $$('#view-stickies .sk-lane');
  const lane = lanes.find(l => y < l.getBoundingClientRect().bottom) || lanes[lanes.length - 1];
  if (!lane) return;
  const others = $$('.sk-card', lane).filter(c => c !== d.card);
  const before = others.find(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null;
  if (d.ph.parentElement === lane && nextCardAfter(d.ph, d.card) === before) return;
  const els = $$('#view-stickies .sk-cards .sk-card, #view-stickies .sk-sec').filter(el => el !== d.card);
  const at = new Map(els.map(el => [el, el.getBoundingClientRect()]));
  if (before) lane.insertBefore(d.ph, before); else lane.append(d.ph);
  slideStickies(at);
}
const nextCardAfter = (el, skip) => { let n = el.nextElementSibling; while (n && (n === skip || !n.matches('.sk-card'))) n = n.nextElementSibling; return n; };
const prevCardBefore = (el, skip) => { let n = el.previousElementSibling; while (n && (n === skip || !n.matches('.sk-card'))) n = n.previousElementSibling; return n; };
function endStickyDrag(commit) {
  const d = skDragging;
  skDragging = null;
  skJustDragged = true; setTimeout(() => { skJustDragged = false; }, 0);
  const list = $('#view-stickies .sk-list'), bin = $('.sk-trash', list), binned = commit && bin.classList.contains('over');
  list.classList.remove('dragging'); bin.classList.remove('over');
  const { card, ph, path } = d;
  if (binned) {
    card.classList.add('binned');
    const at = new Map($$('.sk-cards .sk-card, .sk-sec', list).filter(el => el !== card).map(el => [el, el.getBoundingClientRect()]));
    ph.remove();
    slideStickies(at);
    return deleteStickies(stickySel.has(path) ? pickedStickies() : [path]).finally(() => { if (card.isConnected && S.files.has(path)) { settleSticky(card, null); renderStickies(); } });
  }
  // Where it lands among all its lane's stickies (a search may be hiding some).
  const lane = ph.closest('.sk-lane'), next = nextCardAfter(ph, card), prev = prevCardBefore(ph, card);
  const all = currentBoard().lanes.find(l => l.id === lane?.dataset.lane)?.stickies.map(s => s.path).filter(q => q !== path) || [];
  const index = next ? all.indexOf(next.dataset.path) : prev ? all.indexOf(prev.dataset.path) + 1 : 0;
  if (!commit) { const home = ph; settleSticky(card, null); home.remove(); renderStickies(); return; }
  settleSticky(card, ph);
  if (lane) changeBoard({ move: path, to: lane.dataset.lane, index });
}
// Puts the dragged sticky down (in the gap, or back where it came from), gliding into place.
function settleSticky(card, gap) {
  const from = card.getBoundingClientRect();
  card.classList.remove('lifted', 'binned');
  Object.assign(card.style, { position: '', left: '', top: '', width: '', margin: '', transition: '', transform: '' });
  if (gap) gap.replaceWith(card);
  slideStickies(new Map([[card, from]]));
}

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
