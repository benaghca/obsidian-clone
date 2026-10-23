// Read-only Canvas regressions on the mock vault; native CDP pointer input.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withBrowser, sleep } from './browser.mjs';
const fixture = await readFile(new URL('../../round23-shots/Reference.canvas', import.meta.url), 'utf8');
await withBrowser(async ({ send, run, click, point, move, chord, press, check, shot }) => {
  await run(async fixture => {
    const { api } = await import('/src/api.ts');
    const source = JSON.parse(fixture); source.future = { keep: ['field', 'order'] }; source.nodes.push({id:'future',type:'future',payload:42});
    window.canvasOriginal = JSON.stringify(source, null, 2) + '\n';
    for (const [path, text] of Object.entries({ 'Reference.canvas': canvasOriginal, 'Note.md': '---\ntags: [canvas]\n---\n# Note card\nA **rendered** note with [[Target]].\n\n## Section\nHeading destination.\n', 'Target.md': '# Target\nLocal link destination.', 'CanvasFrontmatter.md': '---\ntags: [canvas]\n---\n\n# Frontmatter\n\nBody.\n' })) await api.createNote(path, text);
    await ((await api.listFiles()).some(f=>f.path === 'diagram.svg') ? api.writeNote : api.createNote)('diagram.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="120"><rect width="220" height="120" fill="#8b6cef"/><circle cx="110" cy="60" r="40" fill="#fff"/></svg>');
    await ws.vault.refreshFiles();
  }, fixture);
  await click('.nav-files [data-path="Reference.canvas"]'); await sleep(200);
  check(await run(() => ws.active.type === 'canvas' && ws.active.path === null && !ws.editors.isLoaded('Reference.canvas')), 'Canvas opens outside the saving editor');
  check(await run(() => document.querySelector('.nav-files [data-path="Reference.canvas"] .lucide-layout-dashboard') && document.querySelector('.workspace-tab-header.is-active .lucide-layout-dashboard')), 'Explorer and tab use the canvas icon');
  check(await run(() => document.querySelector('.view-header-title').textContent === 'Reference'), 'Canvas has the normal header');
  check(await run(() => document.querySelectorAll('.canvas-node').length === 11 && document.querySelectorAll('.canvas-edges > path').length === 16), 'All known card types and side/end edges render; future nodes are skipped');
  check(await run(() => document.querySelector('[data-node-id="text0"] .cm-strong') && !document.querySelector('.canvas-view iframe')), 'Text uses Reading rendering and link cards have no iframe');
  check(await run(() => document.querySelector('[data-node-id="note"]').textContent.includes('Heading destination.') && !document.querySelector('[data-node-id="note"]').textContent.includes('tags:')), 'Note cards render body without frontmatter');
  check(await run(() => !!document.querySelector('[data-node-id="image"] img[src^="blob:"]')), 'Image/SVG cards use local blob URLs');
  check(await run(() => document.querySelector('[data-node-id="link"] a').textContent === 'https://example.invalid/no-fetch' && !document.querySelector('[data-node-id="link"] a').hasAttribute('href')), 'Link card displays only URL text without a fetching target');
  await shot('grove-canvas');
  const p = await point('[data-node-id="text0"] [data-href="Target"]'); await click(p); await sleep(80);
  check(await run(() => ws.active.path === 'Target.md'), 'Real mouse click follows text-card wikilinks');
  await chord('o'); await send('Input.insertText', {text:'Reference.canvas'}); await sleep(80);
  check(await run(() => document.querySelector('.suggestion-content')?.textContent.includes('Reference.canvas')), 'Quick switcher lists canvas attachments');
  await press('Enter'); await sleep(100);
  check(await run(() => ws.active.type === 'canvas'), 'Quick switcher opens canvas');
  await click('[data-node-id="text0"] input');
  check(await run(async () => { const { api } = await import('/src/api.ts'); return await api.readNote('Reference.canvas') === canvasOriginal; }), 'Opening, rendering and task clicks keep original bytes and unknown fields');
  for (const source of ['', '{}', '{', '{"nodes":[null,{"id":"bad","type":"text","width":"oops"}],"edges":[null,{}]}']) {
    await run(async source => { const { api } = await import('/src/api.ts'); await api.writeNote('Damaged.canvas', source); await ws.vault.refreshFiles(); await ws.open('Damaged.canvas'); }, source); await sleep(50);
    check(await run(() => !!document.querySelector('.canvas-view')), 'Damaged/empty canvas opens without crashing: ' + source.slice(0, 25));
  }
  const ribbon = '.side-dock-ribbon-action[aria-label="Create new canvas"]';
  await move({x:800,y:780}); await move(await point(ribbon)); await sleep(600);
  check(await run(() => document.querySelector('.tooltip')?.textContent === 'Create new canvas' && document.querySelector('.tooltip').getAnimations().length === 0), 'Canvas ribbon has the observed instant styled tooltip');
  const createAt = await point(ribbon); await click(createAt); await sleep(60);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', {type, ...createAt, button:'left', clickCount:1});
  await sleep(100);
  check(await run(async () => { const {api}=await import('/src/api.ts'); return ws.active.viewFile === 'Untitled 1.canvas' && await api.readNote('Untitled.canvas') === '{"nodes":[],"edges":[]}' && await api.readNote('Untitled 1.canvas') === '{"nodes":[],"edges":[]}'; }), 'Repeated stationary canvas clicks create numbered valid empty canvases and open them');
  assert.deepEqual(await run(() => [...document.querySelectorAll('.side-dock-ribbon-action')].map(e=>e.getAttribute('aria-label'))), ['Open quick switcher','Open graph view','Create new canvas',"Open today's daily note",'Insert template','Open command palette']);
  check(await run(async () => { const {commands}=await import('/src/commands.ts'); return commands.isEnabled('random-note') && commands.isEnabled('file-explorer:new-file'); }), 'Fresh ribbon order matches Obsidian; random/new-note commands remain');
  await chord('p'); await send('Input.insertText', {text:'Create new canvas'}); await sleep(60); await press('Enter'); await sleep(100);
  check(await run(() => ws.active.viewFile === 'Untitled 2.canvas'), 'Palette command creates and opens a canvas');
  await click('.nav-files [data-path="Projects"]', 'right'); await sleep(50);
  const newCanvasAt = await run(() => { const row=[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.includes('New canvas'));const r=row.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; });
  await click(newCanvasAt); await sleep(100);
  check(await run(() => ws.active.viewFile === 'Projects/Untitled.canvas' && document.querySelector('.view-header-breadcrumb')?.textContent === 'Projects'), 'Explorer New canvas follows folder context and shows breadcrumb');
  for (const mode of ['live', 'source', 'reading']) {
    await run(async mode => { await ws.open('CanvasFrontmatter.md'); ws.setMode(mode); ws.view.dispatch({selection:{anchor:ws.view.state.doc.length}}); ws.view.focus(); }, mode); await sleep(80);
    if (mode !== 'reading') {
      await send('Input.insertText', {text:'[[Reference.canvas'}); await sleep(150);
      check(await run(() => [...document.querySelectorAll('.cm-completionLabel')].some(e => e.textContent === 'Reference.canvas')), mode + ': canvas offered as attachment in wikilink suggestions');
      await press('Enter');
      check(await run(() => ws.view.state.doc.toString().includes('[[Reference.canvas]]')), mode + ': accepts canvas attachment');
    }
    const tip = '.side-dock-ribbon-action[aria-label="Open quick switcher"]';
    await move({ x: 800, y: 780 }); await move(await point(tip)); await sleep(600);
    check(await run(() => document.querySelector('.tooltip')?.textContent.includes('Open quick switcher')), mode + ': real hover works on frontmatter note');
    const at = await point(tip); await click(at); await press('Escape');
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', {type, ...at, button:'left', clickCount:1});
    check(await run(() => !!document.querySelector('.prompt')), mode + ': repeated stationary ribbon click opens prompt'); await press('Escape');
  }
}, { height: 800, screenshots: new URL('../../round23-shots/', import.meta.url).pathname });
