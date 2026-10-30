# C1-A — Rust search evaluator and commands

2026-10-29. Branch `rebuild/c1a-search-codex`, base `aa6b958` (Q1/K1 and prior integration). Implementation commit `e9044b9`. Part A only; no TypeScript or contract change, push, rebase, dependency addition, network access, GUI window, or real-vault access.

## Changes and decisions

- Added `index/search.rs`: matching, per-term lines, same-line groups, shown lines, highlights and exact occurrence counts. `search_notes` returns all matching any-case `.md` notes in the index's BTreeMap path order. `search_lines` independently re-evaluates requested paths, omits nonmatching/missing/folder/attachment/empty-line results, and limits shown lines per note. `search_match` returns one path list per query, including attachments and excluding directories.
- Added all three async Tauri wrappers with the existing state-lock pattern, result models, build command entries, capability entries, and generated allow/deny permission files. G0's command-list test passes. The old `search` remains available for unlinked mentions.
- Queries with no parse tree return empty results, including queries beyond Q1's 64-level limit. There is no query-error result. Empty graph queries produce an empty list for that element, as specified; the frontend will handle the all-files meaning without sending those queries.
- Reused indexed `Line.lower`, `Line.text`, tags and properties. Properties already retain `line`, so Step 3 needed no change. Saved text only. The existing 8 MB indexing ceiling remains effective: huge notes have name/path matching but no content/tags/properties.
- Prepared terms/highlights once per query; cached each note's term-line hits and same-line group hits. A line-slot vector unions shown hits in ascending line order, with later leaves overriding earlier text, matching TS's Map behavior. This avoids per-hit BTreeMap allocation and computing line groups twice.
- Split query words with `is_js_space` and folded with Rust `to_lowercase`, per K1 review. Match case still applies the lowercase word prefilter before checking the case-sensitive whole phrase (including the final-sigma quirk). Tags and property keys stay case insensitive.
- Preserved app behavior: `file:`/`path:` terms show no lines; mixed queries show only their text/property/line-group hits. The initial reference incorrectly returned every content line for the empty term; the review fix below corrects TS, Rust, and eight fixture expectations. Pure name matches can count zero; negated leaves do not supply shown lines/highlights; `line:(-a)` has no candidate lines; property lists show the property's key line, so `[tags:meeting]` can match with count zero.
- Highlight occurrences advance by the complete word length, then overlapping spans count once and adjacent spans separately. Internal byte offsets are sufficient for counting because UTF-8/UTF-16 mappings preserve span order and overlap; no offsets leave Rust. Highlights retain TS's descending UTF-16 length order. Reuse the indexed lowercase line unless a normalized property line replaced its text.
- Search parity now builds each named fixture vault with `Index::from_notes` and calls the command core; attachments use the same evaluator with Match case support. Existing runners receive the file-level corpus as an extra parameter. Validation still diagnoses invalid vault names/types and Match case flags. Updated only the search fixture's Rust descriptor and README implementation entry.

## Verification

- `cargo build --offline`: passed.
- `cargo test --offline`: 52 passed, 0 failed, 2 ignored (general vault benchmark and new search-command benchmark); main/doc tests have no cases. The four added tests cover updates, folder/file renames, deletion, uppercase `.MD`, byte-path order, requested-path filtering/deduplication/limits, graph attachments/empty queries, huge notes without reading their body, 65-level nesting, 100,000 opening parentheses, overlap/adjacency/Unicode counting, BOM/CRLF and property-line text.
- Rust corpus: all 334 cases pass (44 links, 73 tags, 87 properties, 48 query, 82 search). Query/search have no `rust: todo` markers; no expected values changed.
- `npm run build`: passed (existing large-chunk advisory only).
- `npm run audit:offline`: passed, 166 source files plus dist/CSP/capabilities/dependencies checked.
- Full `flock /tmp/grove-npm-test.lock npm test`, including posttest: passed, exit 0 on the first run after waiting for the shared lock. Four browser-discovery tests, 58 Vitest files / 665 tests, all 52 main browser-script stages, and `posttest` (`test-bases-config.mjs`) passed. No flake retries were needed.
- Both ignored search benchmark runs passed, including the exact `meeting` total assertion. `git diff --check` passed. Screenshots are restored before each commit. Prompt files and logs stay uncommitted.

