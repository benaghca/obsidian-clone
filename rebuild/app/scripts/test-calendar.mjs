// Calendar view: open it, click a day that has a daily note and one that does
// not, check the template is filled in, and check the dot appears after the
// create. Headless Chromium, real pointer input. The scratch vault is the
// in-memory mock (no vault folder on disk).
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

await withBrowser(async ({ send, run, key, click, check }) => {
  const wait = async (test, label) => {
    for (let i = 0; i < 80; i++) { if (await test()) return; await sleep(25); }
    assert.fail(label);
  };

  await run(async () => {
    const { api } = await import('/src/api.ts');
    await api.createNote('Templates/Day.md', '# {{title}}\n{{date}}\n');
    await ws.vault.refreshFiles();
    settings.set('daily-notes.json', 'folder', 'Daily');
    settings.set('daily-notes.json', 'format', 'YYYY-MM-DD');
    settings.set('daily-notes.json', 'template', 'Templates/Day');
    settings.set('daily-notes.json', 'weekStart', 'monday');
    settings.set('templates.json', 'dateFormat', 'YYYY-MM-DD');
  });
  check(await run(() => grove.run('daily-notes:open-calendar')) === true, 'the calendar command runs');

  await wait(() => run(() => {
    const dock = document.querySelector('.mod-right-split');
    const view = document.querySelector('.calendar-view');
    if (!dock || !view) return false;
    if (dock.getAnimations().some((a) => a.playState === 'running')) return false;
    const box = dock.getBoundingClientRect();
    return box.width >= 280 && view.getBoundingClientRect().width > 200;
  }), 'the calendar view did not open');

  const labels = () => run(() => [...document.querySelectorAll('.calendar-names span')].map((el) => el.textContent).join(' '));
  check(await labels() === 'Mo Tu We Th Fr Sa Su', 'the week starts on Monday');

  const monthIndex = (title) => {
    const [name, year] = title.split(' ');
    const month = MONTHS.indexOf(name);
    return month < 0 || !/^\d{4}$/.test(year) ? -1 : Number(year) * 12 + month;
  };
  const target = 2026 * 12 + 9;
  for (let i = 0; i < 240; i++) {
    const title = await run(() => document.querySelector('.calendar-title')?.textContent ?? '');
    const index = monthIndex(title);
    if (index === target) break;
    assert.ok(index >= 0, `calendar title is a month (${title})`);
    await click(index > target ? '[aria-label="Previous month"]' : '[aria-label="Next month"]');
    if (i === 239) assert.fail(`did not reach October 2026 (last title ${title})`);
  }
  check(await run(() => document.querySelector('.calendar-title').textContent) === 'October 2026', 'previous and next reach October 2026');

  const column = (iso) => run((iso) => {
    const days = [...document.querySelectorAll('.calendar-day')];
    const index = days.findIndex((el) => el.dataset.day === iso && !el.classList.contains('is-outside'));
    return index < 0 ? -1 : index % 7;
  }, iso);
  check(await column('2026-10-01') === 3, '1 October 2026 is Thursday, the fourth Monday-start column');

  check(await run(() => document.querySelector('.calendar-day[data-day="2026-10-19"]:not(.is-outside)')?.classList.contains('has-note') === true), 'a day with a note has a dot');
  check(await run(() => document.querySelector('.calendar-day[data-day="2026-10-20"]:not(.is-outside)')?.classList.contains('has-note') === false), 'a day without a note has no dot');

  const pointOf = async (iso) => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const point = await run((iso) => {
        const el = document.querySelector(`.calendar-day[data-day="${iso}"]:not(.is-outside)`);
        const dock = document.querySelector('.mod-right-split');
        if (!el || !dock) return null;
        if (dock.getAnimations().some((a) => a.playState === 'running')) return null;
        const box = dock.getBoundingClientRect();
        if (box.width < 280) return null;
        const rect = el.getBoundingClientRect();
        const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) return null;
        const hit = document.elementFromPoint(point.x, point.y);
        if (!hit || (hit !== el && !el.contains(hit))) return null;
        return point;
      }, iso);
      if (point) return point;
      await sleep(25);
    }
    assert.fail(`${iso} was not clickable`);
  };

  const noteText = (path) => run(async (path) => {
    const { api } = await import('/src/api.ts');
    return api.readNote(path);
  }, path);

  await click(await pointOf('2026-10-19'));
  await wait(() => run(() => ws.active.path === 'Daily/2026-10-19.md'), 'clicking a day with a note did not open it');
  const existing = await noteText('Daily/2026-10-19.md');
  check(existing.includes('## Today') && !existing.includes('{{title}}'), 'an existing daily note opens unchanged');
  check(await run(() => document.querySelector('.calendar-day[data-day="2026-10-19"]:not(.is-outside)')?.classList.contains('is-active') === true), 'the open day is marked');

  await click(await pointOf('2026-10-20'));
  await wait(() => run(() => ws.active.path === 'Daily/2026-10-20.md'), 'clicking a day without a note did not create it');
  const created = await noteText('Daily/2026-10-20.md');
  check(created === '# 2026-10-20\n2026-10-20\n', `the template is filled in for that day (${JSON.stringify(created)})`);
  await wait(() => run(() => document.querySelector('.calendar-day[data-day="2026-10-20"]:not(.is-outside)')?.classList.contains('has-note') === true), 'the dot did not appear after the create');
  check(await run(() => document.querySelector('.calendar-day[data-day="2026-10-20"]:not(.is-outside)')?.classList.contains('has-note') === true), 'the dot appears after the create');

  const before = await run(() => ws.tabs.map((tab) => tab.path));
  const point = await pointOf('2026-10-21');
  await key('Control', 2);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1, modifiers: 2 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1, modifiers: 2 });
  await key('Control', 0, 'keyUp');
  await sleep(50);
  await wait(() => run(() => ws.active.path === 'Daily/2026-10-21.md'), 'Ctrl+click did not open the day');
  const tabs = await run(() => ({ paths: ws.tabs.map((tab) => tab.path), active: ws.active.path }));
  check(tabs.paths.length === before.length + 1 && tabs.paths.includes('Daily/2026-10-20.md') && tabs.active === 'Daily/2026-10-21.md', `Ctrl+click opens the day in a new tab (${tabs.paths.join(', ')})`);
  const ctrlCreated = await noteText('Daily/2026-10-21.md');
  check(ctrlCreated === '# 2026-10-21\n2026-10-21\n', `Ctrl+click applies the template (${JSON.stringify(ctrlCreated)})`);
  check(await run(() => document.querySelector('.calendar-day[data-day="2026-10-21"]:not(.is-outside)')?.classList.contains('has-note') === true), 'Ctrl+click leaves a dot on the new day');

  await run(() => settings.set('daily-notes.json', 'weekStart', 'sunday'));
  check(await labels() === 'Su Mo Tu We Th Fr Sa', 'Start week on Sunday redraws the columns');
  check(await column('2026-10-01') === 4, '1 October 2026 is the fifth Sunday-start column');
  check(await run(() => document.querySelector('.calendar-day[data-day="2026-10-19"]:not(.is-outside)')?.classList.contains('has-note') === true), 'the dot stays when the week start changes');

  const today = await run(() => {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const date = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return { iso: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, title: `${months[date.getMonth()]} ${date.getFullYear()}` };
  });
  await click('[aria-label="Today"]');
  check(await run(() => document.querySelector('.calendar-title').textContent) === today.title, `Today shows ${today.title}`);
  check(await run((iso) => document.querySelector(`.calendar-day[data-day="${iso}"]`)?.classList.contains('is-today') === true, today.iso), 'today is marked');

  await run(() => settings.set('core-plugins.json', 'daily-notes', false));
  check(await run(() => document.querySelector('.mod-right-split [aria-label="Calendar"]')?.hidden === true), 'turning Daily notes off hides the Calendar tab');
  check(await run(() => grove.run('daily-notes:open-calendar')) === false, 'the calendar command is off with Daily notes');
});
