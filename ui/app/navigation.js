/* Cinder app — opening files and moving between them. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ navigation

function showView(v) {
  if (S.view === 'inbox' && v !== 'inbox') store('inboxSeen', Date.now()); // leaving the inbox: it's all been seen
  S.view = v;
  for (const id of ['note', 'file', 'graph', 'drawing', 'canvas', 'base', 'tasks', 'inbox', 'empty']) $(`#view-${id}`).hidden = id !== v;
  $('#mode-btn').hidden = v !== 'note';
  if (v === 'graph') CinderGraph.show(); else CinderGraph.hide();
  if (v === 'drawing') CinderDraw.show(); else CinderDraw.hide();
  if (v === 'canvas') CinderCanvas.show(); else CinderCanvas.hide();
  updateHistButtons();
  if (S.tabs) syncTab();
  applyNoteClasses();
  updateTemplateBar();
}

function showEmpty() {
  showView('empty');
  $('#crumbs').textContent = '';
  setSaveState('');
  document.title = `${VAULT} — Cinder`;
  renderTreeActive(); refreshPanels(); updateStatus();
}

function rememberPos() {
  if (S.cur && S.view === 'drawing') { S.pos.set(S.cur, { draw: CinderDraw.getView() }); return; }
  if (S.cur && S.view === 'canvas') { S.pos.set(S.cur, { canvas: CinderCanvas.getView() }); return; }
  if (S.cur && S.view === 'base') { if (baseView) S.pos.set(S.cur, { baseView: baseView.viewName() }); return; }
  if (!S.cur || S.view !== 'note') return;
  if (S.tabs.some(t => t.key === S.cur)) edStates.set(S.cur, ed.getState()); // (undo history, per tab)
  S.pos.set(S.cur, { a: ed.selectionStart, b: ed.selectionEnd, scroll: editWrap.scrollTop, pscroll: preview.scrollTop });
}

async function openPath(p, opts = {}) {
  if (!p) return;
  flushDocViews();
  await save();
  rememberPos();
  if (!S.files.has(p)) { toast(`Not found: ${p}`); return; }
  if (opts.push !== false && S.hist[S.histIdx] !== p) {
    S.hist = S.hist.slice(0, S.histIdx + 1); S.hist.push(p); S.histIdx = S.hist.length - 1;
  }
  S.cur = p; S.dirty = false; S.drawing = null; S.canvasDoc = null; S.baseDoc = null;
  store('last', p);
  S.recent = [p, ...S.recent.filter(x => x !== p)].slice(0, 40); store('recentFiles', S.recent);
  if (isDrawing(p) && !opts.raw) return openDrawing(p);
  if (isCanvas(p)) return openCanvas(p);
  if (isBase(p)) return openBase(p);
  if (!isMd(p)) return openAttachment(p);
  const n = S.notes.get(p);
  showView('note');
  titleEl.value = noteName(p);
  const kept = edStates.get(p);
  if (kept && n && kept.doc.toString() === n.content) ed.setState(kept); else ed.load(n ? n.content : '');
  applyNoteClasses();
  setSaveState('');
  const pos = S.pos.get(p);
  setMode(opts.mode || S.mode, true);
  if (pos && pos.a != null) {
    ed.setSelectionRange(pos.a, pos.b); editWrap.scrollTop = pos.scroll; preview.scrollTop = pos.pscroll;
    requestAnimationFrame(() => { editWrap.scrollTop = pos.scroll; });
  } else { editWrap.scrollTop = 0; preview.scrollTop = 0; }
  $('#crumbs').innerHTML = crumbsHtml(p);
  document.title = `${noteName(p)} — ${VAULT} — Cinder`;
  renderTreeActive(true);
  refreshPanels();
  updateStatus();
  if (opts.heading) scrollToHeading(opts.heading);
  if (opts.select) selectRange(opts.select[0], opts.select[1]);
  if (opts.focusTitle) { titleEl.focus(); titleEl.select(); }
  else if (S.mode === 'edit' && opts.focus !== false) ed.focus();
}

function crumbsHtml(p) {
  const parts = p.split('/');
  const last = parts.pop();
  return parts.map(x => `${esc(x)} / `).join('') + `<b>${esc(isMd(last) ? last.slice(0, -3) : last)}</b>`;
}

let fileViewer = null;
function openAttachment(p) {
  showView('file');
  const v = $('#view-file');
  const f = S.files.get(p);
  const kb = f ? (f.size / 1024).toFixed(1) + ' KB' : '';
  fileViewer?.destroy(); fileViewer = null;
  if (IMG_EXT.test(p)) {
    // Zoomable, with ← → through the other images in the folder.
    const dir = dirname(p);
    const items = [...S.files.keys()].filter(q => dirname(q) === dir && IMG_EXT.test(q)).sort(collator.compare).map(q => ({ src: rawUrl(q), name: `${basename(q)} · ${((S.files.get(q)?.size || 0) / 1024).toFixed(1)} KB`, path: q }));
    const { onCopy, onCrop, onAnnotate } = imageActions();
    fileViewer = CinderImages.viewer(v, items, items.findIndex(it => it.path === p), { onCopy, onCrop, onAnnotate });
    fileViewer.focus();
  } else v.innerHTML = `<div class="file-info"><p>${esc(p)} · ${kb}</p><p><a class="btn" href="${rawUrl(p)}" target="_blank" rel="noopener">Open in new tab</a></p></div>`;
  $('#crumbs').innerHTML = crumbsHtml(p);
  renderTreeActive(true); refreshPanels(); updateStatus();
}

