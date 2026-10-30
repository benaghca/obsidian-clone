# Bases B5 — Group by and Summaries

Completed on `rebuild/bases-b5-codex`, based on integration `08641e4`. Local implementation commits: `7a1690d` (computation, parsing, presentation and units), `8220e74` (menus, host hooks, browser regressions and benchmark). This file is the final documentation commit. Nothing was pushed.

## Changes and ownership

Code and tests total **+933 / −4** across ten files:

- New `app/src/bases/groups.ts`: +394. Typed grouping, cooperative sorting, byte-preserving setting writes and shared virtualized presentation.
- New `app/src/bases/summaries.ts`: +171. All 14 built-ins, custom B1 expressions, group/overall accumulation and sliced evaluation.
- New `app/src/bases/groups.test.ts`: +71; new `summaries.test.ts`: +79. Together these add 44 focused cases.
- `app/src/bases/model.ts`: +4 / −1, restricted to parsing and exposing grouping/summary configuration.
- `app/src/bases/menus.ts`: +16 / −1, restricted to the property header menu.
- `app/src/bases/view.ts`: +7 / −2, clearly marked B5 imports/call sites, described below for B4.
- New `app/scripts/test-bases-groups.mjs`: +90; new `bench-bases-groups.mjs`: +100. `test-bases.mjs`: +1 to run the new browser regression as part of the full suite.

No changes to `embed.ts`, `editor/embeds.ts`, `cards.ts`, shared styles, `write.ts`, Rust, dependencies or package scripts. No work from the separate RUST_PERF_PLAN was implemented. BASES_PLAN §5 explicitly keeps expression evaluation, grouping and summaries in TypeScript over the existing Rust metadata, preserving unsaved note data and one expression language.

## Behavior and decisions

Grouping accepts `groupBy: {property, direction}` per view, defaults direction to ASC, preserves existing selected-row order within each group and places the empty group last in both directions. Headers show the value and row count. Collapse is local presentation state scoped by view/property and survives re-evaluation; it never saves YAML. Keyboard activation uses Grove's existing `pressable` helper, and focused group buttons survive repaint and data refresh.

Null, an empty string and an empty list share the empty group. Zero, false and whitespace are populated values. Numbers, booleans, dates, durations, links and ordered lists have bounded typed identities; date strings and typed dates representing the same instant share an identity. Links compare by path rather than display alias. A list is one whole ordered grouping value, and Unique counts whole ordered list cells, excluding root empties. Rows are not duplicated into separate tag groups. These edge choices are explicit Grove behavior, not a claim of live Obsidian parity. Invalid grouping values join Empty with a visible notice.

The header menu offers Group by this property, direction changes, Clear grouping and Summarize. Summarize offers None; Count, Empty, Filled, Unique, Sum, Average, Min, Max, Range, Median, Earliest, Latest, Checked, Unchecked; and top-level custom definitions. Card property labels open the same menu. Per-group footers and the overall footer show read-only results for selected columns; a table's overall footer is sticky. Changes to source notes recompute the totals. CSV/Copy continue using the existing filtered, sorted and limited selected records, without injecting presentation headers or summary rows.

Numeric aggregates ignore text, booleans and other nonnumeric values. Checked/Unchecked count strict booleans. Sum of no numeric values is zero; Average/Min/Max/Range/Median without numeric values are empty. Date extrema use the existing strict date parser and return typed dates. Sum uses compensated accumulation; Average has a finite weighted fallback for overflowing sums, and even-sized Median avoids overflowing the pair addition. Nonfinite results are visible formula errors. Count counts rows even when a cell fails; other aggregates propagate an encountered cell error rather than hiding it.

Custom definitions compile once through B1. They receive `values`, scalar aggregate getters such as `count`, `sum`, `average`, and `formula.other` references to other custom definitions. Unknown names, parse/runtime failures and cycles produce error results. Lazy B1 branches remain lazy. The menu saves custom selections as `custom.name`, so a custom name can coexist with a built-in name. Error summary cells display `#ERROR!` with detail in the title; notices are deduplicated and bounded.

B1's 10,000-element expression-list cap is retained. A custom summary accessing `values` above that size returns an explicit error, without truncation. Scalar formulas such as `sum / count` work over 50,000 rows; a lazy branch can avoid the oversized list. Both paths are tested. The optional summary host context supplies `this` without file reads.

