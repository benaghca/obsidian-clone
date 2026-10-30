# NOTES_BASES-B1-REVIEW: review of Bases B1, the formula language (Claude)

Branch `rebuild/b1-review-claude`, from `rebuild/bases-b1-codex` `7a5af1b`. B1 is Codex's work: `d01ce46` (dates and durations), `3b5b1ba` (the language, typed errors, `this` and tests) and `7a5af1b` (notes).

VERDICT: NEEDS FIXES

There is one blocking fix, which must land in `model.ts` with or right after B1's merge (§1). There is also a smaller speed regression that should be tracked (§2). Everything else holds, or was fixed in this branch (§3).

## 1. Blocking: a filter that fails at runtime now matches every row

B1 returns evaluation failures as `FormulaError` values instead of throwing, as planned. `model.ts` is unchanged on purpose: Chris kept B1 out of it while B0 and B2 edit it. But `model.ts` still tests filter results by JavaScript truthiness, and an error object is truthy. So merged alone, B1 turns "this filter failed" into "this row matches". Measured with the real `baseModel` on three rows:

| Filter | Before B1 (integration) | B1 alone | B1 + the fix below |
|---|---|---|---|
| `file.inFolder(note.where)`, `where` missing | no rows (`String(null)` = `"null"`) | **all rows** (`text(null)` fails) | no rows |
| `-file.name < 0` | no rows (`NaN < 0`) | **all rows** | no rows |
| `priority > 2`, `!(priority > 2)`, `note.missing.lower() == "a"` | as expected | same | same |

A `not:` tree has the same problem the other way round: a failed child must not make `not` match.

**Exact fix** (verified: all Bases tests pass with it and the table above comes out right; **not committed**, because it is `model.ts`). Apply it in the B1 merge, or as the first commit after it, before any release:

```diff
-import { compare, expression, type Context, type Expression, type Value } from "./expression";
+import { compare, expression, isFormulaError, testExpression, type Context, type Expression, type Value } from "./expression";
@@ tree()
-    return c => op === "and" ? nodes.every(n => n(c)) : op === "or" ? nodes.some(n => n(c)) : !nodes.some(n => n(c));
+    // A failed child fails the whole tree (an error value is truthy, and "not" must not turn it into a match).
+    return c => {
+      for (const n of nodes) {
+        const v = n(c);
+        if (isFormulaError(v)) return v;
+        if (op === "and" ? !v : !!v) return op === "or";
+      }
+      return op !== "or";
+    };
@@ select()
-    const found = rows.map(row => ({ row, context: context(row) })).filter(r => global(r.context) && local(r.context));
+    const found = rows.map(row => ({ row, context: context(row) })).filter(r => testExpression(global, r.context) && testExpression(local, r.context));
```

Add two `model.test.ts` cases with it:
- `filters: 'file.inFolder(note.where)'` over rows without `where` gives no rows;
- a view `filters: { not: ['-file.name < 0'] }` gives no rows.

The fix touches `tree()` and `select()` only, not the view-type and card-key lines B2 owns, so it shouldn't conflict.

**Who wires the rest.** The hand-off covers visible `#ERROR!` cells, the toolbar notice, cycles as errors, error sorting, typed date, duration and link display, and supplying `this`. No task in BASES_PLAN §8 owns it. I recommend:
- the model half (`compileFormula`, cycle errors, runtime notices, sorting errors last) goes to **B5** (Codex, who wrote B1 and owns `model.ts` in wave 2);
- the cell and notice half goes to **B4** (Claude, who owns `view.ts` in wave 2);
- `this` goes to B4, as planned.

Chris should confirm that, or add a small "B1W" task after B2 merges.

## 2. Performance: evaluation is a little slower than integration

Tested with `select()` over every note of the `/tmp/grove-bench-5000` and `/tmp/grove-bench-50000` vaults from `gen-vault.mjs`. Rows were built as `bases/view.ts` builds them (properties from `readProperties`, tags from `tagsInText`). Each case is the median of 7 runs, and the versions were run interleaved, so machine noise hits all of them alike. The cases:
- `tag_sort`: `file.hasTag("meeting")`, sorted by name;
- `folder_or_text`: `or(file.inFolder, file.name.contains)` with a `not` view filter, sorted by path;
- `formula_sort`: two formulas, filtered and sorted by a formula.

