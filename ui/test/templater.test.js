// Tests for ui/templater.js (Templater-syntax templates).
// Run with plain Node 18+, no packages needed:  node ui/test/templater.test.js
'use strict';
const assert = require('assert');
const T = require('../templater.js');

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const env = (extra = {}) => ({
  path: 'Projects/Plan.md', title: 'Plan', folder: 'Projects', content: 'body', selection: 'SEL',
  frontmatter: { status: 'draft', tags: ['a', 'b'], count: 3 }, tags: ['a', 'b'], vaultPath: '/vault',
  ctime: new Date(2024, 0, 2, 3, 4).getTime(), mtime: new Date(2024, 5, 6, 7, 8).getTime(),
  ...extra,
});
const r = async (src, e = env()) => (await T.render(src, e)).text;

t('plain text passes through', async () => {
  assert.equal(await r('no tags here\n'), 'no tags here\n');
});

t('expressions and tp.file', async () => {
  assert.equal(await r('# <% tp.file.title %>'), '# Plan');
  assert.equal(await r('<% tp.file.folder() %>|<% tp.file.folder(true) %>'), 'Projects|Projects');
  assert.equal(await r('<% tp.file.path(true) %>|<% tp.file.path() %>'), 'Projects/Plan.md|/vault/Projects/Plan.md');
  assert.equal(await r('<% tp.file.creation_date("YYYY-MM-DD HH:mm") %>'), '2024-01-02 03:04');
  assert.equal(await r('<% tp.file.last_modified_date() %>'), '2024-06-06 07:08');
  assert.equal(await r('<% tp.file.selection() %> <% tp.file.tags.join(",") %>'), 'SEL #a,#b');
  assert.equal(await r('<% tp.frontmatter.status %> <% tp.frontmatter["count"] + 1 %>'), 'draft 4');
  assert.equal(await r('<% tp.frontmatter.missing %>|'), '|');
});

t('dates', async () => {
  const d = new Date(2024, 2, 5, 14, 7, 9); // Tuesday
  assert.equal(T.formatDate(d, 'YYYY-MM-DD HH:mm:ss'), '2024-03-05 14:07:09');
  assert.equal(T.formatDate(d, 'dddd, MMMM Do YYYY [at] h:mm A'), 'Tuesday, March 5th 2024 at 2:07 PM');
  assert.equal(T.formatDate(d, 'ddd MMM D YY [W]W gggg Q'), 'Tue Mar 5 24 W10 2024 1');
  assert.equal(T.formatDate(new Date(2021, 0, 3), 'GGGG-[W]WW'), '2020-W53');
  assert.equal(await r('<% tp.date.now("YYYY-MM-DD", 7, "2024-03-05", "YYYY-MM-DD") %>'), '2024-03-12');
  assert.equal(await r('<% tp.date.now("YYYY-MM-DD", "P1M", "2024-01-31") %>'), '2024-03-02');
  assert.equal(await r('<% tp.date.now("YYYY-MM-DD", "-P1W", "2024-03-05") %>'), '2024-02-27');
  assert.equal(await r('<% tp.date.now("DD/MM/YYYY", 0, "05/03/2024", "DD/MM/YYYY") %>'), '05/03/2024');
  assert.equal(await r('<% tp.date.weekday("YYYY-MM-DD", 0, "2024-03-07") %>'), '2024-03-04'); // Monday of that week
  assert.equal(await r('<% tp.date.weekday("YYYY-MM-DD", 7, "2024-03-07") %>'), '2024-03-11');
  const today = T.formatDate(new Date(), 'YYYY-MM-DD');
  assert.equal(await r('<% tp.date.now() %>'), today);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  assert.equal(await r('<% tp.date.tomorrow() %>'), T.formatDate(tomorrow));
});

t('whitespace control', async () => {
  assert.equal(await r('a\n<%- "x" -%>\nb'), 'axb');
  assert.equal(await r('a  \n\n<%_ "x" _%>  \n\n b'), 'axb');
  assert.equal(await r('a\n<%* let y = 1 -%>\nb'), 'a\nb');
});

