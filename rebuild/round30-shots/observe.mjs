import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
import {notes,bases} from './fixtures.mjs';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
await withObsidian(async({run,send,click,move,point})=>{
 await run(async(notes,bases)=>{await app.vault.createFolder('BaseTest');for(const [p,s]of Object.entries({...notes,...bases}))await app.vault.create(p,s);},notes,bases);
 await sleep(1600);
 const results={};
 for(const [path,source]of Object.entries(bases)){
  await run(async p=>{await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(p));},path);await sleep(600);
  results[path]=await run(()=>({text:document.querySelector('.workspace-leaf.mod-active .view-content')?.innerText,columns:[...document.querySelectorAll('.workspace-leaf.mod-active .bases-table-header-name')].map(n=>n.textContent), rows:[...document.querySelectorAll('.workspace-leaf.mod-active .bases-tbody .bases-tr')].map(tr=>({path:tr.querySelector('.internal-link')?.dataset.href,values:[...tr.querySelectorAll('.bases-td')].map(td=>{const input=td.querySelector('input');return input ? input.type==='checkbox' ? String(input.checked) : input.value : td.innerText;})}))}));
  assert.equal(await run(p=>app.vault.read(app.vault.getAbstractFileByPath(p)),path),source);
  if(path==='Tasks.base'){await click('.workspace-leaf.mod-active .bases-td[data-property="note.priority"]');const p=await point('.workspace-leaf.mod-active .bases-td[data-property="note.priority"]');for(let i=0;i<2;i++)for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await move({x:10,y:10});assert.equal(await run(p=>app.vault.read(app.vault.getAbstractFileByPath(p)),path),source);}
  if(path==='Tasks.base')await writeFile(new URL('obsidian.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 await writeFile(new URL('observed.json',import.meta.url),JSON.stringify(results,null,2));
 console.log(Object.fromEntries(Object.entries(results).map(([p,r])=>[p,r.text])));
});
