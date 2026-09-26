/* Cinder app — images: viewer, resizing, crop, annotate, screenshots. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ images: viewer, resize, crop, annotate, screenshots

// Editors by their .cm-editor element, so image clicks and grips know whose text to change.
const EDITORS = new WeakMap(); // dom -> { ed, from() }
const regEditor = (e, from) => { EDITORS.set(e.view.dom, { ed: e, from }); return e; };
regEditor(ed, () => S.cur);

// The vault path behind an image URL we produced with rawUrl().
const pathOfUrl = src => { try { const u = new URL(src, location.href); return u.pathname === '/api/raw' ? u.searchParams.get('path') : null; } catch { return null; } };

// Every vault image embedded in `text`, in order, for browsing with ← → in the viewer.
function imagesIn(text, from) {
  const out = [], seen = new Set();
  for (const l of parseNote(text || '').links) {
    if (!l.embed) continue;
    const p = resolveLink(l.name, from);
    if (p && IMG_EXT.test(p) && !seen.has(p)) { seen.add(p); out.push({ src: rawUrl(p), name: basename(p), path: p }); }
  }
  return out;
}

function viewImages(path, list, ctx = {}) {
  const items = list.length ? list : [];
  let i = items.findIndex(it => it.path === path);
  if (i < 0) { items.unshift({ src: rawUrl(path), name: basename(path), path }); i = 0; }
  return CinderImages.lightbox(items, i, imageActions(ctx));
}

// What the viewer's buttons do. ctx.retarget(newPath) repoints the embed the image came from.
function imageActions(ctx = {}) {
  return {
    onOpen: it => openPath(it.path),
    onCopy: it => copyImage(it.path),
    onCrop: it => cropImage(it.path, ctx),
    onAnnotate: it => annotateImage(it.path, ctx),
  };
}

const imageBlob = async p => { const r = await fetch(rawUrl(p)); if (!r.ok) throw new Error(r.statusText); return r.blob(); };

async function copyImage(p) {
  try {
    let blob = await imageBlob(p);
    if (blob.type !== 'image/png') { // the clipboard reliably takes PNG only
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      blob = await new Promise(r => c.toBlob(r, 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Image copied');
  } catch (e) { toast('Couldn’t copy the image: ' + e.message); }
}

// Save `blob` next to `like` as "<name> (<suffix>).<ext>" and return the new path.
async function saveBeside(like, suffix, blob, ext) {
  const stem = basename(like).replace(/\.[^.]+$/, '');
  const path = uniquePath(dirname(like), `${stem} (${suffix}).${ext}`);
  await writeFile(path, blob);
  reindexAll(); renderTree();
  return path;
}

// Crop into a copy (the original stays), then point the embed at the copy.
async function cropImage(p, ctx = {}) {
  const blob = await CinderImages.crop(rawUrl(p));
  if (!blob) return;
  let np;
  try { np = await saveBeside(p, 'cropped', blob, 'png'); } catch (e) { return toast('Couldn’t save the cropped image: ' + e.message); }
  if (ctx.retarget) ctx.retarget(np); else openPath(np);
  toast(`Saved ${basename(np)}`);
}

// Turn an image into a drawing with the image locked underneath, swap the embed for the
// drawing, and open it for marking up.
async function annotateImage(p, ctx = {}) {
  let blob;
  try { blob = await imageBlob(p); } catch (e) { return toast('Couldn’t read the image: ' + e.message); }
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) return toast('Couldn’t read the image');
  const md = cfg.drawingFormat === 'md';
  const scene = CinderSketch.emptyScene(), id = CinderSketch.randomId(40);
  scene.elements.push(CinderSketch.newElement('image', { x: 0, y: 0, width: bmp.width, height: bmp.height, fileId: id, locked: true, strokeColor: 'transparent', backgroundColor: 'transparent' }));
  const embedded = {};
  // .excalidraw.md points at the vault file (like the Obsidian plugin); .excalidraw carries the image.
  if (md) embedded[id] = p;
  else scene.files[id] = { mimeType: blob.type || 'image/png', id, dataURL: await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); }), created: Date.now() };
  const stem = basename(p).replace(/\.[^.]+$/, '');
  const path = uniquePath(dirname(p), `${stem} (annotated).${md ? 'excalidraw.md' : 'excalidraw'}`);
  try { await writeFile(path, CinderSketch.serializeDrawing(scene, md ? { format: 'md', source: '', embedded } : { format: 'json' })); }
  catch (e) { return toast('Couldn’t create the drawing: ' + e.message); }
  reindexAll(); renderTree();
  if (ctx.retarget) { ctx.retarget(path); await save(); }
  await openPath(path);
}

// The embed on `line` that overlaps [from, to] (or starts at `from` when it's a point); an embed
// that merely ends where the range starts doesn't count.
function embedAt(line, from, to) {
  return parseNote(line.text).links.find(k => {
    const s = line.from + k.index, e = s + k.len;
    return k.embed && s < Math.max(to, from + 1) && e > from;
  });
}

// Rewrite the image embed covering [from, to] in editor `e`: a new target and/or width.
// width: a number, null to remove it, undefined to keep it.
/** @param {{target?: string, width?: number | null}} [change] */
function editImageEmbed(e, from, to, change = {}) {
  const { target, width } = change;
  const doc = e.view.state.doc, line = doc.lineAt(from), text = line.text;
  const l = embedAt(line, from, to);
  if (!l) return false;
  const raw = text.slice(l.index, l.index + l.len);
  let out;
  if (!l.md || (target && !IMG_EXT.test(target))) {
    // Wiki embed (a drawing always becomes one, since ![](…) can't show it).
    const inner = l.md ? null : raw.slice(3, -2);
    const [tgt, alias] = inner ? splitOnce(inner, '|') : [null, null];
    const oldW = l.md ? altWidthOf(l.text) : (alias && /^\d+(x\d+)?$/.test(alias.trim()) ? alias.trim() : null);
    const w = width === undefined ? oldW : width;
    const name = target ? linkNameFor(target, [...S.files.keys()]) : tgt;
    out = `![[${name}${w ? '|' + w : ''}]]`;
  } else {
    const m = /^!\[([^\]]*)\]\((.*)\)$/s.exec(raw);
    if (!m) return false;
    const base = m[1].replace(/\|\d+(x\d+)?$/, ''), oldW = altWidthOf(m[1]);
    const w = width === undefined ? oldW : width;
    const href = target ? relPath(dirname(e === ed ? S.cur : EDITORS.get(e.view.dom)?.from() || ''), target).split('/').map(enc).join('/') : m[2];
    out = `![${base}${w ? '|' + w : ''}](${href})`;
  }
  if (out !== raw) e.view.dispatch({ changes: { from: line.from + l.index, to: line.from + l.index + l.len, insert: out } });
  return true;
}
const altWidthOf = alt => /\|(\d+(?:x\d+)?)$/.exec(alt || '')?.[1] || null;

