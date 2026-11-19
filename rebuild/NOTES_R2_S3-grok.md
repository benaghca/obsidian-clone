# R2 S3: say when a save keeps failing

A note whose writes keep getting rejected now gets one notice. The retry, the backoff, and the quit flush are unchanged. There is no unsaved mark, no quit prompt, and no read-only mode.

## When it speaks

A streak starts when a note save throws and the note is still open at that path. That is the permission, read-only, full-disk, locked, and non-UTF-8 failures. A newer keystroke during the failed write counts too, because the bytes were rejected. These do not count:

- the write was only queued for a vault switch
- saves are sealed or the path is held
- the note was deleted while the write was in flight
- the file was renamed while the write was in flight (the follow-up save at the new path is what counts)
- a newer direct write has taken the path. The open streak is dropped when that edit's retry retires. Grove does not say the note saved, because this write did not land the editor text

Reading the error cannot stop the retry. The next save is armed first. Turning the rejection into a sentence happens after that, inside the notice guard. If the rejection's message cannot be read, the retry still runs and that attempt stays quiet.

The first rejection stays quiet. The notice waits for a second rejection of the same note, so one blip that the next try saves says nothing. Retries after the notice do not speak again. A keystroke resets the retry timer, as before, and does not reset this streak.

Notices that come due within 100ms share one notice. If the note saves in that window, the failure notice is dropped and there is no follow-up.

Once the failure notice has been shown, the next successful save of that note says so. Recoveries in the same 100ms share one saved notice.

One outage, from the first open streak until every one of those notes has saved or been deleted, shows at most three failure notices. A note that fails after that stays quiet, including when it later saves. The next outage can speak again. Deleting a note drops its streak and does not say it saved. A rename keeps the same streak and the notice uses the new name.

## Wording

The same notice as the rest of the app: plain text, top right, click or six seconds to dismiss. The apostrophe and the quotes match the export notices.

- `Couldn’t save “Daily”: Permission denied. Grove will keep trying.`
- `Couldn’t save “A” and “B”: Read-only file system. Grove will keep trying.`
- `Couldn’t save “A”, “B”, and “C”: No space left on device. Grove will keep trying.`
- `Couldn’t save “A”, “B”, and 3 more: Note is not UTF-8. Grove will keep trying.`

Two notes with the same name are told apart by the vault path (`Folder/Daily.md`). When the notes in one notice failed for different reasons, the reason is left off. A saved note is `Saved “Daily”.`, with the same way of listing several names.

The reason is the error text. A Rust I/O error loses the trailing ` (os error 13)`. Blank lines and extra spaces are folded. An empty error becomes "the file could not be written". Anything longer than 160 characters is cut.

## What did not change

`scheduleRetry`, `retryDelay`, the dirty flag, and `flush` are the same, including the quit-flush order. A failed write is still tried once per flush and then left on its backoff (half a second, then 1, 2, 4, and at most 8 seconds). Canvases, drawings, and settings do not use this notice. No Rust change.

## Tests

`src/saveNotices.test.ts` is the notice rules, with no editor and no window: once per streak, cleared on success, quiet if the save wins before the notice is shown, one notice for many notes, a cap when notes fail apart, mixed reasons, duplicate names, rename, and delete.

`src/saveFailureNotice.test.ts` drives `NoteEditors` with `writeNote` mocked to fail. It uses the real `notice()` against a stand-in document, and it does not open a window. It checks the backoff is still 500ms, the notice appears once on the second failure, a later retry does not add another, a keystroke does not clear the streak, a save says `Saved “Daily”.`, one blip stays quiet, a sealed write is not a failure, four notes share one notice, and a rename keeps a single streak under the new name. A rejection whose message getter throws still returns from `flush` and retries at 500ms. After one rejection, a newer direct write retires the streak with no notice, and one later failure stays quiet. An announced streak retired the same way does not say the note saved, and the next streak can speak again.

`npx tsc --noEmit` in `rebuild/app` passed. The locked suite `flock /tmp/grove-npm-test.lock npm test` passed, including posttest: 113 vitest files, 1709 tests, then the bases, kanban, fuzz, and edge scripts. The held graph gap stayed at p95 33.4 ms. Rust was not changed, so `cargo test` was not run.

## Size

| File | Lines |
| --- | --- |
| `rebuild/app/src/noteEditors.ts` | 744 |
| `rebuild/app/src/saveNotices.ts` | 185 |
| `rebuild/app/src/saveNotices.test.ts` | 163 |
| `rebuild/app/src/saveFailureNotice.test.ts` | 308 |

`noteEditors.ts` was 717 lines. The save loop gained the calls that report a rejection or a success. The rules live in `saveNotices.ts`.
