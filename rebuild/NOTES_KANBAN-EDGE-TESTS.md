# KANBAN-EDGE-TESTS

Branch `rebuild/kanban-edge-tests-grok` from `5949637` (`Document the K6 sync.`, `rebuild/k6-review-grok`: integration plus the K8 list layout plus the K6 own-write skip).

Product code is unchanged. `rebuild/app/package.json` is unchanged. No Rust, stylesheet, or dependency change. No Obsidian docs, code, or assets were used. The checks follow Grove's K1–K8 implementation and the three rules Chris already decided: a column rename writes only that base's `properties.<id>.displayName`, summaries and CSV follow the toolbar search, and a file named `.md` is not a note (`isNoteFile` requires a base name longer than 3 characters ending in `.md`).

## What changed

| File | Added |
|---|---|
| `rebuild/app/scripts/test-bases-kanban-edge.mjs` | 504 |
| `rebuild/app/scripts/test-bases-kanban-edge-scale.mjs` | 170 |

`5812fa9` is those two files, 674 insertions. This notes file is the second commit.

The scripts are headless Chromium tests through `scripts/browser.mjs`, the same shape as `test-bases-kanban.mjs`, `test-bases-kanban-move.mjs`, and `test-bases-list.mjs`. They do not call `shot()`, so `rebuild/round*-shots/` was left alone. Scratch notes live in the mock vault inside the page, not in a real vault.

## What the behavior script covers

`test-bases-kanban-edge.mjs` opens two browsers.

The first base, `KE.base`, filters `file.inFolder("KE")` and `status != "secret"`. The Board view has a manual group order (`todo`, `doing`, `"🚧 only"`, empty, `waiting`) and hides `review`. A second file, `Other.base`, is a table of the same folder with no display name.

- Missing, `""`, and `[]` share the No value column. A non-empty list is one column labelled `left, right`. A status of a single space is its own group (`s:" "`). `todo`, `Todo`, and `TODO` are three columns. An emoji value and an 80-character value stay one column each. `waiting` is an empty added column with a drop hint. Gamma (`review`) is absent on the board. Secret and both `.md` files are absent. The count is `13 results`, in the manual prefix order.
- Board CSV is `Board.csv`: a header plus those 13 names. Gamma and Secret are absent. This export runs before any move, so the search filter is still empty.
- A pointer stroke that releases inside Alpha's own column cancels. A stroke that detours onto the next column and releases on the start point cancels. Dragging a column header out and back cancels and leaves `KE.base` byte-identical. A cancelled card drag does not open the note (`ws.active.viewFile` stays `KE.base`, `ws.active.path` stays null) and leaves no ghost or drop target. `setProperty` is wrapped so a self-drop can be checked by write count.
- From the view-name control, Tab reaches Alpha. Arrow keys, Home, End, PageDown, and PageUp move among the cards in the column and across to Beta. Space, ArrowRight, ArrowLeft, Space writes nothing. Space, ArrowRight, Escape announces `Move cancelled` and writes nothing.
- Alt+Right walks Delta from `todo` through `doing`, the emoji column, No value, and the empty `waiting` column. Each step waits until the undo button is showing. Four Ctrl+Z presses restore Delta's original bytes and paint it back in `todo`.
- One Alt+Right on Alpha, then six queued keys (undo, undo, redo, undo, redo, redo) while `setProperty` is delayed 40 ms, settle on `status: doing` with the original body. The delay stays on until that settle, so the queued writes are the ones that overlap.
- After that move, a body-only `writeNote` plus `vault.written` keeps the property line. Undo restores `status: todo` and keeps the new body.
- Alt+Left moves Beta to `todo`. Renaming the file to `KE/Beta-out.md` and refreshing, then Ctrl+Z, announces `Can't undo`. The renamed bytes stay as snapshotted, `KE/Beta.md` stays absent, and Alpha's edited body stays.
- Toolbar search `needle` leaves every column up, including No value and the empty `waiting` column, and still hides `review`. The only card is Needle. Board CSV is exactly `file name,status` / `Needle,todo`. List shows one item. The table summary `data-value` is `1` and the only group toggle is `todo (1)`. Table CSV matches. Escape in the search input clears it: the table count and summary become `14` (the shown cards, with Beta now `KE/Beta-out.md`, plus Gamma). Secret and both `.md` files stay out.
- Right-click the table's `status` header, Edit property, set Display name to `State`. `KE.base` gains `displayName: State` and still hides `review`. Alpha's note still has `status: todo` and no `State` key. `Other.base` stays byte-identical and its header stays `status`. Back on the Board, Alpha's card key reads `State` and the column title stays `todo`. Gamma stays off the board.

The second browser is the K6 echo on `EC.base` (A and B in `todo`, C in `doing`).

