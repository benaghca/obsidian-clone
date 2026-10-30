# Bases B3 part 2 — formula fuzz

ID: BASES-B3-FUZZ. Branch `rebuild/bases-b3fuzz-grok`, from `rebuild/integration` `08641e4`.

No product code changed. `bases/expression.ts`, `bases/functions.ts`, `bases/dates.ts` and their tests are untouched. No lines added or removed. The fuzzer stayed in the scratchpad at `/tmp/b3fuzz/fuzz.mjs` and is not committed. It loads those three modules through Vite SSR from this worktree. It does not edit `src/bases`.

## What the fuzzer threw at the evaluator

One run in `America/Los_Angeles`, exit 0:

- Pinned cases from `BASES_PLAN.md` and the existing unit tests: precedence, lazy `&&` / `||` / `if`, division by zero, date arithmetic, unknown functions, `constructor` / `eval`, file methods, `this`, number/min/max, and the source limits (4,001 characters, 251 additions, depth 51 parentheses and bangs). Depth 50 and 250 additions still evaluate.
- Adversarial caller values: a cyclic list, a list of 10,001 entries, a string of 100,001 characters, `NaN`, a bigint, a plain object, throwing getters, and nested lists at depths 40, 50, 60, 200, 2,000 and 5,000.
- Unicode and odd calls: emoji and NUL lengths, `straße` / `İ`, bracket property access, bad dates, duration unit case (`1M` months versus `1m` minutes), link text, and `file['name']`.
- 4,000 random formulas (seed `0xC0FFEE`, nesting up to 6) and 500 garbage strings. None were skipped for length.
- 300 random date-only values, year and month round-trips, the month-end clamp table, a 36-hour elapsed check, and 200 random `parseDate` / `parseDuration` strings. Parsers return null on junk. They do not throw.
- `FormulaDate` format and `String` at 0, ±1, and ±8.64e15, including year 10000 and year −1.
- A 10,000-by-20 nested `join`, which stays an error.

`expression()` throws only a parse-phase `FormulaError`. Calling a compiled expression did not throw. `compileFormula` keeps a parse error on `.error` and returns that same error. `testExpression` is false for errors. No case took more than 50 ms (`slows` was empty). That is the plan's fuzz bar in section 7: random token streams must not throw outside the parser, hang, or take more than 50 ms per expression.

## Speed

Same shape as `NOTES_BASES-B1.md`: compile once, one warmup, 5,000 in-memory evaluations, median of seven runs. This isolates the evaluator. It does not include row construction, sort, IPC or DOM, and it does not decide B7.

| Expression | This run | B1 notes |
|---|---:|---:|
| `priority * 2 + 1` | 1.22 ms | 2.02 ms |
| `title.trim().lower().contains("task")` | 1.10 ms | 1.77 ms |
| `file.mtime > now() - "1 week"` | 9.17 ms | 9.41 ms |
| `tags.contains('work')` | 0.63 ms | — |
| `tags.length` on 200 tags | 0.82 ms | — |
| `tags.contains('tag150')` on 200 tags | 26.59 ms | — |

There is no before/after delta on this branch, because nothing was edited. The B1 figures are that write-up's machine. This run is the same order and is not slower in a way that would justify a change. An earlier run on this machine the same day was 1.20 / 1.06 / 8.55 / 0.72 / 0.78 / 27.29 ms. The date case moved by about 0.6 ms between those two runs.

## Findings left as they are

The fuzzer printed 11 failures. Ten are the harness, or behaviour that is already pinned. One is a real crash path that this task should not patch inside the evaluator.

**Visible error cells are still unwired.** `BASES_PLAN.md` section 3 wants a formula that fails to parse to show an error cell and a one-line toolbar notice. `model.ts` `compile()` still catches that failure, adds `Unsupported expression: …`, and returns null (`model.ts` lines 64–66). A cycle adds `Circular formula: …` and returns null (line 104). A runtime failure such as `1 / 0` is a `FormulaError` whose `toString()` is `#ERROR: Division by zero` (`functions.ts` line 10). `view.ts` `cell()` (lines 222 and 249) and `cards.ts` assign `String(value)` and never check `isFormulaError`. Export and copy do the same in `results.ts` `cellText`. The B1 hand-off in `NOTES_BASES-B1.md` already describes the read-only `#ERROR!` cell, with the message in the title. Claude owns `view.ts`. Codex owns `model.ts`. This task does not edit those files, and it does not change `FormulaError.toString` (unit tests pin the `#ERROR: ` prefix).

