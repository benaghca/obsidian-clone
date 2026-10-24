import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
import {notes,bases} from '../round31-shots/fixtures.mjs';
import {writeFile} from 'node:fs/promises';
await withObsidian(async({run,send,click,press})=>{
 await run(async(notes,bases)=>{await app.vault.createFolder('BaseTest');for(const[p,s]of Object.entries({...notes,...bases}))await app.vault.create(p,s);await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('By due.base'));},notes,bases);await sleep(700);
 const result={};
 const snap=()=>run(()=>[...document.querySelectorAll('.menu,.popover')].map(el=>({text:el.innerText,box:{x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height},controls:[...el.querySelectorAll('input,button,select,[contenteditable],.dropdown')].map(e=>({tag:e.tagName,text:e.innerText,value:e.value,placeholder:e.placeholder,label:e.getAttribute('aria-label'),class:e.className}))})));
 const capture=async name=>{result[name]=await snap();await writeFile(new URL(name+'.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));console.log(name,JSON.stringify(result[name]));};
 const label=async text=>click(await run(text=>{const es=[...document.querySelectorAll('.workspace-leaf.mod-active .bases-toolbar *, .popover *, .menu *')];const e=es.find(e=>e.textContent===text&&e.children.length===0);const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},text));
 await label('Filter');await capture('obsidian-filter');
 await press('Escape');
 await label('Properties');await capture('obsidian-properties');result.propertyColors=await run(()=>[...document.querySelectorAll('.popover *, .menu *')].filter(e=>e.children.length===0&&e.textContent.trim()).map(e=>({text:e.textContent,color:getComputedStyle(e).color})));await press('Escape');
 await click('.workspace-leaf.mod-active .bases-toolbar-item');await capture('obsidian-views');
 await label('Add view');await capture('obsidian-add-view');await press('Escape');
 await run(()=>app.commands.executeCommandById('bases:new-file'));await sleep(400);result.newBase=await run(()=>({selection:getSelection()?.toString(),focused:document.activeElement?.className,content:app.workspace.activeLeaf.view.file?.path}));
 await writeFile(new URL('observed.json',import.meta.url),JSON.stringify(result,null,2));
});
