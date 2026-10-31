# SEARCH-PROPS-EDGE-TESTS-REVIEW

Branch `rebuild/search-props-edge-review-grok` from `ef2d10e` (`rebuild/search-props-edge-tests-grok`, itself from `b5cffcb`). Nothing was pushed. No Obsidian docs, code, or assets were used. The checks follow Grove's own search, property, and path rules (`search.rs`, `query.rs`, `paths.ts`, `workspace.ts`, `frontmatter.ts`, and the parity fixtures the source notes already cite).

## Verdict

The Rust, vitest, and browser tests cover the cases in `NOTES_SEARCH-PROPS-EDGE-TESTS.md`. Two assertions that could pass while the parser never ran were tightened. The two low-severity product bugs are real and stay unfixed. The 50 ms ceiling is unchanged. Product code under `src/` is untouched.

VERDICT: OK

## What the review changed

| Commit | File | Lines |
|---|---|---|
| `26372e6` | `rebuild/app/src-tauri/src/index/search_props_edge.rs` | +8 / −1 |
| `26372e6` | `rebuild/app/scripts/test-search-props-edge.mjs` | +10 / −2 |
| `f22e696` | `rebuild/app/package.json` `test` | +1 / −1 |
| `74ac8cd` | merge of integration `93dbb79` | Bases edge notes, `edge.test.ts`, `test-bases-edge.mjs` |
| `a542313` | merge of integration `87d58f2` | Links and embeds edge notes and scripts |

`search_props_edge.rs` is 306 lines. The browser script is 188 lines. `src/searchPropsEdge.test.ts` is 123 lines and was left as it landed. The only line under `src-tauri/src` outside the test module is `#[cfg(test)] mod search_props_edge;` in `index.rs`, from `38dabe9`.

`test` now ends with `node scripts/test-search-commands.mjs && node scripts/test-search-props-edge.mjs && node scripts/test-links-embeds-edge.mjs && node scripts/test-links-embeds-edge-browser.mjs`. `posttest` still ends with `node --experimental-strip-types scripts/fuzz-property-edit.mjs && node scripts/test-bases-edge.mjs`.

Both merges conflicted only in `rebuild/app/package.json`. The first kept this branch's `test` line and integration's `posttest` line (`test-bases-edge.mjs`). The second kept `test-search-props-edge.mjs` immediately after `test-search-commands.mjs`, then the two links scripts in the order their notes specify. Every script from both sides runs once.

## Checks on the submitted tests

`38dabe9` adds the tests. `ef2d10e` is the source notes. There is no new crate or npm package. The 10k test uses a median of three samples and `CEILING_MS` of `50.0`. The scan and the warmup sit outside that timer. The ceiling was not raised.

One Rust check was empty in a way the notes did not show. `search_notes` returns an empty vec when `parse_query` returns `None` and also when nothing matches, and the corpus had no note whose body contained `or` or `()`. A query of `or` against a note that says `or or () operator` finds that note, while `OR` and `()` do not. `26372e6` adds `Operator.md` with that body. `or` and `operator` must find it. `""`, whitespace, `OR`, `OR OR`, `()`, and `""` must have `parse_query` return `None`, an empty `search_notes` result, and an empty `search_lines` result.

The browser whitespace and lone `"` checks used to run against a result list that was already empty, so a handler that never ran still passed. They now search `only-in-real` until `Real` is on screen, then require an empty count label and zero `.search-result` rows.

`Dup.md` still uses `sleep(150)` and then a one-shot check of zero property rows. The property widget is built with the editor during `open()`, and the `Props.md` check polls until the key list is `empty,items,nested,due,count,rank`. The later sleeps (200, 100, 150, 100 ms) sit after an awaited `open`, `setMode`, or `openLink`. The missing-heading and missing-block caret updates happen inside `open()`. Those sleeps match the older scripts and were left in place.

The ignored test documents a real bug. `cargo test --offline legacy_name_search_must_not_list_a_file_named_dot_md -- --ignored --nocapture` fails with `a file named .md must not appear in search, got [".MD", ".md", "dir/.md"]`. It stays ignored. The browser `EXPECTED FAIL` logs the real `openLink(".md")` move and fails the run if that file is listed as a note. Every browser run printed the same line, moving the active path from `Edge/Target.MD` to `.MD`.

The vitest file was already sound. `searchVault` returns `null` for `""`, whitespace, `OR`, `OR OR`, `()`, and `""`. `file:.md` keeps `Real.md` in the note rows and records `.md`, `.MD`, and `dir/.md` as attachment hits `{}`.

## Break attempts

A throwaway headless probe, deleted before this commit, walked the same paths past the cases the tests name.

