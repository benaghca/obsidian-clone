// Tests for ui/related.js (TF-IDF related notes).
// Run with plain Node 18+, no packages needed:  node ui/test/related.test.js
'use strict';
const assert = require('assert');
const R = require('../related.js');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

t('words: lower-cased, stemmed, without stop words, code, links or URLs', () => {
  assert.deepEqual(R.words('The Gardens and planting tomatoes in `code here` https://x.io [[Link]] $x^2$'), ['garden', 'plant', 'tomato']);
  assert.deepEqual(R.words('---\ntags: [a]\n---\nCompost bins'), ['compost', 'bin']);
  assert.deepEqual(R.words("Sam's berries, boxes and branches"), ['sam', 'berry', 'box', 'branch']);
});

const docs = [
  { id: 'Garden', title: 'Garden plan', text: 'Tomatoes, basil and compost for the raised beds. Water the tomatoes daily.', tags: ['garden'] },
  { id: 'Compost', title: 'Compost', text: 'Kitchen scraps and leaves make compost for the garden beds.', tags: ['garden'] },
  { id: 'Tomato varieties', title: 'Tomato varieties', text: 'Cherry tomatoes and beefsteak tomatoes; basil grows well beside them.' },
  { id: 'Rust notes', title: 'Rust notes', text: 'Ownership, borrowing and lifetimes in the Rust compiler.', tags: ['code'] },
  { id: 'Borrow checker', title: 'Borrow checker', text: 'The borrow checker enforces ownership and lifetimes.', tags: ['code'] },
  { id: 'Groceries', title: 'Groceries', text: 'Milk, bread, eggs.' },
];

t('finds notes about the same things', () => {
  const ix = R.build(docs);
  const g = R.similar(ix, 'Garden').map(x => x.id);
  assert.deepEqual(g.slice(0, 2).sort(), ['Compost', 'Tomato varieties']);
  assert(!g.includes('Rust notes') && !g.includes('Groceries'));
  const r = R.similar(ix, 'Rust notes');
  assert.equal(r[0].id, 'Borrow checker');
  assert(r[0].shared.includes('ownership') || r[0].shared.includes('lifetime'));
});

t('excludes, limits, and ignores empty notes', () => {
  const ix = R.build([...docs, { id: 'Empty', title: '', text: '' }]);
  assert.deepEqual(R.similar(ix, 'Empty'), []);
  const g = R.similar(ix, 'Garden', { exclude: new Set(['Compost']), limit: 1 });
  assert.deepEqual(g.map(x => x.id), ['Tomato varieties']);
});

t('shared links count', () => {
  const ix = R.build([
    { id: 'A', title: 'Alpha', text: 'x', links: ['Project X'] },
    { id: 'B', title: 'Beta', text: 'y', links: ['Project X'] },
    { id: 'C', title: 'Gamma', text: 'z', links: ['Other'] },
    { id: 'D', title: 'Delta', text: 'w', links: [] },
  ]);
  assert.deepEqual(R.similar(ix, 'A').map(x => x.id), ['B']);
});

console.log(`ok ${n} tests`);
