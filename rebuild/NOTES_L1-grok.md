# L1: cheap broken path links and search replies

Two things were slow on a big vault, and both are cheap now. Nothing the user sees changes.

A link like `[[folder/note]]` that is not an exact path used to look at every file, once per link, on every keystroke and after every save. The page and the Rust index now keep a suffix map for the current file list and answer from that. The same link still resolves to the same file.

Each search reply used to build a map of every file, copy each entry, and sort with the locale collator. The map and a name rank are kept for that file list. Later replies on the same list compare integers. A save that only updates a file's modified time still sorts by the new time. Results stay in today's order, including ties. Search is not debounced.

The search view already draws a page of rows (the first screenful immediately, the rest of the page just after, and later pages when asked). The reply still returns every match, as `{ path, count }` only, so the count, copy, and later pages stay what they are today.

## What the tests did before the change

The first counters sat on the old walks. I ran the new tests first, then replaced the walks. Those counters were not incremented by the suffix map, so a later review asked for checks that move when a real walk returns. The page test now counts `path` and `name` reads on the warmed snapshot through a Proxy. The Rust test counts nodes yielded by walking the file map (`iter`, `keys`, `values`, `retain`). Point lookups do not count. Search still counts real map builds and collator sorts.

| Check | Before | After |
| --- | --- | --- |
| 12 partial path links against 402 notes | 9,648 `path` reads when the old `notes.find` is put back (two reads a note) | 0 |
| 11 partial paths against a 44-node Rust index | 484 file-map yields when the old `files.iter` scan is put back | 0 |
| 4 search replies on one file list | 4 map builds and 4 collator sorts | 1 and 1 |
| A new array, or a push, on that list | (each reply rebuilt) | builds once |

Restoring either scan failed only that zero check. The same tests' resolution expects still passed, including a file whose whole name is `.md`.

The resolution checks in those tests passed on the old code. So did the existing search-order test: "Note 10", "Note 2", "Note 2" stay `b.md`, `c.md`, `a.MD`, the reverse exclusion stays `a.MD`, `c.md`, and a later modified time still puts `a.MD` first. No older assertion was weakened.

TypeScript still picks the first note in the snapshot. Rust still picks the shortest path, then the smaller original path. A folder and a file whose whole name is `.md` are still not targets. An exact path still beats a longer suffix. A leading slash that is not a real path still misses on the page.

## Times

Measured in this tree, before the change and after it. The page times are Node. The Rust times are a debug `cargo test` build. Each resolve figure is 40 lookups after one warmup, so the file list's map already exists, which is the cost while typing. Search is 50 replies on one file list after one warmup. The old search column is the previous function (a fresh map, a full entry copy, and the collator), timed beside the new one.

| Work | 5k before | 5k after | 20k before | 20k after |
| --- | --- | --- | --- | --- |
| Page, 40 broken path links | 20.6 ms | 0.18 ms | 78.9 ms | 0.12 ms |
| Page, 40 suffix hits | 22.0 ms | 0.09 ms | 93.2 ms | 0.10 ms |
| Rust, 40 broken path links | 22.4 ms | 0.096 ms | 90.4 ms | 0.101 ms |
| Rust, 40 suffix hits | 21.4 ms | 0.093 ms | 89.1 ms | 0.092 ms |
| Search, 50 replies | 61.1 ms | 19.3 ms | 258 ms | 78.2 ms |

Those 50 search replies built the map 0 times. The first reply on a new file list still sorts names once with the collator. Later replies do not.

## Suites

`cargo test --offline` in `rebuild/app/src-tauri`: 116 passed, 0 failed, 4 ignored. No warnings.

`npm run audit:offline` in `rebuild/app`: `tsc --noEmit`, the production build, and the offline audit passed.

`flock /tmp/grove-npm-test.lock npm test` in `rebuild/app` exited 0 again after this review fix. Discovery passed 6, feel at 5,000 notes passed, vitest passed 100 files and 1,548 tests, the later headless scripts passed, and posttest passed (bases, kanban, and the property-edit fuzz). Feel still reports the known graph gap: p95 33.4 ms, held until `GROVE_FEEL_STRICT_GRAPH=1`.

The desktop app was not opened. The task forbids a GUI window. The headless suite is what ran.

## Size

No new dependency. `livePreview.ts`, `vault.ts`, and `searchView.ts` were not edited. `linkExists` calls `resolveLink`, so a drawn link uses the suffix map.

Against `0358537`:

| File | Lines | Change |
| --- | --- | --- |
| `rebuild/app/src/links/internal.ts` | 388 | +31 / −8 |
| `rebuild/app/src/links/internal.test.ts` | 299 | +43 / −0 |
| `rebuild/app/src/shell/searchRead.ts` | 96 | +59 / −5 |
| `rebuild/app/src/shell/searchRead.test.ts` | 71 | +71 / −0, new |
| `rebuild/app/src-tauri/src/index.rs` | 736 | +41 / −15 |
| `rebuild/app/src-tauri/src/index/file_map.rs` | 128 | +128 / −0, new |
| `rebuild/app/src-tauri/src/index/tests.rs` | 589 | +69 / −0 |

Net code: +442 / −28, plus this note. The file map's walks are what the Rust test counts. `get` does not count.
