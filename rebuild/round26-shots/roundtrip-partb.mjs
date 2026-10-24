import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withObsidian, sleep } from '../round25-shots/obsidian-driver.mjs';
await withObsidian(async ({run,send,click,press,vault}) => {
 const names=(await readdir(new URL('.',import.meta.url))).filter(n=>/^Grove-B-.*\.canvas$/.test(n));
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
 await run(()=>app.workspace.openLinkText('Grove-B-label-toolbar.canvas','',false));await sleep(400);
 await click('.canvas-path-label');await click('[aria-label="Edit label"]');await press('a',2);await send('Input.insertText',{text:'Obsidian return label'});await press('Escape');await sleep(200);
 await click('[aria-label="Line direction"]');await click('.menu-item:nth-child(3)');await click('[aria-label="Set color"]');await click('.canvas-color-picker-item.mod-canvas-color-3');await sleep(300);
 let reverse;
 for(let i=0;i<80;i++){await sleep(100);reverse=await readFile(join(vault,'Grove-B-label-toolbar.canvas'),'utf8');const e=JSON.parse(reverse).edges.find(e=>e.id==='e');if(e.label==='Obsidian return label'&&e.fromEnd==='arrow'&&e.color==='3')break;}
 const e=JSON.parse(reverse).edges.find(e=>e.id==='e');assert.equal(e.label,'Obsidian return label');assert.equal(e.fromEnd,'arrow');assert.equal(e.color,'3');
 await writeFile(new URL('Obsidian-partb.canvas',import.meta.url),reverse);
 await writeFile(new URL('obsidian-partb-return.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 console.log('PASS Native label, bidirectional and yellow actions save the reverse Grove fixture');
});
