# 3A — own-write echo suppression by stamp, not a 500 ms window (non-visible)

Source: Fable review finding 3, part A (/rebuild notes copy below).
Today src-tauri/src/vault.rs and src-tauri/src/watch.rs drop any watcher event for a path Grove wrote in the last 500 ms, whoever caused it. An outside edit (Syncthing, git, another editor) landing in that window is never shown, and the next save overwrites it.

Goal: ignore an event only when the file's current stamp (mtime + size, which the index already records for each own write) matches Grove's own last write; any other change must flow through as a normal external change. Design the details yourself (e.g. how to handle coarse mtime filesystems, renames, S3's CRLF/BOM format tracking, S5's write queue ordering, S8/S9 batching).

Limits:
- No visible change: no new notices, dialogs, or UI. Part B (write_note refusing on stamp mismatch / keep-both UI) is NOT in scope.
- Don't regress typing or save latency; friction budgets must still pass.
- No new crates or packages, no network. Test vaults under /tmp only.
- Add regressions: an outside edit within 500 ms of a Grove save is reported; Grove's own write still produces no echo/reload.
- Run cargo test --offline and locked npm tests (flock /tmp/grove-npm-test.lock npm test). If npm can't resolve @codemirror/* because node_modules is a symlink outside Vite's root, see rebuild/NOTES_S8-grok.md for the in-project offline install fix (no lockfile change).
- Write notes to rebuild/NOTES_3A-grok.md. Commit locally on rebuild/3a-grok, then stop. Do not push.
