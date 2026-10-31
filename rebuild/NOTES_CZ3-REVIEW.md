# CZ3 review

VERDICT: OK WITH OPEN PERF GAP

Reviewed `rebuild/canvas-cz3-codex` (`6c143cb`, notes `rebuild/NOTES_CZ3.md`) on `rebuild/cz3-review-grok`. Integration `93dbb79` is merged as `3052506`. The review changes are the hover guard in `hoverPreview.ts` and two test adjustments in `test-canvas-edge-menu.mjs` and `test-canvas-create.mjs`. Nothing was pushed. CZ6 raster freeze was not implemented.

Judged against `rebuild/CANVAS_ZOOM_PLAN.md` and `NOTES_CZ0.md`, `NOTES_CZ2.md`, and `NOTES_CZ3.md`. No Obsidian code or assets, and no external docs.

## What was reviewed

CZ3 is Z4 and Z6 plus the Z9 edge batching in section 5 of the plan: spatial buckets, lazy Markdown bodies, a 300-body LRU, one paused work queue, and clipped edge batches. D1 (title only, centred), D2 (below 45% going out, above 55% coming in), D3 (double-click zooms first), and D4 stay as CZ2 left them.

`git diff --stat 93dbb79...3052506 -- rebuild/app` is 20 files, +826/−117. The product files are `bodies.ts`, `spatial.ts`, `work.ts`, `edgeClip.ts`, `edges.ts`, `view.ts`, `navigation.ts`, `editing.ts`, and `canvas.css`, plus `bench-canvas-zoom.mjs` (`readyMs`) and `test-canvas-lazy.mjs`. No raster-freeze bitmap, and no Kanban or native changes in that diff.

The merge conflicts were `package.json`, `editing.ts`, and `view.ts`. Every `package.json` test line from both parents is present, including `test-canvas-lazy.mjs` and the CZ5 / edge-test scripts. No conflict markers remain.

## Hover fix

`test-canvas-edge-hover.mjs` failed on the merge. Parking the text link on the right edge uses a real space-drag, which leaves the cursor outside the 1280-wide layout viewport. A synthetic `pointermove` then arms the 350 ms preview. The hit test is the link. The preview never opened.

Chrome then emits `pointerout` with `relatedTarget` null. One traced run, after the hover was armed at (1213, 364) on `.cm-wikilink`, received that event at client (1580, 489). `elementFromPoint` at the armed position was still the link. There is no `scroll` event in the trace. `overflow-anchor: none` on `.canvas-view` was tried and reverted. Treating client coordinates outside the layout viewport as "the pointer left the window" also dismisses this hover, because the parked cursor is already outside, and that check was removed.

`pointerout` with no `relatedTarget` now checks `elementFromPoint` at the last pointer position. If that element is inside the popup, or is a `[data-href]`, `[data-preview-path]`, or `[data-embed-href]` link, or is an internal editor link, the preview stays. If the same-turn hit test is empty, one animation frame later the same check runs, then the preview dismisses if the pointer is still not on a link. A hit on anything else dismisses immediately, as before. `canvas.css` is unchanged. The edge-hover assertion text is unchanged.

`test-canvas-edge-menu.mjs` measured a paste at 1/16 by calling `getComputedStyle` on `.canvas-node-content`. Title mode detaches that body, so the call threw. A missing body now counts as hidden, which is what `test-canvas-navigation.mjs` already does. The card still has to sit on the pointer, keep the title text, and hide that title because the card is under the title floor. That check passed: `hidden: true`, `titleDisplay: "none"`.

`test-canvas-create.mjs` measures a Ctrl+drag on a 1,000-card board and requires 0 layout reads and 0 mutations inside `.canvas-world`. The drag only writes a box on `.canvas-view`. The 2,000 mutations in one run were the zoom-out settle queue (band and cull writes) still applying. The test now waits until `__canvasProbe().pending` stays 0, then keeps the same limits. That script then measured 0 reads, 0 mutations, and a max interval of 16.8 ms.

## Bench

Same CZ0 script, `rebuild/app/scripts/bench-canvas-zoom.mjs`, rerun for this review. Headless Chromium 155.0.8059.84, 1280×1000, device scale 1, `--disable-gpu`. Each tree ran its own script: integration `93dbb79` does not record `readyMs`. CPU is completed trace-task duration per viewport update. Raster is worker time, not wall time. Long tasks are `RunTask` over 50 ms.

### Integration `93dbb79`

| Cards | Gesture | Main ms/update | Raster | Drops | Long tasks | Open ms / longest | DOM |
|---:|---|---:|---:|---:|---|---|---:|
| 100 | wheel | 2.947 | 7.231 | 2 | 0 | 97.8 / 81.0 | 2,676 |
| 100 | pinch | 1.989 | 4.875 | 0 | 0 | | |
| 100 | pan | 1.907 | 5.446 | 0 | 0 | | |
| 300 | wheel | 4.801 | 15.077 | 2 | 0 | 263.2 / 224.0 | 7,851 |
| 300 | pinch | 3.254 | 5.821 | 1 | 0 | | |
| 300 | pan | 3.158 | 5.85 | 0 | 0 | | |
| 1,000 | wheel | 46.206 | 137.167 | 22 | 5 / 95.9 | 1,140.8 / 946.0 | 25,956 |
| 1,000 | pinch | 11.282 | 4.822 | 0 | 0 | | |
| 1,000 | pan | 11.397 | 7.825 | 2 | 0 | | |
| 3,000 | wheel | 262.59 | 755.356 | 131 | 11 / 590.3 | 6,527.3 / 5,808.0 | 77,691 |
| 3,000 | pinch | 36.162 | 5.566 | 69 | 0 | | |
| 3,000 | pan | 38.152 | 20.488 | 19 | 1 / 84.5 | | |

