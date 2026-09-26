const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  fs.writeFileSync(path.join(VAULT, 'A.md'), '# Plan\n\nThe quick brown fox.\nSecond line.\n');
  fs.writeFileSync(path.join(VAULT, 'B.md'), 'bee');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  await page.evaluate(() => openPath('A.md')); await sleep(300);
  await page.evaluate(() => { setMode('edit'); const i = ed.value.indexOf('quick'); ed.setSelectionRange(i, i + 5); ed.focus(); });
  await page.keyboard.type('slow'); await sleep(1200);
  await sleep(1600);
  await page.evaluate(() => { ed.setSelectionRange(ed.value.length); ed.focus(); });
  await page.keyboard.type('Third line.'); await sleep(1200);

  await page.keyboard.press('Control+p'); await page.keyboard.type('version history'); await page.keyboard.press('Enter'); await sleep(600);
  const vs = await page.$$eval('.hist-v', r => r.length);
  assert(vs === 3, 'three versions: the original and two editing sessions (' + vs + ')');
  assert(await page.$$eval('.df-add', r => r.map(x => x.textContent)).then(t => t.some(x => x.includes('Third line.'))), 'the newest version shows what it added');
  await page.click('.hist-v[data-i="1"]'); await sleep(300);
  assert(await page.$eval('.df-del mark', m => m.textContent) === 'quick' && await page.$eval('.df-add mark', m => m.textContent) === 'slow', 'a changed line marks the changed words');
  await page.screenshot({ path: OUT + '/hist.png' });
  await page.click('.hist-v[data-i="2"]'); await page.click('[data-mode=now]'); await sleep(300);
  const st = await page.textContent('.hist-stat');
  assert(/\+2 −1/.test(st), 'Compared with now counts the lines: ' + st);
  await page.click('[data-mode=text]'); await sleep(200);
  assert((await page.textContent('.hist-text')) === '# Plan\n\nThe quick brown fox.\nSecond line.\n', 'Text shows the version as it was');
  await page.click('[data-restore]'); await sleep(1200);
  assert(await page.evaluate(() => ed.value) === '# Plan\n\nThe quick brown fox.\nSecond line.\n' && fs.readFileSync(path.join(VAULT, 'A.md'), 'utf8').includes('quick'), 'Restore puts the original back and saves it');
  await page.evaluate(() => ed.focus()); await page.keyboard.press('Control+z'); await sleep(1200);
  assert((await page.evaluate(() => ed.value)).includes('Third line.'), 'and Ctrl+Z undoes the restore');

  // Renames keep the history, and it's there for files that aren't open.
  await page.evaluate(() => renamePath('A.md', 'Plans/A2.md')); await sleep(800);
  await page.evaluate(() => openPath('B.md')); await sleep(300);
  if (!(await page.$('#tree .t-row[data-path="Plans/A2.md"]'))) { await page.click('#tree .t-row[data-dir="Plans"]'); await sleep(200); }
  await page.click('#tree .t-row[data-path="Plans/A2.md"]', { button: 'right' }); await sleep(200);
  await page.click('.menu >> text=Version history…'); await sleep(600);
  assert(await page.$$eval('.hist-v', r => r.length) >= 3 && (await page.textContent('.hist-file')) === 'A2', 'the history follows a rename, and opens from the file tree');
  await page.keyboard.press('Escape'); await sleep(150);
  assert(!(await page.$('.hist')), 'Esc closes it');
  await page.evaluate(() => openHistory('B.md')); await sleep(400);
  assert(await page.$('.hist-empty'), 'a file never saved in Cinder has no versions yet');
  assert(errors.length === 0, 'no page errors ' + errors.join('; '));
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
