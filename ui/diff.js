/* Cinder diff: what changed between two texts, line by line (Myers' algorithm) and, within a
 * changed line, word by word. Used by version history and by comparing conflicting copies.
 * No DOM access, so it can be tested under Node. */
'use strict';

(function (root) {
  // Myers' O(ND) diff of two arrays. Returns [{t: '=' | '-' | '+', v: item}] in order.
  function diffArrays(a, b, eq = (x, y) => x === y) {
    let pre = 0, suf = 0;
    while (pre < a.length && pre < b.length && eq(a[pre], b[pre])) pre++;
    while (suf < a.length - pre && suf < b.length - pre && eq(a[a.length - 1 - suf], b[b.length - 1 - suf])) suf++;
    const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
    const out = a.slice(0, pre).map(v => ({ t: '=', v }));
    const N = A.length, M = B.length, MAX = N + M;
    if (!N) for (const v of B) out.push({ t: '+', v });
    else if (!M) for (const v of A) out.push({ t: '-', v });
    else {
      const off = MAX + 1, V = new Int32Array(2 * MAX + 3), trace = [];
      let found = false;
      for (let d = 0; d <= MAX && !found; d++) {
        trace.push(V.slice());
        for (let k = -d; k <= d; k += 2) {
          let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
          let y = x - k;
          while (x < N && y < M && eq(A[x], B[y])) { x++; y++; }
          V[off + k] = x;
          if (x >= N && y >= M) { found = true; break; }
        }
      }
      // Walk back through the saved V arrays to recover the edit path.
      const ops = [];
      let x = N, y = M;
      for (let d = trace.length - 1; d >= 0; d--) {
        const v = trace[d], k = x - y;
        const prevK = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? k + 1 : k - 1;
        const px = v[off + prevK], py = px - prevK;
        while (x > px && y > py) { ops.push({ t: '=', v: A[x - 1] }); x--; y--; }
        if (d > 0) { if (x === px) ops.push({ t: '+', v: B[y - 1] }); else ops.push({ t: '-', v: A[x - 1] }); }
        x = px; y = py;
      }
      out.push(...ops.reverse());
    }
    for (const v of a.slice(a.length - suf)) out.push({ t: '=', v });
    return out;
  }

  const splitLines = s => { if (s == null || s === '') return []; const l = String(s).split('\n'); if (l[l.length - 1] === '') l.pop(); return l; };

  // Line diff with line numbers: [{t, text, a (1-based old line or null), b (new line or null)}]
  function lines(oldText, newText) {
    let ai = 0, bi = 0;
    return diffArrays(splitLines(oldText), splitLines(newText)).map(o => ({
      t: o.t, text: o.v,
      a: o.t === '+' ? null : ++ai,
      b: o.t === '-' ? null : ++bi,
    }));
  }

  // Group a line diff into hunks with `context` unchanged lines around each change.
  // Returns [{rows: [...line diff rows], hidden before: n}] plus a count of what changed.
  function hunks(rows, context = 3) {
    const out = [];
    let i = 0;
    const changed = rows.map(r => r.t !== '=');
    while (i < rows.length) {
      const start = changed.indexOf(true, i);
      if (start < 0) break;
      let end = start;
      // Extend while the next change is within 2 * context lines.
      for (let j = start; j < rows.length; j++) {
        if (changed[j]) end = j;
        else if (j - end > 2 * context) break;
      }
      const from = Math.max(i, start - context), to = Math.min(rows.length - 1, end + context);
      out.push({ skipped: from - i, rows: rows.slice(from, to + 1) });
      i = to + 1;
    }
    return { hunks: out, after: rows.length - i, added: rows.filter(r => r.t === '+').length, removed: rows.filter(r => r.t === '-').length };
  }

  // Word-level diff of two lines: [{t, v}] over words, spaces and punctuation.
  const tokens = s => String(s).match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];
  function words(a, b) {
    const ops = diffArrays(tokens(a), tokens(b));
    // Merge runs of the same kind.
    const out = [];
    for (const o of ops) { const l = out[out.length - 1]; if (l && l.t === o.t) l.v += o.v; else out.push({ ...o }); }
    return out;
  }

  // Pair up removed and added lines that sit next to each other, so a changed line can show
  // its word-level changes. Returns rows with `pair` set on each partner.
  function pairChanges(rows) {
    for (let i = 0; i < rows.length;) {
      if (rows[i].t !== '-') { i++; continue; }
      let j = i; while (j < rows.length && rows[j].t === '-') j++;
      let k = j; while (k < rows.length && rows[k].t === '+') k++;
      const n = Math.min(j - i, k - j);
      for (let m = 0; m < n; m++) { rows[i + m].pair = rows[j + m]; rows[j + m].pair = rows[i + m]; }
      i = k;
    }
    return rows;
  }

  // Blocks for merging two versions: runs of shared lines, and conflicts where they differ.
  // [{same: [lines]} | {mine: [lines], theirs: [lines]}]
  function blocks(mine, theirs) {
    const out = [];
    for (const o of diffArrays(splitLines(mine), splitLines(theirs))) {
      const last = out[out.length - 1];
      if (o.t === '=') { if (last && last.same) last.same.push(o.v); else out.push({ same: [o.v] }); }
      else {
        const c = last && !last.same ? last : (out.push({ mine: [], theirs: [] }), out[out.length - 1]);
        (o.t === '-' ? c.mine : c.theirs).push(o.v);
      }
    }
    return out;
  }

  root.CinderDiff = { diffArrays, lines, hunks, words, pairChanges, blocks, splitLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CinderDiff;
})(typeof window !== 'undefined' ? window : globalThis);
