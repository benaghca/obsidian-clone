#!/usr/bin/env node
// T1: the tab strip, with real mouse and keys in headless Chromium against the
// mock's ?synthetic=N vault (GROVE_FEEL_N, default 5000). Look (slim tabs,
// even widths, titles that truncate cleanly, colours from the theme), hover
// (close button, small new-tab highlight, nothing moves), close, middle-close,
// click, drag to reorder and drop outside, keyboard, and where focus and the
// caret land after each. Budgets: T1_TABS_TASK.md.
import assert from "node:assert/strict";
import { sleep, withBrowser } from "./browser.mjs";
import { harness, makeMeasure, openSynthetic } from "./frictionHarness.mjs";

const n = Number(process.env.GROVE_FEEL_N) || 5000;
const REPORT = process.env.GROVE_FRICTION_REPORT === "1";

await withBrowser(async ({ send, evaluate, run, press, chord, key, move, point }) => {
  await openSynthetic({ send, evaluate }, n);
  await run(harness);
  const out = { n };
  const measure = makeMeasure({ run, evaluate }, out, REPORT);
  const misses = [];
  const check = (ok, message) => { if (!ok) misses.push(message); };
  const notes = await evaluate(`ws.vault.notes.filter(n => !n.path.includes("/") && n.path !== "Big note.md").slice(0, 12).map(n => n.path)`);
  const STRIP = ".mod-root .workspace-tabs.mod-active .workspace-tab-header-container";
  const tab = (p) => `${STRIP} .workspace-tab-header[aria-label="${p}"]:not(.is-closing)`;
  const closeOf = (p) => `${tab(p)} .workspace-tab-header-inner-close-button`;
  const mouse = (type, p, button = "left", extra = {}) => send("Input.dispatchMouseEvent", { type, ...p, button, clickCount: 1, ...extra });
  const press1 = async (selector, button = "left") => { const p = await point(selector); await move(p); await mouse("mousePressed", p, button); await mouse("mouseReleased", p, button); };
  const order = () => evaluate("ws.activeGroup.tabs.map((t) => t.path)");
  const where = () => evaluate(`({ path: ws.active.path, head: ws.view.state.selection.main.head, focus: !!document.activeElement?.closest(".workspace-tabs.mod-active .cm-content"), doc: ws.view.state.doc.length })`);
  const opened = (p) => `ws.active.path === ${JSON.stringify(p)} && !!document.querySelector(".workspace-tabs.mod-active .cm-content")?.textContent`;
  // Every box a hover or close could shift: the strip, each header and title, the new-tab button and the note.
  const boxes = () => run((sel) => {
    const c = document.querySelector(sel), r = (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
    return { strip: r(c), editor: r(c.closest(".workspace-tabs").querySelector(".workspace-leaf")), plus: r(c.querySelector(".workspace-tab-header-new-tab")),
      tabs: [...c.querySelectorAll(".workspace-tab-header:not(.is-closing)")].map((h) => [h.getAttribute("aria-label"), ...r(h), ...r(h.querySelector(".workspace-tab-header-inner-title"))]) };
  }, STRIP);
  const look = (p) => run((sel) => {
    const h = document.querySelector(sel), cs = (e) => getComputedStyle(e), b = (e) => e.getBoundingClientRect();
    const inner = h.querySelector(".workspace-tab-header-inner"), title = h.querySelector(".workspace-tab-header-inner-title"), close = h.querySelector(".workspace-tab-header-inner-close-button");
    return { height: b(h).height, width: b(h).width, close: cs(close).opacity, closeBox: [b(close).width, b(close).height], closeBg: cs(close).backgroundColor, closeRadius: parseFloat(cs(close).borderTopLeftRadius),
      titleRoom: b(inner).right - b(title).right, titleClear: b(close).left - b(title).right, ellipsis: cs(title).textOverflow === "ellipsis" && cs(title).overflow === "hidden" && cs(title).whiteSpace === "nowrap" };
  }, typeof p === "string" && p.startsWith(".") ? p : tab(p));
  const hoverSettled = async (p) => { await move(p); await sleep(250); };

  // Four notes and the Big note, which is active with the caret mid-way.
  await run(async (ps) => { await ws.open(ps[0]); for (const p of ps.slice(1, 4)) await ws.open(p, { where: "tab" }); await ws.open("Big note.md", { where: "tab" }); }, notes);
  await run(() => { const l = ws.view.state.doc.line(2000); ws.view.dispatch({ selection: { anchor: l.from + 5 }, scrollIntoView: true }); ws.view.focus(); });
  await move({ x: 800, y: 500 });
  await sleep(500);
  const big = await where();

  // ---- Look: slim, even, clean titles, theme colours ----
  const rest = await boxes();
  for (const [label, , , w, h] of rest.tabs) check(h >= 24 && h <= 30 && Math.abs(w - rest.tabs[0][3]) <= 1, `slim, even tabs: ${label} is ${w}×${h} (first ${rest.tabs[0][3]} wide; 24–30 tall)`);
  const idle = await look(notes[1]), active = await look("Big note.md");
  check(idle.ellipsis && active.ellipsis, "titles clip with an ellipsis on one line");
  check(idle.close === "0" && active.close === "1", `close button: hidden on an idle tab (${idle.close}), shown on the active one (${active.close})`);
  check(idle.titleRoom <= 4, `an idle tab's title has the tab's whole width (${Math.round(idle.titleRoom)} px short)`);
  check(active.titleClear >= 0, `the active tab's title stops before its close button (${Math.round(active.titleClear)} px)`);
  for (const theme of ["light", "dark"]) {
    const colours = await run((theme, sel) => {
      const root = document.documentElement, was = [...root.classList].filter((c) => c.startsWith("theme-"));
      root.classList.remove(...was); root.classList.add(`theme-${theme}`);
      const probe = (v) => { const d = document.body.appendChild(document.createElement("div")); d.style.background = `var(${v})`; const c = getComputedStyle(d).backgroundColor; d.remove(); return c; };
      const strip = document.querySelector(sel), act = strip.querySelector(".workspace-tab-header.is-active");
      const r = { strip: getComputedStyle(strip).backgroundColor, want: probe("--background-secondary"), active: getComputedStyle(act).backgroundColor, page: probe("--background-primary") };
      root.classList.remove(`theme-${theme}`); root.classList.add(...was);
      return r;
    }, theme, STRIP);
    check(colours.strip === colours.want && colours.active === colours.page, `${theme}: strip and active tab use the theme's colours ${JSON.stringify(colours)}`);
    // No line between the strip and the note: the active tab runs straight into the note, in its colour.
    const seam = await run((theme, sel) => {
      const root = document.documentElement, was = [...root.classList].filter((c) => c.startsWith("theme-"));
      root.classList.remove(...was); root.classList.add(`theme-${theme}`);
      const strip = document.querySelector(sel), pane = strip.closest(".workspace-tabs"), leaf = pane.querySelector(".workspace-leaf"), act = strip.querySelector(".workspace-tab-header.is-active");
      const cs = (e) => getComputedStyle(e), seen = (w, c) => parseFloat(w) > 0 && !/^rgba\(.*, 0\)$|transparent/.test(c);
      const lines = [];
      if (seen(cs(strip).borderBottomWidth, cs(strip).borderBottomColor)) lines.push(`strip border-bottom ${cs(strip).borderBottomWidth} ${cs(strip).borderBottomColor}`);
      if (cs(strip).boxShadow !== "none") lines.push(`strip box-shadow ${cs(strip).boxShadow}`);
      for (const e of [leaf, leaf.firstElementChild].filter(Boolean)) if (seen(cs(e).borderTopWidth, cs(e).borderTopColor)) lines.push(`${e.className} border-top ${cs(e).borderTopWidth} ${cs(e).borderTopColor}`);
      for (const e of [strip, act]) for (const pseudo of ["::after"]) { const p = getComputedStyle(e, pseudo); if (p.content !== "none" && p.content !== "normal" && p.backgroundColor !== "rgba(0, 0, 0, 0)") lines.push(`${e.className}${pseudo}`); }
      const r = { tab: cs(act).backgroundColor, note: cs(leaf).backgroundColor, gap: leaf.getBoundingClientRect().top - act.getBoundingClientRect().bottom, lines };
      root.classList.remove(`theme-${theme}`); root.classList.add(...was);
      return r;
    }, theme, STRIP);
    check(seam.tab === seam.note && Math.abs(seam.gap) < 0.5 && !seam.lines.length, `${theme}: the active tab flows into the note, same colour and no line between strip and note ${JSON.stringify(seam)}`);
    // Nor under the side panels' tab rows (left and right sidebars): no line between the row and the panel below.
    const sides = await run((theme) => {
      const root = document.documentElement, was = [...root.classList].filter((c) => c.startsWith("theme-"));
      root.classList.remove(...was); root.classList.add(`theme-${theme}`);
      const cs = (e) => getComputedStyle(e), seen = (w, c) => parseFloat(w) > 0 && !/^rgba\(.*, 0\)$|transparent/.test(c), lines = [];
      for (const side of [".mod-left-split", ".mod-right-split"]) {
        const row = document.querySelector(`${side} > .workspace-tab-header-container`);
        if (!row) { lines.push(`${side}: no tab row`); continue; }
        if (seen(cs(row).borderBottomWidth, cs(row).borderBottomColor)) lines.push(`${side} row border-bottom ${cs(row).borderBottomWidth} ${cs(row).borderBottomColor}`);
        if (cs(row).boxShadow !== "none") lines.push(`${side} row box-shadow ${cs(row).boxShadow}`);
        const p = getComputedStyle(row, "::after"); if (p.content !== "none" && p.content !== "normal") lines.push(`${side} row ::after`);
        for (const e of [row.nextElementSibling, row.nextElementSibling?.firstElementChild].filter(Boolean)) if (seen(cs(e).borderTopWidth, cs(e).borderTopColor)) lines.push(`${side} ${e.className} border-top ${cs(e).borderTopWidth} ${cs(e).borderTopColor}`);
      }
      root.classList.remove(`theme-${theme}`); root.classList.add(...was);
      return lines;
    }, theme);
    check(!sides.length, `${theme}: no line under the side panels' tab rows ${JSON.stringify(sides)}`);
  }

  // ---- Hover: the close button fades in, a small highlight, nothing moves ----
  await hoverSettled(await point(tab(notes[1])));
  check((await look(notes[1])).close === "1", "hovering an idle tab shows its close button");
  check(JSON.stringify(await boxes()) === JSON.stringify(rest), "hovering a tab moves or resizes nothing");
  await hoverSettled(await point(closeOf(notes[1])));
  const closeHover = await look(notes[1]);
  check(closeHover.closeBg !== "rgba(0, 0, 0, 0)" && closeHover.closeBox.every((d) => d <= 22) && closeHover.closeRadius >= 2, `close button hover: a small rounded highlight ${JSON.stringify(closeHover.closeBox)}`);
  await hoverSettled(await point(`${STRIP} .workspace-tab-header-new-tab`));
  const plus = await run((sel) => {
    const c = document.querySelector(sel), b = (e) => e.getBoundingClientRect(), n = c.querySelector(".workspace-tab-header-new-tab"), list = c.querySelector(".workspace-tab-header-tab-list .clickable-icon");
    return { bg: getComputedStyle(n).backgroundColor, w: b(n).width, h: b(n).height, listW: b(list).width, listH: b(list).height, strip: b(c).height, middle: b(n).top + b(n).height / 2, tab: b(c.querySelector(".workspace-tab-header")).top + b(c.querySelector(".workspace-tab-header")).height / 2 };
  }, STRIP);
  check(plus.bg !== "rgba(0, 0, 0, 0)" && Math.abs(plus.w - plus.listW) <= 2 && Math.abs(plus.h - plus.listH) <= 2 && plus.h <= plus.strip - 10 && Math.abs(plus.middle - plus.tab) <= 3,
    `new-tab hover: an icon-sized highlight like the tab list button, level with the tabs ${JSON.stringify(plus)}`);
  check(JSON.stringify(await boxes()) === JSON.stringify(rest), "hovering New tab moves or resizes nothing");
  await move({ x: 800, y: 500 });

  // Each step starts with focus in the note, so one step's focus loss doesn't carry into the next.
  const refocus = () => run(() => ws.view.focus());
  const kept = async (name, want) => { const now = await where(); check(now.focus && now.path === want.path && now.head === want.head, `${name}: focus ${now.focus ? "in the note" : "lost"}, ${now.path} @${now.head}, expected ${want.path} @${want.head}`); };
  const open = (p) => evaluate(`ws.tabs.some((t) => t.path === ${JSON.stringify(p)})`);
  await run(() => { window.__mid = []; addEventListener("pointerdown", (e) => e.button === 1 && __mid.push(e.defaultPrevented)); });

  // ---- A linked tab: its unlink icon stays clear of the close button; a click unlinks, nothing else ----
  const link = (a, b) => run((a, b) => { const t = (p) => ws.tabs.find((x) => x.path === p); ws.setLink(t(a), t(b)); }, a, b);
  const linkOf = (p) => `${tab(p)} .workspace-tab-header-status-icon`;
  await link(notes[3], notes[2]);
  await sleep(100);
  await hoverSettled(await point(tab(notes[3])));
  const linkHit = await run((l, c) => { const lb = document.querySelector(l).getBoundingClientRect(), cb = document.querySelector(c).getBoundingClientRect();
    return { gap: cb.left - lb.right, hit: !!document.elementFromPoint(lb.x + lb.width / 2, lb.y + lb.height / 2)?.closest(".workspace-tab-header-status-icon") }; }, linkOf(notes[3]), closeOf(notes[3]));
  check(linkHit.gap >= 0 && linkHit.hit, `hovered linked tab: the unlink icon is clear of the close button ${JSON.stringify(linkHit)}`);
  await refocus();
  await press1(linkOf(notes[3]));
  await sleep(250);
  check((await open(notes[3])) && !(await evaluate(`document.querySelector(${JSON.stringify(tab(notes[3]))}).classList.contains("is-linked")`)), "clicking a hovered tab's unlink icon unlinks it and doesn't close it");
  await kept("unlink", big);
  const reopen3 = async () => { if (!(await open(notes[3]))) await run(async (p) => { await ws.open(p, { where: "tab" }); ws.activate(ws.tabs.find((t) => t.path === "Big note.md")); }, notes[3]); };
  await reopen3();

  // ---- The same at the narrowest a tab gets (a crowded strip or a narrow split) ----
  // A zero preferred width squeezes every tab to its minimum (--tab-min-width, 40 px). A note tab,
  // and Graph and Canvas tabs, whose view icon takes room too: each linked, inactive and hovered.
  await run(async () => {
    const { api } = await import("/src/api.ts");
    await api.createNote("T1 linked.canvas", JSON.stringify({ nodes: [], edges: [] })); await ws.vault.refreshFiles();
    const big = ws.active;
    ws.openView("graph", "tab"); await ws.open("T1 linked.canvas", { where: "tab" }); ws.activate(big);
  });
  await sleep(400);
  await run((sel) => document.querySelector(sel).style.setProperty("--tab-width", "0px"), STRIP);
  const viewTab = (icon) => `${STRIP} .workspace-tab-header[data-icon="${icon}"]:not(.is-closing)`;
  for (const [name, pick, header] of [["note", notes[3], tab(notes[3])], ["graph", "graph", viewTab("git-fork")], ["canvas", "canvas", viewTab("layout-dashboard")]]) {
    const linkSel = `${header} .workspace-tab-header-status-icon`, closeSel = `${header} .workspace-tab-header-inner-close-button`;
    await run((pick, p) => ws.setLink(ws.tabs.find((t) => (pick.endsWith(".md") ? t.path === pick : t.type === pick)), ws.tabs.find((t) => t.path === p)), pick, notes[2]);
    await sleep(150);
    await hoverSettled(await point(linkSel));
    const narrow = await run((h, l, c, plain) => {
      const b = (e) => document.querySelector(e).getBoundingClientRect(), lb = b(l), cb = b(c);
      return { width: b(h).width, plain: b(plain).width, min: parseFloat(getComputedStyle(document.querySelector(plain)).minWidth), gap: Math.round(cb.left - lb.right),
        hit: !!document.elementFromPoint(lb.x + lb.width / 2, lb.y + lb.height / 2)?.closest(".workspace-tab-header-status-icon") };
    }, header, linkSel, closeSel, tab(notes[1]));
    if (REPORT) console.log("narrow", name, JSON.stringify(narrow));
    check(narrow.plain === narrow.min && narrow.gap >= 0 && narrow.hit, `a linked ${name} tab at the minimum width keeps its unlink icon clear of the close button ${JSON.stringify(narrow)}`);
    await refocus();
    await press1(linkSel);
    await sleep(250);
    check((await evaluate(`!!document.querySelector(${JSON.stringify(header)}) && !document.querySelector(${JSON.stringify(header)}).classList.contains("is-linked")`)), `at the minimum width, clicking a linked ${name} tab's unlink icon unlinks it and doesn't close it`);
    await kept(`unlink_narrow_${name}`, big);
  }
  // Unlinked view tabs at the minimum: a click on the view icon selects the tab, never closes or unpins it.
  const pin = (type) => run((type) => ws.togglePin(ws.tabs.find((t) => t.type === type)), type);
  for (const [name, type, icon, pinned] of [["graph", "graph", "git-fork", false], ["canvas", "canvas", "layout-dashboard", false], ["pinned graph", "graph", "git-fork", true]]) {
    const header = viewTab(icon), iconSel = `${header} .workspace-tab-header-inner-icon`, closeSel = `${header} .workspace-tab-header-inner-close-button`;
    await run(async (type) => { if (!ws.tabs.some((t) => t.type === type)) { const big = ws.active; if (type === "graph") ws.openView("graph", "tab"); else await ws.open("T1 linked.canvas", { where: "tab" }); ws.activate(big); } }, type);
    if (pinned) await pin(type);
    // Back to the note without clicking it: at 40 px the active tab is mostly its close button.
    await run(() => ws.activate(ws.tabs.find((t) => t.path === "Big note.md"))); await sleep(200); await refocus();
    await hoverSettled(await point(iconSel));
    const at = await run((h, i, c) => {
      const b = (e) => document.querySelector(e).getBoundingClientRect(), ib = b(i), cb = b(c);
      return { width: b(h).width, gap: Math.round(cb.left - ib.right), hit: !document.elementFromPoint(ib.x + ib.width / 2, ib.y + ib.height / 2)?.closest(".workspace-tab-header-inner-close-button") };
    }, header, iconSel, closeSel);
    if (REPORT) console.log("icon", name, JSON.stringify(at));
    check(at.gap >= 0 && at.hit, `an inactive ${name} tab at the minimum width keeps its view icon clear of the ${pinned ? "pin" : "close button"} ${JSON.stringify(at)}`);
    await press1(iconSel);
    await sleep(300);
    const sel = await run((type, strip) => { const t = ws.tabs.find((x) => x.type === type); return { open: !!t, active: ws.active === t, pinned: !!t?.pinned, strip: !!document.activeElement?.closest(strip) }; }, type, STRIP);
    check(sel.open && sel.active && sel.pinned === pinned && !sel.strip, `at the minimum width, clicking an inactive ${name} tab's icon selects it, keeps it open${pinned ? " and pinned" : ""}, and leaves focus out of the strip ${JSON.stringify(sel)}`);
    await run(() => ws.activate(ws.tabs.find((t) => t.path === "Big note.md"))); await sleep(200); await refocus();
    await kept(`select_narrow_${name.replace(" ", "_")}`, big);
    if (pinned && sel.open) await pin(type);
  }
  await run((sel) => { document.querySelector(sel).style.removeProperty("--tab-width"); ws.closeTabs(ws.tabs.filter((t) => t.type)); }, STRIP);
  await sleep(300);
  await refocus();
  await reopen3();
  await sleep(150);

  // ---- A middle press closes the tab over its buttons too, with no default (autoscroll, paste) ----
  await link(notes[3], notes[2]);
  await run(async (p) => { await ws.open(p, { where: "tab" }); ws.activate(ws.tabs.find((t) => t.path === "Big note.md")); }, notes[11]);
  await sleep(400);
  for (const [name, p, sel] of [["middle_on_unlink", notes[3], linkOf(notes[3])], ["middle_on_close", notes[11], closeOf(notes[11])]]) {
    await refocus();
    await run(() => (__mid = []));
    await press1(sel, "middle");
    await sleep(250);
    check(!(await open(p)) && JSON.stringify(await evaluate("__mid")) === "[true]" && (await where()).doc === big.doc, `${name}: closes ${p} (${!(await open(p))}), press default cancelled ${JSON.stringify(await evaluate("__mid"))}`);
    await kept(name, big);
  }

  // ---- Close, middle-close, click: the next note in 50 ms, focus and caret kept ----
  const quick = (name) => { const x = out[name]; check(x.ms !== null && x.ms <= 50 && x.long === 0 && !Object.keys(x.flashes).length && !x.removed.editor, `${name}: ${x.ms} ms, ${x.long} long tasks, flashes ${JSON.stringify(x.flashes)}, editor removed ${x.removed.editor ?? 0}`); };
  await measure("close_background", () => press1(closeOf(notes[1])), `!ws.tabs.some((t) => t.path === ${JSON.stringify(notes[1])})`);
  quick("close_background");
  await kept("close_background", big);
  await run(() => (__mid = []));
  await refocus();
  await measure("middle_close_background", () => press1(tab(notes[2]), "middle"), `!ws.tabs.some((t) => t.path === ${JSON.stringify(notes[2])})`);
  quick("middle_close_background");
  await kept("middle_close_background", big);
  check((await where()).doc === big.doc && JSON.stringify(await evaluate("__mid")) === "[true]", `middle-click: no paste, and the press's default (autoscroll, its mousedown) is cancelled: ${JSON.stringify(await evaluate("__mid"))}`);
  await refocus();
  await measure("click_active", () => press1(tab("Big note.md")), "true");
  await kept("click_active", big);
  await measure("click_background", () => press1(tab(notes[0])), opened(notes[0]));
  quick("click_background");
  const first = await where();
  check(first.focus, "click_background: focus in the note");
  await measure("click_back", () => press1(tab("Big note.md")), opened("Big note.md"));
  quick("click_back");
  await kept("click_back", big);
  await run((p) => ws.activate(ws.tabs.find((t) => t.path === p)), notes[0]);
  await sleep(200);
  await measure("middle_close_active", () => press1(tab(notes[0]), "middle"), `ws.active.path !== ${JSON.stringify(notes[0])} && !!ws.active.path && !!document.querySelector(".workspace-tabs.mod-active .cm-content")?.textContent`);
  quick("middle_close_active");
  check((await where()).focus, "middle_close_active: focus in the next note");
  await run(async (p) => { await ws.open(p, { where: "tab" }); }, notes[4]);
  await sleep(300);
  await measure("close_active", () => press1(closeOf(notes[4])), `ws.active.path !== ${JSON.stringify(notes[4])} && !!document.querySelector(".workspace-tabs.mod-active .cm-content")?.textContent`);
  quick("close_active");
  await kept("close_active", big);

  // ---- Drag to reorder; a click never reorders; a drop outside changes nothing ----
  await run(async (ps) => { for (const p of ps) await ws.open(p, { where: "tab" }); ws.activate(ws.tabs.find((t) => t.path === "Big note.md")); }, notes.slice(5, 7));
  await sleep(400);
  const drag = async (from, to, steps = 20) => {
    await move(from); await mouse("mousePressed", from);
    for (let i = 1; i <= steps; i++) { await mouse("mouseMoved", { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }, "left", { buttons: 1 }); await sleep(16); }
    await mouse("mouseReleased", to);
  };
  const before = await order();
  const [a, b] = [await point(tab(before[0])), await point(tab(before[2]))];
  await measure("drag_reorder", () => drag(a, { x: b.x + 20, y: a.y }), `ws.activeGroup.tabs[0].path !== ${JSON.stringify(before[0])}`, { settle: 500 });
  const after = await order(), d = out.drag_reorder;
  check(JSON.stringify(after) === JSON.stringify([before[1], before[2], before[0], ...before.slice(3)]), `drag: ${before[0]} moved after ${before[2]}: ${JSON.stringify(after)}`);
  check(d.gap_p95 <= 17 && d.long === 0 && !d.removed.editor && !Object.keys(d.flashes).length, `drag: frames p95 ${d.gap_p95} ms, ${d.long} long tasks, editor removed ${d.removed.editor ?? 0}, flashes ${JSON.stringify(d.flashes)}`);
  await kept("drag_reorder", big);
  check(!(await evaluate("!!document.querySelector('.drag-ghost:not(.is-closing), .workspace-drop-overlay.is-visible, .is-being-dragged') || document.body.classList.contains('is-grabbing')")), "drag: nothing left behind after the drop");
  await sleep(300);
  check(JSON.stringify(await order()) === JSON.stringify(after), "drag: the new order sticks");
  const c = await point(tab(after[1]));
  await move(c); await mouse("mousePressed", c); await mouse("mouseMoved", { x: c.x + 2, y: c.y + 1 }, "left", { buttons: 1 }); await mouse("mouseReleased", { x: c.x + 2, y: c.y + 1 });
  await sleep(250);
  check(JSON.stringify(await order()) === JSON.stringify(after) && (await where()).path === after[1] && (await where()).focus, "a click (with a 2 px wobble) switches to the tab and never reorders");
  await press1(tab("Big note.md"));
  await sleep(250);
  await refocus();
  await drag(await point(tab(after[0])), { x: 150, y: 450 });
  await sleep(400);
  check(JSON.stringify(await order()) === JSON.stringify(after), "a drop outside any pane changes nothing");
  check(!(await evaluate("!!document.querySelector('.drag-ghost:not(.is-closing), .workspace-drop-overlay.is-visible, .is-being-dragged') || document.body.classList.contains('is-grabbing')")), "a drop outside leaves nothing behind");
  await kept("drop_outside", big);

  // ---- Keyboard and pin still work ----
  const count = (await order()).length;
  // Ctrl+T from the first tab (so its new tab's neighbour is another note), with the caret set.
  await press1(tab((await order())[0])); await sleep(250);
  await run(() => { ws.view.dispatch({ selection: { anchor: Math.min(7, ws.view.state.doc.length) } }); ws.view.focus(); });
  const origin = await where();
  await chord("t"); await sleep(250);
  check((await order()).length === count + 1 && (await evaluate("ws.active.path")) === null && (await order()).at(-1) === null, "Ctrl+T opens a new tab at the end");
  await chord("w"); await sleep(250);
  const back = await where();
  check(back.focus && back.path === origin.path && back.head === origin.head && (await order()).length === count, `Ctrl+W closes the untouched new tab and goes back to the note it came from, caret and all (${back.path} @${back.head}, expected ${origin.path} @${origin.head})`);
  await chord("t"); await sleep(250);
  await run(async (p) => { await ws.open(p); }, notes[4]);
  await chord("w"); await sleep(250);
  check((await where()).path === (await order()).at(-1), `a new tab that opened a note closes to its neighbour as before (${(await where()).path})`);
  await press1(tab(big.path)); await sleep(250);
  const pre = await where();
  await key("Control", 2); await press("Tab", 2); await key("Control", 0, "keyUp"); await sleep(250);
  const cycled = await where();
  check(cycled.path !== pre.path && cycled.focus, `Ctrl+Tab moves to the next tab with focus in it (${pre.path} → ${cycled.path})`);
  await chord("w"); await sleep(250);
  await key("Control", 2); await key("Shift", 10); await press("T", 10); await key("Shift", 2, "keyUp"); await key("Control", 0, "keyUp"); await sleep(300);
  check((await where()).path === cycled.path && (await order()).length === count, "Ctrl+Shift+T reopens the closed tab in its place");
  await run(() => ws.togglePin());
  await sleep(250);
  const pinned = await look(cycled.path);
  check(pinned.close === "1" && (await evaluate(`document.querySelector(${JSON.stringify(tab(cycled.path))}).classList.contains("is-pinned")`)) && pinned.titleClear >= 0, `pin: the pin shows and the title stops before it ${JSON.stringify(pinned)}`);
  await refocus();
  await press1(closeOf(cycled.path));
  await sleep(250);
  check((await open(cycled.path)) && !(await evaluate(`document.querySelector(${JSON.stringify(tab(cycled.path))}).classList.contains("is-pinned")`)), "a click on the pin unpins the tab and keeps it open");

  // ---- Many tabs share the strip evenly ----
  await run(async (ps) => { for (const p of ps) await ws.open(p, { where: "tab" }); }, notes.slice(7, 12));
  await sleep(600);
  const many = await boxes();
  check(many.tabs.length >= 8 && many.tabs.every((t) => Math.abs(t[3] - many.tabs[0][3]) <= 1) && many.tabs.at(-1)[1] + many.tabs.at(-1)[3] <= many.plus[0] + 1, `${many.tabs.length} tabs shrink evenly and leave New tab in place (widths ${[...new Set(many.tabs.map((t) => t[3]))]})`);

  console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.ms === undefined ? v : { ms: v.ms, long: v.long, gap_p95: v.gap_p95, js_max: v.js_max }]))));
  if (REPORT) return console.log(misses);
  assert.deepEqual(misses, [], "tab strip (T1)");
  console.log("PASS tab strip: slim and even, hover, unlink, close, middle-close (also over the buttons), click, drag, drop outside, keyboard, new tab closes to its origin, pin, focus");
});
