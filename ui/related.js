/* Cinder related notes: which notes are about the same things as this one, found from the
 * words they share (TF-IDF vectors and cosine similarity), with extra weight for shared titles
 * words, tags and links. Entirely local: no model, no network. No DOM access, so it can be
 * tested under Node. */
'use strict';

(function (root) {
  const STOP = new Set(('a about above after again against all also am an and any are aren as at be because been before being below between both but by can cannot could did do does doing done down during each even ever every few for from further get gets got had has have having he her here hers herself him himself his how however i if in into is isn it its itself just let like made make many may me might more most much must my myself never no nor not now of off often on once one only or other our ours ourselves out over own per quite rather really same she should since so some still such than that the their theirs them themselves then there these they this those though through thus to too under until up upon us use used using very was we well were what when where whether which while who whom whose why will with within without would yet you your yours yourself yourselves ' +
    'aber als also am an auch auf aus bei bin bis bist da dann das dass dem den der des die dies doch dort du durch ein eine einem einen einer eines er es für hat hatte ich ihr im in ist ja jede kann kein man mit nach nicht noch nur ob oder ohne sein sich sie sind so über um und uns von vor war was weil wenn wer wie wir wird zu zum zur ' +
    'le la les un une des du de et en est pour pas que qui dans ce il elle sur au aux avec par plus son ses nous vous ils elles ont été être ' +
    'el los las una unos unas del al es por con para como pero sus lo se que').split(/\s+/));

  // Light stemming so "gardens" and "garden", "planting" and "plant" meet.
  function stem(w) {
    if (w.length > 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ed') && !w.endsWith('eed')) return w.slice(0, -2);
    if (w.length > 4 && /(?:oes|[sxz]es|[cs]hes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
    return w;
  }

  // Words of a text, lower-cased and stemmed, without code, links' targets, URLs or stop words.
  function words(text) {
    const t = String(text)
      .replace(/^---\r?\n[\s\S]*?\r?\n---/, ' ')
      .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
      .replace(/`[^`\n]*`/g, ' ')
      .replace(/%%[\s\S]*?%%/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, ' ')
      .replace(/!?\[\[[^\]]*\]\]/g, ' ')
      .replace(/\]\([^)]*\)/g, ']')
      .toLowerCase();
    const out = [];
    for (const m of t.matchAll(/[\p{L}][\p{L}\p{N}'’-]*[\p{L}\p{N}]|[\p{L}]{3,}/gu)) {
      const w = m[0].replace(/['’]s$/, '').replace(/['’-]/g, '');
      if (w.length < 3 || w.length > 30 || STOP.has(w) || /^\d/.test(w)) continue;
      out.push(stem(w));
    }
    return out;
  }

  // Build the index. docs: [{id, title, text, tags: [..], links: [ids]}]. Returns {vec: Map(id -> Map(term -> weight)), idf}.
  // A note's term counts. (Callers may keep these and pass them back as doc.counts.)
  function countTerms(d) {
    const c = new Map();
    const add = (k, n) => c.set(k, (c.get(k) || 0) + n);
    for (const w of words(d.text || '')) add(w, 1);
    for (const w of words(d.title || '')) add(w, 3);   // a word in the title says a lot
    for (const g of d.tags || []) add('#' + String(g).toLowerCase(), 2);
    for (const l of d.links || []) add('→' + l, 1.5); // notes that link to the same place are related
    return c;
  }

  function build(docs, { maxTerms = 80 } = {}) {
    const tf = new Map(), df = new Map();
    for (const d of docs) {
      const c = d.counts || countTerms(d);
      tf.set(d.id, c);
      for (const k of c.keys()) df.set(k, (df.get(k) || 0) + 1);
    }
    const N = docs.length || 1, idf = new Map();
    for (const [k, n] of df) idf.set(k, Math.log(1 + N / n));
    const vec = new Map();
    for (const [id, c] of tf) {
      let v = [...c].map(([k, n]) => [k, (1 + Math.log(n)) * idf.get(k)]);
      // Terms in (almost) every note carry no signal.
      v = v.filter(([k]) => df.get(k) <= Math.max(2, N * 0.6));
      v.sort((a, b) => b[1] - a[1]);
      v = v.slice(0, maxTerms);
      const norm = Math.hypot(...v.map(x => x[1])) || 1;
      vec.set(id, new Map(v.map(([k, w]) => [k, w / norm])));
    }
    return { vec, idf };
  }

  // The notes most like `id`: [{id, score, shared: [terms]}], best first.
  function similar(index, id, { limit = 10, exclude = new Set(), min = 0.05 } = {}) {
    const a = index.vec.get(id);
    if (!a || !a.size) return [];
    const out = [];
    for (const [other, b] of index.vec) {
      if (other === id || exclude.has(other)) continue;
      let s = 0; const shared = [];
      const [small, big] = a.size < b.size ? [a, b] : [b, a];
      for (const [k, w] of small) { const w2 = big.get(k); if (w2) { s += w * w2; shared.push([k, w * w2]); } }
      if (s >= min) out.push({ id: other, score: s, shared: shared.sort((x, y) => y[1] - x[1]).slice(0, 4).map(x => x[0]) });
    }
    return out.sort((x, y) => y.score - x.score).slice(0, limit);
  }

  root.CinderRelated = { words, stem, countTerms, build, similar };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CinderRelated;
})(typeof window !== 'undefined' ? window : globalThis);
