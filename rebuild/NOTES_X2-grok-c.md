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
