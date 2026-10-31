// KANBAN-EDGE-TESTS: try to break the merged Bases Kanban work (K1–K8).
// Headless only. Not wired into package.json; the notes file has the line to add.
// A failure here is a product bug to record, not to fix in this task.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const long = `${'長'.repeat(80)} end-mark`;
const SHOWN = [
  'KE/Alpha.md', 'KE/Beta.md', 'KE/Blank.md', 'KE/Case.md', 'KE/Delta.md', 'KE/Emoji.md',
  'KE/EmptyList.md', 'KE/List.md', 'KE/Long.md', 'KE/Loud.md', 'KE/Missing.md', 'KE/Needle.md', 'KE/Space.md',
];
const notes = {
  'KE/Alpha.md': '---\nstatus: todo\n---\nbody alpha\n',
  'KE/Beta.md': '---\nstatus: doing\n---\nbody beta\n',
  'KE/Gamma.md': '---\nstatus: review\n---\nbody gamma\n',
  'KE/Delta.md': '---\nstatus: todo\n---\nbody delta\n',
  'KE/Missing.md': 'body missing\n',
  'KE/Blank.md': '---\nstatus: ""\n---\nblank\n',
  'KE/EmptyList.md': '---\nstatus: []\n---\nempty list\n',
  'KE/Case.md': '---\nstatus: Todo\n---\ncase\n',
  'KE/Loud.md': '---\nstatus: TODO\n---\nloud\n',
  'KE/Emoji.md': '---\nstatus: "🚧 only"\n---\nemoji\n',
  'KE/Long.md': `---\nstatus: "${long}"\n---\nlong\n`,
  'KE/List.md': '---\nstatus: [left, right]\n---\nlist\n',
  'KE/Space.md': '---\nstatus: " "\n---\nspace\n',
  'KE/Needle.md': '---\nstatus: todo\n---\nneedle\n',
  'KE/Secret.md': '---\nstatus: secret\n---\nsecret\n',
  '.md': '---\nstatus: todo\n---\nnot a note\n',
  'KE/.md': '---\nstatus: todo\n---\nnot a note either\n',
};
const source = `filters:
  and:
    - 'file.inFolder("KE")'
    - 'status != "secret"'
views:
  - type: kanban
    name: Board
    order:
      - file.name
      - status
    groupBy:
      property: status
      direction: ASC
      order:
        - todo
        - doing
        - "🚧 only"
        - null
        - waiting
      hidden:
        - review
    sort:
      - property: file.name
        direction: ASC
  - type: list
    name: List
    markers: bullets
    order:
      - file.name
      - status
    groupBy:
      property: status
      direction: ASC
  - type: table
    name: Table
    order:
      - file.name
      - status
    groupBy:
      property: status
      direction: ASC
    summaries:
      file.name: Count
`;
const other = `filters:
  and:
    - 'file.inFolder("KE")'
    - 'status != "secret"'
views:
  - type: table
    name: Other
    order:
      - file.name
      - status
`;

