import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withObsidian, sleep } from './obsidian-driver.mjs';
const source=await readFile(new URL('Grove-controls.canvas',import.meta.url),'utf8');
await withObsidian(async({run,click,press,shot,vault})=>{
 await run(async source=>{await app.vault.create('Toolbar.canvas',source);await app.workspace.openLinkText('Toolbar.canvas','',false);},source);await sleep(1000);
 assert.equal(await readFile(join(vault,'Toolbar.canvas'),'utf8'),source,'Opening Grove toolbar edit keeps exact file bytes');
 const displayed=await run(()=>JSON.parse(app.workspace.activeLeaf.view.getViewData()));
 const expected=JSON.parse(source);
 for(const node of expected.nodes){const actual=displayed.nodes.find(n=>n.id===node.id);for(const key of ['x','y','width','height','color','text'])assert.equal(actual[key],node[key],key);}
 console.log('PASS Grove toolbar edit opens in Obsidian with identical geometry, text, color and disk bytes');
 await click('.canvas-node');await shot('obsidian-toolbar-from-grove');await click('[aria-label="Set color"]');
 console.log('PALETTE',JSON.stringify(await run(()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>=18&&r.width<=24&&r.height>=18&&r.height<=24&&getComputedStyle(e).backgroundColor!=='rgba(0, 0, 0, 0)';}).map(e=>({class:e.className,color:getComputedStyle(e).backgroundColor,rect:e.getBoundingClientRect().toJSON()})))));
 const purple=await run(()=>{const e=[...document.querySelectorAll('body *')].find(e=>{const r=e.getBoundingClientRect();return r.width>=18&&r.width<=24&&getComputedStyle(e).backgroundColor==='rgb(120, 82, 238)';});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});assert.ok(purple,'native purple swatch visible');await click(purple);await press('Escape');
 let reverse;for(let i=0;i<30;i++){await sleep(100);reverse=await readFile(join(vault,'Toolbar.canvas'),'utf8');if(JSON.parse(reverse).nodes.find(n=>n.id==='a').color==='6')break;}
 assert.equal(JSON.parse(reverse).nodes.find(n=>n.id==='a').color,'6');await writeFile(new URL('Obsidian-controls.canvas',import.meta.url),reverse);await shot('obsidian-toolbar-purple');console.log('PASS Native Obsidian palette edit saved color 6 for reverse Grove check');
});
