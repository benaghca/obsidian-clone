#!/usr/bin/env node
// Times the page-side TypeScript that grows with the vault, on a real
// gen-vault.mjs folder: the work behind one quick-switcher keystroke, one
// link resolve, the file tree's sort, a graph tick, a Bases re-evaluation,
// a rename's link rewrite, and JSON.parse of the replies the page gets.
// Not part of npm test (RUST_PERF_PLAN.md).
//
//   node scripts/gen-vault.mjs /tmp/grove-bench-50000 50000
//   node scripts/bench-feel.mjs /tmp/grove-bench-50000
//
// Each figure is the median of five runs (three for the slow ones), in ms.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/bench-feel.mjs <vault dir>");
  process.exit(1);
}

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});
const load = (name) => server.ssrLoadModule(fileURLToPath(new URL(`../src/${name}`, import.meta.url)));

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function time(fn, runs = 5) {
  const samples = [];
  let out;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    out = fn();
    samples.push(performance.now() - t);
  }
  return { ms: Number(median(samples).toFixed(2)), max: Number(Math.max(...samples).toFixed(2)), out };
}

try {
  const { noteName, isNoteFile, compareFiles, compareNames } = await load("paths.ts");
  const { resolveLink, linkTargets, rewriteLinks } = await load("links/internal.ts");
  const { switcherItems } = await load("shell/switcherItems.ts");
  const { wikilinkTargets, tagsInText } = await load("shell/linksTags.ts");
  const { buildGraph, graphFileLists } = await load("graph/data.ts");
  const { Simulation } = await load("graph/sim.ts");
  const { baseModel } = await load("bases/model.ts");
  const { splitFrontmatter, readProperties } = await load("editor/frontmatter.ts");

  // The vault as list_files would send it, and every note's text.
  const files = [];
  const text = new Map();
  const walk = (rel) => {
    for (const name of readdirSync(join(dir, rel))) {
      const path = rel ? `${rel}/${name}` : name;
      const st = statSync(join(dir, path));
      files.push({ path, name, is_dir: st.isDirectory(), mtime_ms: st.mtimeMs, ctime_ms: st.ctimeMs, size: st.isDirectory() ? 0 : st.size });
      if (st.isDirectory()) walk(path);
      else if (isNoteFile(path)) text.set(path, readFileSync(join(dir, path), "utf8"));
    }
  };
  walk("");
  const notes = files.filter((f) => !f.is_dir && isNoteFile(f.path)).map((f) => ({ name: noteName(f.path), path: f.path }));
  const r = {};
  r.notes = notes.length;

  // Replies the page parses (sizes from the same shapes Rust sends).
  const listJson = JSON.stringify(files);
  r.list_files_bytes = listJson.length;
  r.list_files_parse = time(() => JSON.parse(listJson)).ms;
  r.notes_derive = time(() => files.filter((f) => !f.is_dir && isNoteFile(f.path)).map((f) => ({ name: noteName(f.path), path: f.path }))).ms;

  // Link resolution the page does itself (ws.resolve, embeds, backlinks view).
  const someName = notes[notes.length >> 1].name;
  r.resolve_one = time(() => resolveLink(someName, notes[0].path, notes)).ms;
  r.resolve_missing = time(() => resolveLink("no such note", notes[0].path, notes) ?? resolveLink("no such note", notes[0].path, files.filter((f) => !f.is_dir))).ms;
  r.link_targets_build = time(() => linkTargets(files, notes)).ms;

  // The outgoing index the page receives from link_index (resolved here with one map, like Rust).
  const byName = new Map(notes.map((n) => [n.name.toLowerCase(), n.path]));
  const outgoing = {};
  for (const [path, body] of text) {
    const out = [...new Set(wikilinkTargets(body).map((t) => byName.get(t.toLowerCase())).filter(Boolean))];
    if (out.length) outgoing[path] = out;
  }
  const linksJson = JSON.stringify({ outgoing, markdown: {}, unresolved: {} });
  r.link_index_bytes = linksJson.length;
  r.link_index_parse = time(() => JSON.parse(linksJson)).ms;

  // Search view: an all-notes reply from search_notes, parsed, then filtered and sorted.
  // The same steps as searchRead.ts searchResults, which can't load here (it imports api.ts).
  const searchResults = (files, found, excluded, sort) => {
    const entries = new Map(files.filter((f) => !f.is_dir).map((f) => [f.path, f]));
    return found.filter((n) => entries.has(n.path) && !excluded(n.path)).map((n) => ({ ...entries.get(n.path), count: n.count })).sort(compareFiles(sort));
  };
  const searchJson = JSON.stringify(notes.map((n) => ({ path: n.path, count: 26 })));
  r.search_reply_bytes = searchJson.length;
  r.search_page = time(() => searchResults(files, JSON.parse(searchJson), () => false, "alphabetical"), 3).ms;

  // Quick switcher: one keystroke = the candidate list + fuzzy rank of every name.
  const switcherList = () => {
    const seen = new Set(notes.map((n) => n.path));
    const rest = files.filter((f) => !f.is_dir && !seen.has(f.path)).map((f) => ({ name: noteName(f.path), path: f.path }));
    return [...notes, ...rest];
  };
  for (const q of ["r", "ri", "riv", "river s"]) r[`switcher_${q.replace(" ", "_")}`] = time(() => switcherItems(q, switcherList(), [], null)).ms;

  // File tree: the sort buildTree does before any DOM (sidebar.ts buildTree).
  r.tree_sort = time(() => {
    const sorted = [...files].sort((a, b) => a.path.split("/").length - b.path.split("/").length);
    const inOrder = compareFiles("alphabetical");
    return sorted.sort((a, b) => (a.is_dir !== b.is_dir ? Number(b.is_dir) - Number(a.is_dir) : a.is_dir ? compareNames(a.name, b.name) : inOrder(a, b)));
  }, 3).ms;

  // Graph: building the model, then one simulation tick at full heat (the page does one per frame).
  const lists = graphFileLists(files, () => false);
  const g = time(() => buildGraph({ notes: lists.notes, attachments: lists.attachments, links: { outgoing } }, { showTags: false, showAttachments: false, hideUnresolved: true, showOrphans: true }), 3);
  r.graph_build = g.ms;
  r.graph_nodes = g.out.nodes.length;
  r.graph_links = g.out.links.length;
  const sim = new Simulation();
  sim.setGraph(g.out.nodes.map((n) => n.id), g.out.links, () => undefined);
  const ticks = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    sim.tick();
    ticks.push(performance.now() - t);
  }
  r.graph_tick = Number(median(ticks.slice(5)).toFixed(2));
  r.graph_tick_max = Number(Math.max(...ticks).toFixed(2));

  // Bases: one re-evaluation of a tag-filtered table sorted by name (view.ts row build + model.select).
  const tagsOf = new Map([...text].map(([path, body]) => [path, tagsInText(body)]));
  const propsOf = new Map([...text].map(([path, body]) => {
    const fm = splitFrontmatter(body.split("\n", 60));
    return [path, fm ? readProperties(fm.lines) ?? [] : []];
  }));
  const model = baseModel('filters:\n  and:\n    - file.hasTag("meeting")\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - tags\n    sort:\n      - property: file.name\n        direction: DESC\n');
  const rowFiles = files.filter((f) => !f.is_dir && isNoteFile(f.path));
  const b = time(() => model.select(rowFiles.map((file) => ({ file, props: propsOf.get(file.path), tags: tagsOf.get(file.path), hasLink: () => false }))), 3);
  r.bases_reeval = b.ms;
  r.bases_rows = b.out.length;

  // Rename: rewriting the links in every note that links to one note, then a sample of a folder move.
  const target = notes[7];
  const sources = [...text].filter(([, body]) => body.includes(`[[${target.name}`)).map(([path]) => path);
  const after = notes.map((n) => (n.path === target.path ? { name: "renamed", path: "renamed.md" } : n));
  const style = { format: "shortest", wikilinks: true };
  r.rename_sources = sources.length;
  r.rename_one_note = time(() => sources.forEach((s) => rewriteLinks(text.get(s), s, target.path, "renamed.md", notes, after, style)), 3).ms;
  const folder = notes[0].path.split("/").slice(0, 2).join("/");
  const moved = notes.filter((n) => n.path.startsWith(`${folder}/`));
  const movedNames = new Set(moved.map((n) => n.name.toLowerCase()));
  const folderSources = [...text].filter(([, body]) => wikilinkTargets(body).some((t) => movedNames.has(t.toLowerCase()))).map(([path]) => path);
  const sample = folderSources.slice(0, 3);
  const perSourceAllPairs = time(() => sample.forEach((s) => moved.forEach((p) => rewriteLinks(text.get(s), s, p.path, `X/${p.path}`, notes, notes, style))), 1).ms / sample.length;
  r.folder_move = folder;
  r.folder_move_notes = moved.length;
  r.folder_move_sources = folderSources.length;
  r.folder_move_ms_per_source = Number(perSourceAllPairs.toFixed(1));
  r.folder_move_estimate_s = Number(((perSourceAllPairs * folderSources.length) / 1000).toFixed(1));

  console.log(JSON.stringify(r));
} finally {
  await server.close();
}
