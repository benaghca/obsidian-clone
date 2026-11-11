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
  - `Vault::apply` keeps `self.formats` synchronized with watcher batches while preserving S4's single `map_batch` rebuild: two-sided `ChangeKind::Rename` events relocate cached format entries (and drop them if the destination no longer exists in the index), `ChangeKind::Remove` and `ChangeKind::Create` remove cached entries for removed or newly created/recreated paths, and `ChangeKind::Modify` (including atomic saves normalized from `Create` by `Vault::normalize`) preserves cached format for live files while removing entries if a path disappeared or became a directory.
  - `Vault::finish_rescan` clears newly created paths and prunes `self.formats` to retain only live non-directory paths present in `self.index`.
  - `NoteFormat::apply` normalizes line endings to `\r\n` (without doubling existing `\r\n`) and restores the leading `\u{feff}` (without doubling an existing BOM) before writing and updating the index via `upsert_note`. If both `bom` and `crlf` are `false`, it borrows `content` as-is with zero extra allocation.
- **`rebuild/app/src-tauri/src/vault.rs` (`mod tests`):**
  - Added seven regression tests:
    1. `crlf_and_lf_notes_keep_their_line_endings_on_save`
    2. `utf8_bom_is_preserved_and_bomless_notes_do_not_gain_one`
    3. `bom_and_crlf_round_trip_while_new_notes_stay_lf_without_bom`
    4. `write_note_does_not_overwrite_non_utf8_bytes_with_replacement_chars`
    5. `crlf_and_bom_survive_single_line_or_empty_saves_and_renames` (Codex review 1 P2 fix)
    6. `failed_rename_keeps_original_format_and_leaves_destination_uncached` (Codex review 2 P2 fix 1)
    7. `watcher_apply_and_rescan_maintain_and_prune_format_cache` (Codex review 2 P2 fix 2)

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
- After the fixes and merging S4 (`4e364cc`), all 122 active Rust tests (including all 7 S3 tests and all 5 S4 `vault::batch_tests`) pass in `cargo test --offline`.

## Invalid UTF-8 handling

- **Presentation (`read_note`):** Left unchanged (`String::from_utf8_lossy` with BOM stripped), as required by the brief so that no visible UI or editor presentation changes.
- **Preventing silent byte corruption (`write_note`):** When `write_note` inspects the existing file on disk, it checks `String::from_utf8(bytes)` (matching `Vault::set_property` in `edit.rs`) and returns `Err("Note is not UTF-8".to_string())` before `mark_own` or `atomic_write` if the existing file on disk is not valid UTF-8. This prevents `write_note` (including background link updates or editor saves) from silently overwriting original non-UTF-8 bytes on disk with `U+FFFD` replacement characters, without adding any UI.

## Line counts and dependencies

- **Net line change by language / file (vs `rebuild/integration`):**
  - Rust (`rebuild/app/src-tauri/src/vault.rs`): `+253 / -14` (net `+239` lines: `+96` lines in production code, `+143` lines in tests).
  - TypeScript / CSS / JSON: `0` lines changed.
- **Files near/over 800 lines:**
  - `rebuild/app/src-tauri/src/vault.rs`: `1111` lines (`468` lines of implementation + `643` lines of `#[cfg(test)] mod tests`). Kept in `vault.rs` so `rebuild/integration` merges cleanly without file-split conflicts.
  - `rebuild/app/src-tauri/src/edit.rs`: `866` lines (unchanged).
  - `rebuild/app/src-tauri/src/lib.rs`: `721` lines (unchanged).
- **New dependencies:** None.
