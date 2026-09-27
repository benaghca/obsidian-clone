(async () => {
  const post = m => window.webkit.messageHandlers.out.postMessage(typeof m === 'string' ? m : JSON.stringify(m));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    while (typeof S === 'undefined' || S.notes.size < 3000) await sleep(20);
    await sleep(800);
    const small = [...S.notes.keys()].find(p => / 2700 /.test(p)), big = [...S.notes.keys()].find(p => / 0001 /.test(p));
    for (const [label, p] of [['small note', small], ['long note', big]]) {
      const t = [];
      for (let i = 0; i < 10; i++) { const n = S.notes.get(p); const t0 = performance.now(); await writeFile(p, n.content + ' x', n.mtime); t.push(performance.now() - t0); await sleep(50); }
      t.sort((a, b) => a - b);
      post({ name: `save a ${label} (${Math.round(S.notes.get(p).content.length / 1024)} KB), round trip`, median: t[5].toFixed(1), max: t[9].toFixed(1) });
    }
    post('DONE');
  } catch (e) { post('ERROR ' + e.message); post('DONE'); }
})();
