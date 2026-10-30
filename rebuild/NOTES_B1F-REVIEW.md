VERDICT: OK

Reviewed `rebuild/b1f-bench-gemini` at `abe96d0` (bench `5543f21`, notes `abe96d0`) against `rebuild/c1b-search-codex` `3cd98aa`. This review branch is `rebuild/b1f-review-grok`. Gemini's branch was not moved. Nothing was pushed.

One wording fix is on this branch (`42b0638`): the step 0.2 section of `rebuild/RUST_BENCH.md` spoke in the present tense, as if `node scripts/bench-frontend.mjs 5000` still loaded `searchFacts` and `matchingNotes` and did not time `JSON.parse`. It now says that was the step 0.2 run, and that the Step 4 section is what the script measures now. The baseline table and its numbers are unchanged. No change to Rust, the search commands, app TypeScript, or `scripts/bench-frontend.mjs`.

## Scope

`3cd98aa..abe96d0`: 3 files, +113 / −11.

- `rebuild/NOTES_B1F.md` +57
- `rebuild/RUST_BENCH.md` +16 / −1
- `rebuild/app/scripts/bench-frontend.mjs` +40 / −10

`NOTES_B1F.md` says the bench commit is 2 files, +56 / −11, and splits that as the script +39 / −11 and `RUST_BENCH.md` +17 / −1. The two-file total matches `5543f21` (56 insertions, 11 deletions). The per-file split is off by one line (`+40 / −10` and `+16 / −1`). Left as Gemini wrote it.

`gen-vault.mjs`, the search implementation, the commands, and the other TypeScript and Rust files are unchanged. `searchFacts` and `matchingNotes` are gone from `rebuild/app`. The bench does not call them.

## What the bench measures

From `rebuild/app`, three runs on the dev-page mock (`?synthetic=5000` plus the sample vault: 5,017 files, 5,007 notes). Each search sample is `api.searchNotes("garden", false)`, then `searchResults` (known file, exclusion, `compareFiles("alphabetical")`), then `api.searchLines("garden", false, first 50 of those paths, 5)`. Page work is a separate timer: `JSON.parse` of a 5,000-entry `[{ path, count }]` string built from the last 5,000 vault notes, then the same `searchResults`. The median is the middle of the three samples. `parseQuery("garden")` only checks that the term parses; it is outside the timers.

The live view draws the first page as 12 rows and then the remaining 38 (`PAGE` 50, `AT_ONCE` 12), so it issues two `searchLines` calls. §7 and this bench ask for the first 50 paths in one call, limit 5. Same paths and the same limit. The bench also skips `searchReader`, so it does not flush pending editor saves. The harness has no editors. §7's page-work target is `JSON.parse` plus exclusion and sort, which is what `search_page_5k_ms` times. The reduce that sums counts sits after that timer. `NOTES_C1B.md`'s 6.5 ms figure includes that sum on the gen-vault payload.

The script comment says caches are dropped between runs. `vaultTags().forget()` runs each time. The mock `searchVault` line cache does not. `NOTES_B1F.md` and `RUST_BENCH.md` already say the first `garden` sample is cold and the reported median is the warm middle sample.

## Rerun

`flock /tmp/grove-npm-test.lock node scripts/bench-frontend.mjs 5000` on this machine, 2026-10-29:

```json
{"synthetic":5000,"files":5017,"notes":5007,"setup_ms":80.9,"vault_tags_ms":"17.8,10.5,8.8","vault_tags_median_ms":10.5,"notes_with_tags":5007,"tag_uses":10996,"search_term":"garden","search_ms":"32.1,11.8,12.5","search_median_ms":12.5,"search_matches":1900,"search_total":2950,"search_notes_json_bytes":91971,"search_lines_json_bytes":4162,"search_parse_5k_ms":"0.6,1.3,0.4","search_parse_5k_median_ms":0.6,"search_page_5k_ms":"5.6,5.5,4.3","search_page_5k_median_ms":5.5,"search_parse_5k_bytes":248894,"search_page_5k_notes":5000,"link_refresh_ms":"8466.3,7817.6,7658.5","link_refresh_median_ms":7817.6,"link_json_bytes":639766,"outgoing_notes":3946}
```

Counts and sizes match `RUST_BENCH.md` exactly: 1,900 notes, total 2,950, 91,971 B notes, 4,162 B lines, 248,894 B parsed, 5,000 page notes, 10,996 tag uses, 639,766 B links, 3,946 outgoing notes.

Timings are shared-machine noise. Tags median 10.5 ms against 10.9. Search median 12.5 ms against 13.4 (cold first sample 32.1 ms against 22.7; the published median is the warm middle sample, which the notes disclose). Parse median 0.6 ms against 0.4, with one 1.3 ms sample. Page work 5.5 ms against 4.5. Link refresh 7,817.6 ms against 7,789.3. The Step 4 table rounds the published link runs 8,399.4 / 7,789.3 / 7,625.3 ms to 8.4 / 7.8 / 7.6 s. The published numbers stay. The rerun page median sits inside the doc's 4.5–6.5 ms band.

## Targets

Page work (`JSON.parse` + exclusion + sort, 5,000 results) ≤ 15 ms: met. Published synthetic median 4.5 ms. This rerun 5.5 ms. `NOTES_C1B.md` cites 6.528 / 6.540 / 6.435 ms (median 6.528, written as 6.5) for the real 292,520 B `meeting` payload, including the count sum. All three are under 15 ms, and under half of 15 ms. This review did not regenerate `/tmp/grove-bench-5000` or re-derive that 6.5 ms figure.

D2's time consequence is fine. D2's byte caps are missed, and `RUST_BENCH.md` already says **Missed**. An all-match answer is 292,520 B (0.29 MB), about 42 KB over the 0.25 MB cap, at 58.5 B/note. `alpha` is 136,624 B, over the 100 KB guide for about 2,000 notes. The synthetic bench string is 49.8 B/note (248,894 / 5,000). The `garden` notes payload is 48.4 B/note (91,971 / 1,900). That is the ~60 B/note `{ path, count }` shape C1-B kept, above the plan's ~45 B/note estimate. `NOTES_B1F.md` says the extra ~42 KB costs less than 0.1 ms of `JSON.parse`. Parse of the whole string is 0.4–0.6 ms, so the extra bytes are on that order. They do not threaten the 15 ms target. The byte cap is still missed. This bench does not change the wire shape.

The mock `garden` path is slower than the old 5.7 ms (`searchFacts` + `matchingNotes`) because it counts 2,950 occurrences across 1,900 notes and fetches 50 line groups inside the JS mock. In the app those commands run in Rust off the main thread. The notes draw that distinction honestly.

## Checks

From `rebuild/app` on this review branch:

- `npm run build`: passed. The existing large-chunk notice remains.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0 on the first run. Vitest 58 files, 674 tests. Browser discovery, the browser scripts (including `test-search-commands.mjs`), and `posttest` passed. 300-card drag max 16.8 ms (49 intervals). 1000-row scroll max 16.8 ms. Configure view max 16.8 ms. No retry.

Cargo and `npm run audit:offline` were not re-run. The task named the build and `npm test`, and said not to touch Rust. `NOTES_B1F.md` records Gemini's earlier `cargo test --offline` (58 passed, 0 failed, 2 ignored) and offline audit (166 source files). This review did not change Rust or app TypeScript.

Screenshot fixtures were restored with `git checkout -- rebuild/round*-shots` before the commits. Prompt files were not committed.
