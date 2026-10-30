# Bases B6: the Search box, "Edit property…" and "Property type ›"

Built by Claude on `rebuild/bases-b6-claude`, from `rebuild/integration` `98f932f`. Nothing was pushed. Commits:
- `3db2a7a`: the feature;
- `c0ef4c7`: the browser test;
- `c2bc1f8`: the benchmark;
- this notes file.

## In short

- **The toolbar Search box.** A search icon sits between Properties and New; clicking it opens a text box. Typing narrows the rows shown to those containing every word of the query, ignoring case, in any value the row shows. It works in tables, grouped tables, cards and embedded bases. It never writes the `.base` file or any note.
- **"Edit property…"** in the column header menu opens a small "Display name" box. Enter (or leaving the box) writes `properties.<id>.displayName` in the base's YAML; an empty name removes it again, giving back the original bytes. Escape keeps the name.
- **"Property type ›"** is the same submenu the Properties block and the All properties view use (`typeItems`). It sets the vault's type for that name in `.grove/types.json` and never touches the `.base` file or a note. File and formula columns show it disabled.
- **Performance:**
  - no long tasks at 5,000 or 50,000 rows while typing, and every frame at 16.8 ms;
  - tables and cards paint each result on the next frame for most keys, even at 50,000 rows;
  - grouped views take 2 frames at 5,000 rows and 2–5 frames at 50,000, because B5 regroups and recomputes the summaries in 5 ms slices;
  - all header menus open on frame 1 or 2, with no animation.
- **All checks pass:** build, `npm test` (with one canvas flake rerun, below), the offline audit, `cargo build` and `cargo test`.

## What changed (+501 / −31)

| File | Lines | What |
|---|---|---|
| `src/bases/search.ts` (new) | +38 | The matching: the query's words, a row's searchable text, and a sliced filter (`searchWork`, yields every 256 rows). |
| `src/bases/view.ts` | +71 / −20 | The row filter: `drawn` (the rows painted, counted, summarised and copied), `refilter()` for a query change, a text cache per row, and building that cache while the box has focus. The base also redraws when `types.json` changes. The `focusout` rebuild is narrowed (see Decisions). |
| `src/bases/menus.ts` | +37 / −6 | The Search control in the toolbar; "Edit property…" and "Property type ›" in the header menu. |
| `src/bases/write.ts` | +18 / −4 | `writeTop`: replace, add or remove a top-level block (`filters`, `properties`). `writeFilters` now uses it for the global filter. |
| `src/styles/bases.css` | +4 | The Search box and the Display name popover. |
| `src/bases/search.test.ts` (new) | +68 | Unit tests (below). |
| `scripts/test-bases-search.mjs` (new) | +189 | The real-mouse, real-keyboard browser test, run in `posttest`. |
| `scripts/bench-bases-search.mjs` (new) | +75 | The benchmark at 5,000 and 50,000 rows. |
| `package.json` | +1 / −1 | `posttest` runs the new browser test. |

Files outside §8's list for B6: `search.ts` is a new pure module so the matching can be unit-tested. `write.ts` gained `writeTop`, because the display name lives in the top-level `properties` block and no writer existed for it. No other task owns `write.ts` in this wave (B7 is Rust).

## Decisions

### What the Search box matches

- **What counts:**
  - every word of the query must appear somewhere in the row (AND), ignoring case;
  - words are split on spaces, so a word can't span two values;
  - there is no phrase or operator syntax: this is plain text, not the search engine (BASES_PLAN §5).
- **What is searched is what the row shows:**
  - the view's columns, as text (lists joined with ", ", dates and numbers as text);
  - in cards, also the card's title (the note name), which every card shows.
  - Checkboxes, empty cells and formula errors have no text. A column that is hidden is not searched.
- **Search applies after the limit:** it narrows the rows the view already shows, as the plan says ("filters the visible rows").

### How the counts and the rest behave while searching

