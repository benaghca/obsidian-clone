/* Cinder app — the Inbox: a triage desk for things that arrive from the field. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */

// Everything in the inbox folder (Settings; "Inbox" by default), newest first and grouped by the
// day it was made, since trips cluster that way. Photos show as thumbnails and notes as their
// first lines. A day, or any selection, can become one note (text as sections, photos embedded
// in the order they were taken), be appended to a note, filed to a folder or deleted. Typing at
// the top or dropping files adds to it. Below: photos elsewhere that no note uses yet.

const inboxDir = () => (cfg.inboxFolder || 'Inbox').replace(/^\/+|\/+$/g, '');
const inboxSel = new Set();
let inboxFocus = null, inboxOrphansOpen = false;
// When something was made (its modified time, which sync keeps: a photo from Monday's trip that
// syncs on Wednesday still belongs to Monday), and when it arrived here (its creation time on this
// disk), which is what makes it "new".
const whenOf = p => { const f = S.files.get(p); return (f && (f.mtime || f.ctime)) || 0; };
const arrivedOf = p => { const f = S.files.get(p); return (f && Math.max(f.ctime || 0, f.mtime || 0)) || 0; };

function inboxItems() {
  const dir = inboxDir();
  return [...S.files.keys()].filter(p => p.startsWith(dir + '/')).sort((a, b) => whenOf(b) - whenOf(a));
}
// Images in the vault (outside the inbox) that no note, canvas or drawing uses.
function orphanImages() {
  const used = new Set();
  for (const n of S.notes.values()) for (const t of n.out || []) if (t) used.add(t);
  for (const c of S.canvases.values()) for (const r of c.refs) used.add(r);
  const dir = inboxDir();
  return [...S.files.keys()].filter(p => IMG_EXT.test(p) && !used.has(p) && !p.startsWith(dir + '/')).sort((a, b) => whenOf(b) - whenOf(a));
}
function updateInboxBadge() {
  const b = $('[data-cmd=inbox] .rb-badge');
  if (!b) return;
  const n = inboxItems().length;
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
  renderInbox();
  updateStatus();
  requestAnimationFrame(() => ($('#view-inbox .ib-card.focus') || $('#view-inbox .ib-capture input'))?.focus());
}
// Leaving the inbox marks everything in it as seen (the "new" dots are for what came since).
const leaveInbox = () => { if (S.view !== 'inbox') store('inboxSeen', Date.now()); };

const dayLabel = t => {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
};
const timeLabel = t => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function inboxCard(p, seen) {
  const t = whenOf(p), isNew = arrivedOf(p) > seen, sel = inboxSel.has(p);
  let body;
  if (IMG_EXT.test(p)) body = `<div class="ib-thumb"><img src="${rawUrl(p)}" alt="" loading="lazy" draggable="false"></div>`;
  else if (isMd(p)) {
    const text = (S.notes.get(p)?.content || '').replace(/^---[\s\S]*?\n---\s*/, '').trim();
    body = `<div class="ib-text">${text ? esc(text.slice(0, 280)) : '<span class="ib-empty">Empty note</span>'}</div>`;
  } else body = `<div class="ib-file"><span>${esc((p.split('.').pop() || '').toUpperCase())}</span></div>`;
  return `<div class="ib-card${sel ? ' sel' : ''}${isNew ? ' new' : ''}${p === inboxFocus ? ' focus' : ''}" data-path="${esc(p)}" tabindex="${p === inboxFocus ? 0 : -1}" role="option" aria-selected="${sel}">
    <button class="ib-check" tabindex="-1" title="Select (Space)">${sel ? '✓' : ''}</button>
    ${body}
    <div class="ib-meta"><span class="ib-name">${esc(displayName(p))}</span><span class="ib-time">${timeLabel(t)}</span></div>
  </div>`;
}

