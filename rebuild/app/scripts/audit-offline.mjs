#!/usr/bin/env node
// Offline audit: Grove must never reach outside the machine. This fails if
// the source, the styles, the config or the built bundle contain a network
// API, a remote URL or a networking dependency that is not on the short,
// commented allowlist below. Run it with `npm run audit:offline` (which
// builds dist/ first).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

// ----- 1. network APIs and remote URLs in shipped text -----

const RULES = [
  { id: "url", re: /\b(?:https?|wss?|ftp):\/\/[^\s"'`)<>\\]*/gi, what: "URL" },
  { id: "fetch", re: /\bfetch\s*\(/g, what: "fetch()" },
  { id: "xhr", re: /\bXMLHttpRequest\b/g, what: "XMLHttpRequest" },
  { id: "websocket", re: /\bWebSocket\b/g, what: "WebSocket" },
  { id: "eventsource", re: /\bEventSource\b/g, what: "EventSource" },
  { id: "beacon", re: /\bsendBeacon\b/g, what: "sendBeacon" },
  { id: "webrtc", re: /\bRTCPeerConnection\b/g, what: "RTCPeerConnection" },
  { id: "service-worker", re: /\bserviceWorker\b/g, what: "service worker" },
  { id: "import-scripts", re: /\bimportScripts\s*\(/g, what: "importScripts()" },
  { id: "window-open", re: /\bwindow\.open\s*\(/g, what: "window.open()" },
  { id: "css-import", re: /@import\s+(?:url\(\s*)?["']?(?:[a-z]+:)?\/\//gi, what: "remote @import" },
  { id: "css-url", re: /url\(\s*["']?(?:[a-z]+:)?\/\//gi, what: "remote url()" },
  { id: "source-map", re: /sourceMappingURL=/g, what: "source map reference" },
];

// Every exception, with the reason it cannot reach the network.
const ALLOW = [
  {
    rule: "url",
    match: /^http:\/\/www\.w3\.org\/2000\/svg$/,
    files: /./,
    why: "SVG XML namespace identifier on inline icons (and CodeMirror's); an identifier, never fetched",
  },
  {
    rule: "url",
    match: /^https:\/\/schema\.tauri\.app\/config\/2$/,
    files: /^src-tauri\/tauri\.conf\.json$/,
    why: "$schema hint for editors; neither Tauri nor the app reads it at runtime",
  },
  {
    rule: "url",
    match: /^http:\/\/localhost:1420\/?$/,
    files: /^src-tauri\/tauri\.conf\.json$/,
    why: "devUrl: the local Vite dev server, loaded by dev builds only",
  },
  {
    rule: "url",
    match: /^ws:\/\/localhost:1420$/,
    files: /^src-tauri\/tauri\.conf\.json$/,
    why: "devCsp only: Vite's hot-reload socket on localhost",
  },
  {
    rule: "url",
    match: /^http:\/\/(?:asset|ipc)\.localhost$/,
    files: /^src-tauri\/tauri\.conf\.json$/,
    why: "CSP sources for Tauri's in-process custom protocols (how WebView2 spells asset: and ipc:)",
  },
  {
    rule: "url",
    match: /^https?:\/\/\*$/,
    files: /^src-tauri\/capabilities\/[\w-]+\.json$/,
    why: "opener scope: which links a click may hand to the system browser",
  },
  {
    rule: "url",
    match: /^https:\/\/(?:obsidian\.md|example\.com\/[\w./-]*)$/,
    files: /^(?:src\/mock\/sampleVault\.ts|dist\/assets\/backend-[\w-]+\.js)$/,
    why: "link text in the browser mock's sample notes, to exercise external links; never fetched",
  },
  {
    rule: "url",
    match: /^https:\/\/$/,
    files: /^dist\/assets\/index-[\w-]+\.js$/,
    why: "@codemirror/lang-markdown prefixes a pasted www. address with https:// when wrapping it in a markdown link; text only",
  },
];

// Source the app is built from (tests never ship; dist/ covers what does).
const SOURCE_DIRS = ["src"];
const SOURCE_FILES = ["index.html", "vite.config.ts", "src-tauri/tauri.conf.json"];
const TEXT = /\.(?:ts|js|mjs|css|html|json|svg)$/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const rel = (path) => relative(root, path).split("\\").join("/");

function scan(path) {
  const file = rel(path);
  const text = readFileSync(path, "utf8");
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      const hit = m[0];
      if (ALLOW.some((a) => a.rule === rule.id && a.files.test(file) && a.match.test(hit))) continue;
      const line = text.slice(0, m.index).split("\n").length;
      const context = text.slice(Math.max(0, m.index - 40), m.index + hit.length + 40).replace(/\s+/g, " ");
      fail(`${file}:${line}`, `${rule.what} "${hit}" not on the allowlist … ${context} …`);
    }
  }
}

const sources = [
  ...SOURCE_DIRS.flatMap((d) => walk(join(root, d))).filter((p) => TEXT.test(p) && !/\.test\.ts$/.test(p)),
  ...SOURCE_FILES.map((f) => join(root, f)),
  ...walk(join(root, "src-tauri/capabilities")),
];
for (const path of sources) scan(path);

const dist = join(root, "dist");
if (!existsSync(join(dist, "index.html"))) {
  fail("dist", "not built; run `npm run build` first (or use `npm run audit:offline`)");
} else {
  for (const path of walk(dist)) {
    if (path.endsWith(".map")) fail(rel(path), "source map shipped in the release bundle");
    else if (TEXT.test(path)) scan(path);
  }
}

// ----- 2. index.html: nothing inline, nothing remote -----

const html = readFileSync(join(root, "index.html"), "utf8");
// Inline <style> would make Tauri add a style nonce, which disables the
// 'unsafe-inline' that CodeMirror's injected styles rely on.
if (/<style\b/i.test(html)) fail("index.html", "inline <style>; keep styles in src/styles");
for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
  if (!/\bsrc=/.test(m[0])) fail("index.html", `inline script ${m[0]}`);
}

// ----- 3. Content-Security-Policy -----

const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const LOCAL_SOURCES = new Set(["'self'", "'none'", "data:", "blob:", "asset:", "ipc:", "http://asset.localhost", "http://ipc.localhost"]);
const REQUIRED = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "connect-src": ["ipc:", "http://ipc.localhost"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'none'"],
  "frame-src": ["'none'"],
};

function parseCsp(csp) {
  if (typeof csp === "string") {
    return Object.fromEntries(
      csp
        .split(";")
        .map((d) => d.trim().split(/\s+/))
        .filter((d) => d[0])
        .map(([name, ...sources]) => [name, sources]),
    );
  }
  return Object.fromEntries(Object.entries(csp).map(([k, v]) => [k, [v].flat().join(" ").split(/\s+/)]));
}

function checkCsp(name, csp, extra = []) {
  if (!csp) return fail(`tauri.conf.json ${name}`, "missing (no Content-Security-Policy at all)");
  const policy = parseCsp(csp);
  for (const [directive, sources] of Object.entries(policy)) {
    for (const source of sources) {
      const ok =
        LOCAL_SOURCES.has(source) ||
        extra.includes(source) ||
        (source === "'unsafe-inline'" && directive === "style-src");
      if (!ok) fail(`tauri.conf.json ${name}`, `${directive} allows "${source}", which is not a local source`);
    }
  }
  for (const [directive, needed] of Object.entries(REQUIRED)) {
    for (const source of needed) {
      if (!policy[directive]?.includes(source)) fail(`tauri.conf.json ${name}`, `${directive} must include ${source}`);
    }
  }
}

const security = conf.app?.security ?? {};
checkCsp("csp", security.csp);
// Dev builds also talk to the local Vite server and its hot-reload socket.
if (security.devCsp) checkCsp("devCsp", security.devCsp, ["ws://localhost:1420"]);
if (security.dangerousDisableAssetCspModification) {
  fail("tauri.conf.json", "dangerousDisableAssetCspModification is set; the CSP must stay as written");
}
for (const w of conf.app?.windows ?? []) {
  if (w.url && /^[a-z]+:/i.test(w.url)) fail(`tauri.conf.json window ${w.label}`, `loads ${w.url}; windows load the app only`);
}

// ----- 4. capabilities: own origin only, opener scoped to http/https/mailto -----

const OPENER_SCOPES = new Set(["http://*", "https://*", "mailto:*"]);
for (const path of walk(join(root, "src-tauri/capabilities"))) {
  const file = rel(path);
  const cap = JSON.parse(readFileSync(path, "utf8"));
  if (cap.remote) fail(file, `grants IPC to remote origins ${JSON.stringify(cap.remote)}`);
  for (const perm of cap.permissions ?? []) {
    const id = typeof perm === "string" ? perm : perm.identifier;
    if (/^(?:http|updater|shell|websocket|upload|fs|process):/.test(id)) fail(file, `${id} is not allowed in Grove`);
    if (id.startsWith("opener:")) {
      if (id !== "opener:allow-open-url" || typeof perm === "string") {
        fail(file, `${id}: only opener:allow-open-url with an explicit http/https/mailto scope is allowed`);
        continue;
      }
      for (const entry of [...(perm.allow ?? []), ...(perm.deny ?? [])]) {
        if (!OPENER_SCOPES.has(entry.url) || entry.app !== undefined) fail(file, `opener scope ${JSON.stringify(entry)}`);
      }
    }
  }
}

// The opener plugin's default build injects a page script that sends any
// <a target=_blank> click, even a scripted one, to the system browser. Only
// the front end's trusted-click handler may open links, so it must be off.
const libRs = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
if (/tauri_plugin_opener::init\s*\(/.test(libRs) || !/\.open_js_links_on_click\(\s*false\s*\)/.test(libRs)) {
  fail("src-tauri/src/lib.rs", "tauri-plugin-opener must be built with .open_js_links_on_click(false)");
}

// ----- 5. dependencies -----

// Direct dependencies, each listed on purpose. Adding one means adding it here.
const NPM_DEPS = new Set([
  "@codemirror/autocomplete",
  "@codemirror/commands",
  "@codemirror/lang-markdown",
  "@codemirror/language",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/markdown",
  "@tauri-apps/api",
  "@tauri-apps/plugin-opener",
  // Lucide icon path data (ISC, no dependencies, no runtime code that loads
  // anything). Only the icons named in src/shell/icons.ts are bundled.
  "lucide",
  // build and test tooling; never shipped
  "@tauri-apps/cli",
  "typescript",
  "vite",
  "vitest",
]);
const CRATES = new Set(["notify", "serde", "serde_json", "tauri", "tauri-plugin-opener", "tauri-build"]);
// Names that mean networking, updating, analytics or crash reporting.
const DENY =
  /(?:^|[/@_-])(?:reqwest|hyper|ureq|isahc|surf|curl|attohttpc|axios|node-fetch|undici|got|superagent|ky|socket\.io|tungstenite|websocket|updater|plugin-http|sentry|bugsnag|posthog|mixpanel|amplitude|segment|analytics|telemetry|datadog|newrelic|crash-?report\w*|opentelemetry)(?:$|[/@_-])/i;

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
  if (!NPM_DEPS.has(name)) fail("package.json", `dependency ${name} is not on the allowlist`);
}
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
for (const path of Object.keys(lock.packages ?? {})) {
  if (path && DENY.test(path.replace(/^.*node_modules\//, ""))) fail("package-lock.json", `${path} looks like a networking/telemetry package`);
}

const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
for (const section of cargo.matchAll(/^\[(?:build-)?dependencies\]\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)) {
  for (const m of section[1].matchAll(/^([\w-]+)\s*=/gm)) {
    if (!CRATES.has(m[1])) fail("src-tauri/Cargo.toml", `crate ${m[1]} is not on the allowlist`);
  }
}

// The crates actually compiled for this machine. Cargo.lock also lists
// crates for other targets (Tauri's mobile dev proxy pulls in reqwest), so
// ask cargo; skipped with a note when cargo is not installed.
let tree = null;
try {
  tree = execFileSync("cargo", ["tree", "--offline", "-e", "normal", "--prefix", "none", "-f", "{p}"], {
    cwd: join(root, "src-tauri"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch {
  console.warn("audit: cargo not available; skipped the compiled-crate check");
}
if (tree) {
  for (const name of new Set(tree.split("\n").map((l) => l.split(" ")[0]).filter(Boolean))) {
    if (DENY.test(name)) fail("cargo tree", `crate ${name} is compiled into the app`);
  }
}

// ----- report -----

if (problems.length) {
  console.error(`Offline audit failed (${problems.length}):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Offline audit passed: ${sources.length} source files, dist/, CSP, capabilities and dependencies checked.`);
