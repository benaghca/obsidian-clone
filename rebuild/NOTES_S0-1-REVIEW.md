# S0-1 review

Reviewed `git diff rebuild/n-claude-a..rebuild/s0-1-codex` (through `58567f2`) on `rebuild/s0-1-reviewed`. Step 0.1 moves the eight read commands off the main thread and builds a watcher rescan outside `AppState.inner`. This review looked for lost writes during a scan, frontend dependence on reply order, write-path behavior changes, and locks held across awaits or taken in an order that can deadlock.

No Rust source was changed. Frontend fixes are in `3ac487b`. Nothing was pushed.

## What was checked

### Rescan does not drop writes that happen during the scan

`watch.rs` `flush_changes` (lines 112–140) still coalesces, normalizes, and applies a batch under the mutex when the batch does not need a rescan. When it does, `Vault::begin_rescan` (`vault.rs` 276–280) stores an `Arc` token and an empty path journal, the guard is dropped, and `Index::scan` runs outside the lock (`watch.rs` 132–133). `finish_rescan` (`vault.rs` 285–318) runs only after the mutex is taken again.

- The token is compared with `Arc::ptr_eq`. Reopening a vault, including at the same root, replaces the token, so a stale scan cannot swap in. Covered by `rescan_does_not_replace_a_reopened_vault_even_at_the_same_root` (`watch.rs` 379).
- A failed scan clears the token and the journal and leaves the live index in place (`vault.rs` 289–292). Covered by `failed_rescan_keeps_the_live_index_and_allows_the_next_rescan` (`watch.rs` 394).
- Paths mutated while the scan runs are recorded only when `rescan_changes` is `Some` (`index.rs` `changed_during_rescan`, lines 268–271), from `remove_tree` (275), `relocate` (287–288), `refresh_path` (319), and `upsert_note` (341). Replay walks that set in order, so a parent is refreshed before a child: `remove_tree` then `refresh_path` on the replacement index (`vault.rs` 294–297). The stamp diff and the swap happen before the guard is released (`vault.rs` 298–318), so a command cannot write between replay and swap.
- The regression `rescan_keeps_app_mutations_even_after_own_write_suppression_expires` (`watch.rs` 336) injects the writes from the scan hook, uses `try_lock` to show the state mutex is not held, expires the 500 ms own-write map, and still keeps the mutations. An external create in that window is still emitted.
- The watcher thread does not overlap flushes. Events that arrive during the scan stay on the channel and are applied by the next flush. `vault-changed` is emitted only after `flush_changes` returns (`watch.rs` 100–108), which is after the lock is released.

The journal is independent of own-write suppression. That matches the step: re-applying the own-write list was only an example of how to keep those paths.

### Locks

There is one mutex, `AppState.inner`. `lock` (`lib.rs` 43) recovers from poison. The eight reads are synchronous functions marked `#[tauri::command(async)]` (`lib.rs` 160, 166, 171, 177, 263, 274, 279, 286): `last_vault`, `list_files`, `read_note`, `read_file_bytes`, `read_config`, `search`, `link_index`, `frontmatter`. Tauri runs that body on a worker. The body does not `.await`. `with_vault` (`lib.rs` 122–128) holds the guard for the callback, including the file read inside `read_note`, and drops it before the runtime serializes the reply.

Nothing waits on the runtime while holding the mutex. `open_note_window` is async and does not take this mutex. Writes, reads, and the watcher all take the same mutex, so there is no lock-order inversion and no cycle that can deadlock. `RwLock` was optional in the plan and was not taken. Reads still wait on each other and on writes for the duration of the vault access. A write can wait behind one in-flight read. That is the behavior described in `NOTES_S0-1.md`, not a defect in this step.

### Write commands

Write commands are still plain `#[tauri::command]` handlers on the main thread: `open_vault` (144), `create_vault` (154), `write_note` (185), `write_file_bytes` (207), `create_note` (233), `create_folder` (242), `rename_path` (247), `delete_path` (253), `write_config` (269). Their filesystem work was not edited. The journal hook does nothing when no rescan is in flight. A read dispatched after a completed write sees that write when it acquires the mutex. `create_note` still does not call `mark_own`; that predates this step.

### Reply order already handled on the branch

`CONTRACT.md` line 13 says read replies may arrive in any order. The guards added on `rebuild/s0-1-codex` match their call sites: vault file and link refreshes keep the latest request, tag cleanup checks promise identity, property reads are single-flight and remember the mtimes they asked for, search facts are keyed by term, embed reads check a generation, embed-cache deletion checks promise identity, and backlink context reads belong to one cache instance. Canvas load already has a generation. Bases updates run one dirty loop. Settings `load` is the startup `Promise.all` only. Those paths do not need reply order.

A cache hit can already resolve in a microtask while an earlier IPC read is in flight. That interleaving existed before this step.

## Problems

### FIXED: an explicit new tab cancelled an in-flight pane replacement

