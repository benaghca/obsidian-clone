// Converter unit cases run in Chromium's real inert DOMParser (no DOM shim
// or dependency), followed by trusted clipboard/keyboard integration checks.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
const cases = [
  ['bold and italic', '<p><b>bold</b> <strong>strong</strong> <i>italic</i> <em>em</em></p>', '**bold** **strong** _italic_ _em_'],
  ['strike', '<s>one</s> <del>two</del>', '~~one~~ ~~two~~'],
  ['nested inline', '<strong>bold <em>italic</em></strong>', '**bold _italic_**'],
  ['inline code', '<code>a`b</code>', '``a`b``'],
  ['code backtick edges', '<code>`edge`</code>', '`` `edge` ``'],
  ['fenced code preserves whitespace', '<pre><code class="language-js">  let x = 1;\n\n  // hi\n</code></pre>', '```js\n  let x = 1;\n\n  // hi\n```'],
  ['safe code fence', '<pre class="language-md">```\nx\n```</pre>', '````md\n```\nx\n```\n````'],
  ['links', '<a href="https://example.com/doc">the docs</a>', '[the docs](https://example.com/doc)'],
  ['bare URL', '<a href="https://example.com">https://example.com</a>', 'https://example.com'],
  ['link spaces and parentheses', '<a href="https://example.com/a (b)">docs</a>', '[docs](https://example.com/a%20%28b%29)'],
  ['nested numbered list', '<ol start="3"><li>three<ul><li>nested</li></ul></li><li>four</li></ol>', '3. three\n    - nested\n4. four'],
  ['ordered list starts at zero', '<ol start="0"><li>zero</li><li>one</li></ol>', '0. zero\n1. one'],
  ['nested ordered list', '<ul><li>first<ol start="7"><li>seven</li><li>eight</li></ol></li><li>last</li></ul>', '- first\n    7. seven\n    8. eight\n- last'],
  ['tasks', '<ul><li><input type="checkbox">todo</li><li><input type="checkbox" checked>done</li></ul>', '- [ ] todo\n- [x] done'],
  ['nested task belongs to child', '<ul><li>parent<ul><li><input type="checkbox" checked>done</li></ul></li></ul>', '- parent\n    - [x] done'],
  ...Array.from({length: 6}, (_, i) => [`heading ${i + 1}`, `<h${i + 1}>Heading</h${i + 1}>`, '#'.repeat(i + 1) + ' Heading']),
  ['nested quote', '<blockquote><p>quote</p><blockquote>inner</blockquote></blockquote>', '> quote\n> \n> > inner'],
  ['code in quote', '<blockquote><pre>  x\n\n y</pre></blockquote>', '> ```\n>   x\n> \n>  y\n> ```'],
  ['paragraph div break rule', '<p>one<br>two</p><div>three</div><hr>', 'one  \ntwo\n\nthree\n\n---'],
  ['plain paragraphs', '<p>one</p><p>two</p>', null],
  ['browser whitespace', '<p>  one\n  <b> two </b>   three &amp; four&nbsp;five</p>', 'one **two** three & four five'],
  ['literal punctuation follows Obsidian', '<p>*star* _under_ [square] \\path | pipe <b>bold</b></p>', '*star* _under_ [square] \\path | pipe **bold**'],
  ['Google Docs wrapper', '<b style="font-weight:normal" id="docs-internal-guid-123"><p>normal <strong>bold</strong></p></b>', 'normal **bold**'],
  ['Office junk', '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>.MsoNormal{color:red}</style></head><body><!--StartFragment--><p class="MsoNormal" style="mso-margin-top-alt:auto">Word <b>bold</b><o:p>&nbsp;</o:p></p><!--EndFragment--></body></html>', 'Word **bold**'],
  ['Office list marker junk', '<ul><li><span style="mso-list:Ignore">•&nbsp;</span>one</li></ul>', '- one'],
  ['drop active content', '<script>window.pasteRan=1</script><style>x{}</style><!--junk--><iframe src="https://example.com"></iframe><b>safe</b>', '**safe**'],
  ['remote image stays text', '<img alt="remote" src="https://example.com/pic.png">', '![remote](https://example.com/pic.png)'],
  ['table', '<table><tr><th>A</th><th>B</th></tr><tr><td>a|b</td><td><b>bold</b><br>end</td></tr></table>', '|A|B|\n|---|---|\n|a\\|b|**bold**<br>end|'],
  ['table code pipe', '<table><tr><th>A</th></tr><tr><td><code>a|b</code></td></tr></table>', '|A|\n|---|\n|`a\\|b`|'],
  ['plain fragment', '<span>  literal *text*</span>', null],
  ['multiline editor wrapper', '<div style="font-family:monospace"><div><span style="color:red">line one</span></div><div>line two</div></div>', null],
  ['editor wrapper', '<div style="font-family:monospace">const value = 1;</div>', null],
];
await withBrowser(async ({ send, run, click, chord, key, press, check }) => {
  await send('Network.enable');
  await send('Page.bringToFront');
  const units = await run(async cases => {
    const { htmlToMarkdown } = await import('/src/editor/htmlToMarkdown.ts');
    return cases.map(([name, html]) => [name, htmlToMarkdown(html)]);
  }, cases);
  units.forEach(([name, result], i) => { assert.equal(result, cases[i][2], name); check(true, `converter: ${name}`); });
  check(await run(() => !window.pasteRan), 'inert conversion never runs scripts');
  // Fail attempted remote loads too, even if CSP would block them.
  await send('Performance.enable');
  check(await run(() => performance.getEntriesByType('resource').every(e => new URL(e.name).hostname === location.hostname)), 'inert converter never requests remote resources');
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await run(()=>{window.consoleErrors=[]; const error=console.error; console.error=(...args)=>{window.consoleErrors.push(args.map(String));error(...args)};});
  const prefix = '---\ntags: [paste]\n---\n\n';
  await run(async prefix => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Paste.md', prefix + 'START\n');
    await ws.vault.refreshFiles(); await ws.open('Paste.md');
    document.addEventListener('paste', event => { window.lastPaste = { trusted: event.isTrusted, types: [...event.clipboardData.types] }; }, true);
  }, prefix);
  const write = async (html, text) => run(async (html, text) => navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], {type:'text/html'}), 'text/plain': new Blob([text], {type:'text/plain'}) })]), html, text);
  const paste = async (html, plain, shift = false) => {
    await click('.cm-content .cm-line');
    await write(html, plain);
    await chord('End');
    if (shift) { await key('Control', 2); await key('Shift', 10); await press('V', 10); await key('Shift', 2, 'keyUp'); await key('Control', 0, 'keyUp'); }
    else await chord('v');
    await sleep(120);
  };
  const text = () => run(() => ws.view.state.doc.toString());
  const reset = async (body = 'START\n', position = null) => {
    await run((prefix, body, position) => {
      ws.view.dispatch({ changes: {from: prefix.length, to: ws.view.state.doc.length, insert: body}, selection: {anchor: position ?? prefix.length + body.length} });
    }, prefix, body, position);
    await sleep(80);
  };
  const html = '<p>From a web page: <b>important</b> point, see <a href="https://example.com/doc">the docs</a>.</p><ul><li>first</li><li>second</li></ul><h2>Heading</h2><table><tr><th>A</th><th>B</th></tr><tr><td>one</td><td>two</td></tr></table><p><img src="https://example.com/pic.png" alt="remote"></p>';
  const markdown = 'From a web page: **important** point, see [the docs](https://example.com/doc).\n\n- first\n- second\n\n## Heading\n\n|A|B|\n|---|---|\n|one|two|\n\n![remote](https://example.com/pic.png)';
  for (const mode of ['live', 'source']) {
    await run(mode => ws.setMode(mode), mode); await reset();
    await paste(html, 'PLAIN');
    assert.equal(await text(), prefix + 'START\n' + markdown);
    check(await run(() => lastPaste.trusted && lastPaste.types.includes('text/html') && lastPaste.types.includes('text/plain')), `${mode}: trusted native paste contains both clipboard types`);
    check(await run(() => ws.view.state.selection.main.empty && ws.view.state.selection.main.head === ws.view.state.doc.length), `${mode}: caret ends after converted Markdown`);
    await chord('z'); assert.equal(await text(), prefix + 'START\n');
    check(true, `${mode}: one undo removes the whole paste and keeps frontmatter`);
    await paste(html, 'PLAIN');
    await run(() => ws.setMode('reading')); await sleep(150);
    check(await run(() => !!document.querySelector('.cm-content .cm-strong') && !!document.querySelector('.cm-content .cm-h2') && !!document.querySelector('.cm-content table') && !!document.querySelector('.cm-remote-embed') && !document.querySelector('img[src^="https:"]')), `${mode} → Reading renders bold, heading, table and offline image chip`);
    await run(mode => ws.setMode(mode), mode); await reset();
    await paste('<b>bold</b>', 'plain *exact*\n', true);
    assert.equal(await text(), prefix + 'START\nplain *exact*\n');
    check(true, `${mode}: Ctrl+Shift+V preserves plain clipboard text exactly`);
    await reset(); await paste('<div style="font-family:monospace">literal</div>', '  *literal*\n\n');
    assert.equal(await text(), prefix + 'START\n  *literal*\n\n');
    check(true, `${mode}: unformatted editor HTML falls back to exact plain text`);
    await reset(); await paste('<div style="font-family:monospace"><div>one</div><div>two</div></div>', '  one\n  two\n');
    assert.equal(await text(), prefix + 'START\n  one\n  two\n');
    check(true, `${mode}: multiline editor wrappers preserve plain indentation and line breaks`);
    await reset();
    await run(async () => { const {settings} = await import('/src/settings/store.ts'); await settings.set('app.json', 'autoConvertHTML', false); });
    await paste('<b>bold</b>', 'PLAIN'); assert.equal(await text(), prefix + 'START\nPLAIN');
    check(true, `${mode}: disabled setting pastes plain text`);
    await run(async () => { const {settings} = await import('/src/settings/store.ts'); await settings.set('app.json', 'autoConvertHTML', true); });
    // Position with real keyboard after clicking; no script-dispatched paste.
    await reset('```js\ncode\n```\n'); await click('.cm-content'); await chord('End'); await press('ArrowUp'); await press('ArrowUp'); await press('End');
    await write('<b>bold</b>', 'PLAIN'); await chord('v'); await sleep(100);
    assert.equal(await text(), prefix + '```js\ncodePLAIN\n```\n');
    check(true, `${mode}: fenced code uses plain text`);
  }
  await run(() => ws.setMode('source')); await reset();
  await click('.cm-content'); await chord('Home'); await press('ArrowDown'); await press('End');
  await write('<b>bold</b>', 'PLAIN'); await chord('v'); await sleep(100);
  assert.equal(await text(), '---\ntags: [paste]PLAIN\n---\n\nSTART\n');
  check(true, 'Source: pasting inside frontmatter uses plain text');
  await chord('z');
  // URL selection behavior is preserved for Part B's separate caret change.
  await reset('word'); await click('.cm-content'); await chord('End');
  for (let i=0;i<4;i++) await press('ArrowLeft', 8);
  await run(() => navigator.clipboard.writeText('https://example.com'));
  await chord('v'); await sleep(100);
  assert.equal(await text(), prefix + '[word](https://example.com)');
  check(await run(() => ws.view.state.sliceDoc(ws.view.state.selection.main.from, ws.view.state.selection.main.to) === 'word'), 'URL-over-selection still leaves word selected (Part B untouched)');
  await reset('word'); await click('.cm-content .cm-line'); await chord('End');
  for (let i=0;i<4;i++) await press('ArrowLeft', 8);
  await key('Control', 2); await key('Shift', 10); await press('V', 10); await key('Shift', 2, 'keyUp'); await key('Control', 0, 'keyUp'); await sleep(100);
  assert.equal(await text(), prefix + 'https://example.com');
  check(true, 'Ctrl+Shift+V over selected text inserts the plain URL');
  await reset(); await click('.cm-content .cm-line'); await chord('End');
  await write('<b>menu bold</b>', 'menu plain');
  const end = await run(() => {const r=ws.view.coordsAtPos(ws.view.state.doc.length);return {x:r.left+1,y:(r.top+r.bottom)/2};});
  await click(end, 'right');
  const menuPaste = await run(() => {
    const el = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.querySelector('.menu-item-title')?.textContent === 'Paste');
    const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
  });
  await click(menuPaste); await sleep(150);
  assert.equal(await text(), prefix + 'START\n**menu bold**');
  check(true, 'Context-menu Paste reuses HTML conversion');
  await run(() => ws.setMode('reading')); await sleep(100);
  const beforeReading = await text();
  await write('<b>blocked</b>', 'blocked'); await click('.cm-content .cm-line'); await chord('v'); await sleep(100);
  assert.equal(await text(), beforeReading);
  check(true, 'Reading remains read-only on native paste');
  await run(() => ws.setMode('source')); await reset(); await click('.cm-content .cm-line'); await chord('End');
  await run(async () => {
    const canvas = document.createElement('canvas'); canvas.width=canvas.height=1;
    const png = await new Promise(resolve => canvas.toBlob(resolve));
    await navigator.clipboard.write([new ClipboardItem({'image/png':png,'text/html':new Blob(['<b>file HTML</b>'],{type:'text/html'}),'text/plain':new Blob(['FILE PLAIN'],{type:'text/plain'})})]);
  });
  await chord('v'); await sleep(100);
  assert.equal(await text(), prefix + 'START\nFILE PLAIN');
  check(await run(()=>lastPaste.types.includes('Files')), 'File-bearing native clipboard bypasses HTML converter (baseline file behavior)');
  await chord(','); await sleep(100);
  await click('[data-setting-id="editor"]');
  check(await run(() => [...document.querySelectorAll('.setting-item')].some(el => el.textContent.includes('Auto convert HTML'))), 'Settings → Editor exposes Auto convert HTML');
  await run(()=>document.querySelector('[role="switch"][aria-label="Auto convert HTML"]').scrollIntoView({block:'center'}));
  await click('[role="switch"][aria-label="Auto convert HTML"]');
  check(await run(async () => { const {settings} = await import('/src/settings/store.ts'); return !settings.get('app.json').autoConvertHTML; }), 'Editor toggle switches conversion off');
  await click('[role="switch"][aria-label="Auto convert HTML"]');
  check(await run(async () => { const {settings} = await import('/src/settings/store.ts'); return settings.get('app.json').autoConvertHTML; }), 'Repeated toggle click restores conversion');
  assert.deepEqual(await run(() => consoleErrors), []);
  console.log(`Paste: ${cases.length} converter unit cases plus native integration checks passed`);
});
