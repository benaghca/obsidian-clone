const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const rd = p => fs.readFileSync(path.join(VAULT, p), 'utf8');
(async () => {
  fs.mkdirSync(VAULT + '/.obsidian', { recursive: true });
  fs.writeFileSync(VAULT + '/.obsidian/types.json', JSON.stringify({ types: { started: 'datetime' } }));
  w('Book.md', '---\ntitle: Dune\nauthor: "[[Frank Herbert]]"\ntags:\n  - scifi\n  - classic\nrating: 5\nread: true\npublished: 1965-08-01\n---\n# Dune\n\nBody text here.\n');
  w('Other.md', '---\nstatus: done\nrating: 3\n---\nx\n');
  w('Plain.md', 'No properties yet.\n');
  w('Broken.md', '---\ntitle: [unclosed\n---\ntext\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const open = async q => { await page.keyboard.press('Control+o'); await page.keyboard.type(q); await page.keyboard.press('Enter'); await sleep(900); await page.evaluate(() => setMode('edit')); await sleep(250); };
  const saved = async () => { await page.evaluate(() => save()); await sleep(150); return rd(await page.evaluate(() => S.cur)); };
  const row = k => `.cm-props-block .pp-row[data-key="${k}"]`;
  const act = () => page.evaluate(() => { const a = document.activeElement; return (a.closest('.pp-row')?.dataset.key || '') + '|' + a.className; });

  console.log('display');
  await open('Book');
  assert(await page.$$eval('.cm-props-block .pp-row', r => r.length) === 6, 'a row per property');
  assert(!(await page.$('#editor .cm-frontmatter')), 'the YAML itself is hidden');
  assert(await page.$eval(row('author') + ' .internal-link', a => a.textContent === 'Frank Herbert'), 'links in values render as links');
  assert(await page.$(row('rating') + ' .pp-input[type=number]') && await page.$(row('read') + ' .pp-check') && await page.$(row('published') + ' .pp-input[type=date]'), 'number, checkbox and date editors');
  assert(await page.$$eval(row('tags') + ' .pp-chip', c => c.length) === 2, 'tags as chips');
  assert(await page.evaluate(() => ed.selectionStart === ed.value.indexOf('# Dune')), 'the cursor starts below the properties');

  console.log('editing values');
  await page.click(row('title') + ' .pp-display'); await page.keyboard.press('End'); await page.keyboard.type(' Messiah'); await page.keyboard.press('Enter'); await sleep(200);
  assert((await saved()).includes('title: Dune Messiah'), 'text');
  assert((await act()).startsWith('author|'), 'Enter moves to the next value');
  await page.click(row('read') + ' .pp-check'); await sleep(150);
  assert((await saved()).includes('read: false'), 'checkbox');
  await page.fill(row('rating') + ' .pp-input', '4'); await page.keyboard.press('Enter'); await sleep(150);
  assert((await saved()).includes('rating: 4'), 'number');
  await page.fill(row('published') + ' .pp-input', '1965-09-01'); await sleep(150);
  assert((await saved()).includes('published: 1965-09-01'), 'date');
  await page.click(row('tags') + ' .pp-chip-input'); await page.keyboard.type('desert'); await page.keyboard.press('Enter'); await sleep(150);
  assert(/tags:\n  - scifi\n  - classic\n  - desert/.test(await saved()), 'adding a tag');
  assert((await act()).startsWith('tags|pp-chip-input'), 'focus stays in the tag box');
  await page.keyboard.press('Backspace'); await sleep(150);
  assert(!(await saved()).includes('desert'), 'Backspace removes the last one');
  await page.click(row('tags') + ' .pp-chip[data-i="1"] .pp-chip-x'); await sleep(150);
  assert(/tags:\n  - scifi\n/.test(await saved()) && !(await saved()).includes('classic'), '× removes one');

  console.log('names and types');
  await page.fill(row('author') + ' .pp-key', 'writer'); await page.keyboard.press('Enter'); await sleep(150);
  const t1 = await saved();
  assert(/title: Dune Messiah\nwriter: "\[\[Frank Herbert\]\]"\ntags:/.test(t1), 'renaming keeps the place and the value as written');
  await page.fill(row('writer') + ' .pp-key', 'title'); await page.keyboard.press('Enter'); await sleep(150);
  assert(await page.$(row('writer')) && (await saved()).includes('writer:'), 'a name already used is refused');
  await page.click(row('title') + ' .pp-type'); await page.click('.menu >> text=List'); await sleep(250);
  assert(/title:\n  - Dune Messiah\n/.test(await saved()), 'changing the type to List converts the value');
  assert(await page.$(row('title') + ' .pp-chip'), 'and shows chips');
  const types = JSON.parse(rd('.obsidian/types.json'));
  assert(types.types.title === 'multitext' && types.types.started === 'datetime', 'the type is saved in .obsidian/types.json alongside the others');

  console.log('adding');
  await page.click('.cm-props-block .pp-add'); await sleep(100);
  await page.keyboard.type('status'); await sleep(50);
  assert(await page.$eval('.cm-props-block datalist[id$="-keys"]', d => [...d.options].some(o => o.value === 'status')), 'names used elsewhere are suggested');
  await page.keyboard.press('Enter'); await sleep(250);
  assert(/\nstatus:\n---/.test(await saved()), 'Enter adds it');
  assert((await act()).startsWith('status|'), 'and moves to its value');
  await page.keyboard.type('reading'); await page.keyboard.press('Enter'); await sleep(200);
  assert((await saved()).includes('status: reading'), 'typing sets the value');
  await page.click(row('status') + ' .pp-type'); await page.click('.menu >> text=Remove property'); await sleep(200);
  assert(!(await saved()).includes('status'), 'Remove property');

  console.log('keyboard and undo');
  await page.evaluate(() => { ed.focus(); ed.setSelectionRange(ed.value.indexOf('# Dune')); });
  await page.keyboard.press('ArrowUp'); await sleep(150);
  assert((await act()).startsWith('published|'), '↑ from the first line goes into the properties');
  await page.keyboard.press('ArrowUp'); await sleep(50);
  assert((await act()).startsWith('read|'), '↑ again moves up a row');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await sleep(100);
  assert((await act()).includes('pp-add'), '↓ past the last row reaches Add property');
  await page.keyboard.press('ArrowDown'); await sleep(100);
  assert(await page.evaluate(() => ed.view.hasFocus && ed.value.slice(ed.selectionStart).startsWith('# Dune')), 'and ↓ again returns to the text');
  const before = await page.evaluate(() => ed.value);
  await page.click(row('read') + ' .pp-check'); await sleep(150);
  await page.evaluate(() => ed.focus()); await page.keyboard.press('Control+z'); await sleep(150);
  assert(await page.evaluate(() => ed.value) === before, 'Ctrl+Z undoes a property edit');

  console.log('collapse');
  await page.click('.cm-props-block .pp-fold'); await sleep(200);
  assert(await page.$('.cm-props-block.pp-collapsed, .cm-props-block .pp-collapsed') && !(await page.$(row('rating'))), 'folds away');
  await page.click('.cm-props-block .pp-fold'); await sleep(200);

  console.log('reading view');
  await page.evaluate(() => setMode('read')); await sleep(300);
  assert(await page.$('#preview .pp-host .pp-row[data-key="rating"]'), 'reading view shows the same table');
  await page.click('#preview .pp-row[data-key="read"] .pp-check'); await sleep(250);
  const r1 = await saved();
  assert(/read: (true|false)/.test(r1) && (await page.$eval('#preview .pp-row[data-key="read"] .pp-check', c => c.checked)) === /read: true/.test(r1), 'and edits from there');

  console.log('new properties with Ctrl+;');
  await open('Plain');
  await page.evaluate(() => { ed.focus(); ed.setSelectionRange(ed.value.length); });
  await page.keyboard.press('Control+;'); await sleep(300);
  assert(await page.evaluate(() => document.activeElement.placeholder === 'Property name'), 'asks for a name');
  await page.keyboard.type('rating'); await page.keyboard.press('Enter'); await sleep(250);
  assert(/^---\nrating:\n---\nNo properties yet/.test(await saved()), 'frontmatter created at the top');
  assert(await page.$(row('rating') + ' .pp-input[type=number]'), 'a name typed elsewhere keeps its type (number)');

  console.log('source mode and bad YAML');
  await open('Broken');
  assert(!(await page.$('.cm-props-block')) && await page.$('#editor .cm-frontmatter'), 'frontmatter that isn\'t valid YAML stays as text');
  await page.evaluate(() => { cfg.properties = 'source'; S.version++; ed.refresh(); });
  await open('Book');
  assert(!(await page.$('.cm-props-block')) && await page.$('#editor .cm-frontmatter'), 'the Source setting shows the YAML');
  await page.evaluate(() => { cfg.properties = 'visible'; });

  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
