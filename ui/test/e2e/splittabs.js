// Split tabs: a tab can hold a second file on the right, and the pair lives in the tab bar as one group.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const FIX = __dirname + '/fixtures';
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
const rd = p => fs.readFileSync(path.join(VAULT, p), 'utf8');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
(async () => {
  w('Draft.md', '# Draft\n\nWriting here.\n');
  w('Sources.md', '# Sources\n\n- Book one\n');
  w('Extra.md', '# Extra\n');
  w('Links.md', '# Links\n\nGo to [[Sources]] now.\n');
  w('Scratch.md', '# Scratch\n');
  w('Temp.md', '# Temp\n');
  w('Old/Ref.md', '# Ref\n');
  w('notes.txt', 'plain text\n');
  w('pic.png', fs.readFileSync(FIX + '/red.png'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const tabs = () => page.evaluate(() => S.tabs.map(t => [t.key, t.split]));
  const shown = () => page.evaluate(() => $('#split') && !$('#split').hidden ? SPLIT.path : null);
  // Replace every tab with these [left, right] pairs and show the first.
  const reset = async gs => { await page.evaluate(async gs => { S.tabs = gs.map(([k, s]) => Object.assign(newTabObj(k), { split: s })); S.tab = -1; await activateTab(0, { force: true }); }, gs); await sleep(400); };

  // A tab owns its partner: switching away hides it, switching back shows it.
  await page.evaluate(() => openPath('Draft.md')); await sleep(300);
  await page.evaluate(() => openSplit('Sources.md')); await sleep(400);
  assert(same(await tabs(), [['Draft.md', 'Sources.md']]), 'Open to the right gives the current tab a partner');
  await page.evaluate(() => openInNewTab('Extra.md')); await sleep(400);
  assert(await shown() === null, 'a tab without a partner hides the split pane');
  await page.evaluate(() => activateTab(0)); await sleep(400);
  assert(await shown() === 'Sources.md' && await page.evaluate(() => S.cur) === 'Draft.md', 'switching back brings the group back');
  assert(same(await page.evaluate(() => store('tabs')), { keys: ['Draft.md', 'Extra.md'], splits: ['Sources.md', null], active: 0 }), 'partners are saved with the tabs');
  await page.reload(); await sleep(1200);
  assert(same(await tabs(), [['Draft.md', 'Sources.md'], ['Extra.md', null]]) && await shown() === 'Sources.md', 'groups come back after a restart');
  // The old single split pane setting becomes the active tab's partner, once.
  await page.evaluate(() => { store('tabs', { keys: ['Extra.md'], active: 0 }); store('split', 'Draft.md'); });
  await page.reload(); await sleep(1200);
  assert(same(await tabs(), [['Extra.md', 'Draft.md']]) && await page.evaluate(() => store('split')) === null, "the old split pane setting joins the active tab and is cleared");
  // Quick switches between groups end on the right partner, with one editor.
  await reset([['Draft.md', 'Sources.md'], ['Extra.md', 'Links.md'], ['Scratch.md', null]]);
  await page.evaluate(() => { activateTab(1); activateTab(0); activateTab(1); }); await sleep(1000);
  assert(await shown() === 'Links.md' && await page.$$eval('#split .cm-editor', x => x.length) === 1, 'quick tab switches end on the right partner, with one editor');
  // Renames follow a partner, folders included; deletes turn a group back into an ordinary tab.
  await reset([['Scratch.md', 'Old/Ref.md']]);
  await page.evaluate(() => renamePath('Old/Ref.md', 'Old/Ref2.md')); await sleep(800);
  assert(same(await tabs(), [['Scratch.md', 'Old/Ref2.md']]) && await shown() === 'Old/Ref2.md', 'a renamed partner stays in its group');
  await page.evaluate(() => renamePath('Old', 'Archive')); await sleep(800);
  assert(same(await tabs(), [['Scratch.md', 'Archive/Ref2.md']]) && await shown() === 'Archive/Ref2.md', 'and follows a renamed folder');
  await page.evaluate(() => deletePath('Archive/Ref2.md', { confirm: false })); await sleep(700);
  assert(same(await tabs(), [['Scratch.md', null]]) && await shown() === null, 'a deleted partner leaves an ordinary tab');
  await reset([['Temp.md', 'Scratch.md']]);
  await page.evaluate(() => deletePath('Temp.md', { confirm: false })); await sleep(700);
  assert(same(await tabs(), [['Scratch.md', null]]) && await page.evaluate(() => S.cur) === 'Scratch.md' && await shown() === null, 'a deleted left note hands over to its partner');

  // The tab bar spans both panes, with the split pane below it.
  await reset([['Draft.md', 'Sources.md']]);
  const [tb, sp] = await page.evaluate(() => [$('#tabbar'), $('#split')].map(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
  assert(tb.r >= sp.r - 1 && sp.t >= tb.b - 1 && tb.l <= sp.l, 'the tab bar spans both panes, with the split pane below it');

  // A group is one tab with both names.
  const tab0 = '#tabbar .tab[data-i="0"]';
  await reset([['Draft.md', 'Sources.md'], ['Extra.md', null]]);
  assert(await page.$eval(tab0, el => el.classList.contains('group') && !!el.querySelector('.tab-sep') && [...el.querySelectorAll('.tab-name')].map(n => n.textContent).join('|') === 'Draft|Sources'), 'a group shows as one tab with both names');
  assert(await page.getAttribute(tab0, 'title') === 'Draft.md\nSources.md' && await page.getAttribute(tab0, 'aria-label') === 'Draft and Sources', 'its tooltip and label name both notes');
  assert(!(await page.$('[data-split=swap]')) && !(await page.$('[data-split=main]')), 'the split header has no swap or open-in-main buttons');
  assert(await page.isVisible('#pane-close-left'), 'the left pane has a close button in a group');
  await page.evaluate(() => activateTab(1)); await sleep(300);
  assert(!(await page.isVisible('#pane-close-left')), 'but not in an ordinary tab');
  await page.evaluate(() => activateTab(0)); await sleep(400);
  // Its menu swaps and separates.
  await page.click(tab0, { button: 'right' }); await sleep(150);
  await page.click('.menu >> text=Swap panes'); await sleep(600);
  assert(same(await tabs(), [['Sources.md', 'Draft.md'], ['Extra.md', null]]) && await page.evaluate(() => S.cur) === 'Sources.md' && await shown() === 'Draft.md', 'Swap panes trades the two notes');
  await page.click(tab0, { button: 'right' }); await sleep(150);
  await page.click('.menu >> text=Separate tabs'); await sleep(500);
  assert(same(await tabs(), [['Sources.md', null], ['Draft.md', null], ['Extra.md', null]]) && await shown() === null, 'Separate tabs gives the partner its own tab, right after');
  // Typing on the right, then swapping at once, keeps the typing.
  await reset([['Draft.md', 'Sources.md']]);
  await page.click('#split .cm-content'); await page.keyboard.press('Control+End'); await page.keyboard.type('\n- Typed then swapped');
  await page.evaluate(() => swapSplit()); await sleep(1500);
  assert(rd('Sources.md').includes('- Typed then swapped') && (await page.evaluate(() => ed.value)).includes('- Typed then swapped'), 'edits on the right survive a swap straight after typing');
  // Each pane's × closes that note.
  await reset([['Draft.md', 'Sources.md']]);
  await page.click('#split [data-split=close]'); await sleep(400);
  assert(same(await tabs(), [['Draft.md', null]]) && await shown() === null, "the right pane's × closes the right note");
  await reset([['Draft.md', 'Sources.md']]);
  await page.click('#pane-close-left'); await sleep(500);
  assert(same(await tabs(), [['Sources.md', null]]) && await page.evaluate(() => S.cur) === 'Sources.md' && await shown() === null, "the left pane's × closes the left note and the right one moves over");
  // The group's × closes both, and Reopen closed tab brings the group back.
  await reset([['Draft.md', 'Sources.md'], ['Extra.md', null]]);
  await page.click(`${tab0} .tab-x`); await sleep(400);
  assert(same(await tabs(), [['Extra.md', null]]), "the group tab's × closes both notes");
  await page.evaluate(() => reopenClosedTab()); await sleep(600);
  assert(same(await tabs(), [['Extra.md', null], ['Draft.md', 'Sources.md']]) && await shown() === 'Sources.md', 'Reopen closed tab brings the whole group back');
  // Closing the last tab when it's a group leaves one empty tab.
  await reset([['Draft.md', 'Sources.md']]);
  await page.evaluate(() => closeTab()); await sleep(400);
  assert(same(await tabs(), [[null, null]]) && await shown() === null, 'closing the last tab, a group, leaves one empty tab');

  // ---- end
  await page.screenshot({ path: OUT + '/splittabs.png' });
  assert(errors.length === 0, 'no page errors ' + errors.join('; '));
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
