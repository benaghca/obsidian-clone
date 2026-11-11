// Canvas, Bases, graph, drawing and settings still open in the turn that asks
// for them once their chunks are warm, and a restored workspace paints the
// real view with the tab (no empty heavy tab, no base embed popping in later).
// The production build then holds those chunks: an inactive restored tab, a
// keyboard switch, a close onto that tab, the local graph, a tilde base fence
// (including an inactive restored note, a close onto it, and a history step),
// and a warm graph opened while a canvas is still loading.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowser, sleep, withBrowser } from "./browser.mjs";

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
    if ((text.includes("Before the base.") || text.includes("Before the tilde.")) && !document.querySelector(".bases-view")) window.__l2.gap = true;
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

const IDLE = `(() => {
  window.__idleScheduled = 0;
  window.__idleRan = 0;
  const orig = window.requestIdleCallback;
  if (typeof orig !== "function") return;
  window.requestIdleCallback = function (cb, opts) {
    window.__idleScheduled++;
    return orig.call(window, function (deadline) {
      window.__idleRan++;
      return cb(deadline);
    }, opts);
  };
})();`;

const MARKERS = [
  ["canvas", "Drag to add card"],
  ["canvas", "Snap to objects"],
  ["base", "Group by a property to make columns."],
  ["base", "Open the note this base is in to change it."],
  ["graph", "Start timelapse animation"],
  ["drawing", "drawing-tools"],
];

/** Static `from "./x"` / `import "./x"` specifiers. Dynamic import() is not one of these. */
function specifiers(code) {
  return [...code.matchAll(/(?:\bfrom|\bimport)\s*["'](\.[^"']+)["']/g)].map((match) => match[1]);
}

function classifyChunks(dist) {
  const assets = join(dist, "assets");
  const texts = new Map();
  for (const name of readdirSync(assets)) {
    if (!name.endsWith(".js")) continue;
    texts.set(name, readFileSync(join(assets, name), "utf8"));
  }
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const entrySrc = /<script type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
  if (!entrySrc) throw new Error("dist/index.html has no module entry");
  const depName = (file, spec) => new URL(spec, `http://local/assets/${file}`).pathname.split("/").pop();
  const startup = new Set();
  const queue = [entrySrc.split("/").pop()];
  while (queue.length) {
    const name = queue.pop();
    if (!name || startup.has(name) || !texts.has(name)) continue;
    startup.add(name);
    for (const spec of specifiers(texts.get(name))) queue.push(depName(name, spec));
  }
  const kindsOf = new Map();
  const add = (file, kind) => {
    if (startup.has(file)) throw new Error(`startup chunk ${file} contains the ${kind} view`);
    const kinds = kindsOf.get(file) ?? new Set();
    kinds.add(kind);
    kindsOf.set(file, kinds);
  };
  for (const [file, text] of texts) for (const [kind, marker] of MARKERS) if (text.includes(marker)) add(file, kind);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [file, text] of texts) {
      if (startup.has(file)) continue;
      for (const spec of specifiers(text)) {
        const dep = kindsOf.get(depName(file, spec));
        if (!dep) continue;
        for (const kind of dep) {
          const mine = kindsOf.get(file);
          if (mine?.has(kind)) continue;
          add(file, kind);
          grew = true;
        }
      }
    }
  }
  for (const kind of ["canvas", "base", "graph", "drawing"]) {
    if (![...kindsOf.values()].some((kinds) => kinds.has(kind))) throw new Error(`no ${kind} chunk in dist/assets`);
  }
  return kindsOf;
}

function contentType(path) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
  };
  return types[extname(path)] ?? "application/octet-stream";
}

const noteTab = (path) => ({ path, mode: "live", pinned: false, back: [], forward: [] });
const viewTab = (type, file) => ({ path: null, type, file, mode: "live", pinned: false, back: [], forward: [] });
const savedWorkspace = (tabs, active) => ({ v: 1, active: 0, root: { type: "group", tabs, active } });
const savedLayout = (rightView, rightOpen) => ({ rightOpen, leftWidth: null, rightWidth: 320, rightView, fileSort: "alphabetical" });

