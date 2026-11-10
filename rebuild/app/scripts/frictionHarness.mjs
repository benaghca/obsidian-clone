// The in-page measuring harness shared by the friction (F1) and tab (T1)
// browser tests: a frame loop, Long Task, Event Timing and mutation
// observers, per-frame flash checks, and `measure` to time one action.
import { sleep } from "./browser.mjs";

/** Open the mock's ?synthetic=n vault and wait until its notes and links are in. */
export async function openSynthetic({ send, evaluate }, n) {
  const base = await evaluate("location.origin + location.pathname");
  await send("Page.navigate", { url: `${base}?synthetic=${n}` });
  await sleep(300);
  for (let i = 0; i < 600 && !(await evaluate(`!!window.ws?.active.path && ws.vault.notes.length >= ${n}`).catch(() => false)); i++) await sleep(100);
  for (let i = 0; i < 600 && !(await evaluate("Object.keys(ws.vault.links.outgoing).length > 1000").catch(() => false)); i++) await sleep(100);
}

/** Arm the page, run the input, wait for `cond` (a page expression) and `settle` ms, then take the sample into `out[name]`. */
export const makeMeasure = ({ run, evaluate }, out, report = false) => async (name, input, cond = null, { settle = 250, timeout = 3000, ...opts } = {}) => {
  await run((c, o) => __fx.arm({ ...o, cond: c ? new Function(`return (${c})`) : null }), cond, opts);
  await evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
  await input();
  if (cond) for (let t = 0; t < timeout && !(await evaluate("__fx.done != null")); t += 20) await sleep(20);
  await sleep(settle);
  const sample = (out[name] = await evaluate("__fx.take()"));
  if (report) console.log(name, JSON.stringify(sample));
};

