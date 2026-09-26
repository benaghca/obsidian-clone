/* Cinder app — embedded web pages, embed/unembed and hover previews. (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ embedded links: web pages, previews

const WEB_URL_RE = /^https?:\/\/[^\s<>"]+$/i, IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)([?#]|$)/i;
const isWebPage = u => WEB_URL_RE.test(u || '') && !IMAGE_URL_RE.test(u);

// Video pages become their players (which are made to be embedded); anything else loads as it is.
function framedUrl(u) {
  try {
    const x = new URL(u), h = x.hostname.replace(/^(www|m)\./, '');
    const yt = h === 'youtube.com' && x.pathname === '/watch' ? x.searchParams.get('v') : h === 'youtu.be' ? x.pathname.slice(1) : h === 'youtube.com' && x.pathname.startsWith('/shorts/') ? x.pathname.split('/')[2] : null;
    if (yt && /^[\w-]{6,}$/.test(yt)) return `https://www.youtube-nocookie.com/embed/${yt}`;
    if (h === 'vimeo.com' && /^\/\d+/.test(x.pathname)) return `https://player.vimeo.com/video/${x.pathname.split('/')[1]}`;
  } catch { }
  return u;
}

// A live web page in a sandboxed frame, with its address, reload and open-in-browser. size is the
// alt text of ![alt|W x H](url) (or {height}); fill: take the container's height (canvas cards).
// The size in "alt|W x H" (either part may be missing); height defaults to 460.
function embedSize(size) {
  const m = typeof size === 'string' ? /(?:^|\|)\s*(\d+)?\s*(?:x\s*(\d+))?\s*$/.exec(size) : null;
  return { w: m?.[1] ? +m[1] : null, h: Math.max(120, Math.min(2400, (m?.[2] ? +m[2] : size?.height) || 460)) };
}
function sizeWebEmbed(el, size) {
  const { w, h } = embedSize(size);
  el.style.maxWidth = w ? w + 'px' : '';
  const f = $('.we-frame', el);
  if (f) f.style.height = h + 'px';
}
function renderWebEmbed(el, url, size = '', o = {}) {
  const { w } = embedSize(size), hgt = o.fill ? null : embedSize(size).h;
  let host = url;
  try { host = new URL(url).host; } catch { }
  const src = framedUrl(url);
  el.classList.add('web-embed');
  if (o.fill) el.classList.add('we-fill');
  el.innerHTML = `<div class="we-bar"><span class="we-host">${esc(host)}</span><span class="we-url" title="${esc(url)}">${esc(url.replace(/^https?:\/\//, ''))}</span>
    <button class="ib we-reload" title="Reload"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg></button><button class="ib we-open" title="Open in browser"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></button></div>
    <div class="we-frame"${hgt ? ` style="height:${hgt}px"` : ''}></div>${o.fill || o.fixed ? '' : '<span class="we-grip" title="Drag to resize (double-click: default size)"></span>'}`;
  if (w) el.style.maxWidth = w + 'px';
  const frame = $('.we-frame', el);
  const load = () => {
    if (NATIVE && window.ipc) window.ipc.postMessage('frame:' + src); // the desktop window lets this origin load in place
    const f = document.createElement('iframe');
    f.src = src;
    // Its own origin, so it can't reach Cinder; it can't navigate the app either.
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation');
    f.setAttribute('allow', 'fullscreen; picture-in-picture; encrypted-media; clipboard-write');
    f.referrerPolicy = 'no-referrer';
    f.loading = 'lazy';
    f.title = host;
    frame.replaceChildren(f);
  };
  if (cfg.webEmbeds === 'click') {
    frame.innerHTML = `<div class="we-ask"><button class="btn">Load ${esc(host)}</button><small>Embedded pages come from the web. Settings can load them without asking.</small></div>`;
    $('.we-ask button', frame).onclick = e => { e.preventDefault(); e.stopPropagation(); load(); };
  } else load();
  $('.we-open', el).onclick = e => { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank', 'noopener'); };
  $('.we-reload', el).onclick = e => { e.preventDefault(); e.stopPropagation(); load(); };
}

// ------------------------------------------------------------ embed / show as link

// The link covering (or, failing that, first on the line of) doc offset pos in editor e.
function linkAt(e, pos, loose = false) {
  const line = e.view.state.doc.lineAt(pos), t = line.text, o = pos - line.from;
  const found = [];
  for (const m of t.matchAll(/(!?)\[\[[^\[\]\n]+?\]\]/g)) found.push({ s: m.index, e: m.index + m[0].length, kind: 'wiki', embed: !!m[1] });
  for (const m of t.matchAll(/(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?\s*\)/g)) found.push({ s: m.index, e: m.index + m[0].length, kind: 'md', embed: !!m[1], href: m[3] });
  for (const m of t.matchAll(/https?:\/\/[^\s<>()\[\]]+/g)) {
    if (!found.some(f => m.index >= f.s && m.index < f.e)) found.push({ s: m.index, e: m.index + m[0].length, kind: 'url', embed: false, href: m[0] });
  }
  const l = found.find(f => o >= f.s && o <= f.e) || (loose ? found.sort((a, b) => a.s - b.s)[0] : null);
  return l && { ...l, from: line.from + l.s, to: line.from + l.e, text: t.slice(l.s, l.e) };
}
function toggleEmbed(e, pos, loose) {
  const l = linkAt(e, pos, loose);
  if (!l) return toast('Put the cursor on a link first');
  let out;
  if (l.kind === 'url') out = `![](${l.text})`;
  else if (!l.embed) out = '!' + l.text;
  else if (l.kind === 'md' && /^!\[\]\(/.test(l.text) && WEB_URL_RE.test(l.href)) out = l.href; // ![](url) → the bare address
  else out = l.text.slice(1);
  e.view.dispatch({ changes: { from: l.from, to: l.to, insert: out } });
  return true;
}

// Write a size into ![alt|W x H](url): the nth embed of url in text (null size: the default).
function setEmbedSizeIn(text, url, nth, w, h) {
  const esc_ = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`!\\[([^\\]\\n]*)\\]\\(\\s*<?${esc_}>?\\s*\\)`, 'g');
  let i = 0;
  return text.replace(re, (m, alt) => {
    if (i++ !== nth) return m;
    const base = alt.replace(/\|\s*\d*\s*(x\s*\d+)?\s*$/, ''); // only a "|size" suffix
    const size = h ? `|${w ? w : ''}x${h}` : '';
    return `![${base}${size}](${url})`;
  });
}

// Drag an embedded page's corner to resize it; the size goes into the note. The page stays loaded.
document.addEventListener('pointerdown', e => {
  const grip = e.target.closest?.('.we-grip');
  if (!grip || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const box = grip.closest('.web-embed'), frame = $('.we-frame', box);
  const x0 = e.clientX, y0 = e.clientY, w0 = box.getBoundingClientRect().width, h0 = frame.getBoundingClientRect().height;
  const pcs = getComputedStyle(box.parentElement);
  const full = box.parentElement.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight); // its content width
  let w = w0, h = h0;
  document.body.classList.add('we-resizing'); // (the page underneath mustn't swallow the drag)
  grip.setPointerCapture(e.pointerId);
  const move = ev => {
    w = Math.round(Math.max(240, Math.min(full, w0 + ev.clientX - x0)));
    h = Math.round(Math.max(120, Math.min(2400, h0 + ev.clientY - y0)));
    box.style.maxWidth = w >= full - 2 ? '' : w + 'px';
    frame.style.height = h + 'px';
    grip.dataset.size = `${w >= full - 2 ? 'full width' : w} × ${h}`;
  };
  const up = () => {
    grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
    document.body.classList.remove('we-resizing'); delete grip.dataset.size;
    if (Math.abs(w - w0) < 2 && Math.abs(h - h0) < 2) return;
    saveEmbedSize(box, w >= full - 2 ? null : w, h);
  };
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
}, true);
document.addEventListener('dblclick', e => {
  const grip = e.target.closest?.('.we-grip');
  if (!grip) return;
  e.preventDefault(); e.stopPropagation();
  const box = grip.closest('.web-embed');
  sizeWebEmbed(box, '');
  saveEmbedSize(box, null, null);
}, true);
function saveEmbedSize(box, w, h) {
  const cmBlock = box.closest('.cm-web-embed');
  if (cmBlock) {
    // Live preview: rewrite the ![…](url) on the widget's line (the widget resizes in place).
    const reg = EDITORS.get(cmBlock.closest('.cm-editor'));
    if (!reg) return;
    const view = reg.ed.view, line = view.state.doc.lineAt(view.posAtDOM(cmBlock));
    const next = setEmbedSizeIn(line.text, cmBlock.dataset.url, 0, w, h);
    if (next !== line.text) view.dispatch({ changes: { from: line.from, to: line.to, insert: next } });
  } else if (box.closest('#preview') && S.view === 'note') {
    const next = setEmbedSizeIn(ed.value, box.dataset.url, +box.dataset.nth || 0, w, h);
    if (next !== ed.value) ed.value = next; // (reading view keeps showing the resized page)
  }
}

// Right-click a link (or an embed) in the editor: embed it, or turn it back into a link.
document.addEventListener('contextmenu', e => {
  const t = e.target.closest?.('.cm-editor :is(.cm-wikilink, .cm-link, .cm-url, .cm-note-embed, .cm-web-embed, .cm-visual-embed)');
  if (!t || e.defaultPrevented) return;
  const reg = EDITORS.get(t.closest('.cm-editor'));
  if (!reg) return;
  let pos;
  try { pos = reg.ed.view.posAtDOM(t); } catch { return; }
  const block = t.matches('.cm-note-embed, .cm-web-embed, .cm-visual-embed');
  const l = linkAt(reg.ed, pos, block);
  if (!l) return;
  e.preventDefault();
  const url = l.kind === 'wiki' ? null : l.href;
  const name = l.kind === 'wiki' ? splitOnce(splitOnce(l.text.replace(/^!?\[\[|\]\]$/g, ''), '|')[0], '#')[0] : null;
  const target = name != null ? resolveLink(name, reg.from()) : url && !/^[a-z][a-z0-9+.-]*:/i.test(url) ? resolveLink(safeDecode(url.split('#')[0]), reg.from()) : null;
  const items = [[l.embed ? 'Show as a link' : 'Embed (show it here)', () => toggleEmbed(reg.ed, l.from + 1)]];
  if (target) items.push(['Open', () => openPath(target)], ['Open in new tab', () => openInNewTab(target)]);
  else if (url && WEB_URL_RE.test(url)) items.push(['Open in browser', () => window.open(url, '_blank', 'noopener')]);
  items.push(['Copy link', () => navigator.clipboard?.writeText(l.text.replace(/^!/, '')).then(() => toast('Copied'))]);
  menu(e.clientX, e.clientY, items);
});

// ------------------------------------------------------------ hover previews

// Hover a note link to see the note (in the editor, hold Ctrl/Cmd, as in Obsidian); Ctrl/Cmd+hover
// a web link to see the live page. Previews stack: a link inside a preview opens another beside it,
// and each stays while the pointer is on it, on its link, or on a preview it opened. Esc closes
// the top one.
const PREVIEW_TARGETS = 'a.internal-link, a[href^="http"], .cm-editor :is(.cm-wikilink, .cm-link, .cm-url), .cv-link-url';
const MAX_PREVIEWS = 6;
const pops = []; // [{ pop, anchor }], outermost first
let hoverTimer = null, hoverHide = null, lastPointer = { x: 0, y: 0 };
function hoverTarget(a) {
  const url = a.dataset.url || (a.matches('a[href^="http"]') ? a.getAttribute('href') : null);
  if (url && WEB_URL_RE.test(url)) return { web: url };
  const name = a.dataset.link ?? a.dataset.href;
  if (name == null) return null;
  const from = a.dataset.from || EDITORS.get(a.closest('.cm-editor'))?.from() || S.cur;
  const path = a.dataset.path ? name : name === '' ? from : resolveLink(name, from);
  return path && S.files.has(path) ? { path, sub: a.dataset.sub || '' } : null;
}
const popIndex = el => pops.findIndex(p => p.pop.contains(el));
function closePops(keep = 0) {
  clearTimeout(hoverHide);
  while (pops.length > keep) pops.pop().pop.remove();
}
function hideHover() { clearTimeout(hoverTimer); closePops(0); }
function showHover(a) {
  const t = hoverTarget(a);
  if (!t || !a.isConnected) return;
  const level = popIndex(a) + 1; // 0: a link on the page; n: a link inside preview n
  closePops(level);
  if (level >= MAX_PREVIEWS) return;
  const pop = document.createElement('div');
  pop.className = 'hover-pop' + (t.web ? ' hp-web' : '');
  pop.style.zIndex = 55 + level;
  if (t.web) renderWebEmbed(pop, t.web, { height: 380 }, { fixed: true });
  else {
    pop.innerHTML = `<div class="hp-head"><b>${esc(displayName(t.path))}${t.sub ? ` › ${esc(t.sub.replace(/^\^/, ''))}` : ''}</b><button class="ib hp-open" title="Open (Ctrl-click: new tab)"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></button></div><div class="hp-body markdown"></div>`;
    const body = $('.hp-body', pop), n = S.notes.get(t.path);
    if (n && !isDrawing(t.path)) renderInto(body, t.sub ? extractSection(n, t.sub.replace(/^#/, '')) : n.content, t.path, 1);
    else if (IMG_EXT.test(t.path)) body.innerHTML = `<img src="${rawUrl(t.path)}" alt="">`;
    else if (visualEmbed(t.path)) renderVisualEmbed(body, t.path);
    else body.innerHTML = `<p class="none">${esc(basename(t.path))}</p>`;
    $('.hp-open', pop).onclick = e => { hideHover(); (e.ctrlKey || e.metaKey ? openInNewTab : openPath)(t.path, t.sub ? { heading: t.sub } : {}); };
  }
  document.body.append(pop);
  pops.push({ pop, anchor: a });
  // Beside the link: below it if there's room, else above; a nested one is nudged so it doesn't
  // sit exactly over its parent's text.
  const r = a.getBoundingClientRect(), W = pop.offsetWidth, H = pop.offsetHeight;
  const below = r.bottom + 6 + H < innerHeight || r.top < H + 12;
  const x = r.left + (level ? 24 : 0);
  pop.style.left = Math.max(8, Math.min(innerWidth - W - 8, x)) + 'px';
  pop.style.top = (below ? Math.min(innerHeight - H - 8, r.bottom + 6) : Math.max(8, r.top - H - 6)) + 'px';
}
// Keep the previews the pointer is in (and those under it), or the one whose link it's on; the
// rest close after a moment, so moving across a gap doesn't lose them.
function settleHover(target) {
  let keep = 0;
  for (let i = pops.length - 1; i >= 0; i--) {
    if (pops[i].pop.contains(target)) { keep = i + 1; break; }
    if (pops[i].anchor === target || pops[i].anchor.contains(target)) { keep = i + 1; break; }
  }
  clearTimeout(hoverHide);
  if (keep < pops.length) hoverHide = setTimeout(() => closePops(keep), 280);
}
function maybeHover(a, mod) {
  if (!cfg.hoverPreview || !a || pops.some(p => p.anchor === a)) return;
  const t = hoverTarget(a);
  if (!t) return;
  const needMod = !!t.web || (!!a.closest('.cm-editor, .cv-node') && !a.closest('.hover-pop'));
  if (needMod && !mod) return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => showHover(a), needMod ? 120 : 450);
}
document.addEventListener('mouseover', e => {
  lastPointer = { x: e.clientX, y: e.clientY };
  if (pops.length) settleHover(e.target);
  const a = e.target.closest?.(PREVIEW_TARGETS);
  if (a) maybeHover(a, e.ctrlKey || e.metaKey);
  else clearTimeout(hoverTimer);
});
document.addEventListener('mouseout', e => {
  if (e.target.closest?.(PREVIEW_TARGETS)) clearTimeout(hoverTimer);
  if (!e.relatedTarget && pops.length) { clearTimeout(hoverHide); hoverHide = setTimeout(() => closePops(0), 280); } // left the window
});
document.addEventListener('mousemove', e => { lastPointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
// Pressing Ctrl/Cmd while already over a link shows its preview; Esc closes the top preview.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && pops.length) { e.stopPropagation(); closePops(pops.length - 1); return; }
  if ((e.key === 'Control' || e.key === 'Meta') && !e.repeat) maybeHover(document.elementFromPoint(lastPointer.x, lastPointer.y)?.closest?.(PREVIEW_TARGETS), true);
});
// A click outside closes them all; a click inside one closes only those it opened.
document.addEventListener('mousedown', e => { if (pops.length) closePops(popIndex(e.target) + 1); });

