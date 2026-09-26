const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const FIX = __dirname + '/fixtures';
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const rd = p => fs.readFileSync(path.join(VAULT, p), 'utf8');
(async () => {
  w('Draft.md', '# Draft\n\nWriting here.\n');
  w('Sources.md', '# Sources\n\n- Book one\n- Paper two\n');
  w('pic.png', fs.readFileSync(FIX + '/red.png'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  await page.evaluate(() => openPath('Draft.md')); await sleep(300);
  await page.click('#tree .t-row[data-path="Sources.md"]', { button: 'right' }); await sleep(150);
  await page.click('.menu >> text=Open to the right'); await sleep(500);
  assert(await page.$eval('#split', s => !s.hidden) && (await page.textContent('.split-title')) === 'Sources', 'Open to the right shows the note beside the main one');
  assert(await page.evaluate(() => S.cur) === 'Draft.md', 'the main pane keeps its note');
  await page.screenshot({ path: OUT + '/split.png' });
  // Edit in the split pane: it saves.
  await page.click('#split .cm-content'); await page.keyboard.press('Control+End'); await page.keyboard.type('\n- Article three'); await sleep(1300);
  assert(rd('Sources.md').includes('- Article three'), 'editing in the split pane saves the note');
  // The same note in both panes stays in step.
  await page.evaluate(() => openPath('Sources.md')); await sleep(300);
  await page.evaluate(() => { setMode('edit'); ed.setSelectionRange(ed.value.length); ed.focus(); }); await page.keyboard.type('\n- Talk four'); await sleep(1300);
  assert((await page.evaluate(() => SPLIT.handle.cm.value)).includes('- Talk four'), 'edits in the main pane show in the split pane');
  await page.click('#split .cm-content'); await page.keyboard.press('Control+End'); await page.keyboard.type('\n- Blog five'); await sleep(1500);
  assert((await page.evaluate(() => ed.value)).includes('- Blog five'), 'and the other way round');
  // Reading view, swap, disk changes.
  await page.evaluate(() => openPath('Draft.md')); await sleep(300);
  await page.click('[data-split=mode]'); await sleep(300);
  assert(await page.$('#split .split-read li'), 'the split pane has a reading view');
  w('Sources.md', '# Sources\n\n- Changed on disk\n'); await sleep(2800);
  assert((await page.textContent('#split .split-read')).includes('Changed on disk'), 'and follows changes on disk');
  await page.click('[data-split=swap]'); await sleep(600);
  assert(await page.evaluate(() => S.cur) === 'Sources.md' && (await page.textContent('.split-title')) === 'Draft', 'Swap trades the two notes');
  // Renames follow; images show; reload keeps it; close.
  await page.evaluate(() => renamePath('Draft.md', 'Draft v2.md')); await sleep(800);
  assert((await page.textContent('.split-title')) === 'Draft v2', 'a renamed note stays in the split pane');
  await page.reload(); await sleep(1200);
  assert(await page.$eval('#split', s => !s.hidden) && (await page.textContent('.split-title')) === 'Draft v2', 'the split pane comes back after a restart');
  await page.evaluate(() => openSplit('pic.png')); await sleep(400);
  assert(await page.$('#split .split-media img'), 'images show in the split pane');
  await page.click('[data-split=close]'); await sleep(300);
  assert(await page.$eval('#split', s => s.hidden), 'close hides it');
  await page.keyboard.press('Control+Alt+\\'); await sleep(200); await page.keyboard.type('Sources'); await page.keyboard.press('Enter'); await sleep(500);
  assert((await page.textContent('.split-title')) === 'Sources' && await page.evaluate(() => $('#split').contains(document.activeElement)), 'Ctrl+Alt+\\ picks a note to open to the right, with the cursor in it');
  assert(errors.length === 0, 'no page errors ' + errors.join('; '));
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
