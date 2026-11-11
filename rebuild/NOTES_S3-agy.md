# S3 Notes (`rebuild/s3-agy`)

## In plain words

When Grove saves a note that already exists on disk with Windows CRLF (`\r\n`) line endings and/or a UTF-8 BOM (`\u{feff}`), `write_note` keeps that note's existing line endings and BOM instead of rewriting it as plain LF (`\n`) with no BOM. If a note is saved as a single line without line breaks (or as an empty document) and later saved again with multiple lines—including after renaming the note or its parent folder—it still remembers and writes back its CRLF/BOM format. Brand-new notes (written to a path that did not exist yet, or created empty as LF via `create_note`) continue to be saved as LF with no BOM.

**Nothing visible changed:** layout, shortcuts, look, theme, and editor behavior are untouched, and no TypeScript or UI files were modified.

## What changed

- **`rebuild/app/src-tauri/src/vault.rs` (`NoteFormat`, `Vault::read_note`, `Vault::write_note`, `Vault::create_note`, `Vault::rename_path`, `Vault::delete_path`, `Vault::apply`, `Vault::finish_rescan`):**
  - Before `atomic_write`, `write_note` reads the existing file at `full` if one is present (`ErrorKind::NotFound` means a new file).
  - `Vault` keeps a per-note `formats: Mutex<HashMap<String, NoteFormat>>` cache (`bom`, `crlf`), updated by `observe_format` on `read_note`, `write_note`, and `create_note` (storing only notes with `bom` or `crlf` and evicting entries that revert to plain LF without BOM).
  - When a file on disk has `\r\n`, `crlf` is `true`; when it has `\n` without `\r\n`, `crlf` is `false`; when it has no line breaks at all (single-line or empty), `observe_format` preserves the last remembered `crlf` for that note (and `bom` when empty).
  - `Vault::rename_path` relocates cached format entries (`relocate_formats`) only **after** `fs::create_dir_all` and `fs::rename` succeed, right before the S4 `self.index.map_batch()` block, so a failed rename never orphans the original path's format or populates the failed destination.
  - `Vault::apply` keeps `self.formats` synchronized with watcher batches while preserving S4's single `map_batch` rebuild:
    - Rename relocation (`relocate_format_map`) is idempotent on replay: when an app `rename_path` has already moved `from` to `to`, the subsequent watcher rename echo finds no un-evicted keys at `from` and leaves `to`'s cached format intact.
    - All `ChangeKind::Rename` moves in a batch are applied to `self.formats` in sequence before a single final `retain` prunes against the final `self.index`, so chained file and folder renames (`A -> B -> C`) within one watcher batch keep their cached format all the way to `C`.
    - A note moved in that batch is recorded in `kept`. A later `Create` of its new parent folder is still an evict prefix, but the retain keeps the relocated note, so `Rename(A.md -> New/A.md)` followed by `Create(New)` does not forget CRLF.
    - All `ChangeKind::Remove` and `ChangeKind::Create` paths in a batch are collected into a single `HashSet<&str>` (`evict`) and evicted together with final-index pruning in one `formats.retain` pass using `has_prefix_in`.
    - A successful app `rename_path` drops the destination's cached format (the path and anything under it) before moving the source, including when the source has no cached format.
    - A watcher rename moves or clears a format only for a file that has already left that path. `apply` keeps one identity per path. Landing on a path replaces the identity that was there, so a deleted intermediate (`A -> B -> C` after `B` was removed) does not leave a second identity for a replay to spend. An app-rename echo does not relocate either cache: the old path is already gone, or a newer file is still there. Vault writes remember device and inode, so a same-size replace in one clock tick is still a different file and still drops a stale destination format. The index batch still relocates every rename, including that echo. Afterward `apply` puts a source that is still the indexed file back into the index, so the file list keeps it and the final format prune does not drop its cached CRLF or BOM. The destination stays the file the batch refreshed.
  - `Vault::finish_rescan` evicts newly created paths and prunes `self.formats` to retain only live non-directory paths present in `self.index` in a single `retain` pass.
  - `NoteFormat::apply` normalizes line endings to `\r\n` (without doubling existing `\r\n`) and restores the leading `\u{feff}` (without doubling an existing BOM) before writing and updating the index via `upsert_note`. If both `bom` and `crlf` are `false`, it borrows `content` as-is with zero extra allocation.
