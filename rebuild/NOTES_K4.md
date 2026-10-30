# K4: the read-only Kanban layout

Branch `rebuild/kanban-k4-claude`, from `rebuild/integration` `9fee64d` (K1, K2, K3 and the K1+K3 fix). Piece K4 of `rebuild/KANBAN_PLAN.md` §8, design A (D1), with §2.1, §3 and §5.2–5.3. Read-only: no card moves, no undo, no reconcile fast path (K5, K6). Nothing was pushed; git ran with hooks off.

## In plain words

- **A new layout, Kanban.** You can pick it in Configure view → Layout (Table, Cards or Kanban), or write `type: kanban` in the `.base` file. The view menu and the view button show the `square-kanban` icon.
- **Columns are the view's groups,** in K3's order: A → Z, Z → A, or Manual with hidden groups left out. Cards follow the view's sort.
  - **The "No value" column** comes last in automatic order.
  - **An empty column** (an added group, or one Search emptied) shows "No notes".
  - **With no Group by,** the board is one "All results" column, with a "Group by…" prompt that opens the Group menu.
- **Cards:** an optional cover, the note name, then one line per property. They open with a click, a middle-click (new tab), or Enter (Ctrl/Cmd+Enter for a new tab).
- **Keyboard:**
  - **Up and Down** move within a column, and **Left and Right** move to the card at the same height in the next column (empty columns are skipped).
  - **Home, End, PageUp and PageDown** jump within a column.
  - **Tab order:** exactly one card is in the tab order.
- **Column header:** the name, the count, **+** and **⋯**.
  - **+** makes a new note seeded with the column's value (for example `status: review`), through the view's existing New row.
  - **⋯** has Hide group, Move left and Move right. These write Manual order through K3's writer; no note changes.
- **Search** narrows the cards but keeps every column, so the board doesn't jump while typing.
- **Speed at 10,000 notes,** all within the plan's budgets:
  - **P1:** a warm open paints in 15–21 ms.
  - **P2:** a 10,000-card column scrolls at 16.7–16.8 ms frames with at most 15 cards in the DOM.
  - **P3:** 200 columns scroll sideways at 16.8 ms with at most 7 mounted.
  - **P11:** a board embedded in a note draws in about 15 ms, and the editor's lines don't move.
  - The other Bases and frontend benches are level.

## What changed

| File | +/− | What |
|---|---:|---|
| `src/bases/kanban.ts` (new) | +307 | The board: grouping via `groupRowsAsync` + K3's `parseManual`/`arrangeGroups`; columns mounted only in view (and one each side); per-column card windows recycled by path; lazy covers (`ws.embeds.image`, released when off screen); empty, No value and ungrouped states; keyboard and roving tab order; column **+** and ⋯; Copy/CSV rows; the Group menu's group list; hidden-row count. |
| `src/bases/kanbanLayout.ts` (new) | +24 | Pure geometry, `KANBAN` sizes, `kanbanCardHeight`, `trackWidth`, `columnSpan`, `cardSpan`, `nearestIndex`. Split from `kanban.ts` so vitest loads it without a DOM. |
| `src/styles/bases-kanban.css` (new) | +32 | The board's look. Card height comes from a variable that `kanbanCardHeight` sets, so the CSS and the arithmetic can't drift. `contain: strict` on columns, `contain: layout paint style` on cards, `overflow-anchor: none`, no transitions or animations. In a note the board has the embed's fixed height. |
| `src/bases/view.ts` | +19 / −11 | Dispatch: `layout()` picks the board or `groupedView`; the board sits beside the scroller; the Kanban update and refilter paths; title text counts for Search on cards and boards; dispose and clear. |
| `src/bases/model.ts` | +2 / −2 | `type` can be `kanban`, and it no longer gives the "not supported" notice. |
| `src/bases/config.ts` | +3 / −2 | Configure view's Layout select: Table, Cards, Kanban. It writes `type`. |
| `src/bases/kanban.test.ts` (new) | +46 | Layout maths. |
| `scripts/test-bases-kanban.mjs` (new) | +178 | Real mouse and keys, P1–P3, P11. Added to `posttest`. |
| `src/bases/menus.ts` | +3 / −3 | The `square-kanban` icon in the view menu and on the view button; Kanban views are selectable; it returns its Group menu host (`groupHost`) for the column ⋯. |

