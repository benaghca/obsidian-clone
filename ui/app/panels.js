/* Cinder app — the sidebars: search, tags, backlinks, outline. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ left panels: search & tags

function showPanel(name, focus = false) {
  const hidden = document.body.classList.contains('app-no-left');
  const current = $$('#left .panel').find(p => !p.hidden)?.id;
  if (!focus && !hidden && current === 'panel-' + name) { toggleSide('left'); return; }
  if (hidden) toggleSide('left');
  for (const p of $$('#left .panel')) p.hidden = p.id !== 'panel-' + name;
  for (const b of $$('#ribbon .rb[data-cmd^=panel-]')) b.classList.toggle('active', b.dataset.cmd === 'panel-' + name);
  if (name === 'search') { const i = $('#search-input'); i.focus(); i.select(); }
  if (name === 'tags') renderTags();
  if (name === 'bookmarks') { loadBookmarks(); if (focus) $('#bookmark-list').focus(); }
  if (name === 'props') { renderPropsPanel(); if (focus) $('#props-filter').focus(); }
}

function toggleSide(which) {
  document.body.classList.toggle(`app-no-${which}`);
  store('layout', { left: !document.body.classList.contains('app-no-left'), right: !document.body.classList.contains('app-no-right') });
  if (S.view === 'graph') CinderGraph.resize();
}

function searchFor(q) {
  showPanel('search', true);
  $('#search-input').value = q;
  runSearch();
}

// Does frontmatter `fm` have property k (any case), with a value containing v (or any value if v is empty)?
function propMatches(fm, k, v) {
  const key = Object.keys(fm || {}).find(x => x.toLowerCase() === k);
  if (key == null) return false;
  const vals = [fm[key]].flat().filter(x => x != null && x !== '').map(x => String(x).toLowerCase());
  return v ? vals.some(x => x.includes(v) || x.replace(/^#/, '') === v.replace(/^#/, '')) : true;
}
function parseQuery(q) {
  const terms = [];
  // [key] or [key:value] (Obsidian's property search), or op:"text" / op:text / plain words.
  const re = /(-?)(?:\[([^\]:]+)(?::\s*(?:"([^"]*)"|([^\]]*)))?\]|(?:(tag|path|file|line):)?(?:"([^"]*)"|(\S+)))/g; let m;
  while ((m = re.exec(q))) {
    if (m[2] != null) { terms.push({ neg: !!m[1], op: 'prop', k: m[2].trim().toLowerCase(), v: (m[3] ?? m[4] ?? '').trim().toLowerCase() }); continue; }
    m = [m[0], m[1], m[5], m[6], m[7]];
    const v = (m[3] ?? m[4] ?? '').toLowerCase();
    if (!v) continue;
    terms.push({ neg: !!m[1], op: m[2] || 'text', v: m[2] === 'tag' ? v.replace(/^#/, '') : v });
  }
  return terms;
}

// The search index (ui/search.js), kept up to date lazily: before a search, the notes that
// changed since the last one are re-indexed.
const searchIx = new CinderSearch.Index();
const searchBody = (p, n) => isDrawing(p) ? n.content.replace(/%%[\s\S]*?(?:%%|$)/g, m => ' '.repeat(m.length)) : n.content;
function syncSearchIndex() {
  for (const [p, n] of S.notes) searchIx.set(p, { key: n.content, title: noteName(p), body: searchBody(p, n), headings: n.headings.map(h => h.text), tags: [...n.tags], mtime: S.files.get(p)?.mtime });
  for (const id of [...searchIx.docs.keys()]) if (!S.notes.has(id)) searchIx.remove(id);
}

function runSearch() {
  const q = $('#search-input').value.trim();
  const out = $('#search-results'), meta = $('#search-meta');
  if (!q) { out.innerHTML = ''; meta.textContent = ''; return; }
  const terms = parseQuery(q);
  // Plain words go to the index (ranked, with prefixes and near misses); phrases and the
  // operators (tag:, path:, file:, [prop], -word) then have to hold as well.
  const plain = terms.filter(t => t.op === 'text' && !t.neg && !/\s/.test(t.v));
  const words = plain.flatMap(t => CinderSearch.tokens(t.v).map(k => k.t));
  const rest = terms.filter(t => !plain.includes(t));
  const phrases = rest.filter(t => t.op === 'text' && !t.neg).map(t => t.v);
  const passes = p => {
    const n = S.notes.get(p);
    const low = searchBody(p, n).toLowerCase(), pl = p.toLowerCase();
    for (const t of rest) {
      let hit;
      if (t.op === 'tag') hit = [...n.tags].some(x => x === t.v || x.startsWith(t.v + '/'));
      else if (t.op === 'path') hit = pl.includes(t.v);
      else if (t.op === 'file') hit = noteName(p).toLowerCase().includes(t.v);
      else if (t.op === 'prop') hit = propMatches(n.fm, t.k, t.v);
      else hit = low.includes(t.v) || noteName(p).toLowerCase().includes(t.v);
      if (hit === t.neg) return false;
    }
    return true;
  };
  let results;
  if (words.length) {
    syncSearchIndex();
    results = searchIx.search(words, { filter: p => S.notes.has(p) && passes(p) }).map(r => ({ p: r.id, pos: Object.values(r.matched).flat(), used: r.used }));
  } else {
    results = [...S.notes.keys()].filter(passes).sort(collator.compare).map(p => ({ p, pos: [], used: [] }));
  }
  // Where the phrases are, too.
  for (const r of results) {
    if (!phrases.length) continue;
    const low = S.notes.get(r.p).content.toLowerCase();
    for (const ph of phrases) { let i = low.indexOf(ph); while (i >= 0 && r.pos.length < 60) { r.pos.push([i, ph.length]); i = low.indexOf(ph, i + ph.length); } }
  }
  const also = [...new Set(results.flatMap(r => r.used))].filter(t => !words.includes(t)).slice(0, 5);
  meta.innerHTML = `${results.length} note${results.length === 1 ? '' : 's'}${also.length ? ` · also matching <i>${also.map(esc).join(', ')}</i>` : ''}`;
  out.innerHTML = results.slice(0, 300).map(r => {
    const c = S.notes.get(r.p).content;
    const snips = [];
    for (const [i, len] of r.pos.sort((a, b) => a[0] - b[0])) if (snips.length < 4 && !snips.some(s => Math.abs(s.i - i) < 60)) snips.push({ i, len });
    const sn = snips.map(s => {
      const a = Math.max(0, s.i - 50), b = Math.min(c.length, s.i + s.len + 70);
      return `<div class="s-snip" tabindex="-1" data-path="${esc(r.p)}" data-i="${s.i}" data-len="${s.len}">${a > 0 ? '…' : ''}${esc(c.slice(a, s.i))}<mark>${esc(c.slice(s.i, s.i + s.len))}</mark>${esc(c.slice(s.i + s.len, b))}${b < c.length ? '…' : ''}</div>`;
    }).join('');
    return `<div class="s-file"><div class="s-file-name" tabindex="-1" data-path="${esc(r.p)}">${esc(noteName(r.p))}<small>${esc(dirname(r.p))}</small>${r.pos.length ? `<small>${r.pos.length}</small>` : ''}</div>${sn}</div>`;
  }).join('');
}
$('#search-input').addEventListener('input', debounce(runSearch, 120));
$('#search-results').addEventListener('click', e => {
  const s = e.target.closest('.s-snip');
  if (s) { const i = +s.dataset.i; return openPath(s.dataset.path, { mode: 'edit', select: [i, i + +s.dataset.len] }); }
  const f = e.target.closest('.s-file-name');
  if (f) openPath(f.dataset.path);
});

// Focusable items in the right pane (backlinks, outgoing links, outline).
const RIGHT_ITEMS = '.bl-file, .bl-ctx, .o-item, a.tag, .rl-item';

// ↑↓ through a panel's items, Enter opens one, Esc goes back (to the search box, or the page).
function listKeys(box, sel, back) {
  box.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const items = $$(sel, box), i = items.indexOf(document.activeElement);
    let n = null;
    if (e.key === 'ArrowDown') n = items[Math.min(items.length - 1, i + 1)];
    else if (e.key === 'ArrowUp') { if (i <= 0) { e.preventDefault(); return back(); } n = items[i - 1]; }
    else if (e.key === 'Home') n = items[0];
    else if (e.key === 'End') n = items[items.length - 1];
    else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); items[i].click(); return; }
    else if (e.key === 'Escape') { e.preventDefault(); return back(); }
    else return;
    e.preventDefault();
    n?.focus(); n?.scrollIntoView({ block: 'nearest' });
  });
}
listKeys($('#search-results'), '.s-file-name, .s-snip', () => $('#search-input').focus());
listKeys($('#right-body'), RIGHT_ITEMS, () => focusMain());
// In the right pane: ←/→ switch between Backlinks, Outgoing and Outline; Space previews a
// heading; L links an unlinked mention.
const RTABS = ['backlinks', 'outgoing', 'outline', 'related', 'calendar'];
function showRight(tab) {
  if (document.body.classList.contains('app-no-right')) toggleSide('right');
  rtab = tab; store('rtab', rtab); refreshPanels();
  const first = $(`#right-body :is(${RIGHT_ITEMS})`);
  if (first) first.focus(); else $(`#right .tabs [data-rtab="${tab}"]`).focus();
}
$('#right').addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !typingIn(e.target)) {
    e.preventDefault();
    showRight(RTABS[(RTABS.indexOf(rtab) + (e.key === 'ArrowRight' ? 1 : RTABS.length - 1)) % RTABS.length]);
  } else if (e.key === ' ' && e.target.matches?.('.o-item[data-heading]')) {
    // Space scrolls the page to a heading without leaving the outline (Enter goes there).
    e.preventDefault();
    const it = e.target;
    scrollToHeading(it.dataset.heading);
    it.focus({ preventScroll: true });
  } else if (e.key.toLowerCase() === 'l' && e.target.matches?.('.bl-ctx')) {
    const b = e.target.querySelector('[data-link]');
    if (b) { e.preventDefault(); b.click(); }
  } else if (e.key === 'ArrowDown' && e.target.matches?.('.tabs button')) {
    e.preventDefault(); $(`#right-body :is(${RIGHT_ITEMS})`)?.focus();
  } else if (e.key === 'Escape' && e.target.matches?.('.tabs button')) { e.preventDefault(); focusMain(); }
});
listKeys($('#tag-list'), '.tag-row', () => focusMain());
listKeys($('#props-list'), '.pr-name, .pr-val', () => $('#props-filter').focus());
$('#props-filter').addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); $('#props-list :is(.pr-name, .pr-val)')?.focus(); } else if (e.key === 'Escape') { e.preventDefault(); focusMain(); } });
$('#search-input').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.isComposing)) {
    const first = $('#search-results .s-file-name');
    if (!first) return;
    e.preventDefault();
    if (e.key === 'Enter') first.click(); else first.focus();
  } else if (e.key === 'Escape' && !e.target.value) { e.preventDefault(); focusMain(); }
});

// Ctrl+Tab: hold Ctrl and press Tab to step through recently opened files (Shift+Tab goes back);
// letting go of Ctrl opens the one selected. Enter or a click opens too; Esc cancels.
let recentBox = null;
function recentSwitcher(step) {
  if (recentBox) return recentBox.move(step);
  const list = S.recent.filter(p => S.files.has(p));
  if (list.length < 2 && !(list.length === 1 && list[0] !== S.cur)) return toast('No other recent files');
  let i = list[0] === S.cur ? (step > 0 ? 1 : list.length - 1) : 0;
  const back = modal(`<div class="rs"><div class="rs-head">Recent files</div><div class="rs-list">${list.map((p, j) => `<div class="rs-item" data-i="${j}"><span>${esc(displayName(p))}</span><small>${esc(dirname(p))}</small></div>`).join('')}</div><div class="pick-foot"><span>hold Ctrl, Tab to move</span><span>release to open</span><span>esc cancel</span></div></div>`);
  back.classList.add('rs-back');
  back.tabIndex = -1; back.focus();
  const draw = () => $$('.rs-item', back).forEach((x, j) => { x.classList.toggle('sel', j === i); if (j === i) x.scrollIntoView({ block: 'nearest' }); });
  const close = open => {
    window.removeEventListener('keyup', up, true);
    back.remove(); recentBox = null;
    if (open) openPath(list[i]).then(() => focusMain());
  };
  const up = e => { if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt') close(true); };
  window.addEventListener('keyup', up, true);
  back.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); recentBox.move(e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1); }
    else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    else if (e.key === 'Escape') { e.preventDefault(); close(false); }
  });
  back.addEventListener('mousedown', e => { const it = e.target.closest('.rs-item'); if (it) { i = +it.dataset.i; close(true); } else if (e.target === back) close(false); });
  recentBox = { move(d) { i = (i + d + list.length) % list.length; draw(); } };
  draw();
}

function renderTags() {
  const counts = new Map();
  for (const n of S.notes.values()) for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
  const list = [...counts].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
  $('#tag-list').innerHTML = list.length
    ? list.map(([t, c]) => `<div class="tag-row" tabindex="-1" data-tag="${esc(t)}"><span>#${esc(t)}</span><span class="n">${c}</span></div>`).join('')
    : '<div class="none">No tags yet. Add #tags to notes or a <code>tags:</code> list in frontmatter.</div>';
}
$('#tag-list').addEventListener('click', e => { const r = e.target.closest('.tag-row'); if (r) searchFor(`tag:${r.dataset.tag}`); });

// ============================================================ right panel

let rtab = store('rtab') || 'backlinks';

function lineAround(content, index) {
  const s = content.lastIndexOf('\n', index - 1) + 1;
  let e = content.indexOf('\n', index); if (e < 0) e = content.length;
  let line = content.slice(s, e).trim();
  if (line.length > 220) { const off = Math.max(0, index - s - 80); line = (off ? '…' : '') + content.slice(s + off, s + off + 200).trim() + '…'; }
  return line;
}

function backlinksOf(p) {
  const res = new Map();
  for (const [q, c] of S.canvases) if (q !== p && c.refs.includes(p)) res.set(q, [{ index: 0, line: `A card on the canvas “${displayName(q)}”` }]);
  for (const [q, n] of S.notes) {
    if (q === p || !n.out) continue;
    n.out.forEach((t, i) => {
      if (t !== p) return;
      if (!res.has(q)) res.set(q, []);
      res.get(q).push({ index: n.links[i].index, line: lineAround(n.content, n.links[i].index) });
    });
  }
  return res;
}

function unlinkedMentions(p) {
  const names = [noteName(p), ...(S.notes.get(p)?.aliases || [])].filter(x => x.length >= 3);
  if (!names.length) return new Map();
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  const res = new Map();
  for (const [q, n] of S.notes) {
    if (q === p) continue;
    const body = blankCode(n.content);
    let m; re.lastIndex = n.fmLen;
    while ((m = re.exec(body))) {
      const i = m.index;
      if (n.links.some(l => i >= l.index && i < l.index + l.len)) continue;
      if (!res.has(q)) res.set(q, []);
      const list = res.get(q);
      if (list.length < 5) list.push({ index: i, len: m[0].length, line: lineAround(n.content, i) });
    }
  }
  return res;
}

function refreshPanels(light = false) {
  const body = $('#right-body');
  // Redrawing the pane shouldn't throw the keyboard out of it.
  const had = body.contains(document.activeElement) ? $$(RIGHT_ITEMS, body).indexOf(document.activeElement) : -1;
  try { drawRight(body, light); } finally {
    for (const x of $$(RIGHT_ITEMS, body)) x.tabIndex = -1;
    if (had >= 0) { const items = $$(RIGHT_ITEMS, body); items[Math.min(had, items.length - 1)]?.focus({ preventScroll: true }); }
  }
}
function drawRight(body, light) {
  for (const b of $$('#right .tabs button')) b.classList.toggle('active', b.dataset.rtab === rtab);
  if (!$('#panel-tags').hidden && !light) renderTags();
  if (!$('#panel-props').hidden && !light) renderPropsPanel();
  if (!$('#panel-search').hidden && $('#search-input').value && !light) runSearch();
  if (S.view === 'graph' && !light) CinderGraph.refresh();
  updateStatus();
  if (rtab === 'calendar') { drawCalendar(body); body.dataset.tab = rtab; return; }
  if (rtab === 'related') { drawRelated(body); body.dataset.tab = rtab; body.dataset.for = S.cur; return; }
  if (!S.cur) { body.innerHTML = '<div class="none">No file open.</div>'; return; }
  const n = S.notes.get(S.cur);
  if (rtab === 'backlinks') {
    const bl = backlinksOf(S.cur);
    let html = `<div class="r-sec"><h4>Linked mentions <span>${[...bl.values()].reduce((a, b) => a + b.length, 0)}</span></h4>`;
    html += bl.size ? [...bl].sort((a, b) => collator.compare(a[0], b[0])).map(([q, items]) =>
      `<div class="bl-file" data-path="${esc(q)}">${esc(noteName(q))}</div>` +
      items.map(it => `<div class="bl-ctx" data-path="${esc(q)}" data-i="${it.index}">${esc(it.line)}</div>`).join('')).join('')
      : '<div class="none">No backlinks.</div>';
    html += '</div>';
    if (isMd(S.cur)) {
      const um = light ? null : unlinkedMentions(S.cur);
      if (um) {
        html += `<div class="r-sec"><h4>Unlinked mentions <span>${um.size}</span></h4>`;
        html += um.size ? [...um].map(([q, items]) =>
          `<div class="bl-file" data-path="${esc(q)}">${esc(noteName(q))}</div>` +
          items.map(it => `<div class="bl-ctx" data-path="${esc(q)}" data-i="${it.index}" data-len="${it.len}"><button data-link>Link</button>${esc(it.line)}</div>`).join('')).join('')
          : '<div class="none">None.</div>';
        html += '</div>';
      } else if (body.dataset.tab === 'backlinks' && body.dataset.for === S.cur) {
        const old = body.querySelectorAll('.r-sec')[1];
        if (old) html += old.outerHTML;
      }
    }
    body.innerHTML = html;
  } else if (rtab === 'outgoing') {
    if (!n) { body.innerHTML = '<div class="none">Not a note.</div>'; }
    else {
      const seen = new Set(), res = [], unres = [];
      n.links.forEach((l, i) => {
        const t = n.out?.[i];
        const key = t || l.name.toLowerCase();
        if (!l.name || seen.has(key) || t === S.cur) return; seen.add(key);
        (t ? res : unres).push(t ? `<div class="o-item" data-path="${esc(t)}">${esc(isMd(t) ? noteName(t) : basename(t))}</div>` : `<div class="o-item unresolved" data-create="${esc(l.name)}" title="Click to create">${esc(l.name)}</div>`);
      });
      const tags = [...n.tags].map(t => `<a class="tag" data-tag="${esc(t)}">#${esc(t)}</a>`).join(' ');
      body.innerHTML = `<div class="r-sec"><h4>Links <span>${res.length}</span></h4>${res.join('') || '<div class="none">None.</div>'}</div>` +
        (unres.length ? `<div class="r-sec"><h4>Unresolved <span>${unres.length}</span></h4>${unres.join('')}</div>` : '') +
        `<div class="r-sec markdown" style="font-size:13px"><h4>Tags</h4>${tags || '<div class="none">None.</div>'}</div>`;
    }
  } else {
    body.innerHTML = n && n.headings.length
      ? '<div class="r-sec">' + n.headings.map(h => `<div class="o-item" style="padding-left:${6 + (h.level - 1) * 14}px" data-heading="${esc(h.text)}">${esc(h.text)}</div>`).join('') + '</div>'
      : '<div class="none">No headings.</div>';
  }
  body.dataset.tab = rtab; body.dataset.for = S.cur;
}

$('#right .tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-rtab]'); if (!b) return;
  rtab = b.dataset.rtab; store('rtab', rtab); refreshPanels();
});
$('#right-body').addEventListener('click', async e => {
  const link = e.target.closest('[data-link]');
  if (link) {
    // Convert an unlinked mention into a [[link]].
    const ctx = link.closest('.bl-ctx');
    const q = ctx.dataset.path, i = +ctx.dataset.i, len = +ctx.dataset.len;
    const n = S.notes.get(q);
    const word = n.content.slice(i, i + len);
    const nm = linkNameFor(S.cur, [...S.files.keys()]);
    const txt = word === nm ? `[[${nm}]]` : `[[${nm}|${word}]]`;
    await writeFile(q, n.content.slice(0, i) + txt + n.content.slice(i + len), n.mtime);
    resolveNote(q); refreshPanels();
    return;
  }
  const c = e.target.closest('.bl-ctx');
  if (c) { const i = +c.dataset.i; return openPath(c.dataset.path, { mode: 'edit', select: [i, i + (+c.dataset.len || 0)] }); }
  const f = e.target.closest('[data-path]');
  if (f) return openPath(f.dataset.path);
  const cr = e.target.closest('[data-create]');
  if (cr) return followLink(cr.dataset.create, null, S.cur);
  const h = e.target.closest('[data-heading]');
  if (h) scrollToHeading(h.dataset.heading);
});
$('#right-body').addEventListener('contextmenu', e => {
  const h = e.target.closest('.o-item[data-heading]');
  if (!h || !S.cur) return;
  e.preventDefault();
  menu(e.clientX, e.clientY, [['Go to heading', () => scrollToHeading(h.dataset.heading)], ['Bookmark heading', () => bookmarkHeading(h.dataset.heading)]]);
});

// Backlink counts, redone only when the vault changes.
let blCountCache = { key: '', n: 0 };
function backlinkCount(p) {
  const key = S.dataGen + ':' + p;
  if (blCountCache.key !== key) blCountCache = { key, n: [...backlinksOf(p).values()].reduce((a, b) => a + b.length, 0) };
  return blCountCache.n;
}
function toggleFocusMode() {
  cfg.focusMode = !cfg.focusMode; saveCfg(); applyTheme(); updateStatus();
  toast(cfg.focusMode ? `Focus mode. ${fmtKey(keyFor(CMD_BY_ID.get('focus-mode'))) || 'The ◎ in the status bar'} brings the side bars back.` : 'Focus mode off');
}

// The status bar: things about the open file, each a button that does the obvious thing.
function updateStatus() {
  const left = $('#status-left'), right = $('#status-right');
  const b = (act, text, title) => `<button class="sb" data-sb="${act}"${title ? ` title="${esc(title)}"` : ''}>${text}</button>`;
  const s = (text, title) => `<span class="sb-t"${title ? ` title="${esc(title)}"` : ''}>${text}</span>`;
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
  const focus = b('focus', `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"${cfg.focusMode ? ' fill="currentColor"' : ''}/></svg>`, cfg.focusMode ? 'Leave focus mode' : 'Focus mode: hide the side bars, dim all but the current paragraph');
  if (S.view === 'tasks') {
    const open = allTasks().filter(x => !x.done && !x.cancelled).length;
    left.innerHTML = '';
    right.innerHTML = s(plural(open, 'open task'));
  } else if (S.view === 'base' && S.cur) {
    left.innerHTML = ''; right.innerHTML = s('Base');
  } else if ((S.view === 'canvas' || S.view === 'drawing') && S.cur) {
    const bl = backlinkCount(S.cur), n = S.view === 'canvas' ? CinderCanvas.count() : CinderDraw.count();
    left.innerHTML = b('backlinks', plural(bl, 'backlink'), 'Show backlinks');
    right.innerHTML = s(S.view === 'canvas' ? `Canvas · ${plural(n, 'card')}` : `Drawing · ${plural(n, 'element')}`);
  } else if (S.view === 'note' && S.cur) {
    const text = ed.value.slice(splitFrontmatter(ed.value).fmLen);
    const words = (text.match(/[\p{L}\p{N}'’_-]+/gu) || []).length;
    const mins = Math.max(1, Math.round(words / 230));
    const bl = backlinkCount(S.cur);
    const tasks = allTasks().filter(x => x.path === S.cur && !x.done && !x.cancelled).length;
    left.innerHTML = b('backlinks', plural(bl, 'backlink'), 'Show backlinks') + (tasks ? b('tasks', plural(tasks, 'open task'), 'Show this note’s tasks') : '');
    const c = S.mode === 'edit' ? ed.cursorInfo() : null;
    const count = cfg.statusChars ? plural(text.length, 'character') : `${plural(words, 'word')} · ${mins} min read`;
    right.innerHTML = (c && c.selected ? s(`${plural(c.words, 'word')} selected`, `${c.selected.toLocaleString()} characters selected`) : '')
      + (c ? s(`Ln ${c.line}, Col ${c.col}`) : '')
      + b('count', count, cfg.statusChars ? 'Show words' : 'Show characters')
      + b('mode', S.mode === 'read' ? 'Reading' : cfg.livePreview ? 'Live preview' : 'Source', 'Switch between reading and editing (Ctrl+E); right-click for source mode')
      + focus;
  } else {
    left.innerHTML = '';
    right.innerHTML = s(`${plural(S.notes.size, 'note')} · ${plural(S.files.size - S.notes.size, 'attachment')}`);
  }
}
$('#statusbar').addEventListener('click', e => {
  const x = e.target.closest('[data-sb]'); if (!x) return;
  const a = x.dataset.sb;
  if (a === 'backlinks') showRight('backlinks');
  else if (a === 'tasks') { const p = S.cur; openTasks().then(() => tasksView?.show('note:' + p)); }
  else if (a === 'count') { cfg.statusChars = !cfg.statusChars; saveCfg(); updateStatus(); }
  else if (a === 'mode') { if (S.view === 'note') setMode(S.mode === 'edit' ? 'read' : 'edit'); updateStatus(); }
  else if (a === 'focus') toggleFocusMode();
});
$('#statusbar').addEventListener('contextmenu', e => {
  if (!e.target.closest('[data-sb=mode]')) return;
  e.preventDefault();
  cfg.livePreview = !cfg.livePreview; saveCfg(); applyTheme(); updateStatus();
});

