# X2 review — Codex

Reviewed `ee0931f` on `rebuild/x2-review-codex` against the X1/X2 rows, drawing section, and Chris's clean-lines choice in `CINDER_GAP_PLAN.md`. Review fixes are included in this commit. No push, new dependencies, external network requests, GUI windows, or real vault use. Browser tests use the in-memory mock vault; temporary review logs are under `/tmp`.

## Blocking finding

**P1 — point-based geometry is clipped and rotates around the wrong centre.** In `rebuild/app/src/drawing/render.ts`, `layoutBox` / `paddedBox` derive bounds from `x`, `y`, `width`, and `height`; `transformAttr` uses the same nominal box centre. But `placed` draws the actual point coordinates. Lines, arrows, and freedraw may contain negative point offsets. These must contribute their actual geometry to the drawing bounds and rotation pivot.

Reproducer: a single line with `x:300, y:200, width:200, height:100, points:[[0,0],[-200,-100]]`. The emitted path goes from `(300,200)` to `(100,100)`, but the SVG viewBox is `275 175 250 150` (default stroke width 2). Most of the line is outside the viewport, so the tab, note embed, and canvas preview lose it. A temporary Vitest probe confirmed the viewBox excludes `(100,100)`; that diagnostic was removed after the run. With an angle, the renderer rotates around `(400,250)` rather than the points' box centre `(200,150)`, displacing the stroke as well. Existing snapshots exercise negative scene positions but do not catch this negative-offset case.

Left as a larger geometry finding: fix bounds and pivots together for line/arrow/freedraw, account for smoothed-path extrema and arrowhead extents, and add tests for leftward/upward and rotated strokes. This affects ordinary supported drawing content and blocks sign-off.

## Small fixes made

- Escape file-supplied stroke and solid-fill colours at SVG attribute boundaries, including text. The scene model intentionally retains arbitrary strings; previously a colour containing a quote and markup could inject elements into all three `innerHTML` render paths. Added a regression covering shapes, text, and arrows.
- Render stored `arrow` arrowheads as open strokes, distinct from filled `triangle` heads, and keep the shaft connected to the tip. Added a regression and updated the two affected snapshots.
- Preserve in-flight chunk painting when an unchanged-file watcher notification arrives. Previously `load()` cancelled chunks before discovering the bytes were unchanged and returning, leaving a partial drawing. Added a browser regression that sends this notification during the 2,000-element paint.
- Added a browser check that tab viewing, note embeds, pan/zoom, and canvas previews preserve the original drawing bytes.

## Scope and provenance checks

- Shapes, rounded rectangle/diamond geometry, stored arrowheads, smoothed freedraw, stored text size/alignment/coordinates, blob-backed images, own hatch/cross-hatch/zigzag tiles, dashed/dotted strokes, opacity, angle, and dark colour mapping have implementations and fixture tests. Text uses stored placement rather than recomputing wrapping with different system fonts. Pressure-dependent width is intentionally outside the specified smoothed-stroke rendering.
- Roughness is ignored, consistent with clean lines first. Math and unknown types get labelled placeholders; deleted elements are skipped. `.excalidraw.md` remains a note.
- Drawing gestures change the world transform and grid background properties without replacing SVG elements. The focused browser checks confirm unchanged markup on pan and zoom.
- Both note embeds work, including an actual 400 px `|400` embed, and canvas cards lazily display a drawing preview. Object URLs are revoked on replacement/disposal. Drawing views contain read calls and no drawing serialization/write path.
- Inspected the complete X2 diff, renderer helpers, imports, package changes, and shipped asset paths against the prohibited Cinder renderer areas. No indication of copied Excalidraw/Obsidian/rough.js/lz-string implementation, forbidden fonts, or bundled third-party drawing assets. Geometry uses elementary SVG operations; fonts are system stacks. No lockfile, dependency, crate, or binary asset changes. Existing prohibited assets under the legacy `ui/vendor` tree are not imported or shipped by X2. Offline audit passes.
- `git merge-tree --write-tree HEAD rebuild/integration` succeeded without conflicts against integration `1c4f68a`, producing tree `ef3c8036149371c5c1ec1509bbce66e15c956d13` for the submitted X2 head. Integration was not modified.

## Validation

- `npm run build`: passed, including a final run after fixes.
- `flock /tmp/grove-npm-test.lock npm test`: passed outside the sandbox, including posttest; **82 Vitest files / 1,343 tests** and all browser checks. The initial sandbox run failed in the existing browser-discovery child-process test, so the suite was rerun with process/browser access.
- Full-suite drawing benchmark: **2,000 elements, 50.4 ms elapsed, zero observed tasks over 50 ms**. The acceptance criterion concerns individual tasks, not total elapsed time. Independent focused drawing run: **49.9 ms**, zero long tasks, unchanged-file watcher and byte-preservation regressions passed.
- Renderer tests: **24 passed**, with two intentional snapshot updates for open arrowheads.
- `npm run audit:offline`: passed, including a final run after fixes (196 source files, dist, CSP, capabilities, dependencies).
- `cargo test --offline`: **84 passed, 4 ignored**, no failures.
- `git diff --check`: passed. Restored all 61 tracked `rebuild/round*-shots/` artifacts changed by tests; unrelated pre-existing untracked files were left alone.

The 2,000-element benchmark covers rectangles with shared hatch patterns. It does not establish the same timing for every combination of large embedded image payloads, complex paths, or many unique fills. Embeds/card previews also render synchronously rather than using the tab's chunked insertion. These are coverage limitations, separate from the confirmed geometry blocker.

VERDICT: NOT OK — small security, arrowhead, and watcher fixes are included and required checks pass, but supported point-based elements can still be clipped and rotated incorrectly.
