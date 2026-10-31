// K5: native pointer/keys, CAS races, loaded editors, history, embeds and P4/P5/P7.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({run,click,point,send,press,check})=>{
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
  api.setProperty=async(...args)=>{k5calls.push({path:args[0],edit:args[1],dry:!!args[2],at:performance.now()});if(!args[2]&&window.k5delay)await new Promise(r=>setTimeout(r,k5delay));if(!args[2]&&window.k5conflict){window.k5conflict=false;await api.writeNote(args[0],'---\nstatus: external\nkeep: same\n---\nexternal body\n');}if(!args[2]&&window.k5refuse)return {status:'refused',reason:'Simulated write refusal'};return k5original(...args);};
 },source);
 await wait(()=>at('KM/A.md','todo'),'board');
 const focus=async path=>{await run(path=>document.querySelector(`.bases-kanban-card[data-path='${path}']`).focus(),path);};
 const keyboard=async(path,steps)=>{await focus(path);await press(' ');for(let i=0;i<Math.abs(steps);i++)await press(steps>0?'ArrowRight':'ArrowLeft');await press(' ');};
 await keyboard('KM/A.md',1);await wait(async()=>/status: 'doing'/.test(await read('KM/A.md')),'keyboard move');
 assert.ok((await read('KM/A.md')).endsWith('body A\n'));check(true,'Space/arrows/Space moves with quote and body bytes preserved');
 await wait(()=>at('KM/A.md','doing'),'move reconciled');await focus('KM/A.md');await press('z',2);
 await wait(async()=>/status: 'todo'/.test(await read('KM/A.md')),'undo');await wait(()=>at('KM/A.md','todo'),'undo painted');
 await focus('KM/A.md');await press('z',10);await wait(async()=>/status: 'doing'/.test(await read('KM/A.md')),'redo');
 await wait(()=>at('KM/A.md','doing'),'redo painted');check(true,'Ctrl+Z and Ctrl+Shift+Z replay exact raw CAS lines');
 // Escape cancels without a writer; invalid YAML is disabled before pick-up.
 const before=(await run(()=>k5calls.length));await focus('KM/B.md');await press(' ');await press('ArrowRight');await press('Escape');assert.equal(await run(()=>k5calls.length),before);
 assert.equal(await run(()=>document.querySelector('.bases-kanban-card[data-path="KM/Unsafe.md"]').classList.contains('is-movable')),false);
 await wait(()=>run(()=>!document.querySelector('.bases-kanban-card[data-path="KM/Duplicate.md"]').classList.contains('is-movable')),'duplicate disabled');
 check(true,'Escape writes nothing; commented and duplicate frontmatter have no grab cursor');
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
 // Header drag snapshots a Manual order, and one undo restores automatic mode.
 await run(async source=>{for(const g of ws.layout.groups().slice(1))for(const t of [...g.tabs])ws.closeTab(t); await ws.open('KM.base');await k5api.writeNote('KM.base',source.replace('      order: [todo, doing, review, done, null]\n',''));ws.vault.written('KM.base');},source);
 await wait(()=>run(()=>document.querySelector('.bases-kanban-col')?.dataset.groupId==='s:"doing"'),'automatic order');
 const h1=await point(`${col('doing')} .bases-kanban-label`),h2=await point(`${col('review')} .bases-kanban-label`);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...h1,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',...h2,buttons:1});await sleep(35);await send('Input.dispatchMouseEvent',{type:'mouseReleased',...h2,button:'left',clickCount:1});
 await wait(async()=>/      order:\n/.test(await read('KM.base')),'header saved');
 await wait(()=>run(()=>document.querySelector('.bases-move-notice').textContent.includes('Changed column order')),'header completed'); await click('.bases-move-notice button');await wait(async()=>!(/      order:\n/.test(await read('KM.base'))),'header undo to automatic');
 check(true,'Column header drag writes Manual; one notice Undo restores automatic order');
});
