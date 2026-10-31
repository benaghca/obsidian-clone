# KANBAN-K8 — list layout

Branch `rebuild/kanban-k8-grok`, from `rebuild/integration` at `ba9e4ac`. Implementation is `689a776`. Nothing was pushed. `rebuild/canvas-cz4-grok` was not changed. No Obsidian code, CSS, or assets were used.

## What the public pages say

Read on 2026-10-30:

- https://obsidian.md/help/bases/views — List is one of the layouts. In the Table, Cards, and List layouts, selecting a group heading collapses or expands that group.
- https://obsidian.md/help/bases/views/list — Markers are bullets, numbers, or none. With indent off, properties share the line and the separator defaults to a comma. (A direct fetch of this page came back empty; the text is from the public page as recovered by search.)
- https://docs.obsidian.md/plugins/guides/bases-view — a list entry is one line. `file.name` is a link. Empty values are skipped. Each other value follows a separator, with no property label.

Those pages do not name the YAML keys. The keys below are Grove's.

## What changed

`689a776`, 11 files, +690 / −25.

| File | +/− | Why |
|---|---|---|
| `src/bases/list.ts` | +228 | `listLayout` and `createList`. Fixed 28px rows and 32px headings, overscan of 8 rows. |
| `styles/bases-list.css` | +51 | Those heights, no transition, no vertical margin. |
| `src/bases/model.ts` | +22 / −3 | `type: list`, markers, separator, indent notice, `viewGlyph`. |
| `src/bases/view.ts` | +25 / −12 | Dispatch only. The list uses the existing scroller and K3's collapse set. |
| `src/bases/config.ts` | +7 / −4 | Layout option List, and a Markers select while the layout is list. |
| `src/bases/menus.ts` | +3 / −3 | The view menu and the toolbar use `viewGlyph`, so a list view is selectable (`list` is already in the icon set). |
| `src/bases/write.ts` | +2 / −2 | `markers` is a scalar `writeView` can replace. |
| `src/bases/model.test.ts` | +13 | List is its own type. Unknown markers and indent notice. A table ignores both. |
| `src/bases/list.test.ts` | +97 | Window math, and a markers round-trip through `writeView`. |
| `scripts/test-bases-list.mjs` | +241 | Bullets, numbers, inline values, collapse, open, 1,000 and 10,000. |
| `package.json` | +1 / −1 | The list script runs in `posttest`, before the property-edit fuzz. |

`groups.ts` is unchanged. The list reuses `groupRowsAsync`, `arrangeGroups`, and `parseManual`, and it draws the same `.bases-b5-toggle` heading K3 uses.

## Decisions

**The line.** The note name is always a link, then the other properties in `order`, on one line. `file.name` in `order` is not drawn a second time. Null, `""`, and an empty list are skipped. `0` and `false` are shown. A formula error is `#ERROR!`. There is no property label in the line. The label is the value's `title`. The public indent mode would make the first property the primary item and give the row a variable height. That is not built. A list view with `indentProperties` or `nestedProperties` set to true or `"true"` shows "Indent properties isn't supported yet" and stays one line.

**Markers.** Absent, or `bullets` / `bullet` / `unordered`, draws `•`. `numbers` / `number` / `numbered` / `ordered` draws `1.` starting at 1 inside each group. An ungrouped number is that row's place in the whole result, so a scrolled row can read `5001.` The same aliases are accepted on `marker` and `listMarkers`. Anything else notices `Unsupported list markers: …` and draws bullets. Configure view writes the key `markers` as `bullets`, `numbers`, or `none`. `none` draws no marker. A non-list view ignores `markers` and the indent flag, and does not notice them.

**Separator.** On a list view, a string `separator` (or `propertySeparator`) is used as written, including `""`. When the key is absent the separator is `", "` (a comma, then a space). The help page says the default character is a comma. The space is Grove's, so the line reads as the inline list that page describes. There is no control for it in Configure view.

