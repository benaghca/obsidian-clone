VERDICT: OK

Reviewed Grok c's Kanban K8 on `rebuild/k8-review-grok`, taken from `rebuild/kanban-k8-grok` at `d4ed57c`. That branch is still at `d4ed57c`. Parent is `ba9e4ac`. Nothing was pushed. This review changes no product code.

Relied on `rebuild/NOTES_KANBAN-K8.md` and `rebuild/KANBAN_PLAN.md` (sections 2.3, 5, 7 D1–D16, and the K8 row in section 8). The builder's notes already cite the public pages read on 2026-10-30: https://obsidian.md/help/bases/views , https://obsidian.md/help/bases/views/list , and https://docs.obsidian.md/plugins/guides/bases-view . Nothing was fetched for this review. No Obsidian code, CSS, or assets were used.

## Scope

`ba9e4ac..d4ed57c` is 12 files, +773 / −25. It stays in K8's files (`bases/list.ts`, `styles/bases-list.css`, `model.ts` for `type: list`, markers, separator, and the indent notice) plus the hooks the layout needs: `view.ts` dispatch, `config.ts` layout and Markers, `menus.ts` glyph, `write.ts` so `markers` is a scalar, the unit and browser tests, and `package.json` posttest. `groups.ts` is unchanged. No Rust, dependency, or API schema change.

| File | +/− | Why |
|---|---|---|
| `src/bases/list.ts` | +228 | `listLayout` and `createList`. Fixed 28px rows, 32px headings, overscan of 8. |
| `styles/bases-list.css` | +51 | Those heights, no transition, no vertical margin. |
| `src/bases/model.ts` | +22 / −3 | `type: list`, markers, separator, indent notice, `viewGlyph`. |
| `src/bases/view.ts` | +25 / −12 | Dispatch. The list uses the existing scroller and K3's collapse set. |
| `src/bases/config.ts` | +7 / −4 | Layout option List, and Markers while the layout is list. |
| `src/bases/menus.ts` | +3 / −3 | The view menu and toolbar use `viewGlyph`. |
| `src/bases/write.ts` | +2 / −2 | `markers` round-trips through `writeView`. |
| tests and `package.json` | the rest | Unit math, the browser script, and posttest before the property-edit fuzz. |
| `NOTES_KANBAN-K8.md` | +83 | The builder's notes. |

## What the probes held

Headless Chromium, CDP pointer and keys, scratch vault under the test's temp dir. A throwaway probe (not committed) went after the cases the review named.

An empty manual group draws `blocked (0)`. The null group is labeled `Empty (1)`, the table's label. The hidden group `later` is absent. The count is `7 results` and the tooltip is `1 in hidden groups`. Collapsing the empty group leaves the count and the `.base` bytes alone. Hide group on a heading writes that view's manual `hidden` list and drops those rows from the count (`7` to `5` when the heading held 2, tooltip `3 in hidden groups` with the note already hidden).

A file named `.md` is absent. `Upper.MD` is a note. A leading BOM still groups `Bom.md` under `todo`. A CRLF note groups under `doing`. A very long title stays 28px tall, ellipsized, and within half the row. The line shows `false`, `0`, and `#ERROR!`, and skips an empty string. Numbering in the `todo` group is `1.` `2.` `3.`.

Search for the note name leaves one row and `1 results`. Copy to clipboard is that row only. The cell text is the note name `A`, then the values. The formula cell in the TSV is `#ERROR: Division by zero`, which is the shared Copy path's value; the painted line is `#ERROR!`.

Renaming `A.md` to `A2.md` and deleting `B.md` update the open list. Writing `status: todo` on a shown note moves it into the `todo` group. On the table view of the same base, the status Count footer is `7`, and after a search that leaves one row it is `1`. Edit property writes `displayName: State` and leaves the note's frontmatter as it was. One `displayName` key.

A keyboard move on the board (`todo` to `doing`) shows the note under `doing` on the list. Creating another note and pressing Ctrl+Z with the board focused restores the first note, and the list follows. Ctrl+Z while the list view is focused leaves the moved note in `doing`. Focusing the board again and pressing Ctrl+Z still undoes. K8 does not add a move gesture; the undo key stays on the board.

