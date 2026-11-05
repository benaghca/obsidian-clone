// CZ3: lazy bodies, shared origins, bounded opening/settles, culling and teardown.
import assert from 'node:assert/strict';
import { frameFixture, withBrowser, sleep } from './browser.mjs';
await withBrowser(async({run,send,click,press,check})=>{
 const wait=async(test,label)=>{for(let i=0;i<800;i++){if(await test())return;await sleep(15);}assert.fail(label);};
 const settle=()=>wait(()=>run(()=>window.__canvasProbe?.().pending===0),'work drains');
 const zoom=async scale=>{await wait(()=>run(()=>!!document.querySelector('.canvas-world')?.style.transform),'viewport measured');await run(scale=>{const el=document.querySelector('.canvas-view'),r=el.getBoundingClientRect(),s=new DOMMatrix(el.querySelector('.canvas-world').style.transform).a;el.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,cancelable:true,deltaY:-300*Math.log2(scale/s),clientX:r.left+r.width/2,clientY:r.top+r.height/2}));},scale);await sleep(180);await settle();};
 const snapshot=()=>run(()=>({ ...__canvasProbe(), bodies:document.querySelectorAll('.canvas-node-content > .cm-line').length, hit:document.querySelectorAll('.canvas-edge-hit').length, ends:document.querySelectorAll('.canvas-edge-end').length, batch:document.querySelectorAll('.canvas-edge-batch').length, culled:document.querySelectorAll('.canvas-node.is-culled').length }));
 // Connected title-mode cards update their vector batch before pointer release.
 await run(async()=>{const{api}=await import('/src/api.ts');await api.createNote('Drag-title.canvas',JSON.stringify({nodes:[{id:'a',type:'text',text:'A',x:0,y:0,width:250,height:160},{id:'b',type:'text',text:'B',x:450,y:0,width:250,height:160}],edges:[{id:'ab',fromNode:'a',toNode:'b'}]}));await ws.vault.refreshFiles();await ws.open('Drag-title.canvas');});
 await wait(()=>run(()=>window.__canvasProbe?.().built),'drag board built');await zoom(.4);await wait(()=>run(()=>!!document.querySelector('.canvas-edge-batch')),'initial title batch');
 const drag=await run(()=>{const el=document.querySelector('[data-node-id="a"]'),r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,d:document.querySelector('.canvas-edge-batch').getAttribute('d')};});
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:drag.x,y:drag.y,button:'left',clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.x+40,y:drag.y+30,button:'left',buttons:1});
 await sleep(25);
 check(await run(d=>document.querySelector('.canvas-edge-batch').getAttribute('d')!==d,drag.d),'Title-mode connected edge follows a native drag before pointer release');
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:drag.x+40,y:drag.y+30,button:'left',clickCount:1});await settle();
 await run(async()=>{
  const oldWatch=ws.embeds.watch;window.cz3watches=0;ws.embeds.watch=(...args)=>{cz3watches++;const off=oldWatch.apply(ws.embeds,args);let live=true;return()=>{if(live){live=false;cz3watches--;off();}};};
  const {api}=await import('/src/api.ts');await api.createNote('Lazy.md','# Shared note\noriginal');
  window.cz3source=JSON.stringify({nodes:Array.from({length:3000},(_,i)=>({id:`n${i}`,type:i%5?'text':'file',...(i%5?{text:`## Card ${i}\n**body** [[Welcome]]`}:{file:'Lazy.md'}),x:i%60*280,y:Math.floor(i/60)*190,width:250,height:160})),edges:Array.from({length:4000},(_,i)=>({id:`e${i}`,fromNode:`n${i%3000}`,toNode:`n${(i*7+1)%3000}`,color:String(i%6+1),label:i%25===0?'edge':undefined}))});
  await api.createNote('Lazy.canvas',cz3source);await ws.vault.refreshFiles();
  window.cz3long=[];window.cz3observer=new PerformanceObserver(list=>cz3long.push(...list.getEntries().map(e=>e.duration)));cz3observer.observe({type:'longtask'});
  window.cz3start=performance.now();await ws.open('Lazy.canvas');
 });
 await wait(()=>run(()=>document.querySelectorAll('.canvas-node').length===3000),'3000 shells');await settle();
 const open=await run(()=>({ms:performance.now()-cz3start,long:[...cz3long]})), fitted=await snapshot();console.log('CZ3_OPEN',JSON.stringify({open,...fitted}));
 check(fitted.contexts===0&&fitted.bodies===0&&fitted.hit===0&&fitted.ends===0&&fitted.batch>0&&fitted.batch<2000,'Fitted 3000-card board renders no Markdown or edge hit/handle DOM, with bounded edge batches');
 const openWithinBudget=open.long.every(n=>n<=50);
 await zoom(1);const content=await snapshot();console.log('CZ3_CONTENT',JSON.stringify(content));
 check(content.contexts<=2&&content.bodies>0&&content.retained<100&&content.culled>2900,'Only on-screen bodies render, sharing one context per origin');
 check(await run(()=>document.querySelectorAll('iframe').length===0),'The 3000-card board loads no frames');
 await zoom(.4);const titles=await snapshot();check(titles.hit===0&&titles.ends===0&&titles.batch>0,'Settling into title mode removes every individual edge hit path and end');
 await zoom(.6);await settle();
 const tails=await run(()=>[...cz3long]);console.log('CZ3_TASKS',JSON.stringify(tails));const settlesWithinBudget=tails.every(n=>n<=50);
 // Native wheel pan culls old bodies and renders a new part of the board.
 await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:800,y:400,deltaX:3500,deltaY:0});await sleep(180);await settle();
 check((await snapshot()).culled>2800,'Panning culls off-screen titles and bodies');
 // Visit disjoint regions so real renderings and note subscriptions cross the LRU cap.
 for(const [x,y]of [[1500,1500],[6500,1500],[11500,1500],[1500,5000],[6500,5000],[11500,5000]]){
  await run(async(x,y)=>{const{canvasViewports}=await import('/src/canvas/navigation.ts');Object.assign(canvasViewports.get(ws.active),{cx:x,cy:y});document.querySelector('.canvas-view').dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,cancelable:true}));},x,y);
  await sleep(180);await settle();
 }
 const cached=await snapshot();console.log('CZ3_CACHE',JSON.stringify(cached));
 check(cached.retained<=300&&cached.contexts<=2&&await run(()=>cz3watches<=70),'Real off-screen body and subscription caches stay bounded while traversing the board');
 await run(async()=>{const{api}=await import('/src/api.ts');await api.writeNote('Lazy.md','# Updated\nfresh body');ws.vault.written('Lazy.md');});
 await sleep(180);await settle();
 await wait(()=>run(()=>[...document.querySelectorAll('.canvas-node-file:not(.is-culled) .canvas-node-content')].some(el=>el.textContent.includes('fresh body'))),'visible shared note refreshes');
 await run(async()=>{const{api}=await import('/src/api.ts');window.cz3unchanged=(await api.readNote('Lazy.canvas'))===cz3source;});
 check(await run(()=>cz3unchanged),'Lazy rendering, culling and mode switches leave canvas bytes unchanged');
 await run(()=>cz3observer.disconnect());
 // Fit at the same band still needs a fresh viewport query after a distant pan.
 await click('.canvas-controls .lucide-maximize');await settle();
 await run(async()=>{const{canvasViewports}=await import('/src/canvas/navigation.ts');canvasViewports.get(ws.active).cx+=100000;document.querySelector('.canvas-view').dispatchEvent(new WheelEvent('wheel',{cancelable:true}));});await sleep(180);await settle();
 check((await snapshot()).visible===0,'A distant pan culls every card');
 await click('.canvas-controls .lucide-maximize');await settle();
 check((await snapshot()).visible===3000,'Fit refreshes culling even when the zoom band stays the same');
 // A new empty card must accept input while the remaining shells are building.
 await click('.canvas-card-menu [aria-label="Drag to add card"]');
 await send('Input.insertText',{text:'First input during rebuild'});await press('Escape');
 await wait(()=>run(async()=>{const{api}=await import('/src/api.ts');return JSON.parse(await api.readNote('Lazy.canvas')).nodes.some(n=>n.text==='First input during rebuild');}),'early editor input saved');
 await press('z',2);await press('z',2);
 await wait(()=>run(async()=>{const{api}=await import('/src/api.ts');return await api.readNote('Lazy.canvas')===cz3source;}),'board Undo during rebuild');
 check(true,'A new editor accepts its first input and board Undo survives asynchronous rebuilding');
 await wait(()=>run(()=>!!window.__canvasProbe),'rebuilt probe');await settle();
 const pending=await run(async()=>{document.querySelector('.canvas-controls .lucide-maximize').closest('[role=button]').click();const pending=__canvasProbe().pending;window.cz3lastProbe=__canvasProbe;await ws.open('Welcome.md');return pending;});
 await sleep(100);
 check(pending>0&&await run(()=>!document.querySelector('.canvas-view')&&!window.__canvasProbe&&cz3watches===0&&cz3lastProbe().contexts===0&&cz3lastProbe().pending===0),'Leaving during queued work releases contexts, subscriptions and rendering');
 const fixture=await frameFixture();
 try {
  const board=Array.from({length:8},(_,i)=>({id:'f'+i,type:'link',x:(i%3)*160,y:Math.floor(i/3)*90,width:150,height:70,url:fixture.url}));
  board.push({id:'far',type:'link',x:5000,y:0,width:150,height:70,url:fixture.url});
  await run(async nodes=>{
   settings.set('app.json','webEmbeds','always');
   const {api}=await import('/src/api.ts');
   await api.createNote('FramesLazy.canvas',JSON.stringify({nodes,edges:[]}));
   await ws.vault.refreshFiles();await ws.open('FramesLazy.canvas');
  },board);
  await wait(()=>run(()=>window.__canvasProbe?.().built),'frame board built');
  await wait(()=>run(async()=>{const {canvasViewports}=await import('/src/canvas/navigation.ts');return !!document.querySelector('.canvas-world')?.style.transform&&canvasViewports.has(ws.active);}),'frame viewport ready');
  await run(async()=>{const {canvasViewports}=await import('/src/canvas/navigation.ts');Object.assign(canvasViewports.get(ws.active),{cx:235,cy:140,scale:1});document.querySelector('.canvas-view').dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,cancelable:true}));});
  await sleep(280);await settle();
  await wait(()=>run(()=>document.querySelectorAll('iframe.canvas-web-frame[src]').length===6),'six frames load');
  check(await run(()=>document.querySelectorAll('iframe').length===6&&!document.querySelector('[data-node-id="far"] iframe')),'At most six on-screen frames, and an off-screen card has none');
  await zoom(.4);
  check(await run(()=>document.querySelectorAll('iframe').length===0),'Title mode drops every frame');
 } finally { await fixture.close(); }
 assert.ok(openWithinBudget,'opening has no main-thread task over 50ms');assert.ok(settlesWithinBudget,'title/content settles have no task over 50ms');
});
