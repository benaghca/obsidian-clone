// Tests for ui/flashcards.js (cards in the Obsidian Spaced Repetition plugin's format).
// Run with plain Node 18+, no packages needed:  node ui/test/flashcards.test.js
'use strict';
const assert = require('assert');
const F = require('../flashcards.js');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const DAY = '2024-03-06'; // a Wednesday
const parse = (content, meta) => F.parseNote('N.md', content, meta);
const fmMeta = (content, tags) => ({ fmLen: content.indexOf('\n---\n', 3) + 5, fmTags: tags });
const brief = c => [c.kind, c.first, c.last, c.deck];
const faces = c => c.sides.map(s => [s.front, s.back]);
const sched = c => c.sides.map(s => s.due ? `${s.due},${s.interval},${s.ease}` : 'new');

t('dates in the formats the plugin reads', () => {
  assert.equal(F.readDate('2024-03-06'), '2024-03-06');
  assert.equal(F.readDate('06-03-2024'), '2024-03-06');
  assert.equal(F.readDate('Wed Mar 06 2024'), '2024-03-06');
  assert.equal(F.readDate('2024-02-30'), null);
  assert.equal(F.readDate('soon'), null);
  assert.equal(F.addDays('2024-02-28', 2), '2024-03-01');
});

t('scheduling a new side', () => {
  const s = { due: null, interval: 1, ease: 250 };
  assert.deepEqual(F.schedule(s, 'good', DAY), { due: '2024-03-09', interval: 3, ease: 250 });
  assert.deepEqual(F.schedule(s, 'easy', DAY), { due: '2024-03-10', interval: 4, ease: 270 });
  assert.deepEqual(F.schedule(s, 'hard', DAY), { due: '2024-03-07', interval: 1, ease: 230 });
  assert.deepEqual(F.schedule(s, 'again', DAY), { due: '2024-03-06', interval: 0, ease: 230 });
});

t('scheduling a reviewed side, late and early', () => {
  const late = { due: '2024-03-02', interval: 4, ease: 250 }; // four days late
  assert.deepEqual(F.schedule(late, 'good', DAY), { due: '2024-03-21', interval: 15, ease: 250 });
  assert.deepEqual(F.schedule(late, 'easy', DAY), { due: '2024-04-03', interval: 28, ease: 270 });
  assert.deepEqual(F.schedule(late, 'hard', DAY), { due: '2024-03-09', interval: 3, ease: 230 });
  assert.deepEqual(F.schedule({ due: '2024-03-10', interval: 4, ease: 250 }, 'good', DAY), { due: '2024-03-16', interval: 10, ease: 250 });
  assert.deepEqual(F.schedule({ due: DAY, interval: 3, ease: 140 }, 'hard', DAY), { due: '2024-03-08', interval: 2, ease: 130 });
  assert.equal(F.schedule({ due: DAY, interval: 30000, ease: 300 }, 'good', DAY).interval, 36525);
  assert.equal(F.schedule({ due: DAY, interval: 0, ease: 230 }, 'good', DAY).interval, 2); // after Again: from 1 day
  assert.throws(() => F.schedule({ due: null, interval: 1, ease: 250 }, 'meh', DAY));
});

t('load balancing moves long intervals to quieter days', () => {
  const s = { due: DAY, interval: 4, ease: 250 }; // Good: 10 days, 2024-03-16
  assert.equal(F.schedule(s, 'good', DAY, new Map()).interval, 10);
  assert.equal(F.schedule(s, 'good', DAY, new Map([['2024-03-16', 5], ['2024-03-15', 2], ['2024-03-17', 1]])).interval, 11);
  assert.equal(F.schedule(s, 'good', DAY, new Map([['2024-03-16', 5], ['2024-03-17', 1]])).interval, 9);
  assert.equal(F.schedule({ due: DAY, interval: 2, ease: 250 }, 'good', DAY, new Map([['2024-03-11', 9]])).interval, 5); // a week or less: left alone
});

t('interval text', () => {
  assert.deepEqual([0, 1, 25, 45, 400].map(d => F.intervalText(d)), ['today', '1 day', '25 days', '1.5 months', '1.1 years']);
});

