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

## Fix 1

From the Codex review (`FAIL`, two P2s and two P3s). Both P2s and P3 #3 are fixed. P3 #4 (native WebKitGTK pinch and settled text) needs a native session and is not done.

### P2 #1: a press mid-glide no longer jumps to the target
- `navigation.ts`: a pointerdown during a wheel or pinch glide now **stops the glide where it was last painted** (`haltGlide`). Before, it landed the glide on its target (`landGlide`).
  - `state` is already the painted camera, because `glideFrame` draws each camera as it sets it. So nothing moves on the press.
  - The browser hit-tested the press against the board as painted, and that board stays put. A left press reaches the card that is under the pointer.
  - A middle or Space pan uses that camera as its baseline, and so does a card drag (it reads the transform at the press).
  - The band settles by the usual rule, 120 ms after the last zoom input.
- `test-canvas-zoom-glide.mjs`: the instant-landing check is replaced. The page records the world and the pressed card before and after the board's own pointerdown handlers.
  - **Middle press mid-glide:** the painted scale is between the start and the target, it is the same a frame after the press, and it stays the same while the press is held and after release.
  - **Left press on card `a` mid-glide**, away from the wheel's point: the event hits `a`. After the handlers the world scale and `a`'s rect are unchanged and `a` is still under the pointer. The scale stays put while the card is held.

### P2 #2: the speed never jumps across inputs
`zoomGlide.ts` changes:
- A glide now stores its starting **speed** (log2 per ms) instead of a slope multiple. It is a Hermite cubic from that speed down to rest at the target.
- **From rest:** the speed starts at 0 (ease in and out). The old start slope of 2 made the speed jump at the first input.
- **Same-direction retarget:** keeps the board's actual speed. The old floor of 2 sped up a slowing glide in one step.
  - If that speed would overshoot (a start slope above 3), the segment gets shorter instead. It still starts at the board's speed and never passes the target.
- **Reverse retarget:** also starts at the board's speed, so the board slows to a stop and then heads back.
  - The run-on peaks at u = m / (3(m − 2d)), which has a closed form.
  - It must stop short of the old target when that target lies ahead, and short of the zoom limits otherwise. Where it would not, the segment is shortened step by step until it fits; as a last resort it starts from rest.
- `glideAt` clamps each frame to the limits as a backstop, and so does `glideFrame`.
- Fixed while testing: the overshoot test compared unnormalised values, which flipped for zoom-out. It now compares `speed·ms/d > 3`.

New `zoomGlide.test.ts` cases (4, sampled every 0.25 ms). Each one checks:
- in any 0.25 ms the speed changes by under 3% of its peak, across every input;
- the glide starts and ends at rest;
- it lands on the target;
- every sample is within the limits.

The cases:
- five rapid same-direction ticks, and a second tick on a slowing glide;
- a wheel reversal at 20, 60, 100 and 160 ms (the speed crosses zero at most once), plus five alternating ticks;
- a 40-step pinch that opens and then closes;
- a full-speed glide toward 2x (and toward 1/16x) that reverses: the run-on stays at or under the limit.

Two existing unit assertions encoded the old slope and were updated:
- "eased at both ends" now checks a zero starting speed, and the end speed against the mid-glide speed.
- "a reverse tick turns back" now checks that the speed carries over, the board runs on briefly, the run-on stays under the old target, and it lands.

The merge test skips the first two frames of ease-in from rest before it checks for still frames.

### P3 #3: no selection-menu walk on every glide frame
- `navigation.ts` keeps a `MutationObserver` on the world's direct children (`childList` only).
- When no menu is found, that absence is cached until the children change. `takeRecords()` is read before trusting the cache, so a menu appended in the same task is still found.
- A found menu is used as before for as long as it stays attached.
- The observer is disconnected on dispose.

### Existing test adjusted
`test-canvas-edge-titles.mjs`, "a double-click before title mode settles edits the card":
- The old check wheeled toward 0.32 and double-clicked at once. It relied on the press landing the glide on 0.32. With the press now halting the glide at about 0.69, title mode never came.
- It now wheels toward 0.1, waits until the painted zoom is below 0.44 (`paintedBelow`), double-clicks, and reads the editor 20 ms later instead of 80 ms, still before the 120 ms settle.
- Both title-mode assertions are unchanged, and both passed on two runs.

### Results (Fix 1)
One at a time under `heavy`:

| Suite | Result |
|---|---|
| `tsc --noEmit` | clean |
| `vitest run src/canvas/zoomGlide.test.ts` | 9 passed (5 existing + 4 new) |
| `test-canvas-zoom-glide.mjs` | 30 PASS (was 26) |
| `test-canvas-navigation.mjs` | 92 PASS; 300/400 trace: pan 0 drops, zoom 0 drops, rAF p95 16.7 ms |
| `test-canvas-edge-titles.mjs` | 45 PASS (run twice) |

- A notch measured in the browser is still 14 frames over about 217 ms. It is monotone, and the anchor drifts at most 0.005 board px.
- The first frame now moves 0.4% of the scale; before it moved more, from the start slope of 2.
- Not run: the other canvas suites (only waits or unrelated paths touch the glide) and native WebKitGTK.
- The `round23-shots` files the tests rewrite were restored.
