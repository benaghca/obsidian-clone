# Review: daily-note dates and nameless `.md` files

Branch `rebuild/bugfix-dates-md-review-grok-c`, from `rebuild/bugfix-dates-md-grok-b` at `1a82614`. `rebuild/integration` is `278f8ba`, which is already the merge base. It has no commits this branch lacks, so nothing was merged.

Reviewed `e3c2445` and `cb47ee4`. The product diff against integration is 12 files, +219 / −29, including `rebuild/BUGFIX_NOTES-dates-md-grok-b.md`. This review leaves that fix as it is.

## Dates

`dateNamePattern.parse` is what `dailyNotes` uses to order previous and next daily notes (`appCommands.ts`). After `new Date(y, mo, d)` it keeps the timestamp only when `getFullYear`, `getMonth`, and `getDate` match the parsed year, month, and day. `2026-02-29` and `2026-13-40` are null. `2024-02-29`, `2000-02-29`, and `2026-03-01` still parse. A missing month stays January and a missing day stays 1 (`YYYY-MM` of `2026-02` is 1 February). A format with no year stays null. The weekday token is still unchecked. That matches the notes.

Extra cases against the same function: `2100-02-29` is null, `2400-02-29` parses, `2026-06-31` and `2026-02-00` are null, and the same leap-day rule holds for `MMM D YYYY`, `YYYY-MM-Do`, `M/D/YYYY`, and `DD-MM-YYYY`. `YYYY-MM` of `2026-13` and `2026-00` are null.

`openDailyNote` formats a real `Date`. `dailyDate` in `editorHost.ts` already rejects an ISO day that does not round-trip. `rebuild/app` has no second daily-note parser.

Years `0000`–`0099` hit a `Date` quirk this check shares with `dailyDate`: `new Date(96, 1, 29)` is a day in 1996, so `0096-02-29` and `0004-02-29` parse as null. `0104-02-29` parses. Before the check, those names sorted as 1900–1999 and could share a timestamp with a real 19xx daily note. They now stay out of the previous/next list. Left as it is.

## Nameless `.md`

`is_note_path` / `isNoteFile` already require a basename longer than three characters. The bug was the other readers. `display_name` leaves `.md` intact, and that string contains `md`. `Index::search` now skips the path before the name hit. Note line hits were already limited to `is_note_path`, so the skip removes the name hit. `search_match` walks every file; `passes` skips the `any` stem match for a nameless path and still searches indexed lines. A nameless file is not a note, so those lines are empty. `file:` and `path:` are unchanged. Parity `corpus` passed, which covers the `file:md` / `file:MD` case the notes cite.

`resolve` skips the file on an exact path, on `pick`, and on a suffix match. A bare `.md` was already `None`, because the `.md` suffix strip leaves an empty by-name key and empty keys are not stored. `dir/.md`, `dir/.MD`, and `./.md` are covered by the new checks and by the tests.

TypeScript `matches`, `resolveIndexed`, and `linkTargets` use the same basename rule. `workspace.resolve` tries notes, then every file, and both calls go through `resolveIndexed`. `openLink` already returned without creating a note when the filename is `.md` and resolve is null (`workspace.ts`). The bug was resolve succeeding. With resolve null, that guard leaves the open note in place. The browser edge test now requires that, and it passed.

A file named `.md.md` is a note. Path lookup still tries `path + ".md"` before the exact path, so `folder/.md` can open `folder/.md.md`. A bare Rust `resolve(".md")` still misses that note, because the suffix strip runs before the by-name map. That was already true on integration. `[[.md.md]]` resolves. The file stays in the file list, so the explorer and the quick switcher can still open those bytes with `ws.open`. Search and link resolution leave the nameless file out.

Rust and TypeScript agree on `.md`, `.MD`, and `dir/.md`. `a.md`, `B.MD`, and `md.md` stay notes.

## Tests

The three known-bug checks are normal passing tests:

- `test-links-embeds-edge.mjs` asserts `2026-02-29` and `2026-13-40` are null and `2026-03-01` is 1 March. `daily-date-rollover` is gone from `LEDGE_BUGS`. The two embed bugs remain.
- `legacy_name_search_must_not_list_a_file_named_dot_md` is no longer `#[ignore]`. It passed.
- `test-search-props-edge.mjs` requires that `openLink('.md')` leaves the open note alone. The browser run printed that pass.

The new tests in `dateFormat.test.ts`, `nameless_md_files_stay_out_of_search_and_links_while_real_notes_stay_in`, `searchPropsEdge.test.ts`, and `backend.test.ts` match the notes. The mock `search` command already skipped non-note `.md` files and has no name hits; the added assertions lock that.

## Checks

From `rebuild/app`:

- `npm run build` passed (`tsc --noEmit` and vite).
- `flock /tmp/grove-npm-test.lock npm test` passed, exit 0, about 13 minutes. Vitest: 80 files, 1276 tests. No timing flake needed a rerun.
- `npm run audit:offline` passed: 191 source files, dist, CSP, capabilities, and dependencies.

From `rebuild/app/src-tauri`, with `--offline`:

- `cargo build` passed.
- `cargo test` passed: 84 tests, 0 failed, 4 ignored (`set_property_bench`, `crash_child`, `bench_vault`, `bench_search_commands`). `index::parity::corpus` passed.

## Benchmarks

`LEDGE_BENCH.format_date` was 0 on this run. That bench times `formatDate`, which this change does not touch.

The 10k edge test, debug, two runs: `search_ms=6.193` and `6.213`, `lines_ms=0.005`, `switch_ms=0.005`. The notes' integration sample was `search_ms=5.674` with the same line and switch times, and their post-fix samples were about 5.99. All of these sit under the 50 ms ceiling. The gap is one debug run of noise. `bench_vault` and `bench_search_commands` stay ignored.

## Notes checked

The file and behaviour claims in `BUGFIX_NOTES-dates-md-grok-b.md` match the diff and this run. The "still searches note lines" sentence describes the `any` clause; those lines are empty because the file is not a note. The weekday sentence, the `file:` / `path:` sentence, and the leftover embed bugs match.

## Left open

Years 0–99 in a `YYYY` daily-note name, as above. A bare Rust resolve of `.md` does not open a note file `.md.md`; TypeScript path lookup does. Both predate this fix.

VERDICT: OK
