const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  fs.writeFileSync(path.join(VAULT, 'Hub.md'), '---\naliases: [Center]\n---\n# Hub\n');
  fs.writeFileSync(path.join(VAULT, 'A.md'), '---\ntitle: Hub in the frontmatter\n---\nI mention Hub here.\nSome `Hub in code` text.\n\n```\nHub fenced\n```\n\n[[Hub]] is linked.\nHubs is another word.\nThe Center counts too.\n');
  fs.writeFileSync(path.join(VAULT, 'B.md'), 'Nothing to see.\n');
  fs.writeFileSync(path.join(VAULT, 'C.md'), 'hub in lower case\n<!-- Hub in a comment -->\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = []; global.PAGE = page;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  await page.evaluate(() => { rtab = 'backlinks'; openPath('Hub.md'); }); await sleep(500);
  const secs = await page.$$eval('#right-body .r-sec', s => s.map(x => ({ h: x.querySelector('h4').textContent, items: [...x.querySelectorAll('.bl-ctx')].map(c => c.dataset.path + ': ' + c.textContent.replace(/^Link/, '').trim()) })));
  assert(secs[0].h === 'Linked mentions 1' && secs[0].items[0] === 'A.md: [[Hub]] is linked.', 'the link is a linked mention');
  assert(secs[1].h === 'Unlinked mentions 2', 'two notes mention it without a link: ' + secs[1].h);
  assert(JSON.stringify(secs[1].items) === JSON.stringify(['A.md: I mention Hub here.', 'A.md: The Center counts too.', 'C.md: hub in lower case']),
    'plain mentions and the alias count, in any case; code, fenced code, comments, frontmatter, links and "Hubs" don’t: ' + JSON.stringify(secs[1].items));
  await page.click('#right-body .bl-ctx[data-path="C.md"] [data-link]'); await sleep(500);
  assert(fs.readFileSync(path.join(VAULT, 'C.md'), 'utf8').startsWith('[[Hub|hub]] in lower case'), 'Link turns a mention into a link');
  console.log('ERRORS:', errors.join('\n') || 'none');
  if (errors.length) process.exit(1);
  await browser.close();
})().catch(async e => { console.error(e.message); try { await global.PAGE.screenshot({ path: SP + '/shots/fail.png' }); } catch {} process.exit(1); });
