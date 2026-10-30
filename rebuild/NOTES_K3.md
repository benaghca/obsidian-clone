# K3: the Group menu, Manual group order and collapsed headings

Branch `rebuild/kanban-k3-claude`, from `eb02c47` (the approved Kanban plan on `rebuild/integration` `f112151`). Piece K3 of `rebuild/KANBAN_PLAN.md` §8: §2.2, §2.3 and §3.1–3.4, with decisions D5, D7, D11, D13 and D14 as approved. Nothing was pushed.

## In plain words

- **A Group button in the toolbar**, between Sort and Filter (D14). It reads "Group · status", or "Group · status · Manual".
- **The Group menu:**
  - **Group by:** a property, an order (A → Z, Z → A or Manual; the labels follow the type, as in Sort), and a trash button to stop grouping.
  - **In Manual:** every group, with a grip to drag it, a tick to show or hide it, and its count. Below the list are Show all, Hide all, and Add group (an empty group: no note is made or changed). An added group with nothing in it has ✕ to remove it.
  - **Going back:** choosing A → Z or Z → A again drops the manual order and hidden list, so every group is shown in automatic order.
- **Right-click a group heading** for **Hide group**. This switches to Manual and keeps the order on screen.
- **Hidden groups** aren't drawn, counted, summarised or copied (D7). The result count's tooltip says "N in hidden groups".
- **Collapsed headings are now kept per tab** (D5). They survive rebuilds, view switches, Search, and the tab leaving the base and coming back. They are never written to the `.base` file.
- **Alt+Shift+↑ collapses every group, and Alt+Shift+↓ expands them all.**
- **Performance** stays within the plan's budgets:
  - **P8:** the menu with 1,000 groups opens on frame 1 with 20 rows in the DOM, and dragging a row runs at 16.7 ms frames.
  - **P9:** collapse paints on the next frame at 10,000 rows.
  - The existing benches are level.

## What changed

