// HTML from the clipboard (a web page, a document, Cinder's own reading view) as Markdown, the way
// Obsidian pastes it. Returns null when the HTML carries no formatting worth keeping (code copied
// from an editor comes as styled <div>s and <span>s), so the plain text is pasted instead.

const FORMATTING = 'p, h1, h2, h3, h4, h5, h6, ul, ol, li, table, a[href], b, strong, em, i, img, blockquote, pre, code, del, s, mark, hr';
const BLOCKS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR', 'DL', 'DT', 'DD', 'DETAILS', 'SUMMARY']);

export function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll('script, style, noscript, template, title, meta, link')) el.remove();
  if (!doc.body.querySelector(FORMATTING)) return null;
  return block(doc.body).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Characters that would turn plain text into Markdown, escaped (and # > - + 1. at a line's start).
const escapeText = s => s.replace(/([\\`*_[\]])/g, '\\$1').replace(/==/g, '\\=\\=');
const escapeStart = s => s.replace(/^(\s*)([#>+-]|\d+[.)])(?=\s)/gm, '$1\\$2');

// An element's inline content: text and inline formatting, on one line (bar <br>s).
function inline(node, pre = false) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) { out += pre ? n.data : escapeText(n.data.replace(/\s+/g, ' ')); continue; }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = n.tagName, inner = () => inline(n, pre);
    if (BLOCKS.has(tag)) { out += ' ' + inner() + ' '; continue; }
    switch (tag) {
      case 'BR': out += '\n'; break;
      case 'B': case 'STRONG': out += /font-weight:\s*(normal|[1-5]00)/.test(n.getAttribute('style') || '') ? inner() : wrap(inner(), '**'); break;
      case 'I': case 'EM': out += wrap(inner(), '*'); break;
      case 'S': case 'DEL': case 'STRIKE': out += wrap(inner(), '~~'); break;
      case 'MARK': out += wrap(inner(), '=='); break;
      case 'CODE': case 'KBD': case 'SAMP': { const t = n.textContent; const fence = t.includes('`') ? '``' : '`'; out += t.trim() ? `${fence}${t}${fence}` : t; break; }
      case 'A': {
        const href = n.getAttribute('href') || '', text = inner().trim();
        const note = n.getAttribute('data-href'); // a link copied from Cinder's own reading view
        if (/^https?:|^mailto:/i.test(href)) out += !text || text === escapeText(href) ? href : `[${text}](${href.replace(/[ ()]/g, c => encodeURIComponent(c))})`;
        else if (note && n.classList.contains('internal-link')) {
          const name = note.replace(/\.md$/, '').split('/').pop(), label = n.textContent.trim();
          out += `[[${name}${label && label !== name ? '|' + label.replace(/[[\]|]/g, '') : ''}]]`;
        } else out += text;
        break;
      }
      case 'IMG': {
        const src = n.getAttribute('src') || '', alt = (n.getAttribute('alt') || '').replace(/[[\]]/g, '');
        if (/^https?:/i.test(src)) out += `![${alt}](${src.replace(/[ ()]/g, c => encodeURIComponent(c))})`;
        break;
      }
      case 'INPUT': if (n.getAttribute('type') === 'checkbox') out += n.hasAttribute('checked') ? '[x] ' : '[ ] '; break;
      case 'SPAN': {
        // Google Docs marks bold and italic with styles on spans.
        const st = n.getAttribute('style') || '';
        let t = inner();
        if (/font-weight:\s*(bold|[6-9]00)/.test(st)) t = wrap(t, '**');
        if (/font-style:\s*italic/.test(st)) t = wrap(t, '*');
        out += t;
        break;
      }
      default: out += inner();
    }
  }
  return out;
}

// **text**, with the marks inside any spaces at the ends (Markdown needs them against the text).
function wrap(t, mark) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t);
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : t;
}

// An element's content as Markdown blocks, separated by blank lines.
function block(node) {
  const parts = [];
  let run = null; // inline content between blocks
  const flush = () => { if (run && run.trim()) parts.push(escapeStart(run.trim())); run = null; };
  for (const n of node.childNodes) {
    if (n.nodeType === Node.ELEMENT_NODE && BLOCKS.has(n.tagName)) { flush(); const b = blockOf(n); if (b) parts.push(b); continue; }
    if (n.nodeType === Node.ELEMENT_NODE && n.tagName === 'BR') { run = (run || '') + '\n'; continue; }
    const wrapper = document.createElement('span');
    wrapper.append(n.cloneNode(true));
    run = (run || '') + inline(wrapper);
  }
  flush();
  return parts.join('\n\n');
}

function blockOf(n) {
  const tag = n.tagName;
  if (/^H[1-6]$/.test(tag)) { const t = inline(n).replace(/\s+/g, ' ').trim(); return t ? '#'.repeat(+tag[1]) + ' ' + t : ''; }
  switch (tag) {
    case 'P': case 'SUMMARY': case 'DT': case 'FIGCAPTION': return escapeStart(inline(n).trim());
    case 'HR': return '---';
    case 'UL': case 'OL': return list(n, 0);
    case 'BLOCKQUOTE': return block(n).split('\n').map(l => l ? '> ' + l : '>').join('\n');
    case 'PRE': {
      const code = n.querySelector('code'), lang = /(?:language|lang)-([\w+-]+)/.exec((code || n).className)?.[1] || '';
      const text = (code || n).textContent.replace(/\n$/, '');
      const fence = text.includes('```') ? '````' : '```';
      return `${fence}${lang}\n${text}\n${fence}`;
    }
    case 'TABLE': return table(n);
    default: return block(n);
  }
}

// A list, its items' own lists indented a tab further.
function list(n, depth) {
  const lines = [];
  let i = +(n.getAttribute('start') || 1);
  for (const li of n.children) {
    if (li.tagName !== 'LI') continue;
    const marker = n.tagName === 'OL' ? `${i++}. ` : '- ';
    const own = document.createElement('div'), subs = [];
    for (const c of li.childNodes) {
      if (c.nodeType === Node.ELEMENT_NODE && (c.tagName === 'UL' || c.tagName === 'OL')) subs.push(c);
      else own.append(c.cloneNode(true));
    }
    const text = inline(own).replace(/\s+/g, ' ').trim();
    lines.push('\t'.repeat(depth) + marker + text);
    for (const s of subs) lines.push(list(s, depth + 1));
  }
  return lines.join('\n');
}

function table(n) {
  const rows = [...n.querySelectorAll('tr')].filter(r => r.closest('table') === n);
  if (!rows.length) return '';
  const cells = rows.map(r => [...r.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH').map(c => inline(c).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')));
  const cols = Math.max(...cells.map(r => r.length));
  if (!cols) return '';
  const line = r => '| ' + Array.from({ length: cols }, (_, i) => r[i] || '').join(' | ') + ' |';
  return [line(cells[0]), '|' + ' --- |'.repeat(cols), ...cells.slice(1).map(line)].join('\n');
}
