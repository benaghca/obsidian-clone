import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
import {notes,bases} from './fixtures.mjs';
import {writeFile} from 'node:fs/promises';
await withObsidian(async({run,send,click,press})=>{
 await run(async(notes,bases)=>{await app.vault.createFolder('BaseTest');for(const[p,s]of Object.entries({...notes,...bases}))await app.vault.create(p,s);},notes,bases);await sleep(1000);
 const result={};
 const snapshot=()=>run(()=>{const root=document.querySelector('.workspace-leaf.mod-active .view-content'),box=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{x:r.x,y:r.y,w:r.width,h:r.height,font:s.fontSize,family:s.fontFamily,color:s.color,weight:s.fontWeight};};return {text:root.innerText,view:box(root),toolbar:box(root.querySelector('.bases-toolbar')),headers:[...root.querySelectorAll('.bases-thead .bases-td')].map(el=>({name:el.innerText,...box(el),icon:box(el.querySelector('svg')),label:box(el.querySelector('.bases-table-header-name'))})),rows:[...root.querySelectorAll('.bases-tbody .bases-tr')].map(tr=>({path:tr.querySelector('.internal-link')?.dataset.href,values:[...tr.querySelectorAll('.bases-td')].map(td=>{const input=td.querySelector('input');return input?input.value:td.innerText;})}))};});
 for(const path of Object.keys(bases)){
  await run(async p=>{await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(p));},path);await sleep(400);result[path]=await snapshot();
  await writeFile(new URL(path==='Tasks.base'?'obsidian.png':'obsidian-due.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 await run(async()=>{await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('Tasks.base'));});await sleep(300);
 const selector='.workspace-leaf.mod-active .bases-tr:nth-child(1) [data-property="note.status"] [contenteditable]';
 const p=await run(s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x+1,y:r.y+r.height/2};},selector);await click(p);await send('Input.insertText',{text:'X'});await sleep(200);
 result.typing={snapshot:await snapshot(),note:await run(()=>app.vault.read(app.vault.getAbstractFileByPath('BaseTest/Task D.md')))};
 await press('Enter');await sleep(200);result.enter={snapshot:await snapshot(),note:await run(()=>app.vault.read(app.vault.getAbstractFileByPath('BaseTest/Task D.md')))};
 await click('.workspace-leaf.mod-active [data-property="note.priority"] input');await press('a',2);await send('Input.insertText',{text:'0'});await sleep(150);result.numberFocused=await snapshot();await press('Enter');await sleep(150);result.numberEnter=await snapshot();await click('.workspace-leaf.mod-active .bases-toolbar');await sleep(200);result.numberBlur=await snapshot();
 await run(()=>{const el=[...document.querySelectorAll('.workspace-leaf.mod-active .bases-toolbar .text-icon-button')].find(el=>el.innerText==='Sort');window.sortSelector=el?.className;});
 // Locate toolbar controls by rendered labels, then use real pointer input.
 for(const label of ['Sort','Properties']){const p=await run(label=>{const root=document.querySelector('.workspace-leaf.mod-active .bases-toolbar');const el=[...root.querySelectorAll('*')].find(e=>e.textContent===label&&e.children.length===0);const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},label);await click(p);result[label]=await run(()=>({text:[...document.querySelectorAll('.menu,.popover')].map(el=>el.innerText),inputs:[...document.querySelectorAll('.menu input,.popover input')].map(el=>({placeholder:el.placeholder,type:el.type}))}));await press('Escape');}
 for(const key of ['typing','enter','numberFocused','numberEnter','numberBlur']){const v=result[key],snap=v.snapshot??v;result[key]={rows:snap.rows.map(r=>r.path),values:snap.rows.map(r=>r.values.join(' | ')),...(v.note?{note:v.note}:{})};}
 await writeFile(new URL('observed.json',import.meta.url),JSON.stringify(result,null,2));console.log(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,v.rows?.map(r=>r.path)??v.text??'captured'])));
});
