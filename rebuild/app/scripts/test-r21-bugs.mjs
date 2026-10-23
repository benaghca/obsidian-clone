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
  }

  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createFolder('FolderA');
    await api.createFolder('FolderB');
    await api.createNote('FolderA/Same.md', 'A\n');
    await api.createNote('FolderB/Same.md', 'B\n');
    await api.createNote('SwitcherCurrent.md', 'current\n');
    await ws.vault.refreshFiles();
    await ws.open('FolderB/Same.md');
    await ws.open('FolderA/Same.md');
    await ws.open('SwitcherCurrent.md');
  });
  await sleep(100);
  await chord('o');
  await sleep(150);
  const row = await run(() => {
    const el = [...document.querySelectorAll('.suggestion-item')].find((e) => e.textContent.includes('Same') && e.textContent.includes('FolderB'));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + 24, y: r.y + r.height / 2 };
  });
  check(!!row, 'quick switcher lists FolderB/Same on an empty query');
  if (row) {
    await move(row);
    await sleep(60);
    await press('Tab');
    await sleep(80);
    await press('Enter');
    await sleep(150);
    const active = await run(() => ws.active.path);
    check(active === 'FolderB/Same.md', `Tab then Enter opens the hovered Same note, opened ${active}`);
  }
});

assert.deepEqual(failures, [], failures.join('\n'));
