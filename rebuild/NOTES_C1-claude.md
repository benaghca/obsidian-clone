# C1: daily-note gaps

Branch `rebuild/c1-claude`, from `rebuild/integration` at `b5d0a34`. One local commit, not pushed.

Scope, as Chris chose: core Obsidian-style daily notes only. No weekly or monthly notes (C3 is not approved), no Templater.

## What was missing

- `formatDate` had no week-year tokens. `GGGG` (the ISO week-year, which goes with `W`/`WW`) and `gggg` (the locale week-year) came out as literal text.
- A date format with folders (`YYYY/MM/YYYY-MM-DD`) mostly worked, but nothing tested it. The Rust `create_note` already creates parent folders (`fsutil::replace` → `create_dir_all`), and the index adds them (`upsert_note` → `ensure_dirs`). The mock does the same. Previous/next matched the nested path against the format. Three things were wrong at the edges:
  - `dateNamePattern` let the last repeat of a token win. So `Journal/2026/09/2026-10-03.md` counted as 3 October, even though *Open today's daily note* would never look there.
  - A weekday in the name was not checked, so `Monday 2026-10-03` was 3 October (a Saturday).
  - A leading, trailing or doubled `/` in the format gave a path with an empty folder. The folder setting had its slashes trimmed; the format did not.
- There was no *Open daily note on startup*.

## What changed

**Tokens** (`src/settings/dateFormat.ts`). Added `GGGG`, `GG` (ISO week-year), `gggg`, `gg` (locale week-year) and `w`, `ww` (locale week; without it `gggg` has nothing to pair with). Locale means Moment's default English locale: weeks start on Sunday, and week 1 is the one holding 1 January. One `week(d, firstDay, anchor)` helper now does both kinds of week; `isoWeek` used to be its own function. The token switch moved from inside `formatDate` into `formatToken`, so the parser can write one token without a regex pass.

**Name parsing** (`dateNamePattern`). Every date token is now captured. A name belongs to a day only if every date part agrees with that day:
- a repeated year, month or day must be the same text;
- weekdays, week numbers, week-years, `Do` suffixes and one-digit `M`/`D` must be what that day writes;
- time tokens (`HH`, `mm`, `A`, …) still match any digits, as before.

Patterns are cached per format (at most 32 kept).

**Paths.** Three new pure functions, used by both the create path and previous/next:
- `dailyNotePath(date, {folder, format})` joins the folder and the formatted date, dropping empty folder parts.
- `dailyNoteList(paths, {folder, format})` lists the daily notes, oldest first.
- `adjacentDailyNote(list, path, dir)` gives the previous or next one.

Because of this, opening a day and stepping between days always agree on where a note goes.

**Opening and creating** (`src/editorHost.ts`, `openDailyNote`). Builds the path with `dailyNotePath`. Creation goes through a per-path in-flight map, so two opens of a missing day at the same moment make one note: startup plus a click, or a double click. Before, the second `create_note` failed with "already exists".

**Previous/next** (`src/appCommands.ts`). Use `dailyNoteList`, kept until `ws.vault.notes` (a new array on every refresh) or the folder/format changes. Their command checks run whenever the palette or a hotkey asks, and used to rescan the vault each time.

**Startup** (`src/main.ts`, `src/settings/schema.ts`, `src/settings/sections.ts`).
- New setting `daily-notes.json` → `autorun`, off by default. That is the key Obsidian's own `daily-notes.json` uses, so M0b's import can map it as is.
- New toggle row *Open daily note on startup* in Settings → Daily notes.
- After the layout is restored, `openDailyOnStartup` runs once. It skips note windows (`?note=`), the Daily notes plugin when it's off, and a missing vault. If today's note is already in a tab, that tab is shown. Otherwise `openDailyNote` opens it in the active tab (a pinned tab gets a new one, as with any open) or creates it.
- It is a single top-level call in the startup sequence. Nothing calls it again: not a settings change, a vault refresh or a layout change. A page reload or a vault switch (which reloads) is a new startup and opens it again.

| File | Added | Removed |
| --- | ---: | ---: |
| `rebuild/app/src/settings/dateFormat.ts` | 149 | 63 |
| `rebuild/app/src/settings/dateFormat.test.ts` | 97 | 1 |
| `rebuild/app/scripts/test-daily-notes.mjs` (new) | 133 | 0 |
| `rebuild/app/src/editorHost.ts` | 26 | 12 |
| `rebuild/app/src/appCommands.ts` | 12 | 20 |
| `rebuild/app/src/main.ts` | 16 | 1 |
| `rebuild/app/src/settings/schema.ts` | 2 | 0 |
| `rebuild/app/src/settings/sections.ts` | 1 | 0 |
| `rebuild/app/package.json` (new script in `npm test`) | 1 | 1 |
| `rebuild/SETTINGS_NOTES.md` (Daily notes row) | 1 | 1 |