### This branch

`Open` is the shell time. `readyMs` is when the vector queue finishes. Codex's shell / queue pair was 184.3 / 1,317.8 at 3,000 cards.

| Cards | Gesture | Main ms/update | Raster | Drops | Long tasks | Shell / ready / longest | DOM |
|---:|---|---:|---:|---:|---|---|---:|
| 100 | wheel | 1.725 | 8.767 | 1 | 0 | 24.7 / 50.7 / 0 | 421 |
| 100 | pinch | 1.266 | 4.821 | 1 | 0 | | |
| 100 | pan | 1.276 | 5.42 | 0 | 0 | | |
| 300 | wheel | 2.928 | 34.732 | 3 | 0 | 25.2 / 91 / 0 | 1,079 |
| 300 | pinch | 1.777 | 8.249 | 1 | 0 | | |
| 300 | pan | 1.388 | 6.248 | 0 | 0 | | |
| 1,000 | wheel | 3.966 | 33.329 | 4 | 0 | 55.4 / 368.9 / 0 | 3,499 |
| 1,000 | pinch | 2.963 | 4.562 | 0 | 0 | | |
| 1,000 | pan | 2.483 | 6.85 | 1 | 0 | | |
| 3,000 | wheel | 46.23 | 113.717 | 13 | 1 / 67.5 | 175.9 / 1,344.1 / 0 | 10,413 |
| 3,000 | pinch | 13.713 | 4.79 | 2 | 0 | | |
| 3,000 | pan | 7.399 | 11.351 | 2 | 0 | | |

100, 300, and 1,000 have no task over 50 ms. The 3,000-card wheel in this all-size run has one task of 67.5 ms. An isolated 3,000-card wheel on the same build recorded one task of 43.4 ms. Its children are `BeginMainFrame` 43.4, `RunPaintLifecyclePhase` 24.8, `Layerize` 20.2, `Commit` 12.7, `WaitForCommitCompletion` 12.1, input 3.9, `Paint` 3.8, `HitTest` 3.7. That is the same class as Codex's 54.9 and 78.0 ms tasks: one compositor frame, not a JavaScript job the queue can slice. Section 6 still asks for ≤14 ms per step, 0 drops, and no task over 50 ms. This run is 28.9 ms per step (`perStep.task`), 13 drops, and an unstable task over 50 ms. The shell is under 200 ms and the opening long task is 0. The queue drain stays about 1.3 s. Dropping that frame under 50 ms needs CZ6, which this review does not add. Limits in `test-canvas-lazy.mjs` were not loosened.

300-card wheel raster worker time is 34.7 ms, in line with Codex's 36.7. Integration was 15.1 ms of worker time while painting a 7,851-node DOM. Main-thread time at that size fell from 4.8 ms to 2.9 ms.

## Break attempts

Scratch scripts under `/tmp`, not committed.

- One arrowhead on a curve that crosses a batch cell, path `M1024,440 L1014,445 L1014,435`. The card under the viewport keeps its box. A card left off-screen stays culled and comes back when panned in. Fit shows the board again (401 cards). Marquee selection survives culling and the return.
- Fitted title mode at scale 0.259. The first double-click zooms to 2 and does not edit. The second edits, the file saves, the card can be culled, and panning back shows the edit. Hysteresis: 50% while zooming in stays on titles, 56% leaves, 50% while zooming out stays on content, 44% returns. A group label survives. Ctrl+drag opens `.canvas-create-menu`. Ctrl+hover opens the Welcome preview.
- Trusted CDP keys, after the earlier probe failures: ArrowRight moves a visible selected card to `left: 5px` and file `x: 5`. After culling, the card stays selected, ArrowRight moves it to `left: 10px` and file `x: 10`, Delete removes it, and Ctrl+Z restores `x: 10` with text `Hello`. The earlier arrow, undo, and delete failures used a synthetic `KeyboardEvent` while a drag cancel was still armed, and they read the file before the 300 ms save. Those were probe bugs.
- The right-click probe landed on a group, so "Add card" and "Paste" were missing from that popup. `test-canvas-board-menu.mjs` covers the empty-board menu.

## Checks

The final `npm test` under `/tmp/grove-npm-test.lock` exited 0, including `posttest`. Vitest passed 79 files. That run includes the parked-link preview, the title-mode paste, the 1,000-card create drag, `test-canvas-lazy.mjs` with its 50 ms limits unchanged, the 300-card navigation frames, and the Bases scrolls (1,000-row max 16.8 ms, 10,000-row max 16.8 ms).

Earlier full runs stopped before the end. One died in `test-canvas-navigation.mjs` because `.canvas-view` was missing at the maximum-zoom check. An immediate rerun of that script passed, including maximum zoom, the 300-card frames (max 16.8 ms, 0 compositor drops), and the 45/55 checks. The final full run passed that check too. Another full run failed the parked-link preview on the outside-viewport check, which was then removed. `test-canvas-edge-hover.mjs` passed on its own after that, and again inside the final suite.

`npm run audit:offline` passed: 191 source files, dist/, CSP, capabilities and dependencies checked. The existing chunk-size warning is the only build warning.

From `rebuild/app/src-tauri`, `cargo test --offline` passed 73 tests, with 4 ignored (`set_property_bench`, `crash_child`, `bench_vault`, `bench_search_commands`). `cargo build --offline` finished.
