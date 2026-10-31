# CZ5 review

VERDICT: OK

Reviewed Grok c's CZ5 on `rebuild/cz5-review-grok`, taken from `rebuild/canvas-cz5-grok` at `b662a14`. That branch is still at `b662a14`. Parent of the feature is `565d826`. This review added `39f17df`. Nothing was pushed. No app window was opened.

Relied on `rebuild/CANVAS_ZOOM_PLAN.md` sections 1, 5.5, 6 and 9, including D1–D4 as Chris approved them on 2026-10-30, and on `rebuild/NOTES_CZ5.md` and `rebuild/NOTES_CZ4.md`. The public source is Obsidian's Canvas help, `https://obsidian.md/help/plugins/canvas`, as read for the plan and for NOTES_CZ4 on 2026-10-30 and already cited in NOTES_CZ5. It says nothing about Ctrl+drag. This review did not fetch that page again. No Obsidian code, CSS, icons, or assets were used.

## What this review changed

`39f17df` is 65 insertions and 5 deletions:

| File | + | − |
| --- | ---: | ---: |
| `rebuild/app/src/canvas/editing.ts` | 7 | 1 |
| `rebuild/app/src/shell/hoverPreview.ts` | 11 | 2 |
| `rebuild/app/scripts/test-canvas-create.mjs` | 47 | 2 |

Two holes in the feature as landed:

- The create box is placed from the pointerdown transform. Ctrl is held, so a wheel zoomed the board (a plain wheel panned it) and the new card missed the box. While the box exists, a capture-phase `wheel` listener on `.canvas-view` calls `preventDefault` and `stopImmediatePropagation`. `clearCreate` removes it, so cancel, Escape, a click elsewhere, a missing menu, the menu observer, and dispose all unblock the wheel. The listener does not read layout.
- Releasing and pressing Ctrl again during the drag opened a hover preview. The move path already returns while `event.buttons` is set. The keydown path now keeps the same rule: pointerdown, pointerup, pointercancel, and pointermove record `buttons`, and a Control/Meta keydown with buttons down does not call `inspect`. Ctrl+hover while the pointer is still still opens the preview.

The create test now covers a wikilink on card A, Ctrl+hover, a drag across that link, a Ctrl re-press during the drag, and a ctrl-wheel during the drag plus a plain wheel while the menu is up. Both wheels leave `.canvas-world`'s `style.transform` string unchanged.

## Scope

`git diff --stat 565d826..39f17df` is NOTES_CZ5, `package.json`, the create test, and `cards.ts`, `editing.ts`, `view.ts`, `hoverPreview.ts`, `canvas.css`: 596 insertions, 9 deletions. The feature itself matches NOTES_CZ5 and §5.5. Ctrl (Cmd on macOS) on empty writable canvas draws one screen-space box, 2 px accent outline, 12% accent fill. Release opens CZ4's add list. The item takes the box in board units, with the existing 50×50 minimum. Esc, a click elsewhere, or a box under 10 screen px drops it. Read-only Ctrl+drag selects. A drag that starts on a card, edge, or label is unchanged. Snap rounds corners to 20 board units. Alt, or snap off, uses step 0. The menu opens at the snapped release corner. Create group does not open the label editor. Empty text still opens the editor. Media with both width and height keeps the box.

`navigation.ts` is absent from that diff. The wheel block lives only on the create path.

## What this review ran

Headless Chromium, under `flock /tmp/grove-npm-test.lock`.

`test-canvas-create.mjs` passed on its own before the commit and again inside the full suite, and again on the scratch merge below. That includes the five add items and undo, the 50×50 grid cell, Alt and snap-off, one zoom-out step, plain marquee, read-only Ctrl+drag, the tiny box, Escape mid-drag, the new hover and wheel checks, and the 1,000-card create drag: 0 `getBoundingClientRect` reads, 0 world mutations, 48 intervals, max 16.8 ms. The full suite recorded the same 16.8 ms.

`test-canvas-hover.mjs` passed in that full run, including "pressing Ctrl while still opens the note-card preview", "Ctrl+wheel zooms and dismisses the preview", "dragging a card still moves it (480px -> 520px)", and "leaving the canvas removes the preview".

Throwaway probes, deleted afterwards and not committed, on the feature before the wheel listener:

- Releasing Ctrl mid-drag keeps the five-item menu. The gesture is latched at pointerdown.
- A release past the canvas edge opens the menu. The stored rect matches the drag formula with the 50 px minimum.
- A drag that starts on empty canvas and crosses a group leaves the group where it was. Create group uses the box.
- Space+drag pans and does not create.
- At scale 0.25 on this branch (four Zoom out clicks; title mode is CZ2 and is not on this branch) the card matched the drag's board rect and undo restored the file.
- A 3,000-card create drag: 0 layout reads, 0 world mutations, 41 samples, max 16.7 ms. The pointerdown wall time of 62 ms includes a 50 ms sleep in the probe.
- Ctrl+drag on card padding moved the card from (40, 40) to (80, 60) and saved that point. No create menu.
- After closing the canvas, window pointermove/pointerup/pointercancel/keydown and document pointerdown were back to the baseline. During the open menu the extra window keydown and document pointerdown are the menu's own listeners.

