// Obsidian syntax a vault brings with it: %%comments%%, foldable and nested callouts, ~~strikethrough~~
// only with two tildes, task statuses ([/], [-]…), tasks in loose lists, block references (#^id),
// footnotes (in live preview too), ```query blocks (embedded search), links in properties and in
// tables ([[Note\|alias]]), and obsidian://open links to notes in the vault.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const r = p => fs.readFileSync(path.join(VAULT, p), 'utf8');
(async () => {
  w('Callouts.md', '> [!faq]- Folded by default\n> hidden body\n\n> [!tip]+ Open but foldable\n> shown body\n\n> [!note]\n> no title\n\n> [!note] Outer\n> > [!warning] Inner\n> > nested body\n');
  w('Tasks.md', 'H~2~O and ~~struck~~\n\n- [ ] todo\n- [/] in progress\n- [-] cancelled\n- [x] done\n\n- [ ] loose one\n\n- [ ] loose two\n\n- [ ] last\n');
  w('Block.md', '# Block\n\nFirst line of a paragraph\nworth citing. ^cite1\n\n- a list item ^item2\n- another item\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n^table3\n\n' + 'filler\n\n'.repeat(60) + 'Far down. ^far\n');
  w('Refs.md', 'Go [[Block#^far]]\n\n![[Block#^cite1]]\n\n![[Block#^item2]]\n\n![[Block#^table3]]\n\n![[Block#^nope]]\n');
  w('Footnotes.md', 'A claim[^1], an inline one^[said *inline*], one never defined[^nope] and the first again[^1].\n\n[^1]: Source\n');
  w('Garden.md', 'Planting tomatoes #x\n'); w('Orchard.md', 'Apple trees #x\n'); w('Other.md', 'Nothing here\n');
  w('Queries.md', 'Searches:\n\n```query\ntag:x\n```\n\n```query\ntomatoes\n```\n');
  w('Target.md', '# Target\n');
  w('Linker.md', '---\nrelated: "[[Target]]"\n---\n| col | link |\n|---|---|\n| a | [[Target\\|in a table]] |\n');
  w('Uri.md', '[Open the plan](obsidian://open?vault=Mine&file=Folder%2FThe%20Plan)\n');
  w('Folder/The Plan.md', '# The Plan\n');
  w('Comments.md', 'Before %%inline secret%% after\n\n%%\nblock secret\n- [ ] commented task\n%%\n\n- [ ] first\n- [ ] second\n\n```\n%% in code %%\n```\n');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(800);
  const preview = () => page.evaluate(() => document.querySelector('#preview').innerText);

  console.log('%%comments%%');
  await page.evaluate(() => openPath('Comments.md')); await sleep(400);
  await page.evaluate(() => setMode('read')); await sleep(300);
  let text = await preview();
  assert(!/secret|commented task/.test(text), 'reading view leaves comments out');
  assert(/Before\s+after/.test(text), 'and keeps the text around an inline one');
  assert(text.includes('%% in code %%'), 'but not %% inside code');
  assert(await page.$$eval('#preview input[type=checkbox]', c => c.length) === 2, 'a task inside a comment isn’t drawn');
  await page.click('#preview li:has-text("second") input'); await sleep(900);
  assert(/- \[x\] second/.test(r('Comments.md')) && /- \[ \] commented task/.test(r('Comments.md')), 'ticking the second checkbox ticks “second”, not the commented task');
  await page.evaluate(() => setMode('edit')); await sleep(300);
  const dim = await page.$$eval('.cm-content .tok-comment', els => els.map(e => e.textContent).join('|'));
  assert(dim.includes('inline secret') && dim.includes('block secret'), 'the editor shows comments, dimmed: ' + dim.slice(0, 80));

  console.log('callouts');
  await page.evaluate(() => openPath('Callouts.md')); await sleep(400);
  await page.evaluate(() => setMode('read')); await sleep(300);
  const callouts = await page.$$eval('#preview .callout', els => els.map(e => ({ tag: e.tagName, open: e.open, title: e.querySelector('.callout-title').textContent, shown: e.querySelector(':scope > p')?.checkVisibility() })));
  assert(callouts[0].tag === 'DETAILS' && !callouts[0].open && !callouts[0].shown, '[!faq]- starts folded');
  assert(callouts[1].tag === 'DETAILS' && callouts[1].open && callouts[1].shown, '[!tip]+ starts open');
  assert(callouts[2].tag === 'DIV', 'a callout without +/- doesn’t fold');
  await page.click('#preview details.callout summary'); await sleep(150);
  assert(await page.$eval('#preview details.callout', d => d.open), 'clicking a folded callout’s title opens it');
  assert(await page.evaluate(() => getComputedStyle(document.querySelector('#preview .callout-title')).textTransform) === 'none' && callouts[1].title === 'Open but foldable', 'a title of its own isn’t capitalized: ' + callouts[1].title);
  assert(callouts[2].title === 'Note', 'one without a title shows its type, capitalized');
  await page.evaluate(() => { setMode('edit'); ed.setSelectionRange(0); }); await sleep(300);
  const lines = await page.$$eval('.cm-line', ls => ls.map(l => l.textContent));
  assert(lines.some(l => l === 'Inner') && !lines.some(l => l.includes('!warning')), 'a callout inside a callout shows its title while editing');

  console.log('~~strikethrough~~ and task statuses');
  await page.evaluate(() => openPath('Tasks.md')); await sleep(400);
  await page.evaluate(() => setMode('read')); await sleep(300);
  assert(await page.$$eval('#preview del', d => d.map(x => x.textContent).join()) === 'struck', 'only ~~two tildes~~ strike through, not H~2~O');
  const items = await page.$$eval('#preview li', ls => ls.map(l => [l.dataset.task, l.className, !!l.querySelector('input:not([disabled])')]));
  assert(items.length === 7 && items.every(x => x[2]), 'every task, loose lists too, has a checkbox you can click: ' + JSON.stringify(items));
  assert(items[1][0] === '/' && !/done|cancelled/.test(items[1][1]) && /cancelled/.test(items[2][1]) && /done/.test(items[3][1]), '[/] is in progress, [-] cancelled, [x] done');
  await page.click('#preview li:has-text("loose two") input'); await sleep(900);
  assert(/- \[x\] loose two/.test(r('Tasks.md')) && /- \[ \] loose one/.test(r('Tasks.md')), 'ticking a task in a loose list ticks that one');
  await page.click('#preview li:has-text("last") input'); await sleep(900);
  assert(/- \[x\] last/.test(r('Tasks.md')), 'and the ones after it still line up');
  await page.evaluate(() => { setMode('edit'); ed.setSelectionRange(0); }); await sleep(300);
  const boxes = await page.$$eval('.cm-content .cm-task-cb', c => c.map(x => x.dataset.task + (x.checked ? '1' : '0')));
  assert(boxes.slice(0, 4).join() === ' 0,/1,-1,x1', 'live preview draws a checkbox for each status: ' + boxes.join());
  await page.click('.cm-task-cb[data-task="/"]'); await sleep(900);
  assert(/- \[x\] in progress/.test(r('Tasks.md')), 'clicking [/] completes it');

  console.log('block references');
  await page.evaluate(() => openPath('Block.md')); await sleep(400);
  await page.evaluate(() => setMode('read')); await sleep(300);
  assert(!/\^(cite1|item2|table3|far)/.test(await preview()), 'reading view hides ^ids');
  assert(await page.$$eval('#preview [data-block-id]', e => e.map(x => x.tagName + ':' + x.dataset.blockId).join()) === 'P:cite1,LI:item2,DIV:table3,P:far', 'and marks their blocks');
  await page.evaluate(() => openPath('Refs.md')); await sleep(400);
  await page.evaluate(() => setMode('read')); await sleep(500);
  const embeds = await page.$$eval('#preview .embed .markdown', e => e.map(x => x.innerText.trim().replace(/\s+/g, ' ')));
  assert(embeds[0] === 'First line of a paragraph worth citing.', 'an embedded paragraph block: ' + embeds[0]);
  assert(embeds[1] === 'a list item', 'an embedded list item: ' + embeds[1]);
  assert(/^a\s*b\s*1\s*2$/.test(embeds[2]), 'an embedded table, by the ^id below it: ' + embeds[2]);
  assert(/Block "\^nope" not found/.test(embeds[3]), 'a missing block says so');
  await page.click('#preview a.internal-link:has-text("far")'); await sleep(600);
  assert(await page.evaluate(() => S.cur) === 'Block.md', 'a [[Note#^id]] link opens the note');
  assert(await page.evaluate(() => { const r = document.querySelector('#preview [data-block-id="far"]').getBoundingClientRect(); return r.top > 0 && r.bottom < innerHeight; }), 'scrolled to the block');
  await page.evaluate(() => { setMode('edit'); scrollToHeading('^far'); }); await sleep(300);
  assert(await page.evaluate(() => ed.value.slice(ed.selectionStart).startsWith('Far down.')), 'while editing, the cursor goes to the block');

  console.log('footnotes');
  await page.evaluate(() => openPath('Footnotes.md')); await sleep(400);
  await page.evaluate(() => setMode('read')); await sleep(300);
  assert(await page.$$eval('#preview a.fn-ref', a => a.map(x => x.textContent).join()) === '1,2,1', 'references are numbered as they come, the same footnote keeping its number');
  assert((await preview()).includes('one never defined[^nope]'), 'one with no definition stays as typed');
  const notes = await page.$$eval('#preview .footnotes li', l => l.map(x => x.innerText.replace('↩', '').trim()));
  assert(notes.join('|') === 'Source|said inline', 'the footnotes are listed at the end, inline ones too: ' + notes.join('|'));
  assert(!(await preview()).includes('[^1]:'), 'a one-word definition isn’t read as a link definition or left in the text');
  await page.click('#preview a.fn-ref >> nth=1'); await sleep(200);
  assert(await page.evaluate(() => { const r = document.querySelector('#preview [data-fn-def="2"]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'clicking a number shows its footnote');

  await page.evaluate(() => { setMode('edit'); ed.setSelectionRange(ed.value.length); }); await sleep(300);
  assert(await page.$$eval('.cm-content .cm-fn-ref', s => s.map(x => x.textContent).join()) === '1,nope,1', 'live preview raises footnote references to their labels');

  console.log('obsidian:// links');
  await page.evaluate(() => openPath('Uri.md')); await sleep(400);
  await page.evaluate(() => setMode('read')); await sleep(300);
  await page.click('#preview a:has-text("Open the plan")'); await sleep(400);
  assert(await page.evaluate(() => S.cur) === 'Folder/The Plan.md', 'an obsidian://open link to a note in this vault opens it here');

  console.log('```query blocks');
  await page.evaluate(() => openPath('Queries.md')); await sleep(400);
  await page.evaluate(() => setMode('read')); await sleep(300);
  const qs = await page.$$eval('#preview .query-block', b => b.map(x => [...x.querySelectorAll('.s-file-name')].map(n => n.firstChild.textContent).sort().join('+') + ' ' + x.querySelector('.query-head small').textContent));
  assert(qs[0] === 'Garden+Orchard 2 notes', 'a query block lists what the search finds: ' + qs[0]);
  assert(qs[1].startsWith('Garden 1 note'), 'ranked word searches too: ' + qs[1]);
  await page.evaluate(() => setMode('edit')); await sleep(400);
  assert(await page.$$eval('.cm-content .query-block', b => b.length) === 2, 'and live preview draws them');
  await page.click('.cm-content .query-block .s-file-name:has-text("Orchard")'); await sleep(400);
  assert(await page.evaluate(() => S.cur) === 'Orchard.md', 'clicking a result opens it');

  console.log('links in properties and tables');
  assert(await page.evaluate(() => S.notes.get('Linker.md').out.filter(p => p === 'Target.md').length) === 2, 'a [[link]] in a property and a [[link\\|alias]] in a table both count as links');
  await page.evaluate(() => renamePath('Target.md', 'Target Two.md')); await sleep(1200);
  assert(r('Linker.md') === '---\nrelated: "[[Target Two]]"\n---\n| col | link |\n|---|---|\n| a | [[Target Two\\|in a table]] |\n', 'renaming the note rewrites both, the table’s keeping its \\|: ' + JSON.stringify(r('Linker.md')));

  assert(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
