# S5 Notes (`rebuild/s5-agy`)

## In plain words

Opening or creating a vault (`open_vault`, `create_vault`), saving a note (`write_note`), creating a note or folder (`create_note`, `create_folder`), renaming or deleting a path (`rename_path`, `delete_path`), and saving vault settings (`write_config`) no longer run on the GTK main thread. They are dispatched as `#[tauri::command(async)]` commands and execute on a dedicated serialized `"vault-write"` worker thread while awaiting a non-blocking `Reply<T>` future, so disk `fsync`s, vault directory scans, and write-lock waits neither freeze the GTK main thread nor block Tauri's Tokio async worker threads.

In addition, the vault state lock is now an `RwLock` instead of a single `Mutex`, so read commands (such as `search_notes`, `link_index`, `read_note`, and `list_files`) share the lock and overlap with one another instead of queuing behind each other. Write commands reserve a monotonic FIFO ticket synchronously at IPC ingress (`wrap_handler` calls `WriteQueue::arm_accepted` before `respond_async_serialized` spawns the task) and move an `IngressLease` into that future. The future claims the ticket with `take_ingress` on its first poll, then parses the remaining arguments and calls the command, which submits via `WriteTicket::submit`. Queued saves, creates, and renames still execute in exact IPC submission order.

On app exit (`RunEvent::ExitRequested` / `RunEvent::Exit` / `Drop`), the queue seals new ingress and skips a slot only when its owner is gone: a bare unclaimed `Slot::Reserved` with no live lease, a dropped `IngressLease` before `take_ingress`, or a dropped `WriteTicket` that was claimed and never submitted. A save accepted before shutdown is waited out and written. Nothing is skipped because a timer fired. Accepted `Slot::Job` entries and the currently running job still drain without holding the vault or queue locks or freezing GTK, and the `"vault-write"` worker is joined before the process is allowed to exit. The drain-spawn fallback is unchanged: if spawning `"vault-write-drain"` fails, the caller returns immediately and the worker requests exit after the drain.

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
- **Synchronous IPC ingress ordering:** `wrap_handler` wraps `tauri::generate_handler![...]`. For a write command while the queue is open it calls `WriteQueue::arm_accepted` on the IPC caller thread, which allocates `ticket = w.next_ticket`, records `Slot::Pending`, and returns an `IngressLease`. That lease is moved into the future passed to `respond_async_serialized` (`write_dispatch::run` in `write_dispatch.rs`). Dropping the future before `take_ingress` drops the lease and skips the slot. The future calls `take_ingress` at the start of its first poll, parses the remaining arguments with the same `CommandArg` keys the macro would use, and calls the existing command function, which submits via `WriteTicket::submit` (`Slot::Pending -> Slot::Job`). If the queue is already closing, `arm_accepted` returns `None` and the generated `#[tauri::command(async)]` handler still runs so the caller gets `"vault write queue is closed"`. The `#[tauri::command(async)]` attributes stay, so `write_10mb_stays_off_the_calling_thread` still sees them; they are not the open-queue execution path. A command that fails before `ticket.submit(...)` drops the `WriteTicket` and the slot becomes `Slot::Skip`. Test-only `dispatch_ingress` arms a `Slot::Reserved` lease and promotes it to `Slot::Pending` when the handler returns true, so a regression can hold the lease across a delay before `take_ingress`.
- **Non-blocking async runtime integration:** `WriteQueue::default()` spawns a single `"vault-write"` thread (`worker_loop`) and retains its `JoinHandle<()>` in `QueueShared.handle`. `WriteTicket::submit` transitions the ticket's slot to `Slot::Job` (catching any panic to always settle the reply) and returns a `Reply<Result<T, String>>` (`Future` backed by `Option<Waker>`), so Tokio worker threads never block on queue waits, `RwLock` write-lock contention, `Vault::open` scans, or disk `fsync` I/O.
- **Explicit queue drain and shutdown handshake:**
  - `WriteQueue::begin_shutdown` sets `w.closing = true` (sealing new ingress so post-shutdown requests receive `ticket: None` and resolve to `Err("vault write queue is closed")`) and skips only `Slot::Reserved` entries whose owner flag is not set (a bare `reserve_ingress` with no live lease). `Slot::Pending` is never skipped because a timer fired. The worker condvar-waits while the slot is `Reserved` or `Pending`. A dropped `IngressLease` or `WriteTicket` is what turns an abandoned slot into `Slot::Skip`. A save accepted before shutdown is written before exit, or exit stays withheld until that owner submits or drops.
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

