// Tests for ui/search.js (the ranked search index).
// Run with plain Node 18+, no packages needed:  node ui/test/search.test.js
'use strict';
const assert = require('assert');
const { Index, tokens, distance } = require('../search.js');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const NOW = Date.UTC(2026, 8, 25);
const ix = new Index();
ix.set('garden.md', { title: 'Garden', body: 'Tomatoes and basil in the raised beds. Compost helps.', headings: ['Planting'], tags: ['home'], mtime: NOW });
ix.set('compost.md', { title: 'Compost bins', body: 'How to build compost bins for the garden.', mtime: NOW - 90 * 864e5 });
ix.set('recipes.md', { title: 'Recipes', body: 'Basil pesto. Tomato sauce. Receive the café crème.', mtime: NOW - 90 * 864e5 });
ix.set('work.md', { title: 'Work log', body: 'Meeting about the garden project budget.', mtime: NOW - 90 * 864e5 });

t('tokens keep their place in the text, folded', () => {
  assert.deepEqual(tokens('Café au lait'), [{ t: 'cafe', i: 0, len: 4 }, { t: 'au', i: 5, len: 2 }, { t: 'lait', i: 8, len: 4 }]);
});

t('distance', () => {
  assert.equal(distance('recieve', 'receive', 2), 1); // a swap counts once
  assert.equal(distance('garden', 'gardens', 1), 1);
  assert.equal(distance('abc', 'xyz', 1), 2);
});

t('a title match outranks a mention in the text', () => {
  const r = ix.search(['garden'], { now: NOW }).map(x => x.id);
  assert.equal(r[0], 'garden.md');
  assert.deepEqual(r.slice(1).sort(), ['compost.md', 'work.md']);
});

t('every word has to match', () => {
  assert.deepEqual(ix.search(['garden', 'budget'], { now: NOW }).map(x => x.id), ['work.md']);
  assert.deepEqual(ix.search(['garden', 'nothing'], { now: NOW }), []);
});

t('prefixes, typos and accents', () => {
  assert(ix.search(['gard'], { now: NOW }).some(x => x.id === 'garden.md'));
  assert.deepEqual(ix.search(['recieve'], { now: NOW }).map(x => x.id), ['recipes.md']);
  assert.deepEqual(ix.search(['creme'], { now: NOW }).map(x => x.id), ['recipes.md']);
  const r = ix.search(['compst'], { now: NOW });
  assert(r.length === 2 && r[0].used.includes('compost'));
});

t('where the matches are, for snippets', () => {
  const r = ix.search(['basil'], { now: NOW }).find(x => x.id === 'garden.md');
  assert.deepEqual(r.matched.basil, [[13, 5]]);
});

t('updating and removing notes', () => {
  assert.equal(ix.set('work.md', { title: 'Work log', body: 'Meeting about the garden project budget.', key: 'v1' }), true);
  assert.equal(ix.set('work.md', { title: 'x', body: 'y', key: 'v1' }), false, 'the same key is skipped');
  ix.set('work.md', { title: 'Work log', body: 'Only spreadsheets now.', key: 'v2' });
  assert(!ix.search(['budget']).length);
  ix.remove('recipes.md');
  assert(!ix.search(['pesto']).length);
  assert.equal(ix.size, 3);
});

t('a filter applies after matching', () => {
  const r = ix.search(['garden'], { filter: id => id !== 'garden.md' });
  assert(!r.some(x => x.id === 'garden.md'));
});

console.log(`ok ${n} tests`);
