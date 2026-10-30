VERDICT: OK

Reviewed Grok b's Bases B3 part 1, Export CSV, at `5fec54d` on `rebuild/bases-b3-grok` (export `0d99177`, notes `5fec54d`), branched from B0 `dba5a78`. This branch is `rebuild/b3-review-grok`. Grok b's branch is still `5fec54d`. Nothing was pushed. No product code was changed.

## What landed

`dba5a78..5fec54d` is 4 files, +95 / −6:

- `rebuild/app/src/bases/results.ts` +34 / −4 (53 lines). `tableCsv`, `csvFilename`, `csvExport`, and a `text/csv;charset=utf-8` download.
- `rebuild/app/src/bases/results.test.ts` +12 / −1
- `rebuild/app/scripts/test-bases-results.mjs` +4 / −1
- `rebuild/NOTES_BASES-B3.md` +45

`results.ts` is the owned file. The browser script is outside that list. It asserted the exact menu children, so Export CSV had to be added there, and it now checks the download name and the three visible rows. `menus.ts`, `view.ts`, and Rust were not edited. The item is built inside `resultsMenu`, which already owns Copy. Label `Export CSV...`, icon `file-down`, after Copy, no extra separator. That matches `rebuild/round32b-shots/observed.json`.

## Quoting and what is exported

Fields are comma-separated. A field is quoted when it contains a comma, a double quote, CR, or LF, and a quote inside is doubled. There is no trailing extra line and no BOM. The blob type is `text/csv;charset=utf-8`. List values are joined with `, ` and then quoted if that text needs it. Null is empty. Numbers and booleans use `String`. The cell text is the same text Copy already puts in the TSV.

The download is the rows `resultsMenu` is given: filtered, sorted, limited, in view order, with display-name headers. The existing results script checks that. For the fixture it is `By due.csv` and

```
Task,status,Due date,priority
Task F,open,2000-01-01,3
Task A,open,2000-01-01,3
Task D,open,2099-01-01,5
```

A separate headless check covered formulas, a broken formula, dates, lists, and spreadsheet-looking text:

- `if(priority > 1, "a, b", priority)` exports `1` for priority 1 and `"a, b"` for priority 3.
- `nope(` does not compile. The cell is empty and the notice is `Unsupported expression: nope(`. The CSV cell is empty. The notice is not a column.
- `=1+1` is exported unquoted, the same as Copy. The plan does not mention leading `=`, `+`, `-`, or `@`, so that prefix was not added.
- Tags `say "hi"` and `beta, gamma` become `"say ""hi"", beta, gamma"`.
- `2000-01-01` and `2026-05-01T00:00:00.000Z` are exported as stored. `file.mtime` is the raw ISO string, the same bytes Copy writes. The date widget formats a Z timestamp in an input, so the cell's inner text is empty.
- A 50,000-row string with `café` and `日本語` round-trips through UTF-8. The file does not start with a BOM.

`priority + 1` is also an unsupported expression on this branch. The formula language here has no `+`. That is B1's work, not the CSV writer. The failed formula is an empty cell plus the notice, and the CSV matches the empty cell.

## Large export

`node scripts/gen-vault.mjs /tmp/grove-b3-review-50k 50000` wrote 50,000 notes, 136,192,467 bytes, sha256 `d5723282df8133e209ea13557f278a83882e3fc2bb0d884b3c29c657d46421be`. The headless app uses the mock vault and does not mount that directory. The UI export used 50,000 notes created in the page, the same count.

- `tableCsv` of 50,000 rows with lists, quotes, and newlines: 21.4 ms to build, 8.4 ms to make the Blob, 3,060,734 UTF-8 bytes, no BOM.
- Creating the 50,000 notes took 39 ms. Opening the base to `50000 results` took 357 ms.
- Opening the results menu had one frame gap of 166.6 ms. That gap is the row array Copy already builds, plus the CSV string (about 20 ms of it).
- The Export click had one frame gap of 166.7 ms. The file was `Big export.csv`, `text/csv;charset=utf-8`, 50,001 lines, 1,977,188 characters, no BOM. The header was `file name,status,priority,due,tags,score,broken`. The first row was priority 0 and the last was `N49999`, so the sort held. The menu opened and the download finished. The page did not stick.

The CSV string is built when the menu opens, not when Export is clicked. At 50,000 rows that is the small part of the hitch. Moving it onto the click would not remove the row-array work in `menus.ts`, which this task does not own. Left as it is.

## Benchmarks

Before, on parent `dba5a78`, under the lock:

- warm 1000-note open 9.7 ms
- 1000-row scroll, max frame 16.7 ms
- 300-card/400-edge pan: 70 samples, p95 16.8 ms, max 16.8 ms
- zoom: 51 samples, p95 16.7 ms, max 16.8 ms
- 300-card drag, max 16.8 ms, 48 intervals

After, on this branch:

- warm 1000-note open 11.6 ms
- 1000-row scroll, max frame 16.8 ms
- pan: 69 samples, p95 16.7 ms, max 16.8 ms
- zoom: 47 samples, p95 16.7 ms, max 16.8 ms
- 300-card drag, first full run max 33.4 ms (over 20 ms). One rerun under the lock: max 16.8 ms, 48 intervals. That is the known drag flake.

The open moved from 9.7 ms to 11.6 ms. Both are under the 100 ms check. The frame times stayed on one frame.

## Checks

From `rebuild/app`:

- `npm run build`: passed (`tsc --noEmit` and vite).
- `flock /tmp/grove-npm-test.lock npm test`: the first run passed vitest (59 files, 677 tests) and the scripts up to the canvas drag, then failed that drag check at 33.4 ms. The drag script was rerun once under the lock and passed at 16.8 ms. The scripts after it, through `test-bases-results.mjs` and posttest `test-bases-config.mjs`, then passed (exit 0). The results script's CSV name and body assert is in that pass.
- `npm run audit:offline`: passed, 166 source files.

From `rebuild/app/src-tauri`, `--offline`:

- `cargo build`: passed (dev profile).
- `flock /tmp/grove-npm-test.lock cargo test`: 58 passed, 0 failed, 2 ignored (`bench_vault`, `bench_search_commands`).

No Rust files changed. No new crates or npm packages.

## Left open

- The B3 fuzz of B1 is not this commit. It still waits on B1.
- The saved file name and the CSV bytes were not in the recorded Obsidian observation. There is no BOM. A cell that is only `=1+1` is not prefixed. The plan does not ask for either.
- The menu builds the CSV string before it paints. At 50,000 rows that is about 20 ms of the 167 ms open. Copy's row array is the rest, and it lives in `menus.ts`.
- `file.mtime` is exported as the ISO value, matching Copy, not as the formatted date widget.

## Relied on

`rebuild/BASES_PLAN.md` (section 3 item 6, section 7's Export CSV line, section 8's B3 row), `rebuild/NOTES_BASES-B3.md`, and `rebuild/round32b-shots/observed.json` for the menu text and the `lucide-file-down` icon. The cell text follows the TSV already matched in `rebuild/ROUND32B_NOTES.md`. No page was fetched. No Obsidian code, CSS, or assets were used. The icon is Grove's bundled Lucide `file-down`.
