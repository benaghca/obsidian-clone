// Tests for the pure parts of ui/bases.js (YAML, frontmatter, expressions, queries).
// Run with plain Node 18+, no packages needed:  node ui/test/bases.test.js
'use strict';
const assert = require('assert');
require('../templater.js'); // date formatting
const B = require('../bases.js');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

// Shaped like the examples in Obsidian's Bases documentation.
const BASE = `filters:
  and:
    - file.hasTag("book")
    - 'file.ext == "md"'
formulas:
  ppd: pages / 7   # pages per day
  label: 'if(status == "done", "✓ " + file.basename, file.basename)'
properties:
  author:
    displayName: Author
  formula.ppd:
    displayName: "Pages/day"
views:
  - type: table
    name: Reading list
    filters:
      or:
        - status == "reading"
        - status == "todo"
    order:
      - file.name
      - author
      - formula.ppd
    sort:
      - property: pages
        direction: DESC
    limit: 10
  - type: cards
    name: "All books"
    image: cover
  - type: board
    name: Board
    groupBy:
      property: status
      direction: ASC
`;

const row = (path, props, extra = {}) => {
  const name = path.split('/').pop();
  return { path, name, basename: name.replace(/\.md$/, ''), folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', ext: name.split('.').pop(),
    size: 100, ctime: new Date(2024, 0, 1).getTime(), mtime: new Date(2024, 5, 1).getTime(), tags: props.tags ? [].concat(props.tags).map(x => x.toLowerCase()) : [], links: [], props, ...extra };
};
const ROWS = [
  row('Books/Dune.md', { tags: ['book', 'scifi'], status: 'reading', author: 'Herbert', pages: 700, cover: 'dune.jpg' }),
  row('Books/Emma.md', { tags: ['book'], status: 'done', author: 'Austen', pages: 400 }),
  row('Books/Hobbit.md', { tags: ['book/fantasy'], status: 'todo', author: 'Tolkien', pages: 300 }),
  row('Books/Draft.md', { tags: ['book'], status: 'todo' }),
  row('Notes/Other.md', { status: 'reading', pages: 5 }),
  row('Books/cover.png', {}, { ext: 'png', tags: [] }),
];

t('YAML: Obsidian base files parse', () => {
  const y = B.parseYaml(BASE);
  assert.deepEqual(y.filters, { and: ['file.hasTag("book")', 'file.ext == "md"'] });
  assert.equal(y.formulas.ppd, 'pages / 7');
  assert.equal(y.formulas.label, 'if(status == "done", "✓ " + file.basename, file.basename)');
  assert.equal(y.properties['formula.ppd'].displayName, 'Pages/day');
  assert.equal(y.views.length, 3);
  assert.deepEqual(y.views[0].sort, [{ property: 'pages', direction: 'DESC' }]);
  assert.equal(y.views[0].limit, 10);
  assert.equal(y.views[1].name, 'All books');
  assert.deepEqual(y.views[2].groupBy, { property: 'status', direction: 'ASC' });
});

t('YAML: scalars, flow collections, block scalars, comments', () => {
  assert.deepEqual(B.parseYaml('a: 1\nb: 1.5\nc: true\nd: null\ne: ~\nf: "x: y"\ng: \'it\'\'s\'\nh: [1, "two", {k: v}]\ni: {x: [a, b]}\nj: # c\n  - x # y\n  - "#not"\nk: plain text # comment\nl:\n'),
    { a: 1, b: 1.5, c: true, d: null, e: null, f: 'x: y', g: "it's", h: [1, 'two', { k: 'v' }], i: { x: ['a', 'b'] }, j: ['x', '#not'], k: 'plain text', l: null });
  assert.deepEqual(B.parseYaml('text: |\n  line 1\n  line 2\nfolded: >-\n  a\n  b\nafter: 1'), { text: 'line 1\nline 2\n', folded: 'a b', after: 1 });
  assert.deepEqual(B.parseYaml('list:\n- a\n- b\nnested:\n  - name: x\n    v: 1\n  - name: y'), { list: ['a', 'b'], nested: [{ name: 'x', v: 1 }, { name: 'y' }] });
  assert.equal(B.parseYaml('date: 2024-05-01').date, '2024-05-01');
  assert.throws(() => B.parseYaml('a: [1, 2'));
});

