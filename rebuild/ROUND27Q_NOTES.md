# Round 27q

Side-pane colour and glyph gaps from the 27p merge, file-explorer keyboard, and alias suggestions in the wikilink menu. Measured against Obsidian 1.14.4 at 1280×800 where this round launched it. No canvas files and no Bases files. Nothing was pushed.

## What changed

Backlink section headers (Linked mentions, Unlinked mentions) use `--text-normal`, still 13px and weight 500. The file row and the match card share the pane's 13px inset, so both are 274px wide in a 300px pane. The file row stays about 24.9px at y=115, the first match at y=144, and Unlinked mentions at y=199.4. Change sort order is the ascending glyph `arrow-up-narrow-wide`.

An active toolbar button keeps a neutral icon (`--text-normal`) on `--background-modifier-hover`. That covers the file explorer, outline, backlinks, tags, and the search settings button. The accent tint is no longer used for these.

Outline still highlights the heading at the top of the editor when Auto-scroll is off. Auto-scroll only scrolls the outline list, and it still starts off. At the top of an unscrolled note the highlight is the first heading. The Auto-scroll glyph is Grove's own panel with a bar near the top and a bar near the bottom.

The search count is one control, `.search-results-result-count`, labelled "N results", with a filled-circle more-options glyph on its right. The menu item is still Copy search results. The sort dropdown on that row is borderless and transparent, 24px tall, 166px wide, `--text-muted`, and right-aligned. Its right edge sits at window x=332. Clear search stays 28×30 at x=270, and the search field stays 30px tall.

Search settings were 3px low on the switch rows and about 5px low on the count row relative to the field. The open settings block uses `margin-top: -3px` and bottom padding 6px (was 8px). Measured afterwards, in the same window coordinates as the clear button (x=270) and the dropdown (right edge 332): the first switch row's centre is y=103 (63px below the search view) and the count row's top is y=193 (153px below the view). The brief's 75 and 181 were not chased. That gap is much larger than the 3px and 5px that were diagnosed, and closing it would shrink the 30px field.

With the file explorer focused, ArrowUp and ArrowDown move the focused row. The first arrow lands on a row when nothing is focused yet. Shift+ArrowUp and Shift+ArrowDown extend the selection from the anchor. ArrowRight expands a collapsed folder, and on an expanded folder moves to its first child. ArrowLeft collapses an expanded folder, and otherwise moves to the parent. Enter opens a file and toggles a folder. Delete and Backspace ask, then delete the selection (one file uses the existing confirm; several files use one dialog, "Delete N items", and delete only the top-level paths). Escape cancels. Backspace while renaming does not delete. Backspace was not watched in Obsidian's file explorer this round. With the list focused, and no rename field or dialog open, it uses the same confirm as Delete. When the focused path disappears, the ring moves to the next surviving visible path, or the previous one if nothing follows. The selection stays the paths that remain. That neighbour is not selected. A plain click still focuses the row without starting a multi-selection. Dragging several selected files, and dropping a file into an open note as a wikilink (or an embed for a non-note), were already implemented.

Deleting the last files in a folder left the folder on disk and in the Tauri index, but the in-memory backend dropped it, because a folder left the empty-folder set once it gained a file. The mock now keeps a parent that has just become empty, including after a rename of its last file.

Inside `[[`, a second completion source lists frontmatter aliases and inserts `[[note|alias]]` (or a Markdown link when that setting is on). Note names stay synchronous. Empty aliases and aliases that contain `|`, `]`, or a newline are skipped. `[[Note#`, `[[Note^`, and `[[#` were already implemented and were not rebuilt.

## How it was checked

Settings were opened in Obsidian 1.14.4 under a scratch profile, headless, with no real vault and no read of Obsidian's code. The Options list is General, Appearance, Interface, Editor, Files and links, Hotkeys, Keychain, Core plugins, Community plugins, then the core-plugin pages. Grove's list is that same prefix through Core plugins, then the plugin pages Grove has (Backlinks, Daily notes, Note composer, Templates). Files and links already follows the same section order for the rows Grove has: new-note location, attachment location, Links, Trash, Advanced. Nothing was reordered.

From `rebuild/app`, headless Chromium and Vite, real pointer and keyboard input, scratch vault only, viewport 1280×800. No window was opened on the real screen.

`scripts/test-r27q.mjs` checks two unmoved clicks on frontmatter and on H1–H3 in Live Preview, Source, and Reading; backlink header colour, the shared 13px/274px inset, the file and Unlinked rhythm, and the ascending sort glyph; a neutral active icon on backlinks Show more context, outline Auto-scroll, tags sort, file-explorer auto-reveal, and search settings; outline highlight on the top heading while Auto-scroll is off; the auto-scroll glyph; one search count control with the dot on the right; the 24px borderless right-aligned sort dropdown ending at x=332; the 28×30 clear button at x=270; the 30px search field; explorer focus, arrows, Shift-extend, expand and collapse, multi-file drag, Escape cancel, Backspace delete, multi-delete that keeps the empty folder, rename Backspace, an editor drop that inserts `[[KeyDrop]]`, an alias suggestion that inserts `[[R27qAlias|Zephyr]]` and hides a piped alias, `[[Note#` headings, `[[#` headings of the current note, a block id insert, and Reading staying read-only.

`scripts/test-r27p.mjs` now expects the 13px/274px backlink inset, `arrow-up-narrow-wide`, and the `grove-auto-scroll` glyph. Its click on the search field waits for the grey ring to finish fading in. `scripts/test-r27o.mjs` expects Auto-scroll off to keep highlighting the section in view without scrolling the outline. The outline note is long enough that Gamma can sit at the top of the editor, and that script waits for the same ring fade.

- `npm run build`: passed (`tsc --noEmit` and the Vite production build).
- `npm test`: passed. Vitest was 48 files and 283 tests. The browser scripts ran through `scripts/test-r27q.mjs`, including the Live Preview, Source, and Reading pointer checks. The search measurement in that run was switch centre y=103 (view+63) and count top y=193 (view+153).
- `npm run audit:offline`: passed, 151 source files.

The screenshot and canvas fixtures `npm test` rewrites are restored and are not part of this change. Rust was not changed, so cargo was not run.

## Left out

Bookmarks stay a path list. Rename and drag order are a later change, not a half-built editor on that list.

Keychain, Community plugins, and the account pages (Sync and the rest of that second group) are larger than a small fix. Grove's Options order already matches the applicable Obsidian prefix, so it was not rearranged.

The search settings block was not moved the rest of the way to the brief's y=75 / y=181. The measured positions are y=103 and y=193 in the coordinate system where the clear button is x=270.

No production file exceeds 800 lines. `sidebar.ts` is 687. No new dependencies.

## Line counts

Net lines in this round, production code only. The notes file is not included.

- TS: **+298**.
- CSS: **+29**.
- RS: **0**.

The new browser script is 414 lines. `package.json` adds `scripts/test-r27q.mjs` at the end of `test`, after `scripts/test-r27p.mjs`. `scripts/test-r27o.mjs` and `scripts/test-r27p.mjs` expect the outline highlight and the backlink inset and glyphs above.
