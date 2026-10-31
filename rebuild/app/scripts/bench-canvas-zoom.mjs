// Report only: flock /tmp/grove-npm-test.lock node scripts/bench-canvas-zoom.mjs
// Optional: --cards=300 --device-scale=2 --trace-dir=/tmp/grove-cz0-traces
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withBrowser, sleep } from './browser.mjs';
import { traceGesture, summarizeTrace } from './canvas-zoom-trace.mjs';

const option = name => process.argv.find(s => s.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const counts = (option('cards') ?? '100,300,1000,3000').split(',').map(Number);
const deviceScale = Number(option('device-scale') ?? 1), traceDir = option('trace-dir');
if (counts.some(n => !Number.isInteger(n) || n < 1 || n > 3000) || ![1, 2].includes(deviceScale)) throw Error('Use 1..3000 cards and device-scale 1 or 2');
if (traceDir) await mkdir(traceDir, { recursive: true });

export function zoomBoard(count) {
  const across = Math.ceil(Math.sqrt(count * 1.6));
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`, type: i % 5 === 0 ? 'file' : 'text', x: i % across * 280, y: Math.floor(i / across) * 190, width: 250, height: 160,
    ...(i % 5 === 0 ? { file: 'CZ0-note.md' } : { text: `## Card ${i}\n**Local** Markdown and [[Welcome]].\n- Item\n- [ ] Task` }),
    ...(i % 3 ? { color: String(i % 6 + 1) } : {}),
  }));
  for (let i = 0; i < count; i += 50) {
    const members = nodes.slice(i, Math.min(count, i + 50)), x = Math.min(...members.map(n => n.x)), y = Math.min(...members.map(n => n.y));
    members.length && nodes.push({ id: `g${i}`, type: 'group', x: x - 20, y: y - 35, width: Math.max(...members.map(n => n.x + n.width)) - x + 40, height: Math.max(...members.map(n => n.y + n.height)) - y + 55, label: `Group ${i / 50}`, color: '4' });
  }
  return { nodes, edges: Array.from({ length: Math.floor(count * 4 / 3) }, (_, i) => ({ id: `e${i}`, fromNode: `n${i % count}`, toNode: `n${(i * 7 + 1) % count}`, fromSide: 'right', toSide: 'left', ...(i % 25 === 0 ? { label: `Edge ${i}` } : {}) })) };
}

