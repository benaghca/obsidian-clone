# X2: read-only drawings (grok-c)

Branch `rebuild/x2-grok-c`, from `rebuild/x1-review-gemini` (`c208b09`, review `3eb5e8c`). Piece X2 of `rebuild/CINDER_GAP_PLAN.md`. Committed locally, not pushed. No window was opened and no vault was touched. Headless Chromium is the browser test.

## What I built

The renderer is TypeScript (`rebuild/app/src/drawing/render.ts`). A Tauri round trip for each paint would miss the 50 ms open budget, so the drawing stays in the web view. `scene.ts` is unchanged. Nothing here is copied from Excalidraw, Cinder, or Obsidian, and no package or crate was added.

- **`renderDrawing(scene)`** returns an SVG document: rectangles, diamonds, and ellipses with stored roundness; lines and arrows with stored arrowheads; freedraw as one smoothed stroke (pressures stay in the file); text at its stored size, alignment, and box, growing the box when the lines do not fit; images from `files` through a `blob:` URL; solid, hachure, cross-hatch, and zigzag fills from our own pattern tiles; dashed and dotted strokes; opacity; rotation about the box center. Roughness is ignored, so lines stay clean until a later piece adds wobble.
- Deleted elements are skipped. Unknown types, including `embeddable` and `math`, draw as a labelled box. Element links are not wired. A missing image is a dashed labelled box.
- **Dark mode** remaps colour in the renderer. Near-white mixes toward `#1e1e1e` and near-black toward `#f5f5f5`. The mix is capped, so `#ffffff` becomes about `#303030` and `#1e1e1e` about `#b2b2b2`. Mid colours such as `#a5d8ff` stay. Transparent stays transparent. The SVG is not CSS-filtered.
- **`openDrawingImages`** turns each file's data URL into an object URL locally (`atob` into a `Blob`). `revoke` drops them. Snapshots inject stable `blob:drawing/…` hrefs and contain no base64 and no page links. The only `http` URL in the markup is the SVG namespace.
- **Drawing tab.** `.excalidraw` opens as view type `drawing` (pencil icon). Pan and zoom change only the world CSS transform, plus the grid background size and position. Element markup stays put. Zoom is about 1/64–16. An empty drawing stays at scale 1, centred. A scene of more than 400 elements paints a shell, then appends chunks of 200 on `setTimeout(0)`. A file over 80 KB parses on one turn and builds SVG on the next. `JSON.parse` is not split.
- **Note embeds** `![[x.excalidraw]]` and `![[x.excalidraw|400]]`. The sized embed sets the SVG width. The unsized one leaves height to CSS.
- **Canvas file cards** lazy-load a preview with class `is-drawing` (not `is-image`). A double-click opens the drawing when the board is not zoomed out.

## Checks run

- `npm run build` (`tsc --noEmit` and Vite): passed.
- `flock /tmp/grove-npm-test.lock npm test`: passed (exit 0).
  - Vitest: **82 files, 1,341 tests passed** (X1 was 81 files, 1,319; the new file is the 22 SVG snapshot and shape tests).
  - Drawing browser script, inside that suite: wheel pan and zoom change only the world transform; both embeds appear and the `|400` embed is 400 px wide; the canvas card shows the drawing.
  - **2,000 rectangles** (every fifth hachure, one shared pattern): `DRAWING_OPEN {"ms":49.2,"long":[],"count":2000}`. The long-task observer recorded nothing, so no main-thread task was over 50 ms. An earlier run of that script alone was 50.3 ms, also with no long task.
  - Existing benches stayed inside their limits (canvas lazy open had no long task; base embed cold open 25.6 ms; list and kanban scroll frames at 16.8 ms).
- `npm run audit:offline`: passed (196 source files, dist, CSP, capabilities, dependencies).
- `cargo test --offline` in `src-tauri`: **84 passed, 0 failed, 4 ignored**. Rust was not changed.
- `rebuild/round*-shots/` was restored with `git checkout` after the suite and is not in the commit. The suite had rewritten `round30-shots/performance.json` to an 8.7 ms open and a 16.8 ms scroll frame; the stored file stays at 9.1 ms and 16.7 ms.

## Things to know

- **Roughness is unread.** Choice 3 A: clean lines first. Wobble is a later piece.
- **Freedraw** paints one smoothed stroke. Pressures remain in the file and do not change the width.
- **`.excalidraw.md` is untouched**, and element links (`https://…`, `[[note]]`) are not drawn. Those are later pieces.
- **Frames paint first**, then the other elements in file order. A frame that is last in the file still sits behind the shapes.
- **Two drawings on one page** use different pattern id prefixes (`dw`, `em`, `card` plus the canvas node id).
- The open button on a note embed passes the resolved vault path, so a miss cannot create a `.md` note.

## Merge with integration 7ba7d09

Branch `rebuild/x2-merge-grok-b` from `a9032eb` (reviewed X2, re-review VERDICT OK). `git merge --no-ff rebuild/integration`. Integration is `7ba7d09`, which is `5760368` plus the P0 merge (`8f2a6c5`).

Conflicts:

- `rebuild/app/package.json`. The `test` script is the union of both sides: integration's `node scripts/test-feel.mjs` (after the zoom trace) and `node scripts/test-template-merge.mjs` (after `test-paste.mjs`), and X2's `node scripts/test-drawing.mjs` at the end. `posttest` was already the same on both sides.

`canvas/view.ts` and `main.ts` auto-merged. Canvas file cards still pass the canvas path into `canvasCards`, and an `.excalidraw` file card still paints as `is-drawing`. `main.ts` loads `drawing.css` and calls `installHitchMeter()`.

Checks, from `rebuild/app` (cargo from `src-tauri`):

- `npm run build` — exit 0. `tsc --noEmit && vite build`, 2145 modules. The chunk-size warning is the existing one.
- `flock /tmp/grove-npm-test.lock npm test` — exit 0. No timing flake, no rerun. Vitest: 84 files, 1383 tests, including 444 parity and the drawing renderer (34) and scene (37) tests. Geometry stayed within 1px. Ctrl+o frames were 16.7–17.0 ms. `test-paste.mjs`: 53 converter cases, plus the empty paste (one mock read, undo leaves the file) and the canvas image card (aspect inside 400px, on the pointer, one undo). Template merge browser checks passed. `test-drawing.mjs`: wheel and zoom change only the world transform, the `|400` embed is 400px wide, the canvas card shows the drawing, and `DRAWING_OPEN {"ms":49.9,"long":[],"count":2000}`. 300-card pan and zoom stayed under 20 ms. 300-card drag max 16.8 ms (49 intervals). Create and reconnect drag max 16.8 ms. K8 10k scroll: p95 16.8 ms, max 16.8 ms, scrollTop 279218. Kanban edge 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 140000. Bases edge 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 160000. Property fuzz `cases=48`. `LEDGE_TYPE` max 16.8 ms, p95 16.7 ms. `LEDGE_SWITCH` max 16.8 ms, p95 16.8 ms. `LEDGE_BENCH`: `embed_section` 0.1 ms, `link_targets` 1.94 ms, `tag_tree` 3.15 ms. Feel test printed the held graph gap (p95 33.4 ms, max 33.5 ms) and passed.
- `npm run audit:offline` — passed. 199 source files, dist, CSP, capabilities, and dependencies. The script runs the build above.
- `cargo test --offline` — 102 passed, 0 failed, 4 ignored (`set_property_bench`, `crash_child`, `bench_vault`, `bench_search_commands`). X2 did not change Rust; these are the integration tests.

`rebuild/round*-shots/` was restored with `git checkout` after the suite.
