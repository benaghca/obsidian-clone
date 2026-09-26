/* Cinder app — a note out of Cinder: to PDF (the system's print dialog), to a standalone HTML
 * file beside the note, or onto the clipboard as formatted text.
 * (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */

// The note as reading view shows it, ready to leave the app: a title, no editing controls,
// web pages as links. Resolves with a detached element.
async function renderForExport(path) {
  const text = path === S.cur && S.view === 'note' ? ed.value : S.notes.get(path)?.content;
  if (text == null) throw new Error('Only notes can be exported');
  const box = document.createElement('div');
  box.className = 'markdown export-doc';
  renderInto(box, text, path, 0);
  const first = box.querySelector(':scope > h1:first-child, :scope > .props + h1');
  if (!first || first.textContent.trim().toLowerCase() !== noteName(path).toLowerCase()) {
    const t = document.createElement('h1'); t.className = 'preview-title'; t.textContent = noteName(path); box.prepend(t);
  }
  // Drawings, canvases and bases draw themselves a moment after they're placed.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:780px;visibility:hidden';
  host.append(box); document.body.append(host);
  await new Promise(r => setTimeout(r, 400));
  host.remove();
  for (const f of $$('iframe', box)) {
    const u = f.dataset.url || f.src, a = document.createElement('a');
    a.href = u; a.textContent = u;
    (f.closest('.web-embed') || f).replaceWith(a);
  }
  for (const el of $$('.we-bar, .img-resize, .pp-host button, .tk-actions, button', box)) el.remove();
  for (const i of $$('input[type=checkbox]', box)) i.setAttribute('disabled', '');
  return box;
}

// Print the note; the system's dialog saves it as a PDF too.
async function printNote(path = S.cur) {
  if (!path || !isMd(path) || isDrawing(path)) return toast('Open a note to export it');
  if (path === S.cur && S.dirty) await save();
  let box;
  try { box = await renderForExport(path); } catch (e) { return toast(e.message); }
  $('#print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  root.append(box);
  document.body.append(root);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  const title = document.title;
  document.title = noteName(path); // the PDF's default file name
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try { window.print(); } finally { document.title = title; setTimeout(done, 1000); }
}

// Everything the exported page needs, in one file: its own styles, images inlined, math as MathML.
async function exportHtml(path = S.cur) {
  if (!path || !isMd(path) || isDrawing(path)) return toast('Open a note to export it');
  if (path === S.cur && S.dirty) await save();
  let box;
  try { box = await renderForExport(path); } catch (e) { return toast(e.message); }
  await inlineImages(box);
  for (const k of $$('.katex-html', box)) k.remove(); // the MathML beside it renders on its own
  for (const a of $$('a.internal-link, a[data-href]', box)) { const s = document.createElement('span'); s.className = 'internal-link'; s.innerHTML = a.innerHTML; a.replaceWith(s); }
  const html = `<!doctype html>
<html lang="${esc(document.documentElement.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Cinder">
<title>${esc(noteName(path))}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<main class="markdown">
${box.innerHTML}
</main>
</body>
</html>
`;
  const out = uniquePath(dirname(path), noteName(path) + '.html');
  try { await writeFile(out, html); } catch (e) { return toast('Couldn’t save: ' + e.message); }
  let d = dirname(out); while (d) { S.dirs.add(d); d = dirname(d); }
  renderTree();
  toast(`Saved ${basename(out)} beside the note`, 5000, { label: 'Show', run: () => revealInTree(out) });
}

// Formatted text for pasting into an email or a document.
async function copyHtml(path = S.cur) {
  if (!path || !isMd(path)) return toast('Open a note first');
  let box;
  try { box = await renderForExport(path); } catch (e) { return toast(e.message); }
  await inlineImages(box);
  for (const k of $$('.katex-html', box)) k.remove();
  const html = `<div style="font-family: system-ui, sans-serif; line-height: 1.55">${box.innerHTML}</div>`;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([box.innerText], { type: 'text/plain' }) })]);
    toast('Copied as formatted text');
  } catch { toast('Couldn’t copy'); }
}

async function inlineImages(box) {
  for (const img of $$('img', box)) {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('/api/raw')) continue;
    try {
      const b = await (await fetch(src, { headers: { 'X-Cinder-Token': TOKEN } })).blob();
      img.src = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    } catch { }
  }
  for (const svg of $$('svg', box)) svg.removeAttribute('class');
}

// The standalone page's styles: a light, readable page that needs nothing else.
const EXPORT_CSS = `
:root { color-scheme: light; --accent: #c2410c; --muted: #5f5550; --border: #e3dcd7; --code: #f5f1ee; }
body { margin: 0; background: #fff; color: #1f1a17; font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 48px 28px 80px; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 .5em; }
h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
.preview-title, main > h1:first-child { margin-top: 0; }
p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
a { color: var(--accent); }
.internal-link { color: var(--accent); }
img, svg { max-width: 100%; height: auto; }
code { font: .9em ui-monospace, "JetBrains Mono", Consolas, monospace; background: var(--code); padding: .1em .35em; border-radius: 4px; }
pre { background: var(--code); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid var(--border); padding: 2px 16px; color: var(--muted); }
table { border-collapse: collapse; }
th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
th { background: #faf7f5; }
hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
mark { background: #fff1a8; }
.tag { color: var(--accent); background: #fbeee7; border-radius: 10px; padding: 0 7px; font-size: .88em; text-decoration: none; }
.props { display: grid; gap: 2px; margin: 0 0 1.5em; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; font-size: .9em; }
.props > div { display: flex; gap: 12px; } .props .k { min-width: 120px; color: var(--muted); }
.callout { border-left: 3px solid var(--accent); background: #fbf4f0; border-radius: 8px; padding: 10px 14px; margin: 0 0 1em; }
.callout-title { font-weight: 600; color: var(--accent); text-transform: capitalize; margin-bottom: 4px; }
.callout > :last-child { margin-bottom: 0; }
li.task { list-style: none; } li.task input { margin: 0 6px 0 -20px; }
.math-block { display: block; text-align: center; margin: 1em 0; overflow-x: auto; }
.table-wrap { overflow-x: auto; }
.embed, .note-embed { border-left: 2px solid var(--border); padding-left: 14px; margin: 0 0 1em; }
@media print { main { padding: 0; } a { color: inherit; } }
`;
