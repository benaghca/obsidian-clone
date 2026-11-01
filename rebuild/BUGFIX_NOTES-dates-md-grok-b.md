# Daily-note dates and nameless `.md` files

Branch `rebuild/bugfix-dates-md-grok-b`, from `rebuild/integration` at `278f8ba`. Two local commits, not pushed.

## What was wrong

`dateNamePattern` built the daily-note time with `new Date(y, mo, d)`. That constructor rolls overflow forward, so `2026-02-29` became 1 March 2026 and `2026-13-40` landed in 2027. Prev/next daily notes order by that parse, so an impossible name collided with a real day. Opening today's note and opening a date property already went through real `Date` values: `openDailyNote` formats a `Date`, and `dailyDate` in `editorHost.ts` already returns null when the ISO year, month, and day do not round-trip.

`Index::search("md")` matched a file whose whole name is `.md`. `display_name` / `noteName` leave that name intact, and `.md` contains `md`. The same stem made a plain query `md` match in Rust `passes` (`Field::Any`) and in TypeScript `matches`. `openLink('.md')` then opened one, because `resolveLink` treats every non-directory file as a target and the path `.md` is in the file list. Rust `resolve` of a bare `.md` was already `None` (the key becomes empty). Nested `dir/.md`, `./.md`, and a by-name hit still resolved to the nameless file.

A file whose basename is `.md` or `.MD` in any case, including `dir/.md`, is not a note. `is_note_path` / `isNoteFile` already say so: the basename must be longer than three characters and end in `.md`. `a.md` and `B.MD` stay notes. The file stays in the file index. `file:` and `path:` still match it. Parity `search.json` (`file:md` / `file:MD` on the `dot-name` vault) requires that.

## What changed

`e3c2445` — reject impossible daily-note dates. `dateNamePattern.parse` returns null unless `new Date(y, mo, d)` round-trips to that year, month, and day. A missing month token is still January and a missing day is still 1. A format with no year is still null. The weekday token is still not checked against the date.

| File | Added | Removed |
| --- | ---: | ---: |
| `rebuild/app/src/settings/dateFormat.ts` | 6 | 1 |
| `rebuild/app/src/settings/dateFormat.test.ts` | 17 | 0 |
| `rebuild/app/scripts/test-links-embeds-edge.mjs` | 3 | 4 |

`cb47ee4` — skip a nameless `.md` file in search and in link resolution, in Rust and TypeScript. `Index::search` skips the path. Query field `any` skips the stem match and still searches note lines. `file:` and `path:` are unchanged. `resolve`, `pick`, and path lookup skip the file and still follow aliases of real notes. TypeScript `matches`, `resolveIndexed`, and `linkTargets` do the same. Lookup of a real note still tries `path.md` first, so a note file `.md.md` (display name `.md`) is still a note. The mock `search` command already omitted non-note content and name hits; it was left as it is.

| File | Added | Removed |
| --- | ---: | ---: |
| `rebuild/app/src-tauri/src/index.rs` | 22 | 4 |
| `rebuild/app/src-tauri/src/index/search.rs` | 3 | 2 |
| `rebuild/app/src-tauri/src/index/search_props_edge.rs` | 39 | 5 |
| `rebuild/app/src/links/internal.ts` | 8 | 4 |
| `rebuild/app/src/shell/searchQuery.ts` | 2 | 1 |
| `rebuild/app/src/searchPropsEdge.test.ts` | 33 | 1 |
| `rebuild/app/src/mock/backend.test.ts` | 7 | 0 |
| `rebuild/app/scripts/test-search-props-edge.mjs` | 2 | 7 |

## Tests

Converted:

- `test-links-embeds-edge.mjs` no longer logs `daily-date-rollover` or expects a roll-forward. `2026-02-29` and `2026-13-40` parse as null. `2026-03-01` is still 1 March.
- `legacy_name_search_must_not_list_a_file_named_dot_md` is no longer `#[ignore]`. `Index::search("md")` omits `.md`, `.MD`, and `dir/.md`.
- `test-search-props-edge.mjs` no longer treats `openLink('.md')` changing the open note as an expected failure. The file is not a note, and the open note stays put.

Added:

- `dateFormat.test.ts`: `2026-02-29`, `2026-13-40`, `2026-00-10`, `2026-04-31`, `1900-02-29`, `February 29 2026`, and `YYYYMMDD` `20260229` are null. `2026-03-01`, `2024-02-29`, `2000-02-29`, `February 29 2024`, and `20240229` parse.
- `nameless_md_files_stay_out_of_search_and_links_while_real_notes_stay_in`: search omits the nameless files and still hits `md.md`, `a.md`, and `B.MD`. Resolve of `.md`, `.MD`, `dir/.md`, `dir/.MD`, and `./.md` is `None`. Resolve of `a`, `a.md`, `B`, and `B.MD` returns those notes. `file:md` still includes `.md`, `a.md`, and `B.MD`.
- `searchPropsEdge.test.ts`: plain query `md` omits the nameless paths, `resolveLink` and `linkTargets` skip them, and `a.md`, `B.MD`, and `pic.png` still resolve.
- `backend.test.ts`: mock `search` and `search_match` for `md` omit `C1B-INT/.md` and `C1B-INT/.MD`. `file:md` still returns those attachments.

Left as known bugs: `embed-first-line-block` and `embed-depth-off-by-one`.

## Checks

From `rebuild/app`:

- `npm run build` passed (`tsc --noEmit` and vite).
- `flock /tmp/grove-npm-test.lock npm test` passed. Vitest: 80 files, 1276 tests. The converted edge checks passed. No timing flake needed a rerun.
- `npm run audit:offline` passed: 191 source files, dist, CSP, capabilities, and dependencies.

From `rebuild/app/src-tauri`, with `--offline` so Cargo did not use the network:

- `cargo build` passed.
- `cargo test` passed: 84 tests, 0 failed, 4 ignored (`set_property_bench`, `crash_child`, `bench_vault`, `bench_search_commands`).
- `cargo test --lib corpus` passed.

## Benchmarks

`LEDGE_BENCH.format_date` times `formatDate`, which this change does not touch. This run's median was 0 (20 samples, sub-millisecond). There is no before number for that line.

The 10k edge test prints debug timings and fails above 50 ms. One run on the integration copies of `index.rs` and `search.rs`: `search_ms=5.674`, `lines_ms=0.005`, `switch_ms=0.005`. Two runs after the fix: `search_ms=5.993` and `5.990`, with the same line and switch times. Both are under the ceiling. The 0.3 ms gap is one debug run of noise. `bench_vault` and `bench_search_commands` stay ignored and were not compared.

## What this relied on

The task statement, and Grove's existing note rule (`is_note_path` / `isNoteFile`: basename longer than three characters, ending in `.md` in any case). Obsidian's source and assets were not opened. Public help pages were not opened; the task already stated both required behaviors.

`cargo fmt` was not run. The crate is not rustfmt-clean, and a format would rewrite files this fix does not touch.
