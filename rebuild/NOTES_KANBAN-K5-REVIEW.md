VERDICT: OK

Reviewed Codex's Kanban K5 on `rebuild/k5-review-grok`, taken from `rebuild/kanban-k5-codex` at `bd67837`. That branch is still at `bd67837`. Parent is `rebuild/integration` `298c169`. Nothing was pushed.

Relied on `rebuild/NOTES_K5.md`, `rebuild/NOTES_K4.md`, and `rebuild/KANBAN_PLAN.md` (sections 2, 4 including 4.5/4.6, 5.2, 5.3, 7 D1–D16, and the K5 row in section 8). The plan's public source is the Obsidian Views help page, already quoted in KANBAN_PLAN §1. Nothing was fetched for this review. No Obsidian code, CSS, or assets were used.

## Scope

Codex's `298c169..bd67837` stays in K5's files (`move.ts`, `history.ts`, `kanban.ts` hooks, `newRow.ts` seed, the move tests) plus the small exceptions NOTES_K5 already lists: a context export and case-insensitive key lookup in `model.ts`, scope/count/search hooks and an idle wait in `view.ts`, `groupMenu.ts` returning the save promise, `menus.ts` exposing that promise, `package.json` posttest, and `styles/bases-kanban-move.css`. No Rust, dependency, or API schema change. Writes go through `writeProperty` to `api.setProperty` (compare-and-swap) or the live editor's `editProperty`. One header-drag Undo stores the previous `groupBy` and writes that block back. K6's reconcile fast path and K8's list layout are untouched.

This review adds four small fixes, +163 / −9:

| File | +/− | Why |
|---|---|---|
| `src/bases/kanban.ts` | +22 / −4 | A gesture or a queued write owns the board. `idle()` checks again after the gesture settles, because a drop queues its write in that same turn. After a rebuild, focus returns to the card that had it. |
| `src/bases/move.ts` | +11 / −2 | `active()` is true from pointer-down or Space until the gesture ends. An embedded card is a key target; a field drawn inside the board still keeps the keys. |
| `src/bases/view.ts` | +18 / −3 | A ```base block's undo stack is the host path plus a hash of that block's YAML. A refresh that loses to a gesture is retried, so the external edit that started it is applied. |
| `scripts/test-bases-kanban-move.mjs` | +112 | The four failures below. |

## What broke, and the decision

**A refresh already inside `api.properties` cancelled a drag that started during that read.** `update()` unmounted the columns and the drop became "Move cancelled". `idle()` also resolved before the drop's write was queued, so the refresh could slip between the gesture ending and the write. The board now stays up while `moves.active()` or a write is in flight, and the view retries when `update` returns false. Holding `properties`, dragging, releasing the hold, and pressing Escape leaves the ghost until Escape, writes nothing for the drag, and still applies the external edit.

**The move's own refresh stole focus, so a second Ctrl+Z never reached the board.** Optimistic undo focused the card; the following rebuild unmounted that node and focus fell to the document. `restoreFocus()` runs after a successful paint, and only when focus was inside the board, so a search box or the other pane is left alone. The test undoes, waits until the replacement card is focused, and redoes with no extra click.

**Two ```base blocks in one note shared one undo stack.** Scope was the file path, or `block:${host}` when the base has no path. The second block's Undo reverted the first block's note. File bases stay keyed by path. A block is `block:${host}:${djb2 of its YAML}`, so a remount of the same block keeps its stack and a different block in the note does not take it. Identical YAML still shares a stack. Editing the block's YAML orphans the old stack until the tab closes. Both are small; a stable block id would mean an editor change outside K5's files.

**Space, arrows, and Ctrl+Z on an embedded card did nothing.** The board sits inside the note editor's contenteditable, and the key handler treated any such ancestor as a text field. The handler now bails for inputs, plaintext-only fields, and contenteditables the board itself contains. Space, ArrowRight, Space on an embedded card moves it to the next column.

