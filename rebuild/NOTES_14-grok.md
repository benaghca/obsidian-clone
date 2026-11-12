# 14: path lookups instead of scanning the file list

Saving, restoring a layout, and checking a rename used to walk the whole file list or the whole note list. On a vault of 20k files that walk showed up on every save (`isFolder`, `touch`) and on every restored tab and history entry. S9 already kept a path-to-entry map inside `Vault` for `entry`, `isFolder`, and `touch`. This piece uses that map for the remaining exact-path checks, adds a case-insensitive map and a note-path set, and keeps those maps current when a list is replaced or edited in place.

Nothing on screen is meant to change: the same files, the same order, the same rename and move rules, the same restored tabs. No new package. No Rust change. Save, flush, list patching, and watcher batching stay as S1, S3, S4, S5, S9, and 8B left them. `show` still installs a new file array and rebuilds `notes` from it. A duplicate `addEntry` still returns the same array, and it still does that before the parent-folder check. A new array still drops the link-target cache by identity. An in-place edit of the same array drops `fileRefs` and the link-target cache on the next lookup, because those caches key on the array object.

## What changed

`Vault` keeps two maps for the current file array. `byPath` is the first entry for an exact path. `byLower` is the first entry whose path matches ignoring case, the same stop-at-the-first-hit order as `files.find` on `toLowerCase`. `notePaths` is the set of paths in the current note list. `hasNote` is case-sensitive, the same comparison a `notes.some` used. Assigning `files` or `notes` rebuilds the matching index. `push`, `pop`, `shift`, `unshift`, and `splice` on an array the page already holds mark that array stale, including a splice that keeps the same length. The next `entry`, `matchPath`, `hasNote`, `fileRefs`, `includedNotes`, or `linkExists` rebuilds before it answers. A direct index write (`files[i] = entry`) with the length left alone does not mark the list stale. The page and the tests change lists by assignment, `show` / `adopt*`, `push`, and `splice`.

`addEntry` still binary-searches the path-sorted list. The landing index is the existing entry when the path is already listed, so the duplicate check no longer scans.

## Call sites

These now answer from the map or the note set:

| Site | Lookup |
| --- | --- |
| `vault.ts` `entry`, `isFolder`, `touch` | exact path (S9 map, now kept across in-place edits) |
| `vault.ts` `matchPath` | first case-insensitive path |
| `vault.ts` `hasNote` | note path, case-sensitive |
| `vault.ts` `fileRefs`, `includedNotes`, `linkExists` | sync the index, then the existing cache |
| `workspace.ts` `canUndoClose` | `hasNote` |
| `workspace.ts` `loadTab` | `hasNote` for the tab path and each back/forward entry (`savedLayout.ts` already takes that predicate) |
| `shell/rightSidebar.ts` | `hasNote` for the outline file |
| `shell/sidebar.ts` bookmarks | `entry` |
| `fileOps.ts` `freeName`, `renameError`, `moveFile`, `relocateNow` | `matchPath` through `fileAt` / `pathTaken` |
| `drawing/export.ts` | `matchPath` for the export name |
| `canvas/view.ts` background | `entry`, then the same folder and image-extension checks |
| `bases/view.ts` host file | the row, then `entry` |
| `listPatch.ts` `addEntry` | the binary-search landing index |

`fileOps.ts` still scans when the vault object has no `matchPath`. The file-ops tests use that kind of double. A real `Vault` always has the method, so the page hits the map.

These still walk the list, because they return many files or they match on something other than one path:

- `graph/view.ts`, `editorHost.ts` (link candidates and attachment notes), `shell/quickSwitcher.ts`, `settings/sections.ts` (folder paths), `shell/movePrompt.ts` (folders), `shell/menus.ts` (images), `canvas/cards.ts`, `canvas/groups.ts`, `shell/mergePrompt.ts`, `appCommands.ts` (template notes under a folder), `bases/model.ts`
- `fileRefs` and `includedNotes` still filter once when the cache misses
- `dirsOf`, `dropEntries`, and `mapEntries` still walk the list they are rewriting
- `bases/cards.ts` cover art still uses `files.find`. It matches a path or a file name, case-insensitively, and the first hit in list order wins. A path-only map would pick a different file when an earlier entry shares the name.

One duplicate-path case differs from a scan that also requires "not a folder". `entry` returns the first listing. Canvas background then drops that entry when it is a folder. A later image stored under the same path would have won the old `find`. The file list does not store one path twice.

## Tests

`src/vault.lookup.test.ts` (vitest, no window):

- Replacing `files` and `notes` drops the old paths. `Note.md` then `note.md`: `matchPath("NOTE.md")` is `Note.md`, and `hasNote("NOTE.md")` is false.
- `adoptAdded`, `adoptMapped`, and `dropPaths` update `entry`, `hasNote`, `isFolder`, and `matchPath`.
- `files.push` and a same-length `files.splice` show up in `entry`, `matchPath`, and `fileRefs`. `notes.push` and a same-length `notes.splice` show up in `hasNote` and `includedNotes`. A note is absent from `hasNote` until it is on the note list.
- Twenty `hasNote` passes over four history paths read no numeric index of a tracked note-list proxy.
- Twenty thousand files, looked up many times with `entry`, `hasNote`, `matchPath`, and `isFolder`, finished in 4.16 ms (`PATH_LOOKUP_20K_MS 4.16`). The budget in the test is 500 ms. Building the index happens when the list is assigned, before the timer.
- `addEntry` of a path that is already listed returns the same array. Inserting `B` between `A` and `C` still lands in order.

`vault.events.test.ts` still sees zero index reads from `isFolder` and `touch` after `files.reset()`. The index is built when `files` is assigned, before that reset. The in-place watch uses `defineProperty` and does not count as an index read.

Focused vitest (`vault.lookup`, `vault.events`, `fileListPatch`, `fileOps`, `workspace`, `tabs`): 6 files, 57 tests passed. `FILE_LIST_PATCH_MS` on that run was 4.66 (budget 50 ms for one insert into 5,000 files). `tsc --noEmit` was clean.

`cargo test --offline` from `rebuild/app/src-tauri`: exit 0. 196 passed, 0 failed, 5 ignored. No Rust files changed.

`flock /tmp/grove-npm-test.lock` then `npm test` from `rebuild/app`: `TEST_EXIT:0`. Vitest reported 111 files and 1,681 tests. On that run `PATH_LOOKUP_20K_MS` was 5.35 and `FILE_LIST_PATCH_MS` was 7.87. The feel graph gap stayed the known gap: p95 33.4 ms, max 33.4 ms, over_20ms 61/182, 0 long tasks. `posttest` ran. Screenshot dirt under `rebuild/round23-shots` through `rebuild/round33-shots` (including `round31b-shots` and `round32b-shots`) was restored and is not in the commit.

The browser was not opened for this piece. The suite's own headless Chromium is what exercised the page. Test vaults stayed under `/tmp`.

## Size

No new dependency. `workspace.ts` stays 902 lines.

| File | Lines |
| --- | --- |
| `rebuild/app/src/vault.ts` | 546 |
| `rebuild/app/src/fileOps.ts` | 420 |
| `rebuild/app/src/workspace.ts` | 902 |
| `rebuild/app/src/listPatch.ts` | 152 |
| `rebuild/app/src/vault.lookup.test.ts` | 155 |
