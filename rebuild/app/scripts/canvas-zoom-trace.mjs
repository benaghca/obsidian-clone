// CDP trace collection shared by the zoom bench and its compositor regression.
// rAF callback intervals cannot tell whether Chromium presented a frame.
export async function traceGesture({ send, on }, gesture) {
  const complete = new Promise(resolve => {
    const off = on('Tracing.tracingComplete', result => { off(); resolve(result); });
  });
  await send('Tracing.start', {
    categories: 'toplevel,benchmark,cc,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame',
    transferMode: 'ReturnAsStream',
  });
  try { await gesture(); } finally { await send('Tracing.end'); }
  const { stream, dataLossOccurred } = await complete;
  if (dataLossOccurred) throw Error('Chromium lost trace events; this measurement is invalid');
  let json = '';
  try {
    for (;;) {
      const part = await send('IO.read', { handle: stream, size: 1024 * 1024 });
      json += part.base64Encoded ? Buffer.from(part.data, 'base64').toString() : part.data;
      if (part.eof) break;
    }
  } finally { await send('IO.close', { handle: stream }); }
  return JSON.parse(json).traceEvents;
}

export function summarizeTrace(events, steps) {
  const main = events.find(e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  if (!main) throw Error('Trace has no renderer main thread');
  const names = { RunTask: 'task', UpdateLayoutTree: 'style', Layerize: 'layerize', Paint: 'paint', HitTest: 'hitTest', Layout: 'layout' };
  const totals = Object.fromEntries([...Object.values(names), 'raster'].map(k => [k, 0]));
  const longTasks = [];
  let drawn = 0, dropped = 0;
  for (const e of events) {
    if (e.pid === main.pid && e.name === 'DrawFrame') drawn++;
    if (e.pid === main.pid && e.name === 'DroppedFrame') dropped++;
    if (e.ph !== 'X' || !e.dur) continue;
    if (e.pid === main.pid && e.tid !== main.tid && e.name === 'RasterTask') totals.raster += e.dur / 1000;
    if (e.pid !== main.pid || e.tid !== main.tid) continue;
    if (names[e.name]) totals[names[e.name]] += e.dur / 1000;
    if (e.name === 'RunTask' && e.dur > 50000) longTasks.push(e.dur / 1000);
  }
  if (!drawn) throw Error('Trace has no DrawFrame events; refusing a vacuous frame assertion');
  return { steps, drawn, dropped, perStep: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, +(v / steps).toFixed(3)])), longTasks: longTasks.map(n => +n.toFixed(1)) };
}
