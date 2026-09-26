/* Cinder app — fuzzy ranking, modals, pickers, confirm/prompt, menus. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ fuzzy ranking

function score(q, s) {
  if (!q) return 0;
  const t = s.toLowerCase(); q = q.toLowerCase();
  const i = t.indexOf(q);
  if (i >= 0) return 1000 - i * 3 - t.length * 0.2 + (i === 0 || /[\s\/_\-.]/.test(t[i - 1]) ? 200 : 0) + (t === q ? 500 : 0);
  let sc = 0, j = 0, last = -2;
  for (const c of q) {
    if (c === ' ') continue;
    j = t.indexOf(c, j);
    if (j < 0) return -Infinity;
    sc += j === last + 1 ? 6 : (j === 0 || /[\s\/_\-.]/.test(t[j - 1])) ? 4 : 1;
    last = j; j++;
  }
  return sc - t.length * 0.2;
}
function rank(list, q, key = x => x) {
  if (!q) return [...list].sort((a, b) => collator.compare(key(a), key(b)));
  return list.map(x => [x, score(q, key(x))]).filter(([, s]) => s > -Infinity).sort((a, b) => b[1] - a[1]).map(([x]) => x);
}

// ============================================================ modals, pickers, menus

// When the last dialog closes, focus goes back where it was (the tree, the editor…), unless
// the dialog's action already moved it somewhere.
let focusBeforeModal = null;
new MutationObserver(() => {
  if ($('#modal-root').children.length || !focusBeforeModal) return;
  const f = focusBeforeModal;
  focusBeforeModal = null;
  const a = document.activeElement;
  if (f.isConnected && (!a || a === document.body || !a.isConnected)) f.focus({ preventScroll: true });
}).observe($('#modal-root'), { childList: true });

function modal(html) {
  if (!$('#modal-root').children.length && document.activeElement !== document.body) focusBeforeModal = document.activeElement;
  const back = document.createElement('div');
  back.className = 'backdrop';
  back.innerHTML = `<div class="modal">${html}</div>`;
  $('#modal-root').append(back);
  return back;
}

// items(q) -> [{main, sub, value}] ; resolves with value or null.
// onHighlight(value) is called as the selection moves (for live previews); `initial` preselects a value.
// Whether the last picker choice was made with Ctrl/Cmd held (the quick switcher opens a new tab).
let pickedWithMod = false;
function picker({ placeholder, items, onCreate, foot, onHighlight, initial }) {
  pickedWithMod = false;
  return new Promise(resolve => {
    const back = modal(`<input class="field" placeholder="${esc(placeholder)}" spellcheck="false"><div class="pick-list"></div><div class="pick-foot">${foot || '<span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>'}</div>`);
    const input = $('input', back), list = $('.pick-list', back);
    let cur = [], sel = 0, first = true;
    const draw = () => {
      cur = items(input.value).slice(0, 60);
      if (first && initial !== undefined) { const i = cur.findIndex(c => c.value === initial); if (i >= 0) sel = i; }
      first = false;
      if (onCreate && input.value.trim() && !cur.some(c => c.main.toLowerCase() === input.value.trim().toLowerCase()))
        cur.push({ main: `Create “${input.value.trim()}”`, sub: '⇧↵', create: true });
      sel = Math.min(sel, Math.max(0, cur.length - 1));
      list.innerHTML = cur.map((c, i) => `<div class="pick${i === sel ? ' sel' : ''}" data-i="${i}"><span class="main">${esc(c.main)}</span>${c.sub ? `<span class="sub">${esc(c.sub)}</span>` : ''}</div>`).join('') || '<div class="none">No matches</div>';
      list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
      if (onHighlight && cur[sel] && !cur[sel].create) onHighlight(cur[sel].value);
    };
    const done = v => { back.remove(); resolve(v); };
    const choose = (i, create) => {
      const c = cur[i];
      if (create || c?.create) { if (onCreate && input.value.trim()) { back.remove(); onCreate(input.value.trim()); resolve(null); } return; }
      if (c) done(c.value);
    };
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, cur.length - 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); pickedWithMod = e.ctrlKey || e.metaKey; choose(sel, e.shiftKey); }
      else if (e.key === 'Escape') { e.preventDefault(); done(null); }
    });
    list.addEventListener('mousemove', e => { const d = e.target.closest('.pick'); if (d && +d.dataset.i !== sel) { sel = +d.dataset.i; draw(); } });
    list.addEventListener('click', e => { const d = e.target.closest('.pick'); if (d) { pickedWithMod = e.ctrlKey || e.metaKey; choose(+d.dataset.i); } });
    back.addEventListener('mousedown', e => { if (e.target === back) done(null); });
    draw(); input.focus();
  });
}

// opts.multiline: a text box (Ctrl+Enter submits); opts.raw: don't trim the answer.
// Cinder's own yes/no dialog, in place of the browser's confirm(): resolves true or false.
// o: { ok, cancel (button labels), danger (the OK button is destructive) }
function confirmModal(title, message, o = {}) {
  return new Promise(resolve => {
    const back = modal(`<div class="form confirm"><h3>${esc(title)}</h3>${message ? `<p class="confirm-msg">${esc(message)}</p>` : ''}<div class="row"><button type="button" class="btn" data-c="0">${esc(o.cancel || 'Cancel')}</button><button type="button" class="btn ${o.danger ? 'danger' : 'primary'}" data-c="1">${esc(o.ok || 'OK')}</button></div></div>`);
    const done = v => { back.remove(); resolve(v); };
    back.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) done(b.dataset.c === '1'); });
    back.addEventListener('mousedown', e => { if (e.target === back) done(false); });
    back.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } });
    $('[data-c="1"]', back).focus();
  });
}
const conflictAsk = name => confirmModal(`“${name}” was changed outside Cinder`, 'Keep your version (overwriting the one on disk), or load the version on disk (losing your changes here)?', { ok: 'Keep my version', cancel: 'Load the version on disk' });

function promptModal(title, label, value, opts = {}) {
  return new Promise(resolve => {
    const field = opts.multiline ? '<textarea class="field" name="v" rows="6" spellcheck="false"></textarea>' : '<input class="field" name="v" spellcheck="false" autocomplete="off">';
    const back = modal(`<form class="form"><h3>${esc(title)}</h3><label>${esc(label)}${field}</label><div class="row"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">OK</button></div></form>`);
    const input = $('[name=v]', back); input.value = value ?? ''; input.focus(); input.select();
    const done = v => { back.remove(); resolve(v); };
    $('form', back).addEventListener('submit', e => { e.preventDefault(); done(opts.raw ? input.value : input.value.trim()); });
    $('[data-x]', back).onclick = () => done(null);
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') done(null);
      if (opts.multiline && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(opts.raw ? input.value : input.value.trim()); }
    });
    back.addEventListener('mousedown', e => { if (e.target === back) done(null); });
  });
}

function menu(x, y, items) {
  const root = $('#menu-root');
  root.innerHTML = '';
  const m = document.createElement('div');
  m.className = 'menu';
  m.addEventListener('mousedown', e => e.preventDefault()); // (focus and selection stay where they were)
  items.forEach((it, i) => {
    if (!it) { m.append(document.createElement('hr')); return; }
    const d = document.createElement('div');
    d.textContent = it[0]; if (it[2]) d.className = it[2];
    d.onclick = () => { root.innerHTML = ''; it[1](); };
    m.append(d);
  });
  root.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!m.contains(e.target)) { root.innerHTML = ''; document.removeEventListener('mousedown', h); } }), 0);
}

