/* Cinder app — rendering Markdown (reading view, embeds, math). (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ markdown rendering

const slug = s => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
let RC = { from: null, depth: 0 }; // render context for link resolution

marked.use({
  gfm: true,
  breaks: true,
  // ![](https://page) is an embedded web page: a placeholder renderInto fills, never an <img>.
  renderer: {
    image(t) {
      const href = typeof t === 'object' ? t.href : t, alt = typeof t === 'object' ? t.text : arguments[2];
      if (isWebPage(href) && cfg.webEmbeds !== 'off') return `<div class="web-embed-ph" data-url="${esc(href)}" data-alt="${esc(alt || '')}"></div>`;
      return false; // marked's own <img>
    },
  },
  extensions: [
    {
      // $$ … $$ on their own lines
      name: 'blockMath', level: 'block',
      start(src) { const i = src.search(/^ {0,3}\$\$/m); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^ {0,3}\$\$([\s\S]*?)\$\$[ \t]*(?:\n|$)/.exec(src);
        if (m) return { type: 'blockMath', raw: m[0], tex: m[1].trim() };
      },
      renderer(t) { return `<div class="math math-block" data-tex="${esc(t.tex)}"></div>\n`; },
    },
    {
      // $x$ (not "$5 and $10") and $$display$$ inside text
      name: 'inlineMath', level: 'inline',
      start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
      tokenizer(src) {
        let m = /^\$\$((?:\\.|[^\\$])+?)\$\$/.exec(src);
        if (m) return { type: 'inlineMath', raw: m[0], tex: m[1], display: true };
        m = /^\$(?![\s$])((?:\\.|[^\\$\n])*?[^\s\\])\$(?!\d)/.exec(src);
        if (m) return { type: 'inlineMath', raw: m[0], tex: m[1] };
      },
      renderer(t) { return `<span class="math${t.display ? ' math-display' : ''}" data-tex="${esc(t.tex)}"></span>`; },
    },
    {
      name: 'wiki', level: 'inline',
      start(src) { const i = src.search(/!?\[\[/); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^(!?)\[\[([^\[\]\n]+?)\]\]/.exec(src);
        if (m) return { type: 'wiki', raw: m[0], embed: !!m[1], inner: m[2] };
      },
      renderer(t) { return renderWiki(t); },
    },
    {
      name: 'hl', level: 'inline',
      start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^==(?=\S)([^\n]*?\S)==/.exec(src);
        if (m) return { type: 'hl', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
    },
  ],
});

function renderWiki(t) {
  const [tgt, alias] = splitOnce(t.inner, '|');
  const [name, sub] = splitOnce(tgt, '#');
  const target = resolveLink(name.trim(), RC.from);
  if (t.embed) {
    if (target && visualEmbed(target)) {
      const w = alias && /^\d+/.test(alias.trim()) ? parseInt(alias) : '';
      return `<span class="visual-embed" data-path="${esc(target)}" data-width="${w}" data-sub="${esc(sub || '')}"></span>`;
    }
    if (target && IMG_EXT.test(target)) {
      const w = alias && /^\d+(x\d+)?$/.test(alias.trim()) ? ` width="${alias.split('x')[0]}"` : '';
      return `<img src="${rawUrl(target)}" alt="${esc(noteName(target))}" data-path="${esc(target)}"${w}>`;
    }
    if (target && isMd(target)) {
      return `<span class="embed" data-embed="${esc(target)}" data-sub="${esc(sub || '')}"></span>`;
    }
    if (target) return `<a class="internal-link" data-href="${esc(target)}" data-path="1">${esc(basename(target))}</a>`;
  }
  const label = alias != null ? alias : (sub ? `${name}${name ? ' › ' : ''}${sub.replace(/^\^/, '')}` : name);
  return `<a class="internal-link${target ? '' : ' unresolved'}" data-href="${esc(name.trim())}" data-sub="${esc(sub || '')}" data-from="${esc(RC.from || '')}">${esc(label)}</a>`;
}

function markdownToHtml(md, from, depth = 0) {
  const prev = RC;
  RC = { from, depth };
  try {
    const html = marked.parse(md);
    return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'button', 'iframe', 'object', 'embed'] });
  } finally { RC = prev; }
}

// Renders `md` (a note body) into container element `el` and wires up everything.
function renderInto(el, content, from, depth) {
  const { fm, fmLen } = splitFrontmatter(content);
  let html = '';
  const liveProps = depth === 0 && el === preview && fmLen && cfg.properties !== 'source' && propsOf(content.slice(0, fmLen)) != null;
  if (liveProps) html += '<div class="props pp-host"></div>';
  else if (fm && depth === 0 && Object.keys(fm).length) {
    html += '<div class="props">' + Object.entries(fm).map(([k, v]) => {
      const val = Array.isArray(v) ? v.map(x => /^tags?$/.test(k) ? `<a class="tag" data-tag="${esc(String(x).replace(/^#/, ''))}">#${esc(String(x).replace(/^#/, ''))}</a>` : esc(x)).join(', ') : esc(v);
      return `<div><span class="k">${esc(k)}</span><span>${val}</span></div>`;
    }).join('') + '</div>';
  }
  html += markdownToHtml(content.slice(fmLen), from, depth);
  el.innerHTML = html;
  // Reading view edits properties too; changes go through the note's editor, then redraw.
  if (liveProps) mountProps($('.pp-host', el), content.slice(0, fmLen), {
    from: () => S.cur,
    edit: f => { const next = f(ed.value); if (next !== ed.value) { ed.value = next; renderPreview(); } },
    exit: dir => dir === 'down' ? preview.focus({ preventScroll: true }) : titleEl.focus(),
  });
  linkifyTags(el);
  renderMathIn(el);
  for (const tb of $$('table', el)) { const w = document.createElement('div'); w.className = 'table-wrap'; tb.replaceWith(w); w.append(tb); }
  // Headings get ids for [[Note#Heading]] links.
  for (const h of $$('h1,h2,h3,h4,h5,h6', el)) h.id = 'h-' + slug(h.textContent);
  // Relative markdown links/images point into the vault.
  for (const a of $$('a[href]', el)) {
    const href = a.getAttribute('href');
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; continue; }
    if (href.startsWith('#')) { a.classList.add('internal-link'); a.dataset.href = ''; a.dataset.sub = href.slice(1); a.dataset.from = from; a.removeAttribute('href'); continue; }
    let h = href; try { h = decodeURIComponent(href); } catch { }
    const [name, sub] = splitOnce(h, '#');
    a.classList.add('internal-link'); a.dataset.href = name; a.dataset.sub = sub || ''; a.dataset.from = from;
    if (!resolveLink(name, from)) a.classList.add('unresolved');
    a.removeAttribute('href');
  }
  const seenUrl = new Map();
  for (const ph of $$('.web-embed-ph', el)) {
    const n = seenUrl.get(ph.dataset.url) || 0; seenUrl.set(ph.dataset.url, n + 1);
    ph.className = ''; ph.dataset.nth = n; ph.dataset.from = from;
    renderWebEmbed(ph, ph.dataset.url, ph.dataset.alt);
  }
  for (const img of $$('img', el)) {
    const src = img.getAttribute('src') || '';
    if (/^(data:|blob:|\/api\/raw)/.test(src)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) { img.removeAttribute('src'); img.alt = `[blocked external image: ${src}]`; continue; }
    let s = src; try { s = decodeURIComponent(src); } catch { }
    const t = resolveLink(s, from);
    if (t) { img.src = rawUrl(t); img.dataset.path = t; }
    const w = /^(.*?)\|(\d+)(?:x\d+)?$/.exec(img.alt); // ![alt|300](img.png)
    if (w) { img.alt = w[1]; img.width = +w[2]; }
  }
  // Task list items (only the top-level note is toggleable).
  $$('li > input[type=checkbox]', el).forEach((cb, i) => {
    const li = cb.parentElement;
    li.classList.add('task'); li.classList.toggle('done', cb.checked);
    if (depth === 0) { cb.disabled = false; cb.dataset.task = i; } else cb.disabled = true;
  });
  // Callouts: > [!note] Title
  for (const bq of $$('blockquote', el)) {
    const p = bq.firstElementChild;
    if (!p || p.tagName !== 'P') continue;
    const m = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n<]*)(?:<br>\n?)?/.exec(p.innerHTML);
    if (!m) continue;
    const type = m[1].toLowerCase();
    const box = document.createElement('div');
    box.className = `callout c-${type}`;
    const title = document.createElement('div');
    title.className = 'callout-title';
    title.textContent = m[3].trim() || type;
    p.innerHTML = p.innerHTML.slice(m[0].length);
    if (!p.innerHTML.trim()) p.remove();
    box.append(title, ...bq.childNodes);
    bq.replaceWith(box);
  }
  for (const sp of $$('span.visual-embed[data-path]', el)) renderVisualEmbed(sp, sp.dataset.path, +sp.dataset.width || null, sp.dataset.sub);
  for (const code of $$('pre > code.language-tasks', el)) {
    const div = document.createElement('div');
    code.parentElement.replaceWith(div);
    renderTasksBlock(div, code.textContent.replace(/\n$/, ''));
  }
  // ```base blocks become live views.
  for (const code of $$('pre > code.language-base', el)) {
    const div = document.createElement('div');
    code.parentElement.replaceWith(div);
    renderBaseBlock(div, code.textContent.replace(/\n$/, ''), from);
  }
  // Note embeds (transclusion), limited depth.
  for (const sp of $$('span.embed[data-embed]', el)) {
    if (depth >= 2 || sp.dataset.embed === from) { sp.textContent = '(embed depth limit)'; continue; }
    renderEmbedInto(sp, sp.dataset.embed, sp.dataset.sub, depth + 1);
  }
}

function renderEmbedInto(el, target, sub, depth = 1) {
  if (visualEmbed(target)) return renderVisualEmbed(el, target, null, sub);
  const n = S.notes.get(target);
  el.innerHTML = `<div class="embed-head"><a class="internal-link" data-href="${esc(target)}" data-path="1">${esc(noteName(target))}${sub ? ' › ' + esc(sub) : ''}</a></div>`;
  const body = document.createElement('div');
  body.className = 'markdown';
  if (!n) body.textContent = '(missing)';
  else renderInto(body, sub ? extractSection(n, sub) : n.content, target, depth);
  el.append(body);
}

// Turn #tags in text into tag pills (skipping code, links and existing pills).
function linkifyTags(el) {
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement.closest('code, pre, a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  /** @type {Text[]} */
  const texts = [];
  while (tw.nextNode()) { const n = /** @type {Text} */ (tw.currentNode); if (n.data.includes('#')) texts.push(n); }
  const re = /(^|[\s(,;])#([\p{L}\p{N}_\-\/]+)/gu;
  for (const t of texts) {
    const frag = document.createDocumentFragment();
    let last = 0, m, any = false;
    re.lastIndex = 0;
    while ((m = re.exec(t.data))) {
      if (/^[\d\/]+$/.test(m[2])) continue;
      const at = m.index + m[1].length;
      frag.append(t.data.slice(last, at));
      const a = document.createElement('a');
      a.className = 'tag'; a.dataset.tag = m[2]; a.textContent = '#' + m[2];
      frag.append(a);
      last = at + 1 + m[2].length; any = true;
    }
    if (any) { frag.append(t.data.slice(last)); t.replaceWith(frag); }
  }
}

