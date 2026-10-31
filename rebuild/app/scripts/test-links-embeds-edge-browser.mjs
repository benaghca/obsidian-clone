// LINKS-EMBEDS-EDGE-TESTS: headless checks for rendered wikilinks, embeds,
// callouts, tables, tags, and daily notes, plus frame time while typing and
// switching notes. The mock vault stays in the page. No screenshots.
// Not wired into package.json.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const p95 = (values) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * 0.95))];

await withBrowser(async ({ run, send, click, press, check }) => {
  const wait = async (test, label, tries = 80) => {
    for (let i = 0; i < tries; i++) {
      if (await test()) return;
      await sleep(25);
    }
    assert.fail(label);
  };
  const target = `---
aliases:
  - Zzledge secret
tags:
  - zzledge/alpha
---
\`\`\`
## Second
nope
\`\`\`
# Top

Intro line.

## Second

Section body. ^zzbid

### Nested

Nested body.

## Later

Later body.

#zzledge-body
\`#zzledge-code\`

\`\`\`
#zzledge-no
\`\`\`
`;
  const host = `---
tags: [zzledge/host]
---
Alias [[ZzledgeTarget|Zzledge secret]].
Heading [[ZzledgeTarget#Second|the part]].
Block [[ZzledgeTarget#^zzbid]].
Markdown [see](ZzledgeTarget.md#Second).
Missing [[ZzledgeGhost]].
Code \`[[ZzledgeTarget]]\`.

\`\`\`
[[ZzledgeTarget]]
\`\`\`

![[ZzledgeTarget]]

![[ZzledgeTarget#Second]]

![[ZzledgeTarget#^zzbid]]

![[ZzledgeTarget#Missing section]]

![[ZzledgeGhost]]

![[ZzledgeHost]]

![[ZzledgeCycle]]

> [!warning]- Folded warning
> Stay folded

> [!mystery]+ Odd title
> Unknown type

| Name | Qty |
| :--- | ---: |
| alpha | 2 |
| beta | 10 |

#zzledge/live
`;
  const days = await run(async (target, host) => {
    const { api } = await import('/src/api.ts');
    const { settings } = await import('/src/settings/store.ts');
    const pad = (n) => String(n).padStart(2, '0');
    const base = new Date();
    const stamp = (offset) => {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, 12, 0, 0);
      const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const compact = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
      const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
      return { iso, compact, weekday, md: `${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
    };
    const today = stamp(0);
    const prev = stamp(-1);
    const next = stamp(1);
    const notes = [
      ['ZzledgeTarget.md', target],
      ['ZzledgeCycle.md', '![[ZzledgeHost]]\n'],
      ['ZzledgeHost.md', host],
      ['ZzledgePlain.md', 'Plain note.\n'],
      ['ZzledgeScratch.md', 'Start.\n'],
      ['ZzledgeTemplates/Day.md', '# {{title}}\n{{date}} {{time}}\n{{date:dddd}}\n'],
      [`ZzledgeJournal/${prev.iso}.md`, 'yesterday\n'],
      [`ZzledgeJournal/${next.iso}.md`, 'tomorrow\n'],
      [`ZzledgeJournal/${today.iso}.md`, 'EXISTING DAILY\n'],
    ];
    for (const [path, content] of notes) await api.createNote(path, content);
    await ws.vault.refreshFiles();
    settings.set('daily-notes.json', 'folder', 'ZzledgeJournal');
    settings.set('daily-notes.json', 'format', 'YYYY-MM-DD');
    settings.set('daily-notes.json', 'template', 'ZzledgeTemplates/Day');
    settings.set('templates.json', 'dateFormat', 'YYYY-MM-DD');
    settings.set('templates.json', 'timeFormat', 'HH:mm');
    settings.set('app.json', 'alwaysUpdateLinks', false);
    return { today, prev, next };
  }, target, host);

  await run(() => ws.open('ZzledgeHost.md'));
  await wait(() => run(() => document.querySelector('.cm-content')?.innerText.includes('Intro line')), 'whole-note embed painted');
  const painted = () => run(() => {
    const root = document.querySelector('.cm-content');
    const top = [...root.querySelectorAll('.internal-embed')].filter((el) => !el.parentElement.closest('.internal-embed'));
    return {
      mode: document.querySelector('.markdown-reading-view, .cm-content') ? (root.closest('.markdown-reading-view') ? 'reading' : 'edit') : '',
      count: top.length,
      items: top.map((el) => ({
        cls: el.className,
        title: el.querySelector(':scope > .markdown-embed-title')?.textContent ?? '',
        text: (el.querySelector(':scope > .markdown-embed-content')?.innerText ?? el.innerText).replace(/\s+/g, ' ').trim().slice(0, 180),
      })),
      links: [...root.querySelectorAll('.cm-wikilink, .cm-link')].map((el) => `${el.className}|${el.dataset.href}|${el.textContent}`),
      warning: root.querySelector('[data-callout="warning"]')?.className ?? '',
      warningColor: root.querySelector('[data-callout="warning"]')?.style.getPropertyValue('--callout-color') ?? '',
      mystery: root.querySelector('[data-callout="mystery"]')?.className ?? '',
      mysteryColor: root.querySelector('[data-callout="mystery"]')?.style.getPropertyValue('--callout-color') ?? '',
      cells: [...root.querySelectorAll('.cm-table-widget td')].map((td) => `${td.textContent}|${td.style.textAlign}`),
    };
  });
  await wait(async () => {
    const view = await painted();
    return view.items.some((item) => item.text.includes('Intro line')) && view.items.some((item) => item.text.includes('not created yet'));
  }, 'embeds finished reading');
  let view = await painted();
  const item = (pred) => view.items.find(pred);
  check(view.items.length === 7, `seven top-level embeds (${view.items.length})`);
  const whole = item((entry) => entry.title === 'ZzledgeTarget' && entry.text.includes('Intro line'));
  check(!!whole && whole.text.includes('Later body') && whole.text.includes('nope') && !whole.text.includes('Zzledge secret'), `whole-note embed skips frontmatter and keeps the note after a rendered fence (${whole?.text})`);
  const section = item((entry) => entry.title === '' && entry.text.includes('Section body') && entry.text.includes('Nested body'));
  check(!!section && !section.text.includes('Later body') && !section.text.includes('nope'), `heading embed stops before the next heading (${section?.text})`);
  const block = item((entry) => entry.text === 'Section body.');
  check(!!block && block.title === '', `block embed is the paragraph without its id (${block?.text})`);
  const missingSection = item((entry) => entry.text.includes('Unable to find') && entry.text.includes('Missing section'));
  check(!!missingSection, `a missing heading says so (${missingSection?.text})`);
  const ghost = item((entry) => entry.cls.includes('mod-empty') && entry.text.includes('ZzledgeGhost') && entry.text.includes('not created yet'));
  check(!!ghost, `a missing note is an empty chip (${ghost?.text})`);
  const self = item((entry) => entry.cls.includes('file-embed') && !entry.cls.includes('mod-empty') && entry.text.includes('ZzledgeHost.md'));
  check(!!self, `a note embedding itself is a file chip (${self?.text})`);
  const cycle = item((entry) => entry.title === 'ZzledgeCycle');
  check(!!cycle && cycle.text.includes('ZzledgeHost.md') && !cycle.text.includes('Intro line'), `a cycle renders the other note and chips the way back (${cycle?.text})`);
  check(view.links.some((link) => link.includes('ZzledgeTarget|Zzledge secret')), `alias link shows the alias (${view.links.filter((link) => link.includes('secret')).join(' / ')})`);
  check(view.links.some((link) => link.includes('ZzledgeTarget#Second|the part')), `heading link shows its alias (${view.links.filter((link) => link.includes('Second')).join(' / ')})`);
  check(view.links.some((link) => link.includes('is-unresolved') && link.includes('ZzledgeGhost')), `a missing wikilink is unresolved (${view.links.filter((link) => link.includes('Ghost')).join(' / ')})`);
  check(view.warning.includes('is-collapsed') && view.warningColor === 'var(--color-orange)', `a minus callout starts folded in its colour (${view.warning} ${view.warningColor})`);
  check(!view.mystery.includes('is-collapsed') && view.mysteryColor === 'var(--color-blue)', `an unknown plus callout starts open and looks like a note (${view.mystery} ${view.mysteryColor})`);
  check(view.cells.some((cell) => cell.startsWith('alpha|left')) && view.cells.some((cell) => cell.startsWith('2|right')), `table cells keep their alignment (${view.cells.join(' / ')})`);

  const beforeFold = await run(() => ws.view.state.doc.toString());
  const reveal = async (selector) => {
    await run((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'center' }), selector);
    await sleep(40);
  };
  await reveal('[data-callout="warning"] .callout-title');
  await click('[data-callout="warning"] .callout-title');
  check(await run(() => !document.querySelector('[data-callout="warning"]').classList.contains('is-collapsed')), 'clicking the folded callout title opens it');
  await reveal('[data-callout="mystery"] .callout-title');
  await click('[data-callout="mystery"] .callout-title');
  check(await run(() => document.querySelector('[data-callout="mystery"]').classList.contains('is-collapsed')), 'clicking the open callout title folds it');
  await reveal('[data-callout="warning"] .callout-title');
  await click('[data-callout="warning"] .callout-title');
  check(await run((before) => document.querySelector('[data-callout="warning"]').classList.contains('is-collapsed') && ws.view.state.doc.toString() === before, beforeFold), 'folding a callout does not change the note');

  await run(() => ws.setMode('reading'));
  await wait(() => run(() => document.querySelector('.cm-content')?.innerText.includes('Intro line')), 'reading embeds painted');
  view = await painted();
  check(view.items.length === 7 && view.items.some((entry) => entry.text.includes('Later body')) && view.items.some((entry) => entry.text.includes('not created yet')), 'reading mode keeps the same embeds');
  const blockLink = await run(() => {
    const el = [...document.querySelectorAll('.cm-wikilink')].find((node) => node.dataset.href === 'ZzledgeTarget#^zzbid');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 8) };
  });
  check(!!blockLink, 'the block ref is a rendered wikilink');
  await click(blockLink);
  await wait(() => run(() => ws.active.path === 'ZzledgeTarget.md'), 'block ref opens the target');
  check(await run(() => ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text.startsWith('Section body')), 'the block ref lands on the paragraph');

  await run(() => { ws.setMode('live'); return ws.open('ZzledgeScratch.md'); });
  await sleep(80);
  await run(() => {
    const end = ws.view.state.doc.length;
    ws.view.dispatch({ selection: { anchor: end }, scrollIntoView: true });
    ws.view.focus();
  });
  await send('Input.insertText', { text: '\n[[Zzledge sec' });
  await wait(() => run(() => [...document.querySelectorAll('.cm-completionLabel')].some((el) => el.textContent === 'Zzledge secret')), 'alias suggestion', 40);
  const suggestion = await run(() => {
    const row = [...document.querySelectorAll('.cm-link-suggest li')].find((li) => li.querySelector('.cm-completionLabel')?.textContent === 'Zzledge secret');
    return { detail: row?.querySelector('.cm-completionDetail')?.textContent ?? '', footer: document.querySelector('.cm-link-suggest-footer')?.textContent ?? '' };
  });
  check(suggestion.detail === 'ZzledgeTarget' && suggestion.footer.includes('to link heading'), `alias completion names the note (${suggestion.detail})`);
  await press('Escape');

  await send('Performance.enable');
  const arm = () => run(() => {
    window.ledge = { frames: [], long: [] };
    let last = performance.now();
    ledge.obs = new PerformanceObserver((list) => { for (const entry of list.getEntries()) ledge.long.push(entry.duration); });
    ledge.obs.observe({ type: 'longtask' });
    ledge.raf = requestAnimationFrame(function tick(now) {
      ledge.frames.push(now - last);
      last = now;
      ledge.raf = requestAnimationFrame(tick);
    });
  });
  const take = () => run(() => {
    cancelAnimationFrame(ledge.raf);
    ledge.obs.disconnect();
    const frames = ledge.frames.slice(2);
    return { frames, long: ledge.long.map((value) => Math.round(value)) };
  });
  const budget = (sample, label) => {
    const max = Math.max(...sample.frames);
    const tail = p95(sample.frames);
    console.log(label, JSON.stringify({ n: sample.frames.length, max: +max.toFixed(1), p95: +tail.toFixed(1), median: +median(sample.frames).toFixed(1), long: sample.long }));
    assert.ok(sample.frames.length > 2, `${label} recorded frames`);
    assert.ok(max <= 50, `${label} max frame ${max.toFixed(1)}ms`);
    assert.ok(!sample.long.some((value) => value > 50), `${label} long tasks ${sample.long}`);
    check(true, `${label} max ${max.toFixed(1)}ms p95 ${tail.toFixed(1)}ms`);
    return { max, tail };
  };

  await run(() => ws.open('ZzledgeHost.md'));
  await wait(() => run(() => document.querySelector('.cm-content')?.innerText.includes('Intro line')), 'host ready to type');
  await run(() => { ws.setMode('live'); const end = ws.view.state.doc.length; ws.view.dispatch({ selection: { anchor: end } }); ws.view.focus(); });
  await arm();
  const typed = ' edge probe text ok';
  for (const ch of typed) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(30);
  }
  await sleep(120);
  const typing = budget(await take(), 'LEDGE_TYPE');
  check(await run((typed) => ws.view.state.doc.toString().endsWith(typed), typed), 'typed text landed in the heavy note');

  const switchPaths = ['ZzledgePlain.md', 'ZzledgeTarget.md', 'ZzledgeHost.md', 'ZzledgeCycle.md', 'ZzledgeScratch.md', 'Welcome.md'];
  await arm();
  const switches = await run(async (paths) => {
    const elapsed = [];
    for (const path of paths) {
      const started = performance.now();
      await ws.open(path);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      elapsed.push(Math.round(performance.now() - started));
    }
    return elapsed;
  }, switchPaths);
  await sleep(80);
  const switching = budget(await take(), 'LEDGE_SWITCH');
  console.log('LEDGE_SWITCH_MS', JSON.stringify(switches));
  check(await run(() => ws.active.path === 'Welcome.md'), 'the switch walk ended on Welcome');

  await run(() => { ws.open('ZzledgeHost.md'); grove.run('tag-pane:open'); });
  await wait(() => run(() => !!document.querySelector('.tag-pane-tag[title="#zzledge/alpha"]')), 'tags pane listed the frontmatter tag');
  const tagText = await run(() => [...document.querySelectorAll('.tag-pane-tag')].map((el) => el.getAttribute('title')));
  check(tagText.includes('#zzledge/alpha') && tagText.includes('#zzledge/live') && tagText.includes('#zzledge-body'), `saved and body tags are listed (${tagText.filter((tag) => tag?.includes('zzledge')).join(' ')})`);
  check(target.includes('`#zzledge-code`'), 'the target note plants an inline-code tag');
  check(!tagText.includes('#zzledge-no') && !tagText.includes('#zzledge-code'), 'a fenced tag and an inline-code tag are absent');
  await click('.tag-pane-tag[title="#zzledge/alpha"]');
  await wait(() => run(() => document.querySelector('.search-input')?.value === 'tag:#zzledge/alpha'), 'clicking a tag searches for it');
  check(true, 'a tag click fills the search box');

  const opened = await run(() => grove.run('daily-notes'));
  check(opened === true, 'today’s daily note command runs');
  await wait(() => run((iso) => ws.active.path === `ZzledgeJournal/${iso}.md`, days.today.iso), 'existing daily note opens');
  check(await run(async () => {
    const { api } = await import('/src/api.ts');
    return (await api.readNote(ws.active.path)) === 'EXISTING DAILY\n';
  }), 'opening an existing daily note does not rewrite it');
  check(await run(() => grove.run('daily-notes:goto-prev')) === true, 'previous daily note is available');
  await wait(() => run((iso) => ws.active.path === `ZzledgeJournal/${iso}.md`, days.prev.iso), 'previous daily note opens');
  check(await run(() => grove.run('daily-notes:goto-next')) === true, 'next from yesterday returns toward today');
  await wait(() => run((iso) => ws.active.path === `ZzledgeJournal/${iso}.md`, days.today.iso), 'next opens today');
  check(await run(() => grove.run('daily-notes:goto-next')) === true, 'next daily note is available');
  await wait(() => run((iso) => ws.active.path === `ZzledgeJournal/${iso}.md`, days.next.iso), 'next daily note opens');

  await run(() => settings.set('daily-notes.json', 'format', 'YYYYMMDD'));
  check(await run(() => grove.run('daily-notes')) === true, 'a missing daily note is created');
  await wait(() => run((compact) => ws.active.path === `ZzledgeJournal/${compact}.md`, days.today.compact), 'compact daily note opens');
  const created = await run(async () => {
    const { api } = await import('/src/api.ts');
    return api.readNote(ws.active.path);
  });
  check(created.startsWith(`# ${days.today.compact}\n`), `template title is the file name (${created.split('\n')[0]})`);
  check(new RegExp(`^${days.today.iso} \\d{2}:\\d{2}$`, 'm').test(created), `template date and time are filled (${created.split('\n')[1]})`);
  check(created.includes(days.today.weekday), `template weekday is ${days.today.weekday} (${created.trim()})`);
  check(await run(() => grove.run('daily-notes:goto-prev')) === false, 'no earlier compact daily note means previous does not run');
  check(await run((compact) => ws.active.path === `ZzledgeJournal/${compact}.md`, days.today.compact), 'a refused previous command leaves the note open');
  await run(async (compact) => {
    const { api } = await import('/src/api.ts');
    await api.createNote(`ZzledgeJournal/${compact}.md`, 'compact prev\n');
    await ws.vault.refreshFiles();
  }, days.prev.compact);
  check(await run(() => grove.run('daily-notes:goto-prev')) === true, 'previous sees the new compact note');
  await wait(() => run((compact) => ws.active.path === `ZzledgeJournal/${compact}.md`, days.prev.compact), 'previous compact note opens');

  await run(() => settings.set('daily-notes.json', 'format', 'MM-DD'));
  check(await run(() => grove.run('daily-notes')) === true, 'a yearless format still creates today’s note');
  await wait(() => run((md) => ws.active.path === `ZzledgeJournal/${md}.md`, days.today.md), 'yearless daily note opens');
  const yearless = await run(() => [grove.run('daily-notes:goto-prev'), grove.run('daily-notes:goto-next')]);
  check(yearless[0] === false && yearless[1] === false, `a format with no year is not in the previous/next list (${yearless})`);

  await run(() => ws.open('ZzledgeHost.md'));
  await run(async () => {
    const { renameFile } = await import('/src/fileOps.ts');
    await renameFile(ws, 'ZzledgeTarget.md', 'ZzledgeRenamed');
  });
  await wait(() => run(() => document.querySelector('.modal-title')?.textContent === 'Update links?'), 'rename asks to update links');
  const asked = await run(() => document.querySelector('.modal-content')?.textContent ?? '');
  check(asked.includes('link'), `the confirm names the links (${asked})`);
  await click('.modal-button-container .mod-cta');
  await wait(() => run(() => (ws.editors.doc('ZzledgeHost.md')?.toString() ?? '').includes('[[ZzledgeRenamed|Zzledge secret]]')), 'updated host link');
  const updated = await run(() => ws.editors.doc('ZzledgeHost.md').toString());
  check(updated.includes('[[ZzledgeRenamed#Second|the part]]') && updated.includes('[[ZzledgeRenamed#^zzbid]]'), 'the heading alias and the block ref point at the new name');
  check(updated.includes('[see](ZzledgeRenamed.md#Second)') && updated.includes('![[ZzledgeRenamed#Second]]'), 'the markdown link and the heading embed were rewritten');
  check(updated.includes('`[[ZzledgeTarget]]`') && updated.includes('```\n[[ZzledgeTarget]]\n```'), 'code and a fence kept the old name');
  check(updated.includes('[[ZzledgeGhost]]'), 'a missing link was not rewritten');
  await run(() => ws.open('ZzledgeHost.md'));
  await wait(() => run(() => [...document.querySelectorAll('.markdown-embed-title')].some((el) => el.textContent === 'ZzledgeRenamed')), 'embed follows the renamed note');
  check(await run(() => [...document.querySelectorAll('.markdown-embed-title')].some((el) => el.textContent === 'ZzledgeRenamed')), 'the renamed note embed shows the new title');

  console.log('LEDGE_FRAMES', JSON.stringify({
    type_max: +typing.max.toFixed(1), type_p95: +typing.tail.toFixed(1),
    switch_max: +switching.max.toFixed(1), switch_p95: +switching.tail.toFixed(1), switches,
  }));
}, { height: 900 });
