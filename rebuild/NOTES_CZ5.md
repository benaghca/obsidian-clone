# CZ5: Ctrl+drag to create

Branch `rebuild/canvas-cz5-grok`, from `565d826`. Nothing pushed. No app window was opened. Browser checks were headless Chromium under `flock /tmp/grove-npm-test.lock`.

## What changed

Ctrl (Cmd on macOS) held on empty writable canvas draws an accent box. On release, the box's menu is the shared add list: Add card, Add note from vault, Add media from vault, Add web page, Create group. The new item takes the box's position and size in board units, with the existing 50×50 minimum. Esc, a click elsewhere, or a box under 10 screen px drops it. Read-only Ctrl+drag still selects. A drag that starts on a card, edge, or label is unchanged.

Files (tracked diff `471` insertions, `7` deletions):

| File | + | − |
| --- | ---: | ---: |
| `rebuild/app/src/canvas/editing.ts` | 48 | 2 |
| `rebuild/app/src/canvas/cards.ts` | 7 | 3 |
| `rebuild/app/src/canvas/view.ts` | 3 | 1 |
| `rebuild/app/src/styles/canvas.css` | 1 | 0 |
| `rebuild/app/package.json` | 1 | 1 |
| `rebuild/app/scripts/test-canvas-create.mjs` (new) | 411 | 0 |

## Decisions

- **One add list.** `createMenu` calls CZ4's `addItems` with `atStart: true` and the class `canvas-create-menu`. `view.ts` only passes that callback into `canvasEditing`. Both width and height set still means media keeps the box, clamped to 50×50 in `insertFile`, with the existing `object-fit: contain` on file images. Empty text still opens the editor. Create group still uses `makeNode` (`id`, `x`, `y`, `width`, `height`, `type`, `label` `Untitled group`) and does not open the label editor. The selection toolbar's Create group is untouched.
- **The modifier.** `isMac ? metaKey : ctrlKey`, the same split as hover preview. On this Linux test host that is Ctrl.
- **Snap.** With snap-to-grid on, corners round to 20 board units. Alt, or snap-to-grid off, uses step 0, so the box follows the pointer in screen space with no board-pixel rounding. Card drags use step 1 in that case. Alt's job matches those drags: it turns the grid off. The menu opens at the snapped release corner, in client coordinates. `showMenu` still flips that point if it would pass the viewport edge.
- **Ten pixels.** Cancel when either screen side of the drawn box is under 10 (`sw < 10 || sh < 10`). A snapped zero-size box cancels. One grid cell is 20 screen px at scale 1, so it opens, and `sized()` then grows the item to 50×50 at that cell's top-left.
- **The box.** One element appended to `.canvas-view`, so it stays in screen space while the world is scaled. `border-box` keeps the 2 px border inside the rect. Fill is `color-mix` of the accent at 12%. z-index 3, `pointer-events: none`, no radius, no animation. The plan text specifies 2 px and 12%. The mockup stylesheet uses a 3 px border and a 2 px radius; the implementation follows the plan text. The view rect and world matrix are read once on pointerdown. Each move writes only the box's `left`, `top`, `width`, and `height`.
- **How long it stays.** The box remains until `.canvas-create-menu` leaves `document.body`. Esc and a click elsewhere close the menu, and the observer removes the box. The next canvas `pointerdown` also clears a leftover box before a new gesture. Dispose cancels an in-progress drag first, so that drag does not open a menu, then clears the box and closes the menu if it is still connected.
- **Selection.** A create drag does not clear or update the card selection. Shift held with the create modifier still creates. The plan does not mention Shift.
- **Read-only.** The create branch is skipped, so the existing marquee runs.
- **Help.** No new help row. The plan's list for this gesture does not include one.

## What I relied on

Obsidian's public Canvas help page, `https://obsidian.md/help/plugins/canvas`, as read for CZ4 on 2026-10-30. It says nothing about Ctrl+drag. The gesture comes from `rebuild/CANVAS_ZOOM_PLAN.md` §5.5 and §9, and from the mockup `rebuild/canvas-zoom-mockups/ctrl-drag.png` (and `.html`). Chris approved the build split and D1–D4 on 2026-10-30. Grove's canvas code and `NOTES_CZ4.md` were the other sources. No Obsidian code, CSS, icons, or assets.

## Checks

From `rebuild/app`, on this branch:

- `npm run build` passed. The existing Vite chunk-size warning remains.
- `flock /tmp/grove-npm-test.lock node scripts/test-canvas-create.mjs` passed, then the full `flock /tmp/grove-npm-test.lock npm test` passed, including browser scripts and posttest. Vitest: 72 files, 1241 tests, of which 444 are parity. No failure, so no timing flake was rerun.
- `npm run audit:offline` passed: 184 source files, dist, CSP, capabilities, and dependencies.

From `rebuild/app/src-tauri`, with `--offline`:

- `cargo build` passed.
- `cargo test` passed: 73 passed, 4 ignored.

Frame numbers from that locked `npm test`:

- 300-card drag: max 16.8 ms, 49 intervals.
- 300-card/400-edge pan: 70 samples, p95 16.8 ms, max 16.8 ms. Compositor: 24 steps, 22 drawn, 2 dropped.
- 300-card/400-edge zoom: 70 samples, p95 16.7 ms, max 16.8 ms. Compositor: 24 steps, 22 drawn, 0 dropped.
- 1,000-row Bases scroll: max 16.8 ms.
- 1,000-card create drag: 0 `getBoundingClientRect` reads, 0 world mutations, 48 intervals, max 16.8 ms. The dedicated script, run before the full suite, was 47 intervals at the same max.

`rebuild/round*-shots` was restored and not committed. Prompt files were not committed.

## Left open

- Shift with the create modifier starts a create drag. The plan does not say what Shift should do.
- The help dialog still has only the CZ4 row, Canvas menu / Right-click.
- The box follows the plan's 2 px outline. The mockup's 3 px border and 2 px radius are not drawn.
