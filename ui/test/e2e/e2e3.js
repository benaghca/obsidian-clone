const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const FIX = __dirname + '/fixtures';
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { throw new Error('ASSERT: ' + m); } else console.log('  ✓', m); };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; global.PAGE = page; global.ERRS = errors;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push('console ' + m.type() + ': ' + m.text()); });
  let dialogAnswer = true;
  page.on('dialog', d => { console.log('    dialog:', d.message().split('\n')[0]); dialogAnswer ? d.accept() : d.dismiss(); });
  // Cinder's own dialog: answer it the way dialogAnswer says (window.__ans mirrors it)
  await page.addInitScript(() => new MutationObserver(() => document.querySelector(`.confirm [data-c="${window.__ans === false ? 0 : 1}"]`)?.click()).observe(document, { childList: true, subtree: true }));
  // a small PNG to insert
  const pngPath = FIX + '/pic.png';
  await page.goto('http://127.0.0.1:43199/'); await sleep(700);
  const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 120; c.height = 80; const x = c.getContext('2d'); x.fillStyle = '#2f9e44'; x.fillRect(0, 0, 120, 80); x.fillStyle = '#fff'; x.fillRect(20, 20, 40, 40); return c.toDataURL().split(',')[1]; });
  fs.writeFileSync(pngPath, Buffer.from(b64, 'base64'));
  const els = () => page.evaluate(() => CinderDraw.getScene().elements.map(e => ({ id: e.id, type: e.type, x: e.x, y: e.y, w: e.width, h: e.height, text: e.text, containerId: e.containerId, fileId: e.fileId, boundElements: e.boundElements })));
  const canvasBox = async () => page.locator('#view-drawing canvas').boundingBox();
  for (const fmt of ['excalidraw', 'md']) {
    console.log('format', fmt);
    await page.evaluate(f => { cfg.drawingFormat = f; saveCfg(); }, fmt);
    await page.click('[data-cmd=new-drawing]'); await sleep(400);
    const cur = await page.evaluate(() => S.cur);
    const box = await canvasBox();
    const X = x => box.x + x, Y = y => box.y + y;
    // image via the toolbar (file chooser)
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('9')]);
    await chooser.setFiles(pngPath); await sleep(400);
    let e = await els();
    const img = e.find(x => x.type === 'image');
    assert(img && Math.abs(img.w - 120) < 0.01 && Math.abs(img.h - 80) < 0.01, 'image inserted at natural size');
    // arrow + label
    await page.keyboard.press('Escape');
    await page.keyboard.press('a');
    await page.mouse.move(X(300), Y(600)); await page.mouse.down(); await page.mouse.move(X(450), Y(620), { steps: 5 }); await page.mouse.move(X(600), Y(600), { steps: 5 }); await page.mouse.up();
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(X(450), Y(600)); await sleep(50);
    await page.keyboard.type('label'); await page.keyboard.press('Escape');
    e = await els();
    const arrow = e.find(x => x.type === 'arrow'), lab = e.find(x => x.containerId === arrow.id);
    assert(lab && lab.text === 'label' && arrow.boundElements?.some(b => b.id === lab.id), 'arrow gets a label');
    // text edit existing
    await page.keyboard.press('t'); await page.mouse.click(X(300), Y(300)); await page.keyboard.type('first'); await page.keyboard.press('Escape');
    await page.mouse.dblclick(X(310), Y(300)); await sleep(50);
    await page.keyboard.press('End'); await page.keyboard.type(' edited'); await page.keyboard.press('Escape');
    e = await els();
    assert(e.some(x => x.type === 'text' && x.text === 'first edited'), 'double-click edits existing text');
    assert(!(await page.$('.dr-textedit')), 'text editor closed');
    await sleep(1500);
    const disk = fs.readFileSync(path.join(VAULT, cur), 'utf8');
    if (fmt === 'excalidraw') {
      const d = JSON.parse(disk);
      assert(d.files[img.fileId]?.dataURL?.startsWith('data:image/png;base64,'), 'image stored as dataURL in files');
    } else {
      const att = fs.readdirSync(path.join(VAULT, 'attachments'));
      assert(att.length === 1 && /^Pasted image .*\.png$/.test(att[0]), 'md drawing saves image as attachment: ' + att[0]);
      assert(new RegExp(`## Embedded Files\\n${img.fileId}: \\[\\[${att[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`).test(disk), 'Embedded Files lists it');
      assert(/"files": \{\}/.test(disk), 'JSON files map empty (image lives in the vault)');
      // reopen from disk: image loads from vault
      await page.keyboard.press('Control+o'); await page.keyboard.type('Welcome'); await page.keyboard.press('Enter'); await sleep(400);
      await page.keyboard.press('Alt+ArrowLeft'); await sleep(700);
      const loaded = await page.evaluate(() => new Promise(r => setTimeout(() => r(CinderDraw.getScene().elements.some(e => e.type === 'image')), 300)));
      assert(loaded, 'reopened md drawing still has its image');
      await page.screenshot({ path: OUT + '/20-md-image.png' });
    }
  }
  console.log('embed width + rename updates links');
  const drawing = await page.evaluate(() => S.cur);
  const linkName = path.basename(drawing, '.md');
  fs.writeFileSync(path.join(VAULT, 'Uses drawing.md'), `Some text\n\n![[${linkName}|300]]\n`);
  await sleep(2500);
  await page.keyboard.press('Control+o'); await page.keyboard.type('Uses drawing'); await page.keyboard.press('Enter'); await sleep(900);
  const w = await page.$$eval('.cm-visual-embed img', i => i.map(x => x.getAttribute('width')));
  assert(w[0] === '300', 'embed |300 sets width');
  await page.keyboard.press('Alt+ArrowLeft'); await sleep(500);
  await page.evaluate(n => renamePath(S.cur, n), 'Renamed sketch.excalidraw.md'); await sleep(800);
  const uses = fs.readFileSync(path.join(VAULT, 'Uses drawing.md'), 'utf8');
  assert(uses.includes('![[Renamed sketch.excalidraw|300]]'), 'rename rewrote the embed: ' + uses.trim().split('\n').pop());
  assert(await page.evaluate(() => S.cur) === 'Renamed sketch.excalidraw.md' && await page.evaluate(() => S.view) === 'drawing', 'still editing the renamed drawing');
  console.log('conflict');
  const cur = await page.evaluate(() => S.cur);
  // external edit while we have unsaved changes
  const box = await canvasBox();
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 300, box.y + 150); await page.mouse.down(); await page.mouse.move(box.x + 400, box.y + 250, { steps: 4 }); await page.mouse.up();
  const txt = fs.readFileSync(path.join(VAULT, cur), 'utf8');
  await sleep(50);
  fs.writeFileSync(path.join(VAULT, cur), txt.replace('## Text Elements\n', '## Text Elements\nexternal ^ext\n\n'));
  dialogAnswer = false; // Cancel = load disk version
  await page.evaluate(() => { window.__ans = false; });
  await sleep(1500);
  const after = fs.readFileSync(path.join(VAULT, cur), 'utf8');
  assert(after.includes('external ^ext'), 'on conflict, cancelling keeps the version on disk');
  assert(await page.textContent('#save-state') === 'Reloaded from disk', 'save state says reloaded');
  console.log('ERRORS:\n' + (errors.join('\n') || 'none'));
  await browser.close();
})().catch(async e => { console.error(e.message.split('\n')[0]); try { await global.PAGE.screenshot({ path: OUT + '/fail.png' }); } catch {} console.log('ERRORS:\n' + global.ERRS.join('\n')); process.exit(1); });
