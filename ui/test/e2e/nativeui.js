const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => fs.writeFileSync(path.join(VAULT, p), s);
(async () => {
  w('Note.md', 'hello world here\n'); w('Other.md', '---\nstatus: done\nrating: 3\n---\nx\n'); w('Trash me.md', 'bye\n');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  let nativeDialogs = 0;
  page.on('dialog', d => { nativeDialogs++; d.dismiss(); });
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  await page.keyboard.press('Control+o'); await page.keyboard.type('Note'); await page.keyboard.press('Enter'); await sleep(700);
  await page.evaluate(() => { setMode('edit'); ed.focus(); ed.setSelectionRange(6, 11); }); await sleep(150);

  console.log('right-click menu');
  const word = await page.locator('#editor .cm-line').first().boundingBox();
  await page.mouse.click(word.x + 70, word.y + word.height / 2, { button: 'right' }); await sleep(200);
  const items = await page.$$eval('.menu > div', d => d.map(x => x.textContent + (x.classList.contains('disabled') ? '(off)' : '')));
  assert(['Cut', 'Copy', 'Paste', 'Select all', 'Bold'].every(x => items.includes(x)), 'right-click in the editor gives Cinder’s menu: ' + items.join(', '));
  await page.click('.menu >> text=Bold'); await sleep(150);
  assert(await page.evaluate(() => ed.value.startsWith('hello **world**')), 'its formatting items work on the selection');
  await page.evaluate(() => { ed.focus(); ed.setSelectionRange(0, 5); }); await sleep(100);
  await page.mouse.click(word.x + 20, word.y + word.height / 2, { button: 'right' }); await sleep(150);
  await page.click('.menu >> text=Copy'); await sleep(150);
  assert(await page.evaluate(() => navigator.clipboard.readText()) === 'hello', 'Copy copies the selection');
  await page.evaluate(() => { ed.focus(); ed.setSelectionRange(ed.value.length); }); await sleep(50);
  await page.mouse.click(word.x + 200, word.y + word.height / 2, { button: 'right' }); await sleep(150);
  await page.evaluate(() => ed.setSelectionRange(ed.value.length));
  await page.click('.menu >> text=Paste'); await sleep(200);
  assert((await page.evaluate(() => ed.value)).endsWith('hello'), 'Paste pastes');
  await page.mouse.click(700, 600, { button: 'right' }); await sleep(150);
  assert(!(await page.$('.menu')), 'right-clicking empty space shows nothing (and not the browser’s menu)');
  await page.keyboard.press('Escape');

  console.log('suggestions instead of the browser’s dropdown');
  await page.evaluate(() => { ed.focus(); ed.setSelectionRange(ed.value.length); }); await sleep(100);
  await page.keyboard.press('Control+;'); await sleep(300);
  const nameBox = await page.evaluate(() => [document.activeElement.getAttribute('list'), document.activeElement.getAttribute('autocomplete')]);
  assert(nameBox[0] === null && nameBox[1] === 'off', 'no native list or autofill on the field');
  assert(await page.$eval('.suggest-pop', p => !p.hidden && p.textContent.includes('status')), 'Cinder’s own suggestion list appears');
  await page.keyboard.type('rat'); await sleep(150);
  assert(await page.$$eval('.suggest-pop > div', d => d.map(x => x.textContent).join()) === 'rating', 'it filters as you type');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await sleep(300);
  assert((await page.evaluate(() => ed.value)).startsWith('---\nrating:'), '↓ Enter picks it and adds the property');

  console.log('dialogs');
  await page.click('#tree .t-row[data-path="Trash me.md"]', { button: 'right' }); await page.click('.menu >> text=Delete'); await sleep(200);
  assert(await page.$eval('.confirm', c => c.textContent.includes('Delete “Trash me.md”?')), 'deleting asks with Cinder’s dialog');
  await page.keyboard.press('Escape'); await sleep(200);
  assert(fs.existsSync(path.join(VAULT, 'Trash me.md')) && !(await page.$('.confirm')), 'Esc cancels');
  await page.click('#tree .t-row[data-path="Trash me.md"]', { button: 'right' }); await page.click('.menu >> text=Delete'); await sleep(200);
  await page.click('.confirm .btn.danger'); await sleep(600);
  assert(!fs.existsSync(path.join(VAULT, 'Trash me.md')), 'Delete deletes');
  assert(nativeDialogs === 0, 'no browser dialog appeared at any point');

  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
