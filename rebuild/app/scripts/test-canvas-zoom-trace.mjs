import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeTrace } from './canvas-zoom-trace.mjs';

test('trace totals use renderer main work and worker raster, without treating rAF as presentation', () => {
  const events = [
    { name: 'thread_name', pid: 7, tid: 8, args: { name: 'CrRendererMain' } },
    ...['DrawFrame', 'DrawFrame', 'DroppedFrame'].map(name => ({ name, ph: 'I', pid: 7, tid: 9 })),
    { name: 'DroppedFrame', ph: 'I', pid: 1, tid: 2 },
    ...[['RunTask', 60000], ['UpdateLayoutTree', 10000], ['Layerize', 3000], ['Paint', 2000], ['HitTest', 1000], ['Layout', 4000]].map(([name, dur]) => ({ name, dur, ph: 'X', pid: 7, tid: 8 })),
    { name: 'RasterTask', dur: 20000, ph: 'X', pid: 7, tid: 9 },
    { name: 'RunTask', dur: 80000, ph: 'X', pid: 1, tid: 2 },
    { name: 'Paint', dur: 9000, ph: 'X', pid: 7, tid: 9 },
    { name: 'FireAnimationFrame', dur: 1000000, ph: 'X', pid: 7, tid: 8 },
  ];
  assert.deepEqual(summarizeTrace(events, 2), { steps: 2, drawn: 2, dropped: 1, perStep: { task: 30, style: 5, layerize: 1.5, paint: 1, hitTest: .5, layout: 2, raster: 10 }, longTasks: [60] });
});
test('missing renderer or compositor instrumentation cannot silently pass', () => {
  assert.throws(() => summarizeTrace([], 24), /renderer/);
  assert.throws(() => summarizeTrace([{ name: 'thread_name', pid: 1, tid: 2, args: { name: 'CrRendererMain' } }], 24), /DrawFrame/);
});