const rows = [];
await withBrowser(async driver => {
  const { send, run, click } = driver;
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: deviceScale, mobile: false });
  console.log('CZ0_ENV', JSON.stringify({ ...(await send('Browser.getVersion')), width: 1280, height: 1000, deviceScale, gpu: 'disabled (software, shared browser harness)' }));
  await run(async () => { const { api } = await import('/src/api.ts'); await api.createNote('CZ0-note.md', '# A short note\n**Local** Markdown and [[Welcome]].\n- Item\n- [ ] Task'); });
  for (const count of counts) {
    const board = zoomBoard(count);
    const opening = await run(async (board, count) => {
      const { api } = await import('/src/api.ts');
      const path = `CZ0-${count}.canvas`; await api.createNote(path, JSON.stringify(board)); await ws.vault.refreshFiles();
      const long = [], observer = new PerformanceObserver(list => long.push(...list.getEntries().map(e => e.duration)));
      observer.observe({ type: 'longtask', buffered: false });
      const start = performance.now(); await ws.open(path);
      while (document.querySelectorAll('.canvas-node').length !== board.nodes.length) await new Promise(r => setTimeout(r, 20));
      const ms = performance.now() - start;
      await new Promise(requestAnimationFrame); await new Promise(r => setTimeout(r, 50)); observer.disconnect();
      return { ms, longest: Math.max(0, ...long), dom: document.querySelector('.canvas-view').querySelectorAll('*').length };
    }, board, count);
    await sleep(500);
    for (const kind of ['wheel', 'pinch', 'pan']) {
      await click('.canvas-controls .lucide-maximize'); await sleep(250);
      const half = kind === 'pinch' ? count <= 300 ? 150 : 60 : 12;
      const steps = half * 2, interval = kind === 'pinch' ? 8 : 16;
      const center = await run(() => { const r = document.querySelector('.canvas-view').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await run(() => {
        window.cz0Inputs = 0; window.cz0Draws = 0; window.cz0LastInput = 0;
        window.cz0Count = e => { cz0Inputs++; cz0LastInput = performance.timeOrigin + e.timeStamp; };
        document.querySelector('.canvas-view').addEventListener('wheel', cz0Count);
        window.cz0Observer = new MutationObserver(records => { cz0Draws += records.filter(r => r.attributeName === 'style').length; });
        cz0Observer.observe(document.querySelector('.canvas-world'), { attributes: true });
      });
      const started = performance.now();
      let gestureMs, observed;
      const trace = await traceGesture(driver, async () => {
        const begin = performance.now();
        // Keep sending at the requested cadence; awaiting each input ACK would
        // silently slow the input rate to match a busy renderer.
        const pending = [];
        let lastInput;
        for (let i = 0; i < steps; i++) {
          const sign = i < half ? -1 : 1;
          lastInput = Date.now();
          pending.push(send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...center, timestamp: lastInput / 1000, deltaX: 0, deltaY: sign * (kind === 'wheel' ? 100 : kind === 'pinch' ? 6 : 4000), modifiers: kind === 'pan' ? 0 : 2 }));
          await sleep(interval);
        }
        await Promise.all(pending);
        // An input ACK can precede DOM delivery. Keep tracing until the final
        // timestamp reaches the page, otherwise queued input contaminates the
        // next gesture and trace-transfer time corrupts the update denominator.
        const deadline = performance.now() + 120000;
        while (!await run(last => cz0LastInput >= last - 1, lastInput)) {
          if (performance.now() > deadline) throw Error('Final native wheel input never reached the page');
          await sleep(20);
        }
        await run(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await sleep(250);
        observed = await run(() => { document.querySelector('.canvas-view').removeEventListener('wheel', cz0Count); cz0Observer.disconnect(); return { delivered: cz0Inputs, viewportUpdates: cz0Draws }; });
        gestureMs = performance.now() - begin;
      });
      const summary = summarizeTrace(trace, steps);
      if (!observed.delivered || !observed.viewportUpdates) throw Error('Gesture did not reach or transform the board');
      const metrics = { cards: count, kind, dom: opening.dom, opening, requestedIntervalMs: interval, gestureMs: +gestureMs.toFixed(1), traceWallMs: +(performance.now() - started).toFixed(1), ...observed, ...summary,
        perUpdate: Object.fromEntries(Object.entries(summary.perStep).map(([k, v]) => [k, +(v * steps / observed.viewportUpdates).toFixed(3)])) };
      rows.push(metrics); console.log('CZ0_RESULT', JSON.stringify(metrics));
      if (traceDir) await writeFile(join(traceDir, `${count}-${kind}-dpr${deviceScale}.json`), JSON.stringify({ traceEvents: trace }));
    }
  }
});
console.log('\nRequested inputs can coalesce; JSON includes both per-input and per-viewport-update CPU. CPU columns below are ms per viewport update, not callback intervals. Raster sums worker time, not wall time.');
console.log('Cards | DOM | Gesture | Inputs/delivered/updates | Drawn | Dropped | RunTask/update | Style | Layerize | Paint | HitTest | Layout | Raster/update | Long tasks count/max | Open/longest');
for (const r of rows) console.log([r.cards, r.dom, r.kind, `${r.steps}/${r.delivered}/${r.viewportUpdates}`, r.drawn, r.dropped, ...['task', 'style', 'layerize', 'paint', 'hitTest', 'layout', 'raster'].map(k => r.perUpdate[k]), r.longTasks.length ? `${r.longTasks.length}/${Math.max(...r.longTasks)}` : 0, `${r.opening.ms.toFixed(1)}/${r.opening.longest.toFixed(1)}`].join(' | '));
