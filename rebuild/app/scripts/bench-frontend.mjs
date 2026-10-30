#!/usr/bin/env node
// Times the page's tag read, one search-view query (plus JSON.parse and
// exclusion/sort of a 5,000-entry [{ path, count }] payload) and one link
// refresh against the browser mock's synthetic vault (mock/sampleVault.ts,
// `?synthetic=n`, default 5000). The mock is the same one `npm run dev`
// loads.
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
  const { searchResults } = await load("shell/searchRead.ts");
  const { parseQuery } = await load("shell/searchQuery.ts");

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
  const notesJson = JSON.stringify(
    vault.notes.slice(-n).map((note, i) => ({ path: note.path, count: (i % 40) + 1 })),
  );
  const notesJsonBytes = Buffer.byteLength(notesJson);

  const tagMs = [];
  let tagNotes = 0;
  let tagUses = 0;
  const searchMs = [];
  let searchMatches = 0;
  let searchTotal = 0;
  let searchNotesBytes = 0;
  let searchLinesBytes = 0;
  const parseMs = [];
  const page5kMs = [];
  let page5kNotes = 0;
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

    started = performance.now();
    const rawNotes = await api.searchNotes("garden", false);
    const found = searchResults(vault.files, rawNotes, (path) => vault.isExcluded(path), "alphabetical");
    const lines = await api.searchLines("garden", false, found.slice(0, 50).map((note) => note.path), 5);
    searchMs.push(performance.now() - started);
    searchMatches = found.length;
    searchTotal = found.reduce((sum, note) => sum + note.count, 0);
    searchNotesBytes = Buffer.byteLength(JSON.stringify(rawNotes));
    searchLinesBytes = Buffer.byteLength(JSON.stringify(lines));

    started = performance.now();
    const parsedNotes = JSON.parse(notesJson);
    const parsedAt = performance.now();
    const sorted5k = searchResults(vault.files, parsedNotes, (path) => vault.isExcluded(path), "alphabetical");
    const sortedAt = performance.now();
    parseMs.push(parsedAt - started);
    page5kMs.push(sortedAt - started);
    page5kNotes = sorted5k.length;

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
    search_total: searchTotal,
    search_notes_json_bytes: searchNotesBytes,
    search_lines_json_bytes: searchLinesBytes,
    search_parse_5k_ms: list(parseMs),
    search_parse_5k_median_ms: Number(median(parseMs).toFixed(1)),
    search_page_5k_ms: list(page5kMs),
    search_page_5k_median_ms: Number(median(page5kMs).toFixed(1)),
    search_parse_5k_bytes: notesJsonBytes,
    search_page_5k_notes: page5kNotes,
    link_refresh_ms: list(linkMs),
    link_refresh_median_ms: Number(median(linkMs).toFixed(1)),
    link_json_bytes: linkBytes,
    outgoing_notes: outgoingNotes,
  }));
} finally {
  await server.close();
}
