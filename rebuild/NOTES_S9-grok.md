# S9: one refresh per frame, and a path lookup in Vault

A burst of disk changes used to make the page re-read the whole file list and the link index once per event, then reload each path on its own. `isFolder` and `touch` also walked the whole list on every call. Events that arrive in the same frame now share one refresh, and `Vault` keeps a path-to-entry map for the current file list.

Nothing the user sees changes. After a burst, the file list is the one `listFiles` returned, open notes reload for the same paths as before (a path that ends the frame removed is not reloaded), and folder checks answer the same yes or no. A removed folder also drops the files inside it from that reload, and from the modified notice, so a view does not reread a path that is already gone. A later create or modify in the same frame puts the path back. Layout, shortcuts, theme, and which notes are open were not touched. A normal one-file modify still only marks that file and reloads it, with no extra file-list read.

The flush does not wait on a paint. The frame callback runs the batch when the window draws, and a 50ms timer runs that same batch if the frame never comes. Whichever runs first cancels the other. Opening the vault again, or the page going away, drops a batch that has not finished.

The map is rebuilt only when `files` is replaced. The first entry for a path wins, which is the entry a list scan used to stop on. `entry(path)` is that lookup for later callers. `workspace.ts` and the other files that still scan `vault.files` were left alone. Stale `refreshFiles` and `refreshLinks` replies are still dropped by the same request ids.

## Proof

The new tests are `rebuild/app/src/vault.events.test.ts`. They use a mock `api` (`listFiles`, `linkIndex`, `onVaultChanged`) and a fake `reload`. No window is opened.

I ran them on the old `Vault` first (`npx vitest run src/vault.events.test.ts` at `2d4c13c`). Three failed, one passed:

| What | Before | After |
| --- | --- | --- |
| 11 disk events in one turn (modify, create, remove, rename, including a path removed after it was modified and a path created after it was removed) | No frame was queued. Each event ran immediately. | One frame. One `listFiles`, one `linkIndex`. Reloads are the union, each path once. `M2.md`, `Gone.md`, and `AlsoGone.md` are not reloaded. `ThirdGone.md` is, because a create put it back. |
| `isFolder` on a 41-entry list (the folder last) | 123 index reads: three full walks | 0 index reads. Folder, file, and missing path still answer correctly. |
| `touch` from two modify events for the same path | Would walk the list on each event, bump the time twice, and read the link index twice | 0 index reads. The matching entry's time moves, a different entry stays, `onModified` fires once per path, one link-index read, no file-list read. |
| A later `listFiles` that drops `Folder` and adds `Next` | `isFolder("Folder")` walked both entries (2 reads) | 0 reads. `isFolder("Folder")` is false, `isFolder("Next")` is true, and `entry("Old.md")` is the new object. |

The test that two frames each refresh once already passed before the change, because each event refreshed on its own. It still passes, so a later frame is not stuck on the first batch.

After the change, the same file passed: 4 tests. `src/readOrdering.test.ts`, `src/workspace.test.ts`, and `src/fileOps.test.ts` also passed (33 tests). No older assertion was weakened.

`flock /tmp/grove-npm-test.lock` then `npm test` (including posttest) and `npm run audit:offline` passed together on the first S9 commit. The audit runs `npm run build` (`tsc --noEmit` and `vite build`) and then the offline check. It reported 220 source files, dist, CSP, capabilities, and dependencies checked. An earlier run of the same chain passed the tests and stopped in `tsc`: the reload mock was typed as taking no arguments, so `call[0]` did not typecheck. The mock is now `(path: string) => Promise<void>`. That did not change what the tests assert. The chain then passed.

## Review fixes

Codex reviewed `be20aca` as pass-with-fixes. Two batches were wrong. A window that never paints kept the batch forever, because only `requestAnimationFrame` ran it. A modify followed by a remove still emitted `onModified` for the removed path, and a remove of a folder left the files inside it in that set.

I added the tests first and ran `npx vitest run src/vault.events.test.ts` on `be20aca`. Six failed, five passed:

| What | Before the fix | After |
| --- | --- | --- |
| Animation frames never call back | No fallback was queued | One timer runs the batch once: one `listFiles`, one `linkIndex`, reloads for the paths that remain |
| The frame and the timer both fire | No timer was queued | One `listFiles` and one `linkIndex`, not two |
| Modify a file, remove it; modify a child, remove its folder; rename a folder away | `onModified` still fired for those paths | No notice and no reload for them. `Folder2/x.md` stays. A later modify of `Folder/a.md` and a create of `Back.md` come back |
| Open the vault again while a frame is waiting | The old listener stayed, and the frame still ran | The old listener is dropped and the frame does nothing |
| Open again while a file-list read is in flight | The stale batch still reloaded `Stuck.md` | The open's file list is kept and `Stuck.md` is not reloaded |
| Two file-list reads in flight | Already kept the later list | Still does, and both batches reload their own paths |
| The page fires `pagehide` with a frame waiting | Nothing listened | The frame does not touch or reload |

The overlapping file-list test already passed before the fix. It still passes, so a newer list is not thrown away when an older reply arrives last. No older assertion was weakened.

After these fixes, `cargo test --offline` in `rebuild/app/src-tauri` passed (115 tests, 4 ignored) and `flock /tmp/grove-npm-test.lock npm test` passed, including posttest. One earlier `npm test` failed in the feel harness on hitch budgets while the machine was busy. The same suite then passed.

## Review fixes, second pass

Codex re-reviewed `b75f78b` as pass-with-fixes. Two things were still wrong. Each rename walked every path already queued, so 5,000 unrelated renames took 25,040,027 visits on the UI thread. `pagehide` was listened for on `document`, and the test called that callback itself. The browser fires `pagehide` on `window`, and it does not bubble.

Removals are now tombstones in a prefix tree. Each path is checked once, against the folders above it, and a later create or modify of that path wins. The same 5,000 renames, with the folder-remove and recreate cases in front of them, stay under 8 visits per rename. I ran that test on `b75f78b` first: the visit count was 25,040,027, above the limit of 40,000. After the tree, the same test passes, and the older descendant assertions still hold.

`pagehide` and `pageshow` are listened for on `window`. The test dispatches those events on `window`. After `pagehide`, the vault-changed subscription does not start another batch. `pageshow` accepts events again. That test failed on `b75f78b` because a modify after the dispatched `pagehide` still queued a frame.

After this pass, `flock /tmp/grove-npm-test.lock npm test` passed, including posttest.

## Size

No new dependency.

TypeScript, against `2d4c13c`:

| File | Lines now | Change |
| --- | --- | --- |
| `rebuild/app/src/vault.ts` | 334 | +216 / −10 |
| `rebuild/app/src/vault.events.test.ts` | 418 | +418 / −0, new |

Net TypeScript against `2d4c13c`: +634 / −10. Markdown: this file only, 73 lines.

Nothing is near 800 lines. `vault.ts` was 128 lines and is 334. The Rust watcher, `workspace.ts`, and the other slices' files were not edited.
