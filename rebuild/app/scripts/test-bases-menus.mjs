import assert from 'node:assert/strict';
import {withBrowser,sleep} from './browser.mjs';
import {notes,bases} from '../../round31-shots/fixtures.mjs';
import {writeFile} from 'node:fs/promises';
const shots=new URL('../../round31b-shots/',import.meta.url);
const original=`# preserve header
filters:
  and:
    - file.inFolder("BaseTest")
# global end
properties:
  note.status:
    displayName: Status
views:
  - type: table
    name: "Open"
    filters:
      and:
        - status != "done"
    # local end
    order: [file.name, status, priority]
  - type: table
    name: Done
    filters: 'status == "done"'
    order: [file.name, status]
# preserve footer
extra: 'unknown bytes'
`;
await withBrowser(async({run,send,click,point,move,press,chord,fill,check,shot})=>{
 const wait=async(test,label)=>{for(let i=0;i<150;i++){if(await test())return;await sleep(20);}assert.fail(label);};
 const source=()=>run(async()=>{const{api}=await import('/src/api.ts');return api.readNote('PartB.base');});
 const rows=()=>run(()=>[...document.querySelectorAll('.bases-table tbody tr[data-path]')].map(tr=>tr.dataset.path));
 const count=async n=>wait(()=>run(n=>document.querySelector('.bases-count')?.textContent===`${n} results`,n),`${n} results`);
 const choose=async title=>click(await run(title=>{const el=[...document.querySelectorAll('.menu-item')].find(el=>el.querySelector('.menu-item-title')?.textContent===title);if(!el)throw Error('No menu item '+title);const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},title));
 const local='.bases-filter-editor [data-scope="view"]', global='.bases-filter-editor [data-scope="all"]';
 const value=local+' .bases-filter-row input';
 const ready=()=>wait(()=>run(()=>!!document.querySelector('.bases-filter-editor')),'Filter refreshed');
 const timed=async selector=>{
  await run(()=>document.addEventListener('pointerdown',()=>{window.bt={visible:0,max:0};let last=performance.now(),frame=0;requestAnimationFrame(function tick(now){frame++;bt.max=Math.max(bt.max,now-last);last=now;if(!bt.visible&&document.querySelector('.menu'))bt.visible=frame;if(frame<19)requestAnimationFrame(tick);});},{once:true,capture:true}));
  await click(selector);await sleep(340);const t=await run(()=>bt);check(t.visible>0&&t.visible<=2&&t.max<20,`${selector}: frame ${t.visible}, max ${t.max.toFixed(1)}ms`);
  assert.equal(await run(()=>[...document.querySelectorAll('.menu')].some(el=>el.getAnimations().length>0)),false);
 };
 await run(async(notes,bases,source)=>{const{api}=await import('/src/api.ts');for(const[p,s]of Object.entries({...notes,...bases,'PartB.base':source}))await api.createNote(p,s);await ws.vault.refreshFiles();await ws.open('PartB.base');window.firstBaseTab=ws.active;},notes,bases,original);await count(5);
 await timed('.bases-toolbar [aria-label="Filter"]');await shot('grove-filter-initial');
 await fill(value,'waiting');assert.equal(await source(),original);await press('Escape');assert.equal(await source(),original);
 await click('.bases-toolbar [aria-label="Filter"]');await fill(value,'waiting');await click('.bases-toolbar');await count(6);
 assert.equal(await run(()=>!!document.querySelector('.bases-filter-menu')),false);await click('.bases-toolbar [aria-label="Filter"]');await ready();
 assert.equal(await source(),original.replace('        - status != "done"','        - status != "waiting"'));
 await click(local+' .bases-filter-conjunction');await choose('None of the following are true');await count(0);await ready();
 await click(local+' .bases-filter-conjunction');await choose('Any of the following are true');await count(6);await ready();
 await click(local+' [aria-label="Add filter"]');await ready();
 await wait(()=>run(()=>document.querySelectorAll('[data-scope="view"] .bases-filter-row').length===2),'second filter');
 await click(local+' .bases-filter-row:nth-of-type(2) button');await choose('priority');await ready();
 await click(local+' .bases-filter-row:nth-of-type(2) button:nth-of-type(2)');await choose('>');await ready();
 await fill(local+' .bases-filter-row:nth-of-type(2) input','3');await press('Enter');await ready();
 await click(local+' .bases-filter-conjunction');await choose('All the following are true');await count(2);await ready();
 await click(local+' [aria-label="Add filter group"]');await ready();
 await wait(()=>run(()=>!!document.querySelector('[data-scope="view"] [data-depth="1"]')),'nested group');
 await click(local+' [data-depth="1"] [aria-label="Add filter"]');await ready();await count(0);
 await click(local+' [data-depth="1"] [aria-label="Advanced filter"]');
 await fill(local+' [data-depth="1"] [aria-label="Filter expression"]','active == true && priority >= 4');await press('Enter');await count(2);await ready();
 await click(local+' [data-depth="1"] .bases-filter-conjunction');await choose('None of the following are true');await count(0);await ready();
 await click(local+' [aria-label="Remove filter group"]');await count(2);await ready();
 // The global section changes only its block, leaving the view block and other keys alone.
 await click(global+' .bases-filter-heading');const beforeGlobal=await source();
 await fill(global+' input','Nowhere');await press('Enter');await count(0);await ready();
 assert.equal(await source(),beforeGlobal.replace('file.inFolder("BaseTest")','file.inFolder("Nowhere")'));
 await fill(global+' input','BaseTest');await press('Enter');await count(2);await ready();
 const beforeRemove=await source();await click(local+' .bases-filter-row:nth-of-type(2) [aria-label="Remove filter"]');await count(6);await ready();
 assert.equal(await source(),beforeRemove.replace('        - priority > 3\n',''));
 const written=await source();await writeFile(new URL('Grove-written.base',shots),written);await writeFile(new URL('notes.json',shots),JSON.stringify(notes,null,2));
 await shot('grove-filter');await press('Escape');
 await timed('.bases-view-name');await choose('Done');await count(1);assert.equal(await source(),written);
 assert.deepEqual(await rows(),['BaseTest/Task B.md']);
 await run(async()=>{await ws.open('BaseTest/Task A.md');await ws.open('PartB.base');});await count(1);assert.equal(await run(()=>document.querySelector('.bases-view-name span').textContent),'Done');
 await run(async()=>{await ws.open('PartB.base',{where:'tab'});window.secondBaseTab=ws.active;});await count(6);assert.equal(await run(()=>document.querySelector('.bases-view-name span').textContent),'Open');
 await run(()=>ws.activate(firstBaseTab));await count(1);
 await click('.bases-view-name');await choose('Add view');await wait(()=>run(()=>document.querySelector('.bases-view-name span')?.textContent==='View 1'),'new view selected');
 assert.equal(await source(),written.replace('# preserve footer','  - type: table\n    name: View 1\n# preserve footer'));
 await click('.bases-view-name');await shot('grove-views');await choose('Open');await count(6);
 await run(()=>ws.activate(secondBaseTab));await count(6);assert.equal(await run(()=>document.querySelector('.bases-view-name span').textContent),'Open');
 // Sorted columns alone offer Clear sort; every header action has an icon.
 await click('th[data-property="status"]','right');assert.equal(await run(()=>document.querySelector('.menu').textContent.includes('Clear sort')),false);
 assert.equal(await run(()=>[...document.querySelectorAll('.menu-item')].every(el=>!!el.querySelector('svg'))),true);await choose('Sort A → Z');
 await wait(async()=>(await source()).includes('property: status'),'sort saved');await click('th[data-property="status"]','right');await choose('Clear sort');
 await wait(async()=>(await source()).includes('sort: []'),'sort cleared');
 await click('.bases-toolbar [aria-label="Properties"]');
 assert.equal(await run(()=>document.querySelector('.bases-properties-popover').getBoundingClientRect().width),225);
 assert.equal(await run(()=>{const row=document.querySelector('.bases-property-option.is-unchecked');return getComputedStyle(row).color===getComputedStyle(document.querySelector('.bases-count')).color;}),true);await press('Escape');
 // Filter and view buttons toggle at one stationary pointer location.
 for(const [selector,menu] of [['.bases-toolbar [aria-label="Filter"]','.bases-filter-menu'],['.bases-view-name','.bases-view-menu']]){
  const p=await point(selector);await move(p);
  for(const visible of [true,false,true]){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await wait(()=>run((menu,visible)=>!!document.querySelector(menu)===visible,menu,visible),'stationary menu toggle');}await press('Escape');
 }
 // Save all selected-view results for the native return check.
 const results={};
 for(const [name,n] of [['Open',6],['Done',1],['View 1',6]]){
  await click('.bases-view-name');await choose(name);await count(n);
  results[name]=await run(()=>({columns:[...document.querySelectorAll('.bases-table th span')].map(el=>el.textContent),rows:[...document.querySelectorAll('.bases-table tbody tr[data-path]')].map(tr=>({path:tr.dataset.path,values:[...tr.cells].map(td=>td.dataset.value)}))}));
 }
 await writeFile(new URL('Grove-written.base',shots),await source());await writeFile(new URL('written-views.json',shots),JSON.stringify(results,null,2));
 await click('.bases-view-name');await choose('Open');await count(6);await shot('grove-written');
 // New bases select the shared inline rename control; rename keeps the extension and bytes.
 await chord('p');await fill('.prompt-input','Bases: Create new base');await press('Enter');
 await wait(()=>run(()=>getSelection()?.toString()==='Untitled'&&document.activeElement?.matches('.view-header-title')),'new base selected title');
 await send('Input.insertText',{text:'Renamed base'});await press('Enter');
 await wait(()=>run(()=>ws.active.viewFile==='Renamed base.base'),'new base renamed');
 assert.equal(await run(async()=>{const{api}=await import('/src/api.ts');return api.readNote('Renamed base.base');}),'views:\n  - type: table\n    name: View\n');
 await run(()=>ws.open('By due.base'));await count(3);await click('.bases-toolbar [aria-label="Filter"]');await shot('grove-native-filter');
 check(true,'Bases filter groups, lossless writes, per-tab views, Add view, header actions and selected rename');
},{height:800,screenshots:shots.pathname});
