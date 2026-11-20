# R2 B1: fit a base column to its cell text

## Cause

An embedded base and a standalone `.base` tab both use `createBase` in `rebuild/app/src/bases/view.ts`. There is no separate embed measuring path. Standalone views had the same bug.

Opening a table sizes each column from the header label, plus the existing rules: 128 for a date, 210 for a datetime, pill widths for tags, lists, and aliases, and a floor of 78 for `file.name` or 60 otherwise. Plain cell text (text, number, formula, file name) was never measured. Double-clicking the column edge called `size(key)` with no width, which deletes that column's `columnSize` entry. The column then fell back to the header width. A short header and a long cell stayed clipped.

## Fix

`columnWidth` in `columns.ts` is the one measuring function. The open path still calls it without cell text, so a base still opens at the header width. A double-click measures the header and the current result rows on one canvas. The rows are the search result (`drawn`), including rows the table has not painted yet, so a long base does not lay out every row.

When that fit is wider than the header (or the fixed date or pill width), the width is written with the same `columnSize` key a drag uses (`note.<property>`, or `file.*` / `formula.*` unchanged). `menus.size` still clamps at 40. A fit that is not wider still clears `columnSize`, which is what a date column and a short text column already did. Nothing else in the file is written.

The cell string is the one the cell draws. Dates, checkboxes, and pills keep their own rules and are not widened by the word in the cell. Strings are measured longest-first, and a string that cannot beat the current width is skipped (32px per character is above the 13.125px table font). One column, and only on the double-click.

## Review 1

Codex reviewed `319c86f` as pass-with-fixes.

A fit was using every result row, so a long value in a manually hidden group could set the saved width. It now uses the grouped table's drawn rows (`groupedView.rows()`). Those rows exclude hidden groups and still include rows the table has not painted. With no grouping, the fit still uses the search result.

A formula that returns a list was typed as text for the header, and the fit dropped arrays, so the pills stayed clipped. A note property whose column type is text can also draw one row as pills when that row's own type does not fit. The fit now follows the cell renderer: the property editor's per-row type, or the file/formula branch (pills, a checkbox, a fixed date, or the text). Opening a base still sizes from the header, the date constants, and tag/list/alias pills only.

The double-click no longer sorts a copy of every string, and it does not measure the header pills a second time. The header width is the one already computed for the open layout. Identical strings and identical pill rows are measured once. The longest string is measured first, so a shorter string whose glyphs cannot beat that width is skipped.

`columns.test.ts` checks that forty copies of one string and two copies of one pill are measured once, that a list sample widens a text column, and that a date sample stays 128 unless a cell draws something wider. The browser script checks a hidden group (the column stays at 60px and `columnSize` is not written), a formula list and a text-typed property that draws a list (both fit the pill), and 300 virtualized rows whose widest cell is not in the DOM (60 → 872, saved 872, the double-click handler took 0.5ms).

`tsc --noEmit` passed. `scripts/test-bases-columns.mjs` still resets the due column. `flock /tmp/grove-npm-test.lock npm test` then passed, including posttest (vitest 111 files, and the fit lines above). Three earlier runs of that suite stopped on other timing checks: embed cold open 219.6ms against a 100ms budget, the settings search field not focused after 80ms, and a drawing edit at 51ms against a 50ms budget. Those scripts were not part of this change. The suite rewrote tracked files under `rebuild/round*-shots`; those were restored.

## Review 2

Codex reviewed `d026dbb` as pass-with-fixes.

Opening a tag or list column still measures every selected row, including a pill in a hidden group or a row the search box has filtered out. The fit measured only the rows on screen, but it saved the width only when that fit was larger than the automatic one. A smaller fit cleared `columnSize`, and the column went back to the wide automatic width. A fit is now saved whenever it differs from that automatic width. A fit that matches it still clears `columnSize`, which is what the due column and a short text column already did. The open-path measurement is unchanged.