function extractSection(n, sub) {
  const want = sub.trim().toLowerCase();
  const i = n.headings.findIndex(h => h.text.trim().toLowerCase() === want);
  if (i < 0) return `*Heading "${sub}" not found.*`;
  const h = n.headings[i];
  const end = n.headings.slice(i + 1).find(x => x.level <= h.level);
  return n.content.slice(h.index, end ? end.index : undefined);
}

function renderPreview() {
  if (!S.cur) return;
  const st = preview.scrollTop;
  renderInto(preview, ed.value, S.cur, 0);
  // Inline title, unless the note already opens with the same H1.
  const first = preview.querySelector(':scope > h1:first-child, :scope > .props + h1');
  if (!first || first.textContent.trim().toLowerCase() !== noteName(S.cur).toLowerCase()) {
    const t = document.createElement('h1');
    t.className = 'preview-title'; t.textContent = noteName(S.cur);
    preview.prepend(t);
  } else first.classList.add('preview-title');
  preview.scrollTop = st;
}

// Tick the i-th checkbox in reading view (adds the done date; recurring tasks roll forward).
function toggleTask(i) {
  const body = blankCode(ed.value);
  const re = /^[ \t]*(?:>[ \t]?)*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\]/gm;
  let m, k = 0;
  while ((m = re.exec(body))) {
    if (k++ === i) {
      const a = m.index, e = ed.value.indexOf('\n', a) < 0 ? ed.value.length : ed.value.indexOf('\n', a);
      const next = CinderTasks.toggle(ed.value.slice(a, e).replace(/\r$/, ''), { date: CinderTasks.today(), doneDate: cfg.taskDoneDate }).join('\n');
      const cr = ed.value[e - 1] === '\r' ? '\r' : '';
      ed.insert(a, e, next + cr, ed.selectionStart, ed.selectionEnd);
      renderPreview();
      return;
    }
  }
}