// Installed in the page once: a frame loop, observers, and per-frame checks.
export function harness() {
  const fx = (window.__fx = { on: false });
  const leaf = () => document.querySelector(".workspace-tabs.mod-active .workspace-leaf");
  const shown = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden";
  const noteName = (p) => (p ?? "").split("/").pop().replace(/\.md$/i, "");
  fx.state = () => {
    const path = ws.active.path;
    const header = document.querySelector(".workspace-tabs.mod-active .workspace-tab-header.is-active");
    const row = document.querySelector(".nav-files .tree-item-self.is-active");
    const a = document.activeElement;
    return {
      path,
      tab: header?.textContent.trim() ?? null,
      header: document.querySelector(".workspace-tabs.mod-active .view-header-title")?.textContent.trim() ?? null,
      title: shown(leaf()?.querySelector(".inline-title")) ? leaf().querySelector(".inline-title").textContent : null,
      treeActive: row?.dataset.path ?? null,
      treeScroll: Math.round(document.querySelector(".nav-files-container")?.scrollTop ?? 0),
      backlinks: document.querySelector(".status-bar [aria-label='Show backlinks'] span")?.textContent ?? null,
      words: document.querySelector(".plugin-word-count")?.textContent ?? null,
      focus: a === document.body ? "body" : (a?.closest(".cm-content") ? "editor" : a?.closest(".inline-title") ? "title" : a?.closest(".prompt-input, .search-input") ? "input" : a?.closest(".nav-files") ? "tree" : (a?.className || a?.tagName || "none").toString().slice(0, 40)),
      head: ws.view?.state.selection.main.head ?? null,
      line: ws.view ? ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text.slice(0, 60) : null,
      anchor: ws.view?.state.selection.main.anchor ?? null,
      scroll: Math.round(leaf()?.querySelector(":scope > .view-content")?.scrollTop ?? 0),
      name: noteName(path),
    };
  };
  // Flags for one frame: what a user would see flash.
  const frameFlags = () => {
    const l = leaf();
    const flags = [];
    if (fx.expectNote && ws.active.path && shown(l?.querySelector(".empty-state"))) flags.push("empty-state");
    if (fx.expectNote && ws.active.path && ws.active.type !== "canvas" && !shown(l?.querySelector(".cm-editor"))) flags.push("no-editor");
    if (shown(document.querySelector(".nav-files")) && !document.querySelector(".nav-files-container")?.childElementCount) flags.push("empty-tree");
    if (fx.watchTitle && shown(l?.querySelector(".inline-title")) && l.querySelector(".inline-title").textContent !== noteName(ws.active.path) && document.activeElement !== l.querySelector(".inline-title")) flags.push("title-mismatch");
    return flags;
  };
  // Labels that should go straight from the old value to the new one.
  const labels = () => ({
    status: document.querySelector(".status-bar [aria-label='Show backlinks'] span")?.textContent ?? "",
    pane: shown(document.querySelector(".backlink-pane")) ? document.querySelector(".backlink-pane").textContent.replace(/\s+/g, " ").slice(0, 80) : "",
    words: document.querySelector(".plugin-word-count")?.textContent ?? "",
    tab: document.querySelector(".workspace-tabs.mod-active .workspace-tab-header.is-active")?.textContent.trim() ?? "",
    search: shown(document.querySelector(".search-view")) ? `${document.querySelector(".search-results-count-label")?.textContent ?? ""}|${document.querySelectorAll(".search-view .search-result-file-title").length}` : "",
  });
  const loop = (t) => {
    if (fx.on) {
      fx.frames.push(t);
      fx.series.push(labels());
      for (const f of frameFlags()) fx.flashes[f] = (fx.flashes[f] ?? 0) + 1;
      if (fx.cond && fx.done == null && fx.t0 != null) {
        let ok = false;
        try { ok = fx.cond(); } catch {}
        if (ok) fx.done = performance.now(); // not `t`: a frame's stamp can predate a long handler before it
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // Timing starts at the action's own key, not a modifier held for it.
  const MODIFIERS = ["Control", "Shift", "Alt", "Meta"];
  for (const type of ["keydown", "mousedown", "auxclick", "pointerdown"]) window.addEventListener(type, (e) => { if (fx.on && fx.t0 == null && !MODIFIERS.includes(e.key)) fx.t0 = e.timeStamp; }, true);
  // Mock link commands ([start, end]), for the minus_mock estimate only.
  fx.mock = [];
  const minusMock = (start, d) => d - fx.mock.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, start + d) - Math.max(a, start)), 0);
  new PerformanceObserver((l) => { if (fx.on) for (const e of l.getEntries()) fx.long.push(e); }).observe({ type: "longtask" });
  // Entries that started before the action belong to earlier input (CDP can stamp them late).
  new PerformanceObserver((l) => { if (fx.on) for (const e of l.getEntries()) if (e.startTime >= fx.armedAt) fx.events.push(e); }).observe({ type: "event", durationThreshold: 16 });
  // Remounts: these removed (class selectors still match a detached node), and tree rows dropped from the list.
  const watched = { ".cm-editor": "editor", ".workspace-leaf": "leaf", ".workspace-tab-header": "tab", ".inline-title": "title" };
  new MutationObserver((records) => {
    if (!fx.on) return;
    for (const r of records) for (const node of r.removedNodes) {
      if (!(node instanceof Element)) continue;
      if (r.target.classList?.contains("nav-files-container") && node.classList.contains("tree-item")) fx.removed["tree-row"] = (fx.removed["tree-row"] ?? 0) + 1;
      for (const [sel, name] of Object.entries(watched)) if (node.matches(sel) || node.querySelector(sel)) fx.removed[name] = (fx.removed[name] ?? 0) + 1;
    }
  }).observe(document.body, { childList: true, subtree: true });
  fx.arm = (opts = {}) => Object.assign(fx, { on: true, armedAt: performance.now(), t0: null, done: null, frames: [], series: [labels()], long: [], events: [], mock: [], flashes: {}, removed: {}, cond: opts.cond ?? null, expectNote: opts.expectNote ?? true, watchTitle: opts.watchTitle ?? true });
  fx.take = () => {
    fx.on = false;
    const gaps = fx.frames.slice(1).map((t, i) => t - fx.frames[i]).sort((a, b) => a - b);
    const long = fx.long.filter((e) => e.duration > 50);
    const events = fx.events.map((e) => ({ name: e.name, d: e.duration, js: e.processingEnd - e.processingStart, target: e.target?.className?.toString().slice(0, 30) })).filter((e) => e.d >= 16);
    const q = (p) => Math.round(gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] ?? 0);
    // A label that showed something other than its first and last value in between flashed.
    const flicker = {};
    for (const k of Object.keys(fx.series[0])) {
      const vals = fx.series.map((x) => x[k]);
      const first = vals[0], last = vals.at(-1);
      const odd = [...new Set(vals.filter((v) => v !== first && v !== last))];
      if (odd.length) flicker[k] = odd.slice(0, 3);
    }
    return {
      flicker,
      ms: fx.done != null && fx.t0 != null ? Math.round(fx.done - fx.t0) : null,
      mock_ms: Math.round(fx.mock.reduce((sum, [a, b]) => sum + b - a, 0)),
      minus_mock: { // estimate, not measured: the mock's link work taken out (Rust, off the page thread, in the app)
        ms: fx.done != null && fx.t0 != null ? Math.round(minusMock(fx.t0, fx.done - fx.t0)) : null,
        long_max: Math.round(Math.max(0, ...long.map((e) => minusMock(e.startTime, e.duration)))),
      },
      gap_p95: q(0.95), gap_max: q(1), long: long.length, long_max: Math.round(Math.max(0, ...long.map((e) => e.duration))),
      slow_events: events.length, event_max: Math.round(Math.max(0, ...events.map((e) => e.d))), js_max: Math.round(Math.max(0, ...events.map((e) => e.js))),
      worst: [...events].sort((a, b) => b.d - a.d).slice(0, 3).map((e) => `${e.name}:${Math.round(e.d)}${e.target ? "@" + e.target : ""}`),
      flashes: fx.flashes, removed: fx.removed, after: fx.state(),
    };
  };
}
