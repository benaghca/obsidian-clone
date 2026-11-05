#!/usr/bin/env node
// P0: fixed 5k gate; raise to 20k only after P1. Uses the real UI and
// cached mock IPC replies, not Rust timing. Budgets: RUST_PERF_PLAN §1.
import assert from "node:assert/strict";
import { sleep, withBrowser } from "./browser.mjs";

const n = 5000;
const STRICT_GRAPH = process.env.GROVE_FEEL_STRICT_GRAPH === "1";

const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const medianTrial = (trials) =>
  [...trials].sort(
    (a, b) => a.long_tasks - b.long_tasks || a.event_max - b.event_max || a.gap_p95 - b.gap_p95 || a.gap_max - b.gap_max,
  )[Math.floor(trials.length / 2)];

await withBrowser(async ({ send, evaluate, run, press, chord, click }) => {
  const base = await evaluate("location.origin + location.pathname");
  const started = Date.now();
  await send("Page.navigate", { url: `${base}?synthetic=${n}` });
  await sleep(300);
  for (let i = 0; i < 600 && !(await evaluate("!!window.ws?.active.path && ws.vault.notes.length > 1000").catch(() => false)); i++) await sleep(100);
  assert.ok(await evaluate("!!window.ws?.active.path && ws.vault.notes.length >= 5000"), "5k vault ready before deadline");
  const ready = Date.now() - started;
  for (let i = 0; i < 600 && !(await evaluate("Object.keys(ws.vault.links.outgoing).length > 1000").catch(() => false)); i++) await sleep(200);
  assert.ok(await evaluate("Object.keys(ws.vault.links.outgoing).length > 1000"), "link index ready before deadline");
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

  // Exercise the dev-only WebKit-compatible meter before measuring the UI.
  assert.ok(await run(async () => {
    const { installHitchMeter } = await import("/src/shell/hitchMeter.ts");
    const { commands } = await import("/src/commands.ts");
    const key = "grove.dev.hitchMeter";
    const saved = localStorage.getItem(key);
    const warn = console.warn;
    const reports = [];
    let stop = () => {};
    try {
      localStorage.setItem(key, "true");
      commands.register({ id: "p0-hitch-probe", name: "P0 probe", run: () => {
        const until = performance.now() + 90;
        while (performance.now() < until) { /* deliberate test hitch */ }
      } });
      console.warn = (...args) => reports.push(args);
      stop = installHitchMeter();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      commands.run("p0-hitch-probe");
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return reports.some(([label, data]) => label === "[Grove hitch]" && data.gapMs > 50 && data.last === "command p0-hitch-probe");
    } finally {
      stop();
      console.warn = warn;
      if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
    }
  }), "dev meter reports a deliberate hitch with its command");

  assert.ok(await evaluate("['longtask', 'event'].every(type => PerformanceObserver.supportedEntryTypes.includes(type))"), "browser supports required performance observers");
  await run(() => {
    const p = (window.__perf = { long: [], events: [], frames: [], observers: [] });
    const onLong = (entries) => entries.forEach((e) => p.long.push(e.duration));
    const onEvent = (entries) => entries.forEach((e) => p.events.push({ name: e.name, d: e.duration }));
    const longObs = new PerformanceObserver((l) => onLong(l.getEntries()));
    longObs.observe({ type: "longtask" });
    const eventObs = new PerformanceObserver((l) => onEvent(l.getEntries()));
    eventObs.observe({ type: "event", durationThreshold: 16 });
    p.observers = [
      () => onLong(longObs.takeRecords()),
      () => onEvent(eventObs.takeRecords()),
    ];
    const loop = (t) => { p.frames.push(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  const reset = () => run(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const p = window.__perf;
    for (const flush of p.observers) flush();
    p.long = [];
    p.events = [];
    p.frames = [];
  });
  const take = () => run(async () => {
    await new Promise((r) => requestAnimationFrame(r));
    const p = window.__perf;
    for (const flush of p.observers) flush();
    const gaps = p.frames.slice(1).map((t, i) => t - p.frames[i]).sort((a, b) => a - b);
    const pick = (q) => Number((gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))] ?? 0).toFixed(1));
    return {
      frames: gaps.length, gap_p50: pick(0.5), gap_p95: pick(0.95), gap_max: pick(1),
      over_20ms: gaps.filter((g) => g > 20).length,
      long_tasks: p.long.length, long_max: Math.round(Math.max(0, ...p.long)),
      slow_events: p.events.filter((e) => e.d > 16).length, event_max: Math.round(Math.max(0, ...p.events.map((e) => e.d))),
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

  // Note switch: warm up once, then open six notes and wait for two frames each.
  const paths = await evaluate("ws.vault.notes.filter((_, i) => i % 997 === 3).slice(0, 6).map(n => n.path)");
  await run(async (path) => {
    await ws.open(path);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, paths[5]);
  await sleep(150);
  const switches = [];
  await reset();
  for (const path of paths) {
    switches.push(await run(async (path) => {
      await new Promise((r) => requestAnimationFrame(r));
      const t = performance.now();
      await ws.open(path);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t;
    }, path));
    await sleep(150);
  }
  out.note_switch_ms = switches.map((ms) => Math.round(ms));
  out.note_switch_median_ms = median(out.note_switch_ms);
  out.note_switch = await take();

  // Typing: warm up editor input + save refresh, then 40 characters at 40 ms each.
  await click(".cm-content");
  await press("End");
  await typeText(" ", 40);
  await press("Backspace");
  await sleep(1800);
  await reset();
  await typeText("the quick brown fox jumps over the lazy !", 40);
  await sleep(1800); // Include autosave and its delayed link refresh.
  out.typing = await take();
  assert.ok(await evaluate("ws.view.state.doc.toString().includes('the quick brown fox jumps over the lazy !')"), "40 characters reached the editor");

  // Quick switcher: warm up once, then take the median of three runs (Ctrl+O, one keystroke every 120 ms).
  const runSwitcher = async (gap) => {
    await chord("o");
    await sleep(200);
    await typeText("river s", gap);
    await sleep(400);
    assert.ok(await evaluate("document.querySelector('.prompt-input')?.value === 'river s' && !!document.querySelector('.suggestion-item')"), "switcher received query and rendered results");
  };
  await runSwitcher(60);
  await press("Escape");
  await sleep(200);
  const switcherTrials = [];
  for (let i = 0; i < 3; i++) {
    await reset();
    await runSwitcher(120);
    switcherTrials.push(await take());
    await press("Escape");
    await sleep(200);
  }
  out.switcher = medianTrial(switcherTrials);

  // File tree: warm up once, then take the median of three expands of the biggest folder (a sixth of the notes).
  await click('.nav-folder-title[data-path="Projects"]');
  await sleep(400);
  await click('.nav-folder-title[data-path="Projects"]');
  await sleep(300);
  const expandTrials = [];
  for (let i = 0; i < 3; i++) {
    await reset();
    await click('.nav-folder-title[data-path="Projects"]');
    await sleep(600);
    expandTrials.push(await take());
    out.expand_rows = await evaluate("document.querySelectorAll('.nav-file-title').length");
    assert.ok(out.expand_rows > 1000, "large folder actually expanded");
    await click('.nav-folder-title[data-path="Projects"]');
    await sleep(300);
  }
  out.expand_folder = medianTrial(expandTrials);

  // Graph view: warm up open/close once, then Ctrl+G and four seconds of frames while it settles.
  await chord("g");
  await sleep(200);
  await chord("w");
  await sleep(200);
  await reset();
  await chord("g");
  await sleep(4000);
  out.graph = await take();
  assert.ok(await evaluate("!!document.querySelector('.graph-view')"), "graph view actually opened");

  console.log(JSON.stringify(out));
  // Collect every miss so a single regression cannot hide another.
  const misses = [];
  const budget = (ok, message) => { if (!ok) misses.push(message); };
  for (const [name, sample] of Object.entries({ note_switch: out.note_switch, typing: out.typing, switcher: out.switcher, expand_folder: out.expand_folder, graph: out.graph })) {
    budget(sample.frames > 5, `${name}: enough frame samples`);
    budget(sample.long_tasks === 0, `${name}: ${sample.long_tasks} long tasks (max ${sample.long_max} ms), budget 0`);
  }
  budget(out.typing.over_20ms === 0 && out.typing.event_max <= 16, "typing: frame <=20 ms and input <=16 ms");
  budget(out.switcher.event_max <= 16 && out.switcher.gap_max <= 50, "switcher: input <=16 ms, results <=50 ms");
  budget(out.note_switch_ms.length === 6 && out.note_switch_ms.every((ms) => ms <= 50), "note switch: all six paints <=50 ms");
  budget(out.expand_folder.gap_p95 <= 17 && out.expand_folder.gap_max <= 33, "expand_folder: p95 <=17 ms and max <=33 ms");
  const graphOk = out.graph.gap_p95 <= 17 && out.graph.gap_max <= 33;
  if (STRICT_GRAPH) {
    budget(graphOk, "graph: p95 <=17 ms and max <=33 ms");
  } else if (!graphOk) {
    console.log(
      `KNOWN GAP (graph, held per Chris until after switch): p95=${out.graph.gap_p95} ms (budget <=17 ms), max=${out.graph.gap_max} ms (budget <=33 ms), over_20ms=${out.graph.over_20ms}/${out.graph.frames} (set GROVE_FEEL_STRICT_GRAPH=1 to enforce)`,
    );
  }
  assert.deepEqual(misses, [], "visible hitch budgets (RUST_PERF_PLAN §1)");
});
