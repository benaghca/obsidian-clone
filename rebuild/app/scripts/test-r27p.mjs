// Round 27p: search focus ring, settings toggles, result keyboard order,
// backlink cards, paragraph context, toolbar glyphs, outline defaults, tag sort.
// Headless Chromium, real pointer input, scratch vault only.
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
  const center = async (sel) => run((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, sel);

  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('R27pDates.md', body);
    await api.createNote('R27pPair.md', 'before here\nSee [[R27pDates]] here.\n\nAlso R27pDates unlinked.\n');
    await api.createNote('R27pSearch.md', 'alpha line\n\nlead in\nbeta target line\n\ngamma line\n');
    await api.createNote('R27pTags.md', '#r27pzoo\n#r27pzoo\n#r27pzoo\n#r27pant\n');
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    await ws.open('R27pDates.md');
  }, dates);

  for (const mode of ['live', 'source', 'reading']) {
    await run((mode) => ws.setMode(mode), mode);
    await sleep(60);
    const spot = await run(() => {
      const line = [...document.querySelectorAll('.cm-line')].find((el) => /Alpha|due/.test(el.textContent));
      const rect = line.getBoundingClientRect();
      return { x: rect.x + 28, y: rect.y + rect.height / 2 };
    });
    await move(spot);
    for (let n = 0; n < 2; n++) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, ...spot, button: 'left', clickCount: 1 });
      }
      await sleep(30);
    }
    check((await run(() => ws.view.state.doc.toString())).includes('# Alpha'), `${mode}: two clicks at one point leave the headings intact`);
  }
  await run(() => ws.setMode('live'));

  await run(() => grove.run('backlink:open'));
  await wait(async () => (await run(() => document.querySelectorAll('.backlink-pane .search-result-file-match').length)) >= 1, 'linked mentions did not appear');

  const back = await run(() => {
    const pane = document.querySelector('.backlink-view').getBoundingClientRect();
    const header = document.querySelector('.backlink-header').getBoundingClientRect();
    const file = document.querySelector('.backlink-pane .search-result-file-title').getBoundingClientRect();
    const match = document.querySelector('.backlink-pane .search-result-file-match').getBoundingClientRect();
    const card = document.querySelector('.backlink-pane .search-result-file-matches');
    const cardStyle = getComputedStyle(card);
    const glyphs = [...document.querySelectorAll('.backlink-toolbar .clickable-icon svg')].map((el) => [...el.classList].find((c) => c.startsWith('lucide-')) ?? '');
    return {
      fileX: file.x - pane.x, fileW: file.width, fileH: file.height, fileY: file.y,
      headerX: header.x - pane.x, headerW: header.width,
      matchY: match.y,
      cardBg: cardStyle.backgroundColor, cardRadius: cardStyle.borderRadius, cardShadow: cardStyle.boxShadow,
      glyphs,
    };
  });
  check(Math.abs(back.fileX - 13) < 2 && Math.abs(back.fileW - 274) < 2 && Math.abs(back.headerX - 13) < 2 && Math.abs(back.headerW - 274) < 2, `backlink header and file row are inset 13px and 274px wide (file ${back.fileX.toFixed(1)}×${back.fileW.toFixed(1)}, header ${back.headerX.toFixed(1)}×${back.headerW.toFixed(1)})`);
  check(Math.abs(back.fileH - 24.9) < 1 && Math.abs(back.fileY - 115) < 3, `the file row is 24.9px at y=115 (${back.fileH} at ${back.fileY})`);
  check(Math.abs(back.matchY - 144) < 3, `the first match starts at y=144 (${back.matchY})`);
  check(back.cardBg === 'rgb(255, 255, 255)' && back.cardRadius === '4px' && back.cardShadow.includes('rgb(228, 228, 228)'), `matches sit in a white card (${back.cardBg}, ${back.cardRadius}, ${back.cardShadow})`);
  check(back.glyphs.join('|') === 'lucide-list|lucide-move-vertical|lucide-arrow-up-narrow-wide|lucide-search', `backlink toolbar glyphs (${back.glyphs.join('|')})`);

  const unlinkedAt = await run(() => {
    const el = [...document.querySelectorAll('.backlink-header')].find((n) => n.textContent.includes('Unlinked'));
    const r = el.getBoundingClientRect();
    return { x: r.x + 40, y: r.y + r.height / 2, y0: r.y };
  });
  check(Math.abs(unlinkedAt.y0 - 199.6) < 3, `Unlinked mentions starts at y=199.6 (${unlinkedAt.y0})`);

  await click(await center('.backlink-toolbar [aria-label="Show more context"]'));
  await wait(async () => (await run(() => [...document.querySelectorAll('.backlink-pane .search-result-file-match')].some((row) => row.textContent.includes('before here')))), 'same-paragraph context did not appear');
  const crossed = await run(() => [...document.querySelectorAll('.backlink-pane .search-result-file-match')].some((row) => row.textContent.includes('See [[') && row.textContent.includes('unlinked')));
  check(!crossed, 'Show more context stays inside the hit paragraph');

  await move(await center('.backlink-pane .search-result-file-match'));
  const chevron = await run(() => document.querySelector('.backlink-pane .search-result-file-match .backlink-context-toggle svg')?.classList.contains('lucide-chevrons-up-down'));
  check(chevron, 'the mention hover icon is an up/down chevron');

  await run(() => grove.run('outline:open'));
  await wait(async () => (await run(() => document.querySelectorAll('.outline-item').length)) === 4, 'the outline did not list four headings');
  const outline = await run(() => {
    const pane = document.querySelector('.outline-view').getBoundingClientRect();
    const row = document.querySelector('.outline-item').getBoundingClientRect();
    const text = document.querySelector('.outline-item .tree-item-inner').getBoundingClientRect();
    const glyphs = [...document.querySelectorAll('.outline-toolbar .clickable-icon svg')].map((el) => [...el.classList].find((c) => c.startsWith('lucide-') || c.startsWith('grove-')));
    const off = !document.querySelector('.outline-toolbar [aria-label="Auto-scroll to current section"]').classList.contains('is-active');
    return { rowX: row.x - pane.x, rowW: row.width, textX: text.x - pane.x, y: row.y, glyphs, off };
  });
  check(outline.off, 'outline auto-scroll starts off');
  check(Math.abs(outline.rowX - 12) < 2 && Math.abs(outline.rowW - 276) < 2, `outline rows are inset 12px and 276px wide (${outline.rowX.toFixed(1)}×${outline.rowW.toFixed(1)})`);
  check(Math.abs(outline.textX - 36) < 2 && Math.abs(outline.y - 84) < 2, `outline text starts at pane +36 and the first row at y=84 (${outline.textX.toFixed(1)} at ${outline.y})`);
  check(outline.glyphs.join('|') === 'lucide-search|grove-auto-scroll|lucide-chevrons-down-up', `outline toolbar glyphs (${outline.glyphs.join('|')})`);
  await click(await center('.outline-toolbar [aria-label="Auto-scroll to current section"]'));
  // The row background fades in. Wait until the transition lands on the hover token.
  let tone = { bg: '', hover: '', accent: '' };
  await wait(async () => {
    tone = await run(() => {
      const row = document.querySelector('.outline-item.is-active');
      const probe = document.createElement('div');
      probe.style.background = 'var(--background-modifier-hover)';
      document.body.append(probe);
      const hover = getComputedStyle(probe).backgroundColor;
      probe.style.background = 'var(--background-modifier-active-hover)';
      const accent = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { bg: row ? getComputedStyle(row).backgroundColor : '', hover, accent };
    });
    return tone.bg === tone.hover && tone.bg !== tone.accent;
  }, 'the active outline row did not settle on the neutral hover colour');
  check(tone.bg === tone.hover && tone.bg !== tone.accent, `the active outline row is neutral grey (${tone.bg})`);

  await run(() => grove.run('global-search:open'));
  const searchAt = await run(() => {
    const r = document.querySelector('.search-view .search-input').getBoundingClientRect();
    return { x: r.x + 40, y: r.y + r.height / 2 };
  });
  await click(searchAt);
  // Border and shadow fade onto the focus ring. Read them after that settles.
  let clicked = { shadow: '', border: '' };
  await wait(async () => {
    clicked = await run(() => {
      const style = getComputedStyle(document.querySelector('.search-view .search-input'));
      return { shadow: style.boxShadow, border: style.borderColor };
    });
    return clicked.shadow.includes('0px 0px 0px 2px') && clicked.border === 'rgb(189, 189, 189)';
  }, 'a click did not focus search with the grey ring');
  check(clicked.shadow.includes('0px 0px 0px 2px') && clicked.border === 'rgb(189, 189, 189)', `a click focuses search with the grey ring (${clicked.shadow}; ${clicked.border})`);
  const editor = await run(() => {
    const el = [...document.querySelectorAll('.cm-scroller')].find((node) => node.offsetParent && node.getBoundingClientRect().width > 80);
    const r = el.getBoundingClientRect();
    return { x: r.x + 40, y: r.y + 80 };
  });
  await click(editor);
  await run(() => grove.run('global-search:open'));
  // Border and shadow fade onto the focus ring. Read them after that settles.
  let commanded = { active: false, shadow: '', border: '' };
  await wait(async () => {
    commanded = await run(() => {
      const input = document.querySelector('.search-view .search-input');
      const style = getComputedStyle(input);
      return { active: document.activeElement === input, shadow: style.boxShadow, border: style.borderColor };
    });
    return commanded.active && commanded.shadow.includes('0px 0px 0px 2px') && commanded.border === 'rgb(189, 189, 189)';
  }, 'the search command did not focus the field with the grey ring');
  check(commanded.active && commanded.shadow.includes('0px 0px 0px 2px') && commanded.border === 'rgb(189, 189, 189)', `the search command focuses the field with the same ring (${commanded.active}; ${commanded.shadow}; ${commanded.border})`);

  await send('Input.insertText', { text: 'target' });
  await wait(async () => (await run(() => !document.querySelector('.search-view .search-input-clear-button').hidden)), 'the clear button did not appear');
  const clear = await run(() => {
    const el = document.querySelector('.search-view .search-input-clear-button');
    const r = el.getBoundingClientRect();
    const svg = el.querySelector('svg');
    const style = getComputedStyle(svg);
    return { x: r.x, w: r.width, h: r.height, bg: style.backgroundColor, radius: style.borderRadius };
  });
  check(Math.abs(clear.x - 270) < 3 && Math.abs(clear.w - 28) < 1 && Math.abs(clear.h - 30) < 1, `Clear search is a 28×30 button at x=270 (${clear.x.toFixed(1)}, ${clear.w}×${clear.h})`);
  check(clear.bg === 'rgb(92, 92, 92)' && clear.radius === '50%', `Clear search is a filled circle (${clear.bg}, ${clear.radius})`);

  await click(await center('.search-view [aria-label="More options"]'));
  await wait(async () => !!(await run(() => [...document.querySelectorAll('.menu-item')].some((el) => el.textContent.includes('Copy search results')))), 'the search ... menu did not open');
  await press('Escape');

  await click(await center('.search-view [aria-label="Search settings"]'));
  await click(await center('.search-settings [aria-label="Show more context"]'));
  await wait(async () => (await run(() => [...document.querySelectorAll('.search-view .search-result-file-match')].some((row) => row.textContent.includes('lead in')))), 'search context did not keep the hit paragraph');
  const spilled = await run(() => [...document.querySelectorAll('.search-view .search-result-file-match')].some((row) => row.textContent.includes('alpha line') || row.textContent.includes('gamma line')));
  check(!spilled, 'search Show more context stops at the blank line');
  await press('ArrowDown');
  check(await run(() => !!document.querySelector('.search-view .search-result.has-focus') && !document.querySelector('.search-view .search-result-file-match.is-selected')), 'the first ArrowDown focuses the file row');
  await press('ArrowDown');
  const match = await run(() => {
    const row = document.querySelector('.search-view .search-result-file-match.is-selected');
    const style = row ? getComputedStyle(row) : null;
    const icon = row?.querySelector('.backlink-context-toggle svg');
    return { radius: style?.borderRadius ?? '', shown: icon ? getComputedStyle(icon.parentElement).display : '', icon: icon ? [...icon.classList].includes('lucide-chevrons-up-down') : false };
  });
  check(match.radius === '4px' && match.shown === 'flex' && match.icon, `the selected match is rounded and shows the context chevron (${match.radius}, ${match.shown})`);

  await run(() => { ws.open('R27pTags.md'); grove.run('tag-pane:open'); });
  const tagNames = () => run(() => [...document.querySelectorAll('.tag-pane-tag-text')].map((el) => el.textContent));
  await wait(async () => {
    const names = await tagNames();
    return names.includes('#r27pant') && names.includes('#r27pzoo') && names.indexOf('#r27pant') < names.indexOf('#r27pzoo');
  }, 'the tag pane did not list ant before zoo');
  await click(await center('.tag-toolbar [aria-label="Change sort order"]'));
  await wait(async () => !!(await run(() => [...document.querySelectorAll('.menu-item')].some((el) => el.textContent.includes('Frequency (high to low)')))), 'the tag sort menu did not open');
  const freq = await run(() => {
    const el = [...document.querySelectorAll('.menu-item')].find((n) => n.textContent.includes('Frequency (high to low)'));
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await click(freq);
  await wait(async () => {
    const names = await tagNames();
    return names.indexOf('#r27pzoo') >= 0 && names.indexOf('#r27pzoo') < names.indexOf('#r27pant');
  }, 'frequency sort did not put zoo before ant');
}, { height: 800 });
