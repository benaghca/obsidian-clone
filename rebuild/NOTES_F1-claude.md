# NOTES_F1: friction hunt in everyday flows

Branch `rebuild/g1-claude`, from the brief commit `e4cdb65` on `rebuild/integration`.
- TypeScript, CSS and scripts only. No Rust, no new dependency.
- Nothing was pushed. No app window was opened.
- Headless Chromium only, against the mock's `?synthetic=N` vaults in memory.

## In plain words

Most everyday moments in Grove were already inside the budgets at 5,000 notes. Opening, switching and going back paint within one or two frames, typing in the 5,000-line note never drops a frame, and focus lands in the note. The hunt found six things a user would feel, in four places. All six are fixed, each with a check that fails on the old code:

- **Esc no longer throws you to the top of a long note.**
  - **What happened:** Esc on the quick switcher (Ctrl+O), the command palette (Ctrl+P) or a confirmation such as "Delete current file?" put focus back in the note in a way that scrolled it to its first line. The caret stayed where it was, now off screen.
  - **Measured:** in the 5,000-line note, the scroll went from 182,416 px to 0 (switcher), 109,430 to 0 (palette) and 139,020 to 0 (confirmation).
  - **Now:** the note stays exactly where it was. Settings and image zoom hand focus back the same way, so they got the same fix, though neither jumped in this run.
- **Enter continues a list in a long note right away.**
  - **What happened:** just after jumping deep into a long note, Enter on `- item` gave a bare new line instead of `- `. CodeMirror parses a long note in the background, only about 100,000 characters past what's on screen. Its list command reads whatever tree exists. After a jump, the parse catches up with the caret in about 100 ms at 5k, so the window is short: Ctrl+End, a search result or a link, then Enter straight away.
  - **Now:** on a line that can be in a list or quote (it starts with a marker, `>` or indentation), Enter first parses up to the caret, capped at 100 ms, as Grove's own Tab and Backspace list commands already do. In that window, 4,500 lines into the 386,000-character note, this costs about 45 ms once. A plain line skips it (fixed after review, see below).
- **The left sidebar can be resized** by dragging its edge, as in Obsidian and as the right sidebar already could. Its width is kept for the vault like the right one's. Before, the left dock had no handle at all.
- **The new check runs in `npm test`.** `scripts/test-friction.mjs` drives the everyday flows with real key and mouse input at 5k and keeps all of the above from coming back.

Nothing else changed in behaviour: no new setting, command, prompt or visible feature.

## Review fixes (after `f186d83`)

The independent review asked for three fixes. They're all in this commit:

1. **Plain Enter no longer parses the note.**
   - **Problem:** F1 forced the parse before every Enter, plain paragraphs included. The reviewer measured 0.6 ms before F1 and 58.3 ms after, for a plain-paragraph Enter in a cold 5,000-line note.
   - **Fix:** `editor/config.ts` now forces it only when the caret's line starts with a list marker, `>` or indentation. Only those lines can continue markup, and the command runs either way.
   - **Unit test** (`editor/config.test.ts`, cold 5,000-line note):
     - plain Enter leaves the tree where it was (3,018 characters);
     - list Enter continues the list 4,500 lines down.
     - It fails on F1's code (the tree grew to 118,298) and on the code before F1 (no continuation).
   - **Browser:** three timed flows run in copies just opened and jumped into: a typed letter, plain Enter and list Enter.
     - **Plain Enter must cost no more than a typed letter at the same spot.** Both include CodeMirror's own catch-up parse of up to 20 ms per edit, which no Grove code controls.
       - Now: 23–24 ms for both.
       - F1: 45–46 ms of JS against 1 ms for the letter, so the check fails.
     - **List Enter stays within its 100 ms cap.** It measured 43–46 ms and is printed as a known one-time cost.
     - **Warm list Enter must keep the 16 ms keystroke budget.** It's the Enter at the Big note's end, now with the line on screen as a user has it. It measured 16 ms.
