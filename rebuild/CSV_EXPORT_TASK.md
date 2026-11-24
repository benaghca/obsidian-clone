# CSV export for Bases views

Chris asked for a way to export a `.base` view as CSV: "Real quick in grove, add a way to export .base as a csv".

## Already there

Do not start from a blank slate. Reuse and extend this:

- `rebuild/app/src/bases/results.ts` already has `tableCsv`, `csvFilename`, `csvExport`, and `downloadCsv` (a hidden `<a download>` click).
- The Results count button menu already has "Export CSV...".
- Unit tests live in `rebuild/app/src/bases/results.test.ts`. Browser coverage is in `rebuild/app/scripts/test-bases-results.mjs` (it currently expects the menu label `Export CSV...`, a blob download, and the filename `By due.csv`).

That is a start, but it does not meet the request. Keep one export path (reuse the CSV cell formatting, or improve it in place). Do not leave a second, different exporter.

## Requirements

Done only when all of these are true:

1. An **Export as CSV** action for the currently shown Bases view.
2. It exports that view's **currently shown rows and visible columns**, in the **current sort and filter order** (honor the view's result limit too).
3. Headers are the **display names** as shown in the view.
4. Cell values are **formatted as displayed**, not raw internals. Check how the view formats cells (see `rebuild/app/src/bases/cells.ts` and nearby display helpers) and reuse that text.
5. Proper CSV: **UTF-8**, **RFC 4180** quoting (commas, quotes, line breaks).
6. A **save dialog**, with default filename **`<base>-<view>.csv`** (the `.base` file's stem plus the view name, sanitized for a filename). Cancel writes nothing.
7. Put it where it fits Grove's UI: the base view's **toolbar and/or its menus**, **and** the **command palette** (for example `bases:export-csv` / "Bases: Export as CSV"), enabled only when a base view is active, in the same spirit as `drawing:export-svg` in `rebuild/app/src/appCommands.ts`.
8. Keep it simple and responsive (no hitch on a typical view).
9. Update the existing Results-menu tests and labels so there is **one coherent action**, not two different export behaviors or filenames.

## Design notes (direction, not a prescription)

- Grove has no native OS folder dialog today (the vault switcher types a path into the existing instant prompt). **Do not add a new crate or npm package** (no `tauri-plugin-dialog`, no `rfd`). An in-app save dialog that matches existing prompt/confirm dialogs is fine.
- `<a download>` in WebKitGTK often does not give a real save picker; do not treat that as the save dialog.
- The default name is `<base>-<view>.csv`, not only the view name.
- If you need a carefully scoped backend command to write the path the user just confirmed (including outside the vault), update `rebuild/CONTRACT.md` and say so in the commit message. Front-end work lives under `rebuild/app/`. Do not edit the old Cinder code at the repo root.
- Investigate and reach your own design within these limits.

## Hard limits

- No new crates or npm packages. No Obsidian code or assets.
- No network. No GUI windows. Do not launch Grove.
- Test vaults only under `/tmp`. Never touch `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`, `/tmp/grove-playground`, `~/grove-compare-vault`, or any of Chris's real vaults.
- Do not delete files outside this worktree. Do not merge or delete `rebuild/cz6b-claude`. Do not push.
- Do not touch other worktrees or Herdr panes.
- BUILD RULE (Cloud): every build and test goes through the shared lock: prefix it with `heavy` (for example `heavy npx vitest run src/bases/results.test.ts`, `heavy node scripts/test-bases-results.mjs`, `heavy cargo test --offline` in `rebuild/app/src-tauri`). Never run builds/tests in parallel. Blockcraft has priority on build time, so `heavy` may make you wait; that is expected.
- `rebuild/app/src-tauri/target` is already a symlink to a unique directory under `/mnt/build` (NVMe). Never replace it with a real directory.
- Restore any tracked screenshot files (`rebuild/round*-shots` or similar) that a test run rewrites before you commit.

## Tests

- Unit tests for RFC 4180 quoting, UTF-8, the `<base>-<view>.csv` default name (and sanitizing), cancel writes nothing, visible columns, current sort/filter, display-name headers, and displayed values.
- Update `scripts/test-bases-results.mjs` (and any other browser tests that mention the old menu or filename) for the new UI and filename.
- Add a regression test that would fail on the old `<a download>`-only / view-name-only behavior where that is practical.

## Done when

- The focused tests above pass under `heavy`.
- Write `rebuild/NOTES_CSV-claude.md`: what changed, where the button and command live, how to use it, test results, net line change, known gaps.
- Commit locally on `rebuild/csv-claude` (one or more commits; the message should describe the user-facing change). Do not push.
- Then stop. Do not start other work.
