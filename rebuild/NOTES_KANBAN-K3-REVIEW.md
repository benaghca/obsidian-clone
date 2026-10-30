VERDICT: OK

Review of Claude's Kanban K3 on `rebuild/k3-review-grok`, created from `rebuild/kanban-k3-claude` (`86a3609`, still there). Parent is `eb02c47` (integration `f112151` plus the Kanban plan and mockups). One product fix is on this branch: `3b5401c`. Nothing was pushed. `rebuild/k1-review-grok` is still `74cd188`.

`f112151..eb02c47` is 17 files, +1,237, all under `rebuild/KANBAN_PLAN.md` and `rebuild/kanban-mockups/`. The runtime K3 started from is the `f112151` runtime.

## What was reviewed

`eb02c47...86a3609` is 11 files, +762 / −23. The prompt names three commits. The branch also has `b70925f` between `eb02c47` and `e09c966`. All four were reviewed:

- `b70925f` Manual group order and hidden groups in `groupBy`
- `e09c966` toolbar Group menu, Hide group, collapse per tab
- `30ad902` real-input browser test `scripts/test-bases-group-order.mjs` (P8/P9)
- `86a3609` `rebuild/NOTES_K3.md`

| File | Lines | Role |
|---|---|---|
| `src/bases/groupMenu.ts` (new) | +214 | Group menu |
| `src/bases/groups.ts` | +92 / −10 | `parseManual`, `arrangeGroups`, collapse hook. `parseGroupBy` unchanged |
| `src/bases/menus.ts` | +17 / −5 | Toolbar Group button and heading Hide group |
| `src/bases/view.ts` | +15 / −7 | Per-tab collapse key, hidden rows out of the count |
| `src/styles/bases.css` | +32 | Menu rows. No transition, animation, or `.cm-content` margin |
| `src/bases/groupOrder.test.ts` (new) | +64 | Round trip and arrange |
| `scripts/test-bases-group-order.mjs` (new) | +185 | Real mouse and keys, P8/P9 |
| `package.json` | +1 / −1 | `posttest` runs the new browser test |
| `src/bases/write.ts` | +2 | Flow list for a list inside a list |
| `src/shell/icons.ts` | +1 | Lucide `eye` beside the existing `eye-off` |
| `NOTES_K3.md` | +139 | Claude's notes |

`model.ts` is untouched. Claude's "+623 / −23 across 10 files" is this diff with `NOTES_K3.md` left out (623 + 139 = 762).

## Scope

The owned files match the plan: new `groupMenu.ts`, arrange and collapse in `groups.ts` (not `parseGroupBy`), toolbar and heading items in `menus.ts`, tab memory in `view.ts`, `bases.css`, and the tests.

The three edits outside that list are small and safe:

- `write.ts` writes a nested array as a flow list (`- [a, "b, c"]`). The YAML reader has no nested block lists, and the old path would have emitted numeric keys. The branch runs only for an array item inside an array. The round-trip test locks the bytes, including a comma inside a quoted item, and locks that the rest of the file is unchanged.
- `icons.ts` adds `eye` from the bundled Lucide set, used by Show all. `eye-off` was already there. `npm run build` typechecks the icon name.
- `package.json` adds the new browser script to `posttest`, which is how the other Bases browser tests run.

## Plan checklist

Manual is `groupBy.order` present as a list. `hidden` without `order` is ignored. `parseManual` notices a non-list, an unreadable mapping, and a list longer than 1,000 (first 1,000 used). Picking Manual stores the current automatic order and writes no `hidden` key when nothing is hidden. A→Z and Z→A go through `withManual`, which drops `order` and `hidden` and keeps `direction` and any other `groupBy` keys. Changing the grouped property writes only `{ property, direction }`. The trash control removes `groupBy`. The older header items "Group A → Z" and "Group Z → A" still replace `groupBy` with `{ property, direction }`, so they also drop extra keys. That writer predates K3. Their checkmark is off while Manual is on.

Hidden groups are out of paint, the result count, per-group summaries, the all-footer, and Copy/CSV (`rows()` is the shown groups, including collapsed ones). Search still runs first: `update` receives the searched rows, then drops hidden groups. Collapsed groups stay in the counts. The browser test checks that collapse writes nothing, and that Add group leaves the note count at 6. Add group does not create a note. ✕ only removes an added empty group.

Collapse is a `WeakMap` on the tab, keyed by the watched path (or `block:<host>` for a fence with no path), the view name, and the group property. It is not written to the `.base`. It survives a view switch and leaving the base and coming back in the same tab. Alt+Shift+↑/↓ collapses and expands all, and is ignored in a field and while the view is busy.

