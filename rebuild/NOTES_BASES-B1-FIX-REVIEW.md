# NOTES_BASES-B1-FIX-REVIEW: review of the Bases B1 fix (Grok)

Branch `rebuild/b1fix-review-grok`, from `rebuild/b1-fix-claude` `58af482`. B1 is Codex's formula language (`rebuild/bases-b1-codex` `7a5af1b`). Claude reviewed it (`rebuild/NOTES_BASES-B1-REVIEW.md`, NEEDS FIXES) and fixed it on `rebuild/b1-fix-claude`, which already merges B0 (`rebuild/bases-b0-grok` `dba5a78`, merge `e2e3372`). This review did not change code.

VERDICT: OK

Ready to merge right after B0. The branch already contains B0, so merging it brings B0 and B1 in that order. One filter behaviour differs from a plain reading of Obsidian's public docs; it is deliberate, tested, and called out below.

## 1. The failing-filter fix

`d822b4a` is the review's prescribed diff and nothing more: `model.ts` +11/−3, `model.test.ts` +14. `select()` uses `testExpression`, so an error value is not a match. `tree()` returns a child's `FormulaError` instead of letting JavaScript treat the object as true. `and` stops on the first false or error. `not` of an error returns the error, so the row is excluded instead of inverted. An empty `and` is true, an empty `or` is false, and an empty `not` is true, the same as the old `every` / `some` / `!some`.

`or` stops on the first true **or the first error**. That copies `||` inside one expression: the left side goes through `checked()`, which throws a `FormulaError`, and `expression()` returns that error without evaluating the right side. The test "never lets a filter that fails on a row match it" pins the review's table, including the deliberate row: `or: ['-file.name < 0', 'priority == 2']` matches nothing. On integration that leaf was just false (`NaN < 0`), so note B still matched.

**Obsidian.** Relied on prior knowledge of the public Bases syntax page and the Functions page. No page was fetched. Those pages describe a YAML `or` list as any condition being true, and `||` as logical or. They do not say a formula that fails to evaluate aborts the rest of the group, or that a failing left side of `||` discards a true right side. So this matches Grove's own `||`, and it does not match that plain reading of the public filter docs. It is documented and tested, not a silent bug. Left as Claude wrote it. If Chris wants the any-match reading (a later true clause still matches after an earlier failure), that is a small follow-up.

## 2. Speed, rerun against integration

Same method as `NOTES_BASES-B1-FIX.md`: `select()` over every note of the existing `gen-vault.mjs` vaults (`/tmp/grove-bench-5000`, `/tmp/grove-bench-50000`). Rows are built as that bench builds them (properties from the first 60 lines of frontmatter, `tagsInText` of the body, `hasLink` always false). Each figure is the median of 7 runs. This branch and `rebuild/integration` `09d8fb8` were interleaved in one session, fix then integration, three rounds at 5k and two at 50k. The integration snapshot matches `git archive 09d8fb8` of `src/bases`. The fix snapshot matches `HEAD`. `src/bases` was restored afterwards.

Row counts match the fix notes: 5k is 3,000 / 596 / 4,862; 50k is 30,000 / 5,995 / 48,624.

| Vault | Case | This branch | Integration `09d8fb8` |
|---|---|---:|---:|
| 5k | `tag_sort` | 7.8, 6.3, 7.4 ms (median 7.4) | 12.4, 11.4, 10.4 ms (median 11.4) |
| 5k | `folder_or_text` | 5.0, 4.6, 5.5 ms (median 5.0) | 11.9, 12.6, 11.7 ms (median 11.9) |
| 5k | `formula_sort` | 18.4, 17.0, 17.3 ms (median 17.3) | 26.0, 26.4, 24.9 ms (median 26.0) |
| 50k | `tag_sort` | 100.4, 101.1 ms | 149.2, 155.0 ms |
| 50k | `folder_or_text` | 70.9, 65.5 ms | 138.9, 136.9 ms |
| 50k | `formula_sort` | 233.7, 236.3 ms | 342.4, 333.0 ms |

**No regression.** This branch is faster than integration on every case and every round. The slowest fix round is still under the fastest integration round in that case. Against the round medians, 5k is about −35% / −58% / −33%. The 50k rounds are about a third to a half under integration. Claude's published medians are the same shape (this machine's 50k tag and formula sit a few milliseconds slower than that write-up, and still well under integration).

## 3. Sort keys order rows like the comparator they replaced

`d7139ec` precomputes each row's sort values. `576027a` pins the edge cases (`model.test.ts` +7). Compared the new keys with the inline comparator from `d822b4a` (numbers by subtraction, date-like strings by `compareValues` / `parseDate`, other text by `compareNames`, empties last in either direction) on 400 random two-key tables, 200 ASC and 200 DESC: numbers including `NaN` and `-0`, empties, lists, booleans, locale text, valid and invalid date-like strings.

All 400 matched in America/Los_Angeles (this machine), America/New_York, and UTC. The pinned order is `ceadgfbh` ascending and `fgdaecbh` descending on both paths.

Against a reconstruction of integration's comparator (`Date.parse` when both strings are date-like and both parses are finite, otherwise code units; empties still last, and direction does not flip that), 0 of 400 differed in UTC, and 34 of 400 differed in Los Angeles and in New York. Date-only strings are UTC midnight under `Date.parse` and local midnight under `parseDate`. That difference is B1's compare, which the sort-key commit preserved, so table order agrees with formula comparison. Not a new regression.

## 4. The B0 merge

`e2e3372` parents are `06636a0` and `dba5a78`. The merge added only `NOTES_BASES-B0.md`, `test-bases.mjs`, `view.test.ts`, and `view.ts`. At `HEAD`, those three code files are identical to `dba5a78`. Later fix commits do not touch `view.ts`. B1 and B0 did not overlap.

## 5. Nothing outside Bases changed unexpectedly

Commits from `06636a0` to `HEAD` touch only `NOTES_BASES-B0.md`, `NOTES_BASES-B1-FIX.md`, `test-bases.mjs`, `model.test.ts`, `model.ts`, `view.test.ts`, and `view.ts`. The earlier commits already on this branch stay in Bases and the notes: `f302d88` (clock and `checked()`), `2041883` (duration order), and `f87de5c` (the hand-off moved out of `NOTES_B1.md`). `NOTES_B1.md` at `HEAD` matches integration `09d8fb8`, so merging does not rewrite the search-bench notes.

A three-dot diff against `09d8fb8` also shows the Bases plan and mockups. The merge-base is `542d984`, so that is plan ancestry, not an edit in the fix.

## Checks

On `58af482`, under `flock /tmp/grove-npm-test.lock` for the test suite. The crates.io registry was not contacted (`cargo --offline`; the log shows no download).

- `npm run build`: passed (`tsc --noEmit` and vite build).
- `npm test`: the first run stopped on the known 300-card canvas drag flake in `scripts/test-canvas-editing.mjs` (max frame 33.3 ms, limit 20 ms, 46 intervals). Reran the full suite once under the lock. The second run passed: vitest 62 files / 1,029 tests, the browser, geometry, and real-mouse scripts, then `posttest` (`test-bases-config.mjs`).
- `npm run audit:offline`: passed (168 source files).
- `cargo build --offline`: passed.
- `cargo test --offline`: 58 passed, 0 failed, 2 ignored.

No GUI windows, network, real vaults, other worktrees, or Herdr panes were used. B2 was not merged. `rebuild/bases-b3-grok` was left as it is. Nothing was pushed.
