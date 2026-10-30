# Canvas drag lag

Branch `rebuild/canvas-lag-claude`, from `rebuild/integration` `c54026a`, 2026-10-29. Local commits only; nothing pushed. No GUI window was opened; every browser check ran in headless Chromium through `npm test`'s harness.

## The cause, in plain words

Dragging a card was already batched to one update per animation frame (`dragPointer`, `shell/dom.ts:42`). Saving was already right too: nothing is written while the card moves, and the file is saved once, 300 ms after the drop. Two things inside that per-frame update did far more work than moving a card:

1. **Each move rewrote a stylesheet.** Every frame, the drag called `navigation.loaded()`, which redrew the viewport (`canvas/navigation.ts` `draw()`), even though the viewport hadn't changed. That redraw writes five CSS variables into a rule of an adopted stylesheet (`--canvas-inverse-scale` and four `--canvas-view-*` bounds). Writing a stylesheet rule counts as a stylesheet change even when the value is the same. A browser then has to work out again which styles apply to the page. WebKit, the engine inside the app, is believed to do that for the whole document (the sidebar, the file tree, every pane), not just the canvas. That is the likely reason it felt laggy with only two cards.
2. **Each move rebuilt and measured the selection menu.** The drag called the selection toolbar's `update()` every frame. That removed and re-inserted its optional buttons, built a new SVG icon, and then read `offsetTop`/`offsetHeight` of the cards' labels. The reads came right after the card positions were written, so each one forced the browser to finish style and layout immediately, in the middle of the frame. With the stylesheet change from point 1 pending, that forced the page-wide restyle to happen at once.

The card's own update (its `left`/`top`, its edges) was cheap and stays as it is.

## What changed

- **`canvas/navigation.ts`:** `draw()` remembers the viewport it last applied (position, scale, size). If nothing changed, it returns before writing the stylesheet or any style. Pan, zoom and resize still redraw as before.
- **`canvas/controls.ts`:** the selection menu has a new `place()` that only moves it: two inline CSS variables on the toolbar. `update()` still rebuilds the buttons when the selection changes. It now measures each selected card label's offset inside its card once, so `place()` works from the card's model `y` plus that offset, with no layout read. Edge labels are still measured in `place()`, as before. They only count when an edge is selected, and dragging cards doesn't move them.
- **`canvas/editing.ts`:** a card drag move calls `paint(affected)` and `menu.place()` instead of `repaint()`, so the menu isn't rebuilt on every move. Cancel (Esc), arrow-key nudges and selection changes still use the full update.
- **`scripts/test-canvas-drag-work.mjs`** (new, run by `npm test` right after `test-canvas-editing.mjs`): drags two note cards (a multi-selection with an edge between them) through 30 moves. It counts stylesheet-rule writes, selection-menu DOM changes, forced layout reads and saves. It also reads Chromium's style and layout counters. It checks no rule writes, no menu rebuild, no layout reads, no save while dragging, and exactly one save after the drop.

Snapping (grid and objects), Shift axis lock, Alt, multi-select drags, groups moving their children, resize, cancel and undo all go through the same code as before. Only the per-move repaint changed.

## Before and after

