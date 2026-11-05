// T1: Templates: Insert template merges the template's properties into the
// note's own. Native keys only: Ctrl+P, the template picker, then Ctrl+Z.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ send, run, click, chord, press, key, check }) => {
  const wait = async (test, message) => {
    for (let i = 0; i < 100; i++) { if (await test()) return; await sleep(50); }
    throw new Error(message);
  };
  await run(()=>{window.consoleErrors=[]; const error=console.error; console.error=(...args)=>{window.consoleErrors.push(args.map(String));error(...args)};});
  const today = await run(async () => {
    const { api } = await import('/src/api.ts');
    const { settings } = await import('/src/settings/store.ts');
    const { formatDate } = await import('/src/settings/dateFormat.ts');
    await api.createNote('Templates/Meeting.md', '---\ntags:\n  - meeting\n  - project\nstatus: draft\ncreated: {{date}}\n---\n## {{title}}\n- [ ] ');
    await api.createNote('Templates/Plain.md', 'Plain {{title}}');
    await api.createNote('Templates/Empty.md', '');
    await api.createNote('Templates/Properties.md', '---\nkind: meeting\n---\n');
    settings.set('templates.json', 'folder', 'Templates');
    settings.set('templates.json', 'dateFormat', 'YYYY-MM-DD');
    await ws.vault.refreshFiles();
    return formatDate(new Date(), 'YYYY-MM-DD');
  });
  const text = () => run(() => ws.view.state.doc.toString());
  const open = async (path, content) => {
    await run(async (path, content) => {
      const { api } = await import('/src/api.ts');
      await api.createNote(path, content); await ws.vault.refreshFiles(); await ws.open(path);
    }, path, content);
    await wait(() => run(path => ws.active.path === path && !!document.querySelector('.cm-content'), path), `${path} did not open`);
    await sleep(100);
  };
  const insert = async name => {
    await chord('p');
    await wait(() => run(() => !!document.querySelector('.prompt-input')), 'command palette did not open');
    await send('Input.insertText', { text: 'Insert template' }); await sleep(80);
    await wait(() => run(() => document.querySelector('.suggestion-item.is-selected')?.textContent.includes('Templates: Insert template')), 'Insert template is not the first command');
    await press('Enter');
    await wait(() => run(() => document.querySelector('.prompt-input')?.placeholder === 'Type to search templates...'), 'template picker did not open');
    await send('Input.insertText', { text: name }); await sleep(80);
    await wait(() => run(name => document.querySelector('.suggestion-item.is-selected')?.textContent === name, name), `${name} is not the first template`);
    await press('Enter');
    await wait(() => run(() => !document.querySelector('.prompt-input')), 'template picker did not close');
    await sleep(120);
  };
  const caretAtEnd = async () => { await click('.cm-content .cm-line'); await key('Control', 2); await press('End', 2); await key('Control', 0, 'keyUp'); await sleep(50); };
  const fences = s => s.split('\n').filter(l => l === '---').length;

  for (const mode of ['source', 'live']) {
    const name = `Mock ${mode}`;
    const note = '---\ntags: [project, inbox]\nstatus: open\n---\nIntro line\n';
    await open(`${name}.md`, note);
    await run(mode => ws.setMode(mode), mode); await sleep(100);
    await caretAtEnd();
    await insert('Meeting');
    const merged = await text();
    assert.equal(merged, `---\ntags: [project, inbox, meeting]\nstatus: open\ncreated: ${today}\n---\nIntro line\n## ${name}\n- [ ] `);
    check(fences(merged) === 2, `${mode}: one frontmatter block, no second --- block in the body`);
    check(true, `${mode}: the note's status wins, tags are unioned, created is added, the body is at the cursor`);
    check(await run(() => { const s = ws.view.state.selection.main; return s.empty && s.head === ws.view.state.doc.length; }), `${mode}: caret ends after the inserted body`);
    if (mode === 'live') {
      await wait(() => run(() => !!document.querySelector('.properties .property[data-key="created"]') && document.querySelectorAll('.properties .property-pill').length >= 3), 'Properties block did not show created');
      check(true, 'live: the Properties block shows the merged property');
    }
    await chord('z'); await sleep(80);
    assert.equal(await text(), note);
    check(true, `${mode}: one Ctrl+Z undoes the whole insert (properties and body)`);
    await key('Control', 2); await key('Shift', 10); await press('Z', 10); await key('Shift', 2, 'keyUp'); await key('Control', 0, 'keyUp'); await sleep(80);
    assert.equal(await text(), merged);
    check(true, `${mode}: one redo puts it all back`);
  }

  // No frontmatter: the template's block goes on top, the body at the caret.
  const plain = 'First\nSecond\n';
  await open('Plain note.md', plain);
  await run(() => ws.setMode('source')); await sleep(80);
  await caretAtEnd();
  // Typed just before: the insert is its own undo step, not joined to the typing.
  await send('Input.insertText', { text: 'typed' });
  await insert('Meeting');
  const topped = await text();
  assert.equal(topped, `---\ntags:\n  - meeting\n  - project\nstatus: draft\ncreated: ${today}\n---\nFirst\nSecond\ntyped## Plain note\n- [ ] `);
  check(true, 'no frontmatter: the template block is added on top');
  await chord('z'); await sleep(80);
  assert.equal(await text(), plain + 'typed');
  check(true, 'no frontmatter: one Ctrl+Z removes block and body, and keeps the typing before it');

  // A template without properties is inserted as before, over the selection.
  await open('Words.md', 'Hello world');
  await run(() => ws.setMode('source')); await sleep(80);
  await run(() => ws.view.dispatch({ selection: { anchor: 6, head: 11 } }));
  await run(() => ws.view.focus());
  await insert('Plain');
  assert.equal(await text(), 'Hello Plain Words');
  check(true, 'template without frontmatter replaces the selection as before');

  // No body: preserve a reversed selection, mapping it past added properties.
  await open('Selected.md', 'Hello world');
  await run(() => ws.setMode('source')); await sleep(80);
  await run(() => { ws.view.dispatch({ selection: { anchor: 11, head: 6 } }); ws.view.focus(); });
  await insert('Empty');
  assert.deepEqual(await run(() => { const s = ws.view.state.selection.main; return [s.anchor, s.head]; }), [11, 6]);
  assert.equal(await text(), 'Hello world');
  await insert('Properties');
  const prefix = '---\nkind: meeting\n---\n';
  assert.equal(await text(), prefix + 'Hello world');
  assert.deepEqual(await run(() => { const s = ws.view.state.selection.main; return [s.anchor, s.head]; }), [prefix.length + 11, prefix.length + 6]);
  check(true, 'empty and properties-only templates preserve the selection and its direction');

  // The merge is saved: wait for the debounced write and read the file back.
  await chord('z'); await sleep(50);
  await open('Saved.md', '---\naliases: [S]\n---\n');
  await caretAtEnd();
  await insert('Meeting');
  const expected = `---\naliases: [S]\ntags:\n  - meeting\n  - project\nstatus: draft\ncreated: ${today}\n---\n## Saved\n- [ ] `;
  assert.equal(await text(), expected);
  await wait(() => run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('Saved.md'); }).then(s => s === expected), 'merged note was not saved');
  check(true, 'the merged note is written to disk as shown');

  assert.deepEqual(await run(() => consoleErrors), []);
  console.log('Template merge: browser checks passed');
});
