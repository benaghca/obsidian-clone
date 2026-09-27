const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
(async () => {
  w('Bathroom Refresh and Other Long Titles.md', '---\ntype: project\nstatus: planning\n---\n# Bathroom\n\n- [ ] call Sam\n\n' + 'word '.repeat(300) + '\n');
  w('Other.md', 'Links to [[Bathroom Refresh and Other Long Titles]].\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const open = async q => { await page.keyboard.press('Control+o'); await page.keyboard.type(q); await page.keyboard.press('Enter'); await sleep(900); await page.evaluate(() => setMode('edit')); await sleep(250); };
  const sides = () => page.evaluate(() => [!document.body.classList.contains('app-no-left'), !document.body.classList.contains('app-no-right')].join());
  const width = s => page.$eval(s, e => e.getBoundingClientRect().width);
  const resize = async px => { await page.setViewportSize({ width: px, height: 900 }); await sleep(400); };

  console.log('sidebars fold away in a narrow window');
  await open('Bathroom Refresh');
  assert(await sides() === 'true,true', 'both sidebars open at 1300px');
  await resize(900);
  assert(await sides() === 'true,false', 'at 900px the right one folds first');
  assert(await width('#workspace') >= 400, 'and the note keeps its room');
  await resize(640);
  assert(await sides() === 'false,false', 'at 640px both fold');
  await resize(1300);
  assert(await sides() === 'true,true', 'widening brings both back');
  assert(await page.evaluate(() => JSON.stringify(store('layout'))) === '{"left":true,"right":true}' || await page.evaluate(() => store('layout') == null), 'folding isn\'t saved as the layout');
  await resize(900);
  await page.keyboard.press('Control+Shift+Backslash'); await sleep(300);
  assert(await sides() === 'false,true', 'opening the right one by hand folds the left to make room');
  assert(await width('#workspace') >= 400, 'still leaving the note its room');
  await page.keyboard.press('Control+Shift+Backslash'); await sleep(300);
  assert(await sides() === 'true,false', 'closing it again brings the left one back');
  assert(await page.evaluate(() => store('layout').right === false), 'and the right one closed by hand is saved closed');
  await page.keyboard.press('Control+Shift+Backslash'); await sleep(300);
  await resize(1300);

  console.log('the title wraps');
  const lineH = await page.$eval('#title', t => parseFloat(getComputedStyle(t).lineHeight));
  const titleH = () => page.$eval('#title', t => t.getBoundingClientRect().height - parseFloat(getComputedStyle(t).paddingTop) - parseFloat(getComputedStyle(t).paddingBottom));
  assert(Math.round(await titleH()) === Math.round(lineH), 'one line when there\'s room');
  await page.evaluate(() => document.body.classList.add('app-no-right'));
  await resize(700);
  assert(await titleH() >= lineH * 1.9, 'two or more lines in a narrow pane');
  assert(await page.$eval('#title', t => t.scrollWidth <= t.clientWidth && t.scrollHeight <= t.clientHeight + 1), 'nothing cut off');
  await page.screenshot({ path: OUT + '/narrow-title.png' });
  await page.click('#title'); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await sleep(150);
  assert(await page.evaluate(() => !titleEl.value.includes('\n') && document.activeElement !== titleEl), 'Enter still moves to the note, adding no line break');

  console.log('the status bar drops items instead of overlapping');
  await page.evaluate(() => { ed.focus(); ed.setSelectionRange(0, 0); updateStatus(); });
  await resize(1300);
  for (const px of [700, 540, 440, 360, 280]) {
    await page.$eval('#statusbar', (e, px) => { e.style.width = px + 'px'; }, px); await sleep(100);
    const o = await page.evaluate(() => {
      const l = [...document.querySelectorAll('#status-left > *')].filter(e => e.offsetWidth), r = [...document.querySelectorAll('#status-right > *')].filter(e => e.offsetWidth);
      const lEnd = Math.max(0, ...l.map(e => e.getBoundingClientRect().right)), rStart = Math.min(1e9, ...r.map(e => e.getBoundingClientRect().left));
      const sb = document.querySelector('#statusbar').getBoundingClientRect();
      return { lEnd, rStart, sbRight: sb.right, rEnd: Math.max(...r.map(e => e.getBoundingClientRect().right)), shown: [...l, ...r].map(e => e.innerText.replace(/\s+/g, ' ').trim() || '◎') };
    });
    assert(o.lEnd <= o.rStart && o.rEnd <= o.sbRight, `${px}px: ${o.shown.join(' | ')}`);
  }
  assert(await page.$eval('#statusbar [data-sb=mode]', e => e.offsetWidth > 0), 'the mode switch is always there');
  await page.$eval('#statusbar', e => { e.style.width = ''; });

  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
