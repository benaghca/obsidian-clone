# Review I2 — paste fallback and canvas image paste

Reviewed `rebuild/i2-grok-b` at `42b537a` (built on top of `rebuild/i1-review-grok-a` at `934bc65`) on branch `rebuild/i2-review-gemini`, against the I1/I2 rows of `rebuild/CINDER_GAP_PLAN.md`, `rebuild/NOTES_I2-grok-b.md`, and `rebuild/REVIEW_I1-grok-a.md`.

## Plan and Requirement Checks

1. **Empty paste calls `read_clipboard_image`, saves to the attachment folder with a non-colliding name, and embeds it like a pasted file:**
   - In `src/editor/clipboard.ts`, when the note's `paste` event has no files and neither `text/plain` nor `text/html` (or when `event.clipboardData` is null), `pasteImageFallback` runs. If `data.types` advertises `image/*`, it still tries `navigator.clipboard.read()` first; when the event is empty (as in WebKitGTK), it goes straight to `readClipboardImageFile()` → `api.readClipboardImage()`.
   - `splitClipboardImage` (`src/editor/attachments.ts`) splits the packed response on the first `0x0A` (`\n`), verifies the MIME against the five I1 types (`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/bmp`), and preserves any subsequent newlines in the image bytes.
   - The resulting `File` (`"image.png"` with `type: image.mime`) flows through `writeAttachments` (`src/editor/saveAttachments.ts`), which applies Obsidian's `attachmentFolderPath` setting, stamps `Pasted image YYYYMMDDHHmmss.ext` (mapping `image/jpeg` to `.jpg`), picks a free name via `uniquePath` (`" 1"`, `" 2"`, …), enforces the 20 MB cap, refreshes the vault file list once, and inserts the embed (`embedFor`) in one isolated CodeMirror history group.
