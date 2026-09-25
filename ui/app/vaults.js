/* Cinder app — the vault switcher. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ------------------------------------------------------------ vaults

// The vault switcher: recent vaults, the system's folder picker (or a built-in folder browser),
// and making a new vault. Switching saves, then reloads the app on the new folder.
async function switchVault() {
  let v;
  try { v = await api('/api/vaults'); } catch (e) { return toast(e.message); }
  const back = modal(`<div class="vs">
    <div class="vs-head"><h3>Vaults</h3><button class="ib" data-x title="Close (Esc)">×</button></div>
    <div class="vs-list" role="listbox"></div>
    <div class="vs-actions">
      <button class="btn primary" data-a="open">Open folder…</button>
      <button class="btn" data-a="create">Create new vault…</button>
      <button class="btn vs-typed" data-a="typed">Type a path…</button>
    </div>
    <div class="vs-panel" hidden></div>
  </div>`);
  back.querySelector('.modal').classList.add('wide');
  back.tabIndex = -1;
  const list = $('.vs-list', back), panel = $('.vs-panel', back);
  const close = () => back.remove();
  const drawList = () => {
    list.innerHTML = v.recent.length ? v.recent.map((r, i) => `<div class="vs-row${r.current ? ' current' : ''}${r.exists ? '' : ' missing'}" role="option" tabindex="-1" data-i="${i}">
      <div class="vs-icon">${esc((r.name || '?').slice(0, 1).toUpperCase())}</div>
      <div class="vs-text"><b>${esc(r.name)}</b><small>${esc(r.path)}</small></div>
      ${r.current ? '<span class="vs-badge">Open now</span>' : r.exists ? '' : '<span class="vs-badge warn">Missing</span>'}
      ${r.current ? '' : '<button class="ib vs-forget" title="Remove from this list (the folder stays)">×</button>'}
    </div>`).join('') : '<div class="none">No other vaults yet.</div>';
  };
  drawList();
  const go = async (path, create = false) => {
    if (!create && path === v.current) return close();
    await save();
    try { await api('/api/vault', { method: 'POST', body: JSON.stringify({ path, create }) }); }
    catch (e) { return toast('Couldn’t open that folder: ' + e.message, 5000); }
    location.reload();
  };
  const join = (a, b) => a.endsWith(v.sep) ? a + b : a + v.sep + b;
  const parentOf = p => p.slice(0, Math.max(p.lastIndexOf(v.sep), p.indexOf(v.sep) + 1)) || p;

  // Ask the system for a folder; without a picker, browse in here.
  const pickFolder = async (start, title) => {
    try {
      const r = await fetch(`/api/pick-folder?start=${enc(start || '')}`, { method: 'POST', headers: { 'X-Cinder-Token': TOKEN } });
      if (r.status === 204) return null; // cancelled
      if (r.ok) { const j = await r.json(); if (j.path) return j.path; }
    } catch { }
    return browseFolder(start, title);
  };
  // The built-in folder browser (shown in the dialog): resolves with a path or null.
  const browseFolder = (start, title) => new Promise(resolve => {
    panel.hidden = false;
    let at = start;
    const show = async where => {
      let d;
      try { d = await api(`/api/dirs?path=${enc(where || '')}`); } catch (e) { toast(e.message); if (where) return show(''); return; }
      at = d.path;
      const crumbs = d.path.split(v.sep).filter(Boolean);
      const lead = d.path.startsWith(v.sep) ? v.sep : '';
      panel.innerHTML = `<div class="vs-browse">
        <div class="vs-bhead"><b>${esc(title)}</b><div class="vs-roots">${d.roots.map(r => `<button class="btn vs-root" data-go="${esc(r)}">${esc(r)}</button>`).join('')}<button class="btn vs-root" data-go="${esc(d.home)}">Home</button></div></div>
        <div class="vs-crumbs">${crumbs.map((c, i) => `<button data-go="${esc(lead + crumbs.slice(0, i + 1).join(v.sep) + (i === 0 && !lead ? v.sep : ''))}">${esc(c)}</button>`).join('<span>›</span>')}</div>
        <div class="vs-dirs" tabindex="-1">${d.parent ? `<button class="vs-dir up" data-go="${esc(d.parent)}">⬑ Up</button>` : ''}${d.dirs.map(n => `<button class="vs-dir" data-go="${esc(join(d.path, n))}">📁 ${esc(n)}</button>`).join('') || '<div class="none">No folders here.</div>'}</div>
        <div class="vs-bfoot"><span class="vs-note">${d.isVault ? 'This folder has notes in it.' : ''}</span><button class="btn" data-b="newdir">New folder…</button><button class="btn" data-b="cancel">Cancel</button><button class="btn primary" data-b="use">Use this folder</button></div>
      </div>`;
      $('.vs-dirs button', panel)?.focus();
    };
    panel.onclick = async e => {
      const g = e.target.closest('[data-go]');
      if (g) return show(g.dataset.go);
      const b = e.target.closest('[data-b]')?.dataset.b;
      if (b === 'cancel') { panel.hidden = true; resolve(null); }
      else if (b === 'use') { panel.hidden = true; resolve(at); }
      else if (b === 'newdir') {
        const n = (await promptModal('New folder', `In ${at}`, ''))?.trim();
        if (!n) return;
        if (/[\\/:*?"<>|]/.test(n)) return toast('Folder names can’t contain \\ / : * ? " < > |');
        panel.hidden = true; resolve(join(at, n) + '\u0000new');
      }
    };
    show(start);
  });

  const createFlow = async () => {
    panel.hidden = false;
    let where = parentOf(v.current);
    const draw = () => {
      panel.innerHTML = `<form class="vs-create"><b>Create a new vault</b>
        <label>Name<input class="field" name="n" placeholder="e.g. Research" spellcheck="false" autocomplete="off"></label>
        <label>Location<div class="vs-loc"><span>${esc(where)}</span><button type="button" class="btn" data-c="where">Change…</button></div></label>
        <div class="vs-bfoot"><span class="vs-note"></span><button type="button" class="btn" data-c="cancel">Cancel</button><button class="btn primary">Create and open</button></div></form>`;
      const f = $('form', panel);
      f.elements.n.focus();
      f.elements.n.addEventListener('input', () => { $('.vs-note', panel).textContent = f.elements.n.value.trim() ? join(where, f.elements.n.value.trim()) : ''; });
      f.onsubmit = e => {
        e.preventDefault();
        const n = f.elements.n.value.trim();
        if (!n) return f.elements.n.focus();
        if (/[\\/:*?"<>|]/.test(n)) return toast('Vault names can’t contain \\ / : * ? " < > |');
        go(join(where, n), true);
      };
      panel.onclick = async e => {
        const c = e.target.closest('[data-c]')?.dataset.c;
        if (c === 'cancel') panel.hidden = true;
        else if (c === 'where') {
          const name = f.elements.n.value;
          const p = await pickFolder(where, 'Where should the new vault go?');
          panel.hidden = false;
          if (p) where = p.replace(/\u0000new$/, '');
          draw(); $('form', panel).elements.n.value = name;
        }
      };
    };
    draw();
  };

  back.addEventListener('click', async e => {
    if (e.target.closest('[data-x]')) return close();
    const row = e.target.closest('.vs-row');
    if (row) {
      const r = v.recent[+row.dataset.i];
      if (e.target.closest('.vs-forget')) {
        v = await api('/api/vaults/forget', { method: 'POST', body: JSON.stringify({ path: r.path }) });
        drawList();
        return ($$('.vs-row', list)[Math.min(+row.dataset.i, v.recent.length - 1)] || back).focus(); // keep the keyboard here
      }
      if (!r.exists) return toast('That folder isn’t there any more. Remove it from the list with ×.');
      return go(r.path);
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'open') {
      const p = await pickFolder(v.home, 'Open a folder as a vault');
      if (p) go(p.replace(/\u0000new$/, ''), p.endsWith('\u0000new'));
    } else if (a === 'create') createFlow();
    else if (a === 'typed') {
      const p = (await promptModal('Open a vault', 'Full path to a folder of notes', v.current))?.trim();
      if (p) go(p);
    }
  });
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  // ↑↓ through the list, Enter opens, Delete forgets; Esc closes (or backs out of a panel).
  back.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); if (!panel.hidden) panel.hidden = true; else close(); return; }
    if (typingIn(e.target)) return;
    const rows = $$('.vs-row', list), i = rows.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
    else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); rows[i].click(); }
    else if (e.key === 'Delete' && i >= 0) { e.preventDefault(); rows[i].querySelector('.vs-forget')?.click(); }
  });
  (list.querySelector('.vs-row:not(.current)') || list.querySelector('.vs-row'))?.focus();
}

