// Note composer, as Obsidian's: extract the selection to a new note (a link takes its place), and
// merge a note into another (links to it then lead there).
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const r = p => fs.readFileSync(path.join(VAULT, p), 'utf8');
const has = p => fs.existsSync(path.join(VAULT, p));
(async () => {
  w('Projects/Plan.md', '# Plan\n\nIntro.\n\n## Budget ideas\nSpend less on lunch.\nSave for the trip.\n\nOutro.\n');
  w('Scraps.md', '---\ntags: [scrap]\n---\nA stray thought.\n');
  w('Index.md', 'See [[Scraps]] and [[Scraps#A heading|those]].\n');
  w('Journal.md', '# Journal\n\nToday.\n');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(800);

  console.log('extract the selection');
  await page.evaluate(() => { openPath('Projects/Plan.md'); }); await sleep(400);
  await page.evaluate(() => { setMode('edit'); const v = ed.value, a = v.indexOf('## Budget'), b = v.indexOf('\n\nOutro'); ed.setSelectionRange(a, b); });
  await page.evaluate(() => { CMD_BY_ID.get('extract').run(); }); await sleep(300);
  assert(await page.inputValue('.modal input[name=v]') === 'Budget ideas', 'the new note is named after the selection’s first line');
  await page.keyboard.press('Enter'); await sleep(1200);
  assert(has('Projects/Budget ideas.md') && r('Projects/Budget ideas.md') === '## Budget ideas\nSpend less on lunch.\nSave for the trip.\n', 'the selection becomes a note beside this one');
  assert(r('Projects/Plan.md') === '# Plan\n\nIntro.\n\n[[Budget ideas]]\n\nOutro.\n', 'and a link takes its place: ' + JSON.stringify(r('Projects/Plan.md')));
  assert(await page.evaluate(() => S.files.has('Projects/Budget ideas.md') && !!document.querySelector('#tree [data-path="Projects/Budget ideas.md"]')), 'it shows in the file tree');

  console.log('merge a note into another');
  await page.evaluate(() => openPath('Scraps.md')); await sleep(400);
  await page.evaluate(() => { CMD_BY_ID.get('merge').run(); }); await sleep(300);
  await page.keyboard.type('Journal'); await sleep(200); await page.keyboard.press('Enter'); await sleep(300);
  await page.click('.modal .btn.primary, .modal button:has-text("Merge")'); await sleep(1500);
  assert(r('Journal.md') === '# Journal\n\nToday.\n\nA stray thought.\n', 'its text goes onto the end of the other: ' + JSON.stringify(r('Journal.md')));
  assert(!has('Scraps.md'), 'it goes (to .trash)');
  assert(r('Index.md') === 'See [[Journal]] and [[Journal#A heading|those]].\n', 'links to it now lead to the other: ' + JSON.stringify(r('Index.md')));
  assert(await page.evaluate(() => S.cur) === 'Journal.md', 'which is open');

  assert(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
