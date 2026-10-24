import assert from 'node:assert/strict';
import {withBrowser,sleep} from './browser.mjs';
import {notes,bases} from '../../round31-shots/fixtures.mjs';
import {writeFile,readFile} from 'node:fs/promises';
const shots=new URL('../../round31-shots/',import.meta.url);
const native=JSON.parse(await readFile(new URL('observed.json',shots),'utf8'));
await withBrowser(async({run,send,click,point,move,press,chord,fill,check,shot})=>{
 const wait=async(test,label)=>{for(let i=0;i<100;i++){if(await test())return;await sleep(20);}assert.fail(label);};
 const source=path=>run(async p=>{const{api}=await import('/src/api.ts');return api.readNote(p);},path);
 const menu=async title=>click(await run(title=>{const el=[...document.querySelectorAll('.menu-item')].find(el=>el.querySelector('.menu-item-title')?.textContent===title);const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},title));
 const open=async path=>{await run(p=>ws.open(p),path);await wait(()=>run(()=>!!document.querySelector('.bases-count')),'table ready');};
 const td=(path,key)=>`.bases-table tr[data-path="${path}"] td[data-property="${key}"]`;
 const field=(path,key)=>td(path,key)+' [data-part="value"]';
 const rows=()=>run(()=>[...document.querySelectorAll('.bases-table tbody tr[data-path]')].map(tr=>tr.dataset.path));
 const snapshot=()=>run(()=>({columns:[...document.querySelectorAll('.bases-table th span')].map(el=>el.textContent),rows:[...document.querySelectorAll('.bases-table tbody tr[data-path]')].map(tr=>({path:tr.dataset.path,values:[...tr.cells].map(td=>td.dataset.value)}))}));
 const timedOpen=async(selector,label)=>{
  await run(()=>document.addEventListener('pointerdown',()=>{window.baseTiming={visible:0,max:0};let last=performance.now(),frame=0;requestAnimationFrame(function tick(now){frame++;baseTiming.max=Math.max(baseTiming.max,now-last);last=now;if(!baseTiming.visible&&document.querySelector('.menu'))baseTiming.visible=frame;if(frame<19)requestAnimationFrame(tick);});},{once:true,capture:true}));
  await click(selector);await sleep(340);const timing=await run(()=>baseTiming);
  check(timing.visible>0&&timing.visible<=2&&timing.max<20,`${label}: visible in two frames, max ${timing.max.toFixed(1)}ms`);
  assert.equal(await run(()=>[...document.querySelectorAll('.menu')].some(el=>el.getAnimations().length)),false);
 };
 await run(async(notes,bases)=>{const{api}=await import('/src/api.ts');for(const[p,s]of Object.entries({...notes,...bases}))await api.createNote(p,s);await ws.vault.refreshFiles();await ws.open('Tasks.base');},notes,bases);
 await wait(()=>run(()=>document.querySelector('.bases-count')?.textContent==='5 results'),'five results');
 const layout=await run(()=>{const box=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};};return{view:box(document.querySelector('.bases-view')),toolbar:box(document.querySelector('.bases-toolbar')),table:box(document.querySelector('.bases-table')),headers:[...document.querySelectorAll('.bases-table th')].map(th=>({name:th.innerText,...box(th),icon:box(th.querySelector('svg')),label:box(th.querySelector('span')),font:getComputedStyle(th).fontSize,color:getComputedStyle(th).color,weight:getComputedStyle(th).fontWeight})),row:box(document.querySelector('.bases-table tbody tr'))};});
 console.log('LAYOUT',JSON.stringify(layout));
 assert.equal(layout.table.x,layout.view.x);assert.equal(layout.toolbar.y-layout.view.y,5);assert.equal(layout.toolbar.h,29);assert.equal(layout.headers[0].y-layout.view.y,40);assert.equal(layout.row.h,30);
 for(const h of layout.headers){assert.equal(h.h,30);assert.equal(h.icon.w,14);assert.equal(h.icon.h,14);assert.equal(h.label.x-h.x,26);assert.equal(h.font,'13.125px');assert.equal(h.weight,'400');}
 assert.deepEqual(layout.headers.map(h=>h.w),native['Tasks.base'].headers.map(h=>h.w));
 assert.deepEqual((await snapshot()).rows,native['Tasks.base'].rows);
 await writeFile(new URL('grove-layout.json',shots),JSON.stringify(layout,null,2));await shot('grove');
 await open('By due.base');await wait(()=>run(()=>document.querySelector('.bases-count')?.textContent==='3 results'),'due view ready');
 assert.deepEqual((await snapshot()).rows,native['By due.base'].rows);await shot('grove-due');await open('Tasks.base');await wait(()=>run(()=>document.querySelector('.bases-count')?.textContent==='5 results'),'sample restored');
 const d='BaseTest/Task D.md';
 // Place the text caret at the beginning using real pointer input.
 const p=await run(s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x+8,y:r.y+r.height/2};},field(d,'status'));await click(p);await send('Input.insertText',{text:'X'});assert.equal(await source(d),notes[d]);await press('Enter');
 await wait(async()=>(await source(d)).includes('status: Xopen'),'text commits');assert.equal(await source(d),notes[d].replace('status: open','status: Xopen'));assert.equal(await source('Tasks.base'),bases['Tasks.base']);
 await fill(field(d,'status'),'cancelled');await press('Escape');await click('.bases-toolbar');assert.ok((await source(d)).includes('status: Xopen'));
 await fill(field(d,'priority'),'0');assert.equal((await rows())[0],d);await press('Enter');await wait(async()=>(await rows())[3]===d,'row re-sorts on commit');
 await fill(field(d,'status'),'done');await press('Enter');await wait(async()=>!(await rows()).includes(d),'row re-filters on commit');
 // Restore the fixture and edit a missing number, checkbox and tag list.
 await run(async text=>{const{api}=await import('/src/api.ts');await api.writeNote('BaseTest/Task D.md',text);ws.vault.written('BaseTest/Task D.md');},notes[d]);await wait(async()=>(await rows())[0]===d,'restored task');
 await fill(field('BaseTest/Task E.md','priority'),'7');await press('Enter');await wait(async()=>(await source('BaseTest/Task E.md')).includes('priority: 7'),'missing property added');await wait(async()=>(await rows())[0]==='BaseTest/Task E.md','missing priority re-sorts');
 const tagAdd=td(d,'tags')+' [data-part="add"]';await fill(tagAdd,'newtag');await press('Enter');await wait(async()=>(await source(d)).includes('  - newtag'),'tag added');
 await click(td(d,'tags')+' .property-pill-remove');await click('.bases-toolbar');await wait(async()=>!(await source(d)).includes('work/project'),'tag removed');
 assert.equal(await source('Tasks.base'),bases['Tasks.base']);
 // Sort menu and header menu only change the sort block.
 await timedOpen('.bases-toolbar [aria-label="Sort"]','Sort');await wait(()=>run(()=>!!document.querySelector('.bases-sort-menu')),'sort menu');await click('.bases-sort-row button:nth-of-type(2)');await menu('0 → 1');await wait(async()=>(await source('Tasks.base')).includes('direction: ASC'),'direction changed');
 assert.equal(await source('Tasks.base'),bases['Tasks.base'].replace('direction: DESC','direction: ASC'));
 await press('Escape');await click('th[data-property="status"]','right');await menu('Sort A → Z');await wait(async()=>(await source('Tasks.base')).includes('property: status'),'header sorts');
 await timedOpen('.bases-toolbar [aria-label="Properties"]','Properties');await fill('.bases-properties-menu input[type="search"]','due');await click('.bases-property-option input');await wait(()=>run(()=>!document.querySelector('th[data-property="due"]')),'column hidden');await press('Escape');
 const written=await source('Tasks.base');assert.ok(written.startsWith(bases['Tasks.base'].split('    order:')[0]));
 await writeFile(new URL('Grove-written.base',shots),written);await writeFile(new URL('written-notes.json',shots),JSON.stringify(await run(async()=>{const{api}=await import('/src/api.ts');return Object.fromEntries(await Promise.all(ws.vault.notes.filter(n=>n.path.startsWith('BaseTest/')).map(async n=>[n.path,await api.readNote(n.path)])));}),null,2));
 await writeFile(new URL('written-view.json',shots),JSON.stringify(await snapshot(),null,2));await shot('grove-written');
 await click('.bases-toolbar [aria-label="Sort"]');await menu('Add sort');await menu('due');await wait(async()=>(await source('Tasks.base')).includes('property: due'),'Add sort');
 await click('.bases-sort-row button:first-of-type');await menu('file name');await wait(async()=>(await source('Tasks.base')).includes('property: file.name'),'change sort property');
 await click(await run(()=>{const el=[...document.querySelectorAll('.bases-sort-row')].at(-1).querySelector('button:last-child');const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};}));await wait(async()=>!(await source('Tasks.base')).includes('property: due'),'remove sort');await press('Escape');
 await click('th[data-property="file.name"]','right');await menu('Clear sort');await wait(async()=>!(await source('Tasks.base')).includes('property: file.name'),'clear header sort');
 await click('.bases-toolbar [aria-label="Properties"]');await menu('Hide all');await wait(()=>run(()=>document.querySelectorAll('.bases-table th').length===0),'Hide all');
 await fill('.bases-properties-menu input[type="search"]','file name');
 const togglePoint=await point('.bases-property-option input');await move(togglePoint);
 for(const count of [1,0,1]){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...togglePoint,button:'left',clickCount:1});await wait(()=>run(n=>document.querySelectorAll('.bases-table th').length===n,count),'stationary column toggle');}await press('Escape');
 const sortPoint=await point('.bases-toolbar [aria-label="Sort"]');await move(sortPoint);
 for(const shown of [true,false,true]){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...sortPoint,button:'left',clickCount:1});await wait(()=>run(shown=>!!document.querySelector('.bases-sort-menu')===shown,shown),'stationary Sort clicks');}await press('Escape');
 // Existing-note edits must travel through the editor's undoable state in all modes.
 for(const mode of ['live','source','reading']){
  await run(async mode=>{const{api}=await import('/src/api.ts');const path=`Open-${mode}.md`;await api.createNote(path,'---\nstatus: open\npriority: 1\n---\n# One\n## Two\n### Three\n');await ws.vault.refreshFiles();await ws.open(path);ws.setMode(mode);await ws.open('Tasks.base',{where:'right'});},mode);await sleep(80);
  // Use an unfiltered base for this pane so the open note is a row.
  await run(async()=>{const{api}=await import('/src/api.ts');if(!ws.vault.files.some(f=>f.path==='All.base')){await api.createNote('All.base','views:\n  - type: table\n    order:\n      - file.name\n      - status\n');await ws.vault.refreshFiles();}await ws.open('All.base');});await wait(()=>run(()=>!!document.querySelector('.bases-table tr[data-path^="Open-"]')),'open note row');
  await fill(field(`Open-${mode}.md`,'status'),'changed');await press('Enter');await wait(()=>run(p=>ws.editors.doc(p)?.toString().includes('status: changed'),`Open-${mode}.md`),'loaded note updated');
  await run(p=>{const g=ws.layout.groups().find(g=>g.active.path===p);ws.focusGroup(g);ws.view.focus();},`Open-${mode}.md`);await chord('z');
  check(await run(p=>ws.editors.doc(p)?.toString().includes('status: open'),`Open-${mode}.md`),`${mode}: cell edit is undoable in open note`);
  assert.equal(await run(()=>ws.active.mode),mode);if(mode==='reading')assert.equal(await run(()=>ws.view.state.readOnly),true);
  await run(()=>{for(const g of ws.layout.groups().slice(1))for(const t of [...g.tabs])ws.closeTab(t,g);});
 }
 // Every typed control uses the Properties writer, including calendar segments.
 let fields='---\n# retained\nstatus: "Quoted"\ndue: 2026-10-20\nwhen: 2026-10-20T12:34:56\nactive: true\nlabels:\n  - alpha\n---\n# One\n## Two\n### Three\n';
 await run(async text=>{const{api}=await import('/src/api.ts');await api.createNote('Fields.md',text);await api.createNote('Fields.base','filters: \'file.name == "Fields"\'\nviews:\n  - type: table\n    order:\n      - file.name\n      - due\n      - when\n      - active\n      - labels\n');await ws.vault.refreshFiles();await ws.open('Fields.base');},fields);
 await wait(()=>run(()=>!!document.querySelector('tr[data-path="Fields.md"]')),'typed controls');
 for(const key of ['due','when']){
  const target=field('Fields.md',key),before=await run(s=>document.querySelector(s).value,target);
  await click(target);await press('ArrowUp');const value=await run(s=>document.querySelector(s).value,target);assert.notEqual(value,before);await press('Enter');
  fields=fields.replace(`${key}: ${before}`,`${key}: ${value}`);await wait(async()=>(await source('Fields.md'))===fields,`${key} changes only its line`);
 }
 await click(field('Fields.md','active'));fields=fields.replace('active: true','active: false');await wait(async()=>(await source('Fields.md'))===fields,'checkbox changes only its line');
 await fill(td('Fields.md','labels')+' [data-part="add"]','beta');await press('Enter');fields=fields.replace('  - alpha','  - alpha\n  - beta');await wait(async()=>(await source('Fields.md'))===fields,'list item added');
 await click(td('Fields.md','labels')+' .property-pill-remove');await click('.bases-toolbar');fields=fields.replace('  - alpha\n','');await wait(async()=>(await source('Fields.md'))===fields,'list item removed');
 await fill(td('Fields.md','labels')+' [data-part="add"]','cancelled');await press('Escape');assert.equal(await source('Fields.md'),fields);
 assert.equal(await source('Fields.base'),'filters: \'file.name == "Fields"\'\nviews:\n  - type: table\n    order:\n      - file.name\n      - due\n      - when\n      - active\n      - labels\n');
 // Command and explorer context menu create exact canonical content and unique names.
 await chord('p');await fill('.prompt-input','Bases: Create new base');await press('Enter');await wait(()=>run(()=>ws.active.type==='base'&&ws.active.viewFile?.startsWith('Untitled')),'new base command');
 assert.equal(await source(await run(()=>ws.active.viewFile)),'views:\n  - type: table\n    name: View\n');
 await click(await run(()=>{const r=document.querySelector('.nav-files-container').getBoundingClientRect();return{x:r.x+180,y:r.bottom-15};}),'right');await click(await run(()=>{const el=[...document.querySelectorAll('.menu-item')].find(el=>el.textContent==='New base');const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};}));await wait(()=>run(()=>ws.active.viewFile==='Untitled 1.base'),'explorer New base');
 assert.equal(await source('Untitled 1.base'),'views:\n  - type: table\n    name: View\n');
 await click('.tree-item-self[data-path="BaseTest"]','right');await menu('New base');await wait(()=>run(()=>ws.active.viewFile==='BaseTest/Untitled.base'),'folder New base');assert.equal(await source('BaseTest/Untitled.base'),'views:\n  - type: table\n    name: View\n');
 console.log('PASS Bases editing, sort/order writes, menus and New base');
},{height:800,screenshots:shots.pathname});
