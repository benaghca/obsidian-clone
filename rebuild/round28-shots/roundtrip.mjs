import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
await withObsidian(async({run,send,click,press,vault})=>{
 const names=(await readdir(new URL('.',import.meta.url))).filter(n=>/^Grove-group-.*\.canvas$/.test(n));assert.equal(names.length,9);
 for(const name of names){
  const source=await readFile(new URL(name,import.meta.url),'utf8'),expected=JSON.parse(source);
  await run(async(name,source)=>{await app.vault.create(name,source);await app.workspace.openLinkText(name,'',false);},name,source);await sleep(300);
  assert.equal(await readFile(join(vault,name),'utf8'),source,name+': original bytes');
  const actual=JSON.parse(await run(()=>app.workspace.activeLeaf.view.getViewData()));
  for(const n of expected.nodes){const a=actual.nodes.find(a=>a.id===n.id);assert.ok(a);for(const k of ['type','x','y','width','height','text','label','color'])assert.equal(a[k],n[k],name+': node '+k);}
  for(const e of expected.edges){const a=actual.edges.find(a=>a.id===e.id);assert.ok(a);for(const k of ['fromNode','fromSide','toNode','toSide'])assert.equal(a[k],e[k],name+': edge '+k);}
  console.log('PASS',name+': every displayed group/card/edge property and original disk byte is unchanged in Obsidian');
 }
 await run(()=>app.workspace.openLinkText('Grove-group-colored.canvas','',false));await sleep(200);
 await click('.canvas-group-label');await click('.canvas-menu [aria-label="Edit label"]');await sleep(100);await press('a',2);await send('Input.insertText',{text:'Native group'});await press('Enter');await click({x:1150,y:700});await sleep(200);
 await click('.canvas-group-label');await click('.canvas-menu [aria-label="Set color"]');await click('.canvas-color-picker-item.mod-canvas-color-3');
 let reverse;
 for(let i=0;i<80;i++){await sleep(100);reverse=await readFile(join(vault,'Grove-group-colored.canvas'),'utf8');const g=JSON.parse(reverse).nodes.find(n=>n.type==='group');if(g.label==='Native group'&&g.color==='3')break;}
 const g=JSON.parse(reverse).nodes.find(n=>n.type==='group');assert.equal(g.label,'Native group');assert.equal(g.color,'3');
 await writeFile(new URL('Obsidian-groups.canvas',import.meta.url),reverse);
 await writeFile(new URL('obsidian-group-return.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 console.log('PASS Native label/color edits save a reverse fixture for Grove');
});
