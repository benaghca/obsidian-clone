const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const SP = process.env.SP, VAULT = SP + '/vault';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  fs.writeFileSync(VAULT + '/Math.md', '');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  await page.keyboard.press('Control+o'); await page.keyboard.type('Math'); await page.keyboard.press('Enter'); await sleep(700);
  await page.evaluate(() => { setMode('edit'); ed.focus(); });
  const val = () => page.evaluate(() => ed.value);
  const clear = () => page.evaluate(() => { ed.value = ''; ed.focus(); });
  const type = async s => { for (const ch of s) { if (ch === '\t') await page.keyboard.press('Tab'); else await page.keyboard.type(ch); await sleep(15); } await sleep(80); };

  await type('Energy mk\t');
  assert(await val() === 'Energy $$', 'mk + Tab makes inline math: ' + JSON.stringify(await val()));
  await type('E=mcsr, a1');
  assert(await val() === 'Energy $E=mc^{2}, a_1$', 'sr squares, and a1 → a_1: ' + JSON.stringify(await val()));
  await clear(); await type('mk\t//a\tb\t + @a');
  assert(await val() === '$\\frac{a}{b} + \\alpha$', '// makes a fraction, Tab moves through it, @a is α: ' + JSON.stringify(await val()));
  await clear(); await type('mk\tx sr <= y inn RR');
  assert(await val() === '$x ^{2} \\le y \\in \\mathbb{R}$', 'sr, <=, inn, RR: ' + JSON.stringify(await val()));
  await clear(); await type('mk\tsum\t\tx_i');
  assert(await val() === '$\\sum_{i=1}^{n} x_i$', 'sum keeps its default limits when Tabbed through: ' + JSON.stringify(await val()));
  await clear(); await type('mk\tsqx\t+1\t done');
  assert(await val() === '$\\sqrt{x}+1$ done', 'Tab steps out of braces and the closing $: ' + JSON.stringify(await val()));
  await clear(); await type('dm\t\\int');
  assert(/^\$\$\n\\int\n\$\$$/.test(await val()), 'dm + Tab makes a math block');
  await clear(); await type('Mr sq and xx // not math');
  assert(await val() === 'Mr sq and xx // not math', 'outside math nothing changes');
  await clear(); await type('mk\t\\sqrt{x}\\cdot\\hat');
  assert(await val() === '$\\sqrt{x}\\cdot\\hat$', 'typing a command by hand isn\'t rewritten');
  await page.evaluate(() => { cfg.mathSnippets = false; });
  await clear(); await type('$//$');
  assert(await val() === '$//$', 'the setting turns it off');

  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
