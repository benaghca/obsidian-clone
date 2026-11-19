# R2 B1: fit a base column to its cell text

## Cause

An embedded base and a standalone `.base` tab both use `createBase` in `rebuild/app/src/bases/view.ts`. There is no separate embed measuring path. Standalone views had the same bug.

Opening a table sizes each column from the header label, plus the existing rules: 128 for a date, 210 for a datetime, pill widths for tags, lists, and aliases, and a floor of 78 for `file.name` or 60 otherwise. Plain cell text (text, number, formula, file name) was never measured. Double-clicking the column edge called `size(key)` with no width, which deletes that column's `columnSize` entry. The column then fell back to the header width. A short header and a long cell stayed clipped.

## Fix

`columnWidth` in `columns.ts` is the one measuring function. The open path still calls it without cell text, so a base still opens at the header width. A double-click measures the header and the current result rows on one canvas. The rows are the search result (`drawn`), including rows the table has not painted yet, so a long base does not lay out every row.

When that fit is wider than the header (or the fixed date or pill width), the width is written with the same `columnSize` key a drag uses (`note.<property>`, or `file.*` / `formula.*` unchanged). `menus.size` still clamps at 40. A fit that is not wider still clears `columnSize`, which is what a date column and a short text column already did. Nothing else in the file is written.

The cell string is the one the cell draws. Dates, checkboxes, and pills keep their own rules and are not widened by the word in the cell. Strings are measured longest-first, and a string that cannot beat the current width is skipped (32px per character is above the 13.125px table font). One column, and only on the double-click.

## Tests

`rebuild/app/scripts/test-bases-fit.mjs` is headless Chromium. Before the fix, an embedded base with header `t` and a long cell opened at 60px, and the double-click did not write `columnSize`. After the fix the same embed goes 60 → 872, saves `note.t: 872`, and the long cell's overflow is 0. The standalone `Fit.base` does the same. The vault is the harness scratch vault.

`src/bases/columns.test.ts` covers the width function: header floors, a long cell, a short cell that does not grow the column, date 128, datetime 210, a checkbox that ignores the word "true", a tag pill, and skipping a short string after a longer one. 4 tests passed. `tsc --noEmit` passed. Rust was not changed, so `cargo test` was not run.

`scripts/test-bases-columns.mjs` still passes. Double-clicking the due column removes `columnSize` and the width returns to 128, and the file matches the original fixture.

`flock /tmp/grove-npm-test.lock npm test` in `rebuild/app` passed, including posttest. Vitest was 111 files. Inside that run the fit script reported the embed and the standalone base at 60 → 872, saved 872, and the due-column script still reset. The first run stopped earlier, in `test-canvas-notes.mjs`: `node_modules` was a symlink into another worktree, so Vite served `@codemirror/view` with a bare `@codemirror/state` import. `npm ci --offline` replaced the symlink with a local install (69 packages). The lockfile did not change, and `node_modules` is not part of the commit. The suite was run again and exited 0. It rewrote tracked files under `rebuild/round*-shots`; those were restored.
