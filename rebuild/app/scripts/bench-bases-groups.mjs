// Generated-vault B5 benchmark; only accepts a scratch vault under /tmp.
// node scripts/bench-bases-groups.mjs /tmp/grove-bases-b5-.../vault
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { Text } from '@codemirror/state';
import { withBrowser, sleep } from './browser.mjs';
const vault = resolve(process.argv[2] ?? '');
assert.ok(vault.startsWith('/tmp/grove-bases-b5-'), 'pass the B5 gen-vault scratch directory');
const beforePath = new URL('../src/bases/.b5-model-before.ts', import.meta.url);
await writeFile(beforePath, execFileSync('git', ['show', '08641e4:rebuild/app/src/bases/model.ts']));
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const metadata = [];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  const { baseModel } = await server.ssrLoadModule('/src/bases/model.ts');
  const { baseModel: beforeModel } = await server.ssrLoadModule('/src/bases/.b5-model-before.ts');
  const { readFrontmatter } = await server.ssrLoadModule('/src/editor/frontmatter.ts');
  const { tagsInText } = await server.ssrLoadModule('/src/shell/linksTags.ts');
  const { groupRowsAsync } = await server.ssrLoadModule('/src/bases/groups.ts');
  const { summarizeAsync } = await server.ssrLoadModule('/src/bases/summaries.ts');
  const paths = execFileSync('rg', ['--files', '-g', '*.md', vault], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim().split('\n').sort();
  for (let at = 0; at < paths.length; at += 64) {
    const batch = await Promise.all(paths.slice(at, at + 64).map(async path => {
      const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]), name = relative(vault, path);
      return { file: { path: name, name: name.split('/').at(-1), is_dir: false, size: info.size, mtime_ms: info.mtimeMs, ctime_ms: info.ctimeMs }, props: readFrontmatter(Text.of(text.split('\n')))?.props ?? [], tags: tagsInText(text) };
    }));
    metadata.push(...batch);
  }
  assert.equal(metadata.length, 50000);
  console.log('GENERATED_ROWS', metadata.length);
  const rows = metadata.map(row => ({ ...row, hasLink: () => false }));
  for (const count of [5000, 50000]) {
    const data = rows.slice(0, count), cases = {
      tag_sort: 'filters: \'file.hasTag("meeting")\'\nviews:\n  - sort:\n      - property: file.name\n',
      formula_sort: 'formulas:\n  score: \'file.size % 7 + 2\'\nviews:\n  - sort:\n      - property: formula.score\n        direction: DESC\n      - property: file.name\n',
    };
    for (const [name, source] of Object.entries(cases)) {
      const models = [beforeModel(source), baseModel(source)], times = [[], []];
      for (let run = 0; run < 8; run++) for (const version of run % 2 ? [1, 0] : [0, 1]) {
        const start = performance.now(), result = models[version].select(data);
        if (run) times[version].push(performance.now() - start);
        assert.ok(result.length);
      }
      console.log('SELECT', JSON.stringify({ count, name, beforeMedianMs: median(times[0]), afterMedianMs: median(times[1]), samples: times }));
    }
    const source = 'summaries:\n  mean: \'sum / count\'\nviews:\n  - groupBy:\n      property: file.folder\n    summaries:\n      file.size: custom.mean\n      file.tags: Unique\n      file.mtime: Earliest\n      file.name: Count\n';
    const model = baseModel(source), selected = model.select(data), samples = [];
    for (let run = 0; run < 4; run++) {
      const slices = [], start = performance.now(), options = { onSlice: ms => slices.push(ms) };
      const groups = await groupRowsAsync(selected, model.groupBy, options), result = await summarizeAsync(selected, groups, model.summaryPlan, options);
      assert.equal(result.all.get('file.name'), count);
      if (!run) console.log('FIRST_AGGREGATION', JSON.stringify({ count, wallMs: performance.now() - start, cpuMs: slices.reduce((a,b) => a+b,0), maxSliceMs: Math.max(...slices) }));
      if (run) samples.push({ wallMs: performance.now() - start, cpuMs: slices.reduce((a,b) => a+b,0), maxSliceMs: Math.max(...slices), groups: groups.length });
    }
    console.log('AGGREGATION', JSON.stringify({ count, samples }));
  }
} finally { await server.close(); await unlink(beforePath); }

