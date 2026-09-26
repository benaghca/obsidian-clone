const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-crash-reporter', '--disable-crashpad-for-testing', '--no-zygote'], env: { ...process.env, HOME: SP + '/home' } });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; global.PAGE = page; global.ERRS = errors;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push('console ' + m.type() + ': ' + m.text()); });
  await page.goto('http://127.0.0.1:43199/');
  await sleep(800);
  await page.click('[data-cmd=new-drawing]');
  await sleep(500);
  const visible = await page.isVisible('#view-drawing');
  console.log('drawing view visible:', visible, 'crumbs:', await page.textContent('#crumbs'));
  const box = await page.locator('#view-drawing canvas').boundingBox();
  const X = x => box.x + x, Y = y => box.y + y;
  // rectangle
  await page.keyboard.press('r');
  await page.mouse.move(X(300), Y(200)); await page.mouse.down(); await page.mouse.move(X(400), Y(260), { steps: 5 }); await page.mouse.move(X(500), Y(320), { steps: 5 }); await page.mouse.up();
  // ellipse
  await page.keyboard.press('o');
  await page.mouse.move(X(750), Y(220)); await page.mouse.down(); await page.mouse.move(X(900), Y(340), { steps: 8 }); await page.mouse.up();
  // arrow from rect to ellipse
  await page.keyboard.press('a');
  await page.mouse.move(X(420), Y(260)); await page.mouse.down(); await page.mouse.move(X(600), Y(270), { steps: 5 }); await page.mouse.move(X(820), Y(280), { steps: 5 }); await page.mouse.up();
  // label on the rectangle
  await page.keyboard.press('Escape');
  await page.mouse.dblclick(X(305), Y(260));
  await sleep(100);
  await page.keyboard.type('Hello box with a longer label');
  await page.keyboard.press('Escape');
  // free text
  await page.keyboard.press('t');
  await page.mouse.click(X(300), Y(450));
  await page.keyboard.type('Free text [[Welcome]]\nsecond line');
  await page.keyboard.press('Escape');
  // diamond with hachure fill: select tool, set bg
  await page.keyboard.press('d');
  await page.mouse.move(X(600), Y(420)); await page.mouse.down(); await page.mouse.move(X(720), Y(520), { steps: 5 }); await page.mouse.up();
  console.log('props hidden?', await page.evaluate(() => document.querySelector('.dr-props').hidden), await page.evaluate(() => document.querySelector('.dr-props').innerHTML.slice(0, 200)));
  await page.click('.dr-props [data-prop=backgroundColor][data-value="#a5d8ff"]');
  await page.click('.dr-props [data-prop=fillStyle][data-value=hachure]');
  // freedraw
  await page.keyboard.press('p');
  await page.mouse.move(X(900), Y(450)); await page.mouse.down();
  for (let i = 0; i <= 40; i++) await page.mouse.move(X(900 + i * 5), Y(450 + Math.sin(i / 4) * 30));
  await page.mouse.up();
  await page.keyboard.press('v');
  await sleep(1500);
  await page.screenshot({ path: OUT + '/1-drawing.png' });
  const files = fs.readdirSync(VAULT).filter(f => f.endsWith('.excalidraw'));
  console.log('files:', files);
  const data = JSON.parse(fs.readFileSync(path.join(VAULT, files[0]), 'utf8'));
  console.log('saved elements:', data.elements.map(e => e.type + (e.containerId ? '(bound)' : '') + (e.text ? ':' + JSON.stringify(e.text) : '')).join(', '));
  const arrow = data.elements.find(e => e.type === 'arrow');
  console.log('arrow bindings:', !!arrow.startBinding, !!arrow.endBinding, 'points', JSON.stringify(arrow.points));
  const rect = data.elements.find(e => e.type === 'rectangle');
  console.log('rect bound:', JSON.stringify(rect.boundElements), 'h', rect.height);
  // move the rectangle: arrow should follow
  await page.mouse.move(X(300), Y(230)); await page.mouse.down(); await page.mouse.move(X(250), Y(150), { steps: 8 }); await page.mouse.up();
  await sleep(1500);
  const data2 = JSON.parse(fs.readFileSync(path.join(VAULT, files[0]), 'utf8'));
  const a2 = data2.elements.find(e => e.type === 'arrow'), r2 = data2.elements.find(e => e.type === 'rectangle'), t2 = data2.elements.find(e => e.containerId);
  console.log('after move: rect', Math.round(r2.x), Math.round(r2.y), 'arrow start', Math.round(a2.x), Math.round(a2.y), 'label', Math.round(t2.x), Math.round(t2.y));
  // undo / redo
  await page.keyboard.press('Control+z'); await sleep(900);
  const r3 = JSON.parse(fs.readFileSync(path.join(VAULT, files[0]), 'utf8')).elements.find(e => e.type === 'rectangle');
  console.log('after undo rect', Math.round(r3.x), Math.round(r3.y));
  await page.keyboard.press('Control+y'); await sleep(900);
  await page.screenshot({ path: OUT + '/2-moved.png' });
  // embed in a note
  const name = files[0].replace(/\.excalidraw$/, '');
  fs.writeFileSync(path.join(VAULT, 'Embed test.md'), `# Embed\n\n![[${name}.excalidraw]]\n\nafter\n`);
  await sleep(2600);
  await page.keyboard.press('Control+o'); await page.keyboard.type('Embed test'); await page.keyboard.press('Enter');
  await sleep(1200);
  const livePreview = await page.$$eval('.cm-visual-embed img', imgs => imgs.map(i => [i.naturalWidth, i.src.slice(0, 20)]));
  console.log('live preview embed imgs:', JSON.stringify(livePreview));
  await page.screenshot({ path: OUT + '/3-note-live.png' });
  await page.keyboard.press('Control+e'); await sleep(800);
  const reading = await page.$$eval('#preview .drawing-embed img', imgs => imgs.map(i => i.naturalWidth));
  console.log('reading embed imgs:', JSON.stringify(reading));
  await page.screenshot({ path: OUT + '/4-note-read.png' });
  // click embed opens drawing
  await page.click('.drawing-embed:visible');
  await sleep(600);
  console.log('after click view:', await page.evaluate(() => S.view), await page.textContent('#crumbs'));
  // dark theme, back in the note with the embed
  await page.click('[data-cmd=theme]'); await sleep(400);
  await page.screenshot({ path: OUT + '/5-dark.png' });
  await page.keyboard.press('Alt+ArrowLeft'); await sleep(900);
  await page.screenshot({ path: OUT + '/6-dark-embed.png' });
  console.log('ERRORS:\n' + (errors.join('\n') || 'none'));
  await browser.close();
})().catch(async e => { console.error(e.message.split('\n')[0]); try { await global.PAGE.screenshot({ path: OUT + '/fail.png' }); } catch {} console.log('ERRORS:\n' + global.ERRS.join('\n')); process.exit(1); });
