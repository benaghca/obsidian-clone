// Round 21 bugs. These checks assert the behavior Obsidian 1.14.4 showed,
// or the brief where Obsidian and the brief agree. They fail on this commit.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const failures = [];
const check = (ok, message) => {
  if (ok) console.log('PASS', message);
  else { console.log('FAIL', message); failures.push(message); }
};

const fm = '---\ntitle: Hello\ntags: [paste]\n---\n\n';
const docsHtml = '<b id="docs-internal-guid-1" style="font-weight:normal"><span style="font-weight:700">Docs bold</span></b>';
const preHtml = '<pre class="language-py"><div>line1</div><div>line2</div></pre>';

await withBrowser(async ({ send, run, click, chord, press, move }) => {
  await send('Page.bringToFront');
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await run(async (fm) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Bugs.md', fm + 'START\n');
    await ws.vault.refreshFiles();
    await ws.open('Bugs.md');
    ws.setMode('source');
  }, fm);
  await sleep(120);

  const direct = await run(async (docsHtml, preHtml) => {
    const { htmlToMarkdown } = await import('/src/editor/htmlToMarkdown.ts');
    return { docs: htmlToMarkdown(docsHtml), pre: htmlToMarkdown(preHtml) };
  }, docsHtml, preHtml);
  check(direct.docs === '**Docs bold**', `Google Docs bold span converts to **Docs bold**, got ${JSON.stringify(direct.docs)}`);
  check(direct.pre === '```py\nline1\nline2\n```', `pre with a div per line keeps both lines, got ${JSON.stringify(direct.pre)}`);

  const write = (html, text) => run(async (html, text) => navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob([html], { type: 'text/html' }),
    'text/plain': new Blob([text], { type: 'text/plain' }),
  })]), html, text);
  const doc = () => run(() => ws.view.state.doc.toString());

  await run((fm) => {
    ws.view.dispatch({ changes: { from: 0, to: ws.view.state.doc.length, insert: fm + '\n' }, selection: { anchor: fm.length + 1 } });
    ws.view.focus();
  }, fm);
  await write(docsHtml, 'Docs bold');
  await chord('v');
  await sleep(120);
  check((await doc()).includes('**Docs bold**'), `pasted Google Docs bold span stays bold, got ${JSON.stringify(await doc())}`);

  await run((fm) => {
    ws.view.dispatch({ changes: { from: 0, to: ws.view.state.doc.length, insert: fm + '\n' }, selection: { anchor: fm.length + 1 } });
    ws.view.focus();
  }, fm);
  await write(preHtml, 'line1\nline2');
  await chord('v');
  await sleep(120);
  const preDoc = await doc();
  check(preDoc.includes('```py\nline1\nline2\n```'), `pasted pre keeps a line break between div lines, got ${JSON.stringify(preDoc)}`);

  const table = fm + '| one | two |\n| --- | --- |\n| a | b |\n';
  await run(async (table) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Cell.md', table);
    await ws.vault.refreshFiles();
    await ws.open('Cell.md');
    ws.setMode('live');
  }, table);
  await sleep(300);
  const cell = await run(() => {
    const el = [...document.querySelectorAll('th, td')].find((e) => e.textContent.trim() === 'one');
    if (!el) return { cells: [...document.querySelectorAll('th, td')].map((e) => e.textContent) };
    const r = el.getBoundingClientRect();
    return { x: r.x + Math.min(12, r.width / 2), y: r.y + r.height / 2 };
  });
  check(!!cell.x, `Live Preview draws the table cell, saw ${JSON.stringify(cell.cells ?? 'one')}`);
  if (cell.x) {
    await click(cell);
    await sleep(80);
    await write('<b>bold</b>', 'bold');
    await chord('v');
    await sleep(150);
    const cellDoc = await doc();
    check(cellDoc.includes('**bold**'), `Live Preview table cell converts bold HTML, got ${JSON.stringify(cellDoc)}`);
    await chord('z'); await sleep(80);
    check(await doc() === table, 'table-cell rich paste is one undo step in the note history');
    await write('<p><b>first</b></p><p>second</p>', 'first\nsecond');
    await chord('v'); await sleep(100);
    check((await doc()).includes('**first**<br><br>second') && (await doc()).split('\n').length === table.split('\n').length, 'multiline HTML stays in one cell without adding table rows');
    await run(async () => { const {settings}=await import('/src/settings/store.ts'); settings.set('app.json','autoConvertHTML',false); });
    await write('<b>OFF</b>', 'OFF'); await chord('v'); await sleep(100);
    check((await doc()).includes('OFF') && !(await doc()).includes('**OFF**'), 'active cell inherits Auto convert HTML being switched off');
    await run(async () => { const {settings}=await import('/src/settings/store.ts'); settings.set('app.json','autoConvertHTML',true); });
    await write('<b>ON</b>', 'ON'); await chord('v'); await sleep(100);
    check((await doc()).includes('**ON**'), 'active cell inherits Auto convert HTML being switched back on');
    await run(() => ws.setMode('reading')); await sleep(100);
    check(await run(() => document.querySelectorAll('.cm-content table').length === 1 && !!document.querySelector('.cm-content table .cm-strong')), 'Reading renders a single table with the converted cell formatting');
  }

  await run(async fm => {
    const { api } = await import('/src/api.ts');
    await api.createFolder('FolderA');
    await api.createFolder('FolderB');
    await api.createNote('FolderA/Same.md', fm + 'A\n');
    await api.createNote('FolderB/Same.md', fm + 'B\n');
    await api.createNote('SwitcherCurrent.md', fm + 'current\n');
    await ws.vault.refreshFiles();
  }, fm);
  for (const mode of ['live', 'source', 'reading']) {
    await run(async mode => {
      await ws.open('SwitcherCurrent.md'); ws.recent=[];
      await ws.open('FolderB/Same.md'); await ws.open('FolderA/Same.md'); await ws.open('SwitcherCurrent.md');
      ws.setMode(mode);
    }, mode);
    await sleep(100);
    await chord('o'); await sleep(80);
    const row = await run(() => {
      const el = [...document.querySelectorAll('.suggestion-item')].find(e => e.textContent.includes('Same') && e.textContent.includes('FolderB'));
      if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: r.x + 24, y: r.y + r.height / 2 };
    });
    check(!!row, `${mode}: quick switcher lists FolderB/Same on an empty query`);
    if (row) {
      await move(row); await press('Tab'); await sleep(80);
      check(await run(() => document.querySelector('.suggestion-item.is-selected')?.textContent.includes('FolderB') && document.querySelector('.prompt-input').value === 'Same'), `${mode}: Tab completes the name and retains the highlighted path`);
      await press('Tab');
      check(await run(() => document.querySelector('.suggestion-item.is-selected')?.textContent.includes('FolderB')), `${mode}: repeated Tab retains the same path without moving the pointer`);
      await press('Enter'); await sleep(100);
      check(await run(() => ws.active.path === 'FolderB/Same.md'), `${mode}: Tab then Enter opens the hovered Same note`);
    } else await press('Escape');
  }
  await run(async fm => {
    const {api} = await import('/src/api.ts');
    for (let i=0;i<51;i++) { await api.createFolder('Tie'+i); await api.createNote('Tie'+i+'/Same.md',fm+'tie'); }
    await api.createFolder('ZZZ'); await api.createNote('ZZZ/Same.md',fm+'last'); await ws.vault.refreshFiles();
    await ws.open('ZZZ/Same.md'); await ws.open('SwitcherCurrent.md');
  },fm);
  await chord('o'); await sleep(80);
  const cappedRow = await run(() => {
    const el=[...document.querySelectorAll('.suggestion-item')].find(e=>e.textContent.includes('ZZZ'));
    const r=el.getBoundingClientRect(); return {x:r.x+24,y:r.y+r.height/2};
  });
  await move(cappedRow); await press('Tab'); await sleep(80);
  check(await run(()=>document.querySelector('.suggestion-item.is-selected')?.textContent.includes('ZZZ') && document.querySelectorAll('.suggestion-item').length===50), 'Tab retains the selected path even beyond the fuzzy result limit');
  await press('Enter'); await sleep(100);
  check(await run(()=>ws.active.path==='ZZZ/Same.md'), 'Enter opens the retained path beyond the fuzzy result limit');
});

assert.deepEqual(failures, [], failures.join('\n'));
