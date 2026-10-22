# Round 15: finish blocks and search (Claude's notes)

Branch `rebuild/r15-claude`, from `34e7be1`. All seven items are built, each against Obsidian 1.14.4 as observed side by side. What differs from Obsidian, and why, is listed per item and under "Skipped and caveats".

## Summary

- **Checks:** all pass.
  - In `rebuild/app`: `npm run build`, `npm test` (166 tests in 31 files, up from 158) and `npm run audit:offline`.
  - In `src-tauri`: `cargo build` and `cargo test` (32, unchanged in number; one check extended).
- **Built:**
  1. **Table caret:** after Tab (or Enter) adds a row, the caret lands just inside the new empty cell (round 14 bug 2). Every table edit writes the same Markdown as before.
  2. **Tasks in callouts** can be ticked in the note itself (Live Preview and Reading view) and inside an embedded note, as in Obsidian. Obsidian draws no task boxes in table cells, and neither does Grove, so there is nothing to tick there.
  3. **Images:** Obsidian's image menu (17 items in six groups, two left out for the lockdown); in Reading view no hover buttons, and a click opens the lightbox.
  4. **Code blocks:** Obsidian's indent guides (Live Preview and Source mode) and its lighter code background (both themes, inline code too).
  5. **Search:** a Match case toggle, the sort order (Obsidian's six), per-note match counts and "N results" counting matches, at Obsidian's layout and density.
  6. **Properties:** the File properties view (status bar count and command), and Rename / Delete property in All properties, rewriting every note that has it.
  7. **"Link with tab..."**: Obsidian 1.14.4 has it, so Grove has it: the pick mode, the link icon, "Unlink tab", and linked tabs following each other.
- **Two bugs found and fixed:**
  - Dragging the resize corner of an image inside a callout wrote the width into the callout's first line.
  - A right-sidebar view wider than the dock was pushed off to the left (the Outline view with a long frontmatter line already was).
- **Size:** +767 lines in total (TS app +476, tests +118, CSS +137, Rust +36), under the ~1,200 budget. The largest file in `src/` is `workspace.ts` at 646.
- **Speed:** typing (Big note, code block, table), note switching, search typing and the graph are unchanged; numbers under "Performance". Search typing got slower as first built and was won back; see item 5.
- **Dependencies:** none. Three Lucide icons added from the bundled package: `arrow-left-right`, `image-minus`, `case-sensitive`.
- **Contract:** `FileEntry` gains `ctime_ms` (item 5's "Created time" orders). No new command, permission, capability, CSP or `tauri.conf.json` change.
- **Screenshots:** Grove beside Obsidian for items 3–7 are in `rebuild/round15-screens/` (light and dark where the item has colour).

| Commit | What |
|---|---|
| `8a9f8da` | Item 1: table caret |
| `b65de7e` | Item 2: callout tasks |
| `6b9fab2` | Item 3: image menu, Reading view zoom, images in blocks (bug fix) |
| `6f36b16` | Item 4: indent guides, code background |
| `f22a6d8` | Item 5 (backend): `ctime_ms`, the six sort orders shared with the file explorer |
| `fa009d6` | Item 5: Match case, sort, counts, layout |
| `510d055`, `65697fd` | Item 6: File properties, Rename / Delete property (and the sidebar width fix) |
| `0447234`, `d5419f9` | Item 7: Link with tab |
| (last) | These notes and the screenshots |

## How Obsidian was observed

- **Obsidian 1.14.4** (the installed package), as Electron in headless mode (`--ozone-platform=headless`) inside `unshare -rn` (its own user and network namespace, loopback only).
- A scratch `HOME`/`XDG_*` and a fresh copy of a throwaway vault for every run, all in the session scratchpad. The vault held a table, a note with tasks in a callout and in a table (`Inner`) embedded in another (`Host`), images at several sizes, JavaScript and Python code with indents plus a tab-indented plain block, notes with properties, and notes with "alpha" in several cases for search.
- A CDP script drove the mouse and keys and read the DOM, computed styles, the clipboard and the files Obsidian wrote. No Obsidian source, CSS or asset was opened; `~/.config/obsidian` and the owner's vaults were never touched.
- **Grove** ran in headless Chromium against the Vite dev server with its mock vault plus the same notes, and the round's start (`git archive 34e7be1`) on its own server for before/after. No Tauri window was opened this round.

## Item by item

### 1. Table caret after Tab

**Observed:** Tab in the last cell adds a padded row with the caret in its first cell; typing `new` gives `| new         |       |        |`. Obsidian edits cells in place and re-pads the table as you type.

**Grove now:** the caret goes just inside an empty cell's left edge (`| ` + caret), for Tab, Shift+Tab, Enter and the menu's row and column items. Typing gives `| new             |       |        |`: the text is inside the padded cell, and the next table edit pads the row again. Before, it gave `|             new|`.

- **Same Markdown:** every table edit still writes exactly what it wrote; only where the caret lands changed. The round-14 screenshot harness's table-keys output differs only on that row (`| new<br>   |` instead of `|   new<br>|`).
- **Not copied:** re-padding the row as each key is typed. That is Obsidian's in-place cell editor, which Grove doesn't have (round 13 explains why); it would also put a whole-table rewrite on every key.
- **Test:** `tables.test.ts`, Tab in the last cell, then typing.

### 2. Ticking tasks everywhere

**Observed:**
- A task in a callout can be ticked in Live Preview and in Reading view, and writes the note.
- A task in a callout inside an embedded note can be ticked in both views, and writes the embedded note; the host note is untouched.
- **A table cell never shows a task box:** `- [ ] table task` and `[ ] bare box` in a cell are text, in the note and in an embed.

**Grove before:** every box inside a callout was disabled, in the note and in embeds.

**Grove now:**
- A callout's body is painted with a tick handler that maps its line back through the text the callout is drawn in: the note on screen, an embedded note (to the existing `toggleTask`), or an outer callout (a callout inside a callout).
- The task rule (`toggledTask`) and the Live Preview checkbox's tick (`tickLine`) moved to `render.ts`, which the drawn widgets share, so there is still one rule for which box a tick flips.
- Tables: nothing to do; Grove draws no boxes in cells either.
- **Checked** in the browser: Live Preview and Reading ticks in `Inner`'s callout, and both views' ticks in `Host`'s embed, each wrote the right line of `Inner` and left `Host` alone. **Test:** a nested callout's line mapping in `blocks.test.ts`.

### 3. Images

**Observed (Live Preview), right-click on an image:**

Copy image · Swap file... · Remove image · Reset size │ Open in new tab · Open to the right · Open in new window │ Rename... · Move file to... · Bookmark... │ Copy path ▸ │ Open in default app · Show in system explorer · Reveal file in navigation │ Delete image (red)

- Reset size is disabled on an image without a size.
- What they write:

  | Before | Reset size | Swap file (to `pics/a.png`) |
  |---|---|---|
  | `![[pic.png\|200]]` | `![[pic.png]]` | `![[a.png\|200]]` |
  | `![[pic.png\|caption\|200]]` | `![[pic.png\|caption]]` | |
  | `![alt\|150](pic.png)` | `![alt](pic.png)` | `![[a.png\|alt\|150]]` |
  | `![150](pic.png)` | `![](pic.png)` | |

- Remove image deletes the embed's text (its line stays, empty); one undo restores it.
- Copy image puts a PNG on the clipboard.
- Swap file opens a "Choose a file..." picker.

**Observed (Reading view):** no hover buttons at all (no Zoom in, no Edit this block, no resize corner). A click on the image opens the lightbox, and so does a right-click; there is no image menu.

**Observed (an image inside a callout):** no buttons, no resize corner; a right-click shows the callout's menu.

**Grove now:**
- **The menu,** built from `menus.ts`' existing items (open, rename, move, bookmark, copy path, reveal, delete), in Obsidian's order and groups.
  - Reset size, Remove image and Swap file write what Obsidian writes (`resetSize`, tested against the table above; Swap uses the link settings, so the default gives Obsidian's wiki embed).
  - Copy image draws the shown image to a canvas and writes a PNG (checked by reading the clipboard back: `image/png`, 160×100).
- **Reading view:** the hover buttons were already hidden; a click or right-click now opens the lightbox.
- **Images inside a callout, table or embed** have no buttons, resize corner or menu of their own. This also fixes a bug: Grove drew the corner there, and dragging it wrote the width into the callout's first line (`> [!note] Pic170![[photo.png|120]]`).
- **Left out:** Open in default app and Show in system explorer. They need the opener's `open_path` / `reveal_item_in_dir`, which the lockdown denies, as in every other Grove menu since round 5.
- **Differences:** "Bookmark" has no ellipsis (Grove bookmarks at once, as in its other menus). Swap file lists the vault's images at once, where Obsidian's picker starts on recent files ("No recent files found. Type to search...").
- Screenshots: `3-image-menu-*`, `3-image-reading-hover-*`.

### 4. Code blocks

**Observed** (Live Preview, Source mode, Reading view; light and dark):
- Code blocks and inline code sit on `#fafafa` (light) and `#232323` (dark); Grove's light background was `#f2f2f2`.
- In Live Preview and Source mode, each tab stop of a code line's indent (a tab, or four spaces) starts with a 1 px line: black at 12% (light), white at 12% (dark). The lines join up from line to line. Two spaces get none; six get one.
- **Reading view has no guides.**

**Grove now:**
- The code background is the theme's `--background-primary-alt` in both themes (one token; the dark value was already right).
- **Guides without new elements:** the code highlighter, which already walks the visible code blocks after each frame, gives each indented code line a style (`--indent: 8ch; --tab: 4ch`). CSS draws the guides as a repeating gradient on that line, so no element is added and the line's text nodes are as before. The tab stop follows the editor's tab size setting. Reading view turns them off.
- **Off the key's path:** an edit maps the line styles with the text at once and works them out again after the frame, as the colours already are. Guides cover every fenced block, not only the coloured languages.
- **Test:** `indentStops` in `codeHighlight.test.ts`. Screenshots: `4-code-live-*`, `4-code-reading-*`.

### 5. Search pane

**Observed** (query `alpha` over four notes):
- **The field:** a search icon, the query, then "Match case" (an Aa toggle, accent when on), then the clear button, inside the field; "Search settings" beside it.
- **Under it, a 24 px row:** "11 results" (with a "⋯" menu: Copy search results, Bookmark...) on the left, and on the right the sort order, a dropdown:
  - File name (A to Z), File name (Z to A);
  - Modified time (new to old), Modified time (old to new);
  - Created time (new to old), Created time (old to new).

  Then a line, and 12 px of padding.
- **"11 results" counts matches, not notes.** Each note's title row (a fold chevron, 13 px, 25 px high) shows its own count: Other 3, Props 4 (one in its frontmatter), Tables 1, Zeta 3.
- **Each note's lines sit in one card:** 12 px text, 8/20/8/12 px padding, a line between rows, long lines wrapped.
- **With Match case:** 8 results; Other 2, Props 2, Tables 1, Zeta 3. "Alpha again" drops out, and only exact-case words are highlighted.
- The sort and Match case are kept with the view.

**Grove now:**
- **The same field, row and cards,** in `searchView.ts` (the chevrons are the backlinks pane's `foldToggle`; the dropdown is the settings' `dropdown`). The counts match Obsidian's exactly on the observed notes, with and without Match case.
- **Match case:** with it on, the query keeps its case and the terms are matched as typed. The backend's search is case-blind, so its lines are kept only where the term appears as typed; highlights and counts follow. Tags and property names stay case-blind, as in Obsidian. The choice and the sort are remembered (local storage).
- **The sort's Created time:** `list_files` had no creation time, which is why round 7 left those two orders out of the file explorer. File entries now carry `ctime_ms`: the file system's birth time, or its modified time where it keeps none. The six orders and their comparison are one list in `paths.ts`, used by the search view and the file explorer. The file explorer's sort menu gains the two Created time orders and Obsidian's separators between the pairs.
- **Counts never hold up a key:**
  - a note's count is worked out when its row is drawn;
  - the "N results" total is worked out just after the results are painted;
  - a screen's worth of results (12) is drawn with the key, and the rest of the first page of 50 just after.

  As first built (all 50 rows with the key, each with its count and chevron) search typing measured 2–3 ms slower; drawing the first screen first won it back (numbers below).
- **Tests:** Match case, counts and highlights as observed (`searchQuery.test.ts`); the six orders (`paths.test.ts`). Screenshots: `5-search`, `5-search-matchcase`.

**Left out:**
- "Search settings": Collapse results, Show more context, Explain search terms.
- The count's "⋯" menu (Copy search results, Bookmark...).
- The "Show more context" buttons on a line.
- In Grove's narrower sidebar the sort label is cut ("File name (A ...").
- Counts, like the lines shown, come from the backend's search, which returns about four lines per note when a term is on many lines of almost every note. Then the counts are a lower bound (round 10 noted the same limit for lines).

### 6. Properties

**Observed:**
- **File properties:** "Properties view: Show file properties", or a click on the status bar's "N properties" (`mod-clickable`), opens "File properties" in the right sidebar.
  - Its tab icon is Lucide `info`, after Outline.
  - It shows the open note's properties, editable, without the block's "Properties" heading, with a line under each row, a 135 px key column at 15 px, 12 px padding and Add property.
  - A note without properties shows only Add property.
- **All properties, right-click on a property:** Rename (pencil) · Property type ▸ (`menu` icon) │ Delete property (red).
  - Rename turns the name into an editable field in place; Enter renames it in every note that has it.
  - Delete property removes it (and a list's lines) from every note.
  - Neither asks first; both keep each note's other lines and the property's place.

**Grove now:**
- **File properties** (`propertiesView.ts`) is the note's own Properties block (`Block` in `properties.ts`, now with an option to leave out its heading), bound to the open note's editor.
  - Editing there is the same code as in the note.
  - It is drawn again only when the note changes or its frontmatter changes (one identity check per keystroke, as All properties does).
  - It is part of the Properties view core plugin, with the command and the clickable status bar count.
- **Rename / Delete property:**
  - Each note that has the property (from the properties index) is loaded into its editor state, the same path as embed task ticks, and changed there. It is saved by the usual `write_note`, so no new backend command was needed.
  - The per-note rewrite (`rewriteProperty` in `frontmatter.ts`) is pure and tested.
  - A note whose frontmatter Grove can't read line by line (round 10's YAML safety), or that already has a property of the new name, is left alone.
  - Rename is in place, as in Obsidian; the file explorer's in-place rename moved to `dom.ts` (`editInPlace`) and both use it.
- **Bug found while building it:** the sidebar's views were as wide as their content, right-aligned (for the slide animation). A view wider than the dock was pushed off to the left. The round's start already showed this in Outline: its first line, "status: active rating: 4 tags: …", started mid-word at "ting: 4 tags: …", the rest cut off to the left. The dock's views are now capped at the dock's width.
- **Differences:** Grove's File properties tab is there whenever the plugin is on (Obsidian adds it when first opened). Obsidian's All properties also lists `aliases` and `cssclasses` at 0; Grove doesn't.
- **Test:** `frontmatter.test.ts` (rename, delete, the cases left alone). Screenshots: `6-file-properties`, `6-property-menu`.

### 7. "Link with tab..."

**Observed:** Obsidian 1.14.4's tab menu has "Link with tab..." (Lucide `link`) right after Pin.
- Choosing it lights each pane in the accent colour as the pointer passes over it. A click links the tab with that pane's tab (and that pane becomes active).
- Both headers then show an accent link icon ("Unlink tab"), and the menu shows "Unlink tab" (same icon).
- From then on, a note opened in either tab, by a link, the file list or Back, opens in both.

**Grove now:**
- The same: the pick mode with the lit pane (Escape or a click outside the panes gives up), the header icon (a click unlinks), "Unlink tab" in the menu, and linked tabs following.
- The model is a link id on tabs (`tabs.ts`, tested). When the tab on screen shows another note, the tabs linked with it open it through the workspace's existing `reopen`, each keeping what it showed on its Back history.
- **Difference:** links aren't saved with the layout; Obsidian keeps them in `workspace.json`.
- Screenshot: `7-tab-menu-linked`.

## Lines

Measured from `rebuild/app` with round 14's commands. Before is `34e7be1`.

| | Before | After | Change |
|---|---:|---:|---:|
| TypeScript, app | 18,087 | 18,563 | +476 |
| TypeScript, tests | 2,047 | 2,165 | +118 |
| CSS | 3,436 | 3,573 | +137 |
| Rust | 3,079 | 3,115 | +36 |
| *of which Rust app code* | *2,179* | *2,215* | *+36* |
| *of which Rust tests* | *900* | *900* | *0* |
| **Total** | **26,649** | **27,416** | **+767** |

Roughly by item (app code and CSS, then tests):

| Item | App + CSS | Tests |
|---|---:|---:|
| 1. Table caret | +2 | +6 |
| 2. Callout tasks | +18 | +10 |
| 3. Images (menu, Reading view zoom, images in blocks) | +95 | +16 |
| 4. Code blocks | +45 | +5 |
| 5. Search, and the sort orders with `ctime_ms` (Rust +36) | +215 | +51 |
| 6. Properties (and the sidebar width cap) | +145 | +15 |
| 7. Link with tab | +120 | +15 |

**Largest files after:**

| File | Lines |
|---|---:|
| `src/workspace.ts` | 646 |
| `src/styles/settings.css` | 629 |
| `src/shell/pane.ts` | 620 |
| `src/graph/view.ts` | 609 |
| `src-tauri/src/index.rs` | 559 |
| `src-tauri/src/vault.rs` | 552 |
| `src/appCommands.ts` | 529 |
| `src/editor/livePreview.ts` | 528 |
| `src/editor/properties.ts` | 523 |
| `src/shell/menus.ts` | 515 |

No file in `src/` is over 650. `workspace.ts` grew by 7 (`setLink`); the link pick mode is a new file, `shell/tabLinks.ts` (55), so the workspace stays under the limit.

**Removed or merged:**
- `embeds.ts`' `toggledTask` moved to `render.ts`, and Live Preview's checkbox uses the same `tickLine` as callouts.
- The file explorer's in-place rename moved to `dom.ts`, now shared with All properties.
- The file explorer's own sort list is the shared one in `paths.ts`.
- The dark theme's `--code-background` line is gone: both themes use `--background-primary-alt`.

## Dependencies, permissions, contract

- **Dependencies:** none, npm or Cargo. Three Lucide icons from the package already in use: `arrow-left-right` (Swap file), `image-minus` (Remove image), `case-sensitive` (Match case).
- **`CONTRACT.md`:** `list_files`' `FileEntry` gains `ctime_ms` (when the file was created; its modified time where the file system doesn't record that; 0 for folders). The Rust index keeps both times and the size as one `Stamp` per file. `cargo test` checks that a scanned note has both times.
- **No change** to commands, permissions, capabilities, CSP or `tauri.conf.json`. Rename / Delete property save through the existing `write_note`.
- `npm run audit:offline` passes.

## Performance

**Setup:** round 14's harness (`perf.mjs`) and test notes. Headless Chromium at 1280×800 against two Vite dev servers: the round's start (`git archive 34e7be1`) and this branch, with `?synthetic=1000` for the Big note, switching, search and the graph. Three full interleaved runs per side, plus four more search-only runs. Mean / p95 in ms as ranges over the runs, unless noted.

| | Before (`34e7be1`) | After |
|---|---|---|
| Typing on Big note (line 2,500), key → painted frame | 10.4–10.8 / 17.6–18.5 | 10.5–10.9 / 18.2–18.6 |
| Typing inside a 300-line code block | 11.1–11.9 / 18.6–19.3 | 10.9–11.9 / 18.4–19.3 |
| Typing in a 40-row table | 10.5–11.0 / 17.9–18.5 | 9.9–10.8 / 17.0–18.3 |
| Note switch, Welcome ↔ Big note (means) | 15.3–16.1 | 16.0–16.1 |
| Note switch, two notes with frontmatter (means) | 15.9–16.0 | 15.9–16.0 |
| Search key → results painted, `alpha gamma` (means, 7 runs) | 10.9–12.2 | 9.7–11.9 |
| Search, `garden 12` (means, 7 runs) | 6.2–8.0 | 6.3–8.6 |
| Search, `e` (one key per run, 7 runs) | 10.6–17.3 | 9.4–21.7 |
| Graph open → first painted frame | 29.0–30.0 | 29.6–31.3 |
| Pan, frame mean / p95 | 16.7 / 16.7–16.8 | 16.7 / 16.7–16.8 |
| Wheel zoom, frame mean | 29.9 | 29.9 |

**Reading the numbers:**
- Typing, switching and the graph are the same within run-to-run noise.
- **Code-block typing:** the guides added no element to the key's path; their styles are worked out with the colours, after the frame.
- **Search:**
  - **As first built,** drawing all 50 results with their counts and chevrons measured `alpha gamma` at 13.5–14.3 and `garden 12` at 9.8–10.7.
  - **Now** a screen's worth is drawn with the key, the rest just after, and the total after paint. That brought both back into the round-start range: `alpha gamma` is a little lower than before, `garden 12` the same.
  - `e` is a single key per run, so its spread is wide on both sides.

**Bundle:**
- `index.js`: 919.10 → 926.45 kB (gzip 317.77 → 320.32).
- `index.css`: 65.44 → 68.27 kB (gzip 12.28 → 12.72).

No WebKitGTK numbers were taken; nothing on the graph or typing paths changed what the webview is asked to do.

## Skipped and caveats

- **Not observed in a Tauri window.** Everything was checked in headless Chromium. Copy image uses `navigator.clipboard.write` with a PNG `ClipboardItem`, which WebKitGTK supports, but it wasn't tried there.
- **Item 1:** a typed cell isn't re-padded per key (no in-place cell editor).
- **Item 3:** Open in default app and Show in system explorer (lockdown). Swap file lists all images rather than recent files.
- **Item 5:** Search settings (Collapse results, Show more context, Explain search terms), the "⋯" menu on the count, the per-line "Show more context" buttons. Counts are a lower bound for terms on many lines of almost every note.
- **Item 6:** All properties doesn't list `aliases` and `cssclasses` at 0.
- **Item 7:** links aren't saved with the layout.
- **Not committed:** the Obsidian sandbox, the CDP scripts, the scratch vaults and the copy of the round's start are in the session scratchpad. The side-by-side screenshots are committed in `rebuild/round15-screens/`.

## Round 15 comparison (added at merge)

Three agents did this brief from `34e7be1`. Claude's branch was merged as is (`326d13f`); nothing was ported from the other two.

| Rank | Model | Net lines | New Tauri command | Image menu (Live Preview) | Reading view image | Table-cell task boxes |
|---|---|---:|---|---|---|---|
| 1 | Claude | +767 (27,416) | none | Obsidian's groups, minus the two system-opener items | no hover buttons, click opens the lightbox | none (as Obsidian) |
| 2 | Codex | +731 (27,380) | `open_image_file` | Obsidian's full menu | as Obsidian | drawn and tickable (Obsidian draws none) |
| 3 | Grok | +783 (27,432) | none | 3 items (Copy image, Reset size, Reveal) | keeps Zoom in (Obsidian has none) | drawn and tickable |

- **Why Claude:** closest to Obsidian as observed on every item (Reading-view images, no task boxes in table cells, no guides in Reading view), no new permission or command, and it found and fixed two real bugs (an image's resize corner inside a callout wrote into the callout's first line; wide right-sidebar views were clipped on the left). Checks after merge all pass.
- **Codex's best idea:** search counts done lazily for the rendered results only, with case sensitivity passed to the backend, which made search typing faster than before, where Claude's is about 3 ms slower (still inside one frame). Not ported: the two search implementations don't combine cleanly. Folded into round 16's cleanup as a performance item. Its vault-wide property rename preflight (collision and ambiguous-YAML checks) is also noted for a later look. Its `open_image_file` command was not wanted: it widens the lockdown.
- **Grok's best idea:** the smallest change set (8 commits) with a repeating-gradient indent guide that needs no extra elements. Not ported: Claude's guides already add no elements, and Grok's branch diverged from Obsidian on Reading-view images and table tasks.
- **Checks after merge (on the owner's machine):** `npm run build`, `npm test` (166/166), `npm run audit:offline`, `cargo build`, `cargo test` (32/32) all pass.
