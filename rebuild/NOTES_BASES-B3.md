# Bases B3 part 1 — Export CSV

Branch `rebuild/bases-b3-grok`, commit `0d99177`, created from the B0 tip `dba5a78`. Local only. Not pushed.

The results menu now has **Export CSV...** after **Copy to clipboard**. There is no extra separator. The icon is the bundled `file-down` icon. The download is the current view's visible rows: the same headers and values Copy already receives, after filter, sort, and limit.

## What changed

| File | Lines |
|---|---|
| `rebuild/app/src/bases/results.ts` | +34 / −4 |
| `rebuild/app/src/bases/results.test.ts` | +12 / −1 |
| `rebuild/app/scripts/test-bases-results.mjs` | +4 / −1 |

`menus.ts`, `view.ts`, and Rust were not edited. The menu item is built inside `resultsMenu`, which already owns Copy.

`test-bases-results.mjs` is outside the owned file. It asserted the exact menu children, so **Export CSV...** had to be added there. The same script now checks the download name and the three visible rows. The headless click is intercepted so the run does not write a file; the blob text is the file content.

## Decisions

- The label is `Export CSV...` and the icon is `file-down`. Cell text matches `tableTsv`: list values are joined with `, `, and null is empty. Fields are comma-separated. A field is quoted when it contains a comma, a double quote, CR, or LF, and a quote inside is doubled (RFC 4180). There is no extra trailing line and no BOM.
- The file name is the toolbar view title, with slashes and other unsafe characters turned into spaces, then `.csv`. A name that already ends in `.csv` is not doubled. An empty title becomes `Results.csv`. For the fixture view that is `By due.csv`.
- The download is a `text/csv;charset=utf-8` blob and an anchor click. The object URL is revoked after one second. Nothing is written into the vault. There is no Tauri save dialog and no new dependency.
- Rows are whatever the caller passes into `resultsMenu`. **Show all** still widens that set before a later export, the same way Copy works.

## What this relied on

`rebuild/round32b-shots/observed.json`, from the round 32B observation of Obsidian 1.14.4, records the results menu text `Export CSV...` and the class `lucide-file-down`, after Copy, with no separator of its own. That file is a public DOM measurement already in the repo. No page was fetched. No Obsidian code, CSS, or assets were copied. The icon is Grove's existing Lucide `file-down`.

That observation did not record the file name or the CSV bytes. The TSV copy was already matched to Obsidian byte for byte (`ROUND32B_NOTES.md`). The CSV uses those same cells. The file name is the view title the toolbar already shows. A BOM was not added.

## Checks

- `npm run build` passed. Vite still warns that one chunk is over 1000 kB.
- `npm run audit:offline` passed: 166 source files. The registry was not contacted.
- `flock /tmp/grove-npm-test.lock npm test` passed on the first run (exit 0). Vitest: 59 files, 677 tests. No flake retry. The results script reports its PASS line, which includes the CSV name and body. The 1000-row scroll max frame was 16.8 ms. The results menu opened on frame 1, max 16.8 ms. Configure view max frame was 16.8 ms.
- From `rebuild/app/src-tauri`, under the same flock, `cargo build --offline` and `cargo test --offline`: 58 passed, 0 failed, 2 ignored. The registry was not contacted.

Screenshot fixtures under `rebuild/round*-shots/` were restored before the commit and are not in it.

## Left open

The B3 fuzz of B1 is not this commit. It waits until B1 lands. B1 and B2 were not reviewed.

The saved file name and the exact CSV bytes were not in the recorded Obsidian observation. If a later comparison wants a BOM, or a different file name, that is a one-line change in `results.ts`.
