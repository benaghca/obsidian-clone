# Round 27d

Pasted and dropped files become vault attachments, date properties use a left calendar icon, and the command palette gains the Obsidian names for alias, embed, tag, and current-note backlinks. No canvas, sidebar, status bar, or explorer-drag files. Nothing was pushed.

## What changed

Pasting an image, or dropping a file onto a note, writes it into the vault and inserts `![[name]]`. The default folder is the vault root, the same as Obsidian's `attachmentFolderPath` of `/`. Settings → Files and links has "Default location for new attachments": vault folder, a chosen folder, the note's folder, or a subfolder under the note. A clipboard image with no real name is `Pasted image YYYYMMDDHHmmss.png` in local time; a second one in the same second is `Pasted image YYYYMMDDHHmmss 1.png`. A dragged or copied file keeps its own name, and a clash gets the same space-and-number suffix. Several files become several embeds, one undo, caret after the last. Files over 20MB are skipped. A read-only note or a leaf with no note consumes the paste and writes nothing.

`write_file_bytes` is the new Rust command. It uses the same vault path checks as notes (no `..`, no absolute path, no `.obsidian` / `.git` / `.trash` / `.grove`, no symlink that leaves the vault), refuses to overwrite, and refuses more than 20MB. The saving window refreshes its file list itself, because its own write is not echoed. Live Preview and Reading draw the image from a `blob:` URL. Source mode keeps the embed as markdown, which is how Obsidian source mode works.

A clipboard that already has `text/plain` or `text/html` next to a file stays a plain-text paste. CodeMirror inserts the text, and the HTML converter does not run. Only a file or image with no text is saved as an attachment.

Date and datetime properties wrap the input and paint a calendar or clock on the left. The native Chrome indicator is still the click target: it is moved to the left and its opacity is 0. Number inputs are unchanged. The same row is used in the note and in the file-properties sidebar.

Palette commands, with the names from Obsidian 1.14.4 where that dump lists them:

- `backlink:open-backlinks` — "Backlinks: Open backlinks for the current note". Opens a tab bound to that note. `backlink:open` stays "Backlinks: Show backlinks" and still drives the status bar and the more-options menu.
- `editor:insert-embed` — "Add embed". An empty selection is `![[|]]` and starts link completion.
- `editor:insert-tag` — "Add tag". Inserts `#`, or `#` plus the selection.
- `editor:add-alias` — "Add alias". Adds or focuses the aliases property. In source mode it writes a blank YAML list item.

`editor:attach-file` ("Insert attachment") was not added. The older public command dump has no Add alias id; `editor:add-alias` is the id used here so the palette name matches.

## How it was checked

From `rebuild/app`, headless only (Vite + headless Chromium, real pointer and key input). No windows on the real screen. Scratch paths under `/tmp` only. Chris's vaults were not opened.

- `npm test` once reached `scripts/test-paste.mjs` and failed there: a clipboard that held an image plus text was saved as a pasted image. Everything before that had passed: browser discovery, vitest (46 files, 261 tests), geometry on `Geometry.md` in Live Preview, Source, and Reading and on `GeometryFM.md`, `test:fixes`, `test:header`, `test:drag`, and `scripts/test-r20-bugs.mjs`.
- After the paste handler was corrected, `scripts/test-paste.mjs` (53 converter cases plus the native file-plus-text check) and `scripts/test-r27d.mjs` passed together.
- The rest of `npm test`, from `scripts/test-round21b.mjs` through `scripts/test-r27d.mjs`, then passed, including a second run of the round 27d script. That script pastes a PNG, checks the vault-root embed and a PNG signature, checks Live Preview and Reading images and the source-mode embed text, drops a named file into the attachment folder, checks the left calendar pixels and a click that focuses the date input, and runs Add embed, Add tag, Add alias, and the backlinks tab.
- `cargo test --offline --lib` in `src-tauri`: 37 passed, including `write_file_bytes_stays_inside_the_vault` (overwrite, non-image read, `..`, absolute, ignored dirs, 20MB, and a symlink out of the vault). Rust was not changed after that run.
- `npm run audit:offline`: passed, 141 source files. That run is `tsc --noEmit` plus the production build.

Chromium re-encodes a clipboard PNG, so the paste check requires a PNG signature and two identical reads, not the original 70 bytes. `getComputedStyle` on `::-webkit-calendar-picker-indicator` returns the input's own style in this Chromium, so the date check counts screenshot pixels: icon ink on the left, none on the right.

## Left out

Source mode does not paint the image. The embed text is there, and Live Preview and Reading show the picture.

The attachment-folder browser check drops the file on `.cm-content`. A synthetic drop aimed at the line under an existing image lands on the resize corner and never reaches the editor.

`pane.ts` is 710 lines, under 800.

## Line counts

Tracked newline counts under `rebuild/app`, excluding `/gen/`, plus the new attachment, permission, and `test-r27d.mjs` files. The notes file is not included.

- Production TS: **21,031 → 21,467 (+436)**.
- Test TS: **3,289 → 3,362 (+73)**.
- CSS: **3,925 → 3,961 (+36)**.
- Rust: **3,211 → 3,314 (+103)**.
- mjs: **3,730 → 3,986 (+256)**.
- TS/CSS/Rust: **31,456 → 32,104 (+648)**.
- Including mjs: **35,186 → 36,090 (+904)**.

No production file exceeds 800 lines. The largest is `pane.ts` at 710.
