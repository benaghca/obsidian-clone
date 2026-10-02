/* Cinder app — rendering Markdown (reading view, embeds, math). (One of the ui/app/*.js pieces that src/api.rs joins, in order, into /app.js.) */
// ============================================================ markdown rendering

const slug = s => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
let RC = { from: null, depth: 0 }; // render context for link resolution
// Footnotes of the note being rendered: labels with a definition, labels in the order they're first
// referenced (their numbers), and the definitions' HTML. Null outside markdownToHtml.
let FN = null;

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
    // An obsidian://open link to a note here is an internal link (DOMPurify would drop its href).
    link(t) {
      const href = typeof t === 'object' ? t.href : t, target = obsidianUrlTarget(href);
      if (!target) return false;
      const text = typeof t === 'object' ? this.parser.parseInline(t.tokens) : arguments[2];
      return `<a class="internal-link" data-href="${esc(target)}" data-path="1">${text}</a>`;
    },
  },
  // Obsidian strikes through ~~text~~ only; a single ~ (H~2~O) stays as typed.
  tokenizer: {
    del(src) {
      const m = /^~~(?=[^\s~])([\s\S]*?[^\s~])~~(?!~)/.exec(src);
      if (m) return { type: 'del', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
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
      // [^label]: text, with indented lines carrying on. Drawn in the list at the end, not here.
      name: 'footnoteDef', level: 'block',
      start(src) { const i = src.search(/^ {0,3}\[\^[^\]\s]+\]:/m); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)(?:\n|$)/.exec(src);
        if (!m) return;
        const tokens = [];
        this.lexer.blockTokens(m[2].replace(/\n(?: {2,4}|\t)/g, '\n'), tokens);
        return { type: 'footnoteDef', raw: m[0], label: m[1], tokens };
      },
      renderer(t) { if (FN && !FN.defs.has(t.label)) FN.defs.set(t.label, this.parser.parse(t.tokens)); return ''; },
    },
    {
      // [^label] (when the note defines it) and inline ^[footnotes], numbered as they come.
      name: 'footnoteRef', level: 'inline',
      start(src) { const i = src.search(/\[\^|\^\[/); return i < 0 ? undefined : i; },
      tokenizer(src) {
        let m = /^\[\^([^\]\s]+)\]/.exec(src);
        if (m) return { type: 'footnoteRef', raw: m[0], label: m[1] };
        m = /^\^\[((?:[^\[\]\n]|\[[^\[\]\n]*\])+)\]/.exec(src);
        if (m) return { type: 'footnoteRef', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) {
        if (!FN || (t.label && !FN.defined.has(t.label))) return esc(t.raw);
        const label = t.label ?? `^inline-${FN.order.length}`;
        if (!t.label) FN.defs.set(label, this.parser.parseInline(t.tokens));
        let n = FN.order.indexOf(label) + 1;
        if (!n) n = FN.order.push(label);
        return `<sup class="fn-ref"><a class="fn-ref" data-fn="${n}">${n}</a></sup>`;
      },
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

// The note an obsidian://open?vault=…&file=… link (Obsidian's "Copy Obsidian URL") points at, when
// it's in this vault, so it opens here; null for other links.
function obsidianUrlTarget(url) {
  const m = /^obsidian:\/\/open\/?\?(.*)$/i.exec(url || '');
  if (!m) return null;
  const q = new URLSearchParams(m[1]), file = q.get('file');
  if (file) return resolveLink(file.replace(/\.md$/i, ''), RC.from || S.cur) || (S.files.has(file) ? file : null);
  const abs = q.get('path')?.replace(/\\/g, '/');
  if (!abs) return null;
  const p = [...S.files.keys()].find(f => abs.endsWith('/' + f));
  return p || null;
}

function renderWiki(t) {
  const [tgt, alias] = splitOnce(t.inner.replace(/^([^|]*)\\\|/, '$1|'), '|'); // [[Note\|alias]] too, as tables write it
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

// Obsidian's %%comments%% are for editing only. Their line breaks stay, so the lines around one don't join.
function dropComments(md) {
  if (!md.includes('%%')) return md;
  let out = '', at = 0;
  for (const [a, b] of CinderEditor.scanMarkdown(md).comments) { out += md.slice(at, a) + md.slice(a, b).replace(/[^\n]/g, ''); at = b; }
  return out + md.slice(at);
}

function footnotesHtml() {
  if (!FN.order.length) return '';
  return '<section class="footnotes"><ol>' + FN.order.map((label, i) => {
    const body = (FN.defs.get(label) || '').trim().replace(/^<p>([\s\S]*)<\/p>$/, '$1');
    return `<li data-fn-def="${i + 1}">${body} <a class="fn-back" data-fn="${i + 1}" title="Back to the text">↩</a></li>`;
  }).join('') + '</ol></section>';
}

function markdownToHtml(md, from, depth = 0) {
  const prev = RC, prevFN = FN;
  RC = { from, depth };
  md = dropComments(md);
  FN = { defined: new Set([...md.matchAll(/^ {0,3}\[\^([^\]\s]+)\]:/gm)].map(m => m[1])), order: [], defs: new Map() };
  try {
    const html = marked.parse(md) + footnotesHtml();
    return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'button', 'iframe', 'object', 'embed'] });
  } finally { RC = prev; FN = prevFN; }
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
  // Task list items: [ ] and [x], and the other statuses Obsidian draws as tasks too ([/] in progress,
  // [-] cancelled…), in tight lists and loose ones (where the checkbox sits in a paragraph). Each item
  // gets data-task="<status>" as in Obsidian, which themes style. Only the top-level note is toggleable.
  for (const li of $$('li', el)) {
    const host = li.firstElementChild?.tagName === 'P' ? li.firstElementChild : li, t = host.firstChild;
    const m = t?.nodeType === Node.TEXT_NODE && /^\[([^\]\n])\][ \t]/.exec(t.data);
    if (!m) continue;
    t.data = t.data.slice(m[0].length);
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true; cb.dataset.status = m[1];
    host.prepend(cb, ' ');
  }
  $$('li > input[type=checkbox], li > p:first-child > input[type=checkbox]', el).forEach((cb, i) => {
    const li = cb.closest('li'), status = cb.dataset.status || (cb.checked ? 'x' : ' ');
    li.classList.add('task'); li.dataset.task = status;
    li.classList.toggle('done', status === 'x' || status === 'X'); li.classList.toggle('cancelled', status === '-');
    if (depth === 0) { cb.disabled = false; cb.dataset.task = i; } else cb.disabled = true;
  });
  // Block ids: ^id ending a paragraph or list item is hidden and marks its block, for [[Note#^id]];
  // a ^id paragraph of its own marks the block above it.
  for (const p of $$('p', el)) {
    const id = /^\^([A-Za-z0-9-]+)$/.exec(p.textContent.trim());
    if (id && p.previousElementSibling && !p.closest('li')) { p.previousElementSibling.setAttribute('data-block-id', id[1].toLowerCase()); p.remove(); }
  }
  for (const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); tw.nextNode();) {
    const t = /** @type {Text} */ (tw.currentNode), m = /[ \t]\^([A-Za-z0-9-]+)[ \t]*$/.exec(t.data);
    if (!m || t.parentElement.closest('code, pre') || (t.nextSibling && t.nextSibling.nodeName !== 'BR' && t.nextSibling.nodeName !== 'UL' && t.nextSibling.nodeName !== 'OL')) continue;
    t.data = t.data.slice(0, m.index);
    t.parentElement.closest('li, p, td, th, h1, h2, h3, h4, h5, h6')?.setAttribute('data-block-id', m[1].toLowerCase());
  }
  // Callouts: > [!note] Title
  for (const bq of $$('blockquote', el)) {
    const p = bq.firstElementChild;
    if (!p || p.tagName !== 'P') continue;
    const m = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n<]*)(?:<br>\n?)?/.exec(p.innerHTML);
    if (!m) continue;
    const type = m[1].toLowerCase();
    // [!faq]- starts folded and [!faq]+ open; either folds when its title is clicked.
    const box = document.createElement(m[2] ? 'details' : 'div');
    box.className = `callout c-${type}`;
    if (m[2] === '+') box.setAttribute('open', '');
    const title = document.createElement(m[2] ? 'summary' : 'div');
    title.className = 'callout-title';
    title.textContent = m[3].trim() || type[0].toUpperCase() + type.slice(1); // a title of its own stays as written
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
  for (const code of $$('pre > code.language-query', el)) {
    const div = document.createElement('div');
    code.parentElement.replaceWith(div);
    renderQueryBlock(div, code.textContent, from);
  }
  // ```base blocks become live views.
  for (const code of $$('pre > code.language-base', el)) {
    const div = document.createElement('div');
    code.parentElement.replaceWith(div);
    renderBaseBlock(div, code.textContent.replace(/\n$/, ''), from);
  }
  // ```mermaid blocks become diagrams.
  for (const code of $$('pre > code.language-mermaid', el)) {
    const div = document.createElement('div');
    code.parentElement.replaceWith(div);
    renderMermaidBlock(div, code.textContent.replace(/\n$/, ''));
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

// A ```query block (Obsidian's embedded search): what the search finds, listed as in the Search panel.
// The note it's in isn't listed (its own query text would always match).
function renderQueryBlock(el, code, from) {
  const q = code.trim(), found = q ? searchVault(q) : { results: [], also: [] };
  const results = found.results.filter(r => r.p !== from), also = found.also;
  el.className = 'query-block';
  el.innerHTML = `<div class="query-head"><span>${esc(q || 'Empty search')}</span><small>${searchCount(results, also)}</small></div>${searchResultsHtml(results)}`;
  el.onclick = openSearchResult;
}

function extractSection(n, sub) {
  const want = sub.trim().toLowerCase();
  if (want.startsWith('^')) {
    const b = n.blocks?.find(x => x.id.toLowerCase() === want.slice(1));
    return b ? n.content.slice(b.from, b.to) : `*Block "${sub}" not found.*`;
  }
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
  const { code, comments } = CinderEditor.scanMarkdown(ed.value);
  const body = blankRanges(ed.value, [...code, ...comments]); // as reading view counts them
  const re = /^[ \t]*(?:>[ \t]?)*(?:[-*+]|\d+[.)])[ \t]+\[[^\]\n]\][ \t]/gm;
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
  // A footnote's number goes to the footnote, and its ↩ back to the text (in the same note or embed).
  const fn = e.target.closest('a.fn-ref, a.fn-back');
  if (fn) {
    e.preventDefault();
    const sel = fn.classList.contains('fn-ref') ? `[data-fn-def="${fn.dataset.fn}"]` : `a.fn-ref[data-fn="${fn.dataset.fn}"]`;
    fn.closest('.markdown')?.querySelector(sel)?.scrollIntoView({ block: 'center' });
    return;
  }
  const cb = e.target.closest('#preview input[data-task]');
  if (cb) { toggleTask(+cb.dataset.task); return; }
  const de = e.target.closest('.drawing-embed[data-drawing], .canvas-embed[data-canvas]');
  if (de && !e.target.closest('a') && !e.target.closest('.cv-node')) { e.preventDefault(); return openPath(de.dataset.drawing || de.dataset.canvas); }
  const raw = e.target.closest('[data-open-raw]');
  if (raw) { e.preventDefault(); return openPath(raw.dataset.openRaw, { raw: true }); }
  const a = e.target.closest('a.internal-link');
  if (a) {
    e.preventDefault();
    // Ctrl+Alt+click: the other pane. From the split pane the other pane is the main one, where links open anyway.
    const split = e.altKey && (e.ctrlKey || e.metaKey) && !a.closest('#split');
    if (a.dataset.path) return split && canSplit(a.dataset.href) ? openSplit(a.dataset.href) : openPath(a.dataset.href);
    return followLink(a.dataset.href, a.dataset.sub, a.dataset.from || S.cur, { split });
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

// ============================================================ Mermaid diagrams

// ```mermaid blocks, drawn by Mermaid (ui/vendor/mermaid.min.js, loaded the first time a note has
// one) in its strict mode (no scripts, no click handlers), in the light or dark theme to match.
// A diagram with a mistake shows Mermaid's message and its source. Exports wait for mermaidPending.
// A theme change redraws them: applyTheme re-renders the reading view and the editor's blocks.
let mermaidReady = null, mermaidSeq = 0, mermaidTheme = '';
const mermaidPending = new Set();
function loadMermaid() {
  if (!mermaidReady) mermaidReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/mermaid.min.js';
    s.onload = () => window.mermaid ? resolve(window.mermaid) : reject(new Error('Mermaid didn’t start'));
    s.onerror = () => { mermaidReady = null; s.remove(); reject(new Error('Mermaid didn’t load')); };
    document.head.append(s);
  });
  return mermaidReady;
}
function renderMermaidBlock(el, code) {
  el.classList.add('mermaid-block');
  el.dataset.src = code;
  if (!el.querySelector('svg')) el.innerHTML = '<div class="mermaid-wait">Drawing the diagram…</div>';
  const job = (async () => {
    let m;
    try { m = await loadMermaid(); } catch (e) { return mermaidError(el, code, e.message); }
    const theme = document.documentElement.dataset.theme === 'light' ? 'default' : 'dark';
    if (theme !== mermaidTheme) {
      m.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: getComputedStyle(document.body).fontFamily });
      mermaidTheme = theme;
    }
    const id = 'mermaid-' + ++mermaidSeq;
    try { el.innerHTML = (await m.render(id, code)).svg; }
    catch (e) { mermaidError(el, code, e?.message || String(e)); }
    finally { document.getElementById('d' + id)?.remove(); } // what Mermaid leaves behind after a mistake
  })();
  mermaidPending.add(job);
  job.finally(() => mermaidPending.delete(job));
  return job;
}
function mermaidError(el, code, msg) {
  const lines = String(msg).split('\n').filter(l => l.trim()).slice(0, 4).join('\n');
  el.innerHTML = `<div class="mermaid-error">This diagram has a mistake: <pre>${esc(lines)}</pre></div><pre class="mermaid-src"><code>${esc(code)}</code></pre>`;
}

