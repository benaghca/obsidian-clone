// Editing habits from Obsidian: Enter on an empty list item ends the list, a mark typed over a
// selection wraps it, rich text pastes as Markdown (plain with Ctrl+Shift+V, in code, or with
// the setting off), Tab and Enter in tables (as Advanced Tables), and moving list items with
// their children (as Outliner), and fenced code blocks: fences hidden until the cursor comes in,
// closed on Enter, and a way out below one that ends the note.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  fs.writeFileSync(path.join(VAULT, 'Scratch.md'), '');
  fs.writeFileSync(path.join(VAULT, 'Project Plan.md'), '---\naliases: [Roadmap]\n---\n# Project Plan\n\nShip it soon. ^goal1\n\nKeep it small\nand simple.\n');
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

  console.log('fenced code blocks');
  const fenceLines = () => page.$$eval('.cm-content .cm-line.cm-codeblock', ls => ls.map(l => l.textContent));
  await set('Before\n\n```js\nlet a = 1;\n```\n\nAfter', 0); await sleep(150);
  assert((await fenceLines()).join('|') === 'js|let a = 1;|', 'with the cursor elsewhere, the ``` lines are hidden and the language shows: ' + (await fenceLines()).join('|'));
  await page.evaluate(() => ed.setSelectionRange(ed.value.indexOf('let a'))); await sleep(150);
  assert((await fenceLines()).join('|') === '```js|let a = 1;|```', 'with it in the block, they show: ' + (await fenceLines()).join('|'));
  await set('Intro\n'); await page.keyboard.type('```py'); await page.keyboard.press('Enter'); await page.keyboard.type('x = 1');
  assert(await val() === 'Intro\n```py\nx = 1\n```', 'Enter on an opening fence closes the block, the cursor inside: ' + JSON.stringify(await val()));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.type('after');
  assert(await val() === 'Intro\n```py\nx = 1\n```\nafter', '↓ at the end of the note leaves the block: ' + JSON.stringify(await val()));
  await set('```\nno closing fence', 18); await page.keyboard.press('ArrowDown'); await page.keyboard.type('out');
  assert(await val() === '```\nno closing fence\n```\nout', 'and closes one that wasn’t closed: ' + JSON.stringify(await val()));
  await set('```js\na\n```\n\n```', 5); await page.keyboard.press('Enter'); await sleep(60);
  assert(await val() === '```js\n\na\n```\n\n```', 'Enter on a fence that’s already closed is just a new line: ' + JSON.stringify(await val()));

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

  console.log('quotes and callouts');
  await set('> [!tip] Remember'); await page.keyboard.press('Enter'); await page.keyboard.type('bring snacks'); await page.keyboard.press('Enter');
  assert(await val() === '> [!tip] Remember\n> bring snacks\n> ', 'Enter in a callout carries on in it: ' + JSON.stringify(await val()));
  await page.keyboard.press('Enter'); await page.keyboard.type('After');
  assert(await val() === '> [!tip] Remember\n> bring snacks\n\nAfter', 'and Enter on its empty line ends it (with a blank line, so what follows isn’t still in it): ' + JSON.stringify(await val()));
  await set('> outer\n> > inner'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  assert(await val() === '> outer\n> > inner\n>\n> ', 'a quote in a quote ends a level at a time: ' + JSON.stringify(await val()));

  console.log('folding');
  await set('# Plan\n\n## Goals\n\nShip it.\nMore.\n\n## Tasks\n\n- Design\n  - sketch\n- Build\n', 0);
  const lines = () => page.$$eval('#editor .cm-line', ls => ls.map(l => l.textContent).filter(Boolean).join(' / '));
  assert(await page.$$eval('#editor .cm-fold-arrow', a => a.length) === 4, 'headings and a list item with sub-items get a fold arrow');
  await page.hover('#editor .cm-line:has-text("Goals")'); await page.click('#editor .cm-line:has-text("Goals") .cm-fold-arrow'); await sleep(150);
  assert(!(await lines()).includes('Ship it') && (await lines()).includes('Tasks') && (await val()).includes('Ship it.'), 'its arrow folds a heading’s section away (just from view): ' + await lines());
  await page.hover('#editor .cm-line:has-text("Design")'); await page.click('#editor .cm-line:has-text("Design") .cm-fold-arrow'); await sleep(150);
  assert(!(await lines()).includes('sketch') && (await lines()).includes('Build'), 'and a list item’s sub-items: ' + await lines());
  await page.click('#editor .cm-foldPlaceholder >> nth=0'); await sleep(150);
  assert((await lines()).includes('Ship it'), 'clicking … opens it again');
  await page.click('#editor .cm-line:has-text("More.")'); await page.keyboard.press('Control+Shift+BracketLeft'); await sleep(150);
  assert(!(await lines()).includes('More.'), 'Ctrl+Shift+[ folds the section the cursor is in');
  await page.keyboard.press('Control+Shift+BracketRight'); await sleep(150);
  assert((await lines()).includes('More.'), 'Ctrl+Shift+] unfolds it');
  await page.keyboard.press('Control+Alt+BracketLeft'); await sleep(150);
  assert((await lines()) === 'Plan…', 'Ctrl+Alt+[ folds everything: ' + await lines());
  await page.keyboard.press('Control+Alt+BracketRight'); await sleep(150);
  assert((await lines()).includes('sketch'), 'and Ctrl+Alt+] opens it all');

  console.log('clicking a rendered table');
  await set('# T\n\n| Name | Qty |\n|---|---|\n| apples | 3 |\n\nafter', 0);
  await page.evaluate(() => ed.view.contentDOM.blur()); await sleep(150);
  const cellAt = async t => { const b = await (await page.$(`#editor .cm-table-widget :is(td,th):text-is("${t}")`)).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(150); };
  const caret = () => page.evaluate(() => { const v = ed.view, h = v.state.selection.main.head, l = v.state.doc.lineAt(h); return l.text.slice(0, h - l.from) + '‸' + l.text.slice(h - l.from); });
  await cellAt('3');
  assert(await caret() === '| apples | 3‸ |', 'a click on a table’s cell puts the cursor at the end of that cell: ' + await caret());
  await page.keyboard.type('0');
  assert((await val()).includes('| apples | 30 |'), 'ready to type there');

  console.log('link completion');
  const complete = async (text, typed, keys = ['Enter']) => {
    await set(text); await page.keyboard.type(typed); await sleep(400);
    for (const k of keys) await page.keyboard.press(k);
    await sleep(700);
  };
  await complete('', '[[Road');
  assert(await val() === '[[Project Plan|Roadmap]]', 'an alias goes in as the note writes it: ' + await val());
  await complete('| a | b |\n|---|---|\n| ', '[[Road');
  assert((await val()).endsWith('| [[Project Plan\\|Roadmap]]'), 'and in a table its | is written \\| so the cell holds: ' + JSON.stringify(await val()));
  await complete('', '[[Project Plan#^goal');
  assert(await val() === '[[Project Plan#^goal1]]', '#^ finds a block by its id');
  await complete('', '[[Project Plan#^small');
  const id = /#\^(\w+)\]\]$/.exec(await val())?.[1];
  assert(id && fs.readFileSync(path.join(VAULT, 'Project Plan.md'), 'utf8').includes('and simple. ^' + id), 'or by its text, and one without an id gets one: ' + await val());

  console.log('moving sections in the Outline');
  await set('# Plan\n\n## A\n\na text\n\n### A1\n\na1\n\n## B\n\nb text\n\n## C\n\nc text', 0);
  await page.evaluate(async () => { await save(); showRight('outline'); }); await sleep(300);
  const orow = t => `#right-body .o-item[data-heading="${t}"]`;
  await page.dragAndDrop(orow('A'), orow('C'), { targetPosition: { x: 20, y: 18 } }); await sleep(600);
  assert(await val() === '# Plan\n\n## B\n\nb text\n\n## C\n\nc text\n\n## A\n\na text\n\n### A1\n\na1\n', 'dragging a heading below another moves its section, the headings inside it too: ' + JSON.stringify(await val()));
  assert(await page.$$eval('#right-body .o-item', r => r.map(x => x.textContent).join()) === 'Plan,B,C,A,A1', 'and the Outline follows');
  await page.click('#editor .cm-content'); await page.keyboard.press('Control+z'); await sleep(200);
  assert((await val()).startsWith('# Plan\n\n## A\n'), 'Ctrl+Z puts it back');
  await page.evaluate(async () => { await save(); refreshPanels(); }); await sleep(300);
  await page.dragAndDrop(orow('C'), orow('A'), { targetPosition: { x: 20, y: 2 } }); await sleep(600);
  assert(await val() === '# Plan\n\n## C\n\nc text\n\n## A\n\na text\n\n### A1\n\na1\n\n## B\n\nb text\n', 'dropped on the top half, it goes before: ' + JSON.stringify(await val()));
  await page.evaluate(() => showRight('backlinks'));

  console.log('bold and italic together');
  await set('a word here', 2, 6); await page.keyboard.press('Control+b'); await page.keyboard.press('Control+i');
  assert(await val() === 'a ***word*** here', 'Ctrl+I on bold makes it bold italic, not italic: ' + await val());
  await page.keyboard.press('Control+b');
  assert(await val() === 'a *word* here', 'Ctrl+B then takes the bold off, leaving it italic: ' + await val());
  await page.keyboard.press('Control+i');
  assert(await val() === 'a word here', 'and Ctrl+I the italic: ' + await val());
  await set('a **word** here', 2, 10); await page.keyboard.press('Control+b');
  assert(await val() === 'a word here', 'Ctrl+B on a selection that has the ** in it takes them off: ' + await val());
  await set('a ~~word~~ here', 4, 8); await page.evaluate(() => ed.run('strikethrough'));
  assert(await val() === 'a word here', 'and strikethrough still toggles off: ' + await val());

  console.log('the app’s keys from the editor');
  await set('Some text', 4);
  await page.keyboard.press('Control+Shift+f'); await sleep(300);
  assert(await page.evaluate(() => document.activeElement.closest('#left') !== null) && !(await page.$('#editor .cm-search')), 'Ctrl+Shift+F in a note opens the search in all notes, not the note’s find bar');
  await set('Some text', 4);
  await page.keyboard.press('Control+Shift+b'); await sleep(300);
  assert(await val() === 'Some text' && await page.evaluate(() => !$('#right').hidden && /backlink/i.test($('#right .active, #right [aria-selected=true]')?.textContent || $('#right-body').textContent)), 'Ctrl+Shift+B shows the backlinks rather than making bold');

  assert(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
