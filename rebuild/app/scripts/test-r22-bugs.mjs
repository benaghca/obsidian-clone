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
    await api.createNote('Linker.md', fm + '[[a(b)]]\n[a(b)](Projects/a\\(b\\).md)\n[pct](Projects/a%28b%29.md)\n[plain](Projects/Plain.md)\n');
    await api.createNote('LinkerHidden.md', fm + '[see](Projects/a\\(b\\).md)\n');
    await api.createNote('SearchOnly.md', fm + '[see](Projects/a\\(b\\).md)\n');
    await api.createNote('PercentOnly.md', fm + '[see](Projects/a%28b%29.md)\n');
    await api.createNote('PasteBody.md', fm + 'old body\n');
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    settings.set('app.json', 'alwaysUpdateLinks', true);
  }, fm);

  const indexed = await run(() => ({
    back: ws.vault.links.backlinks['Projects/a(b).md']?.map((b) => b.from) ?? [],
    unresolved: ws.vault.links.unresolved?.['LinkerHidden.md'] ?? [],
  }));
  check(indexed.back.includes('LinkerHidden.md'), `escaped destination is a backlink of Projects/a(b).md, got ${JSON.stringify(indexed)}`);
  check(!indexed.unresolved.some((name) => name.includes('\\')), `escaped destination is not stored with a backslash, got ${JSON.stringify(indexed.unresolved)}`);

  await run(async () => {
    // Exercise the search fallback too: these notes are absent from a stale index.
    ws.vault.links.backlinks['Projects/a(b).md'] = ws.vault.links.backlinks['Projects/a(b).md']?.filter(b => !['SearchOnly.md', 'PercentOnly.md'].includes(b.from));
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
  check(renamed.search.includes('[see](c\\(d\\).md)'), 'search finds a note containing only an escaped destination without index help');
  check(renamed.percent.includes('[see](c%28d%29.md)'), 'search finds a note containing only a percent-encoded destination without index help');

  await run(async () => {
    await ws.open('BlockNote.md');
    ws.setMode('live');
    const doc = ws.view.state.doc.toString();
    const start = doc.indexOf('\n---\n') + 5;
    ws.view.dispatch({ changes: { from: start, to: doc.length, insert: '\n' }, selection: { anchor: start + 1 } });
  });
  await sleep(80);
  const caret = await run(() => {
    const pos = ws.view.state.doc.length;
    const r = ws.view.coordsAtPos(pos);
    return { x: r.left + 2, y: (r.top + r.bottom) / 2 };
  });
  await click(caret);
  await send('Input.insertText', { text: '[[BlockNote' });
  await sleep(250);
  const open = await run(() => !!document.querySelector('.cm-link-suggest'));
  check(open, 'link suggester is open on [[BlockNote');
  await press('Tab');
  await sleep(80);
  const afterTab = await run(() => ws.view.state.doc.toString());
  check(/\[\[[^\n]*BlockNote[^\n]*\]\]/.test(afterTab), `Tab accepts the highlighted note, got ${JSON.stringify(afterTab.slice(-80))}`);

  const pasted = fm + 'VISIBLE BODY LINE\n';
  await run(async (pasted) => {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([pasted], { type: 'text/plain' }) })]);
    await ws.open('PasteBody.md');
    ws.setMode('live');
  }, pasted);
  await sleep(150);
  await click(await run(() => {
    const r = ws.view.coordsAtPos(Math.min(12, ws.view.state.doc.length));
    return { x: r.left + 4, y: (r.top + r.bottom) / 2 };
  }));
  await chord('a');
  await sleep(40);
  await chord('v');
  await sleep(200);
  const shown = await run(() => ({
    text: ws.view.contentDOM.innerText.includes('VISIBLE BODY LINE'),
    doc: ws.view.state.doc.toString().includes('VISIBLE BODY LINE'),
  }));
  check(shown.doc && shown.text, `select-all paste of the same frontmatter shows the body, got ${JSON.stringify(shown)}`);
}, { height: 1000 });

assert.deepEqual(failures, []);
