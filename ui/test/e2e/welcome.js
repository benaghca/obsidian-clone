const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1500 }, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(1200);
  const w = fs.readFileSync(path.join(VAULT, 'Welcome.md'), 'utf8');
  assert(w.startsWith('---\ntags:\n  - welcome\n---\nCinder is a local notes app') && w.includes('`![](https://example.com)`'), 'a new vault gets the new welcome note (backticks and all)');
  assert(await page.$('#preview .pp-host .pp-row[data-key="tags"]') && await page.$('#preview .katex') && await page.$('#preview table'), 'it shows its properties, math and shortcut table');
  await page.screenshot({ path: SP + '/shots/welcome.png' });
  fs.writeFileSync(path.join(VAULT, 'Welcome.md'), 'Folio is a local notes app. old text\n');
  await page.evaluate(() => loadAll()); await sleep(500);
  await page.evaluate(() => { document.body.dataset.t = '1'; }); 
  await page.keyboard.press('Control+p'); await page.keyboard.type('Open the welcome note'); await page.keyboard.press('Enter'); await sleep(400);
  assert(await page.$eval('.confirm', c => c.textContent.includes('Update the welcome note?')), 'with an old Welcome.md, the command offers to update it');
  await page.click('.confirm [data-c="1"]'); await sleep(800);
  assert(fs.readFileSync(path.join(VAULT, 'Welcome.md'), 'utf8') === w && await page.evaluate(() => S.cur === 'Welcome.md'), 'and replaces it with the latest');
  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
