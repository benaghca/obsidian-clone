/* Cinder app — conflicting copies and merging two versions of a note.
 * (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.)
 *
 * When OneDrive, Dropbox, Syncthing or Nextcloud can't merge two edits they leave a second
 * copy beside the note ("Note-DESKTOP-AB12C.md", "Note (conflicted copy 2024-…).md",
 * "Note.sync-conflict-20240101-120000-ABC.md"). Cinder spots those, shows a banner on the
 * note, and merges the two: the parts that differ side by side, each kept from either copy,
 * both or neither. The same merge view settles a note changed on disk while being edited. */

// [re, where from]: each re captures (name)(source)(.ext), or (name)(.ext) with a fixed source.
/** @type {[RegExp, string][]} */
const CONFLICT_PATTERNS = [
  [/^(.+?)-((?:DESKTOP|LAPTOP|PC|MACBOOK|WIN|SURFACE)[A-Z0-9-]*|[A-Z][A-Z0-9]{5,}(?:-[A-Z0-9]+)*)(?:-\d+)?(\.[^.\/]+)$/, 'OneDrive'],
  [/^(.+)\.sync-conflict-\d{8}-\d{6}(?:-([A-Z0-9]+))?(\.[^.\/]+)$/, 'Syncthing'],
  [/^(.+) \(([^()]+?)['’]s conflicted copy[^()]*\)(\.[^.\/]+)$/i, 'Dropbox'],
  [/^(.+) \((conflicted copy[^()]*)\)(\.[^.\/]+)$/i, 'sync'],
  [/^(.+) \((Conflict(?:ed)? copy[^()]*)\)(\.[^.\/]+)$/i, 'sync'],
];

// Every conflicting copy in the vault whose original is beside it: [{copy, base, from}]
let conflictsCache = { gen: -1, list: [] };
function conflictCopies() {
  if (conflictsCache.gen === S.dataGen) return conflictsCache.list;
  const list = [];
  for (const p of S.files.keys()) {
    const name = basename(p), dir = dirname(p);
    for (const [re, tool] of CONFLICT_PATTERNS) {
      const m = re.exec(name);
      if (!m) continue;
      const base = join(dir, m[1] + m[3]);
      if (base === p || !S.files.has(base)) continue;
      const who = m[2] && !/^conflict/i.test(m[2]) ? m[2] : '';
      list.push({ copy: p, base, from: who ? `${who} (${tool})` : tool === 'sync' ? 'a sync app' : tool });
      break;
    }
  }
  conflictsCache = { gen: S.dataGen, list };
  return list;
}
const conflictsOf = p => conflictCopies().filter(c => c.base === p || c.copy === p);

// The banner above a note that has (or is) a conflicting copy.
function updateConflictBar() {
  let bar = $('#conflict-bar');
  const cs = S.view === 'note' || S.view === 'canvas' ? conflictsOf(S.cur) : [];
  if (!cs.length) { if (bar) bar.hidden = true; return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'conflict-bar'; bar.setAttribute('role', 'alert');
    $('#main').insertBefore(bar, $('#viewbar').nextSibling);
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-merge]'); if (!b) return;
      resolveConflict(conflictCopies().find(c => c.copy === b.dataset.merge));
    });
  }
  const c = cs[0], isCopy = c.copy === S.cur;
  bar.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/></svg><span>${isCopy
    ? `This is a conflicting copy of <b>${esc(displayName(c.base))}</b>, left by ${esc(c.from)}.`
    : `${cs.length === 1 ? 'A conflicting copy' : `${cs.length} conflicting copies`} of this note ${cs.length === 1 ? 'was' : 'were'} left by ${esc(c.from)}.`}</span><button class="btn" data-merge="${esc(c.copy)}">Compare and merge…</button>`;
  bar.hidden = false;
}

// Merge a conflicting copy into its note; the copy then goes to the trash.
async function resolveConflict(c) {
  if (!c) return;
  if (S.cur === c.base && S.dirty) await save();
  const [a, b] = await Promise.all([c.base, c.copy].map(async p => S.notes.get(p)?.content ?? await api(`/api/raw?path=${enc(p)}&t=${TOKEN}`)));
  const fa = S.files.get(c.base), fb = S.files.get(c.copy);
  const r = await mergeTexts({
    title: `Merge “${displayName(c.base)}”`,
    sub: `${esc(c.from)} couldn’t combine two edits of this note, so it kept both. Choose what to keep from each; the result is saved in the note and the copy goes to the trash.`,
    mine: a, theirs: b,
    mineLabel: `This note · ${fa?.mtime ? new Date(fa.mtime).toLocaleString() : ''}`, theirsLabel: `The copy · ${fb?.mtime ? new Date(fb.mtime).toLocaleString() : ''}`,
    ok: 'Save and remove the copy',
  });
  if (r == null) return;
  if (S.cur === c.base && S.view === 'note') { if (S.mode !== 'edit') setMode('edit'); ed.insert(0, ed.value.length, r, 0, 0); await save(); }
  else await writeFile(c.base, r, fa?.mtime);
  if (isMd(c.base)) resolveNote(c.base);
  await deletePath(c.copy, { confirm: false });
  toast(`Merged. The copy is in the trash.`);
  if (S.cur === c.copy) openPath(c.base);
  updateConflictBar();
}

// Every conflicting copy in the vault, to pick one to merge.
async function listConflicts() {
  const cs = conflictCopies();
  if (!cs.length) return toast('No conflicting copies in this vault');
  const c = await picker({ placeholder: 'Conflicting copies…', items: q => rank(cs, q, c => c.copy).map(c => ({ main: basename(c.copy), sub: `${c.from} · of ${displayName(c.base)}`, value: c })) });
  if (c) resolveConflict(c);
}

// Two versions side by side where they differ. Resolves with the merged text, or null.
// opts: {title, sub (html), mine, theirs, mineLabel, theirsLabel, ok, extra: [[label, value]]}
// An extra button resolves with its value instead.
function mergeTexts(o) {
  return new Promise(resolve => {
    const blocks = CinderDiff.blocks(o.mine, o.theirs);
    // A part only one side has is kept; a part both changed starts as this note's.
    const pick = blocks.map(b => b.same ? null : !b.mine.length ? 'theirs' : !b.theirs.length ? 'mine' : 'mine');
    const nDiff = pick.filter(Boolean).length;
    const back = modal(`<div class="mg">
      <header class="mg-head"><div><h3>${esc(o.title)}</h3><p>${o.sub || ''}</p></div><button class="ib" data-x title="Cancel (Esc)" aria-label="Cancel"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button></header>
      <div class="mg-bar"><span>${nDiff} difference${nDiff === 1 ? '' : 's'}</span><button class="btn" data-all="mine">Use all of this note</button><button class="btn" data-all="theirs">Use all of the copy</button><button class="btn" data-all="both">Keep both everywhere</button>
        <div class="seg"><button class="on" data-v="merge">Choose</button><button data-v="result">Result</button></div></div>
      <div class="mg-cols"><b>${esc(o.mineLabel || 'This version')}</b><b>${esc(o.theirsLabel || 'The other version')}</b></div>
      <div class="mg-body"></div><pre class="mg-result" hidden></pre>
      <footer class="mg-foot">${(o.extra || []).map(([l], i) => `<button class="btn" data-extra="${i}">${esc(l)}</button>`).join('')}<span></span><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${esc(o.ok || 'Save')}</button></footer></div>`);
    back.querySelector('.modal').classList.add('mg-modal');
    const body = $('.mg-body', back), result = $('.mg-result', back);
    const merged = () => blocks.flatMap((b, i) => b.same ? b.same : pick[i] === 'mine' ? b.mine : pick[i] === 'theirs' ? b.theirs : pick[i] === 'both' ? [...b.mine, ...b.theirs] : []).join('\n') + (/\n$/.test(o.mine) || /\n$/.test(o.theirs) ? '\n' : '');
    const lines = (ls, cls) => ls.length ? ls.map(l => `<div class="${cls}">${esc(l) || ' '}</div>`).join('') : '<div class="mg-nothing">(nothing)</div>';
    const draw = () => {
      body.innerHTML = blocks.map((b, i) => {
        if (b.same) {
          const s = b.same, fold = s.length > 6;
          return `<div class="mg-same">${lines(fold ? s.slice(0, 2) : s, 'mg-l')}${fold ? `<div class="mg-fold">${s.length - 4} unchanged lines</div>${lines(s.slice(-2), 'mg-l')}` : ''}</div>`;
        }
        const p = pick[i];
        return `<div class="mg-diff" data-i="${i}"><div class="mg-side mine${p === 'mine' || p === 'both' ? ' kept' : ''}">${lines(b.mine, 'mg-l')}</div><div class="mg-side theirs${p === 'theirs' || p === 'both' ? ' kept' : ''}">${lines(b.theirs, 'mg-l')}</div>
          <div class="mg-pick seg" role="radiogroup">${[['mine', 'This note'], ['theirs', 'The copy'], ['both', 'Both'], ['none', 'Neither']].map(([v, l]) => `<button data-pick="${v}" class="${p === v ? 'on' : ''}" role="radio" aria-checked="${p === v}">${l}</button>`).join('')}</div></div>`;
      }).join('');
      result.textContent = merged();
    };
    const done = v => { back.remove(); resolve(v); };
    body.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      pick[+b.closest('.mg-diff').dataset.i] = b.dataset.pick; draw();
    });
    $('.mg-bar', back).addEventListener('click', e => {
      const a = e.target.closest('[data-all]');
      if (a) { pick.forEach((p, i) => { if (p) pick[i] = a.dataset.all; }); draw(); return; }
      const v = e.target.closest('[data-v]');
      if (v) { for (const x of $$('.mg-bar .seg button', back)) x.classList.toggle('on', x === v); body.hidden = v.dataset.v !== 'merge'; $('.mg-cols', back).hidden = body.hidden; result.hidden = !body.hidden; }
    });
    $$('[data-x]', back).forEach(b => b.onclick = () => done(null));
    $('[data-ok]', back).onclick = () => done(merged());
    $$('[data-extra]', back).forEach(b => b.onclick = () => { back.remove(); resolve(o.extra[+b.dataset.extra][1]); });
    back.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); done(null); } });
    draw();
    $('[data-ok]', back).focus();
  });
}

// A note changed on disk while it had unsaved edits here: merge, keep these edits, or load the disk's.
// Resolves 'mine', 'disk', {text} for a merge, or null to decide later.
async function resolveDiskConflict(p, mine) {
  let disk = '';
  try { disk = await api(`/api/raw?path=${enc(p)}&t=${TOKEN}`); } catch { }
  const r = await mergeTexts({
    title: `“${displayName(p)}” changed outside Cinder`,
    sub: 'It was changed on disk (by another app or a sync) while you had unsaved edits here. Choose what to keep from each version.',
    mine, theirs: disk, mineLabel: 'Your edits here', theirsLabel: 'The version on disk',
    ok: 'Save the merged note', extra: [['Keep only my edits', 'mine'], ['Load the version on disk', 'disk']],
  });
  return r == null ? null : r === 'mine' || r === 'disk' ? r : { text: r };
}
