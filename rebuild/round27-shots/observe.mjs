import { withObsidian, sleep } from '../round25-shots/obsidian-driver.mjs';
import { inspect } from 'node:util';
inspect.defaultOptions.depth = null;
import { writeFile } from 'node:fs/promises';
await withObsidian(async ({run,send,point,move,click,press}) => {
 const shot = async name => writeFile(new URL(name+'.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await run(async()=>{
  await app.vault.createFolder('Folder');
  await app.vault.create('A very long note title that should truncate inside the canvas card.md','---\naliases: [Short]\n---\n# Heading\nBody text');
  await app.vault.create('Short.md','First paragraph\n\nSecond paragraph');
  await app.vault.createBinary('Picture.svg',new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="orange"/></svg>'));
  await app.vault.create('Board.canvas',JSON.stringify({nodes:[{id:'a',type:'text',x:0,y:0,width:250,height:160,text:'Source'}],edges:[]}));
  await app.workspace.openLinkText('Board.canvas','',false);
 }); await sleep(500);
 console.log('ROWS',await run(()=>[...document.querySelectorAll('.nav-file-title,.nav-folder-title')].map(e=>({cls:e.className,path:e.dataset.path,text:e.innerText}))));
 const data=()=>run(()=>({leaves:app.workspace.getLeavesOfType('canvas').map(l=>({name:l.getDisplayText(),data:JSON.parse(l.view.getViewData())})),active:app.workspace.activeLeaf.getDisplayText()}));
 const drag=async(a,b,name)=>{
  await move(a);await send('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',buttons:1,clickCount:1});
  for(let i=1;i<=15;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/15,y:a.y+(b.y-a.y)*i/15,button:'left',buttons:1});await sleep(40);}
  console.log('DRAG_'+name,await run(()=>[...document.querySelectorAll('[class*=drag],.canvas-wrapper,.canvas-node')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height}).map(e=>({cls:e.getAttribute('class'),text:e.innerText?.slice(0,160),box:e.getBoundingClientRect().toJSON(),bg:getComputedStyle(e).backgroundColor,outline:getComputedStyle(e).outline}))));
  await shot(name+'-drag');await send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',clickCount:1});await sleep(600);
  console.log('DROP_'+name,await data());await shot(name);await writeFile(new URL('Obsidian-'+name+'.json',import.meta.url),JSON.stringify(await data(),null,2));
 };
 const r=await run(()=>document.querySelector('.canvas-wrapper').getBoundingClientRect().toJSON());
 const p={x:r.x+r.width*.57,y:r.y+r.height*.3};
 await drag(await point('.nav-file-title[data-path="Short.md"]'),p,'note');
 console.log('NOTE_DOM',await run(()=>[...document.querySelectorAll('.canvas-node')].map(e=>({text:e.innerText,box:e.getBoundingClientRect().toJSON(),children:[...e.querySelectorAll('[class*=title],[class*=label],[class*=header]')].map(c=>({cls:c.className,text:c.innerText,box:c.getBoundingClientRect().toJSON(),font:getComputedStyle(c).font,padding:getComputedStyle(c).padding,whiteSpace:getComputedStyle(c).whiteSpace,weight:getComputedStyle(c).fontWeight,display:getComputedStyle(c).display,color:getComputedStyle(c).color,overflow:getComputedStyle(c).overflow,ellipsis:getComputedStyle(c).textOverflow,cursor:getComputedStyle(c).cursor}))}))));
 await drag(await point('.nav-file-title[data-path="A very long note title that should truncate inside the canvas card.md"]'),{x:p.x,y:p.y-70},'on-card');
 await drag(await point('.nav-file-title[data-path="Picture.svg"]'),{x:r.x+r.width*.3,y:r.y+r.height*.8},'image');
 await drag(await point('.nav-folder-title[data-path="Folder"]'),{x:r.x+r.width*.3,y:r.y+r.height*.2},'folder');
 // Use a fresh board to keep the connection menu in view.
 await run(async()=>{await app.vault.create('Connect.canvas',JSON.stringify({nodes:[{id:'a',type:'text',x:0,y:0,width:250,height:160,text:'Source'}],edges:[]}));await app.workspace.openLinkText('Connect.canvas','',false);});await sleep(400);
 const card=await run(()=>document.querySelector('.canvas-node').getBoundingClientRect().toJSON());
 await drag({x:card.right-1,y:card.y+card.height/2},{x:card.right+160,y:card.y+card.height/2+70},'connection');
 console.log('MENU',await run(()=>[...document.querySelectorAll('.menu,.menu-item')].map(e=>({cls:e.className,text:e.innerText,box:e.getBoundingClientRect().toJSON(),font:getComputedStyle(e).font,icons:[...e.querySelectorAll('svg')].map(s=>s.getAttribute('class'))}))));
 await click('.menu-item');await sleep(300);console.log('CONNECTED',await data());await shot('connected-text');
 await press('Escape');
 await drag({x:card.x+1,y:card.y+card.height/2},{x:card.x-180,y:card.y+card.height/2+100},'connection-note');
 await click('.menu-item:nth-child(2)'); console.log('NOTE_PICKER',await run(()=>({text:document.querySelector('.prompt')?.innerText,rows:[...document.querySelectorAll('.suggestion-item')].map(e=>e.innerText)}))); await shot('connection-picker'); await press('Escape');
 await run(()=>app.workspace.openLinkText('Board.canvas','',false));await sleep(300);await click('.canvas-node .inline-title');console.log('HEADER_CLICK',await data());
 const title=await point('.canvas-node .inline-title');for(const clickCount of [1,2])for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...title,button:'left',clickCount});await sleep(200);console.log('HEADER_DOUBLE',await data());
});
