# R2 CZ: canvas zoom, crisp and smooth (Claude)

Branch `rebuild/r2-cz-claude`, from `rebuild/integration` 76ce52d (the brief).

## What caused each problem

### 1. Blurry when zoomed in

`.canvas-world` had a permanent `will-change: transform`. Edge labels and the selected card had one too. So the board was always a composited layer, and every frame of a pan or zoom only changed that layer's transform.

- **WebKitGTK** is the engine Grove runs on (Tauri 2 on Linux). It rasters a composited layer at device scale, one layer pixel per CSS pixel. It then has the compositor stretch that bitmap by the layer's CSS `scale()`. It does not re-raster at the transform's scale.
  - At 200% every glyph is a 2× upscaled bitmap, so it looks fuzzy.
  - Below 100% the bitmap is shrunk, so it still looks sharp. That matches "blurry when zoomed in".
- WebKit also composites an element that has a transform when any of its descendants is composited. So the `will-change` on edge labels and on the selected card was enough to keep the whole board a stretched layer, even without the world's own `will-change`.
- **Headless Chromium** (what the test harness drives) does not show the blur. I checked this before changing anything: with the old CSS, card text measured as sharp at 2× as at 47% (screenshot pixel-edge contrast, p90 191 vs 186). Chromium re-rasters that layer at the new scale. That is why no test caught the blur.
- **Not verified in WebKitGTK itself.** I may not open app windows, and a WebKitGTK snapshot of an offscreen view paints without the compositor, so it would not show the blur. The cause above is reasoned from how WebKit's coordinated-graphics compositor works, not measured. Chris's eyes in the app are the check.

### 2. Steppy, snappy zoom

`navigation.ts` applied each Ctrl+wheel (or pinch) step to the camera in full on the next frame. One wheel notch was one jump of 2^(1/3) (26%). Quick ticks were a run of jumps with still frames between them. There was no easing anywhere in the wheel path.

## What changed

### Crisp at rest (canvas.css, navigation.ts, editing.ts)

- **The board is a layer only while it moves.**
  - `navigation.ts` adds `is-moving` to the world on any moving frame: Ctrl/Space+wheel zoom, wheel pan, Space or middle-drag pan, the zoom glide, and presentation glides.
  - It removes the class 120 ms (the existing settle time) after the last moving frame, or at once when the zoom band settles.
  - CSS:
    - `.canvas-world.is-moving { will-change: transform }`
    - `.canvas-world.is-moving .canvas-edge-label { will-change: transform }`. This keeps CZ3's finding that labels must be their own layers during a gesture.
- **A dragged card is a layer only while it moves.**
  - `editing.ts` adds `is-dragging-cards` to the world on a drag's first real move and removes it when the drag ends.
  - `.canvas-world.is-dragging-cards .canvas-node.is-selected:not(.is-editing) { will-change: transform }` keeps what the old rule was for (smooth card drags on large boards).
- **At rest nothing on the board asks to be a layer.** The engine paints text, edges and images at the zoom they are shown at, so they are crisp at every level.
- Every toggle is one class on the world. No card, label or ring is restyled or mutated by it; the existing "transforms one world without changing card DOM" check still passes.
- **Cost.** Each gesture now creates a layer at its start and repaints once at its end. In the 300-card / 400-edge trace both pan and zoom had 0 compositor drops (the ceiling is 6). Numbers are below.
- **During a zoom in WebKitGTK** the moving layer is still drawn from its device-scale bitmap. Above 100% the text can soften while it glides and sharpens when it lands. At rest it is always crisp, which is what the brief's checks ask for ("at high zoom and after settling").
  - Making it sharp mid-glide in WebKit too would mean re-rastering every frame (lag on big boards) or a deeper restructure, which I did not do.
  - In Chromium it is sharp during the glide as well.

### Smooth zoom (zoomGlide.ts, navigation.ts)

