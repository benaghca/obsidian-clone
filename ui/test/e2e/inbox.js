const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const B = require('../../inboxboard.js');
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
const BOARD = 'Inbox/Inbox.canvas';
const ex = p => fs.existsSync(path.join(VAULT, p));
const boardText = () => ex(BOARD) ? fs.readFileSync(path.join(VAULT, BOARD), 'utf8') : null;
// The board as saved on disk, read the way Cinder reads it: [[lane name, [file names…]], …]
const saved = () => {
  const files = fs.readdirSync(path.join(VAULT, 'Inbox')).filter(f => f !== 'Inbox.canvas').map(f => 'Inbox/' + f);
  const b = B.readBoard(boardText(), files, p => ({ mtime: fs.statSync(path.join(VAULT, p)).mtimeMs, kind: 'text', length: 0 }), 'Inbox');
  return b.lanes.map(l => [l.name, l.stickies.map(s => path.basename(s.path) + (s.color ? ':' + s.color : ''))]);
};
(async () => {
  const pic = n => fs.readFileSync(`${FIX}/fieldpics/${n}.png`);
  put('Inbox/ridge.png', pic('ridge'), 0, 9); put('Inbox/crater.png', pic('crater'), 0, 11);
  put('Inbox/Crater rim.md', 'Rim is steeper on the **north** side.\nGas smell near the east vent.', 0, 12);
  put('Inbox/flow.png', pic('flow'), 1, 14); put('Inbox/Lava flow.md', 'Flow front advanced ~20 m since last week.', 1, 15);
  put('Inbox/Ash sample.md', 'Bagged sample #7 at the trailhead.', 3, 10);
  put('Pictures/sample.png', pic('sample'), 5, 10);
  put('Trip log.md', '# Trip log\n\nEarlier notes.\n', 10, 9);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, colorScheme: 'dark' });
  const errors = []; global.PAGE = page;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const lanes = () => page.$$eval('#view-inbox .ib-lane', ls => ls.map(l => [l.querySelector('.ib-lane-name').textContent.replace('📌 ', ''), [...l.querySelectorAll('.ib-card')].map(c => c.dataset.path.split('/').pop())]));
  const sticky = n => `#view-inbox .ib-lane .ib-card[data-path="Inbox/${n}"]`;
  const lane = name => page.evaluateHandle(n => [...document.querySelectorAll('#view-inbox .ib-lane')].find(l => l.querySelector('.ib-lane-name').textContent.replace('📌 ', '') === n), name);
  const badge = () => page.$eval('[data-cmd=inbox] .rb-badge', b => b.hidden ? '' : b.textContent);

  console.log('the board');
  assert(await badge() === '6', 'the ribbon counts the 6 things in New');
  await page.click('[data-cmd=inbox]'); await sleep(500);
  const first = await lanes();
  assert(JSON.stringify(first) === JSON.stringify([['Pinned', []], ['New', ['Crater rim.md', 'crater.png', 'ridge.png', 'Lava flow.md', 'flow.png', 'Ash sample.md']]]), 'Pinned and New, with everything in New, newest first: ' + JSON.stringify(first));
  assert(await page.$eval(sticky('Crater rim.md') + ' .ib-text', e => e.querySelector('strong')?.textContent === 'north'), 'text stickies show their note rendered');
  assert(await page.$(sticky('crater.png') + ' img'), 'photos are picture stickies');
  assert(await page.$$eval('#view-inbox .ib-lane .ib-card.new', c => c.length) === 6, 'everything is new on the first visit');
  assert(await page.$('.ib-orphans') && boardText() === null, 'photos no note uses are offered below, and there’s no board file until something is arranged');
  await page.screenshot({ path: SP + '/shots/inbox.png' });

  console.log('lanes');
  await page.click('[data-ib=addlane]'); await sleep(150); await page.keyboard.type('Volcano'); await page.keyboard.press('Enter'); await sleep(600);
  assert(JSON.stringify((await lanes()).map(l => l[0])) === '["Pinned","New","Volcano"]' && JSON.stringify(saved().map(l => l[0])) === '["Pinned","New","Volcano"]', '+ Lane adds a lane, and the board is saved as Inbox.canvas');
  await page.click('[data-ib=addlane]'); await sleep(150); await page.keyboard.type('Later'); await page.keyboard.press('Enter'); await sleep(500);
  await page.evaluate(h => h.querySelector('[data-ib=lanemenu]').click(), await lane('Later')); await sleep(150);
  await page.click('.menu >> text=Move left'); await sleep(500);
  assert(JSON.stringify(saved().map(l => l[0])) === '["Pinned","New","Later","Volcano"]', 'a lane’s menu moves it left');
  await page.evaluate(h => h.querySelector('[data-ib=lanemenu]').click(), await lane('Volcano')); await sleep(150);
  await page.click('.menu >> text=Rename…'); await sleep(150); await page.keyboard.press('Control+a'); await page.keyboard.type('Volcanoes'); await page.keyboard.press('Enter'); await sleep(500);
  await page.evaluate(h => h.querySelector('[data-ib=lanemenu]').click(), await lane('Later')); await sleep(150);
  await page.click('.menu >> text=Delete lane'); await sleep(500);
  assert(JSON.stringify(saved().map(l => l[0])) === '["Pinned","New","Volcanoes"]', 'and renames and deletes it (an empty lane goes without asking)');

  console.log('moving stickies');
  await page.dragAndDrop(sticky('Crater rim.md'), '#view-inbox .ib-lane:nth-of-type(3) .ib-stack'); await sleep(600);
  await page.dragAndDrop(sticky('crater.png'), '#view-inbox .ib-lane:nth-of-type(3) .ib-stack'); await sleep(600);
  assert(JSON.stringify(saved()[2]) === '["Volcanoes",["Crater rim.md","crater.png"]]', 'dragging moves stickies to another lane: ' + JSON.stringify(saved()[2]));
  await page.mouse.move(0, 0); await sleep(300); // let the last drop's hover lift settle, or Playwright sees the target moving and scrolls mid-drag
  await page.dragAndDrop(sticky('crater.png'), sticky('Crater rim.md'), { targetPosition: { x: 40, y: 4 } }); await sleep(600);
  assert(JSON.stringify(saved()[2][1]) === '["crater.png","Crater rim.md"]', 'and dropping on the top half of another reorders them: ' + JSON.stringify(saved()[2][1]));
  await page.hover(sticky('Lava flow.md')); await page.click(sticky('Lava flow.md') + ' [data-ib=pin]'); await sleep(500);
  assert(JSON.stringify(saved()[0]) === '["Pinned",["Lava flow.md"]]', '📌 pins a sticky');
  await page.hover(sticky('Lava flow.md')); await page.click(sticky('Lava flow.md') + ' [data-color="4"]'); await sleep(500);
  assert(saved()[0][1][0] === 'Lava flow.md:4' && await page.$eval(sticky('Lava flow.md'), c => c.classList.contains('c-4')), 'a colour dot colours it');
  // A coloured sticky is washed with its colour over the theme's card; a plain one is the theme's card.
  const look = await page.evaluate(([c, p]) => {
    const probe = document.createElement('div'); probe.style.background = 'var(--bg2)'; document.querySelector(c).parentNode.append(probe);
    const out = { coloured: getComputedStyle(document.querySelector(c)).backgroundColor, plain: getComputedStyle(document.querySelector(p)).backgroundColor, theme: getComputedStyle(probe).backgroundColor };
    probe.remove(); return out;
  }, [sticky('Lava flow.md'), sticky('Ash sample.md')]);
  assert(look.coloured !== look.theme && look.plain === look.theme, 'a colour tints the whole sticky, and plain ones stay neutral: ' + JSON.stringify(look));
  assert(await page.$$eval('#view-inbox .ib-lane:not([data-kind=new]) .ib-card.new', c => c.length) === 0 && await page.$$eval('#view-inbox .ib-lane[data-kind=new] .ib-card.new', c => c.length) > 0, 'only stickies still in New are marked new');
  assert(await page.$(sticky('Lava flow.md') + ' .ib-meta .ib-tools'), 'the tools sit in the sticky’s bottom row');
  assert(await page.$(sticky('Lava flow.md') + ' [data-ib=pin] svg'), 'the pin is an icon, not an emoji');
  assert(await badge() === '3', 'the badge counts only what’s left in New');

  console.log('editing in place');
  await page.click(sticky('Lava flow.md') + ' .ib-text'); await sleep(300);
  assert(await page.$(sticky('Lava flow.md') + '.editing .cm-editor'), 'clicking a text sticky edits it right there');
  await page.keyboard.press('Control+End'); await page.keyboard.type(' Photos taken.'); await sleep(1200);
  assert(fs.readFileSync(path.join(VAULT, 'Inbox/Lava flow.md'), 'utf8').includes('last week. Photos taken.'), 'it saves as you type');
  await page.keyboard.press('Escape'); await sleep(300);
  assert(!(await page.$('#view-inbox .ib-card.editing')) && (await page.textContent(sticky('Lava flow.md'))).includes('Photos taken.'), 'Esc stops editing and shows the new text');

  console.log('keys and triage');
  await page.focus(sticky('ridge.png')); await page.evaluate(() => setInboxFocus('Inbox/ridge.png'));
  await page.keyboard.press('p'); await sleep(500);
  assert(JSON.stringify(saved()[0][1]) === '["ridge.png","Lava flow.md:4"]', 'P pins the focused sticky');
  await page.keyboard.press('p'); await sleep(500);
  assert(saved()[1][1][0] === 'ridge.png', 'and unpins it to the top of New');
  await page.focus(sticky('Ash sample.md')); await page.evaluate(() => setInboxFocus('Inbox/Ash sample.md'));
  await page.keyboard.press('Space'); await sleep(150);
  assert(await page.$eval('.ib-bar b', b => b.textContent) === '1 selected', 'Space selects');
  await page.click('.ib-bar [data-ib=append]'); await sleep(200);
  await page.keyboard.type('Trip log'); await page.keyboard.press('Enter'); await sleep(900);
  assert(/Earlier notes\.\n\n## Ash sample\n\nBagged sample #7/.test(fs.readFileSync(path.join(VAULT, 'Trip log.md'), 'utf8')) && !ex('Inbox/Ash sample.md') && !(await page.$(sticky('Ash sample.md'))), 'Add to a note appends it and it leaves the board');
  await page.fill('.ib-capture input', 'Call the ranger station about access'); await page.keyboard.press('Enter'); await sleep(700);
  const captured = fs.readdirSync(path.join(VAULT, 'Inbox')).find(f => /^\d{4}-\d\d-\d\d \d{4}\.md$/.test(f));
  assert(captured && (await lanes())[1][1][0] === captured, 'jotting at the top adds a sticky to the top of New');
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 30; c.height = 20; c.getContext('2d').fillRect(0, 0, 30, 20);
    const blob = await new Promise(r => c.toBlob(r)); const dt = new DataTransfer(); dt.items.add(new File([blob], 'dropped.png', { type: 'image/png' }));
    document.querySelector('#view-inbox').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }); await sleep(800);
  assert(ex('Inbox/dropped.png') && await page.$(sticky('dropped.png')), 'dropping a file adds a sticky');
  await page.hover(sticky('flow.png')); await page.click(sticky('flow.png') + ' .ib-check'); await page.click('.ib-bar [data-ib=move]'); await sleep(200);
  await page.keyboard.type('Pictures'); await page.keyboard.press('Enter'); await sleep(900);
  assert(ex('Pictures/flow.png') && !ex('Inbox/flow.png'), 'File to folder moves it');
  await page.evaluate(h => h.querySelector('[data-ib=lanemenu]').click(), await lane('Volcanoes')); await sleep(150);
  await page.click('.menu >> text=Make a note from this lane'); await sleep(250);
  assert(await page.$eval('.ib-combine h3', h => h.textContent) === 'Make a note from 2 items', 'a lane can become one note');
  await page.fill('.ib-combine [name=t]', 'Crater visit'); await page.click('.ib-combine .btn.primary'); await sleep(1500);
  assert(/## Crater rim\n\nRim is steeper/.test(fs.readFileSync(path.join(VAULT, 'Crater visit.md'), 'utf8')), 'with the notes as sections and the photos embedded');

  console.log('jotting from anywhere');
  await page.evaluate(() => openPath('Trip log.md')); await sleep(500);
  await page.keyboard.press('Control+Shift+j'); await sleep(250);
  assert(await page.$('.ib-jot textarea:focus'), 'Ctrl+Shift+J opens a jot box from a note');
  await page.keyboard.type('Buy more sample bags'); await page.keyboard.press('Enter'); await sleep(700);
  assert(!(await page.$('.ib-jot')) && await page.evaluate(() => S.view === 'note' && S.cur === 'Trip log.md'), 'Enter saves it and leaves you where you were');
  const jotted = fs.readdirSync(path.join(VAULT, 'Inbox')).filter(f => /^\d{4}-\d\d-\d\d \d{4}( \d+)?\.md$/.test(f)).find(f => fs.readFileSync(path.join(VAULT, 'Inbox', f), 'utf8').startsWith('Buy more sample bags'));
  assert(jotted, 'as a note in the inbox');
  await page.click('[data-cmd=inbox]'); await sleep(500);
  assert((await lanes())[1][1][0] === jotted, 'at the top of New');

  console.log('pasting and screenshots');
  const newTop = async () => (await lanes())[1][1][0];
  const pasteImage = sel => page.evaluate(async sel => {
    const c = document.createElement('canvas'); c.width = 40; c.height = 30; c.getContext('2d').fillRect(0, 0, 40, 30);
    const blob = await new Promise(r => c.toBlob(r)); const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    document.querySelector(sel).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, sel);
  await page.click('.ib-head h2'); await pasteImage('#view-inbox .ib-lanes'); await sleep(800);
  assert(/^Pasted image \d{14}\.png$/.test(await newTop()), 'pasting an image on the board adds it to the top of New: ' + await newTop());
  await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'Pasted: check the gate code'); document.querySelector('#view-inbox .ib-lanes').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }); await sleep(800);
  assert(fs.readFileSync(path.join(VAULT, 'Inbox', await newTop()), 'utf8').startsWith('Pasted: check the gate code'), 'and pasting text there jots it as a sticky');
  await page.fill('.ib-capture input', ''); await page.focus('.ib-capture input'); await pasteImage('.ib-capture input'); await sleep(800);
  assert(/^Pasted image/.test(await newTop()) && await page.$eval('.ib-capture input', i => i.value) === '', 'an image pasted into the jot box becomes a sticky too');
  await page.evaluate(() => openPath('Trip log.md')); await sleep(500);
  await page.keyboard.press('Control+Shift+j'); await sleep(250);
  const before2 = fs.readdirSync(path.join(VAULT, 'Inbox')).length;
  await pasteImage('.ib-jot textarea'); await sleep(800);
  assert(fs.readdirSync(path.join(VAULT, 'Inbox')).length === before2 + 1 && !(await page.$('.ib-jot')) && await page.evaluate(() => S.view === 'note'), 'pasting a screenshot into the Ctrl+Shift+J box adds it and leaves you where you were');
  await page.click('[data-cmd=inbox]'); await sleep(500);
  await page.keyboard.press('Control+Shift+S'); await sleep(1500);
  assert(/^Screenshot .*\.png$/.test(await newTop()), 'Ctrl+Shift+S on the inbox takes a screenshot into New: ' + await newTop());

  console.log('arrivals and a damaged board');
  await page.click('[data-cmd=inbox]'); await sleep(500);
  const before = boardText();
  put('Inbox/From phone.md', 'Synced from my phone', 0, 23); await sleep(1800);
  assert((await lanes())[1][1][0] === 'From phone.md' && boardText() === before, 'a file arriving on disk shows at the top of New, and the board file isn’t touched');
  fs.writeFileSync(path.join(VAULT, BOARD), '{ not a board'); await sleep(1800);
  assert(await page.$('.ib-broken') && (await lanes()).length === 2, 'a board file that can’t be read shows a notice, with everything in New');
  await page.hover(sticky('ridge.png')); await page.click(sticky('ridge.png') + ' [data-ib=pin]'); await sleep(600);
  assert(!(await page.$('.ib-broken')) && saved()[0][1][0] === 'ridge.png', 'arranging again writes a good board');
  await page.screenshot({ path: SP + '/shots/inbox-board.png' });

  console.log('a big board');
  for (let i = 1; i <= 24; i++) put(`Inbox/Big ${i}.md`, `Sticky number ${i}, long enough to wrap onto a second line.`, 0, 8);
  for (let i = 1; i <= 5; i++) await page.evaluate(n => changeBoard({ addLane: n }), 'Lane ' + i);
  await sleep(1800);
  const geo = () => page.evaluate(() => {
    const v = document.querySelector('#view-inbox'), l = document.querySelector('.ib-lanes'), s = document.querySelector('.ib-lane[data-kind=new] .ib-stack');
    return { pageScrolls: v.scrollHeight > v.clientHeight + 1, lanesBottom: l.getBoundingClientRect().bottom, viewBottom: v.getBoundingClientRect().bottom, left: l.scrollLeft, wide: l.scrollWidth > l.clientWidth, stackTop: s.scrollTop, stackScrolls: s.scrollHeight > s.clientHeight };
  });
  let g = await geo();
  assert(!g.pageScrolls && g.lanesBottom <= g.viewBottom + 1 && g.wide, 'the board fits the window and scrolls sideways: ' + JSON.stringify(g));
  assert(g.stackScrolls, 'a long lane scrolls on its own');
  const box = await page.$eval('#view-inbox .ib-lane[data-kind=new] .ib-stack .ib-card', c => { const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y); await page.mouse.wheel(0, 300); await sleep(300);
  g = await geo();
  assert(g.stackTop > 0 && g.left === 0, 'the wheel over a lane scrolls that lane');
  const gap = await page.$eval('#view-inbox .ib-lane[data-kind=pinned]', l => { const r = l.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.bottom + 30 }; });
  await page.mouse.move(gap.x, gap.y); await page.mouse.wheel(0, 200); await sleep(300);
  g = await geo();
  assert(g.left > 0, 'the wheel over empty board scrolls sideways: ' + g.left);
  const was = g.left;
  const empty = await page.$eval('#view-inbox .ib-lanes', ls => {
    const box = ls.getBoundingClientRect();
    const l = [...ls.querySelectorAll('.ib-lane')].map(x => x.getBoundingClientRect()).filter(r => r.left > box.left && r.right < box.right).sort((a, b) => a.bottom - b.bottom)[0];
    return { x: l.x + l.width / 2, y: l.bottom + 30 };
  });
  await page.mouse.move(empty.x, empty.y); await page.mouse.down(); await page.mouse.move(empty.x + 120, empty.y, { steps: 6 }); await page.mouse.up(); await sleep(200);
  g = await geo();
  assert(Math.abs(was - g.left - 120) <= 2, 'dragging empty board pans it: ' + was + ' → ' + g.left);
  await page.evaluate(() => renderInbox()); await sleep(200);
  assert((await geo()).stackTop > 0, 'lanes keep their scroll when the board redraws');
  await page.evaluate(p => openPath(p), BOARD); await sleep(800);
  assert(await page.evaluate(() => S.view === 'canvas' && CinderCanvas.getData().nodes.some(n => n.type === 'group' && n.label === '📌 Pinned')), 'Inbox.canvas opens as a canvas, with the lanes as groups');

  console.log('ERRORS:', errors.join('\n') || 'none');
  if (errors.length) process.exitCode = 1;
  await browser.close();
})().catch(async e => { console.log(e.message); try { await global.PAGE.screenshot({ path: SP + '/shots/fail.png' }); } catch {} process.exit(1); });
