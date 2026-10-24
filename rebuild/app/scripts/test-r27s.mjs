// Round 27s: search dot, explorer ring, empty [[# , link anchor, unclosed link, delete dialog.
// Headless Chromium at 1280×800, real pointer and keyboard, scratch vault.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ send, run, move, click, press, chord, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 80; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const row = (path) => `.nav-files .tree-item-self[data-path=${JSON.stringify(path)}]`;
  const focused = () => run(() => document.querySelector('.nav-files > .nav-files-container .tree-item-self.is-focused')?.dataset.path ?? '');

  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('R27sPlain.md', 'Plain line.\n');
    await api.createNote('R27sTaken.md', 'Taken.\n');
    await api.createFolder('R27qDir');
    for (const name of ['A', 'B', 'C', 'D']) await api.createNote(`R27qDir/R27q${name}.md`, name);
    await api.createNote('R27qAlias.md', '---\naliases:\n  - Zephyr\n---\n# Alias note\n');
    await api.createNote('R27sTarget.md', 'Target.\n');
    await api.createNote('R27sFrom.md', '[[R27sTarget]] and [[R27sTarget]]\n');
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    await ws.open('R27qDir/R27qA.md');
  });

  await run(() => grove.run('global-search:open'));
  await click(await run(() => {
    const r = document.querySelector('.search-view input').getBoundingClientRect();
    return { x: r.x + 24, y: r.y + r.height / 2 };
  }));
  await send('Input.insertText', { text: 'Text' });
  await wait(async () => (await run(() => document.querySelector('.search-results-count-label')?.textContent ?? '')).includes('result'), 'the search count did not appear');
  const search = await run(() => {
    const count = document.querySelector('.search-results-result-count').getBoundingClientRect();
    const label = document.querySelector('.search-results-count-label').getBoundingClientRect();
    const dot = document.querySelector('.search-more-options');
    const dr = dot.getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector('.search-results-result-count'));
    return {
      w: count.width, pad: cs.padding, gap: dr.x - label.right,
      dot: [dr.width, dr.height, dr.x], bg: getComputedStyle(dot).backgroundColor, radius: getComputedStyle(dot).borderRadius,
    };
  });
  console.log(`MEASURE count w=${search.w.toFixed(1)} gap=${search.gap.toFixed(1)} dot x=${search.dot[2].toFixed(1)} pad=${search.pad}`);
  check(Math.abs(search.gap - 6) < 1 && search.pad === '4px 6px' && Math.abs(search.dot[0] - 11) < 1 && search.bg === 'rgb(92, 92, 92)' && search.radius === '50%', `the count dot is an 11px circle 6px after the label (${search.gap.toFixed(1)}, ${search.w.toFixed(1)})`);

  await run(() => grove.run('file-explorer:open'));
  await sleep(40);
  check(await focused() === '', 'Show file explorer draws no ring');
  await press('ArrowDown');
  check(await focused() === 'R27qDir/R27qA.md', 'the first ArrowDown rings the active file');
  const spot = await run(() => {
    const r = document.querySelector('.nav-file-title[data-path="R27sPlain.md"]').getBoundingClientRect();
    return { x: r.x + 36, y: r.y + r.height / 2 };
  });
  await click(spot);
  await sleep(80);
  check(await focused() === '' && await run(() => ws.active.path === 'R27sPlain.md'), 'a click opens the file and leaves no ring');

  await run(() => { ws.setMode('live'); ws.view.focus(); });
  const typeAtEnd = async (text) => {
    await click(await run(() => {
      const pos = ws.view.state.doc.length;
      ws.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      ws.view.focus();
      const r = ws.view.coordsAtPos(pos);
      return { x: Math.min(1100, r.left + 8), y: (r.top + r.bottom) / 2 };
    }));
    await send('Input.insertText', { text });
  };
  await typeAtEnd('\n[[#');
  await wait(async () => (await run(() => document.querySelector('.cm-link-suggest li.is-empty')?.textContent ?? '')) === 'Heading', '[[# in a note with no headings did not open');
  await sleep(60);
  const empty = await run(() => {
    const box = document.querySelector('.cm-tooltip.cm-link-suggest').getBoundingClientRect();
    const item = document.querySelector('.cm-link-suggest li.is-empty');
    const at = ws.view.state.doc.toString().lastIndexOf('[[');
    const bracket = ws.view.coordsAtPos(at);
    const after = ws.view.coordsAtPos(at + 2);
    return {
      w: box.width, h: box.height, boxX: box.x, bracketX: bracket.left, afterX: after.left,
      color: getComputedStyle(item).color, text: document.querySelector('.cm-tooltip.cm-link-suggest').innerText,
      after: getComputedStyle(document.querySelector('.cm-tooltip.cm-link-suggest'), '::after').content,
    };
  });
  console.log(`MEASURE empty [[# ${empty.w.toFixed(1)}×${empty.h.toFixed(1)} Δ${(empty.boxX - empty.bracketX).toFixed(1)} ${empty.color} ${empty.after}`);
  check(Math.abs(empty.w - 94) < 12 && Math.abs(empty.h - 78) < 4 && empty.color === 'rgb(171, 171, 171)' && empty.text.includes('Heading') && empty.after.includes('to accept'), `an empty heading list is a small muted popup (${empty.w.toFixed(1)}×${empty.h.toFixed(1)})`);
  check(empty.boxX + 1 >= empty.bracketX && Math.abs(empty.boxX - empty.afterX) < 4, `the empty popup starts at the end of [[ (Δ${(empty.boxX - empty.bracketX).toFixed(1)})`);
  await press('Escape');

  await run(async () => { await ws.open('R27sPlain.md'); ws.setMode('live'); });
  await typeAtEnd('\n[[Zep');
  await wait(async () => (await run(() => !!document.querySelector('.cm-link-suggest li.mod-link-alias'))), '[[Zep did not suggest the alias');
  await sleep(80);
  const zep = await run(() => {
    const box = document.querySelector('.cm-tooltip.cm-link-suggest').getBoundingClientRect();
    const at = ws.view.state.doc.toString().lastIndexOf('[[');
    const bracket = ws.view.coordsAtPos(at);
    const after = ws.view.coordsAtPos(at + 2);
    const line = [...document.querySelectorAll('.cm-line')].find((el) => el.textContent.includes('[[Zep'));
    const spans = [...line.querySelectorAll('span')].filter((el) => el.textContent === '[[' || el.textContent === 'Zep').map((el) => ({
      t: el.textContent, cls: el.className, color: getComputedStyle(el).color, opacity: getComputedStyle(el).opacity,
    }));
    return { w: box.width, h: box.height, boxX: box.x, bracketX: bracket.left, afterX: after.left, spans };
  });
  console.log(`MEASURE [[Zep ${zep.w.toFixed(1)}×${zep.h.toFixed(1)} Δ${(zep.boxX - zep.bracketX).toFixed(1)} ${JSON.stringify(zep.spans)}`);
  check(Math.abs(zep.h - 93.7) < 4 && zep.w > 380 && zep.w < 480 && Math.abs(zep.boxX - zep.afterX) < 4, `the alias popup is about 94px tall and starts after [[ (${zep.w.toFixed(1)}×${zep.h.toFixed(1)}, Δ${(zep.boxX - zep.bracketX).toFixed(1)})`);
  const brackets = zep.spans.find((s) => s.t === '[[');
  const word = zep.spans.find((s) => s.t === 'Zep');
  check(!!brackets && brackets.cls.includes('cm-formatting') && brackets.color === 'rgb(171, 171, 171)' && !!word && word.cls.includes('cm-wikilink') && word.opacity === '1' && word.color !== 'rgb(34, 34, 34)', 'an unclosed [[ is styled while it is typed');
  await press('Escape');

  await run(async () => { await ws.open('R27qDir/R27qA.md'); grove.run('file-explorer:open'); });
  await sleep(30);
  await press('ArrowDown');
  check(await focused() === 'R27qDir/R27qA.md', 'Show file explorer parks on the active file again');
  await press('ArrowDown');
  check(await focused() === 'R27qDir/R27qB.md', 'the next ArrowDown moves onto R27qB');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  await wait(async () => (await run(() => !!document.querySelector('.modal.mod-confirm'))), 'Delete did not ask');
  const dialog = await run(() => {
    const modal = document.querySelector('.modal.mod-confirm');
    const s = getComputedStyle(modal);
    const title = modal.querySelector('.modal-title');
    const tr = title.getBoundingClientRect();
    const ps = [...modal.querySelectorAll('.modal-content p')];
    const pr = ps.map((p) => p.getBoundingClientRect());
    const box = modal.querySelector('.modal-checkbox input').getBoundingClientRect();
    const button = modal.querySelector('.modal-button-container button');
    const br = button.getBoundingClientRect();
    const bs = getComputedStyle(button);
    const ps0 = getComputedStyle(ps[0]);
    return {
      w: modal.getBoundingClientRect().width, pad: s.padding,
      title: [getComputedStyle(title).fontSize, getComputedStyle(title).fontWeight],
      body: ps0.fontSize, pitch: pr.length > 1 ? pr[1].y - pr[0].y : 0, titleToBody: pr[0].y - tr.y,
      check: [box.width, box.height], button: [br.width, br.height, bs.padding],
    };
  });
  console.log(`MEASURE dialog ${dialog.w} pad ${dialog.pad} title ${dialog.title.join('/')} body ${dialog.body} pitch ${dialog.pitch.toFixed(1)} gap ${dialog.titleToBody.toFixed(1)} check ${dialog.check.join('x')} button ${dialog.button[0].toFixed(1)}x${dialog.button[1].toFixed(1)} ${dialog.button[2]}`);
  check(Math.abs(dialog.w - 560) < 1 && dialog.pad === '16px', `the delete dialog is 560px with 16px padding (${dialog.w}, ${dialog.pad})`);
  check(dialog.title[0] === '15px' && dialog.title[1] === '600' && dialog.body === '15px' && Math.abs(dialog.pitch - 34.5) < 1.5 && Math.abs(dialog.titleToBody - 45.75) < 2, `delete type matches Obsidian (${dialog.title.join('/')} body ${dialog.body}, pitch ${dialog.pitch.toFixed(1)}, gap ${dialog.titleToBody.toFixed(1)})`);
  check(Math.abs(dialog.check[0] - 15) < 1 && Math.abs(dialog.check[1] - 15) < 1 && dialog.button[2] === '4px 12px' && Math.abs(dialog.button[1] - 30) < 1, `the checkbox is 15px and the buttons use 4px 12px (${dialog.check.join('x')}, ${dialog.button[2]})`);
  await press('Escape');

  await run(() => ws.open('R27sPlain.md'));
  await click(await run(() => {
    const r = document.querySelector('.inline-title').getBoundingClientRect();
    return { x: r.right - 8, y: r.y + r.height / 2 };
  }));
  await send('Input.insertText', { text: ':' });
  await sleep(40);
  check(await run(() => (document.querySelector('.inline-title + .rename-error')?.textContent ?? '').includes('cannot contain')), 'an illegal character is reported while the title is typed');
  await press('Escape');
  await click(await run(() => {
    const r = document.querySelector('.inline-title').getBoundingClientRect();
    return { x: r.right - 8, y: r.y + r.height / 2 };
  }));
  await chord('a');
  await send('Input.insertText', { text: 'R27sTaken' });
  await sleep(40);
  check(await run(() => (document.querySelector('.inline-title + .rename-error')?.textContent ?? '').includes('same name')), 'a duplicate title is reported while it is typed');
  await press('Escape');

  await run(() => ws.open('R27sTarget.md'));
  await sleep(80);
  check(await run(() => document.querySelector('[aria-label="Show backlinks"]').textContent) === '2 backlinks', 'the status bar counts each link, not each file');
}, { height: 800 });
