// K5: native pointer/keys, CAS races, loaded editors, history, embeds and P4/P5/P7.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
if (!process.argv.includes("--perf-only")) await withBrowser(async ({run,click,point,move,send,press,check})=>{
 const wait=async(test,label,n=400)=>{for(let i=0;i<n;i++){if(await test())return;await sleep(25);}assert.fail(label);};
 const read=path=>run(async path=>{const {api}=await import('/src/api.ts');return api.readNote(path);},path);
 const source=`filters: 'file.inFolder("KM")'\nviews:\n  - type: kanban\n    name: Board\n    order: [file.name, status]\n    groupBy:\n      property: status\n      direction: ASC\n      order: [todo, doing, review, done, null]\n    sort:\n      - property: file.name\n        direction: ASC\n`;
 const col=id=>`.bases-kanban-col[data-group-id='s:"${id}"']`;
 const card=path=>`.bases-kanban-card[data-path='${path}']`;
 const at=async(path,id)=>run((path,id)=>document.querySelector(`.bases-kanban-col[data-group-id='s:"${id}"'] .bases-kanban-card[data-path='${path}']`)!==null,path,id);
 await run(async source=>{
  const {api}=await import('/src/api.ts');
  for(const [name,status]of [['A','todo'],['B','doing'],['C','review'],['D','todo']])await api.createNote(`KM/${name}.md`,`---\nstatus: '${status}'\nkeep: same\n---\nbody ${name}\n`);
  await api.createNote('KM/Unsafe.md','---\nstatus: todo # comment\n---\nbody\n');
  await api.createNote('KM/Duplicate.md','---\nstatus: todo\nstatus: doing\n---\nbody\n');
  await api.createNote('KM.base',source);await ws.vault.refreshFiles();await ws.open('KM.base');
  window.k5api=api;window.k5original=api.setProperty;window.k5calls=[];
  api.setProperty=async(...args)=>{k5calls.push({path:args[0],edit:args[1],dry:!!args[2],at:performance.now()});if(args[2]&&window.k5dryDelay)await new Promise(r=>setTimeout(r,k5dryDelay));if(!args[2]&&window.k5delay)await new Promise(r=>setTimeout(r,k5delay));if(!args[2]&&window.k5conflict){window.k5conflict=false;await api.writeNote(args[0],'---\nstatus: external\nkeep: same\n---\nexternal body\n');}if(!args[2]&&window.k5refuse)return {status:'refused',reason:'Simulated write refusal'};return k5original(...args);};
 },source);
 await wait(()=>at('KM/A.md','todo'),'board');
 const focus=async path=>{await run(path=>document.querySelector(`.bases-kanban-card[data-path='${path}']`).focus(),path);};
 const keyboard=async(path,steps)=>{await focus(path);await press(' ');for(let i=0;i<Math.abs(steps);i++)await press(steps>0?'ArrowRight':'ArrowLeft');await press(' ');};
 await keyboard('KM/A.md',1);await wait(async()=>/status: 'doing'/.test(await read('KM/A.md')),'keyboard move');
 assert.ok((await read('KM/A.md')).endsWith('body A\n'));check(true,'Space/arrows/Space moves with quote and body bytes preserved');
 await wait(()=>at('KM/A.md','doing'),'move reconciled');await run(()=>{window.k5dryDelay=140;});await focus('KM/A.md');await press('z',2);assert.ok(await at('KM/A.md','todo'),'Undo previews before slow validation');assert.match(await read('KM/A.md'),/status: 'doing'/);
 await wait(async()=>/status: 'todo'/.test(await read('KM/A.md')),'undo');await run(()=>{window.k5dryDelay=0;});await wait(()=>at('KM/A.md','todo'),'undo painted');
 await focus('KM/A.md');await press('z',10);await wait(async()=>/status: 'doing'/.test(await read('KM/A.md')),'redo');
 await wait(()=>at('KM/A.md','doing'),'redo painted');check(true,'Ctrl+Z and Ctrl+Shift+Z replay exact raw CAS lines');
 // Escape cancels without a writer; invalid YAML is disabled before pick-up.
 const before=(await run(()=>k5calls.length));await focus('KM/B.md');await press(' ');await press('ArrowRight');await press('Escape');assert.equal(await run(()=>k5calls.length),before);
 assert.equal(await run(()=>document.querySelector('.bases-kanban-card[data-path="KM/Unsafe.md"]').classList.contains('is-movable')),false);
 await wait(()=>run(()=>!document.querySelector('.bases-kanban-card[data-path="KM/Duplicate.md"]').classList.contains('is-movable')),'duplicate disabled');
 check(true,'Escape writes nothing; commented and duplicate frontmatter have no grab cursor');
 // Leaving keyboard pickup must release queued refreshes, without a property write.
 for(const leave of ['Tab','focus','pointer','blur']) {
  await focus('KM/B.md');await press(' ');await press('ArrowRight');
  const writesBefore=await run(()=>k5calls.filter(c=>!c.dry).length);
  if(leave==='Tab')await press('Tab');
  else if(leave==='focus')await run(()=>document.querySelector('.bases-kanban-add').focus());
  else if(leave==='pointer')await click('.bases-kanban-label');
  else await run(()=>window.dispatchEvent(new Event('blur')));
  await wait(()=>run(()=>document.querySelector('.bases-move-notice').textContent.includes('Move cancelled')),`${leave} cancels pickup`);
  await run(async name=>{await k5api.createNote(`KM/Focus-${name}.md`,'---\nstatus: todo\n---\nbody');await ws.vault.refreshFiles();},leave);
  await wait(()=>at(`KM/Focus-${leave}.md`,'todo'),`refresh after ${leave}`);
  assert.equal(await run(()=>k5calls.filter(c=>!c.dry).length),writesBefore);
 }
 check(true,'Tab, focus departure, pointer and window blur cancel keyboard pickup and release refresh');
 // Optimistic pointer move happens while disk is deliberately delayed.
 await run(()=>{window.k5delay=180;});
 const from=await point(card('KM/D.md')), to=await point(`${col('review')} .bases-kanban-body`);
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',...from});await send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',clickCount:1});
 for(let i=1;i<=12;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12,buttons:1});await sleep(8);}
 assert.equal(await run(()=>!!document.querySelector('.bases-move-ghost')),true);
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',clickCount:1});
 assert.ok(await at('KM/D.md','review'),'optimistic card before write');assert.match(await read('KM/D.md'),/status: 'todo'/);
 await wait(async()=>/status: 'review'/.test(await read('KM/D.md')),'pointer saved');await run(()=>{window.k5delay=0;});
 check(true,'Pointer drop paints immediately before delayed disk write, with ghost, target and landing line');
 // A stale property conflicts and the new external body wins. Undo must not overwrite it.
 await wait(()=>at('KM/D.md','review'),'pointer reconciled');await run(()=>{window.k5conflict=true;});
 await keyboard('KM/D.md',-1);await wait(async()=>/external body/.test(await read('KM/D.md')),'external conflict');
 await wait(()=>run(()=>document.querySelector('.bases-move-notice').textContent.includes('changed since')),'conflict notice');
 assert.match(await read('KM/D.md'),/status: external/);check(true,'A conflicting drop retains the fresh external property and body');
 // Refused move rolls back.
 await run(()=>{window.k5refuse=true;});await keyboard('KM/B.md',1);
 await wait(()=>run(()=>document.querySelector('.bases-move-notice').textContent.includes('Simulated write refusal')),'refusal');
 assert.match(await read('KM/B.md'),/status: 'doing'/);await run(()=>{window.k5refuse=false;});
 check(true,'Refused write rolls the optimistic card back and reports the reason');
 // A loaded unsaved note uses exactly one editor transaction; no setProperty transport.
 await run(async()=>{await ws.open('KM/A.md',{where:'right'});const doc=ws.editors.doc('KM/A.md');ws.editors.change('KM/A.md',{changes:{from:doc.length,insert:'unsaved tail'},userEvent:'input'});});
 await wait(()=>run(()=>!!document.querySelector('.bases-kanban-card[data-path="KM/A.md"]')),'split board remains');
 await sleep(400);await run(()=>{window.k5calls=[];});await keyboard('KM/A.md',1);
 await wait(()=>run(()=>ws.editors.doc('KM/A.md').toString().includes("status: 'review'")),'loaded note moved');
 assert.equal(await run(()=>k5calls.filter(c=>!c.dry).length),0);assert.ok(await run(()=>ws.editors.doc('KM/A.md').toString().endsWith('unsaved tail')));
 check(true,'Loaded note uses editor change, preserving unsaved text without a Rust writer');
 // The note's own Undo makes the board's next Undo an idempotent no-op.
 await run(()=>{const group=ws.layout.groups().find(g=>g.active.path==='KM/A.md');ws.editors.viewOf(group).focus();});await press('z',2);
 await wait(()=>run(()=>ws.editors.doc('KM/A.md').toString().includes("status: 'doing'")),'editor Undo');
 await run(()=>document.querySelector('.bases-kanban').focus());await press('z',2);
 await wait(()=>run(()=>document.querySelector('.bases-move-notice').textContent.includes('Undid')),'board Undo after note Undo');
 assert.ok(await run(()=>ws.editors.doc('KM/A.md').toString().endsWith('unsaved tail')));check(true,'Editor Undo followed by board Undo is unchanged and retains unsaved body text');
 // Header drag snapshots a Manual order, and one undo restores automatic mode.
 await run(async source=>{for(const g of ws.layout.groups().slice(1))for(const t of [...g.tabs])ws.closeTab(t); await ws.open('KM.base');await k5api.writeNote('KM.base',source.replace('      order: [todo, doing, review, done, null]\n',''));ws.vault.written('KM.base');},source);
 await wait(()=>run(()=>document.querySelector('.bases-kanban-col')?.dataset.groupId==='s:"doing"'),'automatic order'); await run(()=>{document.querySelector('.bases-kanban').scrollLeft=0;}); await sleep(60);
 const h1=await point(`${col('doing')} .bases-kanban-label`),h2=await point(`${col('review')} .bases-kanban-label`);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...h1,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',...h2,buttons:1});await sleep(35);await send('Input.dispatchMouseEvent',{type:'mouseReleased',...h2,button:'left',clickCount:1});
 await wait(async()=>/      order:\n/.test(await read('KM.base')),'header saved');
 await wait(()=>run(()=>document.querySelector('.bases-move-notice').textContent.includes('Changed column order')),'header completed'); await click('.bases-move-notice button');await wait(async()=>!(/      order:\n/.test(await read('KM.base'))),'header undo to automatic');
 check(true,'Column header drag writes Manual; one notice Undo restores automatic order');
 // Reset the explicit target columns after the preceding Undo restored automatic order.
 await run(async source=>{await k5api.writeNote('KM.base',source);ws.vault.written('KM.base');},source);
 await wait(()=>run(()=>document.querySelector('.bases-kanban-col')?.dataset.groupId==='s:"todo"'),'manual target columns restored');
 // No value clears, never removes; missing frontmatter is created safely.
 await run(async()=>{await k5api.createNote('KM/Missing.md','body without frontmatter\n');await ws.vault.refreshFiles();});
 await wait(()=>run(()=>document.querySelector('.bases-kanban-card[data-path="KM/Missing.md"]')?.classList.contains('is-movable')),'missing note editable');
 await keyboard('KM/Missing.md',-1);await wait(async()=>/status: done/.test(await read('KM/Missing.md')),'missing key inserted');
 await wait(()=>at('KM/Missing.md','done'),'missing reconciled');await focus('KM/Missing.md');await press('ArrowRight',1);
 await wait(async()=>/status:\n/.test(await read('KM/Missing.md')),'No value clears');assert.ok((await read('KM/Missing.md')).endsWith('body without frontmatter\n'));
 check(true,'Missing frontmatter can move; Alt+Right to No value leaves an empty property');
 // CAS retains a key's case and quote style; the model reads that same property.
 await run(async()=>{await k5api.createNote('KM/Case.md','---\nStatus: "todo"\n---\ncase body');await ws.vault.refreshFiles();document.querySelector('.bases-kanban').scrollLeft=0;});await wait(()=>at('KM/Case.md','todo'),'case variant grouped');await keyboard('KM/Case.md',1);
 await wait(async()=>(await read('KM/Case.md')).includes('Status: "doing"'),'case variant moved');await wait(()=>at('KM/Case.md','doing'),'case variant rendered');check(true,'A preserved mixed-case key and double quotes render in the moved column');
 // Rapid moves of one note are queued against its optimistic raw lines.
 await run(()=>{window.k5calls=[];window.k5delay=120;});await keyboard('KM/B.md',1);await keyboard('KM/B.md',1);
 await wait(async()=>/status: 'done'/.test(await read('KM/B.md')),'queued moves');
 const writes=await run(()=>k5calls.filter(c=>!c.dry));assert.equal(writes.length,2);assert.ok(writes[1].at-writes[0].at>=100);
 await run(()=>{window.k5delay=0;});check(true,'Rapid moves of the same note are serialized with the preceding optimistic expectation');
 // Stale Undo is refused and leaves the external document untouched.
 await run(async()=>{await k5api.writeNote('KM/B.md','---\nstatus: external\n---\nexternal undo body');ws.vault.written('KM/B.md');});await sleep(100);
 await run(()=>document.querySelector('.bases-kanban').focus());await press('z',2);
 await wait(()=>run(()=>document.querySelector('.bases-move-notice').textContent.includes("Can't undo")),'undo conflict');assert.ok((await read('KM/B.md')).endsWith('external undo body'));
 check(true,'Undo refuses a stale target and keeps external bytes');
 // A filtered-out move can be undone after reconciliation removed the row entirely.
 await run(async source=>{await k5api.createNote('KM/Filter.md','---\nstatus: doing\n---\nfilter body');await k5api.writeNote('KM.base',source.replace('    name: Board\n','    name: Board\n    filters: status != "done"\n'));await ws.vault.refreshFiles();ws.vault.written('KM.base');},source);
 await wait(()=>at('KM/Filter.md','doing'),'filtered board');await keyboard('KM/Filter.md',2);
 await wait(async()=>/status: done/.test(await read('KM/Filter.md')),'filter move saved');await sleep(120);
 assert.equal(await run(()=>!!document.querySelector('.bases-kanban-card[data-path="KM/Filter.md"]')),false);
 assert.ok(await run(()=>document.querySelector('.bases-move-notice').textContent.includes('no longer matches')));await click('.bases-move-notice button');
 await wait(()=>at('KM/Filter.md','doing'),'filtered card restored');assert.ok((await read('KM/Filter.md')).endsWith('filter body'));check(true,'Filtered-out move reports its disappearance and Undo restores it after a rebuild');
 // Read-only groups still render, but expose a lock and no movable cards.
 await run(async source=>{await k5api.writeNote('KM.base',source.replace('property: status','property: file.folder'));ws.vault.written('KM.base');},source);
 await wait(()=>run(()=>document.querySelector('.bases-move-lock')?.textContent.includes('file fact')),'read-only lock');
 assert.equal(await run(()=>document.querySelectorAll('.bases-kanban-card.is-movable').length),0);check(true,'File fact grouping displays a lock and disables moves');
 // A list column's + writes its whole list, including when the property is absent.
 await run(async()=>{await k5api.createNote('KM/List.md','---\ntags: [a, b]\n---\nlist body');await k5api.createNote('KM/ListTwo.md','---\ntags: [c]\n---\nlist body');await k5api.writeNote('KM.base','filters: \'file.inFolder("KM")\'\nviews:\n  - type: kanban\n    name: Lists\n    order: [file.name, tags]\n    groupBy:\n      property: tags\n');await ws.vault.refreshFiles();ws.vault.written('KM.base');});
 await wait(()=>run(()=>!!document.querySelector('.bases-kanban-card[data-path="KM/List.md"]')),'list board');
 const plus=await run(()=>{const c=document.querySelector('.bases-kanban-card[data-path="KM/List.md"]').closest('.bases-kanban-col'),r=c.querySelector('.bases-kanban-add').getBoundingClientRect();return{x:r.x+12,y:r.y+12};});await click(plus);
 await wait(()=>run(()=>/KM\/Untitled/.test(ws.active.path??'')),'list new note');const created=await run(()=>ws.active.path);await wait(async()=>(await read(created)).includes('tags:'),'list note saved'); assert.match(await read(created),/tags:\s*(?:\[a, b\]|\n  - a\n  - b)/);check(true,'Column + seeds the whole list using the property formatter');
 // Move to a whole-list column, keeping the old flow-list style.
 await run(()=>ws.open('KM.base'));await wait(()=>run(()=>!!document.querySelector('.bases-kanban-card[data-path="KM/List.md"]')),'list board reopened');await keyboard('KM/List.md',1);
 await wait(async()=>/tags: \[c\]/.test(await read('KM/List.md')),'whole list moved');assert.ok((await read('KM/List.md')).endsWith('list body'));check(true,'Moving a list replaces the whole list and preserves flow style');
 // A removed frontmatter tag may still exist in the body; file.hasTag must use fresh full tags.
 await run(async()=>{for(const [name,body]of [['TagBody','#work'],['TagNoBody','plain']])await k5api.createNote(`KM/${name}.md`,`---\ntags: [work]\n---\n${body}`);await k5api.writeNote('KM.base','filters:\n  and:\n    - \'file.inFolder("KM")\'\n    - \'file.hasTag("work")\'\nviews:\n  - type: kanban\n    name: Tag filters\n    order: [file.name, tags]\n    groupBy:\n      property: tags\n      order:\n        - [work]\n        - [other]\n        - null\n');await ws.vault.refreshFiles();ws.vault.written('KM.base');});
 await wait(()=>run(()=>!!document.querySelector('.bases-kanban-card[data-path="KM/TagBody.md"]')),'tag filter board');await keyboard('KM/TagBody.md',1);
 await wait(async()=>/tags: \[other\]/.test(await read('KM/TagBody.md')),'body tag move');await sleep(150);assert.ok(await run(()=>!!document.querySelector('.bases-kanban-card[data-path="KM/TagBody.md"]')));
 await keyboard('KM/TagNoBody.md',1);await wait(async()=>/tags: \[other\]/.test(await read('KM/TagNoBody.md')),'removed tag move');await sleep(150);
 assert.equal(await run(()=>!!document.querySelector('.bases-kanban-card[data-path="KM/TagNoBody.md"]')),false);check(true,'Tag filters keep body tags and discard removed frontmatter tags after moving');await run(()=>{window.k5dryDelay=140;});await click('.bases-move-notice button');assert.ok(await run(()=>!!document.querySelector('.bases-kanban-card[data-path="KM/TagNoBody.md"]')),'tag-filter Undo paints before validation');assert.match(await read('KM/TagNoBody.md'),/tags: \[other\]/);await wait(async()=>/tags: \[work\]/.test(await read('KM/TagNoBody.md')),'tag-filter Undo saved');await run(()=>{window.k5dryDelay=0;});check(true,'Tag-filter Undo previews immediately while fresh validation is delayed');
 // Native pointer drag inside an editor embed does not drag text or move its following line.
 const embed='# Moving\n\n```base\n'+source+'```\n\nafter move board\n';
 await run(async embed=>{await k5api.createNote('Move Plan.md',embed);await ws.vault.refreshFiles();await ws.open('Move Plan.md');},embed);
 await wait(()=>run(()=>!!document.querySelector('.bases-embed .bases-kanban-card[data-path="KM/C.md"]')),'embedded board');
 await run(()=>{document.querySelector('.bases-embed .bases-kanban').scrollLeft=284;});await sleep(100);
 const lineY=()=>run(()=>{const line=[...document.querySelectorAll('.cm-line')].find(l=>l.textContent==='after move board');return{screen:line.getBoundingClientRect().top,relative:line.getBoundingClientRect().top-line.closest('.cm-content').getBoundingClientRect().top,height:document.querySelector('.bases-embed .bases-kanban').getBoundingClientRect().height,widgetHeight:document.querySelector('.bases-embed').getBoundingClientRect().height,followingGap:line.getBoundingClientRect().top-document.querySelector('.bases-embed').getBoundingClientRect().bottom};});
 const y=await lineY(), start=await point(card('KM/C.md')), end=await point(`${col('doing')} .bases-kanban-body`);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',...end,buttons:1});await sleep(35);await send('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',clickCount:1});
 await wait(async()=>/status: 'doing'/.test(await read('KM/C.md')),'embedded move');const afterY=await lineY();console.log('K5_EMBED',JSON.stringify({before:y,after:afterY}));assert.ok(Math.abs(afterY.followingGap-y.followingGap)<.01);assert.equal(afterY.widgetHeight,y.widgetHeight);assert.ok(Math.abs(afterY.screen-y.screen)<=1);assert.equal(afterY.height,400);check(true,'Embedded native drag changes only the property, with unchanged editor line geometry');
 // The card menu must own the native context event inside an editor embed.
 await click(card('KM/C.md'),'right');
 const menuPoint=title=>run(title=>{const e=[...document.querySelectorAll('.menu-item')].find(e=>e.querySelector('.menu-item-title')?.textContent===title);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},title);
 await wait(async()=>!!await menuPoint('Move to'),'card Move to');await move(await menuPoint('Move to'));await wait(async()=>!!await menuPoint('review'),'target submenu');await click(await menuPoint('review'));
 await wait(async()=>/status: 'review'/.test(await read('KM/C.md')),'context move saved');assert.equal(await read('Move Plan.md'),embed);check(true,'Native card Move to submenu works inside an embed without editing its host');


});

