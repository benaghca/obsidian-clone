# S5 Notes (`rebuild/s5-agy`)

## In plain words

Opening or creating a vault (`open_vault`, `create_vault`), saving a note (`write_note`), creating a note or folder (`create_note`, `create_folder`), renaming or deleting a path (`rename_path`, `delete_path`), and saving vault settings (`write_config`) no longer run on the GTK main thread. They are dispatched as `#[tauri::command(async)]` commands and execute on a dedicated serialized `"vault-write"` worker thread while awaiting a non-blocking `Reply<T>` future, so disk `fsync`s, vault directory scans, and write-lock waits neither freeze the GTK main thread nor block Tauri's Tokio async worker threads.

In addition, the vault state lock is now an `RwLock` instead of a single `Mutex`, so read commands (such as `search_notes`, `link_index`, `read_note`, and `list_files`) share the lock and overlap with one another instead of queuing behind each other. Write commands reserve a monotonic FIFO ticket synchronously at IPC ingress (`wrap_handler` around `tauri::generate_handler![...]` before `respond_async_serialized` spawns the async task) and claim that ticket via `impl CommandArg for WriteTicket` (`take_ingress`), so queued saves, creates, and renames always execute in exact IPC submission order even if Tokio polls their spawned futures out of order.

On app exit (`RunEvent::ExitRequested` / `RunEvent::Exit` / `Drop`), the queue seals new ingress, cancels bare unclaimed `Slot::Reserved` entries immediately, keeps pre-shutdown `Slot::Pending` requests across `begin_shutdown` until their async handlers call `take_ingress` + `submit` or fail (`Drop for WriteTicket` -> `Slot::Skip`, bounded by `PENDING_SHUTDOWN_WAIT` so a dead handler cannot hang exit forever), drains all accepted `Slot::Job` entries and the currently running job without holding the vault/queue locks or freezing GTK, and joins the `"vault-write"` worker thread before the process is allowed to exit.

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
- Updated `watch::flush_changes` and `watch::tests` (`rebuild/app/src-tauri/src/watch.rs`) to accept `&std::sync::RwLock<Inner>` (with `try_write()` in the rescan contention test). S4's batch guard in `vault.rs` / `index.rs` is untouched.

### 3. Synchronous IPC ingress reservation, dedicated `"vault-write"` worker, and shutdown drain (`queue.rs`, `lib.rs`)
- Implemented in `rebuild/app/src-tauri/src/queue.rs` using standard library primitives (`Mutex`, `Condvar`, `BTreeMap`, `JoinHandle`, `std::task::Waker`) with zero new dependencies.
- **Synchronous IPC ingress ordering:** `wrap_handler` wraps `tauri::generate_handler![...]` and calls `WriteQueue::dispatch_ingress_shared` synchronously on the IPC caller thread before `#[tauri::command(async)]` (`respond_async_serialized`) spawns the async task. `reserve_ingress_shared` allocates `ticket = w.next_ticket` and records `Slot::Reserved` in `w.slots` under `Mutex<WorkerState>` so `w.slots` always covers `w.turn .. w.next_ticket` without gaps. Once `handler(invoke)` accepts the invoke and returns `true`, `activate_ingress_shared` transitions the slot to `Slot::Pending`. When the spawned task runs on Tauri's async runtime, `WriteTicket::from_command` (`impl CommandArg for WriteTicket`, the first parameter of each write command) claims the ticket via `take_ingress` and calls `WriteTicket::submit` (`Slot::Pending -> Slot::Job`). If a command is unhandled (`!handled`) or fails before `ticket.submit(...)` (e.g., invalid arguments or headers in `enqueue_write_file_bytes`), `cancel_ingress_shared` or `Drop for WriteTicket` transitions `Slot::Reserved | Slot::Pending -> Slot::Skip` so the worker immediately advances past it without stalling later writes.
- **Non-blocking async runtime integration:** `WriteQueue::default()` spawns a single `"vault-write"` thread (`worker_loop`) and retains its `JoinHandle<()>` in `QueueShared.handle`. `WriteTicket::submit` transitions the ticket's slot to `Slot::Job` (catching any panic to always settle the reply) and returns a `Reply<Result<T, String>>` (`Future` backed by `Option<Waker>`), so Tokio worker threads never block on queue waits, `RwLock` write-lock contention, `Vault::open` scans, or disk `fsync` I/O.
- **Explicit queue drain and shutdown handshake:**
  - `WriteQueue::begin_shutdown` sets `w.closing = true` (sealing new ingress so post-shutdown requests receive `ticket: None` and resolve to `Err("vault write queue is closed")`) and cancels bare unclaimed `Slot::Reserved` entries immediately, while keeping pre-shutdown `Slot::Pending` entries in `w.ingress` and `w.slots` so an in-flight save accepted at IPC ingress whose async handler has not yet reached `take_ingress` / `submit` can still claim its ticket, submit its `Slot::Job`, and drain to disk before exit. In `worker_loop`, waiting on `Slot::Pending` during shutdown is bounded by `PENDING_SHUTDOWN_WAIT` (`120ms`, reset per turn) so a dead handler that never calls `take_ingress` / `submit` is expired to `Slot::Skip` and cannot hang exit forever.
  - `WriteQueue::shutdown` calls `begin_shutdown` and joins the `"vault-write"` `JoinHandle` without holding the vault `RwLock` or `Mutex<WorkerState>` (skipping self-join if called from the worker thread).
  - In `lib.rs::run()`, `.build(tauri::generate_context!()).run(...)` coordinates with S1's window-close flush:
    - On `RunEvent::ExitRequested`: `on_exit_requested` calls `begin_shutdown`. If `"vault-write"` is still running a job or has pending/queued slots, it records `w.pending_exit = Some((exit_code, req_box))`, calls `api.prevent_exit()` (so GTK is never frozen), and spawns `"vault-write-drain"`, which waits for `shutdown()` and invokes `pending_exit`. If spawning `"vault-write-drain"` fails, `on_exit_requested` clears `w.drain_thread_active` and returns `false` immediately without blocking the caller; `worker_loop` then invokes `w.pending_exit` directly as soon as the queue finishes draining (or `on_exit_requested` invokes it immediately if `w.drained` already became `true` concurrently).
    - On `RunEvent::Exit` and `Drop for WriteQueue`: calls `shutdown()` so no exit path can reach `std::process::exit` before accepted writes have finished and the worker thread has been joined.

