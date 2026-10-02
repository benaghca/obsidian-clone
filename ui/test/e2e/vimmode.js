// Vim mode: j/k through wrapped paragraphs, the system clipboard as the unnamed register, the
// vault's .obsidian.vimrc, and the mode in the status bar.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const LONG = 'Long ' + 'words that wrap across the page '.repeat(14).trim() + '.';
const TEXT = `${LONG}\nshort one\nshort two\nshort three\n`;
(async () => {
  w('Page.md', TEXT);
  w('.obsidian.vimrc', '" my mappings\nimap jk <Esc>\nnmap H ^\n\ns/short/long/g\n');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:43199' });
  const page = await ctx.newPage();
  const errors = []; global.PAGE = page;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(800);
  await page.evaluate(() => openPath('Page.md')); await sleep(500);
  await page.evaluate(() => { cfg.vim = true; applyTheme(); setMode('edit'); }); await sleep(500);
  const reset = async (at = 0) => {
    await page.evaluate(([t, at]) => { if (ed.value !== t) ed.value = t; ed.focus(); ed.setSelectionRange(at, at); }, [TEXT, at]);
    await sleep(100); await page.keyboard.press('Escape'); await sleep(50);
  };
  const pos = () => page.evaluate(() => ed.selectionStart);
  const lineOf = p => TEXT.slice(0, p).split('\n').length - 1;

  console.log('j/k through a wrapped paragraph');
  const rows = await page.evaluate(() => Math.round(document.querySelector('.cm-line').getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector('.cm-line')).lineHeight)));
  assert(rows >= 3, `the first paragraph wraps onto ${rows} rows`);
  await reset();
  await page.keyboard.press('j'); await sleep(100);
  const p1 = await pos();
  assert(lineOf(p1) === 0 && p1 > 20, `j goes down a row inside the paragraph (to ${p1})`);
  await page.keyboard.press('k'); await sleep(100);
  assert(await pos() === 0, 'k comes back up');
  await page.keyboard.press('ArrowDown'); await sleep(100);
  assert(lineOf(await pos()) === 0 && await pos() > 20, '↓ does the same');
  await reset();
  await page.keyboard.type('1j'); await sleep(100);
  assert(lineOf(await pos()) === 1, 'with a count, j counts lines (1j is the next line)');
  await reset();
  await page.keyboard.type('dj'); await sleep(150);
  assert(await page.evaluate(() => ed.value) === 'short two\nshort three\n', 'dj deletes this line and the next, whole');

  console.log('the system clipboard');
  await reset(TEXT.indexOf('short two'));
  await page.keyboard.type('yy'); await sleep(200);
  assert(await page.evaluate(() => navigator.clipboard.readText()) === 'short two\n', 'yy puts the line on the system clipboard');
  await page.evaluate(() => navigator.clipboard.writeText('EXTERNAL'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(200);
  await reset(TEXT.indexOf('short one'));
  await page.keyboard.press('p'); await sleep(150);
  assert(await page.evaluate(() => ed.value.includes('sEXTERNALhort one')), 'p pastes what was copied elsewhere');

  console.log('.obsidian.vimrc');
  assert(/skipped a line.*s\/short\/long\/g/.test(await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' '))), 'a line that isn’t a mapping or set is skipped, and named');
  assert(await page.evaluate(() => !ed.value.includes('long one')), 'and doesn’t run');
  await reset(TEXT.indexOf('short one'));
  await page.keyboard.type('Ajk'); await sleep(150);
  assert(await page.evaluate(() => ed.value.includes('short one\n') && !ed.value.includes('jk')), 'imap jk <Esc> leaves insert mode');
  assert(/NORMAL/.test(await page.textContent('#statusbar')), 'back in normal mode');
  w('.obsidian.vimrc', 'imap jk <Esc>\nnmap L $\n');
  await page.evaluate(() => { loadVimrc(); cfg.vim = false; applyTheme(); }); await sleep(300);
  await page.evaluate(() => { cfg.vim = true; applyTheme(); }); await sleep(300);
  await reset(TEXT.indexOf('short one'));
  await page.keyboard.press('L'); await sleep(100);
  assert(await pos() >= TEXT.indexOf('short one') + 'short one'.length - 1, 'a vimrc read while Vim went off is applied when it comes back on');
  w('.obsidian.vimrc', 'nmap H ^\n'.repeat(8000));
  for (let i = 0; i < 2; i++) { await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(300); }
  assert(await page.evaluate(() => [...document.querySelectorAll('.toast')].filter(t => /Couldn’t read/.test(t.textContent)).length) === 1, 'a vimrc that can’t be read says so once, not on every focus');

  let vimrcReads = 0;
  page.on('request', q => { if (q.url().includes('/api/vimrc')) vimrcReads++; });
  await page.evaluate(() => { for (let i = 0; i < 5; i++) applyTheme(); }); await sleep(300);
  assert(vimrcReads === 0, 'theme changes with Vim on (a palette hovered…) don’t read the vimrc again: ' + vimrcReads);

  console.log('the mode in the status bar');
  await reset();
  assert(await page.textContent('#statusbar .sb-vim') === 'NORMAL', 'NORMAL');
  await page.keyboard.press('i'); await sleep(100);
  assert(await page.textContent('#statusbar .sb-vim') === 'INSERT', 'INSERT');
  await page.keyboard.press('Escape'); await page.keyboard.press('V'); await sleep(100);
  assert(await page.textContent('#statusbar .sb-vim') === 'VISUAL LINE', 'VISUAL LINE');
  await page.keyboard.press('Escape'); await page.keyboard.type('d2'); await sleep(100);
  assert(/NORMAL\s*d2/.test(await page.textContent('#statusbar .sb-vim')), 'and a command being typed: ' + await page.textContent('#statusbar .sb-vim'));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { cfg.vim = false; applyTheme(); }); await sleep(200);
  assert(!(await page.$('#statusbar .sb-vim')), 'gone with Vim off');

  assert(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close();
})().catch(async e => { console.log(e.message); try { await global.PAGE.screenshot({ path: SP + '/shots/fail.png' }); } catch {} process.exit(1); });
