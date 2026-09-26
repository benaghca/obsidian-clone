/* Cinder app — version history, and showing what changed between two texts.
 * (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.)
 *
 * Every save is recorded outside the vault (src/history.rs), at most one version per five
 * minutes of editing. "Version history" lists a file's versions, shows what each one changed
 * (or how it differs from now), and restores one. */

// ------------------------------------------------------------ showing a diff

// Draw the changes from `a` to `b` into `el`: hunks of changed lines with a little context,
// line numbers, and the changed words marked within a changed line.
function renderDiff(el, a, b, { context = 3, empty = 'No changes.' } = {}) {
  const rows = CinderDiff.pairChanges(CinderDiff.lines(a, b));
  const h = CinderDiff.hunks(rows, context);
  if (!h.hunks.length) { el.innerHTML = `<div class="df-none">${esc(empty)}</div>`; return h; }
  const words = (r, side) => {
    if (!r.pair) return esc(r.text) || ' ';
    const w = side === '-' ? CinderDiff.words(r.text, r.pair.text) : CinderDiff.words(r.pair.text, r.text);
    return w.filter(o => o.t === '=' || o.t === side).map(o => o.t === '=' ? esc(o.v) : `<mark>${esc(o.v)}</mark>`).join('') || ' ';
  };
  const line = r => `<div class="df-row df-${r.t === '+' ? 'add' : r.t === '-' ? 'del' : 'ctx'}"><span class="df-n">${r.a ?? ''}</span><span class="df-n">${r.b ?? ''}</span><span class="df-s">${r.t === '=' ? '' : r.t === '+' ? '+' : '−'}</span><span class="df-t">${r.t === '=' ? esc(r.text) || ' ' : words(r, r.t)}</span></div>`;
  const skip = n => n ? `<div class="df-skip">${n} unchanged line${n === 1 ? '' : 's'}</div>` : '';
  el.innerHTML = `<div class="df">${h.hunks.map(k => skip(k.skipped) + k.rows.map(line).join('')).join('')}${skip(h.after)}</div>`;
  return h;
}

// ------------------------------------------------------------ version history

const HISTORY_ICON = '<svg viewBox="0 0 24 24"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4.5V9H8M12 7.5V12l3 2"/></svg>';

