(async () => {
  const post = m => window.webkit.messageHandlers.out.postMessage(typeof m === 'string' ? m : JSON.stringify(m));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    while (typeof S === 'undefined' || S.notes.size < 3000) await sleep(20);
    await sleep(1000);
    const big = [...S.notes.keys()].find(p => / 0000 /.test(p));
    for (const mode of ['edit', 'read']) {
      await openPath(big); setMode(mode); await sleep(800);
      const sc = mode === 'edit' ? ed.view.scrollDOM : document.querySelector('#preview').closest('.scroller, #view-note') || document.scrollingElement;
      const el = (() => { let e = mode === 'edit' ? ed.view.contentDOM : document.querySelector('#preview'); while (e && e.scrollHeight <= e.clientHeight + 5) e = e.parentElement; return e; })();
      el.scrollTop = 0; await sleep(300);
      const t = []; let last = performance.now();
      await new Promise(res => { let i = 0; const f = now => { t.push(now - last); last = now; el.scrollTop += 90; if (++i < 240 && el.scrollTop + el.clientHeight < el.scrollHeight - 5) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      t.sort((a, b) => a - b);
      post({ name: `scroll long note (${mode === 'edit' ? 'live preview' : 'reading view'})`, frames: t.length, height: el.scrollHeight, median: Math.round(t[t.length >> 1]), p90: Math.round(t[Math.floor(t.length * 0.9)]), worst: Math.round(t[t.length - 1]) });
    }
    post('DONE');
  } catch (e) { post('ERROR ' + e.message + ' ' + e.stack); post('DONE'); }
})();