**Where it is drawn.** The list element sits in `.bases-scroll`, hidden unless `type` is `list`. The table is hidden for that view. `createGroupedView.clear()` sets the table visible again, so the list branch sets `table.hidden = true` immediately after that clear. Dropping that second assignment puts the table back under the list. Kanban still hides the scroller. Search text for a list includes the note name, as it does for cards and the board.

**Collapse.** The heading's set is K3's, keyed by the tab, the base path, the view name, and the group-by property. Click, Enter, and Space toggle it. `aria-expanded` and the chevron follow. The count stays. Alt+Shift+Up collapses every heading and Alt+Shift+Down expands them. Hide group on a heading is the existing menu. Collapsing writes nothing. Numbering starts again in each group. A new tab does not inherit the set, because the set is on the tab object.

**Scroll.** `listLayout` is pure. A scroll frame reads `scrollTop` and `clientHeight` once, then only writes. A height of 0 (the scroller has not been laid out) uses 600 so the first paint is not empty. Rows and headings are `overflow-anchor: none`. There is no open animation. The root is `contain: strict`. In headless Chromium a row's `offsetHeight` is 28 and a heading's is 32, which is what the math assumes.

`view.ts` does not grow a fast path. That stays with K6.

## Performance

Headless Chromium, inside the locked `npm test` (the list script runs in `posttest`). Budgets from the plan's measurement style: a warm 1,000-note open under 100 ms and a scroll frame under 20 ms; a warm 10,000-note open at median ≤150 ms with no long task over 50 ms; scroll p95 ≤20 ms and max ≤25 ms.

| Check | This run |
|---|---|
| List, 1,000, warm open | 9.2 ms, 36 rows in the DOM |
| List, 1,000, scroll | max 16.8 ms, p95 16.8 ms, 45 rows, no long task |
| List, 10,000, cold open | 34.4 ms, no long task, 36 rows |
| List, 10,000, warm open | 18.4, 14.4, 15.8 ms (median 15.8), no long task |
| List, 10,000, scroll | p95 16.8 ms, max 16.8 ms, 45 rows, `scrollTop` 279218, no long task |
| Existing table, 1,000 | warm open 8.4 ms, scroll max 16.8 ms |
| Kanban P1, 10,000 | warm 16.4, 18, 18.5 ms (median 18), cold 70.6 ms, long task 69 |
| Kanban P2 | p95 16.8 ms, max 16.8 ms, 15 cards |
| Kanban P4 | p95 16.8 ms, handler max 0.5 ms |

A run of `scripts/test-bases-list.mjs` on its own, before the suite, sat in the same band: 1,000 open 10.4 ms, 10,000 warm median 14.1 ms, cold 35.2 ms, frames 16.8 ms.

The existing 1,000-row table scroll and the Kanban move checks were not weakened. Both passed in this same `npm test`.

## Checks

- `npm run build` (`tsc --noEmit` and Vite). The existing chunk-size warning is still there.
- `flock /tmp/grove-npm-test.lock npm test` passed on the first run. Vitest: 73 files, 1243 tests, including 444 parity cases. Posttest includes `test-bases-list.mjs`.
- After that run, the only edit was deleting three documentation URLs from the comment at the top of `list.ts`. `npm run audit:offline` rejects a URL in shipped source. The pages are cited in this note instead. The audit then passed: 185 source files, and it typechecks and rebuilds. The browser suite was not run again for that comment.
- `cargo build --offline` and `cargo test --offline` from `rebuild/app/src-tauri`: 73 passed, 4 ignored. No Rust change.

## Left open

- Indent / nested properties. The notice is the whole behavior. A variable row height would drop the fixed window.
- The YAML names `markers`, `separator`, and `propertySeparator` are unverified against a file Obsidian saved. `marker` and `listMarkers` are read as aliases. Configure view writes `markers` only.
- Configure view still shows Row height for a list. The list does not use `rowHeight`.
- There is no separator field in Configure view. A separator already in the file is kept.
