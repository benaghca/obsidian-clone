// Round 23 bugs. These checks assert behavior observed in Obsidian 1.14.4.
// Each failing check failed on the hunter baseline. App code is unchanged.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const failures = [];
const check = (ok, message) => {
  if (ok) console.log('PASS', message);
  else { console.log('FAIL', message); failures.push(message); }
};

const long = ['---', 'tags: [r23]', '---', '', '# Top', 'ABOVE the destination.', ...Array.from({ length: 8 }, (_, i) => `Filler line ${i} stays above the heading.`), '', '## Destination', 'Arrived at destination.', '', 'Block line one.', 'Block line two. ^bid', '', '## Later', 'After the destination.'].join('\n');
const board = {
  nodes: [
    { id: 'inner', type: 'group', x: 400, y: 220, width: 280, height: 180, label: 'Inner', color: '4' },
    { id: 'outer', type: 'group', x: 340, y: 140, width: 420, height: 340, label: 'Outer', color: '1' },
    { id: 'nolabel', type: 'group', x: 40, y: 40, width: 180, height: 120, color: '2' },
    { id: 'emptylabel', type: 'group', x: 40, y: 220, width: 180, height: 120, label: '', color: '2' },
    { id: 'plain', type: 'group', x: 40, y: 400, width: 180, height: 120, label: 'No color' },
    { id: 'top', type: 'text', x: 100, y: 520, width: 200, height: 100, text: 'Top card' },
    { id: 'bot', type: 'text', x: 100, y: 780, width: 200, height: 100, text: 'Bottom card' },
    { id: 'left', type: 'text', x: 1400, y: 40, width: 180, height: 80, text: 'Left' },
    { id: 'right', type: 'text', x: 1700, y: 40, width: 180, height: 80, text: 'Right' },
    { id: 'note', type: 'file', file: 'Long.md', subpath: '#Destination', x: 900, y: 200, width: 280, height: 180 },
    { id: 'abc', type: 'text', text: 'abc', color: '#abc', x: 900, y: 40, width: 100, height: 50 },
    { id: 'hex8', type: 'text', text: 'hex8', color: '#11223380', x: 1020, y: 40, width: 100, height: 50 },
    { id: 'named', type: 'text', text: 'named', color: 'red', x: 1140, y: 40, width: 100, height: 50 },
    { id: 'hex6', type: 'text', text: 'hex6', color: '#FF0000', x: 1260, y: 40, width: 100, height: 50 },
  ],
  edges: [
    { id: 'vertical', fromNode: 'top', toNode: 'bot' },
    { id: 'horizontal', fromNode: 'left', toNode: 'right' },
  ],
};

await withBrowser(async ({ run, click, press }) => {
  await run(async (board, long) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Long.md', long);
    await api.createNote('Bugs.canvas', JSON.stringify(board));
    await ws.vault.refreshFiles();
    await ws.open('Bugs.canvas');
  }, board, long);
  let note = '';
  for (let i = 0; i < 40 && !note.includes('Arrived'); i++) {
    await sleep(50);
    note = await run(() => document.querySelector('[data-node-id="note"]')?.innerText ?? '');
  }

  const paths = await run(() => Object.fromEntries([...document.querySelectorAll('.canvas-edges > path')].map(p => {
    const d = p.getAttribute('d');
    return [d.startsWith('M1580') || d.startsWith('M1400') ? 'horizontal' : d.includes('570') || d.includes('620') || d.includes('560') ? 'vertical' : d.slice(0, 12), d];
  })));
  const vertical = Object.values(paths).find(d => d.startsWith('M300') || d.startsWith('M200,620') || d.startsWith('M200 620')) ?? Object.values(paths).join(' | ');
  check(/^M200[, ]620\b/.test(vertical), `omitted sides on a vertical stack leave the bottom center, got ${vertical}`);
  const horizontal = Object.values(paths).find(d => d.startsWith('M1580')) ?? '';
  check(horizontal.startsWith('M1580,80') || horizontal.startsWith('M1580 80'), `omitted sides on a horizontal pair still leave the right center, got ${horizontal}`);

  const labels = await run(() => {
    const info = (id) => {
      const el = document.querySelector(`[data-node-id="${id}"] .canvas-group-label`);
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return { w: r.width, h: r.height, display: s.display, text: el.textContent, color: s.color, bg: s.backgroundColor };
    };
    const label = document.querySelector('[data-node-id="inner"] .canvas-group-label').getBoundingClientRect();
    const hit = document.elementFromPoint(label.x + 8, label.y + label.height / 2);
    return {
      nolabel: info('nolabel'),
      empty: info('emptylabel'),
      plain: info('plain'),
      hit: { cls: (hit?.className?.toString?.() || hit?.tagName || '').slice(0, 80), text: (hit?.textContent || '').slice(0, 20) },
    };
  });
  check(labels.nolabel.display === 'none' || labels.nolabel.w === 0, `a group with no label has no pill, got ${JSON.stringify(labels.nolabel)}`);
  check(labels.empty.display === 'none' || labels.empty.w === 0, `a group with an empty label has no pill, got ${JSON.stringify(labels.empty)}`);
  check(labels.plain.color !== 'rgb(255, 255, 255)', `an uncolored group label uses dark text, got ${labels.plain.color} on ${labels.plain.bg}`);
  check(labels.hit.cls.includes('canvas-group-label') && labels.hit.text.includes('Inner'), `the inner group label stays above the later outer group, hit ${JSON.stringify(labels.hit)}`);

  const colors = await run(() => Object.fromEntries(['abc', 'hex8', 'named', 'hex6'].map(id => {
    const el = document.querySelector(`[data-node-id="${id}"]`);
    return [id, el.style.getPropertyValue('--canvas-color')];
  })));
  for (const id of ['abc', 'hex8', 'named']) check(colors[id] && colors[id] !== 'var(--background-modifier-border-focus)', `${id} keeps a custom color, got ${colors[id]}`);
  check(colors.hex6?.toLowerCase() === '#ff0000', `#FF0000 still colors the card, got ${colors.hex6}`);

  check(note.includes('Arrived at destination'), `the subpath card shows the destination section, got ${JSON.stringify(note.slice(0, 180))}`);
  check(!note.includes('Filler line 0'), `a heading subpath omits the lines above that heading, got ${JSON.stringify(note.slice(0, 180))}`);
  check(!note.includes('After the destination'), `a heading subpath stops before the next heading, got ${JSON.stringify(note.slice(0, 240))}`);
  check(!note.includes('^bid'), `the block id is not visible in the file card, got ${JSON.stringify(note)}`);

  const grid = await run(() => getComputedStyle(document.querySelector('.canvas-view')).backgroundImage);
  check(/circle at 0(?:\.7px)? 0(?:\.7px)?/.test(grid), `grid dots sit on the cell corner, image=${grid}`);

  const row = await run(() => {
    const r = document.querySelector('.nav-files [data-path="Bugs.canvas"]').getBoundingClientRect();
    return { x: r.x + 24, y: r.y + r.height / 2 };
  });
  await click(row, 'right');
  await sleep(40);
  const menu = await run(() => [...document.querySelectorAll('.menu-item')].map(e => e.textContent.trim()));
  check(menu.includes('Rename...'), `canvas file menu can rename, got ${JSON.stringify(menu)}`);
  check(menu.includes('Open in new tab'), `canvas file menu can open in a new tab, got ${JSON.stringify(menu)}`);
  await press('Escape');
});

assert.deepEqual(failures, []);
