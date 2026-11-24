# CSV export for Bases views (claude)

Brief: `rebuild/CSV_EXPORT_TASK.md`. Branch `rebuild/csv-claude`, from `rebuild/integration` at b4e47fe.

## What changed

There is now one action, **Export as CSV**. It replaces the old "Export CSV..." item, which clicked a hidden `<a download>` and named the file after the view only. That download code (`csvExport`, `downloadCsv`) is gone, so only one exporter is left.

- **What it exports.** The rows the view shows, in the order shown: after filters, sort and the view's `limit`, then the toolbar Search box. Rows in hidden groups are left out, and grouped and Kanban views export in group order. Columns are the visible ones (`order`), and each header is the column's display name (`properties.<id>.displayName`, or `file name`, `modified time` and so on).
- **Cell text.** Cells hold the text the view shows. `shownText` and `entryText` in `src/bases/results.ts` follow view.ts `cell`:
  - The vault's property type is used when the value fits it.
  - Note properties show their frontmatter value in the column's type.
  - List and tag pills read as their label, so `[[Note|Alias]]` becomes `Alias` and `[[Note]]` becomes `Note`. Pills are joined with `, `.
  - Checkboxes become `true` or `false`.
  - A value that doesn't fit the column type is shown as written.
  - `file.mtime` and `file.ctime` are local `YYYY-MM-DDTHH:mm:ss` (the internal value is a UTC ISO string with `Z`).
  - Formula errors show their message.
  - A note that lacks the property gives an empty cell.
