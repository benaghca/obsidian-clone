# R2 S1: keep cursor and undo across an outside reload

Branch `rebuild/r2-s1-claude`, from `rebuild/integration` d285b70. Builder: Claude. Codex reviews next.

## In plain words

When a sync (git, Syncthing, another app) changes a note you have open but are not typing in, the cursor, the selection and the scroll position now stay on the same text. The outside change is not part of undo, so Ctrl+Z takes back only your own edits. It can no longer bring back the pre-sync text and save it over the synced file.

## What was wrong

`NoteEditors.reload` (`src/noteEditors.ts`) applied an outside change by replacing the whole document (`from: 0, to: length`), with `userEvent: "external"` and nothing else.
- **Cursor and scroll.** Every position inside a replaced range maps to its start, so the caret jumped to 0. CodeMirror's scroll anchor also maps to 0, so the visible lines moved.
- **Undo.** The reload was recorded as an ordinary history event. Ctrl+Z undid the sync. That undo transaction is not `"external"`, so `dispatch()` scheduled a save, and Grove wrote the old text back over the outside edit without saying so.
- **CRLF (found on the way).** `read_note` returns the file's own line breaks, and the editor holds `\n`. The equality check compared the CRLF text to the editor's `\n` text, so every outside event on a CRLF note did a whole-document replace, even when nothing had changed.

## What changed

