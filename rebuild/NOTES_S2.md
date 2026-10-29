# S2: fetch backlinks on demand

Implemented 2026-10-28 on `rebuild/s2-backlinks-codex`, starting at `f8e6cab`. Implementation commits: `74a2ca2` and `5e8d19a`. Local commits only; nothing pushed. No real vaults, other worktrees, network services, dependencies or crates were used or changed.

## Changes

`link_index` now returns only `outgoing`, `markdown` and `unresolved`. It no longer allocates or serializes the vault-wide backlink rows. `LinkIndex.backlinks` was removed on both sides rather than kept as an optional compatibility field.

New `#[tauri::command(async)] backlinks(paths)` returns linked mentions only for requested resolved target paths. Empty requests return `{}`; targets without mentions are omitted; duplicate requested paths do not duplicate results. Each link occurrence still counts, including several on one source line. Wikilinks, embeds and Markdown links use the existing parsed links and resolver. The implementation is in `index/backlinks.rs`; parsing and index mutation rules are unchanged. Registered the command, generated its permission and added `allow-backlinks` to the existing main/note-window capability. CONTRACT.md documents the new shape, permission, semantics and rename precondition.

The status bar and visible backlink panes share targeted per-note promises through `links/backlinks.ts`. A changed file/link snapshot invalidates the cache without depending on workspace listener registration order. Old rejected requests cannot evict newer entries. Both consumers guard the requested path/generation before applying asynchronous replies; hidden backlink panes do no new reads. Filtering, context, per-line grouping and occurrence counts keep their existing rendering behavior.

The mock uses one existing parser/resolver traversal for both commands. Ordinary link refreshes do not accumulate backlink rows; targeted requests accumulate only the requested rows. The round-22 regression now queries the new API and deliberately filters its pre-rename snapshot to preserve its search-fallback coverage.

## Rename ordering: review this invariant

`relocate` now does the following in order:

1. Flush editors under the path being moved.
2. Retain the old note list and collect **every** moved note's old path (not just the first 20).
3. Await a direct `api.backlinks(oldPaths)` snapshot. This deliberately bypasses the display cache. If the read fails, reject the operation before `renamePath` changes any path.
4. Await `api.renamePath`, then move editor states and follow the move in the workspace.
5. Pass the retained old note list and backlink snapshot through `fileSettings.renamed` into `updateLinks`.

The backend updates its index before `renamePath` returns. After a basename/path rename, links written using the old name may no longer resolve, so a backlink request made afterward can be empty. A later refresh can also replace the frontend's link index. Neither can destroy this independently owned pre-rename snapshot.

`updateLinks` takes source paths from that snapshot. Sources inside a moved folder are mapped forward exactly once before reading their current editor text, including unsaved edits. The existing post-rename search fallback still maps backend source paths back to their old paths before the same rewrite path. Text rewriting, confirmation counts, destination styles, headings, aliases and undo behavior remain in TypeScript.

The existing name-search fallback still examines the first 20 moved notes with a 500-hit limit. The backlink snapshot itself has no such limit. Removing the search caps belongs to plan step 5, not this step.

## Benchmarks (step 0.2 harness)

