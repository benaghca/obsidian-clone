// One budget for body rendering, band changes and edge construction. A gesture
// pauses this work; only the navigation transform runs until it settles.
export function canvasWork() {
  const jobs = new Map<object | string, { job: () => void; weight: number }>();
  let frame = 0, paused = true, gone = false;
  const times: number[] = [];
  const schedule = () => { if (!paused && !gone && jobs.size) frame ||= requestAnimationFrame(run); };
  function run() {
    frame = 0; const start = performance.now(); let count = 0;
    while (jobs.size && count < 32 && performance.now() - start < 4) {
      const [key, { job, weight }] = jobs.entries().next().value!; if (count + weight > 32) break; count += weight; jobs.delete(key); job();
    }
    times.push(performance.now() - start); if (times.length > 500) times.shift();
    schedule();
  }
  return { add(key: object | string, job: () => void, weight = 1) { if (!gone) { jobs.delete(key); jobs.set(key, { job, weight: Math.max(1, Math.min(32, weight)) }); schedule(); } },
    cancel(key: object | string) { jobs.delete(key); },
    pause() { paused = true; cancelAnimationFrame(frame); frame = 0; },
    resume() { paused = false; schedule(); },
    dispose() { gone = true; jobs.clear(); cancelAnimationFrame(frame); },
    stats: () => ({ pending: jobs.size, max: Math.max(0, ...times) }),
  };
}
export type CanvasWork = ReturnType<typeof canvasWork>;
