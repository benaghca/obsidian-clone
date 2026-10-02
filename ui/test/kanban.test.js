// Tests for the pure parts of ui/kanban.js (reading and writing Kanban plugin boards).
// Run with plain Node 18+, no packages needed:  node ui/test/kanban.test.js
'use strict';
const assert = require('assert');
const K = require('../kanban.js');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

// As the Kanban plugin writes a board.
const BOARD = `---

kanban-plugin: board

---

## Todo

- [ ] Write the report
- [ ] Call Sam
\tabout the [[Budget]]


## Doing

- [ ] Garden #home


## Done

**Complete**
- [x] Buy seeds




%% kanban:settings
\`\`\`
{"kanban-plugin":"board","list-collapse":[false,false,false]}
\`\`\`
%%`;

t('reads lists, cards (with their indented lines) and the Complete list', () => {
  const b = K.parse(BOARD);
  assert.deepEqual(b.lanes.map(l => l.title), ['Todo', 'Doing', 'Done']);
  assert.deepEqual(b.lanes[0].cards, [{ status: ' ', text: 'Write the report' }, { status: ' ', text: 'Call Sam\nabout the [[Budget]]' }]);
  assert.equal(b.lanes[2].complete, true);
  assert.equal(b.lanes[2].cards[0].status, 'x');
  assert.match(b.head, /^---\n\nkanban-plugin: board\n\n---\s*$/);
  assert.match(b.tail, /^%% kanban:settings/);
});
t('writes it back as it was', () => {
  assert.equal(K.serialize(K.parse(BOARD)), BOARD + '\n');
});
t('moving a card into the Complete list ticks it; out of it unticks it', () => {
  const b = K.parse(BOARD);
  K.moveCard(b, [0, 0], 2, 0);
  assert.deepEqual(b.lanes[2].cards.map(c => c.status + c.text), ['xWrite the report', 'xBuy seeds']);
  K.moveCard(b, [2, 1], 1, 1);
  assert.deepEqual(b.lanes[1].cards.map(c => c.status + c.text), [' Garden #home', ' Buy seeds']);
});
t('moving within a list counts positions as they were', () => {
  const b = K.parse('---\nkanban-plugin: basic\n---\n## A\n- [ ] 1\n- [ ] 2\n- [ ] 3\n');
  K.moveCard(b, [0, 0], 0, 2);
  assert.deepEqual(b.lanes[0].cards.map(c => c.text), ['2', '1', '3']);
  K.moveCard(b, [0, 2], 0, 0);
  assert.deepEqual(b.lanes[0].cards.map(c => c.text), ['3', '2', '1']);
});
t('keeps what it doesn’t use: other lines in a list, and the archive', () => {
  const src = '---\nkanban-plugin: basic\n---\n\n## A\n\n- [ ] one\n\nA note under the list.\n\n\n***\n\n## Archive\n\n- [x] old\n';
  const b = K.parse(src);
  assert.deepEqual(b.lanes.map(l => l.title), ['A']);
  assert.deepEqual(b.lanes[0].extra, ['A note under the list.']);
  const out = K.serialize(b);
  assert.match(out, /A note under the list\./);
  assert.match(out, /\*\*\*\n\n## Archive\n\n- \[x\] old\n$/);
});
t('isBoard: notes with kanban-plugin in their frontmatter', () => {
  assert.equal(K.isBoard({ 'kanban-plugin': 'board' }), true);
  assert.equal(K.isBoard({ tags: ['x'] }), false);
  assert.equal(K.isBoard(null), false);
});

console.log(`ok ${n} tests`);
