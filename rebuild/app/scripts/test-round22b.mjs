// Round 22: native input on scratch notes with frontmatter, in every view mode.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({ send, run, click, move, point, press, chord, check }) => {
  const fm = '---\ntags: [r22]\n---\n\n';
  await run(async fm => {
    const { api } = await import('/src/api.ts');
    for (const [path, body] of Object.entries({
      'Links22.md': 'A paragraph.\n\n', 'RecentAlpha22.md': 'Alpha', 'RecentZulu22.md': 'Zulu',
      'Projects/Plan22.md': 'Plan', 'Excluded22.md': 'Hidden',
      'Index22.md': '[[Uncreated22]]\n[[uncreated22]]\n[[Projects/Uncreated22]]',
    })) await api.createNote(path, fm + body);
    await ws.vault.refreshFiles(); await ws.vault.refreshLinks();
    ws.vault.isExcluded = path => path === 'Excluded22.md';
  }, fm);
  const row = path => `.nav-files [data-path=${JSON.stringify(path)}]`;
  const doc = () => run(() => ws.view.state.doc.toString());
  const options = () => run(() => [...document.querySelectorAll('.cm-link-suggest .cm-completionLabel')].map(el => el.textContent));
  const reset = async mode => {
    await run((mode, fm) => {
      ws.setMode(mode);
      if (mode !== 'reading') ws.view.dispatch({ changes: { from: fm.length, to: ws.view.state.doc.length, insert: 'A paragraph.\n\n' } });
      ws.view.dispatch({ selection: { anchor: ws.view.state.doc.length } });
    }, mode, fm);
    await sleep(150);
    const p = await run(() => { const r = ws.view.coordsAtPos(ws.view.state.doc.length); return { x: r.left + 1, y: (r.top + r.bottom) / 2 }; });
    await click(p);
  };
  const complete = async query => { await send('Input.insertText', { text: '[[' + query }); await sleep(250); };
  for (const mode of ['live', 'source', 'reading']) {
    for (const path of ['RecentAlpha22.md', 'RecentZulu22.md', 'Links22.md']) await click(row(path));
    await reset(mode);
    const before = await doc(); await complete('');
    if (mode === 'reading') {
      check(await doc() === before && (await options()).length === 0, 'Reading rejects link insertion and does not open suggestions');
      continue;
    }
    assert.deepEqual((await options()).slice(0, 3), ['Links22', 'RecentZulu22', 'RecentAlpha22']);
    check(true, `${mode}: link suggestions reuse the actual recently opened file order`);
    const all = await options();
    check(all.includes('photo.png') && all.includes('diagram.svg') && !all.includes('Excluded22'), `${mode}: attachments included, excluded files omitted`);
    check(all.filter(name => name.toLowerCase() === 'uncreated22').length === 1 && all.includes('Projects/Uncreated22'), `${mode}: unresolved targets included and deduplicated`);
    check(await run(() => [...document.querySelectorAll('.cm-link-suggest li')].some(el => el.querySelector('.cm-completionLabel')?.textContent === 'Plan22' && el.querySelector('.cm-completionDetail')?.textContent === 'Projects/')), `${mode}: folder details end in a slash`);
    check(await run(() => {
      const popup = document.querySelector('.cm-link-suggest'), s = getComputedStyle(popup, '::after');
      const ctx = document.createElement('canvas').getContext('2d'); ctx.font = s.font;
      return s.whiteSpace === 'nowrap' && ctx.measureText(s.content.slice(1, -1)).width + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight) <= popup.clientWidth;
    }), `${mode}: the complete heading/block/display-text hint fits on one line`);
    await send('Input.insertText', { text: 'photo.png' }); await sleep(150);
    assert.deepEqual(await options(), ['photo.png']);
    const p = await point('.cm-link-suggest li'); await click(p);
    check((await doc()).endsWith('[[photo.png]]'), `${mode}: native attachment choice inserts a valid link`);
    const completed = await doc();
    // Two more clicks without moving the pointer after the choice closes the popup.
    for (let i = 0; i < 2; i++) for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 });
    check(await doc() === completed, `${mode}: stationary repeated clicks do not insert the completion again`);
    await reset(mode); await complete('Uncreated22');
    await move(await point('.cm-link-suggest li')); await click('.cm-link-suggest li');
    check((await doc()).endsWith('[[Uncreated22]]'), `${mode}: native unresolved choice keeps its target`);
    await reset(mode); await complete('diagram.svg'); await press('Enter');
    check((await doc()).endsWith('[[diagram.svg]]'), `${mode}: SVG completion also works from the keyboard`);
  }
  const repeated = async p => {
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 });
    await sleep(60);
  };
  const hoverTip = async (selector, label) => {
    await move({ x: 800, y: 780 });
    await move(await point(selector)); await sleep(100);
    check(await run(() => !document.querySelector('.tooltip')), label + ': tooltip waits before appearing');
    await sleep(500);
    const tip = await run(selector => {
      const owner = document.querySelector(selector), el = document.querySelector('.tooltip');
      if (!el) return null;
      const style = getComputedStyle(el), arrow = getComputedStyle(el, '::before');
      return { text: el.textContent, label: owner.getAttribute('aria-label'), title: owner.hasAttribute('title'), box: el.getBoundingClientRect().toJSON(), owner: owner.getBoundingClientRect().toJSON(),
        side: el.classList.contains('mod-right'), animation: style.animationName, transition: style.transitionDuration, arrow: arrow.borderBottomWidth, pointer: style.pointerEvents };
    }, selector);
    assert.ok(tip && tip.text === tip.label && !tip.title, label + ': ARIA text replaces the native title');
    assert.ok(tip.box.left >= 8 && tip.box.right <= 1272 && tip.box.top >= 8 && tip.box.bottom <= 992);
    assert.equal(tip.animation, 'none'); assert.equal(tip.transition, '0s'); assert.equal(tip.arrow, '5px'); assert.equal(tip.pointer, 'none');
    assert.ok(tip.side ? tip.box.left >= tip.owner.right : tip.box.top >= tip.owner.bottom);
    check(true, label + ': styled tooltip and arrow, inside viewport, without motion');
    return point(selector);
  };
  for (const mode of ['live', 'source', 'reading']) {
    await run(mode => ws.setMode(mode), mode); await sleep(100);
    const ribbon = '.side-dock-ribbon-action[aria-label="Open quick switcher"]';
    const p = await hoverTip(ribbon, mode + ' ribbon'); await click(p);
    check(await run(() => !!document.querySelector('.prompt') && !document.querySelector('.tooltip')), mode + ': ribbon click dismisses tooltip and opens switcher');
    await press('Escape'); await repeated(p);
    check(await run(() => !!document.querySelector('.prompt') && !document.querySelector('.tooltip')), mode + ': stationary repeated ribbon click opens switcher again');
    await press('Escape');
    const toolbar = '.nav-files [aria-label="Auto-reveal current file"]';
    const before = await run(selector => document.querySelector(selector).getAttribute('aria-pressed'), toolbar);
    const t = await hoverTip(toolbar, mode + ' toolbar'); await click(t); await repeated(t);
    check(await run((selector, before) => document.querySelector(selector).getAttribute('aria-pressed') === before && !document.querySelector('.tooltip'), toolbar, before), mode + ': stationary toolbar clicks toggle twice without a stale tooltip');
    const header = '.view-actions [aria-label^="Current view:"]';
    const h = await hoverTip(header, mode + ' header'); await click(h); await repeated(h);
    check(await run(mode => ws.active.mode === (mode === 'reading' ? 'reading' : 'live') && !document.querySelector('.tooltip'), mode), mode + ': stationary header clicks change views twice and dismiss tooltip');
    if (mode !== 'reading') {
      await chord('f');
      await hoverTip('.cm-search [aria-label="Match case"].clickable-icon', mode + ' find option');
    } else await hoverTip(header, mode + ' repeated header hover');
    await press('Escape');
    check(await run(() => !document.querySelector('.tooltip')), mode + ': keyboard input dismisses tooltip');
  }

});
