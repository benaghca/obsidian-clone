// Empty-canvas right-click: the board menu, Add web page, and Paste.
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({ run, send, open, read, click, press, check }) => {
  const fixture = { future: { keep: [1] }, nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 120, text: 'Alpha' }], edges: [] };
  const data = async () => JSON.parse(await read());
  const titles = () => run(() => [...document.querySelectorAll('.canvas-context-menu .menu-item-title')].map(e => e.textContent).join('|'));
  const item = async (title) => run(title => {
    const row = [...document.querySelectorAll('.menu-item')].find(el => el.querySelector('.menu-item-title')?.textContent === title);
    const r = row.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, title);
  const spot = async () => {
    const point = await run(() => {
      const view = document.querySelector('.canvas-view');
      const r = view.getBoundingClientRect();
      for (let y = r.top + 100; y < r.bottom - 90; y += 34) {
        for (let x = r.left + 36; x < r.right - 300; x += 34) {
          const el = document.elementFromPoint(x, y);
          if (el && view.contains(el) && !el.closest('.canvas-node, [data-edge-id], .canvas-controls, .canvas-card-menu, .canvas-selection-menu'))
            return { x: Math.round(x), y: Math.round(y) };
        }
      }
      return null;
    });
    check(point, 'Empty canvas has a point that is not a card, edge or control');
    return point;
  };
  const openMenu = async () => { const at = await spot(); await click(at, 'right'); return at; };
  const near = (card, at) => Math.abs(card.left - at.x) <= 1.5 && Math.abs(card.top - at.y) <= 1.5;

  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await open('BoardMenu.canvas', fixture);
  const original = await read();
  const at = await spot();
  await run(() => {
    document.addEventListener('pointerdown', () => {
      let last = performance.now(), frame = 0;
      window.boardTiming = { visible: 0, max: 0 };
      const tick = (now) => {
        frame++;
        window.boardTiming.max = Math.max(window.boardTiming.max, now - last);
        last = now;
        const menu = document.querySelector('.canvas-context-menu');
        if (!window.boardTiming.visible && menu && menu.getBoundingClientRect().width) window.boardTiming.visible = frame;
        if (frame < 19) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { once: true, capture: true });
  });
  await click(at, 'right');
  await sleep(340);
  const timing = await run(() => window.boardTiming);
  check(timing.visible > 0 && timing.visible <= 2 && timing.max < 20, `Board menu opens within two frames; max ${timing.max.toFixed(1)}ms`);
  check(await run(() => document.querySelector('.canvas-context-menu').getAnimations().length === 0), 'Board menu has no open animation');
  const menuBox = await run(() => document.querySelector('.canvas-context-menu').getBoundingClientRect().toJSON());
  check(Math.abs(menuBox.left - at.x) <= 1 && Math.abs(menuBox.top - at.y) <= 1, 'Board menu opens at the pointer');
  check(await titles() === 'Add card|Add note from vault|Add media from vault|Add web page|Create group|Undo|Paste|Snap to grid|Snap to objects|Read-only', 'Board menu lists the planned items and hides Redo');
  check(await run(() => ['sticky-note', 'file-text', 'file-image', 'globe', 'group', 'undo-2', 'clipboard-paste', 'grid-2x2', 'scan-line', 'lock'].every((name, i) => document.querySelectorAll('.canvas-context-menu .menu-item')[i]?.querySelector(`.lucide-${name}`))), 'Board menu uses the planned icons');
  check(await run(() => document.querySelectorAll('.canvas-context-menu .menu-separator').length === 3), 'Board menu keeps add, history and settings in separate sections');
  const flags = () => run(() => Object.fromEntries([...document.querySelectorAll('.canvas-context-menu .menu-item')].map(row => [row.querySelector('.menu-item-title').textContent, { checked: row.classList.contains('is-checked'), disabled: row.classList.contains('is-disabled') }])));
  let state = await flags();
  check(state['Snap to grid'].checked && state['Snap to objects'].checked && !state['Read-only'].checked && state.Undo.disabled, 'Snap toggles start checked and Undo is disabled');
  await click(await item('Undo'));
  check(await run(() => !!document.querySelector('.canvas-context-menu')) && await read() === original, 'Disabled Undo leaves the menu and the file alone');
  await press('Escape');
  check(await run(() => !document.querySelector('.menu')) && await read() === original, 'Escape closes the board menu without writing');

  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'right', modifiers: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'right', modifiers: 1, clickCount: 1 });
  await sleep(50);
  check(await titles() === 'Add card|Add note from vault|Add media from vault|Add web page|Create group|Undo|Paste|Snap to grid|Snap to objects|Read-only', 'Alt+right-click opens the same board menu');
  await press('Escape');

  await click('[data-node-id="a"]', 'right');
  check(await titles() === 'Zoom to selection|Edit|Remove', 'Right-click on a card keeps the selection menu');
  await press('Escape');
  await openMenu();
  check((await titles()).startsWith('Add card|'), 'Right-click on empty canvas stays the board menu while a card is selected');
  await press('Escape');

  const addedAt = await openMenu();
  await click(await item('Add card'));
  await sleep(350);
  check(await run(() => !!document.querySelector('.canvas-node.is-editing .cm-editor')), 'Add card opens the empty text editor');
  const cardBox = await run(() => [...document.querySelectorAll('.canvas-node')].find(el => el.dataset.nodeId !== 'a').getBoundingClientRect().toJSON());
  check(near(cardBox, addedAt), 'Add card places the top-left corner on the pointer');
  let nodes = (await data()).nodes;
  const card = nodes.find(n => n.id !== 'a');
  check(nodes.length === 2 && card.type === 'text' && card.text === '' && card.width === 250 && card.height === 60 && /^[0-9a-f]{16}$/.test(card.id), 'Add card writes one empty 250 by 60 text card');
  await press('Escape');
  const withCard = await read();
  const undoAt = await openMenu();
  check(!(await flags()).Undo.disabled && !(await titles()).includes('Redo'), 'Undo is enabled after adding a card');
  await click(await item('Undo'));
  await sleep(350);
  check(await read() === original, 'Undo from the board menu restores the exact file');
  await click(undoAt, 'right');
  check((await titles()).includes('Undo|Redo|Paste') && !(await flags()).Redo.disabled, 'Redo appears only when there is something to redo');
  await click(await item('Redo'));
  await sleep(350);
  check(await read() === withCard, 'Redo from the board menu restores the same card');

  let count = (await data()).nodes.length;
  await openMenu();
  await click(await item('Add web page'));
  check(await run(() => document.querySelector('.mod-confirm')?.getAttribute('aria-label') === 'Add web page' && document.activeElement?.getAttribute('aria-label') === 'Web page URL'), 'Add web page asks for a URL in the confirm dialog');
  await press('Escape');
  check(await run(() => !document.querySelector('.mod-confirm')) && (await data()).nodes.length === count, 'Cancel adds no web page');
  await openMenu();
  await click(await item('Add web page'));
  await run(() => { document.querySelector('.mod-confirm input').focus(); });
  await send('Input.insertText', { text: 'notaurl' });
  await press('Enter');
  await sleep(80);
  check((await data()).nodes.length === count && await run(() => !document.querySelector('.mod-confirm')), 'A non-URL is refused');
  await openMenu();
  await click(await item('Add web page'));
  await run(() => { document.querySelector('.mod-confirm input').focus(); });
  await send('Input.insertText', { text: 'javascript:alert(1)' });
  await press('Enter');
  await sleep(80);
  check((await data()).nodes.length === count, 'A javascript URL is refused');
  const pageAt = await openMenu();
  await click(await item('Add web page'));
  await run(() => { document.querySelector('.mod-confirm input').focus(); });
  await send('Input.insertText', { text: 'https://example.com/docs' });
  await press('Enter');
  await sleep(350);
  nodes = (await data()).nodes;
  const page = nodes.find(n => n.type === 'link');
  check(!!page && page.url === 'https://example.com/docs' && page.width === 400 && page.height === 120, 'Add web page creates a 400 by 120 link card');
  const pageBox = await run(id => document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect().toJSON(), page.id);
  check(near(pageBox, pageAt), 'The web page card sits on the pointer');
  check(await run(() => document.querySelector('.canvas-node-link a')?.textContent === 'https://example.com/docs' && !document.querySelector('.canvas-node.is-editing')), 'The link card shows its URL and does not open an editor');
  check(await run(() => performance.getEntriesByType('resource').every(entry => !entry.name.includes('example.com'))), 'Adding a web page does not fetch it');

  const pasteText = async (text, fallback = false) => {
    await run(text => navigator.clipboard.writeText(text), text);
    if (fallback) await run(() => { window.__groveExec = document.execCommand.bind(document); document.execCommand = () => false; });
    const at = await openMenu();
    await click(await item('Paste'));
    await sleep(350);
    if (fallback) await run(() => { document.execCommand = window.__groveExec; });
    return at;
  };
  const textAt = await pasteText('Hello canvas');
  nodes = (await data()).nodes;
  const pasted = nodes.find(n => n.type === 'text' && n.text === 'Hello canvas');
  check(!!pasted && pasted.width === 250 && pasted.height === 60, 'Paste of plain text creates a 250 by 60 text card');
  const textBox = await run(id => document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect().toJSON(), pasted.id);
  check(near(textBox, textAt) && await run(() => !document.querySelector('.canvas-node.is-editing')), 'The pasted text card sits on the pointer and does not open an editor');
  const urlAt = await pasteText('  https://jsoncanvas.org/spec  ', true);
  nodes = (await data()).nodes;
  const pastedUrl = nodes.find(n => n.url === 'https://jsoncanvas.org/spec');
  check(!!pastedUrl && pastedUrl.type === 'link', 'Paste of a lone URL creates a link card through the async clipboard fallback');
  const urlBox = await run(id => document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect().toJSON(), pastedUrl.id);
  check(near(urlBox, urlAt), 'The pasted link card sits on the pointer');
  count = nodes.length;
  await pasteText('See https://example.com today');
  nodes = (await data()).nodes;
  check(nodes.length === count + 1 && nodes.some(n => n.type === 'text' && n.text === 'See https://example.com today') && !nodes.some(n => n.url === 'https://example.com'), 'A URL inside a sentence stays a text card');
  count = nodes.length;
  await pasteText('   \n');
  check((await data()).nodes.length === count, 'Blank clipboard paste adds nothing');

  await openMenu();
  await click(await item('Read-only'));
  await sleep(80);
  check(await run(() => document.querySelector('.canvas-view').classList.contains('is-readonly')), 'Read-only from the board menu marks the canvas');
  await openMenu();
  check(await titles() === 'Undo|Snap to grid|Snap to objects|Read-only', 'Read-only hides add items, Create group and Paste');
  state = await flags();
  check(state.Undo.disabled && state['Read-only'].checked, 'Undo is disabled while the canvas is read-only');
  await press('Escape');
  await click('[aria-label="Canvas settings"]');
  check(await run(() => [...document.querySelectorAll('.menu-item-title')].map(e => e.textContent).join('|') === 'Snap to grid|Snap to objects|Read-only'), 'Gear menu stays the settings list');
  check(await run(() => [...document.querySelectorAll('.menu-item')].find(el => el.querySelector('.menu-item-title')?.textContent === 'Read-only')?.classList.contains('is-checked')), 'Gear menu shows the same Read-only state');
  await click(await item('Read-only'));
  await sleep(80);
  check(await run(() => !document.querySelector('.canvas-view').classList.contains('is-readonly')), 'Read-only toggles off from the gear menu');

  await openMenu();
  await click(await item('Snap to grid'));
  await click('[aria-label="Canvas settings"]');
  check(await run(() => [...document.querySelectorAll('.menu-item')].find(el => el.textContent === 'Snap to grid').classList.contains('is-checked') === false), 'Snap to grid is the same setting in both menus');
  await press('Escape');
  await openMenu();
  await click(await item('Snap to grid'));

  const groupAt = await openMenu();
  await click(await item('Create group'));
  await sleep(350);
  nodes = (await data()).nodes;
  const group = nodes.find(n => n.type === 'group');
  check(!!group && nodes[0].id === group.id && group.label === 'Untitled group' && group.width === 400 && group.height === 400 && /^[0-9a-f]{16}$/.test(group.id), 'Create group adds one empty 400 by 400 group ahead of the cards');
  const groupBox = await run(id => document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect().toJSON(), group.id);
  const alpha = nodes.find(n => n.id === 'a');
  check(alpha.x === 0 && alpha.y === 0 && near(groupBox, groupAt), 'The group sits on the pointer and leaves the other card where it was');
  check((await data()).future.keep.join(',') === '1', 'Board menu edits preserve unknown canvas fields');

  await click('[aria-label="Canvas help"]');
  check(await run(() => document.querySelector('.canvas-help')?.textContent.includes('Right-click')), 'Canvas help names Right-click');
  await press('Escape');
}, { height: 800 });
