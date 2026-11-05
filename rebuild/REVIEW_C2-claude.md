# Review: C2 Calendar view (Grok b, `rebuild/c2-grok-b` 3b283e3)

Reviewed 2026-11-05 on `rebuild/c2-review-claude`, which was created from `rebuild/c2-grok-b`. I checked the work against the C2 row of `rebuild/CINDER_GAP_PLAN.md` and against `rebuild/NOTES_C2-grok-b.md`. Nothing was pushed and no packages or crates were added.

## Against the plan

| Plan item | Result |
|---|---|
| Right-sidebar view on the `sideView.ts` pattern | Yes. `calendarView.ts` returns a `SideView`, and it does work only while active (`setActive` plus a `stale` flag). |
| Month grid, today marked | Yes. `monthGrid` gives 4 to 6 rows. Today gets `is-today` and `aria-current="date"`. |
| Dot on days that have a daily note | Yes. `dailyNoteDays` uses the same folder prefix and `dateNamePattern` as the base's previous/next commands. Formats with folders (`YYYY/MM/YYYY-MM-DD`) work. |
| Click opens or creates via `openDailyNote` | Yes. `openDailyNote` gained `where: OpenWhere = false`, and both of its `ws.open` calls pass it through. |
| Ctrl+click opens a new tab | Yes, through `whereFromEvent`. Cmd+click and middle-click also open a new tab, and Ctrl+Alt+click opens to the right. |
| Previous, next, Today | Yes. Today only moves the grid. It does not open a note. |
| Week-start setting | Yes. `daily-notes.json` `weekStart` is `monday` or `sunday` (default Monday). An invalid value sanitizes back to the default. It appears in Settings → Daily notes. |
| Updates on vault changes, reads `ws.vault.notes`, no I/O while drawing | Yes. A `files` or `show` change, or a daily-notes settings change, marks the view stale. Dots are cached on the identity of the `notes` array, and `Vault.refreshFiles` always replaces that array, so the cache is sound. `paint()` reads no files. |
| Part of the Daily notes core plugin | Yes. Turning the plugin off hides the tab (in `applyPlugins`) and disables `daily-notes:open-calendar`. The plugin description says so too. |
| No Tasks rings, no weekly/monthly notes | Yes, left out as Chris asked. Week numbers and month names are not clickable. |

The grid maths is right. I checked by hand the 1 August 2015 six-row month (both week starts), February 2021 Monday-start at exactly four rows, and the 1900/2000/2024 leap cases. The rule that drops a trailing row (`w >= 4 && !row[0].inMonth`) never drops a row that holds days of the month, because a month never has more than 31 days. The tests cover what the plan asked for. Vitest checks week start, leap years, the six-row month and folder prefixes. The browser script clicks a day with a note and one without, checks the template, the dot after a create, Ctrl+click in a new tab, the Sunday redraw, Today, and turning the plugin off.

## Fixed on this branch

**1. In a frameless window, the Local graph tab was under the window buttons and could not be reached.** This was the one real bug. C2 adds an eighth right-sidebar icon. To make room, it sets the icons to `flex: none` and lets the tab row scroll with its scrollbar hidden. I measured it in headless Chromium with `is-frameless` set and a 300px dock:

- The row's right padding is the 92px the window buttons cover. With that padding, the visible icon area ends at x = 1188.
- The Calendar tab sat at 1174–1202 (half covered). The Local graph tab sat at 1205–1233 (fully covered), so a click there would hit Minimize.
- `viewTabs.show()` was meant to scroll the selected tab into view, but it compared the tab with the row's border box. That box includes the covered padding, so selecting Local graph scrolled nothing. And since a vertical wheel doesn't scroll a horizontal row, a mouse user had no way to bring the icon out.

Before C2, Local graph was already 14px under the buttons (7 icons do not fit either), so C2 made an existing overlap worse. The fix:

- `src/shell/sideView.ts`: the visible edges subtract the row's left and right padding.
- `src/shell/rightSidebar.ts`: a vertical wheel over the right tab row scrolls it sideways, but only when the row overflows and the event has no horizontal delta.
- `scripts/test-calendar.mjs`: the test adds `is-frameless` and checks four things. The row overflows. Local graph starts under the buttons. `graph:show-local` scrolls it clear. `backlink:open` scrolls the row back, and a wheel event reaches Local graph.

With the source change reverted, the test fails at "selecting Local graph scrolls it clear of the window buttons". With the fix, it passes.

I could not check this fix in WebKitGTK, because the rules allow no GUI window. Chromium counts the end padding as scrollable overflow. Older WebKit did not. If WebKitGTK still doesn't, a 300px dock has nothing to scroll, and Local graph stays under the buttons. Finding 1 covers this.

## Findings left open

