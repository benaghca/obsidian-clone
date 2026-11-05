// X3b: the drawing editor's arrow, line, pen, text and eraser tools with real
// mouse, pen and key input. Arrows bind to shapes and follow them; points are
// dragged, added and removed; pen strokes keep their pressures; text goes on
// its own or inside a shape; the eraser deletes what it crosses. A drawing
// Cinder saved still round-trips after an edit.
import assert from 'node:assert/strict';
import { readFile as readDisk } from 'node:fs/promises';
import { withBrowser, sleep } from './browser.mjs';

const PATH = 'Tools.excalidraw';
const shape = (id, type, x, y, width, height, extra = {}) => ({
  id, type, x, y, width, height, angle: 0, strokeColor: '#1e1e1e', backgroundColor: '#d6e6ff', fillStyle: 'solid', strokeWidth: 2,
  strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1,
  isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...extra,
});
const fixture = {
  type: 'excalidraw', version: 2, source: 'grove',
  elements: [shape('A', 'rectangle', 0, 0, 160, 100), shape('B', 'rectangle', 400, 0, 160, 100, { keepMe: [1, { two: 2 }] })],
  appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {},
};
const cinder = await readDisk(new URL('../fixtures/drawings/cinder-bindings.excalidraw', import.meta.url), 'utf8');

