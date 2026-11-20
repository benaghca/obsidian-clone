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
3. A changed block of up to 200,000 characters on each side is then compared word by word, so unchanged words inside the block keep their place. (This was 4,000 before review round 1.)
4. Each edit is trimmed to the characters that actually differ. Trimming never splits a surrogate pair.

The diff has two limits, and past either one it falls back to a less fine-grained result that is still exact:
- More than 1,000 line edits (a rewrite): the changed middle becomes one block, the same as a common prefix/suffix diff.
- More than 200 word edits inside one block: that block stays one edit.
- Since review round 2, a fallback block is split again around each kept position (the cursor, the line that holds the scroll) when the text around it survived. See review round 2 below.

`normalizeLineBreaks` turns CRLF and lone CR into `\n`, which is what CodeMirror stores.

**`NoteEditors.reload`.** Only the apply step changed:
- It normalizes the read text, computes `minimalChanges`, and returns early when there are none. This replaces the old `text === current.toString()` check and fixes the CRLF case.
- It applies the edits as one transaction with `userEvent: "external"`, `Transaction.addToHistory.of(false)` and `isolateHistory.of("full")`.
  - `addToHistory: false` keeps the reload out of undo. Earlier undo and redo events are mapped across it when that is safe (see review round 1 below). Otherwise the note's history is cleared.
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
  - Run 5, at a load average of about 2–3, passed everything.

  Neither the friction test nor the feel test reaches the reload path. Run alone at low load, `test-friction` passed with this change and passed on the base code. Tracked screenshots that the runs rewrote were restored.

## Review round 1 (Codex FAIL, `/tmp/r2-s1-codex-review1.md`)

**P1: undo could restore pre-sync text.**
- **The problem.** Leaving the reload out of history wasn't enough. CodeMirror maps each earlier undo step across the reload, and when the sync had removed a step's range, the mapped step keeps its insertion but drops its deletion.
  - Example: change `status: draft` to `status: ready` and let it save. A sync then deletes `ready`. Ctrl+Z put `draft` back.
  - If the sync instead replaced `ready` with `published`, Ctrl+Z produced `publisheddraft`.
  - In both cases the undo then saved that text over the synced file.
- **The fix.** New `src/editor/reloadHistory.ts`, with `historySurvives(state, edits)`:
  - It runs every undo step, and separately every redo step, on a light copy of the note: the same document and history field, none of the editor's other extensions. That copy is cheap.
  - It maps the reload's edited ranges into each step's document and checks `changes.touchesRange`. Touching counts as well as overlapping, so text inserted right next to your edit is caught too.
  - If any step reaches an edited range, `reload` applies the change and then clears the note's history: `historyCompartment` is reconfigured to `[]` and back to `history()`.
  - If no step reaches one, the history stays and is mapped. Mapping is exact for steps that don't touch the sync.
  - `history()` in `createNoteState` now lives in `historyCompartment` (`src/editor/editor.ts`), which is the only way to reset it. Mirror panes have no history of their own, and split-pane undo runs on the main state, so this covers them.
- **Tests.**
  - Vitest:
    - Codex's delete case and replace case: nothing to undo, no extra write;
    - a redo step the sync touched;
    - an insert right next to your edit counts as touching it;
    - typing after the clear starts fresh history;
    - an older step touched behind a newer, unrelated one is still caught.
  - Browser, with a real Ctrl+Z and Ctrl+Y, checking the editor text, the disk text and the write count:
    - the delete case;
    - the replace case;
    - a redo after a sync changed the word.

**P2: a caret in a long line could jump.**
- **The problem.** Word refinement was skipped for a changed block over 4,000 characters. Two small edits around 5,000 unchanged characters on one line became one replacement of the whole line, and the caret went to 0.
- **The fix.** The word diff already skips equal words at both ends and stops after 200 edits, so I raised `REFINE_CHARS` to 200,000. Its cost stays around (words in the block) × 200. Above that size, the block stays one edit (listed under gaps).
- **Tests.**
  - Vitest: a caret in the middle of a 5,000-character line stays on its word, and the edits are each under 10 characters; a 60,000-character line edited at both ends gives edits of 2 characters or less, in under 250 ms.
  - Browser: the caret on a long line stays on its word.

**Each new test fails without its fix.**
- With the history check turned off and the old 4,000 cap back, 6 vitest tests failed.
- The browser script failed at the first P1 check.
- A non-fatal copy that skipped the delete and replace cases also failed the redo and long-line checks.

**Suites after the round-1 fixes.**
- `cargo test --offline`: 202 passed.
- Locked `npm test`, first run: `test-feel` missed a graph long-task budget (2 tasks, max 59 ms). Run alone, it then passed once with this change and failed once on note-switch paints. Alternating with the base code at a load average of about 1.5, it passed 3 of 3 with this change and 3 of 3 on base, so I treated that as noise.
- Second run: the whole main chain passed, with 112 vitest files and 1,720 tests, and every browser script, the new reload script included. The posttest step missed one budget: `test-bases-embed` cold open at 115.8 ms, against 100 ms.
- `npm run posttest` under the same lock, run again: passed.

**`readOrdering.test.ts`.** Its fake host now has a real state (with no history) and an `owners` map, because `reload` reads them now.

**Process slip.** One scratch probe ran `npx tsx`, which wasn't installed, so npx fetched it into its own cache, probably over the network. Nothing was added to the project, and no probe files are left in the worktree. Later probes used only installed packages.

