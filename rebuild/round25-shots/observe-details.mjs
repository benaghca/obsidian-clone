import { withObsidian, sleep } from './obsidian-driver.mjs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
await withObsidian(async({run,click,press,shot,send,vault})=>{
 await run(async()=>{
  await app.vault.create('Board.canvas',JSON.stringify({nodes:[{id:'a',type:'text',x:0,y:0,width:280,height:170,text:'A'},{id:'b',type:'text',x:430,y:60,width:220,height:120,text:'B'}],edges:[]}));
  await app.vault.create('Target.md','---\ntags: [test]\n---\n# Top **bold**\n\nParagraph spans\ntwo lines.\n\nExisting. ^known\n\n- Item one\n- Item two\n\n> Quote one\n> Quote two\n\n```js\nconst x = 1\n```\n\nFinal.');
  await app.vault.create('Source.md','Start\n\n');await app.workspace.openLinkText('Board.canvas','',false);
 });await sleep(900);await click('.canvas-node');
 console.log('MENU_METRICS',JSON.stringify(await run(()=>{const el=document.querySelector('.canvas-menu');const s=getComputedStyle(el);return{rect:el.getBoundingClientRect().toJSON(),padding:s.padding,gap:s.gap,border:s.border,radius:s.borderRadius,transform:s.transform,shadow:s.boxShadow};})));
 await click('[aria-label="Set color"]');
 console.log('COLORS',JSON.stringify(await run(()=>[...document.querySelectorAll('.canvas-color-picker *')].map(e=>({tag:e.tagName,cls:e.className,label:e.getAttribute('aria-label'),title:e.getAttribute('title'),type:e.getAttribute('type'),background:getComputedStyle(e).backgroundColor,rect:e.getBoundingClientRect().toJSON()})))));
 // Click red through the visible circle's measured point.
 const red=await run(()=>{const els=[...document.querySelectorAll('.canvas-color-picker *')];const e=els.find(e=>getComputedStyle(e).backgroundColor==='rgb(233, 49, 71)');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});if(red){await click(red);await sleep(900);console.log('RED',await readFile(join(vault,'Board.canvas'),'utf8'));}await press('Escape');
 await click('[aria-label="Canvas settings"]');console.log('SETTINGS',JSON.stringify(await run(()=>[...document.querySelectorAll('.menu-item')].map(e=>({text:e.innerText,icons:[...e.querySelectorAll('svg')].map(s=>s.getAttribute('class'))})))));await click('.menu-item');await sleep(500);
 console.log('CONFIGS',JSON.stringify(await Promise.all((await readdir(join(vault,'.obsidian'))).filter(n=>n.endsWith('.json')).map(async n=>[n,await readFile(join(vault,'.obsidian',n),'utf8')]))));
 await run(()=>app.workspace.openLinkText('Source.md','',false));await sleep(150);
 const suggest=async text=>{await run(()=>{const e=app.workspace.activeLeaf.view.editor;e.setValue('Start\n\n');e.setCursor({line:2,ch:0});e.focus();});await send('Input.insertText',{text});await sleep(280);console.log('ROWS',text,JSON.stringify(await run(()=>[...document.querySelectorAll('.suggestion-container .suggestion-item')].map(e=>({text:e.innerText,classes:e.className,children:[...e.children].map(c=>({text:c.innerText,cls:c.className}))})))));};
 await suggest('[[Target#');await click('.suggestion-container .suggestion-item');console.log('HEADING_ACCEPT',await run(()=>app.workspace.activeLeaf.view.editor.getValue()));
 for(const word of ['','Item','Quote','const','known']){
  await suggest('[[Target^'+word);
  if(word){await click('.suggestion-container .suggestion-item');await sleep(600);console.log('BLOCK_ACCEPT',word,JSON.stringify(await run(async()=>({source:app.workspace.activeLeaf.view.editor.getValue(),target:await app.vault.read(app.vault.getAbstractFileByPath('Target.md'))}))));}
  await press('Escape');
 }
 await shot('obsidian-block-detail');
});
