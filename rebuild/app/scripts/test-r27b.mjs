// Round 27b: explorer drops insert links, and the file list multi-selects.
// Headless Chromium, real pointer and key input, notes with frontmatter.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const note = `---
status: drop
tags: [round]
---
Planning notes for the drop.

## Milestones

Editable end.
`;

await withBrowser(async ({ send, run, press, point, move, click, fill, check }) => {
  const row = (path) => `.nav-files .tree-item-self[data-path=${JSON.stringify(path)}]`;
  const selected = () => run(() => [...document.querySelectorAll('.nav-files .tree-item-self.is-selected')].map((el) => el.dataset.path));
  const has = (path) => run((path) => ws.vault.files.some((file) => file.path === path), path);
  const doc = () => run(() => ws.view.state.doc.toString());
  const wait = async (test, label) => {
    for (let i = 0; i < 60; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const at = async (path) => {
    await run((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'center' }), row(path));
    await sleep(20);
    return point(row(path));
  };
  const clickAt = async (p, modifiers = 0, button = 'left') => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, ...p, button, clickCount: 1, modifiers });
    }
    await sleep(50);
  };
  const release = async (p) => { await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 }); await sleep(80); };
  const begin = async (source, destination) => {
    // A folder drop scrolls that row to the centre. Read the source after that
    // scroll, or the press lands on whichever row slid under the old point.
    let start;
    let end;
    if (typeof destination === 'string') {
      await at(destination);
      start = await point(row(source));
      end = await point(row(destination));
    } else {
      start = await at(source);
      end = destination;
    }
    await move(start);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (end.x - start.x) * i / 8, y: start.y + (end.y - start.y) * i / 8, button: 'left', buttons: 1 });
      await sleep(16);
    }
    await sleep(50);
    return end;
  };
  const titles = () => run(() => [...document.querySelectorAll('.menu .menu-item-title')].map((el) => el.textContent));
  const menuAt = async (title) => {
    const p = await run((title) => {
      const item = [...document.querySelectorAll('.menu .menu-item')].find((el) => el.querySelector('.menu-item-title')?.textContent === title);
      const rect = item.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, title);
    await click(p);
  };

  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    for (const path of ['Sel/A.md', 'Sel/B.md', 'Sel/C.md', 'Sel/D.md', 'Drag/Pinned.md', 'Drop/Live.md', 'Drop/Source.md', 'Drop/Reading.md', 'Move/One.md', 'Move/Two.md', 'Move/Three.md', 'Move/Four.md', 'Move/Five.md', 'Del/P.md', 'Del/Q.md']) {
      await api.createNote(path, body);
    }
    await api.createFolder('Dest');
    await api.createFolder('MenuDest');
    await ws.vault.refreshFiles();
  }, note);
  await click('.nav-files [aria-label="Expand all"]');
  check(await run(() => !!document.querySelector('.tree-item-self[data-path="Sel/A.md"]')), 'expand all shows the new frontmatter notes');

  for (const path of ['Sel/A.md', 'Sel/B.md', 'Sel/C.md', 'Sel/D.md']) {
    const p = await at(path);
    await move(p);
    check(await run((path, x, y) => document.elementFromPoint(x, y)?.closest('[data-path]')?.dataset.path === path, path, p.x, p.y), `pointer rests on ${path}`);
  }
  await run(() => {
    window.sawGhost = false;
    new MutationObserver(() => { if (document.querySelector('.drag-ghost')) window.sawGhost = true; }).observe(document.body, { childList: true, subtree: true });
  });
  const stationary = await at('Sel/A.md');
  await move(stationary);
  await clickAt(stationary);
  await clickAt(stationary);
  check(await run(() => !sawGhost && !document.querySelector('.drag-ghost') && ws.active.path === 'Sel/A.md'), 'two clicks without moving open the note and never drag');
  check(await run(() => ws.view.state.doc.toString().startsWith('---\nstatus: drop')), 'the opened note has frontmatter');

  const beforeSelect = await run(() => ws.active.path);
  await clickAt(await at('Sel/B.md'), 1);
  check(await selected().then((paths) => paths.join() === 'Sel/B.md') && await run(() => ws.active.path) === beforeSelect, 'alt-click selects a row without opening it');
  await sleep(150);
  const colors = await run(() => {
    const probe = (value) => {
      const el = document.createElement('div');
      el.style.background = value;
      document.body.append(el);
      const color = getComputedStyle(el).backgroundColor;
      el.remove();
      return color;
    };
    return {
      selected: getComputedStyle(document.querySelector('.tree-item-self.is-selected')).backgroundColor,
      accent: probe('var(--background-modifier-active-hover)'),
      hover: probe('var(--background-modifier-hover)'),
      active: getComputedStyle(document.querySelector('.tree-item-self.is-active:not(.is-selected)')).backgroundColor,
    };
  });
  check(colors.selected === colors.accent && colors.selected !== colors.hover && colors.active === colors.hover, `a selected row uses the accent highlight, distinct from hover and the open file (${colors.selected} accent ${colors.accent} hover ${colors.hover} active ${colors.active})`);
  await clickAt(await at('Sel/B.md'), 1);
  check((await selected()).length === 0, 'alt-click again removes the row');
  const openSel = await run(() => !document.querySelector('.nav-folder-title[data-path="Sel"] .collapse-icon.is-collapsed'));
  await clickAt(await at('Sel'), 1);
  check((await selected()).join() === 'Sel' && await run(() => !document.querySelector('.nav-folder-title[data-path="Sel"] .collapse-icon.is-collapsed')) === openSel, 'alt-click selects a folder without toggling it');
  await press('Escape');
  check((await selected()).length === 0, 'escape clears the selection');

  await clickAt(await at('Sel/A.md'), 1);
  await clickAt(await at('Sel/C.md'), 8);
  check((await selected()).join() === 'Sel/A.md,Sel/B.md,Sel/C.md', 'shift-click selects the visible range');
  await clickAt(await at('Sel/B.md'), 1);
  check((await selected()).join() === 'Sel/A.md,Sel/C.md', 'alt-click toggles one row out of the range');
  await click(row('Welcome.md'), 'right');
  check((await titles()).includes('Move file to...') && !(await titles()).some((title) => title.startsWith('Move ') && title.endsWith(' items to...')), 'right-click on an unselected row keeps the single-file menu');
  await press('Escape');
  check((await selected()).join() === 'Sel/A.md,Sel/C.md', 'closing that menu leaves the selection');
  await press('Escape');
  check((await selected()).length === 0, 'escape after the menu clears the selection');
  await clickAt(await at('Sel/A.md'), 1);
  await clickAt(await at('Sel/B.md'), 1);
  await clickAt(await at('Sel/D.md'));
  check((await selected()).length === 0 && await run(() => ws.active.path === 'Sel/D.md'), 'a plain click clears the selection and opens the note');

  const spot = () => run(() => {
    ws.view.scrollDOM.scrollTop = 0;
    const text = ws.view.state.doc.toString();
    const pointAt = (needle) => {
      const pos = text.indexOf(needle);
      const box = ws.view.coordsAtPos(pos + 1);
      return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    };
    return { first: pointAt('Planning'), second: pointAt('Milestones'), anchor: ws.view.state.selection.main.anchor };
  });
  for (const mode of ['live', 'source', 'reading']) {
    await run(async (path) => { await ws.open(path); }, `Drop/${mode[0].toUpperCase()}${mode.slice(1)}.md`);
    await sleep(80);
    await run((mode) => ws.setMode(mode), mode);
    await sleep(150);
    check(await run(() => ws.view.state.doc.toString().includes('status: drop')), `${mode}: the open note has frontmatter`);
    const places = await spot();
    const before = await doc();
    const anchorBefore = places.anchor;
    let end = await begin('Drag/Pinned.md', places.first);
    if (mode !== 'reading') {
      const firstAnchor = await run(() => ws.view.state.selection.main.anchor);
      const fresh = await run(() => {
        const pos = ws.view.state.doc.toString().indexOf('Milestones');
        const box = ws.view.coordsAtPos(pos + 1);
        return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
      });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...fresh, button: 'left', buttons: 1 });
      await sleep(50);
      const secondAnchor = await run(() => ws.view.state.selection.main.anchor);
      check(firstAnchor !== secondAnchor, `${mode}: the caret follows the pointer across the note`);
      const seen = await run(() => ws.view.state.doc.toString());
      await release(fresh);
      const after = await doc();
      const linkAt = after.indexOf('[[Pinned]]');
      const gained = linkAt >= 0 && after.slice(0, linkAt) + after.slice(linkAt + '[[Pinned]]'.length) === seen;
      check(gained, gained ? `${mode}: dropping a note inserts [[Pinned]] at the caret` : `${mode}: expected [[Pinned]] in ${JSON.stringify(after)}`);
      check(after.startsWith('---\nstatus: drop'), `${mode}: frontmatter stays put`);
      check(await has('Drag/Pinned.md'), `${mode}: an editor drop does not move the file`);
    } else {
      check(await run(() => document.querySelector('.cm-editor')?.classList.contains('is-reading-mode')), 'reading mode is on the editor');
      await release(end);
      check(await doc() === before && await run(() => ws.view.state.selection.main.anchor) === anchorBefore, 'reading view ignores the drop');
      check(await has('Drag/Pinned.md'), 'reading view does not move the file');
    }
  }

  await run(async () => { await ws.open('Drop/Live.md'); ws.setMode('live'); });
  await sleep(120);
  let end = await begin('Attachments/photo.png', await spot().then((places) => places.second));
  const image = await run(() => ({ anchor: ws.view.state.selection.main.anchor, text: ws.view.state.doc.toString() }));
  await release(end);
  check((await doc()) === image.text.slice(0, image.anchor) + '![[photo.png]]' + image.text.slice(image.anchor), 'dropping an image inserts ![[photo.png]]');
  const folderBefore = await doc();
  end = await begin('Sel', await spot().then((places) => places.first));
  await release(end);
  check(await doc() === folderBefore && await has('Sel/A.md') && await has('Sel'), 'dropping a folder on a note does nothing');

  for (const path of ['Sel/A.md', 'Sel/B.md', 'Sel/C.md']) await clickAt(await at(path), 1);
  end = await begin('Sel/A.md', await spot().then((places) => places.second));
  const many = await run(() => ({ anchor: ws.view.state.selection.main.anchor, text: ws.view.state.doc.toString(), selected: [...document.querySelectorAll('.nav-files .tree-item-self.is-selected')].map((el) => el.dataset.path) }));
  await release(end);
  const afterMany = await doc();
  const block = '[[A]]\n[[B]]\n[[C]]';
  const blockAt = afterMany.indexOf(block);
  const gainedMany = blockAt >= 0 && afterMany.slice(0, blockAt) + afterMany.slice(blockAt + block.length) === many.text;
  check(gainedMany, gainedMany ? 'several selected files insert one link per line' : `expected one link per line, selected ${many.selected.join()}, doc ${JSON.stringify(afterMany)}`);
  await press('Escape');

  end = await begin('Sel/D.md', 'Dest');
  check(await run(() => document.querySelectorAll('.is-being-dragged').length === 1 && document.querySelector('.is-being-dragged')?.dataset.path === 'Sel/D.md' && document.querySelector('.drag-ghost.mod-tree .drag-ghost-title')?.textContent === 'D' && document.querySelector('.drag-ghost')?.textContent === 'DMove into “Dest”'), 'a single drag keeps the row payload and the note-name ghost');
  await press('Escape');
  await release(end);
  check(await has('Sel/D.md'), 'escape cancels a single drag');

  for (const path of ['Move/One.md', 'Move/Two.md', 'Move/Three.md']) await clickAt(await at(path), 1);
  end = await begin('Move/One.md', 'Dest');
  check(await run(() => document.querySelector('.drag-ghost-title')?.textContent === '3 items' && document.querySelector('.drag-ghost-destination')?.textContent === 'Move into “Dest”' && document.querySelectorAll('.is-being-dragged').length === 1 && document.querySelector('.is-being-dragged')?.dataset.path === 'Move/One.md'), 'dragging a selected row ghosts “3 items” and marks only the pressed row');
  await release(end);
  await wait(() => has('Dest/One.md'), 'first of three arrived');
  check(await has('Dest/Two.md') && await has('Dest/Three.md') && !await has('Move/One.md') && !await has('Move/Two.md') && !await has('Move/Three.md'), 'dropping the selection on a folder moves every selected file');

  for (const path of ['Move/Four.md', 'Move/Five.md']) await clickAt(await at(path), 1);
  await click(row('Move/Five.md'), 'right');
  check((await titles()).includes('Move 2 items to...') && (await titles()).includes('Delete'), 'the multi-selection menu offers move and delete');
  await menuAt('Move 2 items to...');
  check(await run(() => !!document.querySelector('.prompt') && document.querySelector('.prompt').getAnimations().length === 0), 'the move prompt is open immediately, with no animation');
  await fill('.prompt-input', 'MenuDest');
  await press('Enter');
  await wait(() => has('MenuDest/Four.md'), 'menu move');
  check(await has('MenuDest/Five.md') && !await has('Move/Four.md') && !await has('Move/Five.md'), 'Move 2 items to... moves both files');

  for (const path of ['Del/P.md', 'Del/Q.md']) await clickAt(await at(path), 1);
  await click(row('Del/Q.md'), 'right');
  await menuAt('Delete');
  const confirm = await run(() => ({
    title: document.querySelector('.mod-confirm .modal-title')?.textContent ?? '',
    message: document.querySelector('.mod-confirm .modal-content')?.textContent ?? '',
    animations: document.querySelector('.mod-confirm')?.getAnimations().length ?? -1,
  }));
  check(confirm.title === 'Delete' && confirm.message.includes('delete 2 items') && confirm.animations === 0, 'delete asks once, immediately, before removing anything');
  await click('.mod-confirm .mod-warning');
  await wait(async () => !await has('Del/P.md') && !await has('Del/Q.md'), 'both files deleted');
  check(!await has('Del/P.md') && !await has('Del/Q.md'), 'the one confirm deletes the whole selection');
});
