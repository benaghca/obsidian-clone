// Kanban plugin boards: a note with kanban-plugin in its frontmatter opens as a board; dragging,
// ticking, adding and editing cards and renaming lists rewrite its Markdown.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const r = p => fs.readFileSync(path.join(VAULT, p), 'utf8');
(async () => {
  fs.writeFileSync(path.join(VAULT, 'Board.md'), '---\n\nkanban-plugin: board\n\n---\n\n## Todo\n\n- [ ] Write the report\n- [ ] Call [[Sam]]\n\n\n## Done\n\n**Complete**\n- [x] Buy seeds\n\n\n\n\n%% kanban:settings\n```\n{"kanban-plugin":"board"}\n```\n%%\n');
  fs.writeFileSync(path.join(VAULT, 'Plain.md'), 'just a note\n');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(800);
  await page.evaluate(() => { openPath('Plain.md'); setMode('edit'); }); await sleep(300);
  await page.evaluate(() => openPath('Board.md')); await sleep(500);
  const lanes = () => page.$$eval('#preview .kb-lane', ls => ls.map(l => l.querySelector('.kb-title').textContent + ': ' + [...l.querySelectorAll('.kb-card')].map(c => (c.querySelector('.kb-check')?.checked ? '☑' : '☐') + c.querySelector('.kb-text').textContent.trim()).join(', ')));
  assert((await lanes()).join(' | ') === 'Todo: ☐Write the report, ☐Call Sam | Done: ☑Buy seeds', 'a board note opens as a board: ' + (await lanes()).join(' | '));
  assert(await page.evaluate(() => S.mode) === 'read', 'in reading view');

  await page.dragAndDrop('#preview .kb-card:has-text("Write the report")', '#preview .kb-lane:has-text("Done") .kb-card:has-text("Buy seeds")', { targetPosition: { x: 20, y: 4 } }); await sleep(1000);
  assert((await lanes()).join(' | ') === 'Todo: ☐Call Sam | Done: ☑Write the report, ☑Buy seeds', 'dragging a card into the Complete list moves and ticks it: ' + (await lanes()).join(' | '));
  assert(/## Done\n\n\*\*Complete\*\*\n- \[x\] Write the report\n- \[x\] Buy seeds/.test(r('Board.md')), 'the note’s Markdown follows');
  assert(/%% kanban:settings\n```\n\{"kanban-plugin":"board"\}\n```\n%%\n$/.test(r('Board.md')), 'and keeps the plugin’s settings');

  await page.click('#preview .kb-lane:has-text("Todo") .kb-check'); await sleep(900);
  assert(/- \[x\] Call \[\[Sam\]\]/.test(r('Board.md')), 'ticking a card ticks its item');
  await page.click('#preview .kb-lane:has-text("Todo") .kb-add');
  await page.keyboard.type('New card'); await page.keyboard.press('Enter'); await sleep(900);
  assert(/- \[x\] Call \[\[Sam\]\]\n- \[ \] New card/.test(r('Board.md')), 'adding a card');
  await page.dblclick('#preview .kb-card:has-text("New card") .kb-text');
  await page.keyboard.press('Control+a'); await page.keyboard.type('Renamed card'); await page.keyboard.press('Enter'); await sleep(900);
  assert(r('Board.md').includes('- [ ] Renamed card') && !r('Board.md').includes('New card'), 'editing a card');
  await page.dblclick('#preview .kb-title:has-text("Todo")');
  await page.keyboard.press('Control+a'); await page.keyboard.type('Next up'); await page.keyboard.press('Enter'); await sleep(900);
  assert(r('Board.md').includes('## Next up\n'), 'renaming a list');
  await page.click('#preview .kb-card:has-text("Renamed card") .kb-del'); await sleep(900);
  assert(!r('Board.md').includes('Renamed card'), 'deleting a card');

  await page.focus('#preview .kb-card:has-text("Call Sam")');
  await page.keyboard.press('Alt+ArrowRight'); await sleep(900);
  assert((await lanes()).join(' | ') === 'Next up:  | Done: ☑Call Sam, ☑Write the report, ☑Buy seeds', 'Alt+→ moves the focused card to the next list: ' + (await lanes()).join(' | '));
  assert(await page.evaluate(() => S.cur) === 'Board.md', 'without going back in history');
  assert(await page.evaluate(() => document.activeElement?.textContent.includes('Call Sam')), 'and the card keeps the focus');
  await page.keyboard.press('Alt+ArrowDown'); await sleep(900);
  assert((await lanes()).join(' | ') === 'Next up:  | Done: ☑Write the report, ☑Call Sam, ☑Buy seeds', 'Alt+↓ moves it down its list: ' + (await lanes()).join(' | '));

  await page.evaluate(() => setMode('edit')); await sleep(300);
  assert(await page.evaluate(() => ed.value.includes('## Next up')), 'Ctrl+E shows its Markdown');
  await page.evaluate(() => setMode('read')); await sleep(200);
  await page.evaluate(() => openPath('Plain.md')); await sleep(300);
  assert(await page.evaluate(() => S.mode) === 'edit', 'and other notes still open as they did, while editing');
  assert(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
