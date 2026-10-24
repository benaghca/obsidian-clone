// Round 21 Part B: native input on scratch notes with frontmatter.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({ send, run, move, click, point, chord, press, fill, check }) => {
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
  await run(async () => {
    const {api} = await import('/src/api.ts');
    for (const name of ['RecentA', 'RecentB', 'RecentCurrent', 'NeverOpened']) await api.createNote(name+'.md', '---\ntags: [switcher]\n---\n\nA paragraph.');
    await ws.vault.refreshFiles();
  });
  for (const mode of ['live', 'source', 'reading']) {
    await run(async () => {await ws.open('FoldEnd.md'); ws.recent=[];});
    for (const name of ['RecentA','RecentB','RecentCurrent']) await click(`.nav-files [data-path="${name}.md"]`);
    await run(mode => ws.setMode(mode), mode); await sleep(100);
    await chord('o'); await sleep(60);
    assert.deepEqual(await run(() => [...document.querySelectorAll('.prompt .suggestion-title')].map(el=>el.textContent)), ['RecentB','RecentA']);
    check(true, `${mode}: empty switcher lists only recents, newest first, excluding current and unopened notes`);
    await move(await point('.prompt .suggestion-item:nth-child(2)'));
    await press('Tab');
    check(await run(() => document.querySelector('.prompt-input').value === 'RecentA' && document.activeElement === document.querySelector('.prompt-input') && ws.active.path === 'RecentCurrent.md'), `${mode}: Tab completes the hovered selection and keeps input focus without opening`);
    await press('Enter'); await sleep(100);
    check(await run(() => ws.active.path === 'RecentA.md'), `${mode}: Enter opens the completed note`);
    await chord('o'); await fill('.prompt-input', 'NeverOp');
    check(await run(() => document.querySelector('.prompt .suggestion-title')?.textContent === 'NeverOpened'), `${mode}: typed query still finds a note that was never opened`);
    await press('Tab');
    check(await run(() => document.querySelector('.prompt-input').value === 'NeverOpened'), `${mode}: Tab completes a fuzzy query`);
    await press('Escape');
    await run(() => {ws.recent=[];});
    await chord('o');
    check(await run(() => !document.querySelector('.prompt .suggestion-item') && !!document.querySelector('.prompt .suggestion-empty')), `${mode}: no recents gives an empty list`);
    await press('Tab');
    check(await run(() => ws.active.path === 'RecentA.md' && document.activeElement === document.querySelector('.prompt-input')), `${mode}: Tab with no selected result keeps focus and opens nothing`);
    await press('Escape');
  }

  await send('Page.bringToFront');
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  const prefix = '---\ntags: [paste]\n---\n\n', url = 'https://example.com';
  await run(async prefix => {
    const {api}=await import('/src/api.ts'); await api.createNote('URLCaret.md', prefix+'word tail');
    await ws.vault.refreshFiles(); await ws.open('URLCaret.md');
  }, prefix);
  for (const mode of ['live','source','reading']) {
    await run((mode,prefix) => {ws.setMode(mode); ws.view.dispatch({changes:{from:prefix.length,to:ws.view.state.doc.length,insert:'word tail'}});}, mode,prefix);
    await sleep(120);
    const wordEnd = await run(prefix => {const r=ws.view.coordsAtPos(prefix.length+4);return {x:r.left,y:(r.top+r.bottom)/2};},prefix);
    await click(wordEnd);
    for (let i=0;i<4;i++) await press('ArrowLeft',8);
    await run(url => navigator.clipboard.writeText(url),url);
    await chord('v'); await sleep(100);
    if (mode === 'reading') {
      check(await run(prefix=>ws.view.state.doc.toString()===prefix+'word tail',prefix), 'Reading: native URL paste remains read-only');
      continue;
    }
    const link = `[word](${url})`;
    assert.equal(await run(()=>ws.view.state.doc.toString()),prefix+`${link} tail`);
    check(await run((from, to) => {
      const sel = ws.view.state.selection.main;
      return !sel.empty && sel.from === from && sel.to === to;
    }, prefix.length, prefix.length + link.length), `${mode}: URL-over-selection selects the whole link and leaves the trailing text`);
    await send('Input.insertText',{text:'!'});
    assert.equal(await run(()=>ws.view.state.doc.toString()),prefix+'! tail');
    check(true, `${mode}: typing replaces the selected link`);
    await chord('z'); await chord('z');
    assert.equal(await run(()=>ws.view.state.doc.toString()),prefix+'word tail');
    check(true, `${mode}: typing and URL paste undo separately`);
    await run(() => navigator.clipboard.writeText('www.example.com')); await chord('v'); await sleep(100);
    const www = '[word](https://www.example.com)';
    assert.equal(await run(()=>ws.view.state.doc.toString()),prefix+`${www} tail`);
    check(await run((from, to) => {
      const sel = ws.view.state.selection.main;
      return !sel.empty && sel.from === from && sel.to === to;
    }, prefix.length, prefix.length + www.length), `${mode}: www URL normalization selects the whole link`);
  }

});
