const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => fs.writeFileSync(path.join(VAULT, p), s);
(async () => {
  w('Hub.md', '# Hub\n[[Alpha]] [[Beta]]\n'); w('Alpha.md', '# Alpha\n'); w('Beta.md', '# Beta\n[[Gamma]]\n'); w('Gamma.md', '# Gamma\n'); w('Fan.md', '# Fan\n[[Hub]]\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  await page.keyboard.press('Control+g'); await sleep(1500);
  const box = await page.locator('#graph-canvas').boundingBox();
  // A node's position once the layout has stopped moving, brought to the middle first so it isn't
  // under the controls or the card (the selection is put back as it was).
  const at = async id => {
    await page.evaluate(i => { const was = CinderGraph.selected(); CinderGraph.select(i, { center: true }); CinderGraph.select(was); }, id);
    let prev = null;
    for (let i = 0; i < 60; i++) {
      const p = await page.evaluate(i => CinderGraph.screenPos(i), id);
      if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 0.5) return [box.x + p[0], box.y + p[1]];
      prev = p; await sleep(80);
    }
    return [box.x + prev[0], box.y + prev[1]];
  };
  const [hx, hy] = await at('Hub.md');
  await page.mouse.click(hx, hy); await sleep(200);
  assert(await page.evaluate(() => CinderGraph.selected()) === 'Hub.md' && await page.evaluate(() => S.view === 'graph'), 'a click selects the node (and stays on the graph)');
  assert(await page.$eval('#graph-info', b => !b.hidden && b.querySelector('b').textContent === 'Hub'), 'its card appears');
  assert(await page.$$eval('#graph-info .gi-lists h4', h => h.map(x => x.textContent.replace(/\s+/g, ' ').trim()).join('|')) === 'Links to 2|Linked from 1', 'listing what it links to and what links to it');
  await page.click('#graph-info .gi-item[data-id="Beta.md"]'); await sleep(200);
  assert(await page.evaluate(() => CinderGraph.selected()) === 'Beta.md' && await page.$eval('#graph-info b', b => b.textContent === 'Beta'), 'clicking a connection moves the selection there');
  const [bx, by] = await at('Beta.md');
  await page.mouse.click(bx, by); await sleep(200);
  assert(await page.evaluate(() => CinderGraph.selected()) === null && await page.$eval('#graph-info', b => b.hidden), 'clicking the selected node again clears it');
  let [hx2, hy2] = await at('Hub.md');
  await page.mouse.click(hx2, hy2); await sleep(100);
  assert(await page.evaluate(() => CinderGraph.selected()) === 'Hub.md', 'select again');
  await page.mouse.click(box.x + 30, box.y + box.height - 30); await sleep(200);
  assert(await page.evaluate(() => CinderGraph.selected()) === null, 'so does a click on empty space');
  [hx2, hy2] = await at('Hub.md');
  await page.mouse.click(hx2, hy2); await sleep(100); await page.keyboard.press('Escape'); await sleep(150);
  assert(await page.evaluate(() => CinderGraph.selected()) === null, 'and Esc');
  [hx2, hy2] = await at('Hub.md');
  await page.mouse.dblclick(hx2, hy2); await sleep(600);
  assert(await page.evaluate(() => S.view === 'note' && S.cur === 'Hub.md'), 'double-click opens the note');
  await page.keyboard.press('Control+g'); await sleep(1200);
  await page.check('#g-clickopen'); await sleep(100);
  const [ax, ay] = await at('Alpha.md');
  await page.mouse.click(box.x + ax - box.x, ay); await sleep(600);
  assert(await page.evaluate(() => S.cur === 'Alpha.md'), '"Click opens notes" brings back one-click opening');
  await page.keyboard.press('Control+g'); await sleep(900);
  assert(await page.isChecked('#g-clickopen'), 'and is remembered');
  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
