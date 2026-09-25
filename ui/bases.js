/* Cinder bases: database-style views of notes and their properties, in the format of
 * Obsidian Bases (.base YAML files, or ```base blocks in notes): global and per-view
 * filters, formulas, sorting, grouping, and table / cards / list views, plus a board
 * (kanban) view where dragging a card changes the note's property.
 *
 * Filters and formulas are expressions in Obsidian's Bases syntax (`status != "done"`,
 * `file.hasTag("book")`, `price / pages`). They run in a small interpreter here, never as
 * JavaScript. The model/YAML/query parts don't touch the DOM and are tested under Node. */
'use strict';

(function (root) {
  // ============================================================ YAML (the subset .base files and frontmatter use)

  function stripComment(line) {
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === q && !(q === "'" && line[i + 1] === "'")) q = null; else if (q === "'" && c === "'") i++; else if (q === '"' && c === '\\') i++; continue; }
      if (c === '"' || c === "'") { if (i === 0 || /[\s:[{,-]/.test(line[i - 1])) q = c; continue; }
      if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
    }
    return line;
  }

  function scalar(s) {
    s = s.trim();
    if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
    if (/^(true|True|TRUE)$/.test(s)) return true;
    if (/^(false|False|FALSE)$/.test(s)) return false;
    if (/^[-+]?\d+$/.test(s) && Math.abs(+s) < 2 ** 53) return +s;
    if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(s)) return +s;
    if (s[0] === '"') return JSON.parse(s.replace(/\\'/g, "'"));
    if (s[0] === "'") return s.slice(1, -1).replace(/''/g, "'");
    return s;
  }

  // Flow collections: [a, "b", {c: 1}] and {a: 1, b: [2]}.
  function flow(s) {
    let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    function value() {
      ws();
      if (s[i] === '[') { i++; const a = []; ws(); if (s[i] === ']') { i++; return a; } for (;;) { a.push(value()); ws(); if (s[i] === ',') { i++; continue; } if (s[i] === ']') { i++; return a; } throw new Error('unclosed [ in YAML'); } }
      if (s[i] === '{') {
        i++; const o = {}; ws(); if (s[i] === '}') { i++; return o; }
        for (;;) {
          ws(); const k = token(true); ws();
          if (s[i] !== ':') throw new Error('expected : in YAML {…}');
          i++; o[k] = value(); ws();
          if (s[i] === ',') { i++; continue; }
          if (s[i] === '}') { i++; return o; }
          throw new Error('unclosed { in YAML');
        }
      }
      return scalar(token(false));
    }
    function token(isKey) {
      ws();
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i]; let j = i + 1;
        for (; j < s.length; j++) { if (s[j] === '\\' && q === '"') { j++; continue; } if (s[j] === q) { if (q === "'" && s[j + 1] === "'") { j++; continue; } break; } }
        const raw = s.slice(i, j + 1); i = j + 1;
        return isKey ? scalar(raw) : raw;
      }
      const start = i;
      while (i < s.length && !(isKey ? /[:,}\]]/ : /[,}\]]/).test(s[i])) i++;
      return s.slice(start, i).trim();
    }
    const v = value();
    ws();
    if (i < s.length) throw new Error('unexpected text after a YAML collection');
    return v;
  }

  const KEY_RE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#-][^:#]*?|-[^\s][^:#]*?)\s*:(?:\s+(.*)|\s*)$/;

  function parseYaml(src) {
    const lines = String(src).replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n').map(raw => {
      const text = stripComment(raw).replace(/\s+$/, '');
      return { raw, text, indent: text.match(/^ */)[0].length, blank: !text.trim() || text.trim() === '---' };
    });
    let i = 0;
    const peek = () => { while (i < lines.length && lines[i].blank) i++; return lines[i]; };

    function block(indent) {
      const l = peek();
      if (!l || l.indent < indent) return null;
      const t = l.text.slice(l.indent);
      if (t === '-' || t.startsWith('- ')) return seq(l.indent);
      if (KEY_RE.test(t)) return map(l.indent);
      // plain multi-line scalar
      const parts = [];
      while (peek() && lines[i].indent >= indent && !KEY_RE.test(lines[i].text.trim())) parts.push(lines[i++].text.trim());
      return inline(parts.join(' '));
    }
    function seq(indent) {
      const a = [];
      for (let l = peek(); l && l.indent === indent && (l.text.slice(indent) === '-' || l.text.slice(indent).startsWith('- ')); l = peek()) {
        const rest = l.text.slice(indent + 1).replace(/^ +/, '');
        const offset = l.text.length - rest.length;
        if (!rest) { i++; a.push(block(indent + 1)); continue; }
        if (KEY_RE.test(rest) && !/^["'[{]/.test(rest)) {
          // "- key: value" starts a mapping at the item's indentation
          lines[i] = { ...l, text: ' '.repeat(offset) + rest, indent: offset };
          a.push(map(offset));
          continue;
        }
        i++;
        a.push(valueAfter(rest, indent));
      }
      return a;
    }
    function map(indent) {
      const o = {};
      for (let l = peek(); l && l.indent === indent; l = peek()) {
        const m = KEY_RE.exec(l.text.slice(indent));
        if (!m) break;
        const key = /^["']/.test(m[1]) ? String(scalar(m[1])) : m[1].trim();
        i++;
        const rest = (m[2] || '').trim();
        if (!rest) {
          const nx = peek();
          if (nx && nx.indent > indent) o[key] = block(nx.indent);
          else if (nx && nx.indent === indent && (nx.text.slice(indent) === '-' || nx.text.slice(indent).startsWith('- '))) o[key] = seq(indent);
          else o[key] = null;
        } else o[key] = valueAfter(rest, indent);
      }
      return o;
    }
    function valueAfter(rest, indent) {
      const bs = /^([|>])([+-]?)\d*$/.exec(rest);
      if (bs) { // block scalar
        const body = [];
        let ind = null;
        while (i < lines.length && (lines[i].raw.trim() === '' || lines[i].raw.match(/^ */)[0].length > indent)) {
          const raw = lines[i].raw;
          if (raw.trim() && ind == null) ind = raw.match(/^ */)[0].length;
          body.push(raw.slice(Math.min(ind ?? 0, raw.match(/^ */)[0].length)));
          i++;
        }
        while (body.length && !body[body.length - 1].trim()) body.pop();
        const text = bs[1] === '|' ? body.join('\n') : body.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ');
        return bs[2] === '-' ? text : text + '\n';
      }
      return inline(rest);
    }
    function inline(s) { return /^[[{]/.test(s) ? flow(s) : scalar(s); }

    const first = peek();
    if (!first) return null;
    const v = block(first.indent);
    if (peek()) throw new Error(`YAML: can't read line ${i + 1}: "${lines[i].raw.trim()}"`);
    return v;
  }

  const needsQuote = s => s === '' || /^[\s]|[\s]$/.test(s) || /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || /: |\s#|\n/.test(s) || s.endsWith(':') ||
    /^(true|false|null|~|yes|no|on|off)$/i.test(s) || /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s);
  const yamlStr = s => needsQuote(s) ? (s.includes('\n') ? JSON.stringify(s) : `'${s.replace(/'/g, "''")}'`) : s;
  const yamlKey = k => /^[\w.$/-][\w .$/-]*$/.test(k) && !/^-|\s$/.test(k) ? k : yamlStr(k);
  function yamlScalar(v) {
    if (v == null) return '';
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    return yamlStr(String(v));
  }
  // Block-style YAML, two-space indents.
  function emitYaml(v, indent = 0) {
    const pad = ' '.repeat(indent);
    if (Array.isArray(v)) {
      if (!v.length) return pad + '[]';
      return v.map(x => {
        if (x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length) {
          const body = emitYaml(x, indent + 2);
          return pad + '- ' + body.slice(indent + 2);
        }
        if (Array.isArray(x) && x.length) return pad + '-\n' + emitYaml(x, indent + 2);
        return pad + '- ' + (Array.isArray(x) ? '[]' : x && typeof x === 'object' ? '{}' : yamlScalar(x));
      }).join('\n');
    }
    if (v && typeof v === 'object') {
      return Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => {
        if (Array.isArray(x)) return x.length ? `${pad}${yamlKey(k)}:\n${emitYaml(x, indent + 2)}` : `${pad}${yamlKey(k)}: []`;
        if (x && typeof x === 'object') return Object.keys(x).length ? `${pad}${yamlKey(k)}:\n${emitYaml(x, indent + 2)}` : `${pad}${yamlKey(k)}: {}`;
        const s = yamlScalar(x);
        return s === '' ? `${pad}${yamlKey(k)}:` : `${pad}${yamlKey(k)}: ${s}`;
      }).join('\n');
    }
    return pad + yamlScalar(v);
  }

  // ============================================================ frontmatter

  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;
  function frontmatter(content) {
    const m = FM_RE.exec(content || '');
    if (!m) return {};
    try { const v = parseYaml(m[1]); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
  }

  // A top-level "key:" line, bare or quoted.
  const fmKeyRe = key => new RegExp(`^(${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|"${key.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&')}"|'${key.replace(/[.*+?^${}()|[\]\\']/g, '\\$&')}')\\s*:`);

  // Rename a top-level frontmatter property where it stands, leaving its value's text alone.
  function renameFrontmatter(content, from, to) {
    const m = FM_RE.exec(content || '');
    if (!m || from === to || !to) return content;
    const lines = m[1].split(/\r?\n/), re = fmKeyRe(from);
    const at = lines.findIndex(l => re.test(l));
    if (at < 0) return content;
    lines[at] = lines[at].replace(re, yamlKey(to) + ':');
    return `---\n${lines.join('\n')}\n---\n` + content.slice(m[0].length);
  }

  // Set (or with value === undefined, remove) one top-level frontmatter property,
  // leaving the rest of the note's text untouched.
  function setFrontmatter(content, key, value) {
    const entry = value === undefined ? '' : emitYaml({ [key]: Array.isArray(value) && !value.length ? null : value });
    const m = FM_RE.exec(content);
    if (!m) return value === undefined ? content : `---\n${entry}\n---\n${content}`;
    const lines = m[1].split(/\r?\n/);
    const keyRe = fmKeyRe(key);
    let at = lines.findIndex(l => keyRe.test(l));
    if (at >= 0) {
      let end = at + 1;
      while (end < lines.length && (/^\s/.test(lines[end]) || /^-(\s|$)/.test(lines[end]) || lines[end] === '')) end++;
      while (end > at + 1 && lines[end - 1] === '') end--;
      lines.splice(at, end - at, ...(entry ? entry.split('\n') : []));
    } else if (entry) {
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      lines.push(...entry.split('\n'));
    }
    const body = lines.join('\n');
    return (body.trim() ? `---\n${body}\n---\n` : '') + content.slice(m[0].length);
  }

  // ============================================================ values

  const DAY = 864e5;
  class FDate {
    constructor(t, dateOnly = false) { this.t = t; this.dateOnly = dateOnly; }
    valueOf() { return this.t; }
    toString() { return fmtDate(this); }
  }
  class Duration { constructor(ms) { this.ms = ms; } valueOf() { return this.ms; } toString() { return humanDuration(this.ms); } }
  class Link { constructor(path, display) { this.path = path; this.display = display; } toString() { return this.display || this.path; } }

  const pad2 = n => String(n).padStart(2, '0');
  function fmtDate(d, fmt) {
    const x = new Date(d.t);
    if (fmt) return root.CinderTemplater ? root.CinderTemplater.formatDate(x, fmt) : fmtDate(d);
    const ymd = `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
    return d.dateOnly || (x.getHours() === 0 && x.getMinutes() === 0) ? ymd : `${ymd} ${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
  }
  function humanDuration(ms) {
    const a = Math.abs(ms), units = [['year', 365 * DAY], ['month', 30 * DAY], ['week', 7 * DAY], ['day', DAY], ['hour', 36e5], ['minute', 6e4]];
    for (const [u, n] of units) if (a >= n) { const v = Math.floor(a / n); return `${v} ${u}${v === 1 ? '' : 's'}`; }
    return 'just now';
  }
  function relative(d, now = Date.now()) {
    const diff = d.t - now;
    if (d.dateOnly) {
      const today = new Date(now); today.setHours(0, 0, 0, 0);
      const days = Math.round((d.t - today.getTime()) / DAY);
      if (days === 0) return 'today';
      if (days === 1) return 'tomorrow';
      if (days === -1) return 'yesterday';
      if (Math.abs(days) < 7) return days > 0 ? `in ${days} days` : `${-days} days ago`;
    }
    const h = humanDuration(diff);
    return h === 'just now' ? h : diff > 0 ? `in ${h}` : `${h} ago`;
  }

  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;
  function toDate(v) {
    if (v instanceof FDate) return v;
    if (typeof v === 'number') return new FDate(v);
    if (typeof v === 'string') {
      const m = DATE_RE.exec(v.trim());
      if (m) return new FDate(new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime(), !m[4]);
    }
    return null;
  }
  // "1d", "2 weeks", "-3h", "1M" -> milliseconds (months/years are calendar-aware in addDuration)
  function parseDuration(s) {
    const out = { ms: 0, months: 0 };
    const re = /([-+]?\d+(?:\.\d+)?)\s*(y|years?|M|months?|w|weeks?|d|days?|h|hours?|m|min|minutes?|s|seconds?)\b/g;
    let m, any = false;
    while ((m = re.exec(String(s)))) {
      any = true;
      const n = +m[1], u = m[2];
      if (/^y/.test(u)) out.months += 12 * n;
      else if (u === 'M' || /^month/.test(u)) out.months += n;
      else if (/^w/.test(u)) out.ms += n * 7 * DAY;
      else if (/^d/.test(u)) out.ms += n * DAY;
      else if (/^h/.test(u)) out.ms += n * 36e5;
      else if (/^m/.test(u)) out.ms += n * 6e4;
      else out.ms += n * 1e3;
    }
    return any ? out : null;
  }
// Difference in local wall-clock time, so a span across a daylight-saving change still counts whole days.
  const wallDiff = (a, b) => a.t - b.t - (new Date(a.t).getTimezoneOffset() - new Date(b.t).getTimezoneOffset()) * 6e4;
  function addDuration(d, dur, sign) {
    const x = new Date(d.t);
    if (dur.months) x.setMonth(x.getMonth() + sign * dur.months);
    return new FDate(x.getTime() + sign * dur.ms, d.dateOnly && dur.ms % DAY === 0);
  }

  const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !(v instanceof FDate) && !(v instanceof Link) && !(v instanceof Duration) && !Array.isArray(v) && !Object.keys(v).length);

  function display(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(display).join(', ');
    if (v instanceof FDate) return fmtDate(v);
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
    if (typeof v === 'object' && !(v instanceof Link) && !(v instanceof Duration)) return JSON.stringify(v);
    return String(v);
  }

  // ============================================================ expressions

  function lex(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1]))) { const m = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(src.slice(i)); out.push({ t: 'num', v: +m[0] }); i += m[0].length; continue; }
      if (/[A-Za-z_$\u00C0-\uFFFF]/.test(c)) { const m = /^[A-Za-z_$\u00C0-\uFFFF][\w$\u00C0-\uFFFF]*/.exec(src.slice(i)); out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if (c === '"' || c === "'") {
        let s = '', j = i + 1;
        for (; j < src.length && src[j] !== c; j++) { if (src[j] === '\\') { j++; s += ({ n: '\n', t: '\t' })[src[j]] ?? src[j]; } else s += src[j]; }
        if (j >= src.length) throw new Error('a string is never closed');
        out.push({ t: 'str', v: s }); i = j + 1; continue;
      }
      const p = ['===', '!==', '==', '!=', '>=', '<=', '&&', '||', '>', '<', '!', '+', '-', '*', '/', '%', '(', ')', '[', ']', ',', '.', '?', ':'].find(x => src.startsWith(x, i));
      if (!p) throw new Error(`unexpected "${c}"`);
      out.push({ t: 'p', v: p === '===' ? '==' : p === '!==' ? '!=' : p }); i += p.length;
    }
    out.push({ t: 'eof' });
    return out;
  }
  const exprCache = new Map();
  function parseExpr(src) {
    if (exprCache.has(src)) return exprCache.get(src);
    const toks = lex(String(src));
    let i = 0;
    const is = v => toks[i].t === 'p' && toks[i].v === v;
    const isId = v => toks[i].t === 'id' && toks[i].v === v;
    const expect = v => { if (!is(v)) throw new Error(`expected "${v}"`); i++; };
    const LV = [['||', 'or'], ['&&', 'and'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
    function expr() {
      const c = bin(0);
      if (!is('?')) return c;
      i++; const a = expr(); expect(':');
      return { k: 'cond', c, a, b: expr() };
    }
    function bin(l) {
      if (l === LV.length) return unary();
      let a = bin(l + 1);
      for (;;) {
        const tk = toks[i];
        const op = tk.t === 'p' && LV[l].includes(tk.v) ? tk.v : tk.t === 'id' && LV[l].includes(tk.v) ? (tk.v === 'and' ? '&&' : '||') : null;
        if (!op) return a;
        i++;
        a = { k: 'bin', op, a, b: bin(l + 1) };
      }
    }
    function unary() {
      if (is('!') || isId('not')) { i++; return { k: 'not', a: unary() }; }
      if (is('-')) { i++; return { k: 'neg', a: unary() }; }
      return post();
    }
    function post() {
      let e = prim();
      for (;;) {
        if (is('.')) { i++; if (toks[i].t !== 'id') throw new Error('expected a name after "."'); e = { k: 'get', o: e, n: toks[i++].v }; }
        else if (is('[')) { i++; const n = expr(); expect(']'); e = { k: 'idx', o: e, n }; }
        else if (is('(')) { i++; const args = []; while (!is(')')) { args.push(expr()); if (!is(')')) expect(','); } i++; e = { k: 'call', f: e, args }; }
        else return e;
      }
    }
    function prim() {
      const tk = toks[i++];
      if (tk.t === 'num' || tk.t === 'str') return { k: 'lit', v: tk.v };
      if (tk.t === 'id') {
        if (tk.v === 'true' || tk.v === 'false') return { k: 'lit', v: tk.v === 'true' };
        if (tk.v === 'null') return { k: 'lit', v: null };
        return { k: 'id', n: tk.v };
      }
      if (tk.t === 'p' && tk.v === '(') { const e = expr(); expect(')'); return e; }
      if (tk.t === 'p' && tk.v === '[') { const items = []; while (!is(']')) { items.push(expr()); if (!is(']')) expect(','); } i++; return { k: 'arr', items }; }
      throw new Error(tk.t === 'eof' ? 'the expression ends too soon' : `unexpected "${tk.v}"`);
    }
    const ast = expr();
    if (toks[i].t !== 'eof') throw new Error(`unexpected "${toks[i].v}"`);
    exprCache.set(src, ast);
    return ast;
  }

  // Tags match themselves and their nested tags: "book" matches "book/fiction".
  const tagMatch = (have, want) => { want = String(want).replace(/^#/, '').toLowerCase(); return have.some(t => t === want || t.startsWith(want + '/')); };

  // The value `file` refers to for a row.
  function fileObject(row, ctx) {
    const o = {
      __file: row,
      name: row.name, basename: row.basename, path: row.path, folder: row.folder, ext: row.ext, size: row.size,
      ctime: new FDate(row.ctime), mtime: new FDate(row.mtime), tags: row.tags.map(t => '#' + t),
      links: row.links.map(p => new Link(p)), properties: row.props,
    };
    // Backlinks cost a vault scan, so only when an expression asks for them.
    Object.defineProperty(o, 'backlinks', { enumerable: true, get: () => ctx.backlinks ? ctx.backlinks(row.path).map(p => new Link(p)) : [] });
    return o;
  }

  const eq = (a, b) => {
    if (a instanceof Link || b instanceof Link) return linkKey(a) === linkKey(b);
    const da = a instanceof FDate ? a : null, db = b instanceof FDate ? b : null;
    if (da || db) { const x = da || toDate(a), y = db || toDate(b); return !!x && !!y && (x.dateOnly || y.dateOnly ? sameDay(x, y) : x.t === y.t); }
    if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '' && !isNaN(+b)) return a === +b;
    if (typeof b === 'number' && typeof a === 'string' && a.trim() !== '' && !isNaN(+a)) return +a === b;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, k) => eq(x, b[k]));
    if (a == null || a === '') return b == null || b === '';
    return a === b;
  };
  const sameDay = (x, y) => { const a = new Date(x.t), b = new Date(y.t); return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
  const linkKey = v => v instanceof Link ? v.path.toLowerCase().replace(/\.md$/, '') : typeof v === 'string' ? v.replace(/^\[\[|\]\]$/g, '').split('|')[0].toLowerCase().replace(/\.md$/, '') : v && v.__file ? v.__file.path.toLowerCase().replace(/\.md$/, '') : String(v);
  function cmp(a, b) {
    if (a instanceof FDate || b instanceof FDate) { const x = toDate(a), y = toDate(b); if (!x || !y) return NaN; return x.t - y.t; }
    const na = typeof a === 'number' ? a : typeof a === 'string' && a.trim() !== '' && !isNaN(+a) ? +a : NaN;
    const nb = typeof b === 'number' ? b : typeof b === 'string' && b.trim() !== '' && !isNaN(+b) ? +b : NaN;
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    if (a == null || b == null) return NaN;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  const FUNCS = {
    if: (c, a, b) => truthy(c) ? a : (b ?? null),
    now: () => new FDate(Date.now()),
    today: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return new FDate(d.getTime(), true); },
    date: s => toDate(s),
    duration: s => { const d = parseDuration(s); return d ? new Duration(d.ms + d.months * 30 * DAY) : null; },
    number: v => v instanceof FDate ? v.t : typeof v === 'boolean' ? +v : v == null || v === '' ? null : isNaN(+v) ? null : +v,
    string: v => display(v),
    link: (p, d) => new Link(String(p).replace(/^\[\[|\]\]$/g, ''), d),
    list: v => Array.isArray(v) ? v : v == null ? [] : [v],
    min: (...a) => Math.min(...a.flat().map(Number)), max: (...a) => Math.max(...a.flat().map(Number)),
    // Maths on an empty value stays empty rather than becoming 0.
    abs: v => v == null ? null : Math.abs(v), round: (v, d = 0) => v == null ? null : Math.round(v * 10 ** d) / 10 ** d,
    floor: v => v == null ? null : Math.floor(v), ceil: v => v == null ? null : Math.ceil(v),
  };
  const truthy = v => Array.isArray(v) ? v.length > 0 : !!v && v !== 'false';

  // Methods callable on values, by type.
  function method(v, name, args, ctx) {
    if (v && v.__file) {
      const row = v.__file;
      switch (name) {
        case 'hasTag': return args.some(t => tagMatch(row.tags, t));
        case 'inFolder': { const f = String(args[0] ?? '').replace(/^\/+|\/+$/g, ''); return f === '' || row.folder === f || row.folder.startsWith(f + '/'); }
        case 'hasProperty': return Object.prototype.hasOwnProperty.call(row.props, String(args[0]));
        case 'hasLink': return args.some(a => row.links.some(p => linkKey(new Link(p)) === linkKey(a) || linkKey(new Link(p.split('/').pop())) === linkKey(a)));
        case 'asLink': return new Link(row.path, args[0]);
      }
    }
    if (v instanceof FDate) {
      switch (name) {
        case 'format': return fmtDate(v, args[0] || 'YYYY-MM-DD');
        case 'date': { const d = new Date(v.t); d.setHours(0, 0, 0, 0); return new FDate(d.getTime(), true); }
        case 'relative': return relative(v);
        case 'isEmpty': return false;
      }
    }
    if (v instanceof Duration) { if (name === 'format') return humanDuration(v.ms); }
    if (typeof v === 'string') {
      switch (name) {
        case 'contains': return v.toLowerCase().includes(String(args[0] ?? '').toLowerCase());
        case 'containsAny': return args.some(a => v.toLowerCase().includes(String(a).toLowerCase()));
        case 'containsAll': return args.every(a => v.toLowerCase().includes(String(a).toLowerCase()));
        case 'startsWith': return v.toLowerCase().startsWith(String(args[0] ?? '').toLowerCase());
        case 'endsWith': return v.toLowerCase().endsWith(String(args[0] ?? '').toLowerCase());
        case 'lower': return v.toLowerCase();
        case 'upper': return v.toUpperCase();
        case 'title': return v.replace(/\b\w/g, c => c.toUpperCase());
        case 'trim': return v.trim();
        case 'replace': return v.split(String(args[0])).join(String(args[1] ?? ''));
        case 'slice': return v.slice(args[0], args[1]);
        case 'split': return v.split(String(args[0] ?? ','));
        case 'isEmpty': return v.trim() === '';
        case 'toString': return v;
      }
    }
    if (Array.isArray(v)) {
      switch (name) {
        case 'contains': return v.some(x => eq(x, args[0]) || (typeof x === 'string' && typeof args[0] === 'string' && x.replace(/^#/, '').toLowerCase() === args[0].replace(/^#/, '').toLowerCase()));
        case 'containsAny': return args.some(a => v.some(x => eq(x, a)));
        case 'containsAll': return args.every(a => v.some(x => eq(x, a)));
        case 'join': return v.map(display).join(args[0] ?? ', ');
        case 'isEmpty': return !v.length;
        case 'first': return v[0] ?? null;
        case 'last': return v[v.length - 1] ?? null;
        case 'sort': return [...v].sort(cmp);
        case 'unique': return v.filter((x, k) => v.findIndex(y => eq(x, y)) === k);
        case 'slice': return v.slice(args[0], args[1]);
      }
    }
    if (typeof v === 'number') {
      switch (name) {
        case 'toFixed': return v.toFixed(args[0] ?? 0);
        case 'round': return FUNCS.round(v, args[0] ?? 0);
        case 'floor': return Math.floor(v);
        case 'ceil': return Math.ceil(v);
        case 'abs': return Math.abs(v);
        case 'isEmpty': return false;
      }
    }
    if (name === 'isEmpty') return isEmpty(v);
    if (name === 'toString') return display(v);
    throw new Error(`${name}() isn't available on ${v == null ? 'an empty value' : Array.isArray(v) ? 'a list' : v instanceof FDate ? 'a date' : typeof v}`);
  }

  function prop(v, name) {
    if (v == null) return null;
    if (v instanceof FDate) {
      const d = new Date(v.t);
      return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), weekday: d.getDay() }[name] ?? null;
    }
    if (v instanceof Duration) return { days: Math.floor(v.ms / DAY), hours: Math.floor(v.ms / 36e5), minutes: Math.floor(v.ms / 6e4), seconds: Math.floor(v.ms / 1e3) }[name] ?? null;
    if (typeof v === 'string' || Array.isArray(v)) return name === 'length' ? v.length : null;
    if (typeof v === 'object' && !(v instanceof Link) && Object.prototype.hasOwnProperty.call(v, name) && name !== '__file') return v[name];
    if (v instanceof Link && name === 'path') return v.path;
    return null;
  }

  // Evaluate expression `src` for a row. ctx: {formulas, thisRow, backlinks, depth}
  function evaluate(src, row, ctx = {}) {
    const ast = typeof src === 'string' ? parseExpr(src) : src;
    const fcache = ctx.fcache || (ctx.fcache = new Map());
    const formula = name => {
      const key = row.path + '\u0000' + name;
      if (fcache.has(key)) { const v = fcache.get(key); if (v === CYCLE) throw new Error(`formula "${name}" refers to itself`); return v; }
      const f = ctx.formulas?.[name];
      if (f == null) return null;
      fcache.set(key, CYCLE);
      let v;
      try { v = evaluate(String(f), row, ctx); } catch (e) { fcache.delete(key); throw e; }
      fcache.set(key, v);
      return v;
    };
    const ev = e => {
      switch (e.k) {
        case 'lit': return e.v;
        case 'arr': return e.items.map(ev);
        case 'id': {
          if (e.n === 'file') return fileObject(row, ctx);
          if (e.n === 'note') return row.props;
          if (e.n === 'formula') return { __formula: true };
          if (e.n === 'this') return ctx.thisRow ? { file: fileObject(ctx.thisRow, ctx), ...ctx.thisRow.props, __this: ctx.thisRow } : {};
          // A bare name is always a note property (a note may well have a "date" property);
          // names only mean functions when called, see 'call' below.
          return Object.prototype.hasOwnProperty.call(row.props, e.n) ? row.props[e.n] : null;
        }
        case 'get': case 'idx': {
          const o = ev(e.o), n = e.k === 'get' ? e.n : display(ev(e.n));
          if (o && o.__formula) return formula(n);
          if (o && o.__file && n === 'file') return o;
          return prop(o, n);
        }
        case 'call': {
          if (e.f.k === 'get') {
            const o = ev(e.f.o);
            if (o && o.__formula) throw new Error('formulas are values, not functions');
            return method(o, e.f.n, e.args.map(ev), ctx);
          }
          if (e.f.k !== 'id' || !Object.prototype.hasOwnProperty.call(FUNCS, e.f.n)) throw new Error(`${e.f.n || 'that'} is not a function`);
          if (e.f.n === 'if') return truthy(ev(e.args[0])) ? ev(e.args[1]) : (e.args[2] ? ev(e.args[2]) : null);
          return FUNCS[e.f.n](...e.args.map(ev));
        }
        case 'not': return !truthy(ev(e.a));
        case 'neg': { const v = ev(e.a); return v == null ? null : -v; }
        case 'cond': return truthy(ev(e.c)) ? ev(e.a) : ev(e.b);
        case 'bin': {
          if (e.op === '&&') { const a = ev(e.a); return truthy(a) ? ev(e.b) : a; }
          if (e.op === '||') { const a = ev(e.a); return truthy(a) ? a : ev(e.b); }
          const a = ev(e.a), b = ev(e.b);
          switch (e.op) {
            case '==': return eq(a, b);
            case '!=': return !eq(a, b);
            case '<': return cmp(a, b) < 0; case '>': return cmp(a, b) > 0;
            case '<=': return cmp(a, b) <= 0; case '>=': return cmp(a, b) >= 0;
            case '+': case '-': {
              if (a instanceof FDate || (e.op === '-' && b instanceof FDate)) {
                if (b instanceof FDate || (e.op === '-' && toDate(b) && typeof b === 'string' && DATE_RE.test(b))) {
                  const da = toDate(a), db = toDate(b);
                  if (!da || !db) throw new Error(`can't subtract "${display(b)}" from "${display(a)}"`);
                  return new Duration(wallDiff(da, db));
                }
                if (!(a instanceof FDate)) throw new Error(`can't subtract a date from "${display(a)}"`);
                const d = b instanceof Duration ? { ms: b.ms, months: 0 } : parseDuration(b);
                if (!d) throw new Error(`can't add "${display(b)}" to a date (use something like "1d" or "2 weeks")`);
                return addDuration(a, d, e.op === '+' ? 1 : -1);
              }
              if (e.op === '+' && (typeof a === 'string' || typeof b === 'string')) return display(a) + display(b);
              if (a == null || b == null) return null;
              return e.op === '+' ? Number(a) + Number(b) : Number(a) - Number(b);
            }
            case '*': return a == null || b == null ? null : Number(a) * Number(b);
            case '/': return a == null || b == null || Number(b) === 0 ? null : Number(a) / Number(b);
            case '%': return a == null || b == null ? null : Number(a) % Number(b);
          }
        }
      }
      throw new Error('unsupported expression');
    };
    return ev(ast);
  }
  const CYCLE = Symbol('cycle');

  // ============================================================ bases & queries

  const VIEW_TYPES = ['table', 'cards', 'list', 'board'];

  function parseBase(text) {
    const v = text && text.trim() ? parseYaml(text) : {};
    if (v !== null && (typeof v !== 'object' || Array.isArray(v))) throw new Error('A base must be a YAML mapping (filters:, views:, …).');
    const base = v || {};
    if (!Array.isArray(base.views) || !base.views.length) base.views = [{ type: 'table', name: 'Table' }];
    base.views = base.views.map((vw, k) => ({ ...(vw && typeof vw === 'object' ? vw : {}), type: VIEW_TYPES.includes(vw?.type) ? vw.type : 'table', name: String(vw?.name ?? `View ${k + 1}`) }));
    return base;
  }
  const serializeBase = base => emitYaml(base) + '\n';

  // Filter trees: an expression string, or {and|or|not: [...]}.
  function passes(filter, row, ctx) {
    if (filter == null) return true;
    if (typeof filter === 'string') return truthy(evaluate(filter, row, ctx));
    if (typeof filter === 'boolean') return filter;
    if (Array.isArray(filter)) return filter.every(f => passes(f, row, ctx));
    if (filter.and) return [].concat(filter.and).every(f => passes(f, row, ctx));
    if (filter.or) return [].concat(filter.or).some(f => passes(f, row, ctx));
    if (filter.not) return ![].concat(filter.not).some(f => passes(f, row, ctx));
    return true;
  }

  // The value of a column ("file.name", "status", "note.status", "formula.x") for a row.
  function valueOf(id, row, ctx) {
    if (id.startsWith('formula.')) return evaluate(`formula[${JSON.stringify(id.slice(8))}]`, row, ctx);
    if (id.startsWith('file.')) return evaluate(id, row, ctx);
    const key = id.startsWith('note.') ? id.slice(5) : id;
    return Object.prototype.hasOwnProperty.call(row.props, key) ? row.props[key] : null;
  }
  const propKey = id => id.startsWith('note.') ? id.slice(5) : id.startsWith('file.') || id.startsWith('formula.') ? null : id;

  // Run a view. Returns {rows, groups: [{key, value, rows}], columns, errors, total}.
  function query(base, viewIndex, allRows, opts = {}) {
    const view = base.views[viewIndex] || base.views[0];
    const ctx = { formulas: base.formulas || {}, thisRow: opts.thisRow || null, backlinks: opts.backlinks, fcache: new Map() };
    const errors = new Set();
    const safe = (fn, dflt) => { try { return fn(); } catch (e) { errors.add(e.message); return dflt; } };
    let rows = allRows.filter(r => safe(() => passes(base.filters, r, ctx) && passes(view.filters, r, ctx), false));
    const total = rows.length;
    if (opts.search) {
      const q = opts.search.toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(q) || Object.values(r.props).some(v => display(v).toLowerCase().includes(q)));
    }
    const sorts = [].concat(view.sort || []).filter(s => s && s.property);
    if (sorts.length) {
      const keyed = rows.map(r => ({ r, k: sorts.map(s => safe(() => valueOf(s.property, r, ctx), null)) }));
      keyed.sort((a, b) => {
        for (let k = 0; k < sorts.length; k++) {
          const x = a.k[k], y = b.k[k], dir = String(sorts[k].direction || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;
          if (isEmpty(x) && isEmpty(y)) continue;
          if (isEmpty(x)) return 1; // empties last either way
          if (isEmpty(y)) return -1;
          const c = cmp(x, y);
          if (c && !isNaN(c)) return c * dir;
        }
        return a.r.name.localeCompare(b.r.name, undefined, { numeric: true });
      });
      rows = keyed.map(x => x.r);
    } else rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (view.limit > 0) rows = rows.slice(0, view.limit);
    let columns = [].concat(view.order || []).filter(Boolean).map(String);
    if (!columns.length) columns = defaultColumns(rows);
    let groups = null;
    const gp = view.groupBy && (typeof view.groupBy === 'string' ? view.groupBy : view.groupBy.property);
    if (gp) {
      const map = new Map();
      for (const r of rows) {
        const v = safe(() => valueOf(gp, r, ctx), null);
        const vals = Array.isArray(v) && view.type === 'board' ? (v.length ? v : [null]) : [v];
        for (const x of vals) {
          const key = isEmpty(x) ? '' : display(x);
          if (!map.has(key)) map.set(key, { key, value: isEmpty(x) ? null : x, rows: [] });
          map.get(key).rows.push(r);
        }
      }
      const dir = String(view.groupBy.direction || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;
      groups = [...map.values()].sort((a, b) => a.key === '' ? 1 : b.key === '' ? -1 : (cmp(a.value, b.value) || a.key.localeCompare(b.key)) * dir);
    }
    return { rows, groups, columns, errors: [...errors], total, ctx };
  }

  // Without an explicit column list: the name, then the properties most notes here have.
  function defaultColumns(rows) {
    const count = new Map();
    for (const r of rows) for (const k of Object.keys(r.props)) if (k !== 'position') count.set(k, (count.get(k) || 0) + 1);
    return ['file.name', ...[...count].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k)];
  }

  const BUILTIN = { 'file.name': 'Name', 'file.basename': 'Name', 'file.path': 'Path', 'file.folder': 'Folder', 'file.ext': 'Extension', 'file.size': 'Size', 'file.ctime': 'Created', 'file.mtime': 'Modified', 'file.tags': 'Tags', 'file.links': 'Links', 'file.backlinks': 'Backlinks' };
  function columnName(base, id) {
    const dn = base.properties?.[id]?.displayName ?? base.properties?.[propKey(id) || '']?.displayName ?? base.properties?.['note.' + id]?.displayName;
    if (dn) return String(dn);
    if (BUILTIN[id]) return BUILTIN[id];
    return id.replace(/^(note|formula)\./, '');
  }

  // Summary of a column: numbers get a sum and average; otherwise how many are filled.
  function summarize(values) {
    const nums = values.filter(v => typeof v === 'number');
    const filled = values.filter(v => !isEmpty(v)).length;
    if (nums.length && nums.length === filled) {
      const sum = nums.reduce((a, b) => a + b, 0);
      return { kind: 'number', sum, avg: sum / nums.length, filled };
    }
    if (values.length && values.every(v => typeof v === 'boolean' || v == null)) return { kind: 'check', checked: values.filter(v => v === true).length, filled: values.length };
    return { kind: 'filled', filled };
  }

  // A filter expression from the filter builder's parts.
  function buildFilter(prop, op, value) {
    const ref = prop.startsWith('file.') || prop.startsWith('formula.') || prop.startsWith('note.') ? prop : /^[A-Za-z_]\w*$/.test(prop) ? prop : `note[${JSON.stringify(prop)}]`;
    const lit = v => v === '' ? '""' : !isNaN(+v) && String(v).trim() !== '' ? String(+v) : /^(true|false)$/.test(v) ? v : JSON.stringify(v);
    switch (op) {
      case 'is': return `${ref} == ${lit(value)}`;
      case 'is not': return `${ref} != ${lit(value)}`;
      case 'contains': return `${ref}.contains(${JSON.stringify(value)})`;
      case 'does not contain': return `!${ref}.contains(${JSON.stringify(value)})`;
      case '>': case '<': case '>=': case '<=': return `${ref} ${op} ${DATE_RE.test(value) ? `date(${JSON.stringify(value)})` : lit(value)}`;
      case 'is empty': return `${ref}.isEmpty()`;
      case 'is not empty': return `!${ref}.isEmpty()`;
      case 'has tag': return `file.hasTag(${JSON.stringify(String(value).replace(/^#/, ''))})`;
      case 'in folder': return `file.inFolder(${JSON.stringify(value)})`;
      case 'links to': return `file.hasLink(${JSON.stringify(value)})`;
    }
    throw new Error('unknown filter operator');
  }

  // Properties to pre-fill on a note created from a view: simple `x == "y"` filters and inFolder.
  function newNoteDefaults(base, view) {
    const props = {};
    let folder = null;
    const walk = f => {
      if (typeof f === 'string') {
        let m;
        if ((m = /^\s*(?:note\.)?([A-Za-z_][\w-]*)\s*==\s*("(?:[^"\\]|\\.)*"|'[^']*'|-?\d+(?:\.\d+)?|true|false)\s*$/.exec(f))) props[m[1]] = scalar(m[2]);
        else if ((m = /^\s*file\.inFolder\(\s*["']([^"']+)["']\s*\)\s*$/.exec(f))) folder = m[1];
        else if ((m = /^\s*file\.hasTag\(\s*["']([^"']+)["']\s*\)\s*$/.exec(f))) props.tags = [...(props.tags || []), m[1]];
      } else if (f && typeof f === 'object' && !Array.isArray(f) && f.and) [].concat(f.and).forEach(walk);
      else if (Array.isArray(f)) f.forEach(walk);
    };
    walk(base.filters); walk(view.filters);
    return { props, folder };
  }

  const pure = {
    parseYaml, emitYaml, frontmatter, setFrontmatter, renameFrontmatter, parseExpr, evaluate, parseBase, serializeBase, query, valueOf, propKey,
    columnName, display, summarize, buildFilter, newNoteDefaults, relative, toDate, isEmpty, FDate, Link, Duration, VIEW_TYPES, BUILTIN,
  };

  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = pure;
    return;
  }

  // ============================================================ UI

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = p => `<svg viewBox="0 0 24 24">${p}</svg>`;
  const VIEW_ICON = {
    table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
    cards: '<rect x="3.5" y="4.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="4.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    board: '<rect x="3.5" y="4.5" width="5" height="15" rx="1.5"/><rect x="9.5" y="4.5" width="5" height="10" rx="1.5"/><rect x="15.5" y="4.5" width="5" height="12" rx="1.5"/>',
  };

  // Mount a base into `el`. o: {base, text, path, view (name), editable (config can be saved),
  // hooks: {rows(), thisRow, backlinks, openFile, setProperty, createNote, save(base), menu, prompt, toast, renderValueLink}}
  // Returns {refresh(), setBase(base), destroy()}.
  // Per-embed UI state (view, search, open panel), so a rebuilt embed looks the same.
  const uiState = new Map();
  function mount(el, o) {
    let base = o.base;
    let vi = Math.max(0, base.views.findIndex(v => v.name === o.view));
    let search = '', searchFocus = false;
    let panel = null; // open popover: 'filter' | 'props' | 'sort'
    const kept = o.stateKey && uiState.get(o.stateKey);
    if (kept) { vi = Math.min(kept.vi, base.views.length - 1); search = kept.search; panel = kept.panel; }
    const h = o.hooks;
    el.classList.add('bs-root');
    if (o.embedded) el.classList.add('bs-embedded');

    const view = () => base.views[vi] || base.views[0];
    function save() { if (o.editable) h.save?.(base); render(); }

    function render() {
      if (o.stateKey) uiState.set(o.stateKey, { vi, search, panel });
      const scrollers = [...el.querySelectorAll('.bs-scroll')].map(s => [s.scrollLeft, s.scrollTop]);
      let r;
      try { r = query(base, vi, h.rows(), { search, thisRow: h.thisRow?.(), backlinks: h.backlinks }); }
      catch (e) { el.innerHTML = `<div class="bs-error">${esc(e.message)}</div>`; return; }
      const v = view();
      el.innerHTML = toolbar(r) + (panel ? panelHtml(r) : '') + `<div class="bs-body bs-view-${v.type}">${body(r)}</div>` +
        (r.errors.length ? `<div class="bs-error">${r.errors.map(esc).join('<br>')}</div>` : '');
      el.querySelectorAll('.bs-scroll').forEach((s, k) => { if (scrollers[k]) [s.scrollLeft, s.scrollTop] = scrollers[k]; });
      const si = el.querySelector('.bs-search');
      if (si && searchFocus) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); searchFocus = false; }
    }

    function toolbar(r) {
      const tabs = base.views.map((v, k) => `<button class="bs-tab${k === vi ? ' on' : ''}" data-view="${k}" title="${esc(v.type)} view">${ICON(VIEW_ICON[v.type] || VIEW_ICON.table)}<span>${esc(v.name)}</span></button>`).join('');
      const nf = [].concat(view().filters ? flatFilters(view().filters) : []).length;
      const ns = [].concat(view().sort || []).length;
      return `<div class="bs-bar">
        <div class="bs-tabs">${tabs}${o.editable ? `<button class="bs-tab bs-add" data-act="add-view" title="Add a view">${ICON('<path d="M12 6v12M6 12h12"/>')}</button>` : ''}</div>
        <div class="bs-grow"></div>
        <span class="bs-count">${r.rows.length === r.total ? r.total : `${r.rows.length} of ${r.total}`} ${r.total === 1 ? 'result' : 'results'}</span>
        <input class="bs-search field" type="search" placeholder="Search…" value="${esc(search)}" spellcheck="false">
        <button class="bs-btn${panel === 'filter' ? ' on' : ''}" data-act="filter" title="Filters">${ICON('<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>')}${nf ? `<b>${nf}</b>` : ''}</button>
        <button class="bs-btn${panel === 'sort' ? ' on' : ''}" data-act="sort" title="Sort and group">${ICON('<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>')}${ns ? `<b>${ns}</b>` : ''}</button>
        <button class="bs-btn${panel === 'props' ? ' on' : ''}" data-act="props" title="Properties shown">${ICON('<path d="M4 6h16M4 12h16M4 18h10"/>')}</button>
        <button class="bs-btn" data-act="new" title="New note in this view">${ICON('<path d="M12 6v12M6 12h12"/>')}</button>
        ${o.editable ? `<button class="bs-btn" data-act="view-menu" title="View options">${ICON('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>')}</button>` : ''}
      </div>`;
    }

    function flatFilters(f) {
      if (!f) return [];
      if (typeof f === 'string') return [f];
      if (Array.isArray(f)) return f;
      if (f.and) return [].concat(f.and);
      return [f];
    }

    // All properties the rows have, for pickers.
    function allProps() {
      const seen = new Set();
      for (const r of h.rows()) for (const k of Object.keys(r.props)) seen.add(k);
      return [...Object.keys(BUILTIN).filter(k => k !== 'file.basename'), ...[...seen].sort(), ...Object.keys(base.formulas || {}).map(k => 'formula.' + k)];
    }

    function panelHtml(r) {
      const v = view();
      if (panel === 'filter') {
        const rows = flatFilters(v.filters).map((f, k) => `<div class="bs-frow"><code>${esc(typeof f === 'string' ? f : JSON.stringify(f))}</code><button class="bs-x" data-act="rm-filter" data-i="${k}" title="Remove">×</button></div>`).join('');
        const g = flatFilters(base.filters).map(f => `<div class="bs-frow bs-global"><code>${esc(typeof f === 'string' ? f : JSON.stringify(f))}</code><span title="Applies to every view">all views</span></div>`).join('');
        const ops = ['is', 'is not', 'contains', 'does not contain', '>', '<', '>=', '<=', 'is empty', 'is not empty', 'has tag', 'in folder', 'links to'];
        return `<div class="bs-panel"><h5>Filters for “${esc(v.name)}”</h5>${g}${rows || '<div class="bs-none">No filters — every note is shown.</div>'}
          <div class="bs-fnew"><select class="field" data-f="prop">${allProps().map(p => `<option value="${esc(p)}">${esc(columnName(base, p))}</option>`).join('')}</select>
          <select class="field" data-f="op">${ops.map(x => `<option>${x}</option>`).join('')}</select>
          <input class="field" data-f="val" placeholder="value" spellcheck="false"><button class="btn" data-act="add-filter">Add</button></div>
          <div class="bs-fnew"><input class="field" data-f="expr" placeholder='or an expression, e.g. file.mtime > now() - "7d"' spellcheck="false"><button class="btn" data-act="add-expr">Add</button></div></div>`;
      }
      if (panel === 'sort') {
        const sorts = [].concat(v.sort || []).map((s, k) => `<div class="bs-frow"><span>${esc(columnName(base, s.property))}</span><button class="bs-chip" data-act="flip-sort" data-i="${k}">${String(s.direction || 'ASC').toUpperCase() === 'DESC' ? 'Z → A' : 'A → Z'}</button><button class="bs-x" data-act="rm-sort" data-i="${k}">×</button></div>`).join('');
        const gp = v.groupBy && (typeof v.groupBy === 'string' ? v.groupBy : v.groupBy.property);
        const opts = sel => allProps().map(p => `<option value="${esc(p)}"${p === sel ? ' selected' : ''}>${esc(columnName(base, p))}</option>`).join('');
        return `<div class="bs-panel"><h5>Sort</h5>${sorts || '<div class="bs-none">By name.</div>'}
          <div class="bs-fnew"><select class="field" data-f="sortprop">${opts()}</select><button class="btn" data-act="add-sort">Add sort</button></div>
          <h5>${v.type === 'board' ? 'Columns come from' : 'Group by'}</h5>
          <div class="bs-fnew"><select class="field" data-f="group"><option value="">${v.type === 'board' ? '(choose a property)' : 'No grouping'}</option>${opts(gp)}</select></div>
          <h5>Limit</h5><div class="bs-fnew"><input class="field" type="number" min="0" data-f="limit" value="${v.limit || ''}" placeholder="no limit"></div></div>`;
      }
      if (panel === 'props') {
        const cols = r.columns;
        const list = allProps().map(p => `<label class="bs-prop"><input type="checkbox" data-prop="${esc(p)}"${cols.includes(p) ? ' checked' : ''}> ${esc(columnName(base, p))}${p.startsWith('formula.') ? ' <small>formula</small>' : ''}</label>`).join('');
        const f = Object.entries(base.formulas || {}).map(([k, x]) => `<div class="bs-frow"><span>${esc(k)}</span><code>${esc(String(x))}</code><button class="bs-x" data-act="rm-formula" data-k="${esc(k)}">×</button></div>`).join('');
        return `<div class="bs-panel"><h5>Properties shown</h5><div class="bs-props">${list}</div>
          <h5>Formulas</h5>${f || '<div class="bs-none">None yet.</div>'}
          <div class="bs-fnew"><input class="field" data-f="fname" placeholder="name" spellcheck="false"><input class="field" data-f="fexpr" placeholder="e.g. price / pages" spellcheck="false"><button class="btn" data-act="add-formula">Add</button></div></div>`;
      }
      return '';
    }

    // ---- values
    function valueHtml(v, id) {
      if (v == null || v === '') return '<span class="bs-empty"></span>';
      if (Array.isArray(v)) return v.length ? v.map(x => `<span class="bs-pill">${valueHtml(x, id)}</span>`).join('') : '<span class="bs-empty"></span>';
      if (typeof v === 'boolean') return `<input type="checkbox" class="bs-check"${v ? ' checked' : ''}>`;
      if (v instanceof FDate) return `<span class="bs-date" title="${esc(relative(v))}">${esc(fmtDate(v))}</span>`;
      if (v instanceof Link) return `<a class="bs-link" data-link="${esc(v.path)}">${esc(v.display || v.path.split('/').pop().replace(/\.md$/, ''))}</a>`;
      if (v && v.__file) return `<a class="bs-link" data-open="${esc(v.__file.path)}">${esc(v.__file.basename)}</a>`;
      if (typeof v === 'number') return `<span class="bs-num">${esc(display(v))}</span>`;
      const s = display(v);
      const wl = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(s);
      if (wl) return `<a class="bs-link" data-link="${esc(wl[1])}">${esc(wl[2] || wl[1])}</a>`;
      if (/^#[\p{L}\p{N}_/-]+$/u.test(s)) return `<a class="tag" data-tag="${esc(s.slice(1))}">${esc(s)}</a>`;
      if (/^https?:\/\/\S+$/.test(s)) return `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(s.replace(/^https?:\/\//, ''))}</a>`;
      return esc(s);
    }
    const cell = (r, id, rr) => {
      let v;
      try { v = valueOf(id, rr, r.ctx); } catch (e) { return `<span class="bs-err" title="${esc(e.message)}">⚠</span>`; }
      if (id === 'file.name' || id === 'file.basename') return `<a class="bs-link bs-name" data-open="${esc(rr.path)}">${esc(rr.basename)}</a>`;
      return valueHtml(v, id);
    };
    const editable = id => !!propKey(id);

    function body(r) {
      const v = view();
      if (!r.total) return `<div class="bs-none bs-blank">No notes match${flatFilters(v.filters).length || flatFilters(base.filters).length ? ' these filters' : ''}.</div>`;
      if (v.type === 'board') return board(r);
      const sections = r.groups ? r.groups.map(g => ({ title: g.value == null ? 'None' : valueHtml(g.value), rows: g.rows })) : [{ title: null, rows: r.rows }];
      if (v.type === 'cards') return `<div class="bs-scroll">` + sections.map(s => (s.title != null ? `<h4 class="bs-group">${s.title} <span>${s.rows.length}</span></h4>` : '') + `<div class="bs-cards">${s.rows.map(rr => card(r, rr)).join('')}</div>`).join('') + '</div>';
      if (v.type === 'list') return `<div class="bs-scroll">` + sections.map(s => (s.title != null ? `<h4 class="bs-group">${s.title} <span>${s.rows.length}</span></h4>` : '') + `<ul class="bs-list">${s.rows.map(rr => `<li data-row="${esc(rr.path)}">${cell(r, 'file.name', rr)}${r.columns.filter(c => c !== 'file.name').map(c => { const x = cell(r, c, rr); return x.includes('bs-empty') ? '' : `<span class="bs-li-prop" data-col="${esc(c)}"><small>${esc(columnName(base, c))}</small> ${x}</span>`; }).join('')}</li>`).join('')}</ul>`).join('') + '</div>';
      // table
      const sorts = [].concat(v.sort || []);
      const head = r.columns.map((c, k) => {
        const s = sorts.find(x => x.property === c);
        const arrow = s ? (String(s.direction || 'ASC').toUpperCase() === 'DESC' ? ' ↓' : ' ↑') : '';
        return `<th data-col="${esc(c)}" data-ci="${k}" title="Click to sort · right-click for options">${esc(columnName(base, c))}${arrow}</th>`;
      }).join('');
      const rowHtml = rr => `<tr data-row="${esc(rr.path)}">${r.columns.map(c => `<td data-col="${esc(c)}"${editable(c) ? ' class="bs-edit"' : ''}>${cell(r, c, rr)}</td>`).join('')}</tr>`;
      const sumRow = rows => `<tr class="bs-sum">${r.columns.map((c, k) => {
        if (k === 0) return `<td>${rows.length} ${rows.length === 1 ? 'note' : 'notes'}</td>`;
        const s = summarize(rows.map(rr => { try { return valueOf(c, rr, r.ctx); } catch { return null; } }));
        return `<td>${s.kind === 'number' ? `Σ ${esc(display(s.sum))} · avg ${esc(display(Math.round(s.avg * 100) / 100))}` : s.kind === 'check' ? `${s.checked} of ${s.filled} checked` : s.filled ? `${s.filled} filled` : ''}</td>`;
      }).join('')}</tr>`;
      const bodyRows = sections.map(s => (s.title != null ? `<tr class="bs-grouprow"><td colspan="${r.columns.length}">${s.title} <span>${s.rows.length}</span></td></tr>` : '') + s.rows.map(rowHtml).join('')).join('');
      return `<div class="bs-scroll"><table class="bs-table"><thead><tr>${head}</tr></thead><tbody>${bodyRows}</tbody><tfoot>${sumRow(r.rows)}</tfoot></table></div>`;
    }

    function card(r, rr) {
      const v = view();
      let cover = '';
      if (v.image) {
        let img = null;
        try { img = valueOf(String(v.image), rr, r.ctx); } catch { }
        const src = img != null && h.imageUrl?.(display(Array.isArray(img) ? img[0] : img), rr.path);
        cover = src ? `<div class="bs-cover"><img src="${esc(src)}" alt="" loading="lazy"></div>` : '<div class="bs-cover bs-nocover"></div>';
      }
      const gp = v.type === 'board' && v.groupBy && (typeof v.groupBy === 'string' ? v.groupBy : v.groupBy.property);
      const props = r.columns.filter(c => c !== 'file.name' && c !== v.image && c !== gp).map(c => { const x = cell(r, c, rr); return x.includes('bs-empty') ? '' : `<div class="bs-cprop" data-col="${esc(c)}"><small>${esc(columnName(base, c))}</small><div>${x}</div></div>`; }).join('');
      return `<div class="bs-card" data-row="${esc(rr.path)}" draggable="${v.type === 'board'}">${cover}<div class="bs-ctitle">${cell(r, 'file.name', rr)}</div>${props}</div>`;
    }

    function board(r) {
      const v = view();
      const gp = v.groupBy && (typeof v.groupBy === 'string' ? v.groupBy : v.groupBy.property);
      if (!gp) return '<div class="bs-none bs-blank">Choose the property whose values become columns under <b>Sort and group</b> (for example <code>status</code>).</div>';
      const cols = [...(r.groups || [])];
      // Columns listed in the view stay (even when empty, so cards can be dropped back) and set the order.
      const listed = [].concat(v.columns || []).map(String);
      for (const extra of listed) if (!cols.some(c => c.key === extra)) cols.push({ key: extra, value: extra, rows: [] });
      if (listed.length) cols.sort((a, b) => (listed.includes(a.key) ? listed.indexOf(a.key) : 1e6) - (listed.includes(b.key) ? listed.indexOf(b.key) : 1e6));
      // Nothing has the property yet (a new board): say how the columns come about.
      const hint = cols.length && cols.every(c => c.value == null) && propKey(gp)
        ? `<div class="bs-hint">No notes have <code>${esc(columnName(base, gp))}</code> yet. Add a column, then drag cards into it to set the property, or set it in a note’s properties.</div>` : '';
      return `${hint}<div class="bs-scroll bs-board">${cols.map(c => `<div class="bs-col" data-value="${esc(c.key)}"><h4>${c.value == null ? '<span class="bs-faint">No value</span>' : valueHtml(c.value)} <span>${c.rows.length}</span></h4><div class="bs-colbody">${c.rows.map(rr => card(r, rr)).join('')}</div><button class="bs-addcard" data-act="new-in" data-value="${esc(c.key)}">+ New</button></div>`).join('')}
        ${propKey(gp) ? `<button class="bs-col bs-newcol" data-act="add-col" title="Add a column">+ Column</button>` : ''}</div>`;
    }

    // ---- events
    el.addEventListener('click', async e => {
      const t = e.target;
      const tab = t.closest('[data-view]');
      if (tab) { vi = +tab.dataset.view; panel = null; return render(); }
      const openA = t.closest('[data-open]');
      if (openA) { e.preventDefault(); return h.openFile(openA.dataset.open); }
      const link = t.closest('[data-link]');
      if (link) { e.preventDefault(); return h.openLink(link.dataset.link); }
      const chk = t.closest('.bs-check');
      if (chk) {
        const td = chk.closest('[data-col]'), row = chk.closest('[data-row]');
        const col = td?.dataset.col;
        if (row && col && propKey(col)) await h.setProperty(row.dataset.row, propKey(col), chk.checked);
        return render(); // redraw from the stored value, whatever happened
      }
      const th = t.closest('th[data-col]');
      if (th) {
        const v = view(), c = th.dataset.col;
        const sorts = [].concat(v.sort || []);
        const s = sorts.find(x => x.property === c);
        if (!s) v.sort = [{ property: c, direction: 'ASC' }];
        else if (String(s.direction).toUpperCase() !== 'DESC') v.sort = [{ property: c, direction: 'DESC' }];
        else v.sort = [];
        if (!v.sort.length) delete v.sort;
        return save();
      }
      const b = t.closest('[data-act]');
      if (!b) return;
      const v = view(), f = k => el.querySelector(`[data-f="${k}"]`);
      switch (b.dataset.act) {
        case 'filter': case 'sort': case 'props': panel = panel === b.dataset.act ? null : b.dataset.act; return render();
        case 'add-filter': {
          const prop = f('prop').value, op = f('op').value, val = f('val').value.trim();
          if (!val && !/empty/.test(op)) return f('val').focus();
          v.filters = addTo(v.filters, buildFilter(prop, op, val));
          return save();
        }
        case 'add-expr': {
          const x = f('expr').value.trim();
          if (!x) return;
          try { parseExpr(x); } catch (err) { return h.toast?.('That expression has a problem: ' + err.message); }
          v.filters = addTo(v.filters, x);
          return save();
        }
        case 'rm-filter': {
          const list = flatFilters(v.filters);
          list.splice(+b.dataset.i, 1);
          if (!list.length) delete v.filters; else v.filters = { and: list };
          return save();
        }
        case 'add-sort': { const p = f('sortprop').value; v.sort = [...[].concat(v.sort || []).filter(s => s.property !== p), { property: p, direction: 'ASC' }]; return save(); }
        case 'flip-sort': { const s = v.sort[+b.dataset.i]; s.direction = String(s.direction || 'ASC').toUpperCase() === 'DESC' ? 'ASC' : 'DESC'; return save(); }
        case 'rm-sort': v.sort.splice(+b.dataset.i, 1); if (!v.sort.length) delete v.sort; return save();
        case 'add-formula': {
          const name = f('fname').value.trim(), x = f('fexpr').value.trim();
          if (!/^[A-Za-z_][\w]*$/.test(name)) return h.toast?.('Formula names use letters, digits and _');
          try { parseExpr(x); } catch (err) { return h.toast?.('That formula has a problem: ' + err.message); }
          base.formulas = { ...(base.formulas || {}), [name]: x };
          v.order = [...(v.order || query(base, vi, h.rows()).columns), 'formula.' + name];
          return save();
        }
        case 'rm-formula': { delete base.formulas[b.dataset.k]; if (!Object.keys(base.formulas).length) delete base.formulas; for (const w of base.views) if (w.order) w.order = w.order.filter(c => c !== 'formula.' + b.dataset.k); return save(); }
        case 'new': case 'new-in': return newNote(b.dataset.act === 'new-in' ? b.dataset.value : undefined);
        case 'add-col': {
          const name = await h.prompt?.('New column', 'Value for the new column', '');
          if (!name) return;
          v.columns = [...[].concat(v.columns || []).map(String).filter(x => x !== name), name];
          return save();
        }
        case 'add-view': return h.menu?.(b.getBoundingClientRect().left, b.getBoundingClientRect().bottom + 4, VIEW_TYPES.map(type => [`${type[0].toUpperCase() + type.slice(1)} view`, () => {
          const cur = view();
          base.views.push({ type, name: uniqueViewName(type[0].toUpperCase() + type.slice(1)), ...(cur.order ? { order: [...cur.order] } : {}), ...(type === 'board' ? { groupBy: { property: guessBoardProp(), direction: 'ASC' } } : {}) });
          vi = base.views.length - 1;
          save();
        }]));
        case 'view-menu': return h.menu?.(b.getBoundingClientRect().left - 160, b.getBoundingClientRect().bottom + 4, [
          ['Rename view…', async () => { const n = await h.prompt?.('Rename view', 'Name', v.name); if (n && n.trim()) { v.name = n.trim(); save(); } }],
          ...VIEW_TYPES.filter(t2 => t2 !== v.type).map(t2 => [`Show as ${t2}`, () => { v.type = t2; if (t2 === 'board' && !v.groupBy) v.groupBy = { property: guessBoardProp(), direction: 'ASC' }; save(); }]),
          ...(v.type === 'cards' ? [['Cover image property…', async () => { const n = await h.prompt?.('Cover image', 'Property holding an image (e.g. cover), empty for none', v.image || ''); if (n != null) { if (n.trim()) v.image = n.trim(); else delete v.image; save(); } }]] : []),
          ['Duplicate view', () => { base.views.splice(vi + 1, 0, { ...JSON.parse(JSON.stringify(v)), name: uniqueViewName(v.name) }); vi++; save(); }],
          null,
          ...(base.views.length > 1 ? [['Delete view', () => { base.views.splice(vi, 1); vi = Math.max(0, vi - 1); save(); }, 'danger']] : []),
        ].filter((x, k, a) => x || (k && a[k - 1])));
      }
    });
    const addTo = (filters, x) => ({ and: [...flatFilters(filters), x] });
    const uniqueViewName = n => { let name = n, k = 2; while (base.views.some(v => v.name === name)) name = `${n} ${k++}`; return name; };
    function guessBoardProp() {
      const counts = new Map();
      for (const r of h.rows()) for (const [k, x] of Object.entries(r.props)) if (typeof x === 'string' && x.length < 40) counts.set(k, (counts.get(k) || 0) + 1);
      for (const pref of ['status', 'stage', 'state', 'priority']) if (counts.has(pref)) return pref;
      return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || 'status';
    }
    async function newNote(columnValue) {
      const v = view();
      const d = newNoteDefaults(base, v);
      const gp = v.groupBy && (typeof v.groupBy === 'string' ? v.groupBy : v.groupBy.property);
      if (columnValue !== undefined && gp && propKey(gp)) { if (columnValue === '') delete d.props[propKey(gp)]; else d.props[propKey(gp)] = scalar(columnValue); }
      await h.createNote(d.folder, d.props);
    }

    el.addEventListener('contextmenu', e => {
      const th = e.target.closest('th[data-col]');
      if (!th) return;
      e.preventDefault();
      const v = view(), c = th.dataset.col, cols = query(base, vi, h.rows()).columns, k = cols.indexOf(c);
      const setOrder = next => { v.order = next; save(); };
      h.menu?.(e.clientX, e.clientY, [
        ['Sort A → Z', () => { v.sort = [{ property: c, direction: 'ASC' }]; save(); }],
        ['Sort Z → A', () => { v.sort = [{ property: c, direction: 'DESC' }]; save(); }],
        ['Group by this', () => { v.groupBy = { property: c, direction: 'ASC' }; save(); }],
        ...(v.groupBy ? [['Remove grouping', () => { delete v.groupBy; save(); }]] : []),
        null,
        ...(k > 0 ? [['Move left', () => { const n = [...cols]; [n[k - 1], n[k]] = [n[k], n[k - 1]]; setOrder(n); }]] : []),
        ...(k < cols.length - 1 ? [['Move right', () => { const n = [...cols]; [n[k + 1], n[k]] = [n[k], n[k + 1]]; setOrder(n); }]] : []),
        ['Rename column…', async () => {
          const n = await h.prompt?.('Column name', 'Shown as', columnName(base, c));
          if (n == null) return;
          base.properties = { ...(base.properties || {}) };
          if (n.trim() && n.trim() !== columnName({}, c)) base.properties[c] = { ...(base.properties[c] || {}), displayName: n.trim() };
          else delete base.properties[c];
          if (!Object.keys(base.properties).length) delete base.properties;
          save();
        }],
        ...(cols.length > 1 ? [['Hide column', () => setOrder(cols.filter(x => x !== c))]] : []),
      ]);
    });

    el.addEventListener('input', e => {
      if (e.target.classList.contains('bs-search')) { search = e.target.value; searchFocus = true; render(); return; }
    });
    el.addEventListener('change', e => {
      const t = e.target, v = view();
      if (t.dataset.prop) {
        const cols = query(base, vi, h.rows()).columns;
        v.order = t.checked ? [...cols, t.dataset.prop] : cols.filter(c => c !== t.dataset.prop);
        return save();
      }
      if (t.dataset.f === 'group') {
        if (t.value) v.groupBy = { property: t.value, direction: 'ASC' }; else delete v.groupBy;
        return save();
      }
      if (t.dataset.f === 'limit') { const n = parseInt(t.value); if (n > 0) v.limit = n; else delete v.limit; return save(); }
    });
    el.addEventListener('keydown', e => {
      if (e.target.matches('[data-f=val], [data-f=expr], [data-f=fexpr]') && e.key === 'Enter') {
        e.preventDefault();
        el.querySelector(e.target.dataset.f === 'val' ? '[data-act=add-filter]' : e.target.dataset.f === 'expr' ? '[data-act=add-expr]' : '[data-act=add-formula]').click();
      }
      if (e.key === 'Escape' && panel) { panel = null; render(); }
    });

    // Inline editing of note properties in the table (double-click a cell).
    el.addEventListener('dblclick', e => {
      const td = e.target.closest('td.bs-edit');
      if (!td || e.target.closest('a, input')) return;
      const path = td.closest('[data-row]').dataset.row, col = td.dataset.col, key = propKey(col);
      const row = h.rows().find(r => r.path === path);
      if (!row || !key) return;
      const cur = row.props[key];
      const input = document.createElement('input');
      input.className = 'bs-cell-edit';
      const isNum = typeof cur === 'number', isDate = typeof cur === 'string' && DATE_RE.test(cur) && cur.length === 10;
      input.type = isNum ? 'number' : isDate ? 'date' : 'text';
      input.value = Array.isArray(cur) ? cur.map(display).join(', ') : cur == null ? '' : display(cur);
      td.replaceChildren(input);
      input.focus(); input.select?.();
      let done = false;
      const finish = async ok => {
        if (done) return; done = true;
        if (!ok) return render();
        const raw = input.value.trim();
        let val;
        if (raw === '') val = null;
        else if (Array.isArray(cur)) val = raw.split(',').map(s => s.trim()).filter(Boolean);
        else if (isNum) val = +raw;
        else if (isDate || typeof cur === 'string') val = raw; // text stays text
        else val = scalar(raw); // an empty cell: "5" becomes a number, "true" a checkbox
        await h.setProperty(path, key, val);
        render(); // closes the editor even when nothing changed or the row isn't a note
      };
      input.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
      input.addEventListener('blur', () => finish(true));
    });

    // Board: drag cards between columns to change the property.
    let dragPath = null;
    el.addEventListener('dragstart', e => { const c = e.target.closest?.('.bs-card'); if (!c || view().type !== 'board') return; dragPath = c.dataset.row; e.dataTransfer.setData('text/plain', dragPath); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
    el.addEventListener('dragend', () => { dragPath = null; el.querySelectorAll('.dragging, .drop').forEach(x => x.classList.remove('dragging', 'drop')); });
    el.addEventListener('dragover', e => { const col = e.target.closest?.('.bs-col[data-value]'); if (!col || !dragPath) return; e.preventDefault(); el.querySelectorAll('.bs-col.drop').forEach(x => x !== col && x.classList.remove('drop')); col.classList.add('drop'); });
    el.addEventListener('drop', async e => {
      const col = e.target.closest?.('.bs-col[data-value]');
      if (!col || !dragPath) return;
      e.preventDefault();
      const v = view(), gp = v.groupBy && (typeof v.groupBy === 'string' ? v.groupBy : v.groupBy.property), key = gp && propKey(gp);
      const path = dragPath; dragPath = null;
      if (!key) return h.toast?.('Only note properties can be changed by dragging');
      const row = h.rows().find(r => r.path === path), value = col.dataset.value === '' ? null : scalar(col.dataset.value);
      if (row && Array.isArray(row.props[key])) return h.toast?.(`"${key}" is a list; edit it in the table instead`);
      // Remember the board's columns so one doesn't vanish when its last card moves out.
      const keys = [...el.querySelectorAll('.bs-col[data-value]')].map(c => c.dataset.value).filter(Boolean);
      if (keys.join('\u0000') !== [].concat(v.columns || []).map(String).join('\u0000')) { v.columns = keys; save(); }
      await h.setProperty(path, key, value);
    });

    render();
    return {
      refresh: render,
      setBase(b) { base = b; if (!base.views[vi]) vi = 0; render(); },
      viewName: () => view().name,
    };
  }

  root.CinderBases = { ...pure, mount };
})(typeof window !== 'undefined' ? window : globalThis);
