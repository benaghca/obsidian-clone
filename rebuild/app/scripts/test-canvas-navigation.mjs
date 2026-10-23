// Pan/zoom and performance with native CDP input in a scratch mock vault.
import { readFile, writeFile } from 'node:fs/promises';
import { withBrowser, sleep } from './browser.mjs';
const [fixture,note,diagram] = await Promise.all(['Reference.canvas','Note.md','diagram.svg'].map(name=>readFile(new URL('../../round23-shots/'+name, import.meta.url),'utf8')));
const large = { nodes: Array.from({length:300},(_,i)=>({id:`n${i}`,type:'text',x:(i%20)*280,y:Math.floor(i/20)*190,width:250,height:160,text:`## Card ${i}\n**Local** Markdown and [[Welcome]].\n- Item\n- [ ] Task`,color:String(i%6+1)})), edges:Array.from({length:400},(_,i)=>({id:`e${i}`,fromNode:`n${i%300}`,toNode:`n${(i*7+1)%300}`,fromSide:'right',toSide:'left',label:i%25===0?`Edge ${i}`:undefined})) };
await writeFile(new URL('../../round23-shots/Large.canvas', import.meta.url), JSON.stringify(large)+'\n');
await withBrowser(async ({send,run,click,move,point,check,press,shot})=>{
  await run(async ({fixture,large,note,diagram})=>{
    const {api}=await import('/src/api.ts');
    for(const [path,content]of Object.entries({'Note.md':note,'diagram.svg':diagram,'Target.md':'# Target'})) {
      if((await api.listFiles()).some(f=>f.path===path))await api.writeNote(path,content);else await api.createNote(path,content);
    }
    await api.createNote('Navigation.canvas',fixture); await api.createNote('Large.canvas',JSON.stringify(large));
    await api.createNote('Small.canvas',JSON.stringify({nodes:[{id:'s',type:'text',x:1000,y:1000,width:200,height:100,text:'Small'}],edges:[]}));
    await ws.vault.refreshFiles();await ws.open('Navigation.canvas');
    window.originalNavigation=fixture;
  },{fixture,large,note,diagram});await sleep(300);
  const state=()=>run(()=>{const el=document.querySelector('.canvas-view'), m=new DOMMatrix(getComputedStyle(el.querySelector('.canvas-world')).transform),r=el.getBoundingClientRect();return {s:m.a,x:m.e,y:m.f,w:r.width,h:r.height,left:r.left,top:r.top,grid:parseFloat(el.style.backgroundSize)};});
  const near=(a,b)=>Math.abs(a-b)<.02;
  const button=label=>`.canvas-controls [aria-label="${label}"]`;
  const fit='.canvas-controls .lucide-maximize';
  const stationary=async()=>{for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...await point(button('Zoom in'))});await sleep(60);};
  const wheel=async(dx,dy,ctrl=false,p={x:800,y:400})=>{await move(p);await send('Input.dispatchMouseEvent',{type:'mouseWheel',...p,deltaX:dx,deltaY:dy,modifiers:ctrl?2:0});await sleep(60);};
  const initial=await state();
  const data=JSON.parse(fixture), left=Math.min(...data.nodes.map(n=>n.x)),right=Math.max(...data.nodes.map(n=>n.x+n.width)),top=Math.min(...data.nodes.map(n=>n.y)),bottom=Math.max(...data.nodes.map(n=>n.y+n.height));
  check(near(initial.s,Math.min(1,initial.w/((right-left)*1.1),initial.h/((bottom-top)*1.1)))&&near(initial.x,initial.w/2-(left+right)/2*initial.s),'Opening fit uses observed 10% extent padding and actual bounds');
  check(await run(()=>[...document.querySelectorAll('.canvas-controls .clickable-icon')].map(e=>e.getAttribute('aria-label')).join('|')==='Canvas settings|Zoom in|Reset zoom|Zoom to fit\n(Shift + 1)|Zoom out|Undo|Redo|Canvas help'),'Zoom controls match observed order and Lucide icons');
  for(const [label,selector] of [['Zoom in',button('Zoom in')],['Reset zoom',button('Reset zoom')],['Zoom to fit\n(Shift + 1)',fit],['Zoom out',button('Zoom out')]]){
    await move({x:500,y:780});await move(await point(selector));await sleep(600);
    check(await run(label=>{const e=document.querySelector('.tooltip');return e?.textContent===label&&e.getAnimations().length===0;},label),label+': native hover has styled tooltip without animation');
    const p=await point(selector);await click(p);
    for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(60);
    check(await run(()=>!!document.querySelector('.canvas-view')&&!document.querySelector('.tooltip')),label+': repeated stationary click keeps board active and dismisses tooltip');
  }
  await click(fit);await click(button('Zoom in'));const once=await state();await stationary();const twice=await state();
  check(near(once.s,initial.s*Math.SQRT2)&&near(twice.s,initial.s*2),'Repeated stationary Zoom in clicks each apply sqrt(2)');
  await click(button('Reset zoom'));check(near((await state()).s,1),'Reset zoom is 100%');
  await click(button('Reset zoom'));const reset=await state();await wheel(60,100);const panned=await state();
  check(near(panned.x-reset.x,-55.8)&&near(panned.y-reset.y,-93),'Wheel/trackpad pans both axes at observed rate');
  const pointer={x:850,y:450},before=await state();await wheel(0,-100,true,pointer);const after=await state();
  check(near(after.s,2**(1/3))&&near((pointer.x-before.left-before.x)/before.s,(pointer.x-after.left-after.x)/after.s)&&near((pointer.y-before.top-before.y)/before.s,(pointer.y-after.top-after.y)/after.s),'Ctrl+wheel zooms around pointer at observed rate');
  await wheel(0,-50000,true);check(near((await state()).s,2),'Maximum zoom is 2x');
  await wheel(0,50000,true);check(near((await state()).s,1/16)&&near((await state()).grid,10),'Minimum zoom is 1/16x and grid coarsens to 10px');
  await click(fit);const fitted=await state();check(near(fitted.s,initial.s)&&near(fitted.x,initial.x)&&near(fitted.y,initial.y),'Fit button returns to initial framing');
  for(const kind of ['space','middle']){
    const start=await state(),p={x:800,y:400};await move(p);
    if(kind==='space')await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:kind==='middle'?'middle':'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+40,y:p.y+40,buttons:kind==='middle'?4:1,button:kind==='middle'?'middle':'left'});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+40,y:p.y+40,button:kind==='middle'?'middle':'left',clickCount:1});
    if(kind==='space')await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
    await sleep(80);const end=await state();check(near(end.x-start.x,40)&&near(end.y-start.y,40),kind+' drag follows native pointer without selecting or navigating cards');
  }
  const linkPoint=await point('[data-node-id="text0"] [data-href="Target"]');await move(linkPoint);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...linkPoint,button:'left',clickCount:1});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  check(await run(()=>ws.active.type==='canvas'),'Space-held stationary click on wikilink never follows it');
  const remembered=await state();
  await run(()=>ws.vault.written('Navigation.canvas'));await sleep(100);
  check(near((await state()).x,remembered.x)&&near((await state()).y,remembered.y),'Refreshing canvas contents preserves its live viewport');
  await run(()=>ws.newTab());await run(()=>ws.open('Welcome.md'));await run(()=>ws.activate(ws.activeGroup.tabs.find(t=>t.type==='canvas')));await sleep(120);
  check(near((await state()).x,remembered.x)&&near((await state()).y,remembered.y),'Switching tabs preserves live canvas viewport');
  await run(()=>ws.open('Navigation.canvas',{where:'tab'}));await sleep(120);
  check(near((await state()).x,initial.x)&&near((await state()).s,initial.s),'Same canvas in a new tab has independent initial fit');
  await wheel(0,100);await run(()=>{ws.closeTab(ws.active);ws.activate(ws.activeGroup.tabs.find(t=>t.type==='canvas'))});await sleep(120);
  check(near((await state()).x,remembered.x)&&near((await state()).y,remembered.y),'Closing second canvas tab restores first tab viewport');
  await run(()=>ws.open('Welcome.md'));await run(()=>ws.open('Navigation.canvas'));await sleep(120);
  check(near((await state()).x,initial.x)&&near((await state()).s,initial.s),'Reopening in a reused tab resets to fit, matching Obsidian');
  await wheel(0,100);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'!',code:'Digit1',windowsVirtualKeyCode:49,modifiers:8});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'!',code:'Digit1',windowsVirtualKeyCode:49,modifiers:8});await sleep(60);
  check(near((await state()).y,initial.y),'Shift+1 fits the focused canvas');
  await shot('grove-partb-fit');
  const beforeResize=await state();await send('Emulation.setDeviceMetricsOverride',{width:1100,height:800,deviceScaleFactor:1,mobile:false});await sleep(100);const resized=await state();
  check(near((beforeResize.w/2-beforeResize.x)/beforeResize.s,(resized.w/2-resized.x)/resized.s)&&near(beforeResize.s,resized.s),'Resizing preserves world center and zoom');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await sleep(100);
  await run(()=>ws.open('Small.canvas'));await sleep(120);const small=await state();
  check(near(small.s,1)&&near(small.x,small.w/2-1100)&&near(small.y,small.h/2-1050),'Small, offset canvas centers on its nodes without zooming past 100%');
  await run(()=>ws.open('Large.canvas'));await sleep(1000);
  check(await run(()=>document.querySelectorAll('.canvas-node').length===300&&document.querySelectorAll('.canvas-edges > path').length===400),'Generated fixture renders 300 cards and 400 edges');
  await click(button('Reset zoom'));await sleep(500);
  await run(()=>{window.canvasChildChanges=0;const world=document.querySelector('.canvas-world');window.canvasMutationObserver=new MutationObserver(records=>{canvasChildChanges+=records.filter(r=>r.target!==world).length});canvasMutationObserver.observe(world,{subtree:true,attributes:true,childList:true})});
  // Warm the compositor, then measure presentation intervals during native wheel input.
  await wheel(0,20);await wheel(0,-20);
  await run(()=>{window.canvasFrames=[];window.canvasRecording=true;let last=performance.now();const tick=now=>{if(!canvasRecording)return;canvasFrames.push(now-last);last=now;window.canvasFrameId=requestAnimationFrame(tick)};window.canvasFrameId=requestAnimationFrame(tick)});
  for(let i=0;i<24;i++){await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:800,y:400,deltaX:i%2?30:-30,deltaY:i%2?20:-20,modifiers:0});await sleep(18);}
  const panFrames=await run(()=>{canvasRecording=false;cancelAnimationFrame(canvasFrameId);return canvasFrames.slice(2)});
  await run(()=>{window.canvasFrames=[];window.canvasRecording=true;let last=performance.now();const tick=now=>{if(!canvasRecording)return;canvasFrames.push(now-last);last=now;window.canvasFrameId=requestAnimationFrame(tick)};window.canvasFrameId=requestAnimationFrame(tick)});
  for(let i=0;i<24;i++){await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:800,y:400,deltaX:0,deltaY:i%2?20:-20,modifiers:2});await sleep(18);}
  const zoomFrames=await run(()=>{canvasRecording=false;cancelAnimationFrame(canvasFrameId);return canvasFrames.slice(2)});
  for(const [name,frames]of [['pan',panFrames],['zoom',zoomFrames]]){const sorted=frames.toSorted((a,b)=>a-b);console.log('FRAMES',name,JSON.stringify({samples:frames.length,p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...frames)}));check(frames.length>=20&&Math.max(...frames)<20,'300-card/400-edge '+name+' presentation frames stay under 20ms');}
  check(await run(()=>{canvasMutationObserver.disconnect();return canvasChildChanges===0}),'Pan/zoom transforms one world without changing card DOM or geometry');
  await shot('grove-partb-large');
  check(await run(async()=>{const{api}=await import('/src/api.ts');return await api.readNote('Navigation.canvas')===originalNavigation}),'Pan, zoom and tab changes leave canvas bytes unchanged');
}, {height:800,screenshots:new URL('../../round23-shots/',import.meta.url).pathname});
