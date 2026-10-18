// Fresh-vault plugin defaults, and turning one on from Settings. The test runner sets CINDER_E2E,
// which forces every plugin on while the saved choice is still the default. This suite asks for
// the real defaults, then checks that the force still applies to a vault that hasn't chosen.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
// The first navigation sometimes never fires `load` (a hung proxy, or the vault's long-poll
// /api/changes still pending). Wait for the document and for the app, and try again.
async function loadApp(page) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto('http://127.0.0.1:43199/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => typeof cfg === 'object' && typeof pluginOn === 'function' && !!document.querySelector('#ribbon [data-cmd]'), null, { timeout: 20000 });
      await sleep(250);
      return;
    } catch (e) { last = e; await sleep(400); }
  }
  throw last;
}
(async () => {
  fs.writeFileSync(path.join(VAULT, 'A.md'), '# A\n\nSee [[B]].\n\n- [ ] one task\n');
  const browser = await chromium.launch({ args: ['--no-proxy-server', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1280, height: 820 } });
  await page.addInitScript(() => localStorage.setItem('cinder:plugins-mode', 'default'));
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await loadApp(page);

  const shown = sel => page.$eval(sel, el => !el.hidden);
  assert(await shown('#ribbon [data-cmd=panel-files]') && await shown('#ribbon [data-cmd=panel-search]') && await shown('#ribbon [data-cmd=graph]'), 'files, search and the graph are on');
  assert(await shown('#left .side-tabs [data-cmd=panel-files].active'), 'the left sidebar has a Files tab, and it is the current one');
  assert(!(await shown('#ribbon [data-cmd=tasks]')) && !(await shown('#ribbon [data-cmd=daily]')) && !(await shown('#ribbon [data-cmd=new-drawing]')), 'tasks, daily notes and drawings are off');
  assert(await page.evaluate(() => document.getElementById('statusbar').previousElementSibling.id === 'app'), 'the status bar runs along the bottom of the window');
  assert(await page.$eval('#view-empty h2', h => h.textContent) === 'No file is open', 'an empty window says no file is open');
  assert(await page.$eval('#view-empty [data-plugin=graph]', p => !p.hidden) && await page.$eval('#view-empty [data-plugin=tasks]', p => p.hidden), 'its links follow which plugins are on');

  await page.keyboard.press('Control+p'); await sleep(200);
  await page.keyboard.type('Open tasks'); await sleep(200);
  const palette = () => page.$$eval('.pick-list .main', els => els.map(e => e.textContent));
  assert(!(await palette()).includes('Open tasks'), 'the command palette hides Open tasks while Tasks is off');
  await page.keyboard.press('Escape'); await sleep(150);

  await page.click('[data-cmd=settings]'); await sleep(250);
  assert(await page.$('.st-page[data-page=plugins]') && await page.$('.st-page[data-page=community]'), 'Settings has Core plugins and Community plugins');
  await page.click('.st-page[data-page=plugins]'); await sleep(150);
  assert(await page.$eval('#plug-file-explorer', el => el.checked) && await page.$eval('#plug-daily-notes', el => !el.checked), 'core plugins start as a fresh Obsidian vault: files on, daily notes off');
  await page.click('.st-page[data-page=community]'); await sleep(150);
  assert(await page.$eval('#plug-tasks', el => !el.checked), 'Tasks starts off');
  // Turning a plugin on or off must leave every row on the page, including the ones that are off,
  // so a switch can be flipped back without leaving Settings.
  const assertRows = async label => {
    const bad = await page.$$eval('.st-content .st-row[data-plug]', els => els.flatMap(el => {
      const id = el.dataset.plug;
      const visible = !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
      const problems = [];
      if (!visible) problems.push(id + ' hidden');
      if (el.querySelector('input').checked !== pluginOn(id)) problems.push(id + ' switch does not match');
      return problems;
    }));
    assert(!bad.length, label + (bad.length ? ': ' + bad.join('; ') : ''));
  };
  const flip = async id => {
    const before = await page.$eval('#plug-' + id, el => el.checked);
    await page.click(`.st-row[data-plug="${id}"] .switch`); await sleep(200);
    const after = await page.$eval('#plug-' + id, el => el.checked);
    assert(after === !before, id + ' flips');
  };
  await assertRows('community rows are all on the page before a switch');
  for (const id of ['calendar', 'dataview', 'tasks', 'kanban']) await flip(id);
  await assertRows('turning several community plugins on keeps every row, including ones still off');
  for (const id of ['calendar', 'dataview', 'kanban', 'tasks']) await flip(id);
  await assertRows('turning them off keeps their own rows, so they can be turned on again');
  await flip('tasks');
  await assertRows('Tasks stays listed after it is turned back on');
  assert(await page.evaluate(() => pluginOn('tasks') && cfg.plugins.tasks === true), 'turning Tasks on enables it');
  await page.click('.st-page[data-page=plugins]'); await sleep(150);
  for (const id of ['graph', 'daily-notes', 'templates']) await flip(id);
  await assertRows('core plugin rows stay when a plugin is turned off');
  for (const id of ['graph', 'daily-notes', 'templates']) await flip(id);
  await assertRows('and when it is turned back on');
  await page.keyboard.press('Escape'); await sleep(200);
  assert(await shown('#ribbon [data-cmd=tasks]'), 'the Tasks icon appears on the ribbon');
  await page.keyboard.press('Control+p'); await sleep(200);
  await page.keyboard.type('Open tasks'); await sleep(200);
  assert((await palette()).includes('Open tasks'), 'and Open tasks is back in the command palette');
  await page.keyboard.press('Escape'); await sleep(150);

  await loadApp(page);
  assert(await shown('#ribbon [data-cmd=tasks]') && !(await shown('#ribbon [data-cmd=daily]')), 'the choice survives a reload, and the others stay off');
  const file = JSON.parse(fs.readFileSync(path.join(VAULT, '.cinder/settings.json'), 'utf8'));
  assert(file.plugins && file.plugins.tasks === true && file.plugins['daily-notes'] === false, 'and it is written to settings.json');
  await ctx.close();

  console.log('the test runner still starts with every plugin on');
  fs.rmSync(path.join(VAULT, '.cinder'), { recursive: true, force: true });
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage({ viewport: { width: 1280, height: 820 } });
  page2.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await loadApp(page2);
  assert(await page2.$eval('#ribbon [data-cmd=tasks]', el => !el.hidden), 'without a saved choice, every plugin is on for the other tests');
  assert(await page2.evaluate(() => cfg.plugins.tasks === false && pluginOn('tasks') === true), 'that force is not written into the vault’s settings');
  const fresh = JSON.parse(fs.readFileSync(path.join(VAULT, '.cinder/settings.json'), 'utf8'));
  assert(!('plugins' in fresh), 'so settings.json stays free of a plugins key: ' + JSON.stringify(fresh));
  await ctx2.close();

  assert(!errors.length, 'no page errors ' + errors.join('; '));
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
