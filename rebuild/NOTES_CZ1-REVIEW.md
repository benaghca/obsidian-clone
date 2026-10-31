# CZ1 review

VERDICT: OK

Reviewed `rebuild/canvas-cz1-claude` (`dee5f5d`, notes `4aa52be`) on `rebuild/cz1-review-grok`. One fix is on this branch: `fbe7816`. Nothing was pushed. CZ-H and the empty-canvas menu (CZ4) were left alone.

## What CZ1 does

Z1, Z2 and Z7 from `CANVAS_ZOOM_PLAN.md`, plus two small pieces so a zoom frame does not restyle the board:

- The per-canvas stylesheet that rewrote `--canvas-inverse-scale` and the four view bounds every frame is gone. The selection menu gets those five values as inline styles. Handles, connection points and edge hit paths read one static zoom-band sheet (`zoomBand`, quarter-octaves from 1/16× to 2×, 21 bands). The sheet is installed once on `document.adoptedStyleSheets` and is not removed on dispose. It is scoped to `.canvas-world[data-zoom-band]`, so a closed canvas does not leak a stylesheet. `test-canvas-edges.mjs` checks that leaving and reopening share exactly one such sheet and no `#canvas-world-` sheet.
- Card bodies are `overflow: hidden` until the card is selected or edited. Image cards keep a more specific `overflow: hidden`. Note cards keep `scrollbar-gutter: stable`.
- The wheel reads a cached rect, cleared on resize and `pointerenter`.
- Connection dots are created on hover or selection, not four per card up front.
- The menu's `:has()` over the board is now the class `is-editing-label`, set by `editCanvasLabel`.
- `will-change: transform` is still on the world, edge labels and selected cards.

`git diff --numstat 18f43a9..4aa52be` is Claude's commit: `navigation.ts` +57/−21, `editing.ts` +10/−3, `labels.ts` +5/−2, `canvas.css` +5/−2, `controls.ts` +1/−1, `test-canvas-navigation.mjs` +22/−1, `test-canvas-edges.mjs` +5/−3, plus `NOTES_CZ1.md`. The review fix `fbe7816` is `navigation.ts` and `test-canvas-navigation.mjs`, 72 insertions and 13 deletions.

## Settle fix

Claude's `draw()` applied the zoom band on any frame that was not a wheel, and it did that only when the viewport key changed. Two holes:

- A pan or Space+drag inside the 120 ms after a zoom applied the band on that frame, so the frame restyled every edge hit and handle.
- A wheel that no longer changes the scale (the 1/16× or 2× cap) never reached the band update, so the 120 ms timer was not rearmed and the band could change mid-gesture.

`syncBand` now treats wheel and pinch as postpone, including a wheel whose band is already the one on the world (that clears a timer that has nothing left to do). A pan does not flush or clear a running timer. Buttons, fit (`Shift+1`), zoom to selection (`Shift+2`), resize and the first draw set the band immediately. `fit`, the zoom buttons and the `ResizeObserver` clear a pending wheel flag so they cannot postpone themselves.

The navigation script covers each of those. One check had to zoom out: zoom to selection of a single card is already at the 2× cap, so a further zoom-in wheel does not change the band.

## Two behaviour changes for Chris

**Space+wheel zooms.** Grove used to pan. Z7 follows the plan's quotation of the public Canvas help page, read 2026-10-30 (`https://obsidian.md/help/plugins/canvas`, `CANVAS_ZOOM_PLAN.md` §2): "press `Space` or `Ctrl` (or `Cmd` on macOS) and scroll using the mouse wheel". The live page was not fetched again. The quotation is explicit, so the change stays. The help dialog's Zoom row now lists `Space + Scroll` and `Ctrl + Scroll`. Space+drag, middle-button drag, scroll and Shift+scroll still pan. A wheel over a card that is being edited still scrolls that card, including when Space is held, because the early return is "not Ctrl, and inside `.canvas-node.is-editing`".

**Selecting an overflowing text card can jump.** Unselected bodies are `overflow: hidden`, so they show no scrollbar. On select, a text card becomes `overflow: auto`. With a classic scrollbar that narrows the text. Note cards have `scrollbar-gutter: stable`, so they do not reflow. Image cards stay clipped. Gutter was not added to text cards. The navigation test checks the three states: an unselected overflowing text card clips, selecting it lets `scrollTop` stick, and a wheel while editing scrolls the card and leaves the board transform alone.

## Bench

