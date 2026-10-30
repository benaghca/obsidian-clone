# NOTES_BASES-B1-FIX: Bases B1 with the review's fixes (Claude)

Branch `rebuild/b1-fix-claude`, from `rebuild/b1-review-claude` `06636a0`, then `git merge --no-ff rebuild/bases-b0-grok` (`dba5a78`, merged cleanly as `e2e3372`). B2 is not merged.

VERDICT: OK

B1 plus these fixes is ready to merge right after B0. The branch already contains B0, so merging it brings B0 and B1 in the right order.

## What changed

| Commit | What | Files (lines) |
|---|---|---|
| `e2e3372` | Merge of B0 (no conflicts) | B0's own files |
| `d822b4a` | **§1 fix.** A filter that fails on a row no longer matches it, in `and`/`or`/`not` trees too | `bases/model.ts` (+11/−3), `bases/model.test.ts` (+14) |
| `d7139ec` | **§2 speed.** File facts worked out on demand, cached property keys, sort keys computed once per row | `bases/model.ts` (+53/−15) |
| `576027a` | A test pinning the sort's edge cases | `bases/model.test.ts` (+7) |

The review branch's own commits are included too: `f302d88` (the clock is read only when asked, plus a `checked()` fast path), `2041883` (durations order with months and against duration text) and `f87de5c` (the hand-off notes moved).

All changes are in `src/bases/` and the notes. `view.ts` is untouched apart from B0's merge.

## §1: failing filters

`select()` now uses `testExpression` for the global and view filters, and the `and`/`or`/`not` tree passes a child's error up instead of treating it as true. The review's table, now as a test (`model.test.ts`, "never lets a filter that fails on a row match it"):

| Filter (rows A=3, B=2, C=none, D=3) | Integration | B1 alone | This branch |
|---|---|---|---|
| `file.inFolder(note.where)`, `where` missing | none | **all** | none |
| `-file.name < 0` | none | **all** | none |
| `not: ['-file.name < 0']` | none | **all** | none |
| `and: ['priority == 9', '-file.name < 0']` | none | none | none |
| `or: ['priority == 2', '-file.name < 0']` | B | **all** | B (`or` stops at its first match, like `\|\|`) |
| `or: ['-file.name < 0', 'priority == 2']` | B | **all** | none (the failure comes first, as it would in `\|\|`) |
| `priority > 2` / `!(priority > 2)` / `note.missing.lower() == "a"` | A D / B C / none | same | same |

The last `or` row is the one deliberate change from integration. In integration the failed leaf was just false, so B still matched. Here a failure stops the tree, the same way `-file.name < 0 || priority == 2` stops inside one expression.

## §2: speed

Same method as the review: `select()` over every note of the `gen-vault.mjs` vaults, with rows built as `bases/view.ts` builds them, median of 7 runs per case. The three versions were run **interleaved** in the same session (each version's whole `src/bases` copied in turn), so machine noise hits them alike.
- "B1" is `rebuild/bases-b1-codex` as delivered.
- "This branch" adds the review's speed-up, the §1 fix and `d7139ec`.
- The script was `scratchpad/b1r/bases-bench.mjs` with `run-bench.sh`, not committed.

| Vault | Case | Integration | B1 | This branch | vs integration |
|---|---|---:|---:|---:|---:|
| 5k | `tag_sort`: `file.hasTag` filter, sort by name (3,000 rows) | 10.1 ms | 12.9 ms | **8.4 ms** | −17% |
| 5k | `folder_or_text`: `or(inFolder, name.contains)` + `not` view filter, sort by path (596 rows) | 11.5 ms | 15.4 ms | **5.0 ms** | −57% |
| 5k | `formula_sort`: two formulas, filter and sort by a formula (4,862 rows) | 24.4 ms | 31.0 ms | **17.4 ms** | −29% |
| 50k | `tag_sort` (30,000 rows) | 141–149 ms | 156–160 ms | **96–98 ms** | −33% |
| 50k | `folder_or_text` (5,995 rows) | 139 ms | 167–168 ms | **66–67 ms** | −52% |
| 50k | `formula_sort` (48,624 rows) | 326–331 ms | 385–387 ms | **227–228 ms** | −31% |

The 5k figures are medians of three interleaved rounds. The 50k figures are the two rounds' medians.

**This branch is faster than integration in every case**, so B1's slowdown is more than won back. The wins come from `model.ts`, which the profile showed was about 70% of `select()`:
- **Each file fact is worked out on demand.** The row getter used to build all eight facts for any `file.*` lookup, two `toISOString` calls included.
- **Each row's sort values are read and parsed once.** Before, every comparison re-read and re-parsed both rows' values (a date parse for ISO strings) and recomputed both note names. The new order is identical: I checked it against the old comparator on 200 random tables of numbers, dates, datetimes, invalid date-like text, lists, empties and locale text, in UTC and New York (a throwaway vitest file, not committed). `576027a` pins the edge cases.
- **Property ids are cached** (`canonical()` ran a regex per lookup).

**What's left**, and whether Rust's B7 pre-filter covers it:
- **Per-row evaluation.** B1's evaluator still costs a little more per row than the old one: about 200 ns of fixed cost per evaluation, spread thinly (see the review §2). The model gains hide it, but it's still there. **B7 would cover this part:** it narrows the rows before any expression runs, so a folder- or tag-scoped base at 50k evaluates thousands of rows, not 50,000.
- **Sorting large result sets by text.** `formula_sort` at 50k is now mostly `Intl.Collator` comparisons over 48,624 rows, which is shared `paths.ts` code. **B7 doesn't help a base that keeps most rows.** What would help is sorting only the visible page, or precomputed collation ranks (as RUST_PERF_PLAN P5 suggests for search). That is outside the Bases files and this task.
- **Against BASES_PLAN §6 (5,000 notes):** re-evaluation now takes 8–17 ms of `select()`, inside the 30 ms target; it was 10–24 ms before B1 and 13–31 ms with B1 alone. The 50k bases still take 66–228 ms per re-evaluation. B0's debounce limits how often that runs; B7, plus a page-at-a-time sort, is the plan for that size.

## Checks (under `flock /tmp/grove-npm-test.lock`)

All passed on the first run, on this branch's head (`576027a`):

- `npm run build`: passed.
- `npm test`: passed in full (vitest 62 files / 1,029 tests, including B0's `view.test.ts`, every browser, geometry and real-mouse script with the Bases warm-open and 1,000-row scroll checks, then `posttest`).
- `npm run audit:offline`: passed (168 source files).
- `cargo build`: passed.
- `cargo test`: 58 passed, 2 ignored (the benches).

No GUI windows, network, real vaults, other worktrees or Herdr panes were used. B2 was not merged. Nothing was pushed.
