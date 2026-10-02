// Editing habits from Obsidian: Enter on an empty list item ends the list, a mark typed over a
// selection wraps it, rich text pastes as Markdown (plain with Ctrl+Shift+V, in code, or with
// the setting off), Tab and Enter in tables (as Advanced Tables), and moving list items with
// their children (as Outliner).
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  fs.writeFileSync(path.join(VAULT, 'Scratch.md'), '');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(800);
  await page.evaluate(() => { openPath('Scratch.md'); }); await sleep(400);
  await page.evaluate(() => setMode('edit')); await sleep(200);
  const set = async (text, at = text.length, to = at) => { await page.evaluate(([t, a, b]) => { ed.value = t; ed.focus(); ed.setSelectionRange(a, b); }, [text, at, to]); await sleep(60); };
  const val = () => page.evaluate(() => ed.value);
  // A paste as the browser sends one, with the clipboard's HTML and plain text.
  const paste = (html, text) => page.evaluate(([html, text]) => {
    const dt = new DataTransfer();
    if (html) dt.setData('text/html', html);
    dt.setData('text/plain', text);
    document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [html, text]).then(() => sleep(100));

  console.log('lists');
  await set('- item\n- '); await page.keyboard.press('Enter'); await sleep(60);
  assert(await val() === '- item\n', 'Enter on an empty item ends the list');
  await set('- item'); await page.keyboard.press('Enter'); await page.keyboard.type('next');
  assert(await val() === '- item\n- next', 'and on one with text carries it on');
  await set('- a\n\t- '); await page.keyboard.press('Enter'); await sleep(60);
  assert(await val() === '- a\n- ', 'an empty nested item goes up a level');

  console.log('marks over a selection');
  await set('word here', 0, 4); await page.keyboard.type('*');
  assert(await val() === '*word* here', '* wraps the selection');
  await page.keyboard.type('*');
  assert(await val() === '**word** here', 'and again makes it bold');
  assert(await page.evaluate(() => ed.value.slice(ed.selectionStart, ed.selectionEnd)) === 'word', 'the text stays selected');
  await set('word', 0, 4); await page.keyboard.type('`');
  assert(await val() === '`word`', '` makes it code');
  await set('word', 0, 0); await page.keyboard.type('*');
  assert(await val() === '*word', 'with nothing selected, * is just typed');

  console.log('tables');
  const sel = () => page.evaluate(() => ed.value.slice(ed.selectionStart, ed.selectionEnd));
  await set('| a | b |\n|---|:-:|\n| 1 | 22 |', 22);
  await page.keyboard.press('Tab'); await sleep(60);
  assert(await val() === '| a   |  b  |\n| --- | :-: |\n| 1   | 22  |', 'Tab lines the columns up, keeping the alignment: ' + JSON.stringify(await val()));
  assert(await sel() === '22', 'and selects the next cell');
  await page.keyboard.press('Tab'); await page.keyboard.type('x'); await sleep(60);
  assert(/\| 1   \| 22  \|\n\| x +\| +\|$/.test(await val()), 'Tab from the last cell starts a new row, typing going into its first cell: ' + JSON.stringify(await val()));
  await page.keyboard.press('Shift+Tab'); await sleep(60);
  assert(await sel() === '22', 'Shift+Tab goes back');
  await set('| a | b |\n|---|---|\n| 1 | 2 |', 26); await page.keyboard.press('Enter'); await page.keyboard.type('y'); await sleep(60);
  assert(/\| 1   \| 2   \|\n\| +\| y +\|$/.test(await val()), 'Enter goes to the same column of the next row: ' + JSON.stringify(await val()));
  await set('| link | n |\n|---|---|\n| [[A\\|b]] | 1 |', 30); await page.keyboard.press('Tab'); await sleep(60);
  assert((await val()).includes('| [[A\\|b]] | 1   |'), 'a \\| in a cell stays in the cell: ' + JSON.stringify(await val()));
  await set('Tab here'); await page.keyboard.press('Tab');
  assert(await val() === 'Tab here\t', 'outside a table, Tab is as before');

  console.log('moving list items');
  await set('- a\n\t- a1\n- b\n- c', 11);
  await page.keyboard.press('Control+Shift+ArrowUp'); await sleep(60);
  assert(await val() === '- b\n- a\n\t- a1\n- c', 'Ctrl+Shift+↑ moves an item above its neighbour, children and all: ' + JSON.stringify(await val()));
  await page.keyboard.press('Control+Shift+ArrowDown'); await page.keyboard.press('Control+Shift+ArrowDown'); await sleep(60);
  assert(await val() === '- a\n\t- a1\n- c\n- b', 'Ctrl+Shift+↓ moves it down: ' + JSON.stringify(await val()));
  await set('- a\n\t- a1\n- b', 0); await page.keyboard.press('Control+Shift+ArrowDown'); await sleep(60);
  assert(await val() === '- b\n- a\n\t- a1', 'an item takes its children along: ' + JSON.stringify(await val()));
  assert(await page.evaluate(() => ed.value.slice(ed.selectionStart).startsWith('- a')), 'the cursor stays on it');

  console.log('pasting rich text');
  const html = '<meta charset="utf-8"><h2>Title</h2><p>Some <b>bold</b>, <em>italic</em> and <a href="https://x.org/a b">a link</a>. Price: 5*3_x</p>'
    + '<ul><li>one<ul><li>nested</li></ul></li><li><input type="checkbox" checked> done</li></ul><ol start="3"><li>three</li></ol>'
    + '<blockquote><p>quoted</p></blockquote><pre><code class="language-js">let a = 1;\nlet b = 2;</code></pre>'
    + '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>x|y</td></tr></table><img src="https://x.org/p.png" alt="pic">';
  await set(''); await paste(html, 'plain');
  const want = '## Title\n\nSome **bold**, *italic* and [a link](https://x.org/a%20b). Price: 5\\*3\\_x\n\n- one\n\t- nested\n- [x] done\n\n3. three\n\n> quoted\n\n```js\nlet a = 1;\nlet b = 2;\n```\n\n| A | B |\n| --- | --- |\n| 1 | x\\|y |\n\n![pic](https://x.org/p.png)';
  const got = await val();
  assert(got === want, 'a web page’s HTML becomes Markdown' + (got === want ? '' : `:\n${JSON.stringify(got)}\nwanted\n${JSON.stringify(want)}`));
  await set('');
  await paste('<b style="font-weight:normal;" id="docs-internal-guid-1"><span style="font-weight:700">Bold</span><span style="font-weight:400"> and </span><span style="font-style:italic">italic</span></b>', 'Bold and italic');
  assert(await val() === '**Bold** and *italic*', 'Google Docs’ styled spans keep their bold and italic: ' + await val());
  await set('');
  await paste('<div style="font-family: monospace; white-space: pre;"><div><span style="color:#c586c0;">const</span> my_var = a*b;</div></div>', 'const my_var = a*b;');
  assert(await val() === 'const my_var = a*b;', 'code copied from an editor (just styled spans) pastes as its text');
  await set('```\n\n```', 4);
  await paste('<p><b>bold</b></p>', 'bold');
  assert(await val() === '```\nbold\n```', 'into a code block, plain text');
  await set('');
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('v'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await paste('<p><b>bold</b></p>', 'bold');
  assert(await val() === 'bold', 'Ctrl+Shift+V pastes plain text');
  await set('');
  await paste('<p>See <a class="internal-link" data-href="Notes/Garden.md" data-path="1">Garden</a> and <a class="internal-link" data-href="Plan.md" data-path="1">the plan</a>.</p>', 'See Garden and the plan.');
  assert(await val() === 'See [[Garden]] and [[Plan|the plan]].', 'links copied from reading view paste back as [[links]]: ' + await val());
  await page.evaluate(() => { cfg.pasteHtml = false; }); await set('');
  await paste('<p><b>bold</b></p>', 'bold');
  assert(await val() === 'bold', 'and so does any paste with the setting off');
  await page.evaluate(() => { cfg.pasteHtml = true; });

  assert(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
