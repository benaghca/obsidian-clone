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
},{height:860,screenshots:new URL('../../round26-shots/',import.meta.url).pathname});
