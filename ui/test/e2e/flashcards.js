const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const pad = n => String(n).padStart(2, '0');
const day = (plus = 0) => { const d = new Date(); d.setDate(d.getDate() + plus); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const read = p => fs.readFileSync(path.join(VAULT, p), 'utf8');
const TODAY = day();
(async () => {
  fs.writeFileSync(path.join(VAULT, 'Spanish.md'), '---\ntags: [flashcards/spanish]\n---\n# Spanish\n\nhola::hello\ngato:::cat\n\n¿Cómo estás?\n?\nHow are you?\n');
  fs.writeFileSync(path.join(VAULT, 'Science.md'), `#flashcards/science\n\nThe ==sun== is a ==star==.\n\nOld::card\n<!--SR:!${TODAY},4,250-->\n\nWater boils at::100 °C\n<!--SR:!2000-01-01,1,250-->\n`);
  fs.writeFileSync(path.join(VAULT, 'FSRS.md'), '#flashcards\n\nf::s\n<!--SR:!fsrs,2024-01-01,1,2,3,4,5,6,x-->\n');
  fs.writeFileSync(path.join(VAULT, 'Plain.md'), 'no cards::here\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = []; global.PAGE = page;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);

  console.log('decks');
  assert(await page.$eval('[data-cmd=flashcards] .rb-badge', b => !b.hidden && b.textContent === '1'), 'the ribbon shows 1 card due');
  await page.keyboard.press('Control+Shift+y'); await sleep(400);
  assert(await page.evaluate(() => S.view === 'flashcards' && tabName(curTab().key) === 'Flashcards'), 'Ctrl+Shift+Y opens the Flashcards tab');
  const rows = await page.$$eval('.fc-deck', r => r.map(x => [x.querySelector('.fc-name').textContent, x.querySelector('.fc-due').textContent, x.querySelector('.fc-new').textContent]));
  assert(JSON.stringify(rows) === JSON.stringify([['flashcards', '1', '7'], ['science', '1', '3'], ['spanish', '0', '4']]), 'decks with due and new counts: ' + JSON.stringify(rows));
  assert(/1 card uses a schedule format Cinder can’t read yet/.test(await page.textContent('.fc-decks')), 'the FSRS card is counted as unreadable, not reviewed');
  await page.screenshot({ path: SP + '/shots/flashcards-decks.png' });

  console.log('a review');
  await page.click('.fc-deck[data-deck="flashcards/science"]'); await sleep(300);
  assert(await page.textContent('.fc-count') === '1 of 4' && (await page.textContent('.fc-front')).trim() === 'Old', 'the due card comes first: 1 of 4, "Old"');
  assert(await page.$eval('.fc-back', b => b.hidden), 'the answer starts hidden');
  await page.keyboard.press('Space'); await sleep(150);
  assert(await page.$eval('.fc-back', b => !b.hidden && b.textContent.includes('card')), 'Space shows the answer');
  const labels = await page.$$eval('.fc-actions button', b => b.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  assert(labels[2].startsWith('Good · 10 days'), 'each button shows the interval it would set: ' + labels.join(' | '));
  await page.screenshot({ path: SP + '/shots/flashcards-review.png' });
  await page.keyboard.press('3'); await sleep(500);
  assert(read('Science.md').includes(`Old::card\n<!--SR:!${day(10)},10,250-->`), 'Good (3) writes the new schedule into the note');
  assert(await page.textContent('.fc-count') === '2 of 4', 'on to the next card');
  await page.keyboard.press('Space'); await sleep(100); await page.keyboard.press('1'); await sleep(500);
  assert(await page.textContent('.fc-count') === '3 of 5', 'Again (1) brings the card back at the end');
  for (let i = 0; i < 6 && !(await page.$('.fc-done')); i++) { await page.keyboard.press('Space'); await sleep(100); await page.keyboard.press('4'); await sleep(450); }
  assert(/You reviewed 5 cards/.test(await page.textContent('.fc-done')), 'the end screen counts the reviews');
  assert(await page.evaluate(t => allCards().filter(c => c.path === 'Science.md' && c.readable).every(c => c.sides.every(s => s.due && s.due > t)), TODAY), 'every Science card is scheduled into the future');
  assert(await page.$eval('[data-cmd=flashcards] .rb-badge', b => b.hidden), 'nothing is due any more');
  await page.screenshot({ path: SP + '/shots/flashcards-done.png' });

  console.log('one note, and a card that changed');
  await page.evaluate(() => openPath('Spanish.md')); await sleep(500);
  await page.click('[data-cmd=note-menu]'); await sleep(150);
  await page.click('.menu >> text=Review flashcards in this note'); await sleep(400);
  assert(await page.textContent('.fc-count') === '1 of 4' && (await page.textContent('.fc-title')) === 'Spanish', 'the note menu reviews just that note');
  const before = read('Spanish.md').replace('hello', 'hi').replace('cat', 'kitty').replace('How are you?', 'How are you doing?');
  fs.writeFileSync(path.join(VAULT, 'Spanish.md'), before); await sleep(1800);
  await page.keyboard.press('Space'); await sleep(100); await page.keyboard.press('2'); await sleep(500);
  assert(/This card changed since it was shown/.test(await page.textContent('body')), 'answering a card that was edited meanwhile says so');
  assert(read('Spanish.md') === before, 'and writes nothing');
  await page.keyboard.press('Escape'); await sleep(200);

  console.log('ERRORS:', errors.join('\n') || 'none');
  if (errors.length) process.exit(1);
  await browser.close();
})().catch(async e => { console.error(e.message); try { await global.PAGE.screenshot({ path: SP + '/shots/fail.png' }); } catch {} process.exit(1); });
