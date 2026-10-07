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

function renderStickies() {
  const box = $('#view-stickies');
  if (stickyOpen) return; // the open sticky has the window; the list redraws on the way back
  const sections = stickySections(), total = inboxItems().length;
  const searching = box.contains(document.activeElement) && document.activeElement.matches('.sk-search');
  box.innerHTML = `<div class="sk-list">
    <header class="sk-head">
      <button class="sk-btn sk-new" data-sk="new" title="New sticky (${esc(fmtKey('Mod-n'))})" aria-label="New sticky"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      <input class="field sk-search" type="search" placeholder="Search stickies" value="${esc(stickySearch)}" spellcheck="false" aria-label="Search stickies">
      ${NATIVE ? `<button class="sk-btn sk-ontop${cfg.keepOnTop ? ' on' : ''}" data-sk="ontop" title="${cfg.keepOnTop ? 'Stop keeping the window on top' : 'Keep the window on top of others'}" aria-pressed="${!!cfg.keepOnTop}" aria-label="Keep on top">${PIN_ICON}</button>` : ''}
      <button class="sk-btn" data-sk="menu" title="More" aria-label="More"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></button>
    </header>
    <div class="sk-cards" role="listbox" aria-label="Stickies" tabindex="-1">${sections.map(({ lane, stickies }) =>
      `${lane.kind === 'new' && sections.length === 1 ? '' : `<h3 class="sk-sec">${lane.kind === 'pinned' ? '📌 ' : ''}${esc(lane.name)}</h3>`}${stickies.map(s => stickyCardHtml(s)).join('')}`).join('')
      || `<div class="sk-none">${total ? 'No stickies match.' : `No stickies yet. <b>+</b> makes one; they live in <code>${esc(inboxDir())}/</code>.`}</div>`}</div>
  </div>`;
  // Text stickies show their note rendered, faded out where it runs long.
  for (const el of $$('.sk-card .sk-text', box)) {
    const p = el.closest('.sk-card').dataset.path, n = S.notes.get(p);
    if (!n || !n.content.slice(n.fmLen).trim()) { el.innerHTML = '<span class="sk-empty">Empty sticky</span>'; continue; }
    renderInto(el, n.content, p, 1);
    if (el.scrollHeight > el.clientHeight + 2) el.classList.add('clipped');
  }
  if (searching) { const i = $('.sk-search', box); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
function stickyCardHtml(s) {
  const p = s.path;
  let body;
  if (IMG_EXT.test(p)) body = `<div class="sk-thumb"><img src="${rawUrl(p)}" alt="" loading="lazy" draggable="false"></div>`;
  else if (isMd(p)) body = '<div class="sk-text markdown"></div>';
  else body = `<div class="sk-file">${esc(displayName(p))}</div>`;
  return `<div class="sk-card${stickyColorClass(s.color)}${s.color ? ' tinted' : ''}" data-path="${esc(p)}" role="option" tabindex="${p === stickyFocus ? 0 : -1}"${stickyTint(s.color)}>
    ${body}<div class="sk-time">${esc(stickyTime(whenOf(p)))}</div></div>`;
}
function focusStickyCard(p = stickyFocus) {
  const cards = $$('#view-stickies .sk-card');
  const c = cards.find(x => x.dataset.path === p) || cards[0];
  if (!c) return $('#view-stickies .sk-search')?.focus();
  stickyFocus = c.dataset.path;
  for (const x of cards) x.tabIndex = x === c ? 0 : -1;
  c.focus();
  c.scrollIntoView({ block: 'nearest' });
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
  if (!b && card && !e.target.closest('a')) return openSticky(card.dataset.path);
  if (!b) return;
  const what = b.dataset.sk, p = stickyOpen?.path;
  if (what === 'new') return newSticky();
  if (what === 'back') return closeSticky();
  if (what === 'ontop') return setKeepOnTop(!cfg.keepOnTop);
  if (what === 'menu') {
    const r = b.getBoundingClientRect();
    return menu(r.left, r.bottom, [
      ['New sticky', () => newSticky()],
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
  if (e.target.matches('.sk-search')) {
    if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); focusStickyCard(cards[0]?.dataset.path); }
    else if (e.key === 'Escape' && stickySearch) { e.preventDefault(); stickySearch = ''; renderStickies(); }
    return;
  }
  if (!card) {
    if (e.target.matches('.sk-cards') && e.key === 'ArrowDown') { e.preventDefault(); focusStickyCard(cards[0]?.dataset.path); }
    return;
  }
  const i = cards.indexOf(card);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = cards[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) focusStickyCard(n.dataset.path); else if (e.key === 'ArrowUp') $('#view-stickies .sk-search').focus(); }
  else if (e.key === 'Enter') { e.preventDefault(); openSticky(card.dataset.path); }
  else if (e.key === 'Delete') { e.preventDefault(); deletePath(card.dataset.path).then(() => { renderStickies(); focusStickyCard(cards[i + 1]?.dataset.path || cards[i - 1]?.dataset.path); }); }
});
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
