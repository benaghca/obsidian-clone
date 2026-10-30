# Canvas lag and alignment review

Reviewed `rebuild/canvas-lag-claude` at `22baf21` on branch `rebuild/canvas-review-grok`. The two commits are `9a8e302` (stop restyling the page on every canvas drag move) and `22baf21` (show alignment guides while dragging canvas cards). Parent is integration `c54026a`. Claude's branch was not moved. Nothing was pushed. No product file was edited.

The diff `c54026a..22baf21` is 10 files, +426 / −27. Relied on `rebuild/NOTES_CANVAS-LAG.md`, the reference screenshot `grove-n-claude-a/.obsidian-align-ref.png` (appearance only; no Obsidian code or assets), and the Canvas help line those notes already quote: "Disable snapping while dragging: Alt". `RUST_MIGRATION_PLAN.md` sections 1–2 leave canvas in TypeScript. This work does not move any of it.

## The lag cause and the fix

Both claims match the code.

A drag was already one update per animation frame (`dragPointer` in `shell/dom.ts`), and a save was already deferred until 300 ms after the drop. Two things inside that frame were expensive:

1. `paint` calls `navigation.loaded()` on every move. `draw()` in `canvas/navigation.ts` then wrote `--canvas-inverse-scale` and the four `--canvas-view-*` bounds into an adopted stylesheet, even when the viewport had not changed. A stylesheet write restyles the page. `draw()` now remembers the last viewport key (`x y scale width height`) and returns before those writes when it matches. `canvasViewports.set` still happens first, so a live tab keeps its viewport.
2. The move called the selection menu's `update()`, which rebuilt buttons and then read `offsetTop` / `offsetHeight` after the card positions were written. `editing.ts` now calls `paint(affected)` and `menu.place()` while a card or a resize handle is moving. `place()` only sets `--canvas-menu-x` and `--canvas-menu-y`. A card label's offset inside its card is measured once in `update()`, and `place()` adds that to the card's model `y`. Edge labels are still measured in `place()`, and only when an edge is part of the selection. A card drag does not select an edge.

Cancel, arrow nudges, and selection changes still go through the full `update` / `repaint`. Pan, zoom, and resize of the viewport still write the stylesheet, because the key really changes.

## What else still behaves

Checked in the drag and resize path, and in the tests below:

- **Pan and zoom.** Unchanged except that an unchanged viewport no longer rewrites the sheet. The 300-card board still pans (max 16.7 ms) and zooms (max 16.8 ms).
- **Resize.** Only the dragged edges snap. The 50×50 minimum is applied after the snap, and the guides are taken from the clamped box, so a snap that would break the minimum does not leave a lying guide.
- **Grid snap and Alt.** Grid snap is still 20 board units unless Alt is held or the setting is off. The editing script still passes "Move snaps to a 20-unit grid" and "Alt bypasses grid snapping".
- **Shift axis lock.** A locked axis is skipped for object snap (`dx` or `dy` stays 0).
- **Multi-select.** The moving box is the union of the selection. The drag-work script shift-selects both note cards and moves them together.
- **Groups.** `moving()` still includes cards fully inside a selected group, and those cards are not alignment targets.
- **Undo and cancel.** A drop commits geometry that changed. Esc calls `dragPointer`'s cancel, which does not re-apply the last move. The end callback clears the guides and `finish` restores the positions. The editing script still passes "Escape during a move restores the card" and "Escape cancels a live drag without saving".
- **Edge labels.** Reconnect still does not use alignment. A card drag's measured layout reads stayed at 0.

## Alignment guides

The reference is two equal-height cards. Three accent lines join them: the top edges, corner to corner, with a dot on each corner; the centers, center to center, with a dot at each center; and the bottom edges the same way as the top. A separate connection sits on the left card's right side. Its midpoint dot is an edge, not a guide. The colour in the shot is that theme's accent.

`guidesFor` draws that geometry. An edge stop puts a dot on both corners of each box. A center stop puts a dot on each box's center. The line runs from the outermost dot to the other. `canvas.css` strokes the line with `--interactive-accent` at 1 screen pixel (`vector-effect: non-scaling-stroke`) and fills the dots the same colour. The layer is `svg.canvas-guides` at z-index 3, above cards at z-index 2, so the line sits on the border. The dot radius passed in is `3 / scale`, which is 3 screen pixels of radius. On the reference those dots are small accent circles on the line. That matches.

Snap distance is `6 / scale` board units, so it stays 6 screen pixels as zoom changes. The unit test covers 6 at 100% and 12 at 50%. Alt turns guides and object snap off, and the "Snap to objects" setting does too (`snapToObjects` defaults on). The headless check, with grid snap off, drags card B until its top is 3 board units below A's top at y=10: during the drag the guides are at y=10, 110, and 210, the corners have dots, and B's top becomes `10px`. The drop clears the guides and saves `y: 10`. With Alt (modifiers 1) there are no guides and the saved y is `-7`.

Targets are sorted once when the drag starts (three lines per other card). Each frame is a binary search, then a walk of the lines that actually meet the snapped coordinate. That is not a scan of every pair on every move. `align.test.ts` builds 900 lines from 300 cards and snaps to the nearest. The 300-card drag frame test still passes at max 16.8 ms.

`show` replaces the guide DOM only when the guide list changes. Drop and Esc both call `show([])` before `finish`.

## Checks

No flake rerun. The 300-card and 1000-row timings passed on the first run.

- `npm run build` (twice, once on its own and once inside the audit): passed. The chunk-size warning is the existing one.
- `flock /tmp/grove-npm-test.lock npm test`: one run, exit 0. Browser discovery 4/4. Vitest 59 files, 675 tests. `posttest` passed.
  - Drag work, 30 moves: 0 stylesheet writes, 0 menu DOM changes, 0 layout reads, 0 saves while moving, 1 save after the drop. Style recalcs 1.43 and layouts 1.0 per move.
  - Alignment lines above, including clear-on-drop and Alt.
  - 300-card drag max 16.8 ms (48 intervals). Pan max 16.7 ms. Zoom max 16.8 ms. Edge create and reconnect max 16.8 ms. Explorer drag max 16.8 ms. 1000-row scroll max 16.7 ms.
- `npm run audit:offline`: passed, 167 source files.
- `flock /tmp/grove-npm-test.lock cargo test --offline`: compiled `grove` and passed, 54 tests, 1 ignored.
- `cargo build --offline`: passed (dev profile, already compiled).
- Screenshots regenerated under `rebuild/round*-shots/` were restored with `git checkout` and were not committed.

## Left as Claude left it

These are already written up in `NOTES_CANVAS-LAG.md`. They are not regressions of this branch.

- Pan and zoom still write the adopted stylesheet every frame, because the viewport changes. If panning feels slow in the app, the four `--canvas-view-*` bounds could move onto the toolbar.
- Guides consider every card, including ones outside the viewport, so a far card can draw a line that runs off-screen.
- There is no equal-spacing guide. The reference does not show one.
- WebKitGTK was not timed. These numbers are headless Chromium. A hand drag in the release build is still worth doing.

VERDICT: OK
