// Real-pointer checks for the tab/header chrome and bounded inline titles.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({ send, run, click, press, chord, point, move, check }) => {
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createFolder('00 - System');
    await api.createNote('00 - System/How this vault works.md', '---\ntags: [geometry]\n---\nA paragraph.\n# HeadingOne\nSection one.');
    await ws.vault.refreshFiles();
    await ws.open('00 - System/How this vault works.md');
  });
  const folder = '.nav-files [data-path="00 - System"]';
  await click(folder);
  await click('.nav-files [aria-label="Auto-reveal current file"]');
  check(await run(() => !!document.querySelector('.nav-files [data-path="00 - System/How this vault works.md"]') && document.querySelector('[aria-label="Auto-reveal current file"]').getAttribute('aria-pressed') === 'true'), 'Auto-reveal button reveals the active note');
  await click('.nav-files [aria-label="Auto-reveal current file"]');
  await click(folder); await sleep(250);
  await run(async () => { await ws.open('Welcome.md'); await ws.open('00 - System/How this vault works.md'); });
  check(await run(() => !document.querySelector('.nav-files [data-path="00 - System/How this vault works.md"]')), 'Auto-reveal can be turned off');
  for (const width of [1280, 900, 600]) for (const mode of ['live', 'source', 'reading']) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await run(mode => ws.setMode(mode), mode); await sleep(200);
    const m = await run(() => {
      const pane = ws.view.dom.closest('.workspace-tabs');
      const box = selector => pane.querySelector(selector).getBoundingClientRect().toJSON();
      const title = pane.querySelector('.inline-title');
      return { title: box('.inline-title'), content: box('.cm-content'), view: box('.view-content'), tab: box('.workspace-tab-header.is-active'), crumb: box('.view-header-title-container'), nav: box('.view-header-nav-buttons'), actions: box('.view-actions'), text: pane.querySelector('.view-header-title-container').innerText, font: getComputedStyle(title).fontSize, weight: getComputedStyle(title).fontWeight, overflow: pane.querySelector('.view-content').scrollWidth - pane.querySelector('.view-content').clientWidth };
    });
    assert.equal(m.text.replace(/\s+/g, ''), '00-System/Howthisvaultworks');
    assert.ok(m.crumb.left >= m.nav.right && m.crumb.right <= m.actions.left);
    assert.ok(Math.abs(m.title.left - m.content.left) <= 1 && m.title.right <= m.view.right && m.title.left >= m.view.left);
    assert.ok(m.overflow <= 1 && m.tab.height === 34 && Math.abs(parseFloat(m.font) - 25.888) < .1 && m.weight === '700', JSON.stringify(m));
    check(true, `${width}px ${mode}: breadcrumb beside arrows; 34px tab; 25.9px bold title aligned with text and inside pane`);
    // Rename field stays in its column as it grows, including a long unbroken name.
    await click('.inline-title'); await chord('a');
    await send('Input.insertText', { text: 'Long title '.repeat(12) + 'x'.repeat(80) });
    check(await run(() => {
      const title = document.querySelector('.inline-title'), r = title.getBoundingClientRect(), content = title.closest('.view-content');
      return r.left >= content.getBoundingClientRect().left && r.right <= content.getBoundingClientRect().right && content.scrollWidth <= content.clientWidth + 1;
    }), `${width}px ${mode}: long rename wraps without horizontal clipping`);
    await press('Escape');
  }
  await click('.view-header-title-container'); await sleep(80);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await run(async () => {
    const { api } = await import('/src/api.ts');
    for (const name of ['Current', 'Background']) await api.createNote(`Tab${name}.md`, '---\ntags: [geometry]\n---\n# Heading\nA paragraph.');
    await ws.vault.refreshFiles();
    await ws.open('TabCurrent.md'); window.currentTab = ws.active;
    await ws.open('TabBackground.md', { where: 'tab' }); window.backgroundTab = ws.active;
  });
  const current = '.workspace-tab-header[aria-label="TabCurrent.md"]';
  const background = '.workspace-tab-header[aria-label="TabBackground.md"]';
  const mouse = async (type, p) => send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 });
  for (const mode of ['live', 'source', 'reading']) {
    await run(mode => { ws.setMode(mode, currentTab); ws.setMode(mode, backgroundTab); ws.activate(currentTab); }, mode); await sleep(200);
    const from = await point(background);
    await move(from);
    check(await run(() => ws.active === currentTab), `${mode}: hovering the background tab keeps the current note`);
    await mouse('mousePressed', from);
    check(await run(() => ws.active === currentTab), `${mode}: pressing the background tab does not switch notes`);
    await mouse('mouseReleased', from); await sleep(80);
    check(await run(() => ws.active === backgroundTab), `${mode}: pointer up without dragging activates the clicked tab`);
    // Repeated clicks at the same coordinates, with no mouse move between them.
    for (let i = 0; i < 2; i++) { await mouse('mousePressed', from); await mouse('mouseReleased', from); }
    check(await run(() => ws.active === backgroundTab && !document.querySelector('.drag-ghost')), `${mode}: stationary repeated tab clicks stay active without starting a drag`);
    await click(current);
    const end = await point(current);
    end.x -= 25;
    await move(from); await mouse('mousePressed', from);
    for (let i = 1; i <= 8; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (end.x - from.x) * i / 8, y: from.y, button: 'left', buttons: 1 }); await sleep(16);
    }
    check(await run(() => ws.active === currentTab && !!document.querySelector('.drag-ghost')), `${mode}: dragging a background tab keeps the current note visible`);
    await mouse('mouseReleased', end); await sleep(250);
    check(await run(() => ws.active === currentTab && ws.tabs.indexOf(backgroundTab) < ws.tabs.indexOf(currentTab)), `${mode}: reordering a background tab preserves the source pane's current note`);
    // A second drag splits off the background tab, still leaving the source on Current.
    const start = await point(background);
    const edge = await run(() => { const r = ws.view.dom.closest('.workspace-tabs').getBoundingClientRect(); return { x: r.right - 20, y: r.top + r.height / 2 }; });
    await move(start); await mouse('mousePressed', start);
    for (let i = 1; i <= 8; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (edge.x - start.x) * i / 8, y: start.y + (edge.y - start.y) * i / 8, button: 'left', buttons: 1 }); await sleep(16);
    }
    check(await run(() => ws.active === currentTab), `${mode}: the source stays on Current before a split drop`);
    await mouse('mouseReleased', edge); await sleep(250);
    check(await run(() => ws.groupOf(currentTab).active === currentTab && ws.groupOf(backgroundTab) !== ws.groupOf(currentTab) && ws.groupOf(backgroundTab).active === backgroundTab), `${mode}: split drop leaves the source pane's active tab unchanged`);
    await run(() => { ws.moveTab(backgroundTab, ws.groupOf(currentTab), ws.groupOf(currentTab).tabs.length); ws.activate(currentTab); }); await sleep(250);
  }

  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Scrollbar.md', '---\ntags: [geometry]\n---\n' + 'A long scrollable paragraph.\n'.repeat(300));
    for (let i = 0; i < 200; i++) await api.createNote(`Scrollbar${i}.md`, 'Scroll fixture');
    await ws.vault.refreshFiles(); await ws.open('Scrollbar.md');
  });
  for (const mode of ['live', 'source', 'reading']) {
    await run(mode => ws.setMode(mode), mode); await sleep(150);
    for (const selector of ['.workspace-leaf > .view-content:not([hidden])', '.nav-files .nav-files-container']) {
      const track = await run(selector => {
        const el = document.querySelector(selector); el.scrollTop = 0;
        const r = el.getBoundingClientRect(), bar = getComputedStyle(el, '::-webkit-scrollbar'), thumb = getComputedStyle(el, '::-webkit-scrollbar-thumb');
        return { x: r.right - 6, y: r.top + r.height * .75, top: r.top, width: bar.width, height: bar.height, border: thumb.borderTopWidth, radius: thumb.borderRadius, clip: thumb.backgroundClip, buttons: getComputedStyle(el, '::-webkit-scrollbar-button').display, gutter: el.offsetWidth - el.clientWidth };
      }, selector);
      assert.equal(track.width, '12px'); assert.equal(track.height, '12px');
      assert.equal(track.border, '3px'); assert.equal(track.radius, '12px'); assert.equal(track.clip, 'padding-box');
      assert.equal(track.buttons, 'none'); assert.equal(track.gutter, 12);
      await move({ x: track.x, y: track.top + 10 });
      check(true, `${mode} ${selector}: hover on a 6px painted thumb inside a 12px gutter, with no arrow buttons`);
      await move({ x: track.x, y: track.y });
      await mouse('mousePressed', { x: track.x, y: track.y }); await mouse('mouseReleased', { x: track.x, y: track.y }); await sleep(250);
      const first = await run(selector => document.querySelector(selector).scrollTop, selector);
      // No move before the second native track click.
      await mouse('mousePressed', { x: track.x, y: track.y }); await mouse('mouseReleased', { x: track.x, y: track.y }); await sleep(250);
      check(first > 0 && await run((selector, first) => document.querySelector(selector).scrollTop > first, selector, first), `${mode} ${selector}: repeated stationary scrollbar clicks scroll both times`);
    }
  }

});