All three are valid in both versions. The script was `scratchpad/b1r/bases-bench.mjs`, not committed.

| Vault | Case | Integration | B1 | B1 + review fix (`f302d88`) |
|---|---|---:|---:|---:|
| 5k | tag_sort | 10.2 ms | 13.9 ms | 12.6 ms |
| 5k | folder_or_text | 11.6 ms | 16.2 ms | 14.6 ms |
| 5k | formula_sort | 24.7 ms | 32.7 ms | 29.9 ms |
| 50k | tag_sort | 158 ms | 157–170 ms | 157–171 ms |
| 50k | folder_or_text | 141 ms | 171 ms | 158–161 ms |
| 50k | formula_sort | 335 ms | 389–425 ms | 367–373 ms |

The 5k figures are medians of three interleaved rounds. The 50k figures are the medians of two rounds, given as a range.

- **B1 was 20–40% slower at 5k and up to 25% slower at 50k.** The cause is fixed cost per evaluation: a clock read, the runtime object, value checks on every node, an arity lookup per method call and a frozen file object per row. It is spread thinly; there's no single hot spot.
- **`f302d88` recovers about 40% of that.** It reads the clock only when `now()` or `today()` asks (still once per evaluation), and adds a fast path in `checked()` for plain values. The rest is 1.5–5 ms at 5k (10–20%), and 0–12% at 50k.
- **Tried and dropped, as slower or no better:** compiling the tree to closures, a per-context cache of file values, and a getter-based clock.
- **What dominates either way is not B1:** `model.ts`'s row getter is about 70% of `select()`'s time in the CPU profile. That is where B5/B7 (RUST_PERF_PLAN P7) win the real time.
- **Against the plan's targets:** the 5k warm-open target (≤ 150 ms) is still met. The 30 ms re-evaluation target was already missed before B1 for a formula-sorted 5k base (24.7 ms of select, plus row building). **This is a regression Chris asked to flag.** I recommend accepting it for the richer language, and checking it again after B5's model work.
- B1 changes no Rust and no command, so the Rust benches can't move.

## 3. What I checked, and the small fixes made here

### Language, against Obsidian's public help

What I relied on: Obsidian's public "Bases syntax" and "Functions" help pages, **from prior knowledge only**, because there was no network, and BASES_PLAN §3. I used no Obsidian code or assets and no real vault.

- **Holds:**
  - operators and precedence (`||` < `&&` < comparison < `+ -` < `* / %`, left-associative, lazy `&&`/`||`/`if`);
  - string concatenation, with null as empty text;
  - every global, method and property named in BASES_PLAN §3;
  - `note.x`, `note["x y"]`, `formula.x` and `file.*`;
  - the old limits (4,000 characters, 500 tokens, depth 50), plus new value and work caps;
  - no `eval`, and no JavaScript property access (the tests cover `constructor`, `__proto__`, `window` and `eval`).
- **Fixed here (`2041883`):** durations with months had no order, so `duration("1 month") > duration("1 day")` was false. Comparing a duration with duration text, as in `now() - file.mtime > "1 week"`, was always false. Ordering now uses the average Gregorian month, and equality stays exact (`1 month ≠ 30d`). Eight tests were added.
- **Possible gaps against Obsidian, all unverified (prior knowledge), so not changed:**
  - `if(cond, a)` with no else is rejected; I believe Obsidian's help lists the else branch as optional.
  - `file.hasTag("a", "b")` is rejected; I believe Obsidian accepts several tags (any match).
  - `"abc".contains(null)` is true, since null reads as empty text.
  - A local datetime inside a DST gap (`2024-03-10T02:30` in New York) is an error, not shifted forward.
  - Obsidian functions outside this plan's scope (`replace`, `split`, `slice`, `abs`, `floor`, list `map`/`filter`/`sort`, `relative()` and others) are absent, as planned ("Later").

  Grok's B3 fuzz/compat pass, or a `.base` file written by Chris's Obsidian, should settle the first two.

