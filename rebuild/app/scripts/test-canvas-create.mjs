// Ctrl+drag (Cmd on macOS) on empty canvas draws a create box, then offers the shared add list.
import { withBrowser, sleep } from './browser.mjs';

const CTRL = 2, ALT = 1;

await withBrowser(async ({ run, send, open, read, click, press, chord, move, check }) => {
  const fixture = {
    nodes: [
      { id: 'a', type: 'text', x: 0, y: 0, width: 120, height: 80, text: 'Alpha' },
      { id: 'b', type: 'text', x: 0, y: 220, width: 120, height: 80, text: 'Beta' },
    ],
    edges: [],
  };
  const data = async () => JSON.parse(await read());
  const titles = () => run(() => [...document.querySelectorAll('.canvas-create-menu .menu-item-title')].map(e => e.textContent).join('|'));
  const item = async (title) => run(title => {
    const row = [...document.querySelectorAll('.menu-item')].find(el => el.querySelector('.menu-item-title')?.textContent === title);
    const r = row.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, title);
  const itemPoint = (selector, text) => run((selector, text) => {
    const row = [...document.querySelectorAll(selector)].find(el => el.textContent.includes(text));
    const r = row.getBoundingClientRect();
    return { x: r.x + 12, y: r.y + r.height / 2 };
  }, selector, text);
  const snapBox = (a, b, step) => {
    const snap = v => step ? Math.round(v / step) * step : v;
    const x0 = snap(a.x), y0 = snap(a.y), x1 = snap(b.x), y1 = snap(b.y);
    const x = Math.min(x0, x1), y = Math.min(y0, y1);
    const width = Math.abs(x1 - x0), height = Math.abs(y1 - y0);
    return {
      x: Math.round(x), y: Math.round(y),
      width: Math.max(50, Math.round(width)), height: Math.max(50, Math.round(height)),
      boardW: width, boardH: height, x1, y1,
    };
  };
  // A screen drag whose whole rectangle misses cards, edges and controls.
  const findDrag = (w, h) => run((w, h) => {
    const view = document.querySelector('.canvas-view');
    const r = view.getBoundingClientRect();
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform);
    const board = (x, y) => ({ x: (x - r.left - m.e) / m.a, y: (y - r.top - m.f) / m.a });
    const screen = (x, y) => ({ x: r.left + x * m.a + m.e, y: r.top + y * m.a + m.f });
    const empty = (x, y) => {
      if (x < r.left + 12 || y < r.top + 12 || x > r.right - 12 || y > r.bottom - 12) return false;
      const el = document.elementFromPoint(x, y);
      return !!(el && view.contains(el) && !el.closest('.canvas-node, [data-edge-id], .canvas-controls, .canvas-card-menu, .canvas-selection-menu, .menu, .prompt, .mod-confirm'));
    };
    for (let y = Math.round(r.top + 64); y < r.bottom - h - 24; y += 16) {
      for (let x = Math.round(r.left + 24); x < r.right - w - 24; x += 16) {
        const x2 = x + w, y2 = y + h;
        if ([ [x, y], [x2, y2], [x2, y], [x, y2], [(x + x2) / 2, (y + y2) / 2] ].every(([px, py]) => empty(px, py)))
          return { from: { x, y }, to: { x: x2, y: y2 }, a: board(x, y), b: board(x2, y2), scale: m.a };
      }
    }
    return null;
  }, w, h);
  // One grid cell: corners fall on adjacent 20-unit lines, so the drawn box is 20 and the item grows to 50.
  const findCell = () => run(() => {
    const view = document.querySelector('.canvas-view');
    const r = view.getBoundingClientRect();
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform);
    const screen = (x, y) => ({ x: r.left + x * m.a + m.e, y: r.top + y * m.a + m.f });
    const empty = (p) => {
      if (p.x < r.left + 8 || p.y < r.top + 8 || p.x > r.right - 8 || p.y > r.bottom - 8) return false;
      const el = document.elementFromPoint(p.x, p.y);
      return !!(el && view.contains(el) && !el.closest('.canvas-node, [data-edge-id], .canvas-controls, .canvas-card-menu, .canvas-selection-menu, .menu'));
    };
    const left = Math.ceil(((8 - m.e) / m.a) / 20) * 20;
    const top = Math.ceil(((8 - m.f) / m.a) / 20) * 20;
    const right = ((r.width - 8 - m.e) / m.a);
    const bottom = ((r.height - 8 - m.f) / m.a);
    for (let y = top; y + 20 < bottom; y += 20) {
      for (let x = left; x + 20 < right; x += 20) {
        const from = screen(x + 1, y + 1), to = screen(x + 19, y + 19);
        if (empty(from) && empty(to) && empty(screen(x + 10, y + 10))) return { from, to, x, y, scale: m.a };
      }
    }
    return null;
  });
  const dragTo = async (from, to, modifiers, steps = 8) => {
    await move(from);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1, modifiers });
    for (let i = 1; i <= steps; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, buttons: 1, modifiers,
      });
      await sleep(16);
    }
    await sleep(40);
  };
  const releaseAt = async (to, modifiers) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1, modifiers });
    await sleep(50);
  };
  const undo = async () => {
    await press('Escape');
    await run(() => document.querySelector('.canvas-view').focus());
    await chord('z');
    await sleep(400);
  };
  const same = (node, box) => node && node.x === box.x && node.y === box.y && node.width === box.width && node.height === box.height;

  await open('Create.canvas', fixture);
  await click('[aria-label="Reset zoom"]');
  await sleep(80);
  const original = await read();
  await click('[data-node-id="a"]');
  check(await run(() => document.querySelector('[data-node-id="a"]').classList.contains('is-selected')), 'Card A starts selected');

  const spot = await findDrag(220, 140);
  check(spot, 'Empty canvas has room for a create drag');
  const snapped = snapBox(spot.a, spot.b, 20);
  check(snapped.boardW * spot.scale >= 10 && snapped.boardH * spot.scale >= 10, 'The snapped box is large enough to keep');
  await run(() => {
    window.createReads = 0;
    window.createDom = 0;
    const orig = Element.prototype.getBoundingClientRect;
    window.createRect = orig;
    Element.prototype.getBoundingClientRect = function () { window.createReads++; return orig.call(this); };
    const world = document.querySelector('.canvas-world');
    window.createObserver = new MutationObserver(records => { window.createDom += records.length; });
    window.createObserver.observe(world, { subtree: true, attributes: true, childList: true });
  });
  await move(spot.from);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...spot.from, button: 'left', buttons: 1, clickCount: 1, modifiers: CTRL });
  await sleep(40);
  await run(() => { createReads = 0; createDom = 0; });
  for (let i = 1; i <= 10; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: spot.from.x + (spot.to.x - spot.from.x) * i / 10, y: spot.from.y + (spot.to.y - spot.from.y) * i / 10,
      buttons: 1, modifiers: CTRL,
    });
    await sleep(16);
  }
  await sleep(40);
  const during = await run(() => {
    const box = document.querySelector('.canvas-create');
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;border:2px solid var(--interactive-accent);background:color-mix(in srgb, var(--interactive-accent) 12%, transparent)';
    const ten = document.createElement('div');
    ten.style.cssText = 'position:absolute;background:color-mix(in srgb, var(--interactive-accent) 10%, transparent)';
    document.body.append(probe, ten);
    const b = getComputedStyle(box), p = getComputedStyle(probe), t = getComputedStyle(ten);
    const look = {
      parent: box.parentElement.classList.contains('canvas-view') && !box.closest('.canvas-world'),
      border: b.borderTopWidth, solid: b.borderTopStyle,
      borderColor: b.borderTopColor === p.borderTopColor,
      fill: b.backgroundColor === p.backgroundColor,
      distinct: b.backgroundColor !== t.backgroundColor,
      animations: box.getAnimations().length,
      width: parseFloat(box.style.width), height: parseFloat(box.style.height),
      selection: !!document.querySelector('.canvas-selection'),
      selected: [...document.querySelectorAll('.canvas-node.is-selected')].map(el => el.dataset.nodeId).join(','),
    };
    probe.remove(); ten.remove();
    createObserver.disconnect();
    Element.prototype.getBoundingClientRect = createRect;
    return { look, reads: createReads, dom: createDom };
  });
  check(during.look.parent, 'The create box is a screen-space child of the canvas, not of the scaled world');
  check(during.look.border === '2px' && during.look.solid === 'solid' && during.look.borderColor, 'The create box has a 2px accent outline');
  check(during.look.fill && during.look.distinct, 'The create box fill is 12% accent, not the selection box 10%');
  check(during.look.animations === 0, 'The create box has no animation');
  check(Math.abs(during.look.width - snapped.boardW * spot.scale) < 0.6 && Math.abs(during.look.height - snapped.boardH * spot.scale) < 0.6, `Grid snap sizes the box (${during.look.width.toFixed(1)}×${during.look.height.toFixed(1)})`);
  check(!during.look.selection && during.look.selected === 'a', 'Ctrl+drag does not marquee-select; the previous selection stays');
  check(during.reads === 0 && during.dom === 0, `Create drag does not read card layout or restyle the board (${during.reads} reads, ${during.dom} mutations)`);
  await releaseAt(spot.to, CTRL);
  check(await titles() === 'Add card|Add note from vault|Add media from vault|Add web page|Create group', 'The release menu is exactly the five add items');
  check(await run(() => ['sticky-note', 'file-text', 'file-image', 'globe', 'group'].every((name, i) => document.querySelectorAll('.canvas-create-menu .menu-item')[i]?.querySelector('.lucide-' + name))), 'The create menu reuses the shared add icons');
  check(await run(() => document.querySelector('.canvas-create-menu').getAnimations().length === 0 && !!document.querySelector('.canvas-create')), 'The menu has no open animation and the box stays up');
  const corner = await run((x1, y1) => {
    const r = document.querySelector('.canvas-view').getBoundingClientRect();
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform);
    return { x: r.left + x1 * m.a + m.e, y: r.top + y1 * m.a + m.f };
  }, snapped.x1, snapped.y1);
  const menuBox = await run(() => document.querySelector('.canvas-create-menu').getBoundingClientRect().toJSON());
  const near = (p, q) => Math.abs(p - q) <= 1.5;
  check((near(menuBox.left, corner.x) || near(menuBox.right, corner.x)) && (near(menuBox.top, corner.y) || near(menuBox.bottom, corner.y)), 'The menu opens at the release corner');
  await press('Escape');
  check(await run(() => !document.querySelector('.menu') && !document.querySelector('.canvas-create')) && await read() === original, 'Escape drops the box and adds nothing');

  await dragTo(spot.from, spot.to, CTRL);
  await releaseAt(spot.to, CTRL);
  check(await run(() => !!document.querySelector('.canvas-create-menu')), 'A second Ctrl+drag opens the menu again');
  const elsewhere = await run(() => {
    const view = document.querySelector('.canvas-view');
    const r = view.getBoundingClientRect();
    for (let y = r.top + 18; y < r.bottom - 18; y += 28) {
      for (let x = r.left + 18; x < r.right - 18; x += 28) {
        const el = document.elementFromPoint(x, y);
        if (el && view.contains(el) && !el.closest('.menu')) return { x: Math.round(x), y: Math.round(y) };
      }
    }
    return null;
  });
  check(elsewhere, 'There is a point outside the create menu');
  await click(elsewhere);
  await sleep(40);
  check(await run(() => !document.querySelector('.menu') && !document.querySelector('.canvas-create')) && await read() === original, 'A click elsewhere drops the box and adds nothing');

  await dragTo(spot.from, spot.from, CTRL, 1);
  await releaseAt(spot.from, CTRL);
  check(await run(() => !document.querySelector('.canvas-create-menu') && !document.querySelector('.canvas-create')), 'A Ctrl+click with no box adds nothing');
  const tinyTo = { x: spot.from.x + 6, y: spot.from.y + 4 };
  await dragTo(spot.from, tinyTo, CTRL | ALT, 2);
  await releaseAt(tinyTo, CTRL | ALT);
  check(await run(() => !document.querySelector('.menu')) && await read() === original, 'A box under 10px is dropped');

  await dragTo(spot.from, spot.to, CTRL);
  await press('Escape');
  await releaseAt(spot.to, CTRL);
  check(await run(() => !document.querySelector('.menu') && !document.querySelector('.canvas-create')) && await read() === original, 'Escape during the drag cancels it');

  const added = async (title, finish, match) => {
    await dragTo(spot.from, spot.to, CTRL);
    await releaseAt(spot.to, CTRL);
    await click(await item(title));
    if (finish) await finish();
    await sleep(400);
    const nodes = (await data()).nodes;
    const node = nodes.find(n => n.id !== 'a' && n.id !== 'b');
    check(same(node, snapped), `${title} uses the box (${JSON.stringify(node && { x: node.x, y: node.y, width: node.width, height: node.height })} vs ${snapped.x},${snapped.y} ${snapped.width}×${snapped.height})`);
    check(match(node, nodes), `${title} creates the right item`);
    await undo();
    check(await read() === original, `${title} undoes back to the original file`);
  };
  await added('Add card', async () => {
    check(await run(() => !!document.querySelector('.canvas-node.is-editing .cm-editor')), 'Add card opens the empty text editor');
  }, node => node.type === 'text' && node.text === '');
  await added('Add note from vault', async () => {
    check(await run(() => !!document.querySelector('.prompt') && document.querySelector('.prompt').getAnimations().length === 0), 'Add note reuses the instant picker');
    await send('Input.insertText', { text: 'Welcome' });
    await click(await itemPoint('.suggestion-item', 'Welcome'));
  }, node => node.type === 'file' && node.file === 'Welcome.md');
  await added('Add media from vault', async () => {
    await send('Input.insertText', { text: 'photo.png' });
    await click(await itemPoint('.suggestion-item', 'photo.png'));
    await sleep(400);
    check(await run(() => getComputedStyle(document.querySelector('.canvas-node-file img')).objectFit === 'contain'), 'Boxed media keeps object-fit contain');
  }, node => node.type === 'file' && node.file === 'Attachments/photo.png');
  await added('Add web page', async () => {
    check(await run(() => document.querySelector('.mod-confirm')?.getAttribute('aria-label') === 'Add web page'), 'Add web page reuses the confirm dialog');
    await run(() => document.querySelector('.mod-confirm input').focus());
    await send('Input.insertText', { text: 'https://example.com/docs' });
    await press('Enter');
  }, node => node.type === 'link' && node.url === 'https://example.com/docs');
  check(await run(() => performance.getEntriesByType('resource').every(entry => !entry.name.includes('example.com'))), 'The web page card is not fetched');
  await added('Create group', async () => {
    check(await run(() => !document.querySelector('.canvas-group-label.is-editing')), 'Create group does not open the label editor');
  }, (node, nodes) => node.type === 'group' && node.label === 'Untitled group' && nodes[0].id === node.id);
  await dragTo(spot.from, spot.to, CTRL);
  await releaseAt(spot.to, CTRL);
  await click(await item('Create group'));
  await sleep(400);
  const line = (await read()).split('\n').map(l => l.trim()).find(l => l.includes('"type":"group"'));
  check(line && /"id":"[0-9a-f]{16}","x":-?\d+,"y":-?\d+,"width":\d+,"height":\d+,"type":"group","label":"Untitled group"/.test(line), 'Create group keeps the selection group key order');
  await undo();

  const cell = await findCell();
  check(cell && cell.scale * 20 >= 10, 'A free grid cell is on screen');
  await dragTo(cell.from, cell.to, CTRL, 4);
  await releaseAt(cell.to, CTRL);
  await click(await item('Add card'));
  await sleep(400);
  const grown = (await data()).nodes.find(n => n.id !== 'a' && n.id !== 'b');
  check(grown && grown.x === cell.x && grown.y === cell.y && grown.width === 50 && grown.height === 50, 'A 20-unit snapped box grows to the 50×50 minimum at its top-left');
  await undo();

  const alt = await findDrag(173, 91);
  check(alt, 'Empty canvas has room for an unsnapped drag');
  const free = snapBox(alt.a, alt.b, 0);
  const grid = snapBox(alt.a, alt.b, 20);
  check(free.x !== grid.x || free.y !== grid.y || free.width !== grid.width || free.height !== grid.height, 'This drag lands off the 20-unit grid');
  await dragTo(alt.from, alt.to, CTRL | ALT);
  const altBox = await run(() => {
    const box = document.querySelector('.canvas-create');
    return box ? { width: parseFloat(box.style.width), height: parseFloat(box.style.height) } : null;
  });
  check(altBox && Math.abs(altBox.width - Math.abs(alt.to.x - alt.from.x)) < 0.6 && Math.abs(altBox.height - Math.abs(alt.to.y - alt.from.y)) < 0.6, 'Alt draws the pointer rectangle instead of the grid');
  await releaseAt(alt.to, CTRL | ALT);
  await click(await item('Add card'));
  await sleep(400);
  const altNode = (await data()).nodes.find(n => n.id !== 'a' && n.id !== 'b');
  check(same(altNode, free), 'Alt stores the unsnapped box, clamped only by the 50×50 minimum');
  await undo();

  await run(async () => { const { settings } = await import('/src/settings/store.ts'); settings.set('canvas.json', 'snapToGrid', false); });
  await dragTo(alt.from, alt.to, CTRL);
  const offBox = await run(() => {
    const box = document.querySelector('.canvas-create');
    return box ? { width: parseFloat(box.style.width), height: parseFloat(box.style.height) } : null;
  });
  check(offBox && Math.abs(offBox.width - Math.abs(alt.to.x - alt.from.x)) < 0.6, 'Snap to grid off follows the pointer without Alt');
  await press('Escape');
  await releaseAt(alt.to, CTRL);
  await run(async () => { const { settings } = await import('/src/settings/store.ts'); settings.set('canvas.json', 'snapToGrid', true); });

  await click('[aria-label="Zoom out"]');
  await sleep(80);
  const zoomed = await findDrag(160, 120);
  check(zoomed && zoomed.scale < 0.8, 'Zoom out leaves empty canvas at a scale below 1');
  await dragTo(zoomed.from, zoomed.to, CTRL | ALT);
  const zoomBox = await run(() => parseFloat(document.querySelector('.canvas-create').style.width));
  check(Math.abs(zoomBox - Math.abs(zoomed.to.x - zoomed.from.x)) < 0.6, 'The box stays in screen pixels while zoomed out');
  await releaseAt(zoomed.to, CTRL | ALT);
  await click(await item('Add card'));
  await sleep(400);
  const zoomNode = (await data()).nodes.find(n => n.id !== 'a' && n.id !== 'b');
  const zoomExpected = snapBox(zoomed.a, zoomed.b, 0);
  check(same(zoomNode, zoomExpected) && zoomExpected.width > Math.abs(zoomed.to.x - zoomed.from.x) + 5, 'The item takes the box in board units, which are larger than its screen width');
  await undo();
  await click('[aria-label="Reset zoom"]');
  await sleep(80);

  const cover = await run(() => {
    const view = document.querySelector('.canvas-view').getBoundingClientRect();
    const a = document.querySelector('[data-node-id="a"]').getBoundingClientRect();
    const b = document.querySelector('[data-node-id="b"]').getBoundingClientRect();
    const from = { x: Math.round(a.left - 20), y: Math.round(Math.max(view.top + 8, a.top - 16)) };
    const to = { x: Math.round(a.right - 8), y: Math.round(a.bottom - 8) };
    const onView = p => p.x > view.left + 2 && p.y > view.top + 2 && p.x < view.right - 2 && p.y < view.bottom - 2;
    const hits = (card, p, q) => p.x < card.right && q.x > card.left && p.y < card.bottom && q.y > card.top;
    return { from, to, ok: onView(from) && onView(to) && hits(a, from, to) && !hits(b, from, to) };
  });
  check(cover.ok, 'A plain marquee can cover card A without card B');
  await dragTo(cover.from, cover.to, 0);
  await releaseAt(cover.to, 0);
  check(await run(() => !document.querySelector('.canvas-create-menu') && !document.querySelector('.canvas-create')
    && document.querySelector('[data-node-id="a"]').classList.contains('is-selected')
    && !document.querySelector('[data-node-id="b"]').classList.contains('is-selected')), 'Plain drag still selects and does not open the create menu');
  check((await data()).nodes.length === 2, 'Plain drag adds no card');

  await click('[aria-label="Canvas settings"]');
  await click(await item('Read-only'));
  await sleep(200);
  check(await run(() => document.querySelector('.canvas-view').classList.contains('is-readonly')), 'The canvas is read-only');
  await dragTo(cover.from, cover.to, CTRL);
  await releaseAt(cover.to, CTRL);
  check(await run(() => !document.querySelector('.canvas-create-menu') && !document.querySelector('.canvas-create')
    && document.querySelector('[data-node-id="a"]').classList.contains('is-selected')
    && !document.querySelector('[data-node-id="b"]').classList.contains('is-selected')), 'Read-only Ctrl+drag selects as a plain drag');
  check((await data()).nodes.length === 2, 'Read-only Ctrl+drag adds no card');

  await run(async () => {
    const nodes = Array.from({ length: 1000 }, (_, i) => ({
      id: 'n' + i, type: 'link', x: (i % 40) * 30, y: Math.floor(i / 40) * 24, width: 28, height: 22, url: 'https://example.com/n' + i,
    }));
    const { api } = await import('/src/api.ts');
    await api.createNote('Many.canvas', JSON.stringify({ nodes, edges: [] }));
    await ws.vault.refreshFiles();
    await ws.open('Many.canvas');
  });
  for (let i = 0; i < 40 && await run(() => document.querySelectorAll('.canvas-node').length) < 1000; i++) await sleep(100);
  check(await run(() => document.querySelectorAll('.canvas-node').length === 1000), 'A 1,000-card canvas opened');
  const center = await run(() => {
    const r = document.querySelector('.canvas-view').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  for (let i = 0; i < 8; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...center, deltaX: 0, deltaY: 400, modifiers: 0 });
    await sleep(20);
  }
  await sleep(80);
  const many = await findDrag(140, 90);
  check(many, 'The 1,000-card canvas has empty space to drag in');
  await run(() => {
    window.createReads = 0;
    window.createDom = 0;
    const orig = Element.prototype.getBoundingClientRect;
    window.createRect = orig;
    Element.prototype.getBoundingClientRect = function () { window.createReads++; return orig.call(this); };
    window.createObserver = new MutationObserver(records => { window.createDom += records.length; });
    window.createObserver.observe(document.querySelector('.canvas-world'), { subtree: true, attributes: true, childList: true });
    window.createFrames = [];
    window.createRecording = true;
    let last = performance.now();
    const tick = now => {
      if (!createRecording) return;
      createFrames.push(now - last);
      last = now;
      window.createFrameId = requestAnimationFrame(tick);
    };
    window.createFrameId = requestAnimationFrame(tick);
  });
  await move(many.from);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...many.from, button: 'left', buttons: 1, clickCount: 1, modifiers: CTRL });
  await sleep(40);
  await run(() => { createReads = 0; createDom = 0; createFrames = []; });
  for (let i = 1; i <= 24; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: many.from.x + (many.to.x - many.from.x) * i / 24, y: many.from.y + (many.to.y - many.from.y) * i / 24,
      buttons: 1, modifiers: CTRL,
    });
    await sleep(16);
  }
  await sleep(40);
  const perf = await run(() => {
    createRecording = false;
    cancelAnimationFrame(createFrameId);
    createObserver.disconnect();
    Element.prototype.getBoundingClientRect = createRect;
    const frames = createFrames.slice(2);
    return { reads: createReads, dom: createDom, samples: frames.length, max: frames.length ? Math.max(...frames) : 0 };
  });
  console.log('FRAMES', 'create-1000', JSON.stringify(perf));
  check(perf.reads === 0 && perf.dom === 0, `1,000-card create drag does not read card layout (${perf.reads} reads, ${perf.dom} mutations)`);
  check(perf.samples > 15 && perf.max < 20, `1,000-card create drag stays under 20ms (max ${perf.max.toFixed(1)}ms, ${perf.samples} intervals)`);
  await releaseAt(many.to, CTRL);
  await press('Escape');
}, { height: 800 });
