const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => fs.writeFileSync(path.join(VAULT, p), s);
(async () => {
  // Center links to five notes (depth 1); each of those links on (depth 2); A1 links one further (depth 3).
  w('Center.md', '# Center\n[[A]] [[B]] [[C]] [[D]] [[E]]\n');
  w('A.md', '# A\n[[A1]] [[A2]]\n'); w('B.md', '# B\n[[B1]]\n'); w('C.md', '# C\n[[C1]]\n'); w('D.md', '# D\n[[D1]]\n'); w('E.md', '# E\n[[E1]]\n');
  for (const n of ['A2', 'B1', 'C1', 'D1', 'E1']) w(n + '.md', `# ${n}\n`);
  w('A1.md', '# A1\n[[Far]]\n'); w('Far.md', '# Far\n'); w('Lone.md', '# Lone\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  await page.evaluate(() => openPath('Center.md')); await sleep(400);
  await page.evaluate(() => openGraph(true)); await sleep(600);

  // Wait until the layout stops moving, then each note's distance from the open note.
  const settled = async () => {
    let prev = null;
    for (let i = 0; i < 80; i++) {
      const p = await page.evaluate(() => CinderGraph.worldPos('E1.md'));
      if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) < 0.3) return;
      prev = p; await sleep(100);
    }
  };
  const dist = ids => page.evaluate(ids => {
    const c = CinderGraph.worldPos('Center.md');
    return ids.map(id => { const p = CinderGraph.worldPos(id); return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]); });
  }, ids);
  const ring1 = ['A.md', 'B.md', 'C.md', 'D.md', 'E.md'], ring2 = ['A1.md', 'A2.md', 'B1.md', 'C1.md', 'D1.md', 'E1.md'];
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const tight = (a, m) => a.every(x => Math.abs(x - m) / m < 0.15);
  const checkRings = async label => {
    await settled();
    const d1 = await dist(ring1), d2 = await dist(ring2);
    const m1 = mean(d1), m2 = mean(d2);
    assert(tight(d1, m1) && tight(d2, m2), `${label}: notes at the same depth sit at the same distance (${d1.map(Math.round)} / ${d2.map(Math.round)})`);
    assert(Math.min(...d2) > Math.max(...d1) && Math.abs(m2 / m1 - 2) < 0.3, `${label}: the second ring is twice as far out as the first`);
  };

  assert(await page.isEnabled('#g-rings') && !(await page.isChecked('#g-rings')), 'Rings by depth is offered on the local graph, off by default');
  await page.check('#g-rings'); await sleep(300);
  assert(await page.evaluate(() => CinderGraph.rings()), 'ticking it turns rings on');
  await checkRings('2D');
  const c = await page.evaluate(() => CinderGraph.worldPos('Center.md'));
  assert(Math.hypot(...c) < 0.5, 'the open note is pinned at the centre');
  await page.screenshot({ path: SP + '/shots/graphrings-2d.png' });

  // Dragging the open note away: it goes back to the centre when let go.
  await page.evaluate(() => CinderGraph.select('Center.md', { center: true })); await sleep(300);
  const box = await page.locator('#graph-canvas').boundingBox();
  const [sx, sy] = await page.evaluate(() => CinderGraph.screenPos('Center.md'));
  await page.mouse.move(box.x + sx, box.y + sy); await page.mouse.down();
  await page.mouse.move(box.x + sx + 120, box.y + sy + 60, { steps: 6 }); await page.mouse.up(); await sleep(200);
  const c2 = await page.evaluate(() => CinderGraph.worldPos('Center.md'));
  assert(Math.hypot(...c2) < 0.5, 'a dragged centre snaps back');

  await page.fill('#g-depth', '3'); await page.dispatchEvent('#g-depth', 'input'); await sleep(300);
  await settled();
  const [far] = await dist(['Far.md']), d2 = mean(await dist(ring2));
  assert(far > d2 * 1.25, 'a third level of links forms a third ring');
  assert(!(await page.evaluate(() => CinderGraph.worldPos('Lone.md'))), 'notes outside the local graph stay out');

  await page.check('#g-3d'); await sleep(600);
  await page.fill('#g-depth', '2'); await page.dispatchEvent('#g-depth', 'input'); await sleep(300);
  await checkRings('3D');
  await page.screenshot({ path: SP + '/shots/graphrings-3d.png' });
  await page.uncheck('#g-3d'); await sleep(400);

  await page.reload(); await sleep(900);
  await page.evaluate(() => openPath('Center.md')); await sleep(400);
  await page.evaluate(() => openGraph(true)); await sleep(600);
  assert(await page.isChecked('#g-rings') && await page.evaluate(() => CinderGraph.rings()), 'the setting is remembered');

  await page.uncheck('#g-local'); await page.dispatchEvent('#g-local', 'input'); await sleep(300);
  assert(await page.isDisabled('#g-rings') && !(await page.evaluate(() => CinderGraph.rings())), 'the global graph has no rings (the box is disabled)');
  await page.check('#g-local'); await page.dispatchEvent('#g-local', 'input'); await sleep(300);
  assert(await page.evaluate(() => CinderGraph.rings()), 'and they come back on the local graph');
  await page.uncheck('#g-rings'); await sleep(200);
  assert(!(await page.evaluate(() => CinderGraph.rings())), 'unticking it turns rings off');

  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
