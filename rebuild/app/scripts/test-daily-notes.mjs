// C1: Settings → Daily notes → Open daily note on startup, with a date format that holds folders.
// Each load of the page is a startup; a hook installed before the app runs counts what it opens and creates.
import { withBrowser, sleep } from './browser.mjs';

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const today = `Journal/${now.getFullYear()}/${pad(now.getMonth() + 1)}/${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.md`;
const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
const tomorrow = `Journal/${tomorrowDate.getFullYear()}/${pad(tomorrowDate.getMonth() + 1)}/${tomorrowDate.getFullYear()}-${pad(tomorrowDate.getMonth() + 1)}-${pad(tomorrowDate.getDate())}.md`;

await withBrowser(async ({ send, run, evaluate, check }) => {
  const wait = async (test, message) => {
    for (let i = 0; i < 100; i++) { if (await test()) return; await sleep(50); }
    throw new Error(message);
  };
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const log = window.__daily = { opens: [], written: [] };
    let real;
    Object.defineProperty(window, 'ws', { configurable: true, get: () => real, set(ws) {
      real = ws;
      const open = ws.open.bind(ws);
      ws.open = (path, opts) => (log.opens.push(path), open(path, opts));
      const written = ws.vault.written.bind(ws.vault);
      ws.vault.written = path => (log.written.push(path), written(path));
    } });
  })();` });
  /** Reload the page (a new startup) and wait until the app has settled. */
  const restart = async (url) => {
    await run(async () => { const { settings } = await import('/src/settings/store.ts'); settings.flush(); window.__stale = true; });
    await sleep(100);
    if (url) await send('Page.navigate', { url }); else await send('Page.reload');
    await wait(() => evaluate('!window.__stale && !!window.ws?.active.path'), 'the app did not start again');
    let last = '';
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      const now = await evaluate('JSON.stringify([window.__daily, ws.active.path])');
      if (now === last) break;
      last = now;
    }
  };
  const state = () => run(path => ({
    opens: __daily.opens.filter(p => p === path).length,
    written: __daily.written.filter(p => p === path).length,
    allWritten: __daily.written.length,
    active: ws.active.path,
    tabs: ws.groups().flatMap(g => g.tabs).filter(t => t.path === path).length,
    exists: ws.vault.notes.some(n => n.path === path),
  }), today);

  // 1. Off by default: an ordinary start opens no daily note.
  check(await run(() => settings.get('daily-notes.json').autorun === false), 'Open daily note on startup is off by default');
  await restart();
  let s = await state();
  check(!s.exists && s.opens === 0 && s.allWritten === 0 && s.active !== today, 'with the option off, starting creates and opens no daily note');

  // 2. On, with folders in the format: the note and its folders are created and opened, once.
  await run(() => {
    settings.set('daily-notes.json', 'autorun', true);
    settings.set('daily-notes.json', 'folder', 'Journal');
    settings.set('daily-notes.json', 'format', 'YYYY/MM/YYYY-MM-DD');
  });
  await restart();
  s = await state();
  check(s.exists && s.written === 1 && s.allWritten === 1, 'starting creates today\'s daily note exactly once');
  check(s.opens === 1 && s.active === today && s.tabs === 1, 'starting opens today\'s daily note once, in one tab');
  check(await run(path => {
    const dirs = new Set(ws.vault.files.filter(f => f.is_dir).map(f => f.path));
    const parts = path.split('/');
    return dirs.has(parts[0]) && dirs.has(parts.slice(0, 2).join('/')) && dirs.has(parts.slice(0, 3).join('/'));
  }, today), 'the format\'s year and month folders are created with the note');

  // Later events in the same window do not start it again.
  await run(async () => {
    settings.set('daily-notes.json', 'autorun', false);
    settings.set('daily-notes.json', 'autorun', true);
    await ws.vault.refreshFiles();
    await ws.open('Ideas.md');
  });
  await sleep(600);
  s = await state();
  check(s.written === 1 && s.opens === 1, 'settings changes and vault refreshes after startup do not open or create it again');

  // Two opens of a day that has no note yet, at the same moment, make one note.
  check(await run(async path => {
    const { openDailyNote } = await import('/src/editorHost.ts');
    const day = new Date(); day.setDate(day.getDate() + 1);
    await Promise.all([openDailyNote(ws, day), openDailyNote(ws, day)]);
    return __daily.written.filter(p => p === path).length === 1 && ws.active.path === path;
  }, tomorrow), 'two opens of a missing daily note at once create it once');
  check(await run(async () => { grove.run('daily-notes:goto-prev'); await new Promise(r => setTimeout(r, 200)); return ws.active.path; }) === today,
    'previous daily note goes from tomorrow to today across the format\'s folders');

  // 3. Today's note already in a tab: that tab is shown, the active one keeps its note.
  await run(async () => {
    settings.set('daily-notes.json', 'folder', '');
    settings.set('daily-notes.json', 'format', '[Welcome]');
    await ws.open('Welcome.md');
    await ws.open('Ideas.md', { where: 'tab' });
  });
  await sleep(700); // the layout is saved half a second after it changes
  await restart();
  const shown = await run(() => ({
    active: ws.active.path,
    welcome: ws.groups().flatMap(g => g.tabs).filter(t => t.path === 'Welcome.md').length,
    ideas: ws.groups().flatMap(g => g.tabs).filter(t => t.path === 'Ideas.md').length,
    written: __daily.written.length,
  }));
  check(shown.active === 'Welcome.md' && shown.welcome === 1 && shown.ideas === 1 && shown.written === 0,
    'an existing daily note already in a tab is shown in that tab, with nothing created or replaced');

  // 4. The Daily notes plugin turned off: nothing opens.
  await run(() => {
    settings.set('daily-notes.json', 'folder', 'Journal');
    settings.set('daily-notes.json', 'format', 'YYYY/MM/YYYY-MM-DD');
    settings.set('core-plugins.json', 'daily-notes', false);
  });
  await restart();
  s = await state();
  check(!s.exists && s.opens === 0 && s.allWritten === 0, 'with the Daily notes plugin off, starting opens no daily note');

  // 5. A note opened in a window of its own is not a startup of the vault.
  await run(() => settings.set('core-plugins.json', 'daily-notes', true));
  await restart(`${await evaluate('location.origin')}/?note=${encodeURIComponent('Ideas.md')}`);
  s = await state();
  check(!s.exists && s.allWritten === 0 && s.active === 'Ideas.md', 'a note window does not open the daily note');
  await run(() => {
    settings.set('daily-notes.json', 'autorun', false);
    settings.set('daily-notes.json', 'folder', '');
    settings.set('daily-notes.json', 'format', 'YYYY-MM-DD');
    settings.flush();
  });
});
