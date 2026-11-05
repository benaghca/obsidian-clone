// M0b: the first open of a mock vault holding .cinder/settings.json (and no
// .grove settings) takes Cinder's daily-note, template, attachment and
// new-note folders, saves them in .grove, and says so in one notice. The
// mock keeps .grove files in localStorage under "grove.mock.config:" and the
// foreign files under "grove.mock.foreign:"; nothing writes the latter.
import assert from 'node:assert/strict';
import { withBrowser, sleep } from './browser.mjs';

const CINDER = JSON.stringify({
  dailyFolder: 'Journal',
  dailyFormat: 'YYYY-MM-DD',
  dailyTemplate: 'Templates/Daily',
  attachFolder: 'Files/Pasted',
  newNoteFolder: 'Inbox',
  weeklyFolder: 'Weekly',
  folderTemplates: 'Meetings: Templates/Meeting',
  theme: 'dark',
});

await withBrowser(async ({ run, click, check }) => {
  const reload = async () => {
    await run(() => location.reload());
    await sleep(200);
    for (let i = 0; i < 100; i++) {
      try { if (await run(() => !!window.ws?.active?.path)) return; } catch { /* still loading */ }
      await sleep(100);
    }
    assert.fail('the mock vault reloaded');
  };
  const stored = () => run(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('grove.mock.')).sort().map(k => [k, localStorage.getItem(k)])));
  const groveFiles = async () => Object.keys(await stored()).filter(k => k.startsWith('grove.mock.config:')).map(k => k.slice('grove.mock.config:'.length));
  const noticeText = () => run(() => [...document.querySelectorAll('.notice-container .notice')].map(n => [...n.querySelectorAll('.notice-line')].map(l => l.textContent)));

  // The sample vault has neither Cinder's nor Obsidian's settings: nothing to say, nothing written.
  check((await noticeText()).length === 0 && (await groveFiles()).length === 0, 'a vault with no foreign settings opens without a notice or .grove files');

  // A vault Cinder used: its settings.json, and no .grove settings yet.
  await run(text => localStorage.setItem('grove.mock.foreign:cinder/settings.json', text), CINDER);
  await reload();
  const notices = await noticeText();
  check(notices.length === 1, 'one notice on the first open');
  assert.deepEqual(notices[0], [
    'Imported settings from Cinder:',
    '• Daily notes folder: Journal',
    '• Daily note template: Templates/Daily',
    '• Template folder: Templates',
    '• Attachment folder: Files/Pasted',
    '• New note folder: Inbox',
    'Not imported: weekly notes; folder templates; 1 other Cinder setting (theme).',
  ]);
  check(true, 'the notice lists what was imported and what was not');
  const box = await run(() => { const r = document.querySelector('.notice').getBoundingClientRect(); return { top: r.top, right: innerWidth - r.right, width: r.width }; });
  check(box.top > 0 && box.top < 120 && box.right < 40 && box.width <= 420, 'the notice sits in the top right corner');

  const files = await stored();
  assert.deepEqual(JSON.parse(files['grove.mock.config:daily-notes.json']), { folder: 'Journal', template: 'Templates/Daily' });
  assert.deepEqual(JSON.parse(files['grove.mock.config:templates.json']), { folder: 'Templates' });
  assert.deepEqual(JSON.parse(files['grove.mock.config:app.json']), { attachmentFolderPath: 'Files/Pasted', newFileLocation: 'folder', newFileFolderPath: 'Inbox' });
  check((await groveFiles()).sort().join() === 'app.json,daily-notes.json,templates.json', '.grove gets daily-notes.json, templates.json and app.json');
  check(files['grove.mock.foreign:cinder/settings.json'] === CINDER && Object.keys(files).filter(k => k.startsWith('grove.mock.foreign:')).length === 1, '.cinder/settings.json is left as it was');

  // The imported settings are the ones in use: Settings shows them, and today's daily note goes in Journal.
  const live = await run(() => ({ daily: settings.get('daily-notes.json').folder, attach: settings.get('app.json').attachmentFolderPath, location: settings.get('app.json').newFileLocation }));
  assert.deepEqual(live, { daily: 'Journal', attach: 'Files/Pasted', location: 'folder' });
  await run(() => grove.run('daily-notes'));
  let daily = '';
  for (let i = 0; i < 30 && !daily.startsWith('Journal/'); i++) { await sleep(100); daily = await run(() => ws.active.path ?? ''); }
  check(/^Journal\/\d{4}-\d{2}-\d{2}\.md$/.test(daily), `today's daily note opens in the imported folder (${daily})`);

  // A click closes the notice.
  await click('.notice');
  check((await noticeText()).length === 0, 'clicking the notice closes it');

  // The next open has Grove's own settings: no import and no notice, the settings kept.
  await reload();
  check((await noticeText()).length === 0, 'the second open shows no notice');
  check(await run(() => settings.get('daily-notes.json').folder) === 'Journal', 'the imported settings stay after a reload');

  // Bad JSON: nothing is written, the notice says which file, and it tries again next time.
  await run(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('grove.mock.config:')) localStorage.removeItem(k); localStorage.setItem('grove.mock.foreign:cinder/settings.json', '{ "dailyFolder": '); });
  await reload();
  assert.deepEqual(await noticeText(), [["Grove didn't import this vault's settings:", "• .cinder/settings.json isn't valid JSON", 'Fix the file and open the vault again to import them.']]);
  check((await groveFiles()).length === 0, 'bad JSON writes no .grove files');
  check(await run(() => settings.get('daily-notes.json').folder) === '', 'bad JSON leaves Grove at its defaults');
  check(await run(() => localStorage.getItem('grove.mock.foreign:cinder/settings.json')) === '{ "dailyFolder": ', 'the broken file is left as it was');
  await run(() => localStorage.setItem('grove.mock.foreign:cinder/settings.json', '{"dailyFolder":"Fixed"}'));
  await reload();
  check(await run(() => settings.get('daily-notes.json').folder) === 'Fixed', 'once fixed, the next open imports it');
  await run(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('grove.mock.')) localStorage.removeItem(k); });
});