function histWhen(ms) {
  const d = new Date(ms), now = new Date();
  const mins = Math.round((now - d) / 60000);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (mins < 1) return `Just now · ${time}`;
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago · ${time}`;
  return time;
}
function histDay(ms) {
  const d = new Date(ms), t = new Date();
  const same = (x, y) => x.toDateString() === y.toDateString();
  if (same(d, t)) return 'Today';
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}

async function openHistory(path = S.cur) {
  if (!path) return toast('Open a file first');
  if (path === S.cur && S.dirty) await save();
  let data;
  try { data = await api(`/api/history?path=${enc(path)}`); } catch (e) { return toast('Couldn’t read the history: ' + e.message); }
  const versions = data.versions;
  const cache = new Map();
  const textOf = async v => {
    if (v === 'now') return path === S.cur && S.view === 'note' ? ed.value : S.notes.get(path)?.content ?? await api(`/api/raw?path=${enc(path)}&t=${TOKEN}`).catch(() => '');
    if (!cache.has(v.id)) cache.set(v.id, await api(`/api/history/read?path=${enc(path)}&id=${v.id}`));
    return cache.get(v.id);
  };
  const back = modal(`<div class="hist">
    <nav class="hist-side"><header><h3>${HISTORY_ICON}Version history</h3><div class="hist-file" title="${esc(path)}">${esc(displayName(path))}</div></header>
      <div class="hist-list" role="listbox" tabindex="0" aria-label="Versions"></div>
      <footer>Versions are kept for ${data.keepDays} days, outside the vault.</footer></nav>
    <section class="hist-main"><header class="hist-bar"><div class="seg" role="radiogroup" aria-label="Show"><button data-mode="changes" class="on">What changed</button><button data-mode="now">Compared with now</button><button data-mode="text">Text</button></div>
      <span class="hist-stat"></span><button class="btn" data-copy>Copy</button><button class="btn primary" data-restore>Restore this version</button><button class="ib" data-x title="Close (Esc)" aria-label="Close">${'<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>'}</button></header>
      <div class="hist-body"></div></section></div>`);
  back.querySelector('.modal').classList.add('hist-modal');
  const list = $('.hist-list', back), body = $('.hist-body', back), stat = $('.hist-stat', back);
  let sel = 0, mode = 'changes';
  if (!versions.length) {
    list.innerHTML = '<div class="hist-empty">No versions yet. They’re recorded as you save, one every five minutes while you edit.</div>';
    body.innerHTML = '<div class="df-none">Nothing to show yet.</div>';
    $('[data-restore]', back).disabled = $('[data-copy]', back).disabled = true;
  } else {
    let last = '';
    list.innerHTML = versions.map((v, i) => {
      const day = histDay(v.saved), head = day !== last ? `<h4>${esc(day)}</h4>` : '';
      last = day;
      return `${head}<div class="hist-v" role="option" data-i="${i}"><span class="hist-t">${esc(histWhen(v.saved))}</span><span class="hist-d" data-i="${i}"></span>${i === versions.length - 1 ? '<span class="hist-tag">oldest</span>' : ''}</div>`;
    }).join('');
  }
  const show = async () => {
    if (!versions.length) return;
    for (const r of $$('.hist-v', list)) { r.classList.toggle('on', +r.dataset.i === sel); r.setAttribute('aria-selected', String(+r.dataset.i === sel)); }
    $(`.hist-v[data-i="${sel}"]`, list)?.scrollIntoView({ block: 'nearest' });
    const v = versions[sel], text = await textOf(v);
    if (versions[sel] !== v) return;
    if (mode === 'text') { body.innerHTML = '<pre class="hist-text"></pre>'; $('.hist-text', body).textContent = text; stat.textContent = `${text.length.toLocaleString()} characters`; return; }
    const before = mode === 'now' ? text : (versions[sel + 1] ? await textOf(versions[sel + 1]) : '');
    const after = mode === 'now' ? await textOf('now') : text;
    const h = renderDiff(body, before, after, { empty: mode === 'now' ? 'This version is the same as the file now.' : 'This version didn’t change the text.' });
    stat.innerHTML = h.hunks.length ? `<b class="add">+${h.added}</b> <b class="del">−${h.removed}</b> lines${mode === 'now' ? ' since' : ''}` : '';
  };
  // How much each version changed, filled in as the texts arrive.
  (async () => {
    for (let i = 0; i < versions.length && back.isConnected; i++) {
      const [a, b] = [await textOf(versions[i]), versions[i + 1] ? await textOf(versions[i + 1]) : ''];
      const n = a.length - b.length, el = $(`.hist-d[data-i="${i}"]`, list);
      if (el) { el.textContent = !versions[i + 1] ? `${a.length.toLocaleString()} chars` : n ? (n > 0 ? '+' : '−') + Math.abs(n).toLocaleString() : '±0'; el.className = 'hist-d ' + (!versions[i + 1] ? '' : n > 0 ? 'add' : n < 0 ? 'del' : ''); }
    }
  })();
  const close = () => back.remove();
  list.addEventListener('click', e => { const r = e.target.closest('.hist-v'); if (r) { sel = +r.dataset.i; show(); } });
  list.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(versions.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); show(); }
  });
  $('.seg', back).addEventListener('click', e => {
    const b = e.target.closest('[data-mode]'); if (!b) return;
    mode = b.dataset.mode;
    for (const x of $$('.seg button', back)) x.classList.toggle('on', x === b);
    show();
  });
  $('[data-copy]', back).onclick = async () => { try { await navigator.clipboard.writeText(await textOf(versions[sel])); toast('Copied'); } catch { toast('Couldn’t copy'); } };
  $('[data-restore]', back).onclick = async () => {
    const v = versions[sel], text = await textOf(v);
    close();
    await restoreText(path, text);
    toast(`Restored the version from ${histDay(v.saved).toLowerCase()}, ${new Date(v.saved).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`, 5000);
  };
  $('[data-x]', back).onclick = close;
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  list.focus();
  show();
}

// Put `text` into the file at `path`: through the editor when it's the open note (so Ctrl+Z
// undoes it), otherwise straight to disk. The text it replaces is kept as a version.
async function restoreText(path, text) {
  if (path === S.cur && S.view === 'note') {
    if (S.mode !== 'edit') setMode('edit');
    ed.insert(0, ed.value.length, text, 0, 0);
    await save();
    return;
  }
  try {
    await writeFile(path, text, S.files.get(path)?.mtime);
    if (isMd(path)) resolveNote(path);
    if (isCanvas(path)) indexCanvas(path, text, S.files.get(path).mtime);
    if (path === S.cur) await openPath(path, { push: false });
    else { S.version++; refreshPanels(); }
  } catch (e) { toast('Couldn’t restore: ' + e.message); }
}
