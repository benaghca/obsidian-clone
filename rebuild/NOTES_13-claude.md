# 13: batch outside-change re-reads (Fable finding 13)

## In plain words

When files change outside Grove (a git pull, a sync, another editor), the page now does one refresh for the whole burst. Before, an event that arrived while a refresh was still running started a second refresh on top of it. Now that event waits for the running refresh and then joins the next batch. Nothing the user sees changes. Outside edits still show up in the file list and in open editors, and unsaved local edits are still never overwritten.

## What was already fixed

S9 (`be20aca`, `b75f78b`, `5dcf508`) already did most of what Fable asked for in `src/vault.ts`:

- `onChanged` queues events. Events that arrive before the next frame, or before the 50ms fallback timer, become one batch.
- Each batch makes at most one `list_files` read (none when the batch is all modifies) and one `link_index` read. Each path is touched once and reloaded once. Paths that end the batch removed, including files inside a removed folder, are neither touched nor reloaded.
- Stale `list_files` and `link_index` replies are still dropped by request id. A new open, or the page going away, drops a waiting batch.

S4 and 8B did not touch this path. 8B patches the file list for Grove's own create, rename, and delete. Piece 14 adds path lookups and is not merged here.

On the Rust side, the watcher (`src-tauri/src/watch.rs`) already waits for about 100ms of quiet, and at most 400ms, before it reports. Then it sends at most one `vault-changed` per kind. Those events arrive together, so the page already handled them as one batch.

## What was left, and what changed

One gap remained. `flushChanges` cleared `pending` before it started reading, so a watcher batch that arrived during the `list_files` read, or while notes were reloading, started a second flush right away. That caused:

- a second `list_files` while the first was still running. The first reply was then thrown away, but Rust had already built it.
- a second `link_index` per flush, where one was enough.
- the same path reloading in two flushes at once.
- with a slow read and a steady stream of watcher batches (one every 100–400ms during a long sync), every read went stale before it could install, so the file list kept waiting.

The fix is in `src/vault.ts` (+26/−10 lines). Only `onChanged`, `abandon`, and `flushChanges` changed:

- `running` marks the batch being applied. While it is set, `onChanged` only adds to `pending`. It does not start another flush.
- When the batch finishes, it starts one more flush (same frame-or-timer path) if anything is waiting. All the events that arrived during the batch become that one batch.
- A batch that leaves events waiting skips its own `link_index` read. The next batch reads it once for both.
- `abandon` (a new open, or `pagehide`) clears `running`, so the next vault is never held behind the old vault's batch. The old batch's `finally` sees it no longer owns `running` and does nothing.

Every existing guard is still checked between steps: the wave check, `pageOwnsDisk`, and the request ids. `NoteEditors.reload` was not changed, so its checks for dirty notes, pending saves, retries, and in-flight jobs are the same as before. No save, conflict, seal, or quit-flush code was touched. Reloads within one batch still run one at a time, in the same order. The diff stays inside these three `Vault` methods so it merges cleanly with piece 14.

## Tests

`src/vault.events.test.ts` (mock `api`, fake `reload`, no window):

| Test | Before the fix | After |
| --- | --- | --- |
| **refreshes once for a mixed burst and ends with the disk's files** (create, modify, delete, rename, folder remove, modify inside the removed folder) | passed (S9 already did this) | passes: one `listFiles`, one `linkIndex`, one `files` and one `links` notice. The files, notes, `isFolder`, and `entry` match the disk. Reloads and modified notices cover only the paths still there. |
| **holds events that arrive while a refresh reads, then refreshes once more for all of them** (four watcher events during an in-flight `listFiles`) | **failed**: a second flush was queued at once | passes: never more than one `listFiles` in flight, exactly one follow-up read for all four events, one `linkIndex` total, end state matches the disk, every path reloaded once, nothing lost |
| **keeps a change that arrives while the batch is reloading notes** | **failed**: a second flush was queued while a reload was waiting | passes: the change runs after the reload finishes. `Late.md` and `Slow.md` reload and are marked modified. No list read for an all-modify batch, and one `linkIndex` for both batches. |
| **keeps the later file list when an older read replies last** (replaces "keeps the later file list when two refreshes are in flight") | – | passes |