1. **Discoverability and WebKitGTK (medium).** At the default 300px dock in a frameless window, two icons are still hidden behind the window buttons until the row is scrolled, and nothing shows that the row scrolls. On top of that, it depends on WebKitGTK counting end padding as scrollable overflow (see above). It needs a check in the real app. One sturdier option: let the icons shrink below 28px when the row is short, which means dropping `flex: none` and reducing the button padding. Another: reserve the window-button room with a trailing spacer or a margin instead of padding. Either is a design choice, so I left it.
2. **Merging with C1 needs a follow-up (low). Resolved in the C1 merge below.** After the merge, the calendar has its own daily-note parser (`dailyNoteDays`, using `trimSlashes` and the raw format), while C1's `dailyNoteList` and `dailyNotePath` normalize differently. C1 also drops empty folder parts and `/` at either end of the format. So a format like `/YYYY/MM/DD` or a folder like `Daily//Sub` would create the note where C1 puts it, but the calendar would show no dot. When merging, `dailyNoteDays` should call C1's `dailyNoteList`, so all three places share one rule. Before the merge, C2 matches the base's `openDailyNote` and previous/next exactly.
3. **`opening` drops a second click (low).** While one day's note is being opened or created, a click on a different day is ignored silently. After C1, `openDailyNote` deduplicates creation of the same path itself (`creatingDaily`), so the guard could go away, or be keyed by day.
4. **Today's marker after midnight (low).** The marker updates only when the view repaints (on a file, show or settings change, or when the tab is selected). If the view stays visible past midnight, yesterday stays marked until something changes.
5. **ARIA shape (low).** `role="grid"` has `role="gridcell"` buttons directly under it, with no `role="row"`. That is invalid structure, and `gridcell` hides the button role from screen readers. Either add rows or drop the grid roles and keep the plain buttons with `aria-current`. `aria-selected` is valid only on the gridcell form.
6. **`weekStart` lives in `daily-notes.json` (note).** Obsidian's own Daily notes plugin writes that file with its own keys. Grove keeps unknown keys, but Obsidian may not. If the same vault is edited in Obsidian's Daily notes settings, the week start may fall back to Monday. Not a blocker. C1's `autorun` uses Obsidian's real key in the same file.

## Trial merge with `rebuild/c1-claude` (6887eae)

I did the trial merge in a scratch worktree, then threw it away. It was not committed. There were four textual conflicts, all from adding lines in the same place:

- `rebuild/app/package.json`: the `test` script ends in `test-calendar.mjs` on one side and `test-daily-notes.mjs` on the other. Keep both.
- `rebuild/app/src/settings/schema.ts`: C2's `weekStart` and C1's `autorun` go after `template`. Keep both.
- `rebuild/app/src/settings/sections.ts`: the "Start week on" dropdown and the "Open daily note on startup" toggle. Keep both.
- `rebuild/app/src/editorHost.ts`, `openDailyNote`: C2's `where` parameter against C1's `creatingDaily` rewrite. Take C1's body and keep C2's signature. Both `ws.open` calls pass `{ where }`, including `await ws.open((await creating).path, { where })`.

`appCommands.ts` and `main.ts` merged cleanly. With those resolutions, `tsc --noEmit` passed on the merged tree, and so did Vitest for `calendarGrid.test.ts` and `src/settings` (3 files, 18 tests). The semantic follow-up is finding 2. Git rerere recorded preimages for the four files in the shared `.git/rr-cache`. That only helps whoever does the real merge.

## Checks (on this branch, with the fix)

- `npm run build`: passed.
- `npm run audit:offline`: passed (193 source files, dist, CSP, capabilities, dependencies).
- `cargo test --offline` (src-tauri): 84 passed, 0 failed, 4 ignored. No Rust changed.
- `flock /tmp/grove-npm-test.lock npm test`: one uninterrupted run, exit 0, `posttest` included. Vitest: 81 files, 1,287 tests. Every browser script passed, including the extended `test-calendar.mjs` (the four frameless tab-row checks). The frame budgets held: 300-card pan and zoom frames under their 20ms ceiling, and 10,000-row list and notes scroll at p95 16.7–16.8ms, max 16.8ms. No search or index path changed, so the 5,000-note Rust bench was not re-run.
- `rebuild/round*-shots/` restored after the suite.

## C1 merge

On 2026-11-05 I merged `rebuild/c1-review-grok-a` (a13ed4d) into this branch with `--no-ff`. That branch is Claude's C1 (6887eae) plus Grok a's fix that keeps padded daily-note names visible. Nothing else was merged. The four conflicts were the ones the trial merge found, and each resolution keeps both sides:

- `package.json`: the `test` script runs `test-calendar.mjs` and then `test-daily-notes.mjs`.
- `settings/schema.ts`: `weekStart` and `autorun` both follow `template`.
- `settings/sections.ts`: "Start week on" and "Open daily note on startup" both stay.
- `editorHost.ts`: C1's `openDailyNote` body (`dailyNotePath`, `existingDailyNote`, `creatingDaily`) with C2's `where: OpenWhere = false`. Both `ws.open` calls pass `{ where }`.

