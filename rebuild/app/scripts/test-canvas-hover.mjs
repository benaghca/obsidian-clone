// Ctrl/Cmd hover previews inside canvas cards. Pointer events only: a mouse
// move must not be enough, because a canvas click can silence those in WebKitGTK.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ send, run, click, double, point, press, key, check }) => {
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('PreviewTarget.md', '# PreviewTarget\n\nDestination body.\n');
    await api.createNote('CardNote.md', '---\ntags: [canvas]\n---\n# Card note\n\nSee [[PreviewTarget]] here.\n');
    await api.createNote('Hover.canvas', JSON.stringify({
      nodes: [
        { id: 'text', type: 'text', x: 80, y: 80, width: 340, height: 200, text: '# Text card\n\nA [[PreviewTarget]] inside text.' },
        { id: 'note', type: 'file', file: 'CardNote.md', x: 480, y: 80, width: 360, height: 240 },
      ],
      edges: [],
    }));
    await ws.vault.refreshFiles();
    await ws.open('Hover.canvas');
  });
  for (let i = 0; i < 40 && !await run(() => !!document.querySelector('[data-node-id="note"] [data-href="PreviewTarget"]') && !!document.querySelector('[data-node-id="text"] [data-href="PreviewTarget"]')); i++) await sleep(50);
  check(await run(() => !!document.querySelector('[data-node-id="text"] [data-href="PreviewTarget"]') && !!document.querySelector('[data-node-id="note"] [data-href="PreviewTarget"]')), 'text and note cards render their wikilinks');
  await click('[aria-label="Reset zoom"]');
  await sleep(80);

  const dispatchAt = async (p, type, fields) => run((p, type, fields) => {
    const hit = document.elementFromPoint(p.x, p.y) || document.body;
    const init = { bubbles: true, cancelable: true, view: window, clientX: p.x, clientY: p.y, ...fields };
    hit.dispatchEvent(type === 'pointer' ? new PointerEvent('pointermove', { pointerId: 1, isPrimary: true, button: -1, ...init }) : new MouseEvent('mousemove', init));
    const href = hit.closest?.('[data-href]')?.getAttribute('data-href');
    if (href) return href;
    return (hit.className && String(hit.className).slice(0, 80)) || hit.tagName;
  }, p, type, fields);

  const measure = selector => run(selector => {
    const pop = document.querySelector('.hover-popover');
    const link = document.querySelector(selector);
    if (!pop || !link) return { open: !!pop, hasLink: !!link };
    const pr = pop.getBoundingClientRect();
    const lr = link.getBoundingClientRect();
    const samples = [[4, 4], [pr.width - 4, 4], [4, pr.height - 4], [pr.width - 4, pr.height - 4], [pr.width / 2, pr.height / 2]];
    const onTop = samples.every(([dx, dy]) => document.elementFromPoint(pr.left + dx, pr.top + dy)?.closest('.hover-popover') === pop);
    const below = pr.top - lr.bottom;
    const above = lr.top - pr.bottom;
    const info = {
      open: true,
      title: pop.querySelector('.markdown-embed-title')?.textContent ?? '',
      parentBody: pop.parentElement === document.body,
      fixed: getComputedStyle(pop).position === 'fixed',
      insideCanvas: !!pop.closest('.canvas-view'),
      unscaled: Math.abs(pr.width - pop.offsetWidth) < 2 && Math.abs(pr.height - pop.offsetHeight) < 2 && getComputedStyle(pop).transform === 'none',
      wide: pr.width > 300,
      onTop,
      inView: pr.left >= 7 && pr.top >= 7 && pr.right <= innerWidth - 7 && pr.bottom <= innerHeight - 7,
      // Left matches the link, then clamps so a 450px preview stays on screen.
      besideLink: ((below >= -1 && below <= 20) || (above >= -1 && above <= 20)) && pr.left <= lr.right + 1 && pr.right >= lr.left - 1,
      below, above, popLeft: pr.left, popRight: pr.right, linkLeft: lr.left, linkRight: lr.right,
    };
    info.ok = info.open && info.title === 'PreviewTarget' && info.parentBody && info.fixed && !info.insideCanvas && info.unscaled && info.wide && info.onTop && info.inView && info.besideLink;
    return info;
  }, selector);

  const closePreview = async () => { await press('Escape'); await sleep(40); };

  const expectPreview = async (selector, label, pointerType = 'mouse') => {
    await run(selector => {
      const link = document.querySelector(selector);
      if (!link) return;
      // The note editor can be taller than the card. Scroll whichever ancestor clips the link.
      for (let node = link.parentElement; node && node !== document.body; node = node.parentElement) {
        if (node.scrollHeight <= node.clientHeight + 1) continue;
        const linkRect = link.getBoundingClientRect();
        const box = node.getBoundingClientRect();
        if (linkRect.top >= box.top + 4 && linkRect.bottom <= box.bottom - 4) continue;
        const scale = box.height / node.clientHeight || 1;
        node.scrollTop += (linkRect.top - (box.top + 24)) / scale;
      }
    }, selector);
    await sleep(30);
    const p = await point(selector);
    const hit = await dispatchAt(p, 'pointer', { pointerType, ctrlKey: true, metaKey: false, buttons: 0 });
    assert.equal(hit, 'PreviewTarget', label + ' pointer is on the link (' + hit + ')');
    await sleep(500);
    const info = await measure(selector);
    check(info.ok, label + ': ' + JSON.stringify(info));
    await closePreview();
    check(await run(() => !document.querySelector('.hover-popover')), label + ': Escape dismisses the preview');
  };

  const textLink = '[data-node-id="text"] [data-href="PreviewTarget"]';
  const noteLink = '[data-node-id="note"] [data-href="PreviewTarget"]';
  const textAt = await point(textLink);
  await dispatchAt(textAt, 'mouse', { ctrlKey: true });
  await sleep(500);
  check(await run(() => !document.querySelector('.hover-popover')), 'mousemove alone does not open a canvas preview');
  await expectPreview(textLink, 'text card');
  await expectPreview(noteLink, 'note card', 'pen');

  const still = await point(noteLink);
  await dispatchAt(still, 'pointer', { pointerType: 'mouse', ctrlKey: false, metaKey: false, buttons: 0 });
  await sleep(500);
  check(await run(() => !document.querySelector('.hover-popover')), 'a still pointer without Ctrl does not open a preview');
  await key('Control', 2);
  await sleep(500);
  check((await measure(noteLink)).ok, 'pressing Ctrl while still opens the note-card preview');
  await closePreview();
  await key('Control', 0, 'keyUp');

  await click('[data-node-id="note"] .canvas-note-title');
  check(await run(() => document.querySelector('[data-node-id="note"]').classList.contains('is-selected')), 'clicking the note title selects the card');
  {
    const p = await point(noteLink);
    const hit = await dispatchAt(p, 'pointer', { pointerType: 'mouse', ctrlKey: true, metaKey: false, buttons: 0 });
    assert.equal(hit, 'PreviewTarget', 'selected note card pointer is on the link (' + hit + ')');
    await sleep(500);
    const info = await measure(noteLink);
    const selected = await run(() => document.querySelector('[data-node-id="note"]').classList.contains('is-selected'));
    check(info.ok && selected, 'selected note card keeps its selection: ' + JSON.stringify({ ...info, selected }));
    await closePreview();
  }

  await double('[data-node-id="note"] .cm-h1');
  for (let i = 0; i < 30 && !await run(() => !!document.querySelector('[data-node-id="note"].is-editing [data-href="PreviewTarget"]')); i++) await sleep(50);
  check(await run(() => !!document.querySelector('.canvas-note-editor')), 'double-click edits the note card');
  await expectPreview('[data-node-id="note"].is-editing [data-href="PreviewTarget"]', 'editing note card');
  await press('Escape');
  await sleep(80);

  await double('[data-node-id="text"] .cm-h1');
  for (let i = 0; i < 30 && !await run(() => !!document.querySelector('[data-node-id="text"].is-editing [data-href="PreviewTarget"]')); i++) await sleep(50);
  check(await run(() => document.querySelector('[data-node-id="text"]').classList.contains('is-editing')), 'double-click edits the text card');
  await expectPreview('[data-node-id="text"].is-editing [data-href="PreviewTarget"]', 'editing text card');
  await press('Escape');
  await sleep(80);

  await click('[aria-label="Reset zoom"]');
  await click('[aria-label="Zoom out"]');
  await click('[aria-label="Zoom out"]');
  await sleep(50);
  const zoomed = await run(() => new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform).a);
  check(zoomed < 0.8 && zoomed > 0.3, 'two zoom-out steps leave a non-1 scale (' + zoomed + ')');
  await expectPreview(noteLink, 'zoomed note card');
  const after = await run(() => new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform).a);
  check(Math.abs(after - zoomed) < 0.001, 'opening a preview does not change the zoom');

  const linkAt = await point(noteLink);
  await dispatchAt(linkAt, 'pointer', { pointerType: 'mouse', ctrlKey: true, metaKey: false, buttons: 0 });
  await sleep(500);
  check((await measure(noteLink)).open, 'a preview is open before the zoom wheel');
  const beforeWheel = await run(() => document.querySelector('.canvas-world').style.transform);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...linkAt, deltaX: 0, deltaY: 240, modifiers: 2 });
  await sleep(60);
  const wheeled = await run(before => ({
    pop: !!document.querySelector('.hover-popover'),
    changed: document.querySelector('.canvas-world').style.transform !== before,
  }), beforeWheel);
  check(!wheeled.pop && wheeled.changed, 'Ctrl+wheel zooms and dismisses the preview (' + JSON.stringify(wheeled) + ')');
  await closePreview();

  await click('[aria-label="Reset zoom"]');
  await sleep(40);
  const dragFrom = await point('[data-node-id="note"] .canvas-note-title');
  const leftBefore = await run(() => document.querySelector('[data-node-id="note"]').style.left);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...dragFrom, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 4; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragFrom.x + 12 * i, y: dragFrom.y, buttons: 1 });
    await sleep(30);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragFrom.x + 48, y: dragFrom.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(80);
  const leftAfter = await run(() => document.querySelector('[data-node-id="note"]').style.left);
  check(leftBefore !== leftAfter, 'dragging a card still moves it (' + leftBefore + ' -> ' + leftAfter + ')');
});
