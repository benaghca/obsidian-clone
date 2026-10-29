#!/usr/bin/env node
// Compare page work on the actual Rust bench JSON bodies (no browser or IPC).
// Run bench_vault with GROVE_BENCH_JSON_DIR=/tmp/grove-s3-codex-bench-json first.
// Then: node scripts/bench-properties.mjs /tmp/grove-s3-codex-bench-json
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const dir = resolve(process.argv[2] ?? '/tmp/grove-s3-codex-bench-json');
const frontmatter = readFileSync(join(dir, 'frontmatter.json'), 'utf8');
const properties = readFileSync(join(dir, 'properties.json'), 'utf8');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const { splitFrontmatter, readProperties } = await server.ssrLoadModule('/src/editor/frontmatter.ts');
  const read = (blocks) => Object.fromEntries(Object.entries(blocks).flatMap(([path, text]) => {
    const split = splitFrontmatter(text), props = split && readProperties(split.lines);
    return props ? [[path, { props, lines: split.lines }]] : [];
  }));
  const blocks = JSON.parse(frontmatter), expected = read(blocks);
  // Includes all line/count metadata and CRLF-normalized lines, not just corpus projection.
  assert.deepEqual(JSON.parse(properties), expected, 'Rust typed data matches TS for every generated note');
  const measure = fn => {
    fn(); // warmup
    const ms = Array.from({ length: 3 }, () => { const at = performance.now(); fn(); return performance.now() - at; });
    return { runs_ms: ms.map(n => Number(n.toFixed(3))), median_ms: Number([...ms].sort((a,b) => a-b)[1].toFixed(3)) };
  };
  console.log(JSON.stringify({
    notes: Object.keys(expected).length,
    before_json_bytes: Buffer.byteLength(frontmatter), after_json_bytes: Buffer.byteLength(properties),
    before_json_parse: measure(() => JSON.parse(frontmatter)),
    before_read_properties: measure(() => read(blocks)),
    before_page_total: measure(() => new Map(Object.entries(read(JSON.parse(frontmatter))))),
    after_json_parse: measure(() => JSON.parse(properties)),
    after_page_total: measure(() => new Map(Object.entries(JSON.parse(properties)))),
  }));
} finally { await server.close(); }
