const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const FIX = __dirname + '/fixtures';
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const put = (p, data, daysAgo, hour) => {
  fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true });
  fs.writeFileSync(path.join(VAULT, p), data);
  const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 15, 0, 0);
  fs.utimesSync(path.join(VAULT, p), d, d);
};
(async () => {
  const pic = n => fs.readFileSync(`${FIX}/fieldpics/${n}.png`);
  put('Inbox/ridge.png', pic('ridge'), 0, 9); put('Inbox/crater.png', pic('crater'), 0, 11);
  put('Inbox/Crater rim.md', 'Rim is steeper on the north side.\nGas smell near the east vent.', 0, 12);
  put('Inbox/flow.png', pic('flow'), 1, 14); put('Inbox/Lava flow.md', 'Flow front advanced ~20 m since last week.', 1, 15);
  put('Inbox/Ash sample.md', 'Bagged sample #7 at the trailhead.', 3, 10);
  put('Pictures/sample.png', pic('sample'), 5, 10);
  put('Trip log.md', '# Trip log\n\nEarlier notes.\n', 10, 9);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const ex = p => fs.existsSync(path.join(VAULT, p));

  assert(await page.$eval('[data-cmd=inbox] .rb-badge', b => !b.hidden && b.textContent === '6'), 'the ribbon button shows 6 in the inbox');
  await page.click('[data-cmd=inbox]'); await sleep(500);
  const days = await page.$$eval('.ib-day h3 span', s => s.map(x => x.textContent));
  assert(days[0] === 'Today' && days[1] === 'Yesterday' && days.length === 3, 'grouped by the day things were made: ' + days.join(' | '));
  assert(await page.$$eval('section.ib-day:first-of-type .ib-card .ib-thumb img', i => i.length) === 2 && await page.$eval('.ib-card[data-path="Inbox/Crater rim.md"] .ib-text', t => t.textContent.startsWith('Rim is steeper')), 'photos as thumbnails, notes as their first lines');
  assert(await page.$$eval('.ib-card.new', c => c.length) === 6, 'everything is new on the first visit');
  assert(await page.$('.ib-orphans') && /Photos no note uses yet/.test(await page.$eval('.ib-orphans', e => e.textContent)), 'a photo elsewhere that no note uses is offered too');
  await page.screenshot({ path: SP + '/shots/inbox.png' });

  console.log('keyboard and selection');
  await page.focus('.ib-card[data-path="Inbox/crater.png"]'); await page.evaluate(() => setInboxFocus('Inbox/crater.png'));
  await page.keyboard.press('Space'); await sleep(100);
  await page.keyboard.press('ArrowRight'); await sleep(50); await page.keyboard.press('Space'); await sleep(100);
  assert(await page.$eval('.ib-bar b', b => b.textContent) === '2 selected', 'Space selects, arrows move');
  await page.screenshot({ path: SP + '/shots/inbox-sel.png' });
  await page.keyboard.press('Escape'); await sleep(100);
  assert(await page.$eval('.ib-bar', b => b.hidden), 'Esc clears the selection');

  console.log('a day becomes a note');
  await page.click('section.ib-day:first-of-type [data-ib=day]'); await sleep(300);
  assert(await page.$eval('.ib-combine h3', h => h.textContent) === 'Make a note from 3 items', 'Make a note from this day asks for a title');
  const title = await page.inputValue('.ib-combine [name=t]');
  assert(/^Field notes \d{4}-\d\d-\d\d$/.test(title), 'suggesting "Field notes <date>"');
  await page.click('.ib-combine .btn.primary'); await sleep(1500);
  const note = fs.readFileSync(path.join(VAULT, title + '.md'), 'utf8');
  assert(/^!\[\[ridge\.png\]\]\n\n!\[\[crater\.png\]\]\n\n## Crater rim\n\nRim is steeper/.test(note), 'photos embedded and notes as sections, in the order they were made:\n' + note);
  assert(ex('attachments/ridge.png') && !ex('Inbox/ridge.png') && !ex('Inbox/Crater rim.md'), 'photos moved to attachments, the text cleared from the inbox');
  assert(await page.evaluate(t => S.cur === t + '.md', title), 'and the note opens');

  console.log('append, capture, drop');
  await page.click('[data-cmd=inbox]'); await sleep(400);
  assert(!(await page.$$eval('.ib-card.new', c => c.length)), 'coming back, nothing is "new" any more');
  await page.click('.ib-card[data-path="Inbox/Ash sample.md"] .ib-check'); await sleep(100);
  await page.click('.ib-bar [data-ib=append]'); await sleep(200);
  await page.keyboard.type('Trip log'); await page.keyboard.press('Enter'); await sleep(900);
  assert(/Earlier notes\.\n\n## Ash sample\n\nBagged sample #7/.test(fs.readFileSync(path.join(VAULT, 'Trip log.md'), 'utf8')) && !ex('Inbox/Ash sample.md'), 'Add to a note appends it and clears it from the inbox');
  await page.fill('.ib-capture input', 'Call the ranger station about access'); await page.keyboard.press('Enter'); await sleep(600);
  const captured = fs.readdirSync(path.join(VAULT, 'Inbox')).find(f => /^\d{4}-\d\d-\d\d \d{4}\.md$/.test(f));
  assert(captured && fs.readFileSync(path.join(VAULT, 'Inbox', captured), 'utf8').startsWith('Call the ranger'), 'typing at the top adds a note to the inbox');
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 30; c.height = 20; c.getContext('2d').fillRect(0, 0, 30, 20);
    const blob = await new Promise(r => c.toBlob(r)); const dt = new DataTransfer(); dt.items.add(new File([blob], 'dropped.png', { type: 'image/png' }));
    document.querySelector('#view-inbox').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }); await sleep(800);
  assert(ex('Inbox/dropped.png') && await page.$('.ib-card[data-path="Inbox/dropped.png"]'), 'dropping a file adds it');
  await page.click('.ib-card[data-path="Inbox/flow.png"] .ib-check'); await page.click('.ib-bar [data-ib=move]'); await sleep(200);
  await page.keyboard.type('Pictures'); await page.keyboard.press('Enter'); await sleep(900);
  assert(ex('Pictures/flow.png') && !ex('Inbox/flow.png'), 'File to folder moves it');
  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
