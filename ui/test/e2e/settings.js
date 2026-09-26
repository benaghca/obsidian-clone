const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  fs.writeFileSync(path.join(VAULT, 'A.md'), '# A\nhello');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  await page.evaluate(() => openPath('A.md')); await sleep(300);

  await page.click('[data-cmd=settings]'); await sleep(250);
  assert(await page.$('.st .st-page.active[data-page=general]'), 'Settings opens on General');
  assert(await page.evaluate(() => document.activeElement.classList.contains('st-q')), 'with the search box focused');
  await page.screenshot({ path: OUT + '/st-general.png' });

  await page.click('.st-page[data-page=editor]'); await sleep(150);
  assert(await page.$eval('.st-head h2', h => h.textContent) === 'Editor', 'clicking a page shows it');
  await page.click('.st-row[data-k=vim] .switch'); await sleep(150);
  assert(await page.evaluate(() => cfg.vim === true && JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.endsWith(':settings')))).vim === true), 'a switch applies and saves at once');
  assert(await page.$eval('.st-row[data-k=vim] .st-reset', b => !b.hidden), 'a changed setting shows a reset button');
  await page.click('.st-row[data-k=vim] .st-reset'); await sleep(150);
  assert(await page.evaluate(() => cfg.vim === false) && await page.$eval('.st-row[data-k=vim] .st-reset', b => b.hidden), 'reset restores the default');

  await page.click('.st-page[data-page=appearance]'); await sleep(150);
  await page.screenshot({ path: OUT + '/st-appearance.png' });
  await page.click('.st-theme[data-id=nord]'); await sleep(150);
  assert(await page.evaluate(() => cfg.palette === 'nord' && document.documentElement.dataset.palette === 'nord'), 'a theme swatch applies the theme');
  await page.selectOption('select[name=theme]', 'light'); await sleep(150);
  assert(await page.evaluate(() => document.documentElement.dataset.theme === 'light'), 'light/dark applies at once');
  await page.fill('input[name=fontText]', 'Georgia'); await sleep(500);
  assert(await page.evaluate(() => cfg.fontText === 'Georgia' && getComputedStyle(document.documentElement).getPropertyValue('--font-text').includes('Georgia')), 'typing a font applies it after a pause');
  await page.screenshot({ path: OUT + '/st-appearance-light.png' });

  await page.fill('.st-q', 'folder'); await sleep(150);
  const found = await page.$$eval('.st-row', r => r.map(x => x.dataset.k));
  assert(found.includes('dailyFolder') && found.includes('attachFolder') && found.includes('inboxFolder') && found.includes('templatesFolder'), 'search finds settings on every page: ' + found.join(','));
  assert(await page.$$eval('.st-group', g => g.length) > 2 && await page.$('.st-row mark'), 'grouped by page, with the matches marked');
  await page.screenshot({ path: OUT + '/st-search.png' });
  await page.fill('.st-q', 'graph view'); await sleep(150);
  assert(await page.$('.st-more'), 'a search that matches commands offers Hotkeys');
  await page.click('.st-more'); await sleep(150);
  assert(await page.$eval('.hk-q', i => i.value) === 'graph view' && await page.$('.hk-row[data-id="graph"]'), 'which opens Hotkeys filtered');
  await page.fill('.st-q', 'zzzqqq'); await sleep(150);
  assert(await page.$('.st-none'), 'no match says so');
  await page.fill('.st-q', ''); await sleep(100);

  await page.fill('.st-q', 'attachments'); await sleep(150);
  await page.fill('input[name=attachFolder]', '/files/'); await page.press('input[name=attachFolder]', 'Tab'); await sleep(150);
  assert(await page.evaluate(() => cfg.attachFolder === 'files'), 'folder settings drop the slashes');

  await page.keyboard.press('Escape'); await sleep(100);
  await page.keyboard.press('Escape'); await sleep(150);
  assert(!(await page.$('.st')), 'Esc clears the search, then closes');

  await page.keyboard.press('Control+p'); await page.keyboard.type('customize hotkeys'); await page.keyboard.press('Enter'); await sleep(250);
  assert(await page.$('.st .st-page[data-page=hotkeys][aria-selected=true]') && await page.$('.hk-row'), 'Customize hotkeys opens Settings on Hotkeys');
  await page.screenshot({ path: OUT + '/st-hotkeys.png' });
  await page.keyboard.press('Escape'); await sleep(150);
  assert(!(await page.$('.st')), 'and Esc closes it');

  await page.setViewportSize({ width: 600, height: 800 }); await page.click('[data-cmd=settings]'); await sleep(200);
  await page.screenshot({ path: OUT + '/st-narrow.png' });
  assert(errors.length === 0, 'no page errors ' + errors.join('; '));
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
