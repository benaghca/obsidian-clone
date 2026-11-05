// X3a: the drawing editor with real mouse and key input. Draw, move, resize,
// rotate, undo, redo, style, a label that follows its shape, marquee and
// delete, the key sheet, then save and reopen. Fields Grove doesn't know stay.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const PATH = 'Edit.excalidraw';
const fixture = {
  type: 'excalidraw',
  version: 2,
  source: 'cinder',
  elements: [
    {
      id: 'box', type: 'rectangle', x: 0, y: 0, width: 200, height: 120, angle: 0,
      strokeColor: '#1e1e1e', backgroundColor: '#cce0ff', fillStyle: 'solid', strokeWidth: 2,
      strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null,
      seed: 11, version: 4, versionNonce: 99, isDeleted: false,
      boundElements: [{ type: 'text', id: 'label' }], updated: 1, link: null, locked: false,
      customKey: { from: 'cinder', list: [1, 2, 3] },
    },
    {
      id: 'label', type: 'text', x: 70, y: 48, width: 60, height: 25, angle: 0,
      strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1,
      strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null,
      seed: 12, version: 2, versionNonce: 98, isDeleted: false, boundElements: null, updated: 1,
      link: null, locked: false, text: 'Label', fontSize: 20, fontFamily: 1, textAlign: 'center',
      verticalAlign: 'middle', containerId: 'box', originalText: 'Label', autoResize: true, lineHeight: 1.25,
    },
    { id: 'math', type: 'math', x: 300, y: 0, width: 100, height: 60, latex: '\\frac{a}{b}', mystery: { deep: [true, null] } },
  ],
  appState: { viewBackgroundColor: '#ffffff', gridSize: null, unknownAppKey: 'kept' },
  files: {},
  extraTopLevel: { note: 'kept too' },
};
const original = JSON.stringify(fixture, null, 2) + '\n';
const mathText = JSON.stringify(fixture.elements[2], null, 2).split('\n').map((line, i) => i ? '    ' + line : line).join('\n');

