// Round 27m: datetime shares the date calendar and left padding, the date
// glyph is the small faint one, date separators are faint, and the sidebar
// tab row has a bottom line with the ribbon starting under it. Headless
// Chromium, real pointer input. Scratch vault only.
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { withBrowser, sleep } from './browser.mjs';

/** 8-bit RGB or RGBA PNG to pixels. Chromium's screenshot is one of those. */
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
      out[(y * w + x) * 4] = cur[s];
      out[(y * w + x) * 4 + 1] = cur[s + 1];
      out[(y * w + x) * 4 + 2] = cur[s + 2];
    }
    prev = cur;
  }
  return { w, h, out };
}

/** Columns of a date field whose ink is faint (a separator) or dark (a digit). */
function separatorColumns(buf) {
  const { w, h, out } = pngPixels(buf);
  const faint = [];
  const dark = [];
  const y0 = Math.floor(h * 0.3);
  const y1 = Math.ceil(h * 0.7);
  for (let x = 24; x < w - 4; x++) {
    let min = 255;
    for (let y = y0; y <= y1; y++) min = Math.min(min, out[(y * w + x) * 4]);
    if (min < 110) dark.push(x);
    else if (min >= 150 && min <= 210) faint.push(x);
  }
  return { faint: faint.length, dark: dark.length };
}

const note = `---
due: 2026-10-23
when: 2026-10-23T20:15:30
plain: hello
---
# Heading

## Section

### Detail

See [[Welcome]] in a frontmatter note.
`;

