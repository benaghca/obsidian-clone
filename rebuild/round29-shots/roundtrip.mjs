import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
await withObsidian(async({run,send,click,vault})=>{
 await run(async()=>{await app.vault.create('Backdrop.svg','<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="lightblue"/></svg>');});
 const names=(await readdir(new URL('.',import.meta.url))).filter(n=>/^Grove-.*\.canvas$/.test(n));assert.equal(names.length,13);
 for(const name of names){
  const source=await readFile(new URL(name,import.meta.url),'utf8'),expected=JSON.parse(source);
  await run(async(name,source)=>{await app.vault.create(name,source);await app.workspace.openLinkText(name,'',false);},name,source);await sleep(300);
  assert.equal(await readFile(join(vault,name),'utf8'),source,name+': exact disk bytes');
  const actual=JSON.parse(await run(()=>app.workspace.activeLeaf.view.getViewData()));
  for(const n of expected.nodes){const a=actual.nodes.find(a=>a.id===n.id);assert.ok(a);for(const k of ['type','x','y','width','height','text','label','color','background','backgroundStyle'])assert.equal(a[k],n[k],name+': node '+k);}
  console.log('PASS',name+': native geometry, label, color, background/style and original bytes unchanged');
 }
 await run(()=>app.workspace.openLinkText('Grove-background-repeat.canvas','',false));await sleep(150);await click('.canvas-group-label');await click('.canvas-menu [aria-label="Edit background"]');
 await click(await run(()=>{const e=[...document.querySelectorAll('.menu-item')].find(e=>e.innerText.trim()==='Keep aspect ratio'),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};}));
 let reverse;for(let i=0;i<80;i++){await sleep(100);reverse=await readFile(join(vault,'Grove-background-repeat.canvas'),'utf8');if(JSON.parse(reverse).nodes[0].backgroundStyle==='ratio')break;}
 assert.equal(JSON.parse(reverse).nodes[0].background,'Backdrop.svg');assert.equal(JSON.parse(reverse).nodes[0].backgroundStyle,'ratio');
 await writeFile(new URL('Obsidian-polish.canvas',import.meta.url),reverse);
 await writeFile(new URL('obsidian-background.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 console.log('PASS Native Keep aspect ratio action writes an explicit ratio return fixture');
});