`node scripts/test-canvas-drag-work.mjs` (headless Chromium, the mock vault's full app, two note cards and one edge, 30 moves; per move):

| | Before | After |
|---|---:|---:|
| Stylesheet rule writes | 5 | **0** |
| Selection-menu DOM node changes | 2 | **0** |
| Forced layout reads (`offset*`) | 4 | **0** |
| Style recalcs | 2.0 | 1.43 |
| Layouts | 1.0 | 1.0 |
| Style time (Chromium) | 0.555 ms | 0.208 ms |
| Script time | 0.164 ms | 0.089 ms |
| Saves while dragging / after the drop | 0 / 1 | 0 / 1 |

Chromium handles a stylesheet change incrementally, so its absolute times are small either way. The counts are what the fix removes: no stylesheet writes, no menu rebuild, no forced layout. WebKit's cost per stylesheet write is expected to be much larger. I could not measure WebKitGTK here without opening a window, so the real-app speed-up should be checked by hand in the release build.

**300-card drag** (`test-canvas-editing.mjs`, "300-card drag frames under 20ms"): before the fix, one run failed at 33.4 ms max (one dropped frame) and one passed at 16.8 ms. After the fix, two runs both passed at 16.8 ms max (48 and 49 intervals). Headless frame times round to whole frames (16.7 ms), so this can't show a speed-up smaller than a frame. It does show the test still passes.

## Tests

- **`npm run build`:** passed, with the existing chunk-size warning only.
- **`npm run audit:offline`:** passed (166 source files).
- **`flock /tmp/grove-npm-test.lock npm test`:** browser discovery 4/4; vitest 58 files, 669 tests.
  - The browser chain stopped once at `test-canvas-navigation.mjs`: "300-card/400-edge zoom presentation frames stay under 20ms" saw one dropped frame (max 33.4 ms, p95 16.7 ms). Zoom was not touched by this change, since a zoom always changes the values `draw()` writes.
  - A single rerun of that script under the lock passed (zoom max 16.8 ms, pan max 16.8 ms).
  - The rest of the chain, from the script after it through `posttest`, then passed in one run (exit 0). That includes `test-canvas-drag-work.mjs` (0 rule writes, 0 menu changes, 0 layout reads per move; one save after the drop) and "300-card drag frames under 20ms" (max 16.8 ms).
- **`flock /tmp/grove-npm-test.lock cargo test --offline`:** 54 passed, 1 ignored.
- **Screenshots:** the regenerated files under `rebuild/round*-shots/` were restored with `git checkout`.

## Left open

- **Pan and zoom still write the adopted stylesheet on every frame,** because the viewport really changes then. If panning also feels slow in the app, the next step is to put the four `--canvas-view-*` bounds on the toolbar element itself, the only thing that uses them, instead of on a stylesheet rule.
- **Please re-test dragging in the release build.** The numbers above come from Chromium.

## Part 2: alignment guides

Chris: "It also doesn't have the alignment helpers on the canvas." The reference was his screenshot of Obsidian (`.obsidian-align-ref.png`, behaviour only; no Obsidian code or assets were used). When a dragged card lines up with another, a thin accent line joins them (corner to corner along aligned edges, center to center for aligned middles), with small dots where it touches each card, and the card snaps into place.

Grove already snapped a dragged card to other cards' edges and centers ("Snap to objects", on by default, `editing.ts`), but it drew nothing, only looked at the card under the pointer, and scanned the whole board on every move. Now:

- **What lines up.** The moving box is the whole selection: one card, a multi-selection, or a group with its cards. Its left, center and right are checked against every other card's and group's left, center and right, and the same for top, middle and bottom. It snaps when within **6 screen pixels**, which is 6 ÷ zoom in board units, so it feels the same at any zoom. Before, it was 5 board units, measured from the pressed card only.
- **Guides.** While dragging, an accent-coloured line is drawn for each alignment, with a dot at each touching corner or center. The line is 1 screen pixel at any zoom (`vector-effect: non-scaling-stroke`) and the dots are 3 screen pixels. They are drawn in a new `svg.canvas-guides` layer on the board, only when the set of guides changes, and removed on drop or Esc.
- **Turning it off.** Hold **Alt** for a drag. Alt already turned off grid snapping and object snapping (Canvas help: "Disable snapping while dragging: Alt"), so it was the natural key, and Ctrl stays free. The "Snap to objects" setting still turns it off for good. Shift's axis lock still applies, and the locked axis doesn't snap.
- **Resize** aligns too, for the edge being dragged only: dragging a card's bottom edge level with a neighbour's bottom snaps and shows that guide. The 50 × 50 minimum size still wins over a snap.
- **Speed.** When a drag starts, the other cards' edges and centers are put into one sorted list per axis (3 per card). Each frame is then a binary search for each of the moving box's three lines, O(log n), instead of the old scan of every card. All of it runs inside the same per-frame update as part 1. Unknown node types without a size are skipped, so they can't break the sorted lists.

**Files:**

| File | Change |
|---|---|
| `canvas/align.ts` (new) | `alignTargets`, `snapOffset`, `guidesFor` (pure) |
| `canvas/align.test.ts` (new) | 6 unit tests |
| `canvas/editing.ts` | The drag and resize use it; guides are cleared on drop |
| `canvas/view.ts` | Guide layer, passed in as the new last argument of `canvasEditing` |
| `styles/canvas.css` | Three lines of guide styles |
| `scripts/test-canvas-drag-work.mjs` | Headless alignment checks |

**Tests:**
- **Unit (`align.test.ts`):** snapping within and outside the distance, center to center, the nearer of two candidates, the distance scaling with zoom, size-less boxes skipped, guide geometry (top edges joined corner to corner with four dots; centers joined with two), a resized edge, and 300 cards.
- **Headless (`test-canvas-drag-work.mjs`):** with grid snapping off, card B is dragged until its top is 3 units below card A's top. During the drag, a horizontal guide at A's top shows (plus the middle and bottom ones, since the cards are the same height), the corners get dots, and B snaps to `top: 10px`. On the drop, the guides clear and `y: 10` is saved. With Alt held, there are no guides and no snap (`y: -7`).

**Checks for part 2:**
- **`npm run build`:** passed. **`npm run audit:offline`:** passed (167 source files).
- **`flock /tmp/grove-npm-test.lock npm test`:** passed in one run (exit 0), with no reruns.
  - Browser discovery: 4/4. Vitest: 59 files, 675 tests.
  - Every browser script passed, plus `posttest`. The 300-card timings still pass: drag max 16.8 ms; pan and zoom; edge create and reconnect 16.8 ms; explorer drag 16.8 ms.
  - The drag-work counts are unchanged: 0 rule writes, 0 menu changes, 0 layout reads per move.
- **`flock … cargo test --offline`:** 54 passed, 1 ignored.
- **Screenshots:** restored.

**Left for later:**
- **Off-screen cards.** Guides compare against every card on the board, not only the visible ones. The sorted lists keep that cheap, but a far-away card can produce a guide that runs off-screen. Limiting targets to the viewport would need the viewport bounds passed in from navigation.
- **Equal spacing.** There is no "same gap" guide (equal spacing between three cards). The screenshot didn't show one.
