const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const ex = p => fs.existsSync(path.join(VAULT, p));
(async () => {
  w('Alpha.md', '# Alpha\nlink to [[Beta]]\n');
  w('Beta.md', '# Beta\n');
  w('Gamma.md', '# Gamma\nsee [[Delta]]\n');
  w('Delta.md', '# Delta\n');
  w('Docs/Old.md', '# Old\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  // (Cinder asks with its own dialog now: say yes, as the browser dialog handler did)
  await page.addInitScript(() => new MutationObserver(() => document.querySelector('.confirm [data-c="1"]')?.click()).observe(document, { childList: true, subtree: true }));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const tabs = () => page.$$eval('#tabbar .tab', ts => ts.map(t => (t.classList.contains('active') ? '*' : '') + t.querySelector('.tab-name').textContent));
  const row = p => `#tree .t-row[data-path="${p}"]`;

  console.log('tabs');
  await page.click(row('Alpha.md')); await sleep(500);
  assert(JSON.stringify(await tabs()) === '["*Alpha"]', 'clicking a file opens it in the current tab');
  await page.click(row('Beta.md'), { button: 'middle' }); await sleep(500);
  assert(JSON.stringify(await tabs()) === '["Alpha","*Beta"]', 'middle-click opens a new tab');
  await page.keyboard.press('Control+o'); await page.keyboard.type('Gamma'); await page.keyboard.press('Control+Enter'); await sleep(500);
  assert(JSON.stringify(await tabs()) === '["Alpha","Beta","*Gamma"]', 'Ctrl+Enter in the quick switcher opens a new tab');
  // undo history survives switching tabs
  await page.evaluate(() => { setMode('edit'); ed.setSelectionRange(ed.value.length); ed.focus(); });
  await page.keyboard.type('typed in gamma'); await sleep(100);
  await page.keyboard.press('Alt+1'); await sleep(400);
  assert(await page.evaluate(() => S.cur === 'Alpha.md'), 'Alt+1 goes to the first tab');
  await page.keyboard.press('Alt+9'); await sleep(400);
  assert(await page.evaluate(() => S.cur === 'Gamma.md' && ed.value.includes('typed in gamma')), 'Alt+9 goes to the last tab');
  await page.evaluate(() => ed.focus()); await page.keyboard.press('Control+z'); await sleep(100);
  assert(await page.evaluate(() => !ed.value.includes('typed in gamma')), 'each tab keeps its own undo history');
  await page.keyboard.press('Control+PageUp'); await sleep(400);
  assert(await page.evaluate(() => S.cur === 'Beta.md'), 'Ctrl+PageUp goes to the previous tab');
  await page.click('#tabbar .tab[data-i="2"] .tab-x'); await sleep(400);
  assert(JSON.stringify(await tabs()) === '["Alpha","*Beta"]', '× closes a tab');
  await page.keyboard.press('Control+w'); await sleep(400);
  assert(JSON.stringify(await tabs()) === '["*Alpha"]', 'Ctrl+W closes the current tab');
  await page.evaluate(() => reopenClosedTab()); await sleep(400);
  assert(JSON.stringify(await tabs()) === '["Alpha","*Beta"]', 'a closed tab can be reopened');
  // each tab has its own back/forward
  await page.evaluate(() => activateTab(0)); await sleep(400);
  await page.evaluate(() => followLink('Beta', null, 'Alpha.md')); await sleep(400);
  assert(JSON.stringify(await tabs()) === '["*Beta","Beta"]', 'following a link stays in the tab');
  await page.keyboard.press('Alt+ArrowLeft'); await sleep(400);
  assert(await page.evaluate(() => S.cur === 'Alpha.md'), 'back goes back within the tab');
  // drag to reorder
  const b0 = await page.locator('#tabbar .tab').nth(0).boundingBox(), b1 = await page.locator('#tabbar .tab').nth(1).boundingBox();
  await page.dragAndDrop('#tabbar .tab[data-i="0"]', '#tabbar .tab[data-i="1"]', { targetPosition: { x: b1.width - 5, y: b1.height / 2 } }); await sleep(200);
  assert(JSON.stringify(await tabs()) === '["Beta","*Alpha"]', 'dragging reorders tabs');
  await page.keyboard.press('Control+t'); await sleep(300);
  assert(await page.$('#modal-root .pick-list') && (await tabs()).includes('*New tab'), 'Ctrl+T opens a new tab with the quick switcher');
  await page.keyboard.type('Delta'); await page.keyboard.press('Enter'); await sleep(500);
  assert(JSON.stringify(await tabs()) === '["Beta","Alpha","*Delta"]', 'and picking a file fills it');
  await page.reload(); await sleep(1200);
  assert(JSON.stringify(await tabs()) === '["Beta","Alpha","*Delta"]' && await page.evaluate(() => S.cur === 'Delta.md'), 'tabs come back after a reload');

  console.log('multi-select in the file tree');
  await page.click(row('Alpha.md')); await sleep(300);
  await page.click(row('Gamma.md'), { modifiers: ['Control'] }); await sleep(100);
  assert(await page.$$eval('#tree .t-row.sel', r => r.length) === 2, 'Ctrl+click adds to the selection (with the open file)');
  await page.click(row('Delta.md'), { modifiers: ['Shift'] }); await sleep(100);
  assert(await page.$$eval('#tree .t-row.sel', r => r.map(x => x.dataset.path).join(',')) === 'Delta.md,Gamma.md', 'Shift+click selects a range');
  await page.click(row('Alpha.md'), { modifiers: ['Control'] }); await sleep(100);
  await page.click(row('Gamma.md'), { button: 'right' }); await sleep(150);
  assert(await page.$('.menu >> text=Move 3 items to…'), 'the menu acts on all of them');
  await page.click('.menu >> text=New folder with 3 items…'); await sleep(200);
  await page.fill('#modal-root input', 'Grouped'); await page.keyboard.press('Enter'); await sleep(1500);
  assert(['Grouped/Alpha.md', 'Grouped/Gamma.md', 'Grouped/Delta.md'].every(ex) && !ex('Alpha.md'), 'New folder with… groups them');
  assert(fs.readFileSync(path.join(VAULT, 'Grouped/Gamma.md'), 'utf8').includes('[[Delta]]'), 'links still resolve');
  assert(await page.evaluate(() => S.tabs.map(t => t.key).join()) === 'Beta.md,Grouped/Alpha.md,Grouped/Alpha.md', 'tabs follow the files they show');
  // keyboard selection and drag
  await page.click(row('Beta.md')); await sleep(300);
  await page.keyboard.press('Control+Shift+E'); await sleep(100);
  await page.keyboard.press('Shift+ArrowUp'); await sleep(100);
  const picked = await page.$$eval('#tree .t-row.sel', r => r.map(x => x.dataset.path || x.dataset.dir));
  assert(picked.length === 2 && picked.includes('Beta.md'), 'Shift+↑ extends the selection: ' + picked);
  await page.keyboard.press('Escape'); await sleep(50);
  assert(await page.$$eval('#tree .t-row.sel', r => r.length) === 0, 'Esc clears it');
  await page.click(row('Beta.md')); await page.click('#tree .t-row[data-dir="Docs"]', { modifiers: ['Control'] }); await sleep(100);
  await page.dragAndDrop(row('Beta.md'), '#tree .t-row[data-dir="Grouped"]'); await sleep(1500);
  assert(ex('Grouped/Beta.md') && ex('Grouped/Docs/Old.md'), 'dragging a selection moves all of it (folders too)');
  await page.click('#tree .t-row[data-dir="Grouped"]'); await sleep(200);
  if (!(await page.$(row('Grouped/Beta.md')))) { await page.click('#tree .t-row[data-dir="Grouped"]'); await sleep(200); }
  await page.click(row('Grouped/Beta.md')); await page.click(row('Grouped/Alpha.md'), { modifiers: ['Control'] }); await sleep(100);
  await page.click(row('Grouped/Alpha.md'), { button: 'right' }); await page.click('.menu >> text=Delete 2 items'); await sleep(1200);
  assert(!ex('Grouped/Beta.md') && !ex('Grouped/Alpha.md') && ex('Grouped/Gamma.md'), 'Delete N items (after one confirmation)');
  assert(await page.evaluate(() => S.tabs.every(t => t.key === null || S.files.has(t.key))), 'tabs of deleted files close');

  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
