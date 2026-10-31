# CZ0 review

VERDICT: OK

Reviewed `rebuild/canvas-cz0-codex` (`6ca9904`, notes `941281b`) on `rebuild/cz0-review-grok`. Codex's branch was not moved. Nothing was pushed. No GUI window was opened. Relied on the CZ0 row of `rebuild/CANVAS_ZOOM_PLAN.md` and `rebuild/NOTES_CZ0.md`. No Obsidian code or assets.

The diff from `18f43a9` is measurement only: the bench, the trace helper, the navigation regression, `browser.mjs`'s CDP event helper, and the dev command. It does not change zoom, pan, card drawing, or the empty-canvas menu. One fix is on this branch as `9e96eab`.

## Debug command

`canvas:measure-zoom` ("Canvas: measure zoom") is registered only inside `import.meta.env.DEV`, and it loads `canvas/measureZoom.ts` with a dynamic import. A production `npm run build` (2127 modules) has none of `canvas:measure-zoom`, `Canvas: measure zoom`, `measureZoom`, `Frame-gap p50`, or `Compositor dropped` in `dist/`. The dev server shows it in the palette only while a canvas tab is active.

On a small canvas it fits, sends 300 synthetic Ctrl+wheel steps (±6 px, 8 ms), and reports callback-gap p50/p95/max, gaps over 20 ms, device scale, the user agent, and long tasks. Three runs here were p50/p95/max 16.7/16.7/16.8 or 16.7/16.8/16.8, 148 or 149 gaps, no long tasks, `droppedFrames: null`. The dialog says compositor drops are unavailable and that callback gaps do not measure presentation. That is the right report: the page API cannot see `DrawFrame`. The command does not write the canvas file. Escape cancels before 300 steps. Blur, a hidden document, and leaving the canvas cancel too.

## Fix

Leaving the canvas cancels the run, and tab switch destroys the canvas element. The restore used to require the element to still be connected and still current, so the tab kept the synthetic zoom in `canvasViewports`. Coming back opened at that zoom. The file was never written; the live viewport was. `9e96eab` writes the saved viewport back whenever the tab is still in the map, and dispatches the redraw wheel only if the element is still on screen. The navigation test zooms, opens another note, then reopens the canvas: scale and translation match, and `Small.canvas` bytes are unchanged.

| File | Lines |
|---|---|
| `rebuild/app/src/canvas/measureZoom.ts` | +7 / −3 |
| `rebuild/app/scripts/test-canvas-navigation.mjs` | +13 / −1 |

## Drop check

`test-canvas-navigation.mjs` replaced the rAF-under-20 ms assertion with compositor `DrawFrame` / `DroppedFrame` on a fitted 300-card board, 24 inputs each for pan and zoom. Missing renderer metadata, missing `DrawFrame`, or trace data loss throws. A `DroppedFrame` from another process is ignored. The unit test covers that filter.

The interim ceiling is 24 drops per 24 inputs, for each gesture. `NOTES_CZ0` calls it a baseline, not the zero-drop target, and says CZ1 should tighten it. Three dedicated runs under the lock, plus the same check inside the full suite:

| Run | Pan drawn / dropped | Zoom drawn / dropped |
|---|---:|---:|
| 1 | 8 / 9 | 8 / 8 |
| 2 | 10 / 11 | 10 / 10 |
| 3 | 10 / 11 | 10 / 10 |
| Full suite | 10 / 11 | 10 / 10 |

Spread is 3 drops. Nothing failed, so nothing was rerun. The ceiling sits about twice the observed 8–11, which is enough that this machine does not flake, and low enough that more than one drop per input fails. A moderate regression that stayed under 24 would still pass. That is acceptable on this branch because the unoptimized board cannot pass a zero check. Tightening belongs with CZ1, which is where the drops actually move.

## CZ1 with this bench

Throwaway worktree `/tmp/grove-cz0-on-cz1`, detached at `rebuild/cz1-review-grok` (`5de9b31`), merged `rebuild/canvas-cz0-codex`. The only conflict was `test-canvas-navigation.mjs`. The resolution kept CZ1's frame and zoom-band checks and CZ0's compositor check. It was not committed. The worktree is removed.

The merged navigation test passed. CZ1's rAF check was max 16.8 ms for pan and zoom. The compositor check passed at pan 22 drawn / 2 dropped and zoom 22 drawn / 0 dropped. A literal zero ceiling would have failed that pan sample.

Same bench, headless Chromium 155, 1280×1000, device scale 1, `--disable-gpu`. Pinch is the comparable column. "Before" is the unoptimized table in `NOTES_CZ0`. "CZ1" is this scratch merge. Main is ms per viewport update. DOM is lower after CZ1 because card bodies are no longer scrollers, so the two tables are the same script on different rendering.

| Cards | Before main | Before drops | CZ1 main | CZ1 drops | CZ1 style | CZ1 open / longest |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 8.7 | 2 | 2.3 | 0 | 0.09 | 88.7 / 76 |
| 300 | 27.1 | 89 | 6.2 | 1 | 0.14 | 235.5 / 198 |
| 1,000 | 109.6 | 336 | 29.4 | 47 | 0.30 | 1108 / 967 |
| 3,000 | 411.4 | 1441 | 123.6 | 393 | 1.07 | 6111 / 5612 |

Wheel and pan move the same way: 300-card wheel main 28.0 → 7.3 ms, drops 14 → 2; 300-card pan 15.3 → 3.8 ms, drops 5 → 1. At 1,000 and 3,000 cards, layerize is still the large main-thread cost (about 19 ms and 87 ms per update on pinch) and drops remain well above zero. Opening a 3,000-card board is still about 6 seconds. CZ2 and CZ3 still have that work. The bench stays outside `npm test`, which is right: the 3,000-card trace is heavy and the opening task is intentionally multi-second.

## Tests

- `npm run build`: passed. Existing chunk-size warning only. Debug strings absent from `dist/`, as above.
- `npm run audit:offline`: passed, 181 source files.
- Trace parser and browser-discovery: 6 passed.
- `flock /tmp/grove-npm-test.lock npm test`: passed on the first run (about 10 minutes), including `posttest`. Vitest 70 files, 1226 tests. 1000-row Bases scroll max 16.7 ms. No timing flake.
- `cargo build --offline` and `cargo test --offline` from `rebuild/app/src-tauri`: 73 passed, 4 ignored. No Rust files changed.
- Screenshots under `rebuild/round*-shots/` were restored and were not committed.

## Left open

Chris still runs **Canvas: measure zoom** in the real WebKitGTK app, on a scratch vault, before and after CZ1. The command records device scale and the engine. It cannot say whether WebKit re-rasters each scale change. That still needs a native trace before deciding on CZ6. The headless Chromium numbers above are the baseline this bench will reproduce.
