import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
const source=await readFile(new URL('Grove-written.base',import.meta.url),'utf8'),notes=JSON.parse(await readFile(new URL('notes.json',import.meta.url),'utf8')),expected=JSON.parse(await readFile(new URL('written.json',import.meta.url),'utf8'));
await withObsidian(async({run,send,click})=>{
 await run(async(notes,source)=>{await app.vault.createFolder('BaseTest');for(const[p,s]of Object.entries(notes))await app.vault.create(p,s);await app.vault.create('Grove-written.base',source);await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('Grove-written.base'));},notes,source);await sleep(600);
 const actual=await run(()=>({name:document.querySelector('.bases-toolbar-item')?.textContent,rows:[...document.querySelectorAll('.bases-tbody .bases-tr')].map(e=>({path:e.querySelector('.internal-link')?.dataset.href,height:e.getBoundingClientRect().height}))}));assert.deepEqual(actual,expected);
 assert.equal(await run(()=>app.vault.read(app.vault.getAbstractFileByPath('Grove-written.base'))),source);
 await click('.bases-toolbar-item');await click('.bases-toolbar-menu-item-icon');assert.equal(await run(()=>document.activeElement?.value),'Renamed: view');assert.equal(await run(()=>document.querySelector('.popover select:not(.is-measuring),.menu select:not(.is-measuring)').value),'medium');
 await writeFile(new URL('roundtrip.json',import.meta.url),JSON.stringify(actual,null,2));await writeFile(new URL('obsidian-written.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));console.log('PASS native return check: identical name, ordered rows, 60px height, selected Configure values and YAML');
});