Generated only `/tmp/grove-s2-codex-bench-5000` with `node scripts/gen-vault.mjs /tmp/grove-s2-codex-bench-5000 5000`. It has 5,000 notes, 5,125 indexed files/folders, 13,600,158 text bytes, and generator sha256 `5b03c1bee51dfe6e284f30d1e2452f9f5bd62c66a5018e8127d8593b0de5d8e7` (the published baseline's same corpus).

Before and after used `GROVE_BENCH_VAULT=/tmp/grove-s2-codex-bench-5000 cargo test --offline [--release] -- --ignored --nocapture bench_vault`, with the current merged Cargo profiles. Figures are three-run medians after the harness's warmup scan, including compact JSON serialization. They exclude Tauri/webview IPC and page JSON parsing.

- `link_index` payload: **2,358,258 → 768,905 bytes**, a **67.4% reduction** (2.36 → 0.77 decimal MB). Outgoing remains 713,602 bytes, Markdown 55,262, unresolved 2. The removed backlink map was 1,589,340 bytes, plus its field overhead.
- Release `link_index`: **8.9 → 6.8 ms**. Before samples: 10.9, 8.9, 7.9; final after samples: 8.0, 6.8, 6.0.
- Debug `link_index`: **83.5 → 40.0 ms**. Before samples: 83.5, 85.3, 82.5; after: 40.2, 40.0, 39.9.
- New `backlinks` for one linked target (the first resolved outgoing destination): **524 bytes**, **3.1 ms release / 18.6 ms debug**. This is additional work when that target is displayed, not included in the link-refresh figure. Status and pane share it for the same target/snapshot.
- Explicitly requesting all 5,000 notes: **1,589,340 bytes**, **10.9 ms release / 69.7 ms debug**. That full payload is sent only when explicitly requested, not with each link refresh.

An initial after-change release run under contention measured 13.3 ms for link refresh (11.4, 13.3, 13.3); the repeat above measured 6.8 ms. Treat CPU comparisons as approximate, not an interactive latency guarantee. The byte reduction is deterministic.

Also ran `node scripts/bench-frontend.mjs 5000` before and after (synthetic 5,000 plus seven sample notes, not the disk corpus). Link-refresh JSON fell **2,248,218 → 639,772 bytes**. Mock refresh medians were **9,002.7 → 12,919.3 ms**, with samples 13,936.2/9,002.7/7,762.9 before and 18,822.5/12,919.3/8,914.4 after. These runs overlapped other compilation activity; no mock CPU speedup is claimed. As the baseline documents, the mock's existing resolver rebuilds the note lookup for each link and dominates this measurement. This step changes payload allocation, not that resolver. Updated the frontend harness to stop reading the removed backlink field, and the Rust harness now measures the separate targeted command.

## Tests and checks

- `npm run build`: passed on final source.
- `npm run audit:offline`: passed on final source (165 production source files, dist, CSP, capabilities and dependencies).
- `cargo build --offline`: passed.
- `cargo test --offline`: **43 passed**, one ignored benchmark; binary/doc-test targets passed. The ignored benchmark was separately executed in release and debug.
- `flock /tmp/grove-npm-test.lock npm test`: **440 Vitest/parity tests across 58 files** and four browser-discovery tests passed. All constituent browser scripts and `posttest` eventually passed, with the two timing-only reruns below. This was not a single uninterrupted zero-exit npm invocation: after each timing stop, resumed the package's exact command sequence at the failed script under the same shared lock, reran that script once, then continued to the end. Coverage was 21 commands before canvas edges, 21 from canvas edges to before Bases, and the final 12 from Bases onward, plus `posttest`.
- Required rename scripts passed: `test-explorer-drag.mjs`, `test-r22-bugs.mjs`, `test-r27f.mjs`, `test-bases.mjs`. Backlink panes, occurrence rendering and the final status-bar backlink count passed. Permanent geometry/real-pointer/menu-latency tests passed.
- `test-canvas-edges.mjs` initially failed its 300-card/400-edge frame ceiling at **33.4 ms**. Its single rerun passed create and reconnect at **16.8 ms**.
- `test-bases.mjs` initially failed its 1,000-row scroll frame ceiling at **133.3 ms**. Its single rerun passed at **16.8 ms** (warm open 13.9 ms). Both reruns used unchanged source, fixtures and thresholds; no assertion was weakened.
- `git diff --check` passed. Generated screenshot, canvas/Base and timing outputs were restored; temporary test-runner/log files were removed.

Eight new Vitest cases cover waiting for the pre-rename snapshot (all 25 folder targets), aborting on its failure, rewriting with fresh backlinks/search empty, moved sources and live editor text, declining confirmation, shared/invalidation-safe display reads, and the mock's split payload/relocation behavior. The new Rust test covers targeted/empty/duplicate/missing requests, duplicate wiki/Markdown occurrences, code exclusion and source/destination relocation. Existing Rust backlink assertions now exercise the targeted method; serialization explicitly checks that `link_index` has no backlink field.

## Files / line counts

Implementation diff versus `f8e6cab`: **387 added / 68 removed across 26 files**, excluding this notes file.

- `CONTRACT.md`: +4 / -3.
- `app/src-tauri/build.rs`: +1 / -0.
- `app/src-tauri/capabilities/default.json`: +1 / -0.
- `app/src-tauri/permissions/autogenerated/backlinks.toml`: +11 / -0.
- `app/src-tauri/src/index.rs`: +2 / -8.
- `app/src-tauri/src/index/backlinks.rs`: +72 / -0.
- `app/src-tauri/src/index/bench.rs`: +27 / -3.
- `app/src-tauri/src/index/tests.rs`: +9 / -7.
- `app/src-tauri/src/lib.rs`: +11 / -1.
- `app/src-tauri/src/model.rs`: +1 / -3.
- `app/src/api.ts`: +2 / -2.
- `app/src/fileOps.ts`: +8 / -4.
- `app/src/fileOps.test.ts`: +33 / -2.
- `app/src/graph/graph.test.ts`: +1 / -1.
- `app/src/links/backlinks.ts`: +25 / -0.
- `app/src/links/backlinks.test.ts`: +37 / -0.
- `app/src/links/update.ts`: +6 / -5.
- `app/src/links/update.test.ts`: +43 / -0.
- `app/src/main.ts`: +11 / -5.
- `app/src/mock/backend.ts`: +6 / -5.
- `app/src/mock/backend.test.ts`: +29 / -0.
- `app/src/readOrdering.test.ts`: +2 / -2.
- `app/src/shell/backlinksView.ts`: +25 / -5.
- `app/src/vault.ts`: +1 / -1.
- `app/scripts/bench-frontend.mjs`: +0 / -3.
- `app/scripts/test-r22-bugs.mjs`: +19 / -8.

## Remaining / decisions

No required implementation work or product decision remains for S2. There is no native interactive IPC latency measurement; the benchmark measures backend work/serialization and the browser tests use the mock. Targeted backlink queries still traverse indexed links, so many different visible target panes add query work; sharing avoids duplicate reads for the common status/pane pair. No persistent reverse index or optional outgoing-diff protocol was introduced. Release link refresh is below the plan's 10 ms target on this corpus. The existing fallback-search limits and expensive mock resolver remain separate follow-up work.