// Clicks on links anywhere (preview, embeds, panels).
document.addEventListener('click', e => {
  const cb = e.target.closest('#preview input[data-task]');
  if (cb) { toggleTask(+cb.dataset.task); return; }
  const de = e.target.closest('.drawing-embed[data-drawing], .canvas-embed[data-canvas]');
  if (de && !e.target.closest('a') && !e.target.closest('.cv-node')) { e.preventDefault(); return openPath(de.dataset.drawing || de.dataset.canvas); }
  const raw = e.target.closest('[data-open-raw]');
  if (raw) { e.preventDefault(); return openPath(raw.dataset.openRaw, { raw: true }); }
  const a = e.target.closest('a.internal-link');
  if (a) {
    e.preventDefault();
    if (a.dataset.path) return openPath(a.dataset.href);
    return followLink(a.dataset.href, a.dataset.sub, a.dataset.from || S.cur);
  }
  const tg = e.target.closest('a.tag');
  if (tg) { e.preventDefault(); searchFor(`tag:${tg.dataset.tag}`); }
});

// Middle-click a link (reading view, live preview, panels) to open it in a new tab.
document.addEventListener('mousedown', e => { if (e.button === 1 && e.target.closest('a.internal-link, .cm-editor [data-link]')) e.preventDefault(); });
document.addEventListener('auxclick', e => {
  if (e.button !== 1) return;
  const a = e.target.closest('a.internal-link, .cm-editor [data-link]');
  if (!a) return;
  e.preventDefault();
  const name = a.dataset.href ?? a.dataset.link;
  const target = a.dataset.path ? name : resolveLink(name, a.dataset.from || S.cur);
  if (target) openInNewTab(target, { heading: a.dataset.sub || undefined });
});

