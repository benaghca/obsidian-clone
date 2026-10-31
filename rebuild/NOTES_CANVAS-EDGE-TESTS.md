# Canvas edge tests

Branch `rebuild/canvas-edge-tests-grok`, from `c0ad2bf` (`rebuild/integration`). Local commits only. Nothing pushed. No app window was opened. Product code is unchanged: nothing under `rebuild/app/src/` and no edit to `rebuild/app/package.json`.

Headless Chromium via `scripts/browser.mjs`, under `flock /tmp/grove-npm-test.lock`. Scratch vaults are the driver's temp dirs. Chris's vaults were not opened.

## Tests added

Three scripts. Each one starts its own browser. A shared helper would be a new module next to the scripts, and a later test glob could pick it up.

| Script | PASS | Fail | Skip |
| --- | ---: | ---: | ---: |
| `rebuild/app/scripts/test-canvas-edge-hover.mjs` | 47 | 0 | 0 |
| `rebuild/app/scripts/test-canvas-edge-menu.mjs` | 159 | 0 | 0 |
| `rebuild/app/scripts/test-canvas-edge-titles.mjs` | 45 | 0 | 0 |

`git diff --numstat` for the three new files (insertions, deletions):

| File | + | − |
| --- | ---: | ---: |
| `rebuild/app/scripts/test-canvas-edge-hover.mjs` | 398 | 0 |
| `rebuild/app/scripts/test-canvas-edge-menu.mjs` | 353 | 0 |
| `rebuild/app/scripts/test-canvas-edge-titles.mjs` | 340 | 0 |

### Hover (`test-canvas-edge-hover.mjs`)

CZ-H on `EdgeHover.canvas`: a text card, a note card, and a file card whose wikilink sits below the card box.

- A move without Ctrl, a touch pointer, and Ctrl with a button held do not open a preview.
- The baseline Ctrl+hover preview is one body child, `position: fixed`, unscaled, on screen, on top of its own box, with no animations, and outside `.canvas-view`.
- The clipped link has no hit point. Hovering where it would be does not preview it.
- Moving from one link to the other keeps a single preview. After that popover is closed, the note card still previews.
- A link parked on the canvas's right edge still gets an on-screen unscaled preview.
- A wheel whose target is inside the popover leaves it open and does not pan or zoom.
- Ctrl+wheel during the 350ms delay zooms and the preview never opens. The zoom-out button dismisses an open preview and still zooms. Space dismisses. Space+drag pans and the preview stays closed.
- A card pushed fully past the view's left edge is not previewed by Ctrl+hover in the empty view. Shift+1 brings the link back at scale 1.
- A hover that starts while a wheel toward 42% is still settling (the link is still the hit target, title mode is not on yet) opens one unscaled preview after title mode settles.
- In title mode, the card center does not preview the hidden link.
- An editing card stays painted in title mode (`content-visibility` is not `hidden`). Ctrl+hover on its link opens an unscaled preview and leaves the editor up.

### Menu (`test-canvas-edge-menu.mjs`)

CZ4 on `EdgeMenu.canvas`, then `EdgeZoom.canvas`.

- All four canvas corners open the full board list, on screen, unscaled, outside the canvas, with no animations. A second corner replaces the first menu. Every item's box stays on screen.
- Blank clipboard text adds nothing: empty, whitespace, BOM, em-spaces, nbsp.
- These stay one 250×60 text card, editor closed: a zero-width space, a null, an emoji, a lone surrogate after the clipboard replaces it (below), `mailto:`, `javascript:`, `data:`, `http://`, a URL with a space, a URL inside a sentence, two URLs, a URL with a following line.
- These become one 400×120 link card and do not fetch: a URL with a trailing zero-width space, a padded mixed-case URL, a URL wrapped in whitespace, a URL wrapped in nbsp, an 8k URL.
- A 100,000-character paste is one text card, editor closed, no fetch. Undo restores the exact previous bytes.
- Add web page adds nothing and does not fetch for an empty string, whitespace, `https://`, a URL with a space, `javascript:`, a protocol-relative URL, or a URL split by a newline.
- Add web page accepts a padded URL, mixed case, `http://127.0.0.1:9/x`, `http://[::1]/index`, a userinfo URL, and a 4k path. The dialog is on screen. The card is 400×120, top-left on the pointer, and nothing is fetched.
- At scale 1/16 the board is in title mode and the menu is the same width as at 100% (186.15625px). Paste of "Zoom paste" sits on the pointer, does not open an editor, and hides the body. The title text is "Zoom paste" and its display is `none` because the card's title band is `-4` (under the 50×26 screen-pixel floor). Add web page of `http://localhost:9/grove` is a 400×120 link on the pointer and does not fetch.
- At scale 2 the menu width matches again. Pasting `https://jsoncanvas.org/spec` creates a link on the pointer. The saved `x`/`y` match `point()`.

### Titles (`test-canvas-edge-titles.mjs`)

CZ2 on `EdgeTitles.canvas` (a text card and a group), then `EdgeHuge.canvas` (4000×2400).