- A is closed. A keyboard move one column right increases `skip` and leaves `full` unchanged, and the column elements stay connected. A second `vault.written` of the same path increases `full` and disconnects those columns. The card stays in `doing`. A closed note does not arm an echo, so this rebuild is the specified path.
- B is opened beside the board. `api.writeNote` is delayed 250 ms once for that path, which is inside the 500 ms echo window and long enough that the document's own-write skip runs before the save's `vault.written`. The save then echoes: `full` stays put, `skip` rises by at least 2, and the same column elements stay connected. After 600 ms of quiet, another `vault.written` increases `full`. The card stays in `doing`.

## What the scale script covers

`test-bases-kanban-edge-scale.mjs` creates 10,000 notes `KS/00000.md`–`KS/09999.md` (status cycling `todo` / `doing` / `review` / `done`) plus `KS/.md`, which must not become a row. The base has a numbered list, a four-column board, and a grouped table. The viewport height is 900.

Ceilings match the existing K8 list scroll and the shared long-task cap. Nothing was loosened.

- List wheel: p95 ≤ 20 ms, max ≤ 25 ms, mounted rows ≤ 80, row height 28, marker is `index + 1` plus a dot, scrollTop moves past 1000, no long task over 50 ms.
- Switching to Board, Table, and back to List keeps `10000 results`, has no long task over 50 ms, and has a max frame ≤ 50 ms. The board mounts 4 columns and fewer than 200 cards. The table mounts fewer than 120 body rows. The list returns to ≤ 80 rows.
- A second, shorter list wheel also has a max frame ≤ 25 ms.

The K4 10k kanban drag bench and the K8 warm-open median (≤ 150 ms) are not repeated here.

## Bugs

None. No case is marked expected-fail.

## package.json line to add later

Current `posttest`, left as it is:

```
"posttest": "node scripts/test-bases-config.mjs && node scripts/test-bases-cards.mjs && node scripts/test-bases-embed.mjs && node scripts/test-bases-search.mjs && node scripts/test-bases-group-order.mjs && node scripts/test-bases-kanban.mjs && node scripts/test-bases-kanban-move.mjs && node scripts/test-bases-list.mjs && node --experimental-strip-types scripts/fuzz-property-edit.mjs"
```

Insert the two scripts after `test-bases-list.mjs` and before the fuzz script:

```
"posttest": "node scripts/test-bases-config.mjs && node scripts/test-bases-cards.mjs && node scripts/test-bases-embed.mjs && node scripts/test-bases-search.mjs && node scripts/test-bases-group-order.mjs && node scripts/test-bases-kanban.mjs && node scripts/test-bases-kanban-move.mjs && node scripts/test-bases-list.mjs && node scripts/test-bases-kanban-edge.mjs && node scripts/test-bases-kanban-edge-scale.mjs && node --experimental-strip-types scripts/fuzz-property-edit.mjs"
```

## Commands and results

From `rebuild/app`. Each script three times, under the lock. All six exited 0. No flake rerun was needed.

```
flock /tmp/grove-npm-test.lock node scripts/test-bases-kanban-edge.mjs
flock /tmp/grove-npm-test.lock node scripts/test-bases-kanban-edge-scale.mjs
```

K6 echo (`KEDGE_ECHO`). `full` stayed 2 and `skip` went from 1 to 3 on every run.

| Run | before lastMs | echoed skip | echoed full |
|---|---|---|---|
| 1 | 1.9 | 3 | 2 |
| 2 | 2.2 | 3 | 2 |
| 3 | 2.7 | 3 | 2 |

10k list scroll (`KEDGE_SCROLL`). Mounted rows 45 and scrollTop 140000 on every run. Long-task list empty.

| Run | p95 ms | max ms | median ms |
|---|---|---|---|
| 1 | 16.8 | 16.8 | 16.7 |
| 2 | 16.8 | 16.8 | 16.7 |
| 3 | 16.7 | 16.8 | 16.7 |

View switches (`KEDGE_SWITCH`). Every sample had an empty long-task list, count `10000 results`, and a max frame of 16.8 ms. The board mounted 56 cards and the table mounted 33 rows on every run.

| Run | board ms | table ms | list ms | second scroll ms |
|---|---|---|---|---|
| 1 | 580 | 569 | 565 | 935 |
| 2 | 580 | 569 | 567 | 935 |
| 3 | 579 | 567 | 567 | 936 |

`npm run build` (`tsc --noEmit && vite build`) exited 0. `dist/` is gitignored. Full `npm test`, `npm run audit:offline`, and cargo were not run: the task says product code is unchanged, so those checks are not required.

## Left open

Wire the two scripts into `posttest` with the line above when a task is allowed to edit `package.json`.
