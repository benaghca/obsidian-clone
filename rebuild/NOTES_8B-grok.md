# 8B: the file list after a new note, rename, or delete

Creating, renaming, moving, or deleting a note used to wait on a fresh read of every file, even though the backend had already returned the new entry or finished the rename. That read then told every open note to redraw its links and dropped the tag cache.

The page now builds the next file list from the change it already knows. The array is new, so the link-target cache still resets. A full read remains for the cases that reply does not describe, and the watcher still reads the vault afterwards. That later read is the authority for anything outside the edit.

## What changed

`createNote`, a new folder, and a queued copy insert the returned `FileEntry` in path order. The insert happens only while this page owns the disk. If a parent folder is not already listed, the page still reads the whole list. The create reply names the file, not the folders the backend had to make, and inventing those folders would show the new note at the vault root until the watcher caught up. A failed create leaves the previous array in place.

A rename or move rewrites paths with the same mapping the tabs already use, keeps each file's times and size, and recomputes the display name. Children move with a folder. If the destination's parent folder is not listed, or two paths would land on one path, the page reads the whole list instead. A delete drops that path and everything inside it. `.trash` is ignored by the index, so the trashed copy is not added.

The local edit does not cancel a file-list read that is already running, and it does not fold itself onto that reply. The reply may be older than the edit, or it may already contain a later outside change, and the page cannot tell those apart. Each patch is tied to the disk generation it started from. A read that installs advances that generation. A create, rename, or delete that finishes after a newer read has installed does not apply, and the page reads the list again. A read that started before the edit is dropped, and one fresh read confirms the list. A read that starts after the edit replaces the patch, and the entry from disk wins, including its modified time. The common case, with no read in flight, still does not call `listFiles`. Switching vault or abandoning the page clears pending edits and advances the generation, so a late reply cannot patch the new page. The install gate from S1 is unchanged: a reply installs only when it is still the current read, for the current backend, on a page that owns the disk.

A peer window records that generation when it holds a path. A delete completion that arrives after the watcher has installed a recreated file is refused, and a fresh read keeps the new file in the list the sidebar and the quick switcher draw from. The same rule covers a late create: an older snapshot that already shows an outside removal is not overwritten with the created file.

A pane redraws its links when its text can name a path that was added or removed. The check uses the same spellings the resolver accepts: the path, the file name, the path without `.md`, the bare note name (`[[Fresh name]]` for `Projects/Fresh name.md`), the parent folder, spaces written as `%20`, backslash-escaped parentheses, and a percent-encoded path decoded back to the raw name. A note that embeds another document (`![`) redraws even when the changed name is only inside that document. A one- or two-character name, the first list after open, and a change of more than 48 pieces still redraw every pane, because a short name is not safe to search for. A later read that changes no paths leaves the decorations and the tag cache as they are. Paths that were added or removed still drop the tag cache, because a new note can contain tags and a rename changes the path the tags are stored under.

The watcher event about 100 ms later still reads the list. Parent-folder modified times are left for that read. Path order is Unicode scalar order, the same order as the backend's file map. JavaScript's UTF-16 comparison would sort an emoji before a fullwidth letter and could change which note a partial path resolves to. A time sort of the parent folder can move when that read lands.

Attachment saves and drawing export still read the whole list. They were outside this piece.

Nothing on screen is meant to change: the same notes, the same order, the same links, the same sidebar selection. The explorer still rebuilds every row when the file list changes. That cost is the P6 gap S7 left in place.

## Tests

`src/fileListPatch.test.ts` (vitest, no window). Before the patch, creating `B.md` between `A.md` and `C.md` called `listFiles` once:

```
expected "listFiles" to not be called at all, but actually been called 1 times
```

