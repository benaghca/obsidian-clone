// Real-pointer checks for the tab/header chrome and bounded inline titles.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({ send, run, click, press, chord, check }) => {
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
});
