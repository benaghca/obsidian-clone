# Bases edge tests review

Branch `rebuild/bases-edge-review-grok`, from `rebuild/bases-edge-tests-grok` at `b0bf771` (itself from `c9fe49f`). Nothing was pushed. No product code in `src/` or `src-tauri/` was edited. The two new test files were left as they landed.

## What changed

Reviewed, and left byte for byte:

- `rebuild/app/src/bases/edge.test.ts` — 248 lines
- `rebuild/app/scripts/test-bases-edge.mjs` — 326 lines
- `rebuild/NOTES_BASES-EDGE-TESTS.md` — 69 lines

This review:

- `rebuild/app/package.json`: `posttest` now ends with `node scripts/test-bases-edge.mjs`. `git merge --no-ff rebuild/integration` (`b5cffcb`) conflicted on that one line. The resolution keeps the integration scripts `test-bases-kanban-edge.mjs` and `test-bases-kanban-edge-scale.mjs` and the new bases edge script.
- This notes file.

## What the tests actually check

I read the assertions against `model.ts`, `expression.ts`, `functions.ts`, `groups.ts`, `search.ts`, `summaries.ts`, `results.ts`, and `view.ts`. They match the notes. I did not fetch Obsidian's help pages. The original notes already treat these cases as Grove's rules (display names stay on that base, summaries and CSV follow the toolbar search, a file named `.md` is not a note, search flushes a pending edit). The checks below use Grove's sources.

The vitest file is not vacuous. Each case names the rows and the values: `.md` is dropped and `a` / `Note` are kept; `1 / points` is the division error on 0 and `0.25` on 4, and `formula.boom + 1` repeats the error only on the zero row; fifty-one nested `if`s compile to null with an `Unsupported expression:` notice (fifty nested `if`s return 1); a forty-formula chain is 41 with an empty notice set; text `"2"`, `"10"`, `"10a"` sorts numerically; `open` / `Open` / `OPEN` and a one-item list `["Open"]` are four groups; the 100,001-character value errors, is skipped by search, and groups as Empty while another column on that row still matches; CSV is the exact display-name string, including the quoted field and the unquoted `#ERROR: Division by zero`; the 10,000-row sort checks the first name `09999`, rank 9999, and the last rank 0, then the 50 ms ceiling.

The browser script uses real pointer and key input. `check(true, …)` only records a step that the `assert` calls above it already proved. The mounted-row check is `< 80`, and the sort wait requires `Edge10/00001.md` with rank 9999. The scroll requires `scrollTop > 1000` and a row past index 100. The three runs mounted 46 rows and stopped at `scrollTop` 160000.

`wait` polls every 20 ms and fails when the condition does not arrive. `sleep(400)` sits after the count already reads `10000 results`. The plain table virtualizes in that same update once `drawn.length > 200`, so the pause is not holding a failing paint out of the assertion. `sleep(25)` between wheel events is the same frame pacing as `test-bases-list.mjs`. The ceilings are the existing ones: sort `reconcile.lastMs` ≤ 50 ms, scroll p95 ≤ 20 ms and max ≤ 25 ms, no long task over 50 ms, mounted rows under 80. Nothing in the new files loosens those.

The formula-notice assertion is `arrayContaining`. Evaluating `formula.self`, `formula.a`, and then `formula.b` still leaves only `Circular formula: formula.self`, `Circular formula: formula.a`, and the unsupported deep expression. The cycle caches null, so a later read of `formula.b` does not add another notice. That matches the notes.

No `src/` edit is in `c9fe49f..b0bf771`. The three runs and the full `npm test` were deterministic on the values. The only varying numbers are the timings, and every one stayed inside the ceilings.

## Trying to break the paths

A throwaway probe (deleted before any commit) exercised the same formula, search, and 10,000-row paths past the cases the tests name.

- Rank sort of 10,000 rows: 8.1 ms. Sort by `rank + 1`: 17 ms. Text sort: 10.5 ms. A miss search: 8.1 ms. A one-row hit: 3.6 ms. Grouping 10,000 distinct ranks: 21.3 ms. Summing a formula over 10,000 rows: 8.6 ms. All under the 50 ms goal.
- A chain of 1,200 formulas returned 1,201.
- A value of length 100,000 lowercases. Length 100,001 is `#ERROR: Formula value is too large`.
- `upper()` of 60,000 `ß` (which expands) is the same too-large error.
- `1 / 0 || true` selects nothing. `true || 1 / 0` selects the row. `if` remains the guard the tests use.
- Dividing by the text `"0"` is `#ERROR: Expected a number`. The tests store `points` as a number, and that path still divides by zero.
- Toolbar search does not match `#ERROR` or `division`. `search.ts` skips formula errors and empty values on purpose. A second column on the row still matches, which is what the vitest file asserts.
- Grouping `1 / points` puts the zero row and a blank row in one Empty group and records `Division by zero` on that group. The vitest file covers the error row alone. `groupWork` sends every thrown value to the empty id and keeps the error. That is the behavior the new test pins.

No product bug turned up. No test script needed a fix.

## Large table against 50 ms and 60 fps

`node scripts/test-bases-edge.mjs`, three times under `flock /tmp/grove-npm-test.lock`, after `npm run build`. No long task.

| Run | Sort `lastMs` | Scroll p95 | Scroll max | Mounted rows |
|---|---:|---:|---:|---:|
| 1 | 19.5 ms | 16.8 ms | 16.8 ms | 46 |
| 2 | 21.1 ms | 16.8 ms | 16.8 ms | 46 |
| 3 | 18.6 ms | 16.7 ms | 16.8 ms | 46 |

A 60 fps frame is 16.7 ms. The scroll frames sat on that tick. The sort work stayed under half of the 50 ms goal.

Vitest `src/bases/edge.test.ts`, three times: 7 passed each time. The 10,000-row case finished in 13 ms, 11 ms, and 18 ms.

The same browser script inside full `npm test` reported sort 18.6 ms, scroll p95 16.7 ms, max 16.8 ms, 46 rows.

## Checks

On this branch, first run, after the merge:

- `npm run build` passed. The usual Vite chunk-size warning remains.
- `flock /tmp/grove-npm-test.lock npm test` passed (about 12.5 minutes). Vitest: 74 files, 1255 tests, including `edge.test.ts` (7) and 444 parity tests. Posttest included the kanban edge scripts and `test-bases-edge.mjs`. The 300-card canvas drag stayed at max 16.8 ms.
- `npm run audit:offline` passed: 186 source files.
- `cargo build --offline` and `cargo test --offline` in `rebuild/app/src-tauri`: 73 passed, 4 ignored.

`npm test` rewrote `rebuild/round*-shots/`. Those were restored with `git checkout -- rebuild/round*-shots` and are not in the commits.

VERDICT: OK
