const { chromium } = require('playwright-core');
const fs = require('fs');
const SP = process.env.SP, OUT = SP + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; global.PAGE = page;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  fs.writeFileSync(SP + '/vault/Theme test.md', '# Heading\n\nSome **bold** text with a [[Welcome]] link and #tag.\n\n> [!warning] Careful\n> A callout\n\n> [!tip] Tip\n> Another\n\n```js\nconst x = "string"; // comment\nfunction f(a) { return 42; }\n```\n\n- [ ] task\n==highlight==\n');
  await page.goto('http://127.0.0.1:43199/'); await sleep(700);
  await page.keyboard.press('Control+o'); await page.keyboard.type('Theme test'); await page.keyboard.press('Enter'); await sleep(500);
  const v = n => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), n);
  const def = await v('--bg');
  // settings: Catppuccin Mocha, dark
  await page.evaluate(() => openSettings('appearance'));
  await page.selectOption('select[name=theme]', 'dark');
  await page.click('.st-theme[data-id=catppuccin-mocha]');
  await page.click('.st [data-x]'); await sleep(300);
  assert(await v('--bg') === '#1e1e2e' && await v('--accent') === '#cba6f7', 'Catppuccin Mocha applied from Settings');
  await page.screenshot({ path: OUT + '/30-mocha.png' });
  await page.click('[data-cmd=theme]'); await sleep(300);
  assert(await v('--bg') === '#eff1f5', 'light mode switches Catppuccin to Latte');
  await page.screenshot({ path: OUT + '/31-latte.png' });
  // palette picker with preview
  await page.keyboard.press('Control+p'); await page.keyboard.type('colour theme'); await page.keyboard.press('Enter'); await sleep(200);
  await page.keyboard.type('everforest'); await sleep(200);
  assert(await v('--bg') === '#fdf6e3', 'picker previews Everforest while highlighted');
  await page.keyboard.press('Escape'); await sleep(200);
  assert(await v('--bg') === '#eff1f5', 'Escape restores the previous theme');
  await page.keyboard.press('Control+p'); await page.keyboard.type('colour theme'); await page.keyboard.press('Enter'); await sleep(200);
  await page.keyboard.type('everforest'); await page.keyboard.press('Enter'); await sleep(200);
  await page.click('[data-cmd=theme]'); await sleep(300);
  assert(await v('--bg') === '#2d353b', 'Everforest dark chosen and kept');
  await page.screenshot({ path: OUT + '/32-everforest.png' });
  await page.reload(); await sleep(800);
  assert(await v('--bg') === '#2d353b', 'theme persists across reload');
  // graph and drawing pick it up
  await page.keyboard.press('Control+g'); await sleep(500);
  await page.screenshot({ path: OUT + '/33-graph.png' });
  await page.click('[data-cmd=new-drawing]'); await sleep(400);
  const px = await page.evaluate(() => { const c = document.querySelector('.dr-canvas'); const d = c.getContext('2d').getImageData(c.width - 20, c.height - 20, 1, 1).data; return '#' + [d[0], d[1], d[2]].map(x => x.toString(16).padStart(2, '0')).join(''); });
  assert(px === '#2d353b', 'drawing canvas uses the theme background (' + px + ')');
  // back to default clears overrides
  await page.evaluate(() => { cfg.palette = 'default'; saveCfg(); applyTheme(); });
  assert(await v('--bg') === '#17110f', 'the default theme (Volcanic) comes back');
  console.log('default bg was', def);
  console.log('ERRORS:', errors.join('\n') || 'none');
  await browser.close();
})().catch(async e => { console.error(e.message); try { await global.PAGE.screenshot({ path: OUT + '/fail.png' }); } catch {} process.exit(1); });
