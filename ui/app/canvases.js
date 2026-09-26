/* Cinder app — canvas files and the canvas view’s hooks. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ canvases

// Leave a drawing or canvas cleanly: finish any text being typed.
function flushDocViews() {
  if (S.view === 'drawing') CinderDraw.flush();
  if (S.view === 'canvas') CinderCanvas.flush();
}

function indexCanvas(p, content, mtime) {
  let refs = [];
  try { refs = CinderCanvas.fileRefs(CinderCanvas.parseCanvas(content)); } catch { }
  S.canvases.set(p, { mtime, refs });
}

async function openCanvas(p) {
  CinderCanvas.load({ nodes: [], edges: [] }, { path: p }); // don't show the previous canvas while this one loads
  showView('canvas');
  $('#crumbs').innerHTML = crumbsHtml(p);
  document.title = `${displayName(p)} — ${VAULT} — Cinder`;
  setSaveState('');
  renderTreeActive(true);
  refreshPanels();
  const got = /** @type {any} */ (await readMany([p]).catch(e => ({ error: e })));
  if (S.cur !== p) return;
  if (!got[p]) return showDrawingError(p, got.error || new Error('the file couldn’t be read'), 'a canvas');
  loadCanvas(p, got[p].content, got[p].mtime, S.pos.get(p)?.canvas);
}

function loadCanvas(p, content, mtime, view) {
  let data;
  try { data = CinderCanvas.parseCanvas(content); } catch (e) { showDrawingError(p, e, 'a canvas'); return false; }
  S.canvasDoc = { mtime };
  if (S.view !== 'canvas') showView('canvas');
  CinderCanvas.load(data, { view, path: p });
  indexCanvas(p, content, mtime);
  updateStatus();
  return true;
}

function canvasChanged() {
  if (S.view !== 'canvas' || !S.canvasDoc) return;
  S.dirty = true;
  setSaveState('Unsaved');
  scheduleSave();
  updateStatus();
}

async function doSaveCanvas(force) {
  const p = S.cur, d = S.canvasDoc;
  S.dirty = false; setSaveState('Saving…');
  const content = CinderCanvas.serializeCanvas(CinderCanvas.getData());
  try {
    const headers = (!force && d.mtime) ? { 'X-Base-Mtime': String(d.mtime) } : {};
    const r = await api(`/api/file?path=${enc(p)}`, { method: 'PUT', body: content, headers });
    d.mtime = r.mtime;
    S.files.set(p, { ...S.files.get(p), mtime: r.mtime, size: new Blob([content]).size });
    indexCanvas(p, content, r.mtime);
    S.version++;
    if (!S.dirty) setSaveState('Saved');
    refreshPanels(true);
    return;
  } catch (e) {
    S.dirty = true;
    if (e.status !== 409) { setSaveState('Save failed: ' + e.message, true); return; }
  }
  if (await conflictAsk(basename(p))) return doSaveCanvas(true);
  S.dirty = false;
  const got = (await readMany([p]).catch(() => ({})))[p];
  if (got && S.cur === p) loadCanvas(p, got.content, got.mtime, CinderCanvas.getView());
  setSaveState('Reloaded from disk');
}

async function newCanvas(folder) {
  if (folder == null) folder = cfg.newNoteFolder;
  const path = uniquePath(folder, 'Untitled.canvas');
  await createNote(path, CinderCanvas.serializeCanvas({ nodes: [], edges: [] }));
}

// What a file card on a canvas shows.
function renderCanvasFile(el, path, sub) {
  if (!S.files.has(path)) { el.innerHTML = `<p class="cv-empty">Missing: ${esc(path)}</p>`; return; }
  if (IMG_EXT.test(path)) { el.classList.add('cv-image'); el.innerHTML = `<img src="${rawUrl(path)}" alt="" draggable="false">`; return; }
  if (visualEmbed(path)) { const d = document.createElement('div'); el.append(d); renderVisualEmbed(d, path); return; }
  if (isMd(path)) {
    const n = S.notes.get(path);
    el.classList.add('markdown');
    const h = sub ? sub.replace(/^#/, '') : '';
    renderInto(el, n ? (h ? extractSection(n, h) : n.content) : '', path, 1);
    return;
  }
  const f = S.files.get(path);
  el.innerHTML = `<div class="cv-link"><div class="cv-link-host">${esc(basename(path))}</div><div class="cv-empty">${f ? (f.size / 1024).toFixed(1) + ' KB' : ''}</div></div>`;
}

// A picture of the canvas for ![[Board.canvas]] embeds, cached by file version and theme.
const canvasSvgCache = new Map();
function canvasSvgUrl(path) {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  const theme = `${document.documentElement.dataset.theme}|${document.documentElement.dataset.palette}`;
  const key = `${S.files.get(path)?.mtime}|${theme}|${S.version}`;
  const hit = canvasSvgCache.get(path);
  if (hit && hit.key === key) return hit.promise;
  const promise = (async () => {
    const content = (await readMany([path]))[path]?.content;
    if (content == null) throw new Error('file not found');
    const data = CinderCanvas.parseCanvas(content);
    const colors = { 1: v('--cv-red'), 2: v('--cv-orange'), 3: v('--cv-yellow'), 4: v('--cv-green'), 5: v('--cv-cyan'), 6: v('--cv-purple') };
    const svg = CinderCanvas.toSVG(data, {
      colors, text: v('--text'), muted: v('--muted'), bg: v('--bg'), border: v('--border'),
      noteText: p => S.notes.get(p)?.content ?? null, name: p => displayName(p),
    });
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  })();
  canvasSvgCache.set(path, { key, promise });
  if (hit) hit.promise.then(u => setTimeout(() => URL.revokeObjectURL(u), 10000), () => { });
  promise.catch(() => { if (canvasSvgCache.get(path)?.promise === promise) canvasSvgCache.delete(path); });
  return promise;
}
function renderCanvasEmbed(el, path, width) {
  el.classList.add('canvas-embed');
  el.dataset.canvas = path;
  el.title = `${displayName(path)} — click to open the canvas`;
  const img = document.createElement('img');
  img.alt = displayName(path);
  if (width) img.width = width;
  el.replaceChildren(img);
  canvasSvgUrl(path).then(u => { img.src = u; }, e => { el.textContent = `(couldn’t show canvas “${displayName(path)}”: ${e.message})`; });
}

