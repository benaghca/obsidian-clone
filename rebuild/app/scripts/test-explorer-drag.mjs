// Scratch-vault explorer moves, driven by native CDP mouse/key events.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({ send, run, press, chord, point, move, click, check }) => {
  const row = path => `.nav-files .tree-item-self[data-path=${JSON.stringify(path)}]`;
  const list = '.nav-files .nav-files-container';
  const has = path => run(path => ws.vault.files.some(f => f.path === path), path);
  const wait = async (test, label) => {
    for (let i = 0; i < 60; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const collapsed = path => run(selector => !!document.querySelector(selector + ' .collapse-icon.is-collapsed'), row(path));
  const open = async path => { if (await collapsed(path)) { await click(row(path)); await sleep(250); } };
  const release = async p => { await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 }); await sleep(100); };
  const begin = async (source, destination) => {
    const start = await point(row(source));
    const end = typeof destination === 'string' ? await point(row(destination)) : destination;
    await move(start);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (end.x - start.x) * i / 8, y: start.y + (end.y - start.y) * i / 8, button: 'left', buttons: 1 });
      await sleep(16);
    }
    await sleep(30);
    return end;
  };
  const drag = async (source, destination, expected) => {
    await release(await begin(source, destination));
    await wait(() => has(expected), 'moved to ' + expected);
    check(!await has(source), `${source} → ${expected}`);
  };
  const clean = async label => check(await run(() => !document.querySelector('.drag-ghost,.is-being-dragged,.is-being-dragged-over') && !document.body.classList.contains('is-grabbing')), label + ': no drag classes or ghost remain');
  const geometry = async label => {
    const rows = await run(() => [...ws.view.contentDOM.children].map(el => {
      const style = getComputedStyle(el), pos = ws.view.posAtDOM(el, 0);
      return { text: el.textContent, margins: [style.marginTop, style.marginBottom], delta: el.classList.contains('cm-line') ? ws.view.documentTop + ws.view.lineBlockAt(pos).top - el.getBoundingClientRect().top : 0 };
    }));
    for (const r of rows) { assert.deepEqual(r.margins, ['0px', '0px']); assert.ok(Math.abs(r.delta) <= 1, JSON.stringify(r)); }
    check(rows.length > 3, label + ': moved note keeps zero margins and line tops within 1px');
  };
  await run(async () => {
    const { api } = await import('/src/api.ts');
    for (const path of ['DragA', 'DragB', 'DragC', 'DragFolder', 'DragFolder/Child', 'DragOpen', 'DragB/DragFolder']) await api.createFolder(path);
    for (const [path, body] of Object.entries({
      'DragA/First.md': 'First', 'DragA/A1.md': 'Collision source', 'DragA/Cancel.md': 'Cancel', 'DragA/Uniq.md': 'Unique note',
      'DragB/A1.md': 'Collision destination', 'DragFolder/Child/Inside.md': 'Inside',
      'DragLinks.md': '[[DragA/Uniq]]',
    })) await api.createNote(path, body);
    for (const mode of ['live', 'source', 'reading']) await api.createNote(`DragOpen/${mode}.md`, '---\ntags: [geometry]\n---\nA paragraph.\n# HeadingOne\nSection one.\n## HeadingTwo\nEditable end.');
    await ws.vault.refreshFiles(); await ws.vault.refreshLinks();
  });
  await open('DragA');
  await click(row('DragA/First.md'));
  check(await run(() => ws.active.path === 'DragA/First.md' && !document.querySelector('.drag-ghost')), 'plain file click opens without a ghost');
  const start = await point(row('DragA/First.md'));
  await move(start); await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + 2, y: start.y, buttons: 1 }); await sleep(50);
  check(await run(() => !document.querySelector('.drag-ghost')), 'a 2px move stays a click');
  await release({ x: start.x + 2, y: start.y });

  // Measure first entry into the actual folder row, through pointer capture.
  await run(selector => {
    const folder = document.querySelector(selector), r = folder.getBoundingClientRect();
    window.expandTiming = { start: 0, delay: 0 };
    const moved = e => { if (!expandTiming.start && e.clientY >= r.top && e.clientY < r.bottom) expandTiming.start = performance.now(); };
    window.addEventListener('pointermove', moved);
    const observer = new MutationObserver(() => {
      if (folder.querySelector('.is-collapsed')) return;
      expandTiming.delay = performance.now() - expandTiming.start;
      observer.disconnect(); window.removeEventListener('pointermove', moved);
    });
    observer.observe(folder, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }, row('DragB'));
  let end = await begin('DragA/First.md', 'DragB');
  check(await run(() => document.querySelectorAll('.is-being-dragged-over').length === 1 && document.querySelector('.nav-folder.is-being-dragged-over > [data-path="DragB"]') && !document.querySelector('.drag-ghost').getAnimations().length && document.querySelector('.drag-ghost').textContent === 'FirstMove into “DragB”'), 'immediate folder highlight and two-line ghost, without open animation');
  const elapsed = await run(() => performance.now() - expandTiming.start);
  await sleep(Math.max(0, 600 - elapsed));
  check(await collapsed('DragB'), 'collapsed folder has not expanded at 600ms');
  await wait(async () => !await collapsed('DragB'), 'auto-expand');
  const delay = await run(() => expandTiming.delay);
  assert.ok(delay >= 730 && delay <= 1050, `auto-expand delay ${delay}`);
  console.log(`MEASURE auto-expand ${delay.toFixed(1)}ms`);
  await release(end); await wait(() => has('DragB/First.md'), 'first move');
  check(await run(() => ws.active.path === 'DragB/First.md'), 'open note tab follows the first move');
  await clean('drop');
  await drag('DragA/A1.md', 'DragB/A1.md', 'DragB/A1 1.md');
  check(await run(() => ws.active.path === 'DragB/First.md'), 'dragging a closed note does not open it');
  check(await has('DragB/A1.md'), 'colliding destination is retained; file row targets its parent');
  await drag('DragFolder', 'DragC', 'DragC/DragFolder');
  await open('DragC'); await open('DragC/DragFolder'); await open('DragC/DragFolder/Child');
  end = await begin('DragC/DragFolder', 'DragC/DragFolder/Child/Inside.md');
  check(await run(() => !document.querySelector('.is-being-dragged-over') && document.querySelector('.drag-ghost-destination').hidden), 'folder over its child refuses the target and hides the Move into line');
  await release(end); check(await has('DragC/DragFolder/Child/Inside.md'), 'refused descendant drop changes nothing');
  await clean('refused drop');

  await drag('DragC/DragFolder', 'DragB', 'DragB/DragFolder 1');
  check(await has('DragB/DragFolder') && await has('DragB/DragFolder 1/Child/Inside.md'), 'folder collision numbers the directory and carries its children');

  const blank = await run(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.bottom - 60 }; }, list);
  end = await begin('DragB/First.md', blank);
  check(await run(() => document.querySelectorAll('.is-being-dragged-over').length === 1 && document.querySelector('.nav-files-container.is-being-dragged-over') && document.querySelector('.drag-ghost-destination').textContent.includes(ws.vault.name)), 'empty space lights the root and names the vault');
  await release(end); await wait(() => has('First.md'), 'root move');
  check(!await has('DragB/First.md'), 'file moves to root via empty space');
  end = await begin('DragA/Cancel.md', 'DragA');
  check(await run(() => !!document.querySelector('.nav-folder.is-being-dragged-over > [data-path="DragA"]')), 'own parent is still highlighted');
  await release(end); check(await has('DragA/Cancel.md'), 'own-parent drop is a silent no-op');

  await click(row('DragC')); await sleep(250);
  end = await begin('DragA/Cancel.md', 'DragC'); await sleep(300);
  await move(await point(row('DragA/Cancel.md'))); await sleep(550);
  check(await collapsed('DragC'), 'leaving a folder before 750ms cancels expansion');
  await press('Escape'); await release(end); await clean('Escape');
  check(await has('DragA/Cancel.md'), 'Escape leaves the source in place');
  end = await begin('DragA/Cancel.md', 'DragC'); await sleep(800); await press('Escape'); await release(end);
  check(!await collapsed('DragC'), 'auto-expanded folder stays open after Escape');

  // Cancellation must restore focus and remove every temporary window listener.
  await click('.cm-content');
  await run(() => { window.beforeDragFocus = document.activeElement; });
  const windowId = (await send('Runtime.evaluate', { expression: 'window' })).result.objectId;
  const listeners = async () => (await send('DOMDebugger.getEventListeners', { objectId: windowId })).listeners.map(l => `${l.type}:${l.useCapture}:${l.scriptId}:${l.lineNumber}`).sort();
  const baselineListeners = await listeners();
  end = await begin('DragA/Cancel.md', 'DragB'); await press('Escape'); await release(end);
  check(await run(() => document.activeElement === beforeDragFocus), 'Escape restores the original editor focus');
  assert.deepEqual(await listeners(), baselineListeners, 'Escape releases all drag listeners');

  // A second headless page steals focus, delivering a real window blur.
  await send('Page.bringToFront');
  end = await begin('DragA/Cancel.md', 'DragB');
  const other = await send('Target.createTarget', { url: 'about:blank', background: false });
  await sleep(150);
  await clean('window blur');
  await send('Target.closeTarget', { targetId: other.targetId });
  await send('Page.bringToFront'); await release(end);
  check(await has('DragA/Cancel.md'), 'window blur leaves the file in place');
  assert.deepEqual(await listeners(), baselineListeners, 'blur releases all drag listeners');

  // Native touch cancellation exercises pointercancel without synthetic DOM events.
  const touch = await point(row('DragA/Cancel.md'));
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touch, id: 1 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touch.x + 8, y: touch.y, id: 1 }] });
  await sleep(80);
  check(await run(() => !!document.querySelector('.drag-ghost')), 'native touch movement starts the same pointer drag');
  await send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await sleep(80);
  await clean('pointercancel');
  check(await has('DragA/Cancel.md'), 'pointercancel leaves the file in place');
  assert.deepEqual(await listeners(), baselineListeners, 'pointercancel releases all drag listeners');

  // A real move must take the existing confirmation/shortest-link/undo path.
  await run(async () => { await ws.open('DragLinks.md'); await ws.vault.refreshLinks(); });
  await drag('DragA/Uniq.md', 'DragB', 'DragB/Uniq.md');
  await wait(() => run(() => !!document.querySelector('.mod-confirm')), 'link-update confirmation');
  check(await run(() => document.querySelector('.mod-confirm .modal-title').textContent === 'Update links?' && document.querySelector('.mod-confirm .modal-content').textContent.includes('1 link in 1 file')), 'move asks the existing Update links question');
  await click('.mod-confirm .mod-cta');
  await wait(() => run(() => ws.view.state.doc.toString() === '[[Uniq]]'), 'shortest link update');
  check(true, '[[DragA/Uniq]] becomes [[Uniq]] through the existing rename path');
  await click('.cm-content'); await chord('z');
  check(await run(() => ws.view.state.doc.toString() === '[[DragA/Uniq]]'), 'link rewrite is undoable');

  for (const mode of ['live', 'source', 'reading']) {
    await open('DragOpen');
    await run(async mode => { await ws.open(`DragOpen/${mode}.md`); ws.setMode(mode === 'reading' ? 'live' : mode); }, mode);
    await sleep(150); await click('.cm-content'); await chord('End');
    await send('Input.insertText', { text: ' edited' });
    await run(mode => { window.dragTabId = ws.active.id; window.dragFocus = document.activeElement; ws.setMode(mode); }, mode);
    await sleep(150);
    await drag(`DragOpen/${mode}.md`, 'DragB', `DragB/${mode}.md`);
    check(await run(mode => ws.active.id === dragTabId && ws.active.path === `DragB/${mode}.md` && ws.active.mode === mode && document.querySelector('.inline-title').textContent === mode && document.querySelector('.view-header-title-container').textContent === `DragB/${mode}` && !!document.querySelector(`.workspace-tab-header[aria-label="DragB/${mode}.md"]`), mode), `${mode}: tab identity, mode, breadcrumb and title follow the move`);
    await geometry(mode);
    // Native stationary double click on the moved note's fold arrow.
    const heading = await run(() => { const r = ws.view.coordsAtPos(ws.view.state.doc.toString().indexOf('HeadingOne')); return { x: r.left + 10, y: (r.top + r.bottom) / 2 }; });
    await move(heading);
    const arrow = await point('.cm-fold-indicator.mod-hover:not([hidden])'); await click(arrow);
    check(await run(() => !!document.querySelector('.cm-foldPlaceholder')), `${mode}: moved frontmatter note folds`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...arrow, button: 'left', clickCount: 1 });
    await sleep(80);
    check(await run(() => !document.querySelector('.cm-foldPlaceholder') && !document.querySelector('.cm-fold-indicator.mod-hover').hidden), `${mode}: moved note unfolds with arrow visible under a still pointer`);
    await geometry(mode + ' unfolded');
    if (mode === 'reading') await run(() => ws.setMode('live'));
    await click('.cm-content'); await chord('z');
    check(await run(() => !ws.view.state.doc.toString().includes(' edited')), `${mode}: moved editor retains its last edit's undo history`);
    await clean(mode);
  }

  await run(async () => {
    const { api } = await import('/src/api.ts');
    for (let i = 0; i < 140; i++) await api.createNote(`Scroll${String(i).padStart(3, '0')}.md`, 'Scroll fixture');
    await ws.vault.refreshFiles();
  });
  await click('.nav-files [aria-label="Collapse all"]'); await sleep(250);
  for (const distance of [39, 25, 10]) {
    await run(selector => { document.querySelector(selector).scrollTop = 0; }, list);
    const edge = await run((selector, distance) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.bottom - distance }; }, list, distance);
    end = await begin('Scroll000.md', edge);
    const before = await run(selector => ({ top: document.querySelector(selector).scrollTop, time: performance.now() }), list);
    await sleep(500);
    const after = await run(selector => ({ top: document.querySelector(selector).scrollTop, time: performance.now() }), list);
    const speed = (after.top - before.top) * 1000 / (after.time - before.time);
    const expected = distance === 39 ? 220 : distance === 25 ? 500 : 1600;
    assert.ok(speed >= expected * .75 && speed <= expected * 1.25, `edge ${distance}px: ${speed} px/s`);
    console.log(`MEASURE scroll at ${distance}px: ${speed.toFixed(1)}px/s`);
    const middle = await run(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: (r.top + r.bottom) / 2 }; }, list);
    await move(middle); await sleep(50);
    const stopped = await run(selector => document.querySelector(selector).scrollTop, list); await sleep(150);
    assert.equal(await run(selector => document.querySelector(selector).scrollTop, list), stopped, 'scroll loop stops outside the edge zone');
    await press('Escape'); await release(middle); await clean('auto-scroll Escape');
    check(await has('Scroll000.md'), 'auto-scroll cancellation never moves the file');
  }
  await run(selector => { document.querySelector(selector).scrollTop = 800; }, list);
  const topEdge = await run(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.top + 25 }; }, list);
  end = await begin('Scroll040.md', topEdge);
  const beforeTop = await run(selector => document.querySelector(selector).scrollTop, list);
  await sleep(250);
  check(await run((selector, before) => document.querySelector(selector).scrollTop < before - 70, list, beforeTop), 'top edge scrolls upwards');
  await press('Escape'); await release(end);
  const cancelledTop = await run(selector => document.querySelector(selector).scrollTop, list); await sleep(150);
  assert.equal(await run(selector => document.querySelector(selector).scrollTop, list), cancelledTop, 'Escape stops a running edge-scroll loop');
  await clean('top-edge Escape');
});
