# S5 Notes (`rebuild/s5-agy`)

## In plain words

Opening or creating a vault (`open_vault`, `create_vault`), saving a note (`write_note`), creating a note or folder (`create_note`, `create_folder`), renaming or deleting a path (`rename_path`, `delete_path`), and saving vault settings (`write_config`) no longer run on the GTK main thread. They now run on Tauri's background thread pool (`#[tauri::command(async)]`), so disk `fsync`s and waiting for an ongoing search or link query no longer freeze the window.

In addition, the vault state lock is now an `RwLock` instead of a single `Mutex`, so read commands (such as `search_notes`, `link_index`, `read_note`, and `list_files`) share the lock and overlap with one another instead of queuing behind each other. Write commands pass through a small FIFO ticket queue (`WriteQueue` / `WriteTicket`) before taking the exclusive write lock, so queued saves, creates, and renames always execute in the exact order they were submitted.

**Nothing visible changed:** layout, shortcuts, look, theme, IPC signatures, return payloads, and event emissions are all unchanged.

## What changed

### 1. Async Tauri commands off the GTK thread (`rebuild/app/src-tauri/src/lib.rs`)
Marked the remaining synchronous vault and write commands with `#[tauri::command(async)]`:
- `open_vault`
- `create_vault`
- `write_note`
- `create_note`
- `create_folder`
- `rename_path`
- `delete_path`
- `write_config`

### 2. `Mutex<Inner>` → `RwLock<Inner>` at the state boundary (`lib.rs`, `watch.rs`)
- Changed `AppState.inner` from `std::sync::Mutex<Inner>` to `std::sync::RwLock<Inner>`.
- Added `read(&RwLock<T>) -> RwLockReadGuard<'_, T>` alongside `lock(&RwLock<T>) -> RwLockWriteGuard<'_, T>`.
- Split `with_vault` into:
  - `read_vault(&AppState, impl FnOnce(&vault::Vault) -> Result<T, String>)`: acquires a shared read guard (`RwLockReadGuard`) for all read-only commands (`list_files`, `read_note`, `read_file_bytes`, `read_config`, `read_foreign_config`, `search`, `link_index`, `backlinks`, `link_sources`, `frontmatter`, `tags`, `properties`, `search_notes`, `search_lines`, `search_match`). `last_vault` also uses `read(&state.inner)`.
  - `write_vault(&AppState, impl FnOnce(&mut vault::Vault) -> Result<T, String>)`: claims a FIFO ticket on `state.write_queue`, waits for its turn, and then takes an exclusive write guard (`RwLockWriteGuard`) for mutating commands (`write_note`, `set_property`, `write_file_bytes`, `create_note`, `create_folder`, `rename_path`, `delete_path`, `write_config`).
- Updated `install_vault` (`open_vault` / `create_vault`) to wait on a `WriteQueue` ticket before scanning disk, then briefly take the write lock to remember the vault and install `inner.vault`.
- Updated `watch::flush_changes` and `watch::tests` (`rebuild/app/src-tauri/src/watch.rs`) to accept `&std::sync::RwLock<Inner>` (with `try_write()` in the rescan contention test).

### 3. Per-vault FIFO write queue (`WriteQueue` / `WriteTicket` in `lib.rs`)
- Implemented using standard library primitives (`AtomicU64`, `Mutex<u64>`, `Condvar`) with zero new dependencies.
- Each write command calls `write_queue.enqueue()` upon entry to receive a monotonically increasing ticket number, waits on the `Condvar` until `turn == ticket`, acquires the `RwLock` write guard to run the mutation, drops the `RwLock` guard, and advances `turn` on drop (`Drop for WriteTicket`).
- `WriteQueue.turn` and `AppState.inner` are never held at the same time, avoiding any lock-order deadlock.

### 4. Leftover lock hold-time work (owned by other slices)
- **Index map rebuild batching under the write lock (owned by S4):** `Index::rebuild_maps` inside `vault.rs` / `index.rs` still rebuilds derived maps inside each mutation while holding the write guard; S4 owns `rebuild_maps` call sites, `apply` batching, `rename_path` rebuild count, and `entry_for`.
- **Incremental map updates / delta protocol (P2) & parallel scan (P3):** Full-clone payloads (`link_index`, `properties`, `tags`) and single-threaded `Vault::open` scanning remain as documented in `rebuild/RUST_PERF_PLAN.md` for P2/P3.

## How each regression test was proven to fail before and pass after

1. **`tests::write_10mb_stays_off_the_calling_thread`**
   - Extended the command list to require `#[tauri::command(async)]` on all 12 write/open/clipboard commands (`open_vault`, `create_vault`, `write_note`, `set_property`, `write_file_bytes`, `create_note`, `create_folder`, `rename_path`, `delete_path`, `write_config`, `read_clipboard_image`, `write_clipboard_image`).
   - **Before fix (`#[tauri::command]` on `open_vault` et al.):** Failed with:
     `open_vault must be an async command so it stays off the GTK thread: #[tauri::command]`
   - **After fix:** Passed (`ok`).

2. **`tests::reads_overlap_while_writes_stay_exclusive`**
   - Spawns two concurrent `read_vault` readers (`r1` and `r2`) where `r1` holds the read guard until `r2` enters `read_vault` and signals `r1`, plus a concurrent `write_vault` writer that must wait until `r1` releases its read guard, followed by 4 concurrent writers asserting `active_writers` never exceeds 1.
   - **Before fix (`read_vault` taking exclusive `lock(&state.inner)`):** Failed with:
     `second read was blocked by the first read: Timeout`
   - **After fix (`read_vault` taking shared `read(&state.inner)`):** Passed (`ok`).

3. **`tests::queued_writes_and_renames_stay_in_submission_order`**
   - Enqueues 4 tickets in submission order (`write-1`, `write-2`, `rename`, `write-moved`), spawns threads where earlier tickets sleep longer before calling `run` (simulating out-of-order async task wakeup), and asserts both execution order (`["write-1", "write-2", "rename", "write-moved"]`) and final file state (`Sub/Moved.md` has `"final"`, `Note.md` is gone).
   - **Before fix (`WriteTicket::wait` disabled):** Failed with:
     `assertion 'left == right' failed: left: ["rename", "write-moved", "write-2", "write-1"], right: ["write-1", "write-2", "rename", "write-moved"]`
   - **After fix (`WriteTicket::wait` active):** Passed (`ok`).

## Line changes, file sizes, and dependencies

- **Net line change by language:**
  - Rust (`.rs`): `+189 / -117` lines (net `+72` lines across 2 files)
  - Markdown (`rebuild/NOTES_S5-agy.md`): `+90` lines (notes file)
- **Net line change by file:**
  - `rebuild/app/src-tauri/src/lib.rs`: `+185 / -113` lines (net `+72`, from `721` to `793` lines)
  - `rebuild/app/src-tauri/src/watch.rs`: `+4 / -4` lines (net `0`, `542` lines)
  - `rebuild/NOTES_S5-agy.md`: `+90` lines (new file)
- **Files near 800 lines:**
  - Modified: `rebuild/app/src-tauri/src/lib.rs` is `793` lines (under the 800-line ceiling).
  - Pre-existing unmodified files in `src-tauri/src/`: `edit.rs` (`866` lines, owned by S3) and `vault.rs` (`864` lines, owned by S3/S4).
- **New dependencies:** None (`Cargo.toml` and `Cargo.lock` untouched).
