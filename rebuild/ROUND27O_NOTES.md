# Round 27o

The 27n side-by-side leftovers, measured against Obsidian 1.14.4 at 1280×800, then the small backlink and search pieces 27n left listed. No canvas files and no Bases files. Nothing was pushed.

## What changed

A one-line backlink mention, linked or unlinked, is 31.6px: padding 8px 20px 8px 12px, 12px type, line-height 1.3. The row sits 13px in from each side of the 300px pane, so it is 274px wide. These rows drop the shared match border, which would have added 2px inside the box. The Link button stays 25px tall and sits 24px in from the row's right edge. Hover keeps the accent tint, and a chevron appears on the row for that mention's context.

The backlink toolbar is four centered 28×24 buttons, the same size as the file explorer's nav buttons: Collapse results, Show more context, Change sort order, and Show search filter. They sit at y=48. Linked mentions is a standard tree row, 24.9px, and the first header starts at y=84 under the 40px tab header and the 40px nav header.

Show more context draws the two lines before a hit and the two after. The toolbar toggle applies to every row. A row's chevron opens or folds that one row. Change sort order reuses the file sort (name, modified, created). The filter matches the note name or the mention line, and the section count is the mentions still shown.

Outline text starts 24px from the row, and each nested level adds 17px, so one level shares one x. On the measured note, Alpha, Beta, Gamma, and Delta sit at +24, +41, +58, and +41. A faint guide marks each ancestor step. Rows keep a 2px gap, so the pitch is about 27px. The filter input stays hidden until Show search filter. Auto-scroll to current section starts on, and turns the existing follow-the-heading off and on. Collapse all stays.

The search field keeps its resting shadow when it is focused. Search settings, the sliders button, sits just to the right of the field at 28×24. It opens Collapse results, Show more context, Explain search terms, and Sort order. Explain search terms writes one sentence from the parsed query. ArrowDown draws a 2px inset border around the row. Show more context adds the two lines around each of the first shown hits.

Backlinks under a note use the same view and grow with their content.

Reading a closed note loads the vault API at that moment. A static import of it pulled `window` into editor unit tests.

## How it was checked

The sizes follow this round's brief, taken side by side with Obsidian 1.14.4 at 1280×800. This round did not launch Obsidian again.

From `rebuild/app`, headless Chromium and Vite, real pointer input, scratch vault only, viewport 1280×800. No window was opened on the real screen.

`scripts/test-r27o.mjs` checks two unmoved clicks in Live Preview, Source, and Reading; a mention row inset 13px and 274px wide, 31.6px tall, at 12px / 15.6px with padding 8px 20px 8px 12px; four 28×24 toolbar buttons at y=48, centered; Linked mentions at 24.9px and y=84; an unlinked row at 31.6px; the Link button 24px in and 25px tall; the hover chevron; Show more context; sort Z to A; the filter; outline text at +24/+41/+58/+41, a 27px pitch, and guides at 0/17/34/17; the hidden outline filter; auto-scroll on, then off; a search field whose focus shadow is the resting input shadow; Search settings to the right of the field; collapse, context, explain, and sort inside that panel; the file-term explanation; an ArrowDown row drawn with a 2px inset border; and search context lines around the hit.

`scripts/test-r27n.mjs` now expects the 31.6px mention row, and opens the outline filter from its toggle before typing.

- `npm run build`
- `npm test`: browser discovery, vitest (48 files, 281 tests), geometry in Live Preview, Source, and Reading, and the browser scripts through `scripts/test-r27o.mjs`. All passed.
- `npm run audit:offline`: passed, 151 source files.

The screenshot and canvas fixtures `npm test` rewrites are restored and are not part of this change. Rust was not changed, so cargo was not run.

## Left out

Alias suggestions in the `[[` suggester stay out. `linkCandidates()` is synchronous and does not read frontmatter, and the property index is async, so offering a note's aliases and inserting `[[note|alias]]` is a later change.

Also left as they were: the Bookmark dialog, Open version history, Open in default app, Show in system explorer, New base on the empty tab, a separate hotkey-conflict pill treatment, and the status-bar sync item. The Hotkeys page already has a search filter, a Conflicts filter, and a red chip whose tooltip names the other command.

The file menu already has New note, New folder, Make a copy, Rename, Delete, Bookmark, Copy path, and Reveal file in navigation. A multi-selection can make a folder, move, bookmark, and delete. The tag pane already nests, counts, and opens a `tag:` search; its sort is by name, and a frequency sort is later. Bookmarks are a flat list that opens a note or reveals a folder. Groups, drag order, and rename are later.

No production file exceeds 800 lines. No new dependencies.

## Line counts

Net lines in this round, production code only. The notes file is not included.

- TS: **+243**.
- CSS: **+62**.
- RS: **0**.

The new browser script is 230 lines. `searchQuery.test.ts` gained the explain-query case (+9). `package.json` adds `scripts/test-r27o.mjs` at the end of `test`. `scripts/test-r27n.mjs` expects the 31.6px row and opens the outline filter from its button.
