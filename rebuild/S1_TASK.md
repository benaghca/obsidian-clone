# S1: Flush pending saves on every quit path, retry failed saves, keep edits across rename

From Fable 5.2's 10 Nov 2026 read-only review of Grove. These are **invisible data-loss fixes** only. Chris approved starting this work provided nothing visible changes. Build on `rebuild/s1-grok` from the brief commit on `rebuild/integration`. Grok 4.7 builds; Codex will review later, read-only. Commit locally. Never push.

This brief also covers what was first sketched as a separate S2 (retry, dirty tracking, and mergeNote). Those changes live in the same save loops as the close-flush and rename-timer fixes, so one builder owns all of them to avoid conflicts. There is no separate S2 branch.

## In plain words

Grove can quietly lose text you just typed. Closing the window with Alt+F4 or the compositor close (not Grove's own X) can drop a pending save. A keystroke typed while a rename is still in flight can vanish. A failed save is only logged, so the app forgets the note is unsaved and can throw the text away on quit. Merging two notes can delete the source even when the combined text never made it to disk. Fix those holes. Successful saves and everyday editing should feel exactly the same as today.

## Problem (paths relative to `rebuild/app/`)

Fable findings 2, 11, and the non-visible half of 1:

1. **Finding 2 — Closing any way except Grove's own X does not wait for saves.**
   - `src/main.ts:454`: Grove's X flushes, then closes.
   - `src/main.ts:496-500`: `beforeunload` fires `void ws.editors.flush()` (and `settings.flush()`) and returns. There is no `close-requested` handler in `src-tauri/src/lib.rs` or in the page.
   - A compositor close, Alt+F4, or a quit starts an async IPC write and tears the page down without waiting. Up to 300 ms of typing is at risk, plus pending canvas, drawing, and settings writes.

2. **Finding 11 — A keystroke during a rename can leave an edit unsaved.**
   - `src/noteEditors.ts:445-454`: `move()` re-keys states, scrollTops, and owners, but not `saveTimers`. The old-path timer then fires, `save()` finds no state (`:472-473`), and returns silently.
   - The edit stays in memory until the next keystroke. The likely flow is: new note, type a title, Enter, start typing, because the rename is still in flight (`src/fileOps.ts:176-192`).

3. **Finding 1, non-visible half — Failed saves are silent and never retried.**
   - `src/noteEditors.ts:470-481`: `save()` deletes the timer, awaits `write_note`, and on failure only logs. The same pattern is in `src/canvas/view.ts:81` and `src/drawing/view.ts:241`.
   - After a failed write (full disk, permissions, a refused path), nothing marks the note as unsaved. Closing the app can lose that text.
   - `src/fileOps.ts:216-219` `mergeNote` appends to the target, calls `saveNow`, then deletes the source. `saveNow` cannot report failure, so a failed save still deletes the source.

## Goal

**No visible behavior change.** Grove's identity rule stands: layout, shortcuts, look, theme, and behavior stay the same. Do **not** add a "couldn't save" notice, status-bar mark, toast, prompt, or dialog. That visible half of finding 1 is deferred for Chris.

- Flush every pending save (editor, canvas, drawing, and settings) on any window close or quit path, and **wait** for those writes (with a short timeout) before the window is destroyed.
- Re-key `saveTimers` (and any dirty or in-flight save state) in `move()`, so a keystroke during rename is saved under the new path.
- Keep a dirty set separate from the timers. Make `save` / `saveNow` report success or failure. Retry failed saves with backoff. `mergeNote` must not delete the source after a failed save.

Preferred close handling: use the Tauri JS `onCloseRequested` API in the page (prevent default, flush, then destroy). Add `core:window:allow-destroy` to `src-tauri/capabilities/default.json` if needed (`allow-close` is already there; `allow-destroy` is not). **Prefer not to change `src-tauri/src/lib.rs`**, so the S5 builder can own that file. If a Rust `close-requested` handler is truly required, keep it as small as possible, isolated from command signatures and the vault Mutex, and explain why in the notes.

## Tests

Add regression tests that **fail before this change and pass after** (check this on the pre-change tree or by temporarily reverting). Use vitest and/or a node script plus the existing mock/harness. No GUI windows.

Cover at least:

- Closing or quitting with a pending editor save, and with pending canvas, drawing, and settings writes, waits for the write (or a short timeout) rather than dropping it.
- A compositor-style close (not Grove's X) also flushes and waits.
- `move()` / rename with a pending or in-flight save still writes the edited text to the new path.
- A failed `write_note` leaves the note dirty and retries; a later success clears dirty. The text is not dropped.
- `mergeNote` does not delete the source if the target save failed.

Do not weaken any existing assertion. A focused vitest file that runs as part of `vitest run` is enough; only add a separate `npm test` script if it is fast and stable.

## Hard rules

- Work only under `rebuild/app/` TypeScript, scripts, tests, capabilities JSON, plus this brief's notes. Do not edit Cinder at the repo root (`ui/`, `src/`). It is reference only.
- Avoid Rust in `src-tauri/src/` unless a close handler there is essential. Do not change command signatures, the vault Mutex, `read_note` / `write_note` line endings, or index rebuild batching (those belong to S3, S4, and S5).
- No new crates or npm packages.
- No Obsidian or Excalidraw code, assets, or fetched pages.
- No network. `npm run audit:offline` must stay green.
- No app or GUI windows. Do not start Grove, Tauri, or a visible browser. Headless Chromium only, if you need the existing feel harness at all.
- Test and bench vaults only under `/tmp`. Never touch real vaults: `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`. Leave `/tmp/grove-playground` and `~/grove-compare-vault` alone.
- `flock /tmp/grove-npm-test.lock npm test` (including `posttest`), `npm run build`, and `npm run audit:offline` must pass. `cargo test --offline` only if Rust changed.
- Restore any screenshots the suite rewrites before committing.
- Commit locally on `rebuild/s1-grok`. Never push. Never force-push. Do not commit prompt files (`.x-*.txt`).
- Do not buy credits or change tool/user config. Do not run `omarchy refresh shell`.

## Size discipline

- The smallest change that closes the loss paths. Reuse and extend the existing flush/save helpers in `noteEditors.ts`, `canvas/view.ts`, `drawing/view.ts`, settings, `fileOps.ts`, and `main.ts`.
- Do not rewrite the three save loops into a new shared "pending-saves service" unless that is clearly smaller than three tiny patches.
- Delete code your changes make dead.
- Keep every file under ~800 lines. Split by responsibility first if a change would push one over.
- No new dependency.

## Scope limits

**In scope:** close/quit flush for notes, canvases, drawings, and settings; rename timer/dirty re-keying; dirty tracking; retry on failed save; `mergeNote` not deleting after a failed save; tests and notes.

**Out of scope:** a visible save-failure notice (finding 1, visible half); conflict detection (finding 3); CRLF/BOM (S3); index map batching (S4); moving Rust commands off the GTK thread (S5); the unmerged T1 tabs work; opening or measuring the real app window.

## Done when

- Every goal item above works and has a regression assertion that fails before and passes after.
- `flock /tmp/grove-npm-test.lock npm test`, `npm run build`, and `npm run audit:offline` pass. No assertion was weakened.
- Worktree is committed locally, clean except untracked prompt files, and not pushed.

## Notes file

Write `rebuild/NOTES_S1-grok.md` before you finish, and commit it with the code. (Do not overwrite the existing historical `rebuild/NOTES_S1.md`.) Include:

- In plain words: what loss paths are closed, and confirmation that nothing visible changed.
- What changed, and how you proved each test failed before and passed after.
- Net line change by language and by file; any file near 800 lines; any new dependency (should be none).
- Any close-path behavior you could only reason about without a real WebKitGTK / WebView2 window.
