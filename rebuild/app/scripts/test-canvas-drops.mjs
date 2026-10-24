// Native pointer drags only; the in-memory vault never touches an owner's files.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async({run,send,point,move,click,press,chord,open,read,check,shot,double})=>{
 const row=path=>`.nav-files .tree-item-self[data-path=${JSON.stringify(path)}]`;
 const data=async()=>JSON.parse(await read());
 const last=async()=>(await data()).nodes.at(-1);
 const world=p=>run(p=>{const r=document.querySelector('.canvas-view').getBoundingClientRect(),m=new DOMMatrix(getComputedStyle(document.querySelector('.canvas-world')).transform);return{x:Math.round((p.x-r.x-m.e)/m.a),y:Math.round((p.y-r.y-m.f)/m.a)};},p);
 const begin=async(a,b)=>{
  if(typeof a==='string')a=await point(a);
  await move(a);await send('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',buttons:1,clickCount:1});
  for(let i=1;i<=12;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/12,y:a.y+(b.y-a.y)*i/12,button:'left',buttons:1});await sleep(17);}
 };
 const release=async p=>{await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await sleep(400);};
 const drag=async(a,b)=>{await begin(a,b);await release(b);};
 const save=async name=>{if(process.env.GROVE_UPDATE_CANVAS_FIXTURES)await writeFile(new URL(`../../round27-shots/Grove-${name}.canvas`,import.meta.url),await read());};
 await run(async()=>{const{api}=await import('/src/api.ts');await api.createFolder('A DropFolder');await api.createNote('A DropNote.md','---\ntags: [canvas]\n---\n# Heading\nBody');await api.createNote('A DropImage.svg','<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="orange"/></svg>');await ws.vault.refreshFiles();});
 const base='{"future":{"keep":[1,2]},"nodes":[{"opaque":"keep","id":"a","type":"text","x":0,"y":0,"width":250,"height":160,"text":"Source"}],"edges":[]}';
 await open('Drop.canvas',base);
 const p={x:750,y:300},expected=await world(p);
 await begin(row('A DropNote.md'),p);
 check(await run(()=>!!document.querySelector('.canvas-view.is-file-drop')&&!!document.querySelector('.drag-ghost')&&!document.querySelector('.drag-ghost-destination:not([hidden])')),'Explorer drag reaches the canvas with the shared ghost and no Move into destination');
 await shot('grove-explorer-drag');await release(p);
 let n=await last();assert.deepEqual([n.x,n.y,n.width,n.height,n.file],[expected.x,expected.y,400,400,'A DropNote.md']);
 check(true,'Note drop places a 400×400 card with its top-left at the world-space pointer');await save('explorer-note');
 check(await run(()=>document.querySelector('.canvas-note-title')?.textContent==='A DropNote'&&getComputedStyle(document.querySelector('.canvas-note-title')).fontSize==='25.888px'&&getComputedStyle(document.querySelector('.canvas-note-title')).fontWeight==='700'),'Note retains a bold internal title above the rendered Markdown');
 const after=await read();await chord('z');await sleep(350);check(await read()===base,'One undo restores exact bytes before explorer drop');await press('Z',10);await sleep(350);check(await read()===after,'Redo restores the same dropped card and metadata');
 await click(`[data-node-id="${n.id}"] .canvas-note-title`);await double(`[data-node-id="${n.id}"] .canvas-note-title`);await sleep(350);
 check(await read()===after&&await run(()=>ws.active.type==='canvas'&&!document.querySelector('.canvas-node.is-editing')),'Title clicks and double-clicks are display only and keep the canvas unchanged');
 const over={x:p.x+30,y:p.y+90};await drag(row('A DropNote.md'),over);n=await last();const overWorld=await world(over);
 check((await data()).nodes.length===3&&n.x===overWorld.x&&n.y===overWorld.y,'Dropping on an existing card adds a separate overlapping card');await save('explorer-on-card');await chord('z');await sleep(350);
 const imageAt={x:600,y:560},imageWorld=await world(imageAt);await drag(row('A DropImage.svg'),imageAt);n=await last();
 check(n.file==='A DropImage.svg'&&n.x===imageWorld.x&&n.y===imageWorld.y&&n.width===400&&n.height===200,'Image drop preserves aspect ratio within 400×400 at the pointer');await save('explorer-image');
 check(await run(()=>!!document.querySelector('.canvas-node-file img[src^="blob:"]')&&document.querySelectorAll('.canvas-note-title').length===1),'Images use local blobs and have no note title');
 const unchanged=await read();await drag(row('A DropFolder'),{x:1050,y:250});check(await read()===unchanged,'Folder drop leaves the canvas and folder unchanged');
 await drag(row('A DropNote.md'),{x:1050,y:44});check(await read()===unchanged,'Drop outside the canvas adds nothing');
 await begin(row('A DropNote.md'),p);await press('Escape');await release(p);check(await read()===unchanged&&await run(()=>!document.querySelector('.is-file-drop,.drag-ghost,.is-being-dragged-over')&&!document.body.classList.contains('is-grabbing')),'Escape mid-drag removes temporary state and writes nothing');
 await click('.canvas-controls [aria-label="Canvas settings"]');
 await click('.menu-item:nth-child(3)');await drag(row('A DropNote.md'),p);check(await read()===unchanged,'Read-only canvas refuses explorer drops');
 await click('.canvas-controls [aria-label="Canvas settings"]');await click('.menu-item:nth-child(3)');
 check((await data()).future.keep.join(',')==='1,2'&&Object.keys((await data()).nodes[0])[0]==='opaque','Explorer actions preserve unknown fields and original key order');
 await shot('grove-explorer-cards');
}, {screenshots:new URL('../../round27-shots/',import.meta.url).pathname});
