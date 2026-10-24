// Stage 3 boundary cases; actions use native CDP pointer/key events.
import {withBrowser,sleep} from './browser.mjs';
await withBrowser(async({run,send,open,read,click,double,move,point,press,chord,check,shot})=>{
 const tight={nodes:[{id:'d',type:'text',x:80,y:240,width:180,height:80,text:'Dee'},{id:'f',type:'text',x:270,y:240,width:180,height:80,text:'Eff'}],edges:[{id:'short',fromNode:'d',fromSide:'right',toNode:'f',toSide:'left',label:'X'}]};
 const rawDouble=async p=>{for(const clickCount of [1,2])for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount});await sleep(80);};
 await open('ShortLabel.canvas',tight);await click('[aria-label="Reset zoom"]');const original=await read(),labelAt=await point('.canvas-edge-label');await move(labelAt);
 for(let i=0;i<3;i++){
  await rawDouble(labelAt);check(await run(()=>document.activeElement.matches('.canvas-edge-label.is-editing')&&document.querySelectorAll('.canvas-node').length===2),'Short label double-click '+(i+1)+' opens its editor without moving the pointer or adding a card');
  await press('Escape');check(await read()===original,'Unchanged short label leaves exact canvas bytes intact');
 }
 await double('[aria-label="Reset zoom"]');check(await run(()=>!document.querySelector('.canvas-edge-label.is-editing')),'Double-clicking controls after a label does not reuse the last label target');
 await double({x:1150,y:650});await press('Escape');await sleep(350);check(await run(()=>document.querySelectorAll('.canvas-node').length===3),'A subsequent background double-click still adds a card');await chord('z');await sleep(350);check(await read()===original,'Undo removes only the background card');
 await open('CoveredLabel.canvas',{...tight,nodes:[...tight.nodes,{id:'cover',type:'text',x:230,y:230,width:100,height:100,text:'Cover'}]});await click('[aria-label="Reset zoom"]');await double('.canvas-edge-label');
 check(await run(()=>document.querySelector('[data-node-id="cover"]').classList.contains('is-editing')&&!document.querySelector('.canvas-edge-label.is-editing')&&document.querySelectorAll('.canvas-node').length===3),'A card covering a label keeps pointer priority over that label');await press('Escape');
 const drag=async(a,b,button='left')=>{await move(a);await send('Input.dispatchMouseEvent',{type:'mousePressed',...a,button,buttons:button==='left'?1:4,clickCount:1});for(let i=1;i<=12;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/12,y:a.y+(b.y-a.y)*i/12,buttons:button==='left'?1:4});await sleep(18);}await send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button,buttons:0,clickCount:1});await sleep(350);};
 const pair={nodes:[{id:'a',type:'text',x:0,y:0,width:140,height:80,text:'Alpha'},{id:'b',type:'text',x:260,y:160,width:140,height:80,text:'Beta'}],edges:[]};
 for(const zoom of [1,2]){
  await open('OuterDots'+zoom+'.canvas',pair);await click('[aria-label="Reset zoom"]');if(zoom===2){await click('[aria-label="Zoom in"]');await click('[aria-label="Zoom in"]');}
  const original=await read();
  for(const side of ['top','right','bottom','left']){
   const target=await run(side=>{const r=document.querySelector('[data-node-id="b"]').getBoundingClientRect();return{x:side==='left'?r.left-7:side==='right'?r.right+7:r.x+r.width/2,y:side==='top'?r.top-7:side==='bottom'?r.bottom+7:r.y+r.height/2};},side);
   await move(await point('[data-node-id="a"]'));await drag(await point('[data-node-id="a"] [data-side="right"]'),target);
   check(await run(async side=>{const{api}=await import('/src/api.ts');const e=JSON.parse(await api.readNote(ws.active.viewFile)).edges[0];return e?.fromNode==='a'&&e.fromSide==='right'&&e.toNode==='b'&&e.toSide===side;},side),zoom+'×: outer half of '+side+' target connects');await chord('z');await sleep(350);check(await read()===original,'Outer-dot creation is one undo step');
  }
  const miss=await run(()=>{const r=document.querySelector('[data-node-id="b"]').getBoundingClientRect();return{x:r.left-11,y:r.y+r.height/2};});await move(await point('[data-node-id="a"]'));await drag(await point('[data-node-id="a"] [data-side="right"]'),miss);check(await read()===original,zoom+'×: a drop beyond the dot still cancels');
 }
 await open('ToolbarBounds.canvas',{...pair,edges:[{id:'e',fromNode:'a',fromSide:'right',toNode:'b',toSide:'left',label:'Gap'}]});await click('[aria-label="Reset zoom"]');await click('.canvas-edge-label');const beforePan=await read();
 const bounded=()=>run(()=>{const r=document.querySelector('.canvas-selection-menu').getBoundingClientRect(),v=document.querySelector('.canvas-view').getBoundingClientRect();return r.width>0&&r.top>=v.top+9.5&&r.bottom<=v.bottom-9.5&&r.left>=v.left+9.5&&r.right<=v.right-9.5;});
 const pan=(dx,dy)=>drag({x:800,y:450},{x:800+dx,y:450+dy},'middle');
 await pan(0,-340);check(await bounded(),'Selected edge toolbar stays in the viewport during pan without reselecting');
 const colorAt=await point('.canvas-selection-menu [aria-label="Set color"]');await click(colorAt);check(await run(()=>!!document.querySelector('.canvas-color-menu')),'Clamped Set color opens with real pointer input');await press('Escape');
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...colorAt,button:'left',clickCount:1});await sleep(80);check(await run(()=>!!document.querySelector('.canvas-color-menu')),'Stationary repeated Set color works at the viewport edge');await press('Escape');await shot('grove-stage3-clamped');
 await pan(-400,0);await pan(-400,0);check(await bounded(),'Toolbar also clamps at the left viewport edge');
 await click('[aria-label="Zoom in"]');await click('[aria-label="Zoom in"]');check(await bounded(),'Viewport clamping follows zoom without reselecting');
 await send('Emulation.setDeviceMetricsOverride',{width:1100,height:800,deviceScaleFactor:1,mobile:false});await sleep(100);check(await bounded(),'Viewport clamping follows a pane resize');
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:860,deviceScaleFactor:1,mobile:false});await sleep(100);check(await read()===beforePan,'Toolbar clamping, menus, pan, zoom and resize preserve exact canvas bytes');
},{height:860,screenshots:new URL('../../round26-shots/',import.meta.url).pathname});
