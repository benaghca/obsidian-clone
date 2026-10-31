# CZ-H review

VERDICT: OK

Reviewed `rebuild/canvas-czh-grok` (`4398f58`, notes `fa47354`) on `rebuild/czh-review-grok`. Grok c's branch was not moved. Nothing was pushed. No GUI window was opened. Relied on `rebuild/CANVAS_ZOOM_PLAN.md` §5.4 and `rebuild/NOTES_CZH.md`. The plan's Pointer Events point is the one used here: `preventDefault()` on `pointerdown` suppresses compatibility mouse events, and Chromium clears that at `pointerup`. No Obsidian code or assets.

The hover change stays in scope. `4398f58` edits `shell/hoverPreview.ts`, its unit test, `scripts/test-canvas-hover.mjs`, and the `package.json` test script. It does not touch canvas zoom (`controls.ts`, `editing.ts`, `labels.ts`, `navigation.ts`) or the empty-canvas menu. One small fix is on this branch as `1e5d012`. It adds a `data-path` on the card in `canvas/view.ts` and does not change zoom, pan, or drawing.

## What already matched

Ctrl/Cmd+hover (pen as well as mouse) over a wikilink in a text card and a note card opens the same body popover as the editor: `position: fixed`, unscaled, on top, beside the link, including while the card is selected, while it is being edited, and at scale 0.5. A plain `mousemove` does not open it. Pressing Ctrl while the pointer is already still does. Touch does not. A held button does not start a preview.

Escape, Ctrl+wheel (zoom still changes), a wheel pan, and leaving the canvas (`ws.open` of another file, which emits `show`) all remove the popover. Dragging a card still moves it. Six open-and-Escape cycles left no `.hover-popover`, and a later preview still opened. Dismissal listeners are an `AbortController` installed only while a hover is pending or open, so they do not show up as matching `removeEventListener` calls. CodeMirror removes its own window listeners in `EditorView.destroy`. That counter gap is not a leak.

Missing wikilinks and markdown links preview. A link painted inside an embed still previews that link, because `[data-href]` wins over the embed.

## Fix

Two hover targets did not match the editor. Both are headless and both are fixed in `1e5d012`.

A canvas tab has no note path. `pathOf` on the pane editor is null, so every canvas link resolved with `from === null`. Duplicate names then pick the first equal-depth match. `[[Twin]]` in `b/Other.md` previewed `a/Twin.md`. A text card has the same problem: its temporary editor is not registered, so `pathOf` is null there too.

Each card now records where its links resolve from. A text card stores the canvas file. A file card that is a note stores that note. Hover uses the editor path when one exists (an open note, or a note card being edited), and otherwise the card path. The sidebar still passes `from === null`. `b/Board.canvas` then resolves `[[Twin]]` to `b/Twin.md`, `a/Card.md` to `a/Twin.md`, and `b/Other.md` to `b/Twin.md`.

`![[PreviewTarget]]` and a missing `![[embed]]` did not preview on a canvas card. Reading cards are painted into `.canvas-node-content`, not a live CodeMirror DOM, so `linkAt` never sees them, and the embed root has no `data-href`. Clicks stay on `[data-href]` only, so the embed root must not grow that attribute or a click would open the whole embed. `NoteEmbedWidget` sets `data-embed-href` to its target on the missing box, the cycle chip, and the markdown embed. Inspect uses it only after `data-href` and `linkAt` miss, and reads one rect for that embed. In the editor, `linkAt` still places the preview on the source span.

| File | Lines |
|---|---|
| `rebuild/app/src/shell/hoverPreview.ts` | +10 / −1 |
| `rebuild/app/src/canvas/view.ts` | +3 |
| `rebuild/app/src/editor/embeds.ts` | +6 / −3 |
| `rebuild/app/src/shell/hoverPreview.test.ts` | +13 / −4 |
| `rebuild/app/scripts/test-canvas-hover.mjs` | +87 |

## Pointer-move cost

Synthetic `pointermove` bursts on a fitted 300-card and 1,000-card canvas (text cards, one `[[Welcome]]` each). The 350 ms open timer was stubbed so no popover was built. `getBoundingClientRect` and `elementFromPoint` were counted only during the burst. `performance.now` steps by about 0.1 ms, so a p50 of 0 is under the timer. "Before" is `hoverPreview.ts` at `18f43a9`. "After" is `fa47354`. "Fixed" is `1e5d012`.

Ctrl+hover on a link is the only case that reads layout, and it reads one rect. Moves with no Ctrl, and Ctrl on the card body, read zero rects and call `elementFromPoint` zero times. The cost does not grow from 300 cards to 1,000. The embed lookup did not add a rect on these boards: they have wikilinks, and the embed walk runs only when no `data-href` was found.

| | 300 before | 300 after | 300 fixed | 1000 before | 1000 after | 1000 fixed |
|---|---:|---:|---:|---:|---:|---:|
| Pointer on link, Ctrl, mean ms | 0.002 | 0.020 | 0.021 | 0.002 | 0.024 | 0.027 |
| Same, p95 / max ms | 0 / 0.1 | 0.1 / 0.3 | 0.1 / 0.3 | 0 / 0.1 | 0.1 / 0.2 | 0.1 / 0.2 |
| Same, rects per move | 0 | 1 | 1 | 0 | 1 | 1 |
| Mouse on link, Ctrl, mean ms | 0.018 | 0.002 | 0.002 | 0.023 | 0.002 | 0.002 |
| Same, rects per move | 1 | 0 | 0 | 1 | 0 | 0 |
| Body, body+Ctrl, link without Ctrl, rects | 0 | 0 | 0 | 0 | 0 | 0 |
| Open, ms | 493 | 476 | 467 | 1432 | 1441 | 1438 |

Before `18f43a9` the listener was `mousemove`, so the pointer bursts were idle and the mouse burst paid the one rect. After CZ-H that cost sits on `pointermove`. Means stay around 0.02 ms.

## Tests

- `npm run build`: passed. The existing chunk-size warning only.
- `npm run audit:offline`: passed, 180 source files.
- `flock /tmp/grove-npm-test.lock npm test`: passed on the first run (about 10 minutes), including `posttest`. Vitest 70 files, 1231 tests. `test-canvas-hover.mjs` passed the builder cases and the new ones (folder resolution, both embeds, wheel pan, canvas close). 300-card pan max 16.8 ms, zoom max 16.8 ms, drag max 16.8 ms. 1000-row Bases scroll max 16.8 ms. No timing flake.
- `cargo build --offline` and `cargo test --offline` from `rebuild/app/src-tauri`: 73 passed, 4 ignored. No Rust files changed.
- Screenshots under `rebuild/round*-shots/` were restored and were not committed.

## Left open

Please confirm in the real WebKitGTK app: Ctrl+hover a link in a file card and a text card after clicking the card, press Ctrl while the pointer is already on the link, and Ctrl+hover an embed title. Headless Chromium cannot show the compatibility-mouse suppression the plan describes. If the popover still fails there, the next suspects are the ones in §5.4: canvas `pointerdown` focus handling, then stacking (`z-index: 40` on the body).
