VERDICT: OK

Reviewed Grok b's Bases B3 part 2, the formula fuzz, at `1e451bb` on `rebuild/bases-b3fuzz-grok`, from `rebuild/integration` `08641e4`. This branch is `rebuild/b3fuzz-review-grok`. Grok b's branch is still `1e451bb`. Nothing was pushed. No product code was changed, and no committed fuzz test was added.

## What landed

`08641e4..1e451bb` is one file, +70:

- `rebuild/NOTES_BASES-B3-FUZZ.md`

`bases/expression.ts`, `bases/functions.ts`, `bases/dates.ts`, `bases/model.ts`, `bases/view.ts`, and their tests are untouched. The fuzzer stayed at `/tmp/b3fuzz/fuzz.mjs`. It loads the evaluator through Vite SSR and does not edit `src/bases`.

## The plan does not ask for a committed test

Section 8's B3 row owns `bases/results.ts` and puts the fuzz script in its scratchpad ("Export CSV now, fuzz once B1 lands"). Section 7 is the bar for that scratchpad run: random token streams must never throw outside the parser, hang, or take more than 50 ms per expression. That is an acceptance check on the uncommitted script, not a request to land a vitest. A fixed-seed suite was not added.

## Rerun

`node /tmp/b3fuzz/fuzz.mjs` against this worktree's `rebuild/app`, time zone `America/Los_Angeles`, exit 0. Same shape as Grok b: seed `0xC0FFEE`, 4,000 random formulas, 300 date cases. `slows` was empty. Nothing took more than 50 ms. Calling a compiled expression did not throw. The 11 recorded failures are the same kinds:

- `clock-once` detail `2`. The harness evaluates twice to check stability. `now()` is still sampled once per evaluation, and the unit test still pins that. Harness, leave it.
- `want-error` `tags == tags => true`. The same array compares equal by reference and does not walk forever. A cyclic list's `String()` is `""`. Leave it.
- Six `value-display` rows, `tags :: Error Value nesting is too deep`. `displayValue` and `equalValues` stop at depth 50 (`functions.ts` lines 68 and 110). The harness calls `displayValue` on the caller's array. Leave it.
- `value-tostring` and `deep-return-crashes-string` at depth 5,000: `expression("tags")` returns the caller's array, and `String()` throws `RangeError: Maximum call stack size exceeded`. See below. Fine to leave. Not a follow-up.
- `expected-throw-or-null` `0001-01-01`. `0001-01-01` minus one day is the date-only value `0000-12-31`. The fuzzer's oracle expected a throw. The oracle was wrong. Leave the product.

## Left open

**Visible error cells stay unwired. Follow-up for Codex and Claude, already written in `NOTES_BASES-B1.md`.** `BASES_PLAN.md` section 3 wants a formula that fails to parse to show an error cell and a one-line toolbar notice. `model.ts` `compile()` still adds `Unsupported expression: …` and returns `() => null` (lines 65–66). A cycle adds `Circular formula: …` and returns null (line 104). The filter tree already returns `isFormulaError` from a child (line 80), so `not` cannot turn that child into a match. A runtime `FormulaError` stringifies as `#ERROR: ${message}` (`functions.ts` line 10), and unit tests pin that prefix. `view.ts` `cell()` puts `String(value)` into the cell (lines 222 and 249) and does not check `isFormulaError`. `cards.ts` does the same (lines 182 and 200). `results.ts` `cellText` (line 8) does too, so a `FormulaError` that reached export would already print `#ERROR: …`. Parse failures never become that value, so the cell stays empty. Do not edit `view.ts` or `model.ts` here. Codex owns the model wiring (`compileFormula`, cycle returns `new FormulaError`, cached errors). Claude owns the read-only `#ERROR!` cell with the message in the title. B4, which splits `view.ts`, is the natural landing. This is not a B3 fuzz defect.

