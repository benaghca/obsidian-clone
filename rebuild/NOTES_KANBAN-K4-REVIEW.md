VERDICT: OK

Reviewed Claude's Kanban K4 on `rebuild/k4-review-grok`, taken from `rebuild/kanban-k4-claude` at `7d4cc6f`. That branch is still at `7d4cc6f`. Parent is `rebuild/integration` `9fee64d` (`git merge-base --is-ancestor` passed). Integration was still `9fee64d` at this commit and was not merged again. `rebuild/kanban-k13-fix-grok` is still `ed994c8`. Nothing was pushed. No product code changed in this review.

Relied on `rebuild/KANBAN_PLAN.md` and `rebuild/NOTES_K4.md`. The plan's only public Obsidian source is the Views help page, quoted in KANBAN_PLAN §1. Nothing was fetched for this review. No Obsidian code, CSS, or assets were used.

## Scope

`git diff --numstat 9fee64d..7d4cc6f` is 15 files, +789 / −24. Dropping `NOTES_K4.md` (160 lines) leaves +629 / −24, which matches NOTES_K4's own total. NOTES_K4's row for `view.ts` says +19 / −11; numstat is +21 / −9.

| File | +/− | Role |
|---|---|---|
| `src/bases/kanban.ts` | +307 | Board. Read-only cards. Columns from `groupRowsAsync`, `parseManual`, `arrangeGroups`. |
| `src/bases/kanbanLayout.ts` | +24 | DOM-free geometry so vitest can load it. |
| `src/styles/bases-kanban.css` | +32 | Fixed card height, `contain`, no transitions. Embed height is the 400 px variable. |
| `src/bases/view.ts` | +21 / −9 | `layout()` picks the board or `groupedView`. Paint stays in the same turn as `update`. |
| `src/bases/model.ts` | +2 / −2 | `type: kanban` is a real type and does not get the unsupported-layout notice. |
| `src/bases/config.ts` | +3 / −2 | Layout select: Table, Cards, Kanban. Writes `type`. |
| `src/bases/menus.ts` | +3 / −3 | `square-kanban` icon, Kanban is selectable, returns `groupHost`. |
| `src/bases/kanban.test.ts` | +46 | Height, spans, `nearestIndex`. |
| `scripts/test-bases-kanban.mjs` | +178 | Real mouse and keys, P1–P3, P11. |
| `package.json` | +1 / −1 | `posttest` runs that script. |

Edits outside the K4 file list, each small:

| File | +/− | Why it is there |
|---|---|---|
| `groupMenu.ts` | +1 / −1 | Exports K3's `writeManual` for Move left/right. |
| `write.ts` | +2 / −2 | `writeView` accepts the key `type`. |
| `icons.ts` | +1 | Bundled Lucide `square-kanban`. |
| `model.test.ts` | +8 / −4 | The unsupported-layout example is `map`. `kanban` opens with no notice. |

The K4 row is read-only. The two writes the plan allows are present and covered by the browser test: column **+** seeds a new note (`status: review` in this fixture), and Hide / Move left / Move right call K3's writer and switch the view to Manual order. No card drag, no property write on an existing note, no undo. Space is not handled. Collapse is absent: D9 and §2.3 leave Kanban column collapse out of v1. The empty column says "No notes". The plan's "Drop here…" placeholder belongs with K5's drag.

`model.ts` adds the kanban notice exclusion and stores `type` as `kanban`. `model.test.ts` checks that. Configure view's Layout switch writes only `type`, and the browser test checks the file is byte-identical after a Kanban → Table → Kanban round trip.

## What the browser test confirmed

`node scripts/test-bases-kanban.mjs` under `flock /tmp/grove-npm-test.lock`, exit 0, then again inside `npm test`.

- Columns `doing 6`, `done 3`, `review 6`, `todo 6`, `No value 3`. Card height 102 px, pitch 110. Titles follow the view sort.
- ArrowDown twice, ArrowRight, End, one `tabindex="0"` card, Enter opens. Click opens.
- Move left writes the Manual order block. Hide review leaves "18 results". **+** creates `KB/Untitled.md` with `status: review` and the review count goes to 7.
- Search `t2` keeps the column names and the counts sum to the result count. Escape clears. The ungrouped view is "All results 25" and its prompt opens the Group menu.
- P11: the line "after the board" has the same y at first paint and 600 ms later. Board height 400 px.