- Three zoom-out clicks enter title mode within a frame of the third click (flush), and the class stays after the buttons rest.
- A one-turn burst from titles, ending inside the band, does not flip the class during the turn or on the next frame. After the 120ms settle, titles stay and the scale is inside (45%, 55%]. The same shape from content keeps content.
- A wheel out of title mode and back within the settle never leaves title mode.
- A pan during a pending leave moves the board and leaves the class waiting. After the zoom rests, title mode leaves.
- A zero-delta Ctrl+wheel during a pending leave does not apply the class early. The leave still happens after the rest.
- Zoom out during a pending leave flushes the new scale immediately. The cancelled wheel does not change that scale later.
- A burst ending at 55% from titles stays in title mode. A burst ending at 45% from content stays on content.
- A double-click while a wheel out of title mode has not settled frames the card and does not edit. The in-flight wheel does not pull the framed scale back.
- A double-click while a wheel into title mode has not settled edits. When title mode settles, the editor stays and the body is not `content-visibility: hidden`.
- Space+double-click does not frame, edit, or add a card.
- Double-clicking a group body does not zoom, edit, or add a card. Double-clicking the group label edits it. Escape, the zooms, and that label edit leave the file bytes unchanged.
- Read-only: the first double-click frames and does not edit. The second does not edit or zoom again.
- The huge card opens fitted in title mode. The first double-click frames. One wheel notch, then a double-click, frames again. The next double-click, with the scale at rest, edits.

## Bugs

No product bug showed up. Nothing is skipped or marked expected-fail.

Two results looked like failures until the assertion matched the code:

- A lone surrogate (`U+D800`) is replaced with `U+FFFD` by Chromium's clipboard before Grove reads it. `navigator.clipboard.readText()` and the stored card text are the same replacement. Grove stores that text as one 250×60 text card. Repro is the surrogate paste in the menu script. This is the clipboard encoding, not a Grove rewrite.
- At 1/16, "Zoom paste" does not paint its title. `titleBand(250, 60)` is `-4`, and zoom band `-16` hides that band. The card is about 16×4 screen pixels, under the 50×26 floor in `navigation.ts`. The title element still holds the text, the body is `content-visibility: hidden`, and the card is not editing.

## package.json

Left untouched, for the branch that owns the test script. Insert these three pieces into the `test` string:

- After `node scripts/test-canvas-hover.mjs`, add ` && node scripts/test-canvas-edge-hover.mjs`
- After `node scripts/test-canvas-board-menu.mjs`, add ` && node scripts/test-canvas-edge-menu.mjs`
- After `node scripts/test-canvas-navigation.mjs`, add ` && node scripts/test-canvas-edge-titles.mjs`

## Decisions

- The spec under test is Grove's own notes and the current source: `NOTES_CZ2.md`, `NOTES_CZ2-REVIEW.md`, `NOTES_CZH.md`, `NOTES_CZ4.md`, and `CANVAS_ZOOM_PLAN.md`, plus the comments in `navigation.ts`, `editing.ts`, `hoverPreview.ts`, `cards.ts`, and `links/external.ts`. Those notes already cite `https://obsidian.md/help/plugins/canvas` and Chris's approved D1–D4. This pass did not open Obsidian and did not copy any Obsidian code or assets. The public help page was not re-read.
- Same-turn wheel bursts are synthetic `WheelEvent`s, because the canvas applies wheel zoom without an `isTrusted` check and the DOM scale is stale until the frame. Settle races use CDP wheels. Double-clicks that must beat the 120ms settle use a press/release pair with no extra sleep. There is no CSS transition on `.canvas-world`. The settle timer is the zoom wait those tests mean.
- A double-click follows the title-mode class already on the world. A wheel that has been painted, whose class has not settled, still counts as the old mode.
- `loneWebUrl` keeps a trailing `U+200B`, so `https://example.com/` plus a zero-width space is a link card and the stored URL still contains that character. The test locks that in. `trim` removes nbsp and ordinary whitespace, and those pastes store the trimmed URL.
- Fit is Shift+1 on a focused canvas. A button `.click()` from the page did not fit reliably. Reset zoom keeps the current center, so after a pan the card can sit under the file explorer. The hover edit case fits first, then double-clicks a point `elementFromPoint` confirms is on the card and not the link.
- The menu script undoes each paste and each web page so the board stays one anchor card. The 100k undo compares file bytes.

## Checks

From `rebuild/app`:

- `npm run build` passed (`tsc --noEmit && vite build`, 2130 modules, built in 212ms). The existing Vite chunk-size warning remains.
- `node scripts/test-canvas-edge-hover.mjs`: 47 PASS, exit 0.
- `node scripts/test-canvas-edge-menu.mjs`: 159 PASS, exit 0.
- `node scripts/test-canvas-edge-titles.mjs`: 45 PASS, exit 0.

No screenshots were written. `rebuild/round*-shots/` is clean. Full `npm test`, `npm run audit:offline`, and `cargo test` were not run. The prompt says those stay off when product code is unchanged.

## For Chris

- Wiring the three scripts into `package.json` is still open. The lines are above.
- A URL that contains `U+200B` is a link. Say if that should stay text.
- A trusted double-click in the same turn as a wheel, before the new scale is painted, was not automated. CDP cannot deliver that pair in one turn. The suite covers the class during the 120ms settle, which is the wait Grove actually has. No failure of that painted-scale case was seen.
- Codex still owns canvas rendering. These scripts only observe it.
