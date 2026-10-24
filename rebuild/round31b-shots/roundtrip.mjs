import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
const source=await readFile(new URL('Grove-written.base',import.meta.url),'utf8');
const notes=JSON.parse(await readFile(new URL('notes.json',import.meta.url),'utf8'));
const wanted=JSON.parse(await readFile(new URL('written-views.json',import.meta.url),'utf8'));
await withObsidian(async({run,send,click,press})=>{
 await run(async(notes,source)=>{await app.vault.createFolder('BaseTest');for(const[p,s]of Object.entries(notes))await app.vault.create(p,s);await app.vault.create('Grove-written.base',source);await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('Grove-written.base'));},notes,source);await sleep(700);
 const result={};
 for(const name of Object.keys(wanted)){
  if(name!=='Open'){
   await click('.workspace-leaf.mod-active .bases-toolbar-item');
   await click(await run(name=>{const e=[...document.querySelectorAll('.popover *, .menu *')].find(e=>e.textContent===name&&e.children.length===0);if(!e)throw Error('Missing view '+name);const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},name));await sleep(200);
  }
  result[name]=await run(()=>({columns:[...document.querySelectorAll('.workspace-leaf.mod-active .bases-thead .bases-table-header-name')].map(el=>el.innerText),rows:[...document.querySelectorAll('.workspace-leaf.mod-active .bases-tbody .bases-tr')].map(tr=>({path:tr.querySelector('.internal-link')?.dataset.href,values:[...tr.querySelectorAll('.bases-td')].map(td=>td.querySelector('input')?.value??td.innerText)}))}));
  assert.deepEqual(result[name],wanted[name]);
  await writeFile(new URL(`obsidian-written-${name.replaceAll(' ','-')}.png`,import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 await press('Escape');assert.equal(await run(()=>app.vault.read(app.vault.getAbstractFileByPath('Grove-written.base'))),source);
 await writeFile(new URL('roundtrip.json',import.meta.url),JSON.stringify(result,null,2));console.log('PASS native return check: all three views, rows, columns, values and untouched YAML');
});
