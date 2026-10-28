# S0-1: reads off the main thread and unlocked watcher rescans

Implemented on `rebuild/s0-1-codex`, 2026-10-27. Local commits only; nothing pushed.

## Changes

All eight requested read commands use `#[tauri::command(async)]`: `list_files`, `read_note`, `read_file_bytes`, `search`, `link_index`, `frontmatter`, `read_config`, and `last_vault`. Their argument/result shapes are unchanged. CONTRACT.md now states that read commands run off the main thread and separate replies may arrive in any order. Write commands and their filesystem operations remain synchronous and unchanged.

The watcher builds the replacement `Index` outside `AppState.inner`. Rather than replaying the expiring own-write suppression map, the live index records changed paths only while a rescan is in flight. This adds small hooks to the existing index mutation methods, without changing any write command. It covers saves, attachments, creates, folder creates, renames (both ends), and deletions. The old locked `Vault::rescan` was replaced, not retained alongside the new path.

## Lock and ordering reasoning for review

1. Under the existing mutex, start an empty path journal and create a unique rescan token; capture the root.
2. Release the mutex and build the full replacement index on the watcher thread. Commands can access the live index during this disk scan.
3. Reacquire the mutex. Accept the result only if its token still belongs to this vault. Reopening even the same root creates a different vault, so an old scan cannot overwrite it.
4. Take the journal and refresh those paths in the replacement from their current disk contents, removing stale subtrees first. This reconciles repeated saves, new parents, moves, and removals without depending on timestamps or the 500 ms echo-suppression lifetime.
5. Diff against the current live index and swap while still holding the mutex. A command cannot write between replay and swap. An app write already reflected in the live index does not become a spurious rescan change. Emit resulting external changes after releasing the lock.

A failed scan clears its journal/token and keeps the live index. The watcher processes queued external notifications after this flush, so external changes occurring too late for the scan can still be applied by the next batch.

Kept `Mutex`, rather than widening this step into `RwLock` conversion. Reads still serialize against one another and against writes while accessing vault state; result serialization happens after the command's vault lock is released, on Tauri's runtime. Synchronous writes can still wait briefly behind a read. Replay may read changed files/subtrees under the lock, and the diff/swap still hold it; the full-vault scan no longer does. This is not a claim that every possible source of UI delay is eliminated.

Writes are still executed synchronously by the main-thread IPC handler. A read dispatched after a completed write sees that write when it acquires the mutex. Separate reads, and reads sent before a write, have no response-order guarantee.

## Frontend audit

- `searchFacts`: promises are cached by term and match-case mode; `Promise.all` associates answers with their input terms. Clearing caches does not let an old answer repopulate them. Search and graph rendering already have generation guards. No production change needed here.
- `vaultTags`: the five searches use positional `Promise.all`, then await the frontmatter query. An old rejected request could clear a newer cached promise after invalidation; cleanup now checks promise identity.
- `propertyIndex`: shares exactly one in-flight read. It records the requested mtimes, so a note changed during the request is stale on the next read. No production change needed here.
- Vault file and link refreshes now accept only the latest requested refresh, preventing an older answer from replacing newer lists/links.
- Note reloads now reject superseded replies and preserve local typing that happened during a read.
- Ordinary note navigation now honors the latest request for its source pane, including a later attachment open or tab selection. The source pane is captured before loading. Explicit requests for new tabs/panes remain independent opens.
- Embed cache rejection cleanup checks promise identity. Note embed rendering checks its generation for both success and failure. Image holders already check identity and release their own URLs.
- Backlink context reads now belong to a particular cache instance; a refresh replaces it, so old reads cannot repopulate the current context cache or trigger its redraw. Unlinked search already has a request guard.
- Settings reads are associated by `Promise.all` position and awaited during startup. Bases updates and menu read/write sequences are serialized. Remaining path-specific reads are awaited by their operations; side-view and canvas rendering already guard stale results.

Added eight frontend regression tests covering reordered file/link replies, reloads, typing during a reload, search cache invalidation, late tag failure, serialized property reads, and superseded ordinary navigation.

## Rust regressions

Three new watcher tests pass:

- The injectable scan hook holds a stale replacement, acquires the released state mutex, and performs app mutations before the scan returns for installation. It also expires the own-write suppression entries. The final index retains saved/created notes, new parents, attachments, folders, moves and removals, with current search text, frontmatter and links. An unrelated external create still produces its event.
- Reopening the same root during a scan rejects the stale replacement.
- A failed scan retains app writes and permits the next rescan.

The hook injects mutations after the replacement has read the old contents but before it is returned for swapping: the deterministic worst case for losing an intervening write. `try_lock` inside that hook verifies that scanning does not hold the state lock.

## Files and line counts

Implementation diff against `e643f9b`: **386 added, 50 removed, 13 files** (excluding this notes file).

- `app/src-tauri/src/lib.rs`: +8 / -8.
- `app/src-tauri/src/index.rs`: +23 / -1.
- `app/src-tauri/src/vault.rs`: +25 / -3.
- `app/src-tauri/src/watch.rs`: +116 / -19, including the three regression tests.
- `app/src/vault.ts`: +10 / -2.
- `app/src/noteEditors.ts`: +8 / -1.
- `app/src/workspace.ts`: +9 / -3.
- `app/src/editorHost.ts`: +1 / -1.
- `app/src/editor/embeds.ts`: +6 / -4.
- `app/src/shell/vaultTags.ts`: +10 / -5.
- `app/src/shell/backlinksView.ts`: +6 / -3.
- `app/src/readOrdering.test.ts`: +163 / -0.
- `CONTRACT.md`: +1 / -0.

Implementation commits: `6656dc0`, `79206d8`, `174cc00`.

## Validation

- `rebuild/app`: `npm run build` passed.
- `rebuild/app`: final complete `npm test` passed: four browser-discovery tests, 308 Vitest tests across 54 files, every browser script (including permanent geometry/real-pointer tests), and `posttest` (`test-bases-config.mjs`).
- `rebuild/app`: `npm run audit:offline` passed on final source, including its build and checks of 164 production source files, bundle, CSP, capabilities and dependencies.
- `rebuild/app/src-tauri`: `cargo build --offline` passed.
- `rebuild/app/src-tauri`: `cargo test --offline` passed, 40 tests plus binary/doc-test targets.
- `git diff --check` passed. Browser-generated screenshots, canvas/Base examples and timing fixtures were restored. No dependencies, crates, permissions, CSS geometry or menu animations changed.

Earlier attempts hit two intermittent browser assertions: the drag script's Reading-mode moved-note fold assertion (passed its isolated rerun), and geometry's menu frame ceiling (20.7 ms versus 20 ms; passed the rerun). The final full run passed both without weakening any assertions. One intermediate run was deliberately stopped to include the final embed/context guards before the final full run.

## Remaining verification / decisions

The plan's native Tauri 5,000-note typing-with-search check was **not performed** in this headless job. Browser tests exercise the mock backend, not GTK IPC. Command placement is verified by the requested Tauri macro annotations and successful native compilation; native interactive latency remains unmeasured. A scratch-vault native check is the remaining manual follow-up before claiming a responsiveness number. No real vault was opened.

No product-behavior decision is needed for this step. Retaining the mutex is deliberate; consider reader/writer locking only if later native measurements justify the wider change. The mutation journal is deliberately independent of own-write suppression so a slow scan cannot forget intervening app mutations.
