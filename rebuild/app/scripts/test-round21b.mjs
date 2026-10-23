// Round 21 Part B: native input on scratch notes with frontmatter.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({ send, run, move, click, check }) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('FoldEnd.md', '---\ntags: [fold]\n---\n\n' + 'Paragraph before.\n'.repeat(160) + '## Final heading\n' + 'Final body.\n'.repeat(8));
    await ws.vault.refreshFiles();
  });
  const mouse = async p => {
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 });
    await sleep(100);
  };
  const heading = () => run(() => [...ws.view.contentDOM.querySelectorAll('.cm-line')].find(e => e.textContent.includes('Final heading')).getBoundingClientRect().top);
  for (const mode of ['live', 'source', 'reading']) {
    await run(async mode => { await ws.open('FoldEnd.md'); ws.setMode(mode); }, mode); await sleep(180);
    await run(() => { const scroller = ws.view.dom.closest('.view-content'); scroller.scrollTop = scroller.scrollHeight; }); await sleep(150);
    const before = await heading();
    const hover = await run(() => {const r=[...ws.view.contentDOM.querySelectorAll('.cm-line')].find(e=>e.textContent.includes('Final heading')).getBoundingClientRect(); return {x:r.left+100,y:r.top+r.height/2};});
    await move(hover);
    const arrow = await run(() => {const r=ws.view.dom.querySelector('.cm-fold-indicator.mod-hover').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
    await click(arrow);
    const after = await heading();
    check(await run(() => !!ws.view.dom.querySelector('.cm-foldPlaceholder')) && after > before + 100, `${mode}: folding at absolute bottom clamps scrolling, matching observed Obsidian`);
    await mouse(arrow); // Stationary second click: Obsidian also misses after clamping.
    check(await run(() => !!ws.view.dom.querySelector('.cm-foldPlaceholder')), `${mode}: stationary second bottom-fold click leaves it folded, matching Obsidian`);
    assert.ok(Math.abs(await heading() - after) <= 1);
    await click('.cm-fold-indicator.is-collapsed svg');
    check(await run(() => !ws.view.dom.querySelector('.cm-foldPlaceholder')), `${mode}: moving to the clamped arrow unfolds normally`);
    console.log('MEASURE bottom fold', mode, JSON.stringify({before,after,shift:after-before}));
  }
});
