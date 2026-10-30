#!/usr/bin/env node
// What a user feels, in headless Chromium on the mock's synthetic vault
// (`?synthetic=n`, at most 20,000 notes): input-to-paint for typing and the
// quick switcher, note switch time, expanding a big folder, and the graph's
// frames. Counts long tasks (over 50 ms) and slow events (over 16 ms, Event
// Timing), not only averages. Not part of npm test (RUST_PERF_PLAN.md).
//
//   flock /tmp/grove-npm-test.lock node scripts/bench-feel-browser.mjs 5000
//
// The mock's link index resolves every link against every note, so on a big
// synthetic vault the page is blocked for a while after load. That is a mock
// cost (Rust builds the index in a few ms), so this waits for it before
// measuring anything.

import { sleep, withBrowser } from "./browser.mjs";

const n = Number(process.argv[2] ?? 5000);

await withBrowser(async ({ send, evaluate, run, press, chord, click }) => {
  const base = await evaluate("location.origin + location.pathname");
  const started = Date.now();
  await send("Page.navigate", { url: `${base}?synthetic=${n}` });
  await sleep(300);
  for (let i = 0; i < 6000 && !(await evaluate("!!window.ws?.active.path && ws.vault.notes.length > 1000").catch(() => false)); i++) await sleep(100);
  const ready = Date.now() - started;
  for (let i = 0; i < 6000 && !(await evaluate("Object.keys(ws.vault.links.outgoing).length > 1000").catch(() => false)); i++) await sleep(200);
  const linked = Date.now() - started;
  // From here the mock answers the link commands from the index it built,
  // still paying JSON.parse of the full reply on the page as Tauri would.
  await run(async () => {
    const { api } = await import("/src/api.ts");
    const links = JSON.stringify(ws.vault.links);
    const back = {};
    for (const [from, tos] of Object.entries(ws.vault.links.outgoing)) for (const to of tos) (back[to] ??= []).push({ from, line: 1, text: "" });
    api.linkIndex = async () => JSON.parse(links);
    api.backlinks = async (paths) => JSON.parse(JSON.stringify(Object.fromEntries(paths.filter((p) => back[p]).map((p) => [p, back[p]]))));
  });
  await sleep(500);

  await run(() => {
    const p = (window.__perf = { long: [], events: [], frames: [] });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => p.long.push(e.duration))).observe({ type: "longtask" });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => p.events.push({ name: e.name, d: e.duration }))).observe({ type: "event", durationThreshold: 16 });
    const loop = (t) => { p.frames.push(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  const reset = () => run(() => { const p = window.__perf; p.long = []; p.events = []; p.frames = []; });
  const take = () => run(() => {
    const p = window.__perf;
    const gaps = p.frames.slice(1).map((t, i) => t - p.frames[i]).sort((a, b) => a - b);
    const pick = (q) => Number((gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))] ?? 0).toFixed(1));
    return {
      frames: gaps.length, gap_p50: pick(0.5), gap_p95: pick(0.95), gap_max: pick(1),
      over_20ms: gaps.filter((g) => g > 20).length,
      long_tasks: p.long.length, long_max: Math.round(Math.max(0, ...p.long)),
      slow_events: p.events.length, event_max: Math.round(Math.max(0, ...p.events.map((e) => e.d))),
    };
  });
  const typeText = async (text, gap) => {
    for (const ch of text) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      await sleep(gap);
    }
  };
  const out = { n, ready_ms: ready, links_ready_ms: linked };

  // Note switch: open a note and wait for two frames (it is painted by then).
  const paths = await evaluate("ws.vault.notes.filter((_, i) => i % 997 === 3).slice(0, 6).map(n => n.path)");
  const switches = [];
  for (const path of paths) {
    switches.push(await run(async (path) => {
      const t = performance.now();
      await ws.open(path);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t;
    }, path));
    await sleep(150);
  }
  out.note_switch_ms = switches.map((ms) => Math.round(ms));

  // Typing: 40 characters at a quick 40 ms each, at the end of the open note.
  await click(".cm-content");
  await press("End");
  await reset();
  await typeText("the quick brown fox jumps over the lazy ", 40);
  await sleep(400);
  out.typing = await take();

  // Quick switcher: Ctrl+O, then one keystroke every 120 ms.
  await reset();
  await chord("o");
  await sleep(200);
  await typeText("river s", 120);
  await sleep(400);
  out.switcher = await take();
  await press("Escape");
  await sleep(200);

  // File tree: expand the biggest folder (a sixth of the notes).
  await reset();
  await click('.nav-folder-title[data-path="Projects"]');
  await sleep(600);
  out.expand_folder = await take();
  out.expand_rows = await evaluate("document.querySelectorAll('.nav-file-title').length");
  await click('.nav-folder-title[data-path="Projects"]');
  await sleep(300);

  // Graph view: Ctrl+G, then four seconds of frames while it settles.
  await reset();
  await chord("g");
  await sleep(4000);
  out.graph = await take();

  console.log(JSON.stringify(out));
});
