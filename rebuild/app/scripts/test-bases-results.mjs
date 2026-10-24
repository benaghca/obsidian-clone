import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {withBrowser,sleep} from './browser.mjs';
import {notes,bases} from '../../round31-shots/fixtures.mjs';
const shots=new URL('../../round32b-shots/',import.meta.url);
const original=bases['By due.base'].replace('      - due\n      - priority\n      - status','      - status\n      - due\n      - priority');
await withBrowser(async({run,send,click,point,move,press,fill,shot,check})=>{
 const wait=async(test,label)=>{for(let i=0;i<150;i++){if(await test())return;await sleep(20);}assert.fail(label);};
 const source=()=>run(async()=>{const{api}=await import('/src/api.ts');return api.readNote('Multi.base');});
 const read=path=>run(async path=>{const{api}=await import('/src/api.ts');return api.readNote(path);},path);
 const rows=()=>run(()=>[...document.querySelectorAll('.bases-table tbody tr[data-path]')].map(tr=>tr.dataset.path));
 const count=n=>wait(()=>run(n=>document.querySelector('.bases-count')?.textContent===`${n} results`,n),`${n} results`);
 const choose=async title=>click(await run(title=>{const e=[...document.querySelectorAll('.menu-item')].find(e=>e.querySelector('.menu-item-title')?.textContent===title);if(!e)throw Error('Missing '+title);const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},title));
 const toggle=async(selector,menu)=>{const p=await point(selector);await move(p);for(const visible of [true,false,true]){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});assert.equal(await run(s=>!!document.querySelector(s),menu),visible);}await press('Escape');};
 await run(async(notes,source)=>{const{api}=await import('/src/api.ts');for(const[p,s]of Object.entries({...notes,'Multi.base':source}))await api.createNote(p,s);await ws.vault.refreshFiles();await ws.open('Multi.base');window.baseTab=ws.active;},notes,original);await count(3);
 // Real clipboard API, using only the isolated headless browser's permission.
 await send('Browser.grantPermissions',{permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
 await click('.bases-count');assert.equal(await run(()=>document.querySelector('.bases-results-menu').getBoundingClientRect().width),220);
 assert.equal(await run(()=>document.querySelector('.bases-results-limit input').placeholder),'e.g. 10');await shot('grove-results');
 await choose('Copy to clipboard');assert.equal(await run(()=>!!document.querySelector('.menu')),false);
 const native='Task\tstatus\tDue date\tpriority\nTask F\topen\t2000-01-01\t3\nTask A\topen\t2000-01-01\t3\nTask D\topen\t2099-01-01\t5';
 assert.equal(await run(()=>navigator.clipboard.readText()),native);assert.equal(await run(()=>document.querySelector('.bases-copy-notice')?.textContent),'Copied to your clipboard');assert.equal(await run(()=>document.querySelector('.bases-copy-notice').getAnimations().length),0);
 await click('.bases-count');await fill('[aria-label="Limit number of results"]','2');assert.equal(await source(),original);await press('Enter');await count(2);assert.equal(await run(()=>!!document.querySelector('.menu')),false);assert.equal(await source(),original.replace('limit: 3','limit: 2'));
 await click('.bases-count');assert.ok(await run(()=>document.querySelector('.menu').textContent.includes('Show all (6)')));await choose('Show all (6)');await count(6);
 const unlimited=original.replace('    limit: 3\n','');assert.equal(await source(),unlimited);
 await click('.bases-count');await fill('[aria-label="Limit number of results"]','0');await press('Enter');await count(0);await press('Escape');
 await click('.bases-count');await fill('[aria-label="Limit number of results"]','');await press('Enter');await count(6);await press('Escape');assert.equal(await source(),unlimited);
 await click('.bases-count');await fill('[aria-label="Limit number of results"]','1');await press('Escape');assert.equal(await source(),unlimited);await count(6);
 await click('.bases-count');await fill('[aria-label="Limit number of results"]','-1');await press('Enter');assert.ok(await run(()=>!!document.querySelector('.bases-results-menu')));assert.equal(await source(),unlimited);await press('Escape');
 // Exactly three matching notes, plus a second view whose limit must be untouched.
 const three='filters: \'priority >= 3 && status == "open"\'\nviews:\n  - type: table\n    name: Three\n    order: [file.name, status]\n  - type: table\n    name: Other\n    limit: 7\n# end\n';
 await run(async text=>{const{api}=await import('/src/api.ts');await api.createNote('Three.base',text);await ws.vault.refreshFiles();await ws.open('Three.base',{where:'tab'});},three);await count(3);
 await click('.bases-count');await fill('[aria-label="Limit number of results"]','2');await press('Enter');await count(2);await press('Escape');
 assert.equal(await read('Three.base'),three.replace('  - type: table\n    name: Other','    limit: 2\n  - type: table\n    name: Other'));
 await click('.bases-count');assert.ok(await run(()=>document.querySelector('.menu').textContent.includes('Show all (3)')));await fill('[aria-label="Limit number of results"]','');await press('Enter');await count(3);await press('Escape');assert.equal(await read('Three.base'),three);
 await run(()=>ws.activate(baseTab));await count(6);
 const before=await source(),local='[data-scope="view"]';
 await click('.bases-toolbar [aria-label="Filter"]');
 await run(()=>document.addEventListener('click',()=>{window.pt={visible:0,max:0};let last=performance.now(),frame=0;requestAnimationFrame(function tick(now){frame++;pt.max=Math.max(pt.max,now-last);last=now;if(!pt.visible&&document.querySelector('.bases-filter-picker'))pt.visible=frame;if(frame<19)requestAnimationFrame(tick);});},{once:true,capture:true}));
 await click(local+' [aria-label="Add filter"]');await sleep(340);const pt=await run(()=>pt);check(pt.visible===1&&pt.max<20,`Filter picker: frame 1, max ${pt.max.toFixed(1)}ms`);
 const placement=await run(()=>{const r=document.querySelector('[data-draft]').getBoundingClientRect(),p=document.querySelector('.bases-filter-picker').getBoundingClientRect();return{parent:!!document.querySelector('.bases-filter-menu'),left:p.left,top:p.top,anchorLeft:r.left,anchorBottom:r.bottom,width:p.width,height:p.height,checked:document.querySelector('.bases-filter-picker .is-checked')?.textContent};});
 assert.equal(placement.parent,true);assert.equal(placement.left,Math.round(placement.anchorLeft));assert.equal(placement.top,Math.round(placement.anchorBottom+4));assert.equal(placement.width,247);assert.ok(placement.height<=300);assert.equal(placement.checked,'file');assert.equal(await source(),before);await shot('grove-picker');
 assert.equal(await run(()=>document.querySelector('.bases-filter-picker .menu-item-hotkey')?.textContent),'file.name');await fill('[aria-label="Filter property search"]','priority');assert.ok(await run(()=>document.querySelector('.bases-filter-menu')&&document.querySelector('.bases-filter-picker').textContent.includes('priority')));await press('Escape');
 assert.ok(await run(()=>document.querySelector('.bases-filter-menu')&&!document.querySelector('.bases-filter-picker')));await move(await point(local+' .bases-filter-heading'));await sleep(200);assert.equal(await run(()=>!!document.querySelector('.bases-filter-picker')),false);assert.equal(await source(),before);await press('Escape');
 // A freshly opened parent has a pending hover timer when an existing row is pressed.
 await click('.bases-toolbar [aria-label="Filter"]');await click(local+' .bases-filter-row > button');await sleep(250);assert.ok(await run(()=>!!document.querySelector('.bases-filter-picker')),'existing row picker stays open past hover delay');
 const propertyPoint=await point(local+' .bases-filter-row > button');await move(propertyPoint);for(let i=0;i<2;i++){for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...propertyPoint,button:'left',clickCount:1});await sleep(180);assert.ok(await run(()=>!!document.querySelector('.bases-filter-picker')));}await press('Escape');await press('Escape');
 // New row opens a new tab; the existing note/title/property paths do all writes.
 await click('.bases-toolbar [aria-label="New"]');await wait(()=>run(()=>ws.active.path==='Untitled.md'&&getSelection()?.toString()==='Untitled'&&document.activeElement?.matches('.inline-title')),'New selected title');
 const seeded='---\ntags:\n  - work\nstatus:\ndue:\npriority:\n---\n';assert.equal(await read('Untitled.md'),seeded);await shot('grove-new');
 await run(()=>ws.activate(baseTab));await wait(async()=>(await rows()).includes('Untitled.md'),'new row indexed immediately');await count(7);
 await click('.bases-toolbar [aria-label="New"]');await wait(()=>run(()=>ws.active.path==='Untitled 1.md'&&getSelection()?.toString()==='Untitled 1'),'unique new name');assert.equal(await read('Untitled 1.md'),seeded);
 await send('Input.insertText',{text:'Created task'});await press('Enter');await wait(()=>run(()=>ws.active.path==='Created task.md'),'real key title rename');assert.equal(await read('Created task.md'),seeded);
 const folder='filters:\n  and:\n    - file.inFolder("BaseTest")\n    - status == "open"\nviews:\n  - type: table\n    name: Folder\n    order: [file.name, status, priority]\n';
 await run(async source=>{const{api}=await import('/src/api.ts');await api.createNote('Folder.base',source);await ws.vault.refreshFiles();await ws.open('Folder.base',{where:'tab'});window.folderTab=ws.active;},folder);await count(5);
 await click('.bases-toolbar [aria-label="New"]');await wait(()=>run(()=>ws.active.path==='BaseTest/Untitled.md'&&getSelection()?.toString()==='Untitled'),'filtered folder');assert.equal(await read('BaseTest/Untitled.md'),'---\nstatus: open\npriority:\n---\n');await run(()=>ws.activate(folderTab));await count(6);assert.ok((await rows()).includes('BaseTest/Untitled.md'));
 // Keep the fixture small and return-check the exact written limit and seeded note.
 await run(()=>ws.activate(baseTab));await count(8);await click('.bases-count');await fill('[aria-label="Limit number of results"]','2');await press('Enter');await count(2);await press('Escape');
 await writeFile(new URL('Grove-written.base',shots),await source());await writeFile(new URL('notes.json',shots),JSON.stringify({...notes,'Untitled.md':seeded,'Created task.md':seeded},null,2));await writeFile(new URL('written.json',shots),JSON.stringify({headers:await run(()=>[...document.querySelectorAll('th .bases-header span')].map(e=>e.textContent)),rows:await rows(),copied:native},null,2));await shot('grove-written');
 const header='th[data-property="due"]',resizer=header+' .bases-resizer';
 const normal=await run(s=>getComputedStyle(document.querySelector(s)).backgroundColor,header);await move(await point(resizer));
 const hover=await run((s,h)=>({width:document.querySelector(s).getBoundingClientRect().width,fill:getComputedStyle(document.querySelector(s)).backgroundColor,tint:getComputedStyle(document.querySelector(h)).backgroundColor,accent:getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim()}),resizer,header);
 assert.equal(hover.width,6);assert.notEqual(hover.fill,'rgba(0, 0, 0, 0)');assert.notEqual(hover.tint,normal);await shot('grove-resizer');
 await click('.bases-toolbar [aria-label="Sort"]');
 const sort=await run(()=>{const rows=[...document.querySelectorAll('.bases-sort-row')],buttons=[...rows[0].querySelectorAll('button')];return{pitch:rows[1].getBoundingClientRect().top-rows[0].getBoundingClientRect().top,buttons:buttons.slice(0,2).map(e=>({height:e.getBoundingClientRect().height,border:getComputedStyle(e).borderTopWidth,chevrons:!!e.querySelector('.lucide-chevrons-up-down')})),trash:buttons[2].textContent,aria:buttons[2].getAttribute('aria-label'),separator:!!document.querySelector('.bases-sort-menu .menu-separator')};});
 assert.deepEqual(sort,{pitch:34,buttons:[{height:28,border:'1px',chevrons:true},{height:28,border:'1px',chevrons:true}],trash:'',aria:'Remove sort',separator:true});await shot('grove-sort');
 await click('.bases-sort-row button:nth-of-type(2)');assert.equal(await run(()=>document.querySelector('.menu .is-checked')?.textContent),'Old to new');await choose('New to old');await wait(async()=>(await source()).includes('property: due\n        direction: DESC'),'date direction menu');
 await click('.bases-sort-row button:nth-of-type(2)');await choose('Old to new');await wait(async()=>(await source()).includes('property: due\n        direction: ASC'),'restore direction');await press('Escape');
 for(const [selector,menu]of [['.bases-count','.bases-results-menu'],['.bases-toolbar [aria-label="Filter"]','.bases-filter-menu']]){
  await run(()=>document.addEventListener('click',()=>{window.bt={visible:0,max:0};let last=performance.now(),frame=0;requestAnimationFrame(function tick(now){frame++;bt.max=Math.max(bt.max,now-last);last=now;if(!bt.visible&&document.querySelector('.menu'))bt.visible=frame;if(frame<19)requestAnimationFrame(tick);});},{once:true,capture:true}));
  await click(selector);await sleep(340);const t=await run(()=>bt);check(t.visible===1&&t.max<20,`${selector}: frame 1, max ${t.max.toFixed(1)}ms`);assert.equal(await run(()=>[...document.querySelectorAll('.menu')].some(e=>e.getAnimations().length)),false);await press('Escape');await toggle(selector,menu);
 }
 // Notes with frontmatter and H1-H3, in all modes: trusted hover and stationary clicks.
 await run(async()=>{const{api}=await import('/src/api.ts');await api.createNote('Results geometry.md','---\nstatus: open\n---\n# HeadingOne\nOne.\n## HeadingTwo\nTwo.\n### HeadingThree\nThree.');await ws.vault.refreshFiles();});
 for(const mode of ['live','source','reading']){
  await run(async mode=>{await ws.open('Results geometry.md');ws.setMode(mode);ws.view.dispatch({selection:{anchor:ws.view.state.doc.length}});},mode);await sleep(200);
  for(const name of ['HeadingOne','HeadingTwo','HeadingThree']){
   const p=await run(name=>{const r=ws.view.coordsAtPos(ws.view.state.doc.toString().indexOf(name)+5);return{x:r.left,y:(r.top+r.bottom)/2};},name);await click(p);
   for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});
   assert.ok(await run(name=>ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text.endsWith(name),name));
  }
  assert.ok(await run(()=>[...ws.view.contentDOM.children].every(e=>{const s=getComputedStyle(e),pos=ws.view.posAtDOM(e,0);return parseFloat(s.marginTop)===0&&parseFloat(s.marginBottom)===0&&(!e.classList.contains('cm-line')||Math.abs(ws.view.documentTop+ws.view.lineBlockAt(pos).top-e.getBoundingClientRect().top)<=1);})),`${mode} geometry`);
 }
 check(true,'Results limits/TSV/notice, New row/title/folder, anchored Filter picker and stationary editor clicks');
},{height:800,screenshots:shots.pathname});
