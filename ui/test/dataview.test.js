// Tests for ui/dataview.js: Dataview queries translated into Bases views and run on sample notes.
// Run with plain Node 18+, no packages needed:  node ui/test/dataview.test.js
'use strict';
const assert = require('assert');
require('../templater.js'); // date formatting
const B = require('../bases.js');
const DV = require('../dataview.js');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

const day = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).getTime(); }; // local midnight
const row = (path, props, extra = {}) => {
  const name = path.split('/').pop();
  return { path, name, basename: name.replace(/\.md$/, ''), folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', ext: 'md', size: 10, ctime: day('2026-01-01'), mtime: day('2026-09-01'), tags: [], links: [], props, ...extra };
};
const ROWS = [
  row('Books/Dune.md', { rating: 5, author: 'Herbert', status: 'done' }, { tags: ['book', 'book/scifi'], links: ['Authors/Herbert.md'] }),
  row('Books/Emma.md', { rating: 3, author: 'Austen', status: 'reading' }, { tags: ['book'] }),
  row('Books/Old/Ulysses.md', { rating: 4, author: 'Joyce', 'due-date': '2026-10-05' }, { tags: ['book'], mtime: day('2025-01-01') }),
  row('Archive/Notes.md', { rating: 1 }, { tags: ['book'] }),
  row('Home.md', {}, { links: ['Books/Dune.md', 'Books/Emma.md'] }),
];
const run = (q, opts = {}) => {
  const p = DV.parse(q);
  const r = B.query(p.base, 0, ROWS, { funcs: { ...DV.FUNCS, outgoing: name => (ROWS.find(x => x.basename === name)?.links || []).map(l => new B.Link(l)) }, ...opts });
  return { p, r, names: r.rows.map(x => x.basename) };
};

t('LIST FROM a tag, nested tags included', () => {
  assert.deepEqual(run('LIST FROM #book').names, ['Dune', 'Emma', 'Notes', 'Ulysses']);
  assert.deepEqual(run('LIST FROM #book/scifi').names, ['Dune']);
});
t('FROM a folder (and its subfolders), and/or, negation', () => {
  assert.deepEqual(run('LIST FROM "Books"').names, ['Dune', 'Emma', 'Ulysses']);
  assert.deepEqual(run('LIST FROM #book AND -"Archive"').names, ['Dune', 'Emma', 'Ulysses']);
  assert.deepEqual(run('LIST FROM "Archive" or "Books/Old"').names, ['Notes', 'Ulysses']);
});
t('FROM [[note]] is what links to it; outgoing([[note]]) what it links to', () => {
  assert.deepEqual(run('LIST FROM [[Herbert]]').names, ['Dune']);
  assert.deepEqual(run('LIST FROM outgoing([[Home]])').names, ['Dune', 'Emma']);
});
t('WHERE with =, and, contains(), dashed fields', () => {
  assert.deepEqual(run('LIST FROM #book WHERE rating >= 4 and status = "done"').names, ['Dune']);
  assert.deepEqual(run('LIST WHERE contains(author, "aus")').names, ['Emma']);
  assert.deepEqual(run('LIST WHERE contains(file.tags, "#book/scifi")').names, ['Dune']);
  assert.deepEqual(run('LIST WHERE due-date').names, ['Ulysses']);
  assert.deepEqual(run('LIST WHERE !status AND rating').names, ['Notes', 'Ulysses']);
});
t('dates: file.mtime against date(today) - dur(…)', () => {
  assert.deepEqual(run('LIST FROM "Books" WHERE file.mtime < date(2026-06-01)').names, ['Ulysses']);
  const since = Math.ceil((Date.now() - day('2025-06-01')) / 864e5);
  assert.deepEqual(run(`LIST FROM "Books" WHERE file.mtime < date(today) - dur(${since} days)`).names, ['Ulysses']);
});
t('TABLE columns with AS, SORT … DESC, LIMIT', () => {
  const { p, r } = run('TABLE rating AS "Stars", author FROM "Books" SORT rating DESC LIMIT 2');
  assert.deepEqual(p.columns.map(c => c.name), ['File', 'Stars', 'author']);
  assert.deepEqual(r.rows.map(x => x.basename), ['Dune', 'Ulysses']);
  assert.equal(B.valueOf('formula.c0', r.rows[1], r.ctx), 4);
});
t('TABLE WITHOUT ID, and a one-line query', () => {
  const { p } = run('TABLE WITHOUT ID file.link AS "Book", rating FROM #book');
  assert.deepEqual(p.columns.map(c => c.id), ['formula.c0', 'formula.c1']);
});
t('LIST with a value shown beside each note', () => {
  const { p, r } = run('LIST author FROM "Books" SORT file.name');
  assert.equal(B.valueOf(p.columns[1].id, r.rows[0], r.ctx), 'Herbert');
});
t('GROUP BY', () => {
  const { r } = run('LIST FROM #book GROUP BY status');
  assert.deepEqual(r.groups.map(g => g.key), ['done', 'reading', '']);
});
t('functions: length, lower, default, choice, dateformat, sum, regexmatch', () => {
  const v = (expr, path = 'Books/Dune.md') => { const r = B.query({ formulas: { x: DV.translate(expr) }, views: [{ type: 'table' }] }, 0, ROWS, { funcs: DV.FUNCS }); return B.valueOf('formula.x', r.rows.find(x => x.path === path), r.ctx); };
  assert.equal(v('length(file.tags)'), 2);
  assert.equal(v('lower(author)'), 'herbert');
  assert.equal(v('default(due-date, "none")'), 'none');
  assert.equal(v('choice(rating > 4, "great", "ok")'), 'great');
  assert.equal(v('dateformat(file.ctime, "yyyy-MM-dd")'), '2026-01-01');
  assert.equal(v('sum([1, 2, 3])'), 6);
  assert.equal(v('regexmatch("H.*t", author)'), true);
  assert.equal(v('file.name + " by " + author'), 'Dune by Herbert');
});
t('what it can’t run says so', () => {
  assert.throws(() => DV.parse('CALENDAR file.ctime'), /CALENDAR/);
  assert.throws(() => DV.parse('LIST FLATTEN x'), /FLATTEN/);
  assert.throws(() => DV.parse('LIST WHERE filter(file.tags, (t) => t = "x")'), /lambdas/);
  assert.throws(() => DV.parse('nonsense'), /starts with LIST/);
});
t('inline fields: lines, list items, [key:: v], (key:: v), "Due Date" also due-date', () => {
  const f = DV.inlineFields('Rating:: 5\n- [ ] task [due:: 2026-10-05]\n**Due Date**:: tomorrow\nsome (mood:: good) text\ntag:: a\ntag:: b\nnot a field: x\n');
  assert.deepEqual(f, { Rating: 5, rating: 5, due: '2026-10-05', 'Due Date': 'tomorrow', 'due-date': 'tomorrow', mood: 'good', tag: ['a', 'b'] });
});

console.log(`ok ${n} tests`);