- `searchNotes("file:.md")` includes the notes whose basename contains `.md` and excludes `.md`, `.MD`, and `dir/.md`.
- `openLink(".md")` sets the active path to `.MD`. `openLink("dir/.md")` sets it to `dir/.md`. In both cases `vault.notes` still omits those paths. Rust `resolve` of `.md` and `.MD` is `None`. `resolve` of `dir/.md` and `dir/.MD` is `Some("dir/.md")`. A source that contains `[[dir/.md]]`, `[[.md]]`, and `[[.MD]]` records outgoing `dir/.md` and leaves `.md` unresolved. That slash form is the same `open()` gap as bug 2: `Workspace.resolve` finds the file after the note list misses, and `open` loads it in the markdown editor.
- The Vite mock's `search` skips a non-note whose name ends in `.md`. A headless `api.search("md")` returned content lines `Welcome.md` and `Edge/Bom.md`. The name hit is the Rust `Index::search` result. The Tauri `search` command in `lib.rs` calls `v.index.search`.
- A 20,000-character `n` query typed into the search box finds `Long`. The browser script uses 4,000 characters, which the box also accepts.
- After a rename to `Folder/New.md`, `path:Old` still matches because the folded path `folder` contains `old`. The test probes `path:Old.MD`, which is empty after the rename. That matches the source notes.
- `[count:42]` and `[count:"42"]` both hit a quoted number stored as text.
- A leading BOM still parses in `splitFrontmatter` (trim). The property widget stays empty because `readFrontmatter` requires line 1 to start with `---`, and the BOM makes that false. `[status:bomdraft]` still finds the note. The parity README already records this editor-versus-index split.

No new product bug.

## Bugs left unfixed

Product code was not changed.

1. `Index::search("md")` lists `.MD`, `.md`, and `dir/.md` as name hits (`line == 0`). `display_name` of a non-note is the whole file name, and `".md"` contains `"md"`. `search_notes` omits those paths. Unlinked mentions skip `line == 0` and any path that fails `isNoteFile`. Severity: low. A caller of the Tauri `search` command that does not filter notes will list a non-note when the query is a substring of `.md`.

2. `openLink(".md")` and `openLink("dir/.md")` open the non-note in the markdown editor. Images, canvases, and bases are the files `open` sends to the attachment view. The create-if-missing branch already returns when the file name is `.md`. The file stays out of `vault.notes`. Severity: low.

## Commands and results

From `rebuild/app`, after `npm run build` (exit 0, existing chunk-size warning unchanged). Each new file three times under `flock /tmp/grove-npm-test.lock`, all exit 0.

- `npx vitest run src/searchPropsEdge.test.ts`: 5 passed each run.
- `node scripts/test-search-props-edge.mjs`: the same passes each run, and the same `EXPECTED FAIL` line to `.MD`. Three of those runs were after `26372e6`. The whitespace and quote checks use `wait` and print nothing on success.

10k timing from `cargo test --offline --lib search_props_edge` (debug). Median of three, ceiling 50 ms. Search, lines, switch:

| Run | search ms | lines ms | switch ms |
|---|---|---|---|
| before `Operator.md` | 5.655 | 0.005 | 0.005 |
| 1 | 5.801 | 0.005 | 0.004 |
| 2 | 5.552 | 0.005 | 0.005 |
| 3 | 5.866 | 0.005 | 0.005 |
| after the edit was reapplied | 5.606 | 0.005 | 0.005 |

The source notes printed 5.553 and 5.618 on their debug runs, with the same line and switch times. All of these sit under 50 ms and under a 16.7 ms frame. This search is the 50 ms budget in `rebuild/RUST_PERF_PLAN.md`.

Full checks, all exit 0. No timing flake needed a rerun.

On `74ac8cd` (integration `93dbb79`), before the links merge:

- `npm run build`.
- `flock /tmp/grove-npm-test.lock npm test`. Vitest: 75 files, 1260 tests, including `src/searchPropsEdge.test.ts` (5) and `src/bases/edge.test.ts` (7). 300-card pan p95 16.80 ms max 16.80 ms, zoom p95 16.70 ms max 16.80 ms, compositor drops 2 (pan) and 0 (zoom). The search script printed the `EXPECTED FAIL` to `.MD`. Posttest bases edge: sort work 19.0 ms, scroll p95 16.8 ms max 16.8 ms, 46 rows, `scrollTop` 160000.
- `npm run audit:offline`: 186 source files, dist, CSP, capabilities, and dependencies.
- `cargo build --offline` and `cargo test --offline` in `rebuild/app/src-tauri`: 81 passed, 0 failed, 5 ignored.

Integration then moved to `87d58f2` (`Merge branch 'rebuild/links-embeds-edge-review-grok'`). Merged with `--no-ff` as `a542313`. Cargo on that commit: build already up to date, tests 81 passed, 0 failed, 5 ignored, finished in 0.37 s. The ignored tests are `set_property_bench`, `crash_child`, `bench_vault`, `bench_search_commands`, and `legacy_name_search_must_not_list_a_file_named_dot_md`. `--offline` keeps the run off the network.

Second full `npm test` on `a542313`, exit 0. Vitest again 75 files, 1260 tests. 300-card pan p95 16.80 ms max 16.80 ms, zoom p95 16.80 ms max 16.80 ms, compositor drops 2 and 0. Search-props printed the same `EXPECTED FAIL`. The links browser script printed `LEDGE_FRAMES` type max 16.8 ms p95 16.7 ms, switch max 16.7 ms p95 16.7 ms. Posttest: K8 10k scroll p95 16.7 ms max 16.8 ms; bases edge sort 23.4 ms, scroll p95 16.7 ms max 16.8 ms, 46 rows, `scrollTop` 160000. `npm run audit:offline` again: 186 source files, dist, CSP, capabilities, and dependencies.

`rebuild/round*-shots/` was restored with `git checkout` and is not in this commit.

## Left open

The two bugs above stay for a later product change. Nothing else is waiting on a decision.

VERDICT: OK