Follow-up (finding 2): `dailyNoteDays` in `calendarGrid.ts` now calls C1's `dailyNoteList`, and `dailyNoteTime` goes through it too. Its own prefix and pattern code is gone, along with the `trimSlashes` and `isNoteFile` imports. The dots, the open/create path and previous/next now share one rule. That rule covers C1's normalization of empty folder parts and slashes at either end of the format, as well as Grok a's padded names. Drawing still does no I/O. The view keeps its cache on the identity of `ws.vault.notes`, and `paint()` reads only that list and the settings. A new Vitest case, "dots follow the path openDailyNote writes and the notes it opens", covers two cases. With folder `Daily//Sub/` and format `/YYYY/MM/DD`, the note is written to `Daily/Sub/2026/10/03.md`, and that day gets a dot. With format `YYYY-M-D`, the padded `Journal/2026-10-03.md` is the note `existingDailyNote` opens, and it gets a dot too. With the old `calendarGrid.ts`, this case fails (`expected [] to deeply equal [ 1791010800000 ]`). With the change, it passes.

Finding 2 is resolved. Findings 1 and 3 to 6 are unchanged. Finding 3 is still open: `openDailyNote` now deduplicates creation, so the view's `opening` guard could be dropped.

Checks on the merged tree:

- `npm run build`: passed.
- `cargo test --offline` (src-tauri): 84 passed, 0 failed, 4 ignored.
- Vitest `calendarGrid.test.ts` and `src/settings`: 3 files, 20 tests passed.
- `flock /tmp/grove-npm-test.lock npm test`: one uninterrupted run, exit 0, `posttest` included. Vitest: 81 files, 1,293 tests. Every browser script passed, including `test-calendar.mjs` (the frameless tab-row checks too) and C1's `test-daily-notes.mjs` (startup open once, two opens create once). The frame budgets held: 300-card pan and zoom frames under 20ms, and 10,000-row scroll at p95 16.7ms, max 16.8ms.
- `npm run audit:offline`: passed (193 source files, dist, CSP, capabilities, dependencies).
- `rebuild/round*-shots/`: restored after the suite.

## Merge with integration 5760368

On 2026-11-05 I merged `rebuild/integration` (5760368: X1, BX1, M0a, WK1, T1, I1, I2) into this branch, from 7783b9c, on `rebuild/c2-merge-claude`, with `--no-ff`.

There was one conflict:

- `package.json`, the `test` script: integration added `test-template-merge.mjs` after `test-paste.mjs`, and this branch added `test-calendar.mjs` and `test-daily-notes.mjs` at the end. The resolved script is integration's line with the two daily-notes tests appended. Each side had nothing else of its own, and `posttest` did not conflict.

`appCommands.ts` and `editorHost.ts` merged cleanly. The two sides touched separate code: T1's template merge and I1/I2's attachment saving on one side, C1's daily-note list and `openDailyNote` on the other. No code changed beyond the resolution.

Checks on the merged tree:

- `npm run build`: passed.
- `cargo test --offline` (src-tauri): 102 passed, 0 failed, 4 ignored.
- `flock /tmp/grove-npm-test.lock npm test`: the first run passed the whole `test` script. It then failed in `posttest`, on one 33.3ms typing frame in `test-bases-embed.mjs` (limit 20ms). That run overlapped my own `cargo test`. The script passed three times on its own, at 16.7–16.8ms. A second full run, with nothing else of mine running, exited 0 with `posttest` included. Vitest: 84 files, 1,360 tests. Every browser script passed, including `test-template-merge.mjs`, `test-calendar.mjs` and `test-daily-notes.mjs`.
- `npm run audit:offline`: passed (196 source files, dist, CSP, capabilities, dependencies).
- `rebuild/round*-shots/`: restored after the suite.

## Verdict

VERDICT: OK

C2 does everything in its plan row. The grid maths is right, and dots are read from `ws.vault.notes` with no I/O while drawing. Click, Ctrl+click and middle-click open or create the note through `openDailyNote`. The week-start setting sanitizes and saves as it should, and the view belongs to the Daily notes plugin. The tests cover what the plan asked for. The one real bug was that, in a frameless window, the eighth tab pushed Local graph under the window buttons, where it could not be reached. That is fixed here, with a test that fails without the fix. What is left is low severity, apart from finding 1, which needs a check in the real WebKitGTK app. C1 (`rebuild/c1-review-grok-a`) is now merged into this branch. The four conflicts were resolved so that both sides keep their behaviour. The calendar dots use C1's `dailyNoteList`, with a test, and every check passes on the merged tree.
