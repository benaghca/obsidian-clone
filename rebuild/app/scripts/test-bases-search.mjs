// Bases B6 with real pointer and key input in the scratch mock vault: the
// toolbar Search box (table, groups and summaries, cards, an embedded block;
// nothing is written), and the header menu's "Edit property..." (the column's
// display name, written to the .base) and "Property type" (the vault's
// types.json, never the .base or a note). Menus open on frame 1 or 2.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const NOTES = {
  'SearchTest/Alpha.md': '---\nstatus: open\npriority: 1\n---\n',
  'SearchTest/Alphabet soup.md': '---\nstatus: done\npriority: 5\n---\n',
  'SearchTest/Beta.md': '---\nstatus: done\npriority: 2\n---\n',
  'SearchTest/Delta.md': '---\nstatus: waiting\npriority: 2\n---\n',
  'SearchTest/Gamma.md': '---\nstatus: open\npriority: 3\n---\n',
  'SearchTest/Omega.md': '---\nstatus: open\n---\n',
};
const BASE = `filters: 'file.inFolder("SearchTest")'
views:
  - type: table
    name: Table
    order: [file.name, status, priority]
  - type: table
    name: Grouped
    order: [file.name, status]
    groupBy:
      property: status
      direction: ASC
    summaries:
      file.name: Count
  - type: cards
    name: Cards
    order: [status]
`;
const HOST = "# Host\n\n```base\nfilters: 'file.inFolder(\"SearchTest\")'\nviews:\n  - type: table\n    name: Embedded\n    order: [file.name, status]\n```\n\nAfter.\n";