Saves use the existing queued menu save path. `writeViewSetting` reuses `writeFilters`' existing YAML serializer only for the new block and patches the selected view's byte range. Other views, root definitions, unknown fields, comments outside the replaced block, BOM and CRLF are retained; replacement of an existing final block retains the missing final newline. An appended block uses the existing newline style. No whole-file YAML serialization or viewing-time save was added. Unit and real-mouse browser cases assert exact output bytes.

## Presentation and B4 hand-off

`createGroupedView` owns presentation inside the existing scroller. Variable-height prefix offsets and binary search restrict both table rows and card sections to the viewport plus overscan. Cards reuse the public `createCardGrid` factory, including its covers and disposal. A component-owned `display:contents` wrapper around the table stops the legacy B2 direct-child adapter from mounting a second card renderer and independently evaluating all rows. Plain cards also use the existing CardGrid; plain unconfigured tables retain their existing fast paint path. There are no new menu animations or vertical margins on editor content children.

Large grouping/summary work yields in approximately 5 ms slices, including group sorting and Median sorting. Continuations start after paint (`requestAnimationFrame` followed by a timer). Shared unique keys/date parsing avoid computing them separately for group and overall states. A generation plus the host's obsolete callback cancels stale work. Failed reload and disposal clear prior cards, summaries, notices and busy state.

**B4 merge hand-off:** transfer the marked `view.ts` hooks into the reusable B4 host: imports; presenter construction with the real scroller/table/body, existing editable `cell`, header callback, `createCardGrid` factory and repaint; the early paint delegation; awaited `update` after row selection; `clear` on reload failure; `dispose` on teardown. Preserve the presentation-owned wrapper/single-renderer arrangement. Supply `summaryContext: () => embeddingContext` for an embedded host's custom-summary `this`; a standalone tab supplies none. The B4 host should keep the existing edit guard and pass its cancellation/dirty predicate. No B4 extraction or embed wiring was attempted here. Row-formula error/toolbar wiring outside these grouping/summary results remains the earlier B1/B4 hand-off, not an ownership expansion in B5.

## Measurements

All browser work was headless under `/tmp/grove-npm-test.lock`. The initial baseline was taken before B5 changes. Final measurements below use the unchanged source that passed the full suite.

Existing UI before → after:

- Warm 1,000-note table open: **9.5 → 9.0 ms**; scroll maximum **16.8 → 16.7 ms**.
- B0 5,000-note browser check: cold **42.3 → 41.3 ms**; warm samples before **15.8 / 22.3 / 12.8 ms**, after **18.7 / 14.9 / 11.9 ms** (medians **15.8 → 14.9 ms**). Both runs recorded zero rebuilds during typing, one after quiet, no rebuild for outside-filter edits/saves or hidden changes, and one refresh on reveal. Maximum typing frame **16.8 ms** in both.
- Existing 1,000-card browser check: **25 DOM cards** in both; scroll maximum **19.0 → 17.3 ms**. Lazy covers remained **9/36** initially, with bottom covers loaded on scroll.
- New 1,000 grouped-card real-wheel scroll: **16.8 ms** maximum in the final standalone and full-suite runs, with fewer than 100 card nodes and the last group reachable.

The untouched generator created `/tmp/grove-bases-b5-codex-81k0zcae/vault`: **50,000 notes, 1,999,993 lines, 136,192,467 bytes**, SHA-256 `d5723282df8133e209ea13557f278a83882e3fc2bb0d884b3c29c657d46421be`. The benchmark reads those actual files and filesystem dates, parses frontmatter with Grove's reader and tags with `tagsInText`, then uses their metadata in the browser. It does not substitute 50,000 identical hand-built rows.

Reproduction: `node scripts/gen-vault.mjs /tmp/grove-bases-b5-<unique>/vault 50000`, then from `app`, under the shared lock, `node scripts/bench-bases-groups.mjs /tmp/grove-bases-b5-<unique>/vault`. The benchmark briefly imports `08641e4`'s model from a temporary sibling module for interleaved comparison and deletes it in `finally`; production source is never overwritten.

Seven measured samples after warm-up, interleaving before/current selection on the same generated rows:

- 5k tag filter/name sort: **8.843 → 8.348 ms** median.
- 5k formula sort: **9.402 → 9.244 ms** median.
- 50k tag filter/name sort: **101.327 → 101.646 ms** median, a raw **+0.319 ms / +0.3%** regression worth retaining in the record, not attributing as an improvement.
- 50k formula sort: **177.009 → 176.490 ms** median. The selection algorithm itself was not changed. Other development runs had small positive deltas too; these small movements are not evidence of a selection speedup.

