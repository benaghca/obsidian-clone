#!/usr/bin/env node
// F1: friction in everyday flows, with real key and mouse input in headless
// Chromium against the mock's ?synthetic=N vault (GROVE_FEEL_N, default 5000).
// For each action: input → painted result, long tasks, frame gaps, slow input
// events, per-frame flashes (empty state, missing editor or tree), remounts,
// where focus and the caret land, and labels left stale. Budgets: RUST_PERF_PLAN §1.
import assert from "node:assert/strict";
import { sleep, withBrowser } from "./browser.mjs";

const n = Number(process.env.GROVE_FEEL_N) || 5000;
const REPORT = process.env.GROVE_FRICTION_REPORT === "1"; // print every sample, assert nothing

// Installed in the page once: a frame loop, observers, and per-frame checks.
function harness() {
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
        if (ok) fx.done = t;
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  for (const type of ["keydown", "mousedown", "auxclick", "pointerdown"]) window.addEventListener(type, (e) => { if (fx.on && fx.t0 == null) fx.t0 = e.timeStamp; }, true);
  new PerformanceObserver((l) => { if (fx.on) for (const e of l.getEntries()) fx.long.push(e.duration); }).observe({ type: "longtask" });
  // Entries that started before the action belong to earlier input (CDP can stamp them late).
  new PerformanceObserver((l) => { if (fx.on) for (const e of l.getEntries()) if (e.startTime >= fx.armedAt) fx.events.push({ name: e.name, d: e.duration, target: e.target?.className?.toString().slice(0, 30) }); }).observe({ type: "event", durationThreshold: 16 });
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
  fx.arm = (opts = {}) => Object.assign(fx, { on: true, armedAt: performance.now(), t0: null, done: null, frames: [], series: [labels()], long: [], events: [], flashes: {}, removed: {}, cond: opts.cond ?? null, expectNote: opts.expectNote ?? true, watchTitle: opts.watchTitle ?? true });
  fx.take = () => {
    fx.on = false;
    const gaps = fx.frames.slice(1).map((t, i) => t - fx.frames[i]).sort((a, b) => a - b);
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
      gap_p95: q(0.95), gap_max: q(1), long: fx.long.length, long_max: Math.round(Math.max(0, ...fx.long)),
      slow_events: fx.events.length, event_max: Math.round(Math.max(0, ...fx.events.map((e) => e.d))),
      worst: [...fx.events].sort((a, b) => b.d - a.d).slice(0, 3).map((e) => `${e.name}:${Math.round(e.d)}${e.target ? "@" + e.target : ""}`),
      flashes: fx.flashes, removed: fx.removed, after: fx.state(),
    };
  };
}