t('one-line, reversed and multi-line cards, with their schedules', () => {
  const note = '#flashcards/lang\n\nhola::hello\ngato:::cat\n<!--SR:!2024-03-01,3,250!2024-03-10,5,270-->\n\n¿Cómo estás?\n?\nHow are you?\n<!--SR:!2024-03-05,2,230-->\n\nplain paragraph\n';
  const cards = parse(note);
  assert.deepEqual(cards.map(brief), [['basic', 2, 2, 'flashcards/lang'], ['reversed', 3, 4, 'flashcards/lang'], ['multi', 6, 9, 'flashcards/lang']]);
  assert.deepEqual(faces(cards[0]), [['hola', 'hello']]);
  assert.deepEqual(sched(cards[0]), ['new']);
  assert.deepEqual(faces(cards[1]), [['gato', 'cat'], ['cat', 'gato']]);
  assert.deepEqual(sched(cards[1]), ['2024-03-01,3,250', '2024-03-10,5,270']);
  assert.deepEqual(faces(cards[2]), [['¿Cómo estás?', 'How are you?']]);
  assert.deepEqual(sched(cards[2]), ['2024-03-05,2,230']);
  assert.deepEqual(cards[1].comment, { line: 4, from: 0, to: 44 });
  assert.equal(cards[1].body, 'gato:::cat');
  assert(cards.every(c => c.readable));
});

t('multi-line reversed, and an empty question is no card', () => {
  const cards = parse('#flashcards\n\nFront\nmore\n??\nBack\n\n?\nanswer only\n');
  assert.deepEqual(cards.map(brief), [['multiReversed', 2, 5, 'flashcards']]);
  assert.deepEqual(faces(cards[0]), [['Front\nmore', 'Back'], ['Back', 'Front\nmore']]);
});

t('decks: frontmatter, body tags and a tag starting a card', () => {
  const note = '---\ntags: [flashcards/fm]\n---\nq1::a1\n\n#flashcards/later\n\nq2::a2\n#flashcards/own q3::a3\n';
  const cards = parse(note, fmMeta(note, ['flashcards/fm']));
  assert.deepEqual(cards.map(c => [c.deck, c.sides[0].front]), [['flashcards/fm', 'q1'], ['flashcards/later', 'q2'], ['flashcards/own', 'q3']]);
  assert.deepEqual(parse('q0::a0\n\n#flashcards/x\n').map(c => c.deck), ['flashcards/x']);
  assert.deepEqual(parse('q::a\n#other\n'), []);
  const fmOnly = '---\ntags: flashcards\n---\nq::a\n';
  assert.deepEqual(parse(fmOnly, fmMeta(fmOnly, ['flashcards'])).map(c => c.deck), ['flashcards']);
  const inFm = '---\nnote: "x::y"\ntags: [flashcards]\n---\n';
  assert.deepEqual(parse(inFm, fmMeta(inFm, ['flashcards'])), []);
});

t('separators in inline code, code blocks and HTML comments make no cards', () => {
  const note = '#flashcards\n\nUse `a::b` in code\n\n<!-- x::y -->\n\n<!--\nhidden::card\n-->\n\nWhat does this print?\n```js\nconsole.log(1::2)\n```\n?\n1\n\nreal::card\n';
  const cards = parse(note);
  assert.deepEqual(cards.map(c => [c.kind, c.first, c.last]), [['multi', 10, 15], ['basic', 17, 17]]);
  assert.deepEqual(faces(cards[0]), [['What does this print?\n```js\nconsole.log(1::2)\n```', '1']]);
});

t('block IDs and same-line comments', () => {
  const note = '#flashcards\n\nq::a ^card-1\n\nq2::a2 <!--SR:!2024-03-01,3,250-->\n\nq3::a3 ^b3\n<!--SR:!2024-03-02,4,250-->\n';
  const [c1, c2, c3] = parse(note);
  assert.deepEqual([faces(c1), faces(c2), faces(c3)], [[['q', 'a']], [['q2', 'a2']], [['q3', 'a3']]]);
  assert.deepEqual(c2.comment, { line: 4, from: 7, to: 34 });
  assert.equal(c2.body, 'q2::a2');
  assert.deepEqual([sched(c2), sched(c3)], [['2024-03-01,3,250'], ['2024-03-02,4,250']]);
  assert.equal(c3.body, 'q3::a3 ^b3');
});

t('CRLF notes', () => {
  const cards = parse('#flashcards\r\n\r\nq::a\r\n<!--SR:!2024-03-01,3,250-->\r\n\r\nQ\r\n?\r\nA\r\n');
  assert.deepEqual(cards.map(c => [c.kind, c.first, c.last]), [['basic', 2, 3], ['multi', 5, 7]]);
  assert.deepEqual(faces(cards[0]).concat(faces(cards[1])), [['q', 'a'], ['Q', 'A']]);
  assert.deepEqual(sched(cards[0]), ['2024-03-01,3,250']);
});

