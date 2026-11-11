# S4: one name-map rebuild per watcher batch

A sync that changes many files used to rebuild Grove's whole name maps once per file, while the vault lock was held. `apply` now rebuilds those maps once for the batch. `rename_path` rebuilds once, not twice. `create_note`, `create_folder`, and `write_file_bytes` look up the one new row instead of building the whole file list.

Nothing the user sees changes. The file list, resolved links, aliases, and search hits after a batch match a fresh scan of the same folder. Layout, shortcuts, theme, and editor behavior were not touched. A normal one-file save still rebuilds once, as it did before.

Name maps are still a full rebuild from the file list. Incremental maps stay with the later P2 work. Replaying in-app edits at the end of a rescan (`finish_rescan`) still rebuilds per path. That path is a handful of writes during a scan, not the watcher batch this piece is about.

## Counts

The counters sit on the real rebuild and on `Index::list`. A deferred call does not count until the batch builds the maps. `entry` does not call `list`.

I ran the new tests on the old call path first (`cargo test --offline --lib -- s4_`). Disk, link, alias, and search checks passed. The count checks failed:

| What | Before | After |
| --- | --- | --- |
| `apply` of 3, 6, and 8 separate creates | 3, 6, 8 rebuilds | 1, 1, 1 |
| The same paths in one change record | 3, 6, 8 | 1, 1, 1 |
| Mixed modify, remove, create, and two renames | 8 | 1 |
| `rename_path` of a file, a folder, and a move into a new folder | 2, 2, 2 | 1, 1, 1 |
| `entry_for` on a missing path, then `create_note`, `create_folder`, `write_file_bytes` | walked 6, 8, 9, 11 list nodes | walked 0 |
| Empty `apply`, and an `apply` of ignored paths | 0 | 0 |

The empty apply already passed before the change. It keeps a no-op batch from rebuilding.

After the batching change, the same five tests passed. `cargo test --offline` in `rebuild/app/src-tauri` then passed: 115 tests, 0 failed, 4 ignored (the existing benches and fuzz). No assertion in an older test was weakened.

The file list is a `BTreeMap`, so the single-row lookup is one `get` on that map. It does not walk the other files. The brief's 6.1 ms per rebuild at 20k notes is why the call count matters: a 500-file sync was about 500 rebuilds under the lock, and is now one. I did not re-time a 20k vault.

## Size

No new dependency.

Rust, against `46b072f`:

| File | Lines now | Change |
| --- | --- | --- |
| `rebuild/app/src-tauri/src/index.rs` | 710 | +99 / −8 |
| `rebuild/app/src-tauri/src/vault.rs` | 872 | +23 / −15 |
| `rebuild/app/src-tauri/src/vault_batch_tests.rs` | 292 | +292 / −0, new |

Net Rust: +414 / −23. Markdown: this file only, +44.

`vault.rs` was already 864 lines, over the ~800 guide, before this change. It is 872 now. The new tests live in `vault_batch_tests.rs` so they did not land in `vault.rs`. I did not split `vault.rs`; S3 is editing note reads and writes in that file. `index.rs` is 710 and stayed in one file.