2. **The friction test checks that the action happened.**
   - **Problem:** Ctrl+Tab's condition was `true`, and timing started on the Ctrl keydown. A frame could therefore "finish" it before Tab was sent.
   - **Fixes:**
     - Timing now starts on the action's own key, never a modifier.
     - Completion is stamped with `performance.now()` in the frame callback. A frame's own timestamp can predate a long handler before it.
     - Ctrl+Tab and Ctrl+Shift+Tab record the neighbouring tab first, then require that exact tab (by id) with its note painted.
     - Other `true` conditions now name their result: undo and redo the expected line, right-sidebar tabs the active header, resizing an 80 px width change, pane focus the other pane's tab.
   - **New budgets:**
     - each switcher and palette keystroke: ≤ 16 ms of JS, measured 1–6 ms;
     - the last keystroke to its results: ≤ 50 ms, measured 16–17 ms;
     - Enter: as above.
   - **Checked against the bug:** with Ctrl+Tab made a no-op, both tab checks now fail. Before, they passed.
3. **The link commands give fresh, correct answers.**
   - **Problem:** the old stand-in echoed the page's own index, so a refresh could never see a change. Its backlinks had no counts, Markdown links or text.
   - **Fix:** the script now calls the mock's real `link_index`, `backlinks` and `link_sources`, and takes their time out of page-side timing as Rust's.
     - Microtasks queued either side of each call bracket exactly the mock's synchronous work. That time is subtracted from long tasks, frame gaps, input events and the input-to-result time, and reported per flow as `rust`.
     - The page still pays `JSON.parse` on each reply.
   - **New checks:**
     - after choosing `[[river signal 4]]` and the autosave: the page's index has the link and equals a fresh backend answer, and the target's backlinks include the Big note with the line's text;
     - after renaming that note from its inline title and taking "Update links?": the index equals the backend, no entry still points at the old path, the backlinks keep their count (4 → 4) and sources, every line's text has the new name, and the status bar reads the same "4 backlinks" before and after.
   - **Checked against the bug:** with the old echo stand-in put back, both checks fail.

One combined sabotage run had F1's `config.ts`, a no-op Ctrl+Tab and the echo stand-in. It failed on exactly the expected checks:
- `ctrl_tab` and `ctrl_shift_tab`, two checks each;
- `enter_plain_fresh_long`;
- the edit links and `rename_linked`;
- also `typing_big_note`: with the echo stand-in, the input event reached 656 ms.

With all three fixes, the script passes.

## How it was measured

`scripts/test-friction.mjs` (500 lines, in `npm test` at 5k; it takes `GROVE_FEEL_N`, and `GROVE_FRICTION_REPORT=1` prints every sample and asserts nothing).

**The harness.** The page gets one frame loop, Long Task and Event Timing observers, and a `MutationObserver`. For each action it records:
- the time from the action's own key or click (not a modifier) to the frame where the result shows, stamped with `performance.now()` in that frame's callback;
- long tasks over 50 ms, frame gaps (p95, max), input events over 16 ms, and the JS each input event ran;
- per-frame flags for an empty-state flash, a missing editor, an empty file tree, or an inline title out of step with the note;
- per-frame values of the tab label, the status-bar backlinks count, the backlinks pane, the word count and the search results, and any value that shows up in between (a flash);
- remounted editors, leaves, tab headers and file-tree rows;
- afterwards: focus, caret, scroll, current line, tab, header, title and tree selection.

**Link commands: real answers, Rust's time kept apart.** `link_index`, `backlinks` and `link_sources` are the mock's own, so they follow every edit and rename. In the app those run in Rust, off the page thread, so their time comes out of the page-side numbers.
- Microtasks queued either side of each call bracket the mock's synchronous work. That time is subtracted from long tasks, frame gaps, input events and the input-to-result time, and reported per flow as `rust`.
- The page still pays `JSON.parse` on each reply.
- At 5k, the mock spends 38–53 ms per file change in these commands. Those are dev-only costs, not the app's.
- Search still runs in the mock, on the page, and is counted.

