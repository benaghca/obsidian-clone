const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault', OTHER = SP + '/vaults';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  fs.rmSync(OTHER, { recursive: true, force: true });
  fs.mkdirSync(OTHER + '/Research', { recursive: true });
  fs.writeFileSync(OTHER + '/Research/Paper.md', '# Paper\n');
  fs.writeFileSync(VAULT + '/Home note.md', '# Home\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push('console: ' + m.text()); }); // (the typed path that isn't there)
  page.on('dialog', d => d.accept());
  // (Cinder asks with its own dialog now: say yes, as the browser dialog handler did)
  await page.addInitScript(() => new MutationObserver(() => document.querySelector('.confirm [data-c="1"]')?.click()).observe(document, { childList: true, subtree: true }));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const browseTo = async p => { await page.evaluate(p => { const b = document.createElement('button'); b.dataset.go = p; document.querySelector('.vs-panel').append(b); b.click(); b.remove(); }, p); await sleep(300); };
  const vaultName = () => page.$eval('#vault-name', e => e.textContent.trim());

  await page.click('#vault-name'); await sleep(300);
  assert(await page.$('.vs .vs-row.current .vs-badge'), 'clicking the vault name opens the switcher, with this vault marked');
  await page.click('.vs [data-a=open]'); await sleep(500);
  assert(await page.$('.vs .vs-browse'), 'without a system picker, Open folder… shows a folder browser');
  await browseTo(OTHER);
  assert(await page.$('.vs-dir >> text=Research'), 'it lists the folders there');
  await page.click('.vs-dir >> text=Research'); await sleep(300);
  assert(/This folder has notes/.test(await page.$eval('.vs-note', e => e.textContent)), 'and says when a folder already has notes');
  await Promise.all([page.waitForNavigation(), page.click('.vs [data-b=use]')]); await sleep(900);
  assert(/research/i.test(await vaultName()) && await page.$('#tree .t-row[data-path="Paper.md"]'), 'Use this folder switches to it');

  await page.click('#vault-name'); await sleep(300);
  const rows = await page.$$eval('.vs-row b', b => b.map(x => x.textContent));
  assert(rows[0] === 'Research' && rows.includes('vault'), 'the recent list has both, newest first: ' + rows);
  await page.keyboard.press('ArrowDown'); await sleep(50);
  await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]); await sleep(900);
  assert(await page.$('#tree .t-row[data-path="Home note.md"]'), 'picking one from the list (↓ Enter) switches back');

  await page.click('#vault-name'); await sleep(300);
  await page.click('.vs [data-a=create]'); await sleep(200);
  await page.fill('.vs-create input[name=n]', 'Fresh');
  await page.click('.vs-create [data-c=where]'); await sleep(500);
  await browseTo(OTHER);
  await page.click('.vs [data-b=use]'); await sleep(300);
  assert((await page.$eval('.vs-loc span', e => e.textContent)) === OTHER && (await page.inputValue('.vs-create input[name=n]')) === 'Fresh', 'Create: the location comes from the browser and the name stays');
  await Promise.all([page.waitForNavigation(), page.click('.vs-create .btn.primary')]); await sleep(900);
  assert(fs.existsSync(OTHER + '/Fresh') && /fresh/i.test(await vaultName()), 'Create and open makes the folder and opens it');

  await page.click('#vault-name'); await sleep(300);
  await page.hover('.vs-row:has-text("Research")'); await page.click('.vs-row:has-text("Research") .vs-forget'); await sleep(300);
  assert(!(await page.$('.vs-row:has-text("Research")')) && fs.existsSync(OTHER + '/Research'), '× removes a vault from the list and leaves the folder alone');
  fs.rmSync(OTHER + '/Research', { recursive: true, force: true });
  await page.keyboard.press('Escape'); await sleep(100);
  assert(!(await page.$('.vs')), 'Esc closes it');
  await page.click('#vault-name'); await sleep(300);
  await page.click('.vs [data-a=typed]'); await sleep(200);
  await page.fill('#modal-root .modal:last-child input', OTHER + '/Nope'); await page.keyboard.press('Enter'); await sleep(500);
  assert(await page.$('.toast') && /no folder/i.test(await page.$eval('.toast', t => t.textContent)), 'typing a path that doesn\'t exist says so (and makes nothing)');
  assert(!fs.existsSync(OTHER + '/Nope'), 'no stray folder appears');

  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
