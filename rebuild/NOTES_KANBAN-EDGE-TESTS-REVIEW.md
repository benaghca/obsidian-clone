# KANBAN-EDGE-TESTS-REVIEW

Branch `rebuild/kanban-edge-review-grok` from `431576b` (`rebuild/kanban-edge-tests-grok`). Integration `4f9163c` is merged in `cfa442c`. Nothing was pushed. No Obsidian docs, code, or assets were used. The tests were checked against Grove's own Kanban code (`move.ts`, `history.ts`, `kanban.ts`, `view.ts`) and against `test-bases-list.mjs`.

## Verdict

The two scripts test the behaviour the source notes describe. Assertions that would have passed with the keys dropped are now real. No product bug showed up on the move and undo paths. Ceilings match the K8 list scroll and the 50 ms long-task cap. `src/` is untouched.

VERDICT: OK

## What the review changed

| Commit | File | Lines |
|---|---|---|
| `e205377` | `rebuild/app/scripts/test-bases-kanban-edge.mjs` | +33 / −6 |
| `e205377` | `rebuild/app/scripts/test-bases-kanban-edge-scale.mjs` | +3 |
| `bc476ff` | `rebuild/app/package.json` `posttest` | +1 / −1 |
| `cfa442c` | `rebuild/NOTES_K8-GEOM.md` from integration | +38 |

The scripts are 531 and 173 lines. The source notes' `posttest` line is in place: both scripts sit after `test-bases-list.mjs` and before `fuzz-property-edit.mjs`. The merge added only `NOTES_K8-GEOM.md`. `posttest` kept every script from both sides.

## Checks on the submitted tests

`5812fa9` adds only the two scripts. `431576b` is the notes. There is no `src/` edit, no dependency, and no raised ceiling.

Frame bars in the scale script match `test-bases-list.mjs`: 10k list p95 ≤ 20 ms, max ≤ 25 ms, at most 80 mounted rows, row height 28, marker `index + 1` plus a dot, no long task over 50 ms. View switches use the same 50 ms long-task cap and a max frame of 50 ms, which the source notes state. The 10k scroll asserts `scrollTop > 1000` with 40 wheel events. K8's 10k scroll uses 80 events and `scrollTop > 100000`. Every run here landed at 140000, so the stricter bar would have passed. The assertion stays at the bar the source notes name.

The sleeps are the same kind the older scripts use: pointer steps, a short pause while a scrolled column mounts, and 25 ms between wheel samples. The echo script's 500 ms and 600 ms waits are the product window (`ECHO_MS` is 500, the doc quiet period and the save delay are each 300, and the test holds `writeNote` for 250 ms so the save's `vault.written` arrives after the own-write skip and inside the echo window). The assertions after those waits poll.

One storm check was weak. Alpha is already `status: doing` when the six keys start, and undo, undo, redo, undo, redo, redo nets back to doing. A dropped queue would still pass. PageUp was sent from Home, so a PageUp that does nothing still ends on Alpha. The second list wheel checked only its frame ceiling.

## Test fixes

`e205377` makes those three checks observe the work.

- The storm waits until six Ctrl/Shift+Z keydowns have been seen, no delayed `setProperty` is in flight, the notice says Redid, and exactly four real writes landed. On a one-record stack the second undo and the last redo are empty, so four writes are the applied keys. `history.queue` serialises the writes, so two `setProperty` calls are not in flight together. The 40 ms delay is unchanged.
- PageUp is sent from Needle, the last card in the column, and must land on Alpha.
- Three of Delta's four undos must leave `status: doing`. The fourth restores the original bytes.
- The second 10k list wheel must increase `scrollTop`.

## Break attempts

A throwaway browser probe, not committed, exercised the move and undo paths after each queue had drained.

- A pointer drop one column to the right writes `status: doing` and announces the move.
- Alt+Right while `setProperty` is delayed 200 ms, then Ctrl+Z before that write returns, restores the original bytes, paints the card back in `todo`, and announces Undid. Two real writes.
- Three Alt+Right with no wait between them reach `review`. Three undos restore the original bytes.
- Two cards moved one after the other undo in LIFO order.
- An outside edit of the property to `status: later`, then Ctrl+Z, announces `Can't undo: … changed since: status: later`. The file keeps `later` and the card paints in that column.
- A new move clears redo. Ctrl+Shift+Z leaves the undone note at `todo`.
- Dragging a column header one column to the right changes `P.base`. Ctrl+Z restores the original bytes.
- With a 40 ms delay, undo, undo, redo, undo on a note that is `doing` restores the original `todo` bytes.

