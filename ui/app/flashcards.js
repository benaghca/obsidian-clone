/* Cinder app — flashcards: the Flashcards view, review sessions and the ribbon's due count. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ flashcards

// Every card in the vault (CinderFlashcards.parseNote), rebuilt only when notes change.
let cardsCache = { gen: -1, cards: [] };
const cardMeta = n => ({ fmLen: n.fmLen, fmTags: n.fm ? asList(n.fm.tags ?? n.fm.tag).map(String) : [] });
function allCards() {
  if (cardsCache.gen === S.dataGen) return cardsCache.cards;
  const cards = [];
  const tpl = cfg.templatesFolder ? cfg.templatesFolder + '/' : null; // template notes hold examples
  for (const [p, n] of S.notes) {
    if (isDrawing(p) || (tpl && p.startsWith(tpl))) continue;
    if (![...n.tags].some(t => t === 'flashcards' || t.startsWith('flashcards/'))) continue;
    cards.push(...CinderFlashcards.parseNote(p, n.content, cardMeta(n)));
  }
  cardsCache = { gen: S.dataGen, cards };
  return cards;
}

// The ribbon's Flashcards button shows how many cards are due today.
function updateCardBadge() {
  const b = $('[data-cmd=flashcards] .rb-badge');
  if (!b) return;
  const n = CinderFlashcards.deckTree(allCards()).due;
  b.textContent = n > 99 ? '99+' : String(n);
  b.hidden = !n;
}

// A note changed: redraw the deck list (a review in progress keeps its cards) and the count.
function refreshFlashcards() {
  if (S.view === 'flashcards' && !fc.session) renderDecks();
  updateCardBadge();
}

const fcPlural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
let fc = { session: null };

// o.note: review just that note's cards.
async function openFlashcards(o = {}) {
  flushDocViews();
  await save();
  rememberPos();
  showView('flashcards');
  setSaveState('');
  $('#crumbs').innerHTML = '<b>Flashcards</b>';
  document.title = `Flashcards — ${VAULT} — Cinder`;
  if (o.note) startReview(c => c.path === o.note, noteName(o.note));
  else if (fc.session) showCard();
  else renderDecks();
  updateStatus();
}

function renderDecks() {
  fc.session = null;
  const tree = CinderFlashcards.deckTree(allCards());
  const row = (d, depth) => `<div class="fc-deck" data-deck="${esc(d.path)}" style="--depth:${depth}" tabindex="0"><span class="fc-name">${esc(d.name)}</span><span class="fc-due${d.due ? '' : ' zero'}">${d.due}</span><span class="fc-new${d.new ? '' : ' zero'}">${d.new}</span></div>` + d.children.map(c => row(c, depth + 1)).join('');
  $('#view-flashcards').innerHTML = `<div class="fc-decks">
    <div class="fc-head"><h2>Flashcards</h2><button class="btn primary" data-fc="all"${tree.due + tree.new ? '' : ' disabled'}>Review all</button></div>
    ${tree.children.length
      ? `<div class="fc-cols"><span>Deck</span><span>Due</span><span>New</span></div>${tree.children.map(d => row(d, 0)).join('')}`
      : '<p class="fc-empty">No flashcards yet. Tag a note <code>#flashcards</code> and write cards in it, such as <code>Question::Answer</code>.</p>'}
    ${tree.unreadable ? `<p class="fc-note">${fcPlural(tree.unreadable, 'card')} ${tree.unreadable === 1 ? 'uses' : 'use'} a schedule format Cinder can’t read yet (the plugin’s FSRS or its data file), so ${tree.unreadable === 1 ? 'it’s' : 'they’re'} left as ${tree.unreadable === 1 ? 'it is' : 'they are'}.</p>` : ''}
  </div>`;
}

// ------------------------------------------------------------ a review session

function startReview(filter, title) {
  const queue = CinderFlashcards.reviewQueue(allCards().filter(filter));
  if (!queue.length) { toast('Nothing to review there right now'); renderDecks(); return; }
  fc.session = { title, queue, pos: 0, done: 0, skipped: 0, again: new Set(), shown: false, busy: false };
  showCard();
}

function showCard() {
  const s = fc.session, el = $('#view-flashcards');
  if (s.pos >= s.queue.length) return endReview();
  const { card, side } = s.queue[s.pos], face = card.sides[side];
  s.shown = false;
  el.innerHTML = `<div class="fc-review">
    <div class="fc-bar"><button class="btn" data-fc="decks" title="Back to the decks (Esc)">← Decks</button><span class="fc-title">${esc(s.title)}</span><span class="fc-count">${s.pos + 1} of ${s.queue.length}</span></div>
    <div class="fc-card markdown"><div class="fc-front"></div><div class="fc-back" hidden></div></div>
    <div class="fc-actions"><button class="btn primary" data-fc="show">Show answer <kbd>Space</kbd></button></div>
    <div class="fc-foot"><button class="btn" data-fc="skip">Skip</button><button class="btn" data-fc="open">Open note</button><span class="fc-where">${esc(noteName(card.path))} · ${esc(card.deck.replace(/\//g, ' › '))}</span></div>
  </div>`;
  renderInto($('.fc-front', el), face.front, card.path, 1);
  renderInto($('.fc-back', el), face.back, card.path, 1);
}

function revealAnswer() {
  const s = fc.session;
  if (!s || s.shown) return;
  s.shown = true;
  const { card, side } = s.queue[s.pos], el = $('#view-flashcards');
  $('.fc-back', el).hidden = false;
  if (card.kind === 'cloze') $('.fc-front', el).hidden = true; // the back is the whole text again, filled in
  const load = CinderFlashcards.dueLoad(allCards()), day = CinderFlashcards.today();
  $('.fc-actions', el).innerHTML = CinderFlashcards.RESPONSES.map((r, i) => {
    const next = CinderFlashcards.schedule(card.sides[side], r, day, load);
    return `<button class="btn fc-${r}" data-fc="rate" data-r="${r}">${r[0].toUpperCase() + r.slice(1)} · ${CinderFlashcards.intervalText(next.interval)} <kbd>${i + 1}</kbd></button>`;
  }).join('');
}

async function rateCard(r) {
  const s = fc.session;
  if (!s || !s.shown || s.busy) return;
  const item = s.queue[s.pos];
  const next = CinderFlashcards.schedule(item.card.sides[item.side], r, CinderFlashcards.today(), CinderFlashcards.dueLoad(allCards()));
  s.busy = true;
  const card = await saveCardSchedule(item.card, item.side, next);
  s.busy = false;
  if (fc.session !== s) return; // left the review while saving
  if (card) {
    s.done++;
    // Other sides of this card still waiting read from the card as it now is.
    for (const q of s.queue) if (q.card === item.card) q.card = card;
    if (r === 'again' && !s.again.has(item)) { s.again.add(item); s.queue.push(item); }
  } else s.skipped++;
  s.pos++;
  showCard();
}

// Write one side's new schedule into its card's <!--SR:…--> comment. The review takes the place of
// the editor, so the note is saved to disk (after save() has flushed any edits). Returns the card
// as it now reads, or null if it couldn't be saved.
async function saveCardSchedule(card, side, next) {
  const n = S.notes.get(card.path);
  const out = n && CinderFlashcards.setSideSchedule(n.content, card, side, next, cardMeta(n));
  if (!out) { toast('This card changed since it was shown, so the answer wasn’t saved', 4000); return null; }
  try { await writeFile(card.path, out.content, n.mtime); resolveNote(card.path); }
  catch (e) { toast(`Couldn’t save the answer to ${noteName(card.path)}: ${e.message}`, 4000); return null; }
  updateCardBadge();
  return out.card;
}

function endReview() {
  const s = fc.session;
  fc.session = null;
  $('#view-flashcards').innerHTML = `<div class="fc-done"><h2>Done</h2><p>You reviewed ${fcPlural(s.done, 'card')}${s.skipped ? `, and ${fcPlural(s.skipped, 'card')} ${s.skipped === 1 ? 'is' : 'are'} left for later` : ''}.</p><button class="btn primary" data-fc="decks">Back to decks</button></div>`;
  updateCardBadge();
}

function openCardNote() {
  const s = fc.session;
  if (!s) return;
  const { card } = s.queue[s.pos], content = S.notes.get(card.path)?.content || '';
  let off = 0;
  for (const l of content.split('\n').slice(0, card.first)) off += l.length + 1;
  openPath(card.path, { mode: 'edit', select: [off, off] });
}

$('#view-flashcards').addEventListener('click', e => {
  const b = e.target.closest('[data-fc], .fc-deck');
  if (!b) return;
  if (b.classList.contains('fc-deck')) { const d = b.dataset.deck; return startReview(c => CinderFlashcards.inDeck(c, d), d.split('/').pop()); }
  const a = b.dataset.fc;
  if (a === 'all') startReview(() => true, 'All decks');
  else if (a === 'decks') renderDecks();
  else if (a === 'show') revealAnswer();
  else if (a === 'rate') rateCard(b.dataset.r);
  else if (a === 'skip') { fc.session.skipped++; fc.session.pos++; showCard(); }
  else if (a === 'open') openCardNote();
});
$('#view-flashcards').addEventListener('keydown', e => {
  const d = e.target.closest?.('.fc-deck');
  if (d && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); d.click(); }
});
// Space shows the answer; 1–4 answer Again / Hard / Good / Easy; Esc goes back to the decks.
document.addEventListener('keydown', e => {
  if (S.view !== 'flashcards' || !fc.session || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable], .modal, .menu')) return;
  if ((e.key === ' ' || e.key === 'Enter') && !fc.session.shown) { e.preventDefault(); revealAnswer(); }
  else if (/^[1-4]$/.test(e.key) && fc.session.shown) { e.preventDefault(); rateCard(CinderFlashcards.RESPONSES[+e.key - 1]); }
  else if (e.key === 'Escape') { e.preventDefault(); renderDecks(); }
});
