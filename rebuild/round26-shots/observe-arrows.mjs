import { withObsidian, sleep } from '../round25-shots/obsidian-driver.mjs';
import { writeFile } from 'node:fs/promises';
await withObsidian(async ({run,send,move,click,press}) => {
  await run(async () => {
    await app.vault.create('Arrows.canvas', JSON.stringify({future:{keep:true},nodes:[
      {id:'a',type:'text',x:0,y:0,width:220,height:140,text:'Alpha'},
      {id:'b',type:'text',x:440,y:0,width:220,height:140,text:'Beta'},
      {id:'c',type:'text',x:220,y:300,width:220,height:140,text:'Gamma'},
    ],edges:[]}));
    await app.workspace.openLinkText('Arrows.canvas','',false);
  }); await sleep(600);
  const at = await run(() => {const el=[...document.querySelectorAll('.canvas-node')].find(e=>e.innerText==='Alpha');const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  await move(at);await sleep(150);
  console.log('HOVER',JSON.stringify(await run(()=>[...document.querySelectorAll('[class*="connection"], [class*="connector"]')].map(e=>({cls:e.getAttribute('class'),rect:e.getBoundingClientRect().toJSON(),display:getComputedStyle(e).display,opacity:getComputedStyle(e).opacity,background:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).border})))));
  await click(at);
  console.log('SELECTED',JSON.stringify(await run(()=>[...document.querySelectorAll('.canvas-node')].map(e=>({text:e.innerText,cls:e.className,children:[...e.children].map(c=>({cls:c.getAttribute('class'),rect:c.getBoundingClientRect().toJSON()}))})))));
  const shot = async name => writeFile(new URL(name+'.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const read = () => run(() => app.workspace.activeLeaf.view.getViewData());
  const rect = name => run(name=>{const r=[...document.querySelectorAll('.canvas-node')].find(e=>e.innerText===name).getBoundingClientRect();return r.toJSON();},name);
  const drag = async (a,b) => {await move(a);await send('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',buttons:1,clickCount:1});for(let i=1;i<=16;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/16,y:a.y+(b.y-a.y)*i/16,buttons:1});await sleep(20);}await shot('obsidian-drag');await send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',clickCount:1});await sleep(1600);};
  console.log('DOT_CHILDREN',JSON.stringify(await run(()=>[...document.querySelectorAll('.canvas-node-connection-point')].map(e=>({box:e.getBoundingClientRect().toJSON(),children:[...e.children].map(c=>({cls:c.getAttribute('class'),rect:c.getBoundingClientRect().toJSON(),bg:getComputedStyle(c).backgroundColor,border:getComputedStyle(c).border,radius:getComputedStyle(c).borderRadius}))})))));
  await move(await run(()=>{const r=document.querySelectorAll('.canvas-node-connection-point')[1].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};}));await sleep(100);
  console.log('DOT_STYLE',JSON.stringify(await run(()=>[...document.querySelectorAll('.canvas-node-connection-point')].map(e=>{const s=getComputedStyle(e,'::before');const a=getComputedStyle(e,'::after');return{cls:e.className,before:{width:s.width,height:s.height,bg:s.backgroundColor,border:s.border,opacity:s.opacity,display:s.display},after:{width:a.width,height:a.height,bg:a.backgroundColor,border:a.border,opacity:a.opacity,display:a.display}};}))));
  await shot('obsidian-dots');
  let a=await rect('Alpha'),b=await rect('Beta'),c=await rect('Gamma');
  await drag({x:a.right-1,y:a.y+a.height/2},{x:b.x+b.width/2,y:b.y+b.height/2});
  console.log('CREATED',await read());console.log('VIEW_JSON',await run(()=>app.workspace.activeLeaf.view.getViewData()));
  console.log('PATHS',JSON.stringify(await run(()=>[...document.querySelectorAll('.canvas-edges path')].map(e=>({cls:e.getAttribute('class'),stroke:getComputedStyle(e).stroke,width:getComputedStyle(e).strokeWidth,opacity:getComputedStyle(e).opacity})))));
  console.log('EDGE_DOM',JSON.stringify(await run(()=>[...document.querySelectorAll('[class*="canvas-edge"]')].map(e=>({tag:e.tagName,cls:e.getAttribute('class'),rect:e.getBoundingClientRect().toJSON(),stroke:getComputedStyle(e).stroke,width:getComputedStyle(e).strokeWidth,children:[...e.children].map(c=>({tag:c.tagName,cls:c.getAttribute('class'),rect:c.getBoundingClientRect().toJSON()}))})))));
  await click(await run(()=>{const e=[...document.querySelectorAll('.canvas-edges path')].find(e=>e.getTotalLength()>30);const p=e.getPointAtLength(e.getTotalLength()/2);const q=new DOMPoint(p.x,p.y).matrixTransform(e.getScreenCTM());return{x:q.x,y:q.y};}));await sleep(100);
  console.log('EDGE_SELECTED',JSON.stringify(await run(()=>[...document.querySelectorAll('[class*="canvas-edge"], .canvas-menu [aria-label]')].map(e=>({cls:e.getAttribute('class'),label:e.getAttribute('aria-label'),rect:e.getBoundingClientRect().toJSON(),stroke:getComputedStyle(e).stroke,width:getComputedStyle(e).strokeWidth,background:getComputedStyle(e).backgroundColor})))));
  console.log('ENDPOINTS',JSON.stringify(await run(()=>[...document.querySelectorAll('[class*=connection], .canvas-display-path')].map(e=>({cls:e.className?.baseVal??e.className,rect:e.getBoundingClientRect().toJSON(),stroke:getComputedStyle(e).stroke,width:getComputedStyle(e).strokeWidth})))));
  await shot('obsidian-edge-selected');
  await click('[aria-label="Set color"]');console.log('COLOR_MENU',JSON.stringify(await run(()=>[...document.querySelectorAll('.menu-item, [class*=color-picker]')].map(e=>({text:e.innerText,cls:e.className})))));await press('Escape');
  console.log('TOOLBAR',JSON.stringify(await run(()=>[...document.querySelectorAll('.canvas-menu [aria-label]')].map(e=>({label:e.getAttribute('aria-label'),icons:[...e.querySelectorAll('svg')].map(s=>s.getAttribute('class'))})))));
  const direction=await run(()=>[...document.querySelectorAll('.canvas-menu [aria-label]')].find(e=>/direction/i.test(e.getAttribute('aria-label')))?.getAttribute('aria-label'));
  if(direction){await click('[aria-label="'+direction+'"]');console.log('DIRECTION_MENU',JSON.stringify(await run(()=>({text:document.body.innerText.slice(-500),items:[...document.querySelectorAll('[class*=direction], [class*=arrow]')].map(e=>({cls:e.getAttribute('class'),text:e.textContent,labels:[...e.querySelectorAll('[aria-label]')].map(c=>c.getAttribute('aria-label'))}))}))));await press('Escape');}
  await drag({x:b.x+b.width/2,y:b.y-9},{x:c.x+c.width/2,y:c.y+5});console.log('RECONNECTED',await read());
  await shot('obsidian-reconnected');
  // Reconnect the source from the exposed line end, outside the card's dot.
  await drag({x:a.right+18,y:a.y+a.height/2},{x:b.x+3,y:b.y+b.height/2});console.log('RECONNECT_SOURCE',await read());
  await click(await run(()=>{const e=document.querySelector('.canvas-display-path');const p=e.getPointAtLength(e.getTotalLength()/2);const q=new DOMPoint(p.x,p.y).matrixTransform(e.getScreenCTM());return{x:q.x,y:q.y};}));
  await press('Delete');await sleep(1600);console.log('DELETED',await read());await press('z',2);await sleep(1600);console.log('UNDO_DELETE',await read());
  a=await rect('Alpha');await move({x:a.x+a.width/2,y:a.y+a.height/2});await sleep(50);
  await drag({x:a.x+a.width/2,y:a.y},{x:a.x+a.width/2-80,y:a.y-80});console.log('EMPTY_DROP',JSON.stringify(await run(()=>({menus:[...document.querySelectorAll('.menu-item')].map(e=>e.innerText),text:document.querySelector('.prompt')?.innerText})))),console.log('EMPTY_JSON',await read());await shot('obsidian-empty-drop');await press('Escape');
  await drag({x:a.right-1,y:a.y+a.height/2},{x:a.x+3,y:a.y+a.height/2});console.log('SELF_DROP',await read());
});
