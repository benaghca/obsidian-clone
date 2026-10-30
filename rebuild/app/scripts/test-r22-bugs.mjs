// Round 22 bugs. These checks assert the behavior the round 22 brief asks for.
// Each assertion failed on the hunter baseline.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const failures = [];
const check = (ok, message) => {
  if (ok) console.log('PASS', message);
  else { console.log('FAIL', message); failures.push(message); }
};

const fm = '---\ntags: [r22hunt]\n---\n\n';

await withBrowser(async ({ send, run, click, press, chord }) => {
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await run(async (fm) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Projects/a(b).md', fm + 'Target with parentheses.\n');
    await api.createNote('Projects/Plain.md', fm + 'Plain target.\n');
    await api.createNote('BlockNote.md', fm + 'A note to suggest.\n');
    await api.createNote('BlockNoteOther.md', fm + 'Another suggestion.\n');
    await api.createNote('Linker.md', fm + '[[a(b)]]\n[a(b)](Projects/a\\(b\\).md)\n[pct](Projects/a%28b%29.md)\n[plain](Projects/Plain.md)\n');
    await api.createNote('LinkerHidden.md', fm + '[see](Projects/a\\(b\\).md)\n');
    await api.createNote('SearchOnly.md', fm + '[see](Projects/a\\(b\\).md)\n');
    await api.createNote('PercentOnly.md', fm + '[see](Projects/a%28b%29.md)\n');
    await api.createNote('PasteBody.md', fm + 'old body\n');
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    settings.set('app.json', 'alwaysUpdateLinks', true);
  }, fm);

  const indexed = await run(async () => {
    const { api } = await import('/src/api.ts');
    return {
      back: (await api.backlinks(['Projects/a(b).md']))['Projects/a(b).md']?.map(b => b.from) ?? [],
      unresolved: ws.vault.links.unresolved?.['LinkerHidden.md'] ?? [],
    };
  });
  check(indexed.back.includes('LinkerHidden.md'), `escaped destination is a backlink of Projects/a(b).md, got ${JSON.stringify(indexed)}`);
  check(!indexed.unresolved.some((name) => name.includes('\\')), `escaped destination is not stored with a backslash, got ${JSON.stringify(indexed.unresolved)}`);

  await run(async () => {
    const { renameFile } = await import('/src/fileOps.ts');
    await renameFile(ws, 'Projects/a(b).md', 'c(d)');
  });
  let renamed = null;
  for (let i = 0; i < 20; i++) {
    renamed = await run(async () => {
      const { api } = await import('/src/api.ts');
      return { linker: await api.readNote('Linker.md'), hidden: await api.readNote('LinkerHidden.md'), search: await api.readNote('SearchOnly.md'), percent: await api.readNote('PercentOnly.md') };
    });
    if (renamed.linker.includes('[[c(d)]]')) break;
    await sleep(50);
  }
  check(renamed.linker.includes('[[c(d)]]') && !renamed.linker.includes('a\\(b\\)'), `escaped markdown destination is renamed with the wikilink, got ${JSON.stringify(renamed.linker)}`);
  check(!renamed.hidden.includes('a\\(b\\)'), `a note whose only link is escaped is renamed, got ${JSON.stringify(renamed.hidden)}`);

  check(renamed.hidden.includes('[see](c\\(d\\).md)'), 'rename retains the backslash-escaped destination style');
  check(renamed.search.includes('[see](c\\(d\\).md)'), 'link sources finds a note containing only an escaped destination');
  check(renamed.percent.includes('[see](c%28d%29.md)'), 'link sources finds a note containing only a percent-encoded destination');

  for (const mode of ['live', 'source']) {
    await run(async mode => {
      await ws.open('BlockNote.md');
      ws.setMode(mode);
      const doc = ws.view.state.doc.toString();
      const start = doc.indexOf('\n---\n') + 5;
      ws.view.dispatch({ changes: { from: start, to: doc.length, insert: '\n' }, selection: { anchor: start + 1 } });
    }, mode);
    await sleep(80);
    await click(await run(() => {
      const r = ws.view.coordsAtPos(ws.view.state.doc.length);
      return { x: r.left + 2, y: (r.top + r.bottom) / 2 };
    }));
    await send('Input.insertText', { text: '[[BlockNote' });
    await sleep(250);
    check(await run(() => !!document.querySelector('.cm-link-suggest')), `${mode}: link suggester is open on [[BlockNote`);
    await press('ArrowDown');
    const selected = await run(() => document.querySelector('.cm-link-suggest [aria-selected="true"] .cm-completionLabel')?.textContent);
    await press('Tab');
    await sleep(80);
    check(selected && await run(selected => ws.view.state.doc.toString().endsWith(`[[${selected}]]`), selected), `${mode}: Tab accepts the highlighted row ${selected}`);
    check(await run(() => ws.view.state.selection.main.head === ws.view.state.doc.length && !document.querySelector('.cm-link-suggest')), `${mode}: Tab closes completion and puts caret after the link`);
    await press('Tab');
    check(await run(() => ws.view.state.doc.line(ws.view.state.doc.lines).text.startsWith('\t')), `${mode}: Tab without completion still indents`);
  }
  await run(() => ws.setMode('reading'));
  const readOnlyText = await run(() => ws.view.state.doc.toString());
  await send('Input.insertText', { text: '[[BlockNote' });
  await press('Tab');
  check(await run(text => ws.view.state.doc.toString() === text && !document.querySelector('.cm-link-suggest'), readOnlyText), 'Reading: completion and Tab do not edit the note');

  for (const mode of ['live', 'source']) {
    const pasted = fm + `VISIBLE PASTED BODY ${mode}\n`;
    await run(async (pasted, mode, fm) => {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([pasted], { type: 'text/plain' }) })]);
      await ws.open('PasteBody.md');
      ws.setMode(mode);
      ws.view.dispatch({ changes: { from: 0, to: ws.view.state.doc.length, insert: fm + 'old body\n' } });
    }, pasted, mode, fm);
    await sleep(150);
    await click(await run(() => {
      const r = ws.view.coordsAtPos(ws.view.state.doc.length - 2);
      return { x: r.left + 2, y: (r.top + r.bottom) / 2 };
    }));
    await chord('a');
    await chord('v');
    await sleep(150);
    check(await run(pasted => ws.view.state.doc.toString() === pasted && ws.view.contentDOM.innerText.includes('VISIBLE PASTED BODY'), pasted), `${mode}: select-all paste of identical frontmatter shows the new body`);
    await chord('z');
    await sleep(80);
    check(await run(() => ws.view.state.doc.toString().endsWith('old body\n') && ws.view.contentDOM.innerText.includes('old body')), `${mode}: undo restores the visible old body`);
  }
  for (const mode of ['live', 'source', 'reading']) {
    await run(mode => ws.setMode(mode), mode);
    const replacement = fm + `VISIBLE REPLACEMENT ${mode}\n`;
    await run(text => ws.view.dispatch({ changes: { from: 0, to: ws.view.state.doc.length, insert: text } }), replacement);
    await sleep(80);
    check(await run(text => ws.view.state.doc.toString() === text && ws.view.contentDOM.innerText.includes('VISIBLE REPLACEMENT'), replacement), `${mode}: whole-document replacement with identical frontmatter shows its body`);
    // A body-only edit must retain the properties DOM while correcting its range.
    await run(() => {
      window.r22Properties = ws.view.dom.querySelector('.properties');
      ws.view.dispatch({ changes: { from: ws.view.state.doc.length, insert: 'APPENDED BODY' } });
    });
    await sleep(80);
    check(await run(() => ws.view.contentDOM.innerText.includes('APPENDED BODY') && window.r22Properties === ws.view.dom.querySelector('.properties')), `${mode}: body edits stay visible and retain the properties DOM`);
  }
}, { height: 1000 });

assert.deepEqual(failures, []);
