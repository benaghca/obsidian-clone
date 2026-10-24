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
 const drag=async(a,b)=>{await move(a);await send('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',buttons:1,clickCount:1});for(let i=1;i<=12;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/12,y:a.y+(b.y-a.y)*i/12,buttons:1});await sleep(18);}await send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',buttons:0,clickCount:1});await sleep(350);};
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
},{height:860,screenshots:new URL('../../round26-shots/',import.meta.url).pathname});
