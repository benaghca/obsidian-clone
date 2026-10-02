/* Cinder dataview: Obsidian's Dataview queries (```dataview blocks and inline `= expr`), so vaults
 * that use the plugin show their tables, lists and tasks. A query (LIST, TABLE or TASK, with FROM,
 * WHERE, SORT, GROUP BY and LIMIT) is translated into a Bases view and run by the Bases interpreter
 * (ui/bases.js), never as JavaScript; dataviewjs blocks aren't run at all. Notes' inline fields
 * (`key:: value`) are read here too. No DOM access, so it can be tested under Node. */
'use strict';

(function (root) {
  const B = root.CinderBases || require('./bases.js');

  // ============================================================ expressions

  // A Dataview expression's tokens: strings, [[links]], names (which may hold dashes, as Dataview's
  // do: due-date), numbers and punctuation. Raw text is kept so the translation can copy it.
  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const rest = src.slice(i);
      let m;
      if (/^\s/.test(rest)) { i++; continue; }
      if ((m = /^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/.exec(rest))) { out.push({ t: 'str', v: JSON.parse('"' + m[0].slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"') }); i += m[0].length; continue; }
      if ((m = /^\[\[([^\]]*)\]\]/.exec(rest))) { out.push({ t: 'link', v: m[1].split('|')[0].split('#')[0].trim() }); i += m[0].length; continue; }
      if ((m = /^\d+(?:\.\d+)?/.exec(rest))) { out.push({ t: 'num', v: m[0] }); i += m[0].length; continue; }
      if ((m = /^[\p{L}_][\p{L}\p{N}_-]*/u.exec(rest))) { out.push({ t: 'id', v: m[0].replace(/-+$/, '') }); i += m[0].replace(/-+$/, '').length; continue; }
      if ((m = /^(=>|==|!=|<=|>=|&&|\|\||[=<>!+\-*/%(),.[\]?:])/.exec(rest))) { out.push({ t: 'p', v: m[0] }); i += m[0].length; continue; }
      throw new Error(`unexpected "${rest[0]}"`);
    }
    return out;
  }

  // Dataview's file fields, as Bases names them.
  const FILE_FIELDS = { name: 'basename', link: 'asLink()', outlinks: 'links', inlinks: 'backlinks', cday: 'ctime.date()', mday: 'mtime.date()', ctime: 'ctime', mtime: 'mtime', etags: 'tags', tags: 'tags', frontmatter: 'properties', path: 'path', folder: 'folder', ext: 'ext', size: 'size' };
  // Dataview functions that are methods in Bases: name -> method (the first argument is the value).
  const AS_METHOD = { contains: 'contains', icontains: 'contains', econtains: 'contains', lower: 'lower', upper: 'upper', startswith: 'startsWith', endswith: 'endsWith', replace: 'replace', join: 'join', split: 'split', striptime: 'date' };
  const DATE_WORDS = { today: 'today()', now: 'now()', tomorrow: '(today() + "1d")', yesterday: '(today() - "1d")' };
  // Luxon's date tokens (Dataview's dateformat) -> the moment-style ones Bases formats with.
  const luxonFormat = f => f.replace(/yyyy/g, 'YYYY').replace(/yy/g, 'YY').replace(/\bdd\b|dd(?=\W|$)/g, 'DD').replace(/(^|[^d])d(?!d)/g, '$1D').replace(/EEEE/g, 'dddd').replace(/EEE/g, 'ddd').replace(/\ba\b/g, 'A');

  // A Dataview expression in Bases' syntax.
  const translate = src => emit(tokenize(String(src)));

  function emit(toks) {
    let out = '';
    const put = s => { out += (/[\w")\]]$/.test(out) && /^[\w"(]/.test(s) ? ' ' : '') + s; };
    for (let j = 0; j < toks.length;) {
      const tk = toks[j], next = toks[j + 1], after = toks[j + 2];
      const afterDot = j > 0 && toks[j - 1].t === 'p' && toks[j - 1].v === '.';
      if (tk.t === 'str') { put(JSON.stringify(tk.v)); j++; continue; }
      if (tk.t === 'num') { put(tk.v); j++; continue; }
      if (tk.t === 'link') { put(`link(${JSON.stringify(tk.v)})`); j++; continue; }
      if (tk.t === 'p') {
        if (tk.v === '=>') throw new Error('Dataview’s lambdas, (x) => …, aren’t supported.');
        put(tk.v === '=' ? '==' : tk.v); j++; continue;
      }
      // A name.
      const low = tk.v.toLowerCase();
      if (!afterDot && (low === 'and' || low === 'or')) { put(low === 'and' ? '&&' : '||'); j++; continue; }
      if (tk.v === 'file' && next?.t === 'p' && next.v === '.' && after?.t === 'id' && FILE_FIELDS[after.v]) {
        if (afterDot) out += 'file.' + FILE_FIELDS[after.v]; else put('file.' + FILE_FIELDS[after.v]);
        j += 3; continue;
      }
      if (!afterDot && next?.t === 'p' && next.v === '(') {
        // A call: its arguments, split at top-level commas.
        const argv = [[]];
        let depth = 0, k = j + 2;
        for (; k < toks.length; k++) {
          const a = toks[k];
          if (a.t === 'p' && (a.v === '(' || a.v === '[')) depth++;
          if (a.t === 'p' && (a.v === ')' || a.v === ']')) { if (!depth) break; depth--; }
          if (a.t === 'p' && a.v === ',' && !depth) { argv.push([]); continue; }
          argv[argv.length - 1].push(a);
        }
        if (k >= toks.length) throw new Error('a "(" is never closed');
        j = k + 1;
        if (argv.length === 1 && !argv[0].length) argv.pop();
        const word = argv.length === 1 && argv[0].length === 1 && argv[0][0].t === 'id' ? argv[0][0].v.toLowerCase() : null;
        if (low === 'date' && DATE_WORDS[word]) { put(DATE_WORDS[word]); continue; }
        const literal = argv.length === 1 && argv[0].map(x => x.v).join('');
        if (low === 'date' && /^\d{4}-\d{2}-\d{2}(?:T[\d:]+)?$/.test(literal)) { put(`date(${JSON.stringify(literal)})`); continue; } // date(2026-06-01)
        if (low === 'dur') { put(`duration(${JSON.stringify(argv.map(a => a.map(x => x.v).join(' ')).join(' '))})`); continue; }
        const t = argv.map(emit);
        if (AS_METHOD[low]) { put(`(${t[0] ?? 'null'}).${AS_METHOD[low]}(${t.slice(1).join(', ')})`); continue; }
        if (low === 'length') { put(`(${t[0]}).length`); continue; }
        if (low === 'default') { put(`if((${t[0]}) == null, ${t[1]}, ${t[0]})`); continue; }
        if (low === 'choice') { put(`if(${t[0]}, ${t[1]}, ${t[2] ?? 'null'})`); continue; }
        if (low === 'dateformat') {
          const fmt = argv[1]?.length === 1 && argv[1][0].t === 'str' ? JSON.stringify(luxonFormat(argv[1][0].v)) : t[1];
          put(`(${t[0]}).format(${fmt})`); continue;
        }
        put(`${tk.v}(${t.join(', ')})`); continue;
      }
      // A field with a dash in its name (due-date) is looked up by name.
      if (!afterDot && tk.v.includes('-')) put(`note[${JSON.stringify(tk.v)}]`);
      else if (afterDot) out += tk.v;
      else put(tk.v);
      j++;
    }
    return out;
  }

  // Extra functions Dataview has and Bases doesn't (passed to the Bases interpreter).
  const FUNCS = {
    sum: v => (Array.isArray(v) ? v : [v]).reduce((s, x) => s + (Number(x) || 0), 0),
    average: v => { const a = (Array.isArray(v) ? v : [v]).map(Number).filter(x => !isNaN(x)); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; },
    nonnull: v => (Array.isArray(v) ? v : [v]).filter(x => x != null && x !== ''),
    regexmatch: (p, s) => { try { return new RegExp('^(?:' + p + ')$').test(String(s ?? '')); } catch { return false; } },
    regextest: (p, s) => { try { return new RegExp(p).test(String(s ?? '')); } catch { return false; } },
    typeof: v => v == null ? 'null' : Array.isArray(v) ? 'array' : v instanceof B.FDate ? 'date' : v instanceof B.Link ? 'link' : v instanceof B.Duration ? 'duration' : typeof v,
    reverse: v => Array.isArray(v) ? [...v].reverse() : v,
    flat: v => Array.isArray(v) ? v.flat() : v,
  };

  // ============================================================ sources (FROM)

  // A FROM clause as a Bases filter expression: #tags, "folders" (or a note's path), [[notes]]
  // linking to a note, outgoing([[note]]), joined with and / or, negated with - or !.
  function fromFilter(src) {
    const toks = [];
    const re = /\s*(?:(#[\p{L}\p{N}_/-]+)|("(?:[^"\\]|\\.)*")|(\[\[[^\]]*\]\])|(outgoing)\s*\(\s*(\[\[[^\]]*\]\])\s*\)|(\(|\))|(and|or)\b|([-!]))/iuy;
    let m, at = 0;
    src = src.trim();
    while (at < src.length) {
      re.lastIndex = at;
      m = re.exec(src);
      if (!m) throw new Error(`can't read FROM ${src}`);
      at = re.lastIndex;
      if (m[1]) toks.push(`file.hasTag(${JSON.stringify(m[1].slice(1))})`);
      else if (m[2]) { const f = JSON.parse(m[2]).replace(/^\/+|\/+$/g, ''); toks.push(`(file.inFolder(${JSON.stringify(f)}) || file.path == ${JSON.stringify(f)} || file.path == ${JSON.stringify(f + '.md')})`); }
      else if (m[3]) { const n = m[3].slice(2, -2).split('|')[0].split('#')[0].trim(); toks.push(n ? `file.hasLink(link(${JSON.stringify(n)}))` : 'file.hasLink(this.file.asLink())'); }
      else if (m[4]) toks.push(`outgoing(${JSON.stringify(m[5].slice(2, -2).split('|')[0].split('#')[0].trim())}).contains(file.asLink())`);
      else if (m[6]) toks.push(m[6]);
      else if (m[7]) toks.push(m[7].toLowerCase() === 'and' ? '&&' : '||');
      else if (m[8]) toks.push('!');
      while (at < src.length && /\s/.test(src[at])) at++;
    }
    // Sources side by side with nothing between count as "and".
    let out = '';
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k], prev = toks[k - 1];
      if (k && prev !== '(' && prev !== '!' && prev !== '&&' && prev !== '||' && t !== ')' && t !== '&&' && t !== '||') out += ' && ';
      else if (k) out += ' ';
      out += t;
    }
    return out;
  }

  // ============================================================ queries

  const CLAUSE = /^(FROM|WHERE|SORT|LIMIT|GROUP\s+BY|FLATTEN)\b/i;

  // Split a query at its clause keywords (outside strings, links and brackets).
  function clauses(text) {
    const out = [{ kw: 'HEAD', text: '' }];
    let cur = '', depth = 0, quote = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) { cur += c; if (c === '\\') { cur += text[++i] ?? ''; } else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; cur += c; continue; }
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
      const m = !depth && (i === 0 || /\s/.test(text[i - 1])) ? CLAUSE.exec(text.slice(i)) : null;
      if (m) { out[out.length - 1].text = cur.trim(); out.push({ kw: m[1].replace(/\s+/g, ' ').toUpperCase(), text: '' }); cur = ''; i += m[0].length - 1; continue; }
      cur += c;
    }
    out[out.length - 1].text = cur.trim();
    return out;
  }

  // Split at top-level commas.
  function commaList(text) {
    const out = [];
    let cur = '', depth = 0, quote = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) { cur += c; if (c === '\\') cur += text[++i] ?? ''; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") quote = c;
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth--;
      if (c === ',' && !depth) { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  // "expr AS name" -> [expr, name]
  function splitAs(text) {
    const m = /^([\s\S]*?)\s+AS\s+("(?:[^"\\]|\\.)*"|[^\s"]+)\s*$/i.exec(text);
    if (!m) return [text.trim(), null];
    return [m[1].trim(), m[2].startsWith('"') ? JSON.parse(m[2]) : m[2]];
  }

  // A ```dataview block -> {type: 'list'|'table'|'task', base (a Bases base whose one view runs it),
  // columns: [{id, name}], withoutId, fromFilter, whereSrc}. Throws with a message for what it can't run.
  function parse(text) {
    const cs = clauses(String(text).replace(/\r/g, '').replace(/\n/g, ' ').trim());
    const head = cs[0].text;
    const hm = /^(LIST|TABLE|TASK|CALENDAR)\b\s*([\s\S]*)$/i.exec(head);
    if (!hm) throw new Error('A Dataview query starts with LIST, TABLE or TASK.');
    const type = hm[1].toLowerCase();
    if (type === 'calendar') throw new Error('CALENDAR queries aren’t supported. The Calendar in the right side bar shows daily notes.');
    let rest = hm[2].trim(), withoutId = false;
    const wm = /^WITHOUT\s+ID\b\s*/i.exec(rest);
    if (wm) { withoutId = true; rest = rest.slice(wm[0].length); }
    const formulas = {}, properties = {}, view = { type: type === 'table' ? 'table' : 'list', name: 'Dataview' };
    const columns = [];
    if (!withoutId || type === 'task') columns.push({ id: 'file.name', name: 'File' });
    const items = type === 'table' ? commaList(rest) : rest ? [rest] : [];
    items.forEach((item, k) => {
      const [expr, name] = splitAs(item);
      formulas['c' + k] = translate(expr);
      properties['formula.c' + k] = { displayName: name ?? expr };
      columns.push({ id: 'formula.c' + k, name: name ?? expr });
    });
    view.order = columns.map(c => c.id);
    const filters = [];
    let from = null, where = null;
    for (const c of cs.slice(1)) {
      if (c.kw === 'FROM') { from = fromFilter(c.text); filters.push(from); }
      else if (c.kw === 'WHERE') { where = translate(c.text); if (type !== 'task') filters.push(where); }
      else if (c.kw === 'SORT') {
        view.sort = commaList(c.text).map((s, k) => {
          const m = /^([\s\S]*?)(?:\s+(ASC|ASCENDING|DESC|DESCENDING))?$/i.exec(s);
          formulas['s' + k] = translate(m[1]);
          return { property: 'formula.s' + k, direction: m[2] && /^desc/i.test(m[2]) ? 'DESC' : 'ASC' };
        });
      } else if (c.kw === 'LIMIT') { const n = parseInt(c.text, 10); if (!(n >= 0)) throw new Error('LIMIT takes a number.'); view.limit = n; }
      else if (c.kw === 'GROUP BY') {
        const [expr, name] = splitAs(c.text);
        formulas.g = translate(expr);
        view.groupBy = { property: 'formula.g', direction: 'ASC' };
        properties['formula.g'] = { displayName: name ?? expr };
      } else if (c.kw === 'FLATTEN') throw new Error('FLATTEN isn’t supported.');
    }
    const base = { filters: filters.length ? { and: filters } : undefined, formulas, properties, views: [view] };
    return { type, base, columns, withoutId, where: type === 'task' ? where : null };
  }

  // ============================================================ inline fields

  // A field's value as Dataview reads it: numbers, true/false, and text (dates and [[links]] stay
  // text, which Bases compares as dates and links).
  function fieldValue(raw) {
    const v = raw.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(v)) return +v;
    if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
    return v;
  }
  // "Due Date" is also "due-date", as in Dataview.
  const canonical = k => k.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');

  // A note's inline fields: `key:: value` lines (in a list item too) and [key:: value] or
  // (key:: value) inside text. `text` should have its code blanked out. Returns {key: value}; a key
  // given more than once gets a list.
  function inlineFields(text) {
    const out = {};
    const add = (k, v) => {
      k = k.replace(/^\*\*|\*\*$|^__|__$/g, '').trim();
      if (!k) return;
      const val = fieldValue(v);
      for (const key of new Set([k, canonical(k)])) {
        if (!(key in out)) out[key] = val;
        else out[key] = [].concat(out[key], val);
      }
    };
    for (const m of text.matchAll(/^[ \t]*(?:>[ \t]*)*(?:[-*+][ \t]+(?:\[.\][ \t]+)?|\d+[.)][ \t]+)?([^\s:[\](][^:[\]()\n]*?)::[ \t]*(.*)$/gm)) add(m[1], m[2]);
    for (const m of text.matchAll(/[[(]([^:[\]()\n]+?)::[ \t]*([^\]\n)]*)[\])]/g)) add(m[1], m[2]);
    return out;
  }

  root.CinderDataview = { parse, translate, fromFilter, inlineFields, FUNCS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CinderDataview;
})(typeof window !== 'undefined' ? window : globalThis);