function renderInbox() {
  const box = $('#view-inbox');
  const items = inboxItems(), seen = store('inboxSeen') || 0;
  for (const p of [...inboxSel]) if (!S.files.has(p)) inboxSel.delete(p);
  if (inboxFocus && !S.files.has(inboxFocus)) inboxFocus = null;
  if (!inboxFocus && items.length) inboxFocus = items[0];
  const days = [];
  for (const p of items) {
    const key = new Date(whenOf(p)).toDateString();
    let d = days[days.length - 1];
    if (!d || d.key !== key) days.push(d = { key, t: whenOf(p), items: [] });
    d.items.push(p);
  }
  const orphans = orphanImages();
  const fresh = items.filter(p => arrivedOf(p) > seen).length;
  const had = box.contains(document.activeElement) ? (document.activeElement.closest('.ib-card') ? 'card' : document.activeElement.matches('.ib-capture input') ? 'capture' : null) : null;
  box.innerHTML = `<div class="inbox">
    <header class="ib-head">
      <div><h2>Inbox</h2><p>${items.length ? `${items.length} item${items.length === 1 ? '' : 's'}${fresh ? ` · <b>${fresh} new</b>` : ''} in <code>${esc(inboxDir())}/</code>` : `Things you capture away from here land in <code>${esc(inboxDir())}/</code>.`}</p></div>
      <form class="ib-capture"><input class="field" placeholder="Jot something down… (Enter adds it to the inbox)" spellcheck="true"><span class="ib-hint">or drop photos and files here</span></form>
    </header>
    <div class="ib-bar"${inboxSel.size ? '' : ' hidden'}><b>${inboxSel.size} selected</b>
      <button class="btn primary" data-ib="combine">Make a note</button><button class="btn" data-ib="append">Add to a note…</button><button class="btn" data-ib="move">File to folder…</button><button class="btn" data-ib="delete">Delete</button><button class="btn ib-clear" data-ib="clear">Clear</button></div>
    ${days.length ? days.map(d => `<section class="ib-day">
      <h3><span>${esc(dayLabel(d.t))}</span><small>${d.items.length}</small><button class="btn" data-ib="day" data-day="${esc(d.key)}" title="One note from everything that arrived this day">Make a note from this day</button></h3>
      <div class="ib-grid" role="listbox" aria-multiselectable="true">${d.items.map(p => inboxCard(p, seen)).join('')}</div>
    </section>`).join('') : `<div class="ib-zero"><img src="/logo.svg" alt="" width="64" height="64"><h3>Inbox zero</h3><p>Everything's filed. New photos and notes synced into <code>${esc(inboxDir())}/</code> (from Obsidian on your phone, or OneDrive's camera upload) will show up here, grouped by day.</p></div>`}
    ${orphans.length ? `<section class="ib-orphans${inboxOrphansOpen ? ' open' : ''}"><h3><button class="ib-fold" data-ib="orphans">${CHEV}Photos no note uses yet <small>${orphans.length}</small></button></h3>
      ${inboxOrphansOpen ? `<div class="ib-grid">${orphans.slice(0, 120).map(p => inboxCard(p, Infinity)).join('')}</div>` : ''}</section>` : ''}
  </div>`;
  if (had === 'card') box.querySelector('.ib-card.focus')?.focus({ preventScroll: true });
  else if (had === 'capture') box.querySelector('.ib-capture input').focus();
  updateInboxBadge();
}
const refreshInboxSoon = debounce(() => { if (S.view === 'inbox') renderInbox(); else updateInboxBadge(); }, 150);

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
  $('#view-inbox .ib-capture input')?.focus();
}

// ------------------------------------------------------------ events

$('#view-inbox').addEventListener('click', e => {
  const act = e.target.closest('[data-ib]');
  if (act) {
    const a = act.dataset.ib;
    if (a === 'day') return inboxCombine(inboxItems().filter(p => new Date(whenOf(p)).toDateString() === act.dataset.day));
    if (a === 'orphans') { inboxOrphansOpen = !inboxOrphansOpen; return renderInbox(); }
    return inboxAct(a);
  }
  const card = e.target.closest('.ib-card');
  if (!card) return;
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
  openInboxItem(p);
});
$('#view-inbox').addEventListener('submit', e => {
  if (!e.target.matches('.ib-capture')) return;
  e.preventDefault();
  const inp = $('input', e.target);
  const v = inp.value;
  inp.value = '';
  inboxCapture(v);
});
// Arrows move between cards (up/down by rows), Space selects, Enter opens, Del deletes,
// C makes a note, A adds to a note, M files, Ctrl+A selects all, Esc clears.
$('#view-inbox').addEventListener('keydown', e => {
  const card = e.target.closest?.('.ib-card');
  if (e.target.matches?.('.ib-capture input')) {
    if (e.key === 'ArrowDown' && inboxCards().length) { e.preventDefault(); setInboxFocus(inboxFocus || inboxCards()[0].dataset.path); }
    else if (e.key === 'Escape') { e.target.value = ''; }
    return;
  }
  if (!card) return;
  const cards = inboxCards(), i = cards.indexOf(card), k = e.key;
  const rowNeighbour = dir => {
    const r = card.getBoundingClientRect(), cx = r.left + r.width / 2;
    const rows = cards.filter(c => dir > 0 ? c.getBoundingClientRect().top > r.bottom - 4 : c.getBoundingClientRect().bottom < r.top + 4);
    if (!rows.length) return null;
    const edge = dir > 0 ? Math.min(...rows.map(c => c.getBoundingClientRect().top)) : Math.max(...rows.map(c => c.getBoundingClientRect().top));
    const line = rows.filter(c => Math.abs(c.getBoundingClientRect().top - edge) < 4);
    return line.sort((a, b) => Math.abs(a.getBoundingClientRect().left + a.offsetWidth / 2 - cx) - Math.abs(b.getBoundingClientRect().left + b.offsetWidth / 2 - cx))[0];
  };
  let done = true;
  if (k === 'ArrowRight') { if (cards[i + 1]) setInboxFocus(cards[i + 1].dataset.path); }
  else if (k === 'ArrowLeft') { if (cards[i - 1]) setInboxFocus(cards[i - 1].dataset.path); }
  else if (k === 'ArrowDown') { const n = rowNeighbour(1); if (n) setInboxFocus(n.dataset.path); }
  else if (k === 'ArrowUp') { const n = rowNeighbour(-1); if (n) setInboxFocus(n.dataset.path); else $('#view-inbox .ib-capture input').focus(); }
  else if (k === ' ') toggleInboxSel(card.dataset.path);
  else if (k === 'Enter') openInboxItem(card.dataset.path);
  else if (k === 'Delete') inboxAct('delete');
  else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') { for (const c of cards) inboxSel.add(c.dataset.path); renderInbox(); }
  else if (e.ctrlKey || e.metaKey || e.altKey) done = false;
  else if (k.toLowerCase() === 'c') inboxAct('combine');
  else if (k.toLowerCase() === 'a') inboxAct('append');
  else if (k.toLowerCase() === 'm') inboxAct('move');
  else if (k === 'Escape' && inboxSel.size) { inboxSel.clear(); renderInbox(); }
  else done = false;
  if (done) { e.preventDefault(); e.stopPropagation(); }
});
// Drop photos or files anywhere on the view: they go into the inbox.
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
