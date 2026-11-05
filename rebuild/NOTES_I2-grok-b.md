# I2 — paste fallback and canvas image paste

Branch `rebuild/i2-grok-b` from `934bc65` (reviewed I1). Local commit only. Cinder at the repo root was not edited. No Rust change: I1 already owns `read_clipboard_image` and the raw `write_file_bytes` body.

## What I built

A paste that carries neither a file nor text calls `read_clipboard_image`, then saves and embeds the image the same way as a pasted file.

- The note's paste handler treats a missing `clipboardData` as that empty case. An event that advertises an `image/*` type still tries `navigator.clipboard.read()` first. An event with no file and no text or HTML does not: WebKitGTK hands the page an empty event, and a stale page clipboard must not hide the native read. The page splits the body on the first LF (`splitClipboardImage`). The mime has to be one of the five I1 types. Later newlines stay in the bytes. The file is named `image.png` with that mime so `attachmentName` stamps `Pasted image YYYYMMDDHHmmss.ext` and maps `jpeg` to `jpg`.
- The context-menu Paste does the same when the clipboard text is empty and the paste is not plain (Ctrl+Shift+V). A command error is `console.warn` and inserts nothing. There is no toast.
- `writeAttachments` is the shared writer (folder, free name, 20 MB cap, one file-list refresh). The note still inserts the embeds as one CodeMirror history group. Undo removes the embed. The file stays.
- Canvas Paste (CZ4) now turns image files into file cards. A native image, when the paste is bare, does the same. The card's top-left is the pointer (`atStart`). One image uses the existing aspect fit, max side 400. Several images are one `add()`, stepped 445px (400 + 45), so one undo. A drag box keeps that box. A non-image file with no text is not bare, so it does not probe the native clipboard. `execCommand("paste")` returning true with no event stays non-bare, as CZ4 required. Whitespace still adds nothing.
- The browser mock's `read_clipboard_image` returns `null` until `setMockClipboardImage` arms a packed body. It does not read the system clipboard. `write_file_bytes` in the mock is still `{ path, bytes: number[] }`, because the page has no raw IPC headers there.

`readClipboardImage` is imported when the native read runs, not at module load. Note unit tests import `clipboard.ts` without a `window`.

## Checks

From `rebuild/app`, after the native read was moved off the clipboard module's load path (a static `api` import had failed six node suites with `window is not defined`):

- `npm run build` — `tsc --noEmit && vite build`, 2138 modules. The chunk-size warning is the existing one.
- `flock /tmp/grove-npm-test.lock npm test` — exit 0. No timing flake, no rerun. Vitest: 80 files, 1284 tests, including 444 parity. Geometry stayed within 1px. Ctrl+o / Ctrl+p / menu frames were 16.7–16.9 ms. `test-paste.mjs`: 53 converter cases, plus the empty paste (one mock read, embed bytes match, undo leaves the file) and the canvas image card (400×200 on the pointer, one undo restores the canvas). 300-card pan and zoom: p95 16.7 ms, max 16.8 ms. 300-card drag max 16.8 ms (49 intervals). Create and reconnect drag max 16.8 ms. K8 10k scroll: p95 16.8 ms, max 16.8 ms, scrollTop 279218. Kanban edge 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 140000. Bases edge 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 160000. Property fuzz `cases=48`. `LEDGE_BENCH`: `embed_section` 0.1 ms, `link_targets` 1.98 ms, `tag_tree` 3.8 ms.
- `npm run audit:offline` — passed. 192 source files, dist, CSP, capabilities, and dependencies. The script runs the build above.

From `rebuild/app/src-tauri`:

- `cargo test --offline` — 97 passed, 0 failed, 4 ignored (`set_property_bench`, `crash_child`, `bench_vault`, `bench_search_commands`). Rust sources were not changed.

`rebuild/round*-shots/` was restored with `git checkout` after the suite. Screenshot paste in a release build is I3, for Chris to record.

## Limits

I1's clipboard read still has no timeout: a clipboard owner that never answers blocks one async worker. The postMessage IPC fallback cannot send a raw `write_file_bytes` body. Undo of a paste removes the embed or the card and leaves the file. I3 is Chris's check in a release build (screenshot with `grim` and `wl-copy`, paste into a note and onto a canvas, drag a file in from the file manager, resize the image). This piece did not open a GUI, so I3 is not a result.

## Merge with integration ebad529

`git merge --no-ff rebuild/integration`. The branch tip was `735c6a0`, which is `ebad529` (X1, BX1, M0a, WK1) plus T1 (`872bee5`, `6146d70`).

Conflicts:

- `rebuild/CONTRACT.md`. Kept I1's `read_clipboard_image` entry and the raw-body `write_file_bytes` entry. Kept integration's temp sweep, which skips `.cinder`, and added `.cinder/` to the attachment path checks (the shared `SKIP_DIRS` list already refuses it). `read_foreign_config` was outside the hunk and stayed.
- `rebuild/app/src-tauri/capabilities/default.json`. The description now names both the clipboard image read and the allowlisted Cinder and Obsidian settings read. `allow-read-clipboard-image` and `allow-read-foreign-config` were already both in the list.

`build.rs` and `lib.rs` auto-merged. Both commands are registered. No behaviour change beyond that resolution.

Checks, from `rebuild/app` (cargo from `src-tauri`):

- `npm run build` — exit 0. `tsc --noEmit && vite build`, 2139 modules. The chunk-size warning is the existing one.
- `flock /tmp/grove-npm-test.lock npm test` — exit 0. Vitest: 83 files, 1349 tests, including 444 parity. Geometry stayed within 1px. Ctrl+o frames were 16.7–16.9 ms. `test-paste.mjs`: 53 converter cases, plus the empty paste (one mock read, undo leaves the file) and the canvas image card (aspect inside 400px, on the pointer, one undo). 300-card pan and zoom stayed under 20 ms. 300-card drag max 16.8 ms (49 intervals). Create and reconnect drag max 16.8 ms. K8 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 279218. Kanban edge 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 140000. Bases edge 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 160000. Property fuzz `cases=48`. `LEDGE_TYPE` max 16.8 ms, p95 16.7 ms. `LEDGE_SWITCH` max 16.8 ms, p95 16.8 ms.
- `npm run audit:offline` — passed. 194 source files, dist, CSP, capabilities, and dependencies. The script runs the build above.
- `cargo test --offline` — 102 passed, 0 failed, 4 ignored (`set_property_bench`, `crash_child`, `bench_vault`, `bench_search_commands`).

`rebuild/round*-shots/` was restored with `git checkout` after the suite.
