// Round 27n: a readable date glyph, menu item pitch, backlink rows, the
// outline, and arrow keys through search results. Headless Chromium, real
// pointer input. Scratch vault only.
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { withBrowser, sleep } from './browser.mjs';

function pngPixels(buf) {
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const bpp = buf[25] === 6 ? 4 : buf[25] === 2 ? 3 : 0;
  if (!bpp) throw new Error(`unexpected png color type ${buf[25]}`);
  const parts = [];
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i);
    if (buf.toString('ascii', i + 4, i + 8) === 'IDAT') parts.push(buf.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = w * bpp;
  const out = new Uint8Array(w * h * 4);
  let p = 0;
  let prev = new Uint8Array(stride);
  const paeth = (left, up, ul) => {
    const pp = left + up - ul;
    const pa = Math.abs(pp - left), pb = Math.abs(pp - up), pc = Math.abs(pp - ul);
    return pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
  };
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p += stride);
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? cur[i - bpp] : 0, up = prev[i], ul = i >= bpp ? prev[i - bpp] : 0;
      const v = row[i];
      cur[i] = filter === 1 ? v + left : filter === 2 ? v + up : filter === 3 ? v + ((left + up) >> 1) : filter === 4 ? v + paeth(left, up, ul) : v;
    }
    for (let x = 0; x < w; x++) {
      const s = x * bpp;
      const i = (y * w + x) * 4;
      out[i] = cur[s];
      out[i + 1] = cur[s + 1];
      out[i + 2] = cur[s + 2];
      out[i + 3] = 255;
    }
    prev = cur;
  }
  return { w, h, out };
}

const gap = '\n'.repeat(40);
const note = `---
due: 2026-10-23
---
# Heading

${gap}
## Section

${gap}
### Detail

See [[Welcome]] in a frontmatter note.
`;

