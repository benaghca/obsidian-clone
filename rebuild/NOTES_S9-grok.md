# S9: one refresh per frame, and a path lookup in Vault

A burst of disk changes used to make the page re-read the whole file list and the link index once per event, then reload each path on its own. `isFolder` and `touch` also walked the whole list on every call. Events that arrive in the same frame now share one refresh, and `Vault` keeps a path-to-entry map for the current file list.

Nothing the user sees changes. After a burst, the file list is the one `listFiles` returned, open notes reload for the same paths as before (a path that ends the frame removed is not reloaded), and folder checks answer the same yes or no. Layout, shortcuts, theme, and which notes are open were not touched. A normal one-file modify still only marks that file and reloads it, with no extra file-list read.

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

`flock /tmp/grove-npm-test.lock` then `npm test` (including posttest) and `npm run audit:offline` passed together on this tree. The audit runs `npm run build` (`tsc --noEmit` and `vite build`) and then the offline check. It reported 220 source files, dist, CSP, capabilities, and dependencies checked. An earlier run of the same chain passed the tests and stopped in `tsc`: the reload mock was typed as taking no arguments, so `call[0]` did not typecheck. The mock is now `(path: string) => Promise<void>`. That did not change what the tests assert. The chain then passed.

## Size

No new dependency.

TypeScript, against `2d4c13c`:

| File | Lines now | Change |
| --- | --- | --- |
| `rebuild/app/src/vault.ts` | 175 | +55 / −8 |
| `rebuild/app/src/vault.events.test.ts` | 174 | +174 / −0, new |

Net TypeScript: +229 / −8. Markdown: this file only, 41 lines.

Nothing is near 800 lines. `vault.ts` was 128 lines and is 175. The Rust watcher, `workspace.ts`, and the other slices' files were not edited.
