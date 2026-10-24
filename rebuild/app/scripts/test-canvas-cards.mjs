// Part B: every interaction is a native CDP pointer/key event, never DOM click().
import { readFile, writeFile } from 'node:fs/promises';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({send, run, move, point, click, press, chord, check, shot, double, read}) => {
  const data=async()=>JSON.parse(await read());
  const last=async()=> (await data()).nodes.at(-1);
  const toolbar=label=>`.canvas-card-menu [aria-label="${label}"]`;
  await run(async()=>{
    const {api}=await import('/src/api.ts');await api.createNote('Cards.canvas','{"future":{"keep":[1,2]},"nodes":[],"edges":[]}');
    await api.createNote('CardNote.md','---\ntags: [canvas]\n---\n# Card note\nLocal content.');
    await api.createNote('CardImage.svg','<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#8b6cef"/></svg>');
    await ws.vault.refreshFiles();await ws.open('Cards.canvas');
  });await sleep(100);
  check(await run(()=>[...document.querySelectorAll('.canvas-card-menu .clickable-icon')].map(n=>n.querySelector('svg').getAttribute('class')).join(',')==='svg-icon lucide-sticky-note,svg-icon lucide-file-text,svg-icon lucide-file-image'),'Toolbar uses observed Lucide icons and order');
  for(const label of ['Drag to add card','Drag to add note from vault','Drag to add media from vault']){
    await move({x:900,y:300});await move(await point(toolbar(label)));await sleep(600);
    check(await run(label=>document.querySelector('.tooltip')?.textContent===label&&document.querySelector('.tooltip').getAnimations().length===0,label),label+': native hover shows the shared tooltip without animation');
  }
  const spot={x:610,y:310};
  const expected=await run(p=>{const r=document.querySelector('.canvas-view').getBoundingClientRect(),m=new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform);return{x:Math.round((p.x-r.x-m.e)/m.a)-125,y:Math.round((p.y-r.y-m.f)/m.a)-30};},spot);
  await double(spot);await sleep(340);
  check((await data()).nodes.length===1&&(await last()).width===250&&(await last()).height===60,'Double-click adds exactly one 250×60 card');
  check((await last()).x===expected.x&&(await last()).y===expected.y,'Double-click centers card on world-space pointer position');
  check(/^[0-9a-f]{16}$/.test((await last()).id),'New card ids use sixteen lower-case hex digits');
  check(await run(()=>document.activeElement.closest('.canvas-node.is-editing')&&document.querySelectorAll('.canvas-node .cm-editor').length===1),'New card starts in a focused CodeMirror editor');
  await send('Input.insertText',{text:'# Added card\n\n**Markdown** and [[CardNote]]\n\n- [ ] Task'});await sleep(350);
  check((await last()).text.includes('**Markdown**'),'Text editing saves Markdown through the canvas document');
  const geometry=await last();await press(' ');await send('Input.insertText',{text:'more'});await press('ArrowLeft');await press('Backspace');await sleep(350);
  check((await data()).nodes.length===1&&(await last()).x===geometry.x&&(await last()).y===geometry.y,'Typing Space, arrows and Backspace stays inside the card editor');
  check(await run(()=>[...document.querySelectorAll('.canvas-node .cm-content > *')].every(n=>{const s=getComputedStyle(n);return parseFloat(s.marginTop)===0&&parseFloat(s.marginBottom)===0;})),'Nested card editor keeps zero direct-child vertical margins');
  const transform=await run(()=>document.querySelector('.canvas-world').style.transform),scrollAt=await point('.canvas-node.is-editing');await move(scrollAt);await send('Input.dispatchMouseEvent',{type:'mouseWheel',...scrollAt,deltaX:0,deltaY:140});await sleep(70);
  check(await run(before=>document.querySelector('.canvas-node.is-editing .canvas-node-content').scrollTop>0&&document.querySelector('.canvas-world').style.transform===before,transform),'Wheel scrolls long text while editing without panning the board');
  await press('Escape');await sleep(50);
  check(await run(()=>!document.querySelector('.canvas-node.is-editing')&&!!document.querySelector('.canvas-node .cm-strong')),'Escape ends editing and renders Markdown');
  const a=(await last()).id, card=`[data-node-id="${a}"]`;
  await double(card);await chord('a');await send('Input.insertText',{text:'Edited again'});await click({x:1100,y:650});await sleep(350);
  check((await last()).text==='Edited again'&&!await run(()=>!!document.querySelector('.canvas-node.is-editing')),'Double-click reopens text; click away ends and saves');
  await chord('z');await sleep(350);check((await last()).text.startsWith('# Added card'),'Board undo restores the preceding text-edit session');
  await press('Z',10);await sleep(350);check((await last()).text==='Edited again','Board redo restores edited text');
  const original=await read();await double(card);await press('Escape');await sleep(350);check(await read()===original,'Entering/leaving unchanged text does not rewrite canvas bytes');
  const addAt=await point(toolbar('Drag to add card'));await click(addAt);await press('Escape');await sleep(350);
  const count=(await data()).nodes.length;
  // Same stationary pointer, no intervening move.
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...addAt,button:'left',clickCount:1});await press('Escape');await sleep(350);
  check((await data()).nodes.length===count+1,'Repeated stationary toolbar clicks each add exactly one text card');
  await click(toolbar('Drag to add note from vault'));check(await run(()=>!!document.querySelector('.prompt')&&document.querySelector('.prompt').getAnimations().length===0),'Note button opens the existing instant prompt');
  await send('Input.insertText',{text:'CardNote'});await click('.suggestion-item');await sleep(350);
  check((await last()).type==='file'&&(await last()).file==='CardNote.md'&&(await last()).width===400&&(await last()).height===400,'Native note picker adds a 400×400 file card');
  await double(`[data-node-id="${(await last()).id}"]`);check(await run(()=>!!document.querySelector('.canvas-note-editor')),'Note cards edit in place on double-click');await press('Escape');await sleep(80);
  await click(toolbar('Drag to add media from vault'));
  check(await run(()=>[...document.querySelectorAll('.suggestion-item')].every(n=>/\.(svg|png|jpe?g|gif|webp|bmp|avif)$/i.test(n.textContent))),'Media picker lists images/SVG only');
  await send('Input.insertText',{text:'CardImage.svg'});await click('.suggestion-item');await sleep(400);
  check((await last()).file==='CardImage.svg'&&(await last()).width===400&&(await last()).height===200,'Native media picker fits image aspect ratio inside 400×400');
  check(await run(()=>!!document.querySelector('.canvas-node-file img[src^="blob:"]')),'Added media uses the local blob path');
  check((await data()).future.keep.join(',')==='1,2','Adding and editing preserve unknown root fields');
  const beforeCancel=await read();await click(toolbar('Drag to add note from vault'));await press('Escape');await sleep(350);check(await read()===beforeCancel,'Dismissing a picker does not edit the canvas');
  await click(toolbar('Drag to add note from vault'));await press('Escape');
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...await point(toolbar('Drag to add note from vault')),button:'left',clickCount:1});check(await run(()=>!!document.querySelector('.prompt')),'Stationary repeated note button click reopens the picker');await press('Escape');
  await click(toolbar('Drag to add media from vault'));await press('Escape');
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...await point(toolbar('Drag to add media from vault')),button:'left',clickCount:1});check(await run(()=>!!document.querySelector('.prompt')),'Stationary repeated media button click reopens the picker');await press('Escape');
  // Open an editor, type, then leave before the debounce expires.
  await run(async()=>{const{api}=await import('/src/api.ts');await api.createNote('FlushText.canvas',JSON.stringify({nodes:[{id:'flush',type:'text',x:0,y:0,width:250,height:100,text:'Before'}],edges:[]}));await ws.vault.refreshFiles();await ws.open('FlushText.canvas');});await sleep(80);
  await double('[data-node-id="flush"]');check(await run(()=>!!document.querySelector('.canvas-node.is-editing')),'Flush scenario begins in a visible card editor');await chord('a');await send('Input.insertText',{text:'Persist when leaving'});await run(()=>ws.open('Welcome.md'));await sleep(100);
  check(await run(async()=>{const{api}=await import('/src/api.ts');return JSON.parse(await api.readNote('FlushText.canvas')).nodes[0].text==='Persist when leaving';}),'Leaving with a text editor open flushes its pending Markdown');
  await run(async()=>{const{api}=await import('/src/api.ts');await api.createNote('Created.canvas','{}');await ws.vault.refreshFiles();await ws.open('Created.canvas');});await sleep(70);
  await double({x:620,y:330});await send('Input.insertText',{text:'# Part B\n\n**Edited** card'});await press('Escape');await sleep(350);
  const created=await read();await chord('z');await sleep(350);check((await last()).text==='','Undo text edit leaves the newly added empty card');await chord('z');await sleep(350);check(await read()==='{}','Undo addition restores the original empty canvas bytes');await press('Z',10);await press('Z',10);await sleep(350);check(await read()===created,'Redo addition and text restores the saved card and id');
  const from=await point(toolbar('Drag to add card')),drop={x:950,y:580};await move(from);await send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});for(let i=1;i<=10;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(drop.x-from.x)*i/10,y:from.y+(drop.y-from.y)*i/10,buttons:1});await sleep(20);}await send('Input.dispatchMouseEvent',{type:'mouseReleased',...drop,button:'left',clickCount:1});await press('Escape');await sleep(350);check((await data()).nodes.length===2,'Real toolbar drag adds exactly one card at release');await chord('z');await sleep(350);
  const outside={x:1000,y:48},start=await point(toolbar('Drag to add card'));await move(start);await send('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});for(let i=1;i<=8;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+(outside.x-start.x)*i/8,y:start.y+(outside.y-start.y)*i/8,buttons:1});await sleep(20);}await send('Input.dispatchMouseEvent',{type:'mouseReleased',...outside,button:'left',clickCount:1});await sleep(350);check((await data()).nodes.length===1,'Toolbar drag released outside the canvas does not add a card');
  await click('.canvas-node');await shot('grove-partb');await writeFile(new URL('../../round24-shots/Grove-partb.canvas',import.meta.url),await read());
  const obs=await readFile(new URL('../../round24-shots/Obsidian-partb.canvas',import.meta.url),'utf8');await run(async text=>{const{api}=await import('/src/api.ts');await api.createNote('FromObsB.canvas',text);await ws.vault.refreshFiles();await ws.open('FromObsB.canvas');},obs);await sleep(150);
  check(await run(expected=>expected.nodes.every(n=>{const el=document.querySelector(`[data-node-id="${n.id}"]`);return el&&['x','y','width','height'].every(k=>parseFloat(el.style[{x:'left',y:'top',width:'width',height:'height'}[k]])===n[k]);}),JSON.parse(obs)),'Obsidian-edited cards open with identical geometry');
  check(await read()===obs,'Opening the Part B Obsidian fixture preserves exact bytes');
}, {height:800,screenshots:new URL('../../round24-shots/',import.meta.url).pathname});
