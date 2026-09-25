/* Cinder app — drawing files: opening, saving, exporting, embeds. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ drawings

async function openDrawing(p) {
  showView('drawing');
  $('#crumbs').innerHTML = crumbsHtml(p);
  document.title = `${drawingName(p)} — ${VAULT} — Cinder`;
  setSaveState('');
  renderTreeActive(true);
  refreshPanels();
  let content, mtime;
  try {
    if (isMd(p) && S.notes.has(p)) ({ content, mtime } = S.notes.get(p));
    else {
      const got = await readMany([p]);
      if (!got[p]) throw new Error('the file couldn’t be read');
      ({ content, mtime } = got[p]);
    }
  } catch (e) { if (S.cur === p) showDrawingError(p, e); return; }
  if (S.cur !== p) return; // navigated away while reading
  loadDrawing(p, content, mtime, S.pos.get(p)?.draw);
}

// Parse and show a drawing; returns false (and shows why) if it can't be read.
function loadDrawing(p, content, mtime, view) {
  let parsed;
  try { parsed = CinderSketch.parseDrawing(content, p); } catch (e) { showDrawingError(p, e); return false; }
  S.drawing = { mtime, info: { format: parsed.format, source: content, embedded: parsed.embedded || {} } };
  if (S.view !== 'drawing') showView('drawing');
  CinderDraw.load(parsed.scene, { fileUrls: drawingFileUrls(parsed.embedded, p), view, relayout: parsed.relayout });
  updateStatus();
  return true;
}

async function reloadDrawingFromDisk(content, mtime) {
  const p = S.cur;
  if (content == null) {
    const got = await readMany([p]).catch(() => ({}));
    if (!got[p] || S.cur !== p || S.dirty) return;
    ({ content, mtime } = got[p]);
  }
  loadDrawing(p, content, mtime, CinderDraw.getView());
}

function showDrawingError(p, e, what = 'a drawing') {
  S.drawing = null; S.canvasDoc = null;
  showView('file');
  $('#view-file').innerHTML = `<div class="file-info"><p>Couldn’t open “${esc(basename(p))}” as ${what}: ${esc(e.message)}</p>` +
    (isMd(p) ? `<p><a class="btn" data-open-raw="${esc(p)}">Open as Markdown</a></p>` : '') + '</div>';
}

// Images in .excalidraw.md drawings are vault files listed under "Embedded Files".
function drawingFileUrls(embedded, from) {
  const out = {};
  for (const [id, link] of Object.entries(embedded || {})) { const t = resolveLink(link, from); if (t) out[id] = rawUrl(t); }
  return out;
}

function drawingChanged() {
  if (S.view !== 'drawing' || !S.drawing) return;
  S.dirty = true;
  setSaveState('Unsaved');
  scheduleSave();
  updateStatus();
}

function dataURLToBlob(u) {
  const [head, data] = u.split(',');
  const mime = /^data:([^;,]+)/.exec(head)?.[1] || 'application/octet-stream';
  const bin = /;base64/.test(head) ? atob(data) : decodeURIComponent(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// .excalidraw.md drawings keep images as vault attachments, like the Obsidian plugin does.
async function storeDrawingImages(d) {
  let added = false;
  for (const [id, f] of Object.entries(CinderDraw.getScene().files)) {
    if (d.info.embedded[id] || !f.dataURL) continue;
    const ext = ((f.mimeType || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const now = new Date();
    const path = uniquePath(cfg.attachFolder, `Pasted image ${fmtDate(now, 'YYYYMMDDHHmm')}${String(now.getSeconds()).padStart(2, '0')}.${ext}`);
    await writeFile(path, dataURLToBlob(f.dataURL));
    if (cfg.attachFolder) S.dirs.add(cfg.attachFolder);
    reindexAll();
    d.info.embedded[id] = linkNameFor(path, [...S.files.keys()]);
    added = true;
  }
  if (added) renderTree();
}

function drawingContent(d) {
  return CinderSketch.serializeDrawing(CinderDraw.getScene(), d.info);
}

async function doSaveDrawing(force) {
  const p = S.cur, d = S.drawing;
  S.dirty = false; setSaveState('Saving…');
  let err = null;
  try {
    if (d.info.format === 'md') await storeDrawingImages(d);
    const content = drawingContent(d);
    const headers = (!force && d.mtime) ? { 'X-Base-Mtime': String(d.mtime) } : {};
    const r = await api(`/api/file?path=${enc(p)}`, { method: 'PUT', body: content, headers });
    d.mtime = r.mtime; d.info.source = content;
    S.files.set(p, { ...S.files.get(p), mtime: r.mtime, size: new Blob([content]).size });
    if (isMd(p)) { setNote(p, content, r.mtime); resolveNote(p); }
    S.version++;
    if (!S.dirty) setSaveState('Saved');
    refreshPanels(true);
  } catch (e) { err = e; S.dirty = true; }
  if (!err) return;
  if (err.status !== 409) { setSaveState('Save failed: ' + err.message, true); return; }
  const overwrite = await conflictAsk(basename(p));
  if (overwrite) return doSaveDrawing(true);
  S.dirty = false;
  await reloadDrawingFromDisk();
  setSaveState('Reloaded from disk');
}

// A new, empty drawing file in `folder`; returns its path.
async function makeDrawingFile(folder) {
  const md = cfg.drawingFormat === 'md';
  const ext = md ? '.excalidraw.md' : '.excalidraw';
  const now = new Date();
  const stem = `Drawing ${fmtDate(now, 'YYYY-MM-DD HH.mm')}.${String(now.getSeconds()).padStart(2, '0')}`;
  let path = join(folder, stem + ext), i = 1;
  while (S.lowerPath.has(path.toLowerCase()) || S.files.has(path)) path = join(folder, `${stem} ${i++}${ext}`);
  const content = CinderSketch.serializeDrawing(CinderSketch.emptyScene(), md ? { format: 'md', source: '' } : { format: 'json' });
  await writeFile(path, content);
  let d = dirname(path);
  while (d) { S.dirs.add(d); d = dirname(d); }
  reindexAll(); renderTree();
  return path;
}

async function newDrawing(folder) {
  if (folder == null) folder = cfg.newNoteFolder;
  try { await openPath(await makeDrawingFile(folder)); } catch (e) { toast('Could not create drawing: ' + e.message); }
}

// Obsidian Excalidraw's "create new drawing and embed it into the active note".
async function newDrawingInNote() {
  if (S.view !== 'note' || !S.cur) return toast('Open a note first');
  if (S.mode !== 'edit') setMode('edit');
  const a = ed.selectionStart, b = ed.selectionEnd;
  let path;
  try { path = await makeDrawingFile(dirname(S.cur)); } catch (e) { return toast('Could not create drawing: ' + e.message); }
  const before = ed.value.slice(0, a);
  const link = `![[${linkNameFor(path, [...S.files.keys()])}]]`;
  insertText(a, b, (before && !before.endsWith('\n') ? '\n' : '') + link + '\n');
  await openPath(path);
}

// SVG of a drawing for embeds, cached by file version and theme.
const drawingSvgCache = new Map();
let virgilPromise = null;
function virgilData() {
  virgilPromise ||= fetch('/vendor/Virgil.woff2').then(r => r.arrayBuffer()).then(buf => {
    const b = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }).catch(() => null);
  return virgilPromise;
}
const blobToDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

function drawingSvgUrl(path) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const key = `${S.files.get(path)?.mtime}|${S.notes.get(path)?.mtime}|${dark}`;
  const hit = drawingSvgCache.get(path);
  if (hit && hit.key === key) return hit.promise;
  const promise = (async () => {
    const content = isMd(path) ? S.notes.get(path)?.content : (await readMany([path]))[path]?.content;
    if (content == null) throw new Error('file not found');
    const { scene, embedded } = CinderSketch.parseDrawing(content, path);
    const data = {};
    for (const el of scene.elements) {
      if (el.type !== 'image' || !el.fileId || data[el.fileId]) continue;
      if (scene.files[el.fileId]?.dataURL) { data[el.fileId] = scene.files[el.fileId].dataURL; continue; }
      const t = embedded?.[el.fileId] && resolveLink(embedded[el.fileId], path);
      if (t) try { data[el.fileId] = await blobToDataURL(await (await fetch(rawUrl(t))).blob()); } catch { }
    }
    const svg = CinderSketch.toSVG(scene.elements, { dark, fontData: await virgilData(), fileData: id => data[id] });
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  })();
  drawingSvgCache.set(path, { key, promise });
  if (hit) hit.promise.then(u => setTimeout(() => URL.revokeObjectURL(u), 10000), () => { });
  promise.catch(() => { if (drawingSvgCache.get(path)?.promise === promise) drawingSvgCache.delete(path); });
  return promise;
}

function renderVisualEmbed(el, path, width, sub) {
  if (isCanvas(path)) return renderCanvasEmbed(el, path, width);
  if (isBase(path)) return renderBaseEmbed(el, path, sub);
  return renderDrawingEmbed(el, path, width);
}

// Render ![[Drawing.excalidraw]] into `el` (reading view, live preview and note embeds).
function renderDrawingEmbed(el, path, width) {
  el.classList.add('drawing-embed');
  el.dataset.drawing = path;
  el.title = `${drawingName(path)} — click to edit`;
  const img = document.createElement('img');
  img.alt = drawingName(path);
  if (width) img.width = width;
  el.replaceChildren(img);
  drawingSvgUrl(path).then(u => { img.src = u; }, e => { el.textContent = `(couldn’t show drawing “${drawingName(path)}”: ${e.message})`; });
}

async function exportDrawing(kind) {
  if (S.view !== 'drawing' || !S.cur) return toast('Open a drawing first');
  const path = S.cur.replace(DRAWING_EXT, '').replace(/\.md$/i, '') + '.' + kind;
  if (S.files.has(path) && !(await confirmModal(`Replace “${basename(path)}”?`, 'A file with that name is already there.', { ok: 'Replace', danger: true }))) return;
  try {
    const content = kind === 'svg' ? await CinderDraw.exportSVG({ fontData: await virgilData() }) : await CinderDraw.exportPNG();
    await writeFile(path, content, S.files.get(path)?.mtime);
    reindexAll(); renderTree();
    toast(`Saved ${basename(path)}`);
  } catch (e) { toast('Export failed: ' + e.message); }
}

async function copyDrawing(kind, onlySelected) {
  try {
    if (kind === 'png') await navigator.clipboard.write([new ClipboardItem({ 'image/png': CinderDraw.exportPNG({ onlySelected }) })]);
    else await navigator.clipboard.writeText(await CinderDraw.exportSVG({ onlySelected, fontData: await virgilData() }));
    toast(kind === 'png' ? 'Copied as PNG' : 'Copied as SVG');
  } catch (e) { toast('Couldn’t copy: ' + e.message); }
}

// Element links in drawings: [[Note]], a note name, or a web address.
function openDrawingLink(link) {
  const t = String(link).trim();
  const m = /^\[\[([^\]]+)\]\]$/.exec(t);
  if (!m && /^[a-z][a-z0-9+.-]*:/i.test(t)) {
    if (/^(https?:|mailto:)/i.test(t)) window.open(t, '_blank', 'noopener');
    return;
  }
  const [tgt] = splitOnce(m ? m[1] : t, '|');
  const [name, sub] = splitOnce(tgt, '#');
  followLink(name.trim(), sub, S.cur);
}