5. **`tests::queue_exit::shutdown_drains_accepted_writes_cancels_unclaimed_tickets_and_coordinates_exit`**
   - Holds `"vault-write"` in a slow `install_vault` operation. The pre-shutdown save (key 11) keeps its `IngressLease` across the 30ms delay, then calls `take_ingress` + `write_vault`. A rename (key 12) is queued behind it. A bare `reserve_ingress` (key 13) and a dropped lease (key 14) are the only slots shutdown may skip. Exit is requested via `on_exit_requested`. Asserts that `prevent_exit` is called immediately without blocking, post-shutdown ingress (key 16) and the bare reservation (key 13) are rejected with `Err("vault write queue is closed")`, the delayed save and rename both run in FIFO order (`Sub/Moved.md` has `"saved-before-quit"`), the dropped lease does not hang shutdown, the worker `JoinHandle` is joined, and exit is requested.
   - **Before fix (on `8bfa018`, where `begin_shutdown` cancelled every `Slot::Reserved`, including a pre-shutdown handler that had not yet called `take_ingress`):** Failed with:
     `assertion 'left == right' failed: left: "initial", right: "saved-before-quit"`
   - **After fix (live lease or ticket withholds exit; only an ownerless reservation is skipped):** Passed (`ok`). The 30ms delay does not cover the old 120ms expiry. Tests 8 and 9 do.

6. **`tests::queue_exit::exit_drain_spawn_failure_falls_back_without_blocking_or_losing_exit`**
   - Holds `"vault-write"` in a slow operation with a queued save behind it, injects a `"vault-write-drain"` thread-spawn failure (`fail_drain_spawn = true`), and calls `on_exit_requested(Some(7), ...)` on a separate thread. Asserts that `on_exit_requested` returns `false` within 50ms without blocking the caller, calls `prevent_exit`, and once the slow operation releases, drains the queued save (`"saved-via-fallback"`) and invokes the `request_exit(7)` callback via `worker_loop`'s fallback path. The leases stay held until after `take_ingress`.
   - **Before fix (on `8bfa018`, where thread-spawn failure in `on_exit_requested` called `shutdown_shared` synchronously and dropped the consumed `request_exit` closure):** Failed with:
     `on_exit_requested blocked the calling thread when drain spawn failed: Timeout`
   - **After fix (`w.pending_exit` fallback in `worker_loop`):** Passed (`ok`).

7. **`tests::queue_exit::ingress_handler_wiring_malformed_requests_and_errors_do_not_stall_queue`**
   - Exercises `dispatch_ingress`, overwritten/cancelled reservations, unreserved non-zero keys, dropped `WriteTicket`s from simulated `CommandArg` deserialization failures, malformed `write_file_bytes` requests (`enqueue_write_file_bytes` with missing `x-grove-path` header or JSON body), and ordinary `Vault` errors (`../escape.md`), verifying each settles its reply and subsequent writes succeed. Each live save holds its lease until after `take_ingress`.
   - **Before fix (on `ae04faa`):** Hung waiting for the leaked ticket and accepted unreserved keys.
   - **After fix:** Passed (`ok`).