- **New `src/canvas/zoomGlide.ts`: pure, unit-tested math.**
  - A wheel tick or pinch step moves a *target*. The camera glides there in log2(scale), so a notch feels the same at every zoom.
  - Each segment is a cubic from the current position and speed to the target. It ends with zero speed and is monotone: it never overshoots, so it can never pass the 1/16–2 limits.
  - A glide starts as a quadratic ease-out, so it answers at once without a jolt.
  - A tick that arrives mid-glide starts a new segment from the current position, keeping the current speed when it heads the same way. Rapid ticks become one continuous glide.
  - Duration: 110 ms for tiny pinch steps up to 200 ms for a full notch or more. It is bounded by the last input, not by the distance.
- **Every glide frame zooms around the last input's screen point** with the existing anchor formula (`zoomAround`), so the board point under the cursor stays under it.
- **Final scales match the old ones.**
  - The target is computed exactly as before (`clamp(previous target × 2^(−deltaY/300))`), so a finished glide lands on the same scale.
  - The exact 45% / 55% title-mode edges still work, and a wheel at the cap is still a no-op that postpones settle.
- **Settle and band.** Glide frames go through `draw()` as wheel frames, so bodies pause and the zoom band waits as before. When a glide lands, the band applies at once if the input rested 120 ms or more; otherwise it applies 120 ms after the last input.
- **Interactions with a running glide:**
  - A press on the board lands it on its target at once. A pan, card drag or double-click then works from the zoom that was asked for; card drags read the transform at the press. The band follows the usual settle.
  - Zoom buttons, Fit, zoom-to-selection and presentation jumps or glides cancel it. Zoom in/out build on the glide's target.
  - A resize lands it on its target.
  - A Ctrl+wheel with zero delta (a sideways Ctrl-scroll, or the redraw that measure-zoom and the tests send after setting the viewport) only redraws, as before. The dev-only measure-zoom command waits 250 ms for the last glide to land before it restores the viewport.
- **Pinch.** A trackpad pinch that arrives as Ctrl+wheel uses the same path. Safari-style `gesturestart/change/end` events (WebKit on macOS) drive the same glide, and while one runs the duplicate Ctrl+wheel is ignored.
  - WebKitGTK does not send gesture events. If its own touchpad pinch never reaches the page as Ctrl+wheel, that is native and outside this piece.
- **Unchanged:** pan, keyboard shortcuts (Shift+1, Shift+2, Space), zoom buttons (still instant), the limits, the wheel rate and the look.

## Tests

### New
- `src/canvas/zoomGlide.test.ts` (vitest, 5 tests):
  - the anchor point is fixed on every frame;
  - glides land exactly on the target with zero speed, are monotone, have no overshoot, are eased at both ends and are bounded in time;
  - rapid ticks merge: no jump at a retarget, no whole-notch frame, no still frame, and the glide lands on the product of the ticks;
  - a same-direction tick keeps its speed and a reverse tick turns back;
  - the limits hold on every frame of long bursts, and a wheel at the cap changes nothing.
- `scripts/test-canvas-zoom-glide.mjs` (browser, native CDP wheel input, per-frame transforms recorded in the page):
  - **a notch:** lands on 2^(1/3), animates over several frames, monotone, eased at both ends, lands in about 200 ms, anchor drift under 0.01 board px;
  - **five quick ticks:** one continuous glide with no still frames and no whole-tick frame, lands on the sum, anchor fixed;
  - **a 40-step pinch:** smooth, lands on the sum, anchor fixed;
  - **±50000 wheels:** glide to exactly 2× and 1/16× and no frame passes them;
  - **a press mid-glide** lands it on its target at once;
  - **crispness** (Chromium layer tree via CDP `LayerTree`, plus computed styles):
    - mid-zoom the world and edge labels are layers and the compositor scales one board layer;
    - at rest at 2× no board element has `will-change`, and no drawn layer has a scale;
    - after a pan at 2×, with a selected card, and after a card drag, no layer is left behind;
    - a dragged card is a layer only while it moves;
    - text at 2× after settling is as sharp as at 100% (screenshot edge contrast).
  - Added to `npm test` after `test-canvas-navigation.mjs`.

