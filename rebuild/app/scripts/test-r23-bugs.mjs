// Round 23 confirmed-bug regressions, based on the Obsidian observations.
// All hover, click and key interactions use native CDP input.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const failures = [];
const check = (ok, message) => {
  if (ok) console.log('PASS', message);
  else { console.log('FAIL', message); failures.push(message); }
};

const long = ['---', 'tags: [r23]', '---', '', '# Top', 'ABOVE the destination.', ...Array.from({ length: 8 }, (_, i) => `Filler line ${i} stays above the heading.`), '', '## Destination', 'Arrived at destination.', '', 'Block line one.', 'Block line two. ^bid', '', '```', 'Code literal ^code', '```', 'Escaped \\^literal', '', '## Later', 'After the destination.'].join('\n');
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
    { id: 'block', type: 'file', file: 'Long.md', subpath: '#^bid', x: 1200, y: 400, width: 280, height: 180 },
    { id: 'rgb', type: 'text', text: 'rgb', color: 'rgb(10 20 30 / .5)', x: 1400, y: 200, width: 100, height: 50 },
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

await withBrowser(async ({ run, click, press, move, point, send }) => {
  await run(async (board, long) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Long.md', long);
    window.originalBugsCanvas = JSON.stringify({ ...board, future: { keep: [1, 2, 3] } }, null, 2) + "\n";
    await api.createNote('Bugs.canvas', originalBugsCanvas);
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

  const innerPoint = await point('[data-node-id="inner"] .canvas-group-label');
  await move(innerPoint); await click(innerPoint);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...innerPoint, button: 'left', clickCount: 1 });
  check(await run(p => document.elementFromPoint(p.x,p.y)?.textContent === 'Inner', innerPoint), 'real hover and repeated stationary clicks keep the earlier label above later groups');

  const colors = await run(() => Object.fromEntries(['abc', 'hex8', 'named', 'hex6', 'rgb'].map(id => {
    const el = document.querySelector(`[data-node-id="${id}"]`);
    return [id, el.style.getPropertyValue('--canvas-color')];
  })));
  for (const id of ['abc', 'hex8', 'named', 'rgb']) check(colors[id] && colors[id] !== 'var(--background-modifier-border-focus)', `${id} keeps a custom color, got ${colors[id]}`);
  check(colors.hex6?.toLowerCase() === '#ff0000', `#FF0000 still colors the card, got ${colors.hex6}`);

  check(note.includes('Arrived at destination'), `the subpath card shows the destination section, got ${JSON.stringify(note.slice(0, 180))}`);
  check(!note.includes('Filler line 0'), `a heading subpath omits the lines above that heading, got ${JSON.stringify(note.slice(0, 180))}`);
  check(!note.includes('After the destination'), `a heading subpath stops before the next heading, got ${JSON.stringify(note.slice(0, 240))}`);
  check(!note.includes('^bid'), `the block id is not visible in the file card, got ${JSON.stringify(note)}`);

  check(note.includes('Code literal ^code') && note.includes('^literal'), 'code and escaped caret literals stay visible');
  const block = await run(() => document.querySelector('[data-node-id="block"] .canvas-node-content').textContent);
  check(block.includes('Block line one.') && block.includes('Block line two.') && !block.includes('Arrived') && !block.includes('^bid'), 'block subpath reuses the selected paragraph without its metadata');

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
  const choose = async title => {
    const p = await run(title => { const el=[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.trim()===title); if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; },title);
    assert.ok(p, 'Menu item exists: '+title);await click(p);await sleep(100);
  };
  check(await run(()=>getComputedStyle(document.querySelector('.menu')).animationName==='none'), 'canvas context menu has no opening animation');
  const tabCount = await run(()=>ws.layout.tabs().length);
  await choose('Open in new tab');
  check(await run(n=>ws.active.type==='canvas'&&ws.active.viewFile==='Bugs.canvas'&&ws.layout.tabs().length===n+1,tabCount), 'native menu click opens another canvas tab');
  await click('.nav-files [data-path="Bugs.canvas"]','right');await choose('Rename...');
  check(await run(()=>document.activeElement?.isContentEditable), 'native Rename menu action starts explorer editing');
  await send('Input.insertText',{text:'Renamed23'});await press('Enter');await sleep(100);
  check(await run(()=>ws.active.viewFile==='Renamed23.canvas'&&ws.layout.tabs().filter(t=>t.viewFile==='Renamed23.canvas').length===2&&!ws.vault.files.some(f=>f.path==='Renamed23.md')), 'menu rename keeps .canvas and updates both open tabs');
  for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'F2',code:'F2',windowsVirtualKeyCode:113});
  check(await run(()=>document.activeElement?.isContentEditable), 'native F2 starts canvas rename');
  await send('Input.insertText',{text:'F2Canvas23'});await press('Enter');await sleep(100);
  check(await run(()=>ws.active.viewFile==='F2Canvas23.canvas'), 'F2 commit retains the canvas extension');
  for(let i=1;i<=2;i++){
    await click('.nav-files [data-path="F2Canvas23.canvas"]','right');await choose('Make a copy');
    check(await run(async i=>{const{api}=await import('/src/api.ts');const path=`F2Canvas23 ${i}.canvas`;return ws.active.viewFile===path&&await api.readNote(path)===originalBugsCanvas&&!ws.editors.isLoaded(path);},i), 'native Make a copy '+i+' numbers .canvas and preserves original bytes outside the saving editor');
  }
  check(await run(async()=>{const{api}=await import('/src/api.ts');return await api.readNote('F2Canvas23.canvas')===originalBugsCanvas}), 'rename/copy leave source JSON unchanged');
  await run(async()=>{const{api}=await import('/src/api.ts');await api.createNote('Stage23FM.md','---\ntags: [stage23]\n---\n# Heading\n\nBody.');await ws.vault.refreshFiles()});
  for(const mode of ['live','source','reading']){
    await run(async mode=>{await ws.open('Stage23FM.md');ws.setMode(mode)},mode);await sleep(70);
    const selector='.side-dock-ribbon-action[aria-label="Open quick switcher"]';
    await move({x:800,y:780});const p=await point(selector);await move(p);await sleep(600);
    check(await run(()=>document.querySelector('.tooltip')?.textContent==='Open quick switcher'&&document.querySelector('.tooltip').getAnimations().length===0),mode+': native hover on frontmatter note shows tooltip without motion');
    await click(p);await press('Escape');
    for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});
    check(await run(()=>!!document.querySelector('.prompt')&&document.querySelector('.prompt').getAnimations().length===0),mode+': repeated stationary click opens switcher without animation');await press('Escape');
  }
});

assert.deepEqual(failures, []);
