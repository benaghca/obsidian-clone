// Round 27d: pasted and dropped attachments, the date-property icon, and palette commands.
// Headless Chromium, real pointer and key input. Scratch vault only.
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
    const pa = Math.abs(pp - left);
    const pb = Math.abs(pp - up);
    const pc = Math.abs(pp - ul);
    return pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
  };
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride);
    p += stride;
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? cur[x - bpp] : 0;
      const up = prev[x];
      const ul = x >= bpp ? prev[x - bpp] : 0;
      const v = row[x];
      cur[x] = filter === 1 ? (v + left) & 255
        : filter === 2 ? (v + up) & 255
        : filter === 3 ? (v + ((left + up) >> 1)) & 255
        : filter === 4 ? (v + paeth(left, up, ul)) & 255
        : v;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const s = x * bpp;
      out[o] = cur[s];
      out[o + 1] = cur[s + 1];
      out[o + 2] = cur[s + 2];
      out[o + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    prev = cur;
  }
  return { w, h, out };
}

const PNG = [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,120,218,99,252,207,192,80,15,0,4,133,1,128,132,169,140,33,0,0,0,0,73,69,78,68,174,66,96,130];

await withBrowser(async ({ send, run, click, chord, press, move, fill, double, check }) => {
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  const note = '---\ndue: 2026-10-23\nwhen: 2026-10-23T20:15\n---\n\nHello grove\n';
  await run(async (note) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Round27d.md', note);
    await ws.vault.refreshFiles();
    await ws.open('Round27d.md');
    ws.setMode('live');
    document.addEventListener('paste', (event) => {
      window.lastPaste = {
        types: [...event.clipboardData.types],
        files: [...event.clipboardData.files].map((f) => `${f.name}:${f.type}:${f.size}`),
        items: [...event.clipboardData.items].map((i) => `${i.kind}:${i.type}`),
      };
    }, true);
  }, note);
  await sleep(200);

  const dateBox = await run(() => {
    const input = document.querySelector('.cm-content .property-value[data-type="date"] input');
    const icon = document.querySelector('.cm-content .property-value[data-type="date"] .property-date-icon');
    const time = document.querySelector('.cm-content .property-value[data-type="datetime"] .property-date-icon');
    const ir = input.getBoundingClientRect();
    const xr = icon.getBoundingClientRect();
    return {
      iconLeft: xr.left, iconRight: xr.right, inputLeft: ir.left, inputMid: ir.left + ir.width / 2,
      calendar: !!icon.querySelector('.lucide-calendar'),
      clock: !!time?.querySelector('.lucide-clock'),
      dates: document.querySelectorAll('.cm-content .property-date').length,
      clip: { x: ir.x, y: ir.y, width: ir.width, height: ir.height, scale: 1 },
    };
  });
  check(dateBox.dates === 2 && dateBox.calendar && dateBox.clock, 'date has a calendar and datetime a clock');
  check(dateBox.iconLeft >= dateBox.inputLeft - 1 && dateBox.iconRight < dateBox.inputMid, `calendar icon is on the left of the date input (${dateBox.iconLeft}..${dateBox.iconRight} vs ${dateBox.inputLeft})`);
  // Chromium 154 paints ::-webkit-calendar-picker-indicator but getComputedStyle reports the input, not the pseudo.
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: dateBox.clip });
  const bmp = pngPixels(Buffer.from(shot.data, 'base64'));
  const at = (x, y) => bmp.out.subarray((y * bmp.w + x) * 4, (y * bmp.w + x) * 4 + 3);
  const bg = at(bmp.w - 3, 3);
  const differs = (x0, x1) => {
    let n = 0;
    for (let y = 3; y < bmp.h - 3; y++) for (let x = x0; x < x1; x++) {
      const p = at(x, y);
      if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 48) n++;
    }
    return n;
  };
  const ink = { w: bmp.w, h: bmp.h, left: differs(4, 22), right: differs(bmp.w - 22, bmp.w - 4) };
  check(ink.left > 8 && ink.right === 0, `the native date picker icon is hidden (left ink ${ink.left}, right ink ${ink.right}, ${ink.w}x${ink.h})`);
  const iconAt = await run(() => {
    const r = document.querySelector('.cm-content .property-value[data-type="date"] .property-date-icon').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await click(iconAt);
  check(await run(() => document.activeElement?.type === 'date'), 'clicking the calendar icon focuses the date input');
  await run(() => grove.run('properties:open-local'));
  await sleep(150);
  check(await run(() => !!document.querySelector('.file-properties .property-date-icon .lucide-calendar')), 'file properties uses the same left calendar icon');

  await click('.cm-content .cm-line');
  await press('End');
  await run(async (bytes) => {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([Uint8Array.from(bytes)], { type: 'image/png' }) })]);
  }, PNG);
  await chord('v');
  let doc = '';
  for (let i = 0; i < 50; i++) {
    doc = await run(() => ws.view.state.doc.toString());
    if (/!\[\[Pasted image \d{14}\.png\]\]/.test(doc)) break;
    await sleep(50);
  }
  const pasted = /!\[\[(Pasted image \d{14}\.png)\]\]/.exec(doc);
  assert.ok(pasted, `paste saves a stamped embed (clipboard ${JSON.stringify(await run(() => window.lastPaste))})`);
  check(doc.startsWith('---\n') && doc.includes('due: 2026-10-23'), 'the paste keeps the frontmatter');
  const name = pasted[1];
  check(await run(async (name) => (await (await import('/src/api.ts')).api.listFiles()).some((f) => f.path === name), name), 'the pasted image is saved in the vault root');
  const round = await run(async (name) => {
    const { api } = await import('/src/api.ts');
    const a = new Uint8Array(await api.readFileBytes(name));
    const b = new Uint8Array(await api.readFileBytes(name));
    const head = [137, 80, 78, 71, 13, 10, 26, 10];
    return a.length > 24 && head.every((byte, i) => a[i] === byte) && a.length === b.length && a.every((byte, i) => byte === b[i]);
  }, name);
  check(round, 'the saved bytes round-trip as a png');
  const loaded = async () => {
    for (let i = 0; i < 40; i++) {
      const img = await run(() => {
        const el = document.querySelector('.cm-content .image-embed img');
        return el && el.src.startsWith('blob:') && el.closest('.image-embed').classList.contains('is-loaded');
      });
      if (img) return true;
      await sleep(50);
    }
    return false;
  };
  check(await loaded(), 'live preview renders the pasted image');
  await run(() => ws.setMode('source'));
  await sleep(150);
  check(await run((name) => ws.view.state.doc.toString().includes(`![[${name}]]`) && !document.querySelector('.image-embed'), name), 'source mode shows the embed as text');
  await run(() => ws.setMode('reading'));
  await sleep(200);
  check(await loaded(), 'reading view renders the pasted image');

  await run(() => ws.setMode('live'));
  await sleep(150);
  const body = await run(() => {
    const line = [...document.querySelectorAll('.cm-line')].find((el) => el.textContent.includes('Hello'));
    const r = line.getBoundingClientRect();
    return { x: r.x + 24, y: r.y + r.height / 2 };
  });
  await move(body);
  await run((x, y, bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(bytes)], 'dropped-shot.png', { type: 'image/png' }));
    const target = document.elementFromPoint(x, y);
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  }, body.x, body.y, PNG);
  for (let i = 0; i < 40 && !/!\[\[dropped-shot\.png\]\]/.test(await run(() => ws.view.state.doc.toString())); i++) await sleep(50);
  check(/!\[\[dropped-shot\.png\]\]/.test(await run(() => ws.view.state.doc.toString())), 'a dropped file keeps its name');
  await run(async () => {
    const { settings } = await import('/src/settings/store.ts');
    await settings.set('app.json', 'attachmentFolderPath', 'Inbox');
  });
  const dropAt = await run(() => {
    const pos = ws.view.state.doc.length;
    const r = ws.view.coordsAtPos(pos);
    return { x: r.left, y: (r.top + r.bottom) / 2 };
  });
  await move(dropAt);
  await run((x, y, bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(bytes)], 'kept-name.png', { type: 'image/png' }));
    const target = document.querySelector('.cm-content');
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  }, dropAt.x, dropAt.y, PNG);
  for (let i = 0; i < 40 && !/kept-name\.png/.test(await run(() => ws.view.state.doc.toString())); i++) await sleep(50);
  check(await run(async () => (await (await import('/src/api.ts')).api.listFiles()).some((f) => f.path === 'Inbox/kept-name.png')), 'the attachment folder setting is used');

  const names = await run(() => grove.all().map((c) => c.name));
  for (const name of ['Backlinks: Open backlinks for the current note', 'Add alias', 'Add embed', 'Add tag']) check(names.includes(name), `palette lists ${name}`);
  check(await run(() => grove.all().find((c) => c.id === 'backlink:open')?.name === 'Backlinks: Show backlinks'), 'Show backlinks keeps its name');
  await run(() => grove.run('command-palette:open'));
  await fill('.prompt-input', 'Add embed');
  check(await run(() => document.querySelector('.suggestion-item.is-selected .suggestion-title')?.textContent === 'Add embed'), 'the palette offers Add embed');
  await press('Escape');

  await run(() => ws.setMode('source'));
  await sleep(150);
  const word = await run(() => {
    const at = ws.view.state.doc.toString().lastIndexOf('grove');
    const r = ws.view.coordsAtPos(at + 2);
    return { x: r.left, y: (r.top + r.bottom) / 2 };
  });
  await double(word);
  await run(() => grove.run('editor:insert-embed'));
  check(/!\[\[grove\]\]/.test(await run(() => ws.view.state.doc.toString())), 'Add embed wraps the selection');
  await click(word);
  await press('End');
  const taggedBefore = await run(() => ws.view.state.doc.toString());
  await run(() => grove.run('editor:insert-tag'));
  const tagged = await run(() => ws.view.state.doc.toString());
  check(tagged === taggedBefore.replace(/grove\]\]/, 'grove]]#') || tagged.includes('#') && tagged.length === taggedBefore.length + 1, 'Add tag inserts a hash');
  const before = await run(() => ws.view.state.doc.toString());
  await run(() => grove.run('editor:add-alias'));
  const after = await run(() => ws.view.state.doc.toString());
  check(after.includes('aliases:\n  - ') && after !== before, 'Add alias in source writes a blank alias');
  await run(() => ws.setMode('live'));
  await sleep(200);
  await run(() => grove.run('editor:add-alias'));
  await sleep(50);
  check(await run(() => document.activeElement?.dataset.part === 'add' && document.activeElement.closest('.property')?.dataset.key === 'aliases'), 'Add alias in live preview focuses the aliases field');

  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Alpha.md', '---\ntitle: Alpha\n---\n\nAlpha body\n');
    await api.createNote('Beta.md', 'See [[Alpha]]\n');
    await ws.vault.refreshFiles();
    await ws.vault.refreshLinks();
    await ws.open('Alpha.md');
  });
  await sleep(150);
  await run(() => grove.run('backlink:open-backlinks'));
  await sleep(250);
  const tab = await run(() => ({
    title: document.querySelector('.workspace-tab-header.is-active .workspace-tab-header-inner-title')?.textContent,
    icon: !!document.querySelector('.workspace-tab-header.is-active .lucide-link'),
    header: document.querySelector('.view-header-title')?.textContent,
    mentions: document.querySelector('.backlinks-tab')?.innerText ?? '',
  }));
  check(tab.title === 'Backlinks for Alpha' && tab.header === 'Backlinks for Alpha' && tab.icon, `backlinks open in a tab for that note (${tab.title})`);
  check(tab.mentions.includes('Beta'), 'the tab lists backlinks to that note');
});