t('schedules Cinder can’t read are marked, not guessed', () => {
  const cards = parse('#flashcards\n\nf::s\n<!--SR:!fsrs,2024-03-01,1,2,3,4,5,6,x-->\n\nbad::date\n<!--SR:!someday,1,250-->\n\nco::lout\n> [!sr|card-metadata] \n> <!--SR:!2024-03-01,3,250-->\n\nid::data ^sr-data-id-abc\n\nok::fine\n');
  assert.deepEqual(cards.map(c => [c.body.split('\n')[0], c.readable, c.reason]), [['f::s', false, 'fsrs'], ['bad::date', false, 'unreadable schedule'], ['co::lout', false, 'plugin data'], ['id::data ^sr-data-id-abc', false, 'plugin data'], ['ok::fine', true, '']]);
});

t('a side without a group of its own is new', () => {
  const [c] = parse('#flashcards\n\nx:::y\n<!--SR:!2024-03-01,3,250-->\n');
  assert.deepEqual(sched(c), ['2024-03-01,3,250', 'new']);
  const [d] = parse('#flashcards\n\nx:::y\n<!--SR:!2000-01-01,1,250!2024-03-01,3,250-->\n');
  assert.deepEqual(sched(d), ['new', '2024-03-01,3,250']);
});

t('highlight clozes', () => {
  const [plain] = parse('#flashcards\n\nThe ==sun== is a ==star==.\n');
  assert.equal(plain.kind, 'cloze');
  assert.deepEqual(faces(plain), [['The [...] is a star.', 'The ==sun== is a star.'], ['The sun is a [...].', 'The sun is a ==star==.']]);
  const [hint] = parse('#flashcards\n\nParis is the capital of ==France;;country==.\n');
  assert.deepEqual(faces(hint), [['Paris is the capital of [country].', 'Paris is the capital of ==France==.']]);
  const [num] = parse('#flashcards\n\n==1;;A== and ==2;;B== and ==1;;C== and ==plain==\n');
  assert.deepEqual(faces(num), [['[...] and B and [...] and ==plain==', '==A== and B and ==C== and ==plain=='], ['A and [...] and C and ==plain==', 'A and ==B== and C and ==plain==']]);
  assert.equal(parse('#flashcards\n\n==3;;x==\n')[0].sides.length, 3);
  const [over] = parse('#flashcards\n\nThe ==ash;;sun== rises\n');
  assert.deepEqual([over.readable, over.reason], [false, 'overlapping cloze']);
  const [multi] = parse('#flashcards\n\nFirst ==one==\nsecond ==two==\n<!--SR:!2024-03-01,3,250-->\n');
  assert.deepEqual([multi.first, multi.last, multi.body, multi.sides.length], [2, 4, 'First ==one==\nsecond ==two==', 2]);
  assert.deepEqual(sched(multi), ['2024-03-01,3,250', 'new']);
  assert.deepEqual(parse('#flashcards\n\nA heading\n=====\n'), []);
});

const S3 = { due: '2024-03-09', interval: 3, ease: 250 };
const write = (content, pick, index, s = S3) => F.setSideSchedule(content, pick(parse(content)), index, s);

t('writing: a new comment goes on the line after the card', () => {
  const r = write('#flashcards\n\nq::a\n\nnext::one\n', cs => cs[0], 0);
  assert.equal(r.content, '#flashcards\n\nq::a\n<!--SR:!2024-03-09,3,250-->\n\nnext::one\n');
  assert.deepEqual(sched(r.card), ['2024-03-09,3,250']);
  assert.equal(write('#flashcards\n\nq::a', cs => cs[0], 0).content, '#flashcards\n\nq::a\n<!--SR:!2024-03-09,3,250-->');
  assert.equal(write('#flashcards\n\nq::a ^id1\n', cs => cs[0], 0).content, '#flashcards\n\nq::a ^id1\n<!--SR:!2024-03-09,3,250-->\n');
  assert.equal(write('#flashcards\n\nq:::a\n', cs => cs[0], 1).content, '#flashcards\n\nq:::a\n<!--SR:!2000-01-01,1,250!2024-03-09,3,250-->\n');
  assert.equal(write('#flashcards\n\nQ\n?\n```\ncode\n```\n', cs => cs[0], 0).content, '#flashcards\n\nQ\n?\n```\ncode\n```\n<!--SR:!2024-03-09,3,250-->\n');
});