await withBrowser(async ({ send, run, move, click, press, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 80; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const box = (sel) => run((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);

  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Outline.md', body);
    await api.createNote('Mention.md', 'See [[Outline]] once.\n');
    await api.createNote('Plain.md', 'Outline appears here.\n');
    await api.createNote('AlphaZebra.md', 'zebrar27n lives in alpha.\n');
    await api.createNote('BetaZebra.md', 'zebrar27n lives in beta.\n');
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    await ws.open('Outline.md');
  }, note);

  const glyph = await run(() => {
    const svg = document.querySelector('.cm-content .property-date-icon svg');
    const sr = svg.getBoundingClientRect();
    const value = document.querySelector('.cm-content .property-value[data-type="date"]');
    return {
      x: sr.x - value.getBoundingClientRect().x,
      w: sr.width,
      h: sr.height,
      color: getComputedStyle(svg).color.replace(/\s/g, ''),
      clip: { x: sr.x, y: sr.y, width: sr.width, height: sr.height, scale: 1 },
    };
  });
  check(glyph.w === 11 && glyph.h === 12 && Math.abs(glyph.x - 7.5) < 0.6, `the date glyph stays 11×12 at x+7.5 (+${glyph.x}, ${glyph.w}×${glyph.h})`);
  check(glyph.color === 'rgb(126,126,126)', `the date glyph is a darker grey (${glyph.color})`);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: glyph.clip });
  const pixels = pngPixels(Buffer.from(shot.data, 'base64'));
  let ink = 0;
  let darkest = 255;
  for (let i = 0; i < pixels.out.length; i += 4) {
    const v = Math.min(pixels.out[i], pixels.out[i + 1], pixels.out[i + 2]);
    if (v < 160) ink++;
    if (v < darkest) darkest = v;
  }
  check(ink >= 25 && darkest <= 140, `the date glyph paints a visible calendar (${ink} ink pixels, darkest ${darkest})`);

  for (const mode of ['live', 'source', 'reading']) {
    await run((mode) => ws.setMode(mode), mode);
    await sleep(80);
    const spot = await run(() => {
      const line = [...document.querySelectorAll('.cm-line')].find((el) => /frontmatter note|Heading/.test(el.textContent));
      const rect = line.getBoundingClientRect();
      return { x: rect.x + 24, y: rect.y + rect.height / 2 };
    });
    await move(spot);
    for (let n = 0; n < 2; n++) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, ...spot, button: 'left', clickCount: 1 });
      }
      await sleep(40);
    }
    check((await run(() => ws.view.state.doc.toString())).includes('# Heading'), `${mode}: two clicks at one point leave the note intact`);
  }
  await run(() => ws.setMode('live'));

  await run(() => ws.open('Mention.md', { where: 'tab' }));
  const inactive = await run(() => {
    const el = [...document.querySelectorAll('.mod-root .workspace-tab-header')].find((n) => !n.classList.contains('is-active'));
    const r = el.getBoundingClientRect();
    return { x: r.x + 16, y: r.y + r.height / 2 };
  });
  await click(inactive, 'right');
  const menu = await run(() => {
    const items = [...document.querySelectorAll('.menu > .menu-item')].map((el) => {
      const r = el.getBoundingClientRect();
      return { h: r.height, top: r.top, bottom: r.bottom };
    });
    const kids = [...document.querySelector('.menu').children];
    const sep = kids.findIndex((el) => el.classList.contains('menu-separator'));
    const above = kids[sep - 1].getBoundingClientRect();
    const below = kids[sep + 1].getBoundingClientRect();
    const pad = getComputedStyle(document.querySelector('.menu')).paddingTop;
    return { h: items[0].h, gap: below.top - above.bottom, pad, n: items.length };
  });
  check(Math.abs(menu.h - 24.9) < 0.6, `a menu item is 24.9px tall (${menu.h})`);
  check(Math.abs(menu.gap - 7) < 0.6, `items around a separator are 7px apart (${menu.gap})`);
  await press('Escape');

  await run(() => { ws.open('Outline.md'); grove.run('backlink:open'); });
  await wait(async () => {
    const dock = await box('.mod-right-split');
    return dock && dock.w > 280;
  }, 'the right dock did not open');
  await sleep(200);
  const dock = await box('.mod-right-split');
  const setWidth = await run(() => getComputedStyle(document.querySelector('.app-container')).getPropertyValue('--right-sidebar-width').trim());
  check(setWidth === '300px' && Math.abs(dock.w - 300) < 2, `a fresh right dock is 300px wide (${setWidth}, drawn ${dock.w})`);

  await wait(async () => (await run(() => document.querySelectorAll('.backlink-pane .search-result-file-match').length)) > 0, 'linked mentions did not appear');
  const headers = await run(() => [...document.querySelectorAll('.backlink-header')].map((el) => {
    const icon = el.querySelector('.collapse-icon');
    const count = el.querySelector('.tree-item-flair');
    const r = el.getBoundingClientRect();
    const c = count.getBoundingClientRect();
    return {
      title: el.querySelector('.tree-item-inner').textContent,
      chevron: icon ? getComputedStyle(icon).display : 'missing',
      countRight: Math.abs(c.right - (r.right - 8)) < 4,
    };
  }));
  check(headers.length === 2 && headers.every((h) => h.chevron === 'none'), `section headers have no chevron (${headers.map((h) => h.chevron).join(',')})`);
  check(headers.every((h) => h.countRight), 'section counts sit at the right of the header');

  const rowBox = await run(() => {
    const row = document.querySelector('.backlink-pane .search-result-file-match');
    const r = row.getBoundingClientRect();
    return { x: r.x + 20, y: r.y + r.height / 2, h: r.height };
  });
  check(Math.abs(rowBox.h - 31.6) < 1.5, `a mention row is 31.6px tall (${rowBox.h})`);
  await move({ x: rowBox.x, y: rowBox.y });
  const hover = await run(() => {
    const row = document.querySelector('.backlink-pane .search-result-file-match');
    const button = row.querySelector('.search-result-file-match-replace-button');
    const bg = getComputedStyle(row).backgroundColor;
    const b = button ? button.getBoundingClientRect() : { width: 0, height: 0 };
    const nums = bg.match(/\d+/g)?.map(Number) ?? [];
    return { bg, tinted: nums.length >= 3 && !(nums[0] === nums[1] && nums[1] === nums[2]), bw: b.width, bh: b.height, display: button ? getComputedStyle(button).display : 'missing' };
  });
  check(hover.tinted, `a hovered mention uses the accent tint (${hover.bg})`);
  check(hover.display === 'none' || hover.bh === 0 || Math.abs(hover.bh - 25) < 0.6, `the Link button is 25px tall when it is shown (${hover.bh}, ${hover.display})`);

  const unlinkedAt = await run(() => {
    const el = [...document.querySelectorAll('.backlink-header')].find((n) => n.textContent.includes('Unlinked'));
    const r = el.getBoundingClientRect();
    return { x: r.x + 40, y: r.y + r.height / 2 };
  });
  await click(unlinkedAt);
  await wait(async () => (await run(() => [...document.querySelectorAll('.backlink-pane .search-result-file-match')].some((row) => row.textContent.includes('appears')))) , 'the unlinked row did not appear');
  const plain = await run(() => {
    const row = [...document.querySelectorAll('.backlink-pane .search-result-file-match')].find((n) => n.textContent.includes('appears'));
    const r = row.getBoundingClientRect();
    return { x: r.x + 24, y: r.y + r.height / 2, h: r.height };
  });
  await move(plain);
  const linkBtn = await run(() => {
    const row = [...document.querySelectorAll('.backlink-pane .search-result-file-match')].find((n) => n.textContent.includes('appears'));
    const button = row.querySelector('.search-result-file-match-replace-button');
    const b = button.getBoundingClientRect();
    return { h: b.height, w: b.width, display: getComputedStyle(button).display };
  });
  check(linkBtn.display === 'block' && Math.abs(linkBtn.h - 25) < 0.6 && linkBtn.w > 30 && linkBtn.w < 48, `hovering an unlinked mention shows a 25px Link button (${linkBtn.w}×${linkBtn.h}, ${linkBtn.display})`);

  const collapseAt = await run(() => {
    const el = document.querySelector('.backlink-toolbar [aria-label="Collapse results"]');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await click(collapseAt);
  check(await run(() => [...document.querySelectorAll('.backlink-pane .search-result-file-matches')].every((el) => el.hidden)), 'Collapse results folds every backlink group');

  await run(() => grove.run('global-search:open'));
  const searchAt = await run(() => {
    const el = document.querySelector('.search-view .search-input');
    const r = el.getBoundingClientRect();
    return { x: r.x + 40, y: r.y + r.height / 2 };
  });
  await click(searchAt);
  await send('Input.insertText', { text: 'zebrar27n' });
  await wait(async () => (await run(() => document.querySelectorAll('.search-view .search-result-file-match').length)) >= 2, 'search did not list both notes');
  await press('ArrowDown');
  const firstPick = await run(() => document.querySelector('.search-view .search-result-file-match.is-selected')?.dataset.previewPath ?? '');
  check(firstPick.endsWith('.md'), `ArrowDown selects the first search result (${firstPick || 'none'})`);
  await press('ArrowDown');
  const secondPick = await run(() => document.querySelector('.search-view .search-result-file-match.is-selected')?.dataset.previewPath ?? '');
  check(secondPick && secondPick !== firstPick, `a second ArrowDown moves the selection (${firstPick} -> ${secondPick})`);
  await press('ArrowUp');
  await press('Enter');
  await wait(() => run((path) => ws.active.path === path, firstPick), 'Enter did not open the selected result');

  await run(() => { ws.open('Outline.md'); grove.run('outline:open'); });
  await wait(async () => (await run(() => [...document.querySelectorAll('.outline-item .tree-item-inner')].map((el) => el.textContent).join('|'))) === 'Heading|Section|Detail', 'the outline did not list the three headings');
  check(await run(() => document.querySelector('.outline-item.is-active .tree-item-inner')?.textContent) === 'Heading', 'the outline highlights the heading at the top');
  const headChevron = await run(() => {
    const el = document.querySelector('.outline-item .collapse-icon');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await click(headChevron);
  check(await run(() => [...document.querySelectorAll('.outline-item .tree-item-inner')].map((el) => el.textContent).join('|')) === 'Heading', 'folding a heading hides its children');
  await click(headChevron);
  check(await run(() => document.querySelectorAll('.outline-item').length) === 3, 'folding the heading again shows its children');
  const collapseAll = await run(() => {
    const el = document.querySelector('.outline-toolbar [aria-label="Collapse all"]');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await click(collapseAll);
  check(await run(() => [...document.querySelectorAll('.outline-item .tree-item-inner')].map((el) => el.textContent).join('|')) === 'Heading', 'Collapse all leaves only the top heading');
  const expandAll = await run(() => {
    const el = document.querySelector('.outline-toolbar [aria-label="Expand all"]');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await click(expandAll);
  check(await run(() => document.querySelectorAll('.outline-item').length) === 3, 'Expand all shows every heading');

  const showFilter = await run(() => {
    const el = document.querySelector('.outline-toolbar [aria-label="Show search filter"]');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await click(showFilter);
  const filterAt = await run(() => {
    const el = document.querySelector('.outline-filter');
    const r = el.getBoundingClientRect();
    return { x: r.x + 20, y: r.y + r.height / 2 };
  });
  await click(filterAt);
  await send('Input.insertText', { text: 'sec' });
  check(await run(() => [...document.querySelectorAll('.outline-item .tree-item-inner')].map((el) => el.textContent).join('|')) === 'Section', 'the outline filter keeps headings whose text matches');
  await press('Backspace');
  await press('Backspace');
  await press('Backspace');
  await wait(async () => (await run(() => document.querySelectorAll('.outline-item').length)) === 3, 'clearing the filter did not restore the outline');

  const editor = await run(() => {
    const el = [...document.querySelectorAll('.cm-scroller')].find((node) => node.offsetParent && node.getBoundingClientRect().width > 80);
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: Math.min(r.bottom - 24, r.y + 120) };
  });
  await move(editor);
  let followed = '';
  for (let i = 0; i < 14 && followed !== 'Section'; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: editor.x, y: editor.y, deltaX: 0, deltaY: 280 });
    await sleep(40);
    followed = await run(() => document.querySelector('.outline-item.is-active .tree-item-inner')?.textContent ?? '');
  }
  const scrollInfo = await run(() => {
    const el = ws.view.dom.closest('.view-content');
    return { active: document.querySelector('.outline-item.is-active .tree-item-inner')?.textContent ?? '', scroll: el?.scrollTop ?? -1, room: (el?.scrollHeight ?? 0) - (el?.clientHeight ?? 0) };
  });
  check(scrollInfo.active === 'Section', `scrolling the editor follows the heading (${JSON.stringify(scrollInfo)})`);
  const headingRow = await run(() => {
    const el = [...document.querySelectorAll('.outline-item')].find((node) => node.querySelector('.tree-item-inner')?.textContent === 'Heading');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await click(headingRow);
  await wait(async () => (await run(() => document.querySelector('.outline-item.is-active .tree-item-inner')?.textContent)) === 'Heading', 'clicking a heading did not jump the editor back to it');

  await run(() => grove.run('properties:open-local'));
  await wait(async () => !!(await run(() => document.querySelector('.file-properties .property-date'))), 'file properties did not show the date');
  const rows = await run(() => {
    const height = (sel) => document.querySelector(sel)?.getBoundingClientRect().height ?? 0;
    return { note: height('.cm-content .property:has([data-type="date"])'), file: height('.file-properties .property:has([data-type="date"])') };
  });
  check(rows.file > 0 && rows.file < 40 && Math.abs(rows.file - rows.note) < 6, `the file-properties date row stays on one line (${rows.file}px, in the note ${rows.note}px)`);
}, { height: 800 });
