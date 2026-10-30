// Step 4: real search rows/copy and graph filter + colour group over the mock commands.
import { withBrowser, sleep } from './browser.mjs';

await withBrowser(async ({ run, fill, click, press, check }) => {
  const wait = async (test, message) => {
    for (let i = 0; i < 100; i++) { if (await test()) return; await sleep(50); }
    throw new Error(message);
  };
  await run(async () => {
    const { api } = await import('/src/api.ts');
    const { settings } = await import('/src/settings/store.ts');
    await api.createNote('C1B/A.MD', 'c1bfilter c1bcolor\n');
    await api.createNote('C1B/B.md', 'c1bfilter c1bfilter\n');
    await api.createNote('C1B/Other.md', 'other\n');
    await ws.vault.refreshFiles();
    settings.set('graph.json', 'showOrphans', true);
    settings.set('graph.json', 'hideUnresolved', true);
    settings.set('graph.json', 'close', false);
    settings.set('graph.json', 'collapse-filter', false);
    settings.set('graph.json', 'collapse-color-groups', false);
    const calls = window.__c1b = { queries: [], colors: [], lines: [], reads: [], copied: null };
    const match = api.searchMatch;
    api.searchMatch = queries => { calls.queries.push([...queries]); return match(queries); };
    const fill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function(...args) {
      if (this.canvas.classList.contains('graph-canvas')) calls.colors.push(this.fillStyle);
      return fill.apply(this, args);
    };
    ws.openView('graph');
  });
  await wait(() => run(() => !!document.querySelector('.graph-search-input')?.offsetParent), 'graph filter did not appear');
  await fill('.graph-search-input', 'c1bfilter');
  await wait(() => run(() => window.__graphNodes === 2), 'text filter should leave both matching notes, including .MD');
  await click(await run(() => {
    const el = [...document.querySelectorAll('.graph-controls button')].find(el => el.textContent === 'New group');
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }));
  await fill('.graph-color-group-query', 'c1bcolor');
  await wait(() => run(() => __c1b.queries.some(q => q.length === 2 && q[0] === 'c1bfilter' && q[1] === 'c1bcolor') && __c1b.colors.includes('#e05252')), 'graph group text was not batched or painted');
  check(await run(() => window.__graphNodes === 2), 'graph text filter plus text colour group retains both matching notes');
  check(await run(() => __c1b.colors.includes('#e05252')), 'the matching colour group is painted with its selected colour');
  const beforeTags = await run(() => __c1b.queries.length);
  await click('.graph-controls [aria-label="Tags"]');
  await sleep(400);
  check(await run(n => __c1b.queries.length === n, beforeTags), 'toggling graph tags reuses the cached query answer');

  await run(async () => {
    const { api } = await import('/src/api.ts');
    const lines = api.searchLines, read = api.readNote;
    api.searchLines = async (query, matchCase, paths, limit) => {
      __c1b.lines.push({ query, paths, limit });
      const found = await lines(query, matchCase, paths, limit);
      if (!__c1b.keepAllLines) delete found['C1B/A.MD']; // save between notes and lines
      if (__c1b.delayCopy) return new Promise(resolve => { __c1b.releaseCopy = () => resolve(found); });
      return found;
    };
    api.readNote = path => { __c1b.reads.push(path); return read(path); };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: text => { __c1b.copied = { text, active: navigator.userActivation.isActive }; return Promise.resolve(); },
    } });
    grove.run('global-search:open');
  });
  await fill('.search-view .search-input', 'c1bfilter');
  await wait(() => run(() => document.querySelectorAll('.search-view .search-result').length === 2), 'search rows did not appear');
  check(await run(() => document.querySelector('.search-results-count-label').textContent === '3 results'), 'search total comes from exact backend counts');
  check(await run(() => {
    const rows = [...document.querySelectorAll('.search-view .search-result')];
    return rows[0].querySelector('.search-result-file-name').textContent === 'A' && !rows[0].querySelector('.search-result-file-match') && rows[1].querySelector('.search-result-file-match');
  }), 'a matching .MD note omitted from search_lines still draws its file row');
  check(await run(() => !__c1b.reads.some(path => path.startsWith('C1B/'))), 'search does not read full note context for ordinary rows');
  await run(() => { __c1b.keepAllLines = true; __c1b.delayCopy = true; });
  const beforeCopy = await run(() => __c1b.lines.length);
  await click('.search-view [aria-label="More options"]');
  check(await run(() => !!document.querySelector('.menu-item[aria-disabled="true"]')), 'copy menu opens immediately with its pending action disabled');
  await run(() => { __c1b.delayCopy = false; __c1b.releaseCopy(); });
  await wait(() => run(() => document.querySelector('.menu-item[aria-disabled="false"]')?.textContent.includes('Copy search results')), 'copy results did not become ready');
  check(await run(n => __c1b.lines.length > n, beforeCopy), 'opening the copy menu fetches all matching paths');
  await click('.menu-item[aria-disabled="false"]');
  check(await run(() => __c1b.copied?.text.includes('c1bfilter c1bcolor') && __c1b.copied.active), 'copy writes fetched lines during the item-click user gesture');
  await fill('.search-view .search-input', 'path:C1B');
  await wait(() => run(() => document.querySelectorAll('.search-view .search-result').length === 3), 'path search rows did not appear');
  check(await run(() => !document.querySelector('.search-view .search-result-file-match')), 'file/path-only search shows no excerpt lines');
  await press('Escape');
});
