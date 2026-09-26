/* Cinder templates in the syntax of Obsidian's Templater plugin: <% tp.date.now() %>,
 * <%* let x = await tp.system.prompt("Name") %>, whitespace control (<%- -%> <%_ _%>).
 *
 * Templater runs templates as JavaScript. Cinder doesn't run code from the vault (and
 * its Content-Security-Policy forbids eval), so this file is a small interpreter for
 * the JavaScript Templater templates actually use: expressions, let/const, if/else,
 * for...of, tR +=, and the tp.* functions below. Anything else is a clear error.
 * No DOM access at load time, so it can be tested under Node. */
'use strict';

(function (root) {
  // ============================================================ dates (moment.js formats)

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');
  const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = t.getUTCFullYear();
    return { week: Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7), year: y };
  }
  function localWeek(d) { // US-style weeks (Sunday start), as moment's default locale
    const jan1 = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d - jan1) / 864e5 + jan1.getDay() + 1) / 7);
  }

  const TOKENS = /\[([^\]]*)\]|YYYY|YY|Q|MMMM|MMM|MM|M|Do|DDDD|DDD|DD|D|dddd|ddd|dd|d|E|e|HH|H|hh|h|kk|k|mm|m|ss|s|SSS|A|a|WW|W|ww|w|GGGG|gggg|X|x|ZZ|Z/g;
  function formatDate(d, fmt = 'YYYY-MM-DD') {
    const tz = -d.getTimezoneOffset(), tzs = (tz >= 0 ? '+' : '-') + pad(Math.floor(Math.abs(tz) / 60)) + ':' + pad(Math.abs(tz) % 60);
    const doy = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(d.getFullYear(), 0, 1)) / 864e5) + 1;
    const h12 = d.getHours() % 12 || 12;
    return fmt.replace(TOKENS, (t, lit) => {
      if (lit !== undefined) return lit;
      switch (t) {
        case 'YYYY': return String(d.getFullYear());
        case 'YY': return pad(d.getFullYear() % 100);
        case 'Q': return String(Math.floor(d.getMonth() / 3) + 1);
        case 'MMMM': return MONTHS[d.getMonth()];
        case 'MMM': return MONTHS[d.getMonth()].slice(0, 3);
        case 'MM': return pad(d.getMonth() + 1);
        case 'M': return String(d.getMonth() + 1);
        case 'Do': return ordinal(d.getDate());
        case 'DDDD': return pad(doy, 3);
        case 'DDD': return String(doy);
        case 'DD': return pad(d.getDate());
        case 'D': return String(d.getDate());
        case 'dddd': return DAYS[d.getDay()];
        case 'ddd': return DAYS[d.getDay()].slice(0, 3);
        case 'dd': return DAYS[d.getDay()].slice(0, 2);
        case 'd': case 'e': return String(d.getDay());
        case 'E': return String(d.getDay() || 7);
        case 'HH': return pad(d.getHours());
        case 'H': return String(d.getHours());
        case 'hh': return pad(h12);
        case 'h': return String(h12);
        case 'kk': return pad(d.getHours() || 24);
        case 'k': return String(d.getHours() || 24);
        case 'mm': return pad(d.getMinutes());
        case 'm': return String(d.getMinutes());
        case 'ss': return pad(d.getSeconds());
        case 's': return String(d.getSeconds());
        case 'SSS': return pad(d.getMilliseconds(), 3);
        case 'A': return d.getHours() < 12 ? 'AM' : 'PM';
        case 'a': return d.getHours() < 12 ? 'am' : 'pm';
        case 'WW': return pad(isoWeek(d).week);
        case 'W': return String(isoWeek(d).week);
        case 'ww': return pad(localWeek(d));
        case 'w': return String(localWeek(d));
        case 'GGGG': return String(isoWeek(d).year);
        case 'gggg': return String(d.getFullYear());
        case 'X': return String(Math.floor(d.getTime() / 1000));
        case 'x': return String(d.getTime());
        case 'Z': return tzs;
        case 'ZZ': return tzs.replace(':', '');
      }
      return t;
    });
  }

  // Parse `s` using a moment-style format (numeric fields only), falling back to Date.
  function parseDate(s, fmt) {
    if (s instanceof Date) return new Date(s);
    s = String(s);
    if (fmt) {
      const parts = [];
      let re = '';
      let last = 0, m;
      TOKENS.lastIndex = 0;
      while ((m = TOKENS.exec(fmt))) {
        re += fmt.slice(last, m.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (m[1] !== undefined) re += m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        else if (/^(YYYY|MM|M|DD|D|HH|H|mm|m|ss|s|YY)$/.test(m[0])) { re += m[0] === 'YYYY' ? '(\\d{4})' : '(\\d{1,2})'; parts.push(m[0]); }
        else if (/^(MMMM|MMM)$/.test(m[0])) { re += '([A-Za-z]+)'; parts.push(m[0]); }
        else re += '.*?';
        last = TOKENS.lastIndex;
      }
      re += fmt.slice(last).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const r = new RegExp('^' + re).exec(s);
      if (r) {
        const now = new Date();
        let y = now.getFullYear(), mo = 0, dd = 1, hh = 0, mi = 0, se = 0;
        parts.forEach((p, i) => {
          const v = r[i + 1];
          if (p === 'YYYY') y = +v; else if (p === 'YY') y = 2000 + +v;
          else if (p === 'MM' || p === 'M') mo = +v - 1;
          else if (p === 'MMMM' || p === 'MMM') mo = MONTHS.findIndex(x => x.toLowerCase().startsWith(v.toLowerCase().slice(0, 3)));
          else if (p === 'DD' || p === 'D') dd = +v; else if (p === 'HH' || p === 'H') hh = +v;
          else if (p === 'mm' || p === 'm') mi = +v; else if (p === 'ss' || p === 's') se = +v;
        });
        return new Date(y, mo, dd, hh, mi, se);
      }
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); // a bare date is local, not UTC
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(s);
    if (isNaN(d)) throw new Error(`can't read "${s}" as a date`);
    return d;
  }

  // Offsets are a number of days or an ISO 8601 duration like "P1W", "-P1M2D", "PT3H".
  function addOffset(d, offset) {
    if (offset == null || offset === '') return d;
    const r = new Date(d);
    if (typeof offset === 'number') { r.setDate(r.getDate() + offset); return r; }
    const m = /^([+-])?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(offset).trim());
    if (!m) throw new Error(`"${offset}" isn't a number of days or an ISO 8601 duration like P1D`);
    const k = m[1] === '-' ? -1 : 1, n = i => k * (+m[i] || 0);
    r.setFullYear(r.getFullYear() + n(2), r.getMonth() + n(3), r.getDate() + n(4) * 7 + n(5));
    r.setHours(r.getHours() + n(6), r.getMinutes() + n(7), r.getSeconds() + n(8));
    return r;
  }

  // ============================================================ template -> tokens

  // Split a template into text and tag segments, applying whitespace control.
  function segments(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('<%', i);
      if (open < 0) { out.push({ text: src.slice(i) }); break; }
      out.push({ text: src.slice(i, open) });
      let j = open + 2, exec = false, trimL = null;
      if (src[j] === '*') { exec = true; j++; }
      if (src[j] === '-' || src[j] === '_') trimL = src[j++];
      if (!exec && src[j] === '*') { exec = true; j++; }
      const close = findClose(src, j);
      if (close < 0) throw new Error('a <% tag is never closed with %>');
      let code = src.slice(j, close), trimR = null;
      if (code.endsWith('-') || code.endsWith('_')) { trimR = code.slice(-1); code = code.slice(0, -1); }
      out.push({ code, exec, trimL, trimR });
      i = close + 2;
    }
    // whitespace control
    for (let k = 0; k < out.length; k++) {
      const s = out[k];
      if (s.text !== undefined) continue;
      const prev = out[k - 1], next = out[k + 1];
      if (s.trimL === '_' && prev) prev.text = prev.text.replace(/\s+$/, '');
      if (s.trimL === '-' && prev) prev.text = prev.text.replace(/\r?\n$/, '');
      if (s.trimR === '_' && next) next.text = next.text.replace(/^\s+/, '');
      if (s.trimR === '-' && next) next.text = next.text.replace(/^\r?\n/, '');
    }
    return out;
  }
  // The %> that closes a tag, skipping any inside string literals.
  function findClose(src, i) {
    let q = null;
    for (; i < src.length - 1; i++) {
      const c = src[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === '%' && src[i + 1] === '>') return i;
    }
    return -1;
  }

  const PUNCT = ['===', '!==', '...', '==', '!=', '<=', '>=', '&&', '||', '??', '+=', '-=', '=>', '?.', '+', '-', '*', '/', '%', '<', '>', '!', '=', '(', ')', '[', ']', '{', '}', ',', '.', ';', ':', '?'];
  function lex(code, out) {
    let i = 0;
    while (i < code.length) {
      const c = code[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
      if (c === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); i = e < 0 ? code.length : e + 2; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1]))) {
        const m = /^(?:0x[0-9a-f]+|\d*\.?\d+(?:e[+-]?\d+)?)/i.exec(code.slice(i));
        out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        const m = /^[A-Za-z_$][\w$]*/.exec(code.slice(i));
        out.push({ t: 'id', v: m[0] }); i += m[0].length; continue;
      }
      if (c === '"' || c === "'") {
        let s = '', j = i + 1;
        for (; j < code.length && code[j] !== c; j++) {
          if (code[j] === '\\') { j++; s += ({ n: '\n', t: '\t', r: '\r', '0': '\0' })[code[j]] ?? code[j]; } else s += code[j];
        }
        if (j >= code.length) throw new Error('a string is never closed');
        out.push({ t: 'str', v: s }); i = j + 1; continue;
      }
      if (c === '`') { // template literal: chunks and ${expressions}
        const parts = [];
        let s = '', j = i + 1;
        for (; j < code.length && code[j] !== '`'; j++) {
          if (code[j] === '\\') { j++; s += ({ n: '\n', t: '\t' })[code[j]] ?? code[j]; continue; }
          if (code[j] === '$' && code[j + 1] === '{') {
            let depth = 1, k = j + 2;
            for (; k < code.length && depth; k++) { if (code[k] === '{') depth++; else if (code[k] === '}') depth--; }
            parts.push(s); s = '';
            const sub = [];
            lex(code.slice(j + 2, k - 1), sub);
            parts.push(sub);
            j = k - 1;
            continue;
          }
          s += code[j];
        }
        if (j >= code.length) throw new Error('a `template string` is never closed');
        parts.push(s);
        out.push({ t: 'tpl', v: parts }); i = j + 1; continue;
      }
      const p = PUNCT.find(x => code.startsWith(x, i));
      if (!p) throw new Error(`unexpected character "${c}"`);
      out.push({ t: 'p', v: p }); i += p.length;
    }
  }

  // Tokens for a whole template. Text becomes `tR += "text"`, <% x %> becomes `tR += x`.
  function tokenize(src) {
    const toks = [];
    for (const s of segments(src)) {
      if (s.text !== undefined) { if (s.text) toks.push({ t: 'text', v: s.text }); continue; }
      if (s.exec) { lex(s.code, toks); toks.push({ t: 'p', v: ';' }); continue; }
      toks.push({ t: 'out' });
      lex(s.code, toks);
      toks.push({ t: 'endout' });
    }
    toks.push({ t: 'eof' });
    return toks;
  }

  // ============================================================ parser

  function parse(toks) {
    let i = 0;
    const peek = (o = 0) => toks[i + o];
    const is = (v, o = 0) => { const k = toks[i + o]; return k.t === 'p' && k.v === v; };
    const isId = (v, o = 0) => { const k = toks[i + o]; return k.t === 'id' && k.v === v; };
    const next = () => toks[i++];
    const expect = v => { if (!is(v)) throw new Error(`expected "${v}" but found ${desc(peek())}`); i++; };
    const desc = k => k.t === 'eof' ? 'the end of the template' : k.t === 'text' ? 'template text' : k.t === 'endout' ? '%>' : `"${k.v}"`;

    function program() {
      const body = [];
      while (peek().t !== 'eof') body.push(statement());
      return body;
    }
    function block() {
      if (!is('{')) return [statement()];
      i++;
      const body = [];
      while (!is('}')) { if (peek().t === 'eof') throw new Error('a { block is never closed with }'); body.push(statement()); }
      i++;
      return body;
    }
    function statement() {
      const k = peek();
      if (k.t === 'text') { i++; return { s: 'out', e: { e: 'lit', v: k.v } }; }
      if (k.t === 'out') {
        i++;
        if (peek().t === 'endout') { i++; return { s: 'empty' }; }
        const e = expression();
        if (peek().t !== 'endout') throw new Error(`expected %> but found ${desc(peek())}`);
        i++;
        return { s: 'out', e };
      }
      if (is(';')) { i++; return { s: 'empty' }; }
      if (is('{')) return { s: 'block', body: block() };
      if (isId('let') || isId('const') || isId('var')) {
        i++;
        const decls = [];
        do {
          if (peek().t !== 'id') throw new Error(`expected a variable name but found ${desc(peek())}`);
          const name = next().v;
          let init = null;
          if (is('=')) { i++; init = expression(); }
          decls.push({ name, init });
        } while (is(',') && ++i);
        semi();
        return { s: 'let', decls };
      }
      if (isId('if')) {
        i++; expect('(');
        const test = expression();
        expect(')');
        const then = block();
        let other = null;
        if (isId('else')) { i++; other = isId('if') ? [statement()] : block(); }
        return { s: 'if', test, then, other };
      }
      if (isId('for')) {
        i++; expect('(');
        if (isId('let') || isId('const') || isId('var')) i++;
        if (peek().t !== 'id') throw new Error('only `for (const x of list)` loops are supported');
        const name = next().v;
        if (!isId('of')) throw new Error('only `for (const x of list)` loops are supported');
        i++;
        const list = expression();
        expect(')');
        return { s: 'for', name, list, body: block() };
      }
      if (isId('return')) { i++; if (!is(';') && !is('}') && peek().t !== 'eof' && peek().t !== 'text') expression(); semi(); return { s: 'return' }; }
      if (isId('function') || isId('while') || isId('do') || isId('class') || isId('try') || isId('switch') || isId('new')) {
        throw new Error(`"${peek().v}" isn't supported in Cinder templates`);
      }
      // assignment or expression
      if (peek().t === 'id' && (is('=', 1) || is('+=', 1) || is('-=', 1))) {
        const name = next().v, op = next().v, e = expression();
        semi();
        return { s: 'assign', name, op, e };
      }
      const e = expression();
      semi();
      return { s: 'expr', e };
    }
    function semi() { if (is(';')) i++; }

    function expression() { return ternary(); }
    function ternary() {
      const test = binary(0);
      if (!is('?')) return test;
      i++;
      const a = expression();
      expect(':');
      return { e: 'cond', test, a, b: expression() };
    }
    const LEVELS = [['??'], ['||'], ['&&'], ['==', '!=', '===', '!=='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
    function binary(level) {
      if (level === LEVELS.length) return unary();
      let left = binary(level + 1);
      while (peek().t === 'p' && LEVELS[level].includes(peek().v)) {
        const op = next().v;
        left = { e: 'bin', op, a: left, b: binary(level + 1) };
      }
      return left;
    }
    function unary() {
      if (is('!')) { i++; return { e: 'not', a: unary() }; }
      if (is('-')) { i++; return { e: 'neg', a: unary() }; }
      if (is('+')) { i++; return { e: 'pos', a: unary() }; }
      if (isId('await')) { i++; return unary(); }
      if (isId('typeof')) { i++; return { e: 'typeof', a: unary() }; }
      return postfix();
    }
    function postfix() {
      let e = primary();
      for (;;) {
        if (is('.') || is('?.')) {
          const opt = next().v === '?.';
          if (peek().t !== 'id') throw new Error(`expected a name after "." but found ${desc(peek())}`);
          e = { e: 'get', o: e, k: { e: 'lit', v: next().v }, opt };
        } else if (is('[')) { i++; const k = expression(); expect(']'); e = { e: 'get', o: e, k }; }
        else if (is('(')) { i++; e = { e: 'call', f: e, args: list(')') }; }
        else return e;
      }
    }
    function list(end) {
      const items = [];
      while (!is(end)) {
        if (is('...')) throw new Error('spread (...) isn\'t supported in Cinder templates');
        items.push(expression());
        if (!is(end)) expect(',');
      }
      i++;
      return items;
    }
    function primary() {
      const k = next();
      if (k.t === 'num' || k.t === 'str') return { e: 'lit', v: k.v };
      if (k.t === 'tpl') return { e: 'tpl', parts: k.v.map(p => typeof p === 'string' ? p : subExpr(p)) };
      if (k.t === 'id') {
        if (k.v === 'true' || k.v === 'false') return { e: 'lit', v: k.v === 'true' };
        if (k.v === 'null') return { e: 'lit', v: null };
        if (k.v === 'undefined') return { e: 'lit', v: undefined };
        if (is('=>')) throw new Error('arrow functions aren\'t supported in Cinder templates');
        return { e: 'var', name: k.v };
      }
      if (k.t === 'p' && k.v === '(') {
        if (is(')') && is('=>', 1)) throw new Error('arrow functions aren\'t supported in Cinder templates');
        const e = expression();
        expect(')');
        if (is('=>')) throw new Error('arrow functions aren\'t supported in Cinder templates');
        return e;
      }
      if (k.t === 'p' && k.v === '[') return { e: 'arr', items: list(']') };
      if (k.t === 'p' && k.v === '{') {
        const props = [];
        while (!is('}')) {
          const key = next();
          if (key.t !== 'id' && key.t !== 'str' && key.t !== 'num') throw new Error(`unexpected ${desc(key)} in an object`);
          if (is(':')) { i++; props.push([String(key.v), expression()]); }
          else props.push([String(key.v), { e: 'var', name: key.v }]);
          if (!is('}')) expect(',');
        }
        i++;
        return { e: 'obj', props };
      }
      throw new Error(`unexpected ${desc(k)}`);
    }
    return program();
  }
  function subExpr(toks) {
    const body = parse([{ t: 'out' }, ...toks, { t: 'endout' }, { t: 'eof' }]);
    return body[0].e;
  }

  // ============================================================ interpreter

  // Only these may be called on strings, arrays and numbers.
  const SAFE_METHODS = {
    string: new Set(['toUpperCase', 'toLowerCase', 'trim', 'trimStart', 'trimEnd', 'split', 'slice', 'substring', 'replace', 'replaceAll', 'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'padStart', 'padEnd', 'repeat', 'charAt', 'concat', 'at', 'localeCompare', 'normalize', 'toString']),
    array: new Set(['join', 'slice', 'includes', 'indexOf', 'concat', 'at', 'reverse', 'sort', 'flat', 'toString']),
    number: new Set(['toFixed', 'toString', 'toPrecision']),
  };
  const BLOCKED = new Set(['constructor', '__proto__', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
  const kind = v => typeof v === 'string' ? 'string' : Array.isArray(v) ? 'array' : typeof v === 'number' ? 'number' : null;

  // Functions the interpreter may call carry this mark.
  const CALLABLE = Symbol('callable');
  const fn = f => { f[CALLABLE] = true; return f; };

  class Abort extends Error { }

  async function run(body, scope, st) {
    for (const s of body) {
      if (++st.steps > 200000) throw new Error('the template ran too long');
      switch (s.s) {
        case 'out': { const v = await ev(s.e, scope, st); st.out += v == null ? '' : String(v); break; }
        case 'let': for (const d of s.decls) scope.vars.set(d.name, d.init ? await ev(d.init, scope, st) : undefined); break;
        case 'assign': {
          const v = await ev(s.e, scope, st);
          if (s.name === 'tR') { st.out = s.op === '=' ? String(v) : st.out + String(v); break; }
          const sc = lookup(scope, s.name);
          if (!sc) throw new Error(`"${s.name}" is not defined`);
          const cur = sc.vars.get(s.name);
          sc.vars.set(s.name, s.op === '=' ? v : s.op === '+=' ? cur + v : cur - v);
          break;
        }
        case 'if': if (truthy(await ev(s.test, scope, st))) await run(s.then, child(scope), st); else if (s.other) await run(s.other, child(scope), st); break;
        case 'for': {
          const list = await ev(s.list, scope, st);
          if (!Array.isArray(list) && typeof list !== 'string') throw new Error('for...of needs a list');
          for (const item of list) { const sc = child(scope); sc.vars.set(s.name, item); await run(s.body, sc, st); }
          break;
        }
        case 'block': await run(s.body, child(scope), st); break;
        case 'expr': await ev(s.e, scope, st); break;
        case 'return': throw new Abort();
      }
    }
  }
  const child = scope => ({ vars: new Map(), parent: scope });
  function lookup(scope, name) { for (let s = scope; s; s = s.parent) if (s.vars.has(name)) return s; return null; }
  const truthy = v => !!v;

  async function ev(e, scope, st) {
    switch (e.e) {
      case 'lit': return e.v;
      case 'tpl': { let s = ''; for (const p of e.parts) s += typeof p === 'string' ? p : String(await ev(p, scope, st) ?? ''); return s; }
      case 'var': {
        if (e.name === 'tR') return st.out;
        const sc = lookup(scope, e.name);
        if (!sc) throw new Error(e.name === 'app' || e.name === 'window' || e.name === 'document' ? `"${e.name}" isn't available in Cinder templates` : `"${e.name}" is not defined`);
        return sc.vars.get(e.name);
      }
      case 'arr': { const a = []; for (const x of e.items) a.push(await ev(x, scope, st)); return a; }
      case 'obj': { const o = {}; for (const [k, x] of e.props) { if (BLOCKED.has(k)) throw new Error(`"${k}" can't be used as a key`); o[k] = await ev(x, scope, st); } return o; }
      case 'not': return !(await ev(e.a, scope, st));
      case 'neg': return -(await ev(e.a, scope, st));
      case 'pos': return +(await ev(e.a, scope, st));
      case 'typeof': { const v = await ev(e.a, scope, st); return typeof v === 'function' ? 'function' : typeof v; }
      case 'cond': return truthy(await ev(e.test, scope, st)) ? ev(e.a, scope, st) : ev(e.b, scope, st);
      case 'bin': {
        const a = await ev(e.a, scope, st);
        if (e.op === '&&') return a ? ev(e.b, scope, st) : a;
        if (e.op === '||') return a ? a : ev(e.b, scope, st);
        if (e.op === '??') return a ?? ev(e.b, scope, st);
        const b = await ev(e.b, scope, st);
        switch (e.op) {
          case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b;
          case '==': return a == b; case '!=': return a != b; case '===': return a === b; case '!==': return a !== b; // eslint-disable-line eqeqeq
          case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
        }
        throw new Error(`unknown operator ${e.op}`);
      }
      case 'get': {
        const o = await ev(e.o, scope, st);
        if (o == null) { if (e.opt) return undefined; throw new Error(`can't read "${await keyOf(e, scope, st)}" of ${o}`); }
        return getProp(o, await keyOf(e, scope, st));
      }
      case 'call': {
        let f, self;
        if (e.f.e === 'get') {
          self = await ev(e.f.o, scope, st);
          if (self == null) { if (e.f.opt) return undefined; throw new Error(`can't call "${await keyOf(e.f, scope, st)}" on ${self}`); }
          const k = await keyOf(e.f, scope, st);
          const kd = kind(self);
          if (kd && SAFE_METHODS[kd].has(k)) {
            const args = [];
            for (const a of e.args) args.push(await ev(a, scope, st));
            if (args.some(a => typeof a === 'function')) throw new Error(`${k}() can't take a function here`);
            return self[k](...args);
          }
          f = getProp(self, k);
        } else f = await ev(e.f, scope, st);
        if (typeof f !== 'function' || !f[CALLABLE]) throw new Error(`${describe(e.f)} is not a function Cinder templates can call`);
        const args = [];
        for (const a of e.args) args.push(await ev(a, scope, st));
        return await f(...args);
      }
    }
    throw new Error('unsupported expression');
  }
  async function keyOf(e, scope, st) { const k = await ev(e.k, scope, st); return typeof k === 'number' ? k : String(k); }
  // Property reads: own properties of objects, and length/indexes of strings and lists.
  // (Methods of strings and lists are only reachable through calls, and only the safe ones.)
  function getProp(o, k) {
    if (BLOCKED.has(String(k))) throw new Error(`"${k}" isn't available in Cinder templates`);
    if (typeof o === 'string' || Array.isArray(o)) return k === 'length' || /^\d+$/.test(String(k)) ? o[k] : undefined;
    if ((o && typeof o === 'object') || typeof o === 'function') return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
    return undefined;
  }
  function describe(e) {
    if (e.e === 'var') return e.name;
    if (e.e === 'get' && e.k.e === 'lit') return describe(e.o) + '.' + e.k.v;
    return 'that';
  }

  // ============================================================ tp

  // env: {path, title, folder, content, selection, frontmatter, tags, vaultPath, ctime, mtime,
  //       prompt(text, def, multiline), suggest(labels, values, placeholder), clipboard(),
  //       read(link) -> content, exists(link), createNote(path, content, open), templatePath}
  function makeTp(env, st) {
    const unsupported = what => fn(() => { throw new Error(`${what} isn't available in Cinder templates`); });
    // "Now" is env.now when given (a note made for another day, like a daily note for tomorrow).
    const now = () => env.now ? new Date(env.now) : new Date();
    const date = {
      now: fn((format = 'YYYY-MM-DD', offset, reference, refFormat) => formatDate(addOffset(reference != null ? parseDate(reference, refFormat) : now(), offset), format)),
      tomorrow: fn((format = 'YYYY-MM-DD') => formatDate(addOffset(now(), 1), format)),
      yesterday: fn((format = 'YYYY-MM-DD') => formatDate(addOffset(now(), -1), format)),
      weekday: fn((format = 'YYYY-MM-DD', weekday = 0, reference, refFormat) => {
        // Monday-based, as in Templater's docs: 0 is this week's Monday, 7 next Monday.
        const d = reference != null ? parseDate(reference, refFormat) : now();
        const monday = addOffset(d, -((d.getDay() + 6) % 7));
        return formatDate(addOffset(monday, weekday), format);
      }),
    };
    const cursors = [];
    const file = {
      title: env.title,
      content: env.content ?? '',
      tags: (env.tags || []).map(t => '#' + t),
      folder: fn((relative = false) => relative ? env.folder : (env.folder.split('/').pop() || '')),
      path: fn((relative = false) => relative ? env.path : (env.vaultPath ? env.vaultPath.replace(/[\\/]+$/, '') + '/' + env.path : env.path)),
      creation_date: fn((format = 'YYYY-MM-DD HH:mm') => formatDate(new Date(env.ctime || Date.now()), format)),
      last_modified_date: fn((format = 'YYYY-MM-DD HH:mm') => formatDate(new Date(env.mtime || Date.now()), format)),
      cursor: fn((order) => { const n = order ?? cursors.length; cursors.push(n); return `\u0000CURSOR${n}\u0000`; }),
      cursor_append: fn(content => { st.cursorAppend.push(String(content)); return ''; }),
      selection: fn(() => env.selection || ''),
      exists: fn(link => !!(env.exists && env.exists(String(link).replace(/^\[\[|\]\]$/g, '')))),
      include: fn(async link => {
        if (st.depth >= 10) throw new Error('templates include each other too deeply');
        const content = env.read && await env.read(String(link).replace(/^\[\[|\]\]$/g, ''));
        if (content == null) throw new Error(`tp.file.include: ${link} not found`);
        const r = await render(content, env, st.depth + 1);
        return r.text;
      }),
      rename: fn(name => { st.actions.push({ type: 'rename', name: String(name) }); file.title = String(name); return ''; }),
      move: fn(path => { st.actions.push({ type: 'move', path: String(path).replace(/^\/+/, '') }); return ''; }),
      create_new: fn(async (template, filename, open = false, folder) => {
        const body = String(template ?? '');
        const name = String(filename || 'Untitled');
        const dir = folder == null ? env.folder : String(folder).replace(/^\/+|\/+$/g, '');
        st.actions.push({ type: 'create', path: (dir ? dir + '/' : '') + name + '.md', content: body, open: !!open });
        return '';
      }),
      find_tfile: unsupported('tp.file.find_tfile'),
    };
    const system = {
      prompt: fn(async (text = '', def = '', throwOnCancel = false, multiline = false) => {
        const v = env.prompt ? await env.prompt(String(text), def == null ? '' : String(def), !!multiline) : def;
        if (v == null) { if (throwOnCancel) throw new Abort(); return null; }
        return v;
      }),
      suggester: fn(async (labels, items, throwOnCancel = false, placeholder = '') => {
        if (!Array.isArray(labels) || !Array.isArray(items)) throw new Error('tp.system.suggester needs two lists: labels and values');
        const v = env.suggest ? await env.suggest(labels.map(String), items, String(placeholder)) : undefined;
        if (v === undefined || v === null) { if (throwOnCancel) throw new Abort(); return null; }
        return v;
      }),
      clipboard: fn(async () => env.clipboard ? await env.clipboard() : ''),
    };
    const tp = {
      date, file, system,
      frontmatter: { ...(env.frontmatter || {}) },
      config: { template_file: env.templatePath || '', target_file: env.path, run_mode: 0 },
      web: { daily_quote: unsupported('tp.web (Cinder makes no network requests)'), random_picture: unsupported('tp.web (Cinder makes no network requests)'), request: unsupported('tp.web (Cinder makes no network requests)') },
      user: {},
      hooks: { on_all_templates_executed: fn(() => '') },
    };
    return { tp, cursors };
  }

  const GLOBALS = {
    Math: Object.fromEntries(['abs', 'ceil', 'floor', 'round', 'max', 'min', 'pow', 'sqrt', 'random', 'trunc', 'sign'].map(k => [k, fn((...a) => Math[k](...a))])),
    parseInt: fn((s, r) => parseInt(s, r)), parseFloat: fn(s => parseFloat(s)), isNaN: fn(v => isNaN(v)),
    String: fn(v => String(v)), Number: fn(v => Number(v)), Boolean: fn(v => Boolean(v)),
    JSON: { stringify: fn((v, _r, sp) => JSON.stringify(v, null, sp)), parse: fn(s => JSON.parse(s)) },
    console: { log: fn(() => undefined) },
  };

  // Render a template. Returns {text, cursor (offset or -1), actions: [{type: rename|move|create, ...}]}.
  async function render(src, env = {}, depth = 0) {
    const body = parse(tokenize(src));
    const st = { out: '', steps: 0, depth, actions: [], cursorAppend: [] };
    const { tp, cursors } = makeTp(env, st);
    const scope = { vars: new Map(Object.entries({ ...GLOBALS, tp })), parent: null };
    try { await run(body, scope, st); } catch (e) { if (!(e instanceof Abort)) throw e; st.aborted = true; }
    let text = st.out, cursor = -1;
    if (depth === 0) {
      // The cursor goes to the lowest-numbered tp.file.cursor(); all markers are then removed.
      const MARK = /\u0000CURSOR\d+\u0000/g;
      if (cursors.length) {
        const at = text.indexOf(`\u0000CURSOR${Math.min(...cursors)}\u0000`);
        if (at >= 0) cursor = text.slice(0, at).replace(MARK, '').length;
      }
      text = text.replace(MARK, '') + st.cursorAppend.join('');
    }
    return { text, cursor, actions: st.actions, aborted: !!st.aborted };
  }

  const hasTemplaterSyntax = s => /<%[\s\S]*?%>/.test(s);

  const api = { render, formatDate, parseDate, addOffset, hasTemplaterSyntax };
  root.CinderTemplater = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
