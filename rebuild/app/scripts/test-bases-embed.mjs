// Bases B4: bases embedded in notes (a ```base block, ![[X.base#View]]) with
// real pointer and key input in the scratch mock vault: `this`, no writes when
// only viewing, cell edits, toolbar writes into the block, geometry, B0's quiet
// period, and scroll frames of a 1,000-row embed.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const EMBED_BASE = `filters: 'file.inFolder("EmbedTest")'
views:
  - type: table
    name: All
    order: [file.name, status]
  - type: table
    name: Open
    filters: 'status == "open"'
    order: [file.name, status, priority]
  - type: cards
    name: Cards
    order: [file.name, status]
`;
const HOST = `---
status: done
---
Intro line.

\`\`\`base
filters: 'file.inFolder("EmbedTest") && status == this.status'
views:
  - type: table
    name: Same status
    order: [file.name, status]
\`\`\`

Middle line.

![[Embed.base#Open]]

Last line.
`;
const SCROLL = `# Scroll\n\n\`\`\`base\nfilters: 'file.inFolder("EmbedBig")'\nviews:\n  - type: table\n    name: Big\n    order: [file.name, n]\n\`\`\`\n\nAfter.\n`;

await withBrowser(async ({ run, send, click, move, press, chord, check }) => {
  const wait = async (test, label) => { for (let i = 0; i < 150; i++) { if (await test()) return; await sleep(20); } assert.fail(label); };
  const source = path => run(async p => { const { api } = await import('/src/api.ts'); return api.readNote(p); }, path);
  // Embeds in document order: [0] the ```base block, [1] ![[Embed.base#Open]].
  const state = () => run(() => [...ws.view.contentDOM.querySelectorAll('.bases-embed')].map(e => ({
    name: e.querySelector('.bases-view-name span')?.textContent,
    count: e.querySelector('.bases-count span')?.textContent,
    rows: [...e.querySelectorAll('.bases-table tbody tr[data-path]')].map(r => r.dataset.path),
    cards: [...e.querySelectorAll('.bases-card')].map(c => c.dataset.path),
  })));
  // The middle of the `index`th match (or `dx` from its left), in document order.
  const centre = (selector, index = 0, dx = null) => run((selector, index, dx) => {
    const r = document.querySelectorAll(selector)[index].getBoundingClientRect();
    return { x: dx === null ? r.x + r.width / 2 : r.x + dx, y: r.y + r.height / 2 };
  }, selector, index, dx);
  const menu = async title => click(await run(title => {
    const el = [...document.querySelectorAll('.menu-item')].find(el => el.querySelector('.menu-item-title')?.textContent === title);
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, title));
  // CodeMirror measures on its next frame: settled within a second, or the mismatch is real.
  const geometry = async label => {
    const measure = () => run(() => [...ws.view.contentDOM.children].map(el => {
      const style = getComputedStyle(el);
      const pos = ws.view.posAtDOM(el, 0);
      return { text: el.textContent.slice(0, 40), margin: [parseFloat(style.marginTop), parseFloat(style.marginBottom)], delta: ws.view.documentTop + ws.view.lineBlockAt(pos).top - el.getBoundingClientRect().top };
    }));
    let rows = await measure();
    for (let i = 0; i < 50 && rows.some(r => Math.abs(r.delta) > 1); i++) { await sleep(20); rows = await measure(); }
    for (const row of rows) {
      assert.ok(Math.abs(row.delta) <= 1, `${label}: ${JSON.stringify(row)}`);
      assert.deepEqual(row.margin, [0, 0], `${label}: direct child vertical margins: ${row.text}`);
    }
    check(rows.some(r => r.text.includes('Same status')), `${label}: every line and the embedded base within 1px of CodeMirror's heights; no vertical margins`);
  };

  await run(async (base, host, scroll) => {
    const { api } = await import('/src/api.ts');
    window.b4Active = new Set(); window.b4Subscriptions = new Set();
    const mount = ws.embeds.base;
    ws.embeds.base = (...args) => { const item = mount(...args); b4Active.add(item); return { ...item, destroy() { b4Active.delete(item); item.destroy(); } }; };
    for (const [object, method] of [[ws, 'on'], [ws.vault, 'onModified']]) {
      const listen = object[method].bind(object);
      object[method] = fn => {
        const own = new Error().stack.split('\n')[2]?.includes('/src/bases/view.ts');
        if (own) b4Subscriptions.add(fn);
        const off = listen(fn);
        return () => { b4Subscriptions.delete(fn); off(); };
      };
    }
    for (const [n, s] of [['A', 'open'], ['B', 'done'], ['C', 'open']]) await api.createNote(`EmbedTest/${n}.md`, `---\nstatus: ${s}\npriority: ${n.charCodeAt(0) - 64}\n---\n# ${n}\n`);
    for (let i = 0; i < 1000; i++) await api.createNote(`EmbedBig/${String(i).padStart(4, '0')}.md`, `---\nn: ${i}\n---\n`);
    await api.createNote('Embed.base', base);
    await api.createNote('Host.md', host);
    await api.createNote('Scroll.md', scroll);
    await api.createNote('Elsewhere.md', '# Elsewhere\n');
    await ws.vault.refreshFiles(); await ws.vault.refreshLinks();
    window.b4Writes = [];
    const write = api.writeNote;
    api.writeNote = (path, text) => { b4Writes.push(path); return write(path, text); };
    const { propertyIndex } = await import('/src/shell/propertyIndex.ts');
    const index = propertyIndex(ws), notes = index.notes;
    window.b4Meter = { calls: 0 };
    index.notes = (...args) => { if (new Error().stack.includes('/src/bases/view.ts')) b4Meter.calls++; return notes(...args); };
  }, EMBED_BASE, HOST, SCROLL);

  // 1. Opening the note draws both embeds, with `this` as the note: cold (first property read), then warm.
  const openHost = () => run(async () => {
    await ws.open('Elsewhere.md'); ws.setMode('live');
    const begin = performance.now();
    const ready = new Promise((resolve, reject) => {
      const done = () => [...document.querySelectorAll('.bases-embed .bases-count span')].filter(s => /results$/.test(s.textContent)).length === 2;
      const observer = new MutationObserver(() => { if (done()) { observer.disconnect(); clearTimeout(timeout); resolve(performance.now() - begin); } });
      const timeout = setTimeout(() => { observer.disconnect(); reject(Error('embeds did not render')); }, 5000);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await ws.open('Host.md');
    return ready;
  });
  const coldMs = await openHost();
  const warmMs = [await openHost(), await openHost(), await openHost()];
  const openMs = Math.max(...warmMs);
  check(openMs <= 100, `both embedded bases render within 100 ms of opening the note (cold ${coldMs.toFixed(1)} ms, warm ${warmMs.map(n => n.toFixed(1)).join(' / ')} ms)`);
  let embeds = await state();
  assert.deepEqual(embeds.map(e => e.name), ['Same status', 'Open']);
  assert.deepEqual(embeds[0].rows, ['EmbedTest/B.md'], '```base block: status == this.status with the note at done');
  assert.deepEqual(embeds[1].rows, ['EmbedTest/A.md', 'EmbedTest/C.md'], '![[Embed.base#Open]] shows the view named Open');
  check(await run(() => document.querySelectorAll('.bases-embed')[0].parentElement === ws.view.contentDOM), 'the ```base block is a block widget; ![[X.base]] sits in its line');
  await geometry('live');
  await run(() => { for (const e of document.querySelectorAll('.bases-embed')) e.b4Kept = true; });

  // 2. Viewing writes nothing: switch the file embed's view with the mouse, to cards and back.
  await click(await centre('.bases-embed .bases-view-name', 1));
  await wait(() => run(() => !!document.querySelector('.bases-view-menu')), 'view menu opens');
  await menu('Cards');
  await wait(async () => (await state())[1].cards.length === 3, 'cards view in the embed');
  check((await state())[1].name === 'Cards', 'a .base embed switches to its card view');
  await click(await centre('.bases-embed .bases-view-name', 1));
  await menu('All');
  await wait(async () => (await state())[1].rows.length === 3, 'All view in the embed');
  assert.deepEqual(await run(() => b4Writes), [], 'opening and switching views writes nothing');
  assert.equal(await source('Embed.base'), EMBED_BASE);
  assert.equal(await source('Host.md'), HOST);
  check(true, 'viewing and switching an embedded view leave Embed.base and Host.md byte-identical, no writes');

  // 3. A file name opens its note; the note comes back with its embeds.
  await click(await run(() => { const r = document.querySelectorAll('.bases-embed')[1].querySelector('td[data-property="file.name"] a').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  await wait(() => run(() => ws.active.path === 'EmbedTest/A.md'), 'file name link opens the note');
  check(true, 'clicking a file name in an embed opens that note');
  await run(() => ws.open('Host.md'));
  await wait(async () => (await state()).length === 2 && (await state())[0].rows.length === 1, 'embeds back');
  await run(() => { for (const e of document.querySelectorAll('.bases-embed')) e.b4Kept = true; });

  // 4. Typing in the note: no rebuild during a burst, at most one after it, and the embeds keep their DOM.
  await click(await centre('.cm-line', await run(() => [...ws.view.contentDOM.querySelectorAll('.cm-line')].findIndex(l => l.textContent === 'Last line.')), 30));
  await press('End');
  const before = await run(() => b4Meter.calls);
  await run(() => { window.b4Frames = []; let last = performance.now(); window.b4Frame = requestAnimationFrame(function tick(t) { b4Frames.push(t - last); last = t; b4Frame = requestAnimationFrame(tick); }); });
  for (let i = 0; i < 5; i++) { await send('Input.insertText', { text: 'x' }); await sleep(100); }
  const during = await run(() => b4Meter.calls) - before;
  const typingMax = await run(() => { cancelAnimationFrame(b4Frame); return Math.max(...b4Frames.slice(2)); });
  await sleep(450);
  const after = await run(() => b4Meter.calls) - before;
  check(during === 0, `typing in the note does not rebuild its embedded bases (${during})`);
  check(after <= 1, `one rebuild at most after the quiet period: the block reads this (${after})`);
  check(typingMax < 20, `typing frames stay below 20ms (${typingMax.toFixed(1)}ms)`);
  check(await run(() => [...document.querySelectorAll('.bases-embed')].every(e => e.b4Kept)), 'typing keeps both embeds\' DOM');

  // 5. Changing the note `this` reads re-filters the block, though the note is outside its folder.
  await run(() => { const doc = ws.view.state.doc.toString(), at = doc.indexOf('status: done') + 8; ws.view.dispatch({ changes: { from: at, to: at + 4, insert: 'open' } }); });
  await wait(async () => (await state())[0].rows.join() === 'EmbedTest/A.md,EmbedTest/C.md', 'this.status follows the note');
  check(true, 'an edit to the note re-filters a base that reads this (A and C at open)');

  // 6. Editing a cell writes the row's note, not the note the base is in.
  // The block's row comes first in the document.
  const value = '.bases-embed tr[data-path="EmbedTest/C.md"] td[data-property="status"] [data-part="value"]';
  await click(await centre(value, 0, 8));
  await send('Input.insertText', { text: 'X' });
  await press('Enter');
  await wait(async () => (await source('EmbedTest/C.md')).includes('status: Xopen'), 'cell edit commits');
  await wait(async () => (await state())[0].rows.join() === 'EmbedTest/A.md', 'the edited row leaves the embed');
  check(!(await run(() => b4Writes)).includes('Embed.base'), 'a cell edit in an embed writes its row\'s note only');

  // 7. The header menu writes a sort into the ```base block, which keeps its DOM.
  const blockBefore = await run(() => ws.view.state.doc.toString());
  await click(await centre('.bases-embed th[data-property="file.name"]', 0), 'right');
  await menu('Sort Z → A');
  await wait(() => run(() => ws.view.state.doc.toString().includes('    sort:\n      - property: file.name\n        direction: DESC\n```')), 'sort written into the block');
  const blockAfter = await run(() => ws.view.state.doc.toString());
  assert.equal(blockAfter.replace(/\n {4}sort:\n {6}- property: file.name\n {8}direction: DESC/, ''), blockBefore, 'only the block\'s YAML changed');
  check(await run(() => document.querySelectorAll('.bases-embed')[0].b4Kept === true), 'the block embed keeps its DOM through its own write');
  assert.equal(await source('Embed.base'), EMBED_BASE);
  check(true, 'a toolbar write in a ```base block changes only the block in the note');
  // Undo/redo must preserve unsaved prose and update the live block rather than its old snapshot.
  await run(() => { ws.view.dispatch({ selection: { anchor: ws.view.state.doc.length } }); ws.view.focus(); });
  await chord('z');
  await wait(() => run(before => ws.view.state.doc.toString() === before, blockBefore), 'undo restores only the block edit');
  assert.ok(blockBefore.includes('xxxxx'), 'the prior unsaved prose is retained');
  await chord('y');
  await wait(() => run(after => ws.view.state.doc.toString() === after, blockAfter), 'redo restores the block edit');
  await run(() => ws.view.contentDOM.blur());
  await wait(async () => (await state()).filter(e => e.count).length === 2, 'block remounts after history');
  check(true, 'block toolbar undo/redo preserves unsaved prose and refreshes the embed');

  // 8. The file embed's own write goes to Embed.base, into the view it shows (Open again: the note was reopened).
  await click(await centre('.bases-embed th[data-property="file.name"]', 1), 'right');
  await menu('Sort Z → A');
  await wait(async () => (await source('Embed.base')).includes('direction: DESC'), 'sort written to Embed.base');
  assert.equal(await source('Embed.base'), EMBED_BASE.replace('order: [file.name, status, priority]\n', 'order: [file.name, status, priority]\n    sort:\n      - property: file.name\n        direction: DESC\n'));
  await wait(async () => (await state())[1].name === 'Open' && (await state())[1].rows.join() === 'EmbedTest/A.md', 'file embed keeps its view');
  check(true, 'a toolbar write in ![[X.base#Open]] writes the Open view of the .base file');

  // 9. "Edit this block" shows the block's source; leaving it draws the base again.
  await move(await centre('.bases-embed', 0));
  await click(await run(() => { const r = document.querySelector('.bases-embed > .embed-actions').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  await wait(() => run(() => [...ws.view.contentDOM.querySelectorAll('.cm-line')].some(l => l.textContent === '```base')), 'block source shows');
  check(await run(() => ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text.startsWith('filters:')), '"Edit this block" puts the caret in the block\'s YAML');
  await click(await centre('.cm-line', await run(() => [...ws.view.contentDOM.querySelectorAll('.cm-line')].findIndex(l => l.textContent.startsWith('Middle line'))), 20));
  await wait(async () => (await state()).length === 2, 'block drawn again');

  // 10. Reading view draws both, with the same geometry rules.
  await run(() => ws.setMode('reading'));
  await wait(async () => (await state()).filter(e => e.count).length === 2, 'reading view embeds');
  await geometry('reading');
  await run(() => ws.setMode('live'));

  // 11. A 1,000-row embed scrolls inside its capped box, virtualised, with no frame over 20 ms.
  await run(() => ws.open('Scroll.md'));
  await wait(() => run(() => document.querySelector('.bases-embed .bases-count span')?.textContent === '1000 results'), 'big embed');
  const box = await run(() => { const s = document.querySelector('.bases-embed .bases-scroll'); return { height: s.clientHeight, rows: s.querySelectorAll('tbody tr[data-path]').length }; });
  check(box.height <= 400 && box.height > 300 && box.rows < 100, `a 1,000-row embed is capped at 400px and virtualised (${box.height}px, ${box.rows} rows drawn)`);
  // Let the mock backend's delayed link refresh settle before timing frames (as test-bases.mjs does).
  await sleep(1200);
  // Frames are timed paging with the scrollbar, as test-bases.mjs does: synthetic wheel
  // events drop every other frame in headless Chromium, in a base tab just the same.
  const track = await run(() => { const r = document.querySelector('.bases-embed .bases-scroll').getBoundingClientRect(); return { x: r.right - 6, y: r.bottom - 20 }; });
  await move(track);
  await run(() => { window.b4Frames = []; let last = performance.now(); window.b4Frame = requestAnimationFrame(function tick(t) { b4Frames.push(t - last); last = t; b4Frame = requestAnimationFrame(tick); }); });
  for (let i = 0; i < 14; i++) { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...track, button: 'left', clickCount: 1 }); await sleep(25); }
  const scroll = await run(() => { cancelAnimationFrame(b4Frame); const s = document.querySelector('.bases-embed .bases-scroll'); return { max: Math.max(...b4Frames.slice(2)), top: s.scrollTop, page: ws.view.scrollDOM.scrollTop }; });
  check(scroll.top > 1000 && scroll.page === 0 && scroll.max < 20, `paging scrolls inside the embed, not the note (${scroll.top}px), max frame ${scroll.max.toFixed(1)}ms`);
  const wheelAt = await centre('.bases-embed .bases-scroll');
  await move(wheelAt);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheelAt, deltaX: 0, deltaY: 600 });
  await wait(() => run(top => document.querySelector('.bases-embed .bases-scroll').scrollTop > top, scroll.top), 'the wheel scrolls the embed');
  check(true, 'the wheel scrolls the embed');
  console.log('B4_METRICS', JSON.stringify({ coldMs, warmMs, typingMax, duringBurst: during, afterQuiet: after, scrollMax: scroll.max, box }));

  const indented = 'Intro\n\n  ```base\n  filters: \'file.inFolder("EmbedTest")\'\n  views:\n    - type: table\n      order: [file.name]\n  ```\n\nAfter\n';
  await run(async text => { const { api } = await import('/src/api.ts'); await api.createNote('Indented.md', text); await ws.vault.refreshFiles(); await ws.open('Indented.md'); }, indented);
  await wait(() => run(() => document.querySelector('.bases-count span')?.textContent === '3 results'), 'indented fence renders');
  await click(await centre('.bases-embed th[data-property="file.name"]'), 'right'); await menu('Sort Z → A');
  const sortedIndent = indented.replace('      order: [file.name]\n', '      order: [file.name]\n      sort:\n        - property: file.name\n          direction: DESC\n');
  await wait(() => run(expected => ws.view.state.doc.toString() === expected, sortedIndent), 'indented fence write preserves surrounding bytes');
  check(true, 'indented base fences render and retain their indentation on toolbar writes');

  // Closing the final note must destroy its widgets, not keep a live base in a hidden editor.
  await run(() => ws.closeTabs(ws.layout.tabs()));
  await wait(() => run(() => b4Active.size === 0 && b4Subscriptions.size === 0), 'closing all tabs disposes every base and subscription');
  assert.equal(await run(() => ws.view.contentDOM.querySelectorAll('.bases-embed').length), 0);
  await run(() => ws.open('Scroll.md'));
  await wait(() => run(() => b4Active.size === 1 && document.querySelector('.bases-count span')?.textContent === '1000 results'), 'reopening reconstructs the saved editor widgets');
  await run(() => ws.closeTabs(ws.layout.tabs()));
  await wait(() => run(() => b4Active.size === 0 && b4Subscriptions.size === 0), 'repeated close leaves no subscriptions');
  check(true, 'closing/reopening the final tab releases Bases widgets and workspace/vault subscriptions');

  // Renaming the host note, then its folder, keeps both embeds on the new path.
  const moveBase = `filters: 'file.path == this.file.path'
formulas:
  host: this.file.path
  folder: this.file.folder
views:
  - type: table
    name: First
    order: [file.name, formula.host, formula.folder, status]
  - type: table
    name: Named
    order: [file.name, formula.host, formula.folder, status]
`;
  const moveNote = `---
status: old
---
Self.

\`\`\`base
filters: 'file.path == this.file.path'
formulas:
  host: this.file.path
  folder: this.file.folder
views:
  - type: table
    name: Self
    order: [file.name, formula.host, formula.folder, status]
\`\`\`

![[HostMove.base#Named]]
`;
  const embedFacts = index => run(index => {
    const embed = document.querySelectorAll('.bases-embed')[index];
    const row = embed?.querySelector('tbody tr[data-path]');
    const values = {};
    for (const td of row?.querySelectorAll('td') ?? []) values[td.dataset.property] = td.dataset.value;
    return { name: embed?.querySelector('.bases-view-name span')?.textContent ?? '', path: row?.dataset.path ?? '', values };
  }, index);
  await run(async (base, note) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('HostMove.base', base);
    await api.createNote('Move/Rename.md', note);
    await ws.vault.refreshFiles();
    await ws.open('Move/Rename.md');
  }, moveBase, moveNote);
  await wait(async () => (await embedFacts(0)).path === 'Move/Rename.md' && (await embedFacts(1)).name === 'Named', 'rename fixture shows the host');
  let facts = [await embedFacts(0), await embedFacts(1)];
  assert.equal(facts[0].name, 'Self');
  assert.deepEqual(facts[0].values, { 'file.name': 'Rename', 'formula.host': 'Move/Rename.md', 'formula.folder': 'Move', status: 'old' });
  assert.deepEqual(facts[1].values, { 'file.name': 'Rename', 'formula.host': 'Move/Rename.md', 'formula.folder': 'Move', status: 'old' });
  await click(await centre('.bases-embed .bases-view-name', 1));
  await wait(() => run(() => !!document.querySelector('.bases-view-menu')), 'named view menu');
  await menu('First');
  await wait(async () => (await embedFacts(1)).name === 'First', 'file embed leaves the linked view');
  await run(async () => { const { renameFile } = await import('/src/fileOps.ts'); await renameFile(ws, 'Move/Rename.md', 'Moved'); });
  await wait(async () => (await embedFacts(0)).path === 'Move/Moved.md' && (await embedFacts(1)).path === 'Move/Moved.md', 'note rename updates both embeds');
  facts = [await embedFacts(0), await embedFacts(1)];
  assert.equal(facts[0].name, 'Self', 'the block keeps its view across the note rename');
  assert.equal(facts[1].name, 'First', 'the file embed keeps the view chosen after opening');
  assert.equal(facts[0].values['formula.host'], 'Move/Moved.md');
  assert.equal(facts[0].values['formula.folder'], 'Move');
  assert.equal(facts[0].values['file.name'], 'Moved');
  assert.equal(await run(() => ws.active.path), 'Move/Moved.md');
  await run(async () => { const { renameFile } = await import('/src/fileOps.ts'); await renameFile(ws, 'Move', 'Shifted'); });
  await wait(async () => (await embedFacts(0)).path === 'Shifted/Moved.md' && (await embedFacts(1)).values['formula.folder'] === 'Shifted', 'folder rename updates host facts');
  facts = [await embedFacts(0), await embedFacts(1)];
  assert.equal(facts[0].name, 'Self');
  assert.equal(facts[1].name, 'First');
  assert.equal(facts[1].values['formula.host'], 'Shifted/Moved.md');
  assert.equal(facts[1].values['file.name'], 'Moved');
  assert.equal(await source('HostMove.base'), moveBase, 'renames do not write the .base file');
  await run(async () => {
    const { api } = await import('/src/api.ts');
    window.b4WritePrev = api.writeNote;
    window.b4Held = [];
    api.writeNote = (path, text) => new Promise((resolve, reject) => b4Held.push({ path, text, resolve, reject }));
  });
  await run(() => {
    const doc = ws.view.state.doc.toString(), at = doc.indexOf('status: old');
    ws.view.dispatch({ changes: { from: at + 'status: '.length, to: at + 'status: old'.length, insert: 'fresh' } });
  });
  await wait(async () => (await embedFacts(0)).values.status === 'fresh' && (await embedFacts(1)).values.status === 'fresh', 'unsaved host status reaches both embeds');
  assert.equal((await embedFacts(0)).path, 'Shifted/Moved.md');
  assert.ok((await source('Shifted/Moved.md')).includes('status: old'), 'the host property is still unsaved');
  await run(async () => {
    const { api } = await import('/src/api.ts');
    const prev = b4WritePrev;
    const held = b4Held.splice(0);
    api.writeNote = prev;
    for (const entry of held) { try { await prev(entry.path, entry.text); entry.resolve(); } catch (error) { entry.reject(error); } }
  });
  const beforeClose = await run(() => b4Active.size);
  assert.equal(beforeClose, 2);
  await run(() => ws.closeTabs(ws.layout.tabs()));
  await wait(() => run(() => b4Active.size === 0 && b4Subscriptions.size === 0 && !document.querySelector('.bases-embed')), 'closing the renamed host releases both bases');
  check(true, 'renaming the host note and its folder keeps rows, host facts, and the chosen view');

  // A failed reread of a nested note must release the Base it painted, including after a newer fill wins.
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Nested.md', '```base\nfilters: \'file.path == this.file.path\'\nviews:\n  - type: table\n    name: Inside\n    order: [file.name]\n```\n');
    await api.createNote('Outer.md', 'Before\n\n![[Nested]]\n');
    await ws.vault.refreshFiles();
    await ws.open('Outer.md');
  });
  await wait(() => run(() => b4Active.size === 1 && document.querySelector('.bases-embed tbody tr')?.dataset.path === 'Nested.md'), 'nested base mounts');
  const mountsBefore = await run(() => {
    let mounts = 0;
    const current = ws.embeds.base;
    ws.embeds.base = (...args) => { mounts++; return current(...args); };
    window.b4Mounts = () => mounts;
    const read = ws.embeds.read.bind(ws.embeds);
    window.b4Read = read;
    let reads = 0;
    ws.embeds.read = path => {
      if (path !== 'Nested.md') return read(path);
      reads++;
      if (reads === 1) return new Promise((_, reject) => { window.b4StaleReject = reject; });
      return read(path);
    };
    return mounts;
  });
  assert.equal(mountsBefore, 0);
  await run(() => { ws.vault.written('Nested.md'); ws.vault.written('Nested.md'); });
  await wait(() => run(() => b4Mounts() === 1 && b4Active.size === 1 && !!document.querySelector('.bases-embed')), 'the newer nested fill mounts one base');
  await run(() => b4StaleReject(Error('stale')));
  await sleep(50);
  assert.equal(await run(() => b4Active.size), 1, 'a stale rejection does not destroy the newer base');
  assert.equal(await run(() => b4Mounts()), 1);
  assert.equal(await run(() => document.querySelectorAll('.bases-embed').length), 1);
  await run(() => {
    const read = b4Read;
    ws.embeds.read = path => path === 'Nested.md' ? Promise.reject(Error('missing')) : read(path);
    ws.vault.written('Nested.md');
  });
  await wait(() => run(() => b4Active.size === 0 && b4Subscriptions.size === 0 && !document.querySelector('.bases-embed') && !!document.querySelector('.markdown-embed-content')), 'a rejected nested read releases the base');
  check(await run(() => document.querySelector('.markdown-embed-content')?.textContent.includes('is not created yet')), 'the missing-note box replaces the nested base');
  await run(() => { ws.embeds.read = b4Read; ws.vault.written('Nested.md'); });
  await wait(() => run(() => b4Active.size === 1 && b4Mounts() === 2 && document.querySelector('.bases-embed tbody tr')?.dataset.path === 'Nested.md'), 'the nested base mounts once more when the read recovers');
  await run(() => ws.closeTabs(ws.layout.tabs()));
  await wait(() => run(() => b4Active.size === 0 && b4Subscriptions.size === 0), 'closing the outer note releases the recovered base');
  check(true, 'a rejected nested-note read releases its base, and a stale rejection does not');
});
