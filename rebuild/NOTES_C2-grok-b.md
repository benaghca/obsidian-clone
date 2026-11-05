# C2: Calendar view

Implemented 2026-11-04 on `rebuild/c2-grok-b`, branched from `rebuild/integration` at `b5d0a34`. Local commit only; nothing pushed. No new packages or crates. `dateFormat.ts` is untouched (C1 owns the tokens and `dateNamePattern`). Weekly notes, monthly notes, week-number clicks, month-name clicks and task-due rings are left out.

## What shipped

The Calendar is a right-sidebar view on the `sideView` pattern, and it belongs to the Daily notes core plugin. Turning that plugin off hides the tab and disables **Daily notes: Open calendar**. The month grid marks today, and a day that already has a daily note gets one presence dot. Previous, next and Today move the grid. Today does not open a note. The month title is not a button.

Clicking a day calls `openDailyNote`. Ctrl+click or Cmd+click, and a middle click, pass `where: "tab"` so an existing note and a newly created one both land in a new tab. `openDailyNote` now takes that `OpenWhere` (default `false`, the same as omitting it). The date handed to it keeps the current clock time, so a template's `{{time}}` is not midnight.

Dots are counted from `ws.vault.notes` with the same folder prefix and `dateNamePattern` as previous/next daily note. The count is cached on the notes-array identity plus folder and format. The view paints only while it is the active sidebar tab, and a vault `files` or `show` event, or a daily-notes settings change, marks it stale. Painting does no file I/O.

**Start week on** is `weekStart` in `daily-notes.json`: `monday` or `sunday`, default Monday. An unknown value sanitizes back to Monday, and the default is omitted from the saved JSON. The grid is four, five or six rows. A trailing week that starts outside the month is dropped once the month already has four rows. August 2015 is six rows for both week starts. February 2021, Monday start, is exactly four rows.

Eight right-sidebar icons do not fit a frameless 300px dock once `--titlebar-buttons-width` (92px) is reserved. The right tab row scrolls horizontally with the scrollbar hidden, and selecting a tab scrolls that button into the row only. Icon size stays 28×25. The headless browser is not frameless, so that scroll is not what `test-calendar.mjs` exercises.

## Why the month grid stays in TypeScript

Painting must not do I/O, and the daily-note name parser already lives in TypeScript. A Rust command would be an IPC round trip on every redraw for arithmetic `Date` already does. There is no new command and no new crate.

## Checks

- `npm run build`: passed (`tsc --noEmit` and Vite, 2139 modules).
- `npm run audit:offline`: passed on the final source (193 source files, dist, CSP, capabilities and dependencies).
- `cargo test --offline` in `rebuild/app/src-tauri`: **84 passed**, 0 failed, 4 ignored. Doc tests passed. No Rust source changed.
- `flock /tmp/grove-npm-test.lock npm test`: one uninterrupted exit 0, including `posttest`. Vitest **81 files, 1287 tests**, including 4 in `calendarGrid.test.ts` (Monday and Sunday lead, the six-row month, the four-row February, leap years 1900 and 2000, folder prefixes). `scripts/test-calendar.mjs` passed: command, Monday columns, October 2026, the existing 2026-10-19 note and its dot, a created 2026-10-20 with `# 2026-10-20` and the date line, the dot after create, Ctrl+click of 2026-10-21 in a new tab with the template and a dot, Sunday columns, Today on November 2026, and the tab and command disappearing with the plugin.
- Frame budgets in that same run stayed inside their ceilings: 300-card drag max 16.8ms, geometry frames 16.7–16.9ms, 10,000-note list scroll p95 16.7ms. No search or index path changed, so the 5,000-note Rust bench was not re-run.
- `rebuild/round*-shots/` was restored after the suite. No assertion was weakened.
