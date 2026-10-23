// Failing regression for the round 20 breadcrumb bug. A long path must keep
// the current note name inside the view header. At 1000px the name's box
// collapses to 0 and sits outside the header.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const path = 'VeryLongFolderNameThatOverflows/AnotherExtremelyLongFolderName/ThirdLongFolderNameHere/Short.md';

await withBrowser(async ({ send, run }) => {
  await run(async (path) => {
    const { api } = await import('/src/api.ts');
    await api.createFolder('VeryLongFolderNameThatOverflows');
    await api.createFolder('VeryLongFolderNameThatOverflows/AnotherExtremelyLongFolderName');
    await api.createFolder('VeryLongFolderNameThatOverflows/AnotherExtremelyLongFolderName/ThirdLongFolderNameHere');
    await api.createNote(path, '---\ntags: [geometry]\n---\n# HeadingOne\nBody.\n');
    await ws.vault.refreshFiles();
    await ws.open(path);
  }, path);
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  const title = await run(() => {
    const container = document.querySelector('.view-header-title-container');
    const box = container.getBoundingClientRect();
    const el = container.querySelector('.view-header-title');
    const r = el.getBoundingClientRect();
    return { text: el.textContent, width: r.width, left: r.left, right: r.right, boxLeft: box.left, boxRight: box.right };
  });
  assert.equal(title.text, 'Short');
  assert.ok(
    title.width >= 8 && title.left < title.boxRight - 1 && title.right > title.boxLeft + 1 && title.right <= title.boxRight + 1,
    `note name is clipped out of the breadcrumb: ${JSON.stringify(title)}`,
  );
});
