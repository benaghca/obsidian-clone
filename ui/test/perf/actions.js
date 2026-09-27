// Runs inside the app page (WebKitGTK). Times common actions; posts JSON results.
(async () => {
  const post = m => window.webkit.messageHandlers.out.postMessage(typeof m === 'string' ? m : JSON.stringify(m));
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const time = async (name, fn, reps = 5) => {
    const t = [];
    for (let i = 0; i < reps; i++) { const t0 = performance.now(); await fn(i); await frame(); t.push(performance.now() - t0); await sleep(150); }
    t.sort((a, b) => a - b);
    post({ name, median: Math.round(t[Math.floor(t.length / 2)]), max: Math.round(t[t.length - 1]) });
  };
  try {
    while (typeof S === 'undefined' || S.notes.size < 3000) await sleep(100);
    await sleep(1500);
    const notes = [...S.notes.keys()], small = notes.filter(p => / 2[0-9]{3} /.test(p)).slice(0, 10), big = notes.find(p => / 0000 /.test(p));
    await time('open a small note (incl. first paint)', i => openPath(small[i]));
    await time('open a long note', () => openPath(big), 3);
    await time('unlinkedMentions() alone', () => unlinkedMentions(small[0]));
    await time('backlinksOf() alone', () => backlinksOf(small[0]));
    await openPath(small[1]); if (S.mode !== 'edit') setMode('edit'); await frame();
    const v = ed.view;
    await time('keystroke in a small note (dispatch + paint)', () => { const e = v.state.doc.length; v.dispatch({ changes: { from: e, insert: 'x' }, selection: { anchor: e + 1 }, userEvent: 'input.type' }); }, 20);
    await openPath(big); await frame();
    await time('keystroke in a long note', () => { const p = v.state.doc.line(40).to; v.dispatch({ changes: { from: p, insert: 'x' }, selection: { anchor: p + 1 }, userEvent: 'input.type' }); }, 20);
    await time('selection move in a long note', i => v.dispatch({ selection: { anchor: v.state.doc.line(40 + i).from } }), 20);
    await time('save + reindex (setNote)', () => { const n = S.notes.get(S.cur); setNote(S.cur, ed.value, n.mtime); resolveNote(S.cur); }, 5);
    await time('reindexAll()', () => reindexAll(), 3);
    await time('renderTree()', () => renderTree(), 3);
    await time('expand all folders', () => setAllExpanded(true), 1);
    await time('collapse all folders', () => setAllExpanded(false), 1);
    await time('open graph', () => openGraph(false), 1);
    await sleep(3000);
    await time('open tasks view', () => openTasks(), 2);
    post('DONE');
  } catch (e) { post('ERROR ' + e.message + ' ' + e.stack); post('DONE'); }
})();
