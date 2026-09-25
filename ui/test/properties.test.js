// Tests for the pure parts of ui/properties.js and the frontmatter edits it relies on.
// Run with plain Node 18+:  node ui/test/properties.test.js
'use strict';
const assert = require('assert');
const P = require('../properties.js');
const B = require('../bases.js');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

t('types are inferred the way Obsidian does', () => {
  assert.equal(P.inferType('tags', null), 'tags');
  assert.equal(P.inferType('aliases', 'x'), 'aliases');
  assert.equal(P.inferType('cssclasses', null), 'multitext');
  assert.equal(P.inferType('x', ['a']), 'multitext');
  assert.equal(P.inferType('x', true), 'checkbox');
  assert.equal(P.inferType('x', 3.5), 'number');
  assert.equal(P.inferType('x', '2024-03-05'), 'date');
  assert.equal(P.inferType('x', '2024-03-05T20:30'), 'datetime');
  assert.equal(P.inferType('x', '2024-03-05 20:30:00'), 'datetime');
  assert.equal(P.inferType('x', 'hello'), 'text');
});

t('values convert when the type changes', () => {
  assert.deepEqual(P.coerce('a, b', 'multitext'), ['a', 'b']);
  assert.deepEqual(P.coerce(['#x', 'y'], 'tags'), ['x', 'y']);
  assert.equal(P.coerce(['a', 'b'], 'text'), 'a, b');
  assert.equal(P.coerce('4.5 stars', 'number'), 4.5);
  assert.equal(P.coerce('none', 'number'), null);
  assert.equal(P.coerce('yes', 'checkbox'), true);
  assert.equal(P.coerce(null, 'checkbox'), false);
  assert.equal(P.coerce('2024-03-05T10:00', 'date'), '2024-03-05');
  assert.equal(P.coerce('2024-03-05', 'datetime'), '2024-03-05T00:00');
  assert.equal(P.coerce('2024-03-05 20:30:15', 'datetime'), '2024-03-05T20:30');
  assert.equal(P.coerce(7, 'text'), '7');
});

t('renaming keeps the position and the value text', () => {
  const c = '---\ntitle: A\ntags:\n  - x\nrating: 3 # nice\n---\nbody';
  assert.equal(B.renameFrontmatter(c, 'tags', 'labels'), '---\ntitle: A\nlabels:\n  - x\nrating: 3 # nice\n---\nbody');
  assert.equal(B.renameFrontmatter(c, 'rating', 'my score'), '---\ntitle: A\ntags:\n  - x\nmy score: 3 # nice\n---\nbody');
  assert.equal(B.renameFrontmatter(c, 'missing', 'x'), c);
  assert.equal(B.renameFrontmatter('no frontmatter', 'a', 'b'), 'no frontmatter');
  assert.equal(B.renameFrontmatter('---\n"a b": 1\n---\n', 'a b', 'c'), '---\nc: 1\n---\n');
});

t('empty frontmatter takes a first property', () => {
  assert.equal(B.setFrontmatter('---\n---\nbody', 'due', null), '---\ndue:\n---\nbody');
  assert.equal(B.setFrontmatter('---\ndue:\n---\nbody', 'due', undefined), 'body');
});

console.log(`ok ${n} tests`);
