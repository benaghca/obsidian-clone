import { writeFile } from 'node:fs/promises';
import { withObsidian, sleep } from '../round25-shots/obsidian-driver.mjs';
await withObsidian(async ({run,send,click,press,move}) => {
 await run(async()=>{await app.vault.create('Menus.canvas',JSON.stringify({nodes:[{id:'a',type:'text',x:0,y:0,width:220,height:140,text:'Alpha'},{id:'b',type:'text',x:440,y:0,width:220,height:140,text:'Beta'}],edges:[{id:'e',fromNode:'a',fromSide:'right',toNode:'b',toSide:'left'}]}));await app.workspace.openLinkText('Menus.canvas','',false);});await sleep(400);
 const edgePoint=()=>run(()=>{const e=document.querySelector('.canvas-display-path'),p=e.getPointAtLength(e.getTotalLength()/2),q=new DOMPoint(p.x,p.y).matrixTransform(e.getScreenCTM());return{x:q.x,y:q.y};});
 const data=()=>run(()=>app.workspace.activeLeaf.view.getViewData());
 await click(await edgePoint());await sleep(200);await click('[aria-label="Line direction"]');await sleep(200);
 console.log('DIRECTION_PICKER',JSON.stringify(await run(()=>[...document.querySelectorAll('[class*=menu]')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&r.width<500&&r.height<400;}).map(e=>({cls:e.className,text:e.innerText,rect:e.getBoundingClientRect().toJSON(),children:[...e.children].map(c=>({cls:c.getAttribute('class'),label:c.getAttribute('aria-label'),icons:[...c.querySelectorAll('svg')].map(s=>s.getAttribute('class'))}))})))));
 await writeFile(new URL('obsidian-direction-picker.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));for(const i of [1,3,2]) {if(i!==1)await click('[aria-label="Line direction"]');await click('.menu-item:nth-child('+i+')');await sleep(120);console.log('DIRECTION_'+i,await data());}
 const p=await edgePoint();await move(p);for(const clickCount of [1,2])for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount});await sleep(200);
 console.log('LABEL_EDITOR',JSON.stringify(await run(()=>({tag:document.activeElement.tagName,cls:document.activeElement.className,editable:document.activeElement.getAttribute('contenteditable'),rect:document.activeElement.getBoundingClientRect().toJSON()}))));
 await send('Input.insertText',{text:'Native label'});await press('Enter');await sleep(250);console.log('LABELED',await data());
 const lp=await run(()=>{const r=document.querySelector('.canvas-path-label').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});await move(lp);for(const clickCount of [1,2])for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...lp,button:'left',clickCount});await sleep(100);await press('a',2);await send('Input.insertText',{text:'Edited label'});await press('Enter');await sleep(200);console.log('EDITED_LABEL',await data());
 await click(await edgePoint());await click('[aria-label="Set color"]');await click('.canvas-color-picker-item.mod-canvas-color-1');await sleep(200);console.log('COLORED',await data());
 await writeFile(new URL('obsidian-native-label.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
});