The Manual picker is disabled above 1,000 live groups unless the view is already Manual (D11). `hideGroup`, `groupEntry`, and `withManual` are exported for the later column drag (D13). The toolbar Group button is present (D14), between Sort and Filter, reading "Group · status" or "Group · status · Manual" via the detail span plus the existing `· ` pseudo-element.

The menu virtualises at 28 px, shows a filter above 30 groups, opens on frame 1, and has no open animation. Drag uses the existing `drag` helper. Escape during a drag cancels the drag and writes nothing.

## Trial merge with K1

`git merge --no-commit --no-ff rebuild/k1-review-grok`, then `git merge --abort`. Git auto-merged `groups.ts` and stopped before committing (exit 0, no unmerged paths). The abort restored the tree. The merge was not committed.

There is still a behaviour clash once both are combined. K1's `parseGroupBy` notices every key other than `property` and `direction`, so a Manual `.base` would show `Unsupported groupBy settings: order, hidden` (or `order` alone). K3 reads those keys in `parseManual` and does not teach `parseGroupBy` about them. When the two branches merge, leave `order` and `hidden` out of K1's extra-key list. K1 did not rename the keys, so the rename warning in `NOTES_K3.md` does not apply. An unknown `direction` is still a notice on K1 and a fallback to ASC. Grove is Manual only when `order` is a list, which is what `NOTES_K3.md` already says.

## Count clamp

`3b5401c` in `view.ts`. Before `groupedView.update` finishes, the toolbar subtracts the previous hidden-row total from the new row list. A search that shrinks the list below that total showed a negative count for the regroup (about 50–70 ms at 50,000 grouped rows in `NOTES_K3.md`). `shownCount` clamps that stand-in at 0. After update, `counted()` sets the count again and, for a table, sets `aria-rowcount` to the shown count plus the header. It had stayed at the full drawn length. Cards `aria-rowcount` is unchanged. During the wait the count can read 0. The first open of a Manual view can still flash the full count, because the hidden total starts at 0. No test reads `aria-rowcount`. The full `npm test` run below includes this edit.

## Speed

No assertion was weakened. No long task over 50 ms. Worst frame in the search bench and the groups bench is 16.8 ms.

P8/P9 from this review's full `npm test` (same script as `NOTES_K3.md`):

| Measure | NOTES_K3 test run | This review |
|---|---|---|
| P9 table, 10,000 rows | median 2.8 ms, 1 frame | work 2.7–3.0 ms, all 1 frame, no long task |
| P9 cards | median 3.4 ms, 1 frame | work 3.3–3.5 ms, all 1 frame, no long task |
| P8 open, 1,000 groups | frame 1, 20 DOM rows, filter shown, max frame 16.8 ms | same, 3 of 3, max frame 16.7–16.8 ms |
| P8 drag | p95 16.8 ms | 80 frames, median 16.7, p95 16.7, max 16.8 ms |

`NOTES_K3.md`'s looser scratch P9 (4.9–5.7 ms table, 3.6–4.2 ms cards) was not repeated. The checked-in test is the one that asserts the budget.

Search bench, `node scripts/bench-bases-search.mjs` (5,000 and 50,000). Work is the median. Frames are the four keys that change the rows.

| Rows / view | NOTES_K3 before (`eb02c47`) | NOTES_K3 after | This review |
|---|---|---|---|
| 5,000 table | 6.0 ms | 6.0 ms | 6.2 ms (max 11.8), frames 1, 1, 1, 1 |
| 5,000 grouped | 11.5 ms | 10.8 ms | 13.1 ms (max 14.9), frames 2, 1, 2, 2 |
| 5,000 cards | 1.6 ms | 1.4 ms | 1.4 ms (max 2.7), frames 1, 1, 1, 1 |
| 50,000 table | 8.1 ms | 7.8 ms | 8.3 ms (max 21.4), frames 2, 1, 1, 1 |
| 50,000 grouped | 57.6, 56.0, 63.6 ms (4–6 frames) | 68.1, 47.8, 63.9 ms (4–6 frames) | 55.8 ms (max 58.9), frames 5, 2, 5, 4 |
| 50,000 cards | 20.0 ms | 19.0 ms | 19.4 ms (max 19.8), frames 3, 1, 3, 1 |

The 5,000 grouped sample is 13.1 ms, above NOTES_K3's 10.8 ms after and 11.5 ms before. The same bench has moved between sessions on unchanged grouping: the B6 review measured 7.5 ms for 5,000 grouped and 6.0 ms for 50,000 cards, while K3's paired before on `eb02c47` (no runtime change from `f112151`) was 11.5 ms and 20.0 ms. This run matches K3's after column on the heavy cases. The 50,000 grouped work (55.8 ms) sits inside K3's after band (47.8–68.1) and beside the B6 review (52.3 ms, frames 4, 2, 5, 4). That work is sliced across frames. Each frame stays at 16.8 ms. This is the known grouped rebuild from B6, not a new hitch.

