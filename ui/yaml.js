/* Cinder YAML: the part of YAML that frontmatter and .base files use — block and flow
 * mappings and sequences, plain and quoted scalars, block scalars (| and >), comments — read
 * into JavaScript values and written back out. One parser for the whole app: the vault index,
 * Properties and Bases all read frontmatter through it. No DOM access, so it can be tested
 * under Node. */
'use strict';

(function (root) {

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

  // ------------------------------------------------------------ frontmatter

  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;
  function frontmatter(content) {
    const m = FM_RE.exec(content || '');
    if (!m) return {};
    try { const v = parseYaml(m[1]); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
  }


  // The forgiving reading the index falls back to when frontmatter isn't valid YAML, so a note
  // with a stray colon still keeps its tags and aliases: flat "key: value" lines and "- item" lists.
  function parseLoose(t) {
    const unq = s => s.trim().replace(/^(["'])(.*)\1$/, '$2');
    const o = {}; let key = null;
    for (const line of String(t).split(/\r?\n/)) {
      let m;
      if ((m = /^([^\s:#][^:]*):[ \t]*(.*)$/.exec(line))) {
        key = m[1].trim(); const v = m[2].trim();
        if (v === '') o[key] = [];
        else if (/^\[.*\]$/.test(v)) o[key] = v.slice(1, -1).split(',').map(unq).filter(Boolean);
        else o[key] = unq(v);
      } else if ((m = /^\s+-\s+(.*)$|^-\s+(.*)$/.exec(line)) && key) {
        if (!Array.isArray(o[key])) o[key] = o[key] ? [o[key]] : [];
        o[key].push(unq(m[1] ?? m[2]));
      }
    }
    return o;
  }

  // A note's frontmatter: {data (an object), valid (it was proper YAML), len (characters it takes)}.
  const FM_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
  function split(content) {
    const m = FM_BLOCK.exec(content || '');
    if (!m) return { data: null, valid: true, len: 0 };
    try {
      const v = parse(m[1]);
      if (v == null) return { data: {}, valid: true, len: m[0].length };
      if (typeof v === 'object' && !Array.isArray(v)) return { data: v, valid: true, len: m[0].length };
    } catch { }
    return { data: parseLoose(m[1]), valid: false, len: m[0].length };
  }

  const parse = parseYaml, emit = emitYaml;
  root.CinderYaml = { parse, emit, scalar, key: yamlKey, str: yamlStr, frontmatter, FM_RE, parseLoose, split };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CinderYaml;
})(typeof window !== 'undefined' ? window : globalThis);
