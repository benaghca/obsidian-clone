#!/usr/bin/env node
// Builds the static canvas-zoom mockups (HTML + PNG) in this folder, like
// kanban-mockups/build.mjs: Lucide path data from the app's own `lucide`
// dependency is written into each page, so the pages are plain HTML/CSS with
// no scripts and no external assets. PNGs come from headless Chromium's
// --screenshot (no window). Obsidian behaviour comes only from Chris's
// screenshots and Obsidian's public Canvas help page; none of its code or assets.
//
//   node rebuild/canvas-zoom-mockups/build.mjs        (from the repo root)

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '../app');
const lucide = createRequire(join(app, 'package.json'))('lucide');
const { findBrowser } = await import(join(app, 'scripts/browser.mjs'));

const pascal = name => name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
const icon = (name, cls = '') => {
  const node = lucide[pascal(name)];
  if (!node) throw new Error(`no icon ${name}`);
  return `<svg class="i ${cls}" viewBox="0 0 24 24">${node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('')}</svg>`;
};
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const colors = { 1: 'var(--color-red)', 2: 'var(--color-orange)', 3: 'var(--color-yellow)', 4: 'var(--color-green)', 5: 'var(--color-cyan)', 6: 'var(--color-purple)' };

// A made-up weekly-planning board. World units, like a .canvas file.
const image = `<svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b5b7a"/><stop offset="1" stop-color="#d9a066"/></linearGradient></defs><rect width="400" height="260" fill="url(#sky)"/><circle cx="300" cy="90" r="34" fill="#f4d58d"/><path d="M0 200 L90 120 L170 190 L250 110 L400 220 L400 260 L0 260Z" fill="#2c3e35"/><path d="M0 230 L120 170 L220 235 L320 180 L400 240 L400 260 L0 260Z" fill="#1d2a24"/></svg>`;
const board = [
  { id: 'g1', type: 'group', x: -40, y: -60, w: 900, h: 560, color: 4, label: 'This week' },
  { id: 'g2', type: 'group', x: 940, y: -60, w: 620, h: 560, color: 6, label: 'Reading' },
  { id: 'a', type: 'file', x: 0, y: 0, w: 400, h: 400, title: '2026-03-21-Saturday', body: ['## Saturday, March 21, 2026', '### Daily Intention & Gratitude', 'What is one thing I am grateful for?', '- Coffee with Sam', '- [ ] Walk by the river'] },
  { id: 'b', type: 'text', x: 440, y: 0, w: 380, h: 180, color: 1, title: 'Fix sync conflict', body: ['## Fix sync conflict', 'Two devices wrote **Inbox.md** at once.', '- [ ] Reproduce with two vaults'] },
  { id: 'c', type: 'text', x: 440, y: 220, w: 380, h: 180, color: 3, title: 'Ideas for the trip', body: ['## Ideas for the trip', 'Lisbon in May? Check [[Holiday budget]].'] },
  { id: 'd', type: 'file', x: 980, y: 0, w: 400, h: 260, image: true, title: 'river-sketch.png' },
  { id: 'e', type: 'link', x: 980, y: 300, w: 400, h: 160, url: 'https://jsoncanvas.org/spec/1.0/', title: 'jsoncanvas.org' },
  { id: 'f', type: 'file', x: 1420, y: 0, w: 120, h: 160, pdf: true, title: 'Lease agreement.pdf' },
  { id: 'h', type: 'file', x: 0, y: 600, w: 400, h: 400, title: 'Home', body: ['## Home', '**Today:** run *Open today’s daily note* from the command palette (Ctrl+P), or click the calendar icon in the left ribbon.', 'Anything unsorted goes in the *Inbox* folder.'] },
  { id: 'i', type: 'text', x: 460, y: 600, w: 380, h: 200, color: 5, title: 'Questions for Thursday', body: ['## Questions for Thursday', '1. Who owns the release notes?', '2. Can the canvas zoom ship first?'] },
  { id: 'j', type: 'text', x: 980, y: 600, w: 380, h: 120, title: 'Groceries: oats, lemons, coffee', body: ['Groceries: oats, lemons, coffee'] },
];
const edges = [['a', 'b'], ['a', 'c'], ['b', 'd'], ['h', 'i'], ['i', 'j'], ['c', 'e']];
const node = id => board.find(n => n.id === id);
const extent = { left: -40, top: -100, right: 1560, bottom: 1000 };