await withBrowser(async ({ run, send, click, move, press, check }) => {
  const wait = async (test, label) => { for (let i = 0; i < 150; i++) { if (await test()) return; await sleep(20); } assert.fail(label); };
  const source = path => run(async p => { const { api } = await import('/src/api.ts'); return api.readNote(p); }, path);
  const names = (scope = '.bases-view') => run(scope => {
    const el = [...document.querySelectorAll(scope)].find(e => e.offsetParent);
    return [...el.querySelectorAll('.bases-table tbody tr[data-path], .bases-card')].map(r => r.dataset.path.replace(/^SearchTest\/|\.md$/g, ''));
  }, scope);
  const count = () => run(() => [...document.querySelectorAll('.bases-count span')].find(e => e.offsetParent)?.textContent);
  const shows = async (want, label, scope) => { await wait(async () => JSON.stringify(await names(scope)) === JSON.stringify(want), `${label}: ${JSON.stringify(await names(scope))}`); check(true, `${label}: ${want.join(', ') || 'none'}`); };
  // Real typing: a key down with its text, then up. Each keystroke's time to the next painted frame showing its result is kept.
  const keystrokes = [];
  const type = async text => {
    for (const ch of text) {
      await run(() => { window.b6Key = { at: 0, before: [...document.querySelectorAll('.bases-count span')].find(e => e.offsetParent)?.textContent }; document.addEventListener('keydown', e => { b6Key.at = performance.now(); }, { once: true, capture: true }); });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, windowsVirtualKeyCode: ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0) });
      keystrokes.push(await run(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - b6Key.at), 0)))));
    }
  };
  const menuItem = title => run(title => {
    const el = [...document.querySelectorAll('.menu-item')].find(el => el.querySelector('.menu-item-title')?.textContent === title);
    if (!el) throw Error('No menu item ' + title);
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, title);
  const centre = selector => run(selector => { const r = [...document.querySelectorAll(selector)].find(e => e.offsetParent).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
  // The frame a menu first shows in, counted from the pointer press, and the longest frame meanwhile.
  const timed = async (target, button, selector = '.menu', label) => {
    await run(selector => document.addEventListener('pointerdown', () => {
      window.b6Menu = { visible: 0, max: 0 }; let last = performance.now(), frame = 0;
      requestAnimationFrame(function tick(now) { frame++; b6Menu.max = Math.max(b6Menu.max, now - last); last = now; if (!b6Menu.visible && document.querySelector(selector)) b6Menu.visible = frame; if (frame < 12) requestAnimationFrame(tick); });
    }, { once: true, capture: true }), selector);
    await click(target, button); await sleep(220);
    const t = await run(() => b6Menu);
    check(t.visible > 0 && t.visible <= 2 && t.max < 20, `${label} opens on frame ${t.visible}, max frame ${t.max.toFixed(1)}ms`);
    assert.equal(await run(() => [...document.querySelectorAll('.menu')].some(el => el.getAnimations().length > 0)), false, `${label} has no animation`);
  };
  const view = async name => { await click('.bases-view-name'); await click(await menuItem(name)); await wait(async () => await run(() => document.querySelector('.bases-view-name span')?.textContent) === name, `view ${name}`); };

  await run(async (notes, base, host) => {
    const { api } = await import('/src/api.ts');
    for (const [path, text] of Object.entries({ ...notes, 'Search.base': base, 'SearchHost.md': host })) await api.createNote(path, text);
    // Every note or .base write, and every settings write, by path.
    window.b6Writes = []; const note = api.writeNote, config = api.writeConfig;
    api.writeNote = (path, text) => { b6Writes.push(path); return note(path, text); };
    api.writeConfig = (name, text) => { b6Writes.push(`.grove/${name}`); return config(name, text); };
    await ws.vault.refreshFiles(); await ws.open('Search.base');
  }, NOTES, BASE, HOST);
  const writes = () => run(() => b6Writes.splice(0));
  await shows(['Alpha', 'Alphabet soup', 'Beta', 'Delta', 'Gamma', 'Omega'], 'the base opens');

  // The Search box: an icon that opens a text box; typing narrows the rows, ignoring case, every word in any shown value.
  await click('.bases-search-toggle');
  assert.equal(await run(() => document.activeElement?.matches('.bases-search-input') && !document.activeElement.hidden), true, 'the box opens focused');
  await type('ALP');
  await shows(['Alpha', 'Alphabet soup'], 'typing filters by the name');
  assert.equal(await count(), '2 results');
  assert.equal(await run(() => document.querySelector('.bases-search-toggle').classList.contains('is-active')), true);
  await type(' soup');
  await shows(['Alphabet soup'], 'every word must match');
  for (let i = 0; i < 5; i++) await press('Backspace');
  await shows(['Alpha', 'Alphabet soup'], 'deleting words widens the rows again');
  for (let i = 0; i < 3; i++) await press('Backspace');
  await shows(['Alpha', 'Alphabet soup', 'Beta', 'Delta', 'Gamma', 'Omega'], 'an empty box shows every row');
  await type('open 3');
  await shows(['Gamma'], 'words match across columns (status and priority)');
  await press('Escape');
  await shows(['Alpha', 'Alphabet soup', 'Beta', 'Delta', 'Gamma', 'Omega'], 'Escape clears the search');
  assert.equal(await run(() => document.querySelector('.bases-search-input').hidden), true, 'Escape closes the box');
  await type('zzz'); // focus is on the toggle: nothing to search
  assert.equal(await count(), '6 results');

  // Groups and summaries follow the search: the group counts and the Count summary are of the rows shown.
  await click('.bases-search-toggle'); await type('done');
  await shows(['Alphabet soup', 'Beta'], 'table: done');
  await view('Grouped');
  await shows(['Alphabet soup', 'Beta'], 'the search stays when the view changes');
  const grouped = () => run(() => ({ groups: [...document.querySelectorAll('.bases-b5-toggle')].map(b => b.getAttribute('aria-label')), total: document.querySelector('tfoot [data-summary]')?.dataset.value }));
  assert.deepEqual(await grouped(), { groups: ['done (2)'], total: '2' });
  await click('.bases-search-input'); await press('End');
  for (let i = 0; i < 4; i++) await press('Backspace');
  await type('alpha');
  await shows(['Alphabet soup', 'Alpha'], 'grouped: alpha, by group');
  assert.deepEqual(await grouped(), { groups: ['done (1)', 'open (1)'], total: '2' });
  check(true, 'group headings and summaries count the rows shown');

  // Cards: the title and the card's properties are searched.
  await view('Cards');
  await shows(['Alpha', 'Alphabet soup'], 'cards: alpha (the title)');
  await click('.bases-search-input'); await press('End');
  for (let i = 0; i < 5; i++) await press('Backspace');
  await type('waiting');
  await shows(['Delta'], 'cards: waiting (a card property)');
  await press('Escape');
  await shows(['Alpha', 'Alphabet soup', 'Beta', 'Delta', 'Gamma', 'Omega'], 'cards: cleared');
  assert.equal(await source('Search.base'), BASE);
  assert.deepEqual(await writes(), [], 'searching writes nothing');
  check(true, 'searching never writes the .base file or a note');

  // Header menu: "Edit property..." sets the column's display name in the .base.
  await view('Table');
  await timed(await centre('th[data-property="status"]'), 'right', '.menu', 'the header menu');
  await timed(await menuItem('Edit property...'), 'left', '.bases-edit-property-menu .bases-edit-property', '"Edit property..."');
  assert.equal(await run(() => document.activeElement?.getAttribute('aria-label') === 'Display name' && document.activeElement.value === 'status' && document.activeElement.selectionStart === 0 && document.activeElement.selectionEnd === 6), true, 'the display name is selected');
  await type('State'); await press('Enter');
  const named = BASE.replace('views:', 'properties:\n  note.status:\n    displayName: State\nviews:');
  await wait(async () => await source('Search.base') === named, 'display name written');
  await wait(() => run(() => document.querySelector('th[data-property="status"] span')?.textContent === 'State'), 'header renamed');
  check(true, 'Edit property writes properties.note.status.displayName and renames the header');
  await click(await centre('th[data-property="status"]'), 'right'); await click(await menuItem('Edit property...'));
  await type('Other'); await press('Escape'); await sleep(150);
  assert.equal(await source('Search.base'), named, 'Escape keeps the name');
  await click(await centre('th[data-property="status"]'), 'right'); await click(await menuItem('Edit property...'));
  await press('Backspace'); await press('Enter');
  await wait(async () => await source('Search.base') === BASE, 'an empty name removes the block');
  check(true, 'an empty display name gives back the original bytes');
  assert.deepEqual(await writes(), ['Search.base', 'Search.base']);

  // Header menu: "Property type" is the vault's type for the name (types.json), the same submenu as the Properties block's.
  await click(await centre('th[data-property="priority"]'), 'right');
  await timed(await menuItem('Property type'), 'left', '.menu.mod-submenu', 'the Property type submenu');
  assert.equal(await run(() => [...document.querySelectorAll('.menu.mod-submenu .menu-item.is-checked .menu-item-title')].map(e => e.textContent).join()), 'Automatic (Number)');
  await click(await menuItem('Text'));
  await wait(() => run(() => !!document.querySelector('th[data-property="priority"] .lucide-text-align-start')), 'header icon changes to text');
  await wait(async () => (await run(async () => { const { api } = await import('/src/api.ts'); return api.readConfig('types.json'); }))?.includes('"priority": "text"'), 'types.json written');
  assert.deepEqual(await writes(), ['.grove/types.json'], 'the type is written to types.json only');
  await click(await centre('th[data-property="priority"]'), 'right'); await click(await menuItem('Property type'));
  await click(await menuItem('Automatic (Number)'));
  await wait(() => run(() => !!document.querySelector('th[data-property="priority"] .lucide-binary')), 'header icon back to number');
  await wait(async () => !(await run(async () => { const { api } = await import('/src/api.ts'); return api.readConfig('types.json'); }))?.includes('priority'), 'types.json cleared');
  check(true, 'Property type writes types.json and redraws the column; Automatic removes it');
  await click(await centre('th[data-property="file.name"]'), 'right');
  assert.equal(await run(() => [...document.querySelectorAll('.menu-item')].find(el => el.textContent === 'Property type')?.classList.contains('is-disabled')), true, 'file columns have no type to choose');
  await press('Escape');
  assert.equal(await source('Search.base'), BASE);
  assert.deepEqual(await writes(), ['.grove/types.json']);

  // An embedded ```base block searches the same way and writes nothing to its note.
  await run(() => ws.open('SearchHost.md'));
  const embed = '.cm-content .bases-embed';
  await wait(() => run(e => document.querySelectorAll(`${e} .bases-table tbody tr[data-path]`).length === 6, embed), 'embed rows');
  await click(await centre(`${embed} .bases-search-toggle`));
  await type('gam');
  await shows(['Gamma'], 'the embedded base searches', embed);
  await press('Escape');
  await shows(['Alpha', 'Alphabet soup', 'Beta', 'Delta', 'Gamma', 'Omega'], 'the embedded base clears', embed);
  await sleep(400);
  assert.equal(await source('SearchHost.md'), HOST);
  assert.deepEqual(await writes(), [], 'searching an embed writes nothing');
  check(true, 'an embedded base searches without writing its note');

  const slowest = Math.max(...keystrokes);
  check(slowest < 50, `keystroke to painted result, ${keystrokes.length} keys: max ${slowest.toFixed(1)}ms (round trip through the test driver)`);
  console.log('B6_SEARCH_TEST', JSON.stringify({ keys: keystrokes.length, maxMs: slowest }));
});
