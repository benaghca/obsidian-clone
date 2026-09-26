const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const rd = p => fs.readFileSync(path.join(VAULT, p), 'utf8');
(async () => {
  w('A.md', '---\nstatus: done\ntags: [x]\n---\nalpha\n');
  w('B.md', '---\nstatus: in progress\nrating: 3\n---\nbeta\n');
  w('C.md', 'gamma\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  // (Cinder asks with its own dialog now: say yes, as the browser dialog handler did)
  await page.addInitScript(() => new MutationObserver(() => document.querySelector('.confirm [data-c="1"]')?.click()).observe(document, { childList: true, subtree: true }));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const results = () => page.$$eval('#search-results .s-file-name', r => r.map(x => x.dataset.path).sort().join(','));

  console.log('panel');
  await page.click('[data-cmd=panel-props]'); await sleep(200);
  assert(await page.$$eval('#props-list .pr-name', r => r.map(x => x.querySelector('.pr-label').textContent + x.querySelector('.n').textContent).join()) === 'rating1,status2,tags1', 'lists every property with how many notes use it');
  await page.focus('#props-filter'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await sleep(150);
  assert(await page.$$eval('#props-list .pr-val', r => r.map(x => x.dataset.v).join()) === 'done,in progress', '→ opens its values');
  await page.click('#props-list .pr-val[data-v="in progress"]'); await sleep(250);
  assert(await page.inputValue('#search-input') === '[status:"in progress"]' && await results() === 'B.md', 'clicking a value searches for it');
  await page.fill('#search-input', '[status]'); await page.dispatchEvent('#search-input', 'input'); await sleep(300);
  assert(await results() === 'A.md,B.md', '[status] finds notes that have it');
  await page.fill('#search-input', '-[status] gamma'); await page.dispatchEvent('#search-input', 'input'); await sleep(300);
  assert(await results() === 'C.md', '-[status] excludes them');
  await page.fill('#search-input', '[tags:x]'); await page.dispatchEvent('#search-input', 'input'); await sleep(300);
  assert(await results() === 'A.md', 'list values match too');

  console.log('changing properties everywhere');
  await page.click('[data-cmd=panel-props]'); await sleep(100);
  await page.click('#props-list .pr-name[data-k="status"]', { button: 'right' }); await sleep(100);
  await page.click('.menu >> text=Rename everywhere…'); await sleep(150);
  await page.fill('#modal-root input', 'state'); await page.keyboard.press('Enter'); await sleep(1200);
  assert(rd('A.md').startsWith('---\nstate: done\n') && rd('B.md').startsWith('---\nstate: in progress\n'), 'Rename everywhere updates every note');
  assert(await page.$('#props-list .pr-name[data-k="state"]') && !(await page.$('#props-list .pr-name[data-k="status"]')), 'and the panel');
  await page.click('#props-list .pr-name[data-k="rating"]', { button: 'right' }); await page.click('.menu >> text=Type: Text'); await sleep(200);
  assert(await page.evaluate(() => S.propTypes.rating === 'text'), 'the type can be set from here');
  await page.click('#props-list .pr-name[data-k="rating"]', { button: 'right' }); await page.click('.menu >> text=Remove from every note…'); await sleep(1000);
  assert(!rd('B.md').includes('rating'), 'Remove from every note');

  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