await withBrowser(async ({ send, evaluate, run, key, press, chord, click, move, point }) => {
  const base = await evaluate("location.origin + location.pathname");
  await send("Page.navigate", { url: `${base}?synthetic=${n}` });
  await sleep(300);
  for (let i = 0; i < 600 && !(await evaluate(`!!window.ws?.active.path && ws.vault.notes.length >= ${n}`).catch(() => false)); i++) await sleep(100);
  for (let i = 0; i < 600 && !(await evaluate("Object.keys(ws.vault.links.outgoing).length > 1000").catch(() => false)); i++) await sleep(100);
  // The link commands run in Rust, off the page thread, in the app. From here
  // they answer from the page's own index, still paying JSON.parse (as test-feel does).
  await run(async () => {
    const { api } = await import("/src/api.ts");
    const back = () => {
      const out = {};
      for (const [from, tos] of Object.entries(ws.vault.links.outgoing)) for (const to of tos) (out[to] ??= []).push({ from, line: 1, text: "" });
      return out;
    };
    api.linkIndex = async () => JSON.parse(JSON.stringify(ws.vault.links));
    api.backlinks = async (paths) => { const all = back(); return JSON.parse(JSON.stringify(Object.fromEntries(paths.filter((p) => all[p]).map((p) => [p, all[p]])))); };
    api.linkSources = async (paths) => { const all = back(); return [...new Set(paths.flatMap((p) => (all[p] ?? []).map((b) => b.from)))].sort(); };
  });
  await run(harness);
  await sleep(500);

  const out = { n };
  const typeText = async (text, gap = 30) => {
    for (const ch of text) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      await sleep(gap);
    }
  };
  const combo = async (k, mods) => {
    // Ctrl 2, Shift 8, Alt 1: modifier keys down, the key, then up.
    const held = [["Control", 2], ["Shift", 8], ["Alt", 1]].filter(([, bit]) => mods & bit);
    let m = 0;
    for (const [name, bit] of held) await key(name, (m |= bit));
    await press(mods & 8 && /^[a-z]$/.test(k) ? k.toUpperCase() : k, mods); // Shift gives "Z", as a keyboard does
    for (const [name, bit] of held.reverse()) await key(name, (m &= ~bit), "keyUp");
  };
  const state = () => evaluate("__fx.state()");
  /** Arm the page, run the input, wait for `cond` (a page expression) and `settle` ms, then take the sample. */
  const measure = async (name, input, cond = null, { settle = 250, timeout = 3000, ...opts } = {}) => {
    await run((c, o) => __fx.arm({ ...o, cond: c ? new Function(`return (${c})`) : null }), cond, opts);
    await evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
    await input();
    if (cond) for (let t = 0; t < timeout && !(await evaluate("__fx.done != null")); t += 20) await sleep(20);
    await sleep(settle);
    const sample = await evaluate("__fx.take()");
    out[name] = sample;
    if (REPORT) console.log(name, JSON.stringify(sample));
    return sample;
  };
  const rowFor = async (path) => {
    await run((p) => { const row = document.querySelector(`.nav-files [data-path="${CSS.escape(p)}"]`); row?.scrollIntoView({ block: "center" }); }, path);
    await sleep(80);
    return point(`.nav-files [data-path="${path.replace(/"/g, '\\"')}"]`);
  };
  const notes = await evaluate(`ws.vault.notes.filter(n => !n.path.includes("/") && n.path !== "Big note.md" && n.path !== "Welcome.md").slice(0, 12).map(n => n.path)`);
  const nameOf = (p) => p.split("/").pop().replace(/\.md$/i, "");
  const opened = (p) => `ws.active.path === ${JSON.stringify(p)} && document.querySelector(".workspace-tabs.mod-active .workspace-leaf .inline-title")?.textContent === ${JSON.stringify(nameOf(p))} && !!document.querySelector(".workspace-tabs.mod-active .cm-content")?.textContent`;

  // Most people keep the backlinks pane open: switching notes refreshes it.
  await combo("]", 3);
  await sleep(600);

  // ---- 1. Open a note ----
  await measure("open_tree_click", async () => click(await rowFor(notes[0])), opened(notes[0]));
  await measure("open_tree_click_2", async () => click(await rowFor(notes[1])), opened(notes[1]));
  const linkTarget = await evaluate(`(() => { const l = document.querySelector(".workspace-tabs.mod-active .cm-content .cm-rendered-link:not(.is-unresolved)"); return l ? ws.resolve(l.closest("[data-href]")?.dataset.href ?? l.dataset.href ?? l.textContent, ws.active.path) : null; })()`);
  out.link_target = linkTarget;
  if (linkTarget) await measure("open_link_click", () => click(".workspace-tabs.mod-active .cm-content .cm-rendered-link:not(.is-unresolved)"), opened(linkTarget));
  const backTo = await evaluate("ws.active.back.at(-1)?.path ?? ws.active.back.at(-1)?.entry ?? null");
  out.back_to = backTo;
  await measure("back_button", () => click('.workspace-tabs.mod-active [aria-label="Navigate back"]'), `ws.active.forward.length > 0 && document.querySelector(".workspace-tabs.mod-active .inline-title")?.textContent !== ${JSON.stringify(linkTarget ? nameOf(linkTarget) : "")}`);
  await measure("forward_shortcut", () => combo("ArrowRight", 3), linkTarget ? opened(linkTarget) : "ws.active.forward.length === 0");
  await measure("back_shortcut", () => combo("ArrowLeft", 3), "ws.active.forward.length > 0");
  const tabsBefore = await evaluate("ws.tabs.length");
  await measure("open_ctrl_click_tree", async () => {
    const p = await rowFor(notes[2]);
    await move(p);
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, ...p, button: "left", clickCount: 1, modifiers: 2 });
  }, `ws.tabs.length === ${tabsBefore + 1} && ws.tabs.some(t => t.path === ${JSON.stringify(notes[2])})`);
  await measure("open_middle_click_tree", async () => {
    const p = await rowFor(notes[3]);
    await move(p);
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, ...p, button: "middle", clickCount: 1 });
  }, `ws.tabs.some(t => t.path === ${JSON.stringify(notes[3])})`);

  // ---- 3. Tabs (before typing, so the Big note is fresh) ----
  await measure("new_tab", () => chord("t"), `ws.active.path === null && !!document.querySelector(".workspace-tabs.mod-active .empty-state")`, { expectNote: false });
  await measure("close_tab", () => chord("w"), "ws.active.path !== null");
  await measure("ctrl_tab", () => combo("Tab", 2), "true");
  await measure("ctrl_shift_tab", () => combo("Tab", 10), "true");
  // Scroll and caret come back on return: the Big note, scrolled and with the caret mid-document.
  await run(async () => { await ws.open("Big note.md"); });
  await sleep(300);
  await run(() => {
    const line = ws.view.state.doc.line(2500);
    ws.view.dispatch({ selection: { anchor: line.from + 3 }, scrollIntoView: true });
    ws.view.focus();
  });
  await sleep(300);
  const bigBefore = await state();
  out.big_before = bigBefore;
  await measure("tab_away", async () => click(await point(".workspace-tabs.mod-active .workspace-tab-header:not(.is-active)")), "ws.active.path !== 'Big note.md'");
  await measure("tab_back_click", () => click('.workspace-tabs.mod-active .workspace-tab-header[aria-label="Big note"], .workspace-tabs.mod-active .workspace-tab-header[aria-label="Big note.md"]'), opened("Big note.md"));
  await measure("tab_close_reopen", async () => { await chord("w"); await sleep(200); await combo("t", 10); }, opened("Big note.md"));

  // Back from a link restores where you were in a long note.
  const placeBig = (line) => run((l) => { const at = ws.view.state.doc.line(l); ws.view.dispatch({ selection: { anchor: at.from + 3 }, scrollIntoView: true }); ws.view.focus(); }, line);
  await placeBig(2500);
  await sleep(300);
  out.big_mid = await state();
  await measure("big_link_click", () => click(".workspace-tabs.mod-active .cm-content .cm-rendered-link:not(.is-unresolved)"), "ws.active.path !== 'Big note.md'");
  await measure("big_back", () => click('.workspace-tabs.mod-active [aria-label="Navigate back"]'), opened("Big note.md"), { settle: 300 });

  // ---- 2. Typing in the Big note, mid-document ----
  await run(() => { const line = ws.view.state.doc.line(2500); ws.view.dispatch({ selection: { anchor: line.to } }); ws.view.focus(); });
  await sleep(200);
  await measure("typing_big_note", () => typeText(" quick brown fox jumps", 40), null, { settle: 1800 });
  await run(() => { const doc = ws.view.state.doc; const end = doc.length; ws.view.dispatch({ changes: { from: end, insert: "\n- first item" }, selection: { anchor: end + 13 } }); ws.view.focus(); });
  await sleep(100);
  await measure("enter_list_item", () => press("Enter"), `ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text === "- "`);
  await measure("suggest_open", () => typeText("[[", 30), `!!document.querySelector(".cm-tooltip.cm-link-suggest li")`);
  await measure("suggest_type", () => typeText("riv", 40), `!!document.querySelector(".cm-tooltip.cm-link-suggest li")`, { settle: 300 });
  await measure("suggest_choose", () => press("Enter"), `!document.querySelector(".cm-link-suggest") && /\\[\\[[^\\]]+\\]\\]$/.test(ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text.slice(0, ws.view.state.selection.main.head - ws.view.state.doc.lineAt(ws.view.state.selection.main.head).from))`);
  await measure("suggest_esc", async () => { await typeText(" [[", 30); await sleep(150); await press("Escape"); }, `!document.querySelector(".cm-link-suggest") && ws.view.state.doc.sliceString(ws.view.state.selection.main.head - 2, ws.view.state.selection.main.head + 2) === "[[]]"`);
  await measure("undo", () => chord("z"), "true", { settle: 200 });
  await measure("redo", () => combo("z", 10), "true", { settle: 200 });
  await sleep(1500);

  // ---- 6. Quick switcher and command palette ----
  await run(() => { ws.view.focus(); });
  const caret = await evaluate("ws.view.state.selection.main.head");
  out.caret_before_modal = caret;
  out.before_switcher = await state();
  await measure("switcher_open", () => chord("o"), `!!document.querySelector(".prompt .suggestion-item")`);
  await measure("switcher_type", () => typeText("river s", 60), `document.querySelector(".prompt-input")?.value === "river s" && !!document.querySelector(".suggestion-item")`);
  await measure("switcher_esc", () => press("Escape"), "!document.querySelector('.prompt')");
  await placeBig(3000);
  await sleep(300);
  out.before_palette = await state();
  await measure("palette_open", () => chord("p"), `!!document.querySelector(".prompt .suggestion-item")`);
  await measure("palette_type", () => typeText("toggle left", 50), `document.querySelector(".prompt-input")?.value === "toggle left"`);
  await measure("palette_esc", () => press("Escape"), "!document.querySelector('.prompt')");
  await placeBig(3500);
  await sleep(300);
  out.before_settings = await state();
  await measure("settings_open", () => chord(","), "!!document.querySelector('.modal.mod-settings, .mod-settings')", { settle: 400 });
  await measure("settings_esc", () => press("Escape"), "!document.querySelector('.mod-settings')", { settle: 400 });
  // A confirmation (Delete current file), cancelled with Esc: back to the same place.
  await placeBig(3800);
  await sleep(300);
  out.before_confirm = await state();
  await measure("confirm_esc", async () => {
    await chord("p");
    await sleep(150);
    await typeText("delete current file", 15);
    await sleep(150);
    await press("Enter");
    for (let i = 0; i < 50 && !(await evaluate("!!document.querySelector('.modal.mod-confirm')")); i++) await sleep(20);
    await press("Escape");
  }, "!document.querySelector('.modal.mod-confirm') && ws.active.path === 'Big note.md'", { settle: 400 });
  // A long note just opened: Enter on a list item deep in it still continues the list.
  await run(async (text) => {
    const { api } = await import("/src/api.ts");
    await api.createNote("Long copy.md", text);
    await ws.vault.refreshFiles();
  }, await evaluate("ws.view.state.doc.toString()"));
  await run(async () => { await ws.open("Long copy.md"); await new Promise((r) => requestAnimationFrame(r)); const at = ws.view.state.doc.line(4500); ws.view.dispatch({ changes: { from: at.to, insert: "\n- item" }, selection: { anchor: at.to + 7 }, scrollIntoView: true }); ws.view.focus(); });
  await measure("enter_list_fresh_long", () => press("Enter"), `ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text === "- "`, { settle: 150 });
  await measure("switcher_enter", async () => { await chord("o"); await sleep(150); await typeText(nameOf(notes[4]), 20); await sleep(200); await press("Enter"); }, opened(notes[4]));
  await measure("switcher_ctrl_enter", async () => { await chord("o"); await sleep(150); await typeText(nameOf(notes[5]), 20); await sleep(200); await combo("Enter", 2); }, `ws.tabs.some(t => t.path === ${JSON.stringify(notes[5])})`);

  // ---- 4. Search ----
  await run(async () => {
    await ws.open("Big note.md");
    const at = ws.view.state.doc.line(4200);
    ws.view.dispatch({ changes: { from: at.to, insert: " zebramarker" } });
    await ws.saveNow("Big note.md");
  });
  await sleep(300);
  await measure("search_open", () => combo("f", 10), `!!document.querySelector(".search-view .search-input") && document.activeElement === document.querySelector(".search-view .search-input")`, { expectNote: true });
  await measure("search_type", () => typeText("lantern", 50), `/[1-9]/.test(document.querySelector(".search-results-count-label")?.textContent ?? "")`, { timeout: 5000, settle: 400 });
  // Search as you type: the last keystroke to its results painted.
  const counted = await evaluate(`document.querySelector(".search-results-count-label")?.textContent ?? ""`);
  await measure("search_last_key", () => typeText("q", 0), `document.querySelector(".search-results-count-label")?.textContent !== ${JSON.stringify(counted)}`, { timeout: 5000 });
  await press("Backspace");
  await sleep(400);
  const match = await evaluate(`(() => { const m = document.querySelector(".search-view .search-result-file-match"); return m && { path: m.closest("[data-path]")?.dataset.path ?? null, text: m.textContent }; })()`);
  out.search_match = match;
  await measure("search_click_result", () => click(".search-view .search-result-file-match"), `(() => { const sel = ws.view?.state.selection.main; if (!sel || sel.empty) return false; const c = ws.view.coordsAtPos(sel.head); const r = ws.view.scrollDOM.getBoundingClientRect(); return !!c && c.top >= r.top && c.bottom <= r.bottom && /lantern/i.test(ws.view.state.sliceDoc(sel.from, sel.to)); })()`);
  await measure("search_deep", async () => { await click(".search-view .search-input"); await chord("a"); await typeText("zebramarker", 20); }, `!!document.querySelector(".search-view .search-result-file-match")`, { timeout: 5000 });
  await measure("search_click_deep", () => click(".search-view .search-result-file-match"), `ws.active.path === "Big note.md" && (() => { const sel = ws.view.state.selection.main; const c = ws.view.coordsAtPos(sel.head); const r = document.querySelector(".workspace-tabs.mod-active .workspace-leaf > .view-content").getBoundingClientRect(); return !sel.empty && !!c && c.top >= r.top && c.bottom <= r.bottom && ws.view.state.sliceDoc(sel.from, sel.to) === "zebramarker"; })()`);
  await measure("search_clear", async () => { await click(".search-view .search-input"); await chord("a"); await press("Backspace"); }, `!document.querySelector(".search-view .search-result-file-match")`);

  // ---- 5. Sidebars ----
  await measure("left_files_tab", () => click('.mod-left-split [aria-label="Files"]'), `!!document.querySelector(".nav-files-container")?.childElementCount`);
  await measure("toggle_left", () => combo("[", 3), "document.querySelector('.app-container').classList.contains('is-left-sidebar-collapsed')", { settle: 400 });
  await measure("toggle_left_back", () => combo("[", 3), "!document.querySelector('.app-container').classList.contains('is-left-sidebar-collapsed')", { settle: 400 });
  await measure("toggle_right", () => combo("]", 3), "document.querySelector('.app-container').classList.contains('is-right-sidebar-collapsed')", { settle: 600 });
  await measure("toggle_right_back", () => combo("]", 3), "!document.querySelector('.app-container').classList.contains('is-right-sidebar-collapsed')", { settle: 600 });
  for (const tab of ["Outgoing links", "Tags", "Outline", "Backlinks"]) await measure(`right_tab_${tab.split(" ")[0].toLowerCase()}`, () => click(`.mod-right-split [aria-label="${tab}"]`), "true", { settle: 300 });
  // Both docks resize by dragging their inner edge, as in Obsidian.
  const drag = async (side, dx) => {
    const handle = `.mod-${side}-split > .workspace-leaf-resize-handle`;
    out[`${side}_handle`] = await evaluate(`!!document.querySelector(${JSON.stringify(handle)})`);
    if (!out[`${side}_handle`]) return;
    const p = await point(handle);
    await move(p);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 });
    for (let i = 1; i <= 20; i++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x + (dx * i) / 20, y: p.y, button: "left", buttons: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x + dx, y: p.y, button: "left", clickCount: 1 });
  };
  for (const [side, dx] of [["left", 80], ["right", -80]]) {
    const width = `document.querySelector(".mod-${side}-split").getBoundingClientRect().width`;
    const before = await evaluate(width);
    await measure(`resize_${side}`, () => drag(side, dx), "true", { settle: 300 });
    out[`resize_${side}`].grew = Math.round((await evaluate(width)) - before);
    // Kept for the next start, in the vault's saved layout.
    out[`resize_${side}`].saved = await evaluate(`(() => { try { return Math.round(JSON.parse(localStorage.getItem("grove.layout:" + ws.vault.path))?.${side}Width ?? -1) - Math.round(${width}); } catch { return null; } })()`);
  }
  await measure("tree_hover", async () => {
    const top = await point(".nav-files-container .nav-file-title");
    for (let dy = 0; dy < 400; dy += 10) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: top.x, y: top.y + dy });
  }, "true", { settle: 200 });
  await measure("folder_expand", () => click('.nav-folder-title[data-path="Projects"]'), "document.querySelectorAll('.nav-file-title').length > 1500", { settle: 300 });
  await measure("folder_collapse", () => click('.nav-folder-title[data-path="Projects"]'), "document.querySelectorAll('.nav-file-title').length < 1500", { settle: 300 });
  await run(async () => { await ws.open(ws.vault.notes.find((x) => x.path.startsWith("Journal/")).path); });
  await sleep(300);
  await measure("reveal_active", async () => { await chord("p"); await sleep(150); await typeText("reveal", 20); await sleep(150); await press("Enter"); }, `document.querySelector(".nav-files .tree-item-self.is-active")?.dataset.path === ws.active.path`, { settle: 300 });

  // ---- 7. New note and rename from the inline title ----
  await measure("new_note", () => chord("n"), `/^Untitled/.test(ws.active.path ?? "") && document.activeElement?.classList.contains("inline-title")`, { watchTitle: false });
  out.new_note_selection = await evaluate("(() => { const s = getSelection(); const t = document.activeElement; return { selected: s.toString(), title: t?.textContent ?? null }; })()");
  await measure("rename_type", () => typeText("Fresh name", 30), "true", { watchTitle: false });
  await measure("rename_enter", () => press("Enter"), `ws.active.path === "Fresh name.md" && document.activeElement?.closest(".cm-content") !== null`, { settle: 400 });

  // Esc while renaming keeps the old name and returns to the note.
  await measure("rename_esc", async () => { await chord("n"); await sleep(300); await typeText("Dropped", 20); await press("Escape"); }, `/^Untitled/.test(ws.active.path ?? "")`, { settle: 300, watchTitle: false });
  out.rename_esc_title = await evaluate(`document.querySelector(".workspace-tabs.mod-active .inline-title")?.textContent`);
  out.nav_buttons = await evaluate(`[...document.querySelectorAll(".workspace-tabs.mod-active .view-header-nav-buttons .clickable-icon")].map((b) => b.classList.contains("is-disabled")).join(",") + " back=" + ws.active.back.length + " fwd=" + ws.active.forward.length`);
  // Arrow keys in the file tree after clicking a row.
  await measure("tree_arrows", async () => { await click(await rowFor(notes[6])); await sleep(150); await click(await rowFor(notes[6])); await press("ArrowDown"); await press("ArrowDown"); await press("Enter"); }, `ws.active.path !== ${JSON.stringify(notes[6])}`, { settle: 300 });
  await measure("new_tab_button", () => click('.workspace-tabs.mod-active [aria-label="New tab"]'), "ws.active.path === null", { expectNote: false });

  // ---- 8. Splits ----
  await run(async (p) => { await ws.open(p); ws.view.focus(); }, notes[7]);
  await sleep(200);
  const groupsBefore = await evaluate("ws.groups().length");
  await measure("split_right", async () => { await chord("p"); await sleep(150); await typeText("split right", 20); await sleep(150); await press("Enter"); }, `ws.groups().length === ${groupsBefore + 1}`, { settle: 300 });
  await measure("focus_left_pane", () => click(".workspace-split.mod-root .workspace-tabs:not(.mod-active) .cm-content"), "true", { settle: 200 });
  await measure("close_split", async () => { await click(".workspace-split.mod-root .workspace-tabs:not(.mod-active) .cm-content"); await sleep(100); await chord("w"); }, `ws.groups().length === ${groupsBefore}`, { settle: 300 });

  console.log(JSON.stringify(out));
  if (REPORT) return;

  // ---- Budgets and friction checks (RUST_PERF_PLAN §1, F1 brief). Every miss is collected. ----
  const misses = [];
  const check = (ok, message) => { if (!ok) misses.push(message); };
  const sample = (name) => out[name] ?? { after: {}, flashes: {}, flicker: {} };
  const near = (a, b) => Math.abs(a - b) <= 2;
  // Opening and switching: painted in 50 ms, no long task, focus in the note, no flash, no stale label.
  for (const name of ["open_tree_click", "open_tree_click_2", "open_link_click", "back_button", "forward_shortcut", "back_shortcut", "open_ctrl_click_tree", "open_middle_click_tree", "ctrl_tab", "ctrl_shift_tab", "tab_away", "tab_back_click", "big_link_click", "big_back", "search_click_result", "search_click_deep"]) {
    const x = sample(name), a = x.after;
    check(x.ms !== null && x.ms <= 50, `${name}: painted in ${x.ms} ms, budget 50`);
    check(x.long === 0, `${name}: ${x.long} long tasks (max ${x.long_max} ms)`);
    check(a.focus === "editor", `${name}: focus on ${a.focus}, not the note`);
    check(!Object.keys(x.flashes).length, `${name}: flashed ${JSON.stringify(x.flashes)}`);
    check(a.tab === a.name && a.header === a.name && a.title === a.name, `${name}: labels ${JSON.stringify([a.tab, a.header, a.title])} for ${a.name}`);
  }
  // Coming back to a long note: caret and scroll where they were.
  for (const [name, before] of [["tab_back_click", "big_before"], ["tab_close_reopen", "big_before"], ["big_back", "big_mid"]]) {
    const a = sample(name).after, b = out[before];
    check(a.head === b.head && near(a.scroll, b.scroll), `${name}: caret ${a.head} scroll ${a.scroll}, was ${b.head} / ${b.scroll}`);
  }
  // Typing in the 5,000-line note, including the save and link refresh after it.
  const typing = sample("typing_big_note");
  check(typing.long === 0 && typing.gap_max <= 20 && typing.event_max <= 16, `typing_big_note: ${typing.long} long tasks, max frame ${typing.gap_max} ms, input ${typing.event_max} ms`);
  for (const name of ["enter_list_item", "enter_list_fresh_long"]) check(sample(name).after.line === "- ", `${name}: Enter on a list item gave ${JSON.stringify(sample(name).after.line)}, not "- "`);
  check(sample("suggest_open").ms !== null && sample("suggest_choose").ms !== null, "[[ suggester: opened and chose a note");
  check(sample("suggest_esc").ms !== null, "[[ suggester: Esc keeps [[]] and closes");
  check(sample("undo").after.line === sample("suggest_choose").after.line && sample("redo").after.line === sample("suggest_esc").after.line, `undo/redo: ${sample("undo").after.line} / ${sample("redo").after.line}`);
  // Quick switcher, command palette, settings: open fast; Esc returns to the same caret and scroll.
  for (const name of ["switcher_open", "palette_open"]) check(sample(name).ms !== null && sample(name).ms <= 100 && sample(name).after.focus === "input", `${name}: ${sample(name).ms} ms, focus ${sample(name).after.focus}`);
  for (const [name, before] of [["switcher_esc", "before_switcher"], ["palette_esc", "before_palette"], ["settings_esc", "before_settings"], ["confirm_esc", "before_confirm"]]) {
    const a = sample(name).after, b = out[before];
    check(a.focus === "editor" && a.head === b.head && near(a.scroll, b.scroll), `${name}: focus ${a.focus}, caret ${a.head} scroll ${a.scroll}, was ${b.head} / ${b.scroll}`);
  }
  for (const name of ["switcher_enter", "switcher_ctrl_enter"]) check(sample(name).after.focus === "editor" && sample(name).long === 0, `${name}: focus ${sample(name).after.focus}, ${sample(name).long} long tasks`);
  // Search.
  check(sample("search_open").after.focus === "input", "search_open: the query box has focus");
  check(sample("search_last_key").ms !== null && sample("search_last_key").ms <= 100, `search_last_key: results in ${sample("search_last_key").ms} ms, budget 100`);
  check(sample("search_clear").ms !== null, "search_clear: results cleared");
  // Sidebars.
  for (const name of ["toggle_left", "toggle_left_back", "toggle_right", "toggle_right_back", "resize_left", "resize_right", "tree_hover", "folder_expand", "folder_collapse"]) check(sample(name).long === 0, `${name}: ${sample(name).long} long tasks (max ${sample(name).long_max} ms)`);
  for (const side of ["left", "right"]) {
    const x = sample(`resize_${side}`);
    check(out[`${side}_handle`] && near(x.grew, 80) && x.saved === 0, `resize_${side}: dragging the edge 80 px changed the width by ${x.grew ?? "nothing (no handle)"}, saved width off by ${x.saved}`);
  }
  check(sample("reveal_active").after.treeActive === sample("reveal_active").after.path, "reveal_active: the file is marked in the tree");
  // New note and rename from the inline title.
  check(sample("new_note").after.focus === "title" && out.new_note_selection.selected === "Untitled", `new_note: focus ${sample("new_note").after.focus}, selected ${JSON.stringify(out.new_note_selection.selected)}`);
  const renamed = sample("rename_enter").after;
  check(renamed.path === "Fresh name.md" && renamed.focus === "editor" && renamed.tab === "Fresh name" && renamed.header === "Fresh name" && renamed.treeActive === "Fresh name.md", `rename_enter: ${JSON.stringify(renamed)}`);
  check(out.rename_esc_title === "Untitled" && sample("rename_esc").after.focus === "editor", `rename_esc: title ${out.rename_esc_title}, focus ${sample("rename_esc").after.focus}`);
  for (const name of ["new_note", "rename_type", "rename_enter"]) check(!Object.keys(sample(name).flashes).length, `${name}: flashed ${JSON.stringify(sample(name).flashes)}`);
  // Splits.
  check(sample("split_right").ms !== null && sample("close_split").ms !== null && sample("close_split").after.focus === "editor", `splits: split ${sample("split_right").ms} ms, close ${sample("close_split").ms} ms, focus ${sample("close_split").after.focus}`);
  // Known gap: a new note or a rename rebuilds every visible tree row (P6, file-tree virtualization).
  const p6 = ["new_note", "rename_enter"].filter((x) => sample(x).long).map((x) => `${x} ${sample(x).long_max} ms`);
  if (p6.length) console.log(`KNOWN GAP (P6, tree rebuilt on every file-list change): long task ${p6.join(", ")}`);
  if (n !== 5000) {
    console.log(`REPORT ONLY at ${n}: ${misses.length} misses`, JSON.stringify(misses));
    return;
  }
  assert.deepEqual(misses, [], "friction budgets (F1)");
});
