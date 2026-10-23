// Permanent real-pointer geometry/folding and prompt/menu latency regression.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({ send, run, press, move, click, check }) => {
  await run(async () => {
    const { api } = await import('/src/api.ts');
    const body = 'A paragraph.\n# HeadingOne\nSection one.\n## HeadingTwo\nSection two.\n### HeadingThree\nSection three.';
    await api.createNote('Geometry.md', body);
    await api.createNote('GeometryFM.md', '---\ntags: [geometry]\n---\n' + body);
    await ws.vault.refreshFiles();
  });
  const geometry = async label => {
    const rows = await run(() => [...ws.view.contentDOM.children].map(el => {
      const style = getComputedStyle(el);
      const pos = ws.view.posAtDOM(el, 0);
      return { text: el.textContent, margin: [parseFloat(style.marginTop), parseFloat(style.marginBottom)], delta: el.classList.contains('cm-line') ? ws.view.documentTop + ws.view.lineBlockAt(pos).top - el.getBoundingClientRect().top : 0 };
    }));
    assert.ok(rows.length > 3, label + ' rendered lines');
    for (const row of rows) {
      assert.ok(Math.abs(row.delta) <= 1, `${label}: ${JSON.stringify(row)}`);
      assert.deepEqual(row.margin, [0, 0], `${label}: direct child vertical margins: ${row.text}`);
    }
    check(true, label + ': every line within 1px; no vertical margins');
  };
  const coords = (name, offset) => run((name, offset) => {
    const pos = ws.view.state.doc.toString().indexOf(name) + offset;
    const r = ws.view.coordsAtPos(pos);
    return { x: r.left, y: (r.top + r.bottom) / 2 };
  }, name, offset);
  for (const path of ['Geometry.md', 'GeometryFM.md']) for (const mode of ['live', 'source', 'reading']) {
    await run(async (path, mode) => { await ws.open(path); ws.setMode(mode); ws.view.dispatch({ selection: { anchor: ws.view.state.doc.length } }); }, path, mode);
    await sleep(250);
    const label = `${path} ${mode}`;
    await geometry(label);
    for (const name of ['HeadingOne', 'HeadingTwo', 'HeadingThree']) {
      await click(await coords(name, 5));
      check(await run(name => ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text.endsWith(name), name), `${label}: click ${name}`);
      await geometry(label + ' focused ' + name);
      // Begin at the text boundary, then read coordinates again after syntax reveals.
      const start = await coords(name, 0);
      await move(start);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1 });
      const end = await coords(name, name.length);
      for (let i = 1; i <= 8; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (end.x - start.x) * i / 8, y: end.y, button: 'left', buttons: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', clickCount: 1 });
      await sleep(50);
      assert.equal(await run(() => ws.view.state.sliceDoc(ws.view.state.selection.main.from, ws.view.state.selection.main.to)), name, `${label}: drag selects exactly ${name}`);
      const row = await run(name => {
        const el = [...ws.view.contentDOM.querySelectorAll('.cm-line')].find(el => el.textContent.endsWith(name));
        const r = el.getBoundingClientRect(); return { x: r.right - 4, top: r.top, bottom: r.bottom };
      }, name);
      for (const y of [row.top + 1, (row.top + row.bottom) / 2, row.bottom - 1]) {
        await move({ x: row.x, y });
        check(await run(() => !ws.view.dom.querySelector('.cm-fold-indicator.mod-hover').hidden), `${label}: fold arrow across ${name} row at ${y.toFixed(1)}`);
      }
      await move({ x: row.x, y: row.top - 4 });
      check(await run(() => ws.view.dom.querySelector('.cm-fold-indicator.mod-hover').hidden), `${label}: no arrow 4px above ${name}`);
      await move({ x: row.x, y: (row.top + row.bottom) / 2 });
      await click('.cm-fold-indicator.mod-hover:not([hidden])');
      check(await run(() => !!ws.view.dom.querySelector('.cm-foldPlaceholder')), `${label}: native arrow click folds ${name}`);
      await click('.cm-foldPlaceholder');
      await sleep(50);
    }
  }
  // Start sampling at the actual trusted input event, not at a CDP round trip.
  const monitor = async (type, selector) => run((type, selector) => {
    window.menuTiming = null;
    window.addEventListener(type, event => {
      const start = event.timeStamp; let last = start, visibleFrame = 0, frame = 0; const gaps = [];
      const tick = () => {
        const now = performance.now();
        gaps.push(now - last); last = now; frame++;
        const el = document.querySelector(selector);
        if (!visibleFrame && el && el.getBoundingClientRect().height && getComputedStyle(el).opacity === '1' && !el.getAnimations({ subtree: true }).length) visibleFrame = frame;
        if (now - start < 300) requestAnimationFrame(tick);
        else window.menuTiming = { visibleFrame, maxFrame: Math.max(...gaps) };
      };
      requestAnimationFrame(tick);
    }, { once: true, capture: true });
  }, type, selector);
  for (const path of ['Geometry.md', 'GeometryFM.md']) for (const mode of ['live', 'source', 'reading']) {
    await run(async (path, mode) => { await ws.open(path); ws.setMode(mode); }, path, mode); await sleep(200);
    const label = `${path} ${mode}`;
    for (const k of ['o', 'p']) {
      await click(await coords('HeadingOne', 5));
      // Control itself is not the opening key.
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', modifiers: 2, windowsVirtualKeyCode: 17 });
      await monitor('keydown', '.prompt');
      await press(k, 2);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', modifiers: 0, windowsVirtualKeyCode: 17 });
      await sleep(340);
      const timing = await run(() => window.menuTiming);
      assert.ok(timing.visibleFrame > 0 && timing.visibleFrame <= 2 && timing.maxFrame <= 20, `${label} Ctrl+${k}: ${JSON.stringify(timing)}`);
      check(true, `${label} Ctrl+${k}: visible within 2 frames, no frame >20ms (${timing.maxFrame.toFixed(1)}ms)`);
      await press('Escape');
    }
    await move(await coords('HeadingOne', 5));
    await monitor('contextmenu', '.menu');
    await click(await coords('HeadingOne', 5), 'right'); await sleep(340);
    const timing = await run(() => window.menuTiming);
    assert.ok(timing.visibleFrame > 0 && timing.visibleFrame <= 2 && timing.maxFrame <= 20, `${label} context menu: ${JSON.stringify(timing)}`);
    check(true, `${label} right-click menu: visible within 2 frames, no frame >20ms (${timing.maxFrame.toFixed(1)}ms)`);
    await press('Escape');
  }
  for (const origin of ['editor', 'title', 'reading']) {
    await run(origin => ws.setMode(origin === 'reading' ? 'reading' : 'live'), origin); await sleep(100);
    await click(origin === 'title' ? '.inline-title' : await coords('HeadingOne', 5));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', modifiers: 2, windowsVirtualKeyCode: 17 });
    await press('p', 2);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', modifiers: 0, windowsVirtualKeyCode: 17 });
    await send('Input.insertText', { text: 'Toggle bold' });
    const titles = await run(() => [...document.querySelectorAll('.prompt .suggestion-title')].map(el => el.textContent));
    assert.equal(titles.includes('Toggle bold'), origin === 'editor', 'lazy command checks preserve ' + origin + ' focus context');
    if (origin === 'editor') {
      await press('Enter');
      check(await run(() => ws.view.state.doc.toString().includes('**HeadingOne**')), 'a command found after typing runs in the original editor');
    } else await press('Escape');
  }

});