### Existing tests adjusted
Only waits were changed; no assertion was changed. A wheel zoom now takes up to 200 ms to land.
- `test-canvas-navigation.mjs`: waits for the world to stop moving (`glided()`) before reading the landed scale (pointer zoom, max/min zoom, Space+wheel, the title-mode wheels). The "content returns once the wheel rests, not mid-gesture" check still reads mid-glide.
- `test-canvas-edge-hover.mjs`, `test-canvas-edge-menu.mjs` and `test-canvas-lazy.mjs`: waits of 180–200 ms after a zoom wheel became 400 ms.
- `test-canvas-edge-titles.mjs`: this one assumed a wheel is fully painted one frame later.
  - Where it needs the landed zoom, it waits for the world to stop moving (`landed()`).
  - Where it checks that "the zoom is painted past 55% while title mode still waits", it waits mid-glide until the painted scale is past 55% (`paintedAbove`).
  - The out-and-back wheel computes its delta from the glide's target.
  - The "pan during the settle" check now measures the pan by the board point under the wheel (which the glide keeps fixed) instead of requiring an unchanged scale, since the glide is still running.
  - Every title-mode assertion is unchanged.

### Results
Final run, one script at a time under `heavy` (Chromium 155 headless, software raster):

| Suite | Result |
|---|---|
| `tsc --noEmit` | clean |
| `vitest run src/canvas` | 59 passed (includes the 5 new `zoomGlide` tests) |
| `node --test test-canvas-zoom-trace.mjs` | 2 passed |
| `test-canvas-zoom-glide.mjs` (new) | 26 PASS |
| `test-canvas-navigation.mjs` | 92 PASS |
| `test-canvas-edge-titles.mjs` | 45 PASS |
| `test-canvas.mjs` | 34 |
| `test-canvas-present.mjs` | 48 |
| `test-canvas-lazy.mjs` | 14 |
| `test-canvas-editing.mjs` | 36 |
| `test-canvas-drag-work.mjs` | 15 |
| `test-canvas-cards.mjs` | 48 |
| `test-canvas-controls.mjs` | 46 |
| `test-canvas-edges.mjs` | 54 |
| `test-canvas-edge-controls.mjs` | 75 |
| `test-canvas-drops.mjs` | 65 |
| `test-canvas-hit-area.mjs` | 18 |
| `test-canvas-notes.mjs` | 38 |
| `test-canvas-hover.mjs` | 34 |
| `test-nested-hover.mjs` | 34 |
| `test-canvas-edge-hover.mjs` | 47 |
| `test-canvas-groups.mjs` | 82 |
| `test-canvas-board-menu.mjs` | 61 |
| `test-canvas-edge-menu.mjs` | 159 |
| `test-canvas-create.mjs` | 72 |
| `test-canvas-bases.mjs` | 34 |

All exited 0.

**Big-board cost** (300 cards / 400 edges, fitted, 24 native inputs, `test-canvas-navigation.mjs` trace):

| Gesture | Compositor drops | Main ms/step | Raster ms/step | Long tasks |
|---|---:|---:|---:|---|
| Pan | 0 | 1.8 | 6.3 | none |
| Zoom (now gliding) | 0 | 2.2 | 7.5 | none |

- The gate is 6 drops; CZ1 recorded 2 for pan and 0 for zoom.
- rAF gaps: p95 16.7 ms, max 16.8 ms.
- A glide frame writes only the world transform and the grid, as before, so its work does not grow with the board.

**Glide shape, as measured in the browser test:**
- A notch is 14 frames over about 217 ms, monotone, with no overshoot.
- The anchor drifts at most 0.004 board px.
- Five ticks 30 ms apart give no still frames and at most 0.07 octave per frame. Before this change each tick was a single 0.2-octave jump.
- Text sharpness at 2× after settling is 193, against 197 at 100% (p90 pixel-edge contrast).

**Not run:** the rest of `npm test`, which is not canvas work, and the CZ0 bench (`bench-canvas-zoom.mjs`). Not checked in WebKitGTK itself (see above): Chris should zoom to 200% in the app and look, during and after a zoom.

## Rules
No new crates or npm packages. No network. No Obsidian or Excalidraw code or assets; the behaviour is built from the brief. No GUI window was opened and Grove was not launched. Test vaults were only the harness's scratch mock vault. The `round23-shots` files the tests rewrite were restored before committing.