`workspace.ts` `open`. Before `3ac487b` every open stored `this.opens`, including `where` of `"tab"`, `"right"`, or `"down"`. The in-flight ordinary open then saw a mismatched token and returned without showing its note.

The token is now stored only when `replaces` is set (`workspace.ts` 469–473), which is `!opts.where`. An explicit new tab or split is still created, and the open already in flight still applies. Test: `still opens an in-flight note when a new tab is opened while it loads`.

### FIXED: history applied after a newer open

`workspace.ts` `travel`. Before `3ac487b` it awaited `editors.load` and then called `stepHistory` with no check against a newer navigation. An out-of-order reply could put the history note on screen over a note opened later, or a late ordinary open could overwrite Back.

`travel` now takes the same pane token before the read (`workspace.ts` 565–574). A failed load restores the previous token (`restoreOpen`, lines 546–549) so the open that was in flight can still apply. If the token, the active tab, or the group changed, it returns without consuming the history stack. Test: `does not apply history after a newer note open`. The reverse, history winning over an older in-flight open, is `lets history supersede an in-flight note open`.

### FIXED: undo-close stole the pane and dropped the closed tab

`workspace.ts` `undoCloseTab`. Before `3ac487b` a note tab awaited `load` and then `select`ed. A note opened during that read lost the pane, and the closed entry had already been popped.

A note restore now takes the pane token (`workspace.ts` 279–292). If a newer open owns the pane when the read returns, the closed item is pushed back onto `closed` and undo-close returns. A failed load restores the token and continues, which still discards that closed entry, as before. Test: `does not reopen a closed tab over a note opened while it loaded`.

### FIXED: an in-flight open published text from before a disk change

`noteEditors.ts` `load` / `reload`. `reload` used to return immediately when the path was not in `states` yet. After this step the watcher can emit `vault-changed` once the read has released the mutex and while the reply is still being serialized, which is before `load` installs the snapshot. The open then kept the old text, and nothing re-read the note.

`reload` now bumps `loadEpoch` (`noteEditors.ts` 73 and 427–429) before that early return. `loadFromDisk` (375–394) reads again when the epoch changes, and it does not replace a state that was installed in the meantime. Concurrent `load`s of one path share one promise (`loading`, lines 75 and 357–368). A save timer still skips applying `reload` over unsaved typing. Test: `does not publish a note read that lost a disk change while it was in flight`.

## Checked, not defects

These were looked at and left unchanged. They are not unresolved correctness bugs in this step.

- Two ordinary opens from a pinned tab still share the replacement token. The pinned tab turns the open into a new tab only after the read (`workspace.ts` 479–480), so the first click is dropped. The step's existing comment requires explicit new tabs and splits to stay independent. The latest ordinary click still wins.
- `show` for an explicit new tab runs when that read finishes. Focus can move there if a newer pane replacement already applied. A cache hit could already finish in a microtask ahead of an earlier IPC read, so this focus move is not new.
- `Vault::open` scans before `install_vault` takes the lock (`lib.rs` 131–138). A write during that first open can be dropped when the new vault is installed. That race predates step 0.1.
- A scan longer than the 500 ms own-write window can still emit an echo as an external modify. Replay does not use that window. `reload` still skips when the document changed locally or a save timer is set.
- A directory rename during a scan is replayed as the journal roots, parents before children, each refreshed from disk. The existing rescan test covers a file rename, not a separate directory-rename case. The replay order does not lose the moved tree.
- The plan's manual 5,000-note typing-while-search check was not run. This review's required checks are the automated suites below. Native interactive latency is still unmeasured. No real vault was opened.

## Tests

Run on the reviewed source, before `3ac487b` was committed. That commit is those three files and nothing else. Screenshot and canvas fixtures rewritten by the browser scripts were restored with `git checkout` and are not in the commit. `git diff --check` was clean.

- `rebuild/app` `npm run build`: passed as part of `npm run audit:offline` (`tsc --noEmit` and Vite 8.3.4, 2111 modules). The existing chunk-size warning on `dist/assets/index-BaxMCJR-.js` is not a failure.
- `rebuild/app` `npm test`: exit 0, about 537s.
  - `scripts/test-browser-discovery.mjs`: 4 passed, 0 failed.
  - Vitest 5.0.5: 54 files passed, 313 tests passed (the 8 tests already on the branch plus the 5 added here).
  - The other 52 scripts in the `test` chain, then `posttest` (`scripts/test-bases-config.mjs`): 1949 `PASS` lines, 0 `FAIL` lines.
- `rebuild/app` `npm run audit:offline`: exit 0. `Offline audit passed: 164 source files, dist/, CSP, capabilities and dependencies checked.`
- `rebuild/app/src-tauri` `cargo test --offline`: exit 0. `grove_lib` 40 passed, 0 failed, 0 ignored (0.05s). The `grove` binary and doc-tests ran 0 tests. `--offline` uses the already cached crates; the suite is unfiltered.

VERDICT: OK TO MERGE
