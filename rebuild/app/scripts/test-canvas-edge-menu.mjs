// Edge cases for CZ4: the empty-canvas menu, Add web page, and Paste.
// Menus at the canvas corners and at the zoom caps, and clipboard text that is
// empty, huge, or only almost a URL. Product code is unchanged.
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ send, run, open, read, click, press, check }) => {
  const data = async () => JSON.parse(await read());
  const titles = () => run(() => [...document.querySelectorAll('.canvas-context-menu .menu-item-title')].map(e => e.textContent).join('|'));
  const item = async (title) => run(title => {
    const row = [...document.querySelectorAll('.menu-item')].find(el => el.querySelector('.menu-item-title')?.textContent === title);
    const r = row.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, title);
  const resources = () => run(() => ({ origin: location.origin, names: performance.getEntriesByType('resource').map(entry => entry.name) }));
  const offApp = (before, after) => after.names.filter(name => !before.names.includes(name) && !name.startsWith(before.origin));
  const look = () => run(() => {
    const world = document.querySelector('.canvas-world');
    return { out: world.classList.contains('is-zoomed-out'), scale: new DOMMatrix(getComputedStyle(world).transform).a };
  });
  const menuInfo = () => run(() => {
    const menu = document.querySelector('.canvas-context-menu');
    if (!menu) return null;
    const r = menu.getBoundingClientRect();
    return {
      count: document.querySelectorAll('.canvas-context-menu').length,
      left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
      inView: r.left >= 7 && r.top >= 7 && r.right <= innerWidth - 7 && r.bottom <= innerHeight - 7,
      unscaled: getComputedStyle(menu).transform === 'none' && Math.abs(r.width - menu.offsetWidth) < 2 && Math.abs(r.height - menu.offsetHeight) < 2,
      inCanvas: !!menu.closest('.canvas-view'),
      animations: menu.getAnimations({ subtree: true }).length,
      itemsOnScreen: [...menu.querySelectorAll('.menu-item')].every(row => {
        const box = row.getBoundingClientRect();
        return box.top >= 7 && box.bottom <= innerHeight - 7 && box.left >= 7 && box.right <= innerWidth - 7;
      }),
      items: [...menu.querySelectorAll('.menu-item')].map(row => {
        const box = row.getBoundingClientRect();
        return { title: row.querySelector('.menu-item-title')?.textContent, top: box.top, bottom: box.bottom, left: box.left, right: box.right };
      }),
    };
  });
  const spot = async (fx, fy) => {
    const point = await run((fx, fy) => {
      const view = document.querySelector('.canvas-view');
      const r = view.getBoundingClientRect();
      const x0 = fx < 0.5 ? r.left + 3 : r.right - 3;
      const y0 = fy < 0.5 ? r.top + 3 : r.bottom - 3;
      const sx = fx < 0.5 ? 6 : -6;
      const sy = fy < 0.5 ? 6 : -6;
      for (let i = 0; i < 50; i++) {
        const x = x0 + sx * i, y = y0 + sy * i;
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) break;
        const el = document.elementFromPoint(x, y);
        if (el && view.contains(el) && !el.closest('.canvas-node, [data-edge-id], .canvas-controls, .canvas-card-menu, .canvas-selection-menu, .menu, .modal-container'))
          return { x: Math.round(x), y: Math.round(y) };
      }
      return null;
    }, fx, fy);
    check(point, `empty canvas at the ${fx < 0.5 ? 'left' : 'right'} ${fy < 0.5 ? 'top' : 'bottom'}`);
    return point;
  };
  const openMenu = async (at) => {
    await click(at, 'right');
    await sleep(70);
    return menuInfo();
  };
  const ids = async () => new Set((await data()).nodes.map(node => node.id));
  const born = async (before) => (await data()).nodes.filter(node => !before.has(node.id));
  const pasteAt = async (text, at) => {
    const before = await ids();
    const bytes = await read();
    await run(text => navigator.clipboard.writeText(text), text);
    await click(at, 'right');
    await sleep(60);
    await click(await item('Paste'));
    let nodes = [];
    for (let i = 0; i < 40; i++) {
      nodes = await born(before);
      if (nodes.length && (nodes[0].text?.length === text.length || nodes[0].url)) break;
      if (i > 10 && !nodes.length && await read() === bytes) break;
      await sleep(40);
    }
    return { before, bytes, nodes };
  };
  const undoBoard = async () => {
    const at = await spot(0, 0);
    await click(at, 'right');
    await sleep(50);
    await click(await item('Undo'));
    for (let i = 0; i < 30 && (await data()).nodes.length !== 1; i++) await sleep(40);
  };
  const typeUrl = async (text) => {
    await run(() => document.querySelector('.mod-confirm input')?.focus());
    await send('Input.insertText', { text });
    const value = await run(() => document.querySelector('.mod-confirm input')?.value ?? null);
    await press('Enter');
    for (let i = 0; i < 20 && await run(() => !!document.querySelector('.mod-confirm')); i++) await sleep(20);
    return value;
  };
  const waitLink = async (before) => {
    let nodes = [];
    for (let i = 0; i < 30; i++) {
      nodes = await born(before);
      if (nodes.some(node => node.type === 'link')) return nodes;
      await sleep(40);
    }
    return nodes;
  };
  const near = (card, at, scale) => {
    const slack = 0.5 * scale + 1.25;
    return Math.abs(card.left - at.x) <= slack && Math.abs(card.top - at.y) <= slack;
  };
  // showMenu flips around the pointer and rounds to a pixel. One corner of the menu
  // stays on that pointer; a menu left at the previous corner does not.
  const anchored = (info, at) => {
    if (!info || !at) return false;
    const dx = Math.min(Math.abs(info.left - at.x), Math.abs(info.right - at.x));
    const dy = Math.min(Math.abs(info.top - at.y), Math.abs(info.bottom - at.y));
    return dx <= 2 && dy <= 2;
  };

  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await open('EdgeMenu.canvas', { nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 160, height: 70, text: 'Anchor' }], edges: [] });
  await sleep(150);
  const full = 'Add card|Add note from vault|Add media from vault|Add web page|Create group|Undo|Paste|Snap to grid|Snap to objects|Read-only';

  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const opened = [];
  for (const [fx, fy] of corners) {
    const at = await spot(fx, fy);
    const info = await openMenu(at);
    opened.push({ at, info });
    check(info && info.count === 1 && info.inView && info.unscaled && !info.inCanvas && info.animations === 0 && info.itemsOnScreen && anchored(info, at),
      `menu at canvas ${fx},${fy} stays on the pointer, on screen, unscaled, and still: ` + JSON.stringify(info && { inView: info.inView, unscaled: info.unscaled, inCanvas: info.inCanvas, animations: info.animations, box: [info.left, info.top, info.right, info.bottom], at }));
    check(await titles() === full, `menu at canvas ${fx},${fy} lists every board item`);
    await press('Escape');
  }
  const widthAt1 = opened[0].info.width;

  // A second right-click replaces the first menu. One menu, at the new corner.
  await click(opened[0].at, 'right');
  await sleep(40);
  await click(opened[3].at, 'right');
  await sleep(70);
  const replaced = await menuInfo();
  check(replaced && replaced.count === 1 && replaced.inView && anchored(replaced, opened[3].at)
      && Math.hypot(replaced.left - opened[0].info.left, replaced.top - opened[0].info.top) > 80,
    'a second corner replaces the first menu (' + JSON.stringify(replaced && { count: replaced.count, left: replaced.left, top: replaced.top, at: opened[3].at, first: { left: opened[0].info.left, top: opened[0].info.top } }) + ')');
  await press('Escape');

  // Empty and almost-empty clipboards add nothing, from a corner so placement is not the easy center.
  const corner = opened[3].at;
  let count = (await data()).nodes.length;
  for (const text of ['', '   \n\t\r  ', '\uFEFF', '\u2003\u2002', '\u00a0 \u00a0']) {
    const result = await pasteAt(text, corner);
    check(result.nodes.length === 0 && await read() === result.bytes, 'blank clipboard adds nothing: ' + JSON.stringify(text));
  }
  check((await data()).nodes.length === count, 'blank pastes leave the node count alone');

  const center = await spot(0.35, 0.55);
  const expectText = async (text, label) => {
    const result = await pasteAt(text, center);
    check(result.nodes.length === 1 && result.nodes[0].type === 'text' && result.nodes[0].text === text && result.nodes[0].width === 250 && result.nodes[0].height === 60,
      label + ' stays one 250 by 60 text card');
    check(await run(() => !document.querySelector('.canvas-node.is-editing')), label + ' does not open an editor');
    await undoBoard();
    check((await data()).nodes.length === 1, label + ' undoes back to the anchor card');
    return result.nodes[0];
  };
  const expectLink = async (text, url, label) => {
    const beforeResources = await resources();
    const result = await pasteAt(text, center);
    const afterResources = await resources();
    check(result.nodes.length === 1 && result.nodes[0].type === 'link' && result.nodes[0].url === url && result.nodes[0].width === 400 && result.nodes[0].height === 120,
      label + ' becomes a 400 by 120 link card');
    check(offApp(beforeResources, afterResources).length === 0, label + ' does not fetch (' + offApp(beforeResources, afterResources).join(' ') + ')');
    await undoBoard();
    check((await data()).nodes.length === 1, label + ' undoes back to the anchor card');
    return result.nodes[0];
  };

  await expectText('\u200b', 'a zero-width space');
  await expectText('a\u0000b', 'a null in the text');
  await expectText('idea \u{1F4A1}', 'an emoji');
  // Chromium's clipboard is UTF-8, so a lone surrogate is replaced with U+FFFD before
  // Grove's paste reads it. The card should store that replacement, still as text.
  {
    const text = 'bad \uD800 lone';
    const clip = await run(async (text) => {
      await navigator.clipboard.writeText(text);
      return [...await navigator.clipboard.readText()].map(ch => ch.codePointAt(0).toString(16));
    }, text);
    const result = await pasteAt(text, center);
    const node = result.nodes[0];
    const codes = [...(node?.text ?? '')].map(ch => ch.codePointAt(0).toString(16));
    check(clip.join(',') === '62,61,64,20,fffd,20,6c,6f,6e,65', 'the clipboard replaces a lone surrogate before paste (' + clip.join(' ') + ')');
    check(result.nodes.length === 1 && node?.type === 'text' && codes.join(',') === clip.join(',') && node.width === 250 && node.height === 60,
      'a lone surrogate is stored as the clipboard replacement, one 250 by 60 text card (' + codes.join(' ') + ')');
    check(await run(() => !document.querySelector('.canvas-node.is-editing')), 'a lone surrogate does not open an editor');
    if (result.nodes.length) await undoBoard();
    check((await data()).nodes.length === 1, 'a lone surrogate undoes back to the anchor card');
  }
  await expectText('mailto:a@b.c', 'a mailto link');
  await expectText('javascript:alert(1)', 'a javascript URL');
  await expectText('data:text/html,hi', 'a data URL');
  await expectText('http://', 'a scheme with no host');
  await expectText('https://example.com/a b', 'a URL with a space');
  await expectText('See https://example.com today', 'a URL inside a sentence');
  await expectText('https://example.com\nhttps://other.test/a', 'two URLs');
  await expectText('\nhttps://example.com\n\nmore', 'a URL with a following line');
  await expectLink('https://example.com/\u200b', 'https://example.com/\u200b', 'a URL with a zero-width space');
  await expectLink('  HTTPS://Example.COM/a/b?q=1  ', 'HTTPS://Example.COM/a/b?q=1', 'a padded mixed-case URL');
  await expectLink('\n\n  https://example.com/nested \n', 'https://example.com/nested', 'a URL wrapped only in whitespace');
  await expectLink('\u00a0https://example.com/nbsp\u00a0', 'https://example.com/nbsp', 'a URL wrapped in nbsp');
  const longUrl = 'https://example.com/' + 'a'.repeat(8000);
  await expectLink(longUrl, longUrl, 'an 8k URL');

  const huge = ('edge '.repeat(20000)).slice(0, 100000);
  const beforeHuge = await read();
  const beforeHugeResources = await resources();
  const hugeResult = await pasteAt(huge, center);
  check(hugeResult.nodes.length === 1 && hugeResult.nodes[0].type === 'text' && hugeResult.nodes[0].text === huge && hugeResult.nodes[0].text.length === 100000,
    'a 100k paste is one text card with every character');
  check(offApp(beforeHugeResources, await resources()).length === 0, 'a huge paste does not fetch');
  check(await run(() => !document.querySelector('.canvas-node.is-editing')), 'a huge paste does not open an editor');
  await undoBoard();
  check(await read() === beforeHuge, 'Undo restores the exact bytes from before the huge paste');

  // Add web page: odd strings, from the corner, and the card's top-left is the pointer.
  const pageAt = await spot(0.08, 0.82);
  count = (await data()).nodes.length;
  const refuse = async (text, label) => {
    const beforeResources = await resources();
    await click(pageAt, 'right');
    await sleep(60);
    await click(await item('Add web page'));
    await typeUrl(text);
    check(!await run(() => !!document.querySelector('.mod-confirm')) && (await data()).nodes.length === count, label + ' adds no card');
    check(offApp(beforeResources, await resources()).length === 0, label + ' does not fetch');
  };
  await refuse('', 'an empty URL');
  await refuse('   ', 'a whitespace URL');
  await refuse('https://', 'a scheme without a host');
  await refuse('https://example.com/a b', 'a URL with a space');
  await refuse('javascript:alert(1)', 'a javascript URL');
  await refuse('//example.com', 'a protocol-relative URL');
  await refuse('https://example.com\nmore', 'a URL split by a newline');

  const accept = async (text, url, label) => {
    const beforeResources = await resources();
    const before = await ids();
    await click(pageAt, 'right');
    await sleep(60);
    await click(await item('Add web page'));
    const dialog = await run(() => {
      const box = document.querySelector('.mod-confirm')?.getBoundingClientRect();
      return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom, inView: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight } : null;
    });
    check(dialog?.inView, label + ' opens the dialog on screen');
    const typed = await typeUrl(text);
    const nodes = await waitLink(before);
    const page = nodes.find(node => node.type === 'link');
    const open = await run(() => !!document.querySelector('.mod-confirm'));
    const made = nodes.length === 1 && page?.url === url && page.width === 400 && page.height === 120;
    check(made, label + ' creates one link card' + (made ? '' : ' ' + JSON.stringify({ typed, open, count: nodes.length, url: page?.url, width: page?.width, height: page?.height })));
    const box = await run(id => {
      const r = document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect();
      return { left: r.left, top: r.top };
    }, page.id);
    const scale = (await look()).scale;
    check(near(box, pageAt, scale), label + ' puts the card on the pointer (' + JSON.stringify({ box, pageAt, scale }) + ')');
    check(offApp(beforeResources, await resources()).length === 0, label + ' does not fetch');
    await undoBoard();
    check((await data()).nodes.length === 1, label + ' undoes back to the anchor card');
    return page;
  };
  await accept('  https://example.com/docs  ', 'https://example.com/docs', 'a padded web page');
  await accept('HTTPS://Example.COM/Path', 'HTTPS://Example.COM/Path', 'a mixed-case web page');
  await accept('http://127.0.0.1:9/x', 'http://127.0.0.1:9/x', 'a loopback web page');
  await accept('http://[::1]/index', 'http://[::1]/index', 'an ipv6 web page');
  await accept('https://user:secret@example.com/a', 'https://user:secret@example.com/a', 'a web page with a userinfo');
  await accept('https://example.com/' + 'b'.repeat(4000), 'https://example.com/' + 'b'.repeat(4000), 'a long web page URL');

  // Zoom caps. The menu is the same screen size, and a paste still sits on the pointer.
  await open('EdgeZoom.canvas', { nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 120, height: 60, text: 'Anchor' }], edges: [] });
  await sleep(150);
  const pivot = await run(() => {
    const r = document.querySelector('.canvas-view').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const wheelToCap = async (deltaY) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...pivot, deltaX: 0, deltaY, modifiers: 2 });
    await sleep(200);
  };

  await wheelToCap(50000);
  const minZoom = await look();
  check(minZoom.out && minZoom.scale < 0.07 && minZoom.scale > 0.06, 'the board is at the minimum zoom and in title mode (' + minZoom.scale + ')');
  const minAt = await spot(1, 1);
  const minMenu = await openMenu(minAt);
  check(minMenu && minMenu.inView && minMenu.unscaled && minMenu.animations === 0 && Math.abs(minMenu.width - widthAt1) <= 3,
    'the menu at 1/16 matches the 100% menu (' + JSON.stringify({ width: minMenu?.width, widthAt1, inView: minMenu?.inView }) + ')');
  await press('Escape');
  const minPaste = await pasteAt('Zoom paste', minAt);
  check(minPaste.nodes.length === 1 && minPaste.nodes[0].text === 'Zoom paste' && minPaste.nodes[0].type === 'text', 'paste at 1/16 writes the text card');
  const minBox = await run(id => {
    const card = document.querySelector(`[data-node-id="${id}"]`);
    const r = card.getBoundingClientRect();
    const title = card.querySelector('.canvas-node-title');
    const body = card.querySelector('.canvas-node-content');
    return {
      left: r.left, top: r.top,
      editing: card.classList.contains('is-editing'),
      title: title?.textContent ?? '',
      titleDisplay: title ? getComputedStyle(title).display : 'missing',
      band: card.dataset.titleBand ?? '',
      hidden: getComputedStyle(body).contentVisibility === 'hidden',
    };
  }, minPaste.nodes[0].id);
  // 250 by 60 at 1/16 is about 16 by 4 screen pixels, under the 50 by 26 title floor,
  // so the title band hides the label and the card is a box. The title text is still there.
  check(near(minBox, minAt, minZoom.scale) && !minBox.editing && minBox.title === 'Zoom paste' && minBox.titleDisplay === 'none' && minBox.hidden,
    'a title-mode paste at 1/16 sits on the pointer, hides its body, and is too small for a title (' + JSON.stringify({ minBox, minAt, scale: minZoom.scale }) + ')');

  const minPageAt = await spot(0, 1);
  const beforeMinPage = await resources();
  const minPageBefore = await ids();
  await click(minPageAt, 'right');
  await sleep(60);
  await click(await item('Add web page'));
  await typeUrl('http://localhost:9/grove');
  const minPage = (await waitLink(minPageBefore)).find(node => node.type === 'link');
  const minPageBox = await run(id => {
    const r = document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect();
    return { left: r.left, top: r.top };
  }, minPage.id);
  check(minPage?.url === 'http://localhost:9/grove' && minPage.width === 400 && minPage.height === 120 && near(minPageBox, minPageAt, minZoom.scale),
    'Add web page at 1/16 stores canvas-sized card on the pointer');
  check(offApp(beforeMinPage, await resources()).length === 0, 'Add web page at 1/16 does not fetch localhost');

  await click('[aria-label="Reset zoom"]');
  await sleep(40);
  await wheelToCap(-50000);
  const maxZoom = await look();
  check(!maxZoom.out && maxZoom.scale > 1.98 && maxZoom.scale < 2.02, 'the board is at the maximum zoom and showing content (' + maxZoom.scale + ')');
  const maxAt = await spot(1, 1);
  const maxMenu = await openMenu(maxAt);
  check(maxMenu && maxMenu.inView && maxMenu.unscaled && maxMenu.animations === 0 && Math.abs(maxMenu.width - widthAt1) <= 3,
    'the menu at 2x matches the 100% menu (' + JSON.stringify({ width: maxMenu?.width, widthAt1, inView: maxMenu?.inView }) + ')');
  await press('Escape');
  const maxPaste = await pasteAt('https://jsoncanvas.org/spec', maxAt);
  check(maxPaste.nodes.length === 1 && maxPaste.nodes[0].type === 'link' && maxPaste.nodes[0].url === 'https://jsoncanvas.org/spec', 'a lone URL pasted at 2x is a link card');
  const maxBox = await run(id => {
    const r = document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect();
    return { left: r.left, top: r.top };
  }, maxPaste.nodes[0].id);
  check(near(maxBox, maxAt, maxZoom.scale), 'the 2x paste sits on the pointer (' + JSON.stringify({ maxBox, maxAt, scale: maxZoom.scale }) + ')');
  const saved = await run((x, y) => {
    const view = document.querySelector('.canvas-view').getBoundingClientRect();
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform);
    return { x: Math.round((x - view.left - m.e) / m.a), y: Math.round((y - view.top - m.f) / m.a) };
  }, maxAt.x, maxAt.y);
  check(maxPaste.nodes[0].x === saved.x && maxPaste.nodes[0].y === saved.y, 'the saved top-left matches the pointer in canvas units (' + JSON.stringify({ node: maxPaste.nodes[0], saved }) + ')');
}, { height: 760 });
