// Round 27q: side-pane colours and glyphs, search count row, explorer keys,
// link aliases. Headless Chromium, real pointer and keyboard, scratch vault.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const gap = '\n'.repeat(30);
const dates = `---
due: 2026-10-24
---
# Alpha

${gap}
## Beta

${gap}
### Gamma

## Delta
`;

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
  const showRow = async (path) => {
    await run((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'nearest' }), row(path));
    await sleep(30);
  };
  const selected = () => run(() => [...document.querySelectorAll('.nav-files > .nav-files-container .tree-item-self.is-selected')].map((el) => el.dataset.path).join('|'));
  const focused = () => run(() => document.querySelector('.nav-files > .nav-files-container .tree-item-self.is-focused')?.dataset.path ?? '');
  const has = (path) => run((path) => ws.vault.files.some((f) => f.path === path), path);
  const tone = (sel) => run((sel) => {
    const el = document.querySelector(sel);
    const probe = document.createElement('div');
    probe.style.color = 'var(--text-normal)';
    document.body.append(probe);
    const normal = getComputedStyle(probe).color;
    probe.style.color = 'var(--text-accent)';
    const accent = getComputedStyle(probe).color;
    probe.style.background = 'var(--background-modifier-hover)';
    const hover = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const style = getComputedStyle(el);
    return { color: style.color, bg: style.backgroundColor, normal, accent, hover, active: el.classList.contains('is-active') };
  }, sel);
  const neutral = async (sel, label) => {
    let got = await tone(sel);
    for (let i = 0; i < 20 && !(got.active && got.color === got.normal && got.color !== got.accent && got.bg === got.hover); i++) {
      await sleep(25);
      got = await tone(sel);
    }
    check(got.active && got.color === got.normal && got.color !== got.accent && got.bg === got.hover, `${label} stays neutral on the hover fill (${got.color} on ${got.bg})`);
  };

  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('R27qDates.md', body);
    await api.createNote('R27qPair.md', 'See [[R27qDates]] here.\n\nAlso R27qDates unlinked.');
    await api.createNote('R27qAlias.md', '---\naliases:\n  - Zephyr\n  - "bad|pipe"\n  - ""\n---\n# Alias note\n');
    await api.createFolder('KeyFolder');
    await api.createFolder('KeyDest');
    await api.createFolder('KeyBin');
    for (const [path, text] of Object.entries({
      'KeyFolder/A.md': 'A', 'KeyFolder/B.md': 'B', 'KeyFolder/C.md': 'C',
      'KeyBin/One.md': 'One', 'KeyBin/Two.md': 'Two',
      'KeyDrop.md': 'Drop me', 'KeyRename.md': 'Rename me',
    })) await api.createNote(path, text);
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    await ws.open('R27qDates.md');
  }, dates);

  for (const mode of ['live', 'source', 'reading']) {
    await run((mode) => ws.setMode(mode), mode);
    await sleep(80);
    for (const heading of ['due', 'Alpha', 'Beta', 'Gamma']) {
      let spot = null;
      for (let i = 0; i < 8 && !spot; i++) {
        spot = await run((heading) => {
          const view = ws.view;
          const text = view.state.doc.toString();
          const index = heading === 'due' ? text.indexOf('due:') : text.search(new RegExp(`^#{1,3} ${heading}$`, 'm'));
          if (index < 0) return null;
          view.dispatch({ selection: { anchor: index }, scrollIntoView: true });
          const coords = view.coordsAtPos(index);
          if (!coords || coords.bottom <= coords.top) return null;
          return { x: coords.left + 12, y: (coords.top + coords.bottom) / 2 };
        }, heading);
        if (!spot) await sleep(40);
      }
      check(!!spot, `${mode}: ${heading} is visible`);
      await move(spot);
      for (let i = 0; i < 2; i++) {
        for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...spot, button: 'left', clickCount: 1 });
        await sleep(30);
      }
      check(await run((mode) => ws.active.mode === mode && ws.active.path === 'R27qDates.md', mode), `${mode}: a second click on ${heading} stays in the note`);
    }
  }
  await run(() => ws.setMode('live'));

  await run(() => grove.run('backlink:open'));
  await wait(async () => (await run(() => document.querySelectorAll('.backlink-pane .search-result-file-match').length)) >= 1, 'linked mentions did not appear');
  const back = await run(() => {
    const pane = document.querySelector('.backlink-view').getBoundingClientRect();
    const header = document.querySelector('.backlink-header');
    const hr = header.getBoundingClientRect();
    const file = document.querySelector('.backlink-pane .search-result-file-title').getBoundingClientRect();
    const card = document.querySelector('.backlink-pane .search-result-file-matches').getBoundingClientRect();
    const unlinked = [...document.querySelectorAll('.backlink-header')].find((el) => el.textContent.includes('Unlinked')).getBoundingClientRect();
    const sort = document.querySelector('.backlink-toolbar [aria-label="Change sort order"] svg');
    return {
      color: getComputedStyle(header).color,
      fileX: file.x - pane.x, fileW: file.width, fileY: file.y,
      cardX: card.x - pane.x, cardW: card.width,
      unlinkedY: unlinked.y,
      sort: [...sort.classList].find((c) => c.startsWith('lucide-')),
    };
  });
  check(back.color === 'rgb(34, 34, 34)', `backlink headers use text-normal (${back.color})`);
  check(Math.abs(back.fileX - 13) < 2 && Math.abs(back.fileW - 274) < 2 && Math.abs(back.cardX - back.fileX) < 1 && Math.abs(back.cardW - back.fileW) < 1, `backlink file row and card share x=${back.fileX.toFixed(1)} w=${back.fileW.toFixed(1)}`);
  check(Math.abs(back.fileY - 115) < 3 && Math.abs(back.unlinkedY - 199.6) < 3, `backlink rhythm stays (file ${back.fileY}, unlinked ${back.unlinkedY})`);
  check(back.sort === 'lucide-arrow-up-narrow-wide', `backlink sort glyph is ascending (${back.sort})`);
  await click(await run(() => {
    const r = document.querySelector('.backlink-toolbar [aria-label="Show more context"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }));
  await neutral('.backlink-toolbar [aria-label="Show more context"]', 'backlinks Show more context');

  await run(() => {
    const view = ws.view;
    view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
    const scroller = view.dom.closest('.view-content') ?? view.scrollDOM;
    scroller.scrollTop = 0;
  });
  await sleep(60);
  await run(() => grove.run('outline:open'));
  await wait(async () => (await run(() => document.querySelectorAll('.outline-item').length)) === 4, 'outline headings did not appear');
  const outline = await run(() => {
    const button = document.querySelector('.outline-toolbar [aria-label="Auto-scroll to current section"]');
    const glyph = [...button.querySelector('svg').classList].find((c) => c.startsWith('grove-') || c.startsWith('lucide-'));
    return {
      off: !button.classList.contains('is-active'),
      heading: document.querySelector('.outline-item.is-active .tree-item-inner')?.textContent ?? '',
      scroll: (ws.view.dom.closest('.view-content') ?? ws.view.scrollDOM).scrollTop,
      glyph,
      bars: button.querySelectorAll('svg path, svg rect').length,
    };
  });
  check(outline.off && outline.heading === 'Alpha', `auto-scroll off still highlights the section in view (${outline.heading}, scroll ${outline.scroll})`);
  check(outline.glyph === 'grove-auto-scroll' && outline.bars >= 2, `auto-scroll glyph is a panel with bars (${outline.glyph}, ${outline.bars})`);
  await click(await run(() => {
    const r = document.querySelector('.outline-toolbar [aria-label="Auto-scroll to current section"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }));
  await neutral('.outline-toolbar [aria-label="Auto-scroll to current section"]', 'outline auto-scroll');

  await run(() => grove.run('tag-pane:open'));
  await click(await run(() => {
    const r = document.querySelector('.tag-toolbar [aria-label="Change sort order"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }));
  await click(await run(() => {
    const item = [...document.querySelectorAll('.menu-item')].find((el) => el.textContent.includes('Frequency (high to low)'));
    const r = item.getBoundingClientRect();
    return { x: r.x + 12, y: r.y + r.height / 2 };
  }));
  await neutral('.tag-toolbar [aria-label="Change sort order"]', 'tags sort');

  await click(await run(() => {
    const r = document.querySelector('.nav-buttons-container [aria-label="Auto-reveal current file"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }));
  await neutral('.nav-buttons-container [aria-label="Auto-reveal current file"]', 'file explorer auto-reveal');

  await run(() => grove.run('global-search:open'));
  await click(await run(() => {
    const r = document.querySelector('.search-view [aria-label="Search settings"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }));
  await neutral('.search-view [aria-label="Search settings"]', 'search settings');
  const search = await run(() => {
    const view = document.querySelector('.search-view').getBoundingClientRect();
    const row = document.querySelector('.search-settings-row').getBoundingClientRect();
    const info = document.querySelector('.search-results-info').getBoundingClientRect();
    const count = document.querySelector('.search-results-result-count');
    const label = count.querySelector('.search-results-count-label').getBoundingClientRect();
    const dot = count.querySelector('svg').getBoundingClientRect();
    const drop = document.querySelector('.search-results-info .dropdown');
    const dr = drop.getBoundingClientRect();
    const ds = getComputedStyle(drop);
    const input = document.querySelector('.search-view .search-input').getBoundingClientRect();
    const clear = document.querySelector('.search-view .search-input-clear-button');
    const cr = clear ? clear.getBoundingClientRect() : null;
    return {
      rowCentre: row.y + row.height / 2,
      rowInView: row.y + row.height / 2 - view.y,
      infoTop: info.y,
      infoInView: info.y - view.y,
      menus: document.querySelectorAll('.search-results-info [aria-label="More options"]').length,
      stray: !!document.querySelector('.search-results-menu'),
      dotAfter: dot.x >= label.x + label.width - 1,
      dot: [dot.width, dot.height],
      dropH: dr.height,
      dropW: dr.width,
      dropRight: dr.right,
      infoRight: info.right,
      dropBg: ds.backgroundColor,
      dropColor: ds.color,
      dropBorder: ds.borderTopWidth,
      dropShadow: ds.boxShadow,
      dropAlign: ds.textAlign,
      inputH: input.height,
      clear: cr && [cr.width, cr.height, cr.x],
    };
  });
  console.log(`MEASURE search row centre ${search.rowCentre.toFixed(1)} (view+${search.rowInView.toFixed(1)}) count top ${search.infoTop.toFixed(1)} (view+${search.infoInView.toFixed(1)})`);
  check(search.menus === 1 && !search.stray && search.dotAfter && Math.abs(search.dot[0] - 14) < 1, `the result count is one control with the dot on its right (${search.menus}, dot ${search.dot.join('x')})`);
  check(Math.abs(search.dropH - 24) < 1 && Math.abs(search.dropW - 166) < 2 && Math.abs(search.dropRight - (search.infoRight - 12)) < 2, `sort dropdown is a 24px borderless field, right aligned (${search.dropW.toFixed(1)}x${search.dropH.toFixed(1)} ending ${search.dropRight.toFixed(1)})`);
  check(search.dropBg === 'rgba(0, 0, 0, 0)' && search.dropColor === 'rgb(92, 92, 92)' && search.dropBorder === '0px' && search.dropShadow === 'none' && search.dropAlign === 'right', `sort dropdown is transparent muted text (${search.dropBg}, ${search.dropColor}, ${search.dropBorder}, ${search.dropShadow})`);
  check(!search.clear || (Math.abs(search.clear[0] - 28) < 1 && Math.abs(search.clear[1] - 30) < 1), `clear button stays 28x30 (${search.clear})`);
  check(Math.abs(search.inputH - 30) < 2, `the search field stays 30px (${search.inputH})`);

  await run(() => grove.run('file-explorer:open'));
  await sleep(50);
  await showRow('KeyFolder');
  await click(row('KeyFolder'));
  await sleep(200);
  check(await run(() => document.activeElement?.classList.contains('nav-files-container')), 'clicking a folder leaves the explorer focused');
  check(await focused() === 'KeyFolder' && (await selected()) === '', 'a plain click focuses the folder without starting a multi-selection');
  await press('ArrowDown');
  check(await selected() === 'KeyFolder/A.md' && await focused() === 'KeyFolder/A.md', 'ArrowDown moves onto the first child');
  await press('ArrowDown');
  check(await selected() === 'KeyFolder/B.md', 'ArrowDown moves to the next file');
  await press('ArrowUp');
  check(await selected() === 'KeyFolder/A.md', 'ArrowUp moves back');
  await tap('ArrowDown', 'ArrowDown', 40, 8);
  check(await selected() === 'KeyFolder/A.md|KeyFolder/B.md' && await focused() === 'KeyFolder/B.md', 'Shift+ArrowDown extends the selection');
  await press('ArrowRight');
  check(await selected() === 'KeyFolder/A.md|KeyFolder/B.md', 'ArrowRight on a file does not change the selection');
  await press('ArrowLeft');
  check(await selected() === 'KeyFolder' && await focused() === 'KeyFolder', 'ArrowLeft on a child selects its parent');
  await press('ArrowLeft');
  await sleep(250);
  const folderRow = row('KeyFolder');
  const childRow = row('KeyFolder/A.md');
  check(await run((folder, child) => !!document.querySelector(folder + ' .collapse-icon.is-collapsed') && !document.querySelector(child), folderRow, childRow), 'ArrowLeft collapses an expanded folder');
  await press('ArrowRight');
  await sleep(40);
  check(await run((folder, child) => !document.querySelector(folder + ' .collapse-icon.is-collapsed') && !!document.querySelector(child), folderRow, childRow), 'ArrowRight expands a collapsed folder');
  await press('ArrowRight');
  check(await selected() === 'KeyFolder/A.md', 'ArrowRight on an expanded folder moves to its first child');

  const drag = async (source, destination) => {
    const start = await run((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, row(source));
    const end = await run((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, row(destination));
    await move(start);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (end.x - start.x) * i / 8, y: start.y + (end.y - start.y) * i / 8, button: 'left', buttons: 1 });
      await sleep(16);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', clickCount: 1 });
  };
  await tap('ArrowDown', 'ArrowDown', 40, 8);
  check(await selected() === 'KeyFolder/A.md|KeyFolder/B.md', 'the two files are selected together before the drag');
  await showRow('KeyDest');
  await showRow('KeyFolder/A.md');
  await drag('KeyFolder/A.md', 'KeyDest');
  await wait(() => has('KeyDest/A.md'), 'multi-drag did not move A');
  check(await has('KeyDest/B.md') && !await has('KeyFolder/A.md') && !await has('KeyFolder/B.md'), 'dragging one selected file moves the whole selection');

  await showRow('KeyFolder');
  await click(row('KeyFolder'));
  await sleep(220);
  if (await run((sel) => !!document.querySelector(sel + ' .collapse-icon.is-collapsed'), row('KeyFolder'))) {
    await press('ArrowRight');
    await sleep(40);
  }
  await press('ArrowDown');
  check(await selected() === 'KeyFolder/C.md', 'ArrowDown lands on the file left in the folder');
  await tap('Delete', 'Delete', 46);
  await wait(async () => (await run(() => document.querySelector('.modal.mod-confirm')?.innerText ?? '')).includes('Delete file'), 'Delete did not ask');
  await press('Escape');
  await sleep(50);
  check(await has('KeyFolder/C.md') && !await run(() => !!document.querySelector('.modal.mod-confirm')), 'Escape cancels the delete');
  await tap('Backspace', 'Backspace', 8);
  await wait(async () => (await run(() => document.querySelector('.modal.mod-confirm')?.innerText ?? '')).includes('Delete file'), 'Backspace did not ask');
  await press('Enter');
  await wait(async () => !await has('KeyFolder/C.md'), 'Backspace did not delete the file');
  check(!await has('KeyFolder/C.md'), 'Backspace deletes the focused file after confirm');

  await showRow('KeyBin');
  await click(row('KeyBin'));
  await sleep(200);
  await press('ArrowDown');
  check(await selected() === 'KeyBin/One.md', 'ArrowDown lands on the first file in KeyBin');
  await tap('ArrowDown', 'ArrowDown', 40, 8);
  check(await selected() === 'KeyBin/One.md|KeyBin/Two.md', 'Shift+ArrowDown selects both files in the folder');
  await tap('Delete', 'Delete', 46);
  await wait(async () => (await run(() => document.querySelector('.modal.mod-confirm')?.innerText ?? '')).includes('delete 2 items'), 'one dialog did not cover the selection');
  const asked = await run(() => document.querySelector('.modal.mod-confirm')?.innerText ?? '');
  check(asked.includes('delete 2 items') && !asked.includes('Delete file'), `one dialog covers the selection (${asked.split('\n')[0]})`);
  await press('Enter');
  await wait(async () => !await has('KeyBin/One.md') && !await has('KeyBin/Two.md'), 'the selection was not deleted');
  check(await has('KeyBin') && !await has('KeyBin/Two.md'), 'Delete removes every selected file and leaves the folder');

  await showRow('KeyRename.md');
  await click(row('KeyRename.md'), 'right');
  await click(await run(() => {
    const item = [...document.querySelectorAll('.menu-item')].find((el) => el.textContent.trim() === 'Rename...');
    const r = item.getBoundingClientRect();
    return { x: r.x + 16, y: r.y + r.height / 2 };
  }));
  await wait(async () => await run(() => !!document.querySelector('.tree-item-inner[contenteditable="plaintext-only"]')), 'rename did not start');
  await press('Backspace');
  await sleep(40);
  check(await has('KeyRename.md'), 'Backspace while renaming does not delete the file');
  await press('Escape');

  await run(() => ws.open('R27qDates.md'));
  await sleep(80);
  await run((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'nearest' }), row('KeyDrop.md'));
  const editor = await run(() => {
    const line = [...document.querySelectorAll('.cm-line')].find((el) => el.textContent.includes('Alpha') && el.getBoundingClientRect().height > 0);
    const r = line.getBoundingClientRect();
    return { x: r.x + 40, y: r.y + r.height / 2 };
  });
  const start = await run((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; }, row('KeyDrop.md'));
  await move(start);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (editor.x - start.x) * i / 8, y: start.y + (editor.y - start.y) * i / 8, button: 'left', buttons: 1 });
    await sleep(16);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...editor, button: 'left', clickCount: 1 });
  await sleep(80);
  check(await run(() => ws.view.state.doc.toString().includes('[[KeyDrop]]')) && await has('KeyDrop.md'), 'dropping a note into the editor inserts a wikilink and leaves the file');

  await press('Escape');
  const end = await run(() => {
    const pos = ws.view.state.doc.length;
    ws.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    ws.view.focus();
    const r = ws.view.coordsAtPos(pos);
    return r && r.bottom > r.top ? { x: r.left + 2, y: (r.top + r.bottom) / 2 } : null;
  });
  check(!!end, 'the end of the note is on screen');
  await click(end);
  await send('Input.insertText', { text: '\n[[Zep' });
  await wait(async () => await run(() => ws.view.state.doc.toString().includes('[[Zep')), 'the alias query was not typed into the note');
  await wait(async () => (await run(() => [...document.querySelectorAll('.cm-link-suggest li')].some((el) => el.textContent.includes('Zephyr') && el.classList.contains('mod-link-alias')))), 'alias suggestion did not appear');
  check(await run(() => [...document.querySelectorAll('.cm-link-suggest li')].every((el) => !el.textContent.includes('bad|pipe'))), 'aliases containing a pipe are not suggested');
  const acceptSuggestion = async (includes) => {
    for (let i = 0; i < 40; i++) {
      const hit = await run((includes) => (document.querySelector('.cm-link-suggest li[aria-selected]')?.textContent ?? '').includes(includes), includes);
      if (hit) break;
      await press('ArrowDown');
      await sleep(20);
      if (i === 39) assert.fail(`suggestion ${includes} was not highlighted`);
    }
    await sleep(80);
    const spot = await run((includes) => {
      const el = document.querySelector('.cm-link-suggest li[aria-selected]');
      if (!el?.textContent.includes(includes)) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > window.innerHeight) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, includes);
    check(!!spot, `${includes} is highlighted on screen`);
    await click(spot);
  };
  const typeAtEnd = async (text) => {
    const spot = await run(() => {
      const pos = ws.view.state.doc.length;
      ws.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      ws.view.focus();
      const r = ws.view.coordsAtPos(pos);
      if (!r || r.bottom <= r.top) return null;
      return { x: Math.min(1200, Math.max(8, r.left + 8)), y: Math.min(window.innerHeight - 8, Math.max(8, (r.top + r.bottom) / 2)) };
    });
    check(!!spot, 'the caret is on screen');
    await click(spot);
    await send('Input.insertText', { text });
  };
  await acceptSuggestion('Zephyr');
  await wait(async () => await run(() => ws.view.state.doc.toString().includes('[[R27qAlias|Zephyr]]')), 'choosing an alias inserts [[note|alias]]');

  await typeAtEnd('\n[[R27qAlias#');
  await wait(async () => await run(() => ws.view.state.doc.toString().includes('[[R27qAlias#')), 'the heading query was not typed');
  await wait(async () => (await run(() => [...document.querySelectorAll('.cm-link-suggest .cm-completionLabel')].map((el) => el.textContent).join('|'))).includes('Alias note'), '[[Note# did not list headings');
  await press('Escape');
  await sleep(40);
  await typeAtEnd('\n[[#');
  await wait(async () => (await run(() => [...document.querySelectorAll('.cm-link-suggest .cm-completionLabel')].map((el) => el.textContent))).includes('Beta'), '[[# did not list this note');
  check(true, '[[# lists headings in this note');
  await press('Escape');
  await typeAtEnd('\n[[R27qAlias^');
  await wait(async () => (await run(() => document.querySelectorAll('.cm-link-suggest li.mod-link-block').length)) >= 1, '[[Note^ did not list blocks');
  await acceptSuggestion('Alias note');
  await wait(async () => await run(() => /\[\[R27qAlias#\^[a-z0-9]{6}]]/.test(ws.view.state.doc.toString())), 'choosing a block inserts [[Note#^id]]');

  await run(() => ws.setMode('reading'));
  const before = await run(() => ws.view.state.doc.toString());
  await send('Input.insertText', { text: '[[#' });
  await sleep(150);
  check(await run((before) => ws.view.state.doc.toString() === before && !document.querySelector('.cm-link-suggest'), before), 'Reading stays read-only with no link menu');
}, { height: 800 });