- **The result count** shows the rows matching the search ("2 results").
- **"Show all (N)"** in the results menu still offers the base's total before the limit, which is unaffected by the search.
- **Group headings and summaries** (per group and overall) count and summarise only the matching rows: what you see is what is summed.
- **Copy and Export CSV** take the matching rows, in their drawn order.
- **Column widths** are still worked out from all the selected rows, so columns don't jump while you type.

### The search box's behaviour

- **The query is not saved.** It stays while you switch views in the same tab or embed, and is gone when the base closes.
- **A new query scrolls back to the top**, so the first results are in view.
- **The toggle** shows the accent colour while a query is active.
- **Escape** clears the query, closes the box and puts focus on the icon.
- **Leaving an empty box** closes it.

### Edit property and Property type

- **"Edit property…" sets the display name.** I read it as the column's display name, the `properties: <id>: displayName:` key Bases files already carry, which `model.label()` reads. It doesn't rename the property in every note. That is what the All properties view's Rename does (`rewriteEverywhere`), and doing it from a base's header felt too far-reaching for one click. **Chris should confirm this matches his Obsidian** (see Open questions).
- **How it writes:**
  - the entry is written under the id the file already uses (`note.status`, `status`), or `note.<name>` if there is none;
  - other keys in that property's entry are kept;
  - a new `properties` block goes just before `views:`;
  - the only bytes that change are those inside the `properties` block.
- **"Property type ›" reuses `typeItems`** from `editor/propertyFields.ts`: Automatic (with the inferred type), then the choosable types, with tags/aliases/cssclasses fixed. The inferred type comes from the notes' values, gathered in the same pass that already builds `types`, so the submenu is built at once, with no await.
- **A type change redraws the base:** `createBase` now listens for `types.json` changes (`settings.on`) and schedules a rebuild. That also covers changes made in the Properties view or a note's Properties block.

### Focus no longer rebuilds the base (a small fix in existing code)

