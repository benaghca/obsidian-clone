import { withObsidian, sleep } from '../round25-shots/obsidian-driver.mjs';
import { writeFile } from 'node:fs/promises';
await withObsidian(async({run,send,move,click,press})=>{
 const drag=async(a,b)=>{await move(a);await send('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',clickCount:1});for(let i=1;i<=15;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/15,y:a.y+(b.y-a.y)*i/15,button:'left',buttons:1});await sleep(25);}await send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',clickCount:1});await sleep(80);};
 for(const side of ['top','right','bottom','left']){
  await run(async side=>{await app.vault.create(side+'.canvas',JSON.stringify({nodes:[{id:'a',type:'text',x:0,y:0,width:250,height:160,text:'Source'}],edges:[]}));await app.workspace.openLinkText(side+'.canvas','',false);},side);await sleep(200);
  const r=await run(()=>document.querySelector('.canvas-node').getBoundingClientRect().toJSON());
  const a={x:side==='left'?r.x+1:side==='right'?r.right-1:r.x+r.width/2,y:side==='top'?r.y+1:side==='bottom'?r.bottom-1:r.y+r.height/2};
  const b={x:a.x+(side==='right'?100:side==='left'?-100:70),y:a.y+(side==='bottom'?120:side==='top'?-120:70)};
  await drag(a,b);await click('.menu-item');await sleep(80);await press('Escape');
  console.log(side,JSON.stringify(await run(()=>JSON.parse(app.workspace.activeLeaf.view.getViewData()))));
 }
 await run(async()=>{await app.vault.create('Title.md','Body');await app.vault.create('Header.canvas',JSON.stringify({nodes:[{id:'t',type:'file',file:'Title.md',x:0,y:0,width:400,height:400}],edges:[]}));await app.workspace.openLinkText('Header.canvas','',false);});await sleep(300);
 const measure=()=>run(()=>[...document.querySelectorAll('.canvas-node .inline-title')].map(e=>({box:e.getBoundingClientRect().toJSON(),font:getComputedStyle(e).font,margin:getComputedStyle(e).margin,whiteSpace:getComputedStyle(e).whiteSpace,edit:e.contentEditable,tab:e.tabIndex,html:e.outerHTML})));
 console.log('HEADER',await measure());await click('.canvas-node .inline-title');await press('Enter');console.log('ENTER',await run(()=>({active:app.workspace.activeLeaf.getDisplayText(),editing:document.activeElement?.className})));
 const p=await run(()=>{const r=document.querySelector('.canvas-node .inline-title').getBoundingClientRect();return{x:r.x+20,y:r.y+15}});await move(p);for(const clickCount of [1,2])for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount});await sleep(100);console.log('DOUBLE',await run(()=>({active:app.workspace.activeLeaf.getDisplayText(),editing:document.activeElement?.className,text:document.querySelector('.canvas-node')?.innerText})));
 await writeFile(new URL('obsidian-header.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
});
