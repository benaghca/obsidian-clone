import { withObsidian, sleep } from './obsidian-driver.mjs';
await withObsidian(async ({run,send,press,click,shot}) => {
  await run(async () => {
    await app.vault.create('Land.md', 'Before.\n\n# Has id ^keep\n\n# Pipe | split\n');
    await app.vault.create('Source.md', '---\ntitle: Source\n---\n\nLinks.\n\n');
    await app.workspace.openLinkText('Source.md', '', false);
  });
  await sleep(200);
  for (const query of ['[[Land#Has', '[[Land#Pipe']) {
    await run(() => { const e=app.workspace.activeLeaf.view.editor;e.setValue('---\ntitle: Source\n---\n\nLinks.\n\n');e.setCursor({line:6,ch:0});e.focus(); });
    await send('Input.insertText', {text:query});await sleep(300);
    console.log('ROWS',query,JSON.stringify(await run(()=>[...document.querySelectorAll('.suggestion-container .suggestion-item')].map(e=>e.innerText))));
    await press('Enter');await sleep(150);
    console.log('ACCEPT',JSON.stringify(await run(()=>app.workspace.activeLeaf.view.editor.getValue())));
  }
  await run(async () => {
    await app.vault.create('A very long note name that should sit above the card.md', 'Body.');
    await app.vault.create('Board.canvas', JSON.stringify({nodes:[{id:'g',type:'group',x:80,y:160,width:420,height:220,label:'Notes from the whole first chapter'},{id:'f',type:'file',file:'A very long note name that should sit above the card.md',x:80,y:460,width:260,height:110}],edges:[]}));
    await app.workspace.openLinkText('Board.canvas','',false);
  });await sleep(700);
  for (const id of ['g','f']) {
    const p=await run(id=>{const el=[...document.querySelectorAll('.canvas-node-label, .canvas-group-label')].find(e=>e.innerText.includes(id==='g'?'Notes from':'A very long'));const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},id);
    await click(p);await sleep(100);
    console.log('LABEL_TOOLBAR',id,JSON.stringify(await run(()=>[...document.querySelectorAll('.canvas-menu, .canvas-node-label, .canvas-group-label')].map(e=>({cls:e.className,text:e.textContent,rect:e.getBoundingClientRect().toJSON()})))));
  }
  await shot('obsidian-stage3-labels');
});
