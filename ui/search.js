/* Cinder search index: an inverted index of the vault's words for ranked search (BM25), where
 * a word matches itself, words it begins (so "gard" finds "garden") and near misses (so
 * "recieve" finds "receive"). Words in a note's title, headings and tags count for more than
 * words in its text, and recently changed notes get a small lift. Accents are ignored.
 * No DOM access, so it can be tested under Node. */
'use strict';

(function (root) {
  const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const WORD = /[\p{L}\p{N}_]+/gu;
  // Each word of a text, folded, with where it is in the text: [{t, i, len}]
  function tokens(text) {
    const out = [];
    for (const m of String(text).matchAll(WORD)) if (m[0].length <= 40) out.push({ t: fold(m[0]), i: m.index, len: m[0].length });
    return out;
  }

  // Damerau-Levenshtein distance, giving up (returning max + 1) once it's over `max`.
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let p2 = null, p = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const c = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
        c.push(v);
        if (v < best) best = v;
      }
      if (best > max) return max + 1;
      p2 = p; p = c;
    }
    return p[b.length];
  }

  const FIELDS = { title: 4, heading: 2, tag: 2, body: 1 };
  const K1 = 1.2, B = 0.75;

  class Index {
    constructor() { this.post = new Map(); this.docs = new Map(); this.vocab = null; this.totalLen = 0; }
    get size() { return this.docs.size; }
    has(id) { return this.docs.has(id); }
    // doc: {title, body, headings: [text], tags: [text], mtime, key (anything; set() is skipped when unchanged)}
    set(id, doc) {
      const old = this.docs.get(id);
      if (old && doc.key !== undefined && old.key === doc.key) return false;
      this.remove(id);
      const terms = new Map(); // term -> {w, pos: [[i, len]]}
      const add = (t, w, pos) => {
        let e = terms.get(t); if (!e) terms.set(t, e = { w: 0, pos: [] });
        e.w += w; if (pos && e.pos.length < 24) e.pos.push(pos);
      };
      const body = tokens(doc.body || '');
      for (const k of body) add(k.t, FIELDS.body, [k.i, k.len]);
      for (const k of tokens(doc.title || '')) add(k.t, FIELDS.title);
      for (const h of doc.headings || []) for (const k of tokens(h)) add(k.t, FIELDS.heading);
      for (const g of doc.tags || []) for (const k of tokens(g)) add(k.t, FIELDS.tag);
      for (const [t, e] of terms) { let m = this.post.get(t); if (!m) { this.post.set(t, m = new Map()); this.vocab = null; } m.set(id, e); }
      this.docs.set(id, { len: body.length || 1, terms: [...terms.keys()], mtime: doc.mtime || 0, key: doc.key });
      this.totalLen += body.length || 1;
      return true;
    }
    remove(id) {
      const d = this.docs.get(id);
      if (!d) return;
      for (const t of d.terms) { const m = this.post.get(t); if (!m) continue; m.delete(id); if (!m.size) { this.post.delete(t); this.vocab = null; } }
      this.totalLen -= d.len;
      this.docs.delete(id);
    }
    // The words a query word matches, each with how good a match it is: [[term, weight]]
    variants(q) {
      q = fold(q);
      const out = new Map();
      if (this.post.has(q)) out.set(q, 1);
      if (!this.vocab) this.vocab = [...this.post.keys()].sort();
      if (q.length >= 2) {
        // Words it begins: binary search to the first, then walk.
        let lo = 0, hi = this.vocab.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (this.vocab[mid] < q) lo = mid + 1; else hi = mid; }
        for (let i = lo, n = 0; i < this.vocab.length && this.vocab[i].startsWith(q) && n < 60; i++, n++) {
          const t = this.vocab[i];
          if (t !== q) out.set(t, Math.max(out.get(t) || 0, 0.75 - Math.min(0.35, (t.length - q.length) * 0.03)));
        }
      }
      if (q.length >= 4) {
        const max = q.length >= 8 ? 2 : 1;
        for (const t of this.vocab) {
          if (Math.abs(t.length - q.length) > max || t[0] !== q[0] && q.length < 6) continue;
          const d = distance(q, t, max);
          if (d > 0 && d <= max) out.set(t, Math.max(out.get(t) || 0, d === 1 ? 0.55 : 0.35));
        }
      }
      return [...out].sort((a, b) => b[1] - a[1]).slice(0, 40);
    }
    // Ranked ids for query words (every word has to match): [{id, score, matched: {term: [[i, len]]}, used: [terms]}]
    /** @param {string[]} words @param {{limit?: number, now?: number, filter?: (id: string) => boolean}} [o] */
    search(words, o = {}) {
      const { limit = 300, now = Date.now(), filter } = o;
      words = words.map(fold).filter(Boolean);
      if (!words.length || !this.docs.size) return [];
      const N = this.docs.size, avg = this.totalLen / N;
      let acc = null;
      for (const w of words) {
        const per = new Map(); // id -> {s, terms}
        for (const [t, vw] of this.variants(w)) {
          const m = this.post.get(t); if (!m) continue;
          const idf = Math.log(1 + (N - m.size + 0.5) / (m.size + 0.5));
          for (const [id, e] of m) {
            if (acc && !acc.has(id)) continue;
            const len = this.docs.get(id).len;
            const s = vw * idf * (e.w * (K1 + 1)) / (e.w + K1 * (1 - B + B * len / avg));
            const cur = per.get(id);
            if (!cur) per.set(id, { s, terms: [t] });
            else { cur.s = Math.max(cur.s, s); cur.terms.push(t); }
          }
        }
        if (acc) { for (const [id, r] of acc) { const p = per.get(id); if (!p) acc.delete(id); else { r.score += p.s; r.used.push(...p.terms); } } }
        else acc = new Map([...per].map(([id, p]) => [id, /** @type {any} */ ({ id, score: p.s, used: [...p.terms] })]));
        if (!acc.size) return [];
      }
      const out = [];
      for (const r of acc.values()) {
        if (filter && !filter(r.id)) continue;
        const age = (now - (this.docs.get(r.id).mtime || 0)) / 864e5;
        r.score *= 1 + 0.12 * Math.max(0, 1 - age / 30); // a little lift for what changed this month
        r.matched = {};
        for (const t of new Set(r.used)) r.matched[t] = this.post.get(t).get(r.id).pos;
        r.used = [...new Set(r.used)];
        out.push(r);
      }
      return out.sort((a, b) => b.score - a.score).slice(0, limit);
    }
  }

  root.CinderSearch = { Index, tokens, fold, distance };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CinderSearch;
})(typeof window !== 'undefined' ? window : globalThis);