Same method as `NOTES_CZ1.md`, rerun for this review. Scratch script in `/tmp` (not committed). Headless Chromium 155.0.8059.84, 1280×1000, device scale 1, `--disable-gpu`, under `/tmp/grove-npm-test.lock`. Each count is its own browser session, so the open is cold.

- **Before:** pristine `18f43a9` under `/tmp/cz1-before`.
- **After:** this branch, including `fbe7816`.
- **Boards:** 100 / 300 / 1,000 / 3,000 cards of 250×160, one note card in five, `floor(4/3 × cards)` edges, one labelled coloured group per 50 cards. Each gesture starts from Zoom to fit.
- **Gestures:** 12+12 Ctrl+wheel notches of 100 px every 16 ms; pinch 60+60 steps of ±6 px every 8 ms (NOTES, at every size); 40 wheel pans of 4,000 px; then a Space+drag of 40 steps of 8×4 px, which ends 320×160 px from the start at every size. Input is sent on that cadence without waiting for each CDP ack.
- **Trace:** until 300 ms after the last event. Main ms/step is main-thread `RunTask` divided by `UpdateLayoutTree` count. Raster is `RasterTask` on the renderer process's other threads. Dropped frames are Chromium `DroppedFrame`. This is the same filter as `scripts/canvas-zoom-trace.mjs`.

Pinch steps are about 60 at 100 cards, not 120. Two events 8 ms apart share a frame, and the divisor is style updates. At 1,000 and 3,000 cards the renderer falls behind, so one style update covers several input events and the step count falls. Both sides used the same sender.

### Before → after

| Cards | Gesture | Steps | Main ms/step | Style | Layerize | Paint | Raster | Dropped | Longest task |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | wheel | 19→25 | 8.2 → 2.2 | 3.4 → 0.1 | 1.5 → 0.8 | 0.4 → 0.2 | 26.1 → 6.3 | 5 → 0 | 10.2 → 3.5 |
| 100 | pinch | 60→59 | 8.9 → 2.1 | 4.3 → 0.1 | 1.8 → 0.9 | 0.5 → 0.1 | 36.7 → 5.2 | 4 → 0 | 10.6 → 2.7 |
| 100 | pan | 38→39 | 4.8 → 1.5 | 3.0 → 0.1 | 0.3 → 0.2 | 0.4 → 0.3 | 5.2 → 5.1 | 0 → 0 | 10.0 → 5.0 |
| 100 | drag | 43→43 | 7.0 → 2.5 | 3.9 → 0.8 | 1.3 → 0.8 | 0.1 → 0.1 | 4.5 → 4.5 | 0 → 0 | 22.5 → 18.4 |
| 300 | wheel | 16→24 | 18.6 → 5.9 | 8.3 → 0.3 | 5.1 → 2.6 | 1.3 → 0.3 | 53.1 → 14.5 | 11 → 2 | 24.0 → 10.7 |
| 300 | pinch | 55→58 | 25.9 → 5.6 | 10.5 → 0.1 | 6.4 → 3.0 | 1.1 → 0.2 | 51.1 → 7.8 | 32 → 1 | 53.8 → 6.0 |
| 300 | pan | 37→38 | 13.0 → 3.6 | 8.5 → 0.1 | 0.9 → 0.4 | 0.9 → 0.8 | 5.7 → 5.3 | 4 → 1 | 28.0 → 15.4 |
| 300 | drag | 43→43 | 18.3 → 7.0 | 10.7 → 2.2 | 5.1 → 2.8 | 0.3 → 0.4 | 4.5 → 4.4 | 1 → 0 | 65.1 → 54.6 |
| 1,000 | wheel | 15→18 | 80.9 → 32.8 | 27.8 → 0.3 | 34.5 → 15.6 | 4.7 → 0.8 | 125.5 → 81.3 | 51 → 22 | 113.8 → 97.2 |
| 1,000 | pinch | 29→48 | 97.0 → 28.3 | 35.5 → 0.3 | 42.6 → 18.3 | 4.0 → 1.0 | 35.3 → 4.6 | 135 → 35 | 106.6 → 34.6 |
| 1,000 | pan | 19→38 | 45.0 → 11.0 | 31.5 → 0.2 | 5.7 → 1.7 | 1.4 → 2.8 | 9.0 → 6.1 | 40 → 5 | 89.6 → 60.0 |
| 1,000 | drag | 13→30 | 98.6 → 34.4 | 57.2 → 11.1 | 28.2 → 16.1 | 0.9 → 2.5 | 3.6 → 4.4 | 39 → 14 | 248.2 → 194.3 |
| 3,000 | wheel | 10→14 | 224.8 → 106.5 | 72.8 → 0.7 | 110.4 → 61.7 | 15.4 → 2.4 | 304.5 → 125.7 | 105 → 73 | 451.8 → 415.4 |
| 3,000 | pinch | 31→33 | 351.2 → 116.5 | 108.3 → 1.1 | 182.7 → 84.1 | 12.3 → 3.1 | 62.3 → 5.2 | 623 → 198 | 399.1 → 145.5 |
| 3,000 | pan | 11→21 | 153.1 → 36.4 | 103.1 → 0.7 | 4.9 → 4.3 | 5.4 → 14.4 | 6.5 → 5.7 | 91 → 28 | 175.7 → 124.4 |
| 3,000 | drag | 8→12 | 271.3 → 166.2 | 225.6 → 75.7 | 3.6 → 58.1 | 4.6 → 15.0 | 4.5 → 4.1 | 64 → 37 | 976.3 → 821.8 |

