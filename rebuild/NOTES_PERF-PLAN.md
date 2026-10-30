# NOTES_PERF-PLAN: a performance plan for big vaults (Claude)

Branch `rebuild/perf-plan-claude`. The branch had no commits of its own and sat at `5218c20`, behind integration, so it was fast-forwarded to `rebuild/integration` `4fddf48` before the plan was written. Plan only: no app code changed.

## What changed

| File | Lines | What |
|---|---|---|
| `rebuild/RUST_PERF_PLAN.md` | new, ~330 | The plan: §1 budgets for felt smoothness, §2 how it was measured, §3 the measured inventory at 5k/20k/50k, §4 each item (Rust or not, gain, cost, risks), §5 Obsidian targets (labelled estimates), §6 risks, §7 the ranked build list P0–P8 alongside Bases waves 1–3, §8 success criteria, §9 decisions |
| `rebuild/BASES_PLAN.md` | +6 / −7 | D5 recorded as Chris decided it: the B7 Rust pre-filter is a real task after B5. B7's row, wave 3, §3 "Later", §5 and the opening bullets now say the same |
| `rebuild/app/scripts/bench-feel.mjs` | new, ~170 | Node bench of the page-side TypeScript on a `gen-vault.mjs` folder (resolve, rename, folder move, switcher, tree sort, graph build/tick, Bases re-evaluation, search page work, `JSON.parse` of replies) |
| `rebuild/app/scripts/bench-feel-browser.mjs` | new, ~120 | Headless Chromium on `?synthetic=n`: Event Timing over 16 ms, long tasks, rAF gaps for typing, the quick switcher, folder expand and the graph; note switch time. After load it answers `linkIndex`/`backlinks` from the built index (with `JSON.parse`), because the mock's own link index is O(N²) |

Neither script is in `npm test`. P0 in the plan turns the browser one into a permanent budget test.

## Decisions I made

- **Framed around Chris's 10:51 PM addition:** budgets for felt moments, with worst cases, frame drops and long tasks rather than averages. The build list is ranked by how often a user would hit a hitch times how bad it is.
- **Not everything goes to Rust.** The biggest hitch, the rename and folder-move hang, is a TypeScript O(N)-per-lookup bug: `resolveLink` builds a map per call. The fix is a cached resolver in TS. The graph needs a Worker, and the file tree needs virtualising. The plan says why Rust wouldn't help in each case.
- **No persistent index cache** (§4.3): the index needs the text anyway.
- **Folder-move times are estimates:** the measured cost per linking note on 3 of them, times the number of linking notes. Running the full move at 50k would take hours.
- **Obsidian numbers are estimates.** There was no network, so nothing was fetched or cited. §5 says so and proposes measuring Obsidian on the `/tmp` vaults by observation.

## Measurements (machine as in RUST_BENCH.md: Ryzen 9 7900X, Linux)

- Vaults `/tmp/grove-bench-{5000,20000,50000}` from `gen-vault.mjs` (sha256 `5b03c1be…`, `1e7c07c8…`, `d5723282…`).
- Rust: `bench_vault` release on each vault, plus a temporary ignored test for `upsert_note`/`rebuild_maps`/`list_files` per save, **reverted before commit**. Peak memory is `VmHWM` polled from `/proc`.
- `bench-feel.mjs` was run twice on each vault. Most figures agree within about 10%, and a few vary up to ~30% (at 50k: `resolveLink` 15.0 then 10.5 ms, Bases 163 then 150 ms). The plan shows the first run, except the search page row, which was added for the second.
- `bench-feel-browser.mjs` was run at 5k and 20k under the shared test lock.

The figures are in RUST_PERF_PLAN.md §3.

## Tests

All passed on the first run, under `flock /tmp/grove-npm-test.lock` where they use the lock:

- `npm run build`: passed.
- `npm test`: passed in full (vitest 58 files / 679 tests, every browser, geometry and mouse script, then `posttest`).
- `npm run audit:offline`: passed (166 source files).
- `cargo build`: passed.
- `cargo test`: 58 passed, 2 ignored (the benches).

The temporary `bench.rs` test was reverted (`git status` was clean for it) before `cargo build` and `cargo test` ran. The npm checks don't build Rust.

## Left open, for Chris

- The §9 decisions: E1–E5 (E6, the Bases D5 change, is done here).
- WebKitGTK wasn't measured (no app windows). P0's in-app hitch meter is how to check it.
- Codex is the bottleneck in waves 2–3 (B5/B7 and P2/P3). It needs a second session, or P3 moves to Claude after P6.