| File | +/− | What |
|---|---:|---|
| `src/bases/groupMenu.ts` (new) | +214 | The Group menu: property and order pickers, the virtual Manual list (28 px rows; a filter box above 30 groups), grip drag, ticks, Alt+↑/↓, Show all / Hide all, Add group, ✕. Also `hideGroup`, plus `groupEntry` and `withManual` (shared with K4/K5 later). |
| `src/bases/groups.ts` | +94 / −8 | `parseManual` (reads `groupBy.order`/`hidden`; separate from `parseGroupBy`), `arrangeGroups`, `MANUAL_LIMIT`; `RowGroup.added/hidden`; the grouped view arranges groups, leaves hidden ones out of paint, summaries and Copy, and reports `groups()` / `hiddenRows()`; collapse state from the host (`collapsed(scope)`); Alt+Shift+↑/↓; heading context menu hook. |
| `src/bases/menus.ts` | +17 / −5 | The toolbar Group button and its detail text, the count tooltip, the heading's "Hide group", and Group A → Z / Z → A in the column header no longer checked while Manual. |
| `src/bases/view.ts` | +17 / −5 | Collapse memory per tab (`collapsedByTab`, beside `viewsByTab`), keyed by base file (or `block:<note>` for a ```` ```base ```` block), view name and group property. Passes the group host to the menus. The count leaves out hidden rows (`counted()`). |
| `src/styles/bases.css` | +32 | Group button detail; menu, rows, grip, drop line, lifted row. No animation. |
| `src/bases/write.ts` | +2 | **Outside K3's files.** A list inside a list (a list-valued group in `order`) is written as a flow list, `- [a, b]`, because `yaml.ts` reads no nested block lists. |
| `src/shell/icons.ts` | +1 | **Outside K3's files.** Bundles Lucide `eye` for "Show all". |
| `src/bases/groupOrder.test.ts` (new) | +64 | 6 vitest tests (below). |
| `scripts/test-bases-group-order.mjs` (new) | +185 | A real-mouse/key browser test, including P8 and P9. Added to `posttest`. |
| `package.json` | +1 / −1 | `posttest` runs the new test. |

The total is +623 / −23, across 10 files.

## Decisions and why

1. **The `.base` keys are exactly the plan's §3.1:** `groupBy.order` (present means Manual) and `groupBy.hidden`, both lists of YAML values, `null` for the empty group. Nothing else is new. The direction (`ASC`/`DESC`) stays in the block, so A → Z / Z → A is one click back.
2. **Manual is read outside `parseGroupBy`.** `parseManual(model.view.groupBy)` reads the raw view YAML, so `parseGroupBy` and `model.ts` are untouched (K1 owns them).
3. **Group identity:** an entry matches a group when `valueKey(entry)` equals the group's id. That is the encoding grouping already uses, so `2026-11-03`, a quoted date and a date value all match one group.
   - **Lists:** a list entry's items are compared as text, as note lists are.
   - **Formula groups:** a text entry that matches no key may name a group by its label. That covers a formula's link, file or date groups, which are written back as their label.
4. **Writing the order.**
   - **A snapshot.** Any change through the menu writes the full order: every group in its current place, as the YAML it was read from (or its value).
   - **Values no note has any more.** A listed value no note has stays as an empty, added group (plan R9). A `hidden` entry that matches nothing is dropped on the next write.
   - **Undo.** Choosing A → Z or Z → A removes both lists, which restores the original `groupBy` bytes; the browser test checks this byte for byte.
5. **`hidden` only counts in Manual** (when `order` exists), as Obsidian's page puts show/hide under Manual. "Hide group" on a heading therefore switches to Manual first, keeping the order shown.
6. **Hidden groups keep their place in the order.** Alt+↑ on the group below a hidden one moves it above the hidden one, as dragging in the list would. The menu lists hidden groups greyed, so that is visible.
7. **Counting (D7).** The count, summaries (the "all" footer too) and Copy/CSV use the shown groups only. The count's tooltip gives the hidden rows. Before a rebuild finishes, the toolbar shows the count with the last known hidden rows, so the count doesn't flash.
8. **Collapse state (D5): per tab, for the session.**
   - **Key:** `<base file, or block:<note>>\0<view name>\0<group property>`.
   - **It survives** rebuilds, view switches, Search, and the tab showing another file and coming back.
   - **It is lost** when the tab is closed, because the state lives on the `Tab` object.
   - **Embeds** use the tab of the note they're in.
   - **Never written:** the test checks that the `.base` bytes and the write count are unchanged.
9. **"Header menu Hide group"** is the group heading's context menu (right-click a heading in table or cards). The column header menu is about columns. Its "Group A → Z / Z → A" items aren't checked while Manual; choosing one restores automatic order, the same as in the Group menu.
10. **Inside the menu component, which owns the keyboard except in inputs:**
    - **Rows are real checkboxes,** so Tab, Space and Alt+↑/↓ work there.
    - **Redraws:** after a list edit, the menu redraws in place, keeping the list's scroll and the focused row. After a property or order change, it opens again over the rebuilt view. If it grows past the bottom of the window, it moves up.
11. **Performance choices:**
    - The Manual list is virtual (fixed 28 px rows, `contain: strict`), so the DOM never holds more than 20 rows.
    - Dragging moves the lifted row and the drop line with `transform` only; the slot is arithmetic, with no layout reads per move.
    - Auto-scroll runs within 20 px of the list's edges.
    - `arrangeGroups` is O(groups) and does nothing when there's no Manual order. The view's no-grouping fast path is unchanged.
12. **D11:** Manual is disabled above 1,000 groups, and the order picker says why. `parseManual` reads at most 1,000 entries, with a notice.
13. **D13** (column-header drag switches to Manual) belongs to the Kanban board (K4/K5). K3 provides what it needs: `hideGroup`, `groupEntry`, `withManual`, and the Manual write helper in `groupMenu.ts`.

**What I relied on for Obsidian's behaviour:** only its public help page "Views" (`help.obsidian.md/bases/views`, which redirects to `obsidian.md/help/bases/views`). It was read once while writing the plan (KANBAN_PLAN §1); nothing was fetched for K3. In particular:

- the Group menu at the top of the view;
- choosing an automatic order or Manual;
- in Manual: check to show and uncheck to hide, Show all / Hide all, dragging the grip, and Add group ("does not create a note or change existing notes");
- choosing an automatic order to restore the order and show all groups;
- collapsing headings in Table, Cards and List as "temporary".

No Obsidian code, CSS or assets were used. The icons are the app's bundled Lucide icons.

## Measurements (before = `eb02c47`, after = this branch; headless Chromium, mock vault)

| Measure | Before | After |
|---|---|---|
| **P9** collapse/expand a heading, 10,000-row grouped **table** (scratch `p9.mjs`, 6 presses) | 4.8–5.2 ms work, every paint on the next frame, no long tasks | 4.9–5.7 ms, next frame, no long tasks |
| **P9**, 10,000-row grouped **cards** | 3.8–4.3 ms, next frame | 3.6–4.2 ms, next frame |
| **P9** in `test-bases-group-order.mjs` (asserts at most 2 frames, under 16.7 ms work, no long task) | – | table 2.8 ms median, cards 3.5 ms; all 1 frame |
| **P8** Group menu with 1,000 groups (Manual): open | – (no menu) | visible on **frame 1** in 3 of 3 opens, max frame 16.8 ms, **20 rows** in the DOM, filter box shown |
| **P8** drag a row 60 moves with auto-scroll | – | 80 frames: median 16.7, **p95 16.7**, max 16.8 ms |
| `bench-bases-search.mjs` 5,000 (work median; frames to paint) | table 6.0 / grouped 11.5 / cards 1.6 ms | 6.0 / 10.8 / 1.4 ms |
| `bench-bases-search.mjs` 50,000 grouped, 3 runs each | 57.6, 56.0, 63.6 ms (4–6 frames) | 68.1, 47.8, 63.9 ms (4–6 frames) |
| `bench-bases-search.mjs` 50,000 table / cards | 8.1 / 20.0 ms | 7.8 / 19.0 ms |
| Long tasks over 50 ms in any of the above | none | none |

- **The 50,000-row grouped numbers** overlap run to run (before 56–64 ms, after 48–68 ms), so this is noise rather than a regression. They were taken as paired runs, swapping only my changed files back to `eb02c47`.
- **When a base has no Manual order,** the new work per rebuild is one `order == null` check and one toolbar text update.
- **The 50,000 grouped re-group** (4–6 frames, all sliced) is the known B6 open question 3, not changed here.

## Tests

- **`src/bases/groupOrder.test.ts`** (6 tests):
  - no Manual without `order`;
  - listed first, then automatic, with added and hidden groups;
  - typed matching (numbers, booleans, dates, lists) and the label fallback;
  - notices, the 1,000 cap, duplicates;
  - `groupEntry` / `withManual`;
  - a byte-exact round trip of the `groupBy` block, including `null`, numbers, booleans and a flow list with a quoted comma, and back to automatic.
- **`scripts/test-bases-group-order.mjs`** uses real mouse and keys, and runs in `posttest`:
  - **Toolbar:** the button order is Sort, Group, Filter, Properties, New.
  - **Manual:** writes the automatic order; only `groupBy` changes.
  - **Unticking:** hides a group and lowers the count, with the tooltip.
  - **Grip drag:** shows a drop line and a lifted row, and reorders.
  - **Keyboard:** Space shows or hides a group, and Alt+↑ moves one, keeping focus.
  - **Add group:** shows "empty · added" and creates no note; ✕ removes it.
  - **Hide all / Show all.**
  - **A → Z:** restores the file byte for byte.
  - **Hide group** from a heading.
  - **Collapse:** kept across view switches and leaving the base; Alt+Shift+↑/↓; no writes.
  - **P9:** 10,000 rows, table and cards.
  - **P8:** 1,000 groups, open and drag.
- **Full checks:**
  - `npm run build`: passed.
  - `npm run audit:offline`: passed (176 files).
  - `cargo build`: passed. `cargo test`: 58 passed, 2 ignored.
  - `flock /tmp/grove-npm-test.lock npm test`: **exit 0**. vitest: 68 files, 1,116 tests passed. Every browser, geometry and real-mouse script and `posttest` passed (2,049 PASS lines), including the new test. In that run, P9 was 2.8 ms (table) and 3.4 ms (cards), every paint on the next frame. P8: frame 1, drag p95 16.8 ms. No timing flake, so nothing was rerun.

## To reconcile with K1 at merge

- **K1 changes `parseGroupBy`** (unknown direction and extra keys become a notice). K3 doesn't touch `parseGroupBy` or `model.ts`. Manual is read by `parseManual` from `model.view.groupBy`, so the two should merge cleanly in `groups.ts`: K3's additions are new functions and the grouped view, away from lines 19–23.
- **If K1 renames `order` or `hidden`** (after checking Obsidian's keys), change the two strings in `parseManual` (`groups.ts`) and `withManual` (`groupMenu.ts`). The vitest round trip and the browser test pin the written bytes, so both will flag it.
- **If K1 makes an unknown `direction` (such as an Obsidian `manual` value) a notice,** Grove still treats a view as Manual only when `order` is a list. Decide at merge whether `direction: manual` without `order` should open Manual with automatic order.

## Open questions for Chris

1. **The order is written as a full snapshot** (every group) on any Manual change. The alternative is listing only the groups moved, which gives shorter YAML, but a new value would then land between listed ones unpredictably. I kept the snapshot.
2. **Stale `hidden` entries,** for values no note has any more, are dropped on the next write. Stale `order` entries stay as empty added groups with ✕. Is that the split you want?
3. **Escape during a group drag** closes the whole menu, because the shared menu handles Escape before the drag does. Nothing is written. Fine, or should Escape only cancel the drag?
4. **Collapse state** ends when the tab closes. The plan's "closing and reopening the base during a session" works when the same tab leaves the base and comes back, not across closed tabs. Keeping it per window instead is a few lines.
5. **Two ```` ```base ```` blocks in one note** with the same view name and group property share collapse state. Rare; tell me if it matters.
6. **Groups emptied by a filter or Search** aren't listed in the menu unless they are added groups, since the menu lists the groups of the rows shown. They come back when rows match again.
