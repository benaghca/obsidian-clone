// Piece NH: Ctrl+hover a link inside a page preview stacks another preview on top.
// Native CDP pointer and key input against the in-memory mock vault.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({ on, send, run, key, press, point, move, click, check }) => {
  const depth = 12;
  await run(async depth => {
    const { api } = await import('/src/api.ts');
    await api.createNote('NH0.md', 'Start [[NH1]] here.\n\nNothing else on this line.');
    for (let i = 1; i <= depth; i++) await api.createNote(`NH${i}.md`,
      `Lead words [[NH${i + 1}]] trailing words.\n\nA plain paragraph to rest the pointer on, long enough to wrap across the preview width.` +
      (i === 1 ? '\n\n![[NHEmbed]]' : ''));
    await api.createNote('NHEmbed.md', 'Embedded body text.');
    await ws.vault.refreshFiles(); await ws.vault.refreshLinks();
  }, depth);
  const count = () => run(() => document.querySelectorAll('.hover-popover').length);
  const titles = () => run(() => [...document.querySelectorAll('.hover-popover > .markdown-embed > .markdown-embed-title')].map(t => t.textContent));
  // hoverPreview.ts's document + window listeners, as DevTools sees them: a closed
  // chain must leave none behind. Other modules (tooltips, lazily loaded views) add their own.
  const scripts = new Map();
  on('Debugger.scriptParsed', e => scripts.set(e.scriptId, e.url));
  await send('Debugger.enable');
  const listeners = async () => {
    let n = 0;
    for (const expression of ['document', 'window']) {
      const { result } = await send('Runtime.evaluate', { expression });
      const found = (await send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners;
      n += found.filter(l => scripts.get(l.scriptId)?.endsWith('/src/shell/hoverPreview.ts')).length;
      await send('Runtime.releaseObject', { objectId: result.objectId });
    }
    return n;
  };
  // A point the nth popover shows on top (null: outside every popover and editor), off any link or embed.
  const exposed = index => run(index => {
    const all = [...document.querySelectorAll('.hover-popover')], want = index === null ? null : all.at(index);
    const box = want ? want.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let y = box.top + 4; y < box.bottom - 4; y += 6) for (let x = box.left + 4; x < box.right - 4; x += 6) {
      const el = document.elementFromPoint(x, y);
      // Labelled icons start the tooltip's own listeners; stay off them too.
      if (!el || el.closest('[data-href], [data-embed-href], [data-preview-path], .clickable-icon, .workspace-ribbon, .workspace-tab-header-container, .status-bar')) continue;
      if (want ? el.closest('.hover-popover') === want : !el.closest('.hover-popover, .cm-editor')) return { x, y };
    }
    return null;
  }, index);
  // The link to the next note inside the newest popover.
  const nextLink = i => run(i => {
    const r = [...document.querySelectorAll('.hover-popover')].at(-1).querySelector(`[data-href="NH${i}"]`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, i);
  const ctrlMove = async p => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p, modifiers: 2 }); await sleep(40); };
  // Ctrl+hover the editor link, then the next link in each new popover.
  const chain = async levels => {
    await move({ x: 640, y: 900 });
    await key('Control', 2);
    await ctrlMove(await point('.cm-content [data-href="NH1"]')); await sleep(450);
    for (let i = 2; i <= levels; i++) { await ctrlMove(await nextLink(i)); await sleep(450); }
    await key('Control', 0, 'keyUp');
  };
  for (const mode of ['live', 'reading']) {
    await run(async mode => { await ws.open('NH0.md'); ws.setMode(mode); }, mode); await sleep(150);
    if (mode === 'live') await click('.inline-title');
    const baseline = await listeners();
    await chain(3);
    check(await count() === 3, `${mode}: Ctrl+hover inside previews stacks three previews`);
    assert.ok(baseline > 0 && await listeners() > baseline, 'listener count sees the dismissal listeners');
    const seen = await titles();
    assert.equal(JSON.stringify(seen), '["NH1","NH2","NH3"]');
    check(true, `${mode}: each preview shows the note its link names`);
    check(await run(() => {
      const all = [...document.querySelectorAll('.hover-popover')].map(p => p.getBoundingClientRect());
      return all.every(r => r.width <= 450 && r.height <= 400 && r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 8 && r.bottom <= innerHeight - 8);
    }), `${mode}: nested previews keep the usual size and stay inside the window`);
    check(await run(() => {
      const [a, b] = [...document.querySelectorAll('.hover-popover')].slice(-2);
      const link = a.querySelector('[data-href="NH3"]').getBoundingClientRect(), r = b.getBoundingClientRect();
      return Math.abs(r.top - (link.bottom + 6)) < 1 || Math.abs(r.bottom - (link.top - 6)) < 1 || r.bottom >= innerHeight - 9;
    }), `${mode}: a child preview sits under (or above) the link that opened it`);
    // Plain hover inside a preview, even in Reading view, does not chain.
    await move(await nextLink(4)); await sleep(500);
    check(await count() === 3, `${mode}: a link inside a preview needs Ctrl`);
    // Ctrl over a preview's plain text does not preview the preview itself.
    await key('Control', 2); await ctrlMove(await exposed(-1)); await sleep(500); await key('Control', 0, 'keyUp');
    check(await count() === 3, `${mode}: Ctrl over preview text opens nothing`);
    // Back into the first preview: the two above it close, the first stays.
    await move(await exposed(0)); await sleep(100);
    check(await count() === 3, `${mode}: children survive a brief pass through their parent`);
    await sleep(200);
    check(await count() === 1 && (await titles())[0] === 'NH1', `${mode}: leaving children for their parent closes just them`);
    // Leaving every preview closes the chain after the usual delay.
    await chain(4);
    check(await count() === 4, `${mode}: chain reopens to depth 4`);
    await move(await exposed(null)); await sleep(100);
    check(await count() === 4, `${mode}: the chain waits out the usual delay`);
    await sleep(200);
    check(await count() === 0, `${mode}: leaving the chain closes every preview`);
    check(await listeners() === baseline, `${mode}: no dismissal listeners outlive the chain`);
    // Escape closes the whole chain at once.
    await chain(3); await press('Escape'); await sleep(50);
    check(await count() === 0 && await listeners() === baseline, `${mode}: Escape closes the whole chain`);
  }
  await run(async () => { await ws.open('NH0.md'); ws.setMode('live'); }); await sleep(150);
  await click('.inline-title');
  const baseline = await listeners();
  // A deep chain stays cheap: 12 popovers, and pointer moves over them cost little.
  await chain(depth);
  check(await count() === depth, `depth ${depth}: every level opens`);
  const cost = await run(() => {
    const top = [...document.querySelectorAll('.hover-popover')].at(-1).querySelector('.markdown-embed-content');
    const r = top.getBoundingClientRect(), t0 = performance.now();
    for (let i = 0; i < 500; i++) top.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: r.left + 10 + (i % 50), clientY: r.top + 10 }));
    return performance.now() - t0;
  });
  assert.ok(cost < 250, `500 moves over a ${depth}-deep chain took ${cost}ms`);
  check(true, `depth ${depth}: hovering over the chain stays cheap (${cost.toFixed(1)}ms per 500 moves)`);
  await move(await exposed(null)); await sleep(300);
  check(await count() === 0 && await listeners() === baseline, `depth ${depth}: the whole chain closes with nothing left`);
  // An embed inside a preview previews its own target.
  await chain(1);
  await key('Control', 2);
  await ctrlMove(await run(() => {
    const r = document.querySelector('.hover-popover [data-embed-href] .markdown-embed-content').getBoundingClientRect();
    return { x: r.x + 20, y: r.y + r.height / 2 };
  })); await sleep(450); await key('Control', 0, 'keyUp');
  check(JSON.stringify(await titles()) === '["NH1","NHEmbed"]', 'an embed inside a preview opens its own preview');
  // A wheel in the parent closes the previews above it and keeps the parent.
  const rest = await exposed(0); await move(rest);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...rest, deltaX: 0, deltaY: 60 }); await sleep(80);
  check(await count() === 1, 'a wheel in a parent closes only the previews above it');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...(await exposed(null)), deltaX: 0, deltaY: 60 }); await sleep(80);
  check(await count() === 0, 'a wheel outside closes the chain');
  // Clicking a link three levels deep opens that note and closes the chain.
  await chain(3);
  await click(await nextLink(4)); await sleep(150);
  check(await run(() => ws.active.path === 'NH4.md' && !document.querySelector('.hover-popover')), 'clicking a link in a nested preview opens it and closes the chain');
  check(await listeners() === baseline, 'no listeners remain after a click closes the chain');
}, { height: 1000 });