for (const variant of ['folders', 'distinct']) await withBrowser(async ({ run }) => {
  // Transfer real generated metadata, not the 136 MB of note bodies. Setup and
  // the pre-existing synchronous select are timed separately from B5 work.
  await run(async (data, variant) => {
    const { baseModel } = await import('/src/bases/model.ts');
    const { createGroupedView } = await import('/src/bases/groups.ts');
    const { createCardGrid } = await import('/src/bases/cards.ts');
    const source = variant === 'distinct' ? 'views:\n  - groupBy:\n      property: file.path\n    order: [file.name, file.size]\n    summaries:\n      file.size: Count\n' : 'summaries:\n  mean: \'sum / count\'\nviews:\n  - groupBy:\n      property: file.folder\n    order: [file.name, file.size, file.tags, file.mtime]\n    summaries:\n      file.size: custom.mean\n      file.tags: Unique\n      file.mtime: Earliest\n      file.name: Count\n';
    const model = baseModel(source), start = performance.now();
    const selected = model.select(data.map(row => ({ ...row, hasLink: () => false })));
    window.b5SelectMs = performance.now() - start;
    const el = document.createElement('div'); el.className = 'bases-view'; Object.assign(el.style, { position: 'fixed', right: '0', top: '100px', width: '650px', height: '600px', background: 'var(--background-primary)' });
    const scroller = document.createElement('div'); scroller.className = 'bases-scroll';
    const table = document.createElement('table'); table.className = 'bases-table'; const body = table.createTBody(); scroller.append(table); el.append(scroller); document.body.append(el);
    window.b5Slices = []; window.b5Ticks = 0;
    const view = createGroupedView({ el, scroller, table, body, ws, group: ws.activeGroup, header: () => {}, createCards: createCardGrid, repaint: () => view.paint(model, selected, true), onSlice: ms => b5Slices.push(ms), cell: (key, entry) => { const td = document.createElement('td'); td.textContent = String(entry.context.get(key) ?? ''); return td; } });
    window.b5Stress = { el, view, scroller, model, selected };
  }, metadata, variant);
  await sleep(200);
  await run(() => {
    window.b5StressFrames = []; let previous = performance.now();
    window.b5StressFrame = requestAnimationFrame(function tick(t) { b5StressFrames.push(t - previous); previous = t; b5StressFrame = requestAnimationFrame(tick); });
    window.b5Tick = setInterval(() => b5Ticks++, 5);
    const started = performance.now();
    window.b5Work = b5Stress.view.update(b5Stress.model, b5Stress.selected, new Map()).then(() => { b5Stress.view.paint(b5Stress.model, b5Stress.selected, true); return performance.now() - started; });
  });
  const result = await run(async () => {
    const wallMs = await b5Work;
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    cancelAnimationFrame(b5StressFrame); clearInterval(b5Tick);
    const value = { count: b5Stress.selected.length, selectMs: b5SelectMs, wallMs, cpuMs: b5Slices.reduce((a,b) => a+b,0), maxSliceMs: Math.max(...b5Slices), ticks: b5Ticks, maxFrameMs: Math.max(...b5StressFrames.slice(1)), domRows: b5Stress.el.querySelectorAll('tbody tr[data-path]').length };
    b5Stress.view.dispose(); b5Stress.el.remove(); return value;
  });
  console.log('BROWSER_50K', JSON.stringify({ variant, ...result }));
  assert.ok(result.ticks > 0, 'large computation yields to UI tasks');
  assert.ok(result.maxSliceMs < 20, 'aggregation slice stays below 20ms');
  assert.ok(result.maxFrameMs < 20, 'aggregation does not miss the frame budget');
  assert.ok(result.domRows < 100, 'grouped table is virtualized');
});