2. **Canvas paste places one image card at the pointer as one undo step:**
   - In `src/canvas/cards.ts`, `pasteAt` (called from CZ4's board menu `Paste`) saves pasted image files or the native clipboard image (when the paste snapshot is `bare`) via `writeAttachments(ws, canvasPath, ...)`, computes the fitted box (`400 / Math.max(naturalWidth, naturalHeight)`), and calls `add()` once with `atStart: true` at the pointer coordinates. Undo removes the card in one step while keeping unknown canvas fields intact.
3. **No image on the clipboard does nothing harmful:**
   - When `read_clipboard_image` returns `null`, `readClipboardImageFile()` returns `null` and nothing is written or inserted. When the command rejects (e.g. missing `wl-paste` or `xclip`), `readClipboardImageFile()` logs a `console.warn` and returns `null` without throwing or mutating the note or canvas.
4. **Text paste is unchanged:**
   - Any paste carrying `text/plain` or `text/html` (including a file alongside text, HTML conversion, URL-over-selection, and plain/multi-cursor paste) bypasses the empty-paste fallback in notes and keeps CZ4's URL/text card rules on the canvas. Whitespace-only paste on the canvas is not `bare` and adds nothing.
5. **Rust clipboard code adds no new crates:**
   - `Cargo.toml`, `Cargo.lock`, and `package.json` are untouched since `rebuild/integration` (`b5d0a34`). `src-tauri/src/clipboard.rs` uses only `std::process::Command`.
6. **Mock backend support:**
   - `src/mock/backend.ts` implements `read_clipboard_image`, returning `null` by default until armed via `setMockClipboardImage(packed)` and tracking calls with `mockClipboardImageReads()`. It never reads the host clipboard.

## Small Fixes Made on This Branch

1. **Editor context-menu `paste(view, plain)` fallback when `navigator.clipboard.readText()` rejects or returns `""` (`src/editor/clipboard.ts`):**
   - Previously, if `document.execCommand("paste")` returned `false`, `paste(view, false)` called `await navigator.clipboard.readText()` without catching a rejection before `pasteNativeImage(view)`. In WebKitGTK (where `navigator.clipboard` lacks permission) or when `readText()` rejects, that skipped `pasteNativeImage(view)`. In addition, an empty clipboard (`text === ""` and no clipboard image) fell through to `insertText(view, "")`, which would overwrite an active selection with `""`.
   - `paste(view, plain)` now catches `readText()` rejection (matching `readAsyncClipboard()`), tries `pasteNativeImage(view)` when `!plain`, and returns without dispatching an empty replacement when `text` is empty.
2. **Canvas `readClipboard()` when `paste` event advertises `image/*` without `data.files` (`src/editor/clipboard.ts`):**
   - Shared `readAsyncClipboardImages()` between note and canvas clipboard reads so that a `paste` event advertising `image/*` in `data.types` with an empty `files` list tries `navigator.clipboard.read()` before falling back to `read_clipboard_image`, matching `pasteImageFallback`.
3. **Unboxed aspect ratio for narrow/short pasted canvas images (`src/canvas/cards.ts`):**
   - `placePastedImages` previously passed fitted image dimensions through `makeNode` → `sized`, clamping sides under 50 px to 50 px even when no drag box was used (unlike `insertFile`, which only clamps drag boxes). Unboxed pasted images now keep their fitted `size.width × size.height` dimensions, matching `insertFile`.
4. **Post-await guard in `saveAttachments` (`src/editorHost.ts`):**
   - Added a check after `await writeAttachments(...)` so that if the editor became `readOnly` or switched notes while the async write was in flight, the embed is not dispatched into a read-only or different note.
5. **Tests (`scripts/test-paste.mjs`):**
   - Added browser checks verifying that an empty paste with no clipboard image leaves an active editor selection untouched, and that context-menu `paste(view, false)` falls back to `read_clipboard_image` and writes the embed when `execCommand("paste")` returns `false` and `navigator.clipboard.readText()` rejects.

## Verification and Benchmarks

From `rebuild/app`:

- `npm run build` — passed (`tsc --noEmit && vite build`, 2138 modules).
- `flock /tmp/grove-npm-test.lock npm test` — passed, exit 0 (including `posttest`).
  - Vitest: 80 files, 1284 tests (including 444 parity tests).
  - `test-paste.mjs`: 53 converter unit cases plus native/mock image paste checks in notes (empty paste, selection-intact check on empty clipboard, context-menu fallback when `readText` rejects, one-step undo leaving the saved file) and on canvas (400×200 media card at the pointer, one-step undo).
  - Canvas benchmarks: 300-card/400-edge pan and zoom presentation frames under 20 ms and within 6 compositor drops per 24 inputs; 300-card drag max 16.8 ms (49 intervals); create drag max 16.8 ms; reconnect drag max 16.8 ms; explorer drag max 16.8 ms.
  - Kanban & Bases benchmarks: `K8_SCROLL` 1k max 16.8 ms (p95 16.7 ms), 10k max 16.8 ms (p95 16.8 ms); `KEDGE_SCROLL` 10k max 16.8 ms (p95 16.8 ms); `EDGE_SCROLL` 10k max 16.8 ms (p95 16.7 ms); `K7_FUZZ` 48 cases; `LEDGE_BENCH` `resolve_one` 0.01 ms, `link_targets` 2.6 ms, `embed_section` 0.18 ms, `tag_tree` 2.02 ms.
- `npm run audit:offline` — passed (192 source files, `dist/`, CSP, capabilities, and dependencies checked).

From `rebuild/app/src-tauri`:

- `cargo test --offline` — passed (97 passed, 0 failed, 4 ignored).

`rebuild/round*-shots/` was restored with `git checkout -- rebuild/round*-shots/`.

VERDICT: OK — I2 matches the plan and contract, preserves text paste and canvas/bases performance targets, adds no new crates or packages, and passes all offline audits and test suites with the edge-case fixes above.