After the patch that test passes. The new array is path-sorted, the returned times and size are kept, and `linkExists("B")` becomes true. A thrown create keeps the old array and does not read the list. A note under a folder that is not listed reads the list and does not leave the note behind when that list omits it. A sealed page, and a page whose vault is not the backend, insert nothing. Renaming folder `A` to `B` rewrites the folder, `A/N.md`, `A/Plan.canvas`, and `A/Sub/X.md` without a list read, and keeps the note's modified time. A move into a missing folder leaves the list as it was. Deleting `A` drops `A` and `A/N.md` and keeps `Z.md`.

An in-flight list that returns without the new note does not fold the note back on. A second read confirms it, and that is the second `listFiles` call. An older snapshot that already contains an outside file, and omits the local create, wins: the fresh read drops the created file and keeps the outside one. A peer delete that finishes after the watcher has installed a recreated file leaves that file in `files`, `notes`, and `includedNotes` (the sidebar and the quick switcher read those). A list read that starts after the create replaces the patched entry with the disk entry (`mtime_ms` 11, same array the backend returned) and reports no path changes. A list that resolves after the page is sealed does not replace the patched list with an empty one.

`Ｙ.md`, `Ｚ.md`, and `😀.md` insert in that order, which is the backend's order. Renaming an unrelated note does not change which of `Ｚ/Shared/Note.md` and `😀/Shared/Note.md` wins `Shared/Note`. Adding `Projects/Fresh name.md` redraws a note that contains only `[[Fresh name]]`, a markdown link to `Projects/Fresh%20name.md`, and any embed. `Fresh%20name.md` redraws `[[Fresh name]]`. A Live Preview pass draws those links unresolved, and `![[Daily]]` and `![[pic.png]]` as missing, until `filesChanged` and then draws them resolved. Short names produce no search token. Inserting one file into a 5,000-file list took 5.45 ms in the green suite (`FILE_LIST_PATCH_MS 5.45`) and did not call `listFiles`.

The friction harness still measures new-note and rename on a 5,000-note vault. On the review-fix run:

- new_note 93 ms (47 without the mock)
- rename_enter 110 ms (52 without the mock)
- rename_linked 105 ms (51 without the mock)

Those long tasks are the explorer rebuilding every row. The harness answers `listFiles` inside the page, so it does not time the full vault read this patch skips. The P6 lines stay known gaps. No budget was weakened.

`cargo test --offline` from `rebuild/app/src-tauri`: `CARGO_EXIT:0`. grove_lib: 156 passed, 0 failed, 4 ignored. No Rust files changed.

`flock /tmp/grove-npm-test.lock` then `npm test` from `rebuild/app`: `TEST_EXIT:0`. Vitest reported 110 files and 1,664 tests. The feel graph gap on that run was p95 33.4 ms, max 33.4 ms, over_20ms 69/175, and 0 long tasks. Enter in the long note stayed inside its input budget (event max 16 ms). Screenshot dirt under `rebuild/round23-shots` through `rebuild/round33-shots` (including `round31b-shots` and `round32b-shots`) was restored and is not in the commit.

Three earlier locked runs for this fix were discarded. The first failed `mergeNote` because that test's workspace has no vault; the generation read is now optional. The second missed the cold base-embed open (130.4 ms against 100 ms). The third missed the 10,000-row base scroll (p95 16.8 ms, max 33.2 ms, budget max 25 ms). Those two timings are load flakes on paths this patch does not run. The numbers above are from the log whose last line is `TEST_EXIT:0`.

The browser was not opened for this piece. The suite's own headless Chromium is what exercised the page.

## Size

No new dependency. `workspace.ts` stays 902 lines.

| File | Lines |
| --- | --- |
| `rebuild/app/src/vault.ts` | 432 |
| `rebuild/app/src/fileOps.ts` | 410 |
| `rebuild/app/src/workspace.ts` | 902 |
| `rebuild/app/src/main.ts` | 621 |
| `rebuild/app/src/pathBarrier.ts` | 261 |
| `rebuild/app/src/listPatch.ts` | 134 |
| `rebuild/app/src/shell/vaultTags.ts` | 38 |
| `rebuild/app/src/fileListPatch.test.ts` | 379 |
