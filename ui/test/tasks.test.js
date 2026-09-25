// Tests for the pure parts of ui/tasks.js (task lines, recurrence, quick add, queries).
// Run with plain Node 18+, no packages needed:  node ui/test/tasks.test.js
'use strict';
const assert = require('assert');
const T = require('../tasks.js');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
// A fixed "now": Wednesday 2024-03-06, 10:00.
const NOW = new Date(2024, 2, 6, 10, 0);

t('parse Tasks-plugin lines', () => {
  const x = T.parseLine('  - [ ] Write report #work/q1 ⏫ 🔁 every week 🛫 2024-03-01 ⏳ 2024-03-04 📅 2024-03-08 ^abc123');
  assert.equal(x.text, 'Write report #work/q1');
  assert.deepEqual([x.priority, x.recur, x.start, x.scheduled, x.due, x.blockRef, x.done], ['high', 'every week', '2024-03-01', '2024-03-04', '2024-03-08', '^abc123', false]);
  assert.deepEqual(x.tags, ['work/q1']);
  const d = T.parseLine('* [x] Done thing ✅ 2024-03-05');
  assert(d.done && d.doneDate === '2024-03-05' && d.text === 'Done thing');
  const dv = T.parseLine('1. [ ] Dataview style [due:: 2024-04-01] [priority:: low] [repeat:: every month]');
  assert.deepEqual([dv.due, dv.priority, dv.recur, dv.text], ['2024-04-01', 'low', 'every month', 'Dataview style']);
  assert.equal(T.parseLine('- [-] dropped').cancelled, true);
  assert.equal(T.parseLine('> - [ ] in a quote').text, 'in a quote');
  assert.equal(T.parseLine('- not a task'), null);
  assert.equal(T.parseLine('- [ ]').text, '');
});

t('tasks in a note skip code blocks and frontmatter, and know their heading', () => {
  const note = '---\ntodo: "- [ ] not me"\n---\n# Plan\n- [ ] one\n```\n- [ ] in code\n```\n## Later\n  - [x] two ✅ 2024-01-01\n';
  const tasks = T.parseNote('Plan.md', note);
  assert.deepEqual(tasks.map(x => [x.text, x.line, x.heading]), [['one', 4, 'Plan'], ['two', 9, 'Later']]);
});

t('editing fields', () => {
  const l = '- [ ] Call Sam 📅 2024-03-06 ^id';
  assert.equal(T.setField(l, 'due', '2024-03-07'), '- [ ] Call Sam 📅 2024-03-07 ^id');
  assert.equal(T.setField(l, 'due', null), '- [ ] Call Sam ^id');
  assert.equal(T.setField('- [ ] Call Sam', 'due', '2024-03-07'), '- [ ] Call Sam 📅 2024-03-07');
  assert.equal(T.setField(l, 'priority', 'high'), '- [ ] Call Sam 📅 2024-03-06 ⏫ ^id');
  assert.equal(T.setField('- [ ] x 🔼 y', 'priority', null), '- [ ] x y');
  assert.equal(T.setField('- [ ] x [due:: 2024-01-01]', 'due', '2024-02-02'), '- [ ] x 📅 2024-02-02');
  assert.equal(T.setStatus('  * [ ] x', 'x'), '  * [x] x');
});

t('toggling adds and removes the done date', () => {
  assert.deepEqual(T.toggle('- [ ] Buy milk 📅 2024-03-06', { date: '2024-03-06' }), ['- [x] Buy milk 📅 2024-03-06 ✅ 2024-03-06']);
  assert.deepEqual(T.toggle('- [x] Buy milk 📅 2024-03-06 ✅ 2024-03-06'), ['- [ ] Buy milk 📅 2024-03-06']);
  assert.deepEqual(T.toggle('- [ ] no date', { date: '2024-03-06', doneDate: false }), ['- [x] no date']);
});

t('recurring tasks create the next occurrence above', () => {
  assert.deepEqual(T.toggle('- [ ] Water plants 🔁 every week 📅 2024-03-06', { date: '2024-03-06' }),
    ['- [ ] Water plants 🔁 every week 📅 2024-03-13', '- [x] Water plants 🔁 every week 📅 2024-03-06 ✅ 2024-03-06']);
  // all dates move together
  assert.deepEqual(T.toggle('- [ ] Report 🔁 every month ⏳ 2024-01-29 📅 2024-01-31', { date: '2024-02-01' })[0], '- [ ] Report 🔁 every month ⏳ 2024-02-27 📅 2024-02-29');
  // "when done" counts from completion
  assert.equal(T.toggle('- [ ] Haircut 🔁 every 4 weeks when done 📅 2024-03-01', { date: '2024-03-06' })[0], '- [ ] Haircut 🔁 every 4 weeks when done 📅 2024-04-03');
  assert.equal(T.nextDate('2024-03-08', T.parseRecur('every weekday')), '2024-03-11'); // Fri -> Mon
  assert.equal(T.nextDate('2024-03-06', T.parseRecur('every mon, thu')), '2024-03-07');
  assert.equal(T.nextDate('2024-01-15', T.parseRecur('every month on the 31st')), '2024-02-29');
  assert.equal(T.nextDate('2024-02-29', T.parseRecur('every year')), '2025-02-28');
  assert.equal(T.nextDate('2024-03-06', T.parseRecur('daily')), '2024-03-07');
  assert.equal(T.parseRecur('whenever'), null);
});

