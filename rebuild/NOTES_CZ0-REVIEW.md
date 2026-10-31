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

## CZ0-SYNC

Merged `rebuild/integration` (`ba9e4ac`, CZ1 + K5 + CZ-H) into `rebuild/cz0-review-grok` with `git merge --no-ff`. Nothing was pushed. No GUI window was opened. No new package or crate. No Obsidian code or assets. The Space+wheel check kept integration's existing citation of Canvas help ("press Space or Ctrl … and scroll"). This sync did not make a new Obsidian lookup.

Two files conflicted.

`rebuild/app/package.json` (+1/−1 against integration). The `test` script is integration's line, including `scripts/test-canvas-hover.mjs`, with `scripts/test-canvas-zoom-trace.mjs` added to the `node --test` list. The `posttest` script is integration's, including `scripts/test-bases-kanban-move.mjs`.

`rebuild/app/scripts/test-canvas-navigation.mjs` (+43/−1 against integration, 205 lines; CZ0 had 128 and integration had 163). The callback keeps both helpers: `{send,on,run,click,move,point,check,press,double,shot}`. `on` feeds the compositor trace. `double` feeds CZ1's edit-to-scroll check. Every CZ1 check stays: rAF frames under 20 ms, no stylesheet rule writes, zoom-band settle, the zoom cap, Shift+1, pan during settle, Zoom in, zoom to selection, resize, Space+wheel, and card-body scroll only when a card is selected or edited. CZ1's mutation observer stays too: it ignores the world and the selection menu, and the no-child-DOM check still runs on that gesture. The compositor trace runs after that observer disconnects, on a fitted 300-card board, so a band settle cannot fail the DOM check. The debug-command checks stay at the end.

`measureZoom.ts` and the `import.meta.env.DEV` registration merged cleanly. CZ1's wheel handler still treats a Ctrl+wheel as zoom and schedules a redraw. The restore writes the saved viewport back into the same object and dispatches one Ctrl+wheel with no delta, which redraws that viewport. The navigation test covers 300 steps, the honest `droppedFrames: null` report, Escape, leaving the canvas, and the live viewport coming back with `Small.canvas` bytes unchanged.

### Drop ceiling

Three dedicated runs, with the check still at the old ceiling of 24 so it recorded the count. Headless Chromium 155, same harness as CZ0.

| Run | Pan drawn / dropped | Zoom drawn / dropped |
|---|---:|---:|
| 1 | 22 / 2 | 20 / 0 |
| 2 | 22 / 2 | 24 / 0 |
| 3 | 22 / 2 | 22 / 0 |

The ceiling is **6** drops per 24 inputs, for each gesture. Pan's measured maximum is 2, and zoom's is 0, so a zero ceiling rejects the pan samples CZ1 still produces. On this machine the pre-CZ1 runs of the same check spread by 3 drops (8–11), and the full suite sat about 2 above the best dedicated sample. 6 is that measured 2, plus the 3-drop spread, plus one. The old 8–11 band still fails. The full suite below repeated pan 22/2 and zoom 22/0.

### Bench

Same script as `NOTES_CZ0`: `flock /tmp/grove-npm-test.lock node scripts/bench-canvas-zoom.mjs`. Chromium 155.0.8059.84, 1280×1000, device scale 1, `--disable-gpu`. Pinch is the comparable column. "Before" is the unoptimized table in `NOTES_CZ0`. "After" is this merge. Main is ms per viewport update. DOM is lower after CZ1 because card bodies are no longer scroll containers until a card is selected. Style is ms per viewport update.

| Cards | Before main | Before drops | After main | After drops | After style | After open / longest |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 8.7 | 2 | 2.4 | 0 | 0.10 | 87.9 / 76 |
| 300 | 27.1 | 89 | 5.7 | 1 | 0.11 | 240.8 / 203 |
| 1,000 | 109.6 | 336 | 29.2 | 45 | 0.31 | 1117 / 970 |
| 3,000 | 411.4 | 1441 | 122.1 | 386 | 1.00 | 6358 / 5856 |

Wheel and pan move the same way. 300-card wheel main 28.0 → 7.3 ms, drops 14 → 2. 300-card pan 15.3 → 3.9 ms, drops 5 → 1. At 1,000 and 3,000 cards, layerize is still the large main-thread cost (18.6 ms and 86.6 ms per pinch update) and drops stay well above zero. Opening a 3,000-card board is still 6.4 s, longest task 5.9 s. CZ2 and CZ3 still have that work.

### Checks

- `npm run build`: passed, 2130 modules. Existing chunk-size warning only. `dist/` has none of `canvas:measure-zoom`, `Canvas: measure zoom`, `measureZoom`, `Frame-gap p50`, or `Compositor dropped`.
- `npm run audit:offline`: passed, 184 source files.
- Trace parser and browser-discovery: 6 passed, inside the full suite.
- `flock /tmp/grove-npm-test.lock npm test`: passed on the first run, 622 s, including `posttest`. Vitest 72 files, 1240 tests. 1000-row Bases scroll max 16.8 ms. Full-suite compositor: pan 22 drawn / 2 dropped, zoom 22 drawn / 0 dropped. rAF max 16.8 ms for both. Debug command: 300 steps, p50/p95/max 16.7/16.7/16.8, no long tasks, `droppedFrames: null`. No timing flake, so nothing was rerun.
- `cargo build --offline` and `cargo test --offline` from `rebuild/app/src-tauri`: 73 passed, 4 ignored. No Rust files changed by this resolution.
- Screenshots under `rebuild/round*-shots/` were restored and were not committed.

## Left open after the sync

Chris still runs **Canvas: measure zoom** in the real WebKitGTK app. The headless numbers above are what that bench reproduces on this machine after CZ1. The command still cannot say whether WebKit re-rasters each scale change. Layerize and the multi-second 3,000-card open remain for CZ2 and CZ3. No new product decision.
