# X2 fix: point bounds and rotation (grok-c)

Branch `rebuild/x2-fix-grok-c`, from the X2 review `fe387b2` (`rebuild/x2-review-codex`). The review verdict was NOT OK. Its small fixes (SVG escaping, open arrowheads, chunk reloads) were already in that commit. This change is the blocking geometry fix. Committed locally, not pushed. No window was opened and no vault was touched. Headless Chromium is the browser test.

## What changed

`rebuild/app/src/drawing/render.ts`. Lines, arrows, and freedraw were bounded and rotated from the stored `x`, `y`, `width`, and `height`. The stroke is drawn from the points. A point can sit up and to the left of that box, so the fitted viewBox clipped it, and an angle turned the stroke about the wrong centre.

For those three types the bounds now come from the points that are actually drawn:

- The polyline, or the smoothed cubic when the element is freedraw or a non-elbowed line/arrow with roundness. The bound uses the cubic's extremes, which leave the polyline. A three-point stroke through `(0,0)`, `(0,60)`, `(60,60)` reaches `x = -40/9` and `y = 60 + 40/9`.
- Arrowhead vertices (bar, arrow, triangle, dot, circle, diamond, and the `_outline` forms), using the same sizes the painter uses.
- Half the stroke on every side, because caps and joins are round. A one-point freedraw is the circle that is painted.

Rotation uses the centre of the point box, then the padded ink is turned about that same centre for the scene bounds. Shapes, text, images, and frames still use the stored box. Roughness is still ignored. Lines stay clean.

A scene that is only a line `x:300, y:200, width:200, height:100, points:[[0,0],[-200,-100]]` (stroke width 2) used to emit `viewBox="275 175 250 150"`, which misses `(100,100)`, and an angle turned it about `(400,250)`. It now bounds `99 99 202 102`, viewBox `83 83 234 134`, and turns about `(200,150)`.

## Snapshot changes

Two fixtures, and only the viewBox and the paper rect. Element paths, arrowheads, and rotation centres are unchanged.

- `excalidraw-web.excalidraw`: `-317 -335 956 718` became `-309 -327 948 710`. The rotated freedraw in the corner no longer carries an extra 8 px of pad. The right and bottom edges stay put.
- `legacy.excalidraw`: `-24.5 -8.5 249 202` became `-18.5 -8.5 235 202`. The old pad on the line and the arrow was wider than the ink. The text and the rectangle now set the edges.

## Checks

- `npm run build` (`tsc --noEmit` and Vite): passed.
- Renderer tests: 32 passed, including the new point-geometry cases (negative line, rotated arrow and freedraw, smoothed bulge, arrowheads, a scene of only those strokes, a deleted stroke that must not widen the scene).
- Drawing browser script, focused runs: line-only, rotated arrow, rotated freedraw, and a scene of only those three, each in the tab, a note embed, and a canvas card. The viewBox contains the turned points, the pivot is the point centre, and each stroke's screen box sits inside the svg.
- 2,000 rectangles, no task over 50 ms. Focused runs: `DRAWING_OPEN {"ms":51.20000000298023,"long":[],"count":2000}` and `{"ms":50.20000000298023,"long":[],"count":2000}`. Full suite: `{"ms":50.599999994039536,"long":[],"count":2000}`. The rectangle path is unchanged. The review's full-suite sample was 50.4 ms and its focused sample 49.9 ms, both with no long task. Elapsed time is the same band.
- Full `flock /tmp/grove-npm-test.lock npm test`: exit 0. Vitest: 82 files, 1351 tests passed. The line-only drawing, the rotated arrow, the rotated freedraw, and the scene of only those three passed in the tab, in note embeds, and on canvas cards. `rebuild/round*-shots/` were restored afterwards and are not in this commit.
- `npm run audit:offline`: passed (196 source files, dist, CSP, capabilities, dependencies). The Vite chunk-size warning is the existing one.
- `cargo test --offline` in `src-tauri`: 84 passed, 0 failed, 4 ignored. Rust was not changed.

## Left from the review

The small findings in `rebuild/REVIEW_X2-codex.md` were already fixed on `fe387b2`. These larger ones stay out of this change:

- The 2,000-element open is rectangles that share one hatch. It does not time large image payloads, complex paths, or many distinct fills.
- Note embeds and canvas cards still paint the whole SVG on one turn. Only the drawing tab chunks past 400 elements.
- Hand-drawn wobble is still later (Choice 3, piece X6). Pressure does not change freedraw width.