**Opening** (`ws.open` until the card nodes are in the DOM).

| Cards | Shown, before → after | Longest task, before → after |
|---:|---:|---:|
| 100 | 96 → 87 ms | 79 → 73 ms |
| 300 | 267 → 246 ms | 221 → 211 ms |
| 1,000 | 1,219 → 1,101 ms | 1,027 → 966 ms |
| 3,000 | 6,847 → 6,247 ms | 6,119 → 5,801 ms |

**Reading it:**

- Style on a zoom step falls to about 0.1–1.1 ms. Layout on wheel, pinch and pan falls to 0. That is Z1 and Z2.
- At 100 cards, pinch and wheel drop no frames. At 300, pinch drops 1 frame (was 32) and the longest pinch task is 6 ms. The 300-card rAF checks still pass and still cannot see drops (plan §3.2): pan max 16.8 ms, zoom max 16.8 ms.
- At 1,000 and 3,000 cards, layerize is still 16–84 ms per zoom step. That is the card bodies. The plan gives it to CZ2 and CZ3. A 3,000-card wheel's longest task is still 415 ms.
- **Pan raster did not rise.** Worker raster for the 4,000 px pans stays about 5–6 ms per step at every size (100: 5.2 → 5.1, 300: 5.7 → 5.3, 1,000: 9.0 → 6.1, 3,000: 6.5 → 5.7). `NOTES_CZ1.md` reports 9 → 23 at 100 cards and 35 → 88 at 300. Those rises are not in this rerun. At 100 and 300 the pan produced 37–39 style updates out of 40 input events, so the events were not collapsed into a few frames. Space+drag, which really moved the board 320×160 px, stays at about 4.5 ms of raster per step (100: 4.5 → 4.5, 300: 4.5 → 4.4, 1,000: 3.6 → 4.4, 3,000: 4.5 → 4.1). There is no Space+drag raster regression.
- The 3,000-card Space+drag still spends 76 ms in style per update (was 226). A wheel pan of the same board spends 0.7 ms. The extra is the pointer: `.canvas-view.is-grabbable *` and connection dots created on `pointerover` as the cursor crosses cards. Left for later. Raster did not follow it.
- Open is a bit faster at every size. The 3,000-card gain here is about 0.6 s, smaller than the 3 s in `NOTES_CZ1.md`. The lazy dots are in this tree; the card markdown still dominates the open.

## Tests

All on `fbe7816`, one run each, no flake rerun:

- `npm run build`: passed (`✓ built in 493ms`), existing chunk-size warning only.
- `npm run audit:offline`: passed, 180 source files.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0. Browser discovery 4/4. Vitest 70 files, 1,226 tests. 2,074 PASS lines. 300-card pan and zoom max 16.8 ms. 300-card drag max 16.8 ms.
- `cargo build --offline` and `cargo test --offline` from `rebuild/app/src-tauri`: 73 passed, 4 ignored.
- Screenshots under `rebuild/round*-shots/` restored with `git checkout` before committing.

## Left open

- One band change still restyles every edge-end handle and every edge hit path. At 3,000 cards that settle is inside a gesture whose longest task is still hundreds of milliseconds. CZ3's plan (edge ends only when selected, no hit paths in title mode) still applies.
- The text-card scrollbar jump, flagged above.
- Space+wheel zoom, flagged above.
- The 300-card frame test still times `requestAnimationFrame`. CZ0 replaces it.
- These numbers are Chromium's. WebKitGTK should gain more from Z1, because a stylesheet write restyles the whole document there. CZ0's in-app command is the check.
