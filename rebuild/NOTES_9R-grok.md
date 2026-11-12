# 9R: stop a superseded search scan

Typing in Search on a large vault used to let every keystroke's scan run to the end. The vault read lock stayed held for that whole walk, so a save waited, and the page waited too before it sent the next query. The read/write lock (finding 4) and the page's cached file map were already in. This change is the missing half: an older scan stops, and it does not hold the lock while it does.

`search_notes` takes the page's request id for that window, copies the current note list, and drops the vault read lock before it walks. The list is shared. The next keystroke in the same window reuses it until a save, rename, or delete clears it. The id is the search reader's version at the moment that query is sent, so it follows the order the user typed, not the order the workers happen to run. Rust stores the id only when it is strictly newer. An older id that arrives late returns `cancelled` and does not move the window's current id. Each note of an owned scan checks that the stored id is still its own. A superseded scan returns `cancelled` and no rows. The newest query walks the list it snapshotted and returns the same rows the old full walk would, in the same path order.

The page starts that newer query as soon as the editor flush for it finishes. Keystrokes that land before the flush still become one query. A reply, including `cancelled`, is drawn only when it is still the query on screen. A failure of that current query is still shown. Clearing the box still drops the query on the page and does not send a cancel. The scan that was already running finishes in the background and its rows are ignored. It does not hold the vault lock.

A second window has its own id. Typing in one does not cancel the other, and does not turn the other's current search into an error. The unlinked-mentions `search` command, `search_lines`, and `search_match` are unchanged. There is no debounce and no minimum query length. No new crate.

## What the tests check

An older scan of 80 notes is paused on the first note. A search from another window returns that window's one hit. A save of the first note finishes while the scan is still paused (the test fails if the save takes 1.5s). The newest query in the paused window matches the direct walk: one note for the saved text, and all 80 notes for the original word. Releasing the pause makes the old scan return `cancelled` after that single note.

Two windows' ids move independently. A later id on one window does not change the other, and repeating the current id does not advance it.

An older request is paused before it claims an id. The newer id is then claimed and returns every matching row. Releasing the older request makes it return `cancelled`, and the stored id is still the newer one. That `Ok` is what the search view draws, so the final query does not become "Could not read search results."

A snapshot taken before a rename still searches the old path. The snapshot taken after the rename is a different list and returns the new path. Deleting a note leaves the earlier snapshot unchanged and omits that note from the new one.

On 20,000 in-memory notes, a debug `cargo test` build recorded:

| Step | Time |
| --- | --- |
| First snapshot | 6.30 ms |
| Second snapshot (same list) | 0.00 ms |
| Full walk of `alpha` (19,999 hits) | 22.6 ms |
| Stop at the next note | 0.01 ms |

The stopped walk checked two notes and returned an error. Its rows match the direct walk for both the 19,999 `alpha` hits and the one `zebra-marker` hit. The second snapshot is the same allocation as the first.

The page test starts the second `searchNotes` while the first promise is still pending, ignores that first reply, and shows the newest rows. The ids sent with those calls increase even when the keystrokes in between are coalesced into one query. A `cancelled` rejection from the old promise does not show "Could not read search results." A rejection of the query that is still current still does.

## Suites

`cargo test --offline` in `rebuild/app/src-tauri`: 201 passed, 0 failed, 5 ignored. The binary and the doc tests ran and had nothing to execute.

The non-test build warns that `Files::len` and `Files::values` are unused. `list` reads `len` only under `cfg(test)`, and `values` has no caller. Both were already that way.

`flock /tmp/grove-npm-test.lock npm test` in `rebuild/app` exited 0. Discovery passed 6, feel at 5,000 notes passed, vitest passed 110 files and 1,677 tests, the later headless scripts passed, and posttest passed (bases, kanban, and the property-edit fuzz). Feel still reports the known graph gap: p95 33.4 ms, held until `GROVE_FEEL_STRICT_GRAPH=1`. One earlier run of the same suite failed an existing bases-edge scroll check (one frame at 33.3 ms, cap 25 ms) and passed on rerun. The run rewrote tracked screenshots; those files were restored before commit.

The desktop app was not opened. The task forbids a GUI window. The headless suite is what ran.

## Size

No new dependency. `searchView.ts` was not edited. The search command takes the window label the same way `write_note` already does. No new IPC name, so the capability list is unchanged.

Against `b13c7bf`:

| File | Lines | Change |
| --- | --- | --- |
| `rebuild/app/src-tauri/src/search_scan.rs` | 311 | +311 / −0, new |
| `rebuild/app/src-tauri/src/index/search.rs` | 699 | +111 / −25 |
| `rebuild/app/src-tauri/src/index/file_map.rs` | 161 | +46 / −13 |
| `rebuild/app/src-tauri/src/index/tests.rs` | 661 | +72 / −0 |
| `rebuild/app/src-tauri/src/lib.rs` | 714 | +11 / −5 |
| `rebuild/app/src/shell/searchRead.ts` | 130 | +44 / −10 |
| `rebuild/app/src/readOrdering.test.ts` | 336 | +36 / −3 |
| `rebuild/app/src-tauri/src/index.rs` | 738 | +3 / −1 |
| `rebuild/app/src-tauri/src/index/parse.rs` | 409 | +3 / −1 |
| `rebuild/app/src-tauri/src/smoke.rs` | 292 | +2 / −0 |

Net in that table: +639 / −58, plus this note, the contract line, `api.ts`, the mock, and the two edge-script wrappers that forward the request id. Notes are cloned only when a save replaces a node whose snapshot is still in a scan.

The request-id fix, against `cf1ab86`, stores the page's id instead of a worker-side counter. `search_scan.rs` is 311 lines. No new IPC name and no new dependency.
