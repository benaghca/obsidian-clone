import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const source=await readFile(new URL('Grove-written.base',import.meta.url),'utf8'),notes=JSON.parse(await readFile(new URL('written-notes.json',import.meta.url),'utf8')),grove=JSON.parse(await readFile(new URL('written-view.json',import.meta.url),'utf8'));
await withObsidian(async({run,send})=>{
 await run(async(notes,source)=>{await app.vault.createFolder('BaseTest');for(const[p,s]of Object.entries(notes))await app.vault.create(p,s);await app.vault.create('Grove-written.base',source);await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('Grove-written.base'));},notes,source);await sleep(1000);
 const native=await run(()=>({columns:[...document.querySelectorAll('.workspace-leaf.mod-active .bases-table-header-name')].map(el=>el.textContent),rows:[...document.querySelectorAll('.workspace-leaf.mod-active .bases-tbody .bases-tr')].map(tr=>({path:tr.querySelector('.internal-link')?.dataset.href,values:[...tr.querySelectorAll('.bases-td')].map(td=>{const input=td.querySelector('input');return input?input.value:td.innerText;})}))}));
 assert.deepEqual(native,grove);assert.equal(await run(()=>app.vault.read(app.vault.getAbstractFileByPath('Grove-written.base'))),source);
 await writeFile(new URL('obsidian-written.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await writeFile(new URL('roundtrip.json',import.meta.url),JSON.stringify(native,null,2));console.log('PASS Obsidian opens Grove sort/order writes with identical rows, columns and values; YAML unchanged');
});