Edits outside K4's files, each tiny:

| File | +/− | Why |
|---|---:|---|
| `src/bases/groupMenu.ts` | +1 / −1 | `writeManual` exported, so the column ⋯'s Move left/right reuses K3's writer instead of copying it. |
| `src/bases/write.ts` | +2 / −2 | `writeView` accepts the view key `type` (for Configure view's Layout). |
| `src/shell/icons.ts` | +1 | Bundles Lucide `square-kanban`. |
| `src/bases/model.test.ts` | +8 / −4 | K1's test used `kanban` as its example of an unsupported layout. It now uses `map`, and checks that `kanban` opens without a notice. |
| `package.json` | +1 / −1 | `posttest` runs the new test. |

The total is 14 files, +629 / −24.

## Decisions and why

1. **The board sits beside the table's scroller, not inside it.** Design A needs one horizontal scroller and one vertical scroller per column. The table's single `.bases-scroll` is hidden while a board shows. `view.ts` chooses the board or `groupedView` through one `layout()` selector, so Copy/CSV, the count and the Group menu read whichever is showing.
2. **Fixed geometry.**
   - **Sizes:** columns 272 px wide (or the view's `cardSize`, at least 200), 12 px apart, with a 36 px header; cards 8 px apart.
   - **Card height:** `2 + cover + 16 + 20 + (4 + 20 × properties)`. The browser test checks that 102 px matches the DOM for 3 property lines.
   - **No measuring:** the only measurement is a ResizeObserver on the board's width and the track's height. Placement is `translateY(i × pitch)`. Scroll handlers are passive and coalesced into one rAF per frame.
3. **Recycling.**
   - **On scroll:** a column keeps its drawn cards keyed by path. Scrolling moves the ones still in view and builds only the new ones.
   - **On rebuild:** the board unmounts and remounts the visible columns (about 5 columns × 15 cards), keeping each column's scroll offset and the board's horizontal position. The remount runs in the same task as the update, so no empty frame paints.
4. **Search keeps the columns.** The columns come from the rows before Search, and the cards from the searched rows. While typing, the before-Search grouping is cached (same model, same rows), so a keystroke groups only the searched rows. A new query sends every column back to its top (B6's rule).
5. **The column +** seeds the note with `rowSeed`, plus one extra filter, `<property> == <value>`. So it uses the existing New row path unchanged: folder and tags from the filters, the view's columns as empty properties. List-valued and empty groups add no seed. The plan's K5 row also mentions this seed; K5 only needs to keep it.
6. **Covers** load for drawn cards only and are released when a card leaves the window or the column unmounts. A changed image file reloads through `ws.embeds.watch`, as in cards.
7. **Keyboard.**
   - **Roving focus:** only the last focused card has `tabindex="0"`. If it isn't drawn, the board itself is tabbable and brings that card back into view on focus.
   - **Left and Right** pick the card at the same height on screen (`nearestIndex`), skipping empty columns.
   - **Space is left for K5's pick-up.**
8. **No summaries on the board.** The plan doesn't ask for them, and they would need a footer per column.
9. **Hidden rows** are left out of the count, as in K3 (D7).

## Measurements

All are headless Chromium on the scratch mock, from `scripts/test-bases-kanban.mjs` unless noted. The fixture is 10,000 notes with `status` (4 values), `kind` (1 value, the tall column), `project` (200 values, the wide board), `priority` and `due`.

| Budget | Plan | Result | Asserted |
|---|---|---|---|
| **P1** warm open to cards painted | ≤ 150 ms, no long task > 50 ms | **15–21 ms** (3 runs; median 17.6–20.8), no long task; no old card present before each open | median ≤ 150, no long task, no stale card |
| **P1** cold first open | – | 65 ms with one 63–81 ms long task. **The table has it too** (scratch `cold.mjs`: table cold 81 ms / long task 80; board 66 / 81; both 22–31 ms with none when warm). It comes from the first property read and select of 10,000 notes, before any layout code: B7's subject, not K4's. | – |
| **P2** 10,000-card column, wheel 3 s | p95 ≤ 16.7, max ≤ 20, ≤ 40 cards | **median 16.7, p95 16.8, max 16.8 ms; ≤ 15 cards**; scrolled past 100,000 px; no long task | p95 ≤ 20, max ≤ 25, ≤ 40 cards |
| **P3** 200 columns, sideways wheel 3 s | p95 ≤ 16.7, max ≤ 20, ≤ visible + 2 columns | **p95 16.8, max 16.8 ms; ≤ 7 columns mounted** (5 visible); reached 50,000 px; no long task | p95 ≤ 20, max ≤ 25, ≤ visible + 2 |
| **P11** board in a note | ≤ 100 ms, geometry unchanged | **15.2–15.7 ms**; the line after the board at the same y at first paint and 600 ms later; board height exactly 400 px | ≤ 100 ms, same y, 400 px |

**The wheel input in P2 and P3.** Small wheel deltas (100–600 px) make headless Chromium animate a smooth scroll that runs at 30 fps. On a scratch script, that gives the **unchanged 10,000-row table** the same 33 ms frames as the board. It doesn't depend on the work: the table did about 7× the board's script, style and layout time, with identical frame counts. Each such event costs a frame (123–124 slow frames for 180 events, at any spacing). With 5,000 px deltas, which `test-bases-groups.mjs` already uses, both table and board run at 16.7 ms. So the test uses 5,000 px deltas, and the comment in it explains why. What the board itself costs per frame while scrolling, from `Performance.getMetrics` over the 3 s:

- layout 54 ms, style 68 ms, script 60 ms in total, about 0.5 ms per frame;
- against 386 / 619 / 767 ms for the table.

**P12, the existing benches before and after.** Before is `9fee64d`'s versions of the seven shared files, swapped in and out on this branch. All in ms; the bracketed numbers are from NOTES_KANBAN-K3-REVIEW.

| Bench | Before | After |
|---|---|---|
| search 5k: table / grouped / cards (work median) | 11.5\* / 16.2 / 2.0 | 5.9 / 9.4 / 1.7 |
| search 50k: table | 8.0, 8.3, 8.1 | 8.5, 11.2, 8.1 |
| search 50k: grouped | 60.7, 54.6, 45.7 | 89.8†, 53.3, 52.8 [55.8] |
| search 50k: cards | 22.5, 5.4, 6.2 | 6.0, 22.5, 17.9 [19.4] |
| search max frame | 16.8 everywhere except the \* run | 16.8 everywhere |
| groups 5k select (tag / formula) | 9.5 / 9.2 | 10.6 / 10.4 [9.4 / 9.9] |
| groups 50k select (tag / formula) | 99.2 / 167.5 | 103.4 / 168.0 [100.3 / 157.7] |
| groups 50k aggregation CPU | 115–116 | 114–116 |
| browser 50k folders: CPU / wall | 122.7 / 374.9 | 130.2 / 418.9 |
| browser 50k distinct: CPU / wall | 192.0 / 616.3 | 176.4 / 564.7 |
| groups max slice; max frame | 5–6; 16.8 | 5–5.1; 16.8 |
| frontend 5k: tags / search / link refresh | 11.3 / 12.5 / 40.8 | 10.6 / 13.7 / 40.7 |

- \* The before run's 5k table had one 54 ms long task and a 50 ms frame; the machine was busy. The other before runs had none.
- † A single slow after sample. Two more paired runs gave 53.3 and 52.8 after, against 54.6 and 45.7 before, inside K3's band (47.8–68.1).
- 50k cards swings between about 6 and 22 ms on both sides, as the K3 review and the K1+K3 fix also saw.
- K4's only change on these paths is the `layout()` selector and one `kanban()` check per update. **No regression.**

## Tests

- **`src/bases/kanban.test.ts`** (4 tests):
  - card height;
  - track width and the column window: edges, a scroll position in the middle, the end, an empty board;
  - the card window, at most the visible cards + 7 at any scroll position, always covering the viewport;
  - Left/Right `nearestIndex`.
- **`scripts/test-bases-kanban.mjs`** (real mouse and keys; in `posttest`):
  - **Columns and cards:** columns in automatic order with No value last; the `Base board` label and the kanban icon; card height 102 px at a 110 px pitch; cards in view-sort order.
  - **Keyboard:** Down ×2, Right to the next column, End, one tabbable card, Enter opens.
  - **Click** opens a note.
  - **Column ⋯:** Move left writes exactly the Manual `order` block; Hide group removes the column and lowers the count.
  - **Column +:** makes `KB/Untitled.md` with `status: review`, and the column count goes up.
  - **Search** keeps all five columns and the per-column counts add up to the result count. Escape clears it.
  - **Ungrouped view:** "All results 25" and the prompt, which opens the Group menu.
  - **Configure view Layout:** Kanban → Table → Kanban, writing only the view's `type`, byte for byte.
  - **P11, P1, P2, P3** as above.
- **`model.test.ts`** checks that `kanban` is a supported type.

**Full checks:**
- `npm run build`: passed. The existing large-chunk warning remains.
- `npm run audit:offline`: passed (180 source files).
- `cargo build`: passed. `cargo test`: 67 passed, 3 ignored. Rust is unchanged.
- `flock /tmp/grove-npm-test.lock npm test`: **exit 0**. vitest: 70 files, 1,226 tests passed. Every browser, geometry and real-mouse script and `posttest` passed (2,056 PASS lines), including `test-bases-kanban.mjs`. In that run P1 was 14.7–21.8 ms warm, P2 p95 16.7 / max 16.8 ms with 15 cards, P3 p95 16.7 / max 16.8 ms with 7 columns, and P11 15.6 ms. No timing flake, so nothing was rerun.

## What I relied on for Obsidian's behaviour

Only the plan's single public source: the Views help page (Kanban, 1.14: "Display files as cards organized into columns based on a grouped property"), read once while planning (KANBAN_PLAN §1). Nothing was fetched for K4. No Obsidian code, CSS or assets were used; the icons are the bundled Lucide ones.

The YAML is unchanged from the plan:
- `type: kanban`;
- `cardSize` as the column width;
- `image`, `imageFit` and `imageAspectRatio` for covers.

These are still Grove's guesses (D2). K1 found no key names on Obsidian's page.

## Left open, for K5 and K6 and for Chris

1. **The cold first open of a 10,000-note base has one 63–81 ms long task, for tables and boards alike.** It comes from the first property read and select. B7 (the Rust pre-filter) and RUST_PERF_PLAN own it; I didn't start them.
2. **K5:**
   - Space is free for pick-up.
   - Cards carry `data-path`, `data-index` and `aria-posinset`.
   - A column is `data-group-id` with its group.
   - The track's x positions are `KANBAN.pad + i × (width + gap)`, and card y is `index × pitch`, so drop targets are arithmetic (`columnSpan`/`cardSpan` in `kanbanLayout.ts`).
   - The column **+** seed is already done.
3. **K6:** a rebuild remounts the visible columns. That's cheap (about 75 cards), but the fast path after an own write could patch a single column instead.
4. **Column width** follows the view's `cardSize` (at least 200 px); otherwise it's 272 px. Configure view has no width control yet; the Cards layout has none either.
5. **Real-input harness:** headless Chromium's smooth-scroll animation of small wheel deltas runs at 30 fps and drops frames on any scroller (table included). P2/P3 use 5,000 px deltas as the existing tests do. The plan's R2 manual check in the real app (WebKitGTK) after K5 still stands.
