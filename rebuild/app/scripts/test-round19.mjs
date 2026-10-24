// Headless UI regressions with native input and the in-memory mock vault.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async ({ send, evaluate, run, key, press, chord, point, click: nativeClick, fill: nativeFill, check, shot }) => {
  const click = async selector => { await nativeClick(selector); await sleep(50); };
  const fill = async (selector, text) => { await nativeFill(selector, text); await sleep(100); };
  await run(async () => {
    const {api} = await import('/src/api.ts');
    await api.createNote('Hover19.md', 'Links to [[Short19]], [[Long19]] and [[Long19#Deep|a heading]].');
    await api.createNote('Short19.md', 'First line.\nSecond line.\nThird line.');
    await api.createNote('Long19.md', '# Top\n\n' + 'Filler.\n\n'.repeat(40) + '## Deep\n\nTarget.\n\n' + 'Tail.\n\n'.repeat(40));
    await ws.vault.refreshFiles(); await ws.open('Hover19.md');
    ws.view.dispatch({selection:{anchor:0}}); ws.view.contentDOM.blur();
  }); await sleep(200);
  const hover = async selector => {
    await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:20,y:700});
    await key('Control',2);
    const p=await point(selector);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p,modifiers:2}); await sleep(500);
    await key('Control',0,'keyUp');
  };
  await hover('[data-href=Short19]');
  check(await evaluate('document.querySelector(".hover-popover .markdown-embed-title").textContent === "Short19"'), 'preview starts with the note title');
  check(await evaluate('(()=>{const p=document.querySelector(".hover-popover"),t=p.querySelector(".markdown-embed-title");return p.offsetHeight < 250 && parseFloat(getComputedStyle(t).fontSize)>24})()'), 'short preview shrinks beneath 250px with a large heading');
  check(await evaluate('document.querySelector(".hover-popover .markdown-embed-link svg") !== null'), 'preview retains the existing Open link icon');
  await shot('hover-short');
  await click('.hover-popover .markdown-embed-link');
  check(await evaluate('ws.active.path === "Short19.md" && !document.querySelector(".hover-popover")'), 'native Open link click opens the previewed note and dismisses preview');
  await run(async()=>{await ws.open('Hover19.md'); ws.view.contentDOM.blur();}); await sleep(150);
  await hover('[data-href=Long19]');
  check(await evaluate('(()=>{const p=document.querySelector(".hover-popover");return p.offsetHeight===400 && p.querySelector(".markdown-embed-content").scrollHeight>p.querySelector(".markdown-embed-content").clientHeight})()'), 'long preview is capped at 400px and scrolls');
  await shot('hover-long'); await press('Escape');
  await hover('[data-href="Long19#Deep"]');
  check(await evaluate('(()=>{const p=document.querySelector(".hover-popover"),t=p.querySelector(".cm-h2");const y=t.getBoundingClientRect().top-p.querySelector(".markdown-embed-content").getBoundingClientRect().top;return p.querySelector(".markdown-embed-title").textContent==="Long19" && y>=8 && y<=24})()'), 'heading preview keeps its file title and existing target alignment');
  await press('Escape');
  await send('Emulation.setDeviceMetricsOverride',{width:800,height:520,deviceScaleFactor:1,mobile:false});
  await run(async()=>{await ws.open('Hover19.md');ws.view.contentDOM.blur();});await sleep(150);
  await hover('[data-href=Long19]');
  check(await evaluate('(()=>{const r=document.querySelector(".hover-popover").getBoundingClientRect();return r.left>=8 && r.top>=8 && r.right<=innerWidth-8 && r.bottom<=innerHeight-8})()'), 'asynchronously loaded long preview remains within a constrained viewport');
  await press('Escape');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});

  // Rename failures keep the draft, show an error beneath it, and can be corrected or canceled.
  await run(async()=>{const {api}=await import('/src/api.ts');await api.createNote('Rename19.md','A note.');await api.createNote('Taken19.md','Taken.');await ws.vault.refreshFiles();await ws.open('Rename19.md');});
  await fill('.inline-title','Bad/name');await press('Enter');await sleep(100);
  check(await evaluate('document.querySelector(".inline-title").textContent === "Bad/name" && document.querySelector(".inline-title + .rename-error").textContent.includes("cannot contain") && ws.active.path === "Rename19.md"'), 'invalid inline title retains the exact draft and reports the error');
  check(await evaluate('(()=>{const f=document.querySelector(".inline-title"),e=f.nextElementSibling;return f.getAttribute("aria-invalid")==="true" && e.getBoundingClientRect().top>=f.getBoundingClientRect().bottom})()'), 'inline title error is beneath the field');
  await shot('rename-title-invalid');
  await fill('.inline-title','taken19');await press('Enter');await sleep(100);
  check(await evaluate('document.querySelector(".inline-title + .rename-error").textContent.includes("same name") && ws.active.path === "Rename19.md"'), 'inline title reports a case-insensitive name clash');
  await fill('.inline-title','Corrected19');await press('Enter');await sleep(200);
  check(await evaluate('ws.active.path === "Corrected19.md" && !document.querySelector(".inline-title + .rename-error")'), 'correcting inline title commits and clears its error');
  await fill('.inline-title','');await press('Enter');await sleep(100);
  check(await evaluate('!!document.querySelector(".inline-title + .rename-error") && ws.active.path === "Corrected19.md"'), 'empty inline title reports an error');
  await press('Escape');
  check(await evaluate('document.querySelector(".inline-title").textContent === "Corrected19" && !document.querySelector(".inline-title + .rename-error")'), 'Escape restores the title and clears its error');
  const row='[data-path="Corrected19.md"]';
  const rp=await point(row);await send('Input.dispatchMouseEvent',{type:'mouseMoved',...rp});await sleep(50);
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...rp,button:'right',clickCount:1});await sleep(100);
  const menu=await run(()=>{const el=[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.includes('Rename'));const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...menu});await sleep(50);
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...menu,button:'left',clickCount:1});await sleep(100);
  const field=row+' .tree-item-inner';
  await fill(field,'Taken19');await press('Enter');await sleep(100);
  check(await evaluate('(()=>{const f=document.querySelector(`[data-path="Corrected19.md"] .tree-item-inner`);return f.isContentEditable && f.textContent==="Taken19" && f.nextElementSibling.textContent.includes("same name")})()'), 'explorer clash keeps the draft editable with an error');
  await fill(field,'Bad:name');await click('.view-header');await sleep(100);
  check(await evaluate('(()=>{const f=document.querySelector(`[data-path="Corrected19.md"] .tree-item-inner`),e=f.nextElementSibling;return f.textContent==="Bad:name" && e.className==="rename-error" && e.getBoundingClientRect().top>=f.getBoundingClientRect().bottom})()'), 'invalid explorer rename reports below the field on blur without dropping characters');
  await shot('rename-explorer-invalid');
  await fill(field,'Explorer19');await press('Enter');await sleep(200);
  check(await evaluate('ws.active.path === "Explorer19.md" && !document.querySelector(".rename-error")'), 'correcting explorer rename commits and clears its error');

  await run(async()=>{const {api}=await import('/src/api.ts');await api.createNote('Lists19.md','1. first\n2. second\n3. third');await ws.vault.refreshFiles();await ws.open('Lists19.md');});await sleep(150);
  await click('.cm-content > .cm-line:nth-child(2)');await press('Tab');await sleep(100);
  check(await run(() => ws.view.state.doc.toString() === "1. first\n\t1. second\n2. third"), 'native Tab renumbers the parent and new ordered sublist');
  await shot('list-indent');await chord('z');
  check(await run(() => ws.view.state.doc.toString() === "1. first\n2. second\n3. third"), 'one Undo restores both indentation and numbering');
  await press('Tab');await key('Shift',8);await press('Tab',8);await key('Shift',0,'keyUp');await sleep(100);
  check(await run(() => ws.view.state.doc.toString() === "1. first\n2. second\n3. third"), 'native Shift+Tab restores parent numbering');
  await run(()=>ws.setMode('source'));await click('.cm-content > .cm-line:nth-child(2)');await press('Tab');
  check(await run(() => ws.view.state.doc.toString() === "1. first\n\t1. second\n2. third"), 'ordered-list renumbering works in Source mode too');
  await run(()=>ws.setMode('live'));

  const backspaceCases=[
    ['- first\n    - nested\n- last','- first\n    nested\n- last','- first\nnested\n- last'],
    ['1. first\n    1. nested\n2. last','1. first\n    nested\n2. last','1. first\nnested\n2. last'],
    ['- first\n    - [x] task','- first\n    task','- first\ntask'],
    ['first\n1. second','first\nsecond','firstsecond'],
  ];
  for(const [doc,once,twice] of backspaceCases) {
    await run(doc=>{ws.view.dispatch({changes:{from:0,to:ws.view.state.doc.length,insert:doc},selection:{anchor:0}});ws.view.focus();},doc);await sleep(100);
    await click('.cm-content > .cm-line:nth-child(2)');await press('End');await press('Home');await press('Backspace');await sleep(50);
    check(await evaluate('ws.view.state.doc.toString()')===once,'first native Backspace removes only the marker: '+JSON.stringify(doc.split('\n')[1]));
    if(doc.startsWith('1.'))await shot('backspace-marker');
    await press('Backspace');await sleep(50);
    check(await evaluate('ws.view.state.doc.toString()')===twice,'second native Backspace outdents or joins: '+JSON.stringify(doc.split('\n')[1]));
  }
  await run(()=>{ws.view.dispatch({changes:{from:0,to:ws.view.state.doc.length,insert:'```\n- code\n```'},selection:{anchor:0}});ws.view.focus();});await sleep(100);
  await click('.cm-content > .cm-line:nth-child(2)');await press('End');for(let i=0;i<4;i++)await press('ArrowLeft');await press('Backspace');
  check(await evaluate('ws.view.state.doc.toString()')==='```\n-code\n```','list-looking fenced code keeps normal character deletion');
}, { height: 800, screenshots: 'node_modules/.round19-partb' });