No Rust changes: the backend already creates the folders. The date logic stays in TypeScript next to `formatDate`, where it already was. Moving it to Rust would add an IPC round trip to each palette check for no gain. No new packages or crates.

## Tests

`dateFormat.test.ts`, four new tests:
- **Week-years around New Year.**
  - 31 Dec 2026 → `2026-W53` / `2027-w01`.
  - 1 Jan 2027 → `2026-W53`.
  - 3 Jan 2027 → `2026-W53` / `2027-w02`, and 4 Jan 2027 → `2027-W01`.
  - 30 Dec 2024 → `2025-W01`; 28/29 Dec 2024 → `2024-w52` / `2025-w01`.
  - 1–2 Jan 2022, 27 Dec 2020, 1 Jan 2021.
  - A sweep of every day from 2020 to 2028: `GGGG` is always the year of that week's Thursday.
- **Parts must agree.** `2026/09/2026-10-03` and `2025/10/2026-10-03` are refused. `Monday 2026-10-03` is refused, `Saturday 2026-10-03` is accepted. `GGGG/[W]WW/…` with the wrong week or week-year is refused. A `HHmm` time still parses.
- **`YYYY/MM/…` round-trip.** `dailyNotePath` with the folder `Journal`, `/Journal/` and `/YYYY//MM/DD/`. For five folder formats (`YYYY/MM/YYYY-MM-DD`, `YYYY/MMMM/Do dddd`, `GGGG/[W]WW/YYYY-MM-DD`, `gggg/ww/ddd D MMM YYYY`, `YYYY//MM/DD`), every day from 20 Dec 2024 to 11 Jan 2025 gets its own path, and that path lists back as the same day, in order.
- **Previous/next across folders.** November → December → January across the year folder; both ends give null. Excluded: the wrong month folder, a non-date note, a note outside the format's folders, a note outside the daily folder, and a `.canvas`. Also checked with no daily folder.

`scripts/test-daily-notes.mjs` (new, headless Chromium on the mock vault, added to `npm test`). A hook installed before the app's scripts load counts every `ws.open` and every `vault.written` (each `createNote` calls it) across reloads. It checks:
1. Off by default; a start with it off creates and opens nothing.
2. On, folder `Journal`, format `YYYY/MM/YYYY-MM-DD`: one reload creates today's note **exactly once**, opens it **once**, in one tab, with the `Journal`, year and month folders in the file list.
3. Toggling the setting, a vault refresh and opening another note afterwards: still one create and one open.
4. Two `openDailyNote` calls at once for a missing day: one create, no error. *Previous daily note* then goes from tomorrow's note to today's across the folders.
5. Today's note already in a tab that isn't active: that tab is shown. The active tab keeps its note, and nothing is created.
6. Daily notes plugin off: nothing opens.
7. A `?note=` window: nothing opens.

11 checks, all pass.

`npm run build`: passes (the existing chunk-size warning only). `npm run audit:offline`: passes. `cargo test --offline` in `rebuild/app/src-tauri`: 84 passed, 4 ignored. `flock /tmp/grove-npm-test.lock npm test`: passes (exit 0, including `posttest`; `test-daily-notes.mjs` ran inside it). The run rewrote files in `rebuild/round23-shots/` to `round33-shots/`; those were restored with `git restore`, and nothing untracked was left there.

## Benchmark

None of the existing `bench-*` scripts cover daily notes. A scratch micro-benchmark (not committed) used 20,000 note paths, 3,000 of them daily notes in `Journal/YYYY/MM/YYYY-MM-DD.md`, median of 7×20 runs:

| | before | after |
| --- | ---: | ---: |
| One full scan for previous/next | 1.07 ms | 1.24–1.32 ms |
| A previous/next command check (palette, hotkey) | 1.07 ms (rescans) | 0.01 ms (kept list) |

The full scan is about 0.2 ms slower because of the stricter agreement checks. It now runs only when the notes or the setting change, so the call that repeats is about 100× faster. `test-links-embeds-edge.mjs`'s `format_date` and `fill_template` timings are unchanged (0 ms).

## Left as it is

- `D`/`M` are now strict, so `2026-10-03` read with format `YYYY-MM-D` does not count. Grove writes `3` for that format and would never look for `03`. Say if you want that leniency back.
- The startup open replaces the restored active tab's note, as a click on *Open today's daily note* does; the replaced note stays in that tab's Back history.
- Weekly/monthly notes, the calendar view and Templater are out of scope (C2, C3).
