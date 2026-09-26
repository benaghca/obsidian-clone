const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
(async () => {
  w('Notes/A.md', '# A'); w('Notes/Deep/B.md', 'b'); w('C.md', 'c');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  // The file tree is a tree.
  assert(await page.$eval('#tree', t => t.getAttribute('role') === 'tree' && t.getAttribute('aria-label') === 'Files'), 'the file tree has role=tree');
  await page.evaluate(() => { S.expanded.add('Notes'); renderTree(); });
  const items = await page.$$eval('#tree [role=treeitem]', r => r.map(x => `${x.getAttribute('aria-level')}:${x.textContent.trim()}:${x.getAttribute('aria-expanded') ?? '-'}`));
  assert(items.join('|') === '1:Notes:true|2:Deep:false|2:A:-|1:C:-', 'rows are treeitems with their level and whether they’re open: ' + items.join('|'));
  await page.keyboard.press('Control+Shift+E'); await sleep(150);
  await page.keyboard.press('ArrowDown'); await sleep(100);
  const act = await page.$eval('#tree', t => document.getElementById(t.getAttribute('aria-activedescendant'))?.textContent.trim());
  assert(act === 'Deep', 'the keyboard cursor is the active descendant: ' + act);
  // Menus work from the keyboard.
  await page.keyboard.press('Shift+F10'); await sleep(200);
  assert(await page.$eval('.menu', m => m.getAttribute('role') === 'menu' && m.querySelectorAll('[role=menuitem]').length > 3), 'Shift+F10 opens the row’s menu, with menu roles');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await sleep(100);
  assert(await page.$eval('.menu .hl', d => d.textContent) === 'New drawing', 'arrows move through the menu');
  await page.keyboard.press('End'); await sleep(50);
  assert(await page.$eval('.menu .hl', d => d.textContent) === 'Delete', 'End goes to the last item');
  await page.keyboard.press('Escape'); await sleep(100);
  assert(!(await page.$('.menu')), 'Esc closes it');
  await page.keyboard.press('Shift+F10'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await sleep(600);
  assert(await page.evaluate(() => S.cur && S.cur.startsWith('Notes/Deep/Untitled')), 'Enter runs the item (New note, in that folder): ' + await page.evaluate(() => S.cur));
  // Tabs, dialogs, icon buttons.
  assert(await page.$eval('#right .tabs', t => t.getAttribute('role') === 'tablist') && await page.$eval('#right .tabs .active', b => b.getAttribute('aria-selected') === 'true' && b.getAttribute('role') === 'tab'), 'the side panel’s tabs are tabs');
  const unnamed = await page.$$eval('button', bs => bs.filter(b => b.offsetParent && !b.textContent.trim() && !b.getAttribute('aria-label')).map(b => b.outerHTML.slice(0, 80)));
  assert(unnamed.length === 0, 'every icon-only button has a name: ' + unnamed.join(' '));
  await page.keyboard.press('Control+,'); await sleep(200);
  assert(await page.$eval('.modal', m => m.getAttribute('role') === 'dialog' && m.getAttribute('aria-modal') === 'true'), 'dialogs are modal dialogs');
  for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
  assert(await page.evaluate(() => $('.modal').contains(document.activeElement)), 'Tab stays inside the dialog');
  await page.keyboard.press('Escape');
  // Less motion when asked for.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const d = await page.evaluate(() => { const b = document.createElement('div'); b.className = 'switch'; b.innerHTML = '<span></span>'; document.body.append(b); const v = getComputedStyle(b.firstChild).transitionDuration; b.remove(); return v; });
  assert(parseFloat(d) < 0.01, 'transitions finish at once with reduced motion: ' + d);
  assert(errors.length === 0, 'no page errors ' + errors.join('; '));
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
