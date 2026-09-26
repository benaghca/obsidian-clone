// Tests for ui/yaml.js (the YAML used for frontmatter and .base files; Bases' tests cover more).
// Run with plain Node 18+, no packages needed:  node ui/test/yaml.test.js
'use strict';
const assert = require('assert');
const Y = require('../yaml.js');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

t('reads what frontmatter holds', () => {
  const v = Y.parse('title: "A: title"\ncount: 3\ndone: false\ntags:\n  - a\n  - b\naliases: [x, "y, z"]\nnested:\n  k: v\nnote: |\n  line one\n  line two\nempty:\n# a comment\nurl: https://example.com/#x');
  assert.deepEqual(v, { title: 'A: title', count: 3, done: false, tags: ['a', 'b'], aliases: ['x', 'y, z'], nested: { k: 'v' }, note: 'line one\nline two\n', empty: null, url: 'https://example.com/#x' });
});

t('writes it back so it reads the same', () => {
  const v = { title: 'A: title', n: 3, yes: true, list: ['a', 'b c', '#tag'], empty: [], obj: { k: 'v' }, s: 'true' };
  assert.deepEqual(Y.parse(Y.emit(v)), v);
});

t('split: frontmatter, how long it is, and whether it was valid', () => {
  const ok = Y.split('---\ntags: [a]\ncount: 2\n---\nBody');
  assert.deepEqual([ok.data, ok.valid, ok.len], [{ tags: ['a'], count: 2 }, true, 27]);
  assert.deepEqual(Y.split('No frontmatter'), { data: null, valid: true, len: 0 });
  // Not valid YAML (an unclosed list): still read leniently, and marked as such.
  const bad = Y.split('---\ntags: [a, b\naliases:\n  - Al\n---\nx');
  assert.equal(bad.valid, false);
  assert.deepEqual(bad.data.aliases, ['Al']);
});

console.log(`ok ${n} tests`);
