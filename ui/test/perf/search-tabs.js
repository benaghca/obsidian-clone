(async () => {
  const post = m => window.webkit.messageHandlers.out.postMessage(typeof m === 'string' ? m : JSON.stringify(m));
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const time = async (name, fn, reps = 5) => {
    const t = [];
    for (let i = 0; i < reps; i++) { const t0 = performance.now(); await fn(i); await frame(); t.push(performance.now() - t0); await sleep(120); }
    t.sort((a, b) => a - b);
    post({ name, median: Math.round(t[Math.floor(t.length / 2)]), max: Math.round(t[t.length - 1]) });
  };
  try {
    while (typeof S === 'undefined' || S.notes.size < 3000) await sleep(5);
    post({ name: 'startup: vault indexed (ms since page start)', median: Math.round(performance.now()), max: 0 });
    while (!document.querySelector('#tree .t-row')) await sleep(5);
    post({ name: 'startup: file tree drawn', median: Math.round(performance.now()), max: 0 });
    await sleep(1500);
    const notes = [...S.notes.keys()];
    for (const q of ['quick brown', 'section', 'tag:topic work', '"into this"']) await time(`search "${q}"`, () => { $('#search-input').value = q; runSearch(); }, 3);
    $('#search-input').value = ''; runSearch();
    openLauncher(''); await frame();
    const input = document.querySelector('.modal input.field');
    let typed = '';
    await time('quick switcher: each key typed ("note 12 we")', i => { typed += 'note 12 we'[i]; input.value = typed; input.dispatchEvent(new Event('input', { bubbles: true })); }, 10);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(200);
    document.querySelector('.modal')?.remove();
    openLauncher('/'); await frame();
    const inp2 = document.querySelector('.modal input.field'); typed = '/';
    await time('quick switcher "/" text search: each key ("brown fox")', i => { typed += 'brown fox'[i]; inp2.value = typed; inp2.dispatchEvent(new Event('input', { bubbles: true })); }, 9);
    document.querySelector('.modal')?.remove(); await sleep(200);
    await openPath(notes[10]); await openInNewTab(notes[20]); await sleep(300);
    const a = S.tab, b = a === 0 ? 1 : a - 1;
    await time('switch tab', i => activateTab(i % 2 ? a : b), 6);
    for (const t of ['outgoing', 'outline', 'backlinks']) await time(`right pane: ${t}`, () => { rtab = t; refreshPanels(); }, 3);
    post('DONE');
  } catch (e) { post('ERROR ' + e.message + ' ' + e.stack); post('DONE'); }
})();
