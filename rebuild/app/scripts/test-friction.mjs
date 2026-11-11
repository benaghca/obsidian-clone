#!/usr/bin/env node
// F1: friction in everyday flows, with real key and mouse input in headless
// Chromium against the mock's ?synthetic=N vault (GROVE_FEEL_N, default 5000).
// For each action: input → painted result, long tasks, frame gaps, slow input
// events, per-frame flashes (empty state, missing editor or tree), remounts,
// where focus and the caret land, and labels left stale. Budgets: RUST_PERF_PLAN §1.
// Budgets check the raw numbers. The link commands run in Rust, off the page
// thread, in the app; here the mock answers them on the page, so `minus_mock`
// is an estimate with the mock's time taken out (not a measure of Rust).
import assert from "node:assert/strict";
import { sleep, withBrowser } from "./browser.mjs";
import { harness, makeMeasure, openSynthetic } from "./frictionHarness.mjs";

const n = Number(process.env.GROVE_FEEL_N) || 5000;
const REPORT = process.env.GROVE_FRICTION_REPORT === "1"; // print every sample, assert nothing

await withBrowser(async ({ send, evaluate, run, key, press, chord, click, move, point }) => {
  await openSynthetic({ send, evaluate }, n);
  await run(harness);
  // The mock's own link commands answer, so replies follow every edit. Microtasks queued either side of the
  // call bracket the mock's synchronous work, for minus_mock. __fx.mockDelay (self-check only) stalls it.
  await run(async () => {
    const { api } = await import("/src/api.ts");
    for (const [name, real] of ["linkIndex", "backlinks", "linkSources"].map((k) => [k, api[k]])) api[name] = async (...args) => {
      let start = 0, end = 0;
      queueMicrotask(() => { start = performance.now(); while (performance.now() < start + (__fx.mockDelay ?? 0)); });
      const reply = real(...args);
      queueMicrotask(() => (end = performance.now()));
      const value = await reply;
      __fx.mock.push([start, end]);
      return JSON.parse(JSON.stringify(value));
    };
  });
  await sleep(500);

  const out = { n };
  const typeText = async (text, gap = 30) => {
    for (const ch of text) {
      for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: ch, text: type === "keyDown" ? ch : undefined });
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
  const measure = makeMeasure({ run, evaluate }, out, REPORT);
  const rowFor = async (path) => {
    await run((p) => document.querySelector(`.nav-files [data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: "center" }), path);
    return sleep(80).then(() => point(`.nav-files [data-path="${path.replace(/"/g, '\\"')}"]`));
  };
  const notes = await evaluate(`ws.vault.notes.filter(n => !n.path.includes("/") && n.path !== "Big note.md" && n.path !== "Welcome.md").slice(0, 12).map(n => n.path)`);
  const nameOf = (p) => p.split("/").pop().replace(/\.md$/i, "");
  const opened = (p) => `ws.active.path === ${JSON.stringify(p)} && document.querySelector(".workspace-tabs.mod-active .workspace-leaf .inline-title")?.textContent === ${JSON.stringify(nameOf(p))} && !!document.querySelector(".workspace-tabs.mod-active .cm-content")?.textContent`;
  // The tab Ctrl+Tab (dir 1) or Ctrl+Shift+Tab (-1) should land on (kept for the checks), and the condition for being there.
  const cycled = async (name, dir) => {
    const to = (out[`${name}_to`] = await evaluate(`(() => { const t = ws.tabs, i = t.indexOf(ws.active), to = t[(i + ${dir} + t.length) % t.length]; return { id: to.id, path: to.path, from: ws.active.id }; })()`));
    return `ws.active.id === ${to.id} && ${opened(to.path)}`;
  };
  // The page's link index against a fresh answer from the backend (lists compared as sets).
  const linksFresh = () => evaluate(`(async () => { const { api } = await import("/src/api.ts"); const fresh = await api.linkIndex(); const norm = (x) => JSON.stringify(Object.entries(x ?? {}).filter(([, v]) => v.length).sort().map(([k, v]) => [k, [...v].sort()])); return ["outgoing", "markdown", "unresolved"].every((k) => norm(ws.vault.links[k]) === norm(fresh[k])); })()`);
  const backlinksOf = (p) => evaluate(`(async () => { const { api } = await import("/src/api.ts"); return (await api.backlinks([${JSON.stringify(p)}]))[${JSON.stringify(p)}] ?? []; })()`);
  const until = async (expr, ms = 5000) => { for (let t = 0; t < ms && !(await evaluate(expr)); t += 20) await sleep(20); return evaluate(expr); };
  const palette = async (command) => { await chord("p"); await sleep(150); await typeText(command, 20); await sleep(150); await press("Enter"); };
  // Most people keep the backlinks pane open: switching notes refreshes it.
  await combo("]", 3).then(() => sleep(600));

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
  const clickRow = async (path, button, modifiers = 0) => {
    const p = await rowFor(path);
    await move(p);
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, ...p, button, clickCount: 1, modifiers });
  };
  await measure("open_ctrl_click_tree", () => clickRow(notes[2], "left", 2), `ws.tabs.length === ${tabsBefore + 1} && ws.tabs.some(t => t.path === ${JSON.stringify(notes[2])})`);
  await measure("open_middle_click_tree", () => clickRow(notes[3], "middle"), `ws.tabs.some(t => t.path === ${JSON.stringify(notes[3])})`);

  // ---- 3. Tabs (before typing, so the Big note is fresh) ----
  await measure("new_tab", () => chord("t"), `ws.active.path === null && !!document.querySelector(".workspace-tabs.mod-active .empty-state")`, { expectNote: false });
  await measure("close_tab", () => chord("w"), "ws.active.path !== null");
  for (const [name, dir, mods] of [["ctrl_tab", 1, 2], ["ctrl_shift_tab", -1, 10]]) await measure(name, () => combo("Tab", mods), await cycled(name, dir));
  // Scroll and caret come back on return: the Big note, scrolled and with the caret mid-document.
  await run(async () => { await ws.open("Big note.md"); }).then(() => sleep(300));
  // The caret at line `line` of the Big note, on screen and focused.
  const placeBig = (line) => run((l) => { const at = ws.view.state.doc.line(l); ws.view.dispatch({ selection: { anchor: at.from + 3 }, scrollIntoView: true }); ws.view.focus(); }, line).then(() => sleep(300));
  await placeBig(2500);
  out.big_before = await state();
  await measure("tab_away", async () => click(await point(".workspace-tabs.mod-active .workspace-tab-header:not(.is-active)")), "ws.active.path !== 'Big note.md'");
  await measure("tab_back_click", () => click('.workspace-tabs.mod-active .workspace-tab-header[aria-label="Big note"], .workspace-tabs.mod-active .workspace-tab-header[aria-label="Big note.md"]'), opened("Big note.md"));
  await measure("tab_close_reopen", async () => { await chord("w"); await sleep(200); await combo("t", 10); }, opened("Big note.md"));

  // Back from a link restores where you were in a long note.
  await placeBig(2500);
  out.big_mid = await state();
  await measure("big_link_click", () => click(".workspace-tabs.mod-active .cm-content .cm-rendered-link:not(.is-unresolved)"), "ws.active.path !== 'Big note.md'");
  await measure("big_back", () => click('.workspace-tabs.mod-active [aria-label="Navigate back"]'), opened("Big note.md"), { settle: 300 });

  // ---- 2. Typing in the Big note, mid-document ----
  await run(() => { const line = ws.view.state.doc.line(2500); ws.view.dispatch({ selection: { anchor: line.to } }); ws.view.focus(); });
  await sleep(200);
  await measure("typing_big_note", () => typeText(" quick brown fox jumps", 40), null, { settle: 1800 });
  // At the end of the note, with the caret's line on screen (and parsed, as it is by the time anyone reads it).
  await run(() => { const doc = ws.view.state.doc; const end = doc.length; ws.view.dispatch({ changes: { from: end, insert: "\n- first item" }, selection: { anchor: end + 13 }, scrollIntoView: true }); ws.view.focus(); });
  await sleep(300);
  const lineIs = (text) => `ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text === ${JSON.stringify(text)}`;
  await measure("enter_list_item", () => press("Enter"), lineIs("- "));
  // Self-check: an Enter whose result is painted 250 ms late, with no long task, must fail the Enter budget.
  const linesNow = await run(() => (addEventListener("keydown", (e) => { if (e.key !== "Enter") return; e.preventDefault(); e.stopImmediatePropagation(); setTimeout(() => { const h = ws.view.state.selection.main.head; ws.view.dispatch({ changes: { from: h, insert: "\n- " }, selection: { anchor: h + 3 } }); }, 250); }, { capture: true, once: true }), ws.view.state.doc.lines));
  await measure("selftest_slow_enter", () => press("Enter"), `ws.view.state.doc.lines === ${linesNow + 1} && ${lineIs("- ")}`, { settle: 100 });
  await run(() => { const h = ws.view.state.selection.main.head; ws.view.dispatch({ changes: { from: h - 3, to: h } }); });
  await measure("suggest_open", () => typeText("[[", 30), `!!document.querySelector(".cm-tooltip.cm-link-suggest li")`);
  await measure("suggest_type", () => typeText("riv", 40), `!!document.querySelector(".cm-tooltip.cm-link-suggest li")`, { settle: 300 });
  await measure("suggest_choose", () => press("Enter"), `!document.querySelector(".cm-link-suggest") && /\\[\\[[^\\]]+\\]\\]$/.test(ws.view.state.doc.lineAt(ws.view.state.selection.main.head).text.slice(0, ws.view.state.selection.main.head - ws.view.state.doc.lineAt(ws.view.state.selection.main.head).from))`);
  await measure("suggest_esc", async () => { await typeText(" [[", 30); await sleep(150); await press("Escape"); }, `!document.querySelector(".cm-link-suggest") && ws.view.state.doc.sliceString(ws.view.state.selection.main.head - 2, ws.view.state.selection.main.head + 2) === "[[]]"`);
  await measure("undo", () => chord("z"), lineIs(out.suggest_choose.after.line), { settle: 200 });
  await measure("redo", () => combo("z", 10), lineIs(out.suggest_esc.after.line), { settle: 200 });
  // After the save, the link index and backlinks show the link just chosen.
  const chosenName = [...(out.suggest_choose.after.line ?? "").matchAll(/\[\[([^\]|#]+)/g)].at(-1)?.[1];
  const chosen = chosenName ? await evaluate(`ws.resolve(${JSON.stringify(chosenName)}, "Big note.md")`) : null;
  out.edit_links = { chosen, indexed: await until(`!!ws.vault.links.outgoing["Big note.md"]?.includes(${JSON.stringify(chosen)})`), fresh: await linksFresh(), backlink: (await backlinksOf(chosen)).some((b) => b.from === "Big note.md" && b.text.includes(`[[${nameOf(chosen)}`)) };

  // ---- 6. Quick switcher and command palette ----
  await run(() => { ws.view.focus(); });
  const caret = await evaluate("ws.view.state.selection.main.head");
  out.caret_before_modal = caret;
  out.before_switcher = await state();
  await measure("switcher_open", () => chord("o"), `!!document.querySelector(".prompt .suggestion-item")`);
  await measure("switcher_type", () => typeText("river s", 60), `document.querySelector(".prompt-input")?.value === "river s" && !!document.querySelector(".suggestion-item")`);
  await measure("switcher_last_key", () => typeText("t", 0), `document.querySelector(".prompt-input")?.value === "river st"`);
  await measure("switcher_esc", () => press("Escape"), "!document.querySelector('.prompt')");
  await placeBig(3000);
  out.before_palette = await state();
  await measure("palette_open", () => chord("p"), `!!document.querySelector(".prompt .suggestion-item")`);
  await measure("palette_type", () => typeText("toggle left", 50), `document.querySelector(".prompt-input")?.value === "toggle left"`);
  await measure("palette_last_key", () => typeText(" s", 0), `document.querySelector(".prompt-input")?.value === "toggle left s"`);
  await measure("palette_esc", () => press("Escape"), "!document.querySelector('.prompt')");
  await placeBig(3500);
  out.before_settings = await state();
  await measure("settings_open", () => chord(","), "!!document.querySelector('.modal.mod-settings, .mod-settings')", { settle: 400 });
  await measure("settings_esc", () => press("Escape"), "!document.querySelector('.mod-settings')", { settle: 400 });
  // A confirmation (Delete current file), cancelled with Esc: back to the same place.
  await placeBig(3800);
  out.before_confirm = await state();
  await measure("confirm_esc", async () => { await palette("delete current file"); await until("!!document.querySelector('.modal.mod-confirm')", 1000); await press("Escape"); },
    "!document.querySelector('.modal.mod-confirm') && ws.active.path === 'Big note.md'", { settle: 400 });
  // A long note just opened and jumped into, before the background parse reaches the caret (about 100 ms
  // at 5k), in three copies: a letter typed deep in it, Enter on a plain line, Enter on a list item (it still continues).
  await run(async (text) => {
    const { api } = await import("/src/api.ts");
    for (const name of ["Long letter.md", "Long plain.md", "Long copy.md"]) await api.createNote(name, text);
    await ws.vault.refreshFiles();
  }, await evaluate("ws.view.state.doc.toString()"));
  const deepPlain = (p) => run(async (p) => {
    await ws.open(p);
    await new Promise((r) => requestAnimationFrame(r));
    let { doc } = ws.view.state, at = doc.line(4500);
    while (!/^[A-Za-z]/.test(at.text)) at = doc.line(at.number + 1);
    ws.view.dispatch({ selection: { anchor: at.to }, scrollIntoView: true });
    return ws.view.focus(), [doc.lines, doc.length];
  }, p);
  const [, chars] = await deepPlain("Long letter.md");
  await measure("letter_fresh_long", () => typeText("x", 0), `ws.view.state.doc.length === ${chars + 1}`, { settle: 150 });
  const [lines] = await deepPlain("Long plain.md");
  await measure("enter_plain_fresh_long", () => press("Enter"), `ws.view.state.doc.lines === ${lines + 1} && ${lineIs("")}`, { settle: 150 });
  await run(async () => { await ws.open("Long copy.md"); await new Promise((r) => requestAnimationFrame(r)); const at = ws.view.state.doc.line(4500); ws.view.dispatch({ changes: { from: at.to, insert: "\n- item" }, selection: { anchor: at.to + 7 }, scrollIntoView: true }); ws.view.focus(); });
  await measure("enter_list_fresh_long", () => press("Enter"), lineIs("- "), { settle: 150 });
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
  for (const tab of ["Outgoing links", "Tags", "Outline", "Backlinks"]) await measure(`right_tab_${tab.split(" ")[0].toLowerCase()}`, () => click(`.mod-right-split [aria-label="${tab}"]`), `!!document.querySelector('.mod-right-split [aria-label="${tab}"].is-active')`, { settle: 300 });
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
    await measure(`resize_${side}`, () => drag(side, dx), `Math.abs(${width} - ${before}) >= 79`, { settle: 300 });
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
  await run(async () => { await ws.open(ws.vault.notes.find((x) => x.path.startsWith("Journal/")).path); }).then(() => sleep(300));
  await measure("reveal_active", () => palette("reveal"), `document.querySelector(".nav-files .tree-item-self.is-active")?.dataset.path === ws.active.path`, { settle: 300 });

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
  await measure("split_right", () => palette("split right"), `ws.groups().length === ${groupsBefore + 1}`, { settle: 300 });
  const otherPane = await evaluate("ws.groups().find((g) => g !== ws.layout.activeGroup)?.active.id ?? null");
  await measure("focus_left_pane", () => click(".workspace-split.mod-root .workspace-tabs:not(.mod-active) .cm-content"), `ws.active.id === ${otherPane} && document.activeElement?.closest(".workspace-tabs.mod-active .cm-content") !== null`, { settle: 200 });
  await measure("close_split", async () => { await click(".workspace-split.mod-root .workspace-tabs:not(.mod-active) .cm-content"); await sleep(100); await chord("w"); }, `ws.groups().length === ${groupsBefore}`, { settle: 300 });

  // Renaming a linked note from its inline title: links, counts and source text follow.
  if (chosen) {
    const renamedTo = chosen.replace(/[^/]+$/, "Retitled.md");
    const before = await backlinksOf(chosen);
    await run(async (p) => { await ws.open(p); }, chosen);
    await sleep(300);
    const status = await evaluate("__fx.state().backlinks");
    // "Update links?" is asked by default: Enter takes Update.
    await measure("rename_linked", async () => { await click(".workspace-tabs.mod-active .inline-title"); await chord("a"); await typeText("Retitled", 20); await press("Enter"); await until("!!document.querySelector('.modal.mod-confirm')", 2000); await press("Enter"); },
      `ws.active.path === ${JSON.stringify(renamedTo)} && !!ws.vault.links.outgoing["Big note.md"]?.includes(${JSON.stringify(renamedTo)})`, { settle: 600, timeout: 8000, watchTitle: false });
    const after = await backlinksOf(renamedTo);
    const sources = (list) => JSON.stringify(list.map((b) => b.from).sort());
    out.rename_links = { fresh: await linksFresh(), count: [before.length, after.length], sources: sources(before) === sources(after), text: after.every((b) => b.text.includes("Retitled")), status: [status, await evaluate("__fx.state().backlinks")],
      old_gone: await evaluate(`![...Object.values(ws.vault.links.outgoing), ...Object.values(ws.vault.links.markdown)].some((v) => v.includes(${JSON.stringify(chosen)}))`) };
  }

  // Self-check: a backend reply 80 ms late shows in the measured time, not taken out of it.
  await run(() => addEventListener("keydown", (e) => { if (e.key !== "F9") return; __fx.mockDelay = 80; import("/src/api.ts").then(({ api }) => api.backlinks([ws.active.path ?? "Welcome.md"])).then(() => { __fx.mockDelay = 0; __fx.replied = true; }); }, { capture: true, once: true }));
  await measure("selftest_slow_backend", () => press("F9"), "__fx.replied === true", { expectNote: false });
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
  // Ctrl+Tab and Ctrl+Shift+Tab land on the neighbouring tab, not merely some note.
  for (const name of ["ctrl_tab", "ctrl_shift_tab"]) {
    const to = out[`${name}_to`] ?? {};
    check(to.id !== to.from && to.path && sample(name).after.path === to.path, `${name}: went to ${sample(name).after.path}, expected tab ${to.id} (${to.path})`);
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
  // Enter in a note already parsed to the caret: painted within 16 ms, i.e. in the next 60 Hz frame (`ms` runs to
  // the start of the frame that shows it, so 16.7 reads as 17 and a frame late as 33), and no slow input event.
  const FRAME = Math.ceil(1000 / 60);
  const enterOk = (x) => x.ms !== null && x.ms <= FRAME && x.long === 0 && x.event_max <= 16;
  const enter = sample("enter_list_item"), slowEnter = sample("selftest_slow_enter"), slowReply = sample("selftest_slow_backend");
  check(enterOk(enter), `enter_list_item: ${enter.ms} ms, ${enter.long} long tasks, slowest input ${enter.event_max} ms (budget 16)`);
  // The checks themselves: a late Enter fails the budget; a late backend reply counts in the measured time.
  check(slowEnter.ms >= 250 && slowEnter.long === 0 && !enterOk(slowEnter), `self-check: an Enter painted ${slowEnter.ms} ms late passed the Enter budget`);
  check(slowReply.ms >= 80 && slowReply.mock_ms >= 80, `self-check: a backend reply 80 ms late measured as ${slowReply.ms} ms (mock ${slowReply.mock_ms} ms)`);
  // The one exception, kept apart: just after a jump into a long note, CodeMirror spends up to 20 ms of each edit parsing
  // toward the screen. A plain Enter costs what a letter does there; a list Enter pays that parse once, within its 100 ms cap.
  const [letter, plain, list] = ["letter_fresh_long", "enter_plain_fresh_long", "enter_list_fresh_long"].map(sample);
  check(letter.ms !== null && plain.ms !== null && plain.long === 0 && plain.ms <= Math.max(16, letter.ms) + 8, `enter_plain_fresh_long: ${plain.ms} ms to the new line, a letter ${letter.ms} ms`);
  check(list.ms !== null && list.js_max <= 100 && list.long_max <= 100, `enter_list_fresh_long: ${list.js_max} ms of JS, longest task ${list.long_max} ms (parse cap 100)`);
  // The save and refresh after an edit: the index and backlinks have the new link.
  const e = out.edit_links ?? {};
  check(e.chosen && e.indexed && e.fresh && e.backlink, `edit: links after choosing [[${e.chosen}]] ${JSON.stringify(e)}`);
  check(sample("suggest_open").ms !== null && sample("suggest_choose").ms !== null, "[[ suggester: opened and chose a note");
  check(sample("suggest_esc").ms !== null, "[[ suggester: Esc keeps [[]] and closes");
  check(sample("undo").after.line === sample("suggest_choose").after.line && sample("redo").after.line === sample("suggest_esc").after.line, `undo/redo: ${sample("undo").after.line} / ${sample("redo").after.line}`);
  // Quick switcher, command palette, settings: open fast; Esc returns to the same caret and scroll.
  for (const name of ["switcher_open", "palette_open"]) check(sample(name).ms !== null && sample(name).ms <= 100 && sample(name).after.focus === "input", `${name}: ${sample(name).ms} ms, focus ${sample(name).after.focus}`);
  // Each keystroke: at most 16 ms of JS, results painted within 50 ms of the last one.
  for (const name of ["switcher_type", "switcher_last_key", "palette_type", "palette_last_key"]) {
    const x = sample(name);
    check(x.ms !== null && x.long === 0 && x.js_max <= 16 && (!name.endsWith("last_key") || x.ms <= 50), `${name}: ${x.ms} ms, ${x.long} long tasks, JS per key up to ${x.js_max} ms`);
  }
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
  // A linked note renamed: no stale index entry, same backlink count, sources and status label, new text.
  const r = out.rename_links ?? {};
  check(sample("rename_linked").ms !== null && r.fresh && r.old_gone && r.count?.[0] > 0 && r.count[0] === r.count[1] && r.sources && r.text && r.status?.[0] === r.status?.[1], `rename_linked: ${JSON.stringify(r)}`);
  // Splits.
  check(sample("split_right").ms !== null && sample("close_split").ms !== null && sample("close_split").after.focus === "editor", `splits: split ${sample("split_right").ms} ms, close ${sample("close_split").ms} ms, focus ${sample("close_split").after.focus}`);
  // Known gap: a new note or a rename rebuilds every visible tree row (P6, file-tree virtualization).
  const p6 = ["new_note", "rename_enter", "rename_linked"].filter((x) => sample(x).long).map((x) => `${x} ${sample(x).long_max} ms (${sample(x).minus_mock.long_max} without the mock)`);
  if (p6.length) console.log(`KNOWN GAP (P6, tree rebuilt on every file-list change): long task ${p6.join(", ")}`);
  console.log(`KNOWN COST (once per long note, just after a jump): list Enter parses to the caret, ${list.js_max} ms of JS`);
  if (n !== 5000) {
    console.log(`REPORT ONLY at ${n}: ${misses.length} misses`, JSON.stringify(misses));
    return;
  }
  assert.deepEqual(misses, [], "friction budgets (F1)");
});
