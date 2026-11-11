# S5: Move save / create / rename Rust work off the GTK main thread

From Fable 5.2's 10 Nov 2026 read-only review of Grove. This is **finding 4**. Chris approved starting this work provided nothing visible changes. Build on `rebuild/s5-agy` from the brief commit on `rebuild/integration`. agy (Gemini 4 Argon, high effort) builds; Codex will review later, read-only. Commit locally. Never push.

S4 is being built in parallel and owns index rebuild batching (`rebuild_maps` call sites, `apply` batching, `rename_path` rebuild count, and `entry_for`). This piece is scoped so the two will not fight: you change how commands are scheduled and how the lock is taken, not how often maps are rebuilt.

## In plain words

Saving, creating, and renaming a note all run on the window's main thread and wait on one lock that long searches also hold. An autosave that arrives during a big search can freeze the whole window. Move that file work off the main thread, keep writes in the same order the page already expects, and let reads and writes share the vault more politely. Nothing the user sees should change.

## Problem (paths relative to `rebuild/app/`)

Fable finding 4. These are plain `#[tauri::command]` in `src-tauri/src/lib.rs`, so they run on the GTK main thread:

- `open_vault` (`:200`) and `create_vault` (`:210`)
- `write_note` (`:347`)
- `create_note` (`:447`) and `create_folder` (`:456`)
- `rename_path` (`:461`) and `delete_path` (`:467`)
- `write_config` (`:483`)

Costs on that thread:

- Each write does an fsync there (`src-tauri/src/fsutil.rs:153`, `:276`). The code comment gives about 4 ms on btrfs; it is worse on a slow or busy disk.
- Each takes the single Mutex (`lib.rs:39`). Async reads hold it for their whole run: `link_index` 25.7 ms at 20k, `search_notes` 77 ms at 20k, and the watcher's batch apply.

An autosave that arrives while a search scan or link refresh runs blocks the whole window until that read ends. The Chromium and mock tests cannot see this.

`lib.rs` already has a source test around `:683-697` that requires `write_file_bytes`, `read_clipboard_image`, and `write_clipboard_image` to be `#[tauri::command(async)]`. The write commands listed above are not in that list yet.

## Goal

**No visible behavior change.** Layout, shortcuts, look, theme, and behavior stay the same. The page already awaits each write, and `fileOps.ts:149-174` already orders moves after writes; keep that order on the Rust side too.

- Make the listed commands async (`#[tauri::command(async)]`) so their bodies run off the GTK main thread.
- Keep write order with a small per-vault write queue.
- Switch the vault `Mutex` to an `RwLock`, so long reads do not block each other and a write can wait without sitting on the GUI thread.
- This slice of P2/P3 does not depend on the delta protocol. Do not start the delta protocol here.

If a full write queue plus RwLock is too large for a careful change, the minimum that still counts is: every listed command is async (off the GTK thread) and the source test covers them all. Document any leftover Mutex hold-time work in the notes.

## File ownership (do not fight S3 / S4 / S1)

- You own `src-tauri/src/lib.rs`: command attributes, the Mutex → RwLock change at the state boundary, a small write queue if you add one, and the async-command test.
- You may adjust how the state lock is acquired at the call boundary (for example a helper that takes a read or write guard). Do **not** change index rebuild batching, `rebuild_maps` call sites, `apply` batching, `rename_path` rebuild count, or `entry_for` (S4).
- Do **not** change `read_note` / `write_note` CRLF or BOM behavior (S3).
- Do **not** edit the TypeScript save loops, `main.ts`, or capabilities unless a command-signature change forces a tiny type fix. S1 owns those files.
- Do not change the T1 tabs work.

## Tests

Add or extend Rust regression tests that **fail before this change and pass after** (check this). Cover at least:

- Extend the existing "must be `#[tauri::command(async)]`" source test so it covers every write/create/rename/delete/config/open-vault command listed above, not just the three already checked.
- Ordering: two writes (or a write then a rename) to the same vault stay in the order they were submitted.
- If you introduce RwLock, a test or a clear assertion that read-style commands can overlap and that writes still exclude each other.

Run `cargo test --offline` in `rebuild/app/src-tauri`. Do not weaken any existing assertion.

## Hard rules

- Work only under `rebuild/app/src-tauri/` (and this brief's notes). Do not edit Cinder at the repo root (`ui/`, `src/`). It is reference only.
- No new crates or npm packages. Use the async runtime and lock types already in the crate / std / tokio / parking_lot, whichever the crate already depends on. Do not add a crate just to get a queue.
- No Obsidian or Excalidraw code, assets, or fetched pages.
- No network. `npm run audit:offline` must stay green if you touch anything it covers.
- No app or GUI windows. Do not start Grove, Tauri, or a visible browser.
- Test and bench vaults only under `/tmp`. Never touch real vaults: `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`. Leave `/tmp/grove-playground` and `~/grove-compare-vault` alone.
- `cargo test --offline` must pass.
- Commit locally on `rebuild/s5-agy`. Never push. Never force-push. Do not commit prompt files (`.x-*.txt`).
- Do not buy credits or change tool/user config. Do not run `omarchy refresh shell`.

## Size discipline

- The smallest change that gets the listed commands off the GTK thread and shortens lock hold times.
- Delete code your changes make dead.
- Keep every file under ~800 lines. `lib.rs` is already mid-size; split by responsibility first if a change would push it over.
- No new dependency.

## Scope limits

**In scope:** async command attributes for the listed commands, a small per-vault write queue, Mutex → RwLock at the state boundary, tests and notes.

**Out of scope:** index map batching (S4); CRLF/BOM (S3); TypeScript save retries and close flush (S1); the delta protocol / full P2; the unmerged T1 tabs work; opening the real app.

## Done when

- The listed commands are async and covered by the source test, with tests that failed before and pass after.
- Write order is preserved.
- `cargo test --offline` passes. No assertion was weakened.
- Worktree is committed locally, clean except untracked prompt files, and not pushed.

## Notes file

Write `rebuild/NOTES_S5-agy.md` before you finish, and commit it with the code. Include:

- In plain words: what no longer runs on the GUI thread, and confirmation that nothing visible changed.
- What changed, leftover Mutex/hold-time work if any, and how you proved each test failed before and passed after.
- Net line change by language and by file; any file near 800 lines; any new dependency (should be none).
