# Bases B1 — formula language and integration APIs

Branch: `rebuild/bases-b1-codex`, starting at `92572f8`.

Implementation commits: `d01ce46` (date/duration primitives) and `3b5b1ba` (formula language, error/host APIs and tests). This notes file and the UI hand-off are committed last.

## Delivered scope

The interpreter now supports arithmetic/concatenation, parentheses, lazy boolean operators and `if`, the planned global functions (`date`, `now`, `today`, `duration`, `list`, `number`, `link`, `min`, `max`, plus existing `contains`), file methods, and the planned text/list/date/number methods and value properties. All dispatch is through an explicit whitelist and an AST; no generated JavaScript, `eval`, host-object property access, packages, crates or network requests were added.

Errors are typed `FormulaError` values, with parse/evaluation phase and optional source position. `expression` still throws parse errors for editor validation; `compileFormula` preserves them in both its callable result and `.error` metadata, even with zero rows. Evaluation failures are returned rather than thrown, dependency errors propagate, and `testExpression` excludes error-valued rows. Errors are independent between evaluations.

`Context.this` supplies an explicit host context. Missing hosts yield null. `hasProperty` and a sampled clock are optional context hooks. Compiled expressions expose frozen dependency keys and a `usesThis` flag without reading data. Typed date, duration, link and file values do not expose their JavaScript internals to expressions. The new link/backlink/embed/property fact names are accepted, but their data must be supplied by callers.

Chris explicitly kept the ownership boundary while B0/B2 edit shared files: **no edits to `model.ts` or `view.ts`**. Visible error cells, toolbar notices, cycle-to-error conversion and supplying the actual embedding note remain integration work after those merges. The concrete hand-off is appended to `NOTES_B1.md`, preserving its pre-existing Rust benchmark notes. The only change to `model.test.ts` updates its old expression rejection list now that arithmetic and `this` are supported; all model/table tests remain.

## Files and decisions

Changes from the starting commit (excluding this notes file):

- `app/src/bases/expression.ts`: +233 / -76; strict lexer, AST parser/evaluator, compiler/error/host APIs and dependency metadata.
- `app/src/bases/functions.ts`: +218; bounded value operations and function/method whitelist.
- `app/src/bases/dates.ts`: +150; immutable date/duration values, strict parsing, calendar arithmetic and existing Grove formatter reuse.
- `app/src/bases/expression.test.ts`: +131; operators, precedence, lazy evaluation, errors, host contexts, metadata and safety.
- `app/src/bases/functions.test.ts`: +86; every global/method, arity/type/empty cases and file hooks.
- `app/src/bases/dates.test.ts`: +94; duration units, leap years, month ends, two DST zones, repeated hours and formatting.
- `app/src/bases/model.test.ts`: +2 / -2; expression rejection assertions only.
- `NOTES_B1.md`: +30; post-merge UI/model hand-off.

Dates accept strict ISO dates/datetimes or numeric epoch milliseconds. Date-only and offset-free input use local time; explicit offsets identify instants. Day/month arithmetic preserves local calendar intent, month ends clamp, and hours/minutes/seconds are elapsed time. Fractional days use elapsed fractions; fractional calendar months are rejected. Nonexistent local input clock times are rejected; arithmetic through a DST gap uses JavaScript's forward normalization. Zero/elapsed-duration arithmetic preserves the second occurrence of a repeated autumn hour. Date subtraction returns elapsed duration. Date parts use local year/month/day-of-month. Date formatting reuses Grove's English Moment-style formatter, adding fractional seconds, offsets and epoch tokens.

Arithmetic is numeric except explicit string concatenation and date/duration operations. Null numeric arithmetic returns null; incompatible types, division/modulo by zero and non-finite results produce errors. `number` accepts finite decimal/exponent text, booleans and fixed durations; calendar months require an anchor. `min`/`max` accept numbers or one list, skip null and return null when empty. `round` supports integer precision -100..100; `toFixed` returns JavaScript's decimal text with precision 0..100. Text length counts UTF-16 units. List membership is typed and structural; equality retains the earlier empty/null equivalence. Empty lists remain truthy as in the original interpreter. Concatenation/display uses empty text for null; list joining defaults to comma-space. Links carry path/display data without resolving or reading files.

The existing source length 4,000, token count 500 and nesting depth 50 limits remain. Additional guards cap a string at 100,000 characters, a list at 10,000 entries, traversed value depth at 50 and processing work at 100,000 steps per evaluation. Output joins check size before growing the result. Non-finite/unsupported callback values and cyclic/oversized traversals become error values. Callbacks remain caller-controlled synchronous APIs; their own work cannot be pre-empted by the evaluator's budget.

## Behavior sources and compatibility limits

Followed `BASES_PLAN.md` sections 3/4/7/8 and the existing Grove expression/model tests. The plan names Obsidian's public Bases syntax/Functions help pages from prior knowledge. No public pages were fetched because this task prohibits network access; no Obsidian code/assets or real vaults were accessed. The choices above are an explicit supported subset, not a claim of live-verified Obsidian parity for every coercion, duration alias, timezone edge or date-format token. Public-doc/fixture parity review and B3 fuzz remain later work under the plan.

## Verification and timings

All heavy checks use `flock /tmp/grove-npm-test.lock`; shared-machine queue time is excluded from timings.

- Production build: passed (TypeScript and Vite; existing large-chunk warning remains).
- Final focused units: 4 files / 351 tests passed, including the repeated-DST-hour, unsupported-callback and shared-concatenation-budget regressions.
- Offline audit: passed, checking 168 source files, dist, CSP, capabilities and dependencies.
- Full `npm test`: **passed on the single full locked retry**, including 61 files / 1,016 unit tests, every browser/geometry/real-pointer script and `posttest` (`test-bases-config.mjs`). The initial run passed its units and browser checks through the canvas drop script, then failed at `test-canvas-drops.mjs:33`: the mock reported `No such file: Drop.canvas` during an SVG explorer drag. That exact drag and the complete script passed on retry. The canvas path does not use this evaluator; no canvas/mock/browser-test code was changed. Recorded as an unrelated timing flake, with no assertions relaxed or tests skipped.
- Rust `cargo build --offline` and `cargo test --offline`: passed; 58 tests passed, 0 failed, 2 ignored; binary/doc-test targets also passed.

A locked, headless Vite SSR/Node harness compiled each expression once and evaluated 5,000 deterministic in-memory row contexts (one warmup, seven measured runs). Warm medians: arithmetic `priority * 2 + 1` **2.02 ms**; text `title.trim().lower().contains("task")` **1.77 ms**; date predicate `file.mtime > now() - "1 week"` **9.41 ms**. Compilation took 0.44 / 0.29 / 0.12 ms respectively; all evaluations returned without errors. This isolates the evaluator: no row construction, formula dependency caching, sort, IPC or DOM is included, so these are not the plan's full-table performance numbers and do not decide B7. The temporary harness/log is not committed.

Screenshots are restored with `git checkout -- rebuild/round*-shots` before every commit. Prompts and logs are excluded. No GUI windows, network, real vaults, other worktrees or Herdr panes were used. No push or rebase.
