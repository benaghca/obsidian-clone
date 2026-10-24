import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withObsidian, sleep } from '../round25-shots/obsidian-driver.mjs';
await withObsidian(async({run,send,point,move,click,press,vault})=>{
 await run(async()=>{await app.vault.create('A DropNote.md','---\ntags: [canvas]\n---\n# Heading\nBody');await app.vault.createBinary('A DropImage.svg',new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="orange"/></svg>'));});
 const names=(await readdir(new URL('.',import.meta.url))).filter(n=>/^Grove-.*\.canvas$/.test(n));
 assert.equal(names.length,9);
 for(const name of names){
  const source=await readFile(new URL(name,import.meta.url),'utf8'),expected=JSON.parse(source);
  await run(async(name,source)=>{await app.vault.create(name,source);await app.workspace.openLinkText(name,'',false);},name,source);await sleep(350);
  assert.equal(await readFile(join(vault,name),'utf8'),source,name+': original bytes');
  const actual=await run(()=>JSON.parse(app.workspace.activeLeaf.view.getViewData()));
  for(const n of expected.nodes){const a=actual.nodes.find(a=>a.id===n.id);assert.ok(a);for(const k of ['type','x','y','width','height','text','file'])assert.equal(a[k],n[k],name+': node '+k);}
  for(const e of expected.edges){const a=actual.edges.find(a=>a.id===e.id);assert.ok(a);for(const k of ['fromNode','fromSide','toNode','toSide'])assert.equal(a[k],e[k],name+': edge '+k);}
  console.log('PASS',name+': Obsidian displays every node/edge and retains every original byte, including unknown fields and key order');
 }
 await run(()=>app.workspace.openLinkText('Grove-connected-right.canvas','',false));await sleep(300);
 const drag=async(a,b)=>{await move(a);await send('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',clickCount:1});for(let i=1;i<=15;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/15,y:a.y+(b.y-a.y)*i/15,button:'left',buttons:1});await sleep(30);}await send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',clickCount:1});await sleep(200);};
 const view=await run(()=>document.querySelector('.canvas-wrapper').getBoundingClientRect().toJSON());
 const source=await run(()=>[...document.querySelectorAll('.canvas-node')].find(e=>e.innerText==='Source').getBoundingClientRect().toJSON());
 await drag({x:source.x+source.width/2,y:source.bottom-1},{x:source.x+source.width/2+60,y:source.bottom+120});
 await click('.menu-item:nth-child(2)');await send('Input.insertText',{text:'A DropImage.svg'});await click('.suggestion-item');await press('Escape');
 await drag(await point('.nav-file-title[data-path="A DropNote.md"]'),{x:view.x+60,y:view.y+70});
 let reverse;
 for(let i=0;i<80;i++){await sleep(100);reverse=await readFile(join(vault,'Grove-connected-right.canvas'),'utf8');const d=JSON.parse(reverse);if(d.nodes.length===4&&d.edges.length===2)break;}
 const d=JSON.parse(reverse);assert.equal(d.nodes.length,4);assert.equal(d.edges.length,2);assert.equal(d.nodes.find(n=>n.file==='A DropImage.svg').height,200);assert.ok(d.nodes.some(n=>n.file==='A DropNote.md'));
 await writeFile(new URL('Obsidian-return.canvas',import.meta.url),reverse);
 await writeFile(new URL('obsidian-roundtrip.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 console.log('PASS Native explorer note drop and connection media choice save a reverse fixture for Grove');
});