await withBrowser(async ({ run, click, point, send, press, chord, check }) => {
  const wait = async (test, label, tries = 400) => {
    for (let i = 0; i < tries; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const read = path => run(async path => { const { api } = await import('/src/api.ts'); return api.readNote(path); }, path);
  const item = title => run(title => {
    const el = [...document.querySelectorAll('.menu-item')].find(e => e.querySelector('.menu-item-title')?.textContent === title);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, title);
  const choose = async title => { await wait(async () => !!await item(title), `menu item ${title}`); await click(await item(title)); };
  const closeMenu = async () => { if (await run(() => !!document.querySelector('.menu'))) await press('Escape'); };
  const view = async name => {
    await closeMenu();
    await click('.bases-view-name');
    await choose(name);
    await wait(() => run(name => document.querySelector('.bases-view-name span')?.textContent === name, name), name);
  };
  const card = path => `.bases-kanban-card[data-path='${path}']`;
  const focus = async path => { await run(path => document.querySelector(`.bases-kanban-card[data-path='${path}']`).focus(), path); };
  const colOf = path => run(path => document.querySelector(`.bases-kanban-card[data-path='${path}']`)?.closest('.bases-kanban-col')?.dataset.groupId ?? '', path);
  const activePath = () => run(() => document.activeElement?.dataset.path ?? document.activeElement?.className ?? '');
  const notice = () => run(() => document.querySelector('.bases-move-notice')?.textContent ?? '');
  const undoReady = () => run(() => {
    const button = document.querySelector('.bases-move-notice button');
    return !!button && !button.hidden && (document.querySelector('.bases-move-notice')?.textContent ?? '').includes('Moved');
  });
  const writes = () => run(() => kEdgeWrites.length);
  const stroke = async points => {
    const [from, ...rest] = points;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', clickCount: 1 });
    let prev = from;
    for (const target of rest) {
      for (let i = 1; i <= 6; i++) {
        const p = { x: prev.x + (target.x - prev.x) * i / 6, y: prev.y + (target.y - prev.y) * i / 6 };
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p, buttons: 1 });
        await sleep(12);
      }
      prev = target;
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...prev, button: 'left', clickCount: 1 });
    await sleep(40);
  };
  const columns = async () => {
    const seen = new Map();
    const max = await run(() => document.querySelector('.bases-kanban-track')?.scrollWidth ?? 0);
    for (let x = 0; x <= max; x += 280) {
      await run(x => { document.querySelector('.bases-kanban').scrollLeft = x; }, x);
      await sleep(45);
      const part = await run(() => [...document.querySelectorAll('.bases-kanban-col')].map(c => ({
        id: c.dataset.groupId,
        label: c.querySelector('.bases-kanban-label').textContent,
        count: c.querySelector('.bases-kanban-count').textContent,
        empty: c.querySelector('.bases-kanban-empty')?.textContent ?? '',
        cards: [...c.querySelectorAll('.bases-kanban-card')].map(el => el.dataset.path),
      })));
      for (const col of part) seen.set(col.id, col);
    }
    await run(() => { document.querySelector('.bases-kanban').scrollLeft = 0; });
    await sleep(40);
    return [...seen.values()];
  };
  const installCsv = () => run(() => {
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { if (String(blob.type).startsWith('text/csv')) window.__csvBlob = blob; return orig(blob); };
    document.addEventListener('click', e => {
      const a = e.target instanceof Element && e.target.closest('a[download]');
      if (!a) return;
      e.preventDefault();
      window.__csvName = a.download;
    }, true);
  });
  const csv = async () => {
    await run(() => { window.__csvBlob = null; window.__csvName = null; });
    await closeMenu();
    await click('.bases-count');
    await choose('Export CSV...');
    await wait(() => run(() => !!window.__csvBlob), 'csv blob');
    return run(async () => ({ name: window.__csvName, text: await window.__csvBlob.text() }));
  };

  await run(async (notes, source, other) => {
    const { api } = await import('/src/api.ts');
    for (const [path, body] of Object.entries(notes)) await api.createNote(path, body);
    await api.createNote('KE.base', source);
    await api.createNote('Other.base', other);
    await ws.vault.refreshFiles();
    await ws.open('KE.base');
    window.kEdgeWrites = [];
    window.kEdgeSlow = false;
    const original = api.setProperty;
    api.setProperty = async (...args) => {
      if (!args[2]) kEdgeWrites.push(args[0]);
      if (!args[2] && window.kEdgeSlow) await new Promise(r => setTimeout(r, 40));
      return original(...args);
    };
  }, notes, source, other);
  await wait(() => run(() => document.querySelector('.bases-kanban-card[data-path="KE/Alpha.md"]')?.classList.contains('is-movable')), 'board');
  await installCsv();

  const cols = await columns();
  const cards = cols.flatMap(c => c.cards).sort();
  const summary = cols.map(c => `${JSON.stringify(c.label)} ${c.count}`).join(' | ');
  assert.deepEqual(cards, [...SHOWN].sort(), summary);
  assert.equal(await run(() => document.querySelector('.bases-count span').textContent), `${SHOWN.length} results`, summary);
  const labelAt = name => cols.findIndex(c => c.label === name);
  assert.ok(labelAt('todo') >= 0 && labelAt('todo') < labelAt('doing') && labelAt('doing') < labelAt('🚧 only') && labelAt('🚧 only') < labelAt('No value') && labelAt('No value') < labelAt('waiting'), summary);
  assert.equal(cols.some(c => c.label === 'review' || c.cards.includes('KE/Gamma.md')), false, summary);
  assert.deepEqual(cols.find(c => c.label === 'todo').cards, ['KE/Alpha.md', 'KE/Delta.md', 'KE/Needle.md']);
  assert.deepEqual(cols.find(c => c.id === 'empty').cards, ['KE/Blank.md', 'KE/EmptyList.md', 'KE/Missing.md']);
  assert.deepEqual(cols.find(c => c.label === 'Todo').cards, ['KE/Case.md']);
  assert.deepEqual(cols.find(c => c.label === 'TODO').cards, ['KE/Loud.md']);
  assert.notEqual(cols.find(c => c.label === 'todo').id, cols.find(c => c.label === 'Todo').id);
  assert.deepEqual(cols.find(c => c.label === '🚧 only').cards, ['KE/Emoji.md']);
  assert.deepEqual(cols.find(c => c.label === long).cards, ['KE/Long.md']);
  assert.deepEqual(cols.find(c => c.label === 'left, right').cards, ['KE/List.md']);
  assert.equal(cols.filter(c => c.cards.includes('KE/List.md')).length, 1, 'a list value is one column');
  const space = cols.find(c => c.id === 's:" "');
  assert.ok(space && space.cards.length === 1 && space.cards[0] === 'KE/Space.md', summary);
  const waiting = cols.find(c => c.label === 'waiting');
  assert.equal(waiting.count, '0');
  assert.match(waiting.empty, /waiting/);
  assert.equal(cols.some(c => c.cards.some(path => path === '.md' || path === 'KE/.md' || path === 'KE/Secret.md')), false);
  check(true, 'Odd groups stay distinct; empty, hidden, filtered and ".md" stay out; waiting is an empty column');

  const exported = await csv();
  const lines = exported.text.split('\n');
  assert.equal(exported.name, 'Board.csv');
  assert.equal(lines.length, SHOWN.length + 1, exported.text);
  for (const path of SHOWN) {
    const name = path.slice('KE/'.length, -'.md'.length);
    assert.ok(lines.some(line => line.startsWith(`${name},`) || line.startsWith(`"${name}"`)), name);
  }
  assert.equal(lines.some(line => line.startsWith('Gamma') || line.startsWith('Secret')), false, exported.text);
  check(true, 'Kanban CSV is the shown cards: hidden review, the search filter, and ".md" are absent');

  // Pointer: drop on this column, including a trip onto the next column and back to the same point.
  const alpha0 = await read('KE/Alpha.md');
  const base0 = await read('KE.base');
  const writes0 = await writes();
  const origin = await point(card('KE/Alpha.md'));
  await stroke([origin, { x: origin.x, y: origin.y + 48 }]);
  await wait(() => notice().then(text => text.includes('Move cancelled')), 'drop inside the same column');
  assert.equal(await read('KE/Alpha.md'), alpha0);
  assert.equal(await run(() => ws.active.viewFile), 'KE.base');
  assert.equal(await run(() => ws.active.path), null, 'a cancelled drag does not open the card');
  assert.equal(await run(() => !!document.querySelector('.bases-move-ghost, .bases-kanban-col.is-drop-target')), false);
  await stroke([origin, { x: origin.x + 200, y: origin.y }, origin]);
  await wait(() => notice().then(text => text.includes('Move cancelled')), 'release back on the same point');
  assert.equal(await read('KE/Alpha.md'), alpha0);
  assert.equal(await writes(), writes0);
  const head = await point('.bases-kanban-col .bases-kanban-label');
  await stroke([head, { x: head.x + 180, y: head.y }, head]);
  await wait(() => notice().then(text => text.includes('Move cancelled')), 'header released on its own position');
  assert.equal(await read('KE.base'), base0);
  check(true, 'Dropping a card or a header back on itself writes nothing and does not open the note');

  // Keyboard only, from the view control. Space on the card's own column is not a move.
  await run(() => document.querySelector('.bases-view-name').focus());
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await press('Tab');
    reached = await run(() => document.activeElement?.classList.contains('bases-kanban-card'));
  }
  assert.equal(reached, true, 'Tab from the view name reaches a card');
  assert.equal(await activePath(), 'KE/Alpha.md');
  await press('ArrowDown');
  assert.equal(await activePath(), 'KE/Delta.md');
  await press('ArrowDown');
  assert.equal(await activePath(), 'KE/Needle.md');
  await press('ArrowUp');
  assert.equal(await activePath(), 'KE/Delta.md');
  await press('Home');
  assert.equal(await activePath(), 'KE/Alpha.md');
  await press('End');
  assert.equal(await activePath(), 'KE/Needle.md');
  await press('Home');
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 });
  assert.equal(await activePath(), 'KE/Needle.md', 'PageDown');
  await press('Home');
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 });
  assert.equal(await activePath(), 'KE/Alpha.md', 'PageUp');
  await press('ArrowRight');
  assert.equal(await activePath(), 'KE/Beta.md');
  await press('ArrowLeft');
  assert.equal(await activePath(), 'KE/Alpha.md');
  await press(' ');
  await press('ArrowRight');
  await press('ArrowLeft');
  await press(' ');
  await sleep(80);
  assert.equal(await read('KE/Alpha.md'), alpha0);
  assert.equal(await writes(), writes0);
  await press(' ');
  await press('ArrowRight');
  await press('Escape');
  await wait(() => notice().then(text => text.includes('Move cancelled')), 'Escape cancels keyboard pickup');
  assert.equal(await read('KE/Alpha.md'), alpha0);
  check(true, 'Keyboard moves between cards; dropping back on the same column, or Escape, writes nothing');

  // An empty manual column is a real drop target from the keyboard, and undo walks back.
  const order = cols.map(c => c.id);
  const steps = order.slice(order.indexOf('s:"todo"') + 1, order.indexOf('s:"waiting"') + 1);
  assert.deepEqual(steps, ['s:"doing"', 's:"🚧 only"', 'empty', 's:"waiting"'], order.join(' > '));
  const delta0 = await read('KE/Delta.md');
  await focus('KE/Delta.md');
  for (const id of steps) {
    await press('ArrowRight', 1);
    await wait(async () => await colOf('KE/Delta.md') === id, `Delta to ${id}`);
    await wait(undoReady, `undo ready after ${id}`);
  }
  assert.match(await read('KE/Delta.md'), /status: waiting/);
  await run(() => document.querySelector('.bases-kanban').focus());
  for (let i = 0; i < steps.length; i++) await press('z', 2);
  await wait(async () => await read('KE/Delta.md') === delta0, 'Delta bytes restored');
  await wait(async () => await colOf('KE/Delta.md') === 's:"todo"', 'Delta back in todo');
  check(true, 'Alt+Right walks onto the empty waiting column; the same number of undos restores the note');

  // Queued undo/redo while each write is still in flight.
  await focus('KE/Alpha.md');
  await press('ArrowRight', 1);
  await wait(async () => /status: doing/.test(await read('KE/Alpha.md')), 'Alpha moved');
  await wait(undoReady, 'Alpha undo ready');
  await run(() => { window.kEdgeSlow = true; document.querySelector('.bases-kanban').focus(); });
  const storm = [false, false, true, false, true, true];
  for (const redo of storm) await press('z', redo ? 10 : 2);
  await wait(async () => /status: doing/.test(await read('KE/Alpha.md')) && (await colOf('KE/Alpha.md')) === 's:"doing"', 'storm settled on doing');
  await run(() => { window.kEdgeSlow = false; });
  assert.ok((await read('KE/Alpha.md')).endsWith('body alpha\n'));
  check(true, 'Six queued undo/redo keypresses settle on the net redo');

  // Undo after the body changed outside the board. The property line still matches, so the body stays.
  const moved = await read('KE/Alpha.md');
  const edited = moved.replace('body alpha\n', 'body alpha edited outside\n');
  assert.notEqual(edited, moved);
  const fullBefore = await run(() => document.querySelector('.bases-view').reconcile.full);
  await run(async text => {
    const { api } = await import('/src/api.ts');
    await api.writeNote('KE/Alpha.md', text);
    ws.vault.written('KE/Alpha.md');
  }, edited);
  await wait(() => run(full => document.querySelector('.bases-view').reconcile.full > full, fullBefore), 'outside body edit rebuilds');
  await focus('KE/Alpha.md');
  await press('z', 2);
  await wait(async () => /status: todo/.test(await read('KE/Alpha.md')), 'undo after an outside body edit');
  assert.ok((await read('KE/Alpha.md')).endsWith('body alpha edited outside\n'));
  await wait(async () => await colOf('KE/Alpha.md') === 's:"todo"', 'Alpha painted back in todo');
  check(true, 'Undo after an outside body edit restores the property and keeps the new body');

  // Undo after a rename: the history path is gone. The renamed note stays as it was.
  await focus('KE/Beta.md');
  await press('ArrowLeft', 1);
  await wait(async () => /status: todo/.test(await read('KE/Beta.md')), 'Beta moved');
  await wait(undoReady, 'Beta undo ready');
  const beta = await read('KE/Beta.md');
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.renamePath('KE/Beta.md', 'KE/Beta-out.md');
    await ws.vault.refreshFiles();
  });
  await wait(() => run(() => !!document.querySelector('.bases-kanban-card[data-path="KE/Beta-out.md"]')), 'rename painted');
  assert.equal(await run(() => !!document.querySelector('.bases-kanban-card[data-path="KE/Beta.md"]')), false);
  await run(() => document.querySelector('.bases-kanban').focus());
  await press('z', 2);
  await wait(() => notice().then(text => text.includes("Can't undo")), 'undo after rename');
  assert.equal(await read('KE/Beta-out.md'), beta);
  assert.equal(await run(() => ws.vault.files.some(f => f.path === 'KE/Beta.md')), false);
  assert.ok((await read('KE/Alpha.md')).endsWith('body alpha edited outside\n'));
  check(true, 'Undo after a rename refuses and leaves the renamed note untouched');

  // Toolbar search on a filtered base: columns stay, CSV and the table summary follow the search.
  await run(() => { document.querySelector('.bases-kanban').scrollLeft = 0; });
  await click('.bases-search-toggle');
  await send('Input.insertText', { text: 'needle' });
  await wait(() => run(() => document.querySelector('.bases-count span').textContent === '1 results'), 'search one card');
  const searched = await columns();
  assert.deepEqual(searched.flatMap(c => c.cards), ['KE/Needle.md']);
  assert.equal(searched.find(c => c.label === 'waiting').count, '0');
  assert.equal(searched.some(c => c.label === 'No value'), true, searched.map(c => c.label).join(', '));
  assert.equal(searched.some(c => c.label === 'review'), false, searched.map(c => c.label).join(', '));
  assert.equal(searched.some(c => c.cards.includes('KE/Gamma.md') || c.cards.includes('KE/Secret.md')), false);
  const searchedCsv = await csv();
  assert.equal(searchedCsv.name, 'Board.csv');
  assert.equal(searchedCsv.text, 'file name,status\nNeedle,todo');
  await view('List');
  await wait(() => run(() => document.querySelectorAll('.bases-list-item').length === 1 && document.querySelector('.bases-list-item')?.dataset.path === 'KE/Needle.md'), 'list follows the search');
  assert.equal(await run(() => document.querySelector('.bases-count span').textContent), '1 results');
  await view('Table');
  await wait(() => run(() => document.querySelector('tfoot [data-summary]')?.dataset.value === '1'), 'summary follows the search');
  assert.deepEqual(await run(() => [...document.querySelectorAll('.bases-b5-toggle')].map(el => el.getAttribute('aria-label'))), ['todo (1)']);
  const tableCsv = await csv();
  assert.equal(tableCsv.name, 'Table.csv');
  assert.equal(tableCsv.text, 'file name,status\nNeedle,todo');
  await click('.bases-search-input');
  await press('Escape');
  await wait(() => run(() => document.querySelector('.bases-count span').textContent === '14 results'), 'search cleared on the table');
  assert.equal(await run(() => document.querySelector('tfoot [data-summary]')?.dataset.value), '14');
  assert.ok((await run(() => [...document.querySelectorAll('tbody tr[data-path]')].map(el => el.dataset.path))).includes('KE/Gamma.md'));
  assert.equal(await run(() => [...document.querySelectorAll('tbody tr[data-path]')].some(el => el.dataset.path === 'KE/Secret.md' || el.dataset.path === '.md' || el.dataset.path === 'KE/.md')), false);
  check(true, 'Search keeps columns; list, table summary and CSV follow it; hidden review returns on the table');

  // Renaming a column writes this base's display name only.
  await click('th[data-property="status"]', 'right');
  await choose('Edit property...');
  await wait(() => run(() => document.activeElement?.getAttribute('aria-label') === 'Display name'), 'display name focused');
  await chord('a');
  await send('Input.insertText', { text: 'State' });
  await press('Enter');
  await wait(async () => (await read('KE.base')).includes('displayName: State'), 'display name written');
  const alphaNote = await read('KE/Alpha.md');
  const renamed = await read('KE.base');
  assert.match(renamed, /displayName: State/);
  assert.match(renamed, /hidden:\n\s+- review/);
  assert.match(alphaNote, /status: todo/);
  assert.doesNotMatch(alphaNote, /State/);
  assert.equal(await read('Other.base'), other);
  await wait(() => run(() => document.querySelector('th[data-property="status"] span')?.textContent === 'State'), 'this table header');
  await run(() => ws.open('Other.base'));
  await wait(() => run(() => document.querySelector('th[data-property="status"] span')?.textContent === 'status'), 'other base keeps status');
  assert.equal(await read('Other.base'), other);
  await run(() => ws.open('KE.base'));
  await wait(() => run(() => !!document.querySelector('.bases-view-name span')), 'KE base back');
  await view('Board');
  await wait(() => run(() => !!document.querySelector('.bases-kanban-card[data-path="KE/Alpha.md"]')), 'board after rename');
  assert.equal(await run(() => document.querySelector('.bases-kanban-card[data-path="KE/Alpha.md"] .bases-kanban-key')?.textContent), 'State');
  assert.equal(await run(() => document.querySelector('.bases-kanban-card[data-path="KE/Alpha.md"]')?.closest('.bases-kanban-col')?.querySelector('.bases-kanban-label').textContent), 'todo');
  assert.equal(await run(() => !!document.querySelector('.bases-kanban-card[data-path="KE/Gamma.md"]')), false);
  check(true, 'Display name changes this base only: notes, the other base, and the group value stay');
});