// Refresh already inside properties, a second Ctrl+Z after that rebuild, undo of a deleted note, and two blocks in one note.
let embedKeyFault = null;
await withBrowser(async({run,point,send,press,check})=>{
 const wait=async(test,label,n=400)=>{for(let i=0;i<n;i++){if(await test())return;await sleep(25);}assert.fail(label);};
 const read=path=>run(async path=>{const {api}=await import('/src/api.ts');return api.readNote(path);},path);
 const source=`filters: 'file.inFolder("KQ")'\nviews:\n  - type: kanban\n    name: Board\n    order: [file.name, status]\n    groupBy:\n      property: status\n      direction: ASC\n      order: [todo, doing, review, done, null]\n`;
 const card=path=>`.bases-kanban-card[data-path='${path}']`;
 const col=id=>`.bases-kanban-col[data-group-id='${id}'] .bases-kanban-body`;
 await run(async source=>{
  const {api}=await import('/src/api.ts');
  for(const [name,status] of [['A','todo'],['B','doing'],['C','review']])await api.createNote(`KQ/${name}.md`,`---\nstatus: '${status}'\nkeep: same\n---\nbody ${name}\n`);
  await api.createNote('KQ.base',source);await ws.vault.refreshFiles();await ws.open('KQ.base');
  window.k5api=api;
 },source);
 await wait(()=>run(sel=>!!document.querySelector(sel),card('KQ/A.md')),'review board');
 await run(sel=>document.querySelector(sel).focus(),card('KQ/A.md'));
 await press(' ');await press('ArrowRight');await press(' ');
 await wait(async()=>/status: 'doing'/.test(await read('KQ/A.md')),'A moved');
 await sleep(200);
 await run(()=>{window.k5col=document.querySelector('.bases-kanban-col');});
 await press('z',2);
 await wait(()=>run(sel=>window.k5col?.isConnected===false&&document.activeElement?.matches(sel),card('KQ/A.md')),'undo rebuild keeps focus');
 await press('z',10);
 await wait(async()=>/status: 'doing'/.test(await read('KQ/A.md')),'redo without clicking the board again');
 check(true,'A second Ctrl+Z still reaches the board after undo rebuilds it');
 await run(async()=>{await k5api.deletePath('KQ/A.md',true);await ws.vault.refreshFiles();});
 await wait(()=>run(sel=>!document.querySelector(sel),card('KQ/A.md')),'deleted card leaves');
 await run(()=>document.querySelector('.bases-kanban').focus());
 await press('z',2);await sleep(300);
 const delNotice=await run(()=>document.querySelector('.bases-move-notice')?.textContent??'');
 let missing=false;try{await read('KQ/A.md');}catch{missing=true;}
 assert.equal(missing,true);assert.equal(await run(sel=>!!document.querySelector(sel),card('KQ/A.md')),false);
 assert.match(delNotice,/Can't undo|Note not found/);
 check(true,'Undo after the moved note was deleted refuses and does not invent a card');
 await run(()=>{
  window.k5held=0;window.k5wait=[];window.k5hold=true;
  const original=k5api.properties.bind(k5api);
  k5api.properties=async(...args)=>{if(window.k5hold){window.k5held++;await new Promise(r=>window.k5wait.push(r));}return original(...args);};
 });
 try{
  await run(async()=>{await k5api.writeNote('KQ/B.md',"---\nstatus: 'doing'\nkeep: touched\n---\nbody B\n");ws.vault.written('KQ/B.md');});
  await wait(()=>run(()=>k5held>0),'properties held');
  await run(()=>{document.querySelector('.bases-kanban').scrollLeft=0;});
  const from=await point(card('KQ/C.md')),to=await point(col('s:"todo"'));
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...from});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',clickCount:1});
  for(let i=1;i<=8;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(to.x-from.x)*i/8,y:from.y,buttons:1});
  await sleep(40);
  assert.equal(await run(()=>!!document.querySelector('.bases-move-ghost')),true);
  await run(()=>{window.k5hold=false;window.k5wait.splice(0).forEach(r=>r());});
  await sleep(300);
  assert.equal(await run(()=>!!document.querySelector('.bases-move-ghost')),true,'a refresh already in flight must not cancel the drag');
  await press('Escape');
  assert.equal(await run(()=>!!document.querySelector('.bases-move-ghost')),false);
  assert.match(await read('KQ/C.md'),/status: 'review'/);
  await sleep(250);
  await run(sel=>document.querySelector(sel).focus(),card('KQ/B.md'));
  await press(' ');await press('ArrowRight');await press(' ');
  await wait(async()=>/status: 'review'/.test(await read('KQ/B.md'))&&/keep: touched/.test(await read('KQ/B.md')),'external edit survived the cancelled drag');
  check(true,'A refresh blocked on properties leaves the drag in place, and Escape still applies the external edit');
 }finally{await run(()=>{window.k5hold=false;window.k5wait?.splice(0).forEach(r=>r());});}
 const embed='# One\n\n```base\n'+source+'```\n\n# Two\n\n```base\nfilters: \'file.inFolder("NO")\'\nviews:\n  - type: kanban\n    name: Other\n    groupBy:\n      property: status\n```\n';
 await run(async embed=>{await k5api.createNote('NO/Z.md',"---\nstatus: 'todo'\n---\nz\n");await k5api.createNote('KQ Plan.md',embed);await ws.vault.refreshFiles();await ws.open('KQ Plan.md');},embed);
 await wait(()=>run(()=>document.querySelectorAll('.bases-embed .bases-kanban').length===2),'two blocks');
 await wait(()=>run(sel=>!!document.querySelector(sel),`.bases-embed ${card('KQ/C.md')}`),'embedded card');
 await run(()=>{document.querySelector('.bases-embed .bases-kanban').scrollLeft=0;});
 await sleep(80);
 const hit=await run(()=>{
  const board=document.querySelector('.bases-embed .bases-kanban');
  const card=board.querySelector('.bases-kanban-card[data-path="KQ/C.md"]');
  const column=[...board.querySelectorAll('.bases-kanban-col')].find(c=>c.dataset.groupId==='s:"todo"');
  const a=card.getBoundingClientRect(),b=column.querySelector('.bases-kanban-body').getBoundingClientRect();
  return {ax:a.x+a.width/2,ay:a.y+12,bx:b.x+20,by:b.y+30};
 });
 const before=await read('KQ/C.md');
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:hit.ax,y:hit.ay});
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:hit.ax,y:hit.ay,button:'left',clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:hit.bx,y:hit.by,buttons:1});
 await sleep(40);
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:hit.bx,y:hit.by,button:'left',clickCount:1});
 await wait(async()=>(await read('KQ/C.md'))!==before,'block move');
 const moved=await read('KQ/C.md');
 // The other block's notice may be hidden, so invoke its handler directly. A shared stack would revert C.
 await run(()=>{
  const boards=[...document.querySelectorAll('.bases-embed .bases-kanban')];
  const other=boards.find(b=>!b.querySelector('.bases-kanban-card[data-path="KQ/C.md"]'));
  other.querySelector('.bases-move-notice button').click();
 });
 await sleep(300);
 assert.equal(await read('KQ/C.md'),moved,'the other block\'s Undo changed this note');
 // A pointer drop suppresses the following click. pointerdown on the Undo button clears that, as a real press does.
 await run(()=>{
  const board=document.querySelector('.bases-embed .bases-kanban-card[data-path="KQ/C.md"]').closest('.bases-kanban');
  const button=board.querySelector('.bases-move-notice button');
  button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}));
  button.click();
 });
 await wait(async()=>(await read('KQ/C.md'))===before,'undo stays on the block that moved');
 check(true,'Undo on one base block does not revert a move made on another block in the same note');
 await run(sel=>document.querySelector(sel).focus(),`.bases-embed ${card('KQ/B.md')}`);
 await press(' ');await press('ArrowRight');await press(' ');
 let embedKey='';
 try{
  await wait(async()=>{embedKey=await run(async()=>{try{const {api}=await import('/src/api.ts');return await api.readNote('KQ/B.md');}catch(e){return 'ERR '+e.message;}});return /status: 'done'/.test(embedKey);},'embed keyboard move');
  check(true,'Space and arrows move a card inside an embedded board');
 }catch(e){
  console.log('EMBED KEY',embedKey,JSON.stringify(await run(()=>({active:document.activeElement?.className??null,paths:ws.vault.files.map(f=>f.path).filter(p=>p.startsWith('KQ')||p.startsWith('NO'))}))));
  embedKeyFault=e;
 }
});

