const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  const w = (p, t) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), t); };
  w('A.md', '# A\nhello there');
  w('B.md', '# Intro\ntext\n\n# Later\nmore hello');
  w('Projects/P1.md', '# P1');
  w('.obsidian/bookmarks.json', JSON.stringify({ items: [
    { type: 'file', ctime: 1, path: 'A.md' },
    { type: 'group', ctime: 2, title: 'Work', items: [{ type: 'folder', ctime: 3, path: 'Projects' }, { type: 'search', ctime: 4, query: 'hello' }] },
    { type: 'file', ctime: 5, path: 'B.md', subpath: '#Later' },
    { type: 'url', ctime: 6, url: 'https://example.com/', title: 'Example' },
  ], other: 'kept' }));
  const disk = () => JSON.parse(fs.readFileSync(path.join(VAULT, '.obsidian/bookmarks.json'), 'utf8'));
  const flat = (items, out = []) => { for (const i of items) { out.push(i); if (i.items) flat(i.items, out); } return out; };

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('popup', p => p.close());
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const names = () => page.$$eval('#bookmark-list .bm-row .name', r => r.map(x => x.textContent));
  const row = t => page.locator('#bookmark-list .bm-row', { hasText: t }).first();

  await page.click('#ribbon [data-cmd=panel-bookmarks]'); await sleep(300);
  assert(!(await page.$eval('#panel-bookmarks', p => p.hidden)), 'the ribbon opens the Bookmarks panel');
  assert((await names()).join('|') === 'A|Work|Projects|hello|B › Later|Example', 'it lists Obsidian’s bookmarks: ' + (await names()).join('|'));

  await row('A').click(); await sleep(300);
  assert(await page.evaluate(() => S.cur) === 'A.md', 'clicking a file bookmark opens it');
  assert(await page.$eval('#bookmark-list .bm-row.active .name', r => r.textContent) === 'A', 'and marks it as open');
  await row('B › Later').click(); await sleep(400);
  assert(await page.evaluate(() => S.cur) === 'B.md', 'a heading bookmark opens its note');
  await row('Projects').click(); await sleep(300);
  assert(await page.evaluate(() => S.expanded.has('Projects') && !document.querySelector('#panel-files').hidden), 'a folder bookmark reveals the folder in the file tree');
  await page.click('#ribbon [data-cmd=panel-bookmarks]'); await sleep(200);
  await row('hello').click(); await sleep(400);
  assert(await page.$eval('#search-input', i => i.value) === 'hello' && !(await page.$eval('#panel-search', p => p.hidden)), 'a search bookmark runs the search');
  await page.click('#ribbon [data-cmd=panel-bookmarks]'); await sleep(200);

  await row('Work').click(); await sleep(200);
  assert((await names()).join('|') === 'A|Work|B › Later|Example', 'clicking a group closes it');
  await page.reload(); await sleep(900);
  await page.click('#ribbon [data-cmd=panel-bookmarks]'); await sleep(300);
  assert((await names()).join('|') === 'A|Work|B › Later|Example', 'and it stays closed after a reload');
  await row('Work').click(); await sleep(200);

  // Bookmark the open file from the panel button, and take it back.
  await page.evaluate(() => openPath('Projects/P1.md')); await sleep(300);
  const btn = '#panel-bookmarks [data-cmd=bookmark]';
  assert(await page.getAttribute(btn, 'aria-pressed') === 'false', 'the button shows the open file isn’t bookmarked');
  await page.click(btn); await sleep(400);
  assert(await page.getAttribute(btn, 'aria-pressed') === 'true' && flat(disk().items).some(i => i.path === 'Projects/P1.md' && i.type === 'file'), 'the button bookmarks it, in .obsidian/bookmarks.json');
  assert(disk().other === 'kept', 'leaving the rest of that file alone');
  await page.click(btn); await sleep(400);
  assert(!flat(disk().items).some(i => i.path === 'Projects/P1.md'), 'clicking again removes it');

  // From the note's ⋯ menu and the file tree's context menu.
  await page.click('[data-cmd=note-menu]'); await sleep(200);
  await page.click('.menu >> text=Bookmark'); await sleep(400);
  assert(flat(disk().items).some(i => i.path === 'Projects/P1.md'), 'the note menu bookmarks the open note');
  await page.click('#ribbon [data-cmd=panel-files]'); await sleep(200);
  await page.click('#tree .t-row[data-path="B.md"]', { button: 'right' }); await sleep(200);
  await page.click('.menu >> text=Bookmark'); await sleep(400);
  assert(flat(disk().items).some(i => i.path === 'B.md' && !i.subpath), 'so does the file tree’s menu');

  // Renames and deletes keep the list tidy.
  await page.evaluate(() => renamePath('Projects', 'Work stuff')); await sleep(800);
  let items = flat(disk().items);
  assert(items.some(i => i.type === 'folder' && i.path === 'Work stuff') && items.some(i => i.type === 'file' && i.path === 'Work stuff/P1.md'), 'renaming a folder updates the bookmarks under it');
  await page.evaluate(() => deletePath('A.md', { confirm: false })); await sleep(600);
  assert(!flat(disk().items).some(i => i.path === 'A.md'), 'deleting a file drops its bookmark');

  // Search and heading bookmarks.
  await page.evaluate(() => searchFor('more')); await sleep(300);
  await page.click('#panel-search [data-cmd=bookmark-search]'); await sleep(400);
  assert(flat(disk().items).some(i => i.type === 'search' && i.query === 'more'), 'the search panel bookmarks the search');
  await page.evaluate(() => openPath('B.md')); await sleep(300);
  await page.click('#right .tabs [data-rtab=outline]'); await sleep(300);
  await page.click('#right-body .o-item[data-heading="Intro"]', { button: 'right' }); await sleep(200);
  await page.click('.menu >> text=Bookmark heading'); await sleep(400);
  assert(flat(disk().items).some(i => i.path === 'B.md' && i.subpath === '#Intro'), 'the outline bookmarks a heading');

  // Groups and moving things around.
  await page.click('#ribbon [data-cmd=panel-bookmarks]'); await sleep(300);
  await page.click('#panel-bookmarks [data-cmd=bookmark-group]'); await sleep(200);
  await page.fill('.modal [name=v]', 'Reading'); await page.keyboard.press('Enter'); await sleep(400);
  assert(disk().items.some(i => i.type === 'group' && i.title === 'Reading'), 'a new group can be made');
  await row('B › Intro').dragTo(row('Reading'), { targetPosition: { x: 40, y: 14 } }); await sleep(400);
  const reading = disk().items.find(i => i.title === 'Reading');
  assert(reading.items.length === 1 && reading.items[0].subpath === '#Intro', 'dragging a bookmark onto a group files it there');
  const before = await names();
  await row('Example').dragTo(row('Work'), { targetPosition: { x: 40, y: 14 } }); await sleep(400);
  const after = await names();
  assert(after.indexOf('Example') >= 0 && after.indexOf('Work') >= 0, 'dropping on a group row moves it into the group: ' + after.join('|'));
  assert(flat(disk().items.find(i => i.title === 'Work').items).some(i => i.url === 'https://example.com/'), 'and it’s saved inside that group');
  // Reorder at the top level: drag the last top-level item before the first.
  const top = () => disk().items.map(i => i.title || i.path || i.query);
  const t0 = top();
  const lastName = await page.$$eval('#bookmark-list > .bm-row', rs => rs.filter(r => r.style.paddingLeft === '6px').pop().querySelector('.name').textContent);
  const firstName = await page.$$eval('#bookmark-list > .bm-row', rs => rs[0].querySelector('.name').textContent);
  await row(lastName).dragTo(row(firstName), { targetPosition: { x: 40, y: 2 } }); await sleep(400);
  const t1 = top();
  assert(t1[0] === t0[t0.length - 1] && t1.length === t0.length, `dragging onto a row puts it just before (${t0.join(',')} → ${t1.join(',')})`);

  // Files dragged in from the file tree.
  await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'B.md\nWork stuff/P1.md\nnope.md'); const end = document.querySelector('#bookmark-list [data-bm-end]'); end.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt })); end.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt })); });
  await sleep(400);
  assert(flat(disk().items).filter(i => i.path === 'B.md' && !i.subpath).length === 1, 'dropping files from the tree bookmarks the new ones only');

  // Rename a bookmark's title; remove one.
  await row('Example').click({ button: 'right' }); await sleep(200);
  await page.click('.menu >> text=Edit title…'); await sleep(200);
  await page.fill('.modal [name=v]', 'Docs'); await page.keyboard.press('Enter'); await sleep(400);
  assert(flat(disk().items).some(i => i.url === 'https://example.com/' && i.title === 'Docs'), 'a bookmark’s title can be changed');
  await row('Docs').click({ button: 'right' }); await sleep(200);
  await page.click('.menu >> text=Remove bookmark'); await sleep(400);
  assert(!flat(disk().items).some(i => i.url), 'and it can be removed');

  // Without an .obsidian folder, bookmarks live in Cinder's own settings.
  fs.rmSync(path.join(VAULT, '.obsidian'), { recursive: true });
  await page.reload(); await sleep(900);
  await page.evaluate(() => openPath('B.md')); await sleep(300);
  await page.evaluate(() => toggleBookmark()); await sleep(300);
  assert(!fs.existsSync(path.join(VAULT, '.obsidian')), 'a vault without .obsidian doesn’t get one');
  await page.reload(); await sleep(900);
  await page.click('#ribbon [data-cmd=panel-bookmarks]'); await sleep(300);
  assert((await names()).join('|') === 'B', 'its bookmarks are kept by Cinder instead');
  await page.screenshot({ path: SP + '/bookmarks.png', clip: { x: 0, y: 0, width: 600, height: 300 } });

  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
