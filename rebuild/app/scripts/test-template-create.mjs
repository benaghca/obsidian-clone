// T2: Templates: Create new note from template. Native keys only: Ctrl+P,
// the template picker, then the inline title.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ send, run, press, chord, key, check }) => {
  const wait = async (test, message) => {
    for (let i = 0; i < 100; i++) { if (await test()) return; await sleep(50); }
    throw new Error(message);
  };
  await run(() => {
    window.consoleErrors = [];
    const error = console.error;
    console.error = (...args) => { window.consoleErrors.push(args.map(String)); error(...args); };
  });
  const paths = () => run(() => ws.vault.files.map((f) => f.path));
  const text = () => run(() => ws.view.state.doc.toString());
  const selected = () => run(() => document.querySelector('.suggestion-item.is-selected .suggestion-title')?.textContent ?? '');
  const clock = () => run(async () => {
    const { formatDate } = await import('/src/settings/dateFormat.ts');
    const now = new Date();
    return { date: formatDate(now, 'YYYY-MM-DD'), time: formatDate(now, 'HH:mm'), year: formatDate(now, 'YYYY') };
  });
  const nextMinute = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(2000, 0, 1, h, m);
    d.setMinutes(d.getMinutes() + 1);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const meeting = (title, stamp) => {
    const time = stamp.time;
    const alt = nextMinute(time);
    const body = (t) => `---\ntags:\n  - meeting\ncreated: ${stamp.date}\ntopic: ${title}\n---\n# ${title}\nAt ${t}\n<% tp.file.cursor() %>\n${stamp.year}\n`;
    return { exact: body(time), alt: body(alt) };
  };
  const accept = (got, expected) => got === expected.exact || got === expected.alt;

  const palette = async (query, name) => {
    await chord('p');
    await wait(() => run(() => !!document.querySelector('.prompt-input')), 'command palette did not open');
    await send('Input.insertText', { text: query });
    await sleep(80);
    await wait(() => selected().then((s) => s === name), `${name} is not the selected command`);
    await press('Enter');
  };
  const pickTemplate = async (name) => {
    await wait(() => run(() => document.querySelector('.prompt-input')?.placeholder === 'Type to search templates...'), 'template picker did not open');
    check(await run(() => [...document.querySelectorAll('.prompt-instruction')].some((el) => el.textContent.includes('to create'))), 'the picker says Enter creates a note');
    await send('Input.insertText', { text: name });
    await sleep(80);
    await wait(() => selected().then((s) => s === name), `${name} is not the selected template`);
  };

  await run(async () => {
    const { settings } = await import('/src/settings/store.ts');
    settings.set('templates.json', 'folder', '');
    settings.set('templates.json', 'dateFormat', 'YYYY-MM-DD');
    settings.set('templates.json', 'timeFormat', 'HH:mm');
  });
  const started = await run(() => ws.active.path);
  await palette('note from template', 'Templates: Create new note from template');
  await wait(() => run(() => !!document.querySelector('.modal.mod-settings') && document.body.textContent.includes('Template folder location')), 'settings did not open when no template folder is set');
  check(await run((path) => ws.active.path === path, started), 'no note is created when the template folder is unset');
  await press('Escape');
  await wait(() => run(() => !document.querySelector('.modal.mod-settings')), 'settings did not close');

  await run(async () => {
    const { settings } = await import('/src/settings/store.ts');
    settings.set('templates.json', 'folder', 'No Templates');
  });
  const emptyBefore = await paths();
  await palette('note from template', 'Templates: Create new note from template');
  await wait(() => run(() => document.querySelector('.prompt-input')?.placeholder === 'Type to search templates...'), 'an empty template folder did not open the picker');
  check(await run(() => !!document.querySelector('.suggestion-empty') && [...document.querySelectorAll('.prompt-instruction')].some((el) => el.textContent.includes('to create'))), 'an empty template folder offers nothing and creates on Enter');
  await press('Enter');
  await sleep(80);
  check(await run(() => !!document.querySelector('.prompt-input')), 'Enter in an empty template folder keeps the picker open');
  await press('Escape');
  await wait(() => run(() => !document.querySelector('.prompt-input')), 'the empty template picker did not close');
  assert.deepEqual((await paths()).slice().sort(), emptyBefore.slice().sort());
  check(true, 'an empty template folder creates nothing');

  await run(async () => {
    const { api } = await import('/src/api.ts');
    const { settings } = await import('/src/settings/store.ts');
    await api.createNote('Templates/Meeting.md', '---\ntags:\n  - meeting\ncreated: {{date}}\ntopic: {{title}}\n---\n# {{title}}\nAt {{time}}\n<% tp.file.cursor() %>\n{{date:YYYY}}\n');
    await api.createNote('Templates/Standup.md', 'Standup {{title}}\n');
    await api.createNote('Templates/Stamp.md', '{{date}} {{time}}\n');
    await api.createNote('Templates/Gone.md', 'gone {{title}}\n');
    await api.createNote('Not a template.md', 'leave me out');
    await api.createNote('Journal/Log.md', 'log');
    settings.set('templates.json', 'folder', 'Templates');
    settings.set('app.json', 'newFileLocation', 'folder');
    settings.set('app.json', 'newFileFolderPath', 'Inbox');
    await ws.vault.refreshFiles();
  });
  const before = await paths();

  await palette('note from template', 'Templates: Create new note from template');
  await wait(() => run(() => document.querySelector('.prompt-input')?.placeholder === 'Type to search templates...'), 'template picker did not open');
  await send('Input.insertText', { text: 'Not a template' });
  await sleep(80);
  await wait(() => run(() => !!document.querySelector('.suggestion-empty')), 'a note outside the template folder is not offered');
  await press('Escape');
  await wait(() => run(() => !document.querySelector('.prompt-input')), 'template picker did not close');
  assert.deepEqual((await paths()).slice().sort(), before.slice().sort());
  check(true, 'dismissing the picker creates nothing');

  let stamp = await clock();
  await palette('note from template', 'Templates: Create new note from template');
  await pickTemplate('Meeting');
  await press('Enter');
  await wait(() => run(() => ws.active.path === 'Inbox/Untitled.md'), 'Inbox/Untitled.md did not open');
  await wait(async () => accept(await text(), meeting('Untitled', stamp)) || accept(await text(), meeting('Untitled', await clock())), 'the template was not filled in');
  const filled = await text();
  assert.ok(accept(filled, meeting('Untitled', stamp)) || accept(filled, meeting('Untitled', await clock())), filled);
  check(filled.includes('<% tp.file.cursor() %>'), 'Templater syntax is left as written');
  check((filled.match(/^---$/gm) ?? []).length === 2, 'the new note has one frontmatter block');
  check(await run(() => ws.active.mode !== 'reading'), 'the new note opens for editing');
  check(await run((path) => ws.tabs.some((t) => t.path === path), started), 'the note that was open stays in its tab');
  await wait(() => run(() => !!document.querySelector('.properties .property[data-key="topic"]') && !!document.querySelector('.properties .property[data-key="created"]')), 'Properties did not show the template keys');
  const titleReady = () => run(() => {
    const title = document.querySelector('.workspace-tabs.mod-active .inline-title');
    const sel = getSelection();
    return !!title && document.activeElement === title && title.getAttribute('contenteditable') === 'plaintext-only' && title.classList.contains('is-renaming') && sel?.toString() === 'Untitled' && title.contains(sel.anchorNode) && title.getBoundingClientRect().height > 0;
  });
  await wait(titleReady, 'the inline title is not focused and selected');
  check(true, 'the inline title is focused, selected, and editable');

  // The title stays selected. Another create must not treat that draft as the new note's name.
  stamp = await clock();
  await palette('note from template', 'Templates: Create new note from template');
  await pickTemplate('Meeting');
  await press('Enter');
  await wait(() => run(() => ws.active.path === 'Inbox/Untitled 1.md'), 'a second create from the selected title did not open Inbox/Untitled 1.md');
  await wait(async () => accept(await text(), meeting('Untitled 1', stamp)) || accept(await text(), meeting('Untitled 1', await clock())), 'the second create from the selected title was not filled in');
  const secondWhileFocused = await text();
  assert.ok(accept(secondWhileFocused, meeting('Untitled 1', stamp)) || accept(secondWhileFocused, meeting('Untitled 1', await clock())), secondWhileFocused);
  await wait(() => run(() => {
    const title = document.querySelector('.workspace-tabs.mod-active .inline-title');
    const sel = getSelection();
    return !!title && document.activeElement === title && title.textContent === 'Untitled 1' && sel?.toString() === 'Untitled 1' && !title.hasAttribute('aria-invalid') && !document.querySelector('.rename-error');
  }), 'the new title kept the previous note\'s name');
  check(true, 'a create started from the selected title names and selects the new note');
  await press('Escape');
  await run(() => ws.open('Inbox/Untitled.md'));
  await wait(() => run((expected) => ws.active.path === 'Inbox/Untitled.md' && ws.view.state.doc.toString() === expected, filled), 'the first note did not come back for undo');

  await press('Escape');
  await sleep(80);
  await chord('z');
  await wait(() => text().then((s) => s === ''), 'one Ctrl+Z did not remove the whole template');
  check(true, 'one undo clears the filled template');
  await key('Control', 2); await key('Shift', 10); await press('Z', 10); await key('Shift', 2, 'keyUp'); await key('Control', 0, 'keyUp');
  await wait(() => text().then((s) => s === filled), 'one redo did not restore the template');
  check(true, 'one redo puts the template back');

  await run(async () => {
    const { settings } = await import('/src/settings/store.ts');
    settings.set('app.json', 'showInlineTitle', false);
  });
  stamp = await clock();
  await palette('note from template', 'Templates: Create new note from template');
  await pickTemplate('Meeting');
  await press('Enter');
  await wait(() => run(() => ws.active.path === 'Inbox/Untitled 2.md'), 'Inbox/Untitled 2.md did not open');
  await wait(async () => accept(await text(), meeting('Untitled 2', stamp)) || accept(await text(), meeting('Untitled 2', await clock())), 'the second template was not filled in');
  const second = await text();
  assert.ok(accept(second, meeting('Untitled 2', stamp)) || accept(second, meeting('Untitled 2', await clock())), second);
  await wait(() => run(() => document.body.classList.contains('is-inline-title-hidden') && document.activeElement?.classList.contains('inline-title') && document.activeElement.classList.contains('is-renaming') && document.activeElement.getBoundingClientRect().height > 0 && getSelection()?.toString() === 'Untitled 2'), 'a hidden inline title did not open for the rename');
  check(true, 'the inline title still opens for editing when it is hidden');
  await send('Input.insertText', { text: 'Board notes' });
  await sleep(80);
  assert.equal(await run(() => document.querySelector('.workspace-tabs.mod-active .inline-title')?.textContent), 'Board notes');
  await press('Enter');
  await wait(() => run(() => ws.active.path === 'Inbox/Board notes.md'), 'the inline title did not rename the note');
  assert.equal(await text(), second);
  check(second.includes('# Untitled 2\n'), 'renaming the note leaves the filled {{title}} as it was');
  await wait(() => run(async (expected) => { const { api } = await import('/src/api.ts'); return (await api.readNote('Inbox/Board notes.md')) === expected; }, second), 'the renamed note was not saved');
  await wait(() => run(async (expected) => { const { api } = await import('/src/api.ts'); return (await api.readNote('Inbox/Untitled.md')) === expected; }, filled), 'the first note was not left as filled');
  check(true, 'the first note is unchanged');

  await run(async () => {
    const { settings } = await import('/src/settings/store.ts');
    settings.set('app.json', 'showInlineTitle', true);
    settings.set('app.json', 'newFileLocation', 'current');
    await ws.open('Journal/Log.md');
  });
  await wait(() => run(() => ws.active.path === 'Journal/Log.md'), 'Journal/Log.md did not open');
  await palette('note from template', 'Templates: Create new note from template');
  await pickTemplate('Standup');
  await press('Enter');
  await wait(() => run(() => ws.active.path === 'Journal/Untitled.md'), 'a current-folder note was not created beside the open note');
  await wait(() => text().then((s) => s === 'Standup Untitled\n'), 'the standup template was not filled in');
  assert.equal(await text(), 'Standup Untitled\n');
  await wait(() => run(() => document.activeElement?.classList.contains('inline-title') && getSelection()?.toString() === 'Untitled'), 'the current-folder note did not select its title');
  check(true, 'the new-note folder follows Files and links, including the current folder');

  await run(async () => {
    const { settings } = await import('/src/settings/store.ts');
    settings.set('app.json', 'newFileLocation', 'root');
  });
  await palette('note from template', 'Templates: Create new note from template');
  await pickTemplate('Standup');
  await press('Enter');
  await wait(() => run(() => ws.active.path === 'Untitled.md'), 'a root new-note location did not create Untitled.md');
  await wait(() => text().then((s) => s === 'Standup Untitled\n'), 'the root note was not filled from the template');
  assert.equal(await text(), 'Standup Untitled\n');
  check(true, 'the vault root is used when new notes go there');

  const rootBefore = await paths();
  await palette('note from template', 'Templates: Create new note from template');
  await pickTemplate('Gone');
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.deletePath('Templates/Gone.md', true);
    await ws.vault.refreshFiles();
  });
  await press('Enter');
  await wait(() => run(() => document.querySelector('.bases-copy-notice')?.textContent === "Couldn't read that template."), 'a missing template did not say it could not be read');
  await sleep(80);
  assert.deepEqual((await paths()).slice().sort(), rootBefore.filter((p) => p !== 'Templates/Gone.md').sort());
  check(await run(() => ws.active.path === 'Untitled.md'), 'a missing template creates no note');
  check(true, 'a missing template creates nothing');

  await run(async () => {
    const { settings } = await import('/src/settings/store.ts');
    settings.set('templates.json', 'dateFormat', 'D MMM YYYY');
    settings.set('templates.json', 'timeFormat', 'HH:mm');
  });
  stamp = await clock();
  const stampText = (s) => run(async (dateFormat, time) => {
    const { formatDate } = await import('/src/settings/dateFormat.ts');
    return `${formatDate(new Date(), dateFormat)} ${time}\n`;
  }, 'D MMM YYYY', s.time);
  await palette('note from template', 'Templates: Create new note from template');
  await pickTemplate('Stamp');
  await press('Enter');
  await wait(() => run(() => ws.active.path === 'Untitled 1.md'), 'the formatted note did not open');
  const wantStamp = async () => {
    const now = await clock();
    const exact = await stampText(stamp);
    const alt = await stampText({ time: nextMinute(stamp.time) });
    const later = await stampText(now);
    const got = await text();
    return got === exact || got === alt || got === later;
  };
  await wait(wantStamp, 'settings date and time formats were not filled in');
  check(await wantStamp(), 'the new note uses the Templates date and time formats');

  await run(async () => {
    const { settings } = await import('/src/settings/store.ts');
    settings.set('core-plugins.json', 'templates', false);
  });
  await chord('p');
  await wait(() => run(() => !!document.querySelector('.prompt-input')), 'command palette did not open');
  await send('Input.insertText', { text: 'note from template' });
  await sleep(80);
  check(await run(() => ![...document.querySelectorAll('.suggestion-title')].some((el) => el.textContent === 'Templates: Create new note from template')), 'the command is hidden while Templates is off');
  await press('Escape');

  assert.deepEqual(await run(() => consoleErrors), []);
  console.log('Create from template: browser checks passed');
});