await withBrowser(async ({ run, send, press, chord, key, move, click, double, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 400; i++) { if (await test()) return; await sleep(20); }
    assert.fail(label);
  };
  const readFile = (path = PATH) => run(async (path) => { const { api } = await import('/src/api.ts'); return api.readNote(path); }, path);
  const saved = async (test, label, path = PATH) => {
    let text = '';
    await wait(async () => { text = await readFile(path); try { return test(JSON.parse(text), text); } catch { return false; } }, label);
    return JSON.parse(text);
  };
  const byId = (doc, id) => doc.elements.find(e => e.id === id);
  const ofType = (doc, type) => doc.elements.filter(e => e.type === type);
  const view = () => run(() => {
    const r = document.querySelector('.drawing-view').getBoundingClientRect();
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.drawing-world')).transform);
    return { left: r.left, top: r.top, a: m.a, e: m.e, f: m.f };
  });
  const at = async (x, y) => { const v = await view(); return { x: v.left + v.e + v.a * x, y: v.top + v.f + v.a * y }; };
  const overlayPoint = (selector) => run((selector) => {
    const node = document.querySelector(`.drawing-overlay ${selector}`);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  const mouse = (type, p, extra = {}) => send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', ...extra });
  const drag = async (from, to, { steps = 10, modifiers = 0, pointerType = 'mouse', force = () => 0.5 } = {}) => {
    const pen = pointerType === 'pen' ? { pointerType } : {};
    await move(from);
    await mouse('mousePressed', from, { buttons: 1, clickCount: 1, modifiers, ...pen, ...(pen.pointerType ? { force: force(0) } : {}) });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await mouse('mouseMoved', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, { buttons: 1, modifiers, ...pen, ...(pen.pointerType ? { force: force(t) } : {}) });
      await sleep(16);
    }
    await mouse('mouseReleased', to, { buttons: 0, clickCount: 1, modifiers, ...pen });
    await sleep(60);
  };
  const near = (a, b, tol = 1.01) => Math.abs(a - b) <= tol;
  const placed = (el) => el.points.map(([x, y]) => [el.x + x, el.y + y]);
  // Whether a point sits on a box's outline grown by `gap` (within a pixel).
  const onBox = ([x, y], b, gap) => {
    const l = b.x - gap, r = b.x + b.width + gap, t = b.y - gap, btm = b.y + b.height + gap;
    const inside = x >= l - 1 && x <= r + 1 && y >= t - 1 && y <= btm + 1;
    const edge = Math.min(Math.abs(x - l), Math.abs(x - r), Math.abs(y - t), Math.abs(y - btm));
    return inside && edge <= 1;
  };
  const tool = () => run(() => document.querySelector('.drawing-view').dataset.tool);
  const typeText = (text) => send('Input.insertText', { text });
  const editor = () => run(() => {
    const area = document.querySelector('.drawing-view .drawing-text-editor');
    return area ? { value: area.value, focused: document.activeElement === area } : null;
  });

  await run(async (path, text) => {
    const { api } = await import('/src/api.ts');
    await api.createNote(path, text);
    await api.createNote('Elsewhere.md', 'Not a drawing.\n');
    await ws.vault.refreshFiles();
    await ws.open(path);
  }, PATH, JSON.stringify(fixture, null, 2) + '\n');
  await wait(() => run(() => !!document.querySelector('.drawing-world > svg [data-id="B"]') && !document.querySelector('.drawing-toolbar')?.hidden), 'editor ready');
  await click('.drawing-controls [aria-label="Reset zoom"]');
  check((await view()).a === 1, 'Zoom reset to 1 so one pixel is one scene unit');
  check(await run(() => ['arrow', 'line', 'freedraw', 'text', 'eraser'].every(t => !!document.querySelector(`.drawing-toolbar [data-tool="${t}"]`))), 'The toolbar has arrow, line, pen, text and eraser');

  // ----- arrows bind to the shapes they start and end in -----
  await click(await at(700, 300));
  await press('a');
  check(await tool() === 'arrow', 'A picks the arrow tool');
  check(await run(() => !document.querySelector('.drawing-style [aria-label="End arrow"]').closest('.drawing-style-section').hidden), 'The panel shows arrowheads for the arrow tool');
  await drag(await at(80, 50), await at(480, 50));
  let doc = await saved(d => ofType(d, 'arrow').length === 1, 'arrow saved');
  const arrow = ofType(doc, 'arrow')[0];
  const aid = arrow.id;
  check(arrow.startBinding?.elementId === 'A' && arrow.endBinding?.elementId === 'B', `The arrow binds to both boxes ${JSON.stringify([arrow.startBinding, arrow.endBinding])}`);
  check(byId(doc, 'A').boundElements.some(b => b.id === aid && b.type === 'arrow') && byId(doc, 'B').boundElements.some(b => b.id === aid), 'Both boxes list the arrow');
  check(onBox(placed(arrow)[0], byId(doc, 'A'), 4) && onBox(placed(arrow)[1], byId(doc, 'B'), 4), `Its ends sit just outside the boxes ${JSON.stringify(placed(arrow))}`);
  check(arrow.roughness === 0 && arrow.endArrowhead === 'arrow' && arrow.startArrowhead === null, 'A new arrow is clean-lined with an end arrowhead');
  check(byId(doc, 'B').keepMe?.[1]?.two === 2, 'An unknown key on a bound box is kept');
  check(await tool() === 'select' && (await run(() => document.querySelectorAll('.drawing-overlay .drawing-point').length)) === 2, 'After drawing, the arrow is selected with its two points');
  const arrowAfterDraw = JSON.stringify(arrow);
  const bVersion = byId(doc, 'B').version;

  // Move B: the arrow's end follows it.
  await press('Escape');
  await drag(await at(480, 80), await at(480, 280));
  doc = await saved(d => byId(d, 'B').y === 200, 'box move saved');
  let moved = byId(doc, aid);
  check(onBox(placed(moved)[1], byId(doc, 'B'), 4) && placed(moved)[1][1] > 100, `The arrow's end followed the box ${JSON.stringify(placed(moved))}`);
  check(onBox(placed(moved)[0], byId(doc, 'A'), 4), 'Its start stayed on the box that did not move');
  check(moved.version === arrow.version + 1 && byId(doc, 'B').version === bVersion + 1, 'The box and the arrow each got one new version');
  check(await run((id) => {
    const node = document.querySelector(`.drawing-world > svg > [data-id="${id}"] [data-part="shaft"]`);
    return !!node && /\d/.test(node.getAttribute('d'));
  }, aid), 'The arrow is painted');
  await chord('z');
  doc = await saved(d => byId(d, 'B').y === 0, 'undo saved');
  check(JSON.stringify(byId(doc, aid)) === arrowAfterDraw, 'Undo puts the arrow back as it was drawn');

  // Drag the arrow's end off B, then back onto it.
  await click(await at(280, 50));
  check((await run(() => document.querySelectorAll('.drawing-overlay .drawing-point').length)) === 2, 'A click on the arrow shows its points');
  let end = await overlayPoint('[data-point="1"]');
  await drag(end, await at(300, 220));
  doc = await saved(d => byId(d, aid).endBinding === null, 'unbind saved');
  check(!(byId(doc, 'B').boundElements ?? []).some(b => b.id === aid) && near(placed(byId(doc, aid))[1][1], 220), 'An end dragged off its box lets go of it, and the box forgets the arrow');
  end = await overlayPoint('[data-point="1"]');
  await drag(end, await at(470, 60));
  doc = await saved(d => byId(d, aid).endBinding?.elementId === 'B', 'rebind saved');
  check(byId(doc, 'B').boundElements.some(b => b.id === aid) && onBox(placed(byId(doc, aid))[1], byId(doc, 'B'), 4), 'Dropped on a box, the end binds to it and sits on its outline');

  // ----- lines: draw, add a point at a midpoint, move it, remove it -----
  await press('Escape');
  await press('l');
  await drag(await at(0, 250), await at(200, 250), { modifiers: 8 });
  doc = await saved(d => ofType(d, 'line').length === 1, 'line saved');
  const lid = ofType(doc, 'line')[0].id;
  check(JSON.stringify(ofType(doc, 'line')[0].points) === '[[0,0],[200,0]]' && !ofType(doc, 'line')[0].startBinding, 'L draws a two-point line, and lines do not bind');
  const mid = await overlayPoint('[data-mid="0"]');
  check(!!mid && !await overlayPoint('[data-handle="se"]'), 'A two-point line shows a midpoint and no frame handles');
  const lineText = await readFile();
  await click(mid);
  await sleep(400);
  check(await readFile() === lineText && !!await overlayPoint('[data-mid="0"]'), 'A click on a midpoint without a drag changes nothing');
  await drag(mid, await at(100, 320));
  doc = await saved(d => byId(d, lid).points.length === 3, 'added point saved');
  check(JSON.stringify(placed(byId(doc, lid))) === '[[0,250],[100,320],[200,250]]', `Dragging the midpoint adds a point there ${JSON.stringify(placed(byId(doc, lid)))}`);
  check(!!await overlayPoint('[data-handle="se"]'), 'A three-point line also gets the frame handles');
  const p0 = await overlayPoint('[data-point="0"]');
  await drag(p0, await at(-20, 230));
  doc = await saved(d => near(placed(byId(d, lid))[0][0], -20), 'moved point saved');
  check(near(placed(byId(doc, lid))[0][1], 230) && near(placed(byId(doc, lid))[1][1], 320), 'Dragging a point moves only that point');
  const p1 = await overlayPoint('[data-point="1"]');
  await move(p1);
  await mouse('mousePressed', p1, { buttons: 1, clickCount: 1, modifiers: 1 });
  await mouse('mouseReleased', p1, { buttons: 0, clickCount: 1, modifiers: 1 });
  doc = await saved(d => byId(d, lid).points.length === 2, 'removed point saved');
  check(JSON.stringify(placed(byId(doc, lid)).map(p => p.map(Math.round))) === '[[-20,230],[200,250]]', 'Alt+click removes a point');

  // ----- the pen: a mouse stroke and a pressured pen stroke -----
  await press('Escape');
  await press('p');
  await drag(await at(250, 250), await at(350, 330), { steps: 24 });
  doc = await saved(d => ofType(d, 'freedraw').length === 1, 'mouse stroke saved');
  const stroke = ofType(doc, 'freedraw')[0];
  check(stroke.points.length >= 15 && stroke.simulatePressure === true && stroke.pressures.length === 0, `A mouse stroke keeps its samples and simulates pressure (${stroke.points.length} points)`);
  check(near(stroke.x, 250) && near(stroke.y, 250) && near(stroke.width, 100, 2) && near(stroke.height, 80, 2) && stroke.roughness === 0, 'It hangs from its first point with the box of its points');
  check(await tool() === 'freedraw', 'The pen stays in hand for the next stroke');
  await drag(await at(250, 360), await at(360, 380), { steps: 20, pointerType: 'pen', force: t => 0.2 + 0.7 * t });
  doc = await saved(d => ofType(d, 'freedraw').length === 2, 'pen stroke saved');
  const pen = ofType(doc, 'freedraw')[1];
  check(pen.simulatePressure === false && pen.pressures.length === pen.points.length && pen.pressures[0] < 0.4 && pen.pressures.at(-1) > 0.75, `A pen stroke stores a pressure per point ${JSON.stringify([pen.pressures[0], pen.pressures.at(-1), pen.points.length])}`);
  check(await run((id) => {
    const node = document.querySelector(`.drawing-world > svg > [data-id="${id}"]`);
    return node.getAttribute('stroke') === 'none' && node.getAttribute('fill') !== 'none';
  }, pen.id), 'It is painted as an outline whose width follows the pressure');

  // ----- text: free text, a label in a shape, editing and fonts -----
  await press('t');
  await click(await at(450, 300));
  check((await editor())?.focused === true, 'A click with the text tool opens a text box with the caret in it');
  await typeText('Hello there');
  await press('Escape');
  doc = await saved(d => ofType(d, 'text').length === 1, 'free text saved');
  const free = ofType(doc, 'text')[0];
  check(free.text === 'Hello there' && free.originalText === 'Hello there' && free.width > 50 && near(free.x, 450) && near(free.y + free.height / 2, 300, 2) && !free.containerId, `The text is saved where it was typed ${JSON.stringify([free.x, free.y, free.width, free.height])}`);
  check(!await editor() && await tool() === 'select', 'Esc finishes the text and goes back to Select');
  check(await run((id) => document.querySelector(`.drawing-world > svg > [data-id="${id}"]`)?.textContent === 'Hello there', free.id), 'The text is painted');

  await press('Escape');
  await double(await at(80, 50));
  check(!!await editor(), 'A double-click on a box starts its label');
  await typeText('Box A');
  await click(await at(700, -200));
  doc = await saved(d => ofType(d, 'text').length === 2, 'label saved');
  const label = ofType(doc, 'text').find(t => t.containerId === 'A');
  check(!!label && label.text === 'Box A' && label.textAlign === 'center' && label.verticalAlign === 'middle', 'The label is bound to the box and centred');
  check(near(label.x + label.width / 2, 80, 1.5) && near(label.y + label.height / 2, 50, 1.5), `It sits in the middle of the box ${JSON.stringify([label.x, label.y, label.width, label.height])}`);
  check(byId(doc, 'A').boundElements.some(b => b.id === label.id && b.type === 'text') && byId(doc, 'A').boundElements.some(b => b.id === aid), 'The box lists its label beside its arrow');

  await click(await at(80, 50));
  await press('Enter');
  check((await editor())?.value === 'Box A', 'Enter on a selected box edits its label');
  await chord('a');
  await typeText('Start here');
  await key('Control', 2);
  await press('Enter', 2);
  await key('Control', 0, 'keyUp');
  doc = await saved(d => byId(d, label.id).text === 'Start here', 'label edit saved');
  check(byId(doc, label.id).version === label.version + 1 && !await editor(), 'Ctrl+Enter finishes the edit, one new version');
  await click('.drawing-style [aria-label="Large"]');
  doc = await saved(d => byId(d, label.id).fontSize === 28, 'font size saved');
  const large = byId(doc, label.id);
  check(near(large.x + large.width / 2, 80, 1.5) && near(large.y + large.height / 2, 50, 1.5) && large.height > label.height, 'A larger font lays the label out again, still centred');
  check(await run(() => !document.querySelector('.drawing-style [aria-label="Code"]').closest('.drawing-style-section').hidden), 'The font choices show for a box with a label');

  // A label on the arrow, by double-clicking its middle.
  await press('Escape');
  await double(await at(280, 50));
  check(!!await editor(), 'A double-click on an arrow starts its label');
  await typeText('next');
  await click(await at(700, -200));
  doc = await saved(d => ofType(d, 'text').some(t => t.containerId === aid), 'arrow label saved');
  const tag = ofType(doc, 'text').find(t => t.containerId === aid);
  const [ta, tb] = placed(byId(doc, aid));
  check(tag.text === 'next' && near(tag.x + tag.width / 2, (ta[0] + tb[0]) / 2, 1.5) && near(tag.y + tag.height / 2, (ta[1] + tb[1]) / 2, 1.5), 'The arrow\'s label sits on its middle');
  check(byId(doc, aid).boundElements?.some(b => b.id === tag.id && b.type === 'text'), 'The arrow lists its label');
  await click(await at(150, 85));

  // Move A: its label goes with it, and the arrow's start follows.
  // (The style panel covers the box's left side, so the press is on its right.)
  await drag(await at(150, 85), await at(150, -15));
  doc = await saved(d => byId(d, 'A').y === -100, 'A move saved');
  check(near(byId(doc, label.id).y, large.y - 100) && onBox(placed(byId(doc, aid))[0], byId(doc, 'A'), 4), 'The label and the arrow start go with the box');
  const [na, nb] = placed(byId(doc, aid));
  const moveTag = byId(doc, tag.id);
  check(near(moveTag.x + moveTag.width / 2, (na[0] + nb[0]) / 2, 1.5) && near(moveTag.y + moveTag.height / 2, (na[1] + nb[1]) / 2, 1.5), 'The arrow\'s label moved to its new middle');

  // ----- the eraser -----
  await press('Escape');
  await press('x');
  check(await tool() === 'eraser' && await run(() => document.querySelector('.drawing-style').hidden), 'X picks the eraser, with no style panel');
  await drag(await at(300, 230), await at(300, 400), { steps: 12 });
  doc = await saved(d => ofType(d, 'freedraw').every(e => e.isDeleted), 'erased strokes saved');
  check(!byId(doc, free.id).isDeleted && !byId(doc, lid).isDeleted && !byId(doc, 'A').isDeleted, 'The eraser takes only what it crossed');
  check(await run(() => !document.querySelector('.drawing-world > svg > [data-type="freedraw"]')), 'Erased strokes are no longer painted');
  await drag(await at(150, -15), await at(155, -10));
  doc = await saved(d => byId(d, 'A').isDeleted, 'erased box saved');
  check(byId(doc, label.id).isDeleted && byId(doc, aid).startBinding === null && !byId(doc, aid).isDeleted, 'Erasing a box takes its label and frees the arrow bound to it');
  await chord('z');
  doc = await saved(d => !byId(d, 'A').isDeleted, 'erase undo saved');
  check(!byId(doc, label.id).isDeleted && byId(doc, aid).startBinding?.elementId === 'A', 'Undo brings back the box, its label and the binding');
  await press('Escape');

  // Leave and reopen: everything is on disk, and reopening writes nothing.
  await sleep(400);
  const before = await readFile();
  await run(async () => { await ws.open('Elsewhere.md'); });
  await sleep(100);
  await run(async (path) => { await ws.open(path); }, PATH);
  await wait(() => run((id) => !!document.querySelector(`.drawing-world > svg > [data-id="${id}"]`), aid), 'reopened drawing painted');
  await sleep(400);
  check(await readFile() === before, 'Reopening writes nothing');

  // ----- a Cinder-made drawing round-trips after an edit -----
  await run(async (text) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Cinder.excalidraw', text);
    await ws.vault.refreshFiles();
    await ws.open('Cinder.excalidraw');
  }, cinder);
  await wait(() => run(() => !!document.querySelector('.drawing-world > svg [data-id="HZ2shPY1"]') && !document.querySelector('.drawing-toolbar')?.hidden), 'Cinder drawing ready');
  await click('.drawing-controls [aria-label="Reset zoom"]');
  // The box has no fill: a press on its label picks it.
  await drag(await at(80, 40), await at(80, 160));
  const original = JSON.parse(cinder);
  const cdoc = await saved(d => byId(d, 'HZ2shPY1').y === 120, 'Cinder edit saved', 'Cinder.excalidraw');
  const ctext = await readFile('Cinder.excalidraw');
  const arrowId = 'LR2YwsFt';
  const changed = new Set(['HZ2shPY1', 'mlGj3FRw', arrowId, 'N4YMqy9A']);
  const blocks = (doc) => doc.elements.filter(e => !changed.has(e.id)).map(e => JSON.stringify(e, null, 2).split('\n').join('\n    '));
  check(blocks(original).every(b => ctext.includes(b)) && blocks(cdoc).length === blocks(original).length, 'Every element the edit did not touch is byte for byte the same');
  check(JSON.stringify(cdoc.elements.map(e => e.id)) === JSON.stringify(original.elements.map(e => e.id)) && JSON.stringify(cdoc.appState) === JSON.stringify(original.appState) && cdoc.source === 'cinder', 'Order, appState and source are kept');
  const carrow = byId(cdoc, arrowId), oarrow = byId(original, arrowId);
  check(JSON.stringify(carrow.startBinding) === JSON.stringify(oarrow.startBinding) && JSON.stringify(carrow.endBinding) === JSON.stringify(oarrow.endBinding) && carrow.startArrowhead === 'dot', 'The arrow keeps its bindings, focus, gap and heads');
  check(JSON.stringify(Object.keys(carrow)) === JSON.stringify(Object.keys(oarrow)) && carrow.version === oarrow.version + 1, 'It keeps its keys in order and gets one new version');
  check(onBox(placed(carrow)[0], byId(cdoc, 'HZ2shPY1'), oarrow.startBinding.gap), `Its start follows the moved box ${JSON.stringify(placed(carrow))}`);
  check(byId(cdoc, 'mlGj3FRw').y === byId(original, 'mlGj3FRw').y + 120 && byId(cdoc, 'N4YMqy9A').y !== byId(original, 'N4YMqy9A').y, 'The box label moved with it and the arrow label to the arrow\'s new middle');
  await chord('z');
  await saved((d, text) => text === cinder, 'Cinder undo saved', 'Cinder.excalidraw');
  check(await readFile('Cinder.excalidraw') === cinder, 'Undo writes the Cinder file back byte for byte');

  // ----- many bound arrows and a long stroke: no task over 50ms -----
  await run(async () => {
    const elements = [{ id: 'hub', type: 'rectangle', x: 600, y: 600, width: 200, height: 200, backgroundColor: '#ffd6d6', boundElements: [] }];
    for (let i = 0; i < 150; i++) {
      const a = (i / 150) * Math.PI * 2;
      const x = 700 + Math.cos(a) * 600, y = 700 + Math.sin(a) * 600;
      // Each arrow ends just outside the hub's square, as the editor leaves bound ends.
      const reach = Math.min(100 / Math.abs(Math.cos(a) || 1e-9), 100 / Math.abs(Math.sin(a) || 1e-9)) + 4;
      const ex = 700 + Math.cos(a) * reach, ey = 700 + Math.sin(a) * reach;
      elements.push({ id: `s${i}`, type: 'ellipse', x: x - 15, y: y - 15, width: 30, height: 30, boundElements: [{ type: 'arrow', id: `a${i}` }] });
      elements.push({ id: `a${i}`, type: 'arrow', version: 1, x, y, points: [[0, 0], [ex - x, ey - y]], startBinding: { elementId: `s${i}`, focus: 0, gap: 4 }, endBinding: { elementId: 'hub', focus: 0, gap: 4 } });
      elements[0].boundElements.push({ type: 'arrow', id: `a${i}` });
    }
    const { api } = await import('/src/api.ts');
    await api.createNote('Hub.excalidraw', JSON.stringify({ type: 'excalidraw', version: 2, elements, appState: {}, files: {} }));
    await ws.vault.refreshFiles();
    await ws.open('Hub.excalidraw');
  });
  await wait(() => run(() => document.querySelectorAll('.drawing-world > svg > [data-type]').length === 301 && !document.querySelector('.drawing-toolbar')?.hidden), 'hub drawing painted');
  await sleep(100);
  await run(() => {
    window.toolLong = [];
    window.toolObserver = new PerformanceObserver(list => toolLong.push(...list.getEntries().map(e => Math.round(e.duration))));
    toolObserver.observe({ type: 'longtask' });
  });
  const hub = await run(() => { const r = document.querySelector('[data-id="hub"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await drag(hub, { x: hub.x + 80, y: hub.y + 40 }, { steps: 30 });
  await press('p');
  await drag({ x: hub.x - 200, y: hub.y - 200 }, { x: hub.x + 200, y: hub.y - 150 }, { steps: 300, pointerType: 'pen', force: t => 0.3 + 0.5 * t });
  await sleep(400);
  const long = await run(() => { toolObserver.disconnect(); return toolLong; });
  console.log('DRAWING_TOOLS_LONG', JSON.stringify(long));
  check(long.every(ms => ms <= 50), 'Moving a shape with 150 bound arrows, and a 300-sample pen stroke, have no task over 50ms');
  const hubDoc = await saved(d => d.elements.some(e => e.type === 'freedraw'), 'hub edits saved', 'Hub.excalidraw');
  check(hubDoc.elements.filter(e => e.type === 'arrow').every(a => a.endBinding?.elementId === 'hub') && byId(hubDoc, 'a0').version === 2, 'Every bound arrow followed the hub, one new version each');
});
