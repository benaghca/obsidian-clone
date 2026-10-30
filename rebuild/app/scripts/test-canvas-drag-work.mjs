// Canvas drag cost: what each pointer move does when two note cards are dragged.
// A move should only reposition the cards, their edges and the selection menu.
// It should not rewrite a stylesheet (WebKit restyles the whole document for
// that), rebuild menu DOM, or save; the save happens once, after the drop.
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
}, { height: 800 });