## Measurements

Real index plus serde JSON serialization; excludes IPC, browser JSON.parse, frontend sorting/exclusions, and cold filesystem scan. One full-command warmup followed by three measured samples, median below. Release and default debug profiles; no profile changes. Other builders share this machine, so these are measured medians rather than latency guarantees.

Existing `/tmp/grove-bench-5000`: 5,000 notes, 13,600,158 content bytes, verified in generator order with SHA-256 `5b03c1bee51dfe6e284f30d1e2452f9f5bd62c66a5018e8127d8593b0de5d8e7`. No regeneration or real vault was needed.

Reproduce from `rebuild/app/src-tauri`:

```sh
cargo test --offline --release bench_search_commands -- --ignored --nocapture
cargo test --offline bench_search_commands -- --ignored --nocapture
```

The dedicated ignored test lives in `search.rs`; B1's `bench.rs`, frontend bench and `RUST_BENCH.md` are untouched. Every requested §7 query and all three commands follow. `total` is highlight occurrences, not matching-line count; e.g. alpha's 3,233 occurrences need not equal the plan's 3,180 matching lines.

Release, milliseconds and exact compact JSON bytes:

```text
profile=release vault=/tmp/grove-bench-5000 bytes=13600158
search_notes query="meeting" ms=[19.894, 17.854, 18.658] median=18.658 bytes=292520 notes=5000 total=131948
search_notes query="alpha" ms=[9.654, 8.741, 8.582] median=8.741 bytes=136624 notes=2376 total=3233
search_notes query="zzz" ms=[15.472, 14.884, 15.038] median=15.038 bytes=2 notes=0 total=0
search_notes query="garden river" ms=[26.521, 27.243, 27.310] median=27.243 bytes=292525 notes=5000 total=268814
search_notes query="\"garden path\"" ms=[24.906, 24.737, 24.457] median=24.737 bytes=292500 notes=5000 total=128948
search_notes query="meeting -garden (river OR stone)" ms=[13.602, 13.132, 13.076] median=13.132 bytes=2 notes=0 total=0
search_notes query="tag:project" ms=[9.585, 9.730, 9.507] median=9.585 bytes=275396 notes=4789 total=5067
search_notes query="[tags:meeting]" ms=[1.983, 1.692, 1.485] median=1.692 bytes=172519 notes=3000 total=0
search_notes query="line:(garden river)" ms=[29.151, 28.855, 28.682] median=28.855 bytes=292525 notes=5000 total=257896
search_notes query="Meeting" ms=[10.019, 9.697, 9.508] median=9.697 bytes=2 notes=0 total=0
search_lines query="meeting; first 50; limit 5" ms=[0.071, 0.065, 0.066] median=0.066 bytes=26385 notes=50 lines=250
search_match query="[\"meeting\", \"tag:project/alpha\", \"path:\\\"Folder 01\\\"\"]" ms=[12.486, 11.965, 12.378] median=12.378 bytes=213470 paths=[5000, 346, 200]
```

Debug, milliseconds (counts/payloads are identical):

