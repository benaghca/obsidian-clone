// The vault's settings file, .cinder/settings.json: seeded from Obsidian's settings for a vault new
// to Cinder, written when a setting changes, applied when it's edited outside, never overwritten
// while it doesn't read, and made from this window's settings the first time for a vault Cinder knows.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const FILE = path.join(VAULT, '.cinder/settings.json');
const file = () => fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
(async () => {
  w('Note.md', '# Note\n');
  w('00 - System/Templates/Daily.md', '# <% tp.date.now("dddd") %>\n');
  w('.obsidian/daily-notes.json', JSON.stringify({ folder: '10 - Timestamps', format: 'YYYY/MM-MMMM/YYYY-MM-DD-dddd', template: '00 - System/Templates/Daily' }));
  w('.obsidian/templates.json', JSON.stringify({ folder: '00 - System/Templates' }));
  const browser = await browserLaunch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = []; global.PAGE = page;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(1200);

  console.log('a vault new to Cinder');
  assert(await page.evaluate(() => cfg.dailyFolder === '10 - Timestamps' && cfg.templatesFolder === '00 - System/Templates'), 'takes its first settings from Obsidian’s');
  assert(JSON.stringify(file()) === JSON.stringify({ dailyFolder: '10 - Timestamps', dailyFormat: 'YYYY/MM-MMMM/YYYY-MM-DD-dddd', dailyTemplate: '00 - System/Templates/Daily', templatesFolder: '00 - System/Templates' }), 'and writes them to .cinder/settings.json: ' + JSON.stringify(file()));

  await sleep(500);
  const ref = fs.existsSync(path.join(VAULT, '.cinder/settings.md')) ? fs.readFileSync(path.join(VAULT, '.cinder/settings.md'), 'utf8') : '';
  assert(ref.includes('- `dailyFolder` (Daily notes folder): ') && ref.includes('default "Daily"') && ref.includes('`note-from-template`: Create new note from template ("Alt-n")') && !ref.includes('`fontText`: '), 'next to it, settings.md lists every setting, its values and default, and the command ids for hotkeys');
  console.log('a guide for assistants');
  const guide = () => fs.readFileSync(path.join(VAULT, '.cinder/README.md'), 'utf8');
  const g = guide();
  assert(g.includes('Templates folder: `00 - System/Templates`. Templates in it: `Daily`.') && g.includes('Daily notes: in `10 - Timestamps`, named `YYYY/MM-MMMM/YYYY-MM-DD-dddd`, template `00 - System/Templates/Daily`'), 'README.md next to it describes this vault as it is set up');
  assert(g.includes('`tp.system.prompt(question, default?, throwOnCancel?, multiline?)`') && g.includes('`multitext` (List)') && g.includes('## Ground rules'), 'with the template commands Cinder supports, the property types, and ground rules');
  const run = () => page.evaluate(() => CMD_BY_ID.get('assistant-instructions').run());
  await run(); await sleep(800);
  const agents = () => fs.readFileSync(path.join(VAULT, 'AGENTS.md'), 'utf8');
  assert(/^# Instructions for AI assistants\n/.test(agents()) && agents().includes('read `.cinder/README.md`'), '"Add assistant instructions" makes an AGENTS.md pointing to it');
  const once = agents(); await run(); await sleep(500);
  assert(agents() === once, 'and doesn’t add it twice');
  fs.writeFileSync(path.join(VAULT, 'AGENTS.md'), '# My rules\n\nAsk before moving notes.\n'); await sleep(2800);
  await run(); await sleep(800);
  assert(agents().startsWith('# My rules\n\nAsk before moving notes.\n\n## Cinder\n\n') && agents().includes('.cinder/README.md'), 'an AGENTS.md of your own keeps its rules and gets the pointer added');

  console.log('changes made in Cinder');
  await page.evaluate(() => { cfg.inboxFolder = 'Capture'; cfg.fontText = 'Inter'; saveCfg(); }); await sleep(900);
  assert(file().inboxFolder === 'Capture' && !('fontText' in file()), 'a setting changed here is written; a machine setting (the font) isn’t');
  assert(!fs.readdirSync(path.join(VAULT, '.cinder')).some(f => f.endsWith('.cinder-tmp')), 'no temp file left behind');
  assert(!(await page.$('.tree [data-path=".cinder"], .tree [data-path=".cinder/settings.json"]')), 'the file tree doesn’t show it');

  console.log('changes made outside');
  fs.writeFileSync(FILE, JSON.stringify({ ...file(), theme: 'light', futureSetting: { keep: true }, inboxFolder: 'Inbox' }, null, 2)); await sleep(2800);
  assert(await page.evaluate(() => cfg.theme === 'light' && document.documentElement.dataset.theme === 'light' && cfg.inboxFolder === 'Inbox'), 'an edit to the file is applied: the theme changes');
  await page.evaluate(() => { cfg.taskDoneDate = false; saveCfg(); }); await sleep(900);
  assert(file().taskDoneDate === false && file().futureSetting?.keep === true && !('inboxFolder' in file()), 'keys Cinder doesn’t know are kept, and a setting back at its default leaves the file');

  console.log('a change, then a reload straight away');
  await page.evaluate(() => { cfg.palette = 'nord'; saveCfg(); }); await page.reload(); await sleep(1500);
  assert(await page.evaluate(() => cfg.palette === 'nord') && file().palette === 'nord', 'a change not yet written when the window reloads isn’t lost: it goes to the file');

  console.log('a file with a mistake');
  fs.writeFileSync(FILE, '{ "theme": "dark", '); await sleep(2800);
  assert(await page.evaluate(() => [...document.querySelectorAll('.toast')].some(t => /settings\.json has a mistake/.test(t.textContent))), 'says so');
  assert(await page.evaluate(() => cfg.theme === 'light'), 'keeps the last good settings');
  await page.evaluate(() => { cfg.statusChars = true; saveCfg(); }); await sleep(900);
  assert(fs.readFileSync(FILE, 'utf8') === '{ "theme": "dark", ', 'and doesn’t overwrite it');
  fs.writeFileSync(FILE, JSON.stringify({ theme: 'dark' })); await sleep(2800);
  assert(await page.evaluate(() => cfg.theme === 'dark' && cfg.statusChars === false && cfg.dailyFolder === 'Daily'), 'once it reads again, it’s the settings (what it leaves out is the default)');

  console.log('a vault Cinder already has settings for');
  await page.close(); // (an open window would put the file straight back from its own settings)
  fs.rmSync(path.join(VAULT, '.cinder'), { recursive: true });
  const page2 = await browser.newPage();
  await page2.addInitScript(() => localStorage.setItem('folio:vault:settings', JSON.stringify({ dailyFolder: 'Journal', vim: true, fontMono: 'Fira Code' })));
  await page2.goto('http://127.0.0.1:43199/'); await sleep(1200);
  assert(JSON.stringify(file()) === JSON.stringify({ dailyFolder: 'Journal', vim: true }), 'its settings move into the file (not the machine ones): ' + JSON.stringify(file()));
  await page2.close();

  console.log('ERRORS:', errors.join('\n') || 'none');
  assert(!errors.length, 'no page errors');
  await browser.close();
})().catch(async e => { console.log(e.message); try { await global.PAGE.screenshot({ path: SP + '/shots/fail.png' }); } catch {} process.exit(1); });

function browserLaunch() { return chromium.launch(); }
