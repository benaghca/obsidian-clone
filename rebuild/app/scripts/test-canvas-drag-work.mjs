// Canvas drag cost: what each pointer move does when two note cards are dragged.
// A move should only reposition the cards, their edges and the selection menu.
// It should not rewrite a stylesheet (WebKit restyles the whole document for
// that), rebuild menu DOM, or save; the save happens once, after the drop.
// Then: alignment guides appear while a card lines up with another, and clear.
import { withBrowser, sleep } from './browser.mjs';

const MOVES = 30;
const board = { nodes: [
  { id: 'a', type: 'file', file: 'Welcome.md', x: 0, y: 0, width: 400, height: 300 },
  { id: 'b', type: 'file', file: 'Ideas.md', x: 480, y: 0, width: 400, height: 300 },
], edges: [{ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' }] };

await withBrowser(async ({ send, run, point, move, check, read, open }) => {
  await open('DragWork.canvas', board, 300);
  // Count the work a move causes: stylesheet rule writes, menu DOM changes,
  // forced layout reads and saves.
  await run(async () => {
    const { api } = await import('/src/api.ts');
    const count = window.dragWork = { ruleWrites: 0, domChanges: 0, layoutReads: 0, saves: 0 };
    const setProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (...args) { if (this.parentRule) count.ruleWrites++; return setProperty.apply(this, args); };
    for (const key of ['offsetTop', 'offsetHeight', 'offsetLeft', 'offsetWidth']) {
      const getter = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key).get;
      Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get() { count.layoutReads++; return getter.call(this); } });
    }
    new MutationObserver(records => { count.domChanges += records.reduce((n, r) => n + r.addedNodes.length + r.removedNodes.length, 0); })
      .observe(document.querySelector('.canvas-selection-menu'), { childList: true, subtree: true });
    const write = api.writeNote;
    api.writeNote = (...args) => { count.saves++; return write(...args); };
  });
  const original = await read();
  await send('Performance.enable');
  const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  // Shift-click the second card so both move, as a multi-selection drag.
  // Inside each card's padding, clear of links in the rendered note.
  const corner = id => run(id => { const r = document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect(); return { x: r.x + 8, y: r.y + 8 }; }, id);
  const a = await corner('a'), b = await corner('b');
  await move(a);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...a, button: 'left', clickCount: 1 });
  await move(b);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...b, button: 'left', clickCount: 1, modifiers: 8 });
  check(await run(() => document.querySelectorAll('.canvas-node.is-selected').length === 2), 'Both note cards are selected');
  await move(a);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...a, button: 'left', buttons: 1, clickCount: 1 });
  // Past the 3px drag threshold first, so every counted move really moves the cards.
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + 10, y: a.y + 10, buttons: 1 }); await sleep(40);
  await run(() => { for (const key of Object.keys(dragWork)) dragWork[key] = 0; });
  const before = await metrics();
  for (let i = 1; i <= MOVES; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + 10 + i * 7, y: a.y + 10 + i * 3, buttons: 1 });
    await sleep(20);
  }
  const after = await metrics();
  const during = await run(() => ({ ...dragWork }));
  const moved = await run(() => document.querySelector('[data-node-id="a"]').style.left);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a.x + 10 + MOVES * 7, y: a.y + 10 + MOVES * 3, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(400);
  const saved = await run(() => dragWork.saves);
  const per = key => (after[key] - before[key]) / MOVES;
  console.log('DRAGWORK', JSON.stringify({
    moves: MOVES, ...Object.fromEntries(Object.entries(during).map(([k, v]) => [`${k}PerMove`, +(v / MOVES).toFixed(2)])),
    styleRecalcsPerMove: +per('RecalcStyleCount').toFixed(2), layoutsPerMove: +per('LayoutCount').toFixed(2),
    styleMsPerMove: +(per('RecalcStyleDuration') * 1000).toFixed(3), layoutMsPerMove: +(per('LayoutDuration') * 1000).toFixed(3),
    scriptMsPerMove: +(per('ScriptDuration') * 1000).toFixed(3), savesAfterDrop: saved,
  }));
  check(moved !== '0px', `The cards moved during the drag (left ${moved})`);
  check(during.saves === 0, 'No save while dragging');
  check(saved === 1, `One save after the drop (${saved})`);
  check(await read() !== original, 'The drop changed the canvas file');
  check(during.ruleWrites === 0, `No stylesheet rule writes while dragging (${during.ruleWrites} in ${MOVES} moves)`);
  check(during.layoutReads === 0, `No forced layout reads while dragging (${during.layoutReads} in ${MOVES} moves)`);
  check(during.domChanges === 0, `The selection menu is not rebuilt while dragging (${during.domChanges} node changes in ${MOVES} moves)`);

  // Alignment guides: B dragged up until its top is 3 board units below A's top
  // snaps level with it and shows guides, which clear on the drop. With Alt held
  // it neither snaps nor shows guides. Grid snapping is off here so only alignment acts.
  await run(async () => { const { settings } = await import('/src/settings/store.ts'); settings.set('canvas.json', 'snapToGrid', false); });
  await open('Align.canvas', { nodes: [
    { id: 'a', type: 'text', x: 0, y: 10, width: 300, height: 200, text: 'A' },
    { id: 'b', type: 'text', x: 400, y: 50, width: 300, height: 200, text: 'B' },
  ], edges: [] }, 300);
  await run(() => document.querySelector('.canvas-controls [aria-label="Reset zoom"]').click());
  await sleep(100);
  const alignDrag = async (dy, modifiers, during) => {
    const p = await corner('b');
    await move(p);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1, modifiers });
    for (let i = 1; i <= 8; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y + dy * i / 8, buttons: 1, modifiers }); await sleep(30); }
    await during();
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y + dy, button: 'left', buttons: 0, clickCount: 1, modifiers });
    await sleep(400);
  };
  const guideLines = () => run(() => [...document.querySelectorAll('.canvas-guides line')].map(l => ({ y1: +l.getAttribute('y1'), y2: +l.getAttribute('y2') })));
  const top = () => run(() => document.querySelector('[data-node-id="b"]').style.top);
  await alignDrag(-37, 0, async () => {
    const lines = await guideLines();
    check(lines.some(l => l.y1 === 10 && l.y2 === 10), `A horizontal guide joins the aligned top edges while dragging (${JSON.stringify(lines)})`);
    check(await run(() => document.querySelectorAll('.canvas-guides circle').length) >= 4, 'The aligned corners get dots');
    check(await top() === '10px', `The card snaps level with the other card (top ${await top()})`);
  });
  check((await guideLines()).length === 0 && await run(() => !document.querySelector('.canvas-guides circle')), 'Guides clear on the drop');
  check(JSON.parse(await read()).nodes[1].y === 10, 'The snapped position is saved');
  await alignDrag(-17, 1, async () => {
    check((await guideLines()).length === 0, 'Alt turns alignment off: no guides');
  });
  check(JSON.parse(await read()).nodes[1].y === -7, `Alt turns alignment off: no snap (y ${JSON.parse(await read()).nodes[1].y})`);
  await run(async () => { const { settings } = await import('/src/settings/store.ts'); settings.set('canvas.json', 'snapToGrid', true); });
}, { height: 800 });