An embedded list keeps the following editor line 24px under the widget through a collapse. The scroller is 324px, then 184px, both inside the 400px cap. No `.cm-content` child has a vertical margin.

Scrolling an 80-row list leaves the view's listeners as `focusout` and two `keydown` handlers. 36 rows stay mounted.

## Performance

Headless Chromium, inside `flock /tmp/grove-npm-test.lock npm test`. Plan slack is a scroll frame p95 of 20ms. The samples sit on one 60fps frame.

| Check | NOTES_KANBAN-K8 | This `npm test` |
|---|---|---|
| List, 1,000, warm open | 9.2 ms, 36 rows | **10.4 ms**, 36 rows |
| List, 1,000, scroll | max 16.8, p95 16.8, 45 rows | max **16.8**, p95 **16.7**, 45 rows |
| List, 10,000, cold open | 34.4 ms, no long task | **38.4 ms**, no long task, 36 rows |
| List, 10,000, warm open | 18.4, 14.4, 15.8 (median 15.8) | 18.1, 14.1, 16.2 (median **16.2**), no long task |
| List, 10,000, scroll | p95 16.8, max 16.8, top 279218 | p95 **16.7**, max **16.8**, 45 rows, top 279218, no long task |
| Table, 1,000-row scroll | 16.8 ms | **16.7 ms** |
| 300-card drag | (suite) | max **16.8 ms** |
| Kanban P1, 10,000 | warm median 18, cold 70.6, long task 69 | warm median **18**, cold **64.4**, long task **63** |
| 5,000-row table typing (B0) |  | frames **16.7 ms**, 0 rebuilds during the burst |

P10, typing beside a 10,000-card board, belongs to K6 and has no test on this branch. The 5,000-row table typing check above is the suite's stand-in, and it passed.

## Checks

From `rebuild/app`: `npm run build` exit 0 (the existing chunk-size warning on the main bundle remains), `npm run audit:offline` passed (185 source files), `flock /tmp/grove-npm-test.lock npm test` exit 0 in 641 s (vitest 73 files, 1243 tests, including 444 parity cases, then the browser scripts and posttest). From `rebuild/app/src-tauri`: `cargo test --offline` 73 passed, 4 ignored; `cargo build --offline` exit 0. No Rust file changed. No timing flake needed a rerun. Screenshots under `rebuild/round*-shots/` were restored and are not in the commit.

The UI was exercised in headless Chromium only. The task forbids opening a Grove window.

## Scratch merge

`rebuild/integration` was `565d826` when the review started and had moved to `c0ad2bf` (CZ2 merged) before the scratch merge. A detached worktree at `/tmp/k8-int` merged `rebuild/k8-review-grok` onto `c0ad2bf`. The only conflict is `rebuild/app/package.json`: both sides edited the scripts block. The resolution keeps integration's `test` script, including `test-canvas-zoom-trace.mjs` and `test-canvas-board-menu.mjs`, and K8's `posttest`, which inserts `test-bases-list.mjs` before the property-edit fuzz. No other file conflicts. Integration has not changed `view.ts`, `model.ts`, `menus.ts`, `config.ts`, or `write.ts` since `ba9e4ac`, so the merged Bases sources are this branch's.

On that tree, with `node_modules` linked from this worktree and no install: `vitest run` passed (73 files, 1245 tests) and `node scripts/test-bases-list.mjs` passed (10,000-row scroll p95 16.8 ms, max 16.8 ms, no long task). The worktree was removed. It was not committed and not pushed.

## Left open

- Indent / nested properties. The notice is the whole behavior. A variable row height would drop the fixed window.
- The YAML names `markers`, `separator`, and `propertySeparator` are unverified against a file Obsidian saved. Configure view writes `markers` only.
- Configure view still shows Row height for a list. The list does not use `rowHeight`. There is no separator field. A separator already in the file is kept.
- A list view with `summaries:` does not draw a summary row. The table view of the same base still does, and that footer follows the search. Copy uses the shown groups, collapsed groups included, hidden groups left out.
- Ctrl+Z undoes a card move when the board is focused. The list view does not take that key.
