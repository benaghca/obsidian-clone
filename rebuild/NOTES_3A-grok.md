# 3A: ignore a watcher event only when the file is still our write

The watcher used to drop every create, modify, and remove for a path Grove had written in the last 500 ms, whoever changed it. An outside edit in that window never became `vault-changed`, and the next save wrote over it.

An event is now dropped only when the file on disk is still that write: the same millisecond mtime, the same size, and, when both are known, the same device and inode. Any other change is a normal external change. There is no timer. Nothing visible was added: no notice, dialog, or other UI. Part B (refuse `write_note` on a stamp mismatch, or a keep-both choice) is not in this slice.

## What records the stamp

`write_note`, `create_note`, `write_file_bytes`, `replace_file_bytes`, and `set_property` record the stamp only after the atomic write returns success. The stamp is the temp file's metadata, taken after the bytes are synced and before `rename` publishes that file. A stat of the destination after the rename can describe someone else's replace, so it is not the record. `atomic_write` and `atomic_write_durable` return that receipt. `write_config` and the app-config `remember` path discard it; they do not own a note stamp.

A failed write leaves the previous record in place, including a crash or directory-sync error after the rename has already landed. The test hook that swaps the destination runs only on the success path, after publication and after the directory sync, and only in test builds. It fires once.

`rename_path` moves the record with the file. `delete_path` drops it. After the unchanged index batch, a watcher rename moves the record only for an identity that actually left its path. The walk is the same one the format cache uses (`stayed` / departed id), on a copy of that map, so a chain still follows the file and a duplicate hop is spent once. Whether a path stayed is the cached device and inode compared with the file now on disk. `record_own` stores the receipt's inode in that cache at the same time as the own-write stamp. `write_note`, `create_note`, `write_file_bytes`, `replace_file_bytes`, and `set_property` all go through it, so a property edit that replaces the inode is still the resident file. Those writers do not stat the destination for this identity. `rename_path`, `create_folder`, and a watcher batch still stat the path they are reconciling, because that path is not an atomic-write receipt.

An echo of an app rename has no departed id when the cache matches. A source that was written again after the rename keeps its new record, and the destination keeps the record `rename_path` already moved. The echo does not copy one onto the other, and it does not adopt whatever bytes are now on disk. A watcher remove drops the record. A create or modify does not refresh it.

The S5 write lock is still held across the save, and the flush that decides takes the same lock. That lock does not stop another process. `apply` and `rename_path` still rebuild name maps in their one existing `map_batch` block. Command signatures and the mutex were not changed. A path with no record is never suppressed, and the check stats only that path.

## Coarse clocks, renames, and line endings

`mtime_ms` truncates to milliseconds. A same-size replace in that same tick is a different file when the inode changes, and that is what gets reported. An in-place write that keeps the inode, the size, and the millisecond is still indistinguishable from our save. The receipt does not close that gap. There is no 500 ms fallback for that case.

A two-sided rename is still reported. Names containing `.grove-tmp` are still ignored, so the rename our atomic save uses collapses to a create of the destination, and that create is dropped while the stamp matches. An external rename of a note we just saved is reported. The stamp moves with the file, so a later modify of those same bytes is quiet, and an edit of the destination is not.

An external modify refreshes the indexed text through the existing `refresh_path`. It does not re-observe CRLF or BOM. The next `read_note` or `write_note` reads the ending from disk. A save that was already sitting in the S5 queue can still overwrite the external bytes. That overwrite is part B.

A missing file is not our write, so an external delete is reported even inside the old window. `delete_path` drops the record first, so the watcher echo of our own delete is also a remove. The index remove is idempotent. The old timer hid that echo only for 500 ms after a save.

## Tests

`watch.rs` checks the flushes under `/tmp`.

On `ce3f996`, before this fix:

- `app_rename_echo_does_not_steal_a_recreated_sources_stamp` failed at `watch.rs:740`. The rename echo was reported, then Grove's own modify of the recreated `A.md` was emitted. `track_own` had moved A's new record onto B.
- With writers still statting the path after `rename`, `outside_replace_during_publish_of_write_note_is_reported`, `..._create_note_...`, and `..._set_property_...` failed at `watch.rs:805` (`adopted the outside file`). `..._write_file_bytes_...` failed at `watch.rs:881` (`is_own_write("pic.png")`). The hook wrote a sibling and renamed it over the published path, so the outside file had a new inode and a different size. The first property attempt expected `todo` and conflicted without writing. The run that failed for real expected `status: todo`, returned `Done`, and still adopted the outside file.

After the receipt and the identity walk, those five pass, and the five checks from `ce3f996` still pass:

- `outside_edit_just_after_a_save_is_reported`
- `own_write_echo_produces_no_vault_changed`
- `same_size_new_inode_replace_is_reported`
- `own_echo_does_not_hide_another_files_remove`
- `external_rename_is_reported_and_keeps_the_stamp`

On `fde70a7`, `app_rename_echo_keeps_property_writes_on_both_files` failed at `watch.rs:800` (`recreated source dropped`). Both property edits had returned Done, and both files were still own writes, before the echo. `set_property` had recorded the stamp from the receipt and left the inode cache on the earlier note write, so the echo treated the resident files as a move and dropped the recreated source.

`create_note` records a stamp, so the property dry-run test expects that stamp to remain, and expects it to stop matching after an outside overwrite. Duplicate-hop, chain, and round-trip format tests still pass. `map_batch` was not edited.

## How it was run

Commands started in `rebuild/app/src-tauri` for Rust and in `rebuild/app` for npm.

- `cargo test --offline` passed: 167 tests, 0 failed, 4 ignored. `cargo fmt` was not run. `index/file_map.rs` still warns that `ValueWalk` is unused. That warning was already there.
- `rebuild/app/node_modules` was already present. The lockfile did not change. `node_modules` is not in the commit.
- `flock /tmp/grove-npm-test.lock npm test` exited 0, including `posttest`. Typing, the switcher, and folder expand had 0 long tasks. The graph stayed the held gap (p95 33.4 ms, max 33.5 ms, 62/181 frames over 20 ms) with 0 long tasks. Friction budgets passed.
- The suite rewrote screenshots under `rebuild/round23-shots` through `rebuild/round33-shots`. Those files were restored and are not in this commit.

## Size

No new dependency. `vault.rs` stays one file (1959 lines; the test module starts at line 808).

| Language | File | Lines | Change |
| --- | --- | --- | --- |
| Rust | `rebuild/app/src-tauri/src/vault.rs` | 1959 | +8 / −4 |
| Rust | `rebuild/app/src-tauri/src/watch.rs` | 986 | +60 / −0 |
| Markdown | `rebuild/NOTES_3A-grok.md` | 69 | +13 / −12 |

Code only: +68 / −4. With this notes file: +81 / −16.
