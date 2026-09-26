const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  fs.mkdirSync(path.join(VAULT, 'Templates'), { recursive: true });
  fs.writeFileSync(path.join(VAULT, 'Templates/Meeting.md'), '# Meeting\n\n');
  fs.writeFileSync(path.join(VAULT, 'A.md'), '# A\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const val = () => page.evaluate(() => ed.value);

  await page.evaluate(() => openPath('A.md')); await sleep(300);
  assert(await page.$eval('#template-bar', b => b.hidden).catch(() => true), 'an ordinary note has no template bar');
  await page.evaluate(() => openPath('Templates/Meeting.md')); await sleep(300);
  assert(!(await page.$eval('#template-bar', b => b.hidden)), 'a note in the templates folder shows the template bar');

  await page.evaluate(() => { setMode('edit'); ed.setSelectionRange(ed.value.length); ed.focus(); });
  await page.keyboard.type('Attendees: <%'); await sleep(300);
  const labels = () => page.$$eval('.cm-tooltip-autocomplete li', l => l.map(x => x.querySelector('.cm-completionLabel')?.textContent));
  assert((await labels()).includes('Today’s date'), 'typing <% lists commands in plain words');
  await page.screenshot({ path: OUT + '/tp-complete.png' });
  await page.keyboard.type(' ask'); await sleep(250);
  assert((await labels())[0].startsWith('Ask'), 'typing narrows the list: ' + (await labels()).slice(0, 3).join(' | '));
  await page.keyboard.press('Enter'); await sleep(150);
  await page.keyboard.type('Who is coming?'); await sleep(100);
  assert((await val()).includes('Attendees: <% tp.system.prompt("Who is coming?") %>'), 'Enter inserts the command with its field selected: ' + (await val()).split('\n').pop());

  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.type('Date: <% tp.date.'); await sleep(300);
  assert((await labels()).join(',').startsWith('now,tomorrow,yesterday,weekday'), 'tp.date. lists its functions: ' + (await labels()).join(',') + ' / ' + JSON.stringify((await val()).split('\n').slice(-3)));
  await page.keyboard.press('Enter'); await sleep(100);
  await page.keyboard.type('DD/MM'); await page.keyboard.press('End'); await page.keyboard.type(' %>');
  assert((await val()).includes('Date: <% tp.date.now("DD/MM") %>'), 'and inserts the call with its format to fill in');

  // Insert from the command palette.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+p'); await page.keyboard.type('insert template command'); await page.keyboard.press('Enter'); await sleep(250);
  await page.keyboard.type('cursor'); await page.keyboard.press('Enter'); await sleep(150);
  assert((await val()).includes('<% tp.file.cursor() %>'), 'Insert template command… picks one by name');

  // Preview.
  await page.click('#template-bar [data-tb=preview]'); await sleep(300);
  await page.fill('.modal [name=v]', 'Ann and Bo'); await page.keyboard.press('Enter'); await sleep(400);
  const out = await page.$eval('.tp-src', e => e.textContent);
  assert(out.includes('Attendees: Ann and Bo') && /Date: \d\d\/\d\d/.test(out) && out.includes('‸'), 'Preview fills the template in, asking its questions: ' + JSON.stringify(out));
  await page.screenshot({ path: OUT + '/tp-preview.png' });
  await page.keyboard.press('Escape'); await sleep(100);

  // Cheat sheet.
  await page.click('#template-bar [data-tb=help]'); await sleep(250);
  assert(await page.$$eval('.tp-cmd', b => b.length) > 15, 'the cheat sheet lists the commands');
  await page.screenshot({ path: OUT + '/tp-help.png' });
  await page.fill('.tp-q', 'week'); await sleep(100);
  const vis = await page.$$eval('.tp-cmd', b => b.filter(x => !x.hidden).map(x => x.querySelector('.tp-l').textContent));
  assert(vis.length >= 2 && vis.every(v => /week|Monday/i.test(v)), 'and filters them: ' + vis.join(' | '));
  await page.keyboard.press('Escape'); await sleep(100);

  // A new template.
  await page.keyboard.press('Control+p'); await page.keyboard.type('create new template'); await page.keyboard.press('Enter'); await sleep(250);
  await page.fill('.modal [name=v]', 'Weekly'); await page.keyboard.press('Enter'); await sleep(700);
  assert(await page.evaluate(() => S.cur) === 'Templates/Weekly.md' && fs.readFileSync(path.join(VAULT, 'Templates/Weekly.md'), 'utf8').includes('tp.file.title'), 'Create new template starts one in the templates folder');

  assert(errors.length === 0, 'no page errors ' + errors.join('; '));
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
