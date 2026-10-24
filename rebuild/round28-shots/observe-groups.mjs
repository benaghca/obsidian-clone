import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
import {writeFile} from 'node:fs/promises';
await withObsidian(async({run,send,move,click,press})=>{
 const shot=async name=>writeFile(new URL(name+'.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const right=async p=>{await move(p);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'right',clickCount:1});await sleep(100);};
 const menu=()=>run(()=>[...document.querySelectorAll('.menu-item')].map(e=>({text:e.innerText,icons:[...e.querySelectorAll('svg')].map(s=>s.getAttribute('class'))})));
 const data=()=>run(()=>app.workspace.activeLeaf.view.getViewData());
 await run(async()=>{await app.vault.create('Groups.canvas',JSON.stringify({nodes:[{id:'a',type:'text',text:'Alpha',x:0,y:0,width:200,height:120},{id:'b',type:'text',text:'Beta',x:300,y:160,width:200,height:120}],edges:[]}));await app.workspace.openLinkText('Groups.canvas','',false);});await sleep(350);
 const boxes=await run(()=>[...document.querySelectorAll('.canvas-node')].map(e=>e.getBoundingClientRect().toJSON()));
 const a={x:boxes[0].left-20,y:boxes[0].top-20},b={x:boxes[1].right+20,y:boxes[1].bottom+20};await move(a);await send('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',clickCount:1});for(let i=1;i<=15;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/15,y:a.y+(b.y-a.y)*i/15,button:'left',buttons:1});await sleep(20);}await send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',clickCount:1});await sleep(100);
 console.log('SELECTED',JSON.stringify(await run(()=>[...document.querySelectorAll('.canvas-node')].map(e=>({text:e.innerText,cls:e.className})))));
 await right({x:(boxes[0].right+boxes[1].left)/2,y:(boxes[0].bottom+boxes[1].top)/2});console.log('BACKGROUND_MENU',JSON.stringify(await menu()));await shot('obsidian-group-menu');
 const at=await run(()=>{const e=[...document.querySelectorAll('.menu-item')].find(e=>/group/i.test(e.innerText));if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});if(!at)return;await click(at);await sleep(200);
 console.log('CREATED',await data());console.log('DOM',JSON.stringify(await run(()=>[...document.querySelectorAll('.canvas-node')].map(e=>({cls:e.className,text:e.innerText,children:[...e.children].map(c=>({cls:c.className,text:c.innerText,box:c.getBoundingClientRect().toJSON()}))})))));await shot('obsidian-group-created');
 const label=await run(()=>{const e=document.querySelector('.canvas-group-label');return e?{html:e.outerHTML,box:e.getBoundingClientRect().toJSON()}:null;});console.log('LABEL',label);
 const p=label?{x:label.box.x+label.box.width/2,y:label.box.y+label.box.height/2}:await run(()=>{const e=[...document.querySelectorAll('.canvas-node')].find(e=>e.classList.contains('is-group'));const r=e.getBoundingClientRect();return{x:r.x+30,y:r.y-15};});
 await move(p);for(const clickCount of [1,2])for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount});await sleep(100);console.log('LABEL_EDIT',JSON.stringify(await run(()=>({active:document.activeElement?.outerHTML,editables:[...document.querySelectorAll('input,textarea,[contenteditable=true]')].map(e=>({cls:e.className,text:e.textContent,value:e.value}))}))));
 await send('Input.insertText',{text:'Renamed group'});await press('Enter');await sleep(200);console.log('RENAMED',await data());await right(p);console.log('GROUP_MENU',JSON.stringify(await menu()));await shot('obsidian-group-actions');
});