## Review round 2 (Codex PASS-WITH-FIXES, `/tmp/r2-s1-codex-review2.md`)

### P2: a fallback edit still sent the caret to its start

- **The problem.** When the diff hits a work limit, it replaces the whole changed block as one edit. A caret inside that block maps to its start, even when the text under the caret didn't change. Codex showed it two ways:
  - a 1,277-character line, `alpha ` ×105, `unchanged section`, ` alpha` ×105, with every `alpha` changed to `bravo`. That is more than 200 word edits, so the caret went from 639 to 0;
  - two small edits around 200,001 unchanged characters, which is over the word-diff size cap. The caret went from 100,000 to 0.

  The same block can also swallow the line CodeMirror holds the scroll by, so the view jumps.
- **The fix.** It keeps the work limits.
  - `minimalChanges(old, next, keep)` takes positions to keep. Fallback blocks are marked internally (`coarse`).
  - For each kept position strictly inside a fallback block, `locate` takes the 32 characters just after and just before the position (then 8, if needed) and looks them up in the block's new text. It looks outward from where the position would land if the edit were spread evenly, at most 32 hits each way.
  - Each hit is extended in both directions (at most 4,096 characters each way). The longest match wins; on a tie, the nearest one, which keeps a caret in repeating text on its own copy and not one 30 characters away.
  - The block is then split into two trimmed edits around that unchanged span, and any other kept positions are handled the same way inside the two parts. Less than 8 matching characters is not worth a split.
  - The split never cuts a surrogate pair, and the result is always exact, because it splits only on text that is the same on both sides.
- **The positions** come from `NoteEditors.places(path)`:
  - the main state's selection (anchor and head of every range);
  - in every pane showing the note, its selection, plus the start of the line block at the top of its scroller and the one after it. That is the block CodeMirror's `scrollAnchorAt` uses to hold the scroll across a change.

  The list is capped at 64 positions.
- **Tests.**
  - Vitest:
    - Codex's 1,277-character case and the 200,001-character case, through the real `reload`;
    - repeating `w0 … w9` text over 200k characters, where the caret must land exactly on its own copy;
    - a 3,000-line note past the line-edit limit, where the caret line and a scroll line both map onto their own text;
    - six kept places in one fallback block;
    - a 300-round fuzz with emoji, limit 1 and random kept positions: the result is always exact and no edit boundary splits a surrogate pair;
    - a 20,000-line rewrite with 64 kept positions in under 500 ms.
  - Browser script, a fallback case: a 1,500-line note where every line changes except 700–760 and 1,390–1,410. The pane is scrolled to line 730 and the caret, out of view, is on line 1400. After the sync, the caret stays on its text and column, and the same line stays at the top with 0 px of scroll change.
- **The tests fail without the fix.**
  - With the kept positions turned off, the five vitest fallback cases fail.
  - In the browser, with no positions, the caret check fails. With the selection kept but not the scroll lines, the top-of-pane check fails (the top went to the note's start, −17,071 px).
- **Concurrent writers.** Codex noted again that a pending whole-note save on a dirty note, or a pop-out with its own dirty state, can still replace an outside edit. That predates this branch and is outside the clean-reload piece (it belongs with S2/S3), so it is unchanged.

**Suites after the round-2 fix.**
- `cargo test --offline`: 202 passed, 0 failed, 5 ignored.
- Locked `npm test`, run 1: the first script, `test-feel`, missed the quick switcher's input budget (24 ms against 16 ms) at a load average around 23. That script runs before any reload code.
- Run 2: the steps before vitest and all of vitest passed (112 files, 1,727 tests). Then `test-r27e` failed "settings opens with the search field focused" at a load average of 76. That is a focus-timing check with no reload in it.
- I then ran `test-r27e` and every script after it, plus `npm run posttest`, under the same lock: all passed (EXIT 0). That includes `test-r27e` itself, `test-bases-embed`, and the new reload script with its fallback checks.
- Between them, the two full runs and that final run cover every step of the suite. Each step passed in at least one of them, and the only failures were the two timing checks above.

## Leftover gaps

- **Mirrors aren't tested directly.** A second pane showing the same note relies on `forward()` and CodeMirror's own selection mapping. Vitest has no DOM, and the browser script uses one pane.
- **Where the caret lands when its text is gone.** If the sync rewrites the caret's own words, the caret goes to the start of the replaced block. The start is the natural place, but it isn't "the same text", because that text no longer exists. Past the fallbacks (more than 200 word edits in one block, more than 1,000 line edits, a block over 200,000 characters), the caret and the scroll line now keep their text when at least 8 characters around them survived (review round 2). Other unchanged text inside a fallback block is still replaced with itself, which is exact but makes CodeMirror re-measure those lines.
- **Kept positions are a lookup, not a diff.** In text that repeats exactly, the match nearest the expected place wins. That keeps the caret on the same words, but in an extreme case it could be a copy a few lines away.
- **History is cleared as a whole.** When any undo or redo step touches the sync, all of the note's history is cleared, including steps elsewhere in the note. Keeping the untouched older steps would mean rebuilding CodeMirror's history, and that isn't public API.
- **Not in this piece:** S2 (merge view for an unsaved conflict) and S3 (save-failure notice). An outside change to a dirty note is still skipped, as before.