// K6 echo: a save that lands after the own-write skip must not rebuild. A closed note has no echo.
await withBrowser(async ({ run, press, check }) => {
  const wait = async (test, label, tries = 400) => {
    for (let i = 0; i < tries; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const read = path => run(async path => { const { api } = await import('/src/api.ts'); return api.readNote(path); }, path);
  const board = `filters: 'file.inFolder("EC")'
views:
  - type: kanban
    name: Board
    order: [file.name, status]
    groupBy:
      property: status
      order: [todo, doing, review, done]
    sort:
      - property: file.name
        direction: ASC
`;
  const at = (path, id) => run((path, id) => document.querySelector(`.bases-kanban-col[data-group-id='s:"${id}"'] .bases-kanban-card[data-path='${path}']`) !== null, path, id);
  const rec = () => run(() => ({ ...document.querySelector('.bases-view').reconcile }));
  const live = () => run(() => kEdgeCols.every(el => el.isConnected));
  const focus = async path => { await run(path => document.querySelector(`.bases-kanban-card[data-path='${path}']`).focus(), path); };
  const keyboard = async (path, steps) => {
    await focus(path);
    await press(' ');
    for (let i = 0; i < Math.abs(steps); i++) await press(steps > 0 ? 'ArrowRight' : 'ArrowLeft');
    await press(' ');
  };
  await run(async board => {
    const { api } = await import('/src/api.ts');
    await api.createNote('EC/A.md', '---\nstatus: todo\n---\nbody A\n');
    await api.createNote('EC/B.md', '---\nstatus: todo\n---\nbody B\n');
    await api.createNote('EC/C.md', '---\nstatus: doing\n---\nbody C\n');
    await api.createNote('EC.base', board);
    await ws.vault.refreshFiles();
    await ws.open('EC.base');
    const original = api.writeNote.bind(api);
    api.writeNote = async (path, content) => {
      if (window.kEdgeHold === path) {
        window.kEdgeHold = '';
        await new Promise(r => setTimeout(r, 250));
      }
      return original(path, content);
    };
  }, board);
  await wait(() => run(() => document.querySelector('.bases-kanban-card[data-path="EC/A.md"]')?.classList.contains('is-movable')), 'echo board');
  await run(() => { window.kEdgeCols = [...document.querySelectorAll('.bases-kanban-col')]; });
  let before = await rec();
  await keyboard('EC/A.md', 1);
  await wait(() => rec().then(now => now.skip > before.skip && now.full === before.full), 'closed-note own write skipped');
  assert.equal(await live(), true, 'own skip keeps the closed-note columns');
  await run(() => { window.kEdgeCols = [...document.querySelectorAll('.bases-kanban-col')]; });
  const skipped = await rec();
  await run(() => ws.vault.written('EC/A.md'));
  await wait(() => rec().then(now => now.full > skipped.full), 'closed note has no echo');
  assert.equal(await live(), false, 'the closed-note notice rebuilds the columns');
  await wait(() => at('EC/A.md', 'doing'), 'A stays in doing');
  assert.match(await read('EC/A.md'), /status: doing/);
  check(true, 'A second file notice for a closed note rebuilds; the card stays where the move put it');

  await run(() => ws.open('EC/B.md', { where: 'right' }));
  await wait(() => run(() => !!ws.editors.doc('EC/B.md') && !!document.querySelector('.bases-kanban-card[data-path="EC/B.md"]')), 'B open beside the board');
  await sleep(500);
  await run(() => { window.kEdgeCols = [...document.querySelectorAll('.bases-kanban-col')]; window.kEdgeHold = 'EC/B.md'; });
  before = await rec();
  await keyboard('EC/B.md', 1);
  await wait(async () => {
    const now = await rec();
    return now.full === before.full && now.skip >= before.skip + 2 && await live() && /status: doing/.test(await read('EC/B.md'));
  }, 'save echo skipped', 800);
  assert.equal(await at('EC/B.md', 'doing'), true);
  assert.ok((await read('EC/B.md')).endsWith('body B\n'));
  const echoed = await rec();
  console.log('KEDGE_ECHO', JSON.stringify({ before, echoed }));
  check(echoed.full === before.full && echoed.skip >= before.skip + 2, 'the editor save after the own-write skip does not rebuild');

  await sleep(600);
  const aged = await rec();
  assert.equal(aged.full, echoed.full, 'quiet after the echo');
  await run(() => ws.vault.written('EC/B.md'));
  await wait(() => rec().then(now => now.full > aged.full), 'a later notice rebuilds');
  await wait(() => at('EC/B.md', 'doing'), 'B still in doing after the late notice');
  check(true, 'Once the echo was consumed, a later file notice rebuilds the same bytes');
});
