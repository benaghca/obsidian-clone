# C1-B — frontend search command switch

Branch `rebuild/c1b-search-codex`, starting at `bcb430d`. Implementation commit `673674b` is the single revertible C1-B switch. Decisions applied: flush pending saves before backend search; keep `{path,count}` objects and document about 60 B per matching note; retain the reference's matching/counting quirks and the reviewed file/path no-lines correction. No pushes, dependencies, external network, app windows, or real vaults.

## Changes

- Added the three API calls and switched the mock to the shared `searchVault` reference. Its per-file parsed lines/tags/properties cache survives unchanged saved text; writes, renames and deletes are reflected in later reads. The existing mock tags command also uses the any-case note suffix, matching Rust. Mock attachments have names without content facts, bodies over 8 MB are omitted, `.MD` counts as a note, and returned paths follow Rust's Unicode/UTF-8 path ordering.
- Search flushes pending saves and allows only one `search_notes` request in flight. New input replaces queued input; clearing cancels queued work; both request versions and the view's sequence guard drop stale replies. Exclusions, known-file filtering, locale sorting and stable ties remain in TS. Counts and total come directly from the backend.
- `pagedRows` can prepare each batch asynchronously before drawing it; it ignores removed/cancelled batches and prevents overlapping page loads. Search asks for five lines per drawn note, draws missing line results as file rows, and reads full context only for drawn rows that ask for it.
- Copy starts fetching all matching rows when the menu opens. The item stays disabled until its text is ready and writes synchronously in the item-click gesture. A small menu refresh handle updates the disabled state without rebuilding/reopening the menu.
- Graph backend queries are deduplicated and batched in one `search_match` call, after flushing saves. Null queries are never sent and match everything; file/path-only queries stay synchronous. Query answers are retained across display/tag-option changes and forgotten after vault changes (or pending document edits before a later flush). Tags for drawing come from `vaultTags`.
- Fixed the Q1-documented null-child parser edge (`file:(-tag:#)` and nested variants): a negated term removed by field scoping now returns null, matching Rust, so malformed queries cannot throw in the UI. Existing corpus expectations are unchanged; a focused TS regression test covers it.
- Removed `searchFacts.ts` and the unused `matchingNotes` helper/fake-facts test setup. Kept TS parsing/highlights/reference matching and the old Rust `search` for unlinked mentions. Added contract entries and the corrected shown-line rule; left B1's frontend benchmark script unchanged for its follow-up.
- Added ordering/coalescing/flush/cancellation/sort/exclusion/cache tests, mock command/mutation/line-ending coverage, and a native-input browser case for graph text filter + text colour group, graph cache reuse, `.MD` results, omitted lines, lazy context, copy readiness/user gesture, and path-only rows.

## Integration

Fast-forwarded with `git merge --no-edit rebuild/integration` to `2f82a1f` while preserving C1-B work separately. Kept integrated Step 5 API/mock/contract entries and reused the `.MD` cleanup's shared `graphFileLists` helper. No integration merge conflicts. A second `git merge --no-edit rebuild/integration` immediately before final checks reported already up to date. Final checks are recorded below.

## Checks

Final locked build and offline audit passed (166 source files; audit rebuilt the final source); Cargo build/test passed (58 tests, 2 ignored benchmarks); all 674 Vitest tests in 58 files and four browser-discovery tests passed. Full `flock /tmp/grove-npm-test.lock npm test` passed with exit 0, including all 53 main browser-script stages (the new ten-check search/graph case included) and the Bases configuration posttest. No test failures or retries were needed. All heavy commands and benchmarks ran under `/tmp/grove-npm-test.lock`; lock contention accounted for the long waits. Initial focused checks before integration: build passed; 358 tests passed across three focused files. Combined pre-final checks also passed the full 673-test unit suite and the new browser case before the final parser regression test brought the total to 674. Generated screenshots are restored before each commit; prompt files, logs and scratch benchmark harness stay uncommitted.

## Measurements

Headless Node/Vite mock baseline from the unchanged B1 frontend benchmark, synthetic=5,000 plus sample files (5,017 files, 5,007 notes): old `searchFacts` + matching/sort for `garden`, 1,900 notes, samples 12.5/7.3/6.2 ms, median 7.3 ms. This baseline did not include exact full-note counting or a separate page-line read. Link refresh is unrelated to this switch (baseline median 7,976.8 ms in the JS mock).

After one warmup and three measured runs:

- New mock command path for the same `garden`: notes/counts + JSON serialization/parse + exclusion/sort + 50 line rows, samples 11.865/19.055/15.930 ms, median 15.930 ms; 1,900 notes, 2,950 exact occurrences, 91,971 B note/count payload and 4,162 B line payload. This performs full counting and page-line retrieval absent from the old 7.3 ms baseline, so it is not a direct scan-speed comparison or a Rust timing.
- Actual 5k gen-vault path/count object payload, page work only (JSON.parse + actual `searchResults` exclusion/sort + sum): 6.528/6.540/6.435 ms, median 6.528 ms; 292,520 B, 5,000 notes, exact total 131,948. Meets §7's ≤15 ms page-work target in Node. These measurements exclude DOM paint, IPC and WebKitGTK. Rust command figures remain available in `RUST_BENCH.md` / `NOTES_B1.md`; the production Rust evaluator is unchanged by this frontend commit.

## Files, decisions and remaining work

Implementation relative to integrated `2f82a1f`: 17 files, +492/−283; this notes file is separate.

- `rebuild/CONTRACT.md`: +3/−0.
- `rebuild/app/package.json`: +1/−1.
- `rebuild/app/scripts/test-search-commands.mjs`: +84/−0.
- `rebuild/app/src/api.ts`: +13/−0.
- `rebuild/app/src/graph/source.ts`: +57/−45.
- `rebuild/app/src/graph/view.ts`: +3/−1.
- `rebuild/app/src/mock/backend.test.ts`: +26/−0.
- `rebuild/app/src/mock/backend.ts`: +46/−2.
- `rebuild/app/src/readOrdering.test.ts`: +72/−20.
- `rebuild/app/src/shell/menu.ts`: +11/−0.
- `rebuild/app/src/shell/searchFacts.ts`: +0/−96.
- `rebuild/app/src/shell/searchQuery.test.ts`: +9/−29.
- `rebuild/app/src/shell/searchQuery.ts`: +7/−8.
- `rebuild/app/src/shell/searchRead.ts`: +42/−0.
- `rebuild/app/src/shell/searchVault.ts`: +41/−22.
- `rebuild/app/src/shell/searchView.ts`: +58/−50.
- `rebuild/app/src/shell/sideView.ts`: +19/−9.

Final check results are recorded above. No new Obsidian behavior was inferred: committed app/reference code, the plan and review were the sources. B1 owns updating `scripts/bench-frontend.mjs` after this switch. No GUI end-to-end latency claim is made.

The browser suite regenerated only the expected round screenshot fixtures; they were restored with `git checkout -- rebuild/round*-shots` before committing. Scratch harness removed; logs and prompt files remain uncommitted. No further C1-B implementation work is left open; F1/R1 review and B1 benchmark-script follow-up remain separate tasks.
