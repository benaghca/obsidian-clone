import assert from 'node:assert/strict';
import {withBrowser,sleep} from './browser.mjs';
import {notes,bases} from '../../round31-shots/fixtures.mjs';
import {writeFile} from 'node:fs/promises';
const shots=new URL('../../round32-shots/',import.meta.url);
const original=bases['By due.base'];
await withBrowser(async({run,send,point,move,click,fill,press,check,shot})=>{
 const wait=async(test,label)=>{for(let i=0;i<120;i++){if(await test())return;await sleep(20);}assert.fail(label);};
 const source=()=>run(async()=>{const{api}=await import('/src/api.ts');return api.readNote('Multi.base');});
 const choose=async title=>{if(await run(()=>!!document.querySelector('.bases-filter-picker')))await fill('[aria-label="Filter property search"]',title);await click(await run(title=>{const el=[...document.querySelectorAll('.menu-item')].find(el=>el.querySelector('.menu-item-title')?.textContent===title);if(!el)throw Error('Missing '+title);const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},title));};
 const th=key=>`.bases-table th[data-property="${key}"]`;
 const width=key=>run(s=>document.querySelector(s).getBoundingClientRect().width,th(key));
 const headers=()=>run(()=>[...document.querySelectorAll('.bases-table th')].map(el=>el.dataset.property));
 const drag=async(from,to,inspect,cancel=false)=>{await move(from);await send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1});for(let i=1;i<=10;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(to.x-from.x)*i/10,y:from.y+(to.y-from.y)*i/10,buttons:1});await sleep(16);}if(inspect)await inspect();if(cancel)await press('Escape');await send('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',buttons:0,clickCount:1});await sleep(100);};
 const ready=()=>wait(()=>run(()=>!!document.querySelector('.bases-filter-editor')),'filter ready');
 const snapshot=()=>run(()=>({headers:[...document.querySelectorAll('.bases-table th')].map(th=>({key:th.dataset.property,label:th.querySelector('span').textContent,width:th.getBoundingClientRect().width})),rows:[...document.querySelectorAll('.bases-table tbody tr[data-path]')].map(tr=>({path:tr.dataset.path,values:[...tr.cells].map(td=>td.dataset.value)}))}));
 await run(async(notes,source)=>{const{api}=await import('/src/api.ts');for(const[p,s]of Object.entries({...notes,'Multi.base':source}))await api.createNote(p,s);await ws.vault.refreshFiles();await ws.open('Multi.base');},notes,original);
 await wait(()=>run(()=>document.querySelector('.bases-count')?.textContent==='3 results'),'table');
 const auto=await width('due'), grip=th('due')+' .bases-resizer';
 assert.equal(await run(s=>{const el=document.querySelector(s),r=el.getBoundingClientRect();return [r.width,r.height,getComputedStyle(el).cursor].join('|');},grip),'6|30|col-resize');
 let p=await point(grip);
 await drag(p,{x:p.x+60,y:p.y},async()=>{assert.equal(await source(),original);assert.equal(await width('due'),auto+60);});
 const sized=original.replace('# Keep this too','    columnSize:\n      note.due: 188\n# Keep this too');
 assert.equal(auto,128);await wait(async()=>await source()===sized,'resize writes exactly one block');assert.equal(await width('due'),188);
 p=await point(grip);await drag(p,{x:p.x-400,y:p.y});const min=sized.replace('note.due: 188','note.due: 40');await wait(async()=>await source()===min,'clamped write');assert.equal(await width('due'),40);
 p=await point(grip);await move(p);for(const clickCount of [1,2])for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount});await wait(async()=>await source()===original,'double-click removes size key');assert.equal(await width('due'),auto);
 p=await point(grip);await drag(p,{x:p.x+60,y:p.y},null,true);assert.equal(await source(),original);assert.equal(await width('due'),auto);
 // A plain click and stationary repeated clicks never sort or rewrite the file.
 const plain=await point(th('priority'));await move(plain);for(let i=0;i<2;i++)for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...plain,button:'left',clickCount:1});assert.equal(await source(),original);
 const edge=async(key,right)=>run((s,right)=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x+(right?r.width-10:10),y:r.y+15};},th(key),right);
 p=await point(th('status'));await drag(p,await edge('due',false),async()=>assert.ok(await run(()=>!!document.querySelector('.bases-column-drop'))));
 await wait(async()=>(await headers()).join('|')==='file.name|status|due|priority','header before');
 const reordered=original.replace('      - due\n      - priority\n      - status','      - status\n      - due\n      - priority');assert.equal(await source(),reordered);
 p=await point(th('file.name'));await drag(p,await edge('priority',true));await wait(async()=>(await headers()).at(-1)==='file.name','first column moves after');
 const beforeCancel=await source();p=await point(th('due'));await drag(p,{x:700,y:400});assert.equal(await source(),beforeCancel);
 p=await point(th('due'));await drag(p,await edge('status',false),null,true);assert.equal(await source(),beforeCancel);
 await click('.bases-toolbar [aria-label="Sort"]');assert.equal(await run(()=>document.querySelector('.bases-sort-row button:nth-of-type(2)').textContent),'Old to new');
 const sg='.bases-sort-row .bases-sort-grip';assert.equal(await run(s=>{const e=document.querySelector(s),r=e.querySelector('svg').getBoundingClientRect();return[r.width,r.height,getComputedStyle(e).cursor].join('|');},sg),'16|16|grab');
 p=await point(sg);const end=await run(()=>{const r=[...document.querySelectorAll('.bases-sort-row')].at(-1).getBoundingClientRect();return{x:r.x+8,y:r.bottom-3};});await drag(p,end);
 await wait(async()=>(await source()).includes('sort:\n      - property: file.name\n        direction: DESC\n      - property: due\n        direction: ASC'),'sort swapped');assert.ok(await run(()=>!!document.querySelector('.bases-sort-menu')));await shot('grove-sort');await press('Escape');
 // Existing sizes include negative values; display clamps without rewriting on open.
 await run(async()=>{const{api}=await import('/src/api.ts');await api.createNote('Invalid sizes.base','views:\n  - type: table\n    order: [file.name, status]\n    columnSize:\n      file.name: -228\n      note.status: 120\n');await ws.vault.refreshFiles();await ws.open('Invalid sizes.base');});await wait(async()=>await width('file.name')===40,'read invalid size clamped');assert.equal(await width('status'),120);
 await run(()=>ws.open('Multi.base'));await wait(async()=>(await headers()).at(-1)==='file.name','back to Multi');
 await click('.bases-toolbar [aria-label="Filter"]');const beforeAdd=await source();
 await click('[data-scope="view"] [aria-label="Add filter"]');assert.ok(await run(()=>!!document.querySelector('.bases-filter-picker input')));assert.equal(await source(),beforeAdd);await press('Escape');assert.equal(await source(),beforeAdd);assert.ok(await run(()=>!!document.querySelector('.bases-filter-editor')));await press('Escape');
 await click('.bases-toolbar [aria-label="Filter"]');await click('[data-scope="view"] [aria-label="Add filter"]');await fill('[aria-label="Filter property search"]','priority');await choose('priority');await ready();assert.equal(await source(),beforeAdd);
 await fill('[data-scope="view"] .bases-filter-row:has([data-draft]) input','4');await press('Enter');await wait(async()=>(await source()).includes('priority == 4'),'completed filter saved');await ready();
 const metrics=await run(()=>{const row=document.querySelector('.bases-filter-row'),input=row.querySelector('input'),button=row.querySelector('.bases-filter-icon'),con=document.querySelector('.bases-filter-conjunction');return{row:row.getBoundingClientRect().height,input:input.getBoundingClientRect().height,button:[button.getBoundingClientRect().width,button.getBoundingClientRect().height],con:con.getBoundingClientRect().width};});assert.deepEqual(metrics,{row:28,input:28,button:[28,24],con:226});
 await click('[data-scope="view"] [aria-label="Add filter"]');await choose('priority');await ready();await click('[data-scope="view"] .bases-filter-row:has([data-draft]) button:nth-of-type(2)');await choose('is empty');await wait(async()=>(await source()).includes('priority == null'),'no-value operator completes row');await press('Escape');
 // Restore the useful native filter before saving return-check fixtures.
 await run(async text=>{const{api}=await import('/src/api.ts');await api.writeNote('Multi.base',text);ws.vault.written('Multi.base');},beforeAdd);await wait(()=>run(()=>document.querySelector('.bases-count')?.textContent==='3 results'),'restored');
 // Set explicit widths, including the last column, for a native width round trip.
 for(const key of await headers()){p=await point(th(key)+' .bases-resizer');await drag(p,{x:p.x+60,y:p.y});}
 await writeFile(new URL('Grove-written.base',shots),await source());await writeFile(new URL('written.json',shots),JSON.stringify(await snapshot(),null,2));await writeFile(new URL('notes.json',shots),JSON.stringify(notes,null,2));await shot('grove-written');
 await click('.bases-view-name');assert.equal(await run(()=>document.querySelector('.bases-view-menu').getBoundingClientRect().width),225);assert.ok(await run(()=>!!document.querySelector('.is-current-view')));await fill('[aria-label="Search views"]','missing');assert.equal(await run(()=>document.querySelectorAll('.bases-view-option').length),0);await fill('[aria-label="Search views"]','');await choose('Add view');await wait(()=>run(()=>document.querySelector('.bases-view-name span')?.textContent==='View'),'first added View');await click('.bases-view-name');await choose('Add view');await wait(()=>run(()=>document.querySelector('.bases-view-name span')?.textContent==='View 1'),'second added View 1');
 await click('.bases-view-name');await choose('By due');await wait(async()=>(await headers()).length===4,'original view');
 await click(th('due'),'right');const header=await run(()=>({checked:document.querySelector('.menu-item.is-checked')?.textContent,red:getComputedStyle(document.querySelector('.menu-item.is-warning')).color,separators:document.querySelectorAll('.menu-separator').length}));assert.equal(header.checked,'Sort A → Z');assert.equal(header.red,'rgb(233, 49, 71)');assert.ok(header.separators>=1);await press('Escape');
 await click('.bases-toolbar [aria-label="Properties"]');const props=await run(()=>{const items=[...document.querySelectorAll('.menu-item')],add=items.find(e=>e.textContent==='Add formula'),hide=items.find(e=>e.textContent==='Hide all');return{color:getComputedStyle(add).color,add:!!add.querySelector('svg'),hide:!!hide.querySelector('svg'),search:!!document.querySelector('.bases-search svg')};});assert.deepEqual(props,{color:'rgb(34, 34, 34)',add:true,hide:true,search:true});await shot('grove-properties');await press('Escape');
 for(const label of ['Sort','Filter','Properties','View']){
  const selector=`.bases-toolbar [aria-label="${label}"]`;
  await run(()=>document.addEventListener('click',()=>{window.bt={visible:0,max:0};let last=performance.now(),frame=0;requestAnimationFrame(function tick(now){frame++;bt.max=Math.max(bt.max,now-last);last=now;if(!bt.visible&&document.querySelector('.menu'))bt.visible=frame;if(frame<19)requestAnimationFrame(tick);});},{once:true,capture:true}));
  await click(selector);await sleep(340);const t=await run(()=>bt);check(t.visible===1&&t.max<20,`${label}: first frame, max ${t.max.toFixed(1)}ms`);assert.equal(await run(()=>[...document.querySelectorAll('.menu')].some(e=>e.getAnimations().length)),false);
  p=await point(selector);await move(p);for(const shown of [false,true]){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await wait(()=>run(shown=>!!document.querySelector('.menu')===shown,shown),'stationary menu toggle');}await press('Escape');
 }
 console.log('PASS Bases resize/reset, header and Sort drags, pending filters and menu details');
},{height:800,screenshots:shots.pathname});
