import { withObsidian, sleep } from './obsidian-driver.mjs';
await withObsidian(async({run,click,press,shot,point,move,send})=>{
  await run(async()=>{
    await app.vault.create('Controls.canvas',JSON.stringify({nodes:[{id:'a',type:'text',x:0,y:0,width:280,height:170,text:'Card A'},{id:'b',type:'text',x:430,y:60,width:220,height:120,text:'Card B'}],edges:[{id:'e',fromNode:'a',toNode:'b'}]}));
    await app.vault.create('Target.md','---\ntags: [observe]\n---\n# First heading\n\nParagraph **one** spans\ntwo lines.\n\n## Another heading\n\nExisting block. ^known\n\n- Item one\n- Item two\n\n> Quote one\n> Quote two\n\n```js\nconst x = 1\n```\n\nFinal paragraph.');
    await app.vault.create('Source.md','---\ntags: [source]\n---\n# Local heading\n\nLocal paragraph.\n\n');
    await app.workspace.openLinkText('Controls.canvas','',false);
  });await sleep(1500);
  const info=()=>run(()=>[...document.querySelectorAll('.canvas-controls [aria-label],.canvas-menu [aria-label]')].map(e=>({label:e.getAttribute('aria-label'),icon:e.querySelector('svg')?.getAttribute('class'),rect:e.getBoundingClientRect().toJSON(),padding:getComputedStyle(e).padding})));
  await click('.canvas-node');await sleep(150);console.log('CONTROLS',JSON.stringify(await info()));
  console.log('TOOLBAR',await run(()=>[...document.querySelectorAll('.canvas-menu,.canvas-controls')].map(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON(),gap:getComputedStyle(e).gap,children:[...e.children].map(c=>c.className)}))));
  await shot('obsidian-toolbar');
  for(const label of ['Set color','Canvas settings','Canvas help']){
    const selector=`[aria-label="${label}"]`;if(!await run(s=>!!document.querySelector(s),selector)){console.log('MISSING',label);continue;}
    await click(selector); await sleep(150);
    console.log(label, await run(() => [...document.querySelectorAll('.menu,.modal,.popover')].map(e => ({
      class:e.className, text:e.innerText,
      controls:[...e.querySelectorAll('[aria-label],input')].map(c => ({tag:c.tagName,type:c.getAttribute('type'),label:c.getAttribute('aria-label'),class:c.className,value:c.value}))
    }))));
    await shot('obsidian-'+label.toLowerCase().replaceAll(' ','-'));await press('Escape');
  }
  await run(()=>app.workspace.openLinkText('Source.md','',false));await sleep(250);
  for(const text of ['[[Target#','[[#','[[Target^','[[Target#^','[[Target#Another','[[Target^Paragraph']){
    await run(()=>{const e=app.workspace.activeLeaf.view.editor;e.setValue('---\ntags: [source]\n---\n# Local heading\n\nLocal paragraph.\n\n');e.setCursor({line:8,ch:0});e.focus();});
    await send('Input.insertText',{text});await sleep(350);
    console.log('SUGGEST',text,await run(()=>[...document.querySelectorAll('.suggestion-container')].map(e=>({text:e.innerText,rows:[...e.querySelectorAll('.suggestion-item')].map(c=>({text:c.innerText,class:c.className}))}))));
    await shot('obsidian-suggest-'+text.replaceAll(/[^a-zA-Z]/g,''));
    if(text==='[[Target^Paragraph'){await click('.suggestion-container .suggestion-item');await sleep(900);console.log('ACCEPT',await run(async()=>({source:app.workspace.activeLeaf.view.editor.getValue(),target:await app.vault.read(app.vault.getAbstractFileByPath('Target.md'))})));}
    await press('Escape');
  }
});
