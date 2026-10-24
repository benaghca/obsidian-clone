// Native pointer drags only; the in-memory vault never touches an owner's files.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
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
 const dot=async side=>{await move(await point('[data-node-id="a"]'));return point(`[data-node-id="a"] [data-side="${side}"]`);};
 const empty=async(side='right',timed=false)=>{
  const a=await dot(side),b={x:a.x+(side==='left'?-150:side==='right'?150:60),y:a.y+(side==='top'?-150:side==='bottom'?150:60)};
  await begin(a,b);
  if(timed)await run(()=>document.addEventListener('pointerup',()=>{window.addTiming={visible:0,max:0};let last=performance.now(),frame=0;function tick(t){frame++;addTiming.max=Math.max(addTiming.max,t-last);last=t;if(!addTiming.visible&&document.querySelector('.canvas-add-menu'))addTiming.visible=frame;if(frame<19)requestAnimationFrame(tick);}requestAnimationFrame(tick);},{once:true,capture:true}));
  await release(b);return b;
 };
 for(const side of ['top','right','bottom','left']){
  await open('Connect-'+side+'.canvas',base);const b=await empty(side,true),p=await world(b);
  check(await read()===base&&await run(()=>[...document.querySelectorAll('.canvas-add-menu .menu-item-title')].map(e=>e.textContent).join('|')==='Add card|Add note from vault'&&!document.querySelector('.canvas-add-menu svg')),'Empty '+side+' drop opens the observed two-row menu without changing bytes');
  const t=await run(()=>addTiming);check(t.visible>0&&t.visible<=2&&t.max<20,`Add card menu opens within two frames; max ${t.max.toFixed(1)}ms`);
  check(await run(()=>document.querySelector('.canvas-add-menu').getAnimations().length===0&&document.querySelector('.canvas-edge-preview').style.display!=='none'),'Pending menu has no animation and keeps the connection preview');
  if(side==='right')await shot('grove-add-menu');
  await double('.canvas-add-menu .menu-item:first-child');await press('Escape');await sleep(350);const d=await data(),n=d.nodes.at(-1),e=d.edges[0];
  const toSide=({top:'bottom',right:'left',bottom:'top',left:'right'})[side];
  assert.deepEqual([n.x,n.y],[p.x-(side==='left'?250:side==='right'?0:125),p.y-(side==='top'?60:side==='bottom'?0:30)]);
  check(d.nodes.length===2&&d.edges.length===1&&n.type==='text'&&e.fromNode==='a'&&e.toNode===n.id&&e.fromSide===side&&e.toSide===toSide,'Double-click Add card creates exactly one card and edge, aligned to the '+toSide+' side');
  check(Object.keys(e).join(',')==='id,fromNode,fromSide,toNode,toSide'&&/^[0-9a-f]{16}$/.test(e.id),'Connected edge uses native key order, defaults and id');await save('connected-'+side);
  const created=await read();await chord('z');await sleep(350);check(await read()===base,'One undo removes the connected card and edge together');await chord('y');await sleep(350);check(await read()===created,'Redo restores both connected records with unchanged ids');
 }
 await open('ConnectedFiles.canvas',base);
 for(const [file,width,height] of [['A DropNote.md',400,400],['A DropImage.svg',400,200]]){
  await empty();await double('.canvas-add-menu .menu-item:nth-child(2)');
  check(await read()===base,'Double-click Add note never creates a background card');
  if(!await run(()=>!!document.querySelector('.prompt'))){await empty();await click('.canvas-add-menu .menu-item:nth-child(2)');}
  check(await run(()=>!!document.querySelector('.prompt')&&document.querySelector('.prompt').getAnimations().length===0),'Add note reuses the existing instant picker');
  await send('Input.insertText',{text:file.replace(/\.md$/,'')});await click('.suggestion-item');await sleep(400);const d=await data(),n=d.nodes.at(-1);
  check(d.nodes.length===2&&d.edges.length===1&&n.file===file&&n.width===width&&n.height===height&&d.edges[0].toNode===n.id,'Connection vault picker adds '+file+' with the observed dimensions and one edge');await save(file.endsWith('.md')?'connected-note':'connected-media');
  await chord('z');await sleep(350);check(await read()===base,'Connected file and edge share one undo checkpoint');
 }
 await empty();await press('Escape');check(await read()===base&&await run(()=>!document.querySelector('.canvas-add-menu')&&document.querySelector('.canvas-edge-preview').style.display==='none'),'Escape dismisses Add card and its preview without a file change');
 await empty();await click({x:1100,y:820});check(await read()===base&&await run(()=>!document.querySelector('.canvas-add-menu')),'Click away cancels the pending connection');
 await empty();await click('.canvas-add-menu .menu-item:nth-child(2)');await press('Escape');check(await read()===base,'Cancelling the vault picker leaves no dangling card or edge');
 const reload=async source=>{await run(async source=>{const{api}=await import('/src/api.ts');await api.writeNote(ws.active.viewFile,source);ws.vault.written(ws.active.viewFile);},source);await sleep(100);};
 const external=base.replace('Source','External');
 await empty();await reload(external);check(await read()===external&&await run(()=>!document.querySelector('.canvas-add-menu')),'External canvas reload disposes a pending Add card menu');await reload(base);
 await empty();await click('.canvas-add-menu .menu-item:nth-child(2)');await reload(external);await send('Input.insertText',{text:'A DropNote'});await click('.suggestion-item');await sleep(350);check(await read()===external,'A stale vault picker cannot overwrite a reloaded canvas');await reload(base);
 await empty();await press('Escape');await empty();check(await run(()=>!!document.querySelector('.canvas-add-menu')),'Repeating the same empty drop reopens the menu');await press('Escape');
 await click('[data-node-id="a"]');await double('.canvas-selection-menu [aria-label="Set color"]');check((await data()).nodes.length===1,'Double-clicking a selection toolbar after Add card never adds a background card');await press('Escape');
 const long='A very long note title that should wrap within the canvas card';
 await run(async title=>{const{api}=await import('/src/api.ts');await api.createNote(title+'.md','Body paragraph');await ws.vault.refreshFiles();},long);
 await open('Title.canvas',{nodes:[{id:'title',type:'file',file:long+'.md',x:0,y:0,width:250,height:400}],edges:[]});const titleBytes=await read();
 const titleState=()=>run(()=>{const e=document.querySelector('.canvas-note-title'),r=e.getBoundingClientRect(),card=e.closest('.canvas-node').getBoundingClientRect(),s=getComputedStyle(e);return{text:e.textContent,h:r.height,left:r.left-card.left,w:r.width,cardWidth:card.width,size:parseFloat(s.fontSize),height:parseFloat(s.lineHeight),space:s.whiteSpace,overflow:s.textOverflow};});
 const title=await titleState();check(title.text===long&&title.h>title.height*2&&title.space==='pre-wrap'&&title.overflow==='clip'&&Math.abs(title.left-17)<1,'Long note titles wrap at the card inset without truncation');
 await click('.canvas-note-title');await click('[aria-label="Zoom in"]');await click('[aria-label="Zoom in"]');const zoomed=await titleState();
 check(Math.abs(zoomed.h/title.h-2)<.01&&zoomed.size===25.888&&await read()===titleBytes,'Selecting and zooming a note scales its header with the card and never changes JSON');await shot('grove-note-header');
 const large=await readFile(new URL('../../round23-shots/Large.canvas',import.meta.url),'utf8');await open('DropLarge.canvas',large,500);await click('[aria-label="Reset zoom"]');await sleep(400);
 await run(()=>{window.dropFrames=[];window.dropRecording=true;let last=performance.now();function tick(t){if(!dropRecording)return;dropFrames.push(t-last);last=t;requestAnimationFrame(tick);}requestAnimationFrame(tick);});
 await begin(row('A DropNote.md'),{x:650,y:350});
 for(let i=0;i<24;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:650+i*8,y:350+i%2*10,button:'left',buttons:1});await sleep(18);}
 await press('Escape');await release({x:834,y:360});const frames=await run(()=>{dropRecording=false;return dropFrames.slice(2);});
 check(frames.length>30&&Math.max(...frames)<20,`300-card/400-edge explorer drag stays under 20ms; max ${Math.max(...frames).toFixed(1)}ms`);
 check(await read()===large&&await run(()=>!document.querySelector('.is-file-drop,.is-explorer-dragging,.drag-ghost')),'Large-board explorer cancellation preserves all bytes and removes drag state');
 await open('SplitDrop.canvas',base);await run(()=>ws.open('Welcome.md',{where:'right'}));await sleep(150);await click('.workspace-tabs.mod-active .cm-content');
 const splitAt=await run(()=>{const r=document.querySelector('.canvas-view').getBoundingClientRect();return{x:r.x+50,y:r.y+100};});await drag(row('A DropNote.md'),splitAt);
 check(await run(()=>ws.active.viewFile==='SplitDrop.canvas'&&document.activeElement.matches('.canvas-view')),'An explorer drop into an inactive canvas pane activates and focuses that canvas');
 await chord('z');await sleep(350);check(await read()===base,'Immediate Undo after an inactive-pane drop restores that canvas alone');
}, {screenshots:new URL('../../round27-shots/',import.meta.url).pathname});
