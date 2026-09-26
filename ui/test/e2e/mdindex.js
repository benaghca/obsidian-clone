const { chromium } = require('playwright-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ✓', m); };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:43199/'); await sleep(900);
  const note = [
    '---', 'tags: [fm]', '---',
    '# Title', '', 'Links: [[Real]] and [md](Other%20note.md) and [angle](<My note.md#Part>) and ![pic](img/a.png) and [web](https://x.io) and [anchor](#section).',
    '', 'Setext heading', '---', '', '## C#', '', '> # Quoted heading', '',
    '- item', '  ```', '  [[InListCode]] #notatag', '  ```', '',
    'Para', '', '    [[Indented]] #alsonot', '', 'Inline `[[Code]] #nope` and #yes', '',
    '<!-- [[Hidden]] -->', '', '<div>', '[[InHtml]]', '</div>', '', '~~~', '[[Tilde]]', '~~~',
  ].join('\n');
  const r = await page.evaluate(t => { const n = parseNote(t); return { links: n.links.map(l => (l.embed ? '!' : '') + l.name + (l.sub ? '#' + l.sub : '')), tags: [...n.tags].sort(), heads: n.headings.map(h => h.level + ':' + h.text), idx: n.links.map(l => t.slice(l.index, l.index + l.len)) }; }, note);
  assert(r.links.join('|') === 'Real|Other note.md|My note.md#Part|!img/a.png', 'links, Markdown links and embeds, not code, comments or HTML: ' + r.links.join('|'));
  assert(r.idx[0] === '[[Real]]' && r.idx[2] === '[angle](<My note.md#Part>)', 'with offsets that point at them');
  assert(r.tags.join() === 'fm,yes', 'tags from frontmatter and text, not from code or #anchors: ' + r.tags.join());
  assert(r.heads.join('|') === '1:Title|2:Setext heading|2:C#', 'headings, setext too, not quoted ones, and C# keeps its #: ' + r.heads.join('|'));
  const speed = await page.evaluate(() => { const t = ('# H\n\nText [[L]] #t `c`\n\n```\nx\n```\n').repeat(200); const t0 = performance.now(); for (let i = 0; i < 50; i++) parseNote(t); return (performance.now() - t0) / 50; });
  assert(speed < 30, `a 5 KB note is read in ${speed.toFixed(1)} ms`);
  assert(errors.length === 0, 'no page errors ' + errors.join('; '));
  await browser.close();
})().catch(e => { console.log(e.message); process.exit(1); });
