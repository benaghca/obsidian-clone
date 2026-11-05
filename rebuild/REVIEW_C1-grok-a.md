# C1 review: daily-note gaps

Reviewed `6887eae` (`C1: week-year tokens, daily notes in format folders, open on startup`) on `rebuild/c1-review-grok-a`, against the C1 row of `rebuild/CINDER_GAP_PLAN.md` and `rebuild/NOTES_C1-claude.md`. Core daily notes only. No weekly or monthly notes, no Templater.

The tokens, folder paths, and startup setting match the plan. One match was too strict for a vault that already has daily notes: with a format like `YYYY-MM-D`, `2026-10-03` was no longer a daily note. That is restored. Grove still writes the short form.

## What the plan asked for

| Ask | Where it landed |
|---|---|
| `GGGG` / `gggg` (and `GG`, `gg`, `w`, `ww`, which they need) | `formatDate` / `formatToken` in `src/settings/dateFormat.ts`. One `week()` helper. ISO is Monday-first, week 1 holds the year's first Thursday. `gggg` / `w` are Moment's English locale: Sunday-first, week 1 holds 1 January. |
| Folder formats for create and previous/next | `dailyNotePath`, `dailyNoteList`, `adjacentDailyNote`. `create_note` already makes parent directories. Previous/next keep the list until `ws.vault.notes` or the folder or format changes. |
| *Open daily note on startup*, off by default | `daily-notes.json` → `autorun` (Obsidian's own key). Toggle in Settings → Daily notes. `openDailyOnStartup` runs once, after the layout is restored. It skips a note window (`?note=`), a disabled Daily notes plugin, and a missing vault. |

`dateNamePattern` now requires every date part to agree with the day. `2026/09/2026-10-03` is not 3 October, and `Monday 2026-10-03` is not that Saturday. Time tokens (`HH`, `mm`, `A`, …) still match any digits. Impossible dates still fail the calendar round-trip.

## Leading zeros

This was not safe to leave strict.

Moment's strict parse uses `\d\d?` for `D`, `M`, `W`, and `w` (the two-digit tokens `DD`, `MM`, `WW`, `ww` are the ones that require two digits). Obsidian's daily-note lookup uses that strict parse, so a file named `2026-10-03.md` is still 3 October when the format is `YYYY-MM-D`. The parser Grove had before this commit did the same. The new agreement check compared the captured text to the short form `3`, so the file dropped out of previous/next.

That shows up when a vault used `YYYY-MM-DD` (the default, and what both apps write for it) and the format was later changed to `D` or `M`, and when a name was written with a zero by hand. The default format itself is unaffected: `YYYY-MM-DD` still requires `03`.

`partAgrees` now treats `03` and `3` as the same value for `M`, `D`, `W`, and `w`. `formatDate` is unchanged, so Grove still writes `2026-10-3`. `existingDailyNote` is what open and startup use: the path Grove would write wins when it exists; otherwise an older name that still parses as that day is opened. A second file is created only when the day has no note.

`DD` and `MM` stay two digits. `2026-10-3` is not a daily note under `YYYY-MM-DD`, which matches Moment's strict mode and the previous parser.

## Week-years

The New Year cases in `dateFormat.test.ts` match the ISO and locale rules (31 Dec 2026 is `2026-W53` and `2027-w01`, 4 Jan 2027 is `2027-W01`, 30 Dec 2024 is `2025-W01`). A separate sweep of every day from 2015 through 2035 compared `week()` with Moment's `weekOfYear` (`dow` 1 / `doy` 4 for ISO, `dow` 0 / `doy` 6 for the English locale) and with the old ISO week-number function. No mismatches.

A format that uses `GGGG` or `YY` and no `YYYY` still does not parse. `GGGG-MM-DD` also collides: 1 Jan 2026 and 1 Jan 2027 both write `2026-01-01`. Week-year tokens are checked when `YYYY` supplies the day. They are not a second way to name that day. Left as it is.

## Folders and startup

`dailyNotePath` joins the folder and the formatted date and drops empty segments. `YYYY/MM/YYYY-MM-DD` round-trips across 20 Dec 2024–11 Jan 2025, including the New Year folder change. Previous/next steps November → December → January and returns null at either end. A wrong month folder, a note outside the format, a note outside the daily folder, and a `.canvas` stay out of the list.

One round-trip hole: a format segment that writes nothing (`YYYY/[]/MM-DD`, or `//`) was removed from the path Grove created and left in the pattern Grove read, so the new note was invisible to previous/next. `dailyParts` now drops a segment whose text is empty, for both the path and the pattern.

Startup is one call after `restoreLayout`. The headless check `scripts/test-daily-notes.mjs` (in `npm test`) covers it:

- Off by default: a start creates and opens nothing.
- On, folder `Journal`, format `YYYY/MM/YYYY-MM-DD`: one create, one open, one tab, and the year and month folders exist.
- Toggling the setting, refreshing the vault, and opening another note do not create or open it again.
- Two `openDailyNote` calls for a missing day make one note. Previous then crosses the month folder.
- Today's note already in a background tab is shown. Nothing is created.
- Daily notes turned off, and a `?note=` window: nothing opens.

All of those passed in this run. If today's note is not already in a tab, startup opens it in the active tab (a pinned tab gets a new one), the same as *Open today's daily note*. The replaced note stays in that tab's Back history. That is the command's existing behaviour.

## Tests and a scan timing

`dateFormat.test.ts` gained the leading-zero cases (`YYYY-MM-D` reads `2026-10-03` and still writes `2026-10-3`, same for `M` and `W`, a padded weekday name, the strict path preferred when both names exist) and the empty-segment round-trip. The disagreement cases (`2026/09/2026-10-03`, the wrong week, `YYYY-MM-DD` refusing `2026-10-3`) stay refused.

A scratch timing, not committed: 20,000 paths, 3,000 of them `Journal/YYYY/MM/YYYY-MM-DD` daily notes, 20 runs. Full scan median 1.30 ms (Claude's after-number was 1.24–1.32 ms). A lookup on the list previous/next keeps was 0.02 ms. The scan runs when the notes or the setting change, not on every palette check.

## Left as it is

- `Do` still has to match the written suffix (`3rd`, not `03rd`). Real daily notes use `3rd`.
- `Q` and the weekday number `d` stay one digit wide, as in Moment's strict parse.
- When both `2026-10-3.md` and `2026-10-03.md` exist, open uses the short name. Previous/next still lists both, in date order.
- Weekly notes, monthly notes, the calendar view, and Templater are C2 and C3.

## Checks

From `rebuild/app`:

- `npm run build` passed (`tsc --noEmit` and vite). The existing chunk-size warning only.
- `flock /tmp/grove-npm-test.lock npm test` passed (exit 0), including `posttest`. Vitest: 80 files, 1287 tests. `test-daily-notes.mjs` passed all 11 checks.
- `npm run audit:offline` passed: 191 source files, dist, CSP, capabilities, and dependencies.
- `cargo test --offline` in `rebuild/app/src-tauri`: 84 passed, 0 failed, 4 ignored.

The test run rewrote files under `rebuild/round23-shots/` through `rebuild/round33-shots/`. Those were put back with `git restore`. No untracked shot files were left.

VERDICT: OK

The plan items are in place, week-years and folder round-trips hold, and startup creates or opens today's note once. The leading-zero match was the one behaviour that would hide an existing daily note; reading is lenient again and writing stays strict. What remains does not drop notes a normal daily-note format would create.