// The editor, range and path behind an image widget element.
function imageWidgetInfo(wrap) {
  const reg = EDITORS.get(wrap.closest('.cm-editor'));
  if (!reg) return null;
  let pos;
  try { pos = reg.ed.view.posAtDOM(wrap); } catch { return null; }
  const block = wrap.classList.contains('cm-image-block');
  const line = reg.ed.view.state.doc.lineAt(pos);
  const img = wrap.querySelector('img');
  return { ...reg, from: block ? line.from : pos, to: block ? line.to : pos, path: pathOfUrl(img?.src), img, note: reg.from() };
}

function revealInTree(p) {
  showPanel('files', true);
  for (let d = dirname(p); d; d = dirname(d)) S.expanded.add(d);
  store('expanded', [...S.expanded]);
  renderTree();
  const r = $(`#tree .t-row[data-path="${CSS.escape(p)}"]`);
  if (!r) return;
  r.scrollIntoView({ block: 'center' });
  r.classList.add('flash');
  setTimeout(() => r.classList.remove('flash'), 1200);
}

function imageMenu(x, y, path, ctx) {
  const items = [
    ['Open in viewer', () => ctx.view()],
    ['Open image file', () => openPath(path)],
    ['Copy image', () => copyImage(path)],
  ];
  if (ctx.resize) items.push(null, ['Small (240 px)', () => ctx.resize(240)], ['Medium (480 px)', () => ctx.resize(480)], ['Large (800 px)', () => ctx.resize(800)], ['Original size', () => ctx.resize(null)]);
  items.push(null, ['Crop…', () => cropImage(path, ctx)], ['Annotate in a drawing', () => annotateImage(path, ctx)]);
  items.push(null, ['Reveal in file tree', () => revealInTree(path)],
    ['Rename image…', async () => { const n = await promptModal('Rename image', 'New name', basename(path).replace(/\.[^.]+$/, '')); if (n && n.trim()) renamePath(path, join(dirname(path), n.trim() + (/\.[^.]+$/.exec(path)?.[0] || ''))); }]);
  if (ctx.remove) items.push(['Remove from note', () => ctx.remove()]);
  items.push(['Delete image file…', () => deletePath(path)]);
  menu(x, y, items);
}

