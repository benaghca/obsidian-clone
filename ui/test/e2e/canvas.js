const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const rd = p => fs.readFileSync(path.join(VAULT, p), 'utf8');
(async () => {
  w('Notes/Plan.md', '# Plan\n\n## Goals\nShip the canvas.\n\n## Later\nMore.');
  w('Obsidian board.canvas', JSON.stringify({ nodes: [
    { id: 'g1', type: 'group', x: -40, y: -60, width: 700, height: 420, label: 'Ideas', color: '4' },
    { id: 'a', type: 'text', text: '# Hello\n- [ ] task one\n- [x] done', x: 0, y: 0, width: 250, height: 150, color: '1' },
    { id: 'b', type: 'file', file: 'Notes/Plan.md', subpath: '#Goals', x: 400, y: 0, width: 230, height: 200 },
    { id: 'c', type: 'link', url: 'https://jsoncanvas.org', x: 0, y: 450, width: 300, height: 100, color: '#ff00aa' }],
    edges: [{ id: 'e1', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', label: 'leads to' }, { id: 'e2', fromNode: 'b', toNode: 'c', color: '5' }] }, null, '\t'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; global.PAGE = page; global.ERRS = errors;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  // (Cinder asks with its own dialog now: say yes, as the browser dialog handler did)
  await page.addInitScript(() => new MutationObserver(() => document.querySelector('.confirm [data-c="1"]')?.click()).observe(document, { childList: true, subtree: true }));
  await page.goto('http://127.0.0.1:43199/'); await sleep(800);
  // No internet in tests: link cards show their address instead of the live page.
  await page.evaluate(() => { cfg.webEmbeds = 'off'; saveCfg(); }); await page.reload(); await sleep(800);
  const data = () => page.evaluate(() => JSON.parse(JSON.stringify(CinderCanvas.getData())));
  const nodeBox = id => page.locator(`.cv-node[data-id="${id}"]`).boundingBox();

  console.log('open an Obsidian canvas');
  await page.keyboard.press('Control+o'); await page.keyboard.type('Obsidian board'); await page.keyboard.press('Enter'); await sleep(900);
  assert(await page.evaluate(() => S.view) === 'canvas', 'canvas view opens');
  assert(await page.locator('.cv-node').count() === 4, 'four cards rendered');
  assert((await page.textContent('.cv-node[data-id="b"] .cv-content')).includes('Ship the canvas.') && !(await page.textContent('.cv-node[data-id="b"] .cv-content')).includes('More.'), 'file card shows the #Goals section');
  assert(await page.locator('.cv-edge').count() === 2 && (await page.textContent('.cv-edge-label')) === 'leads to', 'edges and label drawn');
  assert((await page.textContent('.cv-group > .cv-label')) === 'Ideas', 'group label');
  await page.screenshot({ path: OUT + '/40-obsidian-canvas.png' });
  // checkbox in a text card
  await page.click('.cv-node[data-id="a"]', { position: { x: 200, y: 20 } });
  await page.click('.cv-node[data-id="a"] input[type=checkbox] >> nth=0');
  await sleep(1300);
  assert(JSON.parse(rd('Obsidian board.canvas')).nodes.find(n => n.id === 'a').text.includes('- [x] task one'), 'ticking a checkbox updates the card and saves');
  // external fields preserved on save
  assert(JSON.parse(rd('Obsidian board.canvas')).edges.find(e => e.id === 'e2').color === '5', 'untouched fields kept');

  console.log('new canvas: cards, tab children, connections');
  await page.click('[data-cmd=new-canvas]'); await sleep(600);
  const cur = await page.evaluate(() => S.cur);
  assert(cur === 'Untitled.canvas' && fs.existsSync(path.join(VAULT, cur)), 'new canvas file created');
  const vp = await page.locator('.cv-viewport').boundingBox();
  await page.mouse.dblclick(vp.x + 500, vp.y + 300); await sleep(100);
  await page.keyboard.type('# Root idea\nwith **markdown**'); await page.keyboard.press('Escape'); await sleep(100);
  let d = await data();
  assert(d.nodes.length === 1 && d.nodes[0].text === '# Root idea\nwith **markdown**', 'double-click creates a text card ' + JSON.stringify(d.nodes));
  assert((await page.innerHTML('.cv-node .cv-content')).includes('<strong>markdown</strong>'), 'card renders Markdown');
  const root = d.nodes[0].id;
  await page.keyboard.press('Tab'); await sleep(100);
  await page.keyboard.type('Child one'); await page.keyboard.press('Tab'); await sleep(100);
  await page.keyboard.type('Grandchild'); await page.keyboard.press('Escape');
  d = await data();
  assert(d.nodes.length === 3 && d.edges.length === 2, 'Tab creates connected child cards (' + d.nodes.length + '/' + d.edges.length + ')');
  const child = d.nodes.find(n => n.text === 'Child one');
  assert(child.x > d.nodes[0].x + d.nodes[0].width && d.edges[0].fromNode === root && d.edges[0].toNode === child.id, 'child sits to the right, connected');
  // Alt+Left returns to parent
  await page.click(`.cv-node[data-id="${child.id}"]`); await page.keyboard.press('Alt+ArrowLeft'); await sleep(50);
  assert(await page.evaluate(r => document.querySelector(`.cv-node[data-id="${r}"]`).classList.contains('selected'), root), 'Alt+← jumps to the connected card on the left');
  // connect-drag from root bottom dot to empty space makes a new card
  const rb = await nodeBox(root);
  await page.hover(`.cv-node[data-id="${root}"]`);
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height); await page.mouse.down();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height + 80, { steps: 5 }); await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height + 160, { steps: 5 }); await page.mouse.up();
  await sleep(100); await page.keyboard.type('Below'); await page.keyboard.press('Escape');
  d = await data();
  const below = d.nodes.find(n => n.text === 'Below');
  assert(below && d.edges.some(e => e.fromNode === root && e.fromSide === 'bottom' && e.toNode === below.id && e.toSide === 'top'), 'dragging a side dot into space creates a connected card');
  // connect root right to "Below"? connect below card to grandchild via drag onto card
  const gc = d.nodes.find(n => n.text === 'Grandchild');
  await page.keyboard.press('Escape'); await page.click('[data-act=fit]'); await sleep(200);
  const bb = await nodeBox(below.id), gb = await nodeBox(gc.id);
  await page.hover(`.cv-node[data-id="${below.id}"]`);
  await page.mouse.move(bb.x + bb.width, bb.y + bb.height / 2); await page.mouse.down();
  await page.mouse.move(gb.x + 20, gb.y + gb.height / 2, { steps: 8 });
  await page.mouse.up();
  d = await data();
  assert(d.edges.some(e => e.fromNode === below.id && e.toNode === gc.id), 'dragging a side dot onto a card connects them');
  console.log('move, resize, colour, group, undo');
  const b0 = await data().then(x => x.nodes.find(n => n.id === below.id));
  await page.mouse.move(bb.x + 40, bb.y + 20); await page.mouse.down(); await page.mouse.move(bb.x + 100, bb.y + 60, { steps: 6 }); await page.mouse.up();
  const b1 = await data().then(x => x.nodes.find(n => n.id === below.id));
  const z = await page.evaluate(() => CinderCanvas.getView().z);
  assert(Math.abs(b1.x - b0.x - 60 / z) < 12 && Math.abs(b1.y - b0.y - 40 / z) < 12, `card moves with the mouse (${b1.x - b0.x}, ${b1.y - b0.y})`);
  const nb = await nodeBox(below.id);
  await page.mouse.move(nb.x + nb.width, nb.y + nb.height); await page.mouse.down(); await page.mouse.move(nb.x + nb.width + 80, nb.y + nb.height + 50, { steps: 5 }); await page.mouse.up();
  const b2 = await data().then(x => x.nodes.find(n => n.id === below.id));
  assert(b2.width > b1.width + 40 && b2.height > b1.height + 20, 'corner handle resizes');
  await page.click(`.cv-node[data-id="${below.id}"]`, { button: 'right' });
  await page.click('#menu-root .menu div:has-text("Colour: green")');
  assert((await data()).nodes.find(n => n.id === below.id).color === '4', 'colour preset from the context menu');
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+g'); await sleep(100);
  await page.keyboard.type('My group'); await page.keyboard.press('Enter'); await sleep(100);
  d = await data();
  const g = d.nodes[0];
  assert(g.type === 'group' && g.label === 'My group' && d.nodes.filter(n => n.type !== 'group').every(n => CinderCanvas_inside(n, g)), 'Ctrl+G groups the selection behind it');
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await sleep(50);
  assert(!(await data()).nodes.some(n => n.type === 'group'), 'undo removes the group');
  await page.keyboard.press('Control+y'); await page.keyboard.press('Control+y');
  assert((await data()).nodes.some(n => n.type === 'group' && n.label === 'My group'), 'redo restores it');
  console.log('add a note, save, embed, backlinks, rename');
  await page.keyboard.press('Escape');
  await page.click('[data-act=add-note]'); await sleep(150); await page.keyboard.type('Plan'); await page.keyboard.press('Enter'); await sleep(300);
  d = await data();
  assert(d.nodes.some(n => n.type === 'file' && n.file === 'Notes/Plan.md'), 'toolbar adds a note card');
  await page.screenshot({ path: OUT + '/41-new-canvas.png' });
  await sleep(1200);
  const disk = JSON.parse(rd('Untitled.canvas'));
  assert(disk.nodes.length === d.nodes.length && disk.edges.length === d.edges.length, 'autosaved to disk');
  w('Uses canvas.md', 'See:\n\n![[Untitled.canvas]]\n');
  await sleep(2500);
  await page.keyboard.press('Control+o'); await page.keyboard.type('Plan'); await page.keyboard.press('Enter'); await sleep(600);
  const bl = await page.textContent('#right-body');
  assert(bl.includes('Untitled.canvas') && bl.includes('Obsidian board.canvas'), 'the note shows backlinks from both canvases');
  await page.evaluate(() => renamePath('Notes/Plan.md', 'Archive/Plan 2024.md')); await sleep(900);
  assert(JSON.parse(rd('Obsidian board.canvas')).nodes.find(n => n.id === 'b').file === 'Archive/Plan 2024.md', 'rename updates a closed canvas');
  assert(JSON.parse(rd('Untitled.canvas')).nodes.some(n => n.file === 'Archive/Plan 2024.md'), 'rename updates the other canvas');
  await page.keyboard.press('Control+o'); await page.keyboard.type('Uses canvas'); await page.keyboard.press('Enter'); await sleep(1200);
  const imgs = await page.$$eval('.canvas-embed img', i => i.map(x => x.naturalWidth));
  assert(imgs.length && imgs[0] > 100, 'canvas embed renders a preview (' + imgs + ')');
  await page.screenshot({ path: OUT + '/42-canvas-embed.png' });
  await page.click('.canvas-embed:visible'); await sleep(700);
  assert(await page.evaluate(() => S.cur) === 'Untitled.canvas', 'clicking the embed opens the canvas');
  // edge delete
  await page.evaluate(() => { const d = CinderCanvas.getData(); }); 
  console.log('ERRORS:', errors.join('\n') || 'none');
  await browser.close();
})().catch(async e => { console.error(e.message); try { await global.PAGE.screenshot({ path: OUT + '/fail.png' }); } catch {} console.log('ERRORS:', global.ERRS || ''); process.exit(1); });
function CinderCanvas_inside(n, g) { return n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height; }