await withBrowser(async ({ run, send, press, chord, move, click, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 400; i++) { if (await test()) return; await sleep(20); }
    assert.fail(label);
  };
  const readFile = () => run(async (path) => { const { api } = await import('/src/api.ts'); return api.readNote(path); }, PATH);
  const saved = async (test, label) => {
    let text = '';
    await wait(async () => { text = await readFile(); try { return test(JSON.parse(text), text); } catch { return false; } }, label);
    return JSON.parse(text);
  };
  const byId = (doc, id) => doc.elements.find(e => e.id === id);
  const view = () => run(() => {
    const r = document.querySelector('.drawing-view').getBoundingClientRect();
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.drawing-world')).transform);
    return { left: r.left, top: r.top, a: m.a, e: m.e, f: m.f };
  });
  const at = async (x, y) => { const v = await view(); return { x: v.left + v.e + v.a * x, y: v.top + v.f + v.a * y }; };
  const handle = (name) => run((name) => {
    const node = document.querySelector(`.drawing-overlay [data-handle="${name}"]`);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, name);
  const mouse = (type, p, extra = {}) => send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', ...extra });
  const drag = async (from, to, { steps = 10, modifiers = 0 } = {}) => {
    await move(from);
    await mouse('mousePressed', from, { buttons: 1, clickCount: 1, modifiers });
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }, { buttons: 1, modifiers });
      await sleep(16);
    }
    await mouse('mouseReleased', to, { buttons: 0, clickCount: 1, modifiers });
    await sleep(60);
  };
  const near = (a, b, tol = 1.01) => Math.abs(a - b) <= tol;

  await run(async (path, text) => {
    const { api } = await import('/src/api.ts');
    await api.createNote(path, text);
    await api.createNote('Elsewhere.md', 'Not a drawing.\n');
    await ws.vault.refreshFiles();
    await ws.open(path);
  }, PATH, original);
  await wait(() => run(() => !!document.querySelector('.drawing-world > svg [data-id="box"]') && !document.querySelector('.drawing-toolbar')?.hidden), 'editor ready');
  await click('.drawing-controls [aria-label="Reset zoom"]');
  check((await view()).a === 1, 'Zoom reset to 1 so one pixel is one scene unit');

  // Draw a rectangle with the R key and a real drag.
  await click(await at(450, 300));
  await press('r');
  check(await run(() => document.querySelector('.drawing-view').dataset.tool === 'rectangle'), 'R picks the rectangle tool');
  check(await run(() => !document.querySelector('.drawing-style').hidden), 'Style panel shows for a drawing tool');
  await drag(await at(0, 200), await at(120, 280));
  let doc = await saved(d => d.elements.length === 4, 'drawn rectangle saved');
  const made = doc.elements[3];
  check(made.type === 'rectangle' && near(made.x, 0) && near(made.y, 200) && near(made.width, 120) && near(made.height, 80), `Drawn rectangle has the dragged box ${JSON.stringify([made.x, made.y, made.width, made.height])}`);
  check(made.roughness === 0 && made.version === 1 && made.strokeColor === '#1e1e1e', 'New rectangle is clean-lined, version 1, default ink');
  check(await run(() => document.querySelector('.drawing-view').dataset.tool === 'select'), 'Tool returns to Select after drawing');
  const id = made.id;
  check(await run((id) => !!document.querySelector(`.drawing-world > svg > [data-id="${id}"]`), id), 'New rectangle is painted');
  check(!!await handle('se') && !!await handle('rotate'), 'New rectangle is selected with handles');

  // Move it by dragging inside its frame (it has no fill, so the frame is what takes the press).
  await drag(await at(60, 240), await at(110, 270));
  doc = await saved(d => near(byId(d, id).x, 50), 'move saved');
  check(near(byId(doc, id).x, 50) && near(byId(doc, id).y, 230) && byId(doc, id).version === 2, 'Move shifts the rectangle and bumps its version once');

  // Resize from the bottom right handle.
  const se = await handle('se');
  await drag(se, { x: se.x + 40, y: se.y + 20 });
  doc = await saved(d => near(byId(d, id).width, 160), 'resize saved');
  const sized = byId(doc, id);
  check(near(sized.x, 50) && near(sized.y, 230) && near(sized.width, 160) && near(sized.height, 100) && sized.version === 3, `Resize keeps the top left and grows the box ${JSON.stringify([sized.x, sized.y, sized.width, sized.height])}`);

  // Rotate a quarter turn: from the knob above the box round to its right.
  const knob = await handle('rotate');
  const centre = await at(130, 280);
  await drag(knob, { x: centre.x + 120, y: centre.y }, { steps: 16 });
  doc = await saved(d => Math.abs(byId(d, id).angle - Math.PI / 2) < 0.03, 'rotate saved');
  check(Math.abs(byId(doc, id).angle - Math.PI / 2) < 0.03, `Rotate turns the rectangle a quarter (${byId(doc, id).angle})`);
  check(await run((id) => /rotate\(9\d/.test(document.querySelector(`.drawing-world > svg > [data-id="${id}"]`).getAttribute('transform') ?? ''), id), 'Painted rectangle is turned');

  // Undo, redo, undo.
  await chord('z');
  doc = await saved(d => byId(d, id).angle === 0, 'undo saved');
  check(byId(doc, id).angle === 0 && near(byId(doc, id).width, 160), 'Ctrl+Z undoes the turn only');
  await run(() => document.querySelector('.drawing-view').focus());
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', modifiers: 2, windowsVirtualKeyCode: 17 });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', modifiers: 10, windowsVirtualKeyCode: 16 });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Z', code: 'KeyZ', modifiers: 10, windowsVirtualKeyCode: 90 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Z', code: 'KeyZ', modifiers: 10, windowsVirtualKeyCode: 90 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', modifiers: 2, windowsVirtualKeyCode: 16 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', modifiers: 0, windowsVirtualKeyCode: 17 });
  doc = await saved(d => byId(d, id).angle > 1, 'redo saved');
  check(Math.abs(byId(doc, id).angle - Math.PI / 2) < 0.03, 'Ctrl+Shift+Z redoes it');
  await click('.drawing-toolbar [aria-label="Undo (Ctrl+Z)"]');
  doc = await saved(d => byId(d, id).angle === 0, 'undo button saved');
  check(byId(doc, id).angle === 0, 'The Undo button undoes too');

  // Style the selection from the panel.
  check(await run(() => !document.querySelector('.drawing-style').hidden), 'Style panel shows for a selection');
  await click('.drawing-style [aria-label="#d03030"]');
  await click('.drawing-style [aria-label="Dashed line"]');
  await click('.drawing-style [aria-label="#ffd6d6"]');
  await click('.drawing-style [aria-label="Thick"]');
  doc = await saved(d => byId(d, id).strokeWidth === 4, 'style saved');
  const styled = byId(doc, id);
  check(styled.strokeColor === '#d03030' && styled.strokeStyle === 'dashed' && styled.backgroundColor === '#ffd6d6' && styled.strokeWidth === 4, 'Panel sets stroke, stroke style, fill and width');
  check(await run(() => document.querySelector('.drawing-style [aria-label="Dashed line"]').classList.contains('is-active')), 'Panel shows the selection\'s style');
  check(await run((id) => {
    const node = document.querySelector(`.drawing-world > svg > [data-id="${id}"]`);
    return node.getAttribute('stroke') === '#d03030' && !!node.getAttribute('stroke-dasharray');
  }, id), 'Painted rectangle shows the new style');

  // A shape's label goes where the shape goes. A press on the label picks the shape.
  await press('Escape');
  check(!await handle('se'), 'Esc clears the selection');
  await drag(await at(100, 60), await at(140, 70));
  doc = await saved(d => near(byId(d, 'box').x, 40), 'box move saved');
  check(near(byId(doc, 'box').x, 40) && near(byId(doc, 'box').y, 10) && byId(doc, 'box').version === 5, 'Box moved with one new version');
  check(near(byId(doc, 'label').x, 110) && near(byId(doc, 'label').y, 58), 'Its label moved with it');
  check(JSON.stringify(byId(doc, 'box').customKey) === JSON.stringify(fixture.elements[0].customKey), 'An unknown key on an edited element is kept');

  // Marquee round the drawn rectangle only, delete it, then bring it back.
  await press('Escape');
  await drag(await at(-30, 170), await at(290, 400));
  check(await run(() => document.querySelectorAll('.drawing-overlay .drawing-frame').length === 1) && !!await handle('se'), 'Marquee selects the rectangle it holds');
  await press('Delete');
  doc = await saved(d => byId(d, id).isDeleted === true, 'delete saved');
  check(byId(doc, id).isDeleted === true && !byId(doc, 'box').isDeleted && doc.elements.length === 4, 'Delete marks the element deleted and keeps the record');
  check(await run((id) => !document.querySelector(`.drawing-world > svg > [data-id="${id}"]`), id), 'Deleted rectangle is no longer painted');
  await chord('z');
  doc = await saved(d => byId(d, id).isDeleted === false, 'undelete saved');
  check(await run((id) => !!document.querySelector(`.drawing-world > svg > [data-id="${id}"]`), id), 'Undo paints it again');

  // Ellipse and diamond tools from the toolbar, drawn with Shift for a circle.
  await click('.drawing-toolbar [data-tool="ellipse"]');
  await drag(await at(260, 200), await at(330, 240), { modifiers: 8 });
  doc = await saved(d => d.elements.length === 5, 'ellipse saved');
  const circle = doc.elements[4];
  check(circle.type === 'ellipse' && near(circle.width, 70) && near(circle.height, 70), 'Shift draws a circle');
  await press('d');
  await drag(await at(360, 200), await at(420, 260));
  doc = await saved(d => d.elements.length === 6, 'diamond saved');
  check(doc.elements[5].type === 'diamond' && near(doc.elements[5].width, 60), 'D draws a diamond');

  // The key sheet.
  await press('?');
  check(await run(() => {
    const sheet = document.querySelector('.drawing-help');
    return !sheet.hidden && sheet.textContent.includes('Rectangle') && sheet.textContent.includes('Ctrl + Z');
  }), '? opens the key sheet');
  await press('Escape');
  check(await run(() => document.querySelector('.drawing-help').hidden), 'Esc closes the key sheet');

  // Leave and reopen: everything is on disk and paints again.
  await sleep(400);
  const before = await readFile();
  await run(async () => { await ws.open('Elsewhere.md'); });
  await sleep(100);
  await run(async (path) => { await ws.open(path); }, PATH);
  await wait(() => run((id) => !!document.querySelector(`.drawing-world > svg > [data-id="${id}"]`), id), 'reopened drawing painted');
  const after = await readFile();
  check(after === before, 'Reopening writes nothing');
  doc = JSON.parse(after);
  check(byId(doc, id).strokeColor === '#d03030' && near(byId(doc, 'box').x, 40), 'Reopened drawing has the edits');
  check(await run((id) => document.querySelector(`.drawing-world > svg > [data-id="${id}"]`).getAttribute('stroke') === '#d03030', id), 'Reopened drawing paints the edits');
  check(JSON.stringify(doc.extraTopLevel) === JSON.stringify(fixture.extraTopLevel) && doc.appState.unknownAppKey === 'kept' && doc.source === 'cinder', 'Unknown top-level and appState keys are kept');
  check(JSON.stringify(byId(doc, 'math')) === JSON.stringify(fixture.elements[2]) && after.includes(mathText), 'An unknown element type is kept byte for byte');
  check(after.startsWith('{\n  "type": "excalidraw"') && after.endsWith('}\n'), 'The file keeps its layout');

  // Editing a 2000-element drawing: one shape, then all of them at once. No task over 50ms.
  await run(async () => {
    const elements = [];
    for (let i = 0; i < 2000; i++) elements.push({
      id: `b${i}`, type: i % 3 ? 'rectangle' : 'ellipse', x: (i % 50) * 30, y: Math.floor(i / 50) * 30, width: 20, height: 16,
      strokeColor: '#1e1e1e', backgroundColor: i % 5 ? '#ffffff' : '#a5d8ff', fillStyle: i % 5 ? 'solid' : 'hachure', strokeWidth: 1, angle: 0,
    });
    const { api } = await import('/src/api.ts');
    await api.createNote('Big edit.excalidraw', JSON.stringify({ type: 'excalidraw', version: 2, elements, appState: {}, files: {} }));
    await ws.vault.refreshFiles();
    await ws.open('Big edit.excalidraw');
  });
  const bigReady = () => run(() => document.querySelectorAll('.drawing-world > svg > [data-type]').length === 2000);
  await wait(bigReady, 'big drawing painted');
  await sleep(100);
  await run(() => {
    window.editLong = [];
    window.editObserver = new PerformanceObserver(list => editLong.push(...list.getEntries().map(e => Math.round(e.duration))));
    editObserver.observe({ type: 'longtask' });
  });
  const cell = await run(() => { const r = document.querySelector('[data-id="b1010"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await drag(cell, { x: cell.x + 60, y: cell.y + 40 }, { steps: 20 });
  const corner = await handle('se');
  await drag(corner, { x: corner.x + 30, y: corner.y + 30 }, { steps: 20 });
  await chord('a');
  await drag({ x: cell.x + 60, y: cell.y + 40 }, { x: cell.x + 100, y: cell.y + 80 }, { steps: 20 });
  await wait(bigReady, 'big drawing repainted after moving all');
  await chord('z');
  await sleep(100);
  await wait(bigReady, 'big drawing repainted after undo');
  const editing = await run(() => { editObserver.disconnect(); return editLong; });
  console.log('DRAWING_EDIT_LONG', JSON.stringify(editing));
  check(editing.every(ms => ms <= 50), 'Editing one shape and all 2000 has no task over 50ms');
  const big = JSON.parse(await run(async () => { const { api } = await import('/src/api.ts'); await new Promise(r => setTimeout(r, 400)); return api.readNote('Big edit.excalidraw'); }));
  const cellDoc = big.elements[1010];
  check(cellDoc.x > 300 && cellDoc.y > 600 && cellDoc.width > 20 && cellDoc.height > 16 && big.elements[0].x === 0 && big.elements[0].y === 0,
    `Big drawing saved the shape edits and the undone move ${JSON.stringify([cellDoc.x, cellDoc.y, cellDoc.width, cellDoc.height])}`);
});
