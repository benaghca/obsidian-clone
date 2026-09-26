const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
(async () => {
  const para = n => Array.from({ length: 6 }, (_, i) => `Paragraph ${n} sentence ${i} goes on for a while.`).join(' ');
  w('Essay.md', `# Essay\n\n${para(1)}\n\n${para(2)}\n\n${para(3)}\n\n- [ ] fix intro\n- [ ] add sources\n` + '\nfiller\n'.repeat(60));
  w('Ref.md', 'See [[Essay]] and [[Essay]].');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  await page.evaluate(() => openPath('Essay.md')); await sleep(400);
  const sb = () => page.textContent('#statusbar');
  let t = await sb();
  assert(t.includes('2 backlinks') && t.includes('2 open tasks') && /\d+ words · \d+ min read/.test(t) && t.includes('Live preview'), 'the status bar: ' + t);
  await page.evaluate(() => { setMode('edit'); const i = ed.value.indexOf('Paragraph 2'); ed.setSelectionRange(i, i + 'Paragraph 2 sentence'.length); ed.focus(); }); await sleep(300);
  t = await sb();
  assert(t.includes('3 words selected') && /Ln 5, Col 21/.test(t), 'it shows the selection and where the cursor is: ' + t);
  await page.click('[data-sb=count]'); await sleep(100);
  assert((await sb()).includes('characters'), 'clicking the count switches to characters');
  await page.click('[data-sb=count]');
  await page.click('[data-sb=tasks]'); await sleep(500);
  assert(await page.evaluate(() => S.view === 'tasks' && tasksView.state().list === 'note:Essay.md'), 'the task count opens the note’s task list');
  await page.evaluate(() => openPath('Essay.md')); await sleep(300);
  await page.click('[data-sb=backlinks]'); await sleep(200);
  assert(await page.$('#right .tabs [data-rtab=backlinks].active'), 'the backlink count opens Backlinks');

  // Focus mode.
  await page.evaluate(() => { const i = ed.value.indexOf('Paragraph 2'); ed.setSelectionRange(i); ed.focus(); }); await sleep(200);
  await page.click('[data-sb=focus]'); await sleep(300);
  assert(await page.evaluate(() => document.body.classList.contains('focus-mode') && getComputedStyle($('#left')).display === 'none' && getComputedStyle($('#tabbar')).display === 'none'), 'focus mode hides the side bars and tabs');
  await page.evaluate(() => ed.focus()); await sleep(200);
  const ops = await page.$$eval('#view-note .cm-line', ls => ls.slice(0, 8).map(l => [l.textContent.slice(0, 11), +getComputedStyle(l).opacity]));
  const p2 = ops.find(o => o[0] === 'Paragraph 2'), p1 = ops.find(o => o[0] === 'Paragraph 1');
  assert(p2[1] === 1 && p1[1] < 0.5, 'and dims all but the paragraph being written: ' + JSON.stringify(ops));
  await page.screenshot({ path: OUT + '/focus.png' });
  await page.keyboard.press('Control+Alt+z'); await sleep(200);
  assert(await page.evaluate(() => !document.body.classList.contains('focus-mode')), 'Ctrl+Alt+Z leaves it');

  // Typewriter scrolling.
  await page.evaluate(() => { cfg.typewriter = true; saveCfg(); applyTheme(); });
  await page.evaluate(() => { const i = ed.value.indexOf('filler'); ed.setSelectionRange(i); ed.focus(); });
  for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowDown');
  await sleep(300);
  const pos = await page.evaluate(() => { const r = document.querySelector('.cm-cursor, .cm-cursor-primary')?.getBoundingClientRect(), w = $('#edit-wrap').getBoundingClientRect(); return r ? (r.top - w.top) / w.height : -1; });
  assert(pos > 0.35 && pos < 0.65, 'typewriter scrolling keeps the cursor mid-window: ' + pos.toFixed(2));
  assert(errors.length === 0, 'no page errors ' + errors.join('; '));
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
