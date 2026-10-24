// Heading/block choices use native CDP input, on frontmatter notes and canvas editors.
import { withBrowser, sleep } from './browser.mjs';
await withBrowser(async({run,send,open,click,move,point,press,double,check,shot})=>{
 const source='---\ntags: [source]\n---\n# Local heading\n\nLocal paragraph.\n\n';
 const target='---\ntags: [target]\n---\n# Top **bold**\n\nParagraph **one** spans\ntwo lines.\n\n## Final heading\n\nExisting block. ^known\n\n- Item one\n- Item two\n\n> Quote one\n> Quote two\n\n```js\nconst x = 1\n\nmore code\n```\n';
 const text=path=>run(async path=>{const{api}=await import('/src/api.ts');return api.readNote(path);},path);
 const labels=()=>run(()=>[...document.querySelectorAll('.cm-link-suggest .cm-completionLabel')].map(e=>e.textContent));
 const prepare=async(mode,prefix)=>{
  await run((mode,source)=>{ws.setMode(mode);ws.view.dispatch({changes:{from:0,to:ws.view.state.doc.length,insert:source},selection:{anchor:source.length},scrollIntoView:true});ws.view.focus();},mode,source);
  await sleep(70);const p=await run(()=>{const r=ws.view.coordsAtPos(ws.view.state.doc.length);return{x:r.left+1,y:(r.top+r.bottom)/2};});await click(p);await send('Input.insertText',{text:prefix});await sleep(230);
 };
 const accept=async()=>{const p=await point('.cm-link-suggest li[aria-selected]');await click(p);await sleep(350);return p;};
 for(const mode of ['live','source']){
  const path=`Target-${mode}.md`,name=`Target-${mode}`;
  await run(async(path,target)=>{const{api}=await import('/src/api.ts');await api.createNote(path,target);await ws.vault.refreshFiles();},path,target);
  await open(`Source-${mode}.md`,source);
  await prepare(mode,`[[${name}#`);
  check(JSON.stringify(await labels())===JSON.stringify(['Top **bold**','Final heading']),mode+': headings retain raw source text and document order, excluding frontmatter');
  check(await run(()=>[...document.querySelectorAll('.cm-link-suggest .cm-completionDetail')].map(e=>e.textContent).join('|')==='H1|H2'),mode+': heading rows show level labels');
  const headingPoint=await accept();check(await run(()=>ws.view.state.doc.toString().endsWith(']]')&&ws.view.state.doc.toString().includes('#Top **bold**]]')),mode+': native heading choice inserts the complete heading link');
  check(await text(path)===target,mode+': heading acceptance leaves the target byte-identical');
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...headingPoint,button:'left',clickCount:1});
  check(await run(()=>ws.view.state.doc.toString().match(/\[\[/g).length===1),mode+': stationary repeat does not insert a second link');
  await prepare(mode,'[[#');check(JSON.stringify(await labels())==='["Local heading"]',mode+': [[# lists only current-note headings');await press('ArrowDown');await accept();check(await run(()=>ws.view.state.doc.toString().endsWith('[[#Local heading]]')),mode+': current-note heading uses an empty file path');
  await prepare(mode,`[[${name}#Fnl`);check((await labels())[0]==='Final heading',mode+': heading query uses fuzzy matching');await press('Escape');
  await prepare(mode,`[[${name}^Paragraph`);check((await labels())[0]==='Paragraph one spans\ntwo lines.',mode+': block labels show Markdown text across source lines');await accept();
  const changed=await text(path),id=/two lines\. \^([a-z0-9]{6})/.exec(changed)?.[1];
  check(!!id&&await run(id=>ws.view.state.doc.toString().endsWith(`#^${id}]]`),id),mode+': accepting a block appends a six-character ID and inserts #^id');
  await prepare(mode,`[[${name}#^Paragraph`);await accept();check(await text(path)===changed,mode+': #^ reuses the existing block ID without rewriting the target');
  await prepare(mode,`[[${name}^known`);check((await labels())[0]==='Existing block.',mode+': existing IDs are searchable');await accept();check(await run(()=>ws.view.state.doc.toString().endsWith('#^known]]')),mode+': existing block ID is inserted unchanged');
  await prepare(mode,`[[${name}^Quote`);await accept();const quoted=await text(path),quote=/Quote two\n\n\^([a-z0-9]{6})/.exec(quoted)?.[1];check(!!quote,mode+': a quote ID goes on a separate line');
  await run(async target=>{ws.setMode('reading');await ws.openLink(target);},`${path}#^${quote}`);await sleep(100);check(await run(()=>ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text.startsWith('> Quote')),mode+': generated quote link navigates to the quoted block in Reading');
  await run(path=>ws.open(path),`Source-${mode}.md`);
  await prepare(mode,`[[${name}^const`);await accept();check(/```\n\n\^[a-z0-9]{6}/.test(await text(path)),mode+': fenced-code IDs stay outside the code');
  await prepare(mode,'[[^Local paragraph');await accept();check(await run(()=>{const s=ws.view.state.doc.toString(),id=/Local paragraph\. \^([a-z0-9]{6})/.exec(s)?.[1];return !!id&&s.endsWith(`[[#^${id}]]`)&&ws.view.state.selection.main.head===s.length;}),mode+': current-note ID insertion maps completion positions and caret correctly');
  await prepare(mode,'[[Missing#');check(!(await labels()).length,mode+': a missing target offers no phantom headings');await press('Escape');
  await prepare(mode,'[[#');await shot('grove-heading-'+mode);await press('Escape');
  await run(()=>ws.setMode('reading'));const before=await run(()=>ws.view.state.doc.toString());await send('Input.insertText',{text:'[[#'});await sleep(150);
  check(await run(before=>ws.view.state.doc.toString()===before&&!document.querySelector('.cm-link-suggest'),before),mode+': Reading remains read-only and opens no completion');
 }
 await run(async()=>{const{settings}=await import('/src/settings/store.ts');settings.set('app.json','useMarkdownLinks',true);settings.set('app.json','newLinkFormat','relative');});
 await prepare('live','[[Target-live#Final');await accept();check(await run(()=>ws.view.state.doc.toString().endsWith('[Target-live](Target-live.md#Final%20heading)')),'Heading completion honors Markdown link and relative-path settings');
 await prepare('live','[[#Local');await press('ArrowDown');await accept();check(await run(()=>ws.view.state.doc.toString().endsWith('[Local heading](#Local%20heading)')),'Markdown current-note headings omit the file destination');
 await run(async()=>{const{settings}=await import('/src/settings/store.ts');settings.set('app.json','useMarkdownLinks',false);settings.set('app.json','newLinkFormat','shortest');});
 await prepare('live','[[Target-live^Item two');
 await run(()=>{const path='Target-live.md';ws.editors.change(path,{changes:{from:ws.editors.doc(path).length,insert:'\nChanged externally.'},userEvent:'input'});});
 await accept();check(await run(()=>ws.view.state.doc.toString().endsWith('[[Target-live^Item two')),'A stale block suggestion does not insert a link or overwrite a changed target');
 check((await text('Target-live.md')).endsWith('Changed externally.')&&!/- Item two \^/.test(await text('Target-live.md')),'Concurrent target edits survive a stale block choice');
 const board={nodes:[{id:'card',type:'text',x:0,y:0,width:500,height:320,text:'# Card heading\n\nCard paragraph.\n\n'}],edges:[]};
 await open('LocalSuggest.canvas',board);await double('.canvas-node');await press('End',2);await send('Input.insertText',{text:'[[#'});await sleep(230);
 check(!(await labels()).length,'Canvas-local fragment completion matches Obsidian with no note-local headings');await press('Escape');
 await open('Suggest.canvas',board);await double('.canvas-node');await press('End',2);await send('Input.insertText',{text:'[[Target-live#'});await sleep(230);
 check((await labels())[0]==='Top **bold**','Canvas editor resolves headings in vault notes');await accept();await press('Escape');await sleep(350);
 check(await run(async()=>{const{api}=await import('/src/api.ts');return JSON.parse(await api.readNote('Suggest.canvas')).nodes[0].text.endsWith('[[Target-live#Top **bold**]]');}),'Canvas heading completion saves through the canvas document');
 await double('.canvas-node');await press('End',2);await send('Input.insertText',{text:'\n\n[[Target-live^Item'});await sleep(230);check((await labels())[0]==='Item one','Canvas editor resolves vault block choices');await accept();await press('Escape');await sleep(350);
 check(/- Item one \^[a-z0-9]{6}/.test(await text('Target-live.md')),'Canvas block choice adds the ID through the vault note editor');
 await shot('grove-canvas-suggestions');
}, {height:800,screenshots:new URL('../../round25-shots/',import.meta.url).pathname});