The fit was also using `groupedView.rows()`, which is the copy and CSV order and still includes rows inside a collapsed group. The table does not paint those rows. `fitRows()` is a separate iterator: it skips collapsed groups and keeps every row of an expanded group, including rows outside the painted window. Copy and CSV still use `rows()`. With no grouping, the fit still uses the search result.

The browser script now checks a hidden group whose list column opens at 464px because of a hidden pill, then double-click shrinks it to 75px and writes `note.labels`. It also collapses a group that holds a longer string, with the expanded group's long cell outside the painted window: the fit is 60 → 872, the same width as that expanded cell, and the collapsed string does not widen it.

`tsc --noEmit` passed. `columns.test.ts` is still 5 tests. `scripts/test-bases-columns.mjs` still resets the due column. The fit script passed, including the two new cases (hidden pill 464 → 75; collapsed group 60 → 872, saved 872; the 300-row handler took 0.4ms).

`flock /tmp/grove-npm-test.lock npm test` then passed, including posttest (vitest 111 files, the fit lines above, and the 10,000-row scroll at p95 16.8ms, max 16.8ms). Two earlier runs of that suite stopped on the 10,000-row scroll frame budget in `scripts/test-bases-edge.mjs` (p95 16.8ms, max 33.3ms against 25ms). Run alone, that script's scroll max was 16.8ms. The suite rewrote tracked files under `rebuild/round*-shots`; those were restored.

## Review 3

Codex reviewed `0f699b4` as pass-with-fixes.

A fit measured data rows only. The table also draws a summary label and result in that column: the all-results footer, and a footer on each expanded group. A long custom summary name or result stayed clipped. The double-click now measures those strings too. The label is the 10px summary name and the result is the 13px value the footer draws, including `#ERROR!`. Opening a base still ignores them. A collapsed group's footer is left out. Copy and CSV are unchanged.

The browser script collapses a group whose summary result is longer than the expanded group's. The cells themselves are short, so the column opens at 60px. The fit goes to 868 and saves `note.t`, and the longer collapsed result is not part of it. A second column's summary name is the wide text: 60 → 514, and that label fits.

`tsc --noEmit` passed. The fit script passed, including the summary case above. `flock /tmp/grove-npm-test.lock npm test` then passed, including posttest (vitest 111 files, the summary fit 60 → 868 and 60 → 514, and the 10,000-row scroll at p95 16.8ms, max 16.8ms). One earlier run of that suite stopped on the same scroll frame budget (max 33.2ms against 25ms). The suite rewrote tracked files under `rebuild/round*-shots`; those were restored.

## Tests

`rebuild/app/scripts/test-bases-fit.mjs` is headless Chromium. Before the fix, an embedded base with header `t` and a long cell opened at 60px, and the double-click did not write `columnSize`. After the fix the same embed goes 60 → 872, saves `note.t: 872`, and the long cell's overflow is 0. The standalone `Fit.base` does the same. The vault is the harness scratch vault.

`src/bases/columns.test.ts` covers the width function: header floors, a long cell, a short cell that does not grow the column, date 128, datetime 210, a checkbox that ignores the word "true", a tag pill, and skipping a short string after a longer one. 4 tests passed. `tsc --noEmit` passed. Rust was not changed, so `cargo test` was not run.

`scripts/test-bases-columns.mjs` still passes. Double-clicking the due column removes `columnSize` and the width returns to 128, and the file matches the original fixture.

`flock /tmp/grove-npm-test.lock npm test` in `rebuild/app` passed, including posttest. Vitest was 111 files. Inside that run the fit script reported the embed and the standalone base at 60 → 872, saved 872, and the due-column script still reset. The first run stopped earlier, in `test-canvas-notes.mjs`: `node_modules` was a symlink into another worktree, so Vite served `@codemirror/view` with a bare `@codemirror/state` import. `npm ci --offline` replaced the symlink with a local install (69 packages). The lockfile did not change, and `node_modules` is not part of the commit. The suite was run again and exited 0. It rewrote tracked files under `rebuild/round*-shots`; those were restored.
