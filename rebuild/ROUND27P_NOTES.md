# Round 27p

The 27o leftovers, measured against Obsidian 1.14.4 at 1280×800, then the tag-pane sort 27o left listed. No canvas files and no Bases files. Nothing was pushed.

## What changed

A focused search field, whether the click or the search command put the caret there, uses the grey ring: box-shadow `0 0 0 2px rgb(189, 189, 189)` and border `rgb(189, 189, 189)`. The unfocused field keeps the resting input shadow. The border and shadow still fade in with the shared input transition.

Search settings opens three labeled switches: Collapse results, Show more context, and Explain search terms. Collapse results keeps every found file folded. The count row stays on the pane. Its left side is a round "..." button (More options) whose menu item is Copy search results, and its right side is the sort dropdown. Copy writes each note name, then the shown match lines indented with a tab, and a blank line between notes.

The first ArrowDown from the search field focuses the file row (`tree-item search-result` with `has-focus`). The second selects the first match. A selected match has a 4px radius, the existing 2px inset focus border, and an up/down chevron. Clear search is a filled circle: the button is 28×30 at x=270, and the glyph is a 16px disc in `--text-muted`.

Backlink matches for one file sit in a white card: background `rgb(255, 255, 255)`, radius 4px, shadow `0 0 0 1px rgb(228, 228, 228)`, margin-bottom 8px. In the dark theme the hairline uses `--background-modifier-border`. With one linked file and one match line, the file row is 24.9px at y=115, inset 12px and 276px wide, the first match starts at y=144, and Unlinked mentions starts at y=199.6. Mention rows stay 13px in and 274px wide.

Show more context, in backlinks and in search, stays inside the hit's paragraph. A blank line or a heading ends the block, and a heading is its own block. The per-row icon is `chevrons-up-down`. The backlink toolbar is list, move-vertical, arrow-down-narrow-wide, and search. The outline toolbar is search, square, and chevrons-down-up.

Outline auto-scroll starts off, with no active background, and the highlighted heading uses `--background-modifier-hover`. Outline rows are inset 12px and 276px wide. Text stays at pane +36/+53/+70/+53, and the first row starts at y=84.

The tag pane sorts each level by name A to Z, name Z to A, frequency high to low, or frequency low to high. Name is the tie-break for a frequency sort. The default is name A to Z, and Change sort order is marked active for any other order.

## How it was checked

The sizes follow this round's brief, taken side by side with Obsidian 1.14.4 at 1280×800. This round did not launch Obsidian again.

From `rebuild/app`, headless Chromium and Vite, real pointer input, scratch vault only, viewport 1280×800. No window was opened on the real screen.

`scripts/test-r27p.mjs` checks two unmoved clicks in Live Preview, Source, and Reading; backlink header and file rows inset 12px and 276px wide; a 24.9px file row at y=115; the first match at y=144; the white match card; the four backlink glyphs; Unlinked mentions at y=199.6; paragraph context that keeps the hit's line and stops at the blank line; the up/down mention chevron; outline auto-scroll starting off; outline rows inset 12px and 276px wide with text at pane +36 and the first row at y=84; the three outline glyphs; the neutral active-row grey; the search ring from a click and from the command; the 28×30 filled clear button at x=270; the Copy search results menu item; search context that stops at the blank line; ArrowDown onto the file row and then the rounded match with its chevron; and tag order name A to Z, then frequency high to low.

`scripts/test-r27o.mjs` now expects the grey focus ring, the three settings switches with sort and More options on the count row, ArrowDown onto the file row before the match, and auto-scroll starting off. `scripts/test-r27n.mjs` expects the same file-then-match search order, and turns auto-scroll on before the follow checks.

- `npm run build`
- `npm test`: browser discovery, vitest (48 files, 281 tests), geometry in Live Preview, Source, and Reading, and the browser scripts through `scripts/test-r27p.mjs`. All passed.
- `npm run audit:offline`: passed, 151 source files.

The screenshot and canvas fixtures `npm test` rewrites are restored and are not part of this change. Rust was not changed, so cargo was not run.

## Left out

Alias suggestions in the `[[` suggester stay out. `linkCandidates()` is synchronous and does not read frontmatter, and the property index is async, so offering a note's aliases and inserting `[[note|alias]]` is a later change.

Bookmarks stay a flat list. Rename, drag order, and groups are a sidebar of their own, so they stay later.

Also left as they were: the Bookmark dialog, Open version history, Open in default app, Show in system explorer, New base on the empty tab, a separate hotkey-conflict pill treatment, and the status-bar sync item. The Hotkeys page already has a search filter, a Conflicts filter, and a red chip whose tooltip names the other command.

The file menu already has New note, New folder, Make a copy, Rename, Delete, Bookmark, Copy path, and Reveal file in navigation. Editor commands already cover Ctrl+B, Ctrl+I, Ctrl+K, toggle checklist, indent and outdent, move line up and down, toggle comment, and Ctrl+F / Ctrl+H. Round 27l observed that Obsidian's command list has no Duplicate line command, so none was added. Find and replace already shows the match count, previous and next, and replace all. Properties already add a row, change type, edit list and tag values, and delete a property.

Settings pages stay in their current order (General, Appearance, Interface, Editor, Files and links, Hotkeys, Core plugins). Moving Interface into Appearance, or reordering the Options list to match a fresh Obsidian pass, is larger than a small fix and was not remeasured this round.

Arrow keys, Shift-arrows, and Delete in the file tree stay out. Mouse selection is in place, and Escape clears it. That keyboard half is the same small-to-medium piece round 27b listed.

No production file exceeds 800 lines. No new dependencies.

## Line counts

Net lines in this round, production code only. The notes file is not included.

- TS: **+116**.
- CSS: **+80**.
- RS: **0**.

The new browser script is 217 lines. `package.json` adds `scripts/test-r27p.mjs` at the end of `test`. `scripts/test-r27n.mjs` and `scripts/test-r27o.mjs` expect the file-then-match order, the grey search ring, and auto-scroll starting off.
