// Canvas, Bases, graph, drawing and settings still open in the turn that asks
// for them once their chunks are warm, and a restored workspace paints the
// real view with the tab (no empty heavy tab, no base embed popping in later).
import { withBrowser, sleep } from "./browser.mjs";

const BASE = "views:\n  - type: table\n    name: View\n";
const DRAWING = "{\"type\":\"excalidraw\",\"version\":2,\"source\":\"grove\",\"elements\":[],\"appState\":{\"gridSize\":null,\"viewBackgroundColor\":\"#ffffff\"},\"files\":{}}\n";

const GAP = `(() => {
  window.__l2 = { gap: false, seen: 0 };
  const iconView = { "layout-dashboard": ".canvas-view", table: ".bases-view", pencil: ".drawing-view", "git-fork": ".graph-view" };
  const look = () => {
    window.__l2.seen++;
    const pane = document.querySelector(".workspace-tabs.mod-active");
    const header = pane?.querySelector(".workspace-tab-header.is-active");
    const sel = header && iconView[header.dataset.icon];
    if (sel && !pane.querySelector(sel)) window.__l2.gap = true;
    const text = document.querySelector(".cm-content")?.textContent ?? "";
    if (text.includes("Before the base.") && !document.querySelector(".bases-view")) window.__l2.gap = true;
    const local = document.querySelector('.mod-right-split .workspace-tab-header.is-active[aria-label="Local graph"]');
    if (local && !document.querySelector(".graph-view.mod-local")) window.__l2.gap = true;
  };
  const arm = () => {
    const root = document.documentElement;
    if (!root) return false;
    new MutationObserver(look).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-icon"] });
    look();
    return true;
  };
  if (arm()) return;
  const boot = new MutationObserver(() => { if (arm()) boot.disconnect(); });
  boot.observe(document, { childList: true, subtree: true });
})();`;

await withBrowser(async ({ send, run, evaluate, check }) => {
  const wait = async (test, message) => {
    for (let i = 0; i < 200; i++) {
      if (await test()) return;
      await sleep(25);
    }
    throw new Error(message);
  };

  await wait(() => evaluate(`document.documentElement.dataset.groveHeavy === "ready"`), "heavy chunks did not finish warming");

  await run(async (base, drawing) => {
    const { api } = await import("/src/api.ts");
    await api.createNote("L2.canvas", "{\"nodes\":[],\"edges\":[]}\n");
    await api.createNote("L2.base", base);
    await api.createNote("L2.excalidraw", drawing);
    await api.createNote("L2 embed.md", "Before the base.\n\n```base\n" + base + "```\n");
    await ws.vault.refreshFiles();
    window.__openSettings = (await import("/src/settings/gate.ts")).openSettings;
  }, BASE, DRAWING);

  const opened = await run(() => {
    const time = (fn) => {
      const start = performance.now();
      fn();
      return Math.round(performance.now() - start);
    };
    const out = {};
    out.canvasMs = time(() => { void ws.open("L2.canvas"); });
    out.canvas = !!document.querySelector(".workspace-tabs.mod-active .canvas-view");
    out.baseMs = time(() => { void ws.open("L2.base"); });
    out.base = !!document.querySelector(".workspace-tabs.mod-active .bases-view");
    out.drawingMs = time(() => { void ws.open("L2.excalidraw"); });
    out.drawing = !!document.querySelector(".workspace-tabs.mod-active .drawing-view");
    out.graphMs = time(() => { grove.run("graph:open"); });
    out.graph = !!document.querySelector(".workspace-tabs.mod-active .graph-view");
    out.settingsMs = time(() => { window.__openSettings(); });
    out.settings = !!document.querySelector(".modal.mod-settings");
    document.querySelector(".modal-close-button")?.click();
    out.settingsClosed = !document.querySelector(".modal.mod-settings");
    return out;
  });
  console.log("L2_OPEN", JSON.stringify(opened));
  check(opened.canvas, `a warm canvas is in the document in the open turn (${opened.canvasMs} ms)`);
  check(opened.base, `a warm base is in the document in the open turn (${opened.baseMs} ms)`);
  check(opened.drawing, `a warm drawing is in the document in the open turn (${opened.drawingMs} ms)`);
  check(opened.graph, `a warm graph is in the document in the open turn (${opened.graphMs} ms)`);
  check(opened.settings && opened.settingsClosed, `warm settings open and close in the calling turn (${opened.settingsMs} ms)`);

  const embed = await run(async () => {
    await ws.editors.load("L2 embed.md");
    let painted = false;
    requestAnimationFrame(() => { painted = true; });
    await ws.open("L2 embed.md");
    return {
      view: !!document.querySelector(".internal-embed.bases-embed .bases-view"),
      painted,
    };
  });
  console.log("L2_EMBED", JSON.stringify(embed));
  check(embed.view && !embed.painted, "a base embed is mounted before the next frame");

  const save = async (rightView, rightOpen) => {
    await run(async (rightView, rightOpen) => {
      const { saveWorkspace, saveLayout } = await import("/src/shell/prefs.ts");
      saveWorkspace(ws.vault.path, ws.saveLayout());
      saveLayout(ws.vault.path, { rightOpen, leftWidth: null, rightWidth: 300, rightView, fileSort: "alphabetical" });
    }, rightView, rightOpen);
  };

  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: GAP });
  const origin = await evaluate("location.origin");

  const reload = async (label, seen) => {
    await send("Page.navigate", { url: `${origin}/?l2fixtures=1` });
    await wait(() => evaluate(seen), `${label} did not restore`);
    await sleep(150);
    const gap = await evaluate("window.__l2");
    check(gap && gap.gap === false && gap.seen > 0, `${label} restore never showed the tab without its view (${gap?.seen ?? 0} samples)`);
  };

  await run(() => ws.open("L2.canvas"));
  await save("localgraph", true);
  await reload("canvas and local graph", '!!document.querySelector(".canvas-view") && !!document.querySelector(".graph-view.mod-local")');

  await run(() => ws.open("L2 embed.md"));
  await save("backlinks", false);
  await reload("base embed", '!!document.querySelector(".internal-embed.bases-embed .bases-view")');

  await run(() => ws.open("L2.base"));
  await save("backlinks", false);
  await reload("base", '!!document.querySelector(".workspace-tabs.mod-active .bases-view")');

  await run(() => ws.open("L2.excalidraw"));
  await save("backlinks", false);
  await reload("drawing", '!!document.querySelector(".workspace-tabs.mod-active .drawing-view")');
});
