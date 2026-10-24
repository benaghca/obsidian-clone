import {withObsidian,sleep} from '../round25-shots/obsidian-driver.mjs';
await withObsidian(async({run,click})=>{
 await run(async()=>{await app.vault.create('Overflow.canvas',JSON.stringify({nodes:[{id:'n',type:'text',x:0,y:0,width:250,height:160,text:'## Card\n**Local** Markdown and [[Welcome]].\n- Item\n- [ ] Task'}],edges:[]}));await app.workspace.openLinkText('Overflow.canvas','',false);});await sleep(200);
 const info=()=>run(()=>[...document.querySelectorAll('.canvas-node,.canvas-node *')].filter(e=>e.clientHeight>30).map(e=>{const s=getComputedStyle(e);return{cls:e.className,overflow:s.overflow,scrollbar:s.scrollbarWidth,h:e.clientHeight,sh:e.scrollHeight,w:e.clientWidth,sw:e.scrollWidth};}));
 console.log('UNSELECTED',JSON.stringify(await info()));await click('.canvas-node .markdown-preview-view');console.log('SELECTED',JSON.stringify(await info()));
});