**`src/editor/minimalChange.ts` (new, no packages).** `minimalChanges(old, next)` returns the smallest edits that turn one text into the other:
1. Equal lines at the start and end are skipped.
2. The middle goes through Myers' O(ND) line diff. This is the same algorithm as Cinder's `ui/diff.js` (Chris's code, read for reference), rewritten in TypeScript: lines are interned to integers, and only the diagonals each step needs are traced.
3. A changed block of up to 4,000 characters on each side is then compared word by word, so unchanged words inside the block keep their place.
4. Each edit is trimmed to the characters that actually differ. Trimming never splits a surrogate pair.

The diff has two limits, and past either one it falls back to a less fine-grained result that is still exact:
- More than 1,000 line edits (a rewrite): the changed middle becomes one block, the same as a common prefix/suffix diff.
- More than 200 word edits inside one block: that block stays one edit.

`normalizeLineBreaks` turns CRLF and lone CR into `\n`, which is what CodeMirror stores.

**`NoteEditors.reload`.** Only the apply step changed:
- It normalizes the read text, computes `minimalChanges`, and returns early when there are none. This replaces the old `text === current.toString()` check and fixes the CRLF case.
- It applies the edits as one transaction with `userEvent: "external"`, `Transaction.addToHistory.of(false)` and `isolateHistory.of("full")`.
  - `addToHistory: false` keeps the reload out of undo. Earlier undo and redo events are mapped across it, so undoing your own earlier edit still works, lands in the right place, and leaves the synced text alone.
  - `isolateHistory` stops typing just before the sync and typing just after it from merging into one undo step.
- There is no `scrollIntoView`, so CodeMirror's scroll anchor keeps the top visible line where it was.

Every guard is unchanged and still runs in the same order: `pageOwnsDisk`, the `loadEpoch` bump, `dirty`, the save timer, the retry timer, the in-flight job, the `reloads` token, and `current !== before`. No save, retry, seal, quit-flush, conflict or save-refusal code was touched. Mirrors in other panes get the same change through `forward()` and map their own selections. Canvas cards that embed a note go through the same path.

**Canvas and drawing.** I checked both and changed neither, because they don't have this bug:
- **Canvas** (`src/canvas/view.ts` `load`). It re-reads the file, then `owned.drop()` and `undo = []; redo = []`. The camera (`state`) is kept. Its history is a stack of whole-board snapshots, so it can't be mapped. Clearing it means Ctrl+Z can't restore the pre-sync board.
- **Drawing** (`src/drawing/view.ts` `load`). It calls `editor.reset()`, which runs `history.clear()`. The view state is kept unless there was none yet. Same result.

**`src/readOrdering.test.ts`.** Its fake `change()` assumed the reload sends one `{insert}`. It now applies a real `ChangeSet`. The assertions are the same.

## Tested

- **`src/reloadPlace.test.ts` (vitest, 21 tests).**
  - The diff: exact edits for small cases; edits far apart stay apart; 400 random line-level rounds and 400 random character-level rounds (emoji, accents, newlines) rebuild the target exactly, also with a limit of 1 to force the fallback, and never split a surrogate pair; CRLF compares equal.
  - Cursor and selection (on the note's state):
    - insert above the caret, insert below it, and inserts on both sides;
    - a selection with edits inside it and around it keeps both ends;
    - an edit on the caret's own line, on both sides of the caret, keeps its column;
    - a sync that deletes the caret's line puts the caret where the line was.
  - Undo:
    - after a reload, with no edits of your own, there is nothing to undo and nothing is written;
    - with an earlier saved edit, undo takes back only that edit, mapped past the synced lines, and redo still works;
    - typing after a sync is a separate undo step.
  - Guards and quiet cases: a CRLF file with the same text is not a change and fires no `saved`; a reload still waits while an edit's save is pending, and the typed text is saved; a reload marks previews stale and schedules no save.
  - Big notes, all within budget under load (measured locally at a few ms to ~80 ms):
    - a 5,000-line note with three scattered edits reloads in under 250 ms with the caret kept;
    - a full rewrite of 5,000 lines diffs in under 500 ms and is exact;
    - 100 scattered edits in a 5,000-line note diff in under 250 ms, as 100 small inserts.
- **`scripts/test-r2-s1-reload.mjs` (headless Chromium on the mock vault, added to `npm test`).** It uses a real editor and a real Ctrl+Z.
  - Setup: a 400-line note scrolled to line 200, a letter typed and saved.
  - Insert above: the caret stays on its text, the same line stays at the top of the pane, and `scrollTop` grows by the inserted lines.
  - Insert below: the caret and `scrollTop` don't move.
  - Edit on the caret's line: the caret keeps its column.
  - The first Ctrl+Z takes back only the typed letter and saves text that still has every synced line. A second Ctrl+Z changes nothing, writes nothing, and the note stays clean.
- **The tests fail on the old code.** I temporarily put back the whole-document replace: 10 of the vitest cases failed and the browser script failed. I then restored the fix.
- **`cargo test --offline`** (`rebuild/app/src-tauri`): 202 passed, 0 failed, 5 ignored.
- **`flock /tmp/grove-npm-test.lock npm test`**: passes, including posttest, with 112 vitest files and 1,712 tests. The new browser script passes inside it. It took four runs, because the machine's load average swung between about 10 and 69 while other sessions were running tests:
  - Run 1: `test-feel` missed its hitch budgets.
  - Runs 2 and 3: `test-friction` missed typing and paint budgets by a few ms. A different metric failed each time.
  - Run 4: `test-r27i` timed out while the mock vault was still loading, so the harness failed before the test began.

  Neither the friction test nor the feel test reaches the reload path. Run alone at low load, `test-friction` passed with this change and passed on the base code. The fourth full run, at a load average of about 2–3, passed everything. Tracked screenshots that the runs rewrote were restored.

## Leftover gaps

- **Mirrors aren't tested directly.** A second pane showing the same note relies on `forward()` and CodeMirror's own selection mapping. Vitest has no DOM, and the browser script uses one pane.
- **Where the caret lands when its text is gone.** If the sync rewrites the caret's exact words, or more than 200 words in one block, or more than 1,000 lines, the caret goes to the start of the replaced block. That's the natural place, but it isn't "the same text", because that text no longer exists.
- **Undo can re-apply your own deletion.** Undo before the sync still works on your own edits. If the sync re-added text you had deleted, undoing that deletion puts your copy back too. That's your edit being undone, not the sync's, and nothing is saved that you didn't do.
- **Not in this piece:** S2 (merge view for an unsaved conflict) and S3 (save-failure notice). An outside change to a dirty note is still skipped, as before.
