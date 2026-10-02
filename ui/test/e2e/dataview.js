// Dataview queries: ```dataview TABLE / LIST / TASK blocks over frontmatter and inline fields,
// inline `= expr`, and what isn't run (dataviewjs) or can't be read.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const r = p => fs.readFileSync(path.join(VAULT, p), 'utf8');
(async () => {
  w('Books/Dune.md', '---\nrating: 5\nauthor: Herbert\ntags: [book]\n---\nGreat.\n\n- [ ] reread the appendix\n- [x] lend to Sam\n');
  w('Books/Emma.md', '---\ntags: [book]\n---\nrating:: 3\nAuthor:: Austen\nstatus:: reading\n\n- [ ] finish chapter 12\n');
  w('Books/Ulysses.md', '#book\n\n[rating:: 4] and [author:: Joyce]\n');
  w('Recipes/Soup.md', 'rating:: 5\n');
  w('Dashboard.md', [
    'Books:', '', '```dataview', 'TABLE rating AS "Stars", author', 'FROM #book', 'SORT rating DESC', '```', '',
    '```dataview', 'LIST author FROM "Books" WHERE rating >= 4', '```', '',
    '```dataview', 'TASK FROM #book WHERE !completed', '```', '',
    'This note: `= this.file.name`, books: `= length(this.file.outlinks)`.', '',
    '```dataview', 'LIST FROM #book GROUP BY status', '```', '',
    '```dataviewjs', 'dv.list([1, 2])', '```', '',
    '```dataview', 'TABLE x FROM #book FLATTEN y', '```', '',
  ].join('\n'));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  await page.evaluate(() => openPath('Dashboard.md')); await sleep(400);
  await page.evaluate(() => setMode('read')); await sleep(500);

  const blocks = () => page.$$eval('#preview .dataview-block', b => b.map(x => x.innerText.trim().replace(/\s+/g, ' ')));
  let b = await blocks();
  const table = await page.$$eval('#preview .dataview-block:nth-of-type(1) tr', rs => rs.map(r => [...r.children].map(c => c.innerText.trim()).join('|')));
  assert(table[0] === 'File 3|Stars|author', 'a TABLE has a File column with the count, then its columns: ' + table[0]);
  assert(table.slice(1).join(' / ') === 'Dune|5|Herbert / Ulysses|4|Joyce / Emma|3|Austen', 'sorted by rating, from frontmatter and inline fields alike: ' + table.slice(1).join(' / '));
  assert(!b[0].includes('Soup'), 'FROM #book leaves out notes without the tag');
  const list = await page.$$eval('#preview .dataview-block .dv-list', l => l[0].innerText.trim().replace(/\s+/g, ' '));
  assert(list === 'Dune: Herbert Ulysses: Joyce', 'a LIST shows each note with its value, WHERE applied: ' + list);
  const tasks = await page.$$eval('#preview .tasks-embed .tk-row', t => t.map(x => x.innerText.trim().replace(/\s+/g, ' ')));
  assert(tasks.length === 2 && tasks.some(x => x.includes('reread the appendix')) && tasks.some(x => x.includes('finish chapter 12')), 'TASK lists the open tasks in those notes: ' + tasks.join(' | '));
  assert(await page.evaluate(() => [...document.querySelectorAll('#preview .dv-inline')].map(s => s.textContent).join()) === 'Dashboard,0', 'inline `= expr` shows its value');
  const grouped = await page.$$eval('#preview .dv-group', g => g.map(x => x.textContent.trim()));
  assert(grouped.join() === 'reading,—', 'GROUP BY makes a heading for each value: ' + grouped.join());
  assert(await page.$eval('#preview .dv-js', e => /isn’t run/.test(e.textContent)), 'a dataviewjs block says it isn’t run');
  assert(await page.$$eval('#preview .dv-error', e => e.some(x => /FLATTEN isn’t supported/.test(x.textContent))), 'a query it can’t run says why');

  await page.click('#preview .dataview-block a.internal-link:has-text("Ulysses")'); await sleep(400);
  assert(await page.evaluate(() => S.cur) === 'Books/Ulysses.md', 'a result’s link opens the note');
  await page.evaluate(() => openPath('Dashboard.md')); await sleep(400);
  await page.evaluate(() => setMode('read')); await sleep(400);
  await page.click('#preview .tasks-embed .tk-row:has-text("reread") input[type=checkbox], #preview .tasks-embed .tk-row:has-text("reread") .tk-check'); await sleep(900);
  assert(/- \[x\] reread the appendix/.test(r('Books/Dune.md')), 'ticking a task there ticks it in its note');

  await page.evaluate(() => setMode('edit')); await sleep(600);
  const live = await page.$$eval('.cm-content .dataview-block', b => b.map(x => x.classList.contains('tasks-embed') ? 'task' : x.querySelector('table') ? 'table' : x.querySelector('.dv-error') ? 'error' : 'list'));
  assert(live.join() === 'table,list,task,list,error', 'live preview draws the blocks too: ' + live.join());
  assert(await page.$$eval('.cm-content .dv-inline', s => s.map(x => x.textContent).join()) === 'Dashboard,0', 'and inline `= expr` queries');
  assert(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
