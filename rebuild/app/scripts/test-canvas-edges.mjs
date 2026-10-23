// Part A arrows use native CDP pointer/key input in a scratch mock vault.
import { readFile, writeFile } from 'node:fs/promises';
import { withBrowser, sleep } from './browser.mjs';
const fixture = { future: {keep:[1,2]}, nodes:[
 {id:'a',type:'text',x:0,y:0,width:200,height:120,text:'Alpha',extra:{keep:true}},
 {id:'b',type:'text',x:400,y:0,width:200,height:120,text:'Beta'},
 {id:'c',type:'text',x:200,y:260,width:200,height:120,text:'Gamma'},
 {id:'opaque',type:'text',x:700,y:260,width:100,height:120,text:'Untouched',payload:42},
], edges:[{future:{keep:true},id:'old',fromNode:'a',fromSide:'bottom',toNode:'c',toSide:'left',fromEnd:'arrow',toEnd:'none',color:'4',label:'Existing'}, {id:'opaque-edge',fromNode:'opaque',fromSide:'left',toNode:'b',toSide:'bottom',future:42}]};
await withBrowser(async ({run,send,click,move,point,press,chord,open,read,check,shot,double}) => {
 const data = async () => JSON.parse(await read());
 const save = async name => { if(process.env.GROVE_UPDATE_EDGE_FIXTURES==='1') await writeFile(new URL('../../round26-shots/Grove-'+name+'.canvas',import.meta.url),await read()); };
 const card = id => `[data-node-id="${id}"]`;
 const endpoint = (id,end) => `.canvas-edge-end[data-edge-id="${id}"][data-edge-end="${end}"]`;
 const edgePoint = (id,offset=0) => run((id,offset)=>{const e=[...document.querySelectorAll('path.canvas-edge')].find(e=>e.dataset.edgeId===id),len=e.getTotalLength();const p=e.getPointAtLength(len/2),q=e.getPointAtLength(len/2+1);const m=e.getScreenCTM(),a=new DOMPoint(p.x,p.y).matrixTransform(m),b=new DOMPoint(q.x,q.y).matrixTransform(m),d=Math.hypot(b.x-a.x,b.y-a.y);return{x:a.x-(b.y-a.y)*offset/d,y:a.y+(b.x-a.x)*offset/d};},id,offset);
 const sidePoint = (id,side) => run((id,side)=>{const r=document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect();return{x:side==='left'?r.left+3:side==='right'?r.right-3:r.x+r.width/2,y:side==='top'?r.top+3:side==='bottom'?r.bottom-3:r.y+r.height/2};},id,side);
 const dot = async (id,side) => {await move(await point(card(id)));return point(`${card(id)} [data-side="${side}"]`);};
 const stationary = async (p,modifiers=0) => {for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1,modifiers});await sleep(80);};
 const drag = async (a,b,inspect,cancel=false) => {
  await move(a);await send('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',buttons:1,clickCount:1});
  for(let i=1;i<=18;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/18,y:a.y+(b.y-a.y)*i/18,buttons:1});await sleep(18);}
  if(inspect)await inspect();if(cancel)await press('Escape');
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',buttons:0,clickCount:1});await sleep(380);
 };
 await open('Arrows.canvas',JSON.stringify(fixture,null,2)+'\n');const original=await read();
 for(const side of ['top','right','bottom','left']) {
  const p=await dot('a',side);await move(p);
  check(await run(side=>{const e=document.querySelector(`[data-node-id="a"] [data-side="${side}"]`),r=e.getBoundingClientRect();return Math.abs(r.width-20)<.1&&Math.abs(r.height-20)<.1&&getComputedStyle(e,'::after').opacity==='1'&&document.elementFromPoint(r.x+10,r.y+10)?.closest('.canvas-node-connection-point')===e;},side),side+': connection dot is a visible native 20px pointer target');
 }
 check(await read()===original,'Hovering dots leaves original bytes unchanged');
 await drag(await dot('a','right'),await sidePoint('b','left'),async()=>{
  check(await run(()=>document.querySelector('.canvas-edge-preview').style.display!=='none'),'Connection preview follows the native drag');
  check(await read()===original,'Dragging never saves an intermediate edge');
 });
 const created=await read(),newEdge=(await data()).edges.find(e=>e&&!['old','opaque-edge'].includes(e.id)),id=newEdge?.id;
 check(/^[0-9a-f]{16}$/.test(id)&&JSON.stringify(Object.keys(newEdge))==='["id","fromNode","fromSide","toNode","toSide"]','Created edge has native ID/key order and implicit default arrowheads');
 check(newEdge.fromNode==='a'&&newEdge.fromSide==='right'&&newEdge.toNode==='b'&&newEdge.toSide==='left','Drag snaps to the target left side');
 check((await data()).future.keep.join(',')==='1,2'&&(await data()).nodes[0].extra.keep&&JSON.stringify((await data()).edges.slice(0,fixture.edges.length))===JSON.stringify(fixture.edges),'Creation preserves unknown root, node and edge records');
 check(await run(id=>document.querySelectorAll(`.canvas-edge-end[data-edge-id="${id}"].is-selected`).length===2,id),'New edge stays selected with two reconnect targets');
 await save('created');await shot('grove-edge-created');
 await chord('z');await sleep(380);check(await read()===original,'One undo removes the whole new edge and restores exact original bytes');
 await chord('y');await sleep(380);check(await read()===created,'Ctrl+Y restores the edge in one step');
 await click(await edgePoint(id,8));check(await run(id=>document.querySelector(`path.canvas-edge[data-edge-id="${id}"]`).classList.contains('is-selected'),id),'An 8px offset from the path selects the edge through the forgiving hit area');
 const at=await edgePoint(id);await stationary(at);check(await read()===created,'Repeated stationary edge click changes no bytes');
 await double(at);check((await data()).nodes.length===fixture.nodes.length,'Double-clicking an edge never adds a background text card');
 await drag(await point(endpoint(id,'to')),await sidePoint('c','top'));
 const toChanged=await read();check((await data()).edges.find(e=>e?.id===id).toNode==='c'&&(await data()).edges.find(e=>e?.id===id).toSide==='top','Dragging the target end reconnects the same edge to another card');await save('target-reconnected');
 await chord('z');await sleep(380);check(await read()===created,'Target reconnection is one undo step');await press('Z',10);await sleep(380);check(await read()===toChanged,'Ctrl+Shift+Z redoes target reconnection');
 await click(await edgePoint(id));await drag(await point(endpoint(id,'from')),await sidePoint('b','bottom'));
 const fromChanged=await read();check((await data()).edges.find(e=>e?.id===id).fromNode==='b'&&(await data()).edges.find(e=>e?.id===id).fromSide==='bottom','Dragging the source end reconnects without reversing direction or creating an edge');await save('source-reconnected');
 const exposed=await point(endpoint(id,'from'));exposed.y+=18;await drag(exposed,await sidePoint('b','left'));
 const sideChanged=await read();check((await data()).edges.find(e=>e?.id===id).fromSide==='left','Dragging the exposed line end reconnects to another side of the same card');await save('side-reconnected');
 await drag(await point(endpoint(id,'from')),await sidePoint('b','left'));check(await read()===sideChanged,'Reconnecting to the same endpoint is a byte-preserving no-op');
 await chord('z');await sleep(380);check(await read()===fromChanged,'No-op reconnection adds no extra undo checkpoint');
 await click('[aria-label="Redo"]');await sleep(380);check(await read()===sideChanged,'Redo button restores the side change');
 const undoAt=await point('[aria-label="Undo"]');await click(undoAt);await sleep(380);await stationary(undoAt);await sleep(380);check(await read()===toChanged,'Stationary repeated Undo reverses exactly two reconnections');
 const redoAt=await point('[aria-label="Redo"]');await click(redoAt);await sleep(380);await stationary(redoAt);await sleep(380);check(await read()===sideChanged,'Stationary repeated Redo restores exactly two reconnections');
 await click(await edgePoint(id));await drag(await point(endpoint(id,'to')),{x:1100,y:680},async()=>check(await read()===sideChanged,'A dangling reconnect preview does not save'),true);
 check(await read()===sideChanged&&await run(()=>!document.querySelector('.is-connecting, .is-reconnecting')),'Escape cancels reconnection and removes preview state');
 await drag(await point(endpoint(id,'to')),{x:1100,y:680});check(await read()===sideChanged,'Dropping a reconnect on empty space keeps the original edge');
 await drag(await dot('a','top'),{x:1000,y:680});check(await read()===sideChanged,'Dropping a new connection on empty space cancels without rewriting the file');
 await drag(await dot('a','right'),await sidePoint('a','left'));check(await read()===sideChanged,'Dropping onto the source card rejects a self-connection like Obsidian');
 await click(await edgePoint(id));await drag(await point(endpoint(id,'to')),await sidePoint('b','top'));check(await read()===sideChanged,'Reconnecting onto the opposite endpoint card also rejects a self-connection');
 await click(await edgePoint('old'));await drag(await point(endpoint('old','to')),await sidePoint('b','top'));
 const old=(await data()).edges.find(e=>e?.id==='old');
 check(old.toNode==='b'&&old.toSide==='top'&&old.label==='Existing'&&old.color==='4'&&old.fromEnd==='arrow'&&old.toEnd==='none'&&old.future.keep,'Reconnection preserves the label, color, arrowheads and unknown edge fields');
 check(JSON.stringify(Object.keys(old))===JSON.stringify(Object.keys(fixture.edges[0])),'Reconnection preserves original edge key order');await save('metadata-reconnected');
 await click(await edgePoint(id));await press('Backspace');await sleep(380);
 check(!(await data()).edges.some(e=>e?.id===id)&&(await data()).nodes.length===fixture.nodes.length,'Backspace deletes only the selected edge and keeps every card');await save('deleted');
 await chord('z');await sleep(380);check((await data()).edges.some(e=>e?.id===id),'One undo restores a deleted edge');await chord('y');await sleep(380);check(!(await data()).edges.some(e=>e?.id===id),'Ctrl+Y redoes edge deletion');await chord('z');await sleep(380);
 await click(await edgePoint(id));const a=await point(card('a'));await move(a);await stationary(a,8);
 check(await run(id=>document.querySelector('[data-node-id="a"]').classList.contains('is-selected')&&document.querySelector(`path.canvas-edge[data-edge-id="${id}"]`).classList.contains('is-selected'),id),'Shift-click adds a card to an edge selection');
 const edgeAt=await edgePoint(id);await move(edgeAt);await stationary(edgeAt,8);check(await run(id=>!document.querySelector(`path.canvas-edge[data-edge-id="${id}"]`).classList.contains('is-selected')&&document.querySelector('[data-node-id="a"]').classList.contains('is-selected'),id),'Shift-click toggles an edge out of mixed selection');
 await stationary(edgeAt,8);await press('Delete');await sleep(380);
 check(!(await data()).nodes.some(n=>n.id==='a')&&!(await data()).edges.some(e=>e?.id===id||e?.id==='old')&&(await data()).edges.some(e=>e?.id==='opaque-edge'),'Delete removes mixed selection and incident edges, preserving unrelated unknown edges');await save('mixed-deleted');
 await chord('z');await sleep(380);const beforeLock=await read();
 await click('[aria-label="Canvas settings"]');await click('.menu-item:nth-child(3)');await click(await edgePoint(id));await press('Delete');await sleep(380);
 check(await read()===beforeLock&&await run(()=>getComputedStyle(document.querySelector('.canvas-edge-end.is-selected')).display==='none'),'Read-only canvas allows edge selection but blocks deletion and reconnect handles');
 await click('[aria-label="Canvas settings"]');await click('.menu-item:nth-child(3)');
 await click(await point(card('a')));const removeAt=await point('[aria-label="Remove"]');await double(removeAt);await sleep(380);
 check(!(await data()).nodes.some(n=>n.id==='a')&&!(await data()).nodes.some(n=>n.type==='text'&&n.text===''),'Double-clicking Remove after mixed edge work never adds a card');
 await open('CollidingIds.canvas',{nodes:fixture.nodes.slice(0,3),edges:[{id:'a',fromNode:'b',fromSide:'left',toNode:'c',toSide:'right'}]});
 await click(card('a'));await press('Delete');await sleep(380);check((await data()).edges.length===1&&!(await data()).nodes.some(n=>n.id==='a'),'Deleting a card preserves an unrelated edge with the same ID');await chord('z');await sleep(380);
 await click(await edgePoint('a'));await press('Delete');await sleep(380);check((await data()).nodes.length===3&&(await data()).edges.length===0,'Deleting an edge preserves a card with the same ID');await chord('z');await sleep(380);
 await click(card('a'));const collisionAt=await edgePoint('a');await move(collisionAt);await stationary(collisionAt,8);await press('Delete');await sleep(380);check((await data()).nodes.length===2&&(await data()).edges.length===0,'Mixed selection independently deletes both items when their IDs match');
 // Zoomed coordinates and center snapping on a small canvas.
 await open('Zoom.canvas',{nodes:[{id:'z1',type:'text',x:0,y:0,width:100,height:100,text:'Z1'},{id:'z2',type:'text',x:260,y:0,width:100,height:100,text:'Z2'}],edges:[]});
 await click('[aria-label="Zoom in"]');await click('[aria-label="Zoom in"]');await sleep(80);
 const zDot=await dot('z1','right');await move(zDot);check(await run(()=>Math.abs(document.querySelector('[data-node-id="z1"] [data-side="right"]').getBoundingClientRect().width-20)<.1),'Connection targets stay 20 screen pixels at 2× zoom');
 await drag(zDot,await point(card('z2')));check((await data()).edges[0]?.toSide==='top','Zoomed connection uses world coordinates and the observed center tie chooses top');
 const large=await readFile(new URL('../../round23-shots/Large.canvas',import.meta.url),'utf8');await open('LargeArrows.canvas',large);await click('[aria-label="Reset zoom"]');await sleep(200);
 const pair=await run(()=>{const cards=[...document.querySelectorAll('.canvas-node')].map(e=>({id:e.dataset.nodeId,r:e.getBoundingClientRect()})).filter(({r})=>r.left>320&&r.right<1190&&r.top>170&&r.bottom<650);const a=cards.find(a=>cards.some(b=>b!==a&&Math.abs(a.r.y-b.r.y)<1));return[a.id,cards.find(b=>b!==a&&Math.abs(a.r.y-b.r.y)<1).id];});
 const p=await dot(pair[0],'right'),q=await sidePoint(pair[1],'left');await move(p);
 await run(()=>{window.edgeFrames=[];window.edgeSampling=true;let last=performance.now();function tick(t){if(!edgeSampling)return;edgeFrames.push(t-last);last=t;requestAnimationFrame(tick);}requestAnimationFrame(tick);});
 await drag(p,q);const frames=await run(()=>{edgeSampling=false;return edgeFrames.slice(2);});check(frames.length>15&&Math.max(...frames)<20,`300-card/400-edge create drag and commit stay under 20ms (max ${Math.max(...frames).toFixed(1)}ms)`);
 check((await data()).edges.length===401&&await run(()=>document.querySelectorAll('.canvas-node').length===300),'Large-board edge creation changes one edge and keeps every card');
 const largeEdge=(await data()).edges.at(-1).id;await click(await edgePoint(largeEdge));
 await run(()=>{window.beforeEdgeCards=[...document.querySelectorAll('.canvas-node')];window.edgeFrames=[];window.edgeSampling=true;let last=performance.now();function tick(t){if(!edgeSampling)return;edgeFrames.push(t-last);last=t;requestAnimationFrame(tick);}requestAnimationFrame(tick);});
 await drag(await point(endpoint(largeEdge,'to')),await sidePoint(pair[1],'top'));const reconnectFrames=await run(()=>{edgeSampling=false;return edgeFrames.slice(2);});
 check(reconnectFrames.length>15&&Math.max(...reconnectFrames)<20,`300-card/401-edge reconnect drag and commit stay under 20ms (max ${Math.max(...reconnectFrames).toFixed(1)}ms)`);
 check((await data()).edges.at(-1).toSide==='top'&&await run(()=>beforeEdgeCards.every(e=>e.isConnected)),'Reconnection updates only the edge and retains every existing card DOM node');
 const reverse=await readFile(new URL('../../round26-shots/Obsidian-arrows.canvas',import.meta.url),'utf8');await open('ReverseArrows.canvas',reverse);
 check(await run(async expected=>{const {readCanvas,edgeCurve}=await import('/src/canvas/model.ts');const {nodes,edges}=readCanvas(expected),byId=new Map(nodes.map(n=>[n.id,n]));return edges.every(e=>document.querySelector(`path.canvas-edge[data-edge-id="${e.id}"]`)?.getAttribute('d')===edgeCurve(byId.get(e.fromNode),byId.get(e.toNode),e).path)&&nodes.every(n=>{const card=document.querySelector(`[data-node-id="${n.id}"]`);return card&&parseFloat(card.style.left)===n.x&&parseFloat(card.style.top)===n.y;});},reverse),'Native Obsidian reconnection returns to Grove with identical card and edge geometry');
 check(await read()===reverse,'Reverse round trip preserves exact native file bytes');await shot('grove-edges-return');
}, {height:800,screenshots:new URL('../../round26-shots/',import.meta.url).pathname});