### 4. Leftover lock hold-time work (owned by other slices)
- **Index map rebuild batching under the write lock (owned by S4):** S4 owns `rebuild_maps` call sites, `apply` batching, `rename_path` rebuild count, and `entry_for` in `vault.rs` / `index.rs`.
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

5. **`tests::shutdown_drains_accepted_writes_cancels_unclaimed_tickets_and_coordinates_exit`**
   - Holds `"vault-write"` in a slow `install_vault` operation, dispatches a valid pre-shutdown save (`write_note`, key 11) whose async task is delayed 30ms before calling `take_ingress` + `write_vault`, queues a `rename_path` (key 12) behind it, adds both a bare `reserve_ingress` reservation (key 13) and a dead `dispatch_ingress` handler reservation (key 14), and requests exit via `on_exit_requested`. Asserts that `prevent_exit` is called immediately without blocking, post-shutdown ingress (key 16) and bare reservations (key 13) are rejected immediately with `Err("vault write queue is closed")`, the delayed pre-shutdown save (key 11) and queued rename (key 12) both execute in FIFO order (`Sub/Moved.md` on disk has `"saved-before-quit"`), the dead handler reservation (key 14) expires without hanging shutdown, the worker `JoinHandle` is joined, and exit is requested.
   - **Before fix (on `8bfa018`, where `begin_shutdown` immediately cancelled all `Slot::Reserved` entries including pre-shutdown `dispatch_ingress` handlers that had not yet run `take_ingress`):** Failed with:
     `assertion 'left == right' failed: left: "initial", right: "saved-before-quit"`
   - **After fix (`Slot::Pending` preserved across `begin_shutdown` with bounded `PENDING_SHUTDOWN_WAIT`):** Passed (`ok`).

6. **`tests::exit_drain_spawn_failure_falls_back_without_blocking_or_losing_exit`**
   - Holds `"vault-write"` in a slow operation with a queued save behind it, injects a `"vault-write-drain"` thread-spawn failure (`fail_drain_spawn = true`), and calls `on_exit_requested(Some(7), ...)` on a separate thread. Asserts that `on_exit_requested` returns `false` within 50ms without blocking the caller, calls `prevent_exit`, and once the slow operation releases, drains the queued save (`"saved-via-fallback"`) and invokes the `request_exit(7)` callback via `worker_loop`'s fallback path.
   - **Before fix (on `8bfa018`, where thread-spawn failure in `on_exit_requested` called `shutdown_shared` synchronously and dropped the consumed `request_exit` closure):** Failed with:
     `on_exit_requested blocked the calling thread when drain spawn failed: Timeout`
   - **After fix (`w.pending_exit` fallback in `worker_loop`):** Passed (`ok`).

7. **`tests::ingress_handler_wiring_malformed_requests_and_errors_do_not_stall_queue`**
   - Exercises `dispatch_ingress`, overwritten/cancelled reservations, unreserved non-zero keys, dropped `WriteTicket`s from simulated `CommandArg` deserialization failures, malformed `write_file_bytes` requests (`enqueue_write_file_bytes` with missing `x-grove-path` header or JSON body), and ordinary `Vault` errors (`../escape.md`), verifying each settles its reply and subsequent writes succeed.
   - **Before fix (on `ae04faa`):** Hung waiting for the leaked ticket and accepted unreserved keys.
   - **After fix:** Passed (`ok`).

## Line changes, file sizes, and dependencies

- **Net line change by language (vs. `46b072f`):**
  - Rust (`.rs`): `+909 / -322` lines (net `+587` lines across 3 files)
  - Markdown (`rebuild/NOTES_S5-agy.md`): `+108` lines (notes file)
- **Net line change by file (vs. `46b072f`):**
  - `rebuild/app/src-tauri/src/lib.rs`: `+391 / -318` lines (net `+73`, from `721` to `794` lines)
  - `rebuild/app/src-tauri/src/queue.rs`: `+514 / -0` lines (new module, `514` lines)
  - `rebuild/app/src-tauri/src/watch.rs`: `+4 / -4` lines (net `0`, `542` lines)
  - `rebuild/NOTES_S5-agy.md`: `+108` lines (new file)
- **Files near 800 lines:**
  - Modified/added: `rebuild/app/src-tauri/src/lib.rs` (`794` lines), `rebuild/app/src-tauri/src/queue.rs` (`514` lines), `rebuild/app/src-tauri/src/watch.rs` (`542` lines) — all strictly under the 800-line ceiling.
  - Pre-existing unmodified files in `src-tauri/src/`: `edit.rs` (`866` lines, owned by S3) and `vault.rs` (`864` lines, owned by S3/S4).
- **New dependencies:** None (`Cargo.toml` and `Cargo.lock` untouched).
