const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const FIX = __dirname + '/fixtures';
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const rd = p => fs.readFileSync(path.join(VAULT, p), 'utf8');
const ex = p => fs.existsSync(path.join(VAULT, p));
(async () => {
  w('Pics/a.png', fs.readFileSync(FIX + '/red.png'));
  w('Pics/b.png', fs.readFileSync(FIX + '/blue.png'));
  w('Gallery.md', '# Gallery\n\n![[a.png]]\n\n![b](Pics/b.png)\n\nend\n');
  w('Board.canvas', JSON.stringify({ nodes: [{ id: 'i1', type: 'file', file: 'Pics/a.png', x: 0, y: 0, width: 300, height: 200 }, { id: 'i2', type: 'file', file: 'Pics/b.png', x: 400, y: 0, width: 300, height: 200 }], edges: [] }));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:43199/'); await sleep(800);
  const open = async q => { await page.keyboard.press('Control+o'); await page.keyboard.type(q); await page.keyboard.press('Enter'); await sleep(900); };
  await open('Gallery');
  await page.evaluate(() => { if (S.mode !== 'edit') setMode('edit'); ed.setSelectionRange(ed.value.length); });
  await sleep(300);

  console.log('lightbox from live preview');
  await page.click('#editor .cm-image-block img >> nth=0'); await sleep(300);
  assert(await page.$('.iv-back .iv'), 'clicking an image opens the viewer');
  assert(await page.$eval('.iv-back .iv-name', e => e.textContent) === 'a.png', 'showing a.png');
  assert(await page.$eval('.iv-back .iv-count', e => e.textContent) === '1 / 2', 'knows the note has 2 images');
  await page.keyboard.press('ArrowRight'); await sleep(200);
  assert(await page.$eval('.iv-back .iv-name', e => e.textContent) === 'b.png', '→ goes to the next image');
  const z0 = await page.$eval('.iv-back .iv-zoom', e => e.textContent);
  await page.keyboard.press('+'); await sleep(100);
  assert(await page.$eval('.iv-back .iv-zoom', e => e.textContent) !== z0, '+ zooms');
  await page.keyboard.press('Escape'); await sleep(200);
  assert(!(await page.$('.iv-back')), 'Esc closes the viewer');
  assert(await page.evaluate(() => S.cur === 'Gallery.md' && S.view === 'note'), 'still on the note');

  console.log('resize by dragging the grip');
  const img = page.locator('#editor .cm-image-block img').first();
  const bb = await img.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(150);
  const grip = await page.locator('#editor .cm-image-block .cm-img-grip').first().boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down(); await page.mouse.move(grip.x - 150, grip.y, { steps: 5 }); await page.mouse.up(); await sleep(300);
  const v1 = await page.evaluate(() => ed.value);
  const m = /!\[\[a\.png\|(\d+)\]\]/.exec(v1);
  assert(m && Math.abs(+m[1] - (bb.width - 150 - grip.width / 2)) < 3, 'dragging the grip sets the width: ' + (m && m[1]));
  assert(Math.abs((await img.boundingBox()).width - +m[1]) < 3, 'the image redraws at that width');

  console.log('context menu: resize a markdown image');
  await page.click('#editor .cm-image-block img >> nth=1', { button: 'right' }); await sleep(150);
  await page.click('.menu >> text=Medium (480 px)'); await sleep(200);
  assert((await page.evaluate(() => ed.value)).includes('![b|480](Pics/b.png)'), 'Markdown image gets |480 in its alt text');
  assert(Math.abs((await page.locator('#editor .cm-image-block img').nth(1).boundingBox()).width - 480) < 3, 'and shows 480 px wide');

  console.log('reading view');
  await page.evaluate(() => setMode('read')); await sleep(300);
  assert(await page.$eval('#preview img[data-path="Pics/b.png"]', i => i.width === 480 && i.alt === 'b'), 'reading view honours |480 and strips it from alt');
  await page.click('#preview img[data-path="Pics/b.png"]'); await sleep(250);
  assert(await page.$eval('.iv-back .iv-name', e => e.textContent) === 'b.png', 'clicking in reading view opens the viewer');
  await page.keyboard.press('Escape'); await sleep(150);
  await page.evaluate(() => setMode('edit')); await sleep(300);

  console.log('crop into a copy');
  await page.click('#editor .cm-image-block img >> nth=0', { button: 'right' }); await sleep(150);
  await page.click('.menu >> text=Crop…'); await sleep(400);
  const fr = await page.locator('.ic-img').boundingBox();
  await page.mouse.move(fr.x + fr.width * 0.25, fr.y + fr.height * 0.25); await page.mouse.down();
  await page.mouse.move(fr.x + fr.width * 0.75, fr.y + fr.height * 0.75, { steps: 4 }); await page.mouse.up(); await sleep(100);
  const sz = await page.$eval('.ic-size', e => e.textContent);
  assert(/^300 × 200$/.test(sz), 'selection is measured in image pixels: ' + sz);
  await page.keyboard.press('Enter'); await sleep(800);
  assert(ex('Pics/a (cropped).png'), 'cropped copy saved beside the original');
  assert(ex('Pics/a.png'), 'original kept');
  assert(/!\[\[a \(cropped\)\.png\|\d+\]\]/.test(await page.evaluate(() => ed.value)), 'embed now points at the copy and keeps its width');
  const head = fs.readFileSync(path.join(VAULT, 'Pics/a (cropped).png'));
  assert(head.readUInt32BE(16) === 300 && head.readUInt32BE(20) === 200, 'cropped PNG is 300×200');

  console.log('annotate');
  await page.click('#editor .cm-image-block img >> nth=1', { button: 'right' }); await sleep(150);
  await page.click('.menu >> text=Annotate in a drawing'); await sleep(1500);
  assert(ex('Pics/b (annotated).excalidraw'), 'drawing created next to the image');
  const d = JSON.parse(rd('Pics/b (annotated).excalidraw'));
  const el = d.elements.find(e => e.type === 'image');
  assert(el && el.locked && el.width === 500 && d.files[el.fileId]?.dataURL?.startsWith('data:image/png'), 'drawing holds the image, locked, at full size');
  assert(await page.evaluate(() => S.view === 'drawing' && S.cur === 'Pics/b (annotated).excalidraw'), 'the drawing opens');
  assert(/!\[\[b \(annotated\)\.excalidraw\|480\]\]/.test(rd('Gallery.md')), 'the note embeds the drawing instead, same width: ' + JSON.stringify(rd('Gallery.md')));

  console.log('screenshot');
  await open('Gallery');
  await page.evaluate(() => { setMode('edit'); ed.setSelectionRange(ed.value.length); ed.focus(); });
  await page.keyboard.press('Control+Shift+S'); await sleep(1200);
  const shot = await page.evaluate(() => [...S.files.keys()].find(p => /Screenshot \d{4}-\d\d-\d\d \d{6}\.png$/.test(p)));
  assert(shot && ex(shot), 'screenshot saved: ' + shot);
  assert((await page.evaluate(() => ed.value)).includes(`![[${shot.split('/').pop()}]]`), 'and embedded at the cursor');

  console.log('image file view');
  await open('a.png');
  assert(await page.$('#view-file .iv'), 'image files open in the zoomable viewer');
  await page.keyboard.press('+'); await sleep(100);
  assert(await page.$eval('#view-file .iv-zoom', e => e.textContent) !== '100%', 'keys work straight away');
  const n0 = await page.$eval('#view-file .iv-name', e => e.textContent);
  await page.keyboard.press('ArrowRight'); await sleep(200);
  assert(await page.$eval('#view-file .iv-name', e => e.textContent) !== n0, '→ moves through the folder');

  console.log('canvas image cards');
  await open('Board');
  await page.dblclick('.cv-node[data-id=i2]'); await sleep(300);
  assert(await page.$eval('.iv-back .iv-name', e => e.textContent) === 'b.png', 'double-click an image card opens the viewer');
  assert(await page.$eval('.iv-back .iv-count', e => e.textContent) === '2 / 2', 'with the canvas\'s other images');
  await page.keyboard.press('Escape'); await sleep(200);
  assert(await page.evaluate(() => S.view === 'canvas'), 'back on the canvas');
  await page.click('.cv-node[data-id=i1]'); await page.keyboard.press('Control+Shift+S'); await sleep(1200);
  assert(await page.evaluate(() => CinderCanvas.getData().nodes.some(n => /Screenshot/.test(n.file || ''))), 'Ctrl+Shift+S on a canvas adds the screenshot as a card');

  console.log('screenshot options');
  const cardId = await page.evaluate(() => CinderCanvas.getData().nodes.find(n => /Screenshot/.test(n.file || '')).id);
  await page.keyboard.press('Control+Alt+s'); await sleep(2000);
  assert(await page.evaluate(() => S.view === 'drawing' && /Screenshot .* \(annotated\)\.excalidraw$/.test(S.cur)), 'Ctrl+Alt+S on a canvas opens the screenshot in a drawing');
  const board = JSON.parse(rd('Board.canvas'));
  assert(board.nodes.some(n => /\(annotated\)\.excalidraw$/.test(n.file || '')) && board.nodes.some(n => n.id === cardId), 'and the new card on the canvas is the drawing');
  await open('Gallery');
  await page.evaluate(() => { setMode('edit'); ed.setSelectionRange(ed.value.length); ed.focus(); cfg.screenshotAfter = 'annotate'; cfg.screenshotDelay = '2'; });
  const t0 = Date.now();
  await page.keyboard.press('Control+Shift+S'); await sleep(300);
  assert(/Screenshot in \d/.test(await page.$eval('.shot-countdown', e => e.textContent).catch(() => '')), 'a delay shows a countdown');
  await page.waitForFunction(() => S.view === 'drawing', null, { timeout: 8000 });
  assert(Date.now() - t0 >= 2000, 'and waits it out');
  await page.evaluate(() => save()); await sleep(200);
  assert(/!\[\[Screenshot [^\]]* \(annotated\)\.excalidraw\]\]/.test(rd('Gallery.md')), '"After a screenshot: annotate" puts the drawing in the note: ' + JSON.stringify(rd('Gallery.md').slice(-90)));
  assert(/end\n!\[\[Screenshot [^\]]*\.png\]\]!\[\[Screenshot [^\]]* \(annotated\)\.excalidraw\]\]$/.test(rd('Gallery.md').trim() + ''), 'only the new screenshot is swapped, not the one next to it');
  await page.evaluate(() => { cfg.screenshotAfter = 'insert'; cfg.screenshotDelay = '0'; });

  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