t('YAML: emit round-trips', () => {
  for (const v of [B.parseYaml(BASE), { a: "it's: fine", b: ['#tag', 'true', '12', ''], c: [], d: {}, e: null, f: [{ x: 1, y: [1, 2] }], 'odd key': 'v' }]) {
    const back = B.parseYaml(B.emitYaml(v));
    assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(v)), B.emitYaml(v));
  }
  assert.equal(B.emitYaml({ filters: { and: ['status != "done"'] } }), "filters:\n  and:\n    - status != \"done\"");
});

t('frontmatter: read and edit one property', () => {
  const note = '---\ntitle: Dune\ntags:\n  - book\n  - scifi\nrating: 4\n---\nBody text\n';
  assert.deepEqual(B.frontmatter(note), { title: 'Dune', tags: ['book', 'scifi'], rating: 4 });
  assert.equal(B.setFrontmatter(note, 'rating', 5), '---\ntitle: Dune\ntags:\n  - book\n  - scifi\nrating: 5\n---\nBody text\n');
  assert.equal(B.setFrontmatter(note, 'tags', ['a']), '---\ntitle: Dune\ntags:\n  - a\nrating: 4\n---\nBody text\n');
  assert.equal(B.setFrontmatter(note, 'status', 'in progress'), '---\ntitle: Dune\ntags:\n  - book\n  - scifi\nrating: 4\nstatus: in progress\n---\nBody text\n');
  assert.equal(B.setFrontmatter(note, 'tags', undefined), '---\ntitle: Dune\nrating: 4\n---\nBody text\n');
  assert.equal(B.setFrontmatter('Just text', 'done', true), '---\ndone: true\n---\nJust text');
  assert.equal(B.setFrontmatter('---\nonly: 1\n---\nx', 'only', undefined), 'x');
  assert.equal(B.setFrontmatter(note, 'due', null), note.replace('rating: 4\n', 'rating: 4\ndue:\n'));
});

