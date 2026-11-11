# S5 Notes (`rebuild/s5-agy`)

## In plain words

Opening or creating a vault (`open_vault`, `create_vault`), saving a note (`write_note`), creating a note or folder (`create_note`, `create_folder`), renaming or deleting a path (`rename_path`, `delete_path`), and saving vault settings (`write_config`) no longer run on the GTK main thread. They are dispatched as `#[tauri::command(async)]` commands and execute on a dedicated serialized `"vault-write"` worker thread while awaiting a non-blocking `Reply<T>` future, so disk `fsync`s, vault directory scans, and write-lock waits neither freeze the GTK main thread nor block Tauri's Tokio async worker threads.

In addition, the vault state lock is now an `RwLock` instead of a single `Mutex`, so read commands (such as `search_notes`, `link_index`, `read_note`, and `list_files`) share the lock and overlap with one another instead of queuing behind each other. Write commands reserve a monotonic FIFO ticket synchronously at IPC ingress (`wrap_handler` around `tauri::generate_handler![...]` before `respond_async_serialized` spawns the async task) and claim that ticket via `impl CommandArg for WriteTicket` (`take_ingress`), so queued saves, creates, and renames always execute in exact IPC submission order even if Tokio polls their spawned futures out of order.

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
  - `write_vault(&AppState, WriteTicket, impl FnOnce(&mut vault::Vault) -> Result<T, String>) -> Reply<Result<T, String>>`: submits the mutating closure onto the dedicated `"vault-write"` worker thread under its pre-reserved FIFO ticket, where the worker takes an exclusive write guard (`RwLockWriteGuard`) for mutating commands (`write_note`, `set_property`, `write_file_bytes`, `create_note`, `create_folder`, `rename_path`, `delete_path`, `write_config`) and wakes the non-blocking `Reply` future when done.
- Updated `install_vault` (`open_vault` / `create_vault`) to run `Vault::open` and `config::remember` on the `"vault-write"` thread *before* acquiring `lock(&inner)`, keeping the `RwLock` read lock free during vault scans and only taking the write lock briefly to swap `inner.vault`.
- Updated `watch::flush_changes` and `watch::tests` (`rebuild/app/src-tauri/src/watch.rs`) to accept `&std::sync::RwLock<Inner>` (with `try_write()` in the rescan contention test).

### 3. Synchronous IPC ingress reservation + dedicated `"vault-write"` worker (`WriteQueue` / `WriteTicket` / `Reply` in `lib.rs`)
- Implemented using standard library primitives (`AtomicU64`, `Mutex`, `Condvar`, `BTreeMap`, `std::task::Waker`) with zero new dependencies.
- **Synchronous IPC ingress ordering (P1 fix):** `wrap_handler` wraps `tauri::generate_handler![...]` and calls `state.write_queue.reserve_ingress(invoke_key(&invoke.message))` synchronously on the IPC caller thread before `#[tauri::command(async)]` (`respond_async_serialized`) calls `tauri::async_runtime::spawn`. When the spawned task runs, `WriteTicket::from_command` (`impl CommandArg for WriteTicket`, the first parameter of each write command) claims the pre-reserved ticket via `take_ingress`. If a write command fails before `ticket.submit(...)` (e.g., invalid arguments or headers in `write_file_bytes`), `Drop for WriteTicket` records `Slot::Skip` for that ticket so the worker immediately advances past it without stalling later writes.
- **Non-blocking async runtime integration (P2 fix):** `WriteQueue::default()` spawns a single `"vault-write"` background thread (`worker_loop`) that drains `BTreeMap<u64, Slot>` in strict monotonic `turn` order (`0, 1, 2, ...`). `WriteTicket::submit` enqueues a `Slot::Job` and returns a `Reply<T>` (`Future` backed by `Option<Waker>`), so Tokio worker threads never block on queue `Condvar` waits, `RwLock` write-lock contention, `Vault::open` scans, or disk `fsync` I/O.

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
   - Reserves 4 ingress tickets synchronously in dispatch order (`write-1`, `write-2`, `rename`, `write-moved`) before spawning tasks on `tauri::async_runtime`, delays earlier tasks *before* they reach `take_ingress` / `write_vault` (simulating out-of-order first poll of `#[tauri::command(async)]` futures), and asserts both execution order (`["write-1", "write-2", "rename", "write-moved"]`) and final file state (`Sub/Moved.md` has `"final"`, `Note.md` is gone).
   - **Before fix (on `8c76624`, where tickets were assigned inside `write_vault` after async spawn/poll):** Failed with:
     `assertion 'left == right' failed: left: ["rename", "write-moved", "write-2", "write-1"], right: ["write-1", "write-2", "rename", "write-moved"]`
   - **After fix (synchronous ingress reservation + `"vault-write"` worker):** Passed (`ok`).

4. **`tests::queued_writes_do_not_starve_async_reads_and_ipc`**
   - Starts a slow `install_vault` operation and queues `available_parallelism() * 2` writes behind it on `tauri::async_runtime`, then spawns a concurrent `read_vault` task and an unrelated async IPC task (`FrameOrigins::allow`) and asserts both finish within 300ms while the slow operation is still blocked.
   - **Before fix (on `8c76624`, where `WriteTicket::wait` blocked Tokio worker threads inside async tasks):** Failed with:
     `queued writes starved async read while read lock was free: Timeout`
   - **After fix (non-blocking `Reply<T>` future + `"vault-write"` thread + `install_vault` scanning outside the `RwLock` write lock):** Passed (`ok`).

## Line changes, file sizes, and dependencies

- **Net line change by language (vs. `46b072f`):**
  - Rust (`.rs`): `+395 / -319` lines (net `+76` lines across 2 files; `+283 / -279`, net `+4` vs. `8c76624`)
  - Markdown (`rebuild/NOTES_S5-agy.md`): `+90` lines (notes file)
- **Net line change by file (vs. `46b072f`):**
  - `rebuild/app/src-tauri/src/lib.rs`: `+391 / -315` lines (net `+76`, from `721` to `797` lines)
  - `rebuild/app/src-tauri/src/watch.rs`: `+4 / -4` lines (net `0`, `542` lines)
  - `rebuild/NOTES_S5-agy.md`: `+90` lines (new file)
- **Files near 800 lines:**
  - Modified: `rebuild/app/src-tauri/src/lib.rs` is `797` lines (under the 800-line ceiling).
  - Pre-existing unmodified files in `src-tauri/src/`: `edit.rs` (`866` lines, owned by S3) and `vault.rs` (`864` lines, owned by S3/S4).
- **New dependencies:** None (`Cargo.toml` and `Cargo.lock` untouched).
