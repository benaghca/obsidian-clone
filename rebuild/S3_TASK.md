# S3: Preserve CRLF line endings and BOM on save

From Fable 5.2's 10 Nov 2026 read-only review of Grove. This is the **non-visible half of finding 6**. Chris approved starting this work provided nothing visible changes. Build on `rebuild/s3-agy` from the brief commit on `rebuild/integration`. agy (Gemini 4 Argon, high effort) builds; Codex will review later, read-only. Commit locally. Never push.

Other builders are working in parallel: S1 owns the TypeScript save loops, S4 owns index rebuild batching in `vault.rs` / `index.rs`, and S5 owns `lib.rs` command signatures and the vault Mutex/RwLock. Stay in your file slice so the branches can merge cleanly.

## In plain words

A note that came from Windows (CRLF line endings, or a UTF-8 BOM) is rewritten as plain LF with no BOM the first time Grove saves it. Every line then looks changed in git or a sync tool, even though the user only fixed a typo. Keep the file's existing line endings and BOM when writing it back. New notes should still be saved as LF with no BOM, the way they are today.

## Problem (paths relative to `rebuild/app/`)

Fable finding 6, non-visible half:

- `src-tauri/src/vault.rs:59-61` reads with `from_utf8_lossy` and strips a BOM.
- `src/noteEditors.ts:475` saves `state.doc.toString()`, which always joins lines with `\n`.
- `src/editor/editor.ts:230` sets no line separator.
- `set_property` in Rust already preserves line endings; the editor / `write_note` path does not.

The visible half of finding 6 (a read-only notice for invalid UTF-8) is **deferred for Chris**. Do not add UI, and do not change how a non-UTF-8 file is presented in the editor.

## Goal

**No visible behavior change.** Layout, shortcuts, look, theme, and editor behavior stay the same.

- Remember CRLF vs LF and the presence of a UTF-8 BOM per note, and write them back on save.
- A brand-new note (no existing file, or a file Grove just created as LF) stays LF with no BOM.
- Prefer doing this entirely in Rust `read_note` / `write_note`: if the file on disk is CRLF and/or has a BOM, write those back even when the page sends LF text. That way you should not need to edit TypeScript (S1 owns those files).
- Invalid UTF-8: do not add a notice. If you can avoid silently writing replacement characters over original bytes without any new UI, do so; otherwise leave the non-UTF-8 case alone and document it. The required fix is CRLF/BOM round-trip for valid UTF-8 files.

## File ownership (do not fight the other builders)

- You own `src-tauri/src/vault.rs` **`read_note` / `write_note`** (and any tiny helper they need) plus Rust tests for this behavior.
- Do **not** change `apply`, `rename_path`, `entry_for`, `rebuild_maps`, or other index-batching code (S4).
- Do **not** change command signatures, `#[tauri::command]` attributes, or the Mutex in `src-tauri/src/lib.rs` (S5).
- Do **not** edit `noteEditors.ts`, `editor.ts`, canvas, or drawing files unless a Rust-only fix is genuinely impossible. If you must touch TypeScript, keep it tiny and explain why in the notes.
- Do not break `set_property`, which already preserves line endings.

## Tests

Add Rust regression tests that **fail before this change and pass after** (check this). Cover at least:

- A CRLF note is still CRLF after `write_note`.
- An LF note is still LF.
- A UTF-8 BOM is still present after save; a file without a BOM does not gain one.
- BOM + CRLF round-trips.
- A new note (write to a path that did not exist) is LF with no BOM.

Run `cargo test --offline` in `rebuild/app/src-tauri`. Do not weaken any existing assertion.

## Hard rules

- Work only under `rebuild/app/src-tauri/` (and this brief's notes). Do not edit Cinder at the repo root (`ui/`, `src/`). It is reference only.
- No new crates or npm packages.
- No Obsidian or Excalidraw code, assets, or fetched pages.
- No network. `npm run audit:offline` must stay green if you touch anything it covers.
- No app or GUI windows. Do not start Grove, Tauri, or a visible browser.
- Test and bench vaults only under `/tmp`. Never touch real vaults: `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`. Leave `/tmp/grove-playground` and `~/grove-compare-vault` alone.
- `cargo test --offline` must pass. If you did change any TS or capabilities, also run `flock /tmp/grove-npm-test.lock npm test` and `npm run build` in `rebuild/app`.
- Commit locally on `rebuild/s3-agy`. Never push. Never force-push. Do not commit prompt files (`.x-*.txt`).
- Do not buy credits or change tool/user config. Do not run `omarchy refresh shell`.

## Size discipline

- The smallest change that preserves endings and BOM. Reuse the existing `set_property` approach if it already has the right helper.
- Delete code your changes make dead.
- Keep every file under ~800 lines.
- No new dependency.

## Scope limits

**In scope:** CRLF/LF and BOM preservation on the note read/write path; tests and notes.

**Out of scope:** a read-only or warning UI for non-UTF-8 notes; conflict detection; the S1 save-loop work; S4 index batching; S5 async commands; the unmerged T1 tabs work; opening the real app.

## Done when

- CRLF and BOM round-trip for valid UTF-8 notes, with tests that failed before and pass after.
- New notes remain LF with no BOM.
- `cargo test --offline` passes. No assertion was weakened.
- Worktree is committed locally, clean except untracked prompt files, and not pushed.

## Notes file

Write `rebuild/NOTES_S3-agy.md` before you finish, and commit it with the code. Include:

- In plain words: what is now preserved, and confirmation that nothing visible changed.
- What changed, and how you proved each test failed before and passed after.
- Net line change by language and by file; any file near 800 lines; any new dependency (should be none).
- What you did (or deliberately did not do) about invalid UTF-8.
