import { withBrowser, sleep } from '../app/scripts/browser.mjs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
await withBrowser(async({run,send,open,point,move,press})=>{
 const large=await readFile(new URL('../round23-shots/Large.canvas',import.meta.url),'utf8');
 await open('A DropNote.md','Body');await open('Large.canvas',large,500);
 const reset=await point('[aria-label="Reset zoom"]');await move(reset);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...reset,button:'left',clickCount:1});await sleep(500);
 const root=new URL('../app/node_modules/',import.meta.url),dir=(await readdir(root)).find(n=>n.startsWith('.browser-')),port=(await readFile(new URL(dir+'/DevToolsActivePort',root),'utf8')).split('\n')[0];
 const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json(),socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
 let seq=0,pending=new Map(),events=[],complete;const done=new Promise(r=>complete=r);
 socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){pending.get(m.id)(m.result);pending.delete(m.id);}else if(m.method==='Tracing.dataCollected')events.push(...m.params.value);else if(m.method==='Tracing.tracingComplete')complete();};
 const trace=(method,params={})=>new Promise(resolve=>{pending.set(++seq,resolve);socket.send(JSON.stringify({id:seq,method,params}));});
 await trace('Tracing.start',{categories:'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline',transferMode:'ReportEvents'});
 await run(()=>{window.dropFrames=[];window.dropRecording=true;let last=performance.now();function tick(t){if(!dropRecording)return;dropFrames.push(t-last);last=t;requestAnimationFrame(tick);}requestAnimationFrame(tick);});
 const a=await point('.nav-files .tree-item-self[data-path="A DropNote.md"]'),b={x:650,y:350};await move(a);await send('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',clickCount:1});
 for(let i=1;i<=12;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/12,y:a.y+(b.y-a.y)*i/12,button:'left',buttons:1});await sleep(17);}
 for(let i=0;i<24;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:650+i*8,y:350+i%2*10,button:'left',buttons:1});await sleep(18);}
 await press('Escape');await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:834,y:360,button:'left',clickCount:1});await sleep(400);
 const frames=await run(()=>{dropRecording=false;return dropFrames.slice(2);});console.log('FRAMES',frames);
 await trace('Tracing.end');await done;socket.close();
 await writeFile(new URL('drag-trace.json',import.meta.url),JSON.stringify(events));
 console.log('LONG',events.filter(e=>e.ph==='X'&&e.dur>4000).sort((a,b)=>b.dur-a.dur).slice(0,35).map(e=>({name:e.name,ms:e.dur/1000,args:e.args})));
});
