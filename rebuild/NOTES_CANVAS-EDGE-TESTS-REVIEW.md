# Canvas edge tests review

Reviewed `rebuild/canvas-edge-tests-grok` (`a13e558`, tests `1de95e0`, from integration `c0ad2bf`) on `rebuild/edge-tests-review-grok`. `rebuild/k6-review-grok` was not committed to. Nothing was pushed. No app window was opened. Scratch vaults are the driver's temp dirs. Chris's vaults were not opened.

The branch adds three headless scripts and `rebuild/NOTES_CANVAS-EDGE-TESTS.md`. It does not edit `rebuild/app/src/`. The notes match the scripts: Ctrl+hover (CZ-H), the empty-canvas menu (CZ4), and title mode (CZ2). Nothing is skipped or marked expected-fail.

## What the assertions catch

Each script was run three times under `flock /tmp/grove-npm-test.lock` after `npm run build`, from `rebuild/app`. Every run exited 0 with the same counts: hover 47, menu 159, titles 45.

The checks are the product results, not the sleeps. The long waits are the 350ms hover delay and the 120ms zoom settle. Cases that must stay closed check that before the wait ends. Paste and undo poll the file, then compare bytes, card type, size, and URL. A 100,000-character paste compares the whole string, and Undo compares the file bytes.

Hover, all three runs: a move without Ctrl, a touch pointer, and Ctrl with a button held do not open a preview. The open preview is one body child, `position: fixed`, 450px wide, unscaled, on screen, on top of its box, with no animations, and outside `.canvas-view`. The clipped link has no hit point. Moving from the text card to the note card keeps a single preview (the covered-link fallback did not run). A wheel inside the popover leaves scale and pan unchanged. Ctrl+wheel during the delay zooms (1 to about 1.32) and the preview never opens. The zoom-out button dismisses and still zooms. Space dismisses, and the following drag pans. A card pushed past the left edge is not previewed. A hover that starts while a wheel to 42% is painted, and title mode is not on yet, opens one unscaled preview after the class settles. Title mode does not preview the hidden link. An editing card stays painted (`content-visibility` is not `hidden`) and its link still previews.

Menu, all three runs: each corner's menu is one list, unscaled, outside the canvas, with no animations, and a corner of the box on that click. Minimum zoom is 0.0625 and in title mode. Maximum zoom is 2 and showing content. Menu width is 186.15625px at 100%, at 1/16, and at 2x. The ±3px allowance in the script was not used. "Zoom paste" at 1/16 is a 250×60 text card on the pointer, editor closed, title text present, title `display: none`, band `-4`, body hidden. The 2x URL paste is a 400×120 link whose saved `x`/`y` match `point()` (293, 199 on these runs). Blank clipboards, the lone surrogate (`U+FFFD` from the clipboard, stored as that text), and the refused web URLs add no card and do not fetch. The accepted URLs, including the trailing `U+200B`, are one link and do not fetch.

Titles, all three runs: three zoom-out clicks enter title mode, and the scale does not move again after the buttons rest. A one-turn burst ending at 0.500001 stays in title mode. The same shape ending at 0.48 stays on content. The 55% burst lands at 0.549999 and stays in title mode, so the 1e-6 float snap is what keeps it. The 45% burst lands at 0.45 and stays on content. A wheel out and back inside the settle never leaves title mode. A pan during a pending leave moves the board and the class still leaves after the rest. Zoom-out during a pending leave flushes, and the cancelled wheel does not change that scale later. Double-click during a pending leave frames and the in-flight wheel does not pull the scale back. Double-click during a pending enter edits, and the editor stays up when title mode settles. Space+double-click does not frame, edit, or add a card. A group body does not; the group label does. Read-only frames once and does not edit. The huge card opens fitted at 0.212727. The notch-then-double-click frames again, and the double-click after that scale rests edits.

## Fixes on this branch

`5591a98` and `1cd7bd6`. A second right-click used to pass whenever one menu was still on screen, including the menu left open at the first corner. The menu must now sit on the click that opened it. `showMenu` then keeps an 8px window margin, so a corner click inside that margin is up to 8px off the box. A 2px check failed on the right edge (menu right 1272.15625, click x 1277). 8px matches that margin. The second menu is also required to be more than 80px from the first. On every run it moved from (347, 81) to (1086, 468).

The title comments no longer say the in-band burst or the zero-delta wheel measure something those waits cannot separate.

- One turn draws only the last scale. An ending scale inside the band keeps the class that was already on, whether or not the class is applied on the next frame. The settle wait is the CDP wheel that goes to 72% and back to 36% inside 120ms: the class is still on at 40ms, and it is still on after the return.
- A zero-delta wheel does not apply the pending leave on that frame, and the leave still happens after the rest. The gap between "the timer was reset" and "the timer kept running" is shorter than a stable wait, so that case does not time the difference. The out-and-back wheel is what shows a later wheel replacing the pending one.

`66b7b62` inserts the three scripts into the `test` string where the notes said:

- `node scripts/test-canvas-hover.mjs && node scripts/test-canvas-edge-hover.mjs`
- `node scripts/test-canvas-board-menu.mjs && node scripts/test-canvas-edge-menu.mjs`
- `node scripts/test-canvas-navigation.mjs && node scripts/test-canvas-edge-titles.mjs`

## Scratch merge with integration

`git merge --no-commit` of this branch with `rebuild/integration` (`ec7a58a`) in a detached worktree under `/tmp`, then abort and remove. The merge was done at `66b7b62`. The later margin commit does not touch `package.json`.

