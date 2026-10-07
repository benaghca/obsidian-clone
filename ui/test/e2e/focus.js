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
  // Scrolling: the light follows the middle of the window, and comes back to the cursor on a key.
  const box = await page.$eval('#edit-wrap', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel(0, 700); await sleep(500);
  const lit = await page.evaluate(() => {
    const w = $('#edit-wrap').getBoundingClientRect(), mid = (w.top + w.bottom) / 2;
    const on = [...document.querySelectorAll('#view-note .cm-line.cm-focus-para')];
    return { texts: on.map(l => l.textContent), near: on.some(l => { const r = l.getBoundingClientRect(); return Math.abs((r.top + r.bottom) / 2 - mid) < 60; }), cursorAt: ed.selectionStart === ed.value.indexOf('Paragraph 2') };
  });
  assert(lit.near && !lit.texts.some(t => t.startsWith('Paragraph 2')) && lit.cursorAt, 'scrolling lights the paragraph in the middle of the window, the cursor staying put: ' + JSON.stringify(lit.texts));
  await page.keyboard.press('ArrowRight'); await sleep(400);
  const back = await page.$$eval('#view-note .cm-line.cm-focus-para', ls => ls.map(l => l.textContent.slice(0, 11)));
  assert(back.length === 1 && back[0] === 'Paragraph 2', 'moving the cursor brings the light back to its paragraph: ' + back.join());
  await page.keyboard.type('x'); await sleep(400);
  const typed = await page.$$eval('#view-note .cm-line.cm-focus-para', ls => ls.map(l => l.textContent));
  assert(typed.length === 1 && typed[0].startsWith('Pxaragraph 2'), 'and typing keeps it there (the editor scrolling to the cursor doesn’t move it): ' + typed.map(t => t.slice(0, 12)).join());
  await page.keyboard.press('Backspace');
  // With Cinder's own window frame (the desktop app's), the window's buttons stay clear of the note's bar.
  await page.evaluate(() => {
    document.body.classList.add('frame-custom');
    const bar = document.createElement('div'); bar.id = 'win-controls';
    bar.innerHTML = '<button data-win="min">_</button><button data-win="max">□</button><button data-win="close" class="close">×</button>';
    document.body.append(bar);
  }); await sleep(200);
  await page.mouse.move(400, 15); await sleep(300);
  const hits = await page.$$eval('#viewbar button', bs => bs.filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return [b.title || b.textContent.trim(), !!hit && b.contains(hit)]; }));
  assert(hits.length > 1 && hits.every(h => h[1]), 'in focus mode, each of the note bar’s buttons is clicked where it shows, not a window button over it: ' + JSON.stringify(hits));
  assert(await page.$eval('#win-controls', e => +getComputedStyle(e).opacity) === 1, 'and the window’s buttons show along with the bar');
  await page.mouse.move(600, 500); await sleep(400);
  assert(await page.$eval('#win-controls', e => +getComputedStyle(e).opacity) === 0, 'and hide with it');
  await page.evaluate(() => { document.body.classList.remove('frame-custom'); $('#win-controls').remove(); });
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
