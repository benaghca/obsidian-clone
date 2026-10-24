import { withBrowser, sleep } from '../app/scripts/browser.mjs';
await withBrowser(async({run,send,open,click,check})=>{
 const measure=async label=>{
  await run(()=>{window.inputListen?.abort();window.inputListen=new AbortController();window.inputFrames=[];document.addEventListener('beforeinput',()=>{const start=performance.now();requestAnimationFrame(()=>inputFrames.push(performance.now()-start));},{capture:true,signal:inputListen.signal});});
  for(const text of 'abcdefghijklmnopqrstuvwxyz'){await send('Input.insertText',{text});await sleep(35);}
  const frames=await run(()=>inputFrames);
  check(frames.length===26&&Math.max(...frames)<20,label+': 26 native text insertions reach the next animation frame within 20ms each');
  console.log('MEASURE',label,JSON.stringify({frameMax:Math.max(...frames),frameMean:frames.reduce((a,b)=>a+b)/26}));
 };
 await run(async()=>{await ws.open('Big note.md');ws.setMode('live');ws.view.dispatch({selection:{anchor:ws.view.state.doc.line(2500).from+5},scrollIntoView:true});ws.view.focus();});await sleep(250);
 const p=await run(()=>{const r=ws.view.coordsAtPos(ws.view.state.selection.main.head);return{x:r.left,y:(r.top+r.bottom)/2};});await click(p);await measure('5,000-line Big note');
 check(await run(()=>ws.view.state.doc.lines===5000&&ws.view.state.doc.toString().includes('abcdefghijklmnopqrstuvwxyz')),'Big note retains all 5,000 lines and typed characters');
 const table='| Name | Value |\n| --- | --- |\n'+Array.from({length:40},(_,i)=>`| Row ${i} | Cell ${i} |`).join('\n');
 await open('Typing table.md',table);await click('.cm-table-widget tbody tr:nth-child(15) td:nth-child(2)');await sleep(120);
 check(await run(()=>!!document.activeElement.closest('.cm-table-cell')),'Real pointer enters the 40-row table cell editor');await measure('40-row table');
 check(await run(()=>document.querySelectorAll('.cm-table-widget tbody tr').length===40&&ws.view.state.doc.toString().includes('abcdefghijklmnopqrstuvwxyz')),'Table retains all 40 rows and typed characters');
});