After the fix, a short probe counted the new wheel listener: 1 while the box is dragging, 0 after Escape, 1 while the menu is open, 0 after the menu is dismissed. Dispose calls `cancel()` and then `clearCreate()`, which removes that listener.

## Performance

Same script as NOTES_CZ0: `flock /tmp/grove-npm-test.lock node scripts/bench-canvas-zoom.mjs`. Chromium 155.0.8059.84, 1280×1000, device scale 1, GPU disabled. CPU columns are ms per viewport update. Before is `565d826` in a detached worktree that was removed afterwards. After is this branch at `39f17df`. The two runs were sequential. DOM counts match. Pinch is the stable column. The 1,000-card wheel average moved because that gesture had 14 updates and then 13, so one long frame swings it. CZ5 does not change the zoom path except the create-only wheel block, which this bench never arms. 3,000 cards are over the plan's 14 ms target on both sides. This parent is before CZ2, and the plan says 3,000 needs Z9.

Before, `565d826`:

```
Cards | DOM | Gesture | Inputs/delivered/updates | Drawn | Dropped | RunTask/update | Style | Layerize | Paint | HitTest | Layout | Raster/update | Long tasks count/max | Open/longest
100 | 2474 | wheel | 24/24/21 | 22 | 1 | 2.633 | 0.176 | 0.991 | 0.264 | 0.246 | 0.018 | 7.353 | 0 | 90.3/78.0
100 | 2474 | pinch | 300/290/145 | 145 | 0 | 2.46 | 0.101 | 0.937 | 0.143 | 0.302 | 0 | 4.974 | 0 | 90.3/78.0
100 | 2474 | pan | 24/24/23 | 23 | 0 | 1.711 | 0.088 | 0.243 | 0.462 | 0.23 | 0 | 5.41 | 0 | 90.3/78.0
300 | 7245 | wheel | 24/23/22 | 23 | 2 | 6.881 | 0.361 | 3.298 | 0.418 | 0.937 | 0.041 | 15.297 | 0 | 239.1/202.0
300 | 7245 | pinch | 300/287/144 | 144 | 1 | 6.048 | 0.127 | 3.152 | 0.246 | 0.877 | 0 | 5.817 | 0 | 239.1/202.0
300 | 7245 | pan | 24/24/23 | 23 | 1 | 3.711 | 0.116 | 0.549 | 1.282 | 0.707 | 0 | 5.438 | 0 | 239.1/202.0
1000 | 23936 | wheel | 24/15/14 | 14 | 17 | 47.445 | 0.345 | 19.394 | 0.914 | 4.641 | 0 | 98.748 | 3/106.5 | 1081.2/939.0
1000 | 23936 | pinch | 120/62/56 | 56 | 47 | 29.979 | 0.304 | 19.153 | 0.909 | 4.494 | 0 | 4.774 | 0 | 1081.2/939.0
1000 | 23936 | pan | 24/24/22 | 22 | 7 | 14.275 | 0.237 | 2.846 | 4.765 | 3.165 | 0 | 6.758 | 1/63.6 | 1081.2/939.0
3000 | 71631 | wheel | 24/14/13 | 18 | 113 | 173.721 | 7.497 | 95.267 | 4.634 | 18.401 | 1.481 | 225.161 | 14/326.5 | 6057.4/5565.0
3000 | 71631 | pinch | 120/61/61 | 88 | 388 | 122.534 | 0.995 | 87.486 | 3.12 | 15.962 | 0 | 5.795 | 61/151.6 | 6057.4/5565.0
3000 | 71631 | pan | 24/13/13 | 14 | 36 | 64.263 | 0.792 | 14.116 | 24.153 | 14.692 | 0 | 14.716 | 2/264.2 | 6057.4/5565.0
```

After, `39f17df`:

