# X2 re-review — Codex

Reviewed `4b81e61` on `rebuild/x2-rereview-codex`, including the X2 row and drawing rules in `CINDER_GAP_PLAN.md`, `NOTES_X2-fix-grok-c.md`, the earlier `fe387b2` review, and the complete intervening diff.

## Geometry and earlier fixes

The previous P1 is resolved. Lines, arrows and freedraw now use placed point coordinates rather than stored dimensions. Bounds follow the same shortened shaft and cubic controls as the painter; derivative roots include cubic extrema outside the point polygon. Arrowhead vertices and circular radii contribute bounds, with padding sufficient for the painted strokes. Single-point freedraw includes its circle radius and stroke. Negative coordinates therefore participate in scene fit.

Rotation uses the centre of the placed point box, independently of the ink box (which can be asymmetric because of smoothing or heads). Scene bounds conservatively rotate the padded ink rectangle about that same pivot. At oblique angles this rectangle can overestimate the ink extent; it safely contains it. Scene union and the additional 16 px viewBox margin include all active strokes; deleted strokes do not enlarge it. No blocking geometry defect found.

`fe387b2` is an ancestor of this branch. Its paint-attribute escaping, open arrowheads and unchanged-file watcher fix remain intact. The intervening renderer change only extracts shared curve controls/arrow size and replaces point bounds/pivots; it does not revert those fixes. Browser checks still exercise the watcher during chunk insertion, transform-only gestures, original file bytes, tab rendering, note embeds (including 400 px), and canvas previews.

Added two regression tests (no production changes): sampling emitted cubic/linear SVG paths and both arrowheads at four oblique positive/negative angles, for line/arrow/freedraw with negative point offsets and deliberately misleading stored sizes; and a rotated single-point freedraw dot with its full stroke. The sample check uses emitted coordinates and transform rather than the renderer's extrema helper. Existing exact-bounds tests cover the cubic bulge and quarter-turn pivots; together these provide independent containment and precise regression checks.

## Scope and remaining limitations

Clean lines remain intentional; roughness and pressure-dependent width are deferred as previously documented. The fix uses elementary SVG/Bezier mathematics and imports only the local scene types. No new dependency, crate, third-party drawing code, font or asset was introduced. No drawing write path was added.

The previous larger limitations remain explicitly listed: the benchmark uses 2,000 rectangles with a shared hatch, not heavy image payloads, complex paths or many distinct patterns; note embeds and canvas cards paint synchronously, whereas large drawing tabs insert chunks. Rotated bounds are conservative rather than the tightest possible fit. None reintroduces the negative-point clipping/pivot defect.

## Validation

- `npm run build`: passed after the additional tests. Existing Vite chunk-size warning remains.
- Renderer tests: 34 passed.
- `npm run audit:offline`: passed (196 source files, dist, CSP, capabilities and dependencies).
- `cargo test --offline`: 84 passed, 4 ignored, no failures.
- Focused headless drawing browser run: passed all tab/embed/card geometry checks, transform-only gestures, watcher completion and byte preservation. `DRAWING_OPEN`: 2,000 elements, 72.8 ms total, no observed tasks over 50 ms. This satisfies the per-task acceptance criterion; total elapsed time is higher than the prior approximately 50 ms samples and is not evidence of equal elapsed performance.
- Full `flock /tmp/grove-npm-test.lock npm test`: passed, including posttest; 82 Vitest files / 1,353 tests. Full-suite drawing benchmark: **50.5 ms total, 2,000 elements, no tasks over 50 ms**, consistent with the earlier approximately 50 ms samples. The focused 72.8 ms sample above shows elapsed-time variability, while both meet the task limit.
- Initial sandbox attempts could not run the browser-discovery child-process check or the local browser server. The full suite and focused browser check passed with process/local-server access outside the sandbox. Browsers were headless and drawing data stayed in the in-memory mock vault; no real vault or GUI window was used.
- Restored test-generated tracked `rebuild/round*-shots/` artifacts. Pre-existing untracked files were left alone. No new packages/crates or prohibited code/assets were added; nothing was pushed.
- `git diff --check`: passed.

VERDICT: OK — the point-based clipping and rotation blocker is resolved, earlier fixes remain intact, expanded geometry coverage and all required checks pass, and the benchmark meets the specified per-task limit. Remaining scope and benchmark coverage limitations are listed above.
