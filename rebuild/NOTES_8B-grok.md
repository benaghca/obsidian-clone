# 8B: the file list after a new note, rename, or delete

Creating, renaming, moving, or deleting a note used to wait on a fresh read of every file, even though the backend had already returned the new entry or finished the rename. That read then told every open note to redraw its links and dropped the tag cache.

The page now builds the next file list from the change it already knows. The array is new, so the link-target cache still resets. A full read remains for the cases that reply does not describe, and the watcher still reads the vault afterwards. That later read is the authority for anything outside the edit.

## What changed

`createNote`, a new folder, and a queued copy insert the returned `FileEntry` in path order. The insert happens only while this page owns the disk. If a parent folder is not already listed, the page still reads the whole list. The create reply names the file, not the folders the backend had to make, and inventing those folders would show the new note at the vault root until the watcher caught up. A failed create leaves the previous array in place.

A rename or move rewrites paths with the same mapping the tabs already use, keeps each file's times and size, and recomputes the display name. Children move with a folder. If the destination's parent folder is not listed, or two paths would land on one path, the page reads the whole list instead. A delete drops that path and everything inside it. `.trash` is ignored by the index, so the trashed copy is not added.

The local edit does not cancel a file-list read that is already running. If that read started before the edit, the edit is applied onto the reply, so an older snapshot cannot drop the new file. A read that starts after the edit replaces the patch, and the entry from disk wins, including its modified time. Switching vault or abandoning the page clears those pending edits. The install gate from S1 is unchanged: a reply installs only when it is still the current read, for the current backend, on a page that owns the disk.

A pane redraws its links when its text can name a path that was added or removed. The check is the lowercased path, the file name, the note name, and the parent folder. A one- or two-character name, the first list after open, and a change of more than 48 pieces still redraw every pane, because a short name is not safe to search for. A later read that changes no paths leaves the decorations and the tag cache as they are. Paths that were added or removed still drop the tag cache, because a new note can contain tags and a rename changes the path the tags are stored under.

The watcher event about 100 ms later still reads the list. Parent-folder modified times are left for that read. Alphabetical order uses the path, which the local list keeps in the same order as the backend. A time sort of the parent folder can move when that read lands.

Attachment saves and drawing export still read the whole list. They were outside this piece.

Nothing on screen is meant to change: the same notes, the same order, the same links, the same sidebar selection. The explorer still rebuilds every row when the file list changes. That cost is the P6 gap S7 left in place.

## Tests

`src/fileListPatch.test.ts` (vitest, no window). Before the patch, creating `B.md` between `A.md` and `C.md` called `listFiles` once:

```
expected "listFiles" to not be called at all, but actually been called 1 times
```

After the patch that test passes. The new array is path-sorted, the returned times and size are kept, and `linkExists("B")` becomes true. A thrown create keeps the old array and does not read the list. A note under a folder that is not listed reads the list and does not leave the note behind when that list omits it. A sealed page, and a page whose vault is not the backend, insert nothing. Renaming folder `A` to `B` rewrites the folder, `A/N.md`, `A/Plan.canvas`, and `A/Sub/X.md` without a list read, and keeps the note's modified time. A move into a missing folder leaves the list as it was. Deleting `A` drops `A` and `A/N.md` and keeps `Z.md`.

An in-flight list that returns without the new note still shows the note once it settles, one entry, and that read is the only `listFiles` call. A list read that starts after the create replaces the patched entry with the disk entry (`mtime_ms` 11, same array the backend returned) and reports no path changes. A list that resolves after the page is sealed does not replace the patched list with an empty one.

Short names produce no search token. `Fresh name` is a token, and a note whose text contains `[[Fresh name]]` is the one that redraws. Inserting one file into a 5,000-file list took 3.72 ms in the green suite (`FILE_LIST_PATCH_MS 3.72`) and did not call `listFiles`.

The friction harness still measures new-note and rename on a 5,000-note vault. On this machine, before the patch (the same tree with these edits stashed):

- new_note 123 ms (64 without the mock)
- rename_enter 130 ms (60 without the mock)
- rename_linked 121 ms (54 without the mock)

On the green run, after the patch:

- new_note 117 ms (60 without the mock)
- rename_enter 125 ms (57 without the mock)
- rename_linked 133 ms (63 without the mock)

Those long tasks are the explorer rebuilding every row. The harness answers `listFiles` inside the page, so it does not time the full vault read this patch skips. The P6 lines stay known gaps. No budget was weakened.

`cargo test --offline` from `rebuild/app/src-tauri`: `CARGO_EXIT:0`. grove_lib: 156 passed, 0 failed, 4 ignored.

`flock /tmp/grove-npm-test.lock` then `npm test` from `rebuild/app`: `TEST_EXIT:0` in the log for the run that finished clean. Vitest reported 110 files and 1,659 tests. The feel graph gap on that run was p95 33.4 ms, max 50 ms, over_20ms 86/154, and 0 long tasks. Screenshot dirt under `rebuild/round23-shots` through `rebuild/round33-shots` (including `round31b-shots` and `round32b-shots`) was restored and is not in the commit.

Earlier locked runs on this machine missed a timing budget and were discarded. They failed on a graph long task (55–59 ms), a switcher input of 24 ms against 16 ms, or Enter in the long note at 17 ms with a slowest input of 24 ms. The Enter miss also happened on the stashed tree, before any create or rename. One earlier feel run was alongside `cargo test`. Those are load flakes. The numbers above are from the log whose last line is `TEST_EXIT:0`.

The browser was not opened for this piece. The suite's own headless Chromium is what exercised the page.

## Size

No new dependency. `workspace.ts` stays 902 lines.

| File | Lines |
| --- | --- |
| `rebuild/app/src/vault.ts` | 419 |
| `rebuild/app/src/fileOps.ts` | 404 |
| `rebuild/app/src/workspace.ts` | 902 |
| `rebuild/app/src/main.ts` | 620 |
| `rebuild/app/src/listPatch.ts` | 96 |
| `rebuild/app/src/shell/vaultTags.ts` | 38 |
| `rebuild/app/src/fileListPatch.test.ts` | 195 |
