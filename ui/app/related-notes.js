/* Cinder app — the Related tab: notes about the same things as the open one, from the words,
 * tags and links they share (ui/related.js). Those not linked yet come first, with a button
 * to link them. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */

const relCounts = new Map(); // path -> {content, links, counts}: term counts, redone only when a note changes
let relCache = { gen: -1, index: null }, relTimer = null;

function relatedIndex() {
  if (relCache.gen === S.dataGen && relCache.index) return relCache.index;
  const docs = [];
  const tpl = cfg.templatesFolder ? cfg.templatesFolder + '/' : null;
  for (const [p, n] of S.notes) {
    if (isDrawing(p) || (tpl && p.startsWith(tpl))) continue;
    const links = (n.out || []).filter(Boolean).join('\n');
    let c = relCounts.get(p);
    if (!c || c.content !== n.content || c.links !== links) {
      c = { content: n.content, links, counts: CinderRelated.countTerms({ title: noteName(p), text: n.content, tags: [...n.tags], links: links ? links.split('\n') : [] }) };
      relCounts.set(p, c);
    }
    docs.push({ id: p, counts: c.counts });
  }
  for (const p of relCounts.keys()) if (!S.notes.has(p)) relCounts.delete(p);
  relCache = { gen: S.dataGen, index: CinderRelated.build(docs) };
  return relCache.index;
}

function drawRelated(body) {
  if (!S.cur || !S.notes.has(S.cur) || isDrawing(S.cur)) { body.innerHTML = '<div class="none">Open a note to see notes like it.</div>'; return; }
  // Rebuilding after every keystroke would be wasted work: while typing, show the last results.
  if (relCache.gen !== S.dataGen && relCache.index && body.dataset.tab === 'related' && body.dataset.for === S.cur) {
    clearTimeout(relTimer); relTimer = setTimeout(() => rtab === 'related' && refreshPanels(true), 1500);
    return;
  }
  const n = S.notes.get(S.cur);
  const linked = new Set((n.out || []).filter(Boolean));
  for (const [q, m] of S.notes) if ((m.out || []).includes(S.cur)) linked.add(q);
  const list = CinderRelated.similar(relatedIndex(), S.cur, { limit: 15 });
  const why = t => t.startsWith('#') ? t : t.startsWith('→') ? `links to ${displayName(t.slice(1))}` : t;
  const top = list[0]?.score || 1;
  const item = (x, link) => `<div class="rl-item" data-path="${esc(x.id)}" tabindex="-1"><div class="rl-main"><div class="rl-name">${esc(displayName(x.id))}</div><div class="rl-why">${x.shared.map(t => `<span>${esc(why(t))}</span>`).join('')}</div></div>
    <span class="rl-score" title="How alike: ${Math.round(x.score * 100)}%"><i style="width:${Math.round(8 + 36 * x.score / top)}px"></i></span>${link ? `<button class="rl-link" data-rl-link="${esc(x.id)}" title="Insert a link to it here">Link</button>` : ''}</div>`;
  const fresh = list.filter(x => !linked.has(x.id)), known = list.filter(x => linked.has(x.id));
  body.innerHTML = list.length
    ? `<div class="r-sec"><h4>Not linked yet <span>${fresh.length}</span></h4>${fresh.map(x => item(x, true)).join('') || '<div class="none">Every note like this one is already linked.</div>'}</div>` +
      (known.length ? `<div class="r-sec rl-known"><h4>Already linked <span>${known.length}</span></h4>${known.map(x => item(x, false)).join('')}</div>` : '')
    : '<div class="none">No notes share enough words with this one yet.</div>';
  body.insertAdjacentHTML('beforeend', '<div class="rl-hint">Found from the words, tags and links notes share. Nothing leaves this computer.</div>');
}

$('#right-body').addEventListener('click', e => {
  const l = e.target.closest('[data-rl-link]');
  if (l) {
    e.stopPropagation();
    const t = l.dataset.rlLink, link = `[[${linkNameFor(t, S.notes.keys())}]]`;
    if (S.view !== 'note') return;
    if (S.mode !== 'edit') setMode('edit');
    const at = ed.hasFocus() ? ed.selectionEnd : ed.value.length;
    const pre = at === ed.value.length && ed.value && !ed.value.endsWith('\n') ? '\n' : '';
    ed.insert(at, at, pre + link, at + pre.length + link.length);
    toast(`Linked ${displayName(t)}`);
    return;
  }
  const it = e.target.closest('.rl-item');
  if (it) { e.stopPropagation(); if (e.ctrlKey || e.metaKey) openInNewTab(it.dataset.path); else openPath(it.dataset.path); }
}, true);
