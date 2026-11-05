# PR1 review

VERDICT: OK-WITH-FIXES

Reviewed `f0effff..d152a9e` on `rebuild/pr1-review-codex`, the Canvas presentations PR1 section of `rebuild/CINDER_GAP_PLAN.md`, and the author's `PR1-grok-a.md` (read only).

The implementation matches the intended group-first/card-fallback ordering, reading-order rows, deterministic arrow traversal, cycle termination, nested groups, and selection start. The six original tests meaningfully exercise the planned cases, including branches, joins, separate chains, ignored card edges, and arrowhead behavior. The diff adds only two TypeScript files: no runtime wiring, packages, crates, network behavior, or third-party code/assets.

## Fix

`readCanvas` accepts empty-string node IDs. The traversal's truthiness check skipped such slides when edges existed, including dropping an entire chain starting at that ID. Changed the loop to check `id !== undefined` and added a regression covering an empty ID both at the start and in the middle of a chain, including selection.

Fix commit: `31f7a2d` (`Fix presentation traversal for empty-string slide IDs`), committed locally on `rebuild/pr1-review-codex`. The follow-up authorized approval requests for local Git operations; approved execution resolved the earlier sandbox restriction. Nothing was pushed.

## Verification

- `npm run build`: passed; existing chunk-size warning only.
- `vitest run src/canvas/slides.test.ts`: 7 passed.
- `npm run audit:offline`: passed (205 source files, dist, CSP, capabilities, dependencies).
- `cargo test --offline`: 102 passed, 4 ignored, no failures.
- `git diff --check`: passed.
- `flock /tmp/grove-npm-test.lock npm test`: passed, exit 0, including posttest. Vitest: 88 files, 1,421 tests passed. The sandboxed attempt failed at browser discovery; the approved run outside the sandbox passed. No timing-flaky failure or retry was needed.

The module has no runtime import yet, and this one-condition fix does not change its complexity. Existing suite performance checks passed: note switch median 33 ms; typing, switcher, and folder expansion maximum frame gap 16.8 ms; 10,000-row sort 22.5 ms; 10,000-row scroll p95/max 16.8 ms; Kanban 10k drag p95 16.8 ms and maximum handler 0.500 ms. These match the author's reported feel results. The existing graph gap remains explicitly held by the suite (p95/max 33.4 ms). K7 fuzz passed 48 cases with seed 27447. All rewritten `rebuild/round*-shots/` files were restored before committing.

## Remaining issues

None found within PR1's scope. Presentation-mode integration remains PR2 as planned.
