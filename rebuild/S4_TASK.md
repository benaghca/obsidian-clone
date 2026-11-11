# S4: Batch name-map / index rebuilds under the vault lock

From Fable 5.2's 10 Nov 2026 read-only review of Grove. This is **finding 5**. Chris approved starting this work provided nothing visible changes. Build on `rebuild/s4-grok` from the brief commit on `rebuild/integration`. Grok 4.7 builds; Codex will review later, read-only. Commit locally. Never push.

Other builders are working in parallel: S3 owns `read_note` / `write_note` line endings in `vault.rs`, and S5 owns `lib.rs` command signatures and the Mutex/RwLock. Stay in your file slice so the branches can merge cleanly. Incremental name maps stay with the later P2 work; this piece only stops rebuilding every map on every single file change.

## In plain words

Every time the vault index changes one file, Grove rebuilds all of its name maps. Outside changes (a git pull or a sync of many files) do that once per file while the vault lock is held, which can freeze the window for seconds on a large vault. Rebuild those maps once per batch, not once per file. Nothing the user sees should change: the same files, the same links, the same search results, just less work under the lock.

## Problem (paths relative to `rebuild/app/`)

Fable finding 5:

- `src-tauri/src/index.rs:502-528`: `rebuild_maps` is called from `upsert_note`, `refresh_path`, `remove_tree`, and `relocate` (`:303-374`).
- `src-tauri/src/vault.rs:276-297`: the watcher's `apply` calls those once per changed path, under the lock.
- `src-tauri/src/vault.rs:194-195`: `rename_path` rebuilds twice.
- `src-tauri/src/vault.rs:352-362`: `entry_for` builds the whole file list to return one entry, on every `create_note`, `create_folder`, and `write_file_bytes`.

The perf plan measured 6.1 ms per rebuild at 20k notes. A sync of 500 notes is then about 3 s with the lock held (Fable's estimate: 500 × 6 ms). Combined with finding 4 (S5), that can freeze the window.

## Goal

**No visible behavior change.** Layout, shortcuts, look, theme, and behavior stay the same. Index contents and resolved links after a batch must match today's results.

- Defer to **one** `rebuild_maps` per batch in `apply`.
- Rebuild **once** in `rename_path`, not twice.
- Look up the single entry in `entry_for` instead of building the whole file list.
- Incremental maps stay with P2. Do not start that work here.

## File ownership (do not fight the other builders)

- You own the index mutation / `rebuild_maps` call path in `src-tauri/src/index.rs`, and `apply` / `rename_path` / `entry_for` in `src-tauri/src/vault.rs`.
- Do **not** change `read_note` / `write_note` line-ending or BOM behavior (S3).
- Do **not** change `src-tauri/src/lib.rs` command attributes, async-ness, or the Mutex/RwLock (S5). If you need a hook such as "defer rebuilds", keep it inside the index/vault methods S5 will only call, not in the command layer.
- Do not edit the TypeScript save loops (S1).

## Tests

Add Rust regression tests that **fail before this change and pass after** (check this). Cover at least:

- A watcher-style batch of N path changes (N ≥ 3, preferably more) calls `rebuild_maps` a constant number of times (once, or otherwise independent of N), not N times. You can count calls with a test hook, a thread-local counter, or by refactoring `rebuild_maps` so the batch path is obviously once.
- `rename_path` rebuilds maps once, not twice, and the index is correct after the rename.
- `entry_for` returns the right entry without building the whole file list (O(1) lookup, or an equivalent assertion that it does not walk every file).

Also keep existing index/vault tests passing: links, renames, deletes, and applies still produce the same entries. Run `cargo test --offline` in `rebuild/app/src-tauri`. Do not weaken any existing assertion.

## Hard rules

- Work only under `rebuild/app/src-tauri/` (and this brief's notes). Do not edit Cinder at the repo root (`ui/`, `src/`). It is reference only.
- No new crates or npm packages.
- No Obsidian or Excalidraw code, assets, or fetched pages.
- No network. `npm run audit:offline` must stay green if you touch anything it covers.
- No app or GUI windows. Do not start Grove, Tauri, or a visible browser.
- Test and bench vaults only under `/tmp`. Never touch real vaults: `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`. Leave `/tmp/grove-playground` and `~/grove-compare-vault` alone.
- `cargo test --offline` must pass.
- Commit locally on `rebuild/s4-grok`. Never push. Never force-push. Do not commit prompt files (`.x-*.txt`).
- Do not buy credits or change tool/user config. Do not run `omarchy refresh shell`.

## Size discipline

- The smallest change that batches rebuilds and fixes `entry_for`. Reuse existing maps and methods.
- Delete code your changes make dead.
- Keep every file under ~800 lines. `index.rs` and `vault.rs` are already mid-size; split only if a change would push one over.
- No new dependency.

## Scope limits

**In scope:** batching `rebuild_maps` in `apply`, a single rebuild in `rename_path`, a direct lookup in `entry_for`, tests and notes.

**Out of scope:** incremental maps (P2); making commands async or switching to RwLock (S5); CRLF/BOM (S3); the TypeScript new-note hitch (finding 8) beyond the Rust help this already gives; the unmerged T1 tabs work; opening the real app.

## Done when

- Batches, rename, and `entry_for` meet the goals, with tests that failed before and pass after.
- Index behavior matches today's results.
- `cargo test --offline` passes. No assertion was weakened.
- Worktree is committed locally, clean except untracked prompt files, and not pushed.

## Notes file

Write `rebuild/NOTES_S4-grok.md` before you finish, and commit it with the code. Include:

- In plain words: what is faster under the lock, and confirmation that nothing visible changed.
- Rebuild counts before vs after, and how you proved each test failed before and passed after.
- Net line change by language and by file; any file near 800 lines; any new dependency (should be none).
