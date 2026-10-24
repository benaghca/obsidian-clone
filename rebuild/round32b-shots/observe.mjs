import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
import {notes,bases} from '../round31-shots/fixtures.mjs';
import {writeFile} from 'node:fs/promises';
const source=bases['By due.base'].replace('      - due\n      - priority\n      - status','      - status\n      - due\n      - priority');
await withObsidian(async({run,send,click,press})=>{
 await run(async(notes,source)=>{await app.vault.createFolder('BaseTest');for(const[p,s]of Object.entries(notes))await app.vault.create(p,s);await app.vault.create('Multi.base',source);await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('Multi.base'));},notes,source);await sleep(700);
 const result={};
 const shot=async name=>writeFile(new URL(name+'.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const label=async text=>click(await run(text=>{const e=[...document.querySelectorAll('.workspace-leaf.mod-active .bases-toolbar *, .menu *, .popover *')].find(e=>e.textContent===text&&e.children.length===0&&e.getBoundingClientRect().width>0);if(!e)throw Error('Missing '+text);const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},text));
 await label('3 results');result.results=await run(()=>[...document.querySelectorAll('.menu,.popover')].map(e=>({text:e.innerText,width:e.getBoundingClientRect().width,icons:[...e.querySelectorAll('svg')].map(s=>s.getAttribute('class')),inputs:[...e.querySelectorAll('input')].map(e=>({value:e.value,placeholder:e.placeholder,type:e.type}))})));await shot('obsidian-results');await label('Copy to clipboard');result.copied=await run(()=>Promise.race([navigator.clipboard.readText().catch(e=>String(e)),new Promise(r=>setTimeout(()=>r('unavailable'),400))]));await press('Escape');
 await label('3 results');await click('.menu input[type="number"]');await press('a',2);await send('Input.insertText',{text:'2'});await press('Enter');await sleep(250);result.limitEnter=await run(()=>({menu:!!document.querySelector('.menu'),text:document.querySelector('.menu')?.innerText,count:[...document.querySelectorAll('.bases-toolbar-item')].map(e=>e.textContent)}));await press('Escape');
 await label('Sort');result.sort=await run(()=>[...document.querySelectorAll('svg.lucide-grip-vertical')].map(e=>{const row=e.parentElement.parentElement;return{text:row.textContent,height:row.getBoundingClientRect().height,controls:[...row.children].map(e=>({text:e.textContent,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))};}));await shot('obsidian-sort');await press('Escape');
 await label('Filter');await label('Add filter');await shot('obsidian-picker');await press('Escape');await press('Escape');
 await label('New');await sleep(400);result.new=await run(async()=>{const f=app.vault.getFiles().find(f=>f.name==='Untitled.md');return{path:f?.path,text:f?await app.vault.read(f):null,selection:getSelection()?.toString(),focused:document.activeElement?.className};});await shot('obsidian-new');
 await writeFile(new URL('observed.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
});
