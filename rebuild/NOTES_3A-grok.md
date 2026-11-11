# 3A: ignore a watcher event only when the file is still our write

The watcher used to drop every create, modify, and remove for a path Grove had written in the last 500 ms, whoever changed it. An outside edit in that window never became `vault-changed`, and the next save wrote over it.

An event is now dropped only when the file on disk is still that write: the same millisecond mtime, the same size, and, when both are known, the same device and inode. Any other change is a normal external change. There is no timer. Nothing visible was added: no notice, dialog, or other UI. Part B (refuse `write_note` on a stamp mismatch, or a keep-both choice) is not in this slice.

## What records the stamp

`write_note`, `create_note`, `write_file_bytes`, `replace_file_bytes`, and `set_property` record the stamp after the write succeeds, from the metadata of the file just written. A failed write leaves the previous record in place. `rename_path` moves the record with the file. `delete_path` drops it. After the unchanged index batch, a watcher rename moves the record the same way, and a watcher remove drops it. A create or modify does not refresh the record, so an external edit that was accepted no longer matches, and a later event for that path is not swallowed.

The S5 write lock is still held across the save, and the flush that decides takes the same lock. `apply` and `rename_path` still rebuild name maps in their one existing `map_batch` block. Command signatures and the mutex were not changed. A path with no record is never suppressed, and the check stats only that path.

## Coarse clocks, renames, and line endings

`mtime_ms` truncates to milliseconds. A same-size replace in that same tick is a different file when the inode changes, and that is what gets reported. An in-place write that keeps the inode, the size, and the millisecond is still indistinguishable from our save. There is no 500 ms fallback for that case.

A two-sided rename is still reported. Names containing `.grove-tmp` are still ignored, so the rename our atomic save uses collapses to a create of the destination, and that create is dropped while the stamp matches. An external rename of a note we just saved is reported. The stamp moves with the file, so a later modify of those same bytes is quiet, and an edit of the destination is not.

An external modify refreshes the indexed text through the existing `refresh_path`. It does not re-observe CRLF or BOM. The next `read_note` or `write_note` reads the ending from disk. A save that was already sitting in the S5 queue can still overwrite the external bytes. That overwrite is part B.

A missing file is not our write, so an external delete is reported even inside the old window. `delete_path` drops the record first, so the watcher echo of our own delete is also a remove. The index remove is idempotent. The old timer hid that echo only for 500 ms after a save.

## Tests

`watch.rs` now checks five flushes, all under `/tmp`:

- `outside_edit_just_after_a_save_is_reported`: a different write immediately after `write_note` is one modify, and the index has the outside text.
- `own_write_echo_produces_no_vault_changed`: a modify of our file, and the temp-file rename a save emits, are both empty. The bytes stay ours.
- `same_size_new_inode_replace_is_reported`: same length, mtime restored with `File::set_modified`, new inode. The modify is reported.
- `own_echo_does_not_hide_another_files_remove`: our modify is dropped and the other file's remove is kept.
- `external_rename_is_reported_and_keeps_the_stamp`: the rename is reported, the record is on the destination, and a later modify of those bytes is empty.

These tests were added with the new check, so they were not executed against `02a9e38`. On that commit `is_own_write` was true for 500 ms and did not look at the file.

`create_note` now records a stamp, so the property dry-run test expects that stamp to remain, and expects it to stop matching after an outside overwrite.

## How it was run

Commands started in `rebuild/app/src-tauri` for Rust and in `rebuild/app` for npm.

- `cargo test --offline` passed: 161 tests, 0 failed, 4 ignored. `cargo fmt` was not run. `index/file_map.rs` still warns that `ValueWalk` is unused. That warning was already there.
- `rebuild/app/node_modules` was missing, so the property-edit fuzz could not import `@codemirror/state`. `npm ci --offline` installed 69 packages into this worktree. The lockfile did not change. `node_modules` is not in the commit. CI runs its own `npm ci`.
- The first `flock /tmp/grove-npm-test.lock npm test` stopped in `scripts/test-feel.mjs`: the graph phase had 10 long tasks, max 81 ms. That script drives the mock UI, not this Rust change. The rerun exited 0, including `posttest`. Typing, the switcher, and folder expand had 0 long tasks. The graph stayed the held gap (p95 33.4 ms, max 33.5 ms, 59/184 frames over 20 ms) with 0 long tasks. Friction budgets passed.
- The suite rewrote screenshots under `rebuild/round23-shots` through `rebuild/round33-shots`. Those files were restored and are not in this commit.

## Size

No new dependency. `vault.rs` stays one file (1938 lines; the test module starts at line 787).

| Language | File | Lines | Change |
| --- | --- | --- | --- |
| Rust | `rebuild/app/src-tauri/src/vault.rs` | 1938 | +95 / −23 |
| Rust | `rebuild/app/src-tauri/src/watch.rs` | 715 | +182 / −10 |
| Rust | `rebuild/app/src-tauri/src/edit.rs` | 868 | +5 / −3 |
| Markdown | `rebuild/NOTES_3A-grok.md` | 57 | +57 / −0, new |

Code only: +282 / −36. With this notes file: +339 / −36.
