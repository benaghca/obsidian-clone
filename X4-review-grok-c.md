# X4 Review — drawing commands, rename, and export

VERDICT: OK-WITH-FIXES

Branch: `rebuild/x4-review-grok-c`
Author commit: `d87018e` (Claude, from X3b tip `31a2d8f`)
Integration: `2fa103e` merged `origin/rebuild/integration` `3425320`, then `f28ffae` merged the newer tip `f12b034` (W2 note-line web embeds)
Review fixes: `4687c30`
Code tip: `4687c30481073dcccb2195db00e7537e8b532ff3`

## What I checked

X4 against `rebuild/CINDER_GAP_PLAN.md`: new drawing from the palette, the ribbon (last button), and the explorer (folder and vault background); “Create new drawing and embed it here”; rename rewrites `![[….excalidraw]]` (plain, sized, and markdown image) and leaves a same-stem note alone; export SVG/PNG with Replace; copy as PNG. Clean lines, Grove’s own renderer, no Excalidraw or Obsidian code or assets, no new crates or npm packages. Only a user-written embed frame gets network.

`origin/rebuild/integration` moved from `3425320` to `f12b034` while this review was open, so that tip was merged with `--no-ff`. Conflicts were only in `rebuild/app/package.json` and `rebuild/app/src/mock/backend.ts`. The test script keeps both `test-drawing-commands.mjs` and `test-web-embeds.mjs`. The mock keeps `write_clipboard_image` and `allow_frame_origin`. `api.ts` merged on its own (`replaceFileBytes`, `writeClipboardImage`, and the W2 `allowFrameOrigin` comment).

## Fixes (`4687c30`)

1. **Open text survived a rename at the old path.** A text box does not start its save timer until it is finished. Rename flushed only a timer that was already set, then moved the file, then closed the tab. Closing finished the text and wrote it to the path the view had closed over, which brought the old file back. The tracked save now calls `editor.endLive()` before it writes. That commits the typed text. A drag still in progress is dropped, the same as closing the tab. `scripts/test-drawing-commands.mjs` types `Kept` into an open text box, renames the drawing to `Labeled`, and checks that the old path stays gone and the renamed file contains `Kept`.

2. **A note named `Plan.excalidraw.md` was renamed by a no-op.** The explorer label ran `viewFileExt` on the note stem, so that note showed as `Plan`. Confirming the label called rename with `Plan`, and the file became `Plan.md`. The same footgun applied to `*.canvas.md` and `*.base.md`. `explorerName` drops `.canvas`, `.base`, or `.excalidraw` only when the file itself ends with that extension. A real drawing, canvas, or base still drops its own extension. `paths.test.ts` covers both.

## Checks

Run from `rebuild/app` on this tree (the W2 merge plus the two fixes), once, no retry:

- `npm run build`: passed. The chunk-size warning is the existing one.
- `flock /tmp/grove-npm-test.lock npm test`: passed. Vitest 97 files, 1528 tests. Feel graph is the held gap: p95 33.4 ms, max 33.4 ms, over_20ms 58/185. `DRAWING_OPEN` 52.9 ms for 2000 elements, long tasks empty. `DRAWING_EDIT_LONG` and `DRAWING_TOOLS_LONG` empty. The new live-text case passed (`the text box holds Kept`, old path not restored). Web embed checks passed.
- `npm run audit:offline`: passed. 218 source files, dist/, CSP, capabilities, and dependencies.
- `cargo test --offline` in `src-tauri`: 109 passed, 0 failed, 4 ignored.

`rebuild/round*-shots/` was restored after the tests, including `round31b-shots` and `round32b-shots`. That churn is not in the commits.

## Left as they are

- Copy as PNG is tested with the fake clipboard runner. The desktop path is `wl-copy` or `xclip` with fixed arguments, a PNG signature check, and a 20 MB cap. macOS and Windows refuse.
- The PNG is drawn from an SVG `<img>` in headless Chromium. That path was not tried in the Tauri WebKitGTK webview.
- “Embed it here” puts the drawing in the note’s folder. It does not follow the attachment-folder setting. That matches Cinder.
- `link_sources` can mention a note whose name sits inside a drawing name (`Floor plan` inside `Floor plan.excalidraw`). The rewrite still resolves each link and only changes a real one.
- A folder move can raise the “Update links?” count because image embeds are rewritten now, not only note links.
- Bookmarks still use `noteName`, so a drawing bookmark shows `Foo.excalidraw`.
- If `vault.files` is stale, an SVG or PNG that appeared on disk can be overwritten without the Replace prompt. SVG always uses `write_note`. PNG always uses `replaceFileBytes` after the prompt, and the prompt only sees the file list Grove already has.