8. **`tests::queue_exit::slow_pending_save_blocks_exit_until_submit_then_rename_keeps_bytes`**
   - A valid `write_note` handler is gated before `take_ingress`. Exit is requested, a later `rename_path` is already queued, and the gate stays closed for 250ms (past the old 120ms expiry). Exit must stay withheld until the gate opens and the save submits. Final path is `Sub/Moved.md` and the bytes are `"saved-before-quit"`.
   - **Before fix (on `f1902ac`, `PENDING_SHUTDOWN_WAIT` = 120ms turned every `Reserved`/`Pending` slot into `Skip`):** Failed with:
     `exit proceeded while a pre-shutdown save was still unclaimed`
   - **After fix:** Passed (`ok`).

9. **`tests::queue_exit::claimed_ticket_delayed_past_shutdown_still_writes_before_rename`**
   - The ticket is claimed with `take_ingress`, the lease is dropped, and `submit` is withheld for 250ms after exit is requested, with a later rename already queued. Exit must stay withheld until that submit. Final path and bytes match test 8.
   - **Before fix (on `f1902ac`):** Failed with:
     `exit proceeded while a claimed pre-shutdown save had not submitted`
   - **After fix:** Passed (`ok`).

10. **`tests::queue_exit::abandoned_reservation_does_not_withhold_exit`**
    - `dispatch_ingress` accepts a write and the lease is dropped before `take_ingress`. Exit must proceed (either `on_exit_requested` returns true because the queue is already idle, or the exit callback arrives within 80ms). The file stays `"initial"` and the worker is terminated.
    - **Before fix (on `f1902ac`, the worker waited out `PENDING_SHUTDOWN_WAIT` before skipping the slot):** Failed with:
      `abandoned reservation withheld exit: Timeout`
    - **After fix:** Passed (`ok`).

The three new tests were compiled against `f1902ac` before this change: 0 passed, 3 failed, 0.12s, with the messages above. After the change, `cargo test --offline` from `rebuild/app/src-tauri` (`-- --test-threads=8`) passed: 119 passed, 0 failed, 4 ignored, finished in 0.56s. `cargo build --offline --lib` reported no warnings.

## Line changes, file sizes, and dependencies

- **Net line change by language (vs. `46b072f`):**
  - Rust (`.rs`): `+1390 / -322` lines (net `+1068` across 5 files)
  - Markdown (`rebuild/NOTES_S5-agy.md`): `+134` lines (this file)
- **Net line change by file (vs. `46b072f`):**
  - `rebuild/app/src-tauri/src/lib.rs`: `+286 / -318` lines (net `-32`, from `721` to `689` lines). The shutdown and ingress tests moved to `src/tests/queue_exit.rs`.
  - `rebuild/app/src-tauri/src/queue.rs`: `+571 / -0` lines (new module, `571` lines)
  - `rebuild/app/src-tauri/src/write_dispatch.rs`: `+119 / -0` lines (new module, `119` lines)
  - `rebuild/app/src-tauri/src/tests/queue_exit.rs`: `+410 / -0` lines (new tests, `410` lines)
  - `rebuild/app/src-tauri/src/watch.rs`: `+4 / -4` lines (net `0`, `542` lines)
  - `rebuild/NOTES_S5-agy.md`: `+134` lines (new file, `134` lines)
- **Delta vs. `f1902ac` (this review fix):**
  - `lib.rs`: `+15 / -120` (tests moved out; `wrap_handler` now arms a lease)
  - `queue.rs`: `+143 / -86` (lease ownership; the 120ms skip is gone)
  - `write_dispatch.rs`: `+119 / -0`
  - `src/tests/queue_exit.rs`: `+410 / -0`
  - `NOTES_S5-agy.md`: rewritten shutdown and proof sections
- **Files near 800 lines:**
  - Owned by this change: `lib.rs` (`689`), `queue.rs` (`571`), `write_dispatch.rs` (`119`), `tests/queue_exit.rs` (`410`), `watch.rs` (`542`). All are under 800.
  - Pre-existing unmodified files: `edit.rs` (`866`, owned by S3) and `vault.rs` (`864`, owned by S3/S4).
- **New dependencies:** None (`Cargo.toml` and `Cargo.lock` untouched).
