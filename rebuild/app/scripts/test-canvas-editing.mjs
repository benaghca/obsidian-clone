// Canvas Part A: native CDP selection, drags, stationary clicks and saved bytes.
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
const fixture = { future: { untouched: [1, 2] }, nodes: [
  { id:'g',type:'group',x:-40,y:-40,width:360,height:280,label:'Group' },
  { id:'a',type:'text',x:0,y:0,width:240,height:160,text:'Card A',extra:{retain:42} },
  { id:'future',type:'unknown',x:500,opaque:['keep','order'] },
  { id:'b',type:'text',x:440,y:0,width:240,height:160,text:'Card B' },
], edges:[{id:'e',fromNode:'a',toNode:'b',label:'Live edge',future:true},{id:'future-edge',fromNode:'future',toNode:'a',unknown:42},null] };
await withBrowser(async ({ send, run, click, point, move, press, chord, check, shot, read, open: openFile }) => {
  const open = (name, source = fixture) => openFile(name, source);
  const data = async () => JSON.parse(await read());
  const node = async id => (await data()).nodes.find(n=>n?.id===id);
  const card = id => `[data-node-id="${id}"]`;
  const selected = () => run(()=>[...document.querySelectorAll('.canvas-node.is-selected')].map(n=>n.dataset.nodeId).sort());
  const drag = async (p,dx,dy,modifiers=0,inspect) => {
    await move(p);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1,modifiers});
    for(let i=1;i<=12;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+dx*i/12,y:p.y+dy*i/12,buttons:1,modifiers});await sleep(20);}
    if(inspect) await inspect();
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+dx,y:p.y+dy,button:'left',buttons:0,clickCount:1,modifiers});await sleep(380);
  };
  const modified = async () => run(()=>{ws.vault.written(ws.active.viewFile);});
  await open('Edit.canvas');
  const original=await read();
  await click(card('a'));check(JSON.stringify(await selected())==='["a"]','Click selects a card and exposes eight resize handles');
  check(await run(()=>document.querySelectorAll('.canvas-node.is-selected .canvas-node-resizer').length===8),'Selected card has four side and four corner targets');
  const at=await point(card('a'));
  for(const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type,...at,button:'left',clickCount:1});
  check(JSON.stringify(await selected())==='["a"]','Repeated stationary card click retains selection');
  await click(await point(card('b'))); // move over before Shift click
  await move(await point(card('a')));
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...await point(card('a')),button:'left',clickCount:1,modifiers:8});
  check(JSON.stringify(await selected())==='["a","b"]','Shift-click adds to selection');
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...await point(card('a')),button:'left',clickCount:1,modifiers:8});
  check(JSON.stringify(await selected())==='["b"]','Stationary Shift-click removes from selection');
  await click({x:1000,y:690});check((await selected()).length===0,'Empty background clears selection');
  check(await read()===original,'Selection and no-op clicks leave original bytes intact');
  await click(card('a'));
  const pathBefore=await run(()=>document.querySelector('.canvas-edges > path').getAttribute('d'));
  await drag(await point(card('a')),33,27,0,async()=>{
    check(await run(()=>document.querySelector('.canvas-edges > path').getAttribute('d'))!==pathBefore,'Attached edge follows during the drag before saving');
    check(await read()===original,'No intermediate drag writes');
  });
  check((await node('a')).x===40&&(await node('a')).y===20,'Move snaps to a 20-unit grid');
  const moved=await data();assert.deepEqual(Object.keys(moved),Object.keys(fixture));
  assert.deepEqual(moved.nodes.map(n=>n.id),fixture.nodes.map(n=>n.id));
  assert.deepEqual(moved.nodes[1].extra,fixture.nodes[1].extra);assert.deepEqual(moved.nodes[2],fixture.nodes[2]);assert.deepEqual(moved.edges,fixture.edges);
  check(true,'Save preserves root/key/node order, opaque nodes, edges and nested fields');

  await chord('z');await sleep(380);check(await read()===original,'Undo move restores original bytes');
  await press('Z',10);await sleep(380);check((await node('a')).x===40,'Ctrl+Shift+Z redoes a move');
  await drag(await point(card('a')),13,17,1);check((await node('a')).x===53&&(await node('a')).y===37,'Alt bypasses grid snapping');
  await drag(await point(card('a')),45,15,8);check((await node('a')).y===37,'Shift drag locks the dominant axis');
  await press('ArrowRight');await sleep(380);check((await node('a')).x===105,'Arrow keys nudge by five units');
  await press('ArrowRight',8);await sleep(380);check((await node('a')).x===205,'Shift-arrow nudges by one hundred units');
  await drag(await point(`${card('a')} [data-resize="bottomright"]`),-300,-200);
  check((await node('a')).width===50&&(await node('a')).height===50,'Resize respects 50×50 minimum');
  await chord('z');await sleep(380);check((await node('a')).width===240,'Undo restores size');
  await press('Z',10);await sleep(380);check((await node('a')).width===50,'Redo restores resized card');
  await chord('z');await sleep(380);
  await click(card('a'));
  await drag(await point(`${card('a')} [data-resize="topleft"]`),-40,-40);
  check((await node('a')).x===160&&(await node('a')).y===0&&(await node('a')).width===285,'Top-left resize keeps the opposite corner anchored');
  await press('Escape');await click(card('b'));await press('Backspace');await sleep(380);
  check(!(await data()).nodes.some(n=>n.id==='b')&&!(await data()).edges.some(e=>e?.fromNode==='b'||e?.toNode==='b'),'Backspace removes the selected card and its incident edges');
  await chord('z');await sleep(380);check((await data()).edges.some(e=>e?.id==='e'),'Undo deletion restores the card and all edge fields');
  await press('Z',10);await sleep(380);check(!(await data()).nodes.some(n=>n.id==='b'),'Redo deletion removes it again');
  await open('Groups.canvas');await drag(await point(`${card('g')} .canvas-group-label`),41,21);
  check((await node('g')).x===0&&(await node('g')).y===-20&&(await node('a')).x===40&&(await node('a')).y===20,'Moving a group translates contained cards once');
  await press('Delete');await sleep(380);check(!(await data()).nodes.some(n=>n.id==='g')&&(await data()).nodes.some(n=>n.id==='a'),'Deleting a group leaves its contained cards');
  await open('Box.canvas');
  const r=await run(()=>{const r=document.querySelector('[data-node-id="b"]').getBoundingClientRect();return{x:r.x-15,y:r.y-15,w:r.width+30,h:r.height+30};});
  await drag(r,r.w,r.h);check(JSON.stringify(await selected())==='["b"]','Empty-background box selects fully enclosed cards');
  const bytes=await read();await click({x:1000,y:690});await drag(r,r.w/2,r.h/2);check(JSON.stringify(await selected())==='["b"]','Selection box also selects partially intersecting cards');check(await read()===bytes,'Box selection is read only');
  await click(card('a'));const cancelBefore=await read();
  const start=await point(card('a'));await move(start);await send('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+60,y:start.y+40,buttons:1});await sleep(40);await press('Escape');await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.x+60,y:start.y+40,button:'left',clickCount:1});await sleep(380);
  check(await read()===cancelBefore,'Escape cancels a live drag without saving');
  await drag(await point(card('a')),25,25);await run(async()=>{const{api}=await import('/src/api.ts');const d=JSON.parse(await api.readNote(ws.active.viewFile));d.nodes[1].x=180;await api.writeNote(ws.active.viewFile,JSON.stringify(d));});await modified();await sleep(100);
  check(await run(()=>document.querySelector('[data-node-id="a"]').style.left==='180px'),'External file change reloads board geometry');
  await chord('z');await sleep(380);check((await node('a')).x===180,'External reload clears stale undo history');
  await open('Flush.canvas');
  const s=await point(card('a'));await move(s);await send('Input.dispatchMouseEvent',{type:'mousePressed',...s,button:'left',buttons:1,clickCount:1});for(let i=1;i<=6;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:s.x+40*i/6,y:s.y,buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:s.x+40,y:s.y,button:'left',clickCount:1});await run(async()=>{await ws.open('Welcome.md');});await sleep(100);
  check(await run(async()=>{const{api}=await import('/src/api.ts');return JSON.parse(await api.readNote('Flush.canvas')).nodes[1].x===40;}),'Leaving the canvas flushes its pending save');
  await open('SameEdit.canvas',{nodes:fixture.nodes.filter(n=>n.type!=='unknown'),edges:[fixture.edges[0]]});
  await drag(await point(card('a')),33,27);await shot('grove-edit');await writeFile(new URL('../../round24-shots/Grove.canvas',import.meta.url),await read());
  const obs=await readFile(new URL('../../round24-shots/Obsidian.canvas',import.meta.url),'utf8');await open('FromObsidian.canvas',obs);check(await run(expected=>expected.nodes.every(n=>{const card=document.querySelector(`[data-node-id="${n.id}"]`);return card&&['x','y','width','height'].every(k=>parseFloat(card.style[{x:'left',y:'top',width:'width',height:'height'}[k]])===n[k]);}),JSON.parse(obs)),'Obsidian-edited scratch canvas renders in Grove with identical geometry');check(await read()===obs,'Reverse round trip opens without rewriting Obsidian bytes');
  const large=await readFile(new URL('../../round23-shots/Large.canvas',import.meta.url),'utf8');await open('LargeEdit.canvas',large);await click('.canvas-controls [aria-label="Reset zoom"]');
  const visible=await run(()=>[...document.querySelectorAll('.canvas-node')].map(n=>{const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};}).find(p=>p.x>300&&p.x<1000&&p.y>150&&p.y<600));
  // Warm the compositor, then sample native drag frames on the full fixture.
  await drag(visible,20,20);await run(()=>{window.editFrames=[];window.editSampling=true;let last=performance.now();function frame(t){if(!editSampling)return;editFrames.push(t-last);last=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);});
  await drag({x:visible.x+20,y:visible.y+20},120,80);const frames=await run(()=>{editSampling=false;return editFrames.slice(2);});check(frames.length>15&&Math.max(...frames)<20,`300-card drag frames under 20ms (max ${Math.max(...frames).toFixed(1)}ms, ${frames.length} intervals)`);
}, {height:800,screenshots:new URL('../../round24-shots/',import.meta.url).pathname});
