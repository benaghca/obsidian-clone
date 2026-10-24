// Round 27r: search settings, explorer keys, delete dialog, link suggestions.
// Headless Chromium at 1280×800, real pointer and keyboard, scratch vault.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const gap = '\n'.repeat(8);
const dates = `---\nr27ndue: 2026-10-23\n---\n# Alpha\n\nText one.\n\n## Beta\n\nText two.\n\n### Gamma\n\nText three.\n\n## Delta\n\nText four.\n${gap}`;

await withBrowser(async ({ send, run, move, click, press, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 80; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const tap = async (key, code, vk, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: vk });
  };
  const row = (path) => `.nav-files .tree-item-self[data-path=${JSON.stringify(path)}]`;
  const selected = () => run(() => [...document.querySelectorAll('.nav-files > .nav-files-container .tree-item-self.is-selected')].map((el) => el.dataset.path).join('|'));
  const focused = () => run(() => document.querySelector('.nav-files > .nav-files-container .tree-item-self.is-focused')?.dataset.path ?? '');

  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('R27nDates.md', body);
    await api.createNote('R27qAlias.md', '---\naliases:\n  - Zephyr\n---\n# Alias note\n\nBlock para here.\n\n## Second head\n');
    await api.createFolder('R27qDir');
    for (const name of ['A', 'B', 'C', 'D']) await api.createNote(`R27qDir/R27q${name}.md`, name);
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    await ws.open('R27nDates.md');
  }, dates);

  for (const mode of ['live', 'source', 'reading']) {
    await run((mode) => ws.setMode(mode), mode);
    await sleep(80);
    for (const heading of ['r27ndue', 'Alpha', 'Beta', 'Gamma']) {
      const spot = await run((heading) => {
        const view = ws.view;
        const text = view.state.doc.toString();
        const index = heading === 'r27ndue' ? text.indexOf('r27ndue:') : text.search(new RegExp(`^#{1,3} ${heading}$`, 'm'));
        if (index < 0) return null;
        view.dispatch({ selection: { anchor: index }, scrollIntoView: true });
        const coords = view.coordsAtPos(index);
        if (!coords || coords.bottom <= coords.top) return null;
        return { x: coords.left + 12, y: (coords.top + coords.bottom) / 2 };
      }, heading);
      check(!!spot, `${mode}: ${heading} is on screen`);
      await move(spot);
      for (let i = 0; i < 2; i++) {
        for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...spot, button: 'left', clickCount: 1 });
        await sleep(30);
      }
      check(await run((mode) => ws.active.mode === mode && ws.active.path === 'R27nDates.md', mode), `${mode}: a second click on ${heading} stays in the note`);
    }
  }
  await run(() => ws.setMode('live'));

  await run(() => grove.run('global-search:open'));
  await click(await run(() => {
    const r = document.querySelector('.search-view [aria-label="Search settings"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }));
  await send('Input.insertText', { text: 'Text' });
  await sleep(80);
  const search = await run(() => {
    const view = document.querySelector('.search-view').getBoundingClientRect();
    const panel = document.querySelector('.search-settings').getBoundingClientRect();
    const rows = [...document.querySelectorAll('.search-settings-row')].map((el) => el.getBoundingClientRect());
    const label = document.querySelector('.search-settings-name').getBoundingClientRect();
    const toggle = document.querySelector('.search-settings .checkbox-container');
    const tr = toggle.getBoundingClientRect();
    const knob = getComputedStyle(toggle, '::after');
    const info = document.querySelector('.search-results-info').getBoundingClientRect();
    const count = document.querySelector('.search-results-result-count').getBoundingClientRect();
    const dot = document.querySelector('.search-more-options');
    const dr = dot.getBoundingClientRect();
    const drop = document.querySelector('.search-results-info .dropdown');
    const box = drop.getBoundingClientRect();
    const ds = getComputedStyle(drop);
    const chev = document.querySelector('.search-results-info .dropdown-chevron').getBoundingClientRect();
    const button = document.querySelector('.search-view [aria-label="Search settings"]');
    const bs = getComputedStyle(button);
    const probe = document.createElement('div');
    probe.style.color = 'var(--text-accent)';
    probe.style.background = 'color-mix(in srgb, var(--interactive-accent) 10%, transparent)';
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    const tint = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      inset: panel.x - view.x, panelW: panel.width, viewW: view.width, panelH: panel.height,
      rowY: rows[0].y, countTop: info.y,
      labelX: label.x, rowH: rows.map((r) => r.height), pitch: rows.slice(1).map((r, i) => r.y - rows[i].y),
      toggle: [tr.width, tr.height, tr.x], knob: [parseFloat(knob.width), parseFloat(knob.height)],
      countGap: info.y - panel.bottom, countTop: info.y,
      dot: [dr.width, dr.height, dr.y - count.y], dotBg: getComputedStyle(dot).backgroundColor,
      align: ds.textAlign, pad: ds.padding, chevronGap: box.right - chev.right,
      color: bs.color, bg: bs.backgroundColor, accent, tint,
    };
  });
  console.log(`MEASURE search panel x+${search.inset.toFixed(1)} w=${search.panelW.toFixed(1)} h=${search.panelH.toFixed(1)} rowY ${search.rowY.toFixed(1)} rows ${search.rowH.map((n) => n.toFixed(1)).join('/')} pitch ${search.pitch.map((n) => n.toFixed(1)).join('/')} count top ${search.countTop.toFixed(1)} gap ${search.countGap.toFixed(1)} dot ${search.dot.map((n) => n.toFixed(1)).join(',')}`);
  check(search.color === search.accent && search.bg === search.tint, `search settings button is accent on a 10% tint (${search.color} on ${search.bg})`);
  check(Math.abs(search.inset - 16) < 1.5 && Math.abs(search.panelW - (search.viewW - 32)) < 2 && Math.abs(search.panelH - 97) < 2, `search settings panel is inset 16px and 97px tall (${search.inset.toFixed(1)}, ${search.panelW.toFixed(1)}×${search.panelH.toFixed(1)})`);
  check(Math.abs(search.labelX - (search.inset + 44)) < 3 || Math.abs(search.labelX - 60) < 4, `search labels sit on the panel's left (${search.labelX.toFixed(1)})`);
  check(search.rowH.every((h) => Math.abs(h - 19) < 1) && search.pitch.every((p) => Math.abs(p - 35) < 1.5), `search rows are 19px on a 35px pitch (${search.rowH.join(',')}; ${search.pitch.join(',')})`);
  check(Math.abs(search.toggle[0] - 34) < 1 && Math.abs(search.toggle[1] - 19) < 1 && Math.abs(search.knob[0] - 15) < 1 && Math.abs(search.knob[1] - 15) < 1, `search toggles are 34×19 with a 15px knob (${search.toggle[0]}×${search.toggle[1]}, knob ${search.knob[0]})`);
  check(Math.abs(search.countGap - 4) < 2 && Math.abs(search.rowY - 94) < 2 && Math.abs(search.countTop - 195) < 2, `the first row is at y=94 and the count row at y=195 (${search.rowY.toFixed(1)}, ${search.countTop.toFixed(1)}, gap ${search.countGap.toFixed(1)})`);
  check(Math.abs(search.dot[0] - 11) < 1 && Math.abs(search.dot[1] - 11) < 1 && Math.abs(search.dot[2] - 6.5) < 1.5 && search.dotBg === 'rgb(92, 92, 92)', `the more-options dot is an 11px grey circle (${search.dot.join(',')}, ${search.dotBg})`);
  check((search.align === 'start' || search.align === 'left') && search.pad.startsWith('0px 28.8px 0px 9.6px') && Math.abs(search.chevronGap - 7.8) < 3, `sort text starts inset and the chevron sits at the right (${search.align}, ${search.pad}, gap ${search.chevronGap.toFixed(1)})`);

  await run(() => grove.run('outline:open'));
  await wait(async () => (await run(() => document.querySelectorAll('.outline-item').length)) >= 3, 'outline headings did not appear');
  const glyph = await run(() => {
    const rects = [...document.querySelector('.grove-auto-scroll').querySelectorAll('rect')].map((el) => ({
      x: el.getAttribute('x'), w: el.getAttribute('width'), y: +el.getAttribute('y'), h: +el.getAttribute('height'),
    }));
    rects.sort((a, b) => a.y - b.y);
    return rects;
  });
  check(glyph.length === 3 && glyph[0].x === glyph[1].x && glyph[1].x === glyph[2].x && glyph[0].w === glyph[1].w && glyph[1].w === glyph[2].w && glyph[0].y + glyph[0].h < glyph[1].y && glyph[1].y + glyph[1].h < glyph[2].y && glyph[1].h > glyph[0].h, `auto-scroll is a bar, a card, and a bar (${JSON.stringify(glyph)})`);

  await run(() => grove.run('backlink:open'));
  await wait(async () => (await run(() => document.querySelectorAll('.backlink-header').length)) >= 1, 'backlinks did not open');
  const back = await run(() => {
    const header = document.querySelector('.backlink-header').getBoundingClientRect();
    const file = document.querySelector('.backlink-pane .search-result-file-title')?.getBoundingClientRect();
    return { hx: header.x, hw: header.width, fx: file?.x ?? 0, fw: file?.width ?? 0, hasFile: !!file };
  });
  if (back.hasFile) check(back.hw > back.fw - 0.5 && back.hx < back.fx + 0.5, `backlink headers are wider than the file rows (${back.hx.toFixed(1)}×${back.hw.toFixed(1)} vs ${back.fx.toFixed(1)}×${back.fw.toFixed(1)})`);
  else check(true, 'backlink headers are present');

  await run(async () => { await ws.open('R27qDir/R27qA.md'); grove.run('file-explorer:open'); });
  await sleep(40);
  check(await run(() => document.activeElement?.classList.contains('nav-files-container')), 'Show file explorer focuses the list');
  check(await focused() === '' && await selected() === '', 'Show file explorer shows no focus ring');
  await press('ArrowDown');
  check(await focused() === 'R27qDir/R27qA.md' && await selected() === '', 'the first ArrowDown rings the active file and does not move');
  await press('Enter');
  await sleep(80);
  check(await run(() => ws.view.hasFocus) && await focused() === 'R27qDir/R27qA.md', 'Enter opens the file, focuses the editor, and keeps the ring');
  await run(() => grove.run('file-explorer:open'));
  await sleep(30);
  check(await focused() === '', 'opening the explorer again clears the ring');
  await press('ArrowDown');
  await press('ArrowDown');
  check(await focused() === 'R27qDir/R27qB.md' && await selected() === '', 'a later ArrowDown moves the ring and does not select');
  await tap('Delete', 'Delete', 46);
  await wait(async () => (await run(() => !!document.querySelector('.modal.mod-confirm'))), 'Delete did not ask');
  const dialog = await run(() => {
    const modal = document.querySelector('.modal.mod-confirm');
    const buttons = [...modal.querySelectorAll('.modal-button-container button')].map((el) => el.textContent);
    const box = modal.querySelector('.modal-checkbox')?.getBoundingClientRect();
    const cancel = modal.querySelector('.modal-button-container button')?.getBoundingClientRect();
    const paragraphs = [...modal.querySelectorAll('.modal-content p')].map((el) => el.textContent);
    return {
      title: modal.querySelector('.modal-title')?.textContent,
      paragraphs,
      buttons,
      close: !!modal.querySelector('.modal-close-button'),
      checkboxLeft: !!box && !!cancel && box.x < cancel.x,
      focus: document.activeElement?.textContent ?? '',
    };
  });
  check(dialog.title === 'Delete file' && dialog.paragraphs[0]?.includes('“R27qB.md”') && dialog.paragraphs.length === 2, `delete names the file with its extension on its own line (${dialog.paragraphs.join(' | ')})`);
  check(dialog.buttons.join(',') === 'Cancel,Delete' && dialog.close && dialog.checkboxLeft && dialog.focus === 'Delete', `delete puts Don't ask again left of Cancel then Delete, with a close button (${dialog.buttons.join(',')}, focus ${dialog.focus})`);
  const closeAt = await run(() => {
    const r = document.querySelector('.modal.mod-confirm .modal-close-button').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await click(closeAt);
  await sleep(40);
  check(await run(() => !document.querySelector('.modal.mod-confirm')), 'the close button cancels the delete');
  await tap('ArrowDown', 'ArrowDown', 40, 8);
  check(await selected() === 'R27qDir/R27qB.md|R27qDir/R27qC.md', 'Shift+ArrowDown extends from the focused row');
  await press('ArrowUp');
  check(await selected() === 'R27qDir/R27qB.md|R27qDir/R27qC.md' && await focused() === 'R27qDir/R27qB.md', 'a plain ArrowUp keeps the selection');
  await press('ArrowLeft');
  await sleep(260);
  check(await focused() === 'R27qDir' && await run(() => !!document.querySelector('.nav-files .tree-item-self[data-path="R27qDir"] .collapse-icon.is-collapsed')), 'ArrowLeft from a file focuses the parent and collapses it');

  await press('ArrowRight');
  await sleep(40);
  await press('ArrowRight');
  await press('ArrowDown');
  await press('ArrowDown');
  await press('ArrowDown');
  check(await focused() === 'R27qDir/R27qD.md', 'the ring can move to R27qD');

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
  await run(async () => { await ws.open('R27nDates.md'); });
  await typeAtEnd('\n[[#');
  await wait(async () => (await run(() => [...document.querySelectorAll('.cm-link-suggest .cm-completionLabel')].map((el) => el.textContent))).includes('Alpha'), '[[# did not list headings');
  await sleep(60);
  const heads = await run(() => {
    const box = document.querySelector('.cm-tooltip.cm-link-suggest').getBoundingClientRect();
    const item = document.querySelector('.cm-link-suggest li.mod-link-heading').getBoundingClientRect();
    const at = ws.view.state.doc.toString().lastIndexOf('[[');
    const bracket = ws.view.coordsAtPos(at);
    return { w: box.width, h: item.height, boxX: box.x, bracketX: bracket.left, selected: !!document.querySelector('.cm-link-suggest li[aria-selected]'), footer: !!document.querySelector('.cm-link-suggest-footer') };
  });
  console.log(`MEASURE [[# box x=${heads.boxX.toFixed(1)} bracket ${heads.bracketX.toFixed(1)} w=${heads.w.toFixed(1)} item ${heads.h.toFixed(1)}`);
  check(!heads.selected && !heads.footer, '[[# opens with nothing selected and no note-suggester footer');
  check(Math.abs(heads.h - 31.5) < 2 && heads.w < 280 && heads.boxX >= heads.bracketX - 1 && heads.boxX - heads.bracketX < 18, `[[# is a short list anchored just after [[ (${heads.w.toFixed(1)}×${heads.h.toFixed(1)}, Δ${(heads.boxX - heads.bracketX).toFixed(1)})`);
  await press('Escape');
  await typeAtEnd('\n[[Zep');
  await wait(async () => (await run(() => !!document.querySelector('.cm-link-suggest li.mod-link-alias'))), 'the alias row did not appear');
  await sleep(80);
  const alias = await run(() => {
    const box = document.querySelector('.cm-tooltip.cm-link-suggest').getBoundingClientRect();
    const item = document.querySelector('.cm-link-suggest li.mod-link-alias').getBoundingClientRect();
    const footer = document.querySelector('.cm-link-suggest-footer');
    const at = ws.view.state.doc.toString().lastIndexOf('[[');
    const bracket = ws.view.coordsAtPos(at);
    const label = document.querySelector('.cm-link-suggest li .cm-completionLabel').getBoundingClientRect();
    return {
      w: box.width, h: item.height, boxX: box.x, bracketX: bracket.left, labelX: label.x,
      selected: !!document.querySelector('.cm-link-suggest li[aria-selected]'),
      arrow: !!document.querySelector('.cm-link-suggest .alias-arrow'),
      footer: footer?.innerText ?? '',
      bolds: [...(footer?.querySelectorAll('b') ?? [])].map((el) => el.textContent),
    };
  });
  console.log(`MEASURE [[Zep box x=${alias.boxX.toFixed(1)} w=${alias.w.toFixed(1)} alias h=${alias.h.toFixed(1)} footer ${JSON.stringify(alias.footer)}`);
  check(alias.selected && alias.arrow && Math.abs(alias.h - 47.1) < 3, `an alias row is preselected, about 47px, with a corner arrow (${alias.h.toFixed(1)})`);
  check(!alias.footer.includes('·') && alias.bolds.join('|') === 'Type #|Type ^|Type |' && alias.footer.includes('to link heading') && alias.footer.includes('to change display text'), `the footer bolds each Type command without dots (${alias.footer})`);
  check(alias.w > 300 && alias.w < 500 && alias.boxX >= alias.bracketX - 1 && alias.boxX - alias.bracketX < 18 && alias.labelX > alias.bracketX, `the alias popup is content-sized and anchored just after [[ (${alias.w.toFixed(1)}, Δ${(alias.boxX - alias.bracketX).toFixed(1)})`);
  await press('Escape');

  await run(() => grove.run('app:open-settings'));
  await wait(async () => (await run(() => !!document.querySelector('.vertical-tab-nav-item'))), 'settings did not open');
  const nav = await run(() => {
    const items = [...document.querySelectorAll('.vertical-tab-nav-item')];
    const general = items.find((el) => el.textContent.trim() === 'General').getBoundingClientRect();
    const appearance = items.find((el) => el.textContent.trim() === 'Appearance').getBoundingClientRect();
    return { h: general.height, pitch: appearance.y - general.y };
  });
  check(Math.abs(nav.h - 24.9) < 1.5 && Math.abs(nav.pitch - 26.9) < 1.5, `settings nav rows are about 24.9px with a 2px gap (${nav.h.toFixed(1)}, pitch ${nav.pitch.toFixed(1)})`);
  await press('Escape');
}, { height: 800 });
