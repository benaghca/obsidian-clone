// ```mermaid blocks: drawn as diagrams in reading view and in the editor, a mistake shown with its
// message, redrawn for the theme, included in exports, all within Cinder's Content Security Policy.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
(async () => {
  w('Diagrams.md', '# Diagrams\n\n```mermaid\nflowchart TD\n  A[Pour booked] --> B{Rebar passed?}\n  B -->|yes| C[Pour]\n  B -->|no| D[Fix and reinspect]\n```\n\n' +
    '```mermaid\nsequenceDiagram\n  PM->>Sub: RFI-14\n  Sub-->>PM: Answer\n```\n\n```mermaid\nflowchart TD\n  A --> \n```\n\nEnd.\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [], csp = []; global.PAGE = page;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (/Content Security Policy|Refused to/.test(m.text())) csp.push(m.text()); });
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const wait = async (sel, n) => { for (let i = 0; i < 40; i++) { if ((await page.$$(sel)).length >= n) return true; await sleep(250); } return false; };

  console.log('reading view');
  await page.evaluate(() => openPath('Diagrams.md')); await sleep(400);
  await page.evaluate(() => setMode('read'));
  assert(await wait('#preview .mermaid-block svg', 2), 'the flowchart and the sequence diagram are drawn');
  assert((await page.textContent('#preview .mermaid-block svg')).includes('Rebar passed?'), 'with their labels');
  assert(await page.$('#preview .mermaid-block .mermaid-error') && (await page.textContent('#preview .mermaid-block .mermaid-error')).length > 10 && await page.$('#preview .mermaid-block pre'), 'a diagram with a mistake shows the message and its source');
  await page.screenshot({ path: SP + '/shots/mermaid-read.png' });
  const sizes = await page.$$eval('#preview .mermaid-block svg', l => l.map(s => s.getBoundingClientRect().width));
  assert(sizes.every(w => w > 200), 'at their own size, not icon-sized: ' + sizes.map(Math.round).join(', '));

  console.log('the theme');
  const before = await page.$eval('#preview .mermaid-block svg', s => s.outerHTML);
  await page.evaluate(() => { cfg.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; saveCfg(); applyTheme(); }); await sleep(1500);
  const after = await page.$eval('#preview .mermaid-block svg', s => s.outerHTML);
  assert(before !== after, 'switching light/dark redraws the diagrams in the other theme');
  await page.screenshot({ path: SP + '/shots/mermaid-theme.png' });

  console.log('the editor');
  await page.evaluate(() => setMode('edit'));
  assert(await wait('.cm-editor .cm-codeblock-widget .mermaid-block svg', 2), 'live preview draws them too, with a button to edit the source');
  assert(await page.$('.cm-editor .cm-codeblock-widget .cm-codeblock-edit'), 'the </> button is there');
  await page.screenshot({ path: SP + '/shots/mermaid-edit.png' });

  console.log('export');
  await page.evaluate(() => exportHtml()); await sleep(2500);
  const html = fs.readdirSync(VAULT).find(f => f.endsWith('.html'));
  assert(html && /<svg[\s\S]*Rebar passed\?/.test(fs.readFileSync(path.join(VAULT, html), 'utf8')), 'Export to HTML includes the drawn diagram');

  console.log('ERRORS:', errors.join('\n') || 'none', '| CSP:', csp.join('\n') || 'none');
  assert(!errors.length && !csp.length, 'no page errors and nothing blocked by the Content Security Policy');
  await browser.close();
})().catch(async e => { console.log(e.message); try { await global.PAGE.screenshot({ path: SP + '/shots/fail.png' }); } catch {} process.exit(1); });
