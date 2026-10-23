import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withObsidian, sleep } from '../round25-shots/obsidian-driver.mjs';
await withObsidian(async ({run,send,click,move,vault}) => {
 const names=(await readdir(new URL('.',import.meta.url))).filter(n=>/^Grove-.*\.canvas$/.test(n));
 for(const name of names) {
  const source=await readFile(new URL(name,import.meta.url),'utf8'),expected=JSON.parse(source);
  await run(async(name,source)=>{await app.vault.create(name,source);await app.workspace.openLinkText(name,'',false);},name,source);await sleep(400);
  assert.equal(await readFile(join(vault,name),'utf8'),source,name+': exact disk bytes after open');
  const displayed=await run(()=>JSON.parse(app.workspace.activeLeaf.view.getViewData()));
  const known=expected.nodes.filter(n=>['text','file','link','group'].includes(n.type)),ids=new Set(known.map(n=>n.id));
  for(const node of known) {
   const actual=displayed.nodes.find(n=>n.id===node.id);assert.ok(actual,name+': node '+node.id);
   for(const key of ['type','x','y','width','height','text','file','color'])assert.equal(actual[key],node[key],name+': '+key);
  }
  for(const edge of expected.edges.filter(e=>e&&ids.has(e.fromNode)&&ids.has(e.toNode))) {
   const actual=displayed.edges.find(e=>e.id===edge.id);assert.ok(actual,name+': edge '+edge.id);
   for(const key of ['fromNode','fromSide','toNode','toSide','fromEnd','toEnd','color','label'])assert.equal(actual[key],edge[key],name+': '+key);
  }
  console.log('PASS',name+': every displayed node/edge property and original disk byte is unchanged in Obsidian');
 }
 await run(()=>app.workspace.openLinkText('Grove-created.canvas','',false));await sleep(500);
 const source=JSON.parse(await readFile(new URL('Grove-created.canvas',import.meta.url),'utf8')),id=source.edges.find(e=>e&&!['old','opaque-edge'].includes(e.id)).id;
 const rect=name=>run(name=>{const r=[...document.querySelectorAll('.canvas-node')].find(e=>e.innerText===name).getBoundingClientRect();return r.toJSON();},name);
 const b=await rect('Beta'),c=await rect('Gamma');
 const p=await run(()=>{const e=[...document.querySelectorAll('.canvas-display-path')].find(e=>e.getBoundingClientRect().width>100&&e.getBoundingClientRect().height<1);const p=e.getPointAtLength(e.getTotalLength()/2),q=new DOMPoint(p.x,p.y).matrixTransform(e.getScreenCTM());return{x:q.x,y:q.y};});
 await click(p);await sleep(100);
 await writeFile(new URL('obsidian-grove-created.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const start={x:b.left-9,y:b.y+b.height/2},end={x:c.x+c.width/2,y:c.y+3};await move(start);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});
 for(let i=1;i<=18;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+(end.x-start.x)*i/18,y:start.y+(end.y-start.y)*i/18,buttons:1});await sleep(20);}
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',buttons:0,clickCount:1});await sleep(300);
 const edited=await run(()=>JSON.parse(app.workspace.activeLeaf.view.getViewData()));assert.equal(edited.edges.find(e=>e.id===id)?.toNode,'c','native endpoint drag reconnects the same edge');
 let reverse;
 for(let i=0;i<80;i++){await sleep(100);reverse=await readFile(join(vault,'Grove-created.canvas'),'utf8');if(JSON.parse(reverse).edges.find(e=>e?.id===id)?.toNode==='c')break;}
 assert.equal(JSON.parse(reverse).edges.find(e=>e?.id===id)?.toNode,'c','native reconnection is saved');
 await writeFile(new URL('Obsidian-arrows.canvas',import.meta.url),reverse);
 await writeFile(new URL('obsidian-reverse.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 console.log('PASS Native Obsidian reconnect saves the same edge ID for the reverse Grove check');
});
