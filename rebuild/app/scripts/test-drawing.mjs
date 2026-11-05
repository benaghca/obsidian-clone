// X2: drawing tab, note embeds, canvas file card, and a 2000-element open.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const sketch = {
  type: 'excalidraw',
  version: 2,
  source: 'grove',
  elements: [
    {
      id: 'r1', type: 'rectangle', x: 40, y: 40, width: 160, height: 90,
      strokeColor: '#1e1e1e', backgroundColor: '#a5d8ff', fillStyle: 'solid',
      strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, angle: 0,
      roundness: { type: 3 },
    },
    {
      id: 't1', type: 'text', x: 48, y: 70, width: 140, height: 25,
      strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
      strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, angle: 0,
      text: 'Hello drawing', fontSize: 20, fontFamily: 1, textAlign: 'left', verticalAlign: 'top',
    },
  ],
  appState: { viewBackgroundColor: '#ffffff', gridSize: 20 },
  files: {},
};

await withBrowser(async ({ run, send, click, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 800; i++) { if (await test()) return; await sleep(15); }
    assert.fail(label);
  };

  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Sketch.excalidraw', JSON.stringify(body));
    await api.createNote('Drawing note.md', '![[Sketch.excalidraw]]\n\n![[Sketch.excalidraw|400]]\n');
    await api.createNote('Board.canvas', JSON.stringify({
      nodes: [{ id: 'd', type: 'file', file: 'Sketch.excalidraw', x: 0, y: 0, width: 300, height: 200 }],
      edges: [],
    }));
    await ws.vault.refreshFiles();
    await ws.open('Sketch.excalidraw');
  }, sketch);

  await wait(() => run(() => !!document.querySelector('.drawing-world > svg') && !!document.querySelector('.drawing-world')?.style.transform), 'drawing tab fitted');
  const before = await run(() => {
    const svg = document.querySelector('.drawing-world > svg');
    return { transform: document.querySelector('.drawing-world').style.transform, html: svg.innerHTML, count: svg.childElementCount };
  });
  const view = await run(() => {
    const r = document.querySelector('.drawing-view').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: view.x, y: view.y, deltaX: 0, deltaY: 120 });
  await sleep(50);
  const afterWheel = await run(() => {
    const svg = document.querySelector('.drawing-world > svg');
    return { transform: document.querySelector('.drawing-world').style.transform, html: svg.innerHTML, count: svg.childElementCount };
  });
  check(afterWheel.transform !== before.transform && afterWheel.html === before.html && afterWheel.count === before.count, 'Wheel pans by transform only');
  await click('.drawing-controls [aria-label="Zoom in"]');
  const afterZoom = await run(() => {
    const svg = document.querySelector('.drawing-world > svg');
    return { transform: document.querySelector('.drawing-world').style.transform, html: svg.innerHTML };
  });
  check(afterZoom.transform !== afterWheel.transform && afterZoom.html === before.html, 'Zoom control changes only the transform');

  await run(async () => { await ws.open('Drawing note.md'); });
  await wait(() => run(() => document.querySelectorAll('.drawing-embed-body > svg').length === 2), 'two drawing embeds');
  const sized = await run(() => {
    const wide = [...document.querySelectorAll('.drawing-embed-body > svg')].find(svg => svg.getAttribute('width') === '400');
    return wide ? { width: wide.getAttribute('width'), box: wide.getBoundingClientRect().width } : null;
  });
  check(!!sized && sized.width === '400' && Math.abs(sized.box - 400) < 8, 'Sized embed is 400px wide');

  await run(async () => { await ws.open('Board.canvas'); });
  await wait(() => run(() => !!document.querySelector('.canvas-node.is-drawing .drawing-preview svg')), 'canvas drawing preview');
  const card = await run(() => {
    const node = document.querySelector('.canvas-node.is-drawing');
    return {
      title: node.classList.contains('is-title-mode'),
      text: node.textContent,
      scale: new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform).a,
    };
  });
  check(card.scale <= 1 && !card.title && !card.text.includes('Unsupported file'), 'Canvas card shows the drawing');

  await run(async () => {
    const elements = [];
    for (let i = 0; i < 2000; i++) {
      const hatch = i % 5 === 0;
      elements.push({
        id: `b${i}`, type: 'rectangle',
        x: (i % 50) * 30, y: Math.floor(i / 50) * 30, width: 20, height: 16,
        strokeColor: '#1e1e1e', backgroundColor: hatch ? '#a5d8ff' : '#ffffff',
        fillStyle: hatch ? 'hachure' : 'solid', strokeWidth: 1, strokeStyle: 'solid',
        roughness: 0, opacity: 100, angle: 0,
      });
    }
    const { api } = await import('/src/api.ts');
    await api.createNote('Big.excalidraw', JSON.stringify({
      type: 'excalidraw', version: 2, source: 'grove', elements,
      appState: { viewBackgroundColor: '#ffffff' }, files: {},
    }));
    await ws.vault.refreshFiles();
  });
  await run(async () => {
    // A watcher may repeat an unchanged file while SVG chunks are still painting.
    // The repeat must not leave only the first chunk mounted.
    window.drawingRepeated = false;
    window.drawingRepeatObserver = new MutationObserver(() => {
      const count = document.querySelectorAll('.drawing-view [data-type="rectangle"]').length;
      if (count > 0 && count < 2000 && !drawingRepeated) {
        drawingRepeated = true;
        ws.vault.written('Big.excalidraw');
      }
    });
    drawingRepeatObserver.observe(document.body, { childList: true, subtree: true });
    window.drawingLong = [];
    window.drawingObserver = new PerformanceObserver(list => drawingLong.push(...list.getEntries().map(e => e.duration)));
    drawingObserver.observe({ type: 'longtask' });
    window.drawingStart = performance.now();
    await ws.open('Big.excalidraw');
  });
  await wait(() => run(() => document.querySelectorAll('.drawing-view [data-type="rectangle"]').length === 2000), '2000 rectangles');
  const open = await run(() => ({
    ms: performance.now() - drawingStart,
    long: [...drawingLong],
    count: document.querySelectorAll('.drawing-view [data-type="rectangle"]').length,
  }));
  console.log('DRAWING_OPEN', JSON.stringify(open));
  check(open.count === 2000 && open.long.every(n => n <= 50), '2000-element drawing opens with no task over 50ms');
  check(await run(() => drawingRepeated), 'Unchanged watcher notification during chunked paint completes');
  await run(() => { drawingObserver.disconnect(); drawingRepeatObserver.disconnect(); });
  const unchanged = await run(async (body) => {
    const { api } = await import('/src/api.ts');
    return await api.readNote('Sketch.excalidraw') === JSON.stringify(body);
  }, sketch);
  check(unchanged, 'Viewing a drawing, note embeds and canvas preview preserves drawing bytes');
});
