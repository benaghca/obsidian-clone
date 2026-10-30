# K1F: finish the search parity branch

On `rebuild/k1-search-grok`, 2026-10-29. Local commits only. Nothing pushed.

Claude's review (`rebuild/NOTES_K1-REVIEW.md`, committed as `33524d2`) was OK. This finishes the branch for merge.

## What changed

`e428c6f` merges `rebuild/integration` (`2bb6aeb`) with `--no-ff`. The two conflicts are resolved the way the review says:

- `src-tauri/src/index/parity.rs`: keep Step 3's `"properties" => Some(properties)` and K1's `"query" | "search" => None`.
- `fixtures/parity/README.md`: keep the `properties.json` row that names `note_properties`, and keep the `query.json` and `search.json` rows.

`449a87d` is the two review fixes. 3 files, +9 / −50013.

| File | Added | Removed |
| --- | ---: | ---: |
| `rebuild/app/fixtures/parity/query.json` | 0 | 50010 |
| `rebuild/app/src/shell/searchQuery.test.ts` | 7 | 0 |
| `rebuild/app/src/shell/searchQuery.ts` | 2 | 3 |

The `"10,000 words"` case is gone from `query.json` (48 parse cases remain). `searchQuery.test.ts` parses `w0` … `w9999` and checks one and of 10,000 terms, including the last term `w9999`. There is no timing assertion.

Step 3 already made `noteName` strip `.md` in any case (`paths.ts`). The name test in `matches` calls `noteName(folded)` again. The behaviour is the same, including `Upper.MD by name, match case`. NOTES_K1's open item about `noteName` is done on integration.

## Tests

From `rebuild/app`, on the fixed tree:

- `npx tsc --noEmit`: exit 0.
- `npx vitest run src/parity.test.ts src/shell/searchQuery.test.ts src/readOrdering.test.ts`: 360 passed (parity 340, searchQuery 7, readOrdering 13).
- `npm run build`: passed.
- `npm test` under `flock /tmp/grove-npm-test.lock`: exit 0. Browser discovery 4 passed. Vitest 58 files, 665 tests passed. `300-card drag frames under 20ms (max 16.8ms, 49 intervals)` passed on the first run. Posttest passed (`Configure view: frame 1, max 16.7ms`).
- `npm run audit:offline`: passed, 166 source files.

From `rebuild/app/src-tauri`, `cargo build --offline` and `cargo test --offline`: both passed. `grove_lib` 48 passed, 1 ignored (`index::bench::bench_vault`), the binary 0, doc-tests 0. The registry was not contacted.

Screenshot fixtures were restored with `git checkout` and are not in the commits.

## Left open

Q1 should add the same 10,000-word check in Rust next to `parse_query`. The review's notes for Q1 and C1-A (word split with `is_js_space`, token consumed before the depth refusal) are unchanged.
