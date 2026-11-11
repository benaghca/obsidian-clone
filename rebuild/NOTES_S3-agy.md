# S3 Notes (`rebuild/s3-agy`)

## In plain words

When Grove saves a note that already exists on disk with Windows CRLF (`\r\n`) line endings and/or a UTF-8 BOM (`\u{feff}`), `write_note` keeps that note's existing line endings and BOM instead of rewriting it as plain LF (`\n`) with no BOM. If a note is saved as a single line without line breaks (or as an empty document) and later saved again with multiple lines—including after renaming the note or its parent folder—it still remembers and writes back its CRLF/BOM format. Brand-new notes (written to a path that did not exist yet, or created empty as LF via `create_note`) continue to be saved as LF with no BOM.

**Nothing visible changed:** layout, shortcuts, look, theme, and editor behavior are untouched, and no TypeScript or UI files were modified.

## What changed

- **`rebuild/app/src-tauri/src/vault.rs` (`NoteFormat`, `Vault::read_note`, `Vault::write_note`, `Vault::create_note`, `Vault::rename_path`, `Vault::delete_path`):**
  - Before `atomic_write`, `write_note` reads the existing file at `full` if one is present (`ErrorKind::NotFound` means a new file).
  - `Vault` keeps a per-note `formats: Mutex<HashMap<String, NoteFormat>>` cache (`bom`, `crlf`), updated by `observe_format` on `read_note`, `write_note`, and `create_note`, relocated across file and folder renames by `relocate_formats` in `rename_path`, and cleared on `delete_path`.
  - When a file on disk has `\r\n`, `crlf` is `true`; when it has `\n` without `\r\n`, `crlf` is `false`; when it has no line breaks at all (single-line or empty), `observe_format` preserves the last remembered `crlf` for that note (and `bom` when empty).
  - `NoteFormat::apply` normalizes line endings to `\r\n` (without doubling existing `\r\n`) and restores the leading `\u{feff}` (without doubling an existing BOM) before writing and updating the index via `upsert_note`. If both `bom` and `crlf` are `false`, it borrows `content` as-is with zero extra allocation.
- **`rebuild/app/src-tauri/src/vault.rs` (`mod tests`):**
  - Added five regression tests:
    1. `crlf_and_lf_notes_keep_their_line_endings_on_save`
    2. `utf8_bom_is_preserved_and_bomless_notes_do_not_gain_one`
    3. `bom_and_crlf_round_trip_while_new_notes_stay_lf_without_bom`
    4. `write_note_does_not_overwrite_non_utf8_bytes_with_replacement_chars`
    5. `crlf_and_bom_survive_single_line_or_empty_saves_and_renames` (Codex review P2 fix)

## Proof that each test failed before and passed after

All initial four regression tests were added to `vault.rs` and run via `cargo test --offline vault::tests::` **before** changing `write_note`:

- `crlf_and_lf_notes_keep_their_line_endings_on_save`: **FAILED** (`left: "first\nrevised\n"`, `right: "first\r\nrevised\r\n"`).
- `utf8_bom_is_preserved_and_bomless_notes_do_not_gain_one`: **FAILED** (`left: "first\nrevised\n"`, `right: "\u{feff}first\nrevised\n"`).
- `bom_and_crlf_round_trip_while_new_notes_stay_lf_without_bom`: **FAILED** (`left: "---\nstatus: done\n---\nbody\n"`, `right: "\u{feff}---\r\nstatus: done\r\n---\r\nbody\r\n"`).
- `write_note_does_not_overwrite_non_utf8_bytes_with_replacement_chars`: **FAILED** (`write_note` succeeded and overwrote the original `b"caf\xe9\r\n"` bytes with UTF-8 replacement characters).

For the Codex P2 review fix, `crlf_and_bom_survive_single_line_or_empty_saves_and_renames` was added and run on commit `80911a2` **before** adding `NoteFormat` state:

- `crlf_and_bom_survive_single_line_or_empty_saves_and_renames`: **FAILED** on `80911a2` (`left: "single\nnext"`, `right: "single\r\nnext"` after saving `"single"` to a `"a\r\nb\r\n"` file and then saving `"single\nnext"`).
- After adding `NoteFormat` tracking and rename relocation, all 115 active Rust tests in `cargo test --offline` pass.

## Invalid UTF-8 handling

- **Presentation (`read_note`):** Left unchanged (`String::from_utf8_lossy` with BOM stripped), as required by the brief so that no visible UI or editor presentation changes.
- **Preventing silent byte corruption (`write_note`):** When `write_note` inspects the existing file on disk, it checks `String::from_utf8(bytes)` (matching `Vault::set_property` in `edit.rs`) and returns `Err("Note is not UTF-8".to_string())` before `mark_own` or `atomic_write` if the existing file on disk is not valid UTF-8. This prevents `write_note` (including background link updates or editor saves) from silently overwriting original non-UTF-8 bytes on disk with `U+FFFD` replacement characters, without adding any UI.

## Line counts and dependencies

- **Net line change by language / file (vs `rebuild/integration`):**
  - Rust (`rebuild/app/src-tauri/src/vault.rs`): `+142 / -4` (net `+138` lines: `+59` lines in production code, `+79` lines in tests).
  - TypeScript / CSS / JSON: `0` lines changed.
- **Files near/over 800 lines:**
  - `rebuild/app/src-tauri/src/vault.rs`: `1002` lines (`461` lines of implementation + `541` lines of `#[cfg(test)] mod tests`; was `864` lines before this change). Kept in `vault.rs` so `rebuild/s4-grok` merges cleanly without file-split conflicts.
  - `rebuild/app/src-tauri/src/edit.rs`: `866` lines (unchanged).
  - `rebuild/app/src-tauri/src/lib.rs`: `721` lines (unchanged).
- **New dependencies:** None.