Undo after the moved note is deleted refuses with "Note not found" and does not invent a card. A rename probe did the same and left the renamed file in place. Same-column drops write nothing. Escape, then a click, still opens the note: the drag sets `suppressClick`, and the next pointerdown clears it. A real Undo click includes that pointerdown, so the notice button works; the test sends one before `click()` because a bare `click()` does not.

## Performance

Headless Chromium, CDP pointer and keys, scratch vaults. Budgets: frame p95 ≤20 ms (plan slack; samples sit on 16.7–16.8), handler and script per move ≤1 ms, paint ≤20 ms, save and reconcile ≤100 ms. No long task on the drag, the drop, or a warm open.

| Check | NOTES_K5 | Dedicated move script | Inside `npm test` |
|---|---|---|---|
| P4 p95 / max | 16.7 / 16.8 | 16.8 / 16.8 | 16.8 / 16.8 |
| P4 handler / script per move | 0.40 / 0.091 | 0.40 / 0.083 | 0.50 / 0.099 |
| P4 layouts / frames / rects / ghost / scroll | 11 / 119 / 3 / 120 late 0 / 212×462 | same | same |
| P5 paint / save / reconcile | 6.9 / 8.8 / 63.2 | 6.7 / 8.2 / 58.8 | 6.5 / 8.3 / 58.9 |
| P7 undo paint / save / reconcile, frames | 10.1 / 3.5 / 46.6, frame 1 | 15.2 / 2.9 / 44.6, frame 1 | 14.7 / 3.1 / 46.7, frame 1 |
| P7 redo paint / save / reconcile, frames | 14.9 / 2.4 / 51.4, frame 1 | 5.8 / 2.3 / 51.4, frame 1 | 5.2 / 3.1 / 54.2, frame 1 |

Undo paint is higher than NOTES_K5's 10.1 and still inside the 20 ms assert, on frame 1. Redo paint is lower. NOTES_K5 already saw one 29.4 ms undo-paint sample fail the assert and pass on a retry; this run did not need a retry.

K4 script, inside the same `npm test`:

| Check | NOTES_K5 final | NOTES_K4 | This `npm test` |
|---|---|---|---|
| P1 warm | median 17.7, no long task | 14.7–21.8 | 19.6, 16.9, 18.3 (median 18.3), no long task |
| P1 cold | 68.2, long task 67 | 61–65, long task ~60–81 | **63.1**, long task **61** |
| P2 | p95 16.8, max 16.8, 15 cards | p95 16.7, max 16.8, 15 cards | p95 **16.7**, max **16.8**, 15 cards |
| P3 | p95 16.7, max 16.8, 7 columns | same | p95 **16.7**, max **16.8**, 7 columns, 5 visible |
| P11 | 15.5 ms, height 400, focus shift 0.875 px | 15.6 ms | **15.7 ms**. Embed geometry: height 400, widget 455, following gap 24, focus shift 0.875 px |

The cold open's long task is the inherited first property read of 10,000 notes. It is in the K4 band on this run. K5 does not own it.

## Checks

From `rebuild/app`: `npm run build` exit 0 (the existing chunk-size warning on the main bundle remains), `npm run audit:offline` passed (183 source files), `flock /tmp/grove-npm-test.lock npm test` exit 0 in 607 s (vitest 72 files, 1235 tests, then the browser scripts and posttest). From `rebuild/app/src-tauri`: `cargo test --offline` 73 passed, 4 ignored; `cargo build --offline` exit 0. No Rust file changed. No timing flake needed a rerun. Screenshots under `rebuild/round*-shots/` were restored and are not in the commit.

The UI was exercised in headless Chromium only. The task forbids opening a Grove window.

## Left open

- Two blocks with identical YAML share one undo stack. Changing a block's YAML orphans its stack until the tab closes.
- A conflict notice quotes the raw property lines (`status is now status: 'done'`). The plan's wording is the parsed value.
- The notice's text includes the hidden Undo button's label, so a cancelled move reads "Move cancelledUndo".
- A column-header reorder that overlaps a refresh was not probed. The save reads the file fresh.