(The first F1 commit answered from the page's own index instead, which could never show a change; see Review fixes.)

**Two measuring traps:**
- Chromium can stamp a CDP-dispatched event late, which once produced a 3.6 s "keydown". Event Timing entries that started before the action was armed are therefore dropped.
- CDP sends `z` with Shift held, while a keyboard sends `Z`. CodeMirror reads the first as Ctrl+Z, so the script sends capitals with Shift. Without that, "redo" looked like a second undo, which would have been a false finding.

## Findings

Ranked by how often a user hits it times how much it hurts. Numbers are at 5k, headless Chromium, from the run before the fixes and the run after.

| # | Flow | What a user feels | Before | After | Cause | Fix |
|---|---|---|---|---|---|---|
| 1 | Quick switcher, command palette: Esc | Lose their place: a long note jumps to its first line, the caret off screen | scroll 182,416 → 0 (switcher), 109,430 → 0 (palette) | unchanged (182,405 → 182,405; 110,098 → 110,098) | `prompt.ts` restored focus with a plain `focus()`; on the note's content element that scrolls its top into view | `focus({ preventScroll: true })` |
| 2 | Confirmation dialog: Esc (Delete current file → cancel) | Same jump to the top | 139,020 → 0 | 138,810 → 138,810 | Same, in `confirm.ts` | Same |
| 3 | Settings, image zoom: close | Same pattern | Settings didn't jump in this run: it only refocuses when focus fell to the body. Image zoom wasn't driven | — | Same plain `focus()` in `settings/modal.ts` and `editor/imageZoom.ts` | Same, as a guard |
| 4 | Typing: Enter on a list item in a long note, just after jumping there | An extra step: retype `- ` by hand | `""` after Enter (a just-opened copy of the 5,000-line note at line 4,500; also the Big note's end with the caret off screen) | `"- "`; that first Enter 43–46 ms of JS once, no long task. Plain Enter unaffected (review fix) | The background parse stops about 100,000 characters past the screen and reaches a jumped-to caret about 100 ms later; `insertNewlineContinueMarkupCommand` reads whatever tree exists | Parse to the caret first (`forceParsing`, 100 ms cap) in `editor/config.ts`, only on a line that starts with a list marker, `>` or indentation. Ranked high in F1; the window turned out to be only about 100 ms after a jump |
| 5 | Sidebars: resize the left one | Can't: there's nothing to drag | width +0 px after an 80 px drag; nothing saved | +80 px; saved width equals the shown width | No handle was ever added for the left dock; only the right width was saved | Handle on the left dock's right edge (`main.ts`, `sidedock.css`), `leftWidth` in the saved layout (`prefs.ts`), and the drag highlight only on the dragged handle (`sidedock.ts`) |
| 6 | New note (Ctrl+N), rename Enter, Esc out of a rename | A short hitch | page-side 46–52 ms to the result, 40–48 ms of JS on the key, no page-side long task (the first F1 run counted 50–58 ms long tasks, part of them the mock's link work); at 20k: see below | not changed | Each file-list change rebuilds every visible tree row and re-sorts the vault (13.8 ms of `render` at 5k), then forced layouts read on the dirty tree (`rememberPane`'s `scrollTop`, the title's blur, about 10 ms each) | **P6** (file-tree incremental updates and virtualization). Reported as a known gap by the script. Moving the `scrollTop` read wouldn't remove the layout, only move it |
| 7 | Reveal active file, expanding a 6,700-row folder (20k) | A hitch | 5k: keydown 48 ms, no long task. 20k: 194 ms reveal, 72 ms expand | not changed | Same tree rebuild, plus every row of the opened folder in the DOM | **P6** |
| 8 | Search as you type (20k) | Keystrokes lag | 5k: last key → results 16 ms. 20k: two long tasks, max 110 ms | not changed | The mock's search runs on the page; in the app it's Rust, async | **P5** (parallel, cancellable search). Re-measure in the app after P5 |
| 9 | Jumping to the end of a long note just opened | Unstyled Markdown for a moment | 145 ms (8 frames) before the end is styled | not changed | CodeMirror parses past 100,000 characters in idle slices | Not fixed: forcing the parse there would trade 8 unstyled frames for one ~50 ms frame. Same in any CodeMirror 6 editor |
| 10 | Clicking a sidebar tab header (Files, Search), toggling a sidebar | Keyboard focus goes to the page body | focus `body` | not changed | Tab headers aren't focus targets | Not changed: hotkeys still work from the body, and I couldn't confirm which element Obsidian focuses here without Obsidian. Recorded only |
| 11 | Clicking a file in the tree, then arrow keys | The arrows move the caret in the note | focus `editor` after the click | not changed | Opening a file from the tree focuses the note, which is what lets you type at once | Not a defect: it matches Obsidian as far as I know |

**Measured and fine at 5k** (budget in brackets):

| Flow | Result |
|---|---|
| Open from the tree, a `[[link]]`, back/forward buttons and Ctrl+Alt+←/→, Ctrl+click and middle-click to a new tab (≤ 50 ms) | painted in 8–16 ms; no long task; focus in the note; tab, header, inline title and tree selection right; no flash; the backlinks pane and count go straight from the old value to the new one |
| Tabs: new, Ctrl+W, Ctrl+Tab and Ctrl+Shift+Tab (each must land on the neighbouring tab), clicking a tab, Ctrl+Shift+T | 9–17 ms; the 5,000-line note comes back at the same caret (193,227) and scroll (78,022–91,021) after a tab switch, a close-and-reopen, and Back from a link |
| Typing 22 characters mid-document in the 5,000-line note, through the autosave and link refresh (0 frames over 20 ms; input ≤ 16 ms) | max frame 17 ms, no event over 16 ms, no long task, word count live |
| `[[` suggester | opens about 1 frame after the second `[`; Enter writes `[[river signal 4]]` with the caret after it; Esc keeps `[[]]`; undo/redo step correctly |
| Quick switcher and command palette (≤ 100 ms to open; ≤ 16 ms of JS per keystroke; ≤ 50 ms from the last keystroke to its results) | open in 17 ms with the input focused; 1–6 ms of JS per keystroke; last key to results 16–17 ms; Enter and Ctrl+Enter land in the note |
| Enter on a list item with its line on screen (≤ 16 ms, no input event over 16 ms) | 16–17 ms, 3 ms of JS |
| Search (≤ 100 ms last key to results) | 16 ms; a click opens at the match, selected and on screen, including one 4,200 lines into the long note; clearing empties the results |
| Sidebar toggles, tab switches, resizing, hovering down the tree, folder expand/collapse | no long task; the collapse slide is the existing motion |
| New note (Ctrl+N) | title focused with "Untitled" selected; Enter moves into the body; tab, header and tree all show the new name with no flash; Esc keeps the old name and returns to the note |
| Splits | split right, click into the other pane, close: focus stays in a note |

## 20k (report only, not in `npm test`)

`GROVE_FEEL_N=20000 node scripts/test-friction.mjs`, re-run with the review fixes, page-side numbers.
- The fixed checks and the new link checks all pass at 20k too:
  - the edit: index equals the backend, the backlink has its text;
  - the linked rename: 4 → 4 backlinks, the same sources and status label.
- The only budget miss it lists is `folder_expand` (one 76 ms long task).
- The new-note and rename hitches print as the known P6 gap.

| Flow | 20k |
|---|---|
| Open from the tree / link / back / Ctrl+Tab / tab switch | 10–32 ms painted, no long task |
| Typing in the 5,000-line note | max frame 17 ms, no long task (the mock's link commands: 157 ms, Rust's in the app) |
| Enter: list item on screen / plain line just after a jump | 17 ms / 24 ms (a letter there 23 ms) |
| Switcher, palette | open 17 ms; up to 11 ms of JS per keystroke; last key → results 17 ms |
| Search: typing `lantern` | 2 long tasks, max 110 ms (P5); last key → results 29 ms |
| New note, rename Enter, rename Esc, linked rename | long task 209, 213, 189, 214 ms (P6) |
| Reveal active file | long task 199 ms (P6) |
| Expand a 3,333-row folder | long task 76 ms (P6) |
| Back to the Files tab after Search | long task 52 ms (tree shown again, P6) |
| Resize either sidebar | no long task, max frame 50 ms |

## Focus, flicker, extra steps, stale display

**Checked in the script:**
- **Focus:** where it lands after every action. It goes to the note after any open, switch, close, Esc, Enter in a prompt, rename Enter or Esc, and closing a split; the query box takes it on Ctrl+Shift+F, and the inline title on Ctrl+N with "Untitled" selected.
- **Caret and scroll:** on returning to a long note, by tab, by Back, by reopening a closed tab, and by closing a prompt or confirmation.
- **Flicker:**
  - per-frame empty-state, missing-editor, empty-tree and wrong-title flags, all zero in every flow;
  - in-between values of the tab label, backlinks count, backlinks pane, word count and search results: none, apart from expected live updates (the word count while typing, the search count narrowing);
  - remounts: only closing a split removes an editor. Every file-list change rebuilds the root tree rows (P6), within one frame.
- **Stale display, asserted:**
  - after every open and switch: the tab label, view header and inline title match the note;
  - after reveal and a rename: the tree selection matches;
  - after rename Enter: tab, header and tree show the new name;
  - after an edit and its autosave: the page's link index equals a fresh backend answer, and the new link is in it and in the target's backlinks, with the line's text;
  - after a linked rename: the index again equals the backend, the old path is gone, and the backlink count, sources and status-bar label are unchanged.
- **Stale display, reported but not asserted:** the status-bar backlinks count and the word count after an open. They're printed per flow and looked right in every run (for example 1, 2 and 989 backlinks for the notes opened), but the script doesn't compare them with an expected value.
- **Seen with the real link answers, and correct:** during a linked rename, the status bar and backlinks pane read "0 backlinks" while "Update links?" is open, then return to "4 backlinks" once the links are rewritten. While the prompt is open, the links really do still point at the old name, so this isn't stale. The first F1 run couldn't show it, because its stand-in never changed.
- **Extra steps:** list continuation (fixed), the left resize (fixed), Enter after a rename (moves into the body), and a search click (lands on the match).

**Only reasoned about, without a real window (WebKitGTK):**
- `focus({ preventScroll: true })` is supported in WebKitGTK as in Safari 15 and later, so the Esc fix should behave the same there. The page code takes the same path.
- WebKitGTK's JavaScript is slower than V8, so the one-off parse, about 45 ms for a list Enter just after a jump deep into a 386 KB note, may be longer there. It's still capped at 100 ms, after which Enter behaves as before.
- Frame timing in WebKitGTK is capped at 60 Hz (WEBKIT_HZ notes), so frame-gap numbers here are a floor, not a measurement of the app.

**Ruled out:** a backlinks pane or count flash on note switch (checked with the right sidebar open); a stale tab or title after a rename; a lost caret or scroll on tab switch, Back, or close-and-reopen; focus left in a closed prompt; the tree scroll jumping on a new note (it reveals the new row, as intended); a typing hitch from the autosave and link refresh at 5k (with the mock's link work counted as Rust's, not the page's).

## Recorded for later pieces (not done here)

- **P6 (file tree):** every file-list change rebuilds every visible root row and re-sorts the vault. Page-side, with the mock's link work taken out:
  - new note, rename and rename-cancel cost 40–48 ms of JS at 5k (no task over 50 ms);
  - at 20k they're long tasks of 189–214 ms, and so is a linked rename. Reveal and expanding a large folder are 194 ms and 72 ms at 20k, and showing the Files tab again 52 ms. The script prints these as a known gap; P6's incremental updates and virtual rows are the fix.
- **P5 (search):** typing in search at 20k has two long tasks (max 110 ms), all in the mock's page-side search. Re-measure in the app after P5.
- **P2, P4, P8:** nothing new. Typing with the link refresh is clean at 5k and 20k with the link commands off the page. The graph wasn't in these flows; the switcher opens in 16 ms and filters within the budget at 20k.
- **Rust:** nothing needed.
- **Mock only:** the mock's synchronous link commands cost 38–53 ms per file change at 5k and 150–320 ms per flow at 20k. The script reports these as `rust` and keeps them out of the page-side numbers. They're dev-only, not the app's cost.
- **CodeMirror:** just after a jump deep into a long note, any edit (a letter or a plain Enter) spends up to 20 ms parsing toward the screen. That's CodeMirror's fixed per-edit slice, for about 100 ms until the background parse catches up. It's measured, not changed.

## Tests and checks

- **`scripts/test-friction.mjs`** at 5k: passes.
  - **First F1 commit:** with the product changes reversed (`git apply -R`), it failed on exactly six checks: `enter_list_item`, `enter_list_fresh_long`, `switcher_esc`, `palette_esc`, `confirm_esc`, `resize_left`.
    - Since the review fix, `enter_list_item` puts the line on screen first, as a user has it. On the old code it now fails only `enter_list_fresh_long`'s continuation, which is the case the fix is for.
  - **Review fixes:** the sabotage run listed under Review fixes.
  - It runs in about a minute and is in `npm test`, after `test-feel.mjs`.
- **`src/editor/config.test.ts`:** the cold-note Enter test, which fails on both F1's code and the code before F1.
- **`scripts/test-feel.mjs`:** budgets unchanged; the graph is still the reported known gap.
- **No assertion anywhere was weakened.**
- **Full runs on the final tree, first run, no retry:**
  - `flock /tmp/grove-npm-test.lock npm test` (with `posttest`): exit 0, after the review fixes. Vitest 99 files, 1,545 tests. P0 at 5k passed, with the graph reported as its known gap. The friction script passed, printing the P6 gap (linked rename, 62 ms) and the known one-time list-Enter parse (45 ms).
  - `npm run build`: passed. The existing Vite large-chunk warning remains.
  - `npm run audit:offline`: passed. 220 source files, dist, CSP, capabilities and dependencies checked.
  - `cargo test`: not run, because no Rust changed.

## Line counts

| File | Added | Removed |
|---|---:|---:|
| `app/src/editor/config.ts` | 13 | 3 |
| `app/src/main.ts` | 4 | 2 |
| `app/src/shell/prefs.ts` | 4 | 1 |
| `app/src/shell/prompt.ts` | 2 | 1 |
| `app/src/shell/sidedock.ts` | 2 | 0 |
| `app/src/shell/confirm.ts` | 1 | 1 |
| `app/src/settings/modal.ts` | 1 | 1 |
| `app/src/editor/imageZoom.ts` | 1 | 1 |
| **TypeScript, app code** | **28** | **10** |
| `app/src/styles/sidedock.css` | 9 | 1 |
| **CSS** | **9** | **1** |
| `app/src/editor/config.test.ts` | 18 | 1 |
| `app/scripts/test-friction.mjs` (new) | 500 | 0 |
| `app/package.json` (the script in `npm test`) | 1 | 1 |
| `NOTES_F1-claude.md` | this file | |

- **App code net:** +26 lines (TS +18, CSS +8), far under the +300 limit. Counts are against the brief commit `e4cdb65`, review fixes included.
- **No new dependency.** `forceParsing` comes from `@codemirror/language`, already a dependency.
- **Files near 800 lines:** none touched. `main.ts` is 541, `editor/config.ts` 151, `shell/prompt.ts` 199.
- **Dead code:** none was made dead.