```text
profile=debug vault=/tmp/grove-bench-5000 bytes=13600158
search_notes query="meeting" ms=[84.197, 83.333, 81.795] median=83.333 bytes=292520 notes=5000 total=131948
search_notes query="alpha" ms=[43.886, 43.476, 43.410] median=43.476 bytes=136624 notes=2376 total=3233
search_notes query="zzz" ms=[34.812, 34.357, 35.958] median=34.812 bytes=2 notes=0 total=0
search_notes query="garden river" ms=[149.520, 147.965, 145.931] median=147.965 bytes=292525 notes=5000 total=268814
search_notes query="\"garden path\"" ms=[120.717, 124.465, 123.881] median=123.881 bytes=292500 notes=5000 total=128948
search_notes query="meeting -garden (river OR stone)" ms=[69.025, 68.363, 68.241] median=68.363 bytes=2 notes=0 total=0
search_notes query="tag:project" ms=[46.388, 45.470, 44.916] median=45.470 bytes=275396 notes=4789 total=5067
search_notes query="[tags:meeting]" ms=[9.122, 8.807, 8.584] median=8.807 bytes=172519 notes=3000 total=0
search_notes query="line:(garden river)" ms=[175.602, 176.499, 176.521] median=176.499 bytes=292525 notes=5000 total=257896
search_notes query="Meeting" ms=[49.771, 49.391, 49.325] median=49.391 bytes=2 notes=0 total=0
search_lines query="meeting; first 50; limit 5" ms=[1.023, 1.008, 1.014] median=1.014 bytes=26385 notes=50 lines=250
search_match query="[\"meeting\", \"tag:project/alpha\", \"path:\\\"Folder 01\\\"\"]" ms=[50.493, 49.502, 48.613] median=49.502 bytes=213470 paths=[5000, 346, 200]
```

Debug/release median ratios in the query order above: 4.47×, 4.97×, 2.31×, 5.43×, 5.01×, 5.21×, 4.74×, 5.21×, 6.12×, 5.09×. `search_lines`: 15.36×; `search_match`: 4.00×. Some exceed D5's 3–5×, particularly line groups (6.12×); the line-page ratio is high but the absolute debug time is only 1.014 ms. No dev optimization policy was changed.

### Target assessment

- Release `search_notes` timing: all ten medians ≤30 ms; the slowest is `line:(garden river)` at 28.855 ms. `meeting` is 18.658 ms and its count is exactly 131,948, rather than the old 20,500-line cap.
- `search_lines`, first 50 matching paths, limit 5: 0.066 ms, 26,385 bytes, 250 lines. Meets ≤5 ms / ≤40 KB.
- `search_match`, `["meeting", "tag:project/alpha", "path:\"Folder 01\""]`: 12.378 ms, 213,470 bytes, path counts [5,000, 346, 200]. Meets ≤50 ms / ≤0.6 MB.
- **Payload target missed with the specified wire shape.** All-note `meeting` is 292,520 bytes (58.5 B/note), above ≤0.25 MB; `alpha` is 136,624 bytes for 2,376 notes. Independent compact-JSON calculation for the first 2,000 matching notes gives 117,000 bytes for meeting and 115,031 for alpha, above the approximate ≤100 KB expectation. Bare paths alone are 192,525 bytes. A `{path,count:0}` object costs at least 19 additional bytes over each bare string, so even zero counts would require 287,525 bytes. The plan's 217,520-byte estimate cannot represent the required array of `{path,count}` objects for this vault. Keep the specified API/path strings; recommend revising D2 to about 60 B/note (120 KB/2k, 300 KB/5k). A smaller wire shape would be a separate API decision for C1-B/B1.
- Published prior-plan backend baseline: 17–36 ms and up to about 3 MB per term, plus frontend matching/counting work. Measured unchanged old `search("meeting", 20500)` with the existing `bench_vault` harness: release samples 25.9/28.1/26.4 ms, median 26.4 ms; debug 116.0/117.7/118.0 ms, median 117.7 ms; 20,500 hits, 3,009,644 bytes in both. New `search_notes` is 18.658 ms release / 83.333 ms debug and 292,520 bytes with the complete count. Returning those notes plus the first 50 rows totals 318,905 bytes (about 9.4× smaller than the old single-term payload); frontend costs remain outside this comparison.
- Frontend keystroke/JSON.parse/sorting target and end-to-end GUI latency are not measured in this Part A task. C1-B/B1 own the switch-over/frontend measurement.