## Performance

Headless Chromium, scratch vaults under the test's temp dir. The dedicated Kanban run is the review measurement. The `npm test` row is the same script later in the suite.

| Check | NOTES_K4 | This dedicated run | Inside `npm test` |
|---|---|---|---|
| P1 warm open (median of 3) | 15–21 ms, median 17.6–20.8, no long task | 15.7, 18.1, 20.6 → **18.1 ms**, no long task, no stale card | 14.1, 20.3, 20.9 → **20.3 ms** |
| P1 cold first open | 65 ms, one 63–81 ms long task | **66 ms**, one **64 ms** long task | **61.2 ms**, one **60 ms** long task |
| P2 10,000-card column, 5,000 px wheel | p95 16.8, max 16.8, ≤15 cards | p95 **16.7**, max **16.8**, 15 cards, no long task. Column `scrollTop` passed the test's 100,000 px check | p95 16.8, max 16.8, 15 cards |
| P3 200 columns | p95 16.8, max 16.8, ≤7 columns, 5 visible | p95 **16.8**, max **16.8**, 7 columns, visible 5, `scrollLeft` 50,000 | same p95 / max / 7 columns |
| P11 embed | 15.2–15.7 ms, height 400 | **16.0 ms**, height 400, line y unchanged | **15.9 ms** |

Plan budgets: warm open ≤150 ms, scroll p95 ≤16.7 and max ≤20 (the test allows p95 ≤20 and max ≤25), ≤40 cards, ≤ visible+2 columns, embed ≤100 ms. All of those held. No warm open had a long task over 50 ms.

**Wheel steps.** A scratch script in `/tmp` (deleted after) opened the same 10,000 notes and wheeled 300 px, then 5,000 px.

| Scroller | 300 px (60 events) | 5,000 px (40 events) |
|---|---|---|
| Table `.bases-scroll` | median 16.8, p95 33.4, max 33.4, 59 of 119 frames over 30 ms | median 16.7, p95 33.3, max 33.4, 4 of 79 frames over 30 ms |
| Board column | median 33.2, p95 33.4, max 33.4, 59 of 118 frames over 30 ms | median 16.7, p95 16.8, max 33.4, 3 of 117 frames over 30 ms |

Small deltas do run at about 30 fps on both scrollers. The board's 5,000 px run stays at 16.7–16.8 ms, which is what P2 measured over the full 3 s (p95 16.7, max 16.8). The test's comment at `test-bases-kanban.mjs` is fair. `test-bases-groups.mjs` already uses 5,000 px steps.

**Cold open.** The dedicated board cold open had one ~60 ms long task, as NOTES_K4 said. The scratch script warmed the app on a one-row base first, then opened the 10,000 notes. First open was 52.3 ms as a table and 50.3 ms as a board, with no long task on either. Warm opens were 22.2 ms and 22.9 ms, with no long task. The first select of 10,000 notes sits on the 50 ms line for both layouts and sometimes records one long task. That is the B7 property read, and it is the same shape for the table. No K4 change.

## Existing benches

Same machine, lock held, one run unless noted. Compare with NOTES_K4's after column and with this machine's K13 search numbers.

Search (`bench-bases-search.mjs`), work median ms, no long task, max frame 16.8 everywhere:

| | NOTES_K4 after | K13 on this machine | This run |
|---|---|---|---|
| 5k table / grouped / cards | 5.9 / 9.4 / 1.7 | 6.4 / 9.9 / 1.7 | **6.1 / 9.0 / 1.8** (max 11.5 / 9.7 / 2.8; frames 1×4, 2-1-2-2, 1×4) |
| 50k table | 8.5, 11.2, 8.1 | 8.1 | **8.1** (max 12.7, frames 2,1,1,1) |
| 50k grouped | 53.3 and 52.8 (one 89.8 sample); K3 band 47.8–68.1 | 58.7 | **53.7** (max 55.2, frames 4,2,5,4) |
| 50k cards | 6.0, 22.5, 17.9 | 5.7 | **6.1** (max 12.3, frames 1,1,2,1) |