No product bug.

## Commands and results

From `rebuild/app`, after `npm run build` (exit 0). Each script three times under `flock /tmp/grove-npm-test.lock`, then once more inside full `npm test`. All exited 0.

K6 echo (`KEDGE_ECHO`). `full` stayed 2 and `skip` went from 1 to 3.

| Run | before lastMs | echoed skip | echoed full |
|---|---|---|---|
| 1 | 2.3 | 3 | 2 |
| 2 | 2.2 | 3 | 2 |
| 3 | 2.4 | 3 | 2 |
| posttest | 2.2 | 3 | 2 |

10k list scroll (`KEDGE_SCROLL`). Mounted rows 45, scrollTop 140000, long-task list empty, on every run including posttest.

| Run | p95 ms | max ms | median ms |
|---|---|---|---|
| 1 | 16.7 | 16.8 | 16.7 |
| 2 | 16.7 | 16.8 | 16.7 |
| 3 | 16.7 | 16.8 | 16.7 |
| posttest | 16.8 | 16.8 | 16.7 |

View switches (`KEDGE_SWITCH`). Empty long-task list, count `10000 results`, max frame 16.7–16.8 ms. Board mounted 56 cards. Table mounted 33 rows. The second wheel moved.

| Run | board ms | table ms | list ms | second scroll ms |
|---|---|---|---|---|
| 1 | 581 | 571 | 563 | 935 |
| 2 | 584 | 567 | 564 | 936 |
| 3 | 580 | 568 | 565 | 935 |
| posttest | 581 | 565 | 568 | 935 |

Full checks, all exit 0:

- `npm run build` (`tsc --noEmit && vite build`).
- `flock /tmp/grove-npm-test.lock npm test`. Vitest: 73 files, 1248 tests. `posttest` ran both new scripts and then the property fuzz (`cases=48`).
- `npm run audit:offline`: 186 source files, dist, CSP, capabilities, and dependencies.
- `cargo build --offline` and `cargo test --offline` in `rebuild/app/src-tauri`: 73 passed, 4 ignored, 0 failed. `--offline` keeps the run off the network.

`rebuild/round*-shots/` was restored with `git checkout` and is not in the commits.

## Left open

Nothing for Chris to decide. The 10k distance assertion remains `scrollTop > 1000`, as the source notes specify.

VERDICT: OK

## KANBAN-EDGE-SYNC

`rebuild/integration` is `c9fe49f` (canvas edge tests from `rebuild/edge-tests-review-grok`). Merged with `--no-ff` as `07c0e83`. Nothing was pushed.

One conflict, `rebuild/app/package.json`. Both sides had edited the script block. The `test` line is integration's: `test-canvas-edge-titles.mjs` after navigation, `test-canvas-edge-hover.mjs` after hover, and `test-canvas-edge-menu.mjs` after the board menu. `test-canvas-create.mjs` stays once. The `posttest` line is this branch's: `test-bases-kanban-edge.mjs` and `test-bases-kanban-edge-scale.mjs` stay after `test-bases-list.mjs` and before the property fuzz. `test-bases-kanban-move.mjs` (K6) and `test-bases-list.mjs` (K8) stay once. The combined lists have 58 `test` scripts and 11 `posttest` scripts, with no duplicate. No other file conflicted. The merge adds the three canvas scripts and their two notes. `src/` is untouched, and no ceiling was changed.

Full checks on `07c0e83`, all exit 0. No timing flake needed a rerun. Geometry Ctrl+o stayed at 16.7–16.9 ms. The 300-card zoom frames stayed under 20 ms.

- `npm run build` (`tsc --noEmit && vite build`).
- `flock /tmp/grove-npm-test.lock npm test`. Vitest: 73 files, 1248 tests. The three canvas edge scripts passed, including the huge-card title fit, the editing-card link hit, and the 2x paste. K8 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 279218. Kanban edge echo: before lastMs 2.6, echoed skip 3, full 2. Kanban edge 10k scroll: p95 16.7 ms, max 16.8 ms, scrollTop 140000. View switches: board 580 ms, table 567 ms, list 565 ms, second scroll 935 ms, max frame 16.7–16.8 ms. Property fuzz `cases=48`.
- `npm run audit:offline`: 186 source files, dist, CSP, capabilities, and dependencies.
- `cargo test --offline` in `rebuild/app/src-tauri`: 73 passed, 4 ignored, 0 failed. `--offline` keeps the run off the network.

`rebuild/round*-shots/` was restored with `git checkout` and is not in this commit.

VERDICT: OK
