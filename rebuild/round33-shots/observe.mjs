import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
import {notes,bases} from '../round31-shots/fixtures.mjs';
import {writeFile} from 'node:fs/promises';
await withObsidian(async({run,send,click,press,move,point})=>{
 await run(async(notes,source)=>{await app.vault.createFolder('BaseTest');for(const[p,s]of Object.entries(notes))await app.vault.create(p,s);await app.vault.create('Multi.base',source);await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('Multi.base'));},notes,bases['By due.base']);await sleep(500);
 const result={};const source=()=>run(()=>app.vault.read(app.vault.getAbstractFileByPath('Multi.base')));
 const snap=()=>run(()=>[...document.querySelectorAll('.menu,.popover')].map(e=>({text:e.innerText,width:e.getBoundingClientRect().width,controls:[...e.querySelectorAll('input,select,button,.clickable-icon')].map(e=>({tag:e.tagName,class:e.className,label:e.getAttribute('aria-label'),text:e.innerText,value:e.value,options:e.tagName==='SELECT'?[...e.options].map(o=>({text:o.text,value:o.value})):undefined}))})));
 const shot=async name=>writeFile(new URL(name+'.png',import.meta.url),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const label=async text=>click(await run(text=>{const e=[...document.querySelectorAll('.bases-toolbar *, .menu *, .popover *')].find(e=>e.textContent===text&&e.children.length===0&&e.getBoundingClientRect().width>0);if(!e)throw Error('Missing '+text);const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},text));
 await label('3 results');await shot('obsidian-results');await label('Copy to clipboard');await shot('obsidian-notice');
 await label('By due');result.views=await snap();await shot('obsidian-views');await click('.bases-toolbar-menu-item-icon');result.configure=await snap();await shot('obsidian-configure');
 result.selection=await run(()=>({selected:getSelection()?.toString(),active:document.activeElement?.tagName,start:document.activeElement?.selectionStart,end:document.activeElement?.selectionEnd}));
 const key=async name=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:name,windowsVirtualKeyCode:{Tab:9,ArrowDown:40,ArrowUp:38,Enter:13}[name]});};
 await click('.popover input, .menu input');await press('a',2);for(const key of 'Renamed: view'){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,text:type==='keyDown'?key:undefined,windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)});}await click('.back-icon');await sleep(3000);result.back={menus:await snap(),source:await source()};
 await click('.bases-toolbar-menu-item-icon');result.heights=[];
 for(let i=0;i<6&&!await run(()=>document.activeElement?.matches('select.dropdown:not(.is-measuring)'));i++)await key('Tab');
 for(let i=0;i<3;i++){await key('ArrowDown');await sleep(2300);result.heights.push({source:await source(),rows:await run(()=>[...document.querySelectorAll('.bases-tbody .bases-tr')].map(e=>e.getBoundingClientRect().height))});}
 for(let i=0;i<3;i++)await key('ArrowUp');await sleep(2300);result.short=await source();
 await click(await run(()=>{const e=document.querySelector('svg[class*="more-vertical"]')?.parentElement;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};}));result.more=await snap();await shot('obsidian-more');await press('Escape');result.escapeMore=await snap();
 if(!await run(()=>!!document.querySelector('.back-icon'))){await click('.bases-toolbar-item');await click('.bases-toolbar-menu-item-icon');}
 await click('.back-icon');await label('Add view');result.addView=await snap();await shot('obsidian-add-view');await press('Escape');result.escape=await snap();await sleep(2300);result.final=await source();
 await writeFile(new URL('observed.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
});