Groups (`bench-bases-groups.mjs /tmp/grove-bases-b5-claude-review/vault`). The script's "before" column is `git show 08641e4` of `model.ts`, so the review comparison is the after column. `.b5-model-before.ts` was removed by the script both times.

| | NOTES_K4 after | Run 1 after | Run 2 after |
|---|---|---|---|
| 5k select tag / formula | 10.6 / 10.4 | 8.8 / 9.5 | 8.4 / 9.1 |
| 50k select tag / formula | 103.4 / 168.0 | 103.5 / 167.8 | 101.5 / 171.7 |
| 50k aggregation CPU (3 samples) | 114–116 | 107.1, 107.0, 109.1 | 106.5, 104.3, 104.7 |
| 50k first aggregation wall / max slice | (K3 wall 191, slice 5.07) | 193.1 / 5.08 | 202.4 / 5.05 |
| Browser 50k folders CPU / wall | 130.2 / 418.9 | 122.8 / 383.6 | 127.4 / 392 |
| Browser 50k distinct CPU / wall | 176.4 / 564.7 | 213.3 / 708.6 | 205.3 / 663.6 |
| Max slice / max frame | 5–5.1 / 16.8 | 5.1 / 16.8 | 5.1 / 16.8 |

Select, aggregation slices, folders, and frames sit in the earlier band. The distinct browser wall is higher on both runs (664 ms and 709 ms) than NOTES_K4's 565 ms after and 616 ms before. That harness builds a grouped table from `model.ts`, `groups.ts`, and `cards.ts`. It does not mount the board. K4's `model.ts` change is the kanban type check. Max frame stayed 16.8 ms and the slice stayed at 5.1 ms, under the bench's 20 ms asserts. Left as a measurement gap on a grouped table, not a board defect.

Frontend (`bench-frontend.mjs 5000`), medians:

| | NOTES_K4 after | Run 1 | Run 2 |
|---|---|---|---|
| tags / search / link refresh | 10.6 / 13.7 / 40.7 | 11.1 / 13.4 / 45.1 | **10.3 / 12.9 / 40.0** |

Run 1's link-refresh samples were 55.9, 41.6, 45.1. Run 2's were 52.4, 39.5, 40.0. The quiet run matches NOTES_K4.

## Checks

- `npm run build`: passed, built in 355 ms. The existing chunk-size warning remains.
- `npm run audit:offline`: passed, 180 source files.
- `cargo build --offline` from `rebuild/app/src-tauri`: passed, dev profile in 7.23 s.
- `cargo test --offline`: test profile in 3.01 s, **67 passed, 3 ignored**, test run 0.06 s. Rust is unchanged.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0, about 609 s. Vitest 70 files, 1,226 tests. 2,056 `PASS` lines, including geometry, real-mouse scripts, and `posttest`. No timing flake, so nothing was rerun.
- In that npm run: warm 1,000-note open 8.6 ms; 1,000-row scroll max frame 16.8 ms; B0 cold 41.6 ms, warm 18.8 / 12.0 / 13.9 ms; embed cold 23.4 ms, warm 6.9 / 6.7 / 8.3 ms; 300-card drag max 16.8 ms.

## Left open

1. The cold first open of a 10,000-note base can record one ~60 ms long task. A paired table open is the same size. B7 owns that select. This review did not start it.
2. K5 owns card drag, Space pick-up, undo, the drop placeholder, and the read-only lock icon. The column **+** seed is already in place.
3. K6 owns a fast path after the view's own write. A rebuild remounts the visible columns.
4. Column width follows `cardSize` when it is set (at least 200 px) and is 272 px otherwise. Configure view has no width control. The Cards layout has none either.
5. `type: kanban`, `cardSize` as column width, and the cover keys remain Grove's guess (D2). The Views page names no YAML keys, and nothing was fetched.
6. Plan R2, a real WebKitGTK check, still waits until after K5. These numbers are headless Chromium.
