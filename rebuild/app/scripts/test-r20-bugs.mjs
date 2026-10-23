// Regression for the round 20 breadcrumb bug. A long path must keep
// the current note name inside the view header. Before the fix, at 1000px
// the name's box collapsed to 0 and sat outside the header.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const path = 'VeryLongFolderNameThatOverflows/AnotherExtremelyLongFolderName/ThirdLongFolderNameHere/Short.md';

await withBrowser(async ({ send, run, move, click, check }) => {
  await run(async (path) => {
    const { api } = await import('/src/api.ts');
    await api.createFolder('VeryLongFolderNameThatOverflows');
    await api.createFolder('VeryLongFolderNameThatOverflows/AnotherExtremelyLongFolderName');
    await api.createFolder('VeryLongFolderNameThatOverflows/AnotherExtremelyLongFolderName/ThirdLongFolderNameHere');
    await api.createNote(path, '---\ntags: [geometry]\n---\n# HeadingOne\nBody.\n');
    await ws.vault.refreshFiles();
    await ws.open(path);
  }, path);
  for (const width of [600, 700, 860, 900, 1000, 1100, 1280]) for (const mode of ['live', 'source', 'reading']) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await run(mode => ws.setMode(mode), mode); await sleep(100);
    const measure = () => run(() => {
      const container = document.querySelector('.view-header-title-container');
      const box = container.getBoundingClientRect(), el = container.querySelector('.view-header-title'), r = el.getBoundingClientRect();
      return { text: el.textContent, width: r.width, left: r.left, right: r.right, boxLeft: box.left, boxRight: box.right, clipped: el.scrollWidth > el.clientWidth,
        ancestors: [...container.querySelectorAll('.view-header-breadcrumb')].map(el => ({ width: el.clientWidth, full: el.scrollWidth, overflow: getComputedStyle(el).overflowX, ellipsis: getComputedStyle(el).textOverflow })) };
    });
    const title = await measure();
    assert.equal(title.text, 'Short');
    assert.ok(title.width >= 8 && !title.clipped && title.left >= title.boxLeft && title.right <= title.boxRight + 1, `note name is clipped out of the breadcrumb: ${JSON.stringify(title)}`);
    assert.ok(title.ancestors.every(a => a.overflow === 'hidden' && a.ellipsis === 'ellipsis'));
    if (width <= 1000) assert.ok(title.ancestors.some(a => a.full > a.width), 'ancestor segments shrink before the note name');
    await move(await run(() => { const r = document.querySelector('.view-header-breadcrumb').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    const at = await run(() => { const r = document.querySelector('.view-header-title').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await click(at);
    // Repeat at the same coordinates without any intervening mouse movement.
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 });
    assert.deepEqual(await measure(), title, 'hover and stationary repeated clicks preserve breadcrumb geometry');
    check(true, `${width}px ${mode}: ancestors ellipsize first; full note name remains visible through native hover and clicks`);
  }
});