- **The problem:** the view rebuilt the whole base 20 ms after *any* focus left something inside it. At 50,000 rows that is a ~70–100 ms synchronous task (the select; B7's subject). The benchmark caught it as a 72 ms long task when clicking the Search icon, before the first key.
- **The same cost hit other toolbar buttons:** clicking Sort or Filter rebuilt the base too.
- **The fix:** the rebuild exists to catch up on updates held back while a cell's field had focus (`editing()`). It now runs only when focus leaves such a field.
- **Checked by:** every Bases browser script (cell edits, columns, menus, results, config, cards, embeds, B0) still passes.

### Keeping each keystroke cheap

1. **Build the row texts while the box has focus.** Each row's lower-cased text is cached per evaluation, and built in 5 ms slices as soon as the box gains focus, so the first key finds it ready.
2. **A longer query narrows the current result.** When the new query extends the previous one, it filters the rows already shown instead of every row.
3. **The same rows draw nothing.** Most keys of a short query ("t", "ta", "tas"…) leave the result unchanged; then nothing is regrouped or repainted.

Filtering always runs through `runSliced` (5 ms slices), and stale runs are cancelled by a generation counter. A full rebuild from a vault change filters with the current query; a query change during a rebuild is applied when the rebuild ends.

### A BOM fix that came along

- **Before:** `writeFilters` didn't recognise a top-level `filters:` on a first line that starts with a BOM, so it added a second block.
- **Now:** `writeTop` matches the line and keeps the BOM, following the decided rule that a BOM before the YAML is skipped. A unit test covers it.

## Performance

All runs were headless, under the shared lock.

### Existing benchmarks, before (integration `98f932f`) and after (this branch)

| Measure | Before | After |
|---|---|---|
| Warm 1,000-note open (`test-bases.mjs`) | 9.5 ms | 9.4 ms |
| 1,000-row scroll, worst frame | 16.8 ms | 16.8 ms |
| 5,000-row B0 cold open | 44.4 ms | 42.2 ms |
| 5,000-row B0 warm opens | 18.3 / 11.7 / 13.3 ms | 19.2 / 11.9 / 23.7 ms |
| B0 typing: worst frame; rebuilds during / after | 16.8 ms; 0 / 1 | 16.8 ms; 0 / 1 |
| 1,000 grouped cards scroll, worst frame | 16.7 ms | 16.8 ms |
| 1,000-card grid scroll, worst frame | 17.4 ms | 17.3 ms |
| Embed cold / warm opens | 23.2 ms / 6.7–7.2 ms | 22.4 ms / 6.3–6.6 ms |
| Embed paging scroll, worst frame | 16.8 ms | 16.7 ms |
| `bench-bases-groups` select, 5k (tag / formula) | 8.0 / 8.9 ms | 8.0 / 8.6 ms |
| `bench-bases-groups` select, 50k (tag / formula) | 95.6 / 165.6 ms | 94.6 / 163.6 ms |
| `bench-bases-groups` first aggregation, 50k | 210 ms wall, 5.06 ms max slice | 218 ms wall, 5.31 ms max slice |
| `bench-bases-groups` browser 50k (folders / distinct): max frame | 16.8 / 16.8 ms | 16.8 / 16.8 ms |
| `bench-frontend` 5,000: tags / search median | 11.3 / 13.0 ms | 10.8 / 12.1 ms |

- **The 23.7 ms B0 warm sample is noise.** I ran `test-bases-b0.mjs` four times on each side, interleaved, swapping `src` between integration and this branch.
  - Warm opens: integration 11.5–24.3 ms, this branch 11.9–22.7 ms; both show one such outlier in their third sample.
  - Cold opens: 40.4–42.3 ms against 40.9–45.8 ms.
- **The search code costs nothing without a query:** it runs only once a query is set.
- **I see no regression.**

### The new Search benchmark (`node scripts/bench-bases-search.mjs 5000,50000`)

**How it works:**
- It types "task 12" with real key events, one key every 100 ms, then deletes it with Backspace.
- Note titles are "Task N word", so the result goes from every row to 199 rows (5k) or 2,475 rows (50k), and back.
- Only keys that change the result draw (4 of 14). The other 10 do nothing.
- **Work:** from key down to the rows' DOM changing.
- **Frames:** how many frames start before the one that paints the result (1 = the next frame).
- **Key to paint (upper bound):** from key down to a task after that frame.

| Rows / view | Work, median (max) | Frames to paint | Key to paint, median (max) | Long tasks | Worst frame |
|---|---|---|---|---|---|
| 5,000 table | 6.1 (11.4) ms | 1, 1, 1, 1 | 24.2 (32.5) ms | none | 16.8 ms |
| 5,000 grouped + summaries | 8.7 (10.3) ms | 2, 1, 2, 2 | 25.2 (26.2) ms | none | 16.8 ms |
| 5,000 cards | 1.6 (3.0) ms | 1, 1, 1, 1 | 17.1 (19.4) ms | none | 16.8 ms |
| 50,000 table | 11.8 (17.4) ms | 2, 1, 2, 1 | 26.5 (31.6) ms | none | 16.8 ms |
| 50,000 grouped + summaries | 53.3 (55.4) ms | 4, 2, 5, 4 | 69.1 (71.3) ms | none | 16.8 ms |
| 50,000 cards | 6.2 (18.2) ms | 2, 1, 1, 1 | 21.8 (34.9) ms | none | 16.8 ms |

The upper bound includes waiting for the frame to come round, up to 16.7 ms.

**Before my three fixes**, on the same benchmark:
- 5,000 table: the first key took 3 frames (building the text);
- 50,000: long tasks of 55–72 ms (the `focusout` rebuild) and frames up to 67 ms;
- every key of a grouped view regrouped all 5,000 rows.

**Against the targets:**
- **No task over 50 ms, even at 50,000 rows: met.** No long task was recorded in any run.
- **60 fps while typing, scrolling and filtering: met.** Every frame was 16.8 ms. The typed character itself always shows on the next frame, because no task blocks it.
- **Keystroke to paint under 16 ms: met for tables and cards** at both sizes, for almost every key. Their work fits in one frame and the result paints on the next.
  - The exception is a key that widens or narrows 50,000 rows by tens of thousands, which takes 2 frames.
  - **Grouped views fall short:** 2 frames at 5,000 rows, and 2–5 frames (about 70 ms) at 50,000.
  - The cause is that a changed result is regrouped and re-summarised by B5's sliced code. That code also yields one frame first for anything over 200 rows.
- **Header menus and the Property type submenu: met.** They opened on frame 1 (the Display name popover once on frame 2), with a worst frame of 16.8 ms and no animations.

## Tests

- **Unit** (`search.test.ts`, 6 cases):
  - splitting the query;
  - a row's text, including lists, dates, checkboxes, empties, errors and a throwing cell;
  - every-word matching across values, with no word spanning two values;
  - order kept, hidden columns not searched, the empty query returning the same array;
  - yields while filtering;
  - `writeTop` byte-exact: add before `views:`, replace, remove, no-op removal, `views: []`, no views, CRLF and BOM, and the BOM `filters` fix.
- **Browser** (`test-bases-search.mjs`, real mouse and keys, in `posttest`):
  - **Search in a table:** opening the box (focused); typing, every word, Backspace widening, words across columns; Escape clearing and closing.
  - **Groups and cards:** the query kept across view changes; grouped headings and the Count summary of the matching rows; cards by title and by property.
  - **An embedded ```` ```base ```` block:** search, and its note unchanged.
  - **No writes while searching:** no `writeNote` and no settings write.
  - **"Edit property…":** the header menu and the popover open on frame 1 or 2 with no animation; the display name is written byte-exactly and the header renamed; Escape keeps the name; an empty name gives back the original bytes.
  - **"Property type":** the submenu opens on frame 1 with Automatic (Number) checked; Text writes `types.json` only and the header icon changes; Automatic removes it; file columns show it disabled.
  - **Keystroke timing:** 46 keystrokes timed, max 16.9–17.9 ms through the test driver.
- **Full checks:**
  - `npm run build`: passed.
  - `flock /tmp/grove-npm-test.lock npm test`:
    - 67 files / 1,110 unit tests passed;
    - **one flake:** `test-canvas-groups.mjs` (in `test-canvas-polish.mjs`) ended with an unsettled await (exit 13). That is a canvas test this branch doesn't touch. It passed when rerun alone under the lock.
    - Because `npm test` stops at the first failure, I then ran the rest of the chain and posttest under the lock: all passed (442 PASS lines), including every Bases script and `test-bases-search.mjs`.
  - `npm run audit:offline`: passed over 175 source files.
  - `cargo build`: passed. `cargo test`: 58 passed, 2 ignored.

## Open questions for Chris

1. **Does "Edit property…" mean the display name in your Obsidian?** I built it as the column's display name in the `.base`. If your Obsidian's item instead renames the property in every note, the All properties view's `rewriteEverywhere` could be called from here. For a formula column it might also edit the formula; I didn't add that.
2. **Should summaries and Copy/CSV ignore the search?** I made them follow it ("what you see"). If your Obsidian's summaries ignore the search, this is a one-line change in `view.ts`.
3. **Grouped views at 50,000 rows take about 70 ms (4–5 frames) to show a changed result.** Frames hold and nothing blocks, but the result lags typing a little. Making it next-frame would mean filtering B5's existing groups instead of regrouping. I left B5's code alone; it could be a follow-up (it touches `groups.ts`).
4. **The ~100 ms synchronous select at 50,000 rows is still there** on a full rebuild, such as a note saved while a 50,000-row base is open. That is B7's subject; search doesn't add to it.

## Sources

- **Obsidian's behaviour**, from memory of its public help pages "Bases syntax" (`properties` / `displayName`) and "Views" (the toolbar's search, filtering the results). No page was fetched; there was no network.
- The header menu's item names and icons were already in Grove, matched against Obsidian 1.14.4 by observation in rounds 31–33.
- No Obsidian code or assets were used.
- Test vaults were the in-memory browser mock. The 50,000-note vault `bench-bases-groups` reads is `/tmp/grove-bases-b5-claude-review/vault`, from my B5 review.
- No real vaults, other worktrees or Herdr panes were touched.