// P4/P5/P7: 10,000 balanced notes, transform-only drag across three columns with auto-scroll.
await withBrowser(async({run,send,point,press,check})=>{
 const wait=async(test,label,n=800)=>{for(let i=0;i<n;i++){if(await test())return;await sleep(10);}assert.fail(label);};
 await send('Performance.enable');
 await run(async()=>{
  const {api}=await import('/src/api.ts');window.k5api=api;
  const source='filters: \'file.inFolder("KP")\'\nviews:\n  - type: kanban\n    name: Performance\n    order: [file.name, status, priority]\n    groupBy:\n      property: status\n      order: [todo, doing, review, done]\n    sort:\n      - property: file.name\n';
  for(let i=0;i<10000;i++){const e=i%100===0?'\r\n':'\n',bom=i%100===0?'\uFEFF':'';await api.createNote(`KP/${String(i).padStart(5,'0')}.md`,`${bom}---${e}status: ${['todo','doing','review','done'][i%4]}${e}priority: ${i%7}${e}---${e}body ${i}${e}`);}
  await api.createNote('KP Finish.md','# Finished');await api.createNote('KP.base',source);await ws.vault.refreshFiles();await ws.open('KP.base');
 });
 await wait(()=>run(()=>!!document.querySelector('.bases-kanban-card[data-path="KP/00000.md"]')),'10k board');await sleep(150);
 const start=await point('.bases-kanban-card[data-path="KP/00000.md"]');
 const bounds=await run(()=>{const r=document.querySelector('.bases-kanban-track').getBoundingClientRect(),b=document.querySelector('.bases-kanban').getBoundingClientRect();return{right:b.right,bottom:r.bottom,top:r.top};});
 await run(start=>{
  window.k5p={frames:[],events:[],rects:0,ghostChecks:0,ghostLag:0,long:[],dropLong:[],start,x:start.x,y:start.y};
  const original=Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect=function(...args){if(k5p.active)k5p.rects++;return original.apply(this,args);};
  window.addEventListener('pointermove',e=>{if(!k5p.active)return;k5p.t=performance.now();k5p.x=e.clientX;k5p.y=e.clientY;requestAnimationFrame(()=>{const g=document.querySelector('.bases-move-ghost');if(!g)return;const m=new DOMMatrix(g.style.transform);k5p.ghostChecks++;if(Math.abs(m.e-(k5p.x-start.x))>1||Math.abs(m.f-(k5p.y-start.y))>1)k5p.ghostLag++;});},{capture:true});
  window.addEventListener('pointermove',()=>{if(k5p.active)k5p.events.push(performance.now()-k5p.t);});
  let last=performance.now();k5p.raf=requestAnimationFrame(function tick(t){if(k5p.active)k5p.frames.push(t-last);last=t;k5p.raf=requestAnimationFrame(tick);});
  k5p.obs=new PerformanceObserver(list=>{if(k5p.active)k5p.long.push(...list.getEntries().map(e=>e.duration));else if(k5p.up)k5p.dropLong.push(...list.getEntries().map(e=>e.duration));});k5p.obs.observe({type:'longtask'});
  const originalProperties=k5api.properties;k5api.properties=async(...args)=>{const result=await originalProperties(...args);const value=result['KP/00000.md']?.props.find(p=>p.key==='status')?.value;if(k5p.up&&value==='done')k5p.propsFresh=performance.now();if(window.k5hist?.start&&value===k5hist.target)k5hist.fresh=performance.now();return result;};
  k5p.mutations=new MutationObserver(records=>{if(records.some(r=>[...r.removedNodes].some(n=>n.classList?.contains('bases-kanban-col'))))requestAnimationFrame(()=>{if(k5p.propsFresh)k5p.reconciled=performance.now();if(window.k5hist?.fresh)k5hist.reconciled=performance.now();});});k5p.mutations.observe(document.querySelector('.bases-kanban-track'),{childList:true,subtree:true});
  const originalWrite=k5api.setProperty;k5api.setProperty=async(...args)=>{const r=await originalWrite(...args);if(!args[2])k5p.saved=performance.now();return r;};
  window.addEventListener('pointerup',()=>{k5p.up=performance.now();requestAnimationFrame(()=>{k5p.paint=performance.now();k5p.painted=!!document.querySelector('.bases-kanban-col[data-group-id=\'s:"done"\'] .bases-kanban-card[data-path="KP/00000.md"]');});},{capture:true});
 },start);
 const metrics=async()=>Object.fromEntries((await send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 const before=await metrics();await run(()=>{k5p.active=true;});
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',...start});await send('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',clickCount:1});
 const end={x:bounds.right-12,y:bounds.bottom-18};
 for(let i=1;i<=120;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+(end.x-start.x)*Math.min(1,i/90),y:start.y+(end.y-start.y)*Math.min(1,i/90),buttons:1});await sleep(8);}
 const drag=await run(()=>{k5p.active=false;cancelAnimationFrame(k5p.raf);return{...k5p,frames:k5p.frames.slice(2),trackTop:document.querySelector('.bases-kanban-track').getBoundingClientRect().top,scrollX:document.querySelector('.bases-kanban').scrollLeft,scrollY:Math.max(...[...document.querySelectorAll('.bases-kanban-body')].map(b=>b.scrollTop))};});
 const after=await metrics();const sorted=drag.frames.sort((a,b)=>a-b),p95=sorted[Math.floor(sorted.length*.95)],max=Math.max(...sorted),maxEvent=Math.max(...drag.events);
 console.log('K5_P4',JSON.stringify({frames:sorted.length,p95,max,handlerMaxMs:maxEvent,scriptPerMoveMs:(after.ScriptDuration-before.ScriptDuration)*1000/120,layouts:after.LayoutCount-before.LayoutCount,rectReads:drag.rects,ghostChecks:drag.ghostChecks,ghostLag:drag.ghostLag,scrollX:drag.scrollX,scrollY:drag.scrollY,long:drag.long}));
 assert.ok(p95<=20&&max<=25);assert.ok(maxEvent<=1);assert.ok((after.ScriptDuration-before.ScriptDuration)*1000/120<=1);assert.ok(after.LayoutCount-before.LayoutCount<=sorted.length+4);assert.ok(drag.rects<=3,'only threshold snapshot reads rectangles');assert.equal(drag.ghostLag,0);assert.ok(drag.ghostChecks>=100);assert.ok(drag.scrollX>0&&drag.scrollY>0);assert.equal(drag.trackTop,bounds.top,'a drag hint never reflows the track');assert.deepEqual(drag.long,[]);
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',clickCount:1});
 await wait(()=>run(()=>k5p.paint&&k5p.saved&&k5p.reconciled),'drop painted, saved and reconciled');
 const drop=await run(()=>({paint:k5p.paint-k5p.up,saved:k5p.saved-k5p.up,reconciled:k5p.reconciled-k5p.up,painted:k5p.painted,long:k5p.dropLong}));console.log('K5_P5',JSON.stringify(drop));assert.equal(drop.painted,true);assert.ok(drop.paint<=20&&drop.saved<=100&&drop.reconciled<=100);assert.deepEqual(drop.long,[]);
 // Normal full reconciliation (K6 owns skipping it) must finish within the same 100 ms budget.
 await wait(()=>run(()=>document.querySelector('.bases-move-notice')?.textContent.includes('Moved "00000" to done')),'drop completed');
 await sleep(120);
 // Bring the moved row (sorted first in done) into view for keyboard Undo and Redo.
 await run(()=>{const c=document.querySelector('.bases-kanban-col[data-group-id=\'s:"done"\']');c.querySelector('.bases-kanban-body').scrollTop=0;});await sleep(40);
 const historyMeasure=async(back,target)=>{
  await run(target=>{document.querySelector('.bases-kanban').focus();window.k5hist={target,frames:0};if(!window.k5historyListener){window.k5historyListener=true;window.addEventListener('keydown',e=>{if(!e.ctrlKey||e.key.toLowerCase()!=='z')return;k5hist.start=performance.now();requestAnimationFrame(function tick(){k5hist.frames++;if(document.querySelector(`.bases-kanban-col[data-group-id='s:"${k5hist.target}"'] .bases-kanban-card[data-path="KP/00000.md"]`)){k5hist.paint=performance.now();return;}if(k5hist.frames<30)requestAnimationFrame(tick);});},{capture:true});}},target);
  await press('z',back?2:10);await wait(()=>run(()=>k5hist.paint&&k5hist.reconciled&&k5p.saved>=k5hist.start),'history paint and reconcile');
  const result=await run(()=>({paint:k5hist.paint-k5hist.start,saved:k5p.saved-k5hist.start,reconciled:k5hist.reconciled-k5hist.start,frames:k5hist.frames}));assert.ok(result.paint<=20&&result.saved<=100&&result.reconciled<=100,JSON.stringify(result));assert.equal(result.frames,1,JSON.stringify(result));return result;
 };
 const saved=await run(()=>k5api.readNote('KP/00000.md'));assert.ok(saved.startsWith('\uFEFF---\r\n')&&saved.endsWith('body 0\r\n')&&saved.includes('status: done\r\n'));
 const undo=await historyMeasure(true,'todo');await sleep(120);const redo=await historyMeasure(false,'done');console.log('K5_P7',JSON.stringify({undo,redo}));await run(()=>{k5p.obs.disconnect();k5p.mutations.disconnect();});
 // Navigating away during an auto-scroll drag cancels it and any detached column fill.
 const leaving=await point('.bases-kanban-card[data-path="KP/00000.md"]');
 const other=await point('.bases-kanban-col[data-group-id=\'s:"review"\'] .bases-kanban-body');other.y=bounds.bottom-5;
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...leaving,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',...other,buttons:1});await wait(()=>run(()=>!!document.querySelector('.bases-move-ghost')),'navigation drag');
 await run(()=>ws.open('KP Finish.md'));await send('Input.dispatchMouseEvent',{type:'mouseReleased',...other,button:'left',clickCount:1});await sleep(50);
 assert.equal(await run(()=>!!document.querySelector('.bases-move-ghost')),false);assert.ok((await run(()=>k5api.readNote('KP/00000.md'))).includes('status: done'));check(true,'Leaving an auto-scroll drag removes its ghost and writes nothing');
 check(true,`P4: 10k drag p95 ${p95.toFixed(1)}ms, handler max ${maxEvent.toFixed(3)}ms; P5/P7 optimistic paint and CAS finish within budget`);
});
if (embedKeyFault) throw embedKeyFault;
