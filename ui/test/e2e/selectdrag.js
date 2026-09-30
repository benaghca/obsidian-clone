const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault', OUT = SP + '/shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(VAULT, p)), { recursive: true }); fs.writeFileSync(path.join(VAULT, p), s); };
(async () => {
  const para = i => `Paragraph ${i} with **bold**, *italic*, a [[Other]] link and \`code\` in it, long enough to wrap onto a second line at this width.`;
  w('Other.md', 'x');
  w('Page.md', '# Heading\n\n' + [
    para(1), '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |', para(2), '$$\nx^2 + y^2\n$$', para(3),
    '```js\nlet a = 1;\nlet b = 2;\n```', para(4), '> [!note] Callout\n> inside it', para(5), para(6), para(7),
  ].join('\n\n') + '\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(800);
  await page.keyboard.press('Control+o'); await page.keyboard.type('Page'); await page.keyboard.press('Enter'); await sleep(900);
  await page.evaluate(() => { if (S.mode !== 'edit') setMode('edit'); ed.setSelectionRange(0, 0); });
  await sleep(300);
  const sel = () => page.evaluate(() => [ed.selectionStart, ed.selectionEnd]);
  const box = async s => (await page.locator('.cm-line', { hasText: s }).first().boundingBox());

  console.log('drag-select down across a rendered table');
  const a = await box('Paragraph 1'), z = await box('Paragraph 2');
  const x0 = a.x + 30, y0 = a.y + 5;
  await page.mouse.move(x0, y0); await page.mouse.down();
  const steps = [];
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(x0 + 100, y0 + (z.y + 5 - y0) * i / 30); await sleep(16);
    steps.push((await sel())[1]);
  }
  await page.mouse.up(); await sleep(200);
  const back = steps.filter((v, i) => i && v < steps[i - 1]).length;
  assert(back === 0, `the selection end only moves forward while dragging down (went back ${back} times: ${steps.join(',')})`);
  const [s1, e1] = await sel();
  const text = await page.evaluate(([a, b]) => ed.value.slice(a, b), [s1, e1]);
  assert(/^aragraph 1|^ragraph 1|^agraph 1|^Paragraph 1|^graph 1/.test(text) && /Paragraph 3|Paragraph 2/.test(text), 'it runs from Paragraph 1 to where the mouse let go: ' + JSON.stringify(text.slice(0, 20) + '…' + text.slice(-20)));

  console.log('after letting go');
  await page.mouse.move(x0 + 300, y0 + 40); await sleep(150);
  assert(JSON.stringify(await sel()) === JSON.stringify([s1, e1]), 'moving the mouse (no button) leaves the selection alone');
  const p2 = await box('Paragraph 2');
  await page.mouse.click(p2.x + 40, p2.y + 5); await sleep(200);
  const [s2, e2] = await sel();
  assert(s2 === e2, `one click collapses the selection (${s2}-${e2})`);
  const line = await page.evaluate(p => ed.value.slice(0, p).split('\n').pop(), s2);
  assert(line.startsWith('Paragraph 2'.slice(0, Math.min(line.length, 11))), 'the cursor lands where it was clicked: ' + JSON.stringify(line));

  console.log('select all, then click');
  await page.keyboard.press('Control+a'); await sleep(200);
  
  await page.mouse.click(p2.x + 40, p2.y + 5); await sleep(200);
  const [s3, e3] = await sel();
  assert(s3 === e3, `after Ctrl+A one click collapses the selection (${s3}-${e3})`);
  const line3 = await page.evaluate(p => ed.value.slice(0, p).split('\n').pop(), s3);
  assert(/^Parag/.test(line3), 'and it lands on the clicked line: ' + JSON.stringify(line3));

  assert(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
