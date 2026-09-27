// Tests for ui/inboxboard.js (the Inbox's sticky board, kept as Inbox/Inbox.canvas).
// Run with plain Node 18+, no packages needed:  node ui/test/inboxboard.test.js
'use strict';
const assert = require('assert');
const B = require('../inboxboard.js');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const META = {
  'Inbox/a.md': { mtime: 5, kind: 'text', length: 40 },
  'Inbox/b.md': { mtime: 4, kind: 'text', length: 800 },
  'Inbox/c.png': { mtime: 3, kind: 'picture', length: 0 },
  'Inbox/d.pdf': { mtime: 2, kind: 'file', length: 0 },
  'Inbox/e.md': { mtime: 1, kind: 'text', length: 10 },
};
const FILES = Object.keys(META), meta = p => META[p];
const ids = () => { let i = 0; return () => 'id' + ++i; };
const shape = b => b.lanes.map(l => [l.kind, l.name, l.stickies.map(s => s.path.slice(6) + (s.color ? ':' + s.color : ''))]);
const read = (text, files = FILES) => B.readBoard(text, files, meta, 'Inbox');

t('no board file yet: everything is in New, newest first', () => {
  const b = read(null);
  assert.equal(b.broken, false);
  assert.deepEqual(shape(b), [['pinned', 'Pinned', []], ['new', 'New', ['a.md', 'b.md', 'c.png', 'd.pdf', 'e.md']]]);
  assert.deepEqual(read('').lanes.map(l => l.id), ['pinned', 'new']);
});

t('writing lays lanes out as tidy columns, and reads back the same', () => {
  const text = B.writeBoard(read(null), meta, ids());
  const d = JSON.parse(text);
  const groups = d.nodes.filter(x => x.type === 'group'), cards = d.nodes.filter(x => x.type === 'file');
  assert.deepEqual(groups.map(g => [g.id, g.label, g.x, g.y, g.width, g.height]), [['pinned', '📌 Pinned', 0, 0, 300, 200], ['new', 'New', 340, 0, 300, 840]]);
  assert.deepEqual(cards.map(c => [c.file.slice(6), c.x, c.y, c.width, c.height]), [['a.md', 360, 40, 260, 90], ['b.md', 360, 150, 260, 220], ['c.png', 360, 390, 260, 220], ['d.pdf', 360, 630, 260, 80], ['e.md', 360, 730, 260, 90]]);
  assert(d.nodes.indexOf(groups[1]) < d.nodes.indexOf(cards[0]), 'groups come before cards, so cards draw on top');
  assert(text.includes('\n\t"nodes"'), 'tab-indented, as Obsidian writes it');
  const back = read(text);
  assert.deepEqual(shape(back), shape(read(null)));
  assert.deepEqual(back.lanes[1].stickies.map(s => s.id), ['id1', 'id2', 'id3', 'id4', 'id5']);
});

t('a board arranged by hand, the way Obsidian might leave it', () => {
  const g = (id, label, x, y, width, height) => ({ id, type: 'group', label, x, y, width, height });
  const f = (id, file, x, y, extra = {}) => ({ id, type: 'file', file: 'Inbox/' + file, x, y, width: 260, height: 90, ...extra });
  const text = JSON.stringify({
    nodes: [
      g('g3', 'Ideas', 1200, 0, 300, 500), g('g2', 'NEW', 340, 0, 300, 500), g('g1', '📌 pinned', 0, 0, 300, 500),
      g('g4', 'Big', 700, 0, 400, 600), g('g5', 'Small', 750, 100, 200, 200),
      f('n1', 'a.md', 1300, 50),                 // overhangs Ideas' right edge; its centre is inside
      f('n2', 'b.md', 20, 300), f('n3', 'e.md', 20, 40, { color: '4' }),
      { id: 'n4', type: 'file', file: 'Inbox/c.png', x: 760, y: 120, width: 100, height: 100 }, // in Small, which is inside Big
      f('n5', 'a.md', 360, 40),                  // a second card for a.md, in an earlier lane: it wins
      f('n6', 'gone.md', 360, 200),              // its file has gone
      f('n8', 'd.pdf', -500, 0),                 // in no lane
      { id: 'n7', type: 'text', text: 'my own note', x: 2000, y: 0, width: 200, height: 60 },
      { id: 'n9', type: 'file', file: 'Projects/plan.md', x: 2000, y: 200, width: 200, height: 60 },
    ],
    edges: [{ id: 'e1', fromNode: 'n7', toNode: 'n2' }, { id: 'e2', fromNode: 'n7', toNode: 'n6' }],
  });
  const b = read(text);
  assert.deepEqual(shape(b), [['pinned', 'Pinned', ['e.md:4', 'b.md']], ['new', 'New', ['d.pdf', 'a.md']], ['lane', 'Big', []], ['lane', 'Small', ['c.png']], ['lane', 'Ideas', []]]);
  assert.deepEqual(b.lanes.map(l => l.id), ['g1', 'g2', 'g4', 'g5', 'g3']);
  assert.deepEqual(b.extra.nodes.map(x => x.id), ['n7', 'n9'], 'cards and notes of your own are kept; cards for gone inbox files aren’t');
  const out = JSON.parse(B.writeBoard(b, meta, ids()));
  assert(out.nodes.some(x => x.id === 'n7') && out.nodes.some(x => x.id === 'n9'), 'extra nodes survive a rewrite');
  assert.deepEqual(out.edges.map(e => e.id), ['e1'], 'edges survive when both ends do');
  assert(!out.nodes.some(x => x.id === 'n6' || x.id === 'n1'), 'the gone file and the duplicate card are dropped');
  assert.deepEqual(out.nodes.filter(x => x.id === 'n3').map(x => x.color), ['4'], 'colours are kept');
});

