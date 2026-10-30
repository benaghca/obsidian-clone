// Read-only Bases: real CDP pointer/key input in a scratch mock vault.
import assert from 'node:assert/strict';
import {withBrowser,sleep} from './browser.mjs';
import {notes,bases} from '../../round30-shots/fixtures.mjs';
import {writeFile,readFile} from 'node:fs/promises';
const shots = new URL('../../round30-shots/',import.meta.url);
const observed=JSON.parse(await readFile(new URL('observed.json',shots),'utf8'));
await withBrowser(async({run,send,click,point,move,press,chord,fill,shot,check})=>{
 const wait = async(test,label)=>{for(let i=0;i<100;i++){if(await test())return;await sleep(20);}assert.fail(label);};
 await run(async(notes,bases)=>{
  const {api}=await import('/src/api.ts');
  for(const [p,s] of Object.entries({...notes,...bases}))await api.createNote(p,s);
  await ws.vault.refreshFiles();await ws.vault.refreshLinks();
 },notes,bases);
 const rows = ()=>run(()=>[...document.querySelectorAll('.bases-table tbody tr[data-path]')].map(tr=>tr.dataset.path));
 const values = ()=>run(()=>[...document.querySelectorAll('.bases-table tbody tr[data-path]')].map(tr=>[...tr.cells].map(c=>c.dataset.value)));
 const open = async path=>{await run(p=>ws.open(p),path);await wait(()=>run(()=>!!document.querySelector('.bases-view') && document.querySelector('.bases-toolbar')?.textContent !== ''),'base rendered');};
 const explorer='.nav-files .tree-item-self[data-path="Tasks.base"]';
 await click(explorer);
 await wait(()=>run(()=>document.querySelector('.bases-count')?.textContent==='5 results'),'sample ready');
 check(await run(()=>ws.active.type==='base' && ws.active.viewFile==='Tasks.base'),'explorer opens a base tab');
 assert.equal(await run(s=>document.querySelector(s+' .nav-file-tag').textContent,explorer),'base');
 assert.deepEqual(await rows(),['Task D','Task A','Task F','Task C','Task E'].map(n=>`BaseTest/${n}.md`));
 assert.deepEqual(await run(()=>[...document.querySelectorAll('.bases-table th span')].map(n=>n.textContent)),['file name','Status','priority','due','tags','Late']);
 const sample=await values();
 assert.deepEqual(sample,observed['Tasks.base'].rows.map(r=>r.values));
 assert.equal(sample[1][5],'late');assert.equal(sample[4][2],'');assert.equal(sample[0][2],'5');
 assert.equal(await run(()=>document.querySelector('.bases-table tbody tr').getBoundingClientRect().height),30);
 assert.equal(await run(()=>document.querySelector('.bases-table thead tr').getBoundingClientRect().height),30);
 // Repeated clicks without moving and a double click do not edit metadata or YAML.
 const p=await point('.bases-table td[data-property="priority"]');await move(p);
 for(const count of [1,1,1,2])for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:count});
 await press('x');assert.deepEqual(await values(),sample);
 await shot('grove');
 await run(()=>{window.baseComparison={columns:[...document.querySelectorAll('.bases-table th span')].map(n=>n.textContent),rows:[...document.querySelectorAll('.bases-table tbody tr[data-path]')].map(tr=>({path:tr.dataset.path,values:[...tr.cells].map(c=>c.dataset.value)}))};});
 await writeFile(new URL('grove.json',shots),JSON.stringify(await run(()=>window.baseComparison),null,2));
 // Normal and modifier clicks use the standard note-opening behavior.
 const link='.bases-table td[data-property="file.name"] a';
 const linkPoint=await point(link);await move(linkPoint);
 for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...linkPoint,button:'left',clickCount:1,modifiers:2});
 await wait(()=>run(()=>ws.active.path==='BaseTest/Task D.md'),'Ctrl-click opens note');
 check(await run(()=>ws.activeGroup.tabs.some(t=>t.type==='base' && t.viewFile==='Tasks.base')),'Ctrl-click preserves base tab');
 await open('Tasks.base');await click(link);await wait(()=>run(()=>ws.active.path==='BaseTest/Task D.md'),'normal link opens note');
 // Quick switcher and wikilinks find .base attachments without editor loading.
 await chord('o');await fill('.prompt-input','Tasks.base');await press('Enter');
 await wait(()=>run(()=>ws.active.type==='base'),'switcher opens base');
 await run(async()=>{const {api}=await import('/src/api.ts');await api.createNote('Base link.md','[[Tasks.base]]\n');await ws.vault.refreshFiles();await ws.open('Base link.md');});
 await click('.cm-content .cm-line');await press('ArrowDown');await press('End');
 await wait(()=>run(()=>!!document.querySelector('.cm-content .cm-wikilink')),'rendered wiki link');
 await click('.cm-content .cm-wikilink');
 await wait(()=>run(()=>ws.active.type==='base'),'wiki link opens base');
 // A saved layout restores its view type and attachment path.
 check(await run(async()=>{const {saveTab,loadTab}=await import('/src/savedLayout.ts');const saved=saveTab(ws.active);const tab=loadTab(saved,()=>({...ws.active}),p=>ws.vault.notes.some(n=>n.path===p));return tab?.type==='base'&&tab?.viewFile==='Tasks.base';}),'base tab restores');
 const expected={ 'Multiple.base':['Task C','Task F','Task A','Task B'], 'Not.base':['Task A','Task C','Task E','Task F'], 'Unsupported.base':['Task A','Task B','Task C','Task D','Task E','Task F'], 'Functions.base':['Task A','Task C','Task D','Task E','Task F'], 'Unsupported filter.base':[] };
 for(const [path,names]of Object.entries(expected)){
  await open(path);assert.deepEqual(await rows(),names.map(n=>`BaseTest/${n}.md`));
  assert.deepEqual(await rows(),observed[path].rows.map(r=>r.path));
  assert.deepEqual(await run(()=>[...document.querySelectorAll('.bases-table th span')].map(n=>n.textContent)),observed[path].columns);
  if(path==='Functions.base')assert.ok((await values()).every(r=>r[1]==='true'&&r[2].includes('inline')&&r[2].includes('work/project')));
  if(path==='Unsupported.base'){assert.ok(await run(()=>document.querySelector('.bases-notice').textContent.includes('unknownFunction')));assert.ok((await values()).every(r=>r[1]===''));}
 }
 await open('Empty.base');
 assert.equal(await run(()=>document.querySelector('.bases-count').textContent),`${await run(()=>ws.vault.includedNotes().length)} results`);
 assert.deepEqual(await run(()=>[...document.querySelectorAll('.bases-table th span')].map(n=>n.textContent)),['file name']);
 await open('Invalid.base');assert.match(await run(()=>document.querySelector('.bases-view').textContent),/Unable to open base/);
 // Metadata saves/add/rename/delete update the existing table, not the base file.
 await open('Tasks.base');
 await run(async()=>{const {api}=await import('/src/api.ts');window.baseReads=[];const read=api.properties;api.properties=paths=>{window.baseReads.push(paths);return read(paths);};});
 await run(async()=>{const {api}=await import('/src/api.ts');await api.writeNote('BaseTest/Task A.md','---\nstatus: done\npriority: 3\n---\n# Task A\n');ws.vault.written('BaseTest/Task A.md');});
 await wait(async()=>!(await rows()).includes('BaseTest/Task A.md'),'changed filter updates');
 assert.deepEqual(await run(()=>window.baseReads),[['BaseTest/Task A.md']],'a changed note only rereads its own indexed properties');
 await run(async()=>{const {api}=await import('/src/api.ts');await api.createNote('BaseTest/Added.md','---\nstatus: open\npriority: 9\n---\nAdded\n');await ws.vault.refreshFiles();});
 await wait(async()=>(await rows())[0]==='BaseTest/Added.md','new note updates');
 await run(async()=>{const {api}=await import('/src/api.ts');await api.renamePath('BaseTest/Added.md','BaseTest/Renamed.md');await ws.vault.refreshFiles();});
 await wait(async()=>(await rows())[0]==='BaseTest/Renamed.md','renamed note updates');
 await run(async()=>{const {api}=await import('/src/api.ts');await api.deletePath('BaseTest/Renamed.md',false);await ws.vault.refreshFiles();});
 await wait(async()=>!(await rows()).includes('BaseTest/Renamed.md'),'deleted note updates');
 // Warm-index opening and native scrollbar scrolling with 1,000 rows.
 await run(async()=>{
  const {api}=await import('/src/api.ts');
  for(let i=0;i<1000;i++)await api.createNote(`Perf/Note ${i}.md`,`---\nrank: ${i}\n---\n# Note ${i}\n`);
  await api.createNote('Perf.base','filters: \'file.inFolder("Perf")\'\nviews:\n  - name: Performance\n    type: table\n    order:\n      - file.name\n      - rank\n');
  await ws.vault.refreshFiles();const {propertyIndex}=await import('/src/shell/propertyIndex.ts');await propertyIndex(ws).notes();
 });
 const opening=await run(async()=>{const begin=performance.now();await ws.open('Perf.base');while(document.querySelector('.bases-count')?.textContent!=='1000 results')await new Promise(requestAnimationFrame);return performance.now()-begin;});
 check(opening<100,`warm 1000-note open ${opening.toFixed(1)}ms <100ms`);
 check(await run(()=>document.querySelectorAll('.bases-table tbody tr[data-path]').length<70),'large table renders only visible rows');
 // Let the mock backend's delayed link refresh settle before timing frames.
 await sleep(1200);
 const scrollPoint=await run(()=>{const r=document.querySelector('.bases-scroll').getBoundingClientRect();return{x:r.right-6,y:r.top+400};});await move(scrollPoint);
 await run(()=>{window.baseFrames=[];let last=performance.now();window.baseFrame=requestAnimationFrame(function tick(now){window.baseFrames.push(now-last);last=now;window.baseFrame=requestAnimationFrame(tick);});});
 for(let i=0;i<14;i++){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...scrollPoint,button:'left',clickCount:1});await sleep(25);}
 const frames=await run(()=>{cancelAnimationFrame(window.baseFrame);return window.baseFrames.slice(2);});

 check(Math.max(...frames)<20,`1000-row scroll max frame ${Math.max(...frames).toFixed(1)}ms <20ms`);
 assert.ok((await rows()).some(p=>Number(/Note (\d+)/.exec(p)?.[1])>100));
 const wheelPoint=await point('.bases-scroll');await move(wheelPoint);
 const beforeWheel=await run(()=>document.querySelector('.bases-scroll').scrollTop);
 await send('Input.dispatchMouseEvent',{type:'mouseWheel',...wheelPoint,deltaX:0,deltaY:600});
 await wait(()=>run(top=>document.querySelector('.bases-scroll').scrollTop>top,beforeWheel),'native wheel scrolls');
 assert.equal(await run(async()=>{const {api}=await import('/src/api.ts');return api.readNote('Perf.base');}), 'filters: \'file.inFolder("Perf")\'\nviews:\n  - name: Performance\n    type: table\n    order:\n      - file.name\n      - rank\n');
 for(const [path,source]of Object.entries(bases))assert.equal(await run(async p=>{const {api}=await import('/src/api.ts');return api.readNote(p);},path),source,`${path} byte-identical`);
 console.log('PASS Bases read-only fixtures, file links, subscriptions and bytes');
 await writeFile(new URL('performance.json',shots),JSON.stringify({openingMs:opening,maxScrollFrameMs:Math.max(...frames)},null,2));
 // A vault without saved tags must still match its first unsaved inline tag.
 await run(async()=>{
  const {api}=await import('/src/api.ts');for(const n of ws.vault.notes)await api.deletePath(n.path,false);
  await api.createNote('Fresh.md','# Fresh\n');await api.createNote('Fresh.base','filters: \'file.hasTag("newtag")\'\n');
  await ws.vault.refreshFiles();await ws.vault.refreshLinks();await ws.open('Fresh.md');ws.setMode('source');await ws.open('Fresh.base',{where:'right'});
 });
 await wait(()=>run(()=>document.querySelector('.bases-count')?.textContent==='0 results'),'empty saved tag index');
 await click('.cm-content .cm-line');await press('End');await send('Input.insertText',{text:' #newtag'});
 assert.equal(await run(()=>document.querySelector('.bases-count')?.textContent),'0 results','a keystroke does not rebuild the base');
 assert.equal(await run(async()=>{const {api}=await import('/src/api.ts');return api.readNote('Fresh.md');}),'# Fresh\n','a keystroke has not saved yet');
 await sleep(50);
 assert.equal(await run(()=>document.querySelector('.bases-count')?.textContent),'0 results','typing stays quiet past the old 20ms debounce');
 await wait(()=>run(()=>document.querySelector('.bases-count')?.textContent==='1 results'),'unsaved first tag updates base');
 console.log('PASS first unsaved tag matches an empty saved tag index');
},{height:800,screenshots:shots.pathname});

await import('./test-bases-b0.mjs');
