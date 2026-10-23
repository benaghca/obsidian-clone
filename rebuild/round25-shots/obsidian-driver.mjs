// Obsidian observation uses public workspace/vault APIs and rendered UI only.
// Run inside: unshare -Urn sh -c 'ip link set lo up; exec node ...'
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function withObsidian(test) {
  const root = await mkdtemp(new URL('../app/node_modules/.r25-obs-', import.meta.url).pathname);
  const home=join(root,'home'), config=join(home,'.config'), vault=join(root,'Vault');
  await mkdir(join(config,'obsidian'),{recursive:true}); await mkdir(join(vault,'.obsidian'),{recursive:true});
  await mkdir(join(root,'profile'),{recursive:true});
  for (const dir of [join(config,'obsidian'),join(root,'profile')]) await writeFile(join(dir,'obsidian.json'),JSON.stringify({vaults:{r25:{path:vault,ts:Date.now(),open:true}}}));
  await writeFile(join(vault,'.obsidian/app.json'),JSON.stringify({livePreview:true,showInlineTitle:true}));
  await writeFile(join(vault,'.obsidian/appearance.json'),JSON.stringify({theme:'moonstone'}));
  const proc=spawn('electron43',['/usr/lib/obsidian/app.asar','--no-sandbox','--ozone-platform=headless','--headless','--disable-gpu','--disable-extensions','--disable-background-networking','--disable-component-update','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${join(root,'profile')}`],{env:{...process.env,HOME:home,XDG_CONFIG_HOME:config,XDG_DATA_HOME:join(home,'.local/share'),XDG_CACHE_HOME:join(home,'.cache'),DISPLAY:'',WAYLAND_DISPLAY:''},stdio:['ignore','ignore','pipe']});
  let stderr='',socket;proc.stderr.on('data',d=>stderr+=d);
  try {
    let port; for(let i=0;i<160;i++){const m=/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(stderr);if(m){port=m[1];break;}await sleep(100);}
    assert.ok(port,stderr.slice(-2500));
    let page;for(let i=0;i<160;i++){const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();page=pages.find(p=>p.type==='page'&&p.url.includes('app://'));if(page)break;await sleep(100);}
    assert.ok(page,'Obsidian page opened');socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
    let seq=0;const pending=new Map();socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const [resolve,reject]=pending.get(m.id);pending.delete(m.id);m.error?reject(m.error):resolve(m.result);}};
    const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++seq,[resolve,reject]);socket.send(JSON.stringify({id:seq,method,params}));});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
    const run=(fn,...args)=>evaluate(`(${fn})(...${JSON.stringify(args)})`);
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    for(let i=0;i<160&&!await run(()=>!!window.app?.workspace?.layoutReady);i++)await sleep(100);
    if (!await run(()=>!!window.app?.workspace?.layoutReady)) console.log('BOOT',await run(()=>({url:location.href,text:document.body.innerText,app:!!window.app})));
    assert.ok(await run(()=>!!window.app?.workspace?.layoutReady),'scratch workspace ready');
    assert.equal(await run(()=>app.vault.getName()),'Vault');
    const point=selector=>run(s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},selector);
    const move=async p=>{await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await sleep(40);};
    const click=async target=>{const p=typeof target==='string'?await point(target):target;await move(p);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(100);};
    const press=async(key,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,modifiers,windowsVirtualKeyCode:{Escape:27,Enter:13,ArrowDown:40,Backspace:8}[key]??(key.length===1?key.toUpperCase().charCodeAt(0):0)});};
    const shot=async name=>writeFile(new URL(name+'.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await test({run,send,point,move,click,press,shot,vault});
  } finally {socket?.close();proc.kill();await new Promise(r=>proc.once('exit',r));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
