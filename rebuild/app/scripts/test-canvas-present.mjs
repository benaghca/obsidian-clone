// Presentation mode: keys, clicks, chrome, viewport restore, and a glide that
// only writes the world transform. Canvases are created in the mock vault.
import { withBrowser, sleep } from './browser.mjs';
import { traceGesture, summarizeTrace } from './canvas-zoom-trace.mjs';

const group = (id, x, text) => [
  { id, type: 'group', x, y: 0, width: 480, height: 320, label: id },
  { id: id + 'c', type: 'text', x: x + 40, y: 70, width: 280, height: 120, text },
];
const deck = {
  nodes: [...group('A', 0, '[[Welcome]]'), ...group('B', 900, 'Bee'), ...group('C', 1800, 'Cee')],
  edges: [],
};
const flow = {
  nodes: [...group('A', 500, 'A'), ...group('C', 0, 'C'), ...group('B', 1100, 'B')],
  edges: [
    { id: 'e1', fromNode: 'A', toNode: 'C' },
    { id: 'e2', fromNode: 'C', toNode: 'B' },
  ],
};
const cards = {
  nodes: [
    { id: 'c2', type: 'text', x: 0, y: 0, width: 220, height: 120, text: 'First' },
    { id: 'c3', type: 'text', x: 400, y: 0, width: 220, height: 120, text: 'Second' },
    { id: 'c1', type: 'text', x: 100, y: 280, width: 220, height: 120, text: 'Third' },
  ],
  edges: [],
};
const huge = {
  nodes: [
    { id: 'G', type: 'group', x: 0, y: 0, width: 8000, height: 5000, label: 'Huge' },
    { id: 't', type: 'text', x: 100, y: 100, width: 250, height: 120, text: 'inside' },
  ],
  edges: [],
};
const hugeNote = {
  nodes: [
    { id: 'G', type: 'group', x: 0, y: 0, width: 8000, height: 5000, label: 'Huge' },
    { id: 'note', type: 'file', file: 'Welcome.md', x: 120, y: 120, width: 360, height: 240 },
  ],
  edges: [],
};
const slideDrawing = {
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
const hugeDrawing = {
  nodes: [
    { id: 'G', type: 'group', x: 0, y: 0, width: 8000, height: 5000, label: 'Huge' },
    { id: 'draw', type: 'file', file: 'Slide.excalidraw', x: 120, y: 120, width: 360, height: 240 },
  ],
  edges: [],
};
const many = {
  nodes: Array.from({ length: 300 }, (_, i) => ({
    id: `n${i}`, type: 'text', x: (i % 20) * 300, y: Math.floor(i / 20) * 220, width: 250, height: 160, text: `Card ${i}`,
  })),
  edges: [],
};

await withBrowser(async ({ send, on, run, click, press, check, open }) => {
  const f5 = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F5', code: 'F5', windowsVirtualKeyCode: 116 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F5', code: 'F5', windowsVirtualKeyCode: 116 });
  };
  const slide = () => run(() => document.querySelector('.canvas-view')?.dataset.slideId ?? '');
  const presenting = () => run(() => document.body.classList.contains('is-canvas-presenting'));
  const cam = () => run(() => {
    const view = document.querySelector('.canvas-view');
    const m = new DOMMatrix(view.querySelector('.canvas-world').style.transform);
    const scale = m.a || 1;
    return { cx: (view.clientWidth / 2 - m.e) / scale, cy: (view.clientHeight / 2 - m.f) / scale, scale };
  });
  const near = (a, b) => Math.abs(a - b) < 0.05;
  const same = (a, b) => near(a.cx, b.cx) && near(a.cy, b.cy) && near(a.scale, b.scale);
  const waitBuilt = async count => {
    for (let i = 0; i < 100; i++) {
      const ok = await run(n => {
        const probe = window.__canvasProbe?.();
        return document.querySelectorAll('.canvas-node').length === n && !!probe?.built && probe.pending === 0;
      }, count);
      if (ok) return;
      await sleep(50);
    }
    throw new Error(`canvas did not settle at ${count} cards`);
  };
  const waitSlide = async id => {
    for (let i = 0; i < 30; i++) {
      if (await slide() === id && await presenting()) return;
      await sleep(40);
    }
    throw new Error(`expected slide ${id}, saw ${await slide()}`);
  };
  const hidden = sel => run(sel => getComputedStyle(document.querySelector(sel)).display === 'none', sel);

  await open('EmptyPresent.canvas', { nodes: [], edges: [] });
  await waitBuilt(0);
  await f5();
  await sleep(80);
  check(await presenting() === false, 'empty board does not enter presentation');
  check(await run(() => document.body.textContent.includes('Add some cards to present')), 'empty board says to add some cards');
  check(await run(() => !!document.querySelector('.canvas-view')), 'F5 on an empty canvas does not reload the page');
  await run(() => document.querySelector('.notice')?.click());

  await open('Deck.canvas', deck);
  await waitBuilt(6);
  const fitted = await cam();
  await click('.canvas-controls [aria-label="Zoom in"]');
  await sleep(80);
  const zoomed = await cam();
  check(zoomed.scale > fitted.scale + 0.05, 'zoom in changes the camera before presentation');
  const positions = () => run(() => [...document.querySelectorAll('.canvas-node')].map(n => `${n.dataset.nodeId}:${n.style.left}:${n.style.top}`).join('|'));
  const beforeCards = await positions();
  const beforeFile = await run(async () => (await (await import('/src/api.ts')).api.readNote('Deck.canvas')).length);
  await f5();
  await waitSlide('A');
  check(await hidden('.workspace-ribbon') && await hidden('.mod-left-split') && await hidden('.mod-root .workspace-tab-header-container'), 'presentation hides the ribbon, sidebar and tab strip');
  check(await run(() => getComputedStyle(document.querySelector('.canvas-controls')).display === 'none'), 'presentation hides the canvas controls');
  check(await run(() => document.querySelector('.canvas-present-count')?.textContent === '1 / 3'), 'the slide bar starts at 1 / 3');
  const filled = await run(() => {
    const g = document.querySelector('[data-node-id="A"]').getBoundingClientRect();
    const v = document.querySelector('.canvas-view').getBoundingClientRect();
    return { gw: g.width, gh: g.height, vw: v.width, vh: v.height };
  });
  console.log('SLIDE', JSON.stringify(filled));
  check(filled.vw > 1100 && (filled.gw > filled.vw * 0.75 || filled.gh > filled.vh * 0.75), 'the first slide fills the enlarged view');
  await press('Delete');
  await press('Backspace');
  const during = await cam();
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '!', code: 'Digit1', windowsVirtualKeyCode: 49, modifiers: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '!', code: 'Digit1', windowsVirtualKeyCode: 49, modifiers: 8 });
  await sleep(60);
  check(await positions() === beforeCards, 'presentation does not move or delete cards');
  check(await run(async () => (await (await import('/src/api.ts')).api.readNote('Deck.canvas')).length) === beforeFile, 'presentation does not rewrite the canvas file');
  check(same(await cam(), during), 'Shift+1 does not refit during presentation');

  await press('ArrowRight');
  await sleep(600);
  check(await slide() === 'B', 'ArrowRight advances');
  const spot = await run(() => {
    const view = document.querySelector('.canvas-view');
    const r = view.getBoundingClientRect();
    for (let y = r.top + 40; y < r.bottom - 80; y += 24) for (let x = r.left + 40; x < r.right - 40; x += 24) {
      const el = document.elementFromPoint(x, y);
      if (el && view.contains(el) && !el.closest('a, [data-href], .canvas-present-ui, .canvas-controls, .notice')) return { x, y };
    }
    return null;
  });
  check(!!spot, 'a click target is clear of links and the slide bar');
  await click(spot);
  await sleep(600);
  check(await slide() === 'C', 'click advances');
  await press(' ');
  await sleep(100);
  check(await slide() === 'C', 'Space at the end stays put');
  await press('Home');
  await sleep(600);
  check(await slide() === 'A', 'Home returns to the first slide');
  await press('End');
  await sleep(600);
  check(await slide() === 'C', 'End jumps to the last slide');
  await press('ArrowLeft');
  await sleep(600);
  check(await slide() === 'B', 'ArrowLeft goes back');
  await click(spot, 'right');
  await sleep(600);
  check(await slide() === 'A', 'right-click goes back');
  await press('Escape');
  await sleep(80);
  check(await presenting() === false, 'Escape leaves presentation');
  check(await hidden('.workspace-ribbon') === false, 'Escape restores the ribbon');
  const restored = await cam();
  console.log('CAMERA', JSON.stringify({ zoomed, restored }));
  check(same(restored, zoomed), 'Escape restores the viewport');

  await f5();
  await waitSlide('A');
  await run(() => { ws.newTab(); return ws.open('Welcome.md'); });
  await sleep(80);
  check(await presenting() === false, 'opening another tab ends presentation');
  check(await hidden('.workspace-ribbon') === false, 'leaving the canvas restores the ribbon');
  await run(() => ws.activate(ws.activeGroup.tabs.find(t => t.type === 'canvas')));
  await waitBuilt(6);
  let back = await cam();
  for (let i = 0; i < 30 && !same(back, zoomed); i++) { await sleep(40); back = await cam(); }
  console.log('LEFT', JSON.stringify({ zoomed, back }));
  check(same(back, zoomed), 'leaving the canvas restores the camera');
  await run(() => {
    const extra = ws.activeGroup.tabs.find(t => t !== ws.active && t.path === 'Welcome.md');
    if (extra) ws.closeTab(extra);
  });

  await click('.canvas-controls .lucide-maximize');
  await sleep(150);
  const onB = await run(() => {
    const g = document.querySelector('[data-node-id="B"]');
    const r = g.getBoundingClientRect();
    for (let y = r.top + 4; y < r.bottom - 4; y += 10) for (let x = r.left + 4; x < r.right - 4; x += 10) {
      const node = document.elementFromPoint(x, y)?.closest('[data-node-id]');
      if (node?.dataset.nodeId === 'B') return { x, y };
    }
    return null;
  });
  check(!!onB, 'group B has a clickable part');
  await click(onB);
  await sleep(40);
  check(await run(() => document.querySelector('[data-node-id="B"]').classList.contains('is-selected')), 'clicking group B selects it');
  await f5();
  await waitSlide('B');
  check(await run(() => document.querySelector('.canvas-present-count')?.textContent === '2 / 3'), 'a selected group starts the presentation there');
  await press('Escape');
  await sleep(40);

  await run(() => { ws.open('Deck.canvas'); document.querySelector('.canvas-view')?.focus(); });
  await waitBuilt(6);
  await run(() => document.querySelector('.canvas-view').focus());
  await press('Escape');
  await f5();
  await waitSlide('A');
  for (let i = 0; i < 40 && !await run(() => !!document.querySelector('[data-href="Welcome"]')); i++) await sleep(50);
  check(await run(() => !!document.querySelector('[data-href="Welcome"]')), 'the presented card renders its wikilink');
  await click('[data-href="Welcome"]');
  for (let i = 0; i < 40 && !await run(() => ws.active.path === 'Welcome.md'); i++) await sleep(50);
  check(await run(() => ws.active.path === 'Welcome.md'), 'a wikilink still opens the note');
  check(await presenting() === false, 'opening a note ends presentation');

  await open('Flow.canvas', flow);
  await waitBuilt(6);
  const play = await run(() => {
    const button = [...document.querySelectorAll('.canvas-controls [role="button"]')].find(el => el.getAttribute('aria-label') === 'Start presentation\n(F5)');
    const r = button.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await click(play);
  await waitSlide('A');
  check(await run(() => document.querySelector('.canvas-view').dataset.slideCount === '3'), 'the play button starts the arrow order');
  await press('ArrowRight');
  await sleep(600);
  check(await slide() === 'C', 'edges order the slides A then C');
  await press('Escape');
  await sleep(40);

  await open('Cards.canvas', cards);
  await waitBuilt(3);
  await f5();
  await waitSlide('c2');
  check(await run(() => document.querySelector('.canvas-present-count')?.textContent === '1 / 3'), 'cards are slides when the board has no groups');
  await press('Escape');
  await sleep(40);

  await open('Huge.canvas', huge);
  await waitBuilt(2);
  await f5();
  await waitSlide('G');
  await waitBuilt(2);
  const title = await run(() => {
    const card = document.querySelector('[data-node-id="t"]');
    const scale = new DOMMatrix(document.querySelector('.canvas-world').style.transform).a;
    return {
      scale,
      title: card.classList.contains('is-title-mode'),
      culled: card.classList.contains('is-culled'),
      body: card.querySelector('.canvas-node-content')?.childNodes.length ?? 0,
    };
  });
  console.log('HUGE', JSON.stringify(title));
  check(title.scale < 0.45 && !title.title && !title.culled && title.body > 0, 'a fitted group below title-mode zoom still shows its card body');
  await press('Escape');
  await sleep(40);

  await open('HugeNote.canvas', hugeNote);
  await waitBuilt(2);
  await f5();
  await waitSlide('G');
  let noteBody = { title: true, culled: true, text: false };
  for (let i = 0; i < 40; i++) {
    noteBody = await run(() => {
      const card = document.querySelector('[data-node-id="note"]');
      const text = card?.querySelector('.canvas-node-content')?.textContent ?? '';
      return { title: card.classList.contains('is-title-mode'), culled: card.classList.contains('is-culled'), text: text.includes('sample vault') };
    });
    if (noteBody.text && !noteBody.title && !noteBody.culled) break;
    await sleep(50);
  }
  console.log('HUGE NOTE', JSON.stringify(noteBody));
  check(!noteBody.title && !noteBody.culled && noteBody.text, 'a file card in a fitted group still renders its note');
  await press('Escape');
  await sleep(40);

  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Slide.excalidraw', JSON.stringify(body));
    await ws.vault.refreshFiles();
  }, slideDrawing);
  await open('HugeDrawing.canvas', hugeDrawing);
  await waitBuilt(2);
  await f5();
  await waitSlide('G');
  let drawing = { title: true, culled: true, svg: false, text: false };
  for (let i = 0; i < 40; i++) {
    drawing = await run(() => {
      const card = document.querySelector('[data-node-id="draw"]');
      const svg = card?.querySelector('.drawing-preview svg');
      return {
        title: !!card?.classList.contains('is-title-mode'),
        culled: !!card?.classList.contains('is-culled'),
        svg: !!svg,
        text: !!svg?.textContent.includes('Hello drawing'),
      };
    });
    if (drawing.svg && drawing.text && !drawing.title && !drawing.culled) break;
    await sleep(50);
  }
  console.log('HUGE DRAWING', JSON.stringify(drawing));
  check(!drawing.title && !drawing.culled && drawing.svg && drawing.text, 'a drawing card in a fitted group still renders its picture');
  await press('Escape');
  await sleep(40);

  await open('Many.canvas', many);
  await waitBuilt(300);
  await f5();
  await waitSlide('n0');
  await waitBuilt(300);
  await sleep(200);
  await run(() => {
    const world = document.querySelector('.canvas-world');
    const view = document.querySelector('.canvas-view');
    const cx = () => {
      const m = new DOMMatrix(world.style.transform);
      return (view.clientWidth / 2 - m.e) / (m.a || 1);
    };
    window.glideCx = [cx()];
    let n = 0;
    const tick = () => { window.glideCx.push(cx()); if (++n < 40) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await press('ArrowRight');
  await sleep(750);
  const glide = await run(() => window.glideCx);
  const first = glide[0], last = glide[glide.length - 1];
  const between = glide.some(x => Math.abs(x - first) > 1 && Math.abs(last - x) > 1 && (x - first) * (last - first) > 0);
  console.log('GLIDE', JSON.stringify({ samples: glide.length, first, last, between }));
  check(Math.abs(last - first) > 20 && between, 'the slide change glides');
  check(await slide() === 'n1', 'the glide lands on the next card');

  await run(() => {
    window.canvasChildChanges = 0;
    const world = document.querySelector('.canvas-world');
    window.canvasMutationObserver = new MutationObserver(records => {
      canvasChildChanges += records.filter(r => r.target !== world && !r.target.closest?.('.canvas-selection-menu')).length;
    });
    window.canvasFrames = [];
    window.canvasRecording = true;
    let last = performance.now();
    const tick = now => {
      if (!canvasRecording) return;
      canvasFrames.push(now - last);
      last = now;
      window.canvasFrameId = requestAnimationFrame(tick);
    };
    window.canvasFrameId = requestAnimationFrame(tick);
  });
  await press('ArrowRight');
  await run(() => { window.canvasChildChanges = 0; window.canvasFrames = []; });
  await sleep(300);
  const frames = await run(() => {
    canvasRecording = false;
    cancelAnimationFrame(canvasFrameId);
    canvasMutationObserver.disconnect();
    return { frames: canvasFrames.slice(1), changes: canvasChildChanges };
  });
  const maxFrame = Math.max(...frames.frames);
  console.log('FRAMES', JSON.stringify({ samples: frames.frames.length, max: maxFrame, changes: frames.changes }));
  check(frames.frames.length >= 8 && maxFrame < 20 && frames.changes === 0, 'a 300-card glide stays under 20ms and does not touch card DOM');
  await sleep(300);

  const trace = await traceGesture({ send, on }, async () => {
    await press('ArrowRight');
    await sleep(600);
  });
  const metrics = summarizeTrace(trace, 1);
  console.log('COMPOSITOR', JSON.stringify(metrics));
  check(metrics.dropped <= 6, 'a 300-card glide stays within 6 compositor drops');

  await press('ArrowRight');
  await sleep(60);
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  const refit = await run(() => {
    const id = document.querySelector('.canvas-view').dataset.slideId;
    const card = document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect();
    const view = document.querySelector('.canvas-view').getBoundingClientRect();
    return { id, cw: card.width, ch: card.height, vw: view.width, vh: view.height };
  });
  console.log('RESIZE', JSON.stringify(refit));
  check(refit.vw < 950 && (refit.cw > refit.vw * 0.75 || refit.ch > refit.vh * 0.75), 'a resize during the glide refits the slide');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await press('Escape');
});