## Files and line totals

Implementation/reference metadata relative to `aa6b958`: 13 files, +912/−15 (includes the 108-line ignored timing harness in search.rs). No changes to parser, tag/link/property implementations, TS, forbidden shared files, or B1-owned benchmark files.

- `rebuild/app/fixtures/parity/README.md`: +1/−1.
- `rebuild/app/fixtures/parity/search.json`: +1/−1.
- `rebuild/app/src-tauri/build.rs`: +3/−0.
- `rebuild/app/src-tauri/capabilities/default.json`: +3/−0.
- `rebuild/app/src-tauri/permissions/autogenerated/search_lines.toml`: +11/−0.
- `rebuild/app/src-tauri/permissions/autogenerated/search_match.toml`: +11/−0.
- `rebuild/app/src-tauri/permissions/autogenerated/search_notes.toml`: +11/−0.
- `rebuild/app/src-tauri/src/index.rs`: +1/−0.
- `rebuild/app/src-tauri/src/index/parity.rs`: +70/−12.
- `rebuild/app/src-tauri/src/index/search.rs`: +615/−0.
- `rebuild/app/src-tauri/src/index/tests.rs`: +135/−0.
- `rebuild/app/src-tauri/src/lib.rs`: +37/−1.
- `rebuild/app/src-tauri/src/model.rs`: +13/−0.

This notes file adds 111 lines. Combined change: 14 files, +1,023/−15.

## Left for later tasks

F1 differential fuzz/shadow checks, B1's canonical benchmark integration, C1-B's frontend/API/mock/contract switch-over, and R1 review remain outstanding by design. The new commands are registered but unused by the current production frontend. F1 should use the same core and add real mismatches to the corpus before C1-B proceeds. Debug ratios and the payload-budget correction above remain review items. No Obsidian behavior was newly inferred or sourced: Grove's committed TS reference and shared corpus were the specification, with no Obsidian code/assets or external documentation used.

## C1-A review fix — file/path terms show no lines

Fast-forwarded to Claude's review `80a9a40` and applied its section 1 fix. The implementation/measurement totals above describe the original C1-A commits; this section records the subsequent correction.

- The local TS reference now returns `undefined` for an empty line term, matching the app's `searchFacts` behavior. Rust file/path leaves retain no text term and are skipped when collecting shown lines. A query such as `path:"Projects" alpha` shows only alpha's line; a pure file/path query shows none.
- Regenerated all 82 cases through the patched `searchVault` using local Vite SSR. Exactly the eight reviewed expectations changed: `file:`, `file: against a dated name`, `path:`, `path and a word`, `Search in folder`, `file:md matches every note`, `path:/ matches every file`, and `file:md includes Upper.MD`. Verified that matching paths and counts, other case fields, corpus metadata, and all other expectations are unchanged.
- Corrected the earlier “Preserved TS quirks” statement above. The original all-lines behavior was a reference-versus-app mismatch, not an app quirk. No payload/API shape change; `{path,count}` objects remain. C1-B remains a later task.
- Changes relative to review commit: `searchVault.ts` +2/−0, `search.rs` +6/−9, `search.json` +15/−81, and this notes file +12/−1; four files, +35/−91.
- Checks, each under `/tmp/grove-npm-test.lock`: `npm run build`, `npm run audit:offline`, `cargo build --offline`, `cargo test --offline` (52 passed, 2 ignored), and full `npm test` including posttest passed. Vitest: 58 files / 665 tests; browser discovery: 4 passed. No failures or retries. Benchmarks were not rerun for this shown-line correction. No new dependencies, network, GUI windows, or real vaults were used.
- Generated screenshots were restored with `git checkout -- rebuild/round*-shots`; logs and prompt files are excluded from the single fix commit. No further review fix is left open; later-task items above remain.