Open and scroll, this `npm test`, next to the B6 review on `f112151`:

| Measure | B6 review | This review |
|---|---|---|
| Warm 1,000-note open | 8.3 ms | 8.3 ms |
| 1,000-row scroll, max frame | 16.8 ms | 16.7 ms |
| 1,000 grouped cards scroll | 16.8 ms | 16.7 ms |
| 5,000-row B0 cold | 41.1 ms | 40.9 ms |
| 5,000-row B0 warm | 19.2 / 11.8 / 14.2 ms | 19.8 / 12.3 / 14.9 ms |
| B0 typing frame; rebuilds during / after | 16.8 ms; 0 / 1 | 16.8 ms; 0 / 1 |
| Embed cold / warm | 23.7 / 7.0, 6.6, 7.4 ms | 24.2 / 7.1, 6.9, 7.3 ms |
| Embed paging scroll | 16.7 ms | 16.7 ms |

`bench-bases-groups.mjs` on `/tmp/grove-bases-b5-claude-review/vault` (50,000 notes). The script's "before" column is `08641e4`'s `model.ts`, which the bench loads and deletes. K3 does not change `model.ts`. The useful comparison is this run's after column against the B6 review on the same vault.

| Measure | B6 review after | This review |
|---|---|---|
| 5k select, tag / formula | 8.4 / 9.1 ms | 9.4 / 9.9 ms |
| 50k select, tag / formula | 96.0 / 167.7 ms | 100.3 / 157.7 ms |
| 50k first aggregation | 195 ms wall, max slice 5.05 ms | 191 ms wall, max slice 5.07 ms |
| Browser 50k folders | max frame 16.8 ms | max frame 16.7 ms, max slice 5 ms, 27 DOM rows, 79 ticks |
| Browser 50k distinct | max frame 16.8 ms | max frame 16.8 ms, max slice 5 ms, 8 DOM rows, 120 ticks |

Select samples already swing by more than these gaps (the 50k tag after samples run from 94 ms to 137 ms). Aggregation slices stay under 20 ms and the grouped table stays virtualised. `bench-frontend.mjs` was not rerun. The B6 review's link-refresh numbers are unchanged by this diff, which does not touch search or links.

## Checks

First run, no flake, no retry. The view.ts clamp was already in the tree.

- `npm run build`: passed. The existing Vite large-chunk warning remains.
- `npm run audit:offline`: passed, 176 source files, dist, CSP, capabilities, dependencies.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0. Vitest 68 files / 1,116 tests. 2,049 PASS lines, including `test-bases-group-order.mjs`. Geometry and the real-mouse scripts passed.
- `cargo build --offline` and `cargo test --offline` from `src-tauri`: 58 passed, 0 failed, 2 ignored. The registry was not contacted.

## Left open

These are notes, not fixes. The plan's "one Undo brings the automatic order back" is not built. K5 owns Bases history, and there is no toast-undo helper yet.

Claude's open questions still stand, and I agree with them:

1. A Manual edit writes a full snapshot of every group. A shorter list of only the moved groups would put a new value in an unpredictable place.
2. A stale `hidden` entry that matches nothing is dropped on the next write. A stale `order` entry stays as an empty added group with ✕.
3. Escape during a drag closes the whole menu. Nothing is written.
4. Collapse ends when the tab closes. Leaving the base and coming back in the same tab keeps it.
5. Two base fences in one note with the same view name and group property share collapse.
6. A group emptied by Search or a filter is absent from the menu unless it was added. It returns when rows match again.

Also, an unreadable `order` or `hidden` entry (a mapping) is skipped with a notice and stays on disk until the next Manual edit. That edit writes a snapshot from the groups Grove could read, so the unreadable entry is then dropped. An order string of `Empty` can match the no-value group's label rather than a real value whose id is not `empty`. Adding a group on a `formula.*` column types a numeric-looking string as a number, because formula columns are passed to `typed()` with no property type. Untyped note properties stay text, so `3` stays a string there.

## Obsidian

Nothing was fetched. No Obsidian code, CSS, or assets were used. The only public page in this chain is the one the plan already cites, the Views help page, and that page names no YAML keys. `groupBy.order` and `groupBy.hidden` remain Grove's guess from the plan (D2). The icons are the app's bundled Lucide icons.
