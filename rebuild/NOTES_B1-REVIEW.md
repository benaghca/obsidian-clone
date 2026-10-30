VERDICT: OK

Reviewed `rebuild/b1-bench-gemini` at `093f6a0` (bench `48b19f3`, notes `093f6a0`) against `rebuild/c1a-search-codex` `4d02300`. This review branch is `rebuild/b1-review-grok`. Gemini's branch was not moved. Nothing was pushed.

One small wording fix is on this branch (`ce3f4ff`): `rebuild/RUST_BENCH.md` now says the D2 payload caps are missed and that D5 is not entirely inside 3–5×. No change to `search.rs`, commands, TypeScript, or `scripts/bench-frontend.mjs`.

## Scope

`4d02300..093f6a0`: 3 files, +182 / −0.

- `rebuild/app/src-tauri/src/index/bench.rs` +77
- `rebuild/RUST_BENCH.md` +37
- `rebuild/NOTES_B1.md` +68

`gen-vault.mjs` is unchanged. No `Cargo.toml`, lockfile, or package change.

## What the bench covers

`bench_vault` still times the old `search` line, then the §7 set. Each `search_notes` line prints `ms`, `median`, `json_bytes`, `notes`, and `total` (the sum of `count`). Serialization is compact `serde_json` and is inside the timer. Three runs. The queries are `meeting`, `alpha`, `zzz`, `garden river`, `"garden path"`, `meeting -garden (river OR stone)`, `tag:project`, `[tags:meeting]`, `line:(garden river)`, and `Meeting` with match case.

`search_lines` uses the first 50 paths from `search_notes("meeting")`, limit 5, and prints time, payload, note count, and line count. `search_match` uses `["meeting", "tag:project/alpha", "path:\"Folder 01\""]` and prints time, payload, and the three path counts.

`alpha`'s total is 3,233. That is the sum of occurrence counts. §7's 3,180 is a matching-line figure from the plan's earlier scratch measurement. `[tags:meeting]` is 3,000 notes and total 0, which is the saved property-line quirk C1-A kept. `Meeting` with match case is 0 notes: the generator's prose is lowercase `meeting`. Those are the command's results, not bench bugs.

`scripts/bench-frontend.mjs` is still the old `searchFacts` path. §8 schedules that half after C1-B, and this review was told not to edit it. Leaving it open is right.

## Rerun

`/tmp/grove-bench-5000` is the published vault: 5,000 notes, 13,600,158 bytes, sha256 `5b03c1bee51dfe6e284f30d1e2452f9f5bd62c66a5018e8127d8593b0de5d8e7`. It was not regenerated.

Release and debug `bench_vault` ran under `flock /tmp/grove-npm-test.lock` with `cargo test --offline`. Every `json_bytes`, note count, total, and path count matches `RUST_BENCH.md` exactly, including the old `search` line (`20,500` hits, `3,009,644` bytes).

Release medians here, against the published medians: `meeting` 19.4 (19.8), `alpha` 8.7 (9.6), `zzz` 13.2 (15.9), `garden river` 25.7 (27.2), `"garden path"` 22.8 (24.2), the negated query 12.1 (13.0), `tag:project` 8.8 (9.5), `[tags:meeting]` 1.7 (1.9), `line:(garden river)` 29.7 (28.8), `Meeting` 9.8 (9.8), `search_lines` 0.07 (0.08), `search_match` 11.6 (12.7). The old `search` median was 26.3, the same figure the "before" column uses. Debug medians were within about 2% (`meeting` 85.8 vs 84.3, `line:(garden river)` 177.0 vs 176.5, `search_lines` 1.07 vs 1.05). That is shared-machine noise. The published table stays.

`search_lines` samples are printed to 0.1 ms and the median to 0.01 ms, so `0.2,0.1,0.1` with median 0.08 is the rounded sample list, not a bad median.

## Targets

Release `search_notes` is under 30 ms on every query (slowest published median 28.8 ms, rerun 29.7 ms). `search_lines` is 0.08 ms and 26,385 B (≤ 5 ms / ≤ 40 KB). `search_match` is 12.7 ms and 213,470 B (≤ 50 ms / ≤ 0.6 MB). `meeting` reports 131,948, not the old 20,500-line cap.

D2's payload caps are missed, and the original assessment did not say so. It reported 0.29 MB and 58.5 B/note as slightly above the ~45 B/note estimate, and it did not mention the ≤ 100 KB guide for about 2,000 notes. `meeting` is 292,520 B, over 0.25 MB. `alpha` is 136,624 B for 2,376 notes, over 100 KB. `ce3f4ff` says both caps are missed and leaves the wire shape alone. `NOTES_B1.md` still has the softer sentence. The bench doc is the one later steps will read.

D5 is not a pass at 3×, and not entirely inside 3–5×. The table already had `line:(garden river)` at 6.1× and `search_lines` at 13.1×. The D5 sentence mentioned the 6.1× line and not the 13.1× line. The 13× ratio is a pair of ~1 ms measurements. Release is the target. No profile change. The same commit states that.

## Checks

Under the lock, from `rebuild/app/src-tauri`, `--offline`:

- `cargo build`: passed (dev profile).
- `cargo test`: 52 passed, 0 failed, 2 ignored (`bench_vault` and `bench_search_commands`). Binary and doc-tests ran 0 tests.
- Release `bench_vault`: passed.
- Debug `bench_vault`: passed.

No npm run. This review did not change the app. Screenshot fixtures were not touched.