async function withDist(test) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const dist = join(root, "dist");
  if (!existsSync(join(dist, "index.html"))) throw new Error("dist/index.html is missing; the startup-chunk check builds it before this script");
  const kindsOf = classifyChunks(dist);
  const listed = Object.fromEntries([...kindsOf].map(([name, kinds]) => [name, [...kinds]]));
  console.log("L2_CHUNKS", JSON.stringify(listed));
  const executable = findBrowser();
  if (!executable) throw new Error("No browser found. Set GROVE_BROWSER to the full path to Chrome, Edge or Chromium.");
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      const path = resolve(dist, rel);
      const rootPath = resolve(dist);
      if (path !== rootPath && !path.startsWith(rootPath + sep)) {
        res.writeHead(403).end();
        return;
      }
      if (!existsSync(path) || !statSync(path).isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": contentType(path), "cache-control": "no-store" });
      res.end(readFileSync(path));
    } catch {
      res.writeHead(500).end();
    }
  });
  const port = await new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePort(server.address().port));
  });
  const origin = `http://127.0.0.1:${port}`;
  const scratch = await mkdtemp(root + "node_modules/.browser-");
  const browser = spawn(executable, ["--headless", "--no-sandbox", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${scratch}`, "about:blank"], { stdio: "ignore" });
  let socket;
  try {
    let tabs;
    for (let i = 0; i < 100; i++) {
      try {
        const debugPort = (await readFile(scratch + "/DevToolsActivePort", "utf8")).split("\n")[0];
        tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
        if (tabs.some((item) => item.type === "page")) break;
      } catch { /* browser still starting */ }
      await sleep(100);
    }
    if (!tabs?.some((item) => item.type === "page")) throw new Error("headless Chromium did not start");
    socket = new WebSocket(tabs.find((item) => item.type === "page").webSocketDebuggerUrl);
    await new Promise((resolveOpen) => { socket.onopen = resolveOpen; });
    let sequence = 0;
    const pending = new Map();
    const listeners = new Map();
    const errors = [];
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      for (const listener of listeners.get(message.method) ?? []) listener(message.params);
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "exception");
      if (!message.id) return;
      const [resolveCall, rejectCall] = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) rejectCall(new Error(JSON.stringify(message.error)));
      else resolveCall(message.result);
    };
    const send = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
      pending.set(++sequence, [resolveCall, rejectCall]);
      socket.send(JSON.stringify({ id: sequence, method, params }));
    });
    const on = (method, listener) => {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(listener);
    };
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    };
    const check = (value, message) => { if (!value) throw new Error(message); console.log("PASS", message); };
    const waitFor = async (expression, message) => {
      for (let i = 0; i < 200; i++) {
        if (await evaluate(expression)) return;
        await sleep(25);
      }
      throw new Error(message);
    };
    const holds = async (expression, ms, message) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (!await evaluate(expression)) throw new Error(message);
        await sleep(40);
      }
    };
    const click = async (selector, modifiers = 0) => {
      const point = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; node.scrollIntoView({ block: "center", inline: "nearest" }); const rect = node.getBoundingClientRect(); const x = rect.x + rect.width / 2; const y = rect.y + rect.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, w: rect.width, h: rect.height, ok: !!(hit && (hit === node || node.contains(hit))), hit: hit ? (hit.getAttribute("class") || hit.tagName) : "none" }; })()`);
      if (!point || point.w < 1 || point.h < 1) throw new Error(`nothing to click for ${selector}`);
      if (!point.ok) throw new Error(`click missed ${selector} (hit ${point.hit})`);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
      await sleep(40);
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1, modifiers });
      await sleep(50);
    };
    const key = async (keyName, modifiers = 0, type = "keyDown") => {
      const virtual = { Enter: 13, Escape: 27, Control: 17, Tab: 9, Backspace: 8, Shift: 16, Alt: 18, ArrowLeft: 37, ArrowRight: 39 }[keyName] ?? (keyName.length === 1 ? keyName.toUpperCase().charCodeAt(0) : 0);
      const code = keyName === "Tab" || keyName === "ArrowLeft" || keyName === "ArrowRight" ? keyName : keyName === "Control" ? "ControlLeft" : keyName === "Alt" ? "AltLeft" : keyName.length === 1 ? `Key${keyName.toUpperCase()}` : keyName;
      await send("Input.dispatchKeyEvent", { type, key: keyName, code, modifiers, windowsVirtualKeyCode: virtual });
    };
    const press = async (keyName, modifiers = 0) => { await key(keyName, modifiers); await key(keyName, modifiers, "keyUp"); };
    const blocked = new Set();
    const paused = new Map();
    const held = (name) => [...(kindsOf.get(name) ?? [])].some((kind) => blocked.has(kind));
    on("Fetch.requestPaused", (params) => {
      const name = new URL(params.request.url).pathname.split("/").pop() ?? "";
      if (held(name)) {
        paused.set(params.requestId, name);
        return;
      }
      void send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
    });
    const drain = async () => {
      // Let the page we are leaving finish its paused imports. Failing them
      // rejects the loader and shows up as a browser exception.
      const ids = [...paused.keys()];
      paused.clear();
      for (const requestId of ids) await send("Fetch.continueRequest", { requestId }).catch(() => {});
    };
    const release = async (kind) => {
      blocked.delete(kind);
      const ids = [...paused].filter(([, name]) => !held(name)).map(([id]) => id);
      for (const requestId of ids) {
        paused.delete(requestId);
        await send("Fetch.continueRequest", { requestId }).catch(() => {});
      }
    };
    const waitHeld = async (kind) => {
      for (let i = 0; i < 200; i++) {
        if ([...paused.values()].some((name) => kindsOf.get(name)?.has(kind))) return;
        await sleep(25);
      }
      throw new Error(`the ${kind} chunk was never requested`);
    };
    const plant = (workspace, layout) => {
      const lines = ["localStorage.clear();"];
      if (workspace) lines.push(`localStorage.setItem(${JSON.stringify("grove.workspace:/mock/Sample Vault")}, ${JSON.stringify(JSON.stringify(workspace))});`);
      if (layout) lines.push(`localStorage.setItem(${JSON.stringify("grove.layout:/mock/Sample Vault")}, ${JSON.stringify(JSON.stringify(layout))});`);
      return send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { ${lines.join(" ")} })();` });
    };
    const gap = async (label) => {
      const state = await evaluate("window.__l2");
      check(state && state.gap === false && state.seen > 0, `${label} kept the header and the view together (${state?.seen ?? 0} samples)`);
    };
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Network.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `${IDLE}\n${GAP}` });
    await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    let nav = 0;
    const open = async (block, workspace, layout) => {
      await drain();
      blocked.clear();
      for (const kind of block) blocked.add(kind);
      await plant(workspace, layout);
      nav += 1;
      await send("Page.navigate", { url: `${origin}/?l2fixtures=1&cold=${nav}` });
    };
    await test({ check, evaluate, waitFor, holds, click, key, press, release, waitHeld, gap, open, errors });
    if (errors.length) throw new Error(`browser exceptions:\n${errors.join("\n")}`);
  } finally {
    socket?.close();
    browser.kill();
    server.close();
    await new Promise((resolveExit) => { browser.once("exit", resolveExit); setTimeout(resolveExit, 2000); });
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const restoredCanvas = savedWorkspace([noteTab("Welcome.md"), viewTab("canvas", "L2.canvas")], 0);
const welcomeHeader = `document.querySelector(".workspace-tabs.mod-active .workspace-tab-header.is-active")?.getAttribute("aria-label") === "Welcome.md"`;
const noCanvas = `!document.querySelector(".canvas-view")`;

await withDist(async ({ check, evaluate, waitFor, holds, click, key, press, release, waitHeld, gap, open }) => {
  const ready = async (label) => {
    await waitFor(`(document.querySelector(".cm-content")?.textContent ?? "").includes("sample vault")`, `${label} did not show the welcome note`);
    await waitFor(`window.__idleScheduled > 0 && window.__l2 && window.__l2.seen > 0`, `${label} did not schedule the production idle warm`);
  };

  await open(["canvas"], restoredCanvas, savedLayout("backlinks", false));
  await ready("inactive canvas");
  await waitHeld("canvas");
  check(await evaluate(`document.documentElement.dataset.groveHeavy !== "ready"`), "a held canvas keeps the heavy warm unfinished");
  await waitFor(`!!document.querySelector('.workspace-tabs.mod-active .workspace-tab-header[aria-label="L2"]:not(.is-active)')`, "the restored canvas tab was not left inactive");
  await click(`.workspace-tabs.mod-active .workspace-tab-header[aria-label="L2"] .workspace-tab-header-inner-title`);
  await holds(`${welcomeHeader} && ${noCanvas}`, 400, "clicking a cold canvas tab committed it before the chunk loaded");
  await gap("cold canvas click");
  await release("canvas");
  await waitFor(`document.querySelector('.workspace-tabs.mod-active .workspace-tab-header.is-active[aria-label="L2"]') && document.querySelector(".workspace-tabs.mod-active .canvas-view")`, "the canvas tab did not show its view after the chunk loaded");
  await gap("cold canvas click after load");

  await open(["canvas"], restoredCanvas, savedLayout("backlinks", false));
  await ready("ctrl+tab");
  await waitHeld("canvas");
  await key("Control", 2); await press("Tab", 2); await key("Control", 0, "keyUp");
  await holds(`${welcomeHeader} && ${noCanvas}`, 400, "Ctrl+Tab committed a cold canvas tab before the chunk loaded");
  await gap("cold canvas Ctrl+Tab");
  await release("canvas");
  await waitFor(`document.querySelector('.workspace-tabs.mod-active .workspace-tab-header.is-active[aria-label="L2"]') && document.querySelector(".workspace-tabs.mod-active .canvas-view")`, "Ctrl+Tab did not show the canvas once its chunk loaded");
  await gap("cold canvas Ctrl+Tab after load");

  await open(["canvas"], restoredCanvas, savedLayout("backlinks", false));
  await ready("close");
  await waitHeld("canvas");
  await click(".workspace-tabs.mod-active .workspace-tab-header.is-active .workspace-tab-header-inner-close-button");
  await holds(`${welcomeHeader} && !!document.querySelector('.workspace-tabs.mod-active .workspace-tab-header[aria-label="Welcome.md"]') && ${noCanvas}`, 400, "closing onto a cold canvas tab committed it before the chunk loaded");
  await gap("cold close");
  await release("canvas");
  await waitFor(`!document.querySelector('.workspace-tab-header[aria-label="Welcome.md"]:not(.is-closing)') && document.querySelector('.workspace-tabs.mod-active .workspace-tab-header.is-active[aria-label="L2"]') && document.querySelector(".canvas-view")`, "the close did not fall through to the canvas once its chunk loaded");
  await gap("cold close after load");

  await open(["graph"], null, savedLayout("backlinks", true));
  await ready("local graph");
  await waitHeld("graph");
  await waitFor(`!!document.querySelector('.mod-right-split .workspace-tab-header.is-active[aria-label="Backlinks"]')`, "the right sidebar did not open on Backlinks");
  await click(`.mod-right-split .workspace-tab-header[aria-label="Local graph"]`);
  await holds(`!!document.querySelector('.mod-right-split .workspace-tab-header.is-active[aria-label="Backlinks"]') && !document.querySelector(".graph-view.mod-local")`, 400, "Local graph was marked active before its view existed");
  await gap("cold local graph");
  await release("graph");
  await waitFor(`!!document.querySelector('.mod-right-split .workspace-tab-header.is-active[aria-label="Local graph"]') && !!document.querySelector(".graph-view.mod-local")`, "Local graph did not show with its button");
  await gap("cold local graph after load");

  await open(["base"], savedWorkspace([noteTab("L2 tilde.md")], 0), savedLayout("backlinks", false));
  await waitFor(`!!document.querySelector('.tree-item-self[data-path="L2 tilde.md"]')`, "the tilde note was not in the vault");
  await holds(`!(document.querySelector(".cm-content")?.textContent ?? "").includes("Before the tilde.")`, 600, "a restored ~~~base note painted before the Bases chunks loaded");
  await gap("restored tilde fence");
  await release("base");
  await waitFor(`(document.querySelector(".cm-content")?.textContent ?? "").includes("Before the tilde.") && !!document.querySelector(".internal-embed.bases-embed .bases-view")`, "the restored tilde note did not mount its base with the text");
  await gap("restored tilde fence after load");

  await open(["base"], null, savedLayout("backlinks", false));
  await ready("open tilde");
  await waitHeld("base");
  await click(`.tree-item-self[data-path="L2 tilde.md"]`);
  await holds(`(document.querySelector(".cm-content")?.textContent ?? "").includes("sample vault") && !(document.querySelector(".cm-content")?.textContent ?? "").includes("Before the tilde.")`, 400, "opening a ~~~base note painted it before the Bases chunks loaded");
  await gap("opened tilde fence");
  await release("base");
  await waitFor(`(document.querySelector(".cm-content")?.textContent ?? "").includes("Before the tilde.") && !!document.querySelector(".internal-embed.bases-embed .bases-view")`, "the opened tilde note did not mount its base with the text");
  await gap("opened tilde fence after load");

  const restoredInactiveTilde = savedWorkspace([noteTab("Welcome.md"), noteTab("L2 tilde.md")], 0);
  const tildeHidden = `!(document.querySelector(".cm-content")?.textContent ?? "").includes("Before the tilde.") && !document.querySelector(".bases-view")`;
  const tildeShown = `(document.querySelector(".cm-content")?.textContent ?? "").includes("Before the tilde.") && !!document.querySelector(".internal-embed.bases-embed .bases-view")`;
  const tildeHeader = `document.querySelector(".workspace-tabs.mod-active .workspace-tab-header.is-active")?.getAttribute("aria-label") === "L2 tilde.md"`;

  await open(["base"], restoredInactiveTilde, savedLayout("backlinks", false));
  await ready("inactive tilde");
  await waitHeld("base");
  await waitFor(`!!document.querySelector('.workspace-tabs.mod-active .workspace-tab-header[aria-label="L2 tilde.md"]:not(.is-active)')`, "the restored tilde note was not left inactive");
  await click(`.workspace-tabs.mod-active .workspace-tab-header[aria-label="L2 tilde.md"] .workspace-tab-header-inner-title`);
  await holds(`${welcomeHeader} && ${tildeHidden}`, 400, "clicking an unloaded base note committed it before the Bases chunks loaded");
  await gap("inactive tilde");
  await release("base");
  await waitFor(`${tildeHeader} && ${tildeShown}`, "the inactive tilde note did not show its base with the text");
  await gap("inactive tilde after load");

  await open(["base"], restoredInactiveTilde, savedLayout("backlinks", false));
  await ready("close onto tilde");
  await waitHeld("base");
  await click(".workspace-tabs.mod-active .workspace-tab-header.is-active .workspace-tab-header-inner-close-button");
  await holds(`${welcomeHeader} && !!document.querySelector('.workspace-tabs.mod-active .workspace-tab-header[aria-label="Welcome.md"]') && ${tildeHidden}`, 400, "closing onto an unloaded base note committed it before the Bases chunks loaded");
  await gap("close onto tilde");
  await release("base");
  await waitFor(`!document.querySelector('.workspace-tab-header[aria-label="Welcome.md"]:not(.is-closing)') && ${tildeHeader} && ${tildeShown}`, "the close did not fall through to the tilde note with its base");
  await gap("close onto tilde after load");

  await open(["base"], savedWorkspace([{ ...noteTab("Welcome.md"), back: ["L2 tilde.md"] }], 0), savedLayout("backlinks", false));
  await ready("history tilde");
  await waitHeld("base");
  await key("Control", 2);
  await key("Alt", 3);
  await press("ArrowLeft", 3);
  await key("Alt", 2, "keyUp");
  await key("Control", 0, "keyUp");
  await holds(`${welcomeHeader} && ${tildeHidden}`, 400, "history opened an unloaded base note before the Bases chunks loaded");
  await gap("history tilde");
  await release("base");
  await waitFor(`${tildeHeader} && ${tildeShown}`, "history did not show the tilde note with its base");
  await gap("history tilde after load");

  await open(["canvas"], null, savedLayout("backlinks", false));
  await ready("graph over canvas");
  await waitFor(`document.documentElement.dataset.groveGraph === "ready" && window.__idleRan > 0`, "the production idle warm did not finish the graph while canvas was held");
  check(await evaluate(`document.documentElement.dataset.groveHeavy !== "ready"`), "the heavy warm finished while the canvas chunk was still held");
  await waitHeld("canvas");
  // A plain click clears the multi-selection and does not mark the row. Alt-click
  // toggles is-selected and does not open, so the next plain click is the open.
  const canvasRow = `.nav-files .tree-item-self[data-path="L2.canvas"]`;
  await click(`${canvasRow} .tree-item-inner`, 1);
  await waitFor(`!!document.querySelector('.nav-files .tree-item-self.is-selected[data-path="L2.canvas"]')`, "the canvas row did not receive the click");
  await click(`${canvasRow} .tree-item-inner`);
  await waitFor(`!document.querySelector('.nav-files .tree-item-self.is-selected[data-path="L2.canvas"]')`, "the canvas row click did not start the open");
  await holds(`${welcomeHeader} && ${noCanvas}`, 300, "the cold canvas open replaced the note before its chunk loaded");
  await key("Control", 2); await press("g", 2); await key("Control", 0, "keyUp");
  await waitFor(`!!document.querySelector(".workspace-tabs.mod-active .graph-view") && document.querySelector(".workspace-tabs.mod-active .workspace-tab-header.is-active")?.getAttribute("aria-label") === "Graph view" && ${noCanvas}`, "Ctrl+G did not open the warm graph over the loading canvas");
  await release("canvas");
  await waitFor(`document.documentElement.dataset.groveHeavy === "ready"`, "the heavy chunks did not finish after the canvas hold was released");
  await sleep(100);
  check(await evaluate(`!!document.querySelector(".workspace-tabs.mod-active .graph-view") && ${noCanvas}`), "the late canvas chunk replaced the graph that was opened while it loaded");
  await gap("canvas cold then graph warm");
});
