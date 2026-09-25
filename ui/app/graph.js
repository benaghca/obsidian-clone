/* Cinder app — the graph view. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ graph

function graphData({ local, depth, tags, unresolved, orphans, attach, filter }) {
  const nodes = new Map(), edges = [];
  const add = (id, label, kind) => { if (!nodes.has(id)) nodes.set(id, { id, label, kind, deg: 0 }); return nodes.get(id); };
  const f = (filter || '').toLowerCase();
  const allowFile = p => (isMd(p) || attach || DRAWING_EXT.test(p) || isCanvas(p)) && (!f || p.toLowerCase().includes(f));
  for (const p of S.files.keys()) if (allowFile(p)) add(p, displayName(p), isDrawing(p) ? 'drawing' : isCanvas(p) ? 'canvas' : isMd(p) ? 'note' : 'file');
  for (const [p, c] of S.canvases) {
    if (!nodes.has(p)) continue;
    for (const t of c.refs) if (nodes.has(t) && t !== p) edges.push([p, t]);
  }
  for (const [p, n] of S.notes) {
    if (!nodes.has(p)) continue;
    const seen = new Set();
    n.links.forEach((l, i) => {
      let t = n.out?.[i];
      if (!t) { if (!unresolved || !l.name) return; t = 'unresolved:' + l.name.toLowerCase(); add(t, l.name, 'unresolved'); }
      if (!nodes.has(t) || t === p || seen.has(t)) return;
      seen.add(t); edges.push([p, t]);
    });
    if (tags) for (const tg of n.tags) { const id = 'tag:' + tg; add(id, '#' + tg, 'tag'); edges.push([p, id]); }
  }
  for (const [a, b] of edges) { nodes.get(a).deg++; nodes.get(b).deg++; }
  if (local && S.cur && nodes.has(S.cur)) {
    const adj = new Map();
    for (const [a, b] of edges) { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); }
    const keep = new Set([S.cur]); let frontier = [S.cur];
    for (let d = 0; d < depth; d++) {
      const nx = [];
      for (const x of frontier) for (const y of adj.get(x) || []) if (!keep.has(y)) { keep.add(y); nx.push(y); }
      frontier = nx;
    }
    for (const id of [...nodes.keys()]) if (!keep.has(id)) nodes.delete(id);
  } else if (!orphans) {
    for (const [id, nd] of [...nodes]) if (!nd.deg) nodes.delete(id);
  }
  return { nodes: [...nodes.values()], edges: edges.filter(([a, b]) => nodes.has(a) && nodes.has(b)), current: S.cur };
}

function graphOptions() {
  return {
    local: $('#g-local').checked, depth: +$('#g-depth').value, tags: $('#g-tags').checked,
    unresolved: $('#g-unresolved').checked, orphans: $('#g-orphans').checked, attach: $('#g-attach').checked,
    filter: $('#g-filter').value.trim(),
  };
}

async function openGraph(local) {
  flushDocViews();
  await save();
  rememberPos();
  $('#g-local').checked = !!local;
  showView('graph');
  setSaveState('');
  $('#crumbs').innerHTML = `<b>${local && S.cur ? 'Local graph · ' + esc(noteName(S.cur)) : 'Graph view'}</b>`;
  CinderGraph.refresh(true);
}

const openGraphNode = (id, e) => {
  if (id.startsWith('tag:')) return searchFor('tag:' + id.slice(4));
  if (id.startsWith('unresolved:')) return followLink(id.slice(11), null, null);
  return e?.ctrlKey || e?.metaKey || e?.button === 1 ? openInNewTab(id) : openPath(id);
};
CinderGraph.init($('#graph-canvas'), {
  data: () => graphData(graphOptions()),
  open: (id, e) => openGraphNode(id, e),
  clickOpens: () => $('#g-clickopen').checked,
  onSelect: i => showGraphInfo(i),
});
// The selected node's card: what it links to and what links to it; click one to move there.
function showGraphInfo(i) {
  const box = $('#graph-info');
  if (!i) { box.hidden = true; return; }
  const kindName = { note: 'Note', drawing: 'Drawing', canvas: 'Canvas', file: 'File', tag: 'Tag', unresolved: 'Not created yet' }[i.kind] || '';
  const list = (title, items) => `<h4>${title} <span>${items.length}</span></h4>${items.length ? items.map(x => `<button class="gi-item gi-${esc(x.kind)}" data-id="${esc(x.id)}" title="${esc(x.id)}"><i></i>${esc(x.label)}</button>`).join('') : '<div class="none">None</div>'}`;
  const file = !/^(tag|unresolved):/.test(i.id);
  box.innerHTML = `<div class="gi-head"><div><b>${esc(i.label)}</b><small>${kindName}</small></div><button class="ib" data-gi="close" title="Clear selection (Esc)">×</button></div>
    <div class="gi-actions"><button class="btn" data-gi="open">${i.kind === 'tag' ? 'Search' : i.kind === 'unresolved' ? 'Create' : 'Open'}</button>${file ? '<button class="btn" data-gi="tab">New tab</button><button class="btn" data-gi="local">Local graph</button>' : ''}</div>
    <div class="gi-lists">${list('Links to', i.out)}${list('Linked from', i.in)}</div>`;
  box.hidden = false;
  box.onclick = e => {
    const it = e.target.closest('.gi-item');
    if (it) return CinderGraph.select(it.dataset.id, { center: true });
    const a = e.target.closest('[data-gi]')?.dataset.gi;
    if (a === 'close') CinderGraph.select(null);
    else if (a === 'open') openGraphNode(i.id);
    else if (a === 'tab') openInNewTab(i.id);
    else if (a === 'local') { S.cur = i.id; openPath(i.id, { focus: false }).then(() => openGraph(true)); }
  };
  box.ondblclick = e => { const it = e.target.closest('.gi-item'); if (it) openGraphNode(it.dataset.id); };
}
try { $('#g-clickopen').checked = !!store('graphClickOpens'); } catch { }
// 2D or 3D (remembered), and a slow turn in 3D.
const apply3d = () => {
  const on = $('#g-3d').checked;
  $('.g-spin').hidden = !on;
  CinderGraph.set3d(on);
  CinderGraph.setSpin(on && $('#g-spin').checked);
};
$('#g-3d').checked = !!store('graph3d'); $('#g-spin').checked = !!store('graphSpin');
$('#g-3d').addEventListener('change', e => { store('graph3d', e.target.checked); apply3d(); });
$('#g-spin').addEventListener('change', e => { store('graphSpin', e.target.checked); apply3d(); });
apply3d();
$('#g-clickopen').addEventListener('change', e => store('graphClickOpens', e.target.checked));
// A live-preview editor inside a canvas card. A text card's editor reports its text through
// onChange; a note card's edits the note itself and saves it as you type, like the main editor.
function mountCardEditor(host, o) {
  const note = o.notePath;
  if (note && !S.notes.has(note)) return null;
  let mtime = note ? S.notes.get(note).mtime : 0, timer = null, dirty = false, chain = Promise.resolve();
  const save = () => {
    clearTimeout(timer); timer = null;
    if (!dirty) return chain;
    dirty = false;
    const body = cm.value;
    chain = chain.then(async () => {
      try {
        const r = await api(`/api/file?path=${enc(note)}`, { method: 'PUT', body, headers: mtime ? { 'X-Base-Mtime': String(mtime) } : {} });
        mtime = r.mtime;
        setNote(note, body, r.mtime);
        S.files.set(note, { ...S.files.get(note), mtime: r.mtime, size: new Blob([body]).size });
        resolveNote(note);
        CinderCanvas.refreshFiles();
      } catch (e) {
        if (e.status !== 409) { toast('Save failed: ' + e.message); dirty = true; return; }
        // Changed elsewhere: take the version on disk rather than overwrite it.
        const got = await readMany([note]);
        if (got[note]) { setNote(note, got[note].content, got[note].mtime); resolveNote(note); mtime = got[note].mtime; if (alive) cm.setSilently(got[note].content); }
        toast(`"${noteName(note)}" changed on disk, so the card now shows that version.`, 4000);
      }
    });
    return chain;
  };
  let alive = true;
  const from = () => note || o.from || S.cur;
  const cm = CinderEditor.create(host, editorHooks(from, {
    onChange: () => {
      if (note) { dirty = true; clearTimeout(timer); timer = setTimeout(save, 700); }
      else o.onChange?.(cm.value);
    },
    onFiles: (files, pasted) => { (async () => { for (const f of files) await attachAndLink(f, pasted, cm); })(); },
    ...(note ? {} : { codeBlock: lang => lang === 'tasks' }), // a base block in a text card has no note to save to
  }), {
    vim: cfg.vim,
    keys: editorKeys(),
    placeholder: o.placeholder || '',
    extraKeys: [
      // Tab on a plain line makes a connected card (as on the canvas); in lists it still indents.
      ...(o.onTab ? [{ key: 'Tab', run: v => /^\s*([-*+]|\d+[.)])\s/.test(v.state.doc.lineAt(v.state.selection.main.head).text) ? false : o.onTab() }] : []),
    ],
  });
  cm.load(note ? S.notes.get(note).content : o.text || '');
  regEditor(cm, from);
  // Escape finishes editing unless the editor needs it (a popup, search, Vim insert mode). Caught
  // before the editor sees it, since Vim and the completion keymap claim Escape unconditionally.
  host.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || cm.escapeBusy) return;
    e.preventDefault(); e.stopPropagation();
    o.onExit?.();
  }, true);
  return {
    focus() { cm.focus(); if (!note) cm.setSelectionRange(cm.value.length); },
    destroy() { alive = false; const p = save(); cm.destroy(); return p; },
  };
}

CinderCanvas.init($('#view-canvas'), {
  onChange: () => canvasChanged(),
  renderMarkdown: (el, text, from) => { renderInto(el, text, from || S.cur, 1); for (const cb of $$('input[type=checkbox]', el)) cb.disabled = false; },
  renderFile: (el, p, sub) => renderCanvasFile(el, p, sub),
  fileVersion: p => `${S.files.get(p)?.mtime}|${S.notes.get(p)?.mtime}`,
  fileName: p => displayName(p),
  openFile: (p, sub) => S.files.has(p) ? openPath(p, { heading: sub ? sub.replace(/^#/, '') : undefined }) : toast(`Not found: ${p}`),
  openUrl: url => { if (/^(https?:|mailto:)/i.test(url || '')) window.open(url, '_blank', 'noopener'); },
  pickFile: kind => {
    const files = [...S.files.keys()].filter(p => kind === 'note' ? isMd(p) && !isDrawing(p) : !isMd(p) || isDrawing(p));
    return picker({ placeholder: kind === 'note' ? 'Add a note to the canvas…' : 'Add an image or file to the canvas…', items: q => rank(files, q, displayName).map(p => ({ main: displayName(p), sub: dirname(p), value: p })) });
  },
  importFile: async f => {
    const path = uniquePath(cfg.attachFolder, f.name || `Pasted image ${Date.now()}.png`);
    try { await writeFile(path, f); } catch (e) { toast('Import failed: ' + e.message); return null; }
    if (cfg.attachFolder) S.dirs.add(cfg.attachFolder);
    reindexAll(); renderTree();
    return path;
  },
  fileExists: p => S.files.has(p),
  mountEditor: (host, o) => mountCardEditor(host, o),
  present: on => presentMode(on),
  renderLink: (el, url) => { if (!isWebPage(url) || cfg.webEmbeds === 'off') return false; renderWebEmbed(el, url, '', { fill: true }); return true; },
  viewImage: (p, all) => viewImages(p, all.map(q => ({ src: rawUrl(q), name: basename(q), path: q }))),
  createNoteFromText: async text => {
    const first = (text.split('\n').find(l => l.trim()) || 'Untitled').replace(/^#+\s*/, '').replace(/[\\/:*?"<>|#^[\]]/g, '').trim().slice(0, 60) || 'Untitled';
    const name = await promptModal('Convert card to note', 'Note name', first);
    if (!name) return null;
    if (BAD_NAME.test(name)) { toast('Names can’t contain \\ / : * ? " < > | # ^ [ ]'); return null; }
    const path = uniquePath(cfg.newNoteFolder, name + '.md');
    try { await writeFile(path, text); } catch (e) { toast('Could not create note: ' + e.message); return null; }
    reindexAll(); renderTree();
    return path;
  },
  prompt: (title, label, value) => promptModal(title, label, value),
  menu: (x, y, items) => menu(x, y, items),
  help: html => { const back = modal(html); back.addEventListener('mousedown', e => { if (e.target === back) back.remove(); }); back.tabIndex = -1; back.focus(); back.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === '?') back.remove(); }); },
  toast: msg => toast(msg),
  store: (k, v) => store(k, v),
  modalOpen: () => $('#modal-root').children.length > 0,
});