**A list nested about 5,000 deep makes `String()` throw. Fine to leave.** `checked()` rejects a list longer than 10,000 entries and a string longer than 100,000 characters, and it does not walk depth (`functions.ts` lines 50–58). Frontmatter cannot build this value, and the parser's depth limit is 50. `view.ts` `update()` catches the `RangeError`, including the column-width loop's `String(item)` at line 321, and shows "Unable to open base" (lines 328–329). Walking every list inside `checked()` would tax `tags.length` (0.89 ms for 5,000 evaluations on this run). That cost is not justified.

**`FormulaFile.toString` requires `file.path` to be text. Fine to leave.** It calls `text(context.get("file.path"))` (`functions.ts` line 32), which throws "Expected text" for null or a number (line 61). `fileFact` returns the vault path string (`model.ts` line 31). A real row does not hit this. Hardening `toString` would hide a getter that returned the wrong type.

The rest of Grok b's pinned behaviour matches this rerun and stays as tested: half-up `Math.round` (`(-2.5).round()` is −2, `2.5.round()` is 3), `contains("abc", null)` true, `file.inFolder("")` true for every file, `||` / `&&` / `if` / YAML `or` stopping when an earlier formula fails, `date("2024-01-01") + 1` an evaluation error, and `file['name']` not parsing.

## Speed

Same shape as `NOTES_BASES-B1.md`: compile once, one warmup, 5,000 in-memory evaluations, median of seven. This isolates the evaluator. It does not decide B7.

| Expression | This rerun | B1 notes |
|---|---:|---:|
| `priority * 2 + 1` | 1.23 ms | 2.02 ms |
| `title.trim().lower().contains("task")` | 1.12 ms | 1.77 ms |
| `file.mtime > now() - "1 week"` | 8.60 ms | 9.41 ms |
| `tags.contains('work')` | 0.73 ms | — |
| `tags.length` on 200 tags | 0.89 ms | — |
| `tags.contains('tag150')` on 200 tags | 26.30 ms | — |

Grok b's committed run was 1.22 / 1.10 / 9.17 / 0.63 / 0.82 / 26.59 ms. Nothing on this branch edits the evaluator. The three B1 expressions are the same order and are not slower.

## Checks

Shared-machine queue time is excluded. `npm test` and `cargo test` took `/tmp/grove-npm-test.lock` in turn. Cargo used `--offline`. No fetch.

- `npm run build`: passed. TypeScript and Vite, built in 202 ms. The existing chunk-size warning remains.
- `npm run audit:offline`: passed. 171 source files, dist, CSP, capabilities and dependencies.
- `flock /tmp/grove-npm-test.lock npm test`: passed on the first full run. Vitest 63 files / 1,050 tests, the browser, geometry and real-pointer scripts, and `posttest` (`test-bases-config.mjs` and `test-bases-cards.mjs`). The 300-card canvas drag stayed under 20 ms (max 16.8 ms, 48 intervals). The 1,000-row Bases scroll was 16.8 ms. No retry.
- `cargo build --offline`: passed, dev profile in 0.17 s. `cargo test --offline`: 58 passed, 0 failed, 2 ignored (`bench_vault`, `bench_search_commands`). The binary and doc-test targets passed.

Screenshot fixtures under `rebuild/round*-shots/` were restored with `git checkout -- rebuild/round*-shots` before this commit. Prompts, logs, and `/tmp/b3fuzz/fuzz.mjs` are not committed.

## What this relied on

`BASES_PLAN.md` sections 3, 7 and 8, `NOTES_BASES-B3-FUZZ.md`, and `NOTES_BASES-B1.md` (speed paragraph and the UI hand-off). Obsidian's public help pages "Introduction to Bases", "Bases syntax", "Functions" and "Views", from prior knowledge, the same pages Grok b named. No page was fetched this review. No Obsidian code or assets. No network, no new packages or crates, no GUI, no real vaults, no other worktrees.
