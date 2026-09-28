// Tests for ui/vaultsettings.js (the vault's .cinder/settings.json).
// Run with plain Node 18+, no packages needed:  node ui/test/vaultsettings.test.js
'use strict';
const assert = require('assert');
const V = require('../vaultsettings.js');

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const DEF = { dailyFolder: 'Daily', dailyFormat: 'YYYY-MM-DD', templatesFolder: 'Templates', theme: '', fontText: '', fontMono: '', windowFrame: 'custom', screenshotHide: true, screenshotDelay: '0', taskSuggest: true };

t('the file holds what differs from the defaults, sorted, without machine-only settings', () => {
  const cfg = { ...DEF, dailyFolder: 'Journal', theme: 'dark', fontText: 'Inter', windowFrame: 'native', screenshotDelay: '3', hotkeys: { 'new-note': 'Mod-Alt-n' } };
  const out = V.forFile(cfg, DEF);
  assert.deepEqual(out, { dailyFolder: 'Journal', hotkeys: { 'new-note': 'Mod-Alt-n' }, theme: 'dark' });
  assert.deepEqual(Object.keys(out), ['dailyFolder', 'hotkeys', 'theme']);
  assert.deepEqual(V.forFile({ ...DEF, hotkeys: {}, propTypes: {} }, DEF), {}, 'empty hotkeys and types are left out');
});

t('keys this Cinder doesn’t know are kept', () => {
  const prev = { futureThing: 42, dailyFolder: 'Old' };
  assert.deepEqual(V.forFile({ ...DEF, templatesFolder: 'T' }, DEF, prev), { futureThing: 42, templatesFolder: 'T' }, 'a known key back at its default goes; unknown ones stay');
});

t('reading the file: defaults for what’s missing, local keys ignored', () => {
  const got = V.fromFile({ dailyFolder: 'Journal', fontText: 'Comic Sans', futureThing: 1, hotkeys: { a: 'b' } }, DEF);
  assert.deepEqual(got, { ...Object.fromEntries(Object.entries(DEF).filter(([k]) => !V.LOCAL_KEYS.includes(k))), dailyFolder: 'Journal', hotkeys: { a: 'b' }, propTypes: {} });
  assert.ok(!('fontText' in got) && !('futureThing' in got));
});

t('first run from Obsidian’s settings', () => {
  const o = {
    daily: { folder: '10 - Timestamps', format: 'YYYY/MM-MMMM/YYYY-MM-DD-dddd', template: '00 - System/Templates/Daily' },
    templates: { folder: '00 - System/Templates' },
    app: { attachmentFolderPath: 'bin/attachments', newFileLocation: 'folder', newFileFolderPath: 'Inbox' },
    templater: { templates_folder: 'Other', folder_templates: [{ folder: 'Meetings', template: '00 - System/Templates/Meeting.md' }, { folder: '', template: '' }] },
    periodic: { weekly: { enabled: true, folder: 'Weeks', format: 'GGGG-[W]WW', template: 'T/Weekly.md' }, monthly: { enabled: false, folder: 'Months' } },
  };
  assert.deepEqual(V.fromObsidian(o), {
    dailyFolder: '10 - Timestamps', dailyFormat: 'YYYY/MM-MMMM/YYYY-MM-DD-dddd', dailyTemplate: '00 - System/Templates/Daily',
    templatesFolder: '00 - System/Templates', attachFolder: 'bin/attachments', newNoteFolder: 'Inbox',
    folderTemplates: 'Meetings: 00 - System/Templates/Meeting',
    weeklyFolder: 'Weeks', weeklyFormat: 'GGGG-[W]WW', weeklyTemplate: 'T/Weekly',
  });
  assert.equal(V.fromObsidian({ templater: { templates_folder: 'Tpl/' } }).templatesFolder, 'Tpl', 'Templater’s folder when core Templates has none');
  assert.deepEqual(V.fromObsidian({ app: { attachmentFolderPath: './assets', newFileLocation: 'current' } }), {}, 'relative attachments and "same folder" new notes don’t map');
  assert.deepEqual(V.fromObsidian({ app: { attachmentFolderPath: '/', newFileLocation: 'root' } }), { attachFolder: '', newNoteFolder: '' });
  assert.deepEqual(V.fromObsidian({ periodic: { daily: { enabled: true, folder: 'P', format: 'DD.MM.YYYY' } }, daily: { folder: 'D' } }), { dailyFolder: 'P', dailyFormat: 'DD.MM.YYYY' }, 'Periodic Notes’ daily settings win when it’s on');
  assert.deepEqual(V.fromObsidian(null), {});
  assert.deepEqual(V.fromObsidian({ daily: 'junk', app: 5 }), {});
});

console.log(`ok ${n} tests`);
