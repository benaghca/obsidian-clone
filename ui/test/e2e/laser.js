const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(800);
  await page.click('[data-cmd=new-drawing]'); await sleep(800);
  const box = await page.locator('.dr-canvas').boundingBox();
  const redAt = (x, y) => page.evaluate(([x, y]) => { const c = document.querySelector('.dr-canvas'), r = devicePixelRatio; const d = c.getContext('2d').getImageData(Math.round(x * r) - 4, Math.round(y * r) - 4, 9, 9).data; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 120 && d[i + 2] < 120) return true; return false; }, [x, y]);
  await page.keyboard.press('k'); await sleep(100);
  assert(await page.$eval('[data-tool=laser]', b => b.classList.contains('active')), 'K picks the laser pointer');
  await page.mouse.move(box.x + 300, box.y + 300); await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 300, { steps: 12 });
  await sleep(50);
  assert(await redAt(400, 300), 'dragging leaves a red trail');
  // A wavy stroke, captured mid-flight, to eyeball the trail.
  for (let i = 0; i <= 40; i++) await page.mouse.move(box.x + 300 + i * 6, box.y + 300 + Math.sin(i / 4) * 80);
  await sleep(30);
  await page.screenshot({ path: SP + '/laser.png', clip: { x: box.x + 280, y: box.y + 200, width: 300, height: 200 }, scale: 'device' });
  await page.mouse.up(); await sleep(1500);
  assert(!(await redAt(400, 300)), 'which fades away');
  const n = await page.evaluate(() => CinderDraw.getScene ? CinderDraw.getScene().elements.filter(e => !e.isDeleted).length : 0);
  assert(n === 0, 'and adds nothing to the drawing');
  assert(await page.$eval('[data-tool=laser]', b => b.classList.contains('active')), 'the laser stays selected for the next stroke');
  const px = (x, y, test) => page.evaluate(([x, y, test]) => { const c = document.querySelector('.dr-canvas'), r = devicePixelRatio; const d = c.getContext('2d').getImageData(Math.round(x * r) - 4, Math.round(y * r) - 4, 9, 9).data; const f = new Function('r', 'g', 'b', 'return ' + test); for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2])) return true; return false; }, [x, y, test]);
  // A long stroke: the start is cut off by the length cap while it's still young.
  await page.mouse.move(box.x + 60, box.y + 200); await page.mouse.down();
  for (const [x, y] of [[480, 200], [480, 600], [60, 600]]) await page.mouse.move(box.x + x, box.y + y, { steps: 25 });
  await sleep(60);
  assert(await redAt(200, 600), 'a long stroke shows near the head');
  assert(!(await redAt(120, 200)), 'but its far end is trimmed by the length cap before it has aged out');
  await page.mouse.up(); await sleep(1300);
  assert((await page.$$('.dr-props [data-prop=laserColor]')).length === 4, 'the laser shows four colour swatches');
  await page.click('.dr-props [data-prop=laserColor][data-value=green]'); await sleep(100);
  assert(await page.$eval('[data-prop=laserColor][data-value=green]', b => b.classList.contains('on')), 'green can be picked');
  await page.mouse.move(box.x + 300, box.y + 300); await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 300, { steps: 12 }); await sleep(60);
  assert(await px(400, 300, 'g > 150 && r < 120'), 'and the trail comes out green');
  await page.mouse.up(); await sleep(1300);
  await page.keyboard.press('v'); await sleep(100);
  assert(!(await page.locator('.dr-props [data-prop=laserColor]').first().isVisible()), 'other tools don’t show the laser colours');
  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