Additional grouping plus four summaries (custom size mean, tag Unique, modification-date Earliest, file-name Count), separately timed after selection:

- 5k / 10 folders: first aggregation **19.11 ms CPU / 24.16 ms wall**, largest slice **5.11 ms**. Three warm samples: **12.01 / 8.86 / 9.39 ms CPU**, **12.89 / 9.25 / 10.92 ms wall**. Warm median CPU **9.39 ms**, within the plan's 20 ms extra-work target. One earlier cold run was **20.22 ms CPU**; cold variance should not be hidden.
- 50k / 100 folders: first **170.34 ms CPU / 210.71 ms wall**, largest slice **5.06 ms**. Warm **112.40 / 110.22 / 109.85 ms CPU**, **135.34 / 132.54 / 131.86 ms wall**. Work is spread across UI turns rather than blocking for the total.
- Headless browser, 50k / 100 folders: **381.5 ms wall**, **122.3 ms measured aggregation CPU**, **5.1 ms maximum slice**, **79 timer ticks**, **16.8 ms maximum frame**, **27 rendered data rows**.
- Headless browser, 50k distinct file-path groups plus Count: **666.1 ms wall**, **203.1 ms CPU**, **5.0 ms maximum slice**, **137 timer ticks**, **16.7 ms maximum frame**, **8 rendered data rows**. This exercises the worst group-cardinality sort/layout rather than only a few large groups.

**Performance limit:** those browser frame measurements cover the new B5 aggregation/rendering phase. Existing synchronous row selection happened before frame collection and took **107.1 / 119.8 ms** in the two final browser scenarios. The whole initial 50k open is therefore not guaranteed to stay below 20 ms; BASES_PLAN's B7 pre-filter remains necessary. Individual B1 expression calls also retain B1's synchronous safety limits; this is cooperative scheduling, not a Worker or preemptive runtime.

An early development stress run missed a frame (**33.2 ms**) despite short slices. Shared parsing/identity work and paint-aligned continuations were then tuned; the final assertions still require frames and slices below 20 ms and were not relaxed.

## Checks and remaining work

- `npm run build`: passed. The existing Vite chunk-size warning remains.
- Exact `flock /tmp/grove-npm-test.lock npm test`: passed, exit 0, including **posttest**. **65 Vitest files / 1,094 tests**, discovery tests and all geometry, real-pointer, canvas, search and Bases browser scripts passed. The new B5 script is included through `test-bases.mjs`.
- The final new browser script also passed standalone: grouping/direction/empty placement; mouse and keyboard collapse; no viewing-time writes; editable-cell totals; custom formulas; byte-exact menu saves; cards; failed-reload clearing and recovery; virtualized real-wheel scrolling.
- `npm run audit:offline`: passed, **173 source files** plus dist/CSP/capabilities/dependencies. Final build/audit/benchmark chain exited 0.
- From `app/src-tauri`, `cargo build --offline` and `cargo test --offline`: passed; **58 passed, 0 failed, 2 ignored**, with binary/doc tests also passing. Rust source was unchanged.
- `git diff --check` and staged whitespace checks passed. Generated `rebuild/round*-shots` were restored before each commit. Prompts, logs, scratch vaults and temporary benchmark modules are not committed. Git hooks were disabled for branch/commit operations as instructed.

The first full-suite attempt was invalidated by my editing a watched module while its Vite browser session was active: a reload caused the Round22 attachment test to see an undefined `ws`. This was my verification mistake, not an unrelated timing flake. Source was frozen for the complete successful rerun. The additional keyboard regression exposed focus/activation problems, which were fixed using focus preservation and the shared keyboard helper before that rerun. No required check remains failing.

Sources: the repository's BASES_PLAN, Rust migration plan, existing implementation and B0–B3 notes/reviews. The plan's public Obsidian help descriptions are prior knowledge; no page was fetched, no Obsidian code/CSS/assets were used, and no live parity observation is claimed. No network, GUI windows, new packages/crates, real vaults, other worktrees or Herdr were accessed.

Remaining integration work is the B4 host hand-off above. The inherited formula-list cap, existing synchronous 50k selection and small raw timing variations are recorded limitations; no decision from Chris is required to complete B5. Stopping after the local notes commit; no push.
