// Reproduce Part A's visual comparison using only scratch mock data and headless CDP.
import { withBrowser, sleep } from '../app/scripts/browser.mjs';
import { fileURLToPath } from 'node:url';
const stage = process.argv[2];
if (!['before', 'after'].includes(stage)) throw Error('Choose before or after');
await withBrowser(async ({ run, shot, click, chord, press, move, send }) => {
  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Cleanup.canvas', JSON.stringify({nodes:[
      {id:'g',type:'group',x:-30,y:-30,width:350,height:250,label:'Group',color:'4'},
      {id:'a',type:'text',x:0,y:0,width:280,height:170,text:'# Selected card\n\n**Markdown** and [[Welcome]]'},
      {id:'b',type:'text',x:420,y:70,width:240,height:130,text:'Second card'},
    ],edges:[{id:'e',fromNode:'a',toNode:'b',label:'Edge'}]}));
    await ws.vault.refreshFiles();
    const style = document.createElement('style');
    style.textContent = '.cm-cursor,.cm-cursorLayer { visibility:hidden !important; }';
    document.head.append(style);
  });
  const capture = async name => { await sleep(650); await shot(name); };
  for (const theme of ['light', 'dark']) {
    await run(theme => { document.documentElement.classList.remove('theme-light','theme-dark'); document.documentElement.classList.add('theme-'+theme); }, theme);
    await run(async () => { await ws.open('Welcome.md'); ws.setMode('live'); ws.view.dispatch({selection:{anchor:ws.view.state.doc.length}}); });
    await move({x:1100,y:750}); await capture(theme+'-welcome-explorer');
    for (const mode of ['live','source','reading']) {
      await run(async mode => { await ws.open('Callouts, tables and embeds.md'); ws.setMode(mode); ws.view.dispatch({selection:{anchor:ws.view.state.doc.length}}); }, mode);
      await capture(theme+'-blocks-'+mode);
    }
    await run(() => ws.open('Cleanup.canvas')); await sleep(150);
    await click('[data-node-id="a"]'); await move({x:1100,y:750}); await capture(theme+'-canvas');
    await run(() => ws.open('Welcome.md')); await sleep(150);
    await chord('o'); await capture(theme+'-switcher'); await press('Escape');
    await chord(','); await capture(theme+'-settings'); await press('Escape');
    await move({x:1100,y:750});
    await move(await run(() => { const r=document.querySelector('.view-actions .clickable-icon').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; }));
    await capture(theme+'-tooltip');
    if (!await run(() => !!document.querySelector('.tooltip'))) throw Error('Missing tooltip');
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1100,y:750});
  }
}, {height:800,screenshots:fileURLToPath(new URL(stage+'/',import.meta.url))});