t('a board file that isn’t JSON shows everything in New', () => {
  const b = read('{ this is not json');
  assert.equal(b.broken, true);
  assert.deepEqual(shape(b), shape(read(null)));
});

t('changes', () => {
  const nid = ids();
  let b = read(null);
  const orig = JSON.stringify(b);
  b = B.applyChange(b, { move: 'Inbox/c.png', to: 'new', index: 0 });
  assert.deepEqual(shape(b)[1][2], ['c.png', 'a.md', 'b.md', 'd.pdf', 'e.md']);
  assert.equal(JSON.stringify(read(null)), orig, 'the board passed in is left alone');
  b = B.applyChange(b, { addLane: '  Ideas ' }, nid);
  assert.deepEqual(b.lanes[2], { id: 'id1', name: 'Ideas', kind: 'lane', stickies: [] });
  b = B.applyChange(b, { move: 'Inbox/b.md', to: 'id1', index: 9 });
  b = B.applyChange(b, { move: 'Inbox/e.md', to: 'id1', index: 0 });
  assert.deepEqual(shape(b)[2][2], ['e.md', 'b.md'], 'an index past the end means the end');
  b = B.applyChange(b, { pin: 'Inbox/b.md' });
  b = B.applyChange(b, { pin: 'Inbox/a.md' });
  assert.deepEqual(shape(b)[0][2], ['a.md', 'b.md'], 'pinning puts it at the top of Pinned');
  b = B.applyChange(b, { unpin: 'Inbox/b.md' });
  assert.deepEqual([shape(b)[0][2], shape(b)[1][2][0]], [['a.md'], 'b.md'], 'unpinning puts it at the top of New');
  b = B.applyChange(b, { color: 'Inbox/a.md', value: '1' });
  assert.equal(B.laneOf(b, 'Inbox/a.md').stickies[0].color, '1');
  b = B.applyChange(b, { color: 'Inbox/a.md', value: null });
  assert.equal(B.laneOf(b, 'Inbox/a.md').stickies[0].color, null);
  b = B.applyChange(b, { renameLane: 'id1', name: 'Thoughts' });
  b = B.applyChange(b, { addLane: 'Errands' }, nid);
  b = B.applyChange(b, { moveLane: 'id2', by: -1 });
  assert.deepEqual(b.lanes.map(l => l.name), ['Pinned', 'New', 'Errands', 'Thoughts']);
  assert.strictEqual(B.applyChange(b, { moveLane: 'id2', by: -1 }), b, 'user lanes stay after New');
  assert.strictEqual(B.applyChange(b, { renameLane: 'pinned', name: 'x' }), b, 'Pinned and New keep their names');
  assert.strictEqual(B.applyChange(b, { deleteLane: 'new' }), b, 'and can’t be deleted');
  assert.strictEqual(B.applyChange(b, { move: 'Inbox/nope.md', to: 'new' }), b, 'an unknown sticky changes nothing');
  b = B.applyChange(b, { deleteLane: 'id1' });
  assert.deepEqual(shape(b).map(l => l[1]), ['Pinned', 'New', 'Errands']);
  assert.deepEqual(shape(b)[1][2].slice(0, 1), ['e.md'], 'a deleted lane’s stickies go to the top of New');
  assert.throws(() => B.applyChange(b, { explode: true }));
});

t('ids and colours survive writing, and new stickies get ids', () => {
  let b = read(B.writeBoard(read(null), meta, ids()));
  b = B.applyChange(b, { color: 'Inbox/e.md', value: '#ff00aa' });
  const again = read(B.writeBoard(b, meta, ids()), [...FILES, 'Inbox/f.md']);
  assert.deepEqual(again.lanes[1].stickies.map(s => [s.path.slice(6), s.id, s.color]), [['f.md', null, null], ['a.md', 'id1', null], ['b.md', 'id2', null], ['c.png', 'id3', null], ['d.pdf', 'id4', null], ['e.md', 'id5', '#ff00aa']]);
});

console.log(`ok ${n} tests`);
