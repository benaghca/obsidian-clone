// Edge cases for CZ-H: Ctrl+hover previews on canvas cards.
// Hover while a zoom is settling, while panning, and after a card leaves the viewport.
// Pointer events only, matching test-canvas-hover.mjs. Product code is not under test here
// beyond what these checks observe.
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ send, run, click, double, point, press, check }) => {
  const textLink = '[data-node-id="text"] [data-href="PreviewTarget"]';
  const noteLink = '[data-node-id="note"] [data-href="PreviewTarget"]';
  const clipLink = '[data-node-id="clip"] [data-href="PreviewTarget"]';

  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('PreviewTarget.md', '# PreviewTarget\n\nDestination body.\n');
    const filler = Array.from({ length: 24 }, (_, i) => `Filler line ${i} sits above the link.`).join('\n');
    await api.createNote('Clipped.md', `${filler}\n\nSee [[PreviewTarget]] below the fold.\n`);
    await api.createNote('CardNote.md', '# Card note\n\nSee [[PreviewTarget]] here.\n');
    await api.createNote('EdgeHover.canvas', JSON.stringify({
      nodes: [
        { id: 'text', type: 'text', x: 40, y: 30, width: 300, height: 150, text: 'A [[PreviewTarget]] inside text.' },
        { id: 'note', type: 'file', file: 'CardNote.md', x: 560, y: 30, width: 280, height: 150 },
        { id: 'clip', type: 'file', file: 'Clipped.md', x: 40, y: 220, width: 300, height: 100 },
      ],
      edges: [],
    }));
    await ws.vault.refreshFiles();
    await ws.open('EdgeHover.canvas');
  });
  const linksReady = (text, note, clip) => run((text, note, clip) => !!document.querySelector(text) && !!document.querySelector(note) && !!document.querySelector(clip), text, note, clip);
  for (let i = 0; i < 40 && !await linksReady(textLink, noteLink, clipLink); i++) await sleep(50);
  check(await linksReady(textLink, noteLink, clipLink), 'text, note and clipped cards render their wikilinks');
  await click('[aria-label="Reset zoom"]');
  await sleep(80);

  const dispatchAt = async (p, fields) => run((p, fields) => {
    const hit = document.elementFromPoint(p.x, p.y) || document.body;
    hit.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, isPrimary: true, button: -1, bubbles: true, cancelable: true, view: window,
      clientX: p.x, clientY: p.y, pointerType: 'mouse', ctrlKey: true, buttons: 0, ...fields,
    }));
    const href = hit.closest?.('[data-href]')?.getAttribute('data-href');
    return href || (hit.className && String(hit.className).slice(0, 80)) || hit.tagName;
  }, p, fields);

  const preview = () => run(() => {
    const pop = document.querySelector('.hover-popover');
    if (!pop) return { open: false };
    const pr = pop.getBoundingClientRect();
    const samples = [[4, 4], [pr.width - 4, 4], [4, pr.height - 4], [pr.width - 4, pr.height - 4], [pr.width / 2, pr.height / 2]];
    return {
      open: true,
      count: document.querySelectorAll('.hover-popover').length,
      title: pop.querySelector('.markdown-embed-title')?.textContent ?? '',
      parentBody: pop.parentElement === document.body,
      fixed: getComputedStyle(pop).position === 'fixed',
      insideCanvas: !!pop.closest('.canvas-view'),
      unscaled: Math.abs(pr.width - pop.offsetWidth) < 2 && Math.abs(pr.height - pop.offsetHeight) < 2 && getComputedStyle(pop).transform === 'none',
      wide: pr.width > 300,
      onTop: samples.every(([dx, dy]) => document.elementFromPoint(pr.left + dx, pr.top + dy)?.closest('.hover-popover') === pop),
      inView: pr.left >= 0 && pr.top >= 0 && pr.right <= innerWidth + 1 && pr.bottom <= innerHeight + 1,
      animations: pop.getAnimations().length,
      left: pr.left, top: pr.top, width: pr.width, height: pr.height,
    };
  });

  const okPreview = (info, title) => info.open && info.count === 1 && info.title === title && info.parentBody && info.fixed
    && !info.insideCanvas && info.unscaled && info.wide && info.onTop && info.inView && info.animations === 0;

  const closePreview = async () => { await press('Escape'); await sleep(40); };

  const visibleOn = async selector => run(selector => {
    const link = document.querySelector(selector);
    const view = document.querySelector('.canvas-view');
    if (!link || !view) return null;
    const r = link.getBoundingClientRect();
    const v = view.getBoundingClientRect();
    const y0 = Math.max(r.top, v.top), y1 = Math.min(r.bottom, v.bottom);
    const x0 = Math.max(r.left, v.left), x1 = Math.min(r.right, v.right);
    for (let y = y0 + 2; y < y1 - 1; y += 4) {
      for (let x = x0 + 2; x < x1 - 1; x += 6) {
        const el = document.elementFromPoint(x, y);
        if (el?.closest('[data-href]') === link) return { x, y };
      }
    }
    return null;
  }, selector);

  const look = () => run(() => {
    const world = document.querySelector('.canvas-world');
    const m = new DOMMatrix(getComputedStyle(world).transform);
    return { out: world.classList.contains('is-zoomed-out'), scale: m.a, x: m.e, y: m.f };
  });

  const empty = async () => {
    const spot = await run(() => {
      const view = document.querySelector('.canvas-view');
      const r = view.getBoundingClientRect();
      for (let y = r.bottom - 24; y > r.top + 40; y -= 28) {
        for (let x = r.right - 24; x > r.left + 24; x -= 28) {
          const el = document.elementFromPoint(x, y);
          if (el && view.contains(el) && !el.closest('.canvas-node, [data-edge-id], .canvas-controls, .canvas-card-menu, .canvas-selection-menu, .menu'))
            return { x, y };
        }
      }
      return null;
    });
    check(spot, 'the canvas has an empty point');
    return spot;
  };

  // Baseline, then input that must not open a preview.
  const base = await visibleOn(textLink);
  check(base, 'the text-card link is visible at 100%');
  const moved = await dispatchAt(base, { ctrlKey: false });
  await sleep(400);
  check(!((await preview()).open), 'a pointer move without Ctrl does not open a preview (' + moved + ')');
  const touched = await dispatchAt(base, { pointerType: 'touch', ctrlKey: true, buttons: 0 });
  await sleep(400);
  check(!((await preview()).open), 'a touch pointer does not open a canvas preview (' + touched + ')');
  const held = await dispatchAt(base, { ctrlKey: true, buttons: 1 });
  await sleep(400);
  check(!((await preview()).open), 'Ctrl+hover with a button held does not start a preview (' + held + ')');
  const hit = await dispatchAt(base, { ctrlKey: true, buttons: 0 });
  check(hit === 'PreviewTarget', 'the baseline pointer is on the text link (' + hit + ')');
  await sleep(420);
  const opened = await preview();
  check(okPreview(opened, 'PreviewTarget'), 'baseline text-card preview: ' + JSON.stringify(opened));
  await closePreview();

  // A link clipped by its own card is not a hit target, so it must not preview.
  const clipRect = await run(selector => {
    const link = document.querySelector(selector);
    const card = link.closest('.canvas-node');
    const lr = link.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    return { linkTop: lr.top, cardBottom: cr.bottom, cx: lr.left + lr.width / 2, cy: lr.top + lr.height / 2 };
  }, clipLink);
  check(clipRect.linkTop > clipRect.cardBottom - 2, 'the clipped card lays its link below the card box');
  const clipVisible = await visibleOn(clipLink);
  check(!clipVisible, 'the clipped link has no visible hit point');
  const clipHit = await dispatchAt({ x: clipRect.cx, y: Math.min(clipRect.cy, clipRect.cardBottom + 8) }, { ctrlKey: true });
  await sleep(420);
  check(!((await preview()).open) && clipHit !== 'PreviewTarget', 'Ctrl+hover where the clipped link would be does not preview it (' + clipHit + ')');

  // A second link replaces the one open preview. If the first popover covers it, that
  // cover is the hit target and must not count as the link.
  const first = await visibleOn(textLink);
  await dispatchAt(first, { ctrlKey: true });
  await sleep(420);
  check((await preview()).open, 'a preview is open before moving to the other card');
  const second = await visibleOn(noteLink);
  if (second) {
    const swapHit = await dispatchAt(second, { ctrlKey: true });
    check(swapHit === 'PreviewTarget', 'the note-card link is the hit target beside the open preview');
    await sleep(420);
    const swapped = await preview();
    check(okPreview(swapped, 'PreviewTarget'), 'moving to the other link keeps a single unscaled preview: ' + JSON.stringify(swapped));
  } else {
    const covered = await run(selector => {
      const link = document.querySelector(selector);
      const r = link.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit?.closest('.hover-popover') ? 'popover' : (hit?.className && String(hit.className).slice(0, 60)) || hit?.tagName;
    }, noteLink);
    check(covered === 'popover', 'the open preview covers the other link, so that link is not the hit target (' + covered + ')');
  }
  await closePreview();
  const noteAt = await visibleOn(noteLink);
  check(noteAt, 'the note-card link is visible once the preview is gone');
  await dispatchAt(noteAt, { ctrlKey: true });
  await sleep(420);
  check(okPreview(await preview(), 'PreviewTarget'), 'the note card still previews after the other popover covered it');
  await closePreview();

  // Park the text link on the right edge of the canvas. The popover stays on screen and unscaled.
  const park = await run(selector => {
    const link = document.querySelector(selector);
    const view = document.querySelector('.canvas-view');
    const lr = link.getBoundingClientRect();
    const vr = view.getBoundingClientRect();
    return { dx: (vr.right - 16) - (lr.left + lr.width / 2), x: vr.left + vr.width / 2, y: vr.top + vr.height / 2 };
  }, textLink);
  await click(await empty());
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: park.x, y: park.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: park.x + park.dx, y: park.y, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: park.x + park.dx, y: park.y, button: 'left', buttons: 0, clickCount: 1 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(60);
  const edged = await visibleOn(textLink);
  check(edged, 'the text link is still hittable after parking it on the right edge');
  const edgeHit = await dispatchAt(edged, { ctrlKey: true });
  check(edgeHit === 'PreviewTarget', 'the edge pointer is on the link (' + edgeHit + ')');
  await sleep(420);
  const edgePop = await preview();
  check(okPreview(edgePop, 'PreviewTarget'), 'a link at the canvas edge still gets an on-screen unscaled preview: ' + JSON.stringify(edgePop));

  // Wheel inside the popover scrolls the preview. It does not close it or zoom the board.
  const popAt = await point('.hover-popover .markdown-embed-content, .hover-popover');
  const beforePopWheel = await look();
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...popAt, deltaX: 0, deltaY: 80, modifiers: 0 });
  await sleep(80);
  const afterPopWheel = await look();
  const still = await preview();
  check(still.open && Math.abs(afterPopWheel.scale - beforePopWheel.scale) < 1e-9 && Math.abs(afterPopWheel.x - beforePopWheel.x) < 0.5 && Math.abs(afterPopWheel.y - beforePopWheel.y) < 0.5,
    'a wheel inside the preview leaves it open and does not pan or zoom (' + JSON.stringify({ still: still.open, beforePopWheel, afterPopWheel }) + ')');
  await closePreview();

  // A zoom that starts during the 350ms hover delay cancels the preview and still zooms.
  const live = await visibleOn(textLink);
  check(live, 'the link is visible before the zoom-during-hover');
  await dispatchAt(live, { ctrlKey: true });
  await sleep(40);
  check(!((await preview()).open), 'the preview is still waiting when the zoom wheel arrives');
  const beforeDelayZoom = await look();
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...live, deltaX: 0, deltaY: -120, modifiers: 2 });
  await sleep(500);
  const afterDelayZoom = await look();
  check(!((await preview()).open) && afterDelayZoom.scale > beforeDelayZoom.scale + 0.01,
    'Ctrl+wheel during the hover delay zooms and the preview never opens (' + JSON.stringify({ before: beforeDelayZoom.scale, after: afterDelayZoom.scale }) + ')');

  // Zoom back, open a preview, then a zoom button (pointerdown) dismisses it and zooms.
  await click('[aria-label="Reset zoom"]');
  await sleep(80);
  const again = await visibleOn(textLink);
  check(again, 'the link is visible after reset');
  await dispatchAt(again, { ctrlKey: true });
  await sleep(420);
  check((await preview()).open, 'a preview is open before the zoom button');
  const beforeButton = (await look()).scale;
  await click('[aria-label="Zoom out"]');
  await sleep(80);
  const afterButton = (await look()).scale;
  check(!((await preview()).open) && afterButton < beforeButton - 0.05,
    'the zoom button dismisses the preview and still zooms (' + beforeButton + ' -> ' + afterButton + ')');

  // Space+drag pans. The space key and the press both dismiss an open preview, and the board moves.
  await click('[aria-label="Reset zoom"]');
  await sleep(60);
  await click(await empty());
  const forPan = await visibleOn(textLink);
  await dispatchAt(forPan, { ctrlKey: true });
  await sleep(420);
  check((await preview()).open, 'a preview is open before the pan');
  const panFrom = await run(() => {
    const r = document.querySelector('.canvas-view').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const beforePan = await look();
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(30);
  check(!((await preview()).open), 'pressing Space dismisses the preview');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...panFrom, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: panFrom.x - 220, y: panFrom.y + 40, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: panFrom.x - 220, y: panFrom.y + 40, button: 'left', buttons: 0, clickCount: 1 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(500);
  const afterPan = await look();
  check(!((await preview()).open) && (Math.abs(afterPan.x - beforePan.x) > 2 || Math.abs(afterPan.y - beforePan.y) > 2),
    'a pan after Space moves the board and the preview stays closed (' + JSON.stringify({ beforePan, afterPan }) + ')');

  // Push the text card fully past the left of the canvas. Hovering the view must not revive it.
  const shove = await run(selector => {
    const link = document.querySelector(selector);
    const view = document.querySelector('.canvas-view').getBoundingClientRect();
    const r = link.getBoundingClientRect();
    return { dx: (view.left - 40) - r.right, x: view.left + view.width / 2, y: view.top + view.height / 2 };
  }, textLink);
  await click(await empty());
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: shove.x, y: shove.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: shove.x + shove.dx, y: shove.y, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: shove.x + shove.dx, y: shove.y, button: 'left', buttons: 0, clickCount: 1 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(60);
  const gone = await run(selector => {
    const link = document.querySelector(selector);
    const view = document.querySelector('.canvas-view').getBoundingClientRect();
    const r = link.getBoundingClientRect();
    const separated = r.right < view.left + 2 || r.left > view.right - 2 || r.bottom < view.top + 2 || r.top > view.bottom - 2;
    return { separated, left: r.left, right: r.right, viewLeft: view.left, viewRight: view.right };
  }, textLink);
  check(gone.separated, 'the text card has left the viewport (' + JSON.stringify(gone) + ')');
  const missed = await visibleOn(textLink);
  check(!missed, 'a card outside the viewport has no visible link');
  const mid = await run(() => {
    const r = document.querySelector('.canvas-view').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await dispatchAt(mid, { ctrlKey: true });
  await sleep(420);
  check(!((await preview()).open), 'Ctrl+hover in the empty view does not preview a card that has left');

  // Fit brings the card back. A hover that starts while a zoom-out is still settling (the link is
  // still painted) opens one unscaled preview, including after title mode hides the link.
  await click(await empty());
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '!', code: 'Digit1', windowsVirtualKeyCode: 49, modifiers: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '!', code: 'Digit1', windowsVirtualKeyCode: 49, modifiers: 8 });
  await sleep(120);
  const back = await visibleOn(textLink);
  const backInfo = await run(selector => {
    const link = document.querySelector(selector);
    const view = document.querySelector('.canvas-view').getBoundingClientRect();
    const world = document.querySelector('.canvas-world');
    const r = link.getBoundingClientRect();
    return {
      scale: new DOMMatrix(getComputedStyle(world).transform).a,
      out: world.classList.contains('is-zoomed-out'),
      link: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, text: link.textContent },
      view: { left: view.left, top: view.top, right: view.right, bottom: view.bottom },
    };
  }, textLink);
  check(back, 'the text link is back after fit ' + JSON.stringify(backInfo));
  const scaleNow = (await look()).scale;
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...back, deltaX: 0, deltaY: -300 * Math.log2(0.42 / scaleNow), modifiers: 2 });
  const during = await dispatchAt(back, { ctrlKey: true });
  const midZoom = await look();
  check(during === 'PreviewTarget' && !midZoom.out, 'the link is still the hit target while title mode is waiting to settle (' + during + ', ' + JSON.stringify(midZoom) + ')');
  await sleep(500);
  const settledHover = await preview();
  const settled = await look();
  check(settled.out && settled.scale < 0.45 && okPreview(settledHover, 'PreviewTarget'),
    'a hover started during the zoom still opens an unscaled preview once title mode settles: ' + JSON.stringify({ settled, settledHover }));
  await closePreview();

  // In title mode the link is not painted, so a pointer on the card does not preview it.
  const cardAt = await run(() => {
    const r = document.querySelector('[data-node-id="text"]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const hiddenHit = await dispatchAt(cardAt, { ctrlKey: true });
  await sleep(420);
  check(!((await preview()).open) && hiddenHit !== 'PreviewTarget', 'title mode does not preview a link the card is no longer showing (' + hiddenHit + ')');

  // Editing keeps the body. Fit leaves title mode and puts the card back in the
  // canvas view. Reset zoom keeps the panned center, so the card can sit under the file explorer.
  await click(await empty());
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '!', code: 'Digit1', windowsVirtualKeyCode: 49, modifiers: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '!', code: 'Digit1', windowsVirtualKeyCode: 49, modifiers: 8 });
  await sleep(150);
  const prepared = await look();
  check(!prepared.out && prepared.scale > 0.55, 'fit leaves content mode before the edit (' + JSON.stringify(prepared) + ')');
  const editAt = await run(() => {
    const card = document.querySelector('[data-node-id="text"]');
    const view = document.querySelector('.canvas-view');
    const r = card.getBoundingClientRect();
    const v = view.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height * 0.78;
    const hit = document.elementFromPoint(x, y);
    const inside = x > v.left && x < v.right && y > v.top && y < v.bottom;
    return {
      x, y, inside,
      onCard: hit?.closest('[data-node-id="text"]') === card,
      onLink: !!hit?.closest('[data-href]'),
      hit: hit ? (hit.className?.toString?.().slice(0, 80) || hit.tagName) : 'none',
    };
  });
  check(editAt.inside && editAt.onCard && !editAt.onLink, 'the edit double-click lands on the card (' + JSON.stringify(editAt) + ')');
  await double(editAt);
  for (let i = 0; i < 30 && !await run(() => !!document.querySelector('[data-node-id="text"].is-editing')); i++) await sleep(50);
  check(await run(() => document.querySelector('[data-node-id="text"]')?.classList.contains('is-editing')), 'double-click edits the text card before the title-mode zoom');
  const editLink = await point('[data-node-id="text"].is-editing [data-href="PreviewTarget"]');
  const editScale = (await look()).scale;
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...editLink, deltaX: 0, deltaY: -300 * Math.log2(0.36 / editScale), modifiers: 2 });
  await sleep(200);
  const editingZoom = await run(() => {
    const world = document.querySelector('.canvas-world');
    const card = document.querySelector('[data-node-id="text"]');
    const body = card.querySelector('.canvas-node-content');
    return {
      out: world.classList.contains('is-zoomed-out'),
      scale: new DOMMatrix(getComputedStyle(world).transform).a,
      editing: card.classList.contains('is-editing'),
      hidden: getComputedStyle(body).contentVisibility === 'hidden',
    };
  });
  check(editingZoom.out && editingZoom.scale < 0.45 && editingZoom.editing && !editingZoom.hidden,
    'an editing card stays painted when the board enters title mode (' + JSON.stringify(editingZoom) + ')');
  const editVisible = await run(selector => {
    const link = document.querySelector(selector);
    const view = document.querySelector('.canvas-view')?.getBoundingClientRect();
    if (!link || !view) return null;
    const r = link.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x <= view.left || x >= view.right || y <= view.top || y >= view.bottom) return null;
    const el = document.elementFromPoint(x, y);
    return el?.closest('[data-href]') === link ? { x, y } : null;
  }, '[data-node-id="text"].is-editing [data-href="PreviewTarget"]');
  check(editVisible, 'the link in the editing card is hittable in title mode');
  const editHit = await dispatchAt(editVisible, { ctrlKey: true });
  check(editHit === 'PreviewTarget', 'the editing-card pointer is on the link (' + editHit + ')');
  await sleep(420);
  const editPop = await preview();
  const editStill = await run(() => document.querySelector('[data-node-id="text"]')?.classList.contains('is-editing') && document.querySelector('.canvas-world').classList.contains('is-zoomed-out'));
  check(okPreview(editPop, 'PreviewTarget') && editStill, 'Ctrl+hover in an editing title-mode card opens an unscaled preview and leaves the editor up: ' + JSON.stringify(editPop));
  await closePreview();
}, { height: 900 });