The only conflict is `rebuild/app/package.json`, the `test` string. Integration added `node scripts/test-canvas-create.mjs` after `test-canvas-board-menu.mjs`. Keep both. One resolution is the review branch's three insertions, with `test-canvas-create.mjs` immediately after `test-canvas-edge-menu.mjs`.

These merged clean: `NOTES_CZ5.md`, `NOTES_CZ5-REVIEW.md`, `scripts/test-canvas-create.mjs`, `src/canvas/cards.ts`, `src/canvas/editing.ts`, `src/canvas/view.ts`, `src/shell/hoverPreview.ts`, `src/styles/canvas.css`. The hunks add the Ctrl+drag create box and remember pointer buttons for the hover keydown path. Paste, `loneWebUrl`, the board menu, title-mode settle, and the pointermove rules these scripts use are unchanged. The three scripts were not re-run on the merged tree.

## Checks

From `rebuild/app`, on `1cd7bd6`:

- `npm run build` passed (`tsc --noEmit && vite build`, 2130 modules). The existing Vite chunk-size warning remains.
- Each new script, three times, under the flock: 47, 159, and 45, exit 0.
- `flock /tmp/grove-npm-test.lock npm test` passed, exit 0. Vitest: 72 files, 1242 tests, including 444 parity cases. The run includes the three new scripts (the anchored corner menu, the single hover swap, the 100k paste, and the huge-card edit). 300-card drag max 16.8ms. Pan and zoom max 16.8ms.
- `npm run audit:offline` passed: 184 source files, dist, CSP, capabilities, and dependencies.
- `cargo test --offline` in `rebuild/app/src-tauri`: 73 passed, 4 ignored.

`npm test` rewrote `rebuild/round*-shots/`. Those files were restored and are not part of this branch. No screenshots were written by the three new scripts.

## Left as they were

A URL that still contains `U+200B` after trim is a link card. The menu script locks that in. A trusted double-click in the same turn as a wheel, before the new scale is painted, is still not automated. CDP cannot deliver that pair in one turn. The class during the 120ms settle is what the suite covers.

VERDICT: OK

## EDGE-SYNC

Merged `rebuild/integration` (`4f9163c`) into `rebuild/edge-tests-review-grok` (`8fd03f4`) with `git merge --no-ff`. Nothing was pushed. No ceiling was loosened.

The only conflict was `rebuild/app/package.json`, the `test` and `posttest` strings. Both sides stay, each script once. JSON parses (`name` grove).

- `test` keeps the three canvas edge scripts. Integration's `node scripts/test-canvas-create.mjs` sits immediately after `node scripts/test-canvas-edge-menu.mjs` and before `node scripts/test-r27i.mjs`. Titles stay immediately after `test-canvas-navigation.mjs`. Hover stays immediately after `test-canvas-hover.mjs`. 62 steps, all unique.
- `posttest` is integration's string. `test-bases-list.mjs` sits after `test-bases-kanban-move.mjs` and before the property-edit fuzz. 9 steps, all unique.
- K6 adds no script name. Its cases stay in `test-bases-kanban-move.mjs` (in `posttest`) and in `test-bases-b0.mjs`, which `test-bases.mjs` imports. `test-bases.mjs` is already in `test`.

`test-bases-b0.mjs`, `test-bases-kanban-move.mjs`, `test-bases-list.mjs`, and `test-canvas-create.mjs` match `4f9163c`. They still carry the K6 own-write cases and the K8 list script. `git diff rebuild/integration -- rebuild/app/src` is empty, so the merged canvas and bases sources are integration's: the CZ5 create box, the K8 list layout, and the K6 own-write skip. This sync does not edit `src/` by hand.

Ceilings left as written: list 10k scroll `p95 <= 20` and `max <= 25`; K5 drag `p95 <= 20`, `max <= 25`, `maxEvent <= 1`; b0 typing beside a 10,000-note board `p10FrameMs < 20`.

From `rebuild/app`, on the resolved tree, one run each. No timing flake, so no second run.

- `npm run build` passed (`tsc --noEmit && vite build`, 2132 modules). The existing Vite chunk-size warning remains (`index-CSArzFUv.js` 1,140.50 kB). CSS is `index-Djwi7bkH.css` 122.98 kB.
- `flock /tmp/grove-npm-test.lock npm test` exit 0. Vitest 73 files, 1248 tests, including 444 parity cases. The suite ran the three edge scripts (anchored corner menu, baseline hover preview, title mode after the buttons rest), the K6 own-write skip ("own write keeps the columns mounted"), and the K8 list scroll. 300-card drag max 16.8 ms. Pan and zoom max 16.8 ms. K5 10k drag p95 16.8, max 16.8, handler max 0.5 ms. K8 list: 1,000 warm open 10.4 ms; 1,000 scroll max 16.8, p95 16.7, 45 rows, top 27218; 10,000 warm open 14.4 ms (cold 36); 10,000 scroll p95 16.8, max 16.8, 45 rows, top 279218.
- `npm run audit:offline` passed: 186 source files, dist, CSP, capabilities, and dependencies.
- `cargo test --offline` in `rebuild/app/src-tauri`: 73 passed, 4 ignored. This merge does not touch `src-tauri`.

`npm test` rewrote `rebuild/round*-shots/`. Those files were restored with `git checkout` and are not in this commit. No app window was opened.

The verdict stays OK.

VERDICT: OK
