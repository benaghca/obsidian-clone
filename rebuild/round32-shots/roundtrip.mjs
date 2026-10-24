import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
const source=await readFile(new URL('Grove-written.base',import.meta.url),'utf8');
const notes=JSON.parse(await readFile(new URL('notes.json',import.meta.url),'utf8'));
const expected=JSON.parse(await readFile(new URL('written.json',import.meta.url),'utf8'));
await withObsidian(async({run,send})=>{
 await run(async(notes,source)=>{await app.vault.createFolder('BaseTest');for(const[p,s]of Object.entries(notes))await app.vault.create(p,s);await app.vault.create('Grove-written.base',source);await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('Grove-written.base'));},notes,source);await sleep(700);
 const actual=await run(()=>({headers:[...document.querySelectorAll('.bases-thead .bases-td')].map(el=>({label:el.querySelector('.bases-table-header-name').innerText,width:el.getBoundingClientRect().width})),rows:[...document.querySelectorAll('.bases-tbody .bases-tr')].map(tr=>({path:tr.querySelector('.internal-link')?.dataset.href,values:[...tr.querySelectorAll('.bases-td')].map(td=>td.querySelector('input')?.value??td.innerText)}))}));
 assert.deepEqual(actual.headers,expected.headers.map(({label,width})=>({label,width})));assert.deepEqual(actual.rows,expected.rows);
 assert.equal(await run(()=>app.vault.read(app.vault.getAbstractFileByPath('Grove-written.base'))),source);
 await writeFile(new URL('roundtrip.json',import.meta.url),JSON.stringify(actual,null,2));await writeFile(new URL('obsidian-written.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 console.log('PASS native return check: identical columns, widths, rows, values and YAML');
});