The replaced S9 test started two watcher flushes at once, which can no longer happen. Its point was that stale-reply dropping keeps the newer list. It now gets two reads in flight from a watcher batch plus a direct `refreshFiles()` (a create's confirmation read). The newer reply arrives first and the older one last. It still asserts that the newer list stays, that only two `files` notices fire, and which paths reload. No other assertion changed.

To check "failed before", I put the `HEAD` version of `vault.ts` back with the new tests in place and ran `npx vitest run src/vault.events.test.ts`: 2 failed, 15 passed. With the fix: 17 passed.

## Results

- `npx vitest run`: 110 files, 1678 tests passed.
- `npx tsc --noEmit`: clean.
- `cargo test --offline` (in `rebuild/app/src-tauri`): 196 passed, 0 failed, 5 ignored.
- `flock /tmp/grove-npm-test.lock npm test`, with posttest: passed (exit 0) on the third run. The first two runs were made while the machine was busy (load average about 6.4) and each stopped on a timing check outside this change:
  1. `test-feel.mjs`: one 50ms long task in the graph scenario. The graph is already a known gap.
  2. `test-canvas-cards.mjs`: "Six on-screen link cards load a frame". This check waits about 1s. With the fix in place, the script passed twice when run alone, and then in the full third run.

  Neither script uses `vault-changed` events. The screenshots and fixtures the runs rewrote under `rebuild/round*-shots/` were restored with `git checkout`.

## Size

`vault.ts` 450 → 465 lines. `vault.events.test.ts` 481 → 600 lines. Only TypeScript changed. No new crates or packages.

## Codex round 1 fixes

Codex reviewed `42cf18a` and returned PASS-WITH-FIXES, with one blocker. A batch that left events waiting always skipped its link-index read. In a steady stream, where another change lands before each batch finishes, `vault.links` would never update until the stream went quiet. Changes to notes that are not loaded never call `written()`, so nothing else would read it either. S9 read the link index after every batch, so this was a regression.

Changes in `src/vault.ts` (+15/−3):

- `linksOwed` bounds the deferral. A batch with events waiting may skip its link read only if the batch before it did not already skip. During a stream the index is read every second batch, still coalesced. Any `refreshLinks` call clears the debt, including the 1s timer `written()` sets after one of Grove's own saves. `abandon` clears it, since `open` reads the index itself.
- If a batch fails (a rejected `list_files`), nothing waits, and an earlier batch still owes its link read, the `finally` reads it. This still checks the wave and `pageOwnsDisk`. The request-id guards in `refreshLinks` are unchanged.
- The flush's promise now has a `.catch` that logs to `console.error`, where before it was an unhandled rejection. The error is reported either way. The batch that failed is dropped as before, and what waited still runs.

New tests in `src/vault.events.test.ts`. I checked each against `42cf18a`'s `vault.ts`:

| Test | On `42cf18a` | After |
| --- | --- | --- |
| **reads the link index while a steady stream of changes keeps the queue full**: six batches, each with the next change queued before it finishes | **failed**: 0 link reads until the stream ended | passes: a read by the second batch, never more than one batch late, at most ⌈6/2⌉+1 reads in all. The final `vault.links` names the last change's note, and the files and reloads cover all six |
| **runs the waiting batch after an awaited read rejects** | **failed**: unhandled rejection | passes: the error is logged once, the waiting batch runs (files, reload, one link read), and a later change starts its own batch |
| **still reads the links a batch deferred when the batch that waited fails** | **failed** | passes. With only the `finally` fallback line removed, it fails on the link-read count, so that line is pinned too |
| **does not let an old vault's batch release a newer batch when it finishes late**: an open during a batch, then the old read replies while the new batch is reading | passed (new coverage) | passes: the old reply does not install or reload, the new batch's marker holds, so a change during it waits, and the end state matches the new vault |

Results for this round:

- `npx vitest run`: 110 files, 1682 tests passed.
- `npx tsc --noEmit`: clean.
- `cargo test --offline`: 196 passed, 5 ignored.
- `flock /tmp/grove-npm-test.lock npm test`, with posttest: passed (exit 0) on the first run. The screenshots and fixtures it rewrote under `rebuild/round*-shots/` were restored with `git checkout`.