**A list nested about 5,000 deep makes `String()` throw.** `expression("tags")` returns the caller's array. `checked()` accepts any array of at most 10,000 entries and does not walk it. `displayValue` and equality already stop at depth 50 with "Value nesting is too deep". `String()` on that array succeeds through depth 4,500 and throws `RangeError: Maximum call stack size exceeded` at depth 5,000. `view.ts` `update()` turns that throw into "Unable to open base" (line 329). A cyclic list does not throw: `String()` of a cycle is `""`, and `tags == tags` on the same array is true by reference equality, so it does not walk forever. Frontmatter and the parser cannot build a 5,000-deep list (parse depth is 50). Rejecting it inside `checked()` would walk every list on every read, including `tags.length`, which is 0.82 ms for 5,000 evaluations today. That cost is not justified. Left unchanged.

**`FormulaFile.toString` requires `file.path` to be text.** It calls `text(context.get("file.path"))`, which throws "Expected text" for null or a number. `fileFact` returns the vault entry's path string (`model.ts` lines 27–31), so a real row does not hit this. Hardening `toString` would hide a getter that returned the wrong type. Left unchanged.

**Pinned behaviour, confirmed and kept.**

- `(-2.5).round()` is −2 and `2.5.round()` is 3. Half goes toward +∞, matching `Math.round`. The existing tests pin this, including the decimal-shift cases.
- `contains("abc", null)` is true. The display of null is empty, and the empty string is found in every string.
- `file.inFolder("")` is true for every file. `file.inFolder("Folder")` is false for `Folder 01`.
- `||`, `&&`, `if`, and a YAML `or` group stop when an earlier formula fails. That matches Grove's `||` and the B1-fix review. Public docs describe YAML `or` as any condition true. They do not say a failed formula aborts the rest of the group. Left as tested.
- `date("2024-01-01") + 1` is an evaluation error. A bare number is not a duration. `"2024-01-01" + "1d"` is date arithmetic. `0001-01-01` minus one day is the date-only value `0000-12-31`, not a throw. The fuzzer's oracle expected a throw there. That oracle was wrong.
- `file['name']` does not parse. After the name `file`, only `.` is a postfix. `note['My key']` works. File properties are identifiers. Recorded, not a crash.

The harness also counted `clock-once` as 2. `now()` is still sampled once per evaluation. The counter moved because the harness evaluates twice to check stability. The unit test still pins one sample.

## What this relied on

`BASES_PLAN.md` sections 3, 7, 8 and 9, plus `NOTES_BASES-B1.md` and `NOTES_BASES-B1-FIX-REVIEW.md`. Obsidian's public help pages "Introduction to Bases", "Bases syntax", "Functions" and "Views", from prior knowledge. No page was fetched. No Obsidian code or assets. No network, no new packages or crates, no GUI, no real vaults, no other worktrees.

## Checks

Shared-machine queue time is excluded from the cargo and audit times. `npm test` waited on `/tmp/grove-npm-test.lock` and then ran the full chain. The registry was not contacted: both Cargo commands used `--offline`, and their logs show a finished local build with no fetch.

- `npm run build` (inside `npm run audit:offline`): passed. TypeScript and Vite, 2,118 modules, built in 203 ms. The existing chunk-size warning remains.
- `npm run audit:offline`: passed. 171 source files, dist, CSP, capabilities and dependencies.
- `flock /tmp/grove-npm-test.lock npm test`: passed on the first full run, including vitest (63 files / 1,050 tests), the browser, geometry and real-pointer scripts, and `posttest` (`test-bases-config.mjs` and `test-bases-cards.mjs`). The 300-card canvas drag stayed under 20 ms (max 16.8 ms). The 1,000-row Bases scroll was 16.8 ms. No retry and no assertion changes.
- `cargo build --offline` and `cargo test --offline` in `rebuild/app/src-tauri`: passed. 58 tests passed, 0 failed, 2 ignored. The binary and doc-test targets passed.

Screenshot fixtures under `rebuild/round*-shots/` were restored with `git checkout -- rebuild/round*-shots` before the commit. Prompts, logs and the fuzzer are not committed. No push.
