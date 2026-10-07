// The sticky layout: a thin window becomes a OneNote-style list of the Inbox's stickies; a sticky
// opens to fill it, with its colour, pin, delete and a formatting bar; notes still open full width;
// widening brings everything back.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s, t) => { const f = path.join(VAULT, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); if (t) fs.utimesSync(f, t / 1000, t / 1000); };
const r = p => fs.readFileSync(path.join(VAULT, p), 'utf8');
const has = p => fs.existsSync(path.join(VAULT, p));
(async () => {
  const now = Date.now();
  w('Inbox/Groceries.md', '# Groceries\n\n- [ ] milk\n- [ ] eggs\n', now - 3e5);
  w('Inbox/Call Sam.md', 'Call Sam about the invoice\n', now - 2e5);
  w('Inbox/Garden.md', 'Where the beds go\n', now - 1e5);
  w('Project.md', '# Project\n\nThe big plan.\n');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  await page.evaluate(() => openPath('Project.md')); await sleep(400);
  const shown = sel => page.$$eval(sel, els => els.some(e => e.offsetParent !== null));
  const cards = () => page.$$eval('#view-stickies .sk-card', cs => cs.map(c => c.dataset.path.replace(/^Inbox\//, '').replace(/\.md$/, '')));

  console.log('a thin window');
  await page.setViewportSize({ width: 380, height: 900 }); await sleep(600);
  assert(await page.evaluate(() => document.body.classList.contains('sticky-layout') && S.view === 'stickies'), 'becomes the sticky layout, showing the stickies');
  assert(!(await shown('#ribbon')) && !(await shown('#left')) && !(await shown('#tabbar')), 'with no ribbon, side bars or tabs');
  assert((await cards()).join() === 'Garden,Call Sam,Groceries', 'newest first, as in New: ' + (await cards()).join());
  assert(await page.evaluate(() => !document.activeElement.closest('.sk-card')), 'no sticky looks selected to begin with');
  await page.keyboard.press('ArrowDown'); await sleep(150);
  assert(await page.evaluate(() => document.activeElement.matches('.sk-card') && document.activeElement.textContent.includes('beds')), '↓ goes to the first sticky');
  await page.screenshot({ path: OUT + '/stickies-list.png' });

  console.log('a new sticky');
  await page.click('[data-sk=new]'); await sleep(600);
  assert(await page.$('#view-stickies .sk-page') && await page.evaluate(() => document.activeElement.closest('.sk-page-body') !== null), '+ opens a new sticky to write in');
  await page.keyboard.type('Buy stamps'); await sleep(1200);
  const made = await page.evaluate(() => $('#view-stickies .sk-page').dataset.path);
  assert(r(made) === 'Buy stamps', 'what’s typed is saved to its file: ' + JSON.stringify(r(made)));
  await page.click('[data-sk=fmt][data-cmd=task-list]'); await sleep(900);
  assert(r(made) === '- [ ] Buy stamps', 'the checklist button makes it a task: ' + JSON.stringify(r(made)));
  await page.keyboard.press('Shift+Control+ArrowLeft'); await page.click('[data-sk=fmt][data-cmd=bold]'); await sleep(900);
  assert(r(made) === '- [ ] Buy **stamps**', 'B bolds the selection: ' + JSON.stringify(r(made)));
  await page.click('[data-sk=color][data-color="4"]'); await sleep(700);
  assert(await page.$eval('#view-stickies .sk-page', p => p.classList.contains('c-4')) && /"color":\s*"4"/.test(r('Inbox/Inbox.canvas')), 'a colour from the header washes it, and is kept on the board');
  await page.click('[data-sk=pin]'); await sleep(700);
  await page.screenshot({ path: OUT + '/stickies-page.png' });
  await page.click('[data-sk=back]'); await sleep(500);
  assert((await cards())[0] === made.replace(/^Inbox\//, '').replace(/\.md$/, ''), '← goes back to the list, the pinned sticky first: ' + (await cards()).join());
  assert(await page.$eval('#view-stickies .sk-sec', h => h.textContent.includes('Pinned')), 'under 📌 Pinned');

  console.log('an empty one goes');
  const before = (await cards()).length;
  await page.keyboard.press('Control+n'); await sleep(600);
  const empty = await page.evaluate(() => $('#view-stickies .sk-page').dataset.path);
  await page.keyboard.press('Escape'); await sleep(600);
  assert(!has(empty) && (await cards()).length === before, 'Ctrl+N makes one, and Esc on it still empty throws it away');

  console.log('search, keys, opening');
  await page.fill('.sk-search', 'invoice'); await sleep(400);
  assert((await cards()).join() === 'Call Sam', 'search finds stickies by their text');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await sleep(500);
  assert(await page.evaluate(() => $('#view-stickies .sk-page')?.dataset.path) === 'Inbox/Call Sam.md', '↓ and Enter open the one found');
  await page.click('[data-sk=back]'); await sleep(400);
  await page.fill('.sk-search', ''); await sleep(400);

  console.log('a note, and back');
  await page.evaluate(() => openPath('Project.md')); await sleep(500);
  assert(await page.evaluate(() => S.view === 'note') && await shown('#sk-home') && !(await shown('#left')), 'a note opens full width, with ← Stickies');
  const editW = await page.$eval('#editor .cm-content', e => e.getBoundingClientRect().width);
  assert(editW > 300, 'and room to write in: ' + Math.round(editW) + 'px');
  await page.click('#sk-home'); await sleep(400);
  assert(await page.evaluate(() => S.view === 'stickies'), '← Stickies goes home');

  console.log('widening');
  await page.click('.sk-card:has-text("beds")'); await sleep(400);
  await page.setViewportSize({ width: 1200, height: 900 }); await sleep(800);
  assert(await page.evaluate(() => !document.body.classList.contains('sticky-layout') && S.view === 'note' && S.cur === 'Project.md'), 'brings the full layout back, and what was open before');
  assert(await shown('#ribbon') && await shown('#left'), 'with the ribbon and side bar');
  await page.evaluate(() => { cfg.stickyLayout = false; saveCfg(); });
  await page.setViewportSize({ width: 380, height: 900 }); await sleep(600);
  assert(await page.evaluate(() => !document.body.classList.contains('sticky-layout') && S.view === 'note'), 'with the setting off, a thin window keeps the full layout');
  assert(!(await shown('#left')), 'though the side bar still folds away, leaving the note room');
  await page.evaluate(() => { cfg.stickyLayout = true; saveCfg(); });

  assert(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
