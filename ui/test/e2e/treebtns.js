const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  const w = (p, t) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), t); };
  for (let i = 0; i < 40; i++) w(`Note ${String(i).padStart(2, '0')}.md`, 'x');
  w('Zeta/Deep/Deeper/Bottom.md', '# bottom');
  w('Alpha/Other.md', '# other');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const expanded = () => page.evaluate(() => [...S.expanded].sort());
  const inView = p => page.evaluate(p => { const r = document.querySelector(`#tree .t-row[data-path="${CSS.escape(p)}"]`); if (!r) return false; const a = r.getBoundingClientRect(), b = document.querySelector('#tree').getBoundingClientRect(); return a.top >= b.top - 1 && a.bottom <= b.bottom + 1; }, p);

  // Expand all / collapse all
  await page.evaluate(() => setAllExpanded(false)); await sleep(100);
  const ex = '#panel-files [data-cmd=toggle-expand]';
  assert(await page.getAttribute(ex, 'title') === 'Expand all', 'with everything closed the button offers Expand all');
  await page.click(ex); await sleep(200);
  assert((await expanded()).join() === 'Alpha,Zeta,Zeta/Deep,Zeta/Deep/Deeper', 'it opens every folder, nested ones too');
  assert(await page.getAttribute(ex, 'title') === 'Collapse all', 'then offers Collapse all');
  await page.click(ex); await sleep(200);
  assert((await expanded()).length === 0 && await page.getAttribute(ex, 'title') === 'Expand all', 'which closes them all');
  await page.evaluate(() => { const r = document.querySelector('#tree .t-row.folder'); r.click(); }); await sleep(200);
  assert(await page.getAttribute(ex, 'title') === 'Collapse all', 'opening one folder by hand flips it back to Collapse all');
  await page.click(ex); await sleep(200);

  // Auto-reveal
  const ar = '#panel-files [data-cmd=auto-reveal]';
  assert(await page.getAttribute(ar, 'aria-pressed') === 'true', 'auto-reveal is on by default');
  await page.evaluate(() => { document.querySelector('#tree').scrollTop = 0; });
  await page.evaluate(() => openPath('Zeta/Deep/Deeper/Bottom.md')); await sleep(400);
  assert((await expanded()).join() === 'Zeta,Zeta/Deep,Zeta/Deep/Deeper', 'opening a deep file opens its folders');
  assert(await page.$('#tree .t-row.active[data-path="Zeta/Deep/Deeper/Bottom.md"]'), 'and marks it');
  assert(await inView('Zeta/Deep/Deeper/Bottom.md'), 'and scrolls the tree to it (it was below the fold)');
  await page.click(ar); await sleep(200);
  assert(await page.getAttribute(ar, 'aria-pressed') === 'false', 'the button turns auto-reveal off');
  await page.click(ex); await sleep(200);
  await page.evaluate(() => { document.querySelector('#tree').scrollTop = 0; });
  await page.evaluate(() => openPath('Alpha/Other.md')); await sleep(300);
  assert((await expanded()).length === 0, 'then opening a file leaves the folders alone');
  await page.click(ar); await sleep(300);
  assert((await expanded()).join() === 'Alpha' && await page.$('#tree .t-row.active[data-path="Alpha/Other.md"]'), 'turning it back on reveals the open file at once');
  await page.reload(); await sleep(900);
  assert(await page.getAttribute(ar, 'aria-pressed') === 'true', 'the choice is remembered');
  await page.click(ar); await sleep(100); await page.reload(); await sleep(900);
  assert(await page.getAttribute(ar, 'aria-pressed') === 'false', 'off is remembered too');
  await page.click(ar); await sleep(100);

  // Sidebar toggles
  const left = '#ribbon [data-cmd=toggle-left]', right = '#tabbar [data-cmd=toggle-right]';
  assert(await page.$(left) && await page.$(right), 'the ribbon has a left sidebar toggle and the tab bar a right one');
  assert(!(await page.$('#viewbar [data-cmd=toggle-right]')), 'the old one in the note header is gone');
  await page.click(left); await sleep(200);
  assert(await page.evaluate(() => document.body.classList.contains('app-no-left') && getComputedStyle(document.querySelector('#left')).display === 'none'), 'the left toggle hides the left sidebar');
  await page.click(left); await sleep(200);
  assert(await page.evaluate(() => !document.body.classList.contains('app-no-left')), 'and brings it back');
  await page.click(right); await sleep(200);
  assert(await page.evaluate(() => document.body.classList.contains('app-no-right')), 'the right toggle hides the right sidebar');
  const rb = await page.locator(right).boundingBox(), tb = await page.locator('#tabbar').boundingBox();
  assert(rb.x + rb.width > tb.x + tb.width - 60, 'it sits at the right end of the tab bar');
  await page.click(right); await sleep(200);
  assert(await page.evaluate(() => !document.body.classList.contains('app-no-right')), 'and brings it back');
  await page.screenshot({ path: SP + '/treebtns.png', clip: { x: 0, y: 0, width: 1200, height: 140 } });

  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
