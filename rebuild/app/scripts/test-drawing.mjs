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

  // A scene of only point strokes, including ones whose points run up and left
  // of the stored box. The fitted viewBox has to contain the drawn geometry.
  const stroke = { strokeWidth: 2, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeStyle: 'solid', roughness: 0, opacity: 100 };
  const lineOnly = {
    type: 'excalidraw', version: 2, source: 'grove', files: {},
    appState: { viewBackgroundColor: '#ffffff' },
    elements: [{ ...stroke, id: 'ln', type: 'line', x: 300, y: 200, width: 200, height: 100, angle: 0, points: [[0, 0], [-200, -100]] }],
  };
  const arrowOnly = {
    type: 'excalidraw', version: 2, source: 'grove', files: {},
    appState: { viewBackgroundColor: '#ffffff' },
    elements: [{ ...stroke, id: 'ar', type: 'arrow', x: 300, y: 200, width: 200, height: 100, angle: Math.PI / 2, points: [[0, 0], [-200, -100]], endArrowhead: 'arrow' }],
  };
  const penOnly = {
    type: 'excalidraw', version: 2, source: 'grove', files: {},
    appState: { viewBackgroundColor: '#ffffff' },
    elements: [{ ...stroke, id: 'fd', type: 'freedraw', x: 0, y: 0, width: 10, height: 10, angle: Math.PI / 2, points: [[0, 0], [-80, 20], [-20, -60]] }],
  };
  const offsets = {
    type: 'excalidraw', version: 2, source: 'grove', files: {},
    appState: { viewBackgroundColor: '#ffffff' },
    elements: [...lineOnly.elements, ...arrowOnly.elements, ...penOnly.elements],
  };
  await run(async (files) => {
    const { api } = await import('/src/api.ts');
    for (const [name, body] of Object.entries(files)) await api.createNote(name, JSON.stringify(body));
    await api.createNote('Offsets note.md', '![[Line.excalidraw]]\n\n![[Arrow.excalidraw]]\n\n![[Pen.excalidraw]]\n\n![[Offsets.excalidraw]]\n');
    await api.createNote('Offsets.canvas', JSON.stringify({
      nodes: [
        { id: 'ln', type: 'file', file: 'Line.excalidraw', x: 0, y: 0, width: 280, height: 180 },
        { id: 'ar', type: 'file', file: 'Arrow.excalidraw', x: 320, y: 0, width: 280, height: 180 },
        { id: 'fd', type: 'file', file: 'Pen.excalidraw', x: 0, y: 220, width: 280, height: 180 },
        { id: 'all', type: 'file', file: 'Offsets.excalidraw', x: 320, y: 220, width: 280, height: 180 },
      ],
      edges: [],
    }));
    await ws.vault.refreshFiles();
  }, {
    'Line.excalidraw': lineOnly,
    'Arrow.excalidraw': arrowOnly,
    'Pen.excalidraw': penOnly,
    'Offsets.excalidraw': offsets,
  });

  const readDrawing = (selector) => run((selector) => {
    const svg = document.querySelector(selector);
    if (!svg) return null;
    const [x, y, width, height] = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
    const box = { x, y, right: x + width, bottom: y + height };
    const covers = (px, py) => px >= box.x && py >= box.y && px <= box.right && py <= box.bottom;
    const turn = (px, py, cx, cy, angle) => {
      const dx = px - cx, dy = py - cy, c = Math.cos(angle), s = Math.sin(angle);
      return [cx + dx * c - dy * s, cy + dx * s + dy * c];
    };
    const misses = [];
    const want = (px, py, name) => { if (!covers(px, py)) misses.push(`${name} ${px},${py}`); };
    const html = svg.outerHTML;
    if (svg.querySelector('[data-id="ln"]')) {
      want(100, 100, 'line');
      want(300, 200, 'line');
    }
    if (svg.querySelector('[data-id="ar"]')) {
      for (const [px, py] of [[300, 200], [100, 100]]) {
        const [rx, ry] = turn(px, py, 200, 150, Math.PI / 2);
        want(rx, ry, 'arrow');
      }
    }
    if (svg.querySelector('[data-id="fd"]')) {
      for (const [px, py] of [[0, 0], [-80, 20], [-20, -60]]) {
        const [rx, ry] = turn(px, py, -40, -20, Math.PI / 2);
        want(rx, ry, 'freedraw');
      }
    }
    const sb = svg.getBoundingClientRect();
    const visible = [...svg.querySelectorAll('[data-id]')].every((el) => {
      const r = el.getBoundingClientRect();
      const mx = (r.left + r.right) / 2, my = (r.top + r.bottom) / 2;
      return r.width > 0 && r.height > 0 && mx >= sb.left - 1 && mx <= sb.right + 1 && my >= sb.top - 1 && my <= sb.bottom + 1;
    });
    return {
      misses,
      visible,
      ids: [...svg.querySelectorAll('[data-id]')].map((el) => el.getAttribute('data-id')).sort().join(','),
      arrowPivot: !html.includes('data-id="ar"') || html.includes('rotate(90 200 150)'),
      freedrawPivot: !html.includes('data-id="fd"') || html.includes('rotate(90 -40 -20)'),
      storedPivot: html.includes('400 250') || html.includes('rotate(90 5 5)'),
    };
  }, selector);

  const expectFit = async (selector, ids, label) => {
    await wait(() => run((selector, ids) => {
      const svg = document.querySelector(selector);
      if (!svg) return false;
      const got = [...svg.querySelectorAll('[data-id]')].map((el) => el.getAttribute('data-id')).sort().join(',');
      return got === ids;
    }, selector, ids), label);
    const report = await readDrawing(selector);
    check(!!report && report.misses.length === 0 && report.visible && report.ids === ids && report.arrowPivot && report.freedrawPivot && !report.storedPivot,
      `${label} ${JSON.stringify(report)}`);
  };

  await run(async () => { await ws.open('Line.excalidraw'); });
  await expectFit('.drawing-world > svg', 'ln', 'Line-only drawing fits');
  await run(async () => { await ws.open('Arrow.excalidraw'); });
  await expectFit('.drawing-world > svg', 'ar', 'Rotated arrow fits');
  await run(async () => { await ws.open('Pen.excalidraw'); });
  await expectFit('.drawing-world > svg', 'fd', 'Rotated freedraw fits');
  await run(async () => { await ws.open('Offsets.excalidraw'); });
  await expectFit('.drawing-world > svg', 'ar,fd,ln', 'Scene of only negative strokes fits');

  await run(async () => { await ws.open('Offsets note.md'); });
  await wait(() => run(() => document.querySelectorAll('.drawing-embed-body > svg').length === 4), 'four offset embeds');
  const embedIds = await run(() => [...document.querySelectorAll('.drawing-embed-body > svg')].map((svg) => {
    const ids = [...svg.querySelectorAll('[data-id]')].map((el) => el.getAttribute('data-id')).sort().join(',');
    svg.dataset.offset = ids;
    return ids;
  }));
  check(embedIds.slice().sort().join('|') === 'ar|ar,fd,ln|fd|ln', `Offset embeds ${embedIds.join('|')}`);
  for (const ids of embedIds) await expectFit(`.drawing-embed-body > svg[data-offset="${ids}"]`, ids, `Offset embed ${ids} fits`);

  await run(async () => { await ws.open('Offsets.canvas'); });
  await wait(() => run(() => document.querySelectorAll('.canvas-node.is-drawing .drawing-preview svg').length === 4), 'four drawing cards');
  const cardIds = await run(() => [...document.querySelectorAll('.canvas-node.is-drawing .drawing-preview svg')].map((svg) => {
    const ids = [...svg.querySelectorAll('[data-id]')].map((el) => el.getAttribute('data-id')).sort().join(',');
    svg.dataset.offset = ids;
    return ids;
  }));
  check(cardIds.slice().sort().join('|') === 'ar|ar,fd,ln|fd|ln', `Offset cards ${cardIds.join('|')}`);
  for (const ids of cardIds) await expectFit(`.drawing-preview svg[data-offset="${ids}"]`, ids, `Offset card ${ids} fits`);
});