### Dates and durations

- **Strict ISO parsing.** Invalid days are rejected (`2024-02-30`, month 13), and leap years are handled.
- **Time zones and offsets.** `Z`, `±hh:mm` and `±hhmm` work. Date-only and offset-free times are local. Probed: `2024-01-01T10:00+05:30` formats as `2023-12-31 23:30` in New York, which is correct.
- **Month arithmetic** clamps to the month's end: Jan 31 + 1 month = Feb 29 (2024), Mar 31 − 1M = Feb 29, and Feb 29 + 1 year = Feb 28.
- **Days follow the local calendar across DST.** Hours, minutes and seconds are elapsed time.
- **Fractional months are rejected.** `M` means months and `m` means minutes, as in Moment-style units.
- The B1 tests pin TZ per test. I also ran the whole Bases suite under UTC, New York, Kolkata, Chatham (+12:45), Lord Howe (half-hour DST) and São Paulo, and all passed.

### Errors and `this`

- **Errors are values, never thrown:**
  - parse errors throw only from `expression()` (for editors), while `compileFormula()` returns a callable plus `.error`, even with zero rows;
  - runtime failures (division by zero, wrong types, the work limit) return a `FormulaError`;
  - a formula that depends on a failed one returns the same error;
  - `testExpression` excludes error rows. The model just doesn't call it yet (§1).
- **`this`** works as planned. Without a host it is null. `this.file.name`, `this.note[...]`, `this.formula.x` and `this.file.hasTag()` read the host context only. Dependencies carry a `this.` prefix, and `usesThis` is set, without reading any data.

### Ownership, tests and the hand-off

- **Ownership.** Only `expression.ts`, `functions.ts`, `dates.ts` and their tests changed, plus two lines of `model.test.ts`. Those two lines drop `this` and arithmetic from the "must reject" list, which is a necessary consequence. `model.ts` and `view.ts` are untouched.
- **Tests.** The Bases unit files hold 367 tests at `7a5af1b` (375 with this review's eight). They cover every function's arity and types, precedence, laziness, the limits, DST and month ends, error propagation, the host context and the metadata. They are good. What's missing is a model-level test of failing filters, which is the §1 bug.
- **Hand-off.** It is detailed enough for B4 and B5, covering cells, notices, cycles, sorting, typed values, `this` and `hasProperty`. Codex had appended it to `NOTES_B1.md`, which is Gemini's Rust search-bench notes. I moved it, unchanged, to the end of `NOTES_BASES-B1.md` (`f87de5c`), so B1's merge doesn't touch `NOTES_B1.md`.

## 4. Commits in this branch

| Commit | What | Files |
|---|---|---|
| `f302d88` | The clock is read only when asked, and `checked()` has a fast path | `bases/expression.ts` (+1/−1), `bases/functions.ts` (+15/−6) |
| `2041883` | Durations order with months and against duration text, with tests | `bases/functions.ts`, `bases/functions.test.ts` (+8 tests) |
| `f87de5c` | The hand-off moved into B1's own notes | `NOTES_B1.md` (back to integration's text), `NOTES_BASES-B1.md` |
| this file | The review | `NOTES_BASES-B1-REVIEW.md` |

## 5. Checks (under `flock /tmp/grove-npm-test.lock`)

All passed on the first run, on this branch's head (with `f302d88`, `2041883` and `f87de5c`):

- `npm run build`: passed.
- `npm test`: passed in full (vitest 61 files / 1,024 tests, every browser, geometry and real-mouse script, then `posttest`).
- `npm run audit:offline`: passed (168 source files).
- `cargo build`: passed.
- `cargo test`: 58 passed, 2 ignored (the benches).
- The Bases unit files were also run under six time zones (§3), and all passed.

No GUI windows, network, real vaults, other worktrees or Herdr panes were used. Nothing was pushed.