CinderDraw.init($('#view-drawing'), {
  confirm: (title, message, o) => confirmModal(title, message, o),
  onChange: () => drawingChanged(),
  openLink: link => openDrawingLink(link),
  menu: (x, y, items) => menu(x, y, items),
  prompt: (title, label, value) => promptModal(title, label, value),
  help: html => { const back = modal(html); back.addEventListener('mousedown', e => { if (e.target === back) back.remove(); }); back.tabIndex = -1; back.focus(); back.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === '?') back.remove(); }); },
  toast: msg => toast(msg),
  store: (k, v) => store(k, v),
  modalOpen: () => $('#modal-root').children.length > 0,
  exportFile: kind => exportDrawing(kind),
  copyPNG: onlySelected => copyDrawing('png', onlySelected),
  copySVG: onlySelected => copyDrawing('svg', onlySelected),
  fetchVaultImage: async p => {
    if (!IMG_EXT.test(p) || !S.files.has(p)) return null;
    const blob = await (await fetch(rawUrl(p))).blob();
    return new File([blob], basename(p), { type: blob.type });
  },
});

for (const id of ['g-local', 'g-depth', 'g-tags', 'g-unresolved', 'g-orphans', 'g-attach']) $('#' + id).addEventListener('input', () => CinderGraph.refresh(id === 'g-local' || id === 'g-depth'));
$('#g-filter').addEventListener('input', debounce(() => CinderGraph.refresh(), 200));

