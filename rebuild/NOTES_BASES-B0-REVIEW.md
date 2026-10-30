# Bases B0 review

VERDICT: OK

This verdict includes the review fixes, not the original B0 unchanged. Reviewed Grok b's `4c6eb51` and `dba5a78` on `rebuild/b0-review-codex`. Fixes: `1f0d717`; browser regressions: `390e509`. `rebuild/bases-b1-codex` remains at `7a5af1b` and was not changed or merged here.

## Findings fixed

1. **Unsafe mandatory predicates across OR.** For `file.inFolder("A") && status == "open" || status == "done"`, B0 inferred that every matching row must be in A. It could skip changes to matching notes elsewhere. A top-level OR now disables extraction for that expression. An independent AND sibling outside a parenthesized OR remains usable. Quoted operators, single-quote escapes and malformed parentheses are handled conservatively.
2. **Tag removals beyond a result limit.** `selected` contains only the limited result set. A matching note beyond that limit could lose a required tag and be classified as irrelevant, leaving the total stale. A tag skip now requires both the pre-edit and current text to prove exclusion. Unknown previous text forces a refresh. The first pre-edit text is retained until the corresponding save notification; folder misses remain decidable without text.
3. **Hidden and outside edits could bypass scheduling.** Hiding a tab with a pending timer did not cancel it unless another edit arrived. Separately, `vault.onModified` always scheduled a rebuild, including hidden views and saves of excluded notes. Hiding now cancels pending work and records deferral. Every scheduled callback rechecks visibility, and modified-file notifications use the same visibility/pre-filter path. The Base's own file still sets `reload` and is re-read on reveal.
4. **Deferred work could be lost on an outside edit.** A known outside edit could clear the deferred flag without scheduling the earlier work. That case now schedules the outstanding refresh. An outside edit still leaves an existing pending timer intact.

The new unit cases reproduced **6 failures out of 10** against original B0; all **10 passed** with the fixes. The remaining four already passed against B0. No failed assertion was weakened to make the fixes pass.

## Scope

Original B0 changed only `bases/view.ts`, `bases/view.test.ts`, `scripts/test-bases.mjs`, and its notes. The helpers/imports in `view.ts` support the workspace-change handler. Its original browser assertion adjustment is justified: the note save and doc quiet delays are both 300 ms, so testing that the file is unsaved after the result changes was racy. The new browser test additionally holds the save promise and proves the table uses unsaved properties.

This review changes only scheduling/pre-filter helpers in `view.ts` and tests. `model.ts`, `expression.ts`, `update()`, paint/render logic, styles, Rust, package manifests and dependencies are unchanged. No new margins, menu animations or packages/crates were introduced.

Diff from `dba5a78`, excluding this notes file:

- `app/src/bases/view.ts`: **+40 / -13**.
- `app/src/bases/view.test.ts`: **+53 / -2**.
- `app/scripts/test-bases-b0.mjs`: **+141 / -0**, new permanent browser regression/performance check.
- `app/scripts/test-bases.mjs`: **+2 / -0**, runs the new check in the full suite.
- Total product/test change: **236 insertions, 15 deletions**.

## Browser proof and performance

The new harness generates 5,000 matching notes in the in-memory mock vault, in addition to the bundled sample notes. It uses a required folder/tag filter, a status predicate, a formula column and two sort keys. Native pointer/key input types five characters with 100 ms pauses. Holding saves separates doc scheduling from saved-file notifications and proves an unsaved `status: done` removes a row before the file changes on disk. Files and links refreshes are explicitly checked.

- Before B0 (`4c6eb51^`): **5 rebuilds during the burst**. Original B0 and the fixes: **0 during typing, 1 after the quiet period**. Maximum typing frame was at most **16.8 ms** in every comparison session.
- Original B0 skipped the outside-folder doc event but rebuilt on its save: **0 then 1** rebuilds. The fixes: **0 then 0**. Explicit files/links changes still refresh.
- Original B0 performed **1 hidden pending update, 2 total after a hidden Base-file modification**, then **0 on reveal**. The fixes perform **0 while hidden, then 1 on reveal**, showing the updated Base source.
- Today's pane host disposes a Base when switching its tab. A retained-view fixture therefore tests the hidden lifecycle independently, using the real Base DOM, property index, modified-file callback and timers. It does not claim the current host retains hidden tabs.

**Performance flag:** separate fresh-browser DOM-readiness samples showed slightly higher medians with the fixes: warm **29.15 → 30.85 ms (+1.70 ms)** and cold browser opens **55.50 → 58.10 ms (+2.60 ms)**, two sessions per variant with three warm opens each. Earlier animation-frame polling samples also varied with session order. These raw increases are recorded rather than hidden as “no regression.”

To distinguish session variation from view work, a temporary harness loaded both versions into **one browser**, alternated their order, warmed both six times and measured **20 pairs per case**. Warm-index means were **24.13 → 24.33 ms (+0.20 ms)**; medians **23.90 → 24.30 ms**. Fresh-workspace-index means were **37.50 → 37.33 ms (-0.17 ms)**; medians **36.70 → 37.15 ms**. The paired-difference standard errors were 0.33 / 0.51 ms respectively. This does not establish a consistent added cost beyond the observed variation; all opens remain far inside the **150 ms** target. The paired fixture's fresh index is not a cold browser, so its figures are not interchangeable with the preceding cold-open figures.

In the full suite, the new harness measured a **57.9 ms** cold open, warm opens **29.7 / 28.8 / 26.8 ms**, **16.8 ms** maximum typing frame, and the expected 0/1 burst/quiet updates. Existing checks measured a **11.6 ms** warm 1,000-row open, **16.8 ms** maximum 1,000-row scroll frame and **16.7 ms** Configure view frame. No performance assertion was relaxed. These are browser-mock results, with no Rust IPC; keep the small timing flag visible in the integration benchmark rather than interpreting this review as proof of zero overhead.

## Checks

All heavy runs used `/tmp/grove-npm-test.lock`; `npm test` was invoked as `flock /tmp/grove-npm-test.lock npm test`.

- `npm run build`: passed; the existing Vite large-chunk warning remains.
- Full `npm test`: **passed on its first run**, including **59 files / 683 unit tests**, every browser/geometry/real-pointer script, the new 5,000-note regression harness, and `posttest` (`test-bases-config.mjs`). No flake retry or skipped script.
- `npm run audit:offline`: passed; **166 source files**, dist, CSP, capabilities and dependencies checked.
- `cargo build --offline`: passed.
- `cargo test --offline`: **58 passed, 0 failed, 2 ignored**; binary/doc-test targets also passed.
- Baseline/review comparisons and the final paired run exited successfully. Original-code regression failures were intentional and recorded separately from the passing review runs. Temporary benchmark modules/scripts were removed.

Behavior sources were `BASES_PLAN.md` sections 2/6/8, `NOTES_BASES-B0.md`, and Grove's workspace, vault, editor-save and view code. This reviews Grove scheduling, not an Obsidian gesture. No public pages were fetched, no Obsidian code/assets were used, and no network, GUI window, real vault, other worktree or Herdr pane was used. Browser test vault contents stayed in memory. Git hooks were disabled for branch/commit operations with `core.hooksPath=/dev/null`; no Codex hooks were trusted or run.

Generated `rebuild/round*-shots` files were restored before each commit. Prompts and logs are excluded. No push or rebase. No functional fixes remain open within B0; the small performance measurements above are the integration watch item.