- **`rebuild/app/src-tauri/src/vault.rs` (`mod tests`):**
  - Added nine regression tests:
    1. `crlf_and_lf_notes_keep_their_line_endings_on_save`
    2. `utf8_bom_is_preserved_and_bomless_notes_do_not_gain_one`
    3. `bom_and_crlf_round_trip_while_new_notes_stay_lf_without_bom`
    4. `write_note_does_not_overwrite_non_utf8_bytes_with_replacement_chars`
    5. `crlf_and_bom_survive_single_line_or_empty_saves_and_renames` (Codex review 1 P2 fix)
    6. `failed_rename_keeps_original_format_and_leaves_destination_uncached` (Codex review 2 P2 fix 1)
    7. `watcher_apply_and_rescan_maintain_and_prune_format_cache` (Codex review 2 P2 fix 2)
    8. `app_rename_watcher_echo_preserves_cached_format` (Codex review 3 P2 fix 1)
    9. `chained_watcher_renames_and_batched_eviction_keep_and_prune_formats` (Codex review 3 P2 fix 2 + P3 batched eviction)
    10. `destination_dir_create_keeps_relocated_crlf_format` (Codex review 4 P2 fix 1)
    11. `external_delete_then_app_rename_drops_stale_destination_format` (Codex review 4 P2 fix 2)
    12. `external_delete_and_rename_does_not_inherit_destination_format` (Codex review 5 P2 fix)
    13. `replay_duplicate_coalesced_file_rename_keeps_crlf` (Codex review 6 P2)
    14. `replay_duplicate_coalesced_folder_rename_keeps_crlf` (Codex review 6 P2)
    15. `replay_repeated_chain_hop_keeps_crlf` (Codex review 6 P2)
    16. `replay_app_rename_reused_source_echo_keeps_crlf` (Codex review 6 P2)
    17. `replay_round_trip_keeps_crlf_on_the_final_hop` (Codex review 6, guards against pair dedup)
    18. `replay_reused_source_external_rename_drops_stale_format` (Codex review 6, a real rename of a reused path still drops the old format)
    19. `replay_app_echo_keeps_reused_crlf_source_and_lf_dest` (Codex review 7 P2)
    20. `replay_app_echo_keeps_dest_crlf_when_reused_source_has_bom` (Codex review 7 P2)
    21. `replay_preindexed_intermediate_hop_keeps_crlf` (Codex review 7 P2)
    22. `replay_round_trip_back_to_resident_source_keeps_crlf` (Codex review 7, a round trip that ends on the original file)
    23. `replay_echo_single_line_keeps_reused_crlf_source` (Codex review 8 P2)
    24. `replay_echo_single_line_keeps_reused_bom_source` (Codex review 8 P2)
    25. `replay_echo_single_line_coalesce_keeps_reused_crlf_source` (Codex review 8 P2, through coalesce/normalize)
    26. `replay_echo_single_line_coalesce_keeps_reused_bom_source` (Codex review 8 P2, through coalesce/normalize)

## Proof that each test failed before and passed after

All initial four regression tests were added to `vault.rs` and run via `cargo test --offline vault::tests::` **before** changing `write_note`:

- `crlf_and_lf_notes_keep_their_line_endings_on_save`: **FAILED** (`left: "first\nrevised\n"`, `right: "first\r\nrevised\r\n"`).
- `utf8_bom_is_preserved_and_bomless_notes_do_not_gain_one`: **FAILED** (`left: "first\nrevised\n"`, `right: "\u{feff}first\nrevised\n"`).
- `bom_and_crlf_round_trip_while_new_notes_stay_lf_without_bom`: **FAILED** (`left: "---\nstatus: done\n---\nbody\n"`, `right: "\u{feff}---\r\nstatus: done\r\n---\r\nbody\r\n"`).
- `write_note_does_not_overwrite_non_utf8_bytes_with_replacement_chars`: **FAILED** (`write_note` succeeded and overwrote the original `b"caf\xe9\r\n"` bytes with UTF-8 replacement characters).

For the first Codex P2 review fix, `crlf_and_bom_survive_single_line_or_empty_saves_and_renames` was added and run on commit `80911a2` **before** adding `NoteFormat` state:

- `crlf_and_bom_survive_single_line_or_empty_saves_and_renames`: **FAILED** on `80911a2` (`left: "single\nnext"`, `right: "single\r\nnext"` after saving `"single"` to a `"a\r\nb\r\n"` file and then saving `"single\nnext"`).

For the second Codex P2 review fixes, both new regression tests were added and run on commit `9f59057` **before** updating `rename_path`, `apply`, and `finish_rescan`:

- `failed_rename_keeps_original_format_and_leaves_destination_uncached`: **FAILED** on `9f59057` (`left: "single\nnext"`, `right: "single\r\nnext"` after `rename_path("Orig.md", "blocker/Dest.md")` failed in `create_dir_all` and prematurely relocated `"Orig.md"`'s cached format).
- `watcher_apply_and_rescan_maintain_and_prune_format_cache`: **FAILED** on `9f59057` (`left: "single\nnext"`, `right: "single\r\nnext"` after external file and folder renames via `vault.apply`).

For the third Codex P2/P3 review fixes, both new regression tests were added and run on commit `01ed722` **before** updating `relocate_format_map` and `apply`:

- `app_rename_watcher_echo_preserves_cached_format`: **FAILED** on `01ed722` (`left: "single\nnext"`, `right: "single\r\nnext"` after `rename_path` was followed by its watcher `ChangeKind::Rename` echo).
- `chained_watcher_renames_and_batched_eviction_keep_and_prune_formats`: **FAILED** on `01ed722` (`left: "single\nnext"`, `right: "single\r\nnext"` after a single watcher batch with chained `A.md -> B.md -> C.md` and `dir1 -> dir2 -> dir3` renames).
- After the fixes, all 124 active Rust tests (including all 9 S3 tests and all 5 S4 `vault::batch_tests`) pass in `cargo test --offline`.

For the fourth Codex review, both new regressions were added and run on commit `f42e98f` **before** updating `relocate_formats` and the `apply` retain:

- `destination_dir_create_keeps_relocated_crlf_format`: **FAILED** on `f42e98f` (`left: "single\nnext"`, `right: "single\r\nnext"`). The coalesced and normalized batch was `Rename(A.md, New/A.md)` then `Create(New)`, and the next multiline save wrote LF.
- `external_delete_then_app_rename_drops_stale_destination_format`: **FAILED** on `f42e98f` (`left: "single\r\nnext"`, `right: "single\nnext"`). `B.md` was cached CRLF, deleted on disk before any watcher event, then a plain LF `A.md` was renamed onto `B.md`. The next multiline save inherited CRLF. The test also applies the watcher rename echo before that save.
- After the fixes, those two tests pass, and `cargo test --offline` in `rebuild/app/src-tauri` passes: 126 tests, 0 failed, 4 ignored. No older assertion was weakened. S4's `map_batch` block was not edited.

For the fifth Codex review, `external_delete_and_rename_does_not_inherit_destination_format` was added and run on commit `59a0d69` **before** teaching `apply` to retire a real external destination:

- **FAILED** on `59a0d69` (`left: ("single\r\nnext", "\u{feff}single\r\nnext")`, `right: ("single\nnext", "single\nnext")`). Both cases delete `B.md` externally and rename plain `A.md` onto it. Coalesce leaves only `Rename(A.md, B.md)`. The single-line LF source inherited CRLF. The empty LF source inherited the stale BOM and CRLF.
- After the fix, that test passes. The app-echo, parent-create, and chained-rename regressions still pass. `cargo test --offline` in `rebuild/app/src-tauri` passes: 127 tests, 0 failed, 4 ignored. No older assertion was weakened. The `map_batch` block was not edited.

For the sixth Codex review, the four failing regressions were added and run on commit `fc12a42` **before** `apply` started consuming move identity:

- `replay_duplicate_coalesced_file_rename_keeps_crlf`: **FAILED** (`left: "single\nnext"`, `right: "single\r\nnext"`). Coalesce kept two `Rename(A.md, B.md)` records. The second cleared `B.md` after the first had moved the CRLF cache.
- `replay_duplicate_coalesced_folder_rename_keeps_crlf`: **FAILED** the same way (`left: "single\nnext"`, `right: "single\r\nnext"`) for two coalesced `Rename(dir1, dir2)` records.
- `replay_repeated_chain_hop_keeps_crlf`: **FAILED** (`left: "single\nnext"`, `right: "single\r\nnext"`) on the save of `C.md` after `A -> B -> C` plus a repeated `B -> C`.
- `replay_app_rename_reused_source_echo_keeps_crlf`: **FAILED** (`left: "single\nnext"`, `right: "single\r\nnext"`). `rename_path(A.md, B.md)`, then `create_note` of a plain LF `A.md`, then the watcher echo, cleared `B.md`.

`replay_round_trip_keeps_crlf_on_the_final_hop` passed on `fc12a42` and still passes. The format is relocated on every hop, including the second `A -> B`. Dropping repeated pairs would leave that format on `A`. `replay_reused_source_external_rename_drops_stale_format` passes after the fix: renaming the new plain file onto `B.md` still writes LF.

After the fix, the four regressions pass. The app-echo, parent-create, chained-rename, and external-replacement regressions still pass. `cargo test --offline` in `rebuild/app/src-tauri` passes: 133 tests, 0 failed, 4 ignored. No older assertion was weakened. The `map_batch` block was not edited.

For the seventh Codex review, three regressions were added and run on commit `ab4c2ef` **before** a landing replaced the identity at that path and an echo stopped relocating:

- `replay_app_echo_keeps_reused_crlf_source_and_lf_dest`: **FAILED** (`left: ("single\r\nnext", "a\r\nnext\r\n")`, `right: ("single\nnext", "a\r\nnext\r\n")`). After `rename_path(A.md, B.md)` and a new CRLF `A.md`, the echo copied that CRLF onto the single-line `B.md`. The new `A.md` stayed CRLF.
- `replay_app_echo_keeps_dest_crlf_when_reused_source_has_bom`: **FAILED** (`left: ("single\nnext", "\u{feff}only\nnext")`, `right: ("single\r\nnext", "\u{feff}only\nnext")`). The echo replaced `B.md`'s remembered CRLF with the new file's BOM format.
- `replay_preindexed_intermediate_hop_keeps_crlf`: **FAILED** (`left: "single\nnext"`, `right: "single\r\nnext"`). `B.md` was indexed, deleted, and `A.md` moved `A -> B -> C`, with a second coalesced `B -> C`. Coalesce kept three renames and dropped the delete. The extra identity cleared `C.md`.

`replay_round_trip_back_to_resident_source_keeps_crlf` passed on `ab4c2ef` and still passes. The file moves out and back to `A.md`, and `A.md` keeps CRLF.

After the fix, those regressions pass. The earlier rename regressions still pass, including an external delete-and-rename onto a same-size note. `cargo test --offline` in `rebuild/app/src-tauri` passes: 137 tests, 0 failed, 4 ignored. No older assertion was weakened. The `map_batch` block was not edited.

For the eighth Codex review, four regressions were added and run on commit `bd7cf43` **before** `apply` put a still-present rename source back into the index:

- `replay_echo_single_line_keeps_reused_crlf_source`: **FAILED** (`recreated source dropped out of the index`). With that assert moved after the save, it **FAILED** (`left: ("only\nnext", "single\nnext")`, `right: ("only\r\nnext", "single\nnext")`). After `rename_path(A.md, B.md)`, a new CRLF `A.md` was saved as the single line `only`, then the echo ran. The next multiline save of `A.md` wrote LF. `B.md` stayed LF.
- `replay_echo_single_line_keeps_reused_bom_source`: **FAILED** (`recreated source dropped out of the index`). The same save-first reorder passed on `bd7cf43`: disk still held `\u{feff}only`, so the next save put the BOM back, and `write_note` reindexed `A.md`. `B.md` stayed CRLF. The index assert before that save is the failure.
- `replay_echo_single_line_coalesce_keeps_reused_crlf_source`: **FAILED** (`recreated source dropped out of the index`). Coalesce of a create, the rename, and a modify of `A.md` left only `Rename(A.md, B.md)`, so the batch had no later refresh of `A.md`.
- `replay_echo_single_line_coalesce_keeps_reused_bom_source`: **FAILED** the same way (`recreated source dropped out of the index`) through coalesce and normalize.

After the fix, those regressions pass. Both files stay indexed, and the next save writes `only\r\nnext` for the CRLF source and `\u{feff}only\nnext` for the BOM source. The destination keeps the format it had. The earlier echo, round-trip, duplicate-replay, and external-replacement regressions still pass. `cargo test --offline` in `rebuild/app/src-tauri` passes: 141 tests, 0 failed, 4 ignored. No older assertion was weakened. The `map_batch` block was not edited.

## Invalid UTF-8 handling

- **Presentation (`read_note`):** Left unchanged (`String::from_utf8_lossy` with BOM stripped), as required by the brief so that no visible UI or editor presentation changes.
- **Preventing silent byte corruption (`write_note`):** When `write_note` inspects the existing file on disk, it checks `String::from_utf8(bytes)` (matching `Vault::set_property` in `edit.rs`) and returns `Err("Note is not UTF-8".to_string())` before `mark_own` or `atomic_write` if the existing file on disk is not valid UTF-8. This prevents `write_note` (including background link updates or editor saves) from silently overwriting original non-UTF-8 bytes on disk with `U+FFFD` replacement characters, without adding any UI.

## Line counts and dependencies

- **This commit (on top of `bd7cf43`):** Rust `rebuild/app/src-tauri/src/vault.rs` `+167 / -0` (net `+167`: `+31 / -0` before `#[cfg(test)]`, `+136` in the new tests). Markdown `rebuild/NOTES_S3-agy.md` `+16 / -3`. No TypeScript, CSS, or JSON.
- **File length:** `rebuild/app/src-tauri/src/vault.rs` is `1866` lines (`715` through the line before `#[cfg(test)]`, `1151` from that line to the end). It is over 800 lines. It stays one file so the integration merge does not split `vault.rs` while S4 also edits it. `edit.rs` and `lib.rs` were not changed. The S4 `map_batch` guard in `apply` was not changed.
- **New dependencies:** None.
