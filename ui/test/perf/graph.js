(async () => {
  const post = m => window.webkit.messageHandlers.out.postMessage(typeof m === 'string' ? m : JSON.stringify(m));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const frames = async ms => { const t = []; let last = performance.now(); const end = last + ms; await new Promise(res => { const f = now => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); t.sort((a, b) => a - b); return { frames: t.length, fps: Math.round(t.length / (ms / 1000)), median: Math.round(t[t.length >> 1]), p90: Math.round(t[Math.floor(t.length * 0.9)]), worst: Math.round(t[t.length - 1]) }; };
  try {
    while (typeof S === 'undefined' || S.notes.size < 3000) await sleep(20);
    await sleep(1500);
    const t0 = performance.now(); await openGraph(false); const opened = performance.now() - t0;
    post({ name: 'openGraph() blocking ms', v: Math.round(opened) });
    post({ name: 'first 3s after opening (settling)', ...(await frames(3000)) });
    await sleep(8000);
    post({ name: 'idle, settled', ...(await frames(1000)) });
    // drag a node for 2s via synthetic mouse events on the canvas
    const c = document.querySelector('#graph-canvas'), r = c.getBoundingClientRect();
    const id = S.cur || [...S.notes.keys()][0];
    const pos = CinderGraph.screenPos([...S.notes.keys()][5]) || [r.width / 2, r.height / 2];
    const at = (x, y) => ({ clientX: r.left + x, clientY: r.top + y, bubbles: true, button: 0 });
    c.dispatchEvent(new MouseEvent('mousedown', at(pos[0], pos[1])));
    const drag = frames(2000);
    for (let i = 0; i < 100; i++) { window.dispatchEvent(new MouseEvent('mousemove', at(pos[0] + i * 3, pos[1] + Math.sin(i / 5) * 40))); await sleep(20); }
    post({ name: 'dragging a node', ...(await drag) });
    window.dispatchEvent(new MouseEvent('mouseup', at(pos[0] + 300, pos[1])));
    post('DONE');
  } catch (e) { post('ERROR ' + e.message + ' ' + e.stack); post('DONE'); }
})();
