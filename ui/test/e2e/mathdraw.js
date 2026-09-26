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
  page.on('console', m => { if (m.type() === 'error' && !/Content Security Policy|unsafe-eval/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:43199/'); await sleep(800);
  await page.click('[data-cmd=new-drawing]'); await sleep(800);
  const cur = await page.evaluate(() => S.cur);
  const els = () => page.evaluate(() => CinderDraw.getScene().elements.filter(e => !e.isDeleted).map(e => ({ id: e.id, type: e.type, fileId: e.fileId, latex: e.customData?.latex, x: e.x, y: e.y, w: e.width, h: e.height, stroke: e.strokeColor })));
  // Count pixels in an element's box that match a colour test.
  const inkIn = (el, test) => page.evaluate(([el, test]) => {
    const c = document.querySelector('.dr-canvas'), r = devicePixelRatio, v = CinderDraw.getView();
    const x = (el.x + v.sx) * v.zoom * r, y = (el.y + v.sy) * v.zoom * r, w = el.w * v.zoom * r, h = el.h * v.zoom * r;
    const d = c.getContext('2d').getImageData(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data;
    const f = new Function('r', 'g', 'b', 'a', 'return ' + test);
    let n = 0; for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2], d[i + 3])) n++;
    return n;
  }, [el, test]);
  const texValue = () => page.$eval('.tex-src .cm-content', e => [...e.querySelectorAll('.cm-line')].map(l => l.textContent).join('\n'));
  const center = async el => { const box = await page.locator('.dr-canvas').boundingBox(); const v = await page.evaluate(() => CinderDraw.getView()); return [box.x + (el.x + el.w / 2 + v.sx) * v.zoom, box.y + (el.y + el.h / 2 + v.sy) * v.zoom]; };

  assert(await page.$('[data-tool=math]'), 'the toolbar has an equation button');
  await page.keyboard.press('m'); await sleep(300);
  assert(await page.$('.tex-modal'), 'M opens the equation editor');
  await page.fill('.tex-src .cm-content', '\\frac{a');
  await page.waitForSelector('.tex-preview .tex-err', { timeout: 15000 });
  assert(/brace|Missing|close/i.test(await page.textContent('.tex-preview')), 'a broken equation shows the error: ' + (await page.textContent('.tex-preview')).trim());
  await page.fill('.tex-src .cm-content', '\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'); await sleep(400);
  await page.waitForSelector('.tex-preview img', { timeout: 5000 });
  assert(await page.$eval('.tex-preview img', i => i.naturalWidth > 50), 'and a good one previews live');
  await page.keyboard.press('Enter'); await sleep(500);
  assert(!(await page.$('.tex-modal')), 'Enter inserts it');
  let list = await els();
  assert(list.length === 1 && list[0].type === 'image' && list[0].latex === '\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', 'as an equation element holding its LaTeX');
  assert(list[0].w > 80 && list[0].h > 30 && list[0].w > list[0].h, `sized like the formula (${Math.round(list[0].w)}×${Math.round(list[0].h)})`);
  await sleep(300);
  const dark = await inkIn(list[0], 'a > 200 && r < 90 && g < 90 && b < 90');
  assert(dark > 100, `drawn in dark ink on the light canvas (${dark} px)`);

  // Colour follows the stroke swatches.
  const reds = await page.$$eval('.dr-props [data-prop=strokeColor][data-value]', bs => bs.map(b => b.dataset.value));
  assert(reds.length > 2, 'an equation offers stroke colours');
  await page.click('.dr-props [data-prop=strokeColor][data-value="#e03131"]'); await sleep(400);
  list = await els();
  assert(list[0].stroke === '#e03131' && await inkIn(list[0], 'r > 180 && g < 110 && b < 110') > 100, 'and picking red redraws it red');
  await page.keyboard.press('Control+z'); await sleep(300);
  assert((await els())[0].stroke !== '#e03131', 'undo takes the colour back');

  // Edit by double-click; undo restores the old source and picture.
  const fid = list[0].fileId, oldW = list[0].w;
  await page.mouse.dblclick(...await center(list[0])); await sleep(300);
  assert(await page.evaluate(() => !!document.activeElement.closest('.tex-src')), 'double-click puts the cursor in the editor (focus: ' + await page.evaluate(() => document.activeElement.className) + ')');
  assert(await texValue() === '\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', 'double-click opens it with its LaTeX');
  assert(await page.evaluate(() => { const s = getSelection(); return s.isCollapsed && s.focusNode && s.focusNode.textContent.endsWith('{2a}') && s.focusOffset === s.focusNode.textContent.length; }), 'with the cursor at the end, not everything selected');
  assert(await page.$eval('.tex-src .cm-cursor', c => c.getBoundingClientRect().height > 8), 'and the cursor is visible');
  assert(/Edit equation/.test(await page.textContent('.tex-modal h3')), 'titled Edit equation');
  await page.fill('.tex-src .cm-content', 'e^{i\\pi} + 1 = 0'); await sleep(200);
  await page.keyboard.press('Enter'); await sleep(600);
  list = await els();
  assert(list.length === 1 && list[0].latex === 'e^{i\\pi} + 1 = 0' && list[0].fileId !== fid, 'saving replaces the equation in place');
  assert(list[0].w < oldW, 'and resizes to the new formula');
  await page.keyboard.press('Control+z'); await sleep(400);
  list = await els();
  assert(list[0].latex.startsWith('\\frac') && list[0].fileId === fid, 'undo brings the old equation back');
  assert(await inkIn(list[0], 'a > 200 && r < 90 && g < 90 && b < 90') > 100, 'with its picture');
  await page.keyboard.press('Control+y'); await sleep(300);

  // Enter on a selected equation edits too; Escape leaves it alone.
  await page.keyboard.press('Enter'); await sleep(300);
  assert(await page.$('.tex-modal'), 'Enter on a selected equation edits it');
  await page.keyboard.press('Escape'); await sleep(200);
  assert(!(await page.$('.tex-modal')) && (await els())[0].latex === 'e^{i\\pi} + 1 = 0', 'Escape cancels');

  // Suggestions and snippets, as in the note editor's math.
  await page.keyboard.press('m'); await sleep(300);
  const caret = await page.$eval('.tex-src .cm-cursor', c => { const cs = getComputedStyle(c); return [cs.borderLeftWidth, cs.borderLeftColor, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()]; });
  assert(caret[0] === '2px' && !/rgb\(0, 0, 0\)/.test(caret[1]), 'the cursor is drawn in the accent colour: ' + caret.join(' '));
  await page.keyboard.type('\\D'); await sleep(400);
  const opts = await page.$$eval('.cm-tooltip-autocomplete li', ls => ls.map(l => l.textContent));
  assert(opts.includes('\\Delta') && opts.includes('\\delta'), 'typing \\D lists matching commands: ' + opts.slice(0, 6).join(' '));
  await page.waitForSelector('.cm-completionInfo .cm-math-info .katex', { timeout: 5000 });
  assert(true, 'with a rendered preview of the highlighted one');
  while (!/^\\Delta$/.test(await page.$eval('.cm-tooltip-autocomplete li[aria-selected]', l => l.textContent))) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); await sleep(200);
  assert(await page.$('.tex-modal') && await texValue() === '\\Delta', 'Enter picks the suggestion without closing the editor');
  await page.keyboard.type(' = \\fra'); await sleep(400);
  while (!/^\\frac$/.test(await page.$eval('.cm-tooltip-autocomplete li[aria-selected]', l => l.textContent))) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); await sleep(100);
  await page.keyboard.type('a'); await page.keyboard.press('Tab'); await page.keyboard.type('b'); await page.keyboard.press('Tab');
  await page.keyboard.type(' + @a'); await sleep(200);
  assert(await texValue() === '\\Delta = \\frac{a}{b} + \\alpha', 'snippet fields take Tab, and @a becomes \\alpha: ' + await texValue());
  await page.keyboard.press('Enter'); await sleep(600);
  assert(!(await page.$('.tex-modal')) && (await els()).some(e => e.latex === '\\Delta = \\frac{a}{b} + \\alpha'), 'and Enter inserts it');
  await page.keyboard.press('Delete'); await sleep(200);

  // Right-click on empty canvas: Insert equation… at that spot.
  const box = await page.locator('.dr-canvas').boundingBox();
  await page.mouse.click(box.x + 150, box.y + 550, { button: 'right' }); await sleep(200);
  await page.click('.menu >> text=Insert equation…'); await sleep(300);
  await page.fill('.tex-src .cm-content', '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}'); await sleep(200);
  await page.click('.tex-modal .btn.primary'); await sleep(600);
  list = await els();
  assert(list.length === 2, 'the context menu inserts a second equation');
  const v = await page.evaluate(() => CinderDraw.getView());
  const second = list[1];
  assert(Math.abs((second.x + second.w / 2 + v.sx) * v.zoom - 150) < 5 && Math.abs((second.y + second.h / 2 + v.sy) * v.zoom - 550) < 5, 'centred where you right-clicked');

  // .excalidraw (JSON): the SVGs live in "files", the LaTeX on each element; the replaced one is dropped.
  await page.keyboard.press('Control+s'); await sleep(1000);
  let data = JSON.parse(fs.readFileSync(path.join(VAULT, cur), 'utf8'));
  assert(data.elements.map(e => e.customData?.latex).join('|') === list.map(e => e.latex).join('|'), 'the .excalidraw file keeps each LaTeX source');
  assert(Object.keys(data.files).sort().join() === [list[0].fileId, list[1].fileId].sort().join() && Object.values(data.files).every(f => /^data:image\/svg\+xml/.test(f.dataURL)), 'and just the SVGs in use');

  // .excalidraw.md: saved as the Obsidian plugin does, `id: $$tex$$` under Embedded Files.
  await page.evaluate(() => { cfg.drawingFormat = 'md'; });
  await page.click('[data-cmd=new-drawing]'); await sleep(800);
  const mdPath = await page.evaluate(() => S.cur);
  assert(/\.excalidraw\.md$/.test(mdPath), 'a .excalidraw.md drawing');
  for (const tex of ['e^{i\\pi} + 1 = 0', '\\int_0^1 x^2\\,dx = \\tfrac13']) {
    await page.keyboard.press('m'); await sleep(200);
    await page.fill('.tex-src .cm-content', tex); await sleep(100);
    await page.keyboard.press('Enter'); await sleep(500);
    if (tex.startsWith('e')) for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowDown'); // move it out of the way
  }
  list = await els();
  assert(list.length === 2, 'two equations in it');
  const firstFile = list[0].fileId;
  await page.mouse.dblclick(...await center(list[0])); await sleep(300);
  await page.fill('.tex-src .cm-content', 'e^{i\\pi} = -1'); await page.keyboard.press('Enter'); await sleep(600);
  await page.keyboard.press('Control+a'); await sleep(100);
  await page.click('.dr-props [data-prop=strokeColor][data-value="#1e1e1e"]'); await sleep(300);
  list = await els();
  assert(list.every(e => e.stroke === '#1e1e1e'), 'several equations can be recoloured at once');
  await page.keyboard.press('Control+s'); await sleep(1000);
  const md = fs.readFileSync(path.join(VAULT, mdPath), 'utf8');
  assert(md.includes(`${list[0].fileId}: $$e^{i\\pi} = -1$$`) && md.includes(`${list[1].fileId}: $$\\int_0^1 x^2\\,dx = \\tfrac13$$`), 'the note lists both equations as $$…$$ under Embedded Files');
  assert(!md.includes(firstFile + ':'), 'the replaced version is not kept');
  assert(!/data:image\/svg/.test(md), 'no SVG is stored in the note');
  const svgs = fs.readdirSync(VAULT, { recursive: true }).filter(f => /\.svg$/.test(f));
  assert(svgs.length === 0, 'and no SVG attachments were written');

  // Reopen from disk: the equations render from their source.
  await page.reload(); await sleep(1000);
  await page.evaluate(p => openPath(p), mdPath); await sleep(2500);
  list = await els();
  assert(list.length === 2 && list[0].latex === 'e^{i\\pi} = -1', 'reopening restores the LaTeX from the note');
  assert(await inkIn(list[0], 'a > 200 && r < 90 && g < 90 && b < 90') > 50, 'and draws it (MathJax loaded on demand)');

  // Dark theme: the ink turns light.
  await page.click('[data-cmd=theme]'); await sleep(800);
  const light = await inkIn(list[0], 'a > 200 && r > 170 && g > 170 && b > 170');
  assert(light > 50, `in the dark theme it's drawn light (${light} px)`);

  // Exports carry the equations, in dark ink even from the dark theme.
  const svg = await page.evaluate(() => CinderDraw.exportSVG());
  assert((svg.match(/<image href="data:image\/svg\+xml/g) || []).length === 2 && svg.includes(encodeURIComponent('color="#1e1e1e"')), 'SVG export embeds both, tinted');
  const png = await page.evaluate(async () => { const b = await CinderDraw.exportPNG(); const bmp = await createImageBitmap(b); const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0); const d = x.getImageData(0, 0, bmp.width, bmp.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) n++; return n; });
  assert(png > 500, `PNG export draws them dark (${png} px)`);
  await page.click('[data-cmd=theme]'); await sleep(500);

  // Embedded in a note, the drawing's picture includes them.
  const embedSvg = await page.evaluate(async p => { let blob; const o = URL.createObjectURL; URL.createObjectURL = b => { blob = b; return o(b); }; drawingSvgCache.clear(); try { await drawingSvgUrl(p); } finally { URL.createObjectURL = o; } return await blob.text(); }, mdPath);
  assert((embedSvg.match(/data:image\/svg\+xml/g) || []).length === 2, 'a note embedding the drawing shows the equations');

  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