t('execution blocks: variables, if/else, loops, tR', async () => {
  const src = '<%* let n = 2; const who = "Ada" %>Hi <% who %>!\n<%* if (n > 1) { %>many<%* } else { %>one<%* } %>\n<%* for (const x of ["a", "b", "c"]) { tR += x.toUpperCase() + ";" } %>';
  assert.equal(await r(src), 'Hi Ada!\nmany\nA;B;C;');
  assert.equal(await r('<%* let s = `t=${tp.file.title}, ${1 + 2}` %><% s %>'), 't=Plan, 3');
  assert.equal(await r('<%* tR = "replaced" %>tail'), 'replacedtail');
  assert.equal(await r('<% tp.frontmatter.status === "draft" ? "D" : "F" %>'), 'D');
  assert.equal(await r('<%* let o = {a: 1, b: [1, 2]} %><% o.b.length %> <% JSON.stringify(o) %>'), '2 {"a":1,"b":[1,2]}');
  assert.equal(await r('<% "a,b".split(",").join(" & ") %> <% (3.14159).toFixed(2) %> <% Math.max(1, 5) %>'), 'a & b 3.14 5');
  assert.equal(await r('<%* if (tp.file.title.startsWith("P")) { %>yes<%* } %>'), 'yes');
  assert.equal(await r('<% tp.frontmatter.nope?.x ?? "fallback" %>'), 'fallback');
});

t('prompt, suggester, clipboard', async () => {
  const e = env({
    prompt: async (text, def) => text === 'Name' ? 'Grace' : def,
    suggest: async (labels, values) => values[labels.indexOf('Two')],
    clipboard: async () => 'CLIP',
  });
  assert.equal(await r('<% await tp.system.prompt("Name") %>/<% tp.system.prompt("Other", "dflt") %>', e), 'Grace/dflt');
  assert.equal(await r('<% await tp.system.suggester(["One", "Two"], ["1", "2"]) %>', e), '2');
  assert.equal(await r('<% await tp.system.clipboard() %>', e), 'CLIP');
  const cancelled = env({ prompt: async () => null });
  assert.equal(await r('[<% tp.system.prompt("x") %>]', cancelled), '[]');
  const res = await T.render('a<%* await tp.system.prompt("x", "", true) %>b', cancelled);
  assert(res.aborted);
});

t('cursor, rename, move, include, create_new', async () => {
  const res = await T.render('# T\n<% tp.file.cursor(2) %>x<% tp.file.cursor(1) %>y');
  assert.equal(res.text, '# T\nxy'); assert.equal(res.cursor, 5);
  const a = await T.render('<%* await tp.file.rename("New name") %><% tp.file.title %><%* await tp.file.move("Archive/New name") %>');
  assert.equal(a.text, 'New name');
  assert.deepEqual(a.actions, [{ type: 'rename', name: 'New name' }, { type: 'move', path: 'Archive/New name' }]);
  const inc = env({ read: async name => name === 'Header' ? 'Title: <% tp.file.title %>' : null });
  assert.equal(await r('<% await tp.file.include("[[Header]]") %>!', inc), 'Title: Plan!');
  await assert.rejects(T.render('<% await tp.file.include("[[Nope]]") %>', inc), /not found/);
  const loop = env({ read: async () => '<% await tp.file.include("[[Self]]") %>' });
  await assert.rejects(T.render('<% await tp.file.include("[[Self]]") %>', loop), /too deeply/);
  const c = await T.render('<%* await tp.file.create_new("hello", "Child", false, "Inbox") %>');
  assert.deepEqual(c.actions, [{ type: 'create', path: 'Inbox/Child.md', content: 'hello', open: false }]);
});

t('the sandbox refuses anything outside the template language', async () => {
  const bad = [
    ['<% "".constructor.constructor("return 1")() %>', /constructor/],
    ['<% tp.__proto__ %>', /__proto__/],
    ['<% app.vault %>', /isn't available/],
    ['<% window.location %>', /isn't available/],
    ['<% fetch("x") %>', /not defined/],
    ['<% tp.web.daily_quote() %>', /network/],
    ['<%* while (true) {} %>', /isn't supported/],
    ['<%* function f() {} %>', /isn't supported/],
    ['<% [1].map(x => x) %>', /arrow functions/],
    ['<% "a".replace("a", tp.date.now) %>', /can't take a function/],
    ['<% tp.date %>x<% tp.date.now.call(null) %>', /not a function/],
    ['<% eval("1") %>', /not defined/],
    ['<% [].concat.constructor %>', /constructor/],
    ['<% tp.file.title', /never closed/],
  ];
  for (const [src, re] of bad) await assert.rejects(T.render(src, env()), re, src);
  // runaway loops stop
  await assert.rejects(T.render('<%* let a = []; for (const x of "abcdefghijklmnopqrstuvwxyz") { for (const y of "abcdefghijklmnopqrstuvwxyz") { for (const z of "abcdefghijklmnopqrstuvwxyz") { for (const w of "abcdefghijklmnopqrstuvwxyz") { tR += "" } } } } %>', env()), /too long/);
});

t('strings containing %> inside tags', async () => {
  assert.equal(await r('<% "50%> done" %>'), '50%> done');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; }
  }
  console.log(`ok ${n} tests`);
})().catch(e => { console.error(e); process.exit(1); });