t('writing: an existing comment is replaced where it is', () => {
  const next = '#flashcards\n\ngato:::cat\n<!--SR:!2024-03-01,3,250!2024-03-10,5,270-->\n';
  assert.equal(write(next, cs => cs[0], 1, { due: '2024-03-20', interval: 10, ease: 270 }).content, '#flashcards\n\ngato:::cat\n<!--SR:!2024-03-01,3,250!2024-03-20,10,270-->\n');
  assert.equal(write('#flashcards\n\nq::a <!--SR:!2024-03-01,3,250--> ^x\n', cs => cs[0], 0).content, '#flashcards\n\nq::a <!--SR:!2024-03-09,3,250--> ^x\n');
  const crlf = '#flashcards\r\n\r\nq::a\r\n\r\nz::y\r\n<!--SR:!2024-03-01,3,250-->\r\n';
  assert.equal(write(crlf, cs => cs[0], 0).content, '#flashcards\r\n\r\nq::a\r\n<!--SR:!2024-03-09,3,250-->\r\n\r\nz::y\r\n<!--SR:!2024-03-01,3,250-->\r\n');
  assert.equal(write(crlf, cs => cs[1], 0).content, '#flashcards\r\n\r\nq::a\r\n\r\nz::y\r\n<!--SR:!2024-03-09,3,250-->\r\n');
});

t('writing finds a card that moved, and refuses one that changed, went or can’t be read', () => {
  const [c] = parse('#flashcards\n\nq::a\n');
  assert.equal(F.setSideSchedule('#flashcards\n\nnew::card\n\nq::a\n', c, 0, S3).content, '#flashcards\n\nnew::card\n\nq::a\n<!--SR:!2024-03-09,3,250-->\n');
  assert.equal(F.setSideSchedule('#flashcards\n\nq::b\n', c, 0, S3), null);
  assert.equal(F.setSideSchedule('#flashcards\n\n', c, 0, S3), null);
  const fsrs = '#flashcards\n\nf::s\n<!--SR:!fsrs,x-->\n';
  assert.equal(F.setSideSchedule(fsrs, parse(fsrs)[0], 0, S3), null);
});

t('writing two sides of one card in a row keeps both', () => {
  const content = '#flashcards\n\ngato:::cat\n';
  const [c] = parse(content);
  const one = F.setSideSchedule(content, c, 0, S3);
  const two = F.setSideSchedule(one.content, c, 1, { due: '2024-03-10', interval: 4, ease: 270 }); // c is from before the first write
  assert.equal(two.content, '#flashcards\n\ngato:::cat\n<!--SR:!2024-03-09,3,250!2024-03-10,4,270-->\n');
});

t('deck tree and review order', () => {
  const a = '---\ntags: [flashcards/Spanish]\n---\nold::er\n<!--SR:!2024-02-01,3,250-->\n\na::b\n<!--SR:!2024-03-01,3,250-->\n\nc:::d\n';
  const cards = [
    ...F.parseNote('A.md', a, fmMeta(a, ['flashcards/Spanish'])),
    ...parse('#flashcards/spanish/verbs\n\ne::f\n<!--SR:!2024-03-20,3,250-->\n'),
    ...parse('#flashcards\n\ng::h\n<!--SR:!fsrs,x-->\n'),
  ];
  const tree = F.deckTree(cards, DAY);
  const counts = d => [d.name, d.due, d.new, d.unreadable];
  assert.deepEqual(counts(tree), ['', 2, 2, 1]);
  const [fc] = tree.children;
  assert.deepEqual(counts(fc), ['flashcards', 2, 2, 1]);
  assert.deepEqual(fc.children.map(counts), [['Spanish', 2, 2, 0]]);
  assert.deepEqual(fc.children[0].children.map(counts), [['verbs', 0, 0, 0]]);
  const q = F.reviewQueue(cards, DAY, () => 0.5);
  assert.deepEqual(q.map(x => x.card.sides[x.side].front), ['old', 'a', 'c', 'd']);
  assert(F.inDeck(cards[3], 'flashcards/spanish') && F.inDeck(cards[3], 'FLASHCARDS') && !F.inDeck(cards[3], 'flashcards/span'));
  assert.deepEqual([...F.dueLoad(cards)], [['2024-02-01', 1], ['2024-03-01', 1], ['2024-03-20', 1]]);
});

console.log(`ok ${n} tests`);
