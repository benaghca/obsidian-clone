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
