// Pan/zoom and performance with native CDP input in a scratch mock vault.
import { readFile, writeFile } from 'node:fs/promises';
import { withBrowser, sleep } from './browser.mjs';
import { traceGesture, summarizeTrace } from './canvas-zoom-trace.mjs';
const [fixture,note,diagram] = await Promise.all(['Reference.canvas','Note.md','diagram.svg'].map(name=>readFile(new URL('../../round23-shots/'+name, import.meta.url),'utf8')));
const large = { nodes: Array.from({length:300},(_,i)=>({id:`n${i}`,type:'text',x:(i%20)*280,y:Math.floor(i/20)*190,width:250,height:160,text:`## Card ${i}\n**Local** Markdown and [[Welcome]].\n- Item\n- [ ] Task`,color:String(i%6+1)})), edges:Array.from({length:400},(_,i)=>({id:`e${i}`,fromNode:`n${i%300}`,toNode:`n${(i*7+1)%300}`,fromSide:'right',toSide:'left',label:i%25===0?`Edge ${i}`:undefined})) };
await writeFile(new URL('../../round23-shots/Large.canvas', import.meta.url), JSON.stringify(large)+'\n');
await withBrowser(async ({send,on,run,click,move,point,check,press,double,shot})=>{
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
  await run(()=>{window.canvasChildChanges=0;const world=document.querySelector('.canvas-world');window.canvasMutationObserver=new MutationObserver(records=>{canvasChildChanges+=records.filter(r=>r.target!==world&&!r.target.closest?.('.canvas-selection-menu')).length});canvasMutationObserver.observe(world,{subtree:true,attributes:true,childList:true})});
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
  // Fitted, so all 300 cards are visible. rAF intervals stay smooth while the
  // compositor can still drop. Three runs after CZ1: pan drops 2, zoom drops 0.
  // Ceiling 6 keeps the old 3-drop timing spread above that. See NOTES_CZ0-REVIEW.
  for(const name of ['pan','zoom']) {
    await click(fit);await sleep(250);
    const trace=await traceGesture({send,on},async()=>{
      const pending=[];
      for(let i=0;i<24;i++){
        pending.push(send('Input.dispatchMouseEvent',{type:'mouseWheel',x:800,y:400,deltaX:name==='pan'?(i%2?30:-30):0,deltaY:i%2?20:-20,modifiers:name==='zoom'?2:0}));await sleep(16);
      }
      await Promise.all(pending);await sleep(250);
    });
    const metrics=summarizeTrace(trace,24);console.log('COMPOSITOR',name,JSON.stringify(metrics));
    check(metrics.dropped<=6,'300-card/400-edge '+name+' stays within 6 compositor drops per 24 inputs');
  }
  // CZ1: a zoom frame writes no stylesheet rule; zoom-dependent handle sizes follow one band attribute once the wheel rests.
  await run(()=>{window.canvasRuleWrites=0;const set=CSSStyleDeclaration.prototype.setProperty;window.canvasSetProperty=set;CSSStyleDeclaration.prototype.setProperty=function(...a){if(this.parentRule)canvasRuleWrites++;return set.apply(this,a)};});
  const bandBefore=await run(()=>document.querySelector('.canvas-world').dataset.zoomBand);
  for(let i=0;i<12;i++){await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:800,y:400,deltaX:0,deltaY:-25,modifiers:2});await sleep(16);}
  const midGesture=await run(()=>document.querySelector('.canvas-world').dataset.zoomBand);await sleep(250);
  const settled=await run(()=>{CSSStyleDeclaration.prototype.setProperty=canvasSetProperty;const world=document.querySelector('.canvas-world'),s=new DOMMatrix(world.style.transform).a;return{writes:canvasRuleWrites,band:world.dataset.zoomBand,expected:String(Math.max(-16,Math.min(4,Math.round(Math.log2(s)*4)))),hit:getComputedStyle(document.querySelector('.canvas-edge-hit')).getPropertyValue('--canvas-inverse-scale').trim(),inverse:2**(-Math.max(-16,Math.min(4,Math.round(Math.log2(s)*4)))/4)}});
  check(settled.writes===0,'Ctrl+wheel zoom writes no stylesheet rule');
  check(midGesture===bandBefore&&settled.band===settled.expected&&settled.band!==bandBefore&&Math.abs(parseFloat(settled.hit)-settled.inverse)<1e-9,'Handle sizes follow the zoom band once the wheel rests, not during the gesture');
  const bandNow=()=>run(()=>document.querySelector('.canvas-world').dataset.zoomBand);
  const expectedBand=()=>run(()=>{const s=new DOMMatrix(document.querySelector('.canvas-world').style.transform).a;return String(Math.max(-16,Math.min(4,Math.round(Math.log2(s)*4))));});
  await click(button('Reset zoom'));await sleep(80);check(await bandNow()==='0','Reset zoom applies the 100% band straight away');
  const capBefore=await bandNow();
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:800,y:400,deltaX:0,deltaY:-50000,modifiers:2});await sleep(25);
  for(let i=0;i<6;i++){await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:800,y:400,deltaX:0,deltaY:-100,modifiers:2});await sleep(25);}
  check(await bandNow()===capBefore,'Wheels at the zoom cap keep postponing the band until the wheel rests');
  await sleep(200);check(await bandNow()==='4'&&await expectedBand()==='4','The band catches up 120ms after the last capped wheel');
  const jumpBefore=await bandNow();
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:800,y:400,deltaX:0,deltaY:-100,modifiers:2});await sleep(35);
  check(await bandNow()===jumpBefore,'A zoom frame does not apply its band');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'!',code:'Digit1',windowsVirtualKeyCode:49,modifiers:8});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'!',code:'Digit1',windowsVirtualKeyCode:49,modifiers:8});await sleep(40);
  check(await bandNow()===await expectedBand()&&await bandNow()!==jumpBefore,'Shift+1 applies the fit band straight away, without waiting out the wheel');
  const panBefore=await bandNow();
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:800,y:400,deltaX:0,deltaY:-100,modifiers:2});await sleep(35);
  const panY=(await state()).y;
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:800,y:400,deltaX:0,deltaY:200,modifiers:0});await sleep(35);
  check(await bandNow()===panBefore&&Math.abs((await state()).y-panY)>1,'A pan during settle does not apply the zoom band');
  await sleep(200);check(await bandNow()===await expectedBand()&&await bandNow()!==panBefore,'The band follows the zoom 120ms after that wheel, not on the pan');
  await click(button('Zoom in'));check(await bandNow()===await expectedBand(),'Zoom in applies the band straight away');
  const picked=await run(()=>{const v=document.querySelector('.canvas-view').getBoundingClientRect();const c=[...document.querySelectorAll('.canvas-node')].find(c=>{const r=c.getBoundingClientRect();return r.width>40&&r.left>v.left+10&&r.right<v.right-10&&r.top>v.top+10&&r.bottom<v.bottom-10;});const r=c.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
  await click(picked);const selectionBefore=await bandNow();
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'@',code:'Digit2',windowsVirtualKeyCode:50,modifiers:8});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'@',code:'Digit2',windowsVirtualKeyCode:50,modifiers:8});await sleep(40);
  check(await bandNow()===await expectedBand()&&await bandNow()!==selectionBefore,'Zoom to selection applies the band straight away');
  const resizeBefore=await bandNow();
  // Zoom to selection of one card is already at the 2x cap, so zoom out. A further
  // zoom-in wheel would not change the scale, and the band would already match.
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:800,y:400,deltaX:0,deltaY:100,modifiers:2});await sleep(20);
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:800,deviceScaleFactor:1,mobile:false});await sleep(50);
  check(await bandNow()===await expectedBand()&&await bandNow()!==resizeBefore,'Resize applies the pending zoom band straight away');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await sleep(60);
  // Space+wheel zooms too (Canvas help: "press Space or Ctrl ... and scroll").
  const spaceBefore=await state();await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:800,y:400,deltaX:0,deltaY:100,modifiers:0});await sleep(80);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});const spaceAfter=await state();
  check(near(spaceAfter.s,spaceBefore.s*2**(-1/3))&&near((800-spaceBefore.left-spaceBefore.x)/spaceBefore.s,(800-spaceAfter.left-spaceAfter.x)/spaceAfter.s),'Space+wheel zooms around the pointer');
  // Card bodies scroll only on a selected or edited card.
  await click(button('Reset zoom'));await sleep(100);
  const card=await run(()=>{const v=document.querySelector('.canvas-view').getBoundingClientRect();const c=[...document.querySelectorAll('.canvas-node')].find(c=>{const r=c.getBoundingClientRect();return r.left>v.left+20&&r.right<v.right-60&&r.top>v.top+60&&r.bottom<v.bottom-80;});const r=c.getBoundingClientRect();return{id:c.dataset.nodeId,x:r.x+r.width-15,y:r.y+r.height-10};});
  const overflow=()=>run(id=>getComputedStyle(document.querySelector(`.canvas-node[data-node-id="${id}"] > .canvas-node-content`)).overflowY,card.id);
  const unselected=await overflow();await click(card);const selected=await overflow();
  const menuScale=await run(()=>{const m=document.querySelector('.canvas-selection-menu');return{visible:!m.hidden,inverse:parseFloat(m.style.getPropertyValue('--canvas-inverse-scale')),scale:new DOMMatrix(document.querySelector('.canvas-world').style.transform).a};});
  check(unselected==='hidden'&&selected==='auto','Card bodies are not scroll containers unless the card is selected');
  check(menuScale.visible&&Math.abs(menuScale.inverse-1/menuScale.scale)<1e-9,'The selection menu keeps its screen size from its own inline variables');
  await shot('grove-partb-large');
  await run(async()=>{const {api}=await import('/src/api.ts');const text=Array.from({length:30},(_,i)=>`Line ${i} stays on the card.`).join('\n');await api.createNote('Overflow.canvas',JSON.stringify({nodes:[{id:'o',type:'text',x:200,y:200,width:280,height:140,text}],edges:[]}));await ws.vault.refreshFiles();await ws.open('Overflow.canvas');});
  await sleep(200);await click(button('Reset zoom'));await sleep(80);
  const overflowAt=await run(()=>{const content=document.querySelector('.canvas-node[data-node-id="o"] > .canvas-node-content');const r=content.getBoundingClientRect();return{overflow:getComputedStyle(content).overflowY,scrollable:content.scrollHeight>content.clientHeight+2,x:r.x+30,y:r.y+24};});
  check(overflowAt.overflow==='hidden'&&overflowAt.scrollable,'An unselected overflowing text card clips its body');
  await click({x:overflowAt.x,y:overflowAt.y});
  const selectedScroll=await run(()=>{const content=document.querySelector('.canvas-node[data-node-id="o"] > .canvas-node-content');content.scrollTop=48;return{overflow:getComputedStyle(content).overflowY,top:content.scrollTop};});
  check(selectedScroll.overflow==='auto'&&selectedScroll.top>=40,'Selecting an overflowing text card lets its body scroll');
  await double({x:overflowAt.x,y:overflowAt.y});await sleep(120);
  const editing=await run(()=>{const card=document.querySelector('.canvas-node[data-node-id="o"]');const content=card.querySelector('.canvas-node-content');return{editing:card.classList.contains('is-editing'),editor:!!card.querySelector('.cm-editor'),overflow:getComputedStyle(content).overflowY};});
  check(editing.editing&&editing.editor&&editing.overflow==='auto','Editing an overflowing text card keeps a scrollable editor');
  const editView=await state();
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:overflowAt.x,y:overflowAt.y,deltaX:0,deltaY:120,modifiers:0});await sleep(50);
  const scrolled=await run(()=>{const card=document.querySelector('.canvas-node[data-node-id="o"]');return Math.max(card.querySelector('.cm-scroller')?.scrollTop??0,card.querySelector('.canvas-node-content').scrollTop);});
  const editAfter=await state();
  check(scrolled>0&&near(editAfter.x,editView.x)&&near(editAfter.y,editView.y)&&near(editAfter.s,editView.s),'Wheel over an edited overflowing text card scrolls it and does not pan');
  check(await run(async()=>{const{api}=await import('/src/api.ts');return await api.readNote('Navigation.canvas')===originalNavigation}),'Pan, zoom and tab changes leave canvas bytes unchanged');
  // The real-app diagnostic is in the DEV registry, performs exactly 300
  // synthetic inputs, restores the live viewport and does not save anything.
  await run(()=>ws.open('Small.canvas'));await sleep(120);const beforeMeasure=await state();
  await run(()=>{window.cz0WheelCount=0;document.querySelector('.canvas-view').addEventListener('wheel',e=>{if(!e.isTrusted&&e.ctrlKey&&e.deltaY)cz0WheelCount++;});window.cz0Measure=grove.get('canvas:measure-zoom').run();});
  for(let i=0;i<300&&!await run(()=>!!document.querySelector('[aria-label="Canvas: measure zoom"]'));i++)await sleep(25);
  const report=await run(()=>cz0Measure);console.log('CZ0_DEBUG',JSON.stringify(report));
  check(report.steps===300&&!report.cancelled&&report.samples>10&&report.droppedFrames===null&&await run(()=>cz0WheelCount===300),'Debug zoom command sends 300 steps and labels unavailable compositor counts honestly');
  check(await run(()=>document.querySelector('[aria-label="Canvas: measure zoom"]')?.textContent.includes('Frame-gap p50 / p95 / max')),'Debug zoom results show p50/p95/max and device scale');
  await press('Escape');await sleep(40);const afterMeasure=await state();check(near(beforeMeasure.s,afterMeasure.s)&&near(beforeMeasure.x,afterMeasure.x)&&near(beforeMeasure.y,afterMeasure.y),'Debug measurement restores the original live viewport');
  await run(()=>{window.cz0Measure=grove.get('canvas:measure-zoom').run();});await sleep(80);await press('Escape');
  const cancelled=await run(()=>cz0Measure);check(cancelled.cancelled&&cancelled.steps<300,'Escape cancels the debug measurement before 300 steps');
  await press('Escape');await sleep(40);
  check(await run(async()=>{const{api}=await import('/src/api.ts');return JSON.parse(await api.readNote('Small.canvas')).nodes[0].text==='Small';}),'Debug measurement and cancellation never save the canvas');
  const beforeLeave=await state();
  await run(()=>{window.cz0Measure=grove.get('canvas:measure-zoom').run();});
  for(let i=0;i<40&&near((await state()).s,beforeLeave.s);i++)await sleep(25);
  check(!near((await state()).s,beforeLeave.s),'measurement changes zoom before the canvas is left');
  await run(()=>ws.open('Welcome.md'));
  const leftReport=await run(()=>cz0Measure);
  check(leftReport.cancelled&&leftReport.steps<300,'leaving the canvas cancels the measurement');
  await press('Escape');await sleep(40);
  check(await run(()=>!grove.isAvailable(grove.get('canvas:measure-zoom'))),'Debug zoom command is unavailable outside a canvas');
  await run(()=>ws.open('Small.canvas'));await sleep(200);
  const returned=await state();
  check(near(beforeLeave.s,returned.s)&&near(beforeLeave.x,returned.x)&&near(beforeLeave.y,returned.y),'leaving mid-measure restores the live viewport ('+JSON.stringify(beforeLeave)+' -> '+JSON.stringify(returned)+')');
  check(await run(async()=>{const{api}=await import('/src/api.ts');return JSON.parse(await api.readNote('Small.canvas')).nodes[0].text==='Small';}),'leaving mid-measure does not save the canvas');
}, {height:800,screenshots:new URL('../../round23-shots/',import.meta.url).pathname});
