// Round 27j: date fields sized to the value, a calendar on datetime, the daily-note
// link, empty-tab labels that fit, and explorer rows at Obsidian's height.
// Headless Chromium, real pointer and key input. Scratch vault only.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const note = `---
due: 2026-10-23
when: 2026-10-23T20:15:30
blank: ""
---
# Heading

## Section

### Detail

A frontmatter note for the pointer checks.
`;

await withBrowser(async ({ send, run, press, move, click, check }) => {
  const row = (path) => `.nav-files .tree-item-self[data-path=${JSON.stringify(path)}]`;
  const wait = async (test, label) => {
    for (let i = 0; i < 80; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };
  const at = async (selector) => {
    await run((selector) => document.querySelector(selector)?.scrollIntoView({ block: 'center' }), selector);
    await sleep(20);
    return run((selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, selector);
  };
  const clickAt = async (p, modifiers = 0) => {
    await move(p);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1, modifiers });
    }
    await sleep(50);
  };

  await run(async (body) => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Dates.md', body);
    await api.createNote('J/A.md', 'A\n');
    await api.createNote('J/B.md', 'B\n');
    await api.createNote('Templates/Day.md', 'Daily {{title}} on {{date}}\n');
    await ws.vault.refreshFiles();
  }, note);
  await click('.nav-files [aria-label="Expand all"]');
  await wait(() => run((selector) => !!document.querySelector(selector), row('J/A.md')), 'rows visible');

  const height = await run((selector) => {
    const el = document.querySelector(selector);
    const style = getComputedStyle(el);
    return { h: el.getBoundingClientRect().height, pad: style.paddingTop, lh: style.lineHeight, font: style.fontSize };
  }, row('J/A.md'));
  check(height.h > 24 && height.h < 26 && height.font === '13px', `explorer rows are about 25px at 13px (${height.h}px, line ${height.lh}, pad ${height.pad})`);

  await clickAt(await at(row('J/A.md')), 1);
  await clickAt(await at(row('J/B.md')), 1);
  const selected = await run(() => [...document.querySelectorAll('.nav-files .tree-item-self.is-selected')].map((el) => el.dataset.path));
  check(selected.includes('J/A.md') && selected.includes('J/B.md') && (await run(() => ws.active.path)) !== 'J/B.md', `alt-click selects both rows without opening (${selected.join(', ')})`);

  await run(() => ws.open('Dates.md'));
  await sleep(80);
  for (const mode of ['live', 'source', 'reading']) {
    await run((mode) => ws.setMode(mode), mode);
    await sleep(80);
    const spot = await run(() => {
      const line = [...document.querySelectorAll('.cm-line')].find((el) => /frontmatter note|Heading/.test(el.textContent));
      const rect = line.getBoundingClientRect();
      return { x: rect.x + 24, y: rect.y + rect.height / 2 };
    });
    await move(spot);
    for (let n = 0; n < 2; n++) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, ...spot, button: 'left', clickCount: 1 });
      }
      await sleep(40);
    }
    const body = await run(() => ws.view.state.doc.toString());
    check(body.includes('due: 2026-10-23') && body.includes('when: 2026-10-23T20:15:30') && body.includes('# Heading'), `${mode}: two clicks at one point leave the note intact`);
  }

  await run(() => ws.setMode('live'));
  await sleep(60);
  await run(() => settings.setPropertyType('blank', 'date'));
  await wait(() => run(() => document.querySelectorAll('.cm-content .property-daily').length >= 2), 'empty date shows a daily-note link');

  const fields = await run(() => {
    const value = (type) => document.querySelector(`.cm-content .property-value[data-type="${type}"]`);
    const box = (type) => {
      const input = value(type).querySelector('input');
      const rect = input.getBoundingClientRect();
      const column = value(type).getBoundingClientRect();
      return {
        width: rect.width,
        column: column.width,
        value: input.value,
        calendar: !!value(type).querySelector('.property-date-icon .lucide-calendar'),
        clock: !!value(type).querySelector('.property-date-icon .lucide-clock'),
        links: [...value(type).querySelectorAll('.property-daily')].map((el) => el.getAttribute('aria-label')),
      };
    };
    const due = box('date');
    const when = box('datetime');
    return { due, when, blankLinks: document.querySelector('[data-key="blank"] .property-daily')?.getAttribute('aria-label') ?? '' };
  });
  check(fields.due.width < 180 && fields.due.width < fields.due.column / 2, `the date field is sized to its value (${fields.due.width}px of a ${fields.due.column}px column)`);
  check(fields.when.value === '2026-10-23T20:15:30' && fields.when.width > fields.due.width * 2, `datetime keeps seconds and fills the column (${fields.when.value}, ${fields.when.width}px)`);
  check(fields.due.calendar && fields.when.calendar && !fields.due.clock && !fields.when.clock, 'date and datetime values show a calendar');
  check(fields.due.links.join() === 'Open daily note' && fields.when.links.length === 0 && fields.blankLinks === 'Open daily note', 'the daily-note link follows date values only');

  await clickAt(await at('.cm-content .property-value[data-type="date"] .property-date-icon'));
  check(await run(() => document.activeElement?.type === 'date' && document.activeElement.value === '2026-10-23'), 'the calendar icon focuses the date field and keeps its value');
  await press('ArrowRight');
  const keyed = await run(() => ({ type: document.activeElement?.type ?? '', value: document.activeElement?.value ?? '' }));
  check(keyed.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(keyed.value), `a key edits the date field (${keyed.value})`);
  await run(() => { document.querySelector('.cm-content .property-value[data-type="date"] input').value = '2026-10-23'; });

  await clickAt(await at('.cm-content .property-value[data-type="datetime"] input'));
  check(await run(() => document.activeElement?.value === '2026-10-23T20:15:30'), 'clicking the datetime field keeps the seconds');

  const before = await run(() => ws.vault.files.map((f) => f.path));
  await clickAt(await at('[data-key="blank"] .property-daily'));
  await sleep(80);
  const afterBlank = await run(() => ({ path: ws.active.path, files: ws.vault.files.map((f) => f.path) }));
  check(afterBlank.path === 'Dates.md' && afterBlank.files.length === before.length, 'an empty date link does not create a note');

  await clickAt(await at('[data-key="due"] .property-daily'));
  await wait(() => run(() => ws.active.path === '2026-10-23.md'), 'the link opens the daily note');
  await click('.cm-content .cm-line');
  await send('Input.insertText', { text: 'kept' });
  await sleep(40);
  check(await run(() => ws.view.state.doc.toString().includes('kept')), 'the new daily note accepts typing');
  await run(() => ws.open('Dates.md'));
  await wait(() => run(() => !!document.querySelector('[data-key="due"] .property-daily')), 'back on the dated note');
  await clickAt(await at('[data-key="due"] .property-daily'));
  await wait(() => run(() => ws.active.path === '2026-10-23.md' && ws.view.state.doc.toString().includes('kept')), 'opening the daily note again keeps what was typed');

  await run(() => {
    settings.set('daily-notes.json', 'format', 'YYYY/MM/DD');
    settings.set('daily-notes.json', 'folder', 'Journal');
    settings.set('daily-notes.json', 'template', 'Templates/Day');
    ws.open('Dates.md');
  });
  await wait(() => run(() => !!document.querySelector('[data-key="due"] .property-daily')), 'dated note after the daily-notes settings');
  await clickAt(await at('[data-key="due"] .property-daily'));
  await wait(() => run(() => ws.active.path === 'Journal/2026/10/23.md'), 'format and folder name the new daily note');
  const made = await run(() => ({
    text: ws.view.state.doc.toString(),
    kept: ws.editors.doc('2026-10-23.md')?.toString() ?? '',
  }));
  check(made.text.startsWith('Daily 23 on 2026-10-23'), `the template is filled for that date (${JSON.stringify(made.text)})`);
  check(made.kept.includes('kept'), 'the earlier daily note is left as it was');

  await run(() => ws.setMode('reading'));
  await run(() => ws.open('Dates.md'));
  await wait(() => run(() => !!document.querySelector('.cm-content [data-key="due"] .property-daily')), 'reading view shows the link');
  await run(() => { ws.setMode('live'); grove.run('properties:open-local'); });
  await sleep(150);
  const side = await run(() => {
    const input = document.querySelector('.file-properties .property-value[data-type="date"] input');
    const when = document.querySelector('.file-properties .property-value[data-type="datetime"] input');
    return {
      width: input?.getBoundingClientRect().width ?? 0,
      when: when?.value ?? '',
      link: document.querySelector('.file-properties .property-daily')?.getAttribute('aria-label') ?? '',
      calendar: !!document.querySelector('.file-properties .property-value[data-type="datetime"] .lucide-calendar'),
    };
  });
  check(side.width > 0 && side.width < 180 && side.when === '2026-10-23T20:15:30' && side.link === 'Open daily note' && side.calendar, `file properties uses the same date field (${side.width}px, ${side.when})`);

  const bar = await run(() => {
    const el = document.querySelector('.status-bar');
    const rect = el.getBoundingClientRect();
    return { h: rect.height, bottom: innerHeight - rect.bottom, right: innerWidth - rect.right };
  });
  check(bar.h > 26 && bar.h < 29 && bar.bottom < 1 && bar.right < 1, `the status bar is the corner chip (${bar.h}px)`);

  await run(() => ws.newTab());
  await sleep(60);
  const labels = await run(() => [...document.querySelectorAll('.empty-state-action-label')].map((el) => {
    const style = getComputedStyle(el);
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return {
      text: el.textContent,
      textWidth: canvas.measureText(el.textContent).width,
      client: el.clientWidth,
      overflow: style.textOverflow,
      ellipsis: el.classList.contains('is-ellipsized'),
    };
  }));
  check(labels.map((label) => label.text).join('|') === 'New note|New canvas|Go to file', `empty tab labels (${labels.map((label) => label.text).join(' | ')})`);
  check(labels.every((label) => label.textWidth <= label.client + 0.5 && !label.ellipsis && label.overflow === 'clip'), `short labels fit without an ellipsis (${labels.map((label) => `${label.textWidth}/${label.client}`).join(', ')})`);

  await run(() => { document.querySelector('.empty-state-action-label').textContent = 'This label is intentionally far too long for the pill'; });
  await sleep(30);
  const long = await run(() => {
    const el = document.querySelector('.empty-state-action-label');
    return { over: el.scrollWidth > el.clientWidth + 1, ellipsis: el.classList.contains('is-ellipsized'), overflow: getComputedStyle(el).textOverflow };
  });
  check(long.over && long.ellipsis && long.overflow === 'ellipsis', 'a genuinely long label ellipsizes');
});
