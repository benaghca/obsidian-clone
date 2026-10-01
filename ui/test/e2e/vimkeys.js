// Vim mode owns the Ctrl keys Vim uses while the cursor is in a note (and only while Vim is on);
// the top bar's box opens the quick switcher, so the app's commands are a click away regardless.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const TEXT = Array.from({ length: 200 }, (_, i) => `line ${i} word 7`).join('\n') + '\n';
(async () => {
  w('Page.md', TEXT);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = []; global.PAGE = page;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(800);
  await page.evaluate(() => openPath('Page.md')); await sleep(600);
  const snap = () => page.evaluate(() => ({ modal: $('#modal-root').children.length, view: S.view, mode: S.mode, cur: S.cur, val: ed.value }));
  // Press `key` in the editor (after `prep`, e.g. 'i' for insert mode); what changed in the app.
  const press = async (key, prep) => {
    await page.evaluate(t => { while ($('#modal-root').children.length) $('#modal-root').lastChild.remove(); if (S.cur !== 'Page.md' || S.view !== 'note') openPath('Page.md', { push: false }); setMode('edit'); if (ed.value !== t) ed.value = t; ed.focus(); const p = ed.value.indexOf('line 50'); ed.setSelectionRange(p, p); }, TEXT);
    await sleep(250);
    if (await page.evaluate(() => cfg.vim)) { await page.keyboard.press('Escape'); if (prep) await page.keyboard.press(prep); }
    const a = await snap();
    await page.keyboard.press(key); await sleep(300);
    const b = await snap();
    return { app: b.modal !== a.modal || b.view !== a.view || b.mode !== a.mode || b.cur !== a.cur, edited: b.val !== a.val };
  };

  console.log('Vim off: the app’s shortcuts work in the editor');
  let r = await press('Control+e');
  assert(r.app, 'Ctrl+E switches to reading view');
  r = await press('Control+b');
  assert(r.edited, 'Ctrl+B is bold');

  console.log('Vim on');
  await page.evaluate(() => { cfg.vim = true; ed.setVim(true); }); await sleep(300);
  for (const k of ['n', 'p', 'e', 'g', 'o']) {
    r = await press('Control+' + k, 'i');
    assert(!r.app && !r.edited, `insert mode: Ctrl+${k.toUpperCase()} doesn’t reach the app`);
  }
  for (const k of ['b', 'i', 'k', 'm']) {
    r = await press('Control+' + k, 'i');
    assert(!r.edited, `insert mode: Ctrl+${k.toUpperCase()} isn’t a formatting key`);
  }
  r = await press('Control+a', 'i');
  assert(await page.evaluate(() => ed.selectionStart === ed.selectionEnd), 'insert mode: Ctrl+A doesn’t select the whole note');
  r = await press('Control+w', 'A');
  assert(r.edited && await page.evaluate(() => /^line 50 word $/m.test(ed.value)), 'insert mode: Ctrl+W still deletes a word (Vim)');
  for (const k of ['g', 'k', 'm']) {
    r = await press('Control+' + k);
    assert(!r.app && !r.edited, `normal mode: Ctrl+${k.toUpperCase()} doesn’t reach the app or edit`);
  }
  await press('Control+d');
  assert(await page.evaluate(() => ed.selectionStart > ed.value.indexOf('line 51')), 'normal mode: Ctrl+D still moves down half a page (Vim)');
  r = await press('Control+;');
  assert(r.edited, 'keys Vim doesn’t use (Ctrl+; adds a property) still work');
  r = await press('Control+/');
  assert(r.app, 'and so do app keys Vim doesn’t use (Ctrl+/)');
  await page.evaluate(() => { while ($('#modal-root').children.length) $('#modal-root').lastChild.remove(); });
  await page.click('#tree'); await page.keyboard.press('Control+e'); await sleep(300);
  assert(await page.evaluate(() => S.mode === 'read'), 'outside the editor, Ctrl+E is still the app’s');

  console.log('Settings → Hotkeys says which keys Vim takes');
  await page.evaluate(() => openHotkeys('quick switcher')); await sleep(300);
  assert(/Vim, in the editor/.test(await page.textContent('.hk-row[data-id=switcher]')), 'the quick switcher’s Ctrl+O is marked');
  await page.evaluate(() => { while ($('#modal-root').children.length) $('#modal-root').lastChild.remove(); cfg.vim = false; ed.setVim(false); });

  console.log('the top bar');
  const bar = await page.$eval('#topbar', b => { const r = b.getBoundingClientRect(); return { top: r.top, w: r.width }; });
  assert(bar.top === 0 && bar.w === 1300, 'runs across the top of the window');
  assert(await page.textContent('#cmdbox kbd') === 'Ctrl+O', 'its box shows the quick switcher’s key');
  await page.click('#cmdbox'); await sleep(300);
  assert(await page.evaluate(() => !!$('#modal-root input')), 'clicking it opens the quick switcher');
  await page.keyboard.type('>graph'); await sleep(200);
  assert(/Open graph view/.test(await page.textContent('#modal-root')), '> lists commands');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { cfg.hotkeys = { switcher: 'Mod-Shift-o' }; rebuildHotkeys(); });
  assert(await page.textContent('#cmdbox kbd') === 'Ctrl+Shift+O', 'and follows a changed hotkey');

  assert(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close();
})().catch(async e => { console.log(e.message); try { await global.PAGE.screenshot({ path: SP + '/shots/fail.png' }); } catch {} process.exit(1); });
