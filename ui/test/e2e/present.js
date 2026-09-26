const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => fs.writeFileSync(path.join(VAULT, p), s);
const grp = (id, label, x, y) => [{ id, type: 'group', label, x, y, width: 600, height: 400 }, { id: id + 't', type: 'text', text: `# ${label}\nSlide text`, x: x + 40, y: y + 40, width: 400, height: 160 }];
(async () => {
  w('Deck.canvas', JSON.stringify({ nodes: [...grp('A', 'Intro', 0, 0), ...grp('B', 'Middle', 800, 0), ...grp('C', 'End', 0, 700)], edges: [] }));
  w('Flow.canvas', JSON.stringify({ nodes: [...grp('A', 'Intro', 0, 0), ...grp('B', 'Middle', 800, 0), ...grp('C', 'End', 0, 700)], edges: [{ id: 'e1', fromNode: 'A', toNode: 'C' }, { id: 'e2', fromNode: 'C', toNode: 'B' }] }));
  w('Cards.canvas', JSON.stringify({ nodes: [{ id: 'x', type: 'text', text: 'one', x: 0, y: 0, width: 200, height: 100 }, { id: 'y', type: 'text', text: 'two', x: 300, y: 10, width: 200, height: 100 }], edges: [] }));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const open = async q => { await page.keyboard.press('Control+o'); await page.keyboard.type(q); await page.keyboard.press('Enter'); await sleep(900); };
  const cur = () => page.evaluate(() => CinderCanvas.presenting()?.id ?? null);

  await open('Deck');
  assert(JSON.stringify(await page.evaluate(() => CinderCanvas.slides())) === '["A","B","C"]', 'without arrows, groups go in reading order');
  await page.keyboard.press('F5'); await sleep(800);
  assert(await page.evaluate(() => document.body.classList.contains('presenting')) && await cur() === 'A', 'F5 presents from the first slide');
  assert(await page.$eval('#tabbar', t => getComputedStyle(t).display === 'none') && await page.$eval('.cv-toolbar', t => getComputedStyle(t).display === 'none'), 'the app and canvas UI are hidden');
  const r = await page.$eval('.cv-node[data-id="A"]', el => el.getBoundingClientRect().toJSON());
  assert(r.width > 1000 || r.height > 680, `the slide fills the screen (${Math.round(r.width)}×${Math.round(r.height)})`);
  await page.keyboard.press('ArrowRight'); await sleep(700);
  assert(await cur() === 'B', '→ goes to the next slide');
  await page.mouse.click(300, 300); await sleep(700);
  assert(await cur() === 'C', 'a click does too');
  await page.keyboard.press('Space'); await sleep(300);
  assert(await cur() === 'C', 'and it stops at the last one');
  await page.keyboard.press('Home'); await sleep(300);
  assert(await cur() === 'A', 'Home goes back to the start');
  await page.mouse.move(600, 400); await page.mouse.move(700, 450); await sleep(100);
  assert(await page.$eval('.cv-pres', el => el.classList.contains('on') && el.querySelector('.cv-pres-count').textContent === '1 / 3'), 'moving the mouse shows the slide counter');
  await page.keyboard.press('Escape'); await sleep(500);
  assert(!(await page.evaluate(() => document.body.classList.contains('presenting'))) && await cur() === null && await page.$eval('.cv-toolbar', t => getComputedStyle(t).display !== 'none'), 'Esc ends it, and everything comes back');
  await page.click('.cv-node[data-id="B"] .cv-label'); await sleep(100);
  await page.keyboard.press('F5'); await sleep(700);
  assert(await cur() === 'B', 'with a group selected, it starts there');
  await page.keyboard.press('Escape'); await sleep(300);

  await open('Flow');
  assert(JSON.stringify(await page.evaluate(() => CinderCanvas.slides())) === '["A","C","B"]', 'arrows between groups set the order');
  await page.click('.cv-toolbar [data-act=present]'); await sleep(700);
  assert(await cur() === 'A', 'the ▶ button presents');
  await page.keyboard.press('Escape'); await sleep(300);

  await open('Cards');
  assert(JSON.stringify(await page.evaluate(() => CinderCanvas.slides())) === '["x","y"]', 'with no groups, each card is a slide');

  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
