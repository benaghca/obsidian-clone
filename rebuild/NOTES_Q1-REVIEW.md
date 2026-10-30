VERDICT: OK

Reviewed `rebuild/q1-query-gemini` at `fe5d143` (parser `6ba62bf`, notes `fe5d143`) against `ac47873`, which is the merge of K1 `d11803d`. Compared with Q1 in `rebuild/STEP4_SEARCH_PLAN.md` (§8 task outline, §6 corpus shape, §9 parser risks). Did not edit that branch, did not commit, did not push. This worktree is still `rebuild/s5-linksources-grok` at `6686339`.

Diff `ac47873..fe5d143`: 7 files, +432 / −13. Without `NOTES_Q1.md`: 6 files, +370 / −13. No changes to `Cargo.toml`, `Cargo.lock`, or `package.json`. No new crates.

## What landed

`index/query.rs` is a port of `parseQuery`, `term`, and `scoped` from `searchQuery.ts`. `Query` serializes to the same JSON tree (`and`/`or` `parts`, `not` `part`, `term` `text`+`field`, `line` `part`, `prop` `key`+`value`). `is_js_space` and `js_trim` are `pub(super)` and are what the port uses for `\s` and `trim()`. Operator names are ASCII letters only. Nesting past 64 `(`, negating `-`, or `[property]` returns `None`. `parity.rs` registers `"query"` and passes `matchCase`. `search` stays `"rust": "todo"`. `index.rs` gains `mod query`. `query.json` changes only the top-level `"rust"` string, from `"todo"` to the parser path. No `expected` value changed. No case still has `"rust": "todo"`.

There is no regex operator. `/abc/` stays the term `/abc/`, which is the corpus case "slashes are not a regex". The plan says regex search is out of scope.

The depth cases are real counts: 64 and 65 `(` (lengths 129 and 131), 64 and 65 `-` (lengths 65 and 66), and 64 and 65 `[a:`. Empty input, an empty property key, `path:""`, and depth 65 are `null`. `tag:#` and `path:/` are terms whose text is empty, because the empty check happens before the `#` or slash strip. That matches `term()` in TypeScript.

The parity runner was not loosened. A case whose Rust value differs from `expected` still fails. A `"rust": "todo"` that now matches still fails. A file with a runner and a top-level `"rust": "todo"` still fails. `search.json` still has to say `"todo"`. The old query fixture in `search_vault_names_are_checked_without_a_runner` now runs `parse_query("A", match_case: true)` and requires the cased term. That is a stronger check.

`#![allow(dead_code)]` is there because nothing outside the test runner calls the parser until C1-A. `cargo build --offline` is clean with it.

## One input the corpus does not cover

`file:(-tag:#)` and the same shape with `path:/`. TypeScript builds `{ op: "not", part: null }` because `scoped` uses a non-null assertion on a `term("")` that returns `null`. `holds` and `explainQuery` then throw. Rust's `Not` cannot hold null, so `scoped` returns `None` and the query is nothing to search for (or, inside `AND`/`OR`, that arm is dropped). Q1 was told not to edit TypeScript. Reproducing the invalid tree would not match the `Query` type. I would not block on it. If C1 needs a recorded answer, add the string to `query.json` only after deciding which tree is intended.

## Newer K1

`rebuild/k1-search-grok` at `cacf8d0` is `449a87d` plus a notes file. `449a87d` deletes the "10,000 words" case from `query.json` (about 50,000 lines) and checks that shape in `searchQuery.test.ts` instead. It also uses `noteName` inside `matches`, not inside `parseQuery`. The parser does not need to change. `noteName` does not change any parse tree.

`git merge-tree` of `k1-search-grok` and `q1-query-gemini` (base `d11803d`) conflicts in two files:

- `fixtures/parity/README.md`: one row. Keep Q1's cell, `` `parse_query` (`index/query.rs`) ``. The `properties.json` row above it already merged to `note_properties`.
- `index/parity.rs`: the `match` arm only. Keep Q1's `"query" => Some(parse_query)` and `"search" => None`. Do not put back `"query" | "search" => None`. The rest of the file already has the case-map signature, including `properties`. Keeping K1's arm would reject the merged `query.json`, whose `"rust"` field is no longer `"todo"`, and would ignore `matchCase`.

These auto-merge:

- `query.json`: `"rust"` is Q1's parser path, 48 cases, no per-case todo, and the 10,000-word case is gone.
- `index.rs`: both `mod props` and `mod query`.
- `searchQuery.ts`: K1's `noteName` change only. Q1 does not touch it.

After that resolution the parser should pass with no edit. The 10,000-word check then exists only on the TypeScript side. A short Rust assertion of the same shape would keep the linear-parse check. It is not required for the merge to go green.

## Checks run here

Detached this worktree at `fe5d143`, then returned to `rebuild/s5-linksources-grok`. Screenshot fixtures were not regenerated.

- `cargo test --offline` from `rebuild/app/src-tauri`: 48 passed, 1 ignored (`index::bench::bench_vault`). `index::parity::corpus` passed, which includes all 49 `query.json` cases.
- `cargo build --offline`: passed.
- `npx vitest run src/parity.test.ts src/shell/searchQuery.test.ts` under `/tmp/grove-npm-test.lock`: 347 passed (341 parity, 6 search-query).
- Re-ran `/tmp/grove-q1-fuzz/target/release/grove-q1-fuzz` on its 60,000 stored cases. The binary's `query.rs` and `tags.rs` match `fe5d143`. Result: 60,000 queries and the 100,000-`(` stress case, 0 mismatches.

Did not re-run the full browser `npm test`. The parser is not called from the UI. `NOTES_Q1.md` reports that suite passing (665 vitest tests, browser scripts, posttest) on the first run. I did not reproduce that number.