t('natural-language quick add', () => {
  const q = s => T.parseQuick(s, NOW);
  assert.deepEqual(q('Call Sam tomorrow !high #family'), { text: 'Call Sam #family', due: '2024-03-07', scheduled: null, priority: 'high', recur: null });
  assert.equal(q('Pay rent every month').due, '2024-03-06');
  assert.equal(q('Pay rent every month').recur, 'every month');
  assert.equal(q('Standup every weekday').recur, 'every weekday');
  assert.equal(q('Gym every sat').due, '2024-03-09');
  assert.equal(q('Review friday').due, '2024-03-08');
  assert.equal(q('Review next friday').due, '2024-03-15');
  assert.equal(q('Review wednesday').due, '2024-03-13', 'a weekday name never means today');
  assert.equal(q('Plan in 3 days').due, '2024-03-09');
  assert.equal(q('Plan in 2 weeks').due, '2024-03-20');
  assert.equal(q('Taxes due apr 15').due, '2024-04-15');
  assert.equal(q('Party 3rd May 2025').due, '2025-05-03');
  assert.equal(q('Retro jan 5').due, '2025-01-05', 'past month-day means next year');
  assert.equal(q('Ship 2024-06-01 !!!').due, '2024-06-01');
  assert.equal(q('Ship 2024-06-01 !!!').priority, 'high');
  assert.equal(q('Tidy this weekend').due, '2024-03-09');
  assert.equal(q('Invoice end of month').due, '2024-03-31');
  assert.equal(q('Read Mondays book').text, 'Read Mondays book', 'words that merely contain a day stay');
  assert.equal(q('Email the team today').text, 'Email the team');
  assert.equal(T.formatTask(q('Call Sam tomorrow !high every week')), '- [ ] Call Sam ⏫ 🔁 every week 📅 2024-03-07');
  assert.equal(T.formatTask(q('Just a thing')), '- [ ] Just a thing');
});

t('queries (Tasks plugin syntax)', () => {
  const tasks = T.parseNote('Work/Plan.md', '# Q1\n- [ ] A 📅 2024-03-05 ⏫ #work\n- [ ] B 📅 2024-03-06\n- [ ] C 📅 2024-03-10 🔽\n- [ ] D\n- [x] E 📅 2024-03-01 ✅ 2024-03-02\n## Home\n- [ ] F #home 🔁 every day 📅 2024-03-06\n');
  const run = src => T.runQuery(T.parseQuery(src, NOW), tasks).flatMap(g => g.tasks.map(x => x.text.split(' ')[0]));
  assert.deepEqual(run('not done\ndue before today'), ['A']);
  assert.deepEqual(run('not done\ndue on or before today\nsort by priority'), ['A', 'B', 'F']);
  assert.deepEqual(run('no due date'), ['D']);
  assert.deepEqual(run('done'), ['E']);
  assert.deepEqual(run('tag includes #work'), ['A']);
  assert.deepEqual(run('heading includes home'), ['F']);
  assert.deepEqual(run('is recurring'), ['F']);
  assert.deepEqual(run('priority is above none'), ['A']);
  assert.deepEqual(run('priority is low'), ['C']);
  assert.deepEqual(run('path includes plan\nnot done\nsort by due reverse\nlimit 2'), ['C', 'B']);
  const groups = T.runQuery(T.parseQuery('not done\ngroup by heading', NOW), tasks);
  assert.deepEqual(groups.map(g => [g.key, g.tasks.length]), [['Home', 1], ['Q1', 4]]);
  assert.deepEqual(T.parseQuery('frobnicate\nnot done', NOW).errors, ['don\'t understand "frobnicate"']);
  // default order: open first, then by due date
  assert.deepEqual(run(''), ['A', 'B', 'F', 'C', 'D', 'E']);
});

t('Tasks view buckets', () => {
  const tasks = T.parseNote('x.md', '- [ ] late 📅 2024-03-01\n- [ ] now 📅 2024-03-06\n- [ ] sched ⏳ 2024-03-07\n- [ ] sat 📅 2024-03-09\n- [ ] far 📅 2024-04-01\n- [ ] free\n- [x] gone 📅 2024-03-06');
  const b = T.buckets(tasks, NOW);
  assert.deepEqual(b.map(s => [s.title, s.tasks.map(x => x.text)]), [['Overdue', ['late']], ['Today', ['now']], ['Tomorrow', ['sched']], ['Saturday', ['sat']], ['Later', ['far']], ['No date', ['free']]]);
  assert.equal(T.friendly('2024-03-20', NOW), 'Wed, Mar 20');
  assert.equal(T.friendly('2024-03-04', NOW), '2 days ago');
});

console.log(`ok ${n} tests`);