t('expressions', () => {
  const r = ROWS[0], ev = (x, ctx) => B.evaluate(x, r, ctx);
  assert.equal(ev('status == "reading"'), true);
  assert.equal(ev('note.pages > 500 && author.startsWith("her")'), true);
  assert.equal(ev('pages / 7'), 100);
  assert.equal(ev('file.name'), 'Dune.md');
  assert.equal(ev('file.basename + " by " + author'), 'Dune by Herbert');
  assert.equal(ev('file.hasTag("book") && file.hasTag("#scifi") && !file.hasTag("fantasy")'), true);
  assert.equal(B.evaluate('file.hasTag("book")', ROWS[2]), true, 'nested tags match their parent');
  assert.equal(ev('file.inFolder("Books") && !file.inFolder("Notes")'), true);
  assert.equal(ev('tags.contains("scifi") and tags.length == 2'), true);
  assert.equal(ev('missing == null && missing.isEmpty()'), true);
  assert.equal(ev('if(pages > 500, "long", "short")'), 'long');
  assert.equal(ev('round(missing / 7, 1)'), null, 'maths on an empty value stays empty');
  assert.equal(ev('file.mtime > file.ctime'), true);
  assert.equal(ev('file.ctime.format("YYYY")'), '2024');
  assert.equal(ev('(file.mtime - file.ctime).days'), 152);
  assert.equal(ev('date("2024-01-31") + "1M" == date("2024-03-02")'), true);
  assert.equal(ev('today() - "1d" < today()'), true);
  assert.equal(ev('status == "done" ? 1 : 2'), 2);
  assert.equal(ev('formula.ppd * 2', { formulas: { ppd: 'pages / 7' } }), 200);
  assert.throws(() => ev('formula.a', { formulas: { a: 'formula.b', b: 'formula.a' } }), /refers to itself/);
  assert.throws(() => ev('constructor.constructor("x")'), /isn't available|not a function/);
  assert.throws(() => ev('fetch("x")'), /not a function/);
  assert.throws(() => ev('status =='), /ends too soon/);
  // a property called "date" is still a property
  assert.equal(B.evaluate('date < today()', row('x.md', { date: '2020-01-01' })), true);
});

t('queries: filters, sort, limit, group, columns', () => {
  const base = B.parseBase(BASE);
  const q0 = B.query(base, 0, ROWS);
  assert.deepEqual(q0.rows.map(r => r.basename), ['Dune', 'Hobbit', 'Draft'], 'global + view filters, sorted by pages desc, empties last');
  assert.deepEqual(B.query(base, 0, ROWS, { backlinks: p => p === 'Books/Dune.md' ? ['Notes/Other.md'] : [] }).rows.length, 3);
  assert.equal(B.evaluate('file.backlinks.length', ROWS[0], { backlinks: () => ['a.md', 'b.md'] }), 2);
  assert.deepEqual(q0.columns, ['file.name', 'author', 'formula.ppd']);
  assert.equal(B.valueOf('formula.ppd', q0.rows[0], q0.ctx), 100);
  assert.equal(B.columnName(base, 'formula.ppd'), 'Pages/day');
  assert.equal(B.columnName(base, 'author'), 'Author');
  const q2 = B.query(base, 2, ROWS);
  assert.deepEqual(q2.groups.map(g => [g.key, g.rows.length]), [['done', 1], ['reading', 1], ['todo', 2]]);
  const q1 = B.query(base, 1, ROWS, { search: 'aust' });
  assert.deepEqual(q1.rows.map(r => r.basename), ['Emma']);
  assert.equal(q1.total, 4);
  // defaults: no views, no order -> name + common properties
  const plain = B.query(B.parseBase(''), 0, ROWS);
  assert.equal(plain.rows.length, ROWS.length);
  assert.equal(plain.columns[0], 'file.name');
  assert(plain.columns.includes('status'));
  // a broken filter reports an error instead of throwing
  const bad = B.query(B.parseBase('filters: "status =="'), 0, ROWS);
  assert.equal(bad.rows.length, 0); assert(bad.errors[0].includes('ends too soon'));
});

t('filter builder and new-note defaults', () => {
  assert.equal(B.buildFilter('status', 'is', 'done'), 'status == "done"');
  assert.equal(B.buildFilter('pages', '>', '300'), 'pages > 300');
  assert.equal(B.buildFilter('due', '<', '2024-05-01'), 'due < date("2024-05-01")');
  assert.equal(B.buildFilter('my prop', 'contains', 'x'), 'note["my prop"].contains("x")');
  assert.equal(B.buildFilter('file.tags', 'has tag', '#book'), 'file.hasTag("book")');
  for (const [p, o, v] of [['status', 'is not', 'x'], ['file.name', 'contains', 'a'], ['due', 'is empty', ''], ['x', 'in folder', 'A/B'], ['x', 'links to', 'Note']]) B.parseExpr(B.buildFilter(p, o, v));
  const base = B.parseBase('filters:\n  and:\n    - file.inFolder("Books")\n    - file.hasTag("book")\nviews:\n  - type: table\n    name: T\n    filters:\n      and:\n        - status == "todo"\n        - pages == 3\n');
  assert.deepEqual(B.newNoteDefaults(base, base.views[0]), { props: { tags: ['book'], status: 'todo', pages: 3 }, folder: 'Books' });
});

t('summaries and relative dates', () => {
  assert.deepEqual(B.summarize([1, 2, 3, null]), { kind: 'number', sum: 6, avg: 2, filled: 3 });
  assert.deepEqual(B.summarize([true, false, null]), { kind: 'check', checked: 1, filled: 3 });
  assert.deepEqual(B.summarize(['a', '', null]), { kind: 'filled', filled: 1 });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  assert.equal(B.relative(new B.FDate(today.getTime() + 864e5, true)), 'tomorrow');
  assert.equal(B.relative(new B.FDate(today.getTime() - 3 * 864e5, true)), '3 days ago');
  assert.equal(B.relative(new B.FDate(Date.now() - 2 * 36e5)), '2 hours ago');
});

console.log(`ok ${n} tests`);
