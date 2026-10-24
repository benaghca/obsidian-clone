import {writeFile} from 'node:fs/promises';
import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
await withObsidian(async({run,send,click,move,press})=>{
 await run(async()=>{await app.vault.create('B.canvas',JSON.stringify({nodes:[{id:'a',type:'text',x:0,y:0,width:220,height:140,text:'Alpha'},{id:'b',type:'text',x:440,y:0,width:220,height:140,text:'Beta'}],edges:[{id:'e',fromNode:'a',fromSide:'right',toNode:'b',toSide:'left',label:'Original'}]}));await app.workspace.openLinkText('B.canvas','',false);});await sleep(400);
 const label=()=>run(()=>{const r=document.querySelector('.canvas-path-label').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
 const double=async p=>{await move(p);for(const clickCount of [1,2])for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount});await sleep(100);};
 const data=()=>run(()=>app.workspace.activeLeaf.view.getViewData());
 await click(await label());console.log('LABELED_TOOLBAR',JSON.stringify(await run(()=>[...document.querySelector('.canvas-menu').children].map(e=>({label:e.getAttribute('aria-label'),display:getComputedStyle(e).display,icons:[...e.querySelectorAll('svg')].map(s=>s.getAttribute('class'))})))));await double(await label());await press('a',2);await send('Input.insertText',{text:'Escape edit'});await press('Escape');await sleep(100);console.log('ESCAPE',await data());
 await double(await label());await press('a',2);await send('Input.insertText',{text:'Click away'});await click({x:1100,y:650});console.log('AWAY',await data());
 await double(await label());await press('a',2);await press('Backspace');await press('Enter');await sleep(100);console.log('EMPTY',await data());
 await click('[aria-label="Edit label"]');await send('Input.insertText',{text:'Toolbar label'});await press('Enter');await sleep(100);
 const p=await run(()=>{const r=[...document.querySelectorAll('.canvas-node')].find(e=>e.innerText==='Alpha').getBoundingClientRect();return{x:r.x+50,y:r.y+50};});await move(p);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1,modifiers:8});
 console.log('MIXED',JSON.stringify(await run(()=>[...document.querySelector('.canvas-menu').children].map(e=>({label:e.getAttribute('aria-label'),display:getComputedStyle(e).display})))));
 await writeFile(new URL('obsidian-partb.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
});
