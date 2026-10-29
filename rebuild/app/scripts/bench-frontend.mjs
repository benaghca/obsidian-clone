#!/usr/bin/env node
// Times the page's tag read, one search-view query and one link refresh
// against the browser mock's synthetic vault (mock/sampleVault.ts,
// `?synthetic=n`, default 5000). The mock is the same one `npm run dev`
// loads. There is no IPC and no JSON.parse: the figures are the work the
// page does once the objects are in hand, plus how large those objects are
// when stringified.
//
//   node scripts/bench-frontend.mjs [n]
//
// Three measured runs. The median is the middle one. Caches are dropped
// between runs. The sample vault is included, as it is on the dev page.

import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const n = Number(process.argv[2] ?? 5000);
if (!Number.isInteger(n) || n < 1 || n > 20000) {
  console.error("usage: node scripts/bench-frontend.mjs [n]");
  process.exit(1);
}

const memory = () => {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
};

const location = { search: `?synthetic=${n}`, href: "", pathname: "/" };
globalThis.location = location;
globalThis.sessionStorage = memory();
globalThis.localStorage = memory();
globalThis.window = {
  location,
  sessionStorage: globalThis.sessionStorage,
  localStorage: globalThis.localStorage,
  setTimeout,
  clearTimeout,
  addEventListener() {},
  removeEventListener() {},
};

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: appRoot,
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
  // Node has no browser globals. Rewrite the free names the mock and api use.
  define: {
    window: "globalThis.window",
    location: "globalThis.location",
    sessionStorage: "globalThis.sessionStorage",
    localStorage: "globalThis.localStorage",
  },
});

const median = (samples) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
const list = (samples) => samples.map((ms) => ms.toFixed(1)).join(",");

try {
  const load = (name) => server.ssrLoadModule(fileURLToPath(new URL(`../src/${name}`, import.meta.url)));
  const { api } = await load("api.ts");
  const { Vault } = await load("vault.ts");
  const { vaultTags } = await load("shell/vaultTags.ts");
  const { searchFacts } = await load("shell/searchFacts.ts");
  const { parseQuery, matchingNotes } = await load("shell/searchQuery.ts");

  const setupStarted = performance.now();
  const vault = new Vault(() => {}, async () => {});
  await vault.refreshFiles();
  const setupMs = performance.now() - setupStarted;
  const ws = {
    vault,
    on(fn) {
      return () => void fn;
    },
  };
  const query = parseQuery("garden");
  if (!query) throw new Error("garden did not parse");

  const tagMs = [];
  let tagNotes = 0;
  let tagUses = 0;
  const searchMs = [];
  let searchMatches = 0;
  const linkMs = [];
  let linkBytes = 0;
  let outgoingNotes = 0;

  for (let run = 0; run < 3; run++) {
    vaultTags(ws).forget();
    let started = performance.now();
    const tags = await vaultTags(ws).read();
    tagMs.push(performance.now() - started);
    tagNotes = tags.size;
    tagUses = [...tags.values()].reduce((sum, list) => sum + list.length, 0);

    searchFacts(ws).forget();
    started = performance.now();
    const facts = await searchFacts(ws).facts([query], false, false);
    const found = matchingNotes(vault.notes, query, facts, () => false);
    searchMs.push(performance.now() - started);
    searchMatches = found.length;

    started = performance.now();
    await vault.refreshLinks();
    linkMs.push(performance.now() - started);
    linkBytes = Buffer.byteLength(JSON.stringify(vault.links));
    outgoingNotes = Object.keys(vault.links.outgoing).length;
  }

  console.log(JSON.stringify({
    synthetic: n,
    files: vault.files.length,
    notes: vault.notes.length,
    setup_ms: Number(setupMs.toFixed(1)),
    vault_tags_ms: list(tagMs),
    vault_tags_median_ms: Number(median(tagMs).toFixed(1)),
    notes_with_tags: tagNotes,
    tag_uses: tagUses,
    search_term: "garden",
    search_ms: list(searchMs),
    search_median_ms: Number(median(searchMs).toFixed(1)),
    search_matches: searchMatches,
    link_refresh_ms: list(linkMs),
    link_refresh_median_ms: Number(median(linkMs).toFixed(1)),
    link_json_bytes: linkBytes,
    outgoing_notes: outgoingNotes,
  }));
} finally {
  await server.close();
}