// Live-preview images: click to view, right-click for the menu, drag the corner grip to resize.
function editorImageCtx(info) {
  const e = info.ed;
  const at = () => { // the widget may have moved since the menu opened
    const i = imageWidgetInfo(info.wrap);
    return i || info;
  };
  return {
    view: () => viewImages(info.path, imagesIn(e.value, info.note), editorImageCtx(info)),
    resize: w => { const i = at(); editImageEmbed(e, i.from, i.to, { width: w }); },
    retarget: np => { const i = at(); editImageEmbed(e, i.from, i.to, { target: np }); },
    remove: () => { const i = at(); const doc = e.view.state.doc, line = doc.lineAt(i.from); const l = embedAt(line, i.from, i.to); if (l) e.view.dispatch({ changes: { from: line.from + l.index, to: line.from + l.index + l.len, insert: '' } }); },
  };
}

document.addEventListener('click', e => {
  const wrap = e.target.closest('.cm-editor .cm-image');
  if (!wrap || e.target.closest('.cm-img-grip') || e.button !== 0) return;
  const info = imageWidgetInfo(wrap);
  if (!info?.path) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) return openPath(info.path);
  editorImageCtx({ ...info, wrap }).view();
});
document.addEventListener('contextmenu', e => {
  const wrap = e.target.closest('.cm-editor .cm-image');
  if (wrap) {
    const info = imageWidgetInfo(wrap);
    if (!info?.path) return;
    e.preventDefault();
    return imageMenu(e.clientX, e.clientY, info.path, editorImageCtx({ ...info, wrap }));
  }
  const img = e.target.closest('#preview img[data-path], .embed img[data-path], .cv-content img[data-path]');
  if (img) { e.preventDefault(); imageMenu(e.clientX, e.clientY, img.dataset.path, { view: () => viewImages(img.dataset.path, readingImages(img)) }); }
});
document.addEventListener('pointerdown', e => {
  const grip = e.target.closest('.cm-editor .cm-img-grip');
  if (!grip || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const wrap = grip.closest('.cm-image'), img = wrap.querySelector('img');
  const info = imageWidgetInfo(wrap);
  if (!info) return;
  const x0 = e.clientX, w0 = img.getBoundingClientRect().width;
  const max = wrap.closest('.cm-content').clientWidth;
  let w = w0;
  wrap.classList.add('resizing');
  grip.setPointerCapture(e.pointerId);
  const move = ev => { w = Math.round(Math.max(32, Math.min(max, w0 + ev.clientX - x0))); img.style.width = w + 'px'; img.style.height = 'auto'; grip.dataset.w = w; };
  const up = () => {
    grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
    wrap.classList.remove('resizing');
    if (Math.abs(w - w0) >= 2) editImageEmbed(info.ed, info.from, info.to, { width: w });
  };
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
}, true);

// Reading view (and embeds, canvas cards): click an image to view it, with ← → through the rest.
function readingImages(img) {
  const scope = img.closest('#preview, .embed, .cv-content') || document;
  const seen = new Set();
  return $$('img[data-path]', scope).filter(i => !seen.has(i.dataset.path) && seen.add(i.dataset.path)).map(i => ({ src: i.src, name: basename(i.dataset.path), path: i.dataset.path }));
}
document.addEventListener('click', e => {
  const img = e.target.closest('#preview img[data-path], .embed img[data-path]');
  if (!img || e.target.closest('a') || e.button !== 0) return;
  e.preventDefault();
  viewImages(img.dataset.path, readingImages(img));
});

// Insert screenshot: the system's region picker (via the app), else the browser's screen capture.
// o.screen: the whole screen rather than a region; o.annotate: open it in a drawing right away
// (also Settings → "After a screenshot"). The desktop app can step out of the way first, and
// Settings can add a delay for catching menus.
let shooting = false;
async function insertScreenshot(o = {}) {
  if (S.view !== 'note' && S.view !== 'canvas') return toast('Open a note or canvas first');
  if (shooting) return;
  const into = S.view, cur = S.cur;
  const annotate = o.annotate ?? cfg.screenshotAfter === 'annotate';
  const delay = Math.max(0, Math.min(10, +cfg.screenshotDelay || 0));
  let blob = null;
  shooting = true;
  if (delay) countdown(delay);
  try {
    const q = new URLSearchParams({ mode: o.screen ? 'screen' : 'region', hide: cfg.screenshotHide ? '1' : '0', delay: String(delay) });
    const r = await fetch(`/api/screenshot?${q}`, { method: 'POST', headers: { 'X-Cinder-Token': TOKEN } });
    if (r.status === 204) return;
    if (r.ok) blob = await r.blob();
    else {
      const msg = (await r.json().catch(() => ({}))).error || r.statusText;
      if (r.status !== 501 || !CinderImages.canCaptureScreen()) return toast('Screenshot failed: ' + msg, 5000);
      blob = await CinderImages.captureScreen({ crop: !o.screen });
    }
  } catch (e) { return toast('Screenshot failed: ' + e.message, 5000); }
  finally { shooting = false; }
  if (!blob) return;
  if (S.cur !== cur || S.view !== into) return toast('The screenshot wasn’t inserted because another file was opened');
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const file = new File([blob], `Screenshot ${fmtDate(d, 'YYYY-MM-DD')} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`, { type: 'image/png' });
  if (into === 'note') {
    setMode('edit');
    const got = await attachAndLink(file, false);
    if (!got) return;
    if (annotate) return annotateImage(got.path, { retarget: np => editImageEmbed(ed, got.from, got.to, { target: np }) });
    ed.focus();
    return;
  }
  const path = uniquePath(cfg.attachFolder, file.name);
  try { await writeFile(path, file); } catch (e) { return toast('Couldn’t save the screenshot: ' + e.message); }
  if (cfg.attachFolder) S.dirs.add(cfg.attachFolder);
  reindexAll(); renderTree();
  const card = CinderCanvas.addFile(path);
  if (annotate && card) annotateImage(path, { retarget: np => CinderCanvas.setFile(card.id, np) });
}

// "3… 2… 1…" while a delayed screenshot waits.
function countdown(n) {
  const t = document.createElement('div');
  t.className = 'toast shot-countdown';
  document.body.append(t);
  const tick = () => { if (n <= 0) return t.remove(); t.textContent = `Screenshot in ${n}…`; n--; setTimeout(tick, 1000); };
  tick();
}

titleEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); ed.focus(); ed.setSelectionRange(0, 0); }
  if (e.key === 'Escape') { titleEl.value = noteName(S.cur); ed.focus(); }
});
titleEl.addEventListener('blur', async () => {
  if (!S.cur || !isMd(S.cur)) return;
  const name = titleEl.value.trim();
  if (!name || name === noteName(S.cur)) { titleEl.value = noteName(S.cur); return; }
  if (BAD_NAME.test(name)) { toast('Names can’t contain \\ / : * ? " < > | # ^ [ ]'); titleEl.value = noteName(S.cur); return; }
  await renamePath(S.cur, join(dirname(S.cur), name + '.md'));
});