- **Copy to clipboard.** The TSV copy now uses the same cell text (`tableTsv`), so copy and export agree.
- **CSV format.** UTF-8 with no BOM, written as raw bytes. It follows RFC 4180: every record ends in CRLF, including the last. A field is quoted only if it holds `,`, `"`, CR or LF, and quotes inside it are doubled. Line breaks inside a field are kept as written.
- **Save dialog.** This is an in-app modal built on `shell/confirm.ts` and styled like Grove's other confirm dialogs. Its title is "Export as CSV". It has a "Save to" field holding a vault-relative path, a line like "3 rows, 4 columns, in the vault “X”.", and Cancel and Save buttons.
  - The default path is `<base folder>/<base>-<view>.csv`. The .base file's stem and the view name are each cleaned for use in a file name (`csvFilename`), and the file stem is selected so you can type a new name.
  - For a ```` ```base ```` block, the base name and folder come from the note the block is in. For `![[X.base]]` they come from `X.base`.
  - Enter or Save writes the file. Escape, Cancel, × or a click outside writes nothing.
  - A path with `..`, a part starting with a dot (for example `.grove/`), or an empty name keeps the dialog open with the reason. A folder at that path does the same.
  - If a file already exists at that path, a "Replace “name”?" dialog appears. Cancelling it goes back to the save dialog.
  - `.csv` is added when the typed name doesn't end in it.
- **How the file is written.** It goes through the existing `write_file_bytes` command with `x-grove-replace` (`submitBytes(..., "replace")`), the same path the drawing PNG export uses. That write is atomic and byte-exact (`write_note` would change line endings to match the file it replaces). The file list is then refreshed and a "Saved “name.csv”" notice appears. **No backend change, no new command, no CONTRACT.md change.**
- **Dialog changes in `shell/confirm.ts`.** Two optional fields: `field` (gets focus first and joins the Tab cycle) and `accept` (an async check that can keep the dialog open). Existing callers are unchanged: with no `accept`, Enter still confirms in the same turn.

## Where it lives

- **Results menu.** In the Bases toolbar, click the "N results" button and choose **Export as CSV...**. This works in a .base tab and in embedded bases.
- **More options.** In a .base tab, the view header's ⋮ menu has **Export as CSV...**.
- **Command palette.** `bases:export-csv`, shown as **Bases: Export as CSV**. It is available only when the active tab is a .base view (`baseView()` in `appCommands.ts`, next to `drawing:export-svg`).
- **Code.** All three entry points call one function: `exportView` in `bases/view.ts`. It builds the table with `shownTable()`, then calls `exportCsv`, which opens the dialog (`askCsvPath`) and writes the file. For the command, the function is exposed on the view element as `el.exportCsv`, the same way `reconcile` is, so `appCommands.ts` doesn't import the lazily loaded Bases chunk.

## How to use it

Open a base, choose the view, then sort, filter or search as you like. Open "N results", More options or the palette and run Export as CSV. Keep or edit the path, which is relative to the vault, and press Enter. The CSV appears in the file explorer.

## Tests (all run under `heavy`, one at a time)

- `npx tsc --noEmit -p .`: clean.
- `npx vitest run src/bases/results.test.ts src/bases/edge.test.ts`: 20 tests pass. New or rewritten coverage:
  - RFC 4180 quoting: commas, quotes, CRLF, lone CR and LF, spaces kept, empty fields, a header-only table.
  - UTF-8 bytes with no BOM.
  - `<base>-<view>.csv` naming and cleaning, including a regression check that the name is no longer just the view name (`By due.csv`).
  - Default path beside the base, and checks on typed paths.
  - Displayed values: link pills, tags, checkbox, date, number, a value that doesn't fit its type, a missing property, `file.mtime` without `Z`, formula values and errors.
  - Visible columns, display-name headers, sort, filter and limit, run through `baseModel`.
  - Cancel writes nothing.
  - Save writes the exact UTF-8 bytes to the chosen path with `replace`, not as a browser download.
  - A failed write shows a notice.
  - A 10,000-row export builds in under 150 ms.
  - The existing edge test's CSV now uses CRLF records.
- `npx vitest run` (whole suite): 118 files and 1834 tests pass. On the first run, 2 timing-ratio tests unrelated to Bases (`parse < json * 1.25 + 2`) failed while other heavy jobs were running. Two reruns were clean.
- `node scripts/test-bases-results.mjs`: PASS. It checks:
  - The menu label `Export as CSV...`.
  - The dialog's title, default value `Multi-By due.csv`, focus and selected stem, note and buttons.
  - Escape and Cancel write nothing.
  - `../out` is refused inline.
  - Save writes `Multi-By due.csv` with the exact CRLF text, the file shows up in the vault, and the notice appears.
  - Saving again asks to replace, and Escape there goes back to the dialog.
  - A typed `Exports/Mine` is written to `Exports/Mine.csv`.
  - No blob was created and no `<a download>` was clicked (a regression check against the old behavior).
  - The palette command is available and opens the dialog.
  - More options lists the action and opens the dialog.
- `node scripts/test-bases-edge.mjs`: PASS. Filtered view plus search exports to `Edge-Filtered.csv`, including quotes, CR/LF and emoji.
- `node scripts/test-bases-kanban-edge.mjs`: PASS. The Kanban, searched-Kanban and table exports go to `KE-Board.csv` and `KE-Table.csv`, and every record ends in CRLF.
- Also run and passing: `test-bases-groups`, `test-bases-config`, `test-bases-menus`, `test-canvas-bases`, `test-drawing-commands` (the confirm dialog change), `test-startup-chunk` and `test-lazy-views`. `test-lazy-views` needs the `dist/` that `test-startup-chunk` builds, so I ran it after that.
- Tracked screenshots the runs rewrote (`round31b-shots`, `round32b-shots`, `round33-shots`) were restored with `git checkout`.

## Net line change

+477 / −99 across 13 files before this note: source +215 / −38, tests +262 / −61.

## Known gaps

- **Vault only.** You can only save inside the open vault. Grove has no native file dialog, and I didn't add a backend command that writes outside the vault, to keep the write surface the same. To export elsewhere, save it in the vault and move it, or add a scoped command later (that would also need a CONTRACT.md entry).
- **Dates use ISO format.** Date and datetime properties export as the value their date field holds (`2024-01-05`, `2024-01-05T10:30:00`). On screen, WebKit shows that field in the system locale (for example `01/05/2024`), and that rendering can't be reproduced exactly from JS. ISO also reads unambiguously in spreadsheets.
- **Missing checkboxes are empty.** A checkbox property the note doesn't have exports as an empty cell, while the table draws an unticked box.
- **List view differences.** List view shows failing formulas as `#ERROR!`; the export shows the error's message, as the table does. Cards skip empty items in lists; the export keeps them, as the table does.
- **No BOM.** Excel on Windows may misread non-ASCII text when opening the file by double-click; importing it as UTF-8 works.
- **No formula-injection guard.** Cells starting with `=`, `+`, `-` or `@` are written as shown, with no escaping against spreadsheet formula injection.
- **20 MB cap.** The existing `write_file_bytes` limit applies, which is far beyond a typical view.
- **Notice position.** The "Saved" notice sits at the top right over the toolbar end for about 6 seconds, as drawing export notices do. The browser tests remove it before clicking there.