// Markdown-ish body lines, as Reading view would show them.
function bodyHtml(n) {
  if (n.image) return `<div class="img">${image}</div>`;
  if (n.pdf) return `<div class="pdf">${icon('file')}<span>Lease agreement.pdf</span></div>`;
  if (n.type === 'link') return `<div class="body"><a>${n.url}</a></div>`;
  const md = l => esc(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/\[\[(.+?)\]\]/g, '<a>$1</a>');
  return `<div class="body">${n.type === 'file' ? `<div class="note-title">${n.title}</div>` : ''}${n.body.map(l =>
    l.startsWith('### ') ? `<h3>${md(l.slice(4))}</h3>` : l.startsWith('## ') ? `<h2>${md(l.slice(3))}</h2>` : l.startsWith('- [ ] ') ? `<div class="li"><span class="box"></span>${md(l.slice(6))}</div>` : l.startsWith('- ') ? `<div class="li">• ${md(l.slice(2))}</div>` : `<p>${md(l)}</p>`).join('')}</div>`;
}
function curve(a, b, s, ox, oy) {
  const p = [(a.x + a.w) * s + ox, (a.y + a.h / 2) * s + oy], q = [b.x * s + ox, (b.y + b.h / 2) * s + oy];
  const right = b.x >= a.x + a.w;
  const [p2, q2] = right ? [p, q] : [[(a.x + a.w / 2) * s + ox, (a.y + a.h) * s + oy], [(b.x + b.w / 2) * s + ox, b.y * s + oy]];
  const d = right ? Math.max(30 * s, (q2[0] - p2[0]) / 2) : Math.max(30 * s, (q2[1] - p2[1]) / 2);
  return right ? `M${p2} C${p2[0] + d},${p2[1]} ${q2[0] - d},${q2[1]} ${q2}` : `M${p2} C${p2[0]},${p2[1] + d} ${q2[0]},${q2[1] - d} ${q2}`;
}
// One board panel. style: 'today' (Grove now), 'full' (proposed, full content), or an LOD option 'A'|'B'|'C'.
function panel(w, h, s, style, { cx, cy } = {}) {
  cx ??= (extent.left + extent.right) / 2; cy ??= (extent.top + extent.bottom) / 2;
  const ox = w / 2 - cx * s, oy = h / 2 - cy * s;
  let grid = 20 * s; while (grid < 10) grid *= 2;
  const lod = /^[ABC]$/.test(style), proposed = style !== 'today';
  const edgeSvg = `<svg class="edges" width="${w}" height="${h}">${edges.map(([f, t]) => `<path d="${curve(node(f), node(t), s, ox, oy)}" stroke-width="${proposed ? 1.5 : Math.max(.2, 2 * s)}"/>`).join('')}</svg>`;
  const cards = board.map(n => {
    const box = `left:${n.x * s + ox}px;top:${n.y * s + oy}px;width:${n.w * s}px;height:${n.h * s}px;${n.color ? `--c:${colors[n.color]};` : ''}`;
    const cls = `card ${n.type}${n.color ? ' colored' : ''}`;
    if (n.type === 'group') {
      const label = lod || proposed ? `<div class="glabel p" style="font-size:${lod ? 14 : Math.max(13, 22.5 * s)}px">${n.label}</div>` : `<div class="glabel" style="font-size:${22.5 * s}px;padding:${4 * s}px ${8 * s}px">${n.label}</div>`;
      return `<div class="${cls}" style="${box}">${label}</div>`;
    }
    if (!lod) {
      const fileLabel = n.type === 'file' && !proposed ? `<div class="flabel" style="font-size:${14 * s}px">${n.title}</div>` : '';
      return `<div class="${cls}" style="${box}">${fileLabel}<div class="world" style="width:${n.w}px;height:${n.h}px;transform:scale(${s})">${bodyHtml(n)}</div></div>`;
    }
    if (n.image) return `<div class="${cls} lod" style="${box}"><div class="img">${image}</div></div>`;
    // Cards under ~26 px tall or ~50 px wide on screen: boxes only.
    const tiny = n.h * s < 26 || n.w * s < 50, one = n.h * s < 38 ? ' one' : '';
    const glyph = n.type === 'link' ? 'globe' : n.pdf ? 'file' : n.type === 'file' ? 'file-text' : 'sticky-note';
    const title = tiny ? '' : style === 'A' ? `<div class="t${one}">${n.title}</div>`
      : style === 'B' ? `<div class="t left${one}">${n.title}</div>${n.h * s > 70 ? `<div class="hint">${'<i></i>'.repeat(Math.min(4, Math.floor((n.h * s - 40) / 12)))}</div>` : ''}`
      : `<div class="t left${one}">${icon(glyph, 'tiny')}<span>${n.title}</span></div>`;
    return `<div class="${cls} lod ${style}" style="${box}">${title}</div>`;
  }).join('');
  return `<div class="board ${proposed ? 'proposed' : 'today'}" style="width:${w}px;height:${h}px;background-size:${grid}px ${grid}px;background-position:${ox}px ${oy}px">${edgeSvg}${cards}<div class="zoom">${Math.round(s * 100)}%</div></div>`;
}
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="canvas.css"></head><body>${body}</body></html>`;
const cell = (head, inner, note = '') => `<div class="cell"><div class="head">${head}</div>${inner}${note ? `<div class="note">${note}</div>` : ''}</div>`;

const pages = {
  // 1. Card definition, today vs proposed, at the same zooms (Chris's addendum 1).
  'definition': page('Card definition', `<h1>Card definition: today vs proposed, same board, same zoom</h1>
    <div class="grid3">${[0.62, 0.36, 0.2].map(s => cell(`Today · ${Math.round(s * 100)}%`, panel(400, 300, s, 'today'))).join('')}</div>
    <div class="grid3">${[0.62, 0.36, 0.2].map(s => cell(`Proposed · ${Math.round(s * 100)}%`, panel(400, 300, s, s < 0.45 ? 'A' : 'full'))).join('')}</div>
    <p class="legend">Proposed: cards sit on a raised fill (one step lighter than the canvas), keep a 1&nbsp;px screen border at every zoom, and coloured cards keep a full-strength 1.5&nbsp;px colour border with a light tint. Group fills stay faint, with a 1&nbsp;px colour outline. Edges keep 1.5&nbsp;px on screen. Below 45% (the right two) cards switch to their titles.</p>`),
  // 2. The three zoomed-out looks side by side.
  'lod-options': page('Zoomed-out options', `<h1>Zoomed-out look: three options (board at 25%)</h1>
    <div class="grid3">${cell('A · Title only (recommended)', panel(400, 330, 0.25, 'A'), 'Title centred and bold on the card fill. Closest to Chris’s Obsidian screenshot; nothing to read but the title.')}
    ${cell('B · Title + faint content hint', panel(400, 330, 0.25, 'B'), 'Title top-left, then grey bars standing in for the lines below. Says “there is more here” but adds noise.')}
    ${cell('C · Title + type icon', panel(400, 330, 0.25, 'C'), 'Title top-left after a note / text / link / file icon. Useful on mixed boards, busier than A.')}</div>
    <p class="legend">In every option: images stay as pictures, groups keep their fill and show their label at a readable 14&nbsp;px, the faint file label above note cards is dropped (the title is inside), and edges keep 1.5&nbsp;px.</p>`),
  // 3. Threshold behaviour and the per-type states.
  'threshold': page('Zoom threshold', `<h1>When cards switch, and what each type shows</h1>
    <div class="strip">${[[0.7, 'full'], [0.5, 'full'], [0.4, 'A'], [0.18, 'A'], [0.0625, 'A']].map(([s, st]) => cell(`${Math.round(s * 1000) / 10}%${st === 'A' ? (s < 0.1 ? ' · mostly boxes' : ' · title only') : ' · full content'}`, panel(240, 200, s, st, { cx: 640, cy: 230 }))).join('')}</div>
    <div class="band"><div class="bar"><span class="full">full content</span><span class="title">title only</span><span class="box">boxes only</span></div>
      <div class="marks"><span style="left:63%">zooming out: switch at 45%</span><span style="left:52%" class="up">zooming in: switch back at 55%</span><span style="left:88%">card under ~26 px tall: title hidden</span></div></div>
    <table class="types"><tr><th>Card type</th><th>Full (≥ 55%, or above 45% when zooming out)</th><th>Zoomed out (&lt; 45%)</th></tr>
      <tr><td>Note (file .md)</td><td>Rendered note, title on top</td><td>Note name, centred and bold</td></tr>
      <tr><td>Text card</td><td>Rendered Markdown</td><td>First heading, or the first line with Markdown stripped</td></tr>
      <tr><td>Image</td><td>Image</td><td>Same image (already a picture; decoded once)</td></tr>
      <tr><td>Link card</td><td>URL text (no fetching)</td><td>Host name, e.g. jsoncanvas.org</td></tr>
      <tr><td>Other file (PDF…)</td><td>“Unsupported file” line</td><td>File name</td></tr>
      <tr><td>Group</td><td>Fill + label above it</td><td>Fill + label above it at 14 px on screen</td></tr>
      <tr><td>Card being edited</td><td colspan="2">Never switches while its editor is open</td></tr></table>`),
  // 4. Ctrl+drag to create (addendum 3).
  'ctrl-drag': page('Ctrl+drag create', `<h1>Ctrl+drag on empty canvas: draw a box, then choose what goes there</h1>
    <div class="grid2">${cell('Today: Ctrl+drag draws a plain selection box', `<div class="board proposed" style="width:600px;height:400px;background-size:20px 20px">${'<div class="selbox" style="left:60px;top:60px;width:330px;height:190px"></div>'}<div class="zoom">100%</div></div>`, 'Same as a plain drag: selects cards inside, then disappears.')}
    ${cell('Proposed', `<div class="board proposed" style="width:600px;height:400px;background-size:20px 20px"><div class="drawbox" style="left:60px;top:60px;width:330px;height:190px"></div>
      <div class="menu" style="left:392px;top:252px">${[['sticky-note', 'Add card'], ['file-text', 'Add note from vault'], ['file-image', 'Add media from vault'], ['globe', 'Add web page'], ['group', 'Create group']].map(([g, t]) => `<div class="mi">${icon(g)}${t}</div>`).join('')}</div><div class="zoom">100%</div></div>`,
      'Accent outline + light accent fill while dragging. On release the menu opens at the corner; the new card or group takes exactly the box’s position and size. Esc or a click elsewhere cancels.')}</div>`),
  // 5. Empty-canvas right-click (addendum 4).
  'context-menu': page('Canvas context menu', `<h1>Right-click on empty canvas</h1>
    <div class="grid2">${cell('Today', `<div class="board proposed" style="width:600px;height:400px;background-size:20px 20px"><div class="cursor" style="left:150px;top:90px"></div><div class="nothing">No menu: the app blocks the browser menu and the canvas only shows one when something is selected.</div></div>`)}
    ${cell('Proposed', `<div class="board proposed" style="width:600px;height:400px;background-size:20px 20px"><div class="cursor" style="left:150px;top:60px"></div>
      <div class="menu" style="left:152px;top:62px">${[['sticky-note', 'Add card'], ['file-text', 'Add note from vault'], ['file-image', 'Add media from vault'], ['globe', 'Add web page'], ['group', 'Create group'], '|', ['undo-2', 'Undo'], '|', ['clipboard-paste', 'Paste'], '|', ['grid-2x2', 'Snap to grid', 'check'], ['scan-line', 'Snap to objects', 'check'], ['lock', 'Read-only']].map(x => x === '|' ? '<div class="sep"></div>' : `<div class="mi${x[2] === 'off' ? ' off' : ''}">${icon(x[0])}${x[1]}${x[2] === 'check' ? `<span class="chk">${icon('check')}</span>` : ''}</div>`).join('')}</div></div>`,
      'Items add at the pointer. The snap toggles and Read-only are the same settings as the gear menu. In Read-only, the add items, Create group and Paste are hidden.')}</div>`),
};

for (const [name, html] of Object.entries(pages)) writeFileSync(join(here, `${name}.html`), html);
const browser = findBrowser();
if (!browser) throw new Error('no Chromium found (set GROVE_BROWSER)');
for (const name of Object.keys(pages)) {
  execFileSync(browser, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1280,800', `--screenshot=${join(here, `${name}.png`)}`, `file://${join(here, `${name}.html`)}`], { stdio: 'ignore' });
  console.log(`${name}.png`);
}