```
Cards | DOM | Gesture | Inputs/delivered/updates | Drawn | Dropped | RunTask/update | Style | Layerize | Paint | HitTest | Layout | Raster/update | Long tasks count/max | Open/longest
100 | 2474 | wheel | 24/24/22 | 23 | 1 | 2.533 | 0.165 | 0.956 | 0.257 | 0.244 | 0.012 | 7.64 | 0 | 88.9/76.0
100 | 2474 | pinch | 300/291/147 | 147 | 0 | 2.3 | 0.088 | 0.924 | 0.129 | 0.239 | 0 | 4.873 | 0 | 88.9/76.0
100 | 2474 | pan | 24/24/23 | 23 | 0 | 1.65 | 0.082 | 0.238 | 0.455 | 0.218 | 0 | 5.324 | 0 | 88.9/76.0
300 | 7245 | wheel | 24/23/22 | 23 | 2 | 7.379 | 0.375 | 3.307 | 0.453 | 1.179 | 0.043 | 15.368 | 0 | 241.8/204.0
300 | 7245 | pinch | 300/288/145 | 145 | 1 | 6.3 | 0.137 | 3.151 | 0.267 | 0.999 | 0 | 6.014 | 0 | 241.8/204.0
300 | 7245 | pan | 24/24/24 | 24 | 1 | 3.655 | 0.109 | 0.518 | 1.209 | 0.724 | 0 | 5.506 | 0 | 241.8/204.0
1000 | 23936 | wheel | 24/15/13 | 14 | 21 | 57.655 | 2.531 | 20.924 | 6.271 | 5.214 | 0.502 | 131.579 | 5/140 | 1093.3/953.0
1000 | 23936 | pinch | 120/62/60 | 60 | 48 | 29.776 | 0.342 | 18.804 | 0.882 | 4.87 | 0 | 4.778 | 0 | 1093.3/953.0
1000 | 23936 | pan | 24/24/22 | 22 | 3 | 13.821 | 0.272 | 1.992 | 4.636 | 3.455 | 0 | 6.962 | 1/64.8 | 1093.3/953.0
3000 | 71631 | wheel | 24/14/13 | 19 | 114 | 173.274 | 7.516 | 94.134 | 4.693 | 18.249 | 1.508 | 226.951 | 14/326.4 | 6277.7/5787.0
3000 | 71631 | pinch | 120/61/61 | 87 | 387 | 122.325 | 1.033 | 86.384 | 3.232 | 16.747 | 0 | 6.002 | 61/151.2 | 6277.7/5787.0
3000 | 71631 | pan | 24/13/13 | 14 | 37 | 64.597 | 0.768 | 13.942 | 24.493 | 15.07 | 0 | 15.661 | 2/262.2 | 6277.7/5787.0
```

From this branch's locked `npm test`:

- 300-card drag: max 16.8 ms, 49 intervals.
- 300-card/400-edge pan: 70 samples, p95 16.7 ms, max 16.8 ms. Compositor: 24 steps, 22 drawn, 2 dropped.
- 300-card/400-edge zoom: 70 samples, p95 16.7 ms, max 16.8 ms. Compositor: 24 steps, 22 drawn, 0 dropped.
- 1,000-row Bases scroll: max 16.8 ms.
- Board menu: on screen within two frames, max 16.7 ms, no open animation.
- 1,000-card create drag: 0 reads, 0 world mutations, 48 intervals, max 16.8 ms.

Nothing in the create drag, the 300-card gestures, or the Bases scroll exceeded 50 ms. No timing flake, so nothing was rerun.

## Scratch merge

`git worktree add --detach /tmp/cz5-int rebuild/integration` at `c0ad2bf` ("Merge branch 'rebuild/cz2-review-grok' into rebuild/integration"). `git merge --no-commit --no-ff rebuild/cz5-review-grok`. No conflicts. The merge was not committed. The worktree was removed afterwards. `node_modules` was a real copy.

`editing.ts` kept CZ2's `titleZoom` and this branch's wheel block and `openCreateMenu`. `view.ts` kept `sizeTitle` in the paint callback and passes `openCreateMenu` as the last `canvasEditing` argument. `canvas.css` kept the title-mode rules and `.canvas-create`. `package.json` kept integration's scripts and inserted `node scripts/test-canvas-create.mjs` immediately after `node scripts/test-canvas-board-menu.mjs`. `posttest` still includes `test-bases-kanban-move.mjs`.

`npm run build` on that tree passed (`tsc`, Vite, 2130 modules). The create script passed there, including the 1,000-card drag at max 16.8 ms. A throwaway probe then zoomed out with the Zoom out button until scale 0.353553 and `.canvas-world.is-zoomed-out`. Ctrl+drag opened the five-item menu. Add card stored and painted `(-1140, -1100, 520×340)`, the snapped box. Undo restored the file. The first read of that file was inside the 300 ms save debounce and looked empty; the rerun waited 500 ms.

## Checks

From `rebuild/app`, on this branch:

- `npm run build` passed. The existing Vite chunk-size warning remains.
- `flock /tmp/grove-npm-test.lock npm test` passed, including browser scripts and posttest. Vitest: 72 files, 1241 tests, of which 444 are parity. No failure, so the known 300-card drag flake was not rerun.
- `npm run audit:offline` passed: 184 source files, dist, CSP, capabilities, and dependencies.

From `rebuild/app/src-tauri`, with `--offline`:

- `cargo build` passed.
- `cargo test` passed: 73 passed, 4 ignored.

`rebuild/round*-shots` was restored and not committed. Prompt files were not committed.

## Left open

- Shift with the create modifier starts a create drag. The plan does not say what Shift should do. NOTES_CZ5 already left this open.
- The help dialog still has only the CZ4 row, Canvas menu / Right-click.
- The box follows the plan's 2 px outline. The mockup's 3 px border and 2 px radius are not drawn.
- One snapped grid cell is 20 board units. Below half scale its screen size is under 10 px, so the gesture cancels. At scale 1 it opens and `sized()` grows the item to 50×50.
- The zoom buttons call `zoom()` directly. The new listener blocks the wheel only, so those buttons can still move the world while the create menu is open.
- A second pointer, or a right-click, during the drag runs `clearCreate` on pointerdown and does not cancel the in-progress `dragPointer`. That is the same pattern as the other canvas drags.
