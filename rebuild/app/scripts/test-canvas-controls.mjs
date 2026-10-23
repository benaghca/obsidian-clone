// Round 25 controls: native hover, stationary clicks, palettes, history and saves.
import { readFile, writeFile } from 'node:fs/promises';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({run,send,open,read,click,point,move,press,chord,check,shot}) => {
 const fixture={future:{keep:[1,2]},nodes:[{id:'a',type:'text',x:0,y:0,width:280,height:170,text:'Card A',extra:{keep:true}},{id:'b',type:'text',x:430,y:60,width:220,height:120,text:'Card B'}],edges:[{id:'e',fromNode:'a',toNode:'b',extra:42}]};
 const button=label=>`[aria-label^="${label.split("\n")[0]}"]`;
 const data=async()=>JSON.parse(await read());
 const stationary=async p=>{for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(70);};
 const color=async label=>{await click(button('Set color'));await click(`.canvas-color-menu ${button(label)}`);await sleep(350);};
 await open('Controls.canvas',fixture);const original=await read();
 check(await run(()=>document.querySelectorAll('.canvas-control-group').length===4),'Control stack has settings, zoom, history and help groups');
 check(await run(()=>['Undo','Redo'].every(label=>document.querySelector(`[aria-label="${label}"]`).getAttribute('aria-disabled')==='true')),'Both history controls start disabled');
 const monitor=selector=>run(selector=>{
   document.addEventListener('pointerdown',()=>{
     let last=performance.now(),frames=0;window.controlTiming={visibleFrame:0,maxFrame:0};
     const tick=now=>{const result=window.controlTiming;frames++;result.maxFrame=Math.max(result.maxFrame,now-last);last=now;
       const el=document.querySelector(selector);if(!result.visibleFrame&&el&&el.getBoundingClientRect().width&&getComputedStyle(el).display!=='none')result.visibleFrame=frames;
       if(frames<19)requestAnimationFrame(tick);
     };requestAnimationFrame(tick);
   },{once:true,capture:true});
 },selector);
 await monitor('.canvas-selection-menu:not([hidden])');await click('[data-node-id="a"]');await sleep(340);
 const timing=await run(()=>window.controlTiming);
 check(timing.visibleFrame>0&&timing.visibleFrame<=2&&timing.maxFrame<=20,'Selection toolbar appears within two frames with no frame over 20ms');
 await monitor('.canvas-color-menu');await click(button('Set color'));await sleep(340);
 const paletteTiming=await run(()=>window.controlTiming);
 check(paletteTiming.visibleFrame>0&&paletteTiming.visibleFrame<=2&&paletteTiming.maxFrame<=20,'Palette appears within two frames with no frame over 20ms');await press('Escape');
 check(await run(()=>[...document.querySelectorAll('.canvas-selection-menu .clickable-icon')].map(e=>e.getAttribute('aria-label')).join('|')==='Remove|Set color|Zoom to selection\n(Shift + 2)|Edit'),'Selection toolbar follows observed action order');
 for(const label of ['Remove','Set color','Zoom to selection\n(Shift + 2)','Edit','Canvas settings','Undo','Redo','Canvas help']){
   await move({x:950,y:700});await move(await point(button(label)));await sleep(560);
   check(await run(label=>document.querySelector('.tooltip')?.textContent===label&&!document.querySelector('.tooltip').getAnimations().length,label),label+': native hover uses instant shared tooltip');
 }
 await shot('grove-controls');
 await color('Red');check((await data()).nodes[0].color==='1','Preset red writes Obsidian color 1');
 check(await run(()=>document.querySelector('[data-node-id="a"]').classList.contains('is-colored')),'Preset color updates rendered card immediately');
 await click(button('Set color'));const at=await point(button('Set color'));await press('Escape');await stationary(at);
 check(await run(()=>!!document.querySelector('.canvas-color-menu')),'Stationary Set color click reopens the shared palette');
 await press('Escape');await color('Purple');check((await data()).nodes[0].color==='6','Preset purple writes Obsidian color 6');
 await click(button('Set color'));await click('.canvas-color-menu [aria-label="Custom color"]');await send('Input.insertText',{text:'#123abc'});await press('Enter');await sleep(350);
 check((await data()).nodes[0].color==='#123abc','Custom hex color is preserved exactly in canvas JSON');
 await color('Default');check(!('color' in (await data()).nodes[0]),'Default removes the color field');
 await color('Green');const saved=await read();
 await writeFile(new URL('../../round25-shots/Grove-controls.canvas',import.meta.url),saved);
 check((await data()).nodes[0].extra.keep&&(await data()).future.keep.join(',')==='1,2'&&(await data()).edges[0].extra===42,'Toolbar save preserves unknown node, root and edge data');
 await click(button('Undo'));await sleep(350);check(!('color' in (await data()).nodes[0]),'Undo button restores preceding canvas document');
 const undoAt=await point(button('Undo'));await stationary(undoAt);await sleep(350);check((await data()).nodes[0].color==='#123abc','Repeated stationary Undo applies the next checkpoint');
 await click(button('Redo'));await sleep(350);check(!('color' in (await data()).nodes[0]),'Redo button restores color removal');
 await stationary(await point(button('Redo')));await sleep(350);check(await read()===saved,'Repeated stationary Redo restores the saved toolbar edit');
 await click('[data-node-id="a"]');const transform=await run(()=>document.querySelector('.canvas-world').style.transform);
 await click(button('Zoom to selection\n(Shift + 2)'));await sleep(70);
 check(await run(before=>document.querySelector('.canvas-world').style.transform!==before,transform),'Zoom to selection fits the selected card');
 await click(button('Zoom to selection\n(Shift + 2)'));await stationary(await point(button('Zoom to selection\n(Shift + 2)')));check(await read()===saved,'Repeated zoom-to-selection clicks do not write canvas bytes');
 await click(button('Reset zoom'));await click('[data-node-id="a"]');await click(button('Edit'));
 check(await run(()=>!!document.querySelector('.canvas-node.is-editing .cm-editor')),'Edit opens the existing text-card editor');await press('Escape');await stationary(await point(button('Edit')));check(await run(()=>!!document.querySelector('.canvas-node.is-editing')),'Stationary Edit click reopens the text editor');await press('Escape');
 await click(button('Canvas settings'));check(await run(()=>[...document.querySelectorAll('.menu-item-title')].map(e=>e.textContent).join('|')==='Snap to grid|Snap to objects|Read-only'),'Settings menu matches observed rows');await press('Escape');
 const settingsAt=await point(button('Canvas settings'));await stationary(settingsAt);check(await run(()=>!!document.querySelector('.menu')),'Stationary settings click reopens menu');
 await click('.menu-item:nth-child(1)');check(await run(async()=>{const{settings}=await import('/src/settings/store.ts');return !settings.get('canvas.json').snapToGrid;}),'Snap to grid setting is wired');
 await click(button('Canvas settings'));await click('.menu-item:nth-child(2)');
 const p=await point('[data-node-id="a"]');await move(p);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});
 for(let i=1;i<=8;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+13*i/8,y:p.y+17*i/8,buttons:1});await sleep(18);}await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+13,y:p.y+17,button:'left',clickCount:1});await sleep(350);
 check((await data()).nodes[0].x===13&&(await data()).nodes[0].y===17,'Disabling both snap settings allows exact native drag coordinates');
 await click(button('Canvas settings'));await click('.menu-item:nth-child(3)');const locked=await read();await click('[data-node-id="a"]');await press('Delete');await sleep(350);
 check(await read()===locked&&await run(()=>document.querySelector('.canvas-view').classList.contains('is-readonly')),'Read-only prevents deletion and hides edit controls');
 await click(button('Canvas settings'));await click('.menu-item:nth-child(3)');
 await click(button('Canvas help'));check(await run(()=>document.querySelector('.canvas-help')?.textContent.includes('Shift + 2')),'Canvas help opens a local shortcut dialog');await press('Escape');await stationary(await point(button('Canvas help')));check(await run(()=>!!document.querySelector('.canvas-help')),'Stationary help click reopens the dialog');await press('Escape');
 await click('[data-node-id="b"]');const removeAt=await point(button('Remove'));await click(removeAt);await sleep(350);await stationary(removeAt);check((await data()).nodes.length===1&&(await data()).edges.length===0,'Remove deletes the selected card and its incident edge');
 await open('History.canvas','{}');await click('.canvas-card-menu [aria-label="Drag to add card"]');await press('Escape');await sleep(350);await chord('z');await sleep(350);
 check(await read()==='{}'&&await run(()=>document.querySelector('[aria-label="Undo"]').getAttribute('aria-disabled')==='true'),'Keyboard undo updates disabled history buttons');
 check(original!==saved,'Round-trip fixture contains a real toolbar edit');
 const reverse=await readFile(new URL('../../round25-shots/Obsidian-controls.canvas',import.meta.url),'utf8');await open('Reverse.canvas',reverse);
 check(await run(expected=>expected.nodes.every(n=>{const card=document.querySelector(`[data-node-id="${n.id}"]`);return card&&card.style.getPropertyValue('--canvas-color').includes('purple')=== (n.color==='6')&&['x','y','width','height'].every(k=>parseFloat(card.style[{x:'left',y:'top',width:'width',height:'height'}[k]])===n[k]);}),JSON.parse(reverse)),'Native Obsidian color edit returns with identical geometry and color');
 check(await read()===reverse,'Reverse toolbar round trip preserves exact Obsidian file bytes');await shot('grove-controls-roundtrip');

}, {height:800,screenshots:new URL('../../round25-shots/',import.meta.url).pathname});