await withBrowser(async ({ send, run, move, click, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 80; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Dates.md', body);
    await api.createNote('Other.md', 'Dates is mentioned here as plain text.\n');
    await ws.vault.refreshFiles();
    await ws.open('Dates.md');
  }, note);

  const chrome = await run(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const value = (type) => document.querySelector(`.cm-content .property-value[data-type="${type}"]`);
    const field = (type) => {
      const root = value(type);
      const input = root.querySelector('input');
      const svg = root.querySelector('.property-date-icon svg');
      const vx = root.getBoundingClientRect().x;
      const sr = svg.getBoundingClientRect();
      const pad = getComputedStyle(input).padding;
      const rect = input.getBoundingClientRect();
      return {
        pad,
        clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
        glyph: { x: sr.x - vx, y: sr.y, w: sr.width, h: sr.height, color: getComputedStyle(svg).color },
      };
    };
    const header = document.querySelector('.mod-left-split > .workspace-tab-header-container');
    const ribbon = document.querySelector('.workspace-ribbon');
    const toggle = ribbon.querySelector('.sidebar-toggle-button');
    return {
      date: field('date'),
      time: field('datetime'),
      headerBorder: getComputedStyle(header).borderBottomWidth,
      headerColor: getComputedStyle(header).borderBottomColor,
      ribbon: box(ribbon),
      toggle: box(toggle),
      actionY: box(document.querySelector('.side-dock-ribbon-action')).y,
    };
  });
  const rgb = (c) => c.replace(/\s/g, '');
  check(chrome.date.glyph.w === 11 && chrome.date.glyph.h === 12 && Math.abs(chrome.date.glyph.x - 7.5) < 0.6, `the date glyph is 11×12 at x+7.5 (${chrome.date.glyph.w}×${chrome.date.glyph.h} at +${chrome.date.glyph.x})`);
  check(rgb(chrome.date.glyph.color) === 'rgb(126,126,126)', `the date glyph is a readable grey (${chrome.date.glyph.color})`);
  check(chrome.time.glyph.w === 11 && Math.abs(chrome.time.glyph.x - 7.5) < 0.6 && chrome.time.pad === '4px 8px 4px 24px', `datetime has the same glyph and 24px left padding (${chrome.time.pad}, glyph +${chrome.time.glyph.x})`);
  for (const kind of ['date', 'time']) {
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: chrome[kind].clip });
    const ink = separatorColumns(Buffer.from(shot.data, 'base64'));
    check(ink.faint >= 4 && ink.dark >= 8, `${kind} separators are faint and the numbers stay dark (${ink.faint} faint columns, ${ink.dark} dark)`);
  }
  check(chrome.headerBorder === '1px' && rgb(chrome.headerColor) === 'rgb(228,228,228)', `the sidebar tab row has a 1px bottom line (${chrome.headerBorder} ${chrome.headerColor})`);
  check(Math.abs(chrome.ribbon.y - 40) < 0.6 && Math.abs(chrome.ribbon.w - 44) < 0.6 && Math.abs(chrome.ribbon.h - 760) < 1, `the ribbon starts under the tab row (${chrome.ribbon.x},${chrome.ribbon.y} ${chrome.ribbon.w}×${chrome.ribbon.h})`);
  check(Math.abs(chrome.toggle.w - 44) < 0.6 && chrome.toggle.h === 39 && Math.abs(chrome.toggle.y) < 0.6 && Math.abs(chrome.actionY - 48) < 1, `the sidebar toggle is 44×39 in the row above, and an action stays at y=48 (${chrome.toggle.w}×${chrome.toggle.h} at ${chrome.toggle.y}, action ${chrome.actionY})`);

  const iconAt = await run(() => {
    const el = document.querySelector('.cm-content .property-value[data-type="datetime"] .property-date-icon');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await click(iconAt);
  check(await run(() => document.activeElement?.type === 'datetime-local' && document.activeElement.value === '2026-10-23T20:15:30'), 'clicking the datetime glyph focuses the clock and keeps the seconds');

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
    const body = await run(() => ws.view.state.doc.toString());
    check(body.includes('due: 2026-10-23') && body.includes('# Heading'), `${mode}: two clicks at one point leave the note intact`);
  }

  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Pair.md', 'See Dates and Dates on one line.\n');
    await ws.vault.refreshFiles();
    await ws.open('Dates.md');
  });
  await run(() => grove.run('backlink:open'));
  const unlinkedAt = () => run(() => {
    const dock = document.querySelector('.mod-right-split')?.getBoundingClientRect();
    if (!dock || dock.width < 200) return null;
    const el = [...document.querySelectorAll('.backlink-pane .backlink-header')].find((n) => n.textContent.includes('Unlinked'));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.left < dock.left - 1) return null;
    return { x: r.x + Math.min(48, r.width / 2), y: r.y + r.height / 2 };
  });
  await wait(async () => !!(await unlinkedAt()), 'the backlinks pane did not open');
  await click(await unlinkedAt());
  const secondMention = () => run(() => {
    const rows = [...document.querySelectorAll('.backlink-pane .search-result-file-match')];
    const missing = rows.map((n) => {
      const hit = n.querySelector('.search-result-file-matched-text');
      return `${JSON.stringify(hit?.previousSibling?.textContent ?? null)}|${hit?.textContent ?? ''}`;
    }).join(' || ').slice(0, 300);
    const row = rows.find((n) => n.querySelector('.search-result-file-matched-text')?.previousSibling?.textContent === 'See Dates and ');
    if (!row) return { missing };
    const r = row.getBoundingClientRect();
    const button = row.querySelector('.search-result-file-match-replace-button');
    const b = button.getBoundingClientRect();
    return { x: r.x + 24, y: r.y + r.height / 2, label: button.textContent, display: getComputedStyle(button).display, bx: b.x + b.width / 2, by: b.y + b.height / 2, bw: b.width, missing };
  });
  let mention = null;
  for (let i = 0; i < 80 && !mention?.label; i++) { mention = await secondMention(); await sleep(25); }
  check(mention?.label === 'Link', 'a line with two mentions shows a row for each');
  check(mention.display === 'none', 'the Link button stays hidden until the row is hovered');
  await move({ x: mention.x, y: mention.y });
  const shown = await secondMention();
  check(shown.label === 'Link' && shown.display === 'block' && shown.bw > 0, 'hovering a mention shows its Link button');
  await click({ x: shown.bx, y: shown.by });
  await wait(async () => (await run(async () => { const { api } = await import('/src/api.ts'); return api.readNote('Pair.md'); })) === 'See Dates and [[Dates]] on one line.\n', 'Link did not wrap only the second Dates');
  check(await run(() => ws.active.path === 'Dates.md'), 'Link leaves the open note where it was');

  await run(() => ws.open('Other.md', { where: 'tab' }));
  const inactive = await run(() => {
    const el = [...document.querySelectorAll('.mod-root .workspace-tab-header')].find((n) => !n.classList.contains('is-active'));
    const r = el.getBoundingClientRect();
    return { x: r.x + 16, y: r.y + r.height / 2 };
  });
  await click(inactive, 'right');
  const shape = await run(() => [...document.querySelector('.menu').children].map((n) => n.classList.contains('menu-separator') ? '---' : n.querySelector('.menu-item-title')?.textContent));
  check(shape.slice(0, 9).join('|') === 'Close|Close others|Close tabs after|Close all|---|Pin|Link with tab...|---|Move to new window', `an inactive tab offers Move to new window (${shape.slice(0, 9).join('|')})`);
  const moveItem = await run(() => {
    const el = [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-item-title')?.textContent === 'Move to new window');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: el.classList.contains('is-disabled') };
  });
  check(!moveItem.disabled, 'Move to new window is enabled on an inactive file tab');
  await click(moveItem);
  await wait(() => run(() => document.querySelectorAll('.mod-root .workspace-tab-header').length === 1 && ws.active.path === 'Other.md'), 'Move to new window did not leave the other tab');
}, { height: 800 });
