// Tests for ui/diff.js (line and word diffs, hunks, merge blocks).
// Run with plain Node 18+, no packages needed:  node ui/test/diff.test.js
'use strict';
const assert = require('assert');
const D = require('../diff.js');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

// Applying a diff's '=' and '+' rows must give the new text; '=' and '-' rows the old one.
const rebuild = (rows, keep) => rows.filter(r => r.t === '=' || r.t === keep).map(r => r.text).join('\n');

t('line diff of small edits', () => {
  const a = 'one\ntwo\nthree\nfour', b = 'one\n2\nthree\nfour\nfive';
  const rows = D.lines(a, b);
  assert.deepEqual(rows.map(r => r.t + r.text), ['=one', '-two', '+2', '=three', '=four', '+five']);
  assert.deepEqual(rows.map(r => [r.a, r.b]), [[1, 1], [2, null], [null, 2], [3, 3], [4, 4], [null, 5]]);
});

t('diffs rebuild both sides, for random texts', () => {
  let seed = 7;
  const rnd = k => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
  for (let i = 0; i < 300; i++) {
    const mk = () => Array.from({ length: rnd(14) }, () => 'abcde'[rnd(5)]).join('\n');
    const a = mk(), b = mk();
    const rows = D.lines(a, b);
    assert.equal(rebuild(rows, '-'), D.splitLines(a).join('\n'));
    assert.equal(rebuild(rows, '+'), D.splitLines(b).join('\n'));
  }
});

t('the diff is minimal', () => {
  const rows = D.lines('a\nb\nc\na\nb\nb\na', 'c\nb\na\nb\na\nc');
  assert.equal(rows.filter(r => r.t !== '=').length, 5); // the classic Myers example: D = 5
});

t('empty sides', () => {
  assert.deepEqual(D.lines('', 'x\ny').map(r => r.t), ['+', '+']);
  assert.deepEqual(D.lines('x', '').map(r => r.t), ['-']);
  assert.deepEqual(D.lines('same\n', 'same'), [{ t: '=', text: 'same', a: 1, b: 1 }]);
});

t('hunks keep context and count changes', () => {
  const a = Array.from({ length: 30 }, (_, i) => 'line ' + i).join('\n');
  const b = a.replace('line 3\n', 'line three\n').replace('line 25', 'line 25!');
  const h = D.hunks(D.lines(a, b), 2);
  assert.equal(h.hunks.length, 2);
  assert.equal(h.hunks[0].skipped, 1);
  assert.deepEqual(h.hunks[0].rows.map(r => r.text), ['line 1', 'line 2', 'line 3', 'line three', 'line 4', 'line 5']);
  assert.equal(h.after, 2);
  assert.deepEqual([h.added, h.removed], [2, 2]);
});

t('word diff within a line', () => {
  const w = D.words('The quick brown fox', 'The slow brown fox!');
  assert.deepEqual(w, [{ t: '=', v: 'The ' }, { t: '-', v: 'quick' }, { t: '+', v: 'slow' }, { t: '=', v: ' brown fox' }, { t: '+', v: '!' }]);
});

t('pairing changed lines', () => {
  const rows = D.pairChanges(D.lines('a\nold 1\nold 2\nz', 'a\nnew 1\nz'));
  assert.equal(rows[1].pair, rows[3]);
  assert.equal(rows[2].pair, undefined);
});

t('merge blocks', () => {
  const b = D.blocks('head\nmine\ntail', 'head\ntheirs\nmore\ntail');
  assert.deepEqual(b, [{ same: ['head'] }, { mine: ['mine'], theirs: ['theirs', 'more'] }, { same: ['tail'] }]);
});

console.log(`ok ${n} tests`);
