# Round 18 bugs

Hunter pass on `rebuild/r18-grok` at `16b14c8` (Codex's round 18, notes in `ROUND18_NOTES.md`). Nothing in the app was changed. Checked in headless Chromium against the Vite dev server, with real pointer events (`Input.dispatchMouseEvent`: move, then press, then release) and key events. Device scale 1, window 1280×800, in-memory mock vault. No remote URL was requested. The page threw no exception.

Obsidian 1.14.4 was not driven in this pass. Expected behavior is the round brief, plus the Obsidian 1.14.4 behavior already recorded in `ROUND18_NOTES.md`.

## Bugs

### 1. Releasing Ctrl closes the preview while the pointer is still on the link

Severity: moderate.

Repro:

1. Open a note in Live Preview that contains `[[Sibling]]`.
2. Hold Ctrl and move the pointer onto the link. Wait about 500 ms. The preview opens.
3. Keep the pointer on the link and release Ctrl. A later `mousemove` still on that link is enough; moving the pointer a few pixels does it.
4. Wait 180 ms.

Expected: Ctrl (Cmd on macOS) is how the preview opens. Once it is open, it stays until the pointer leaves both the link and the popover, then closes after the short delay. Moving into the popover keeps it. Escape, typing, and scrolling the note close it.

Actual: the preview is still open 60 ms after that move, and it is gone after another 280 ms. The same close happens from the unit test: a `mousemove` with `ctrlKey: false` whose target is still the link calls `destroy`. Moving into the popover before the timer fires does keep it open, including after Ctrl is up. Reading view, which does not require the modifier, is unaffected.

Suspected: `src/shell/hoverPreview.ts` line 92. `if (!modified && !view?.state.facet(readingMode)) return leave();` runs before the "same link, keep it" path. The existing test "preview opens once…" (lines 58–62) dispatches that unmodified move and expects the close, so it locks the bug in. The new test "releasing Ctrl while the pointer remains on the link keeps the preview" fails on current code and is the brief's behavior. A fix has to update the older assertion as well.

### 2. A heading or block preview scrolls the target halfway down the popup

Severity: moderate.

Repro:

1. Open a note whose target is long enough to scroll. The fixture started with `# Top heading`, twelve filler paragraphs, `## Deep heading`, then `Block one stays together.` / `Block two stays together. ^blk18`.
2. In Live Preview, Ctrl+hover `[[ShortTarget#Deep heading|deep alias]]` until the preview opens.
3. Repeat for `[[ShortTarget#^blk18]]` with no other preview already covering that link.

Expected: `[[note#heading]]` scrolls that heading near the top of the popover, and `[[note#^block]]` does the same for the block. The heading is rendered without its hashes.

Actual: the heading text is `Deep heading` (hashes hidden) and its source line is right, but the heading's top is 290 px inside the 400 px popup. Measured: heading `offsetTop` 855, offset parent `internal-embed markdown-embed`, popup `offsetTop` 253, `scrollTop` 586. That is `855 - 253 - 16`. The block's top is 307 px down (`offsetTop` 939, popup `offsetTop` 253, `scrollTop` 653), with `Top heading` still leading the visible text. The miss tracks the popup's page Y, so a link high in the window can look fine while a link mid-window parks the target near the bottom.

Suspected: `src/editor/embeds.ts` line 280, `popup.scrollTop = target.offsetTop - popup.offsetTop - 16`. `offsetTop` is already relative to the `position: relative` embed inside the popup. `popup.offsetTop` is the fixed popup's page Y, so subtracting it underscrolls by about that distance.

### 3. Ctrl+hover on a search hit covers the hits under it

Severity: moderate.

Repro:

1. Search for a word with several hits. The fixture's `Needle` query listed three rows in Search18.
2. Hold Ctrl and rest the pointer on the first row until the preview opens.
3. Look at the rows below it.

Expected: Backlinks and Search previews were in scope only while the popover stayed small enough to keep using the list. The other hits stay visible, and the pointer can move to the next row.

Actual: the preview is the fixed 450×400 box (`pop` at 41,216 through 491,616) and it intersects the next row (`overlap` true, 3 hits). The popup's `mousemove` handler treats any pointer inside the popup as "stay open", so a covered row cannot be hovered without first leaving the popover. A single backlink row does open a preview (BackFrom's line, box at 822,139 through 1272,539) because nothing sits under that one row.

Suspected: placement in `src/shell/hoverPreview.ts` lines 81–84 prefers `rect.bottom + 6` and then clamps, and `.hover-popover` in `src/styles/blocks.css` lines 354–355 sets `width` and `height` to 450×400. Under a left-sidebar row that box covers the rows beneath it. The same fixed height is why a one-line missing note ("Not Created Yet" is not created yet) is still a 450×400 empty popup. That size matches the 452×402 Obsidian popup measured in the round notes, so the empty box on its own is the recorded size. Covering the following search rows is the part that fails the brief's "if that stays small".

### 4. A drag that starts on a tag selects nothing

Severity: moderate.

Repro:

1. Open `Tags18` in Live Preview: `Before the tags.` and `#orchard #nested/child more text after`.
2. Put the caret at the start of the note, so it is not already inside the tag.
3. Press on `#orchard`, drag to the right past the tag, and release.

Expected: dragging across a tag selects that text, the same as dragging across `Before`. A click with no drag still searches. A click while the caret is already inside the tag still edits it.

Actual: the selection stays empty and the search field stays empty, so it was not treated as a tag-search click either. A drag that starts on `Before` selects `Before`. A plain click on `#orchard` sets the search to `tag:#orchard` and lists the note. `#nested/child` searches as `tag:#nested/child`. A click with the caret already inside `#orchard` leaves the query alone and keeps the editor focused.

Suspected: `src/shell/pane.ts` lines 65–75. On mousedown, if the selection does not already overlap the tag, the handler calls `preventDefault()` and `stopPropagation()` before it can tell a drag from a click. CodeMirror never starts the selection.

### 5. Clicking the second highlight on a search row selects the first match

Severity: moderate.

Repro:

1. Open Search and query `Hit`. Search18 has one line, `FirstHit then several words then SecondHit on one line`, with two highlighted `Hit` spans.
2. Press the second highlight (measured around x=169, y=193). The first highlight is around x=86.

Expected: the note opens with the match under the pointer selected. The second `Hit` is the one inside `SecondHit` (column 33 on that line).

Actual: the selection is the four characters `Hit` at column 5, which is the `Hit` inside `FirstHit`. `FirstHit` starts at column 0 and `SecondHit` at column 33. A row with one match does the right thing: `UniqueNeedle` on line 1, `FarNeedle` scrolled into view on the long line, and `TailNeedle` on the last line of a note that was already open.

Suspected: `src/shell/searchView.ts` lines 91–95. The row's `onclick` always passes `spans[0]`, and it never looks at which `.search-result-file-matched-text` was pressed. Backlinks use the same first-span choice in `src/shell/backlinksView.ts` around line 94.

### 6. Clicking an embed inside a callout lands on the callout header

Severity: moderate.

Repro:

1. In Live Preview, open a note with a callout that contains an embed:

   ```markdown
   > [!note] Callout
   > Embedded below.
   > ![[Alpha]]
   ```

2. Press the rendered text of the embedded note (the "Alpha note" lines), not the Open link icon.

Expected: the caret moves to that embed's `![[Alpha]]` line and the source shows, the same as clicking `![[Beta]]` in ordinary text. On `Before ![[Alpha]] middle ![[Beta]] after.`, clicking the Beta embed puts the caret at column 28, inside `![[Beta]]`, and the syntax is visible.

Actual: the caret line is `> [!note] Callout`. The content DOM does not contain `![[Alpha]]`. The embed the pointer was on is not the thing that opened.

Suspected: `src/editor/embeds.ts` lines 256–258 return immediately when `dom.parentElement` is inside `.cm-callout`. The callout's own mousedown (`src/editor/callouts.ts` line 92, via `box()` in `src/editor/render.ts` lines 103–108) then calls `editAt` at `posAtDOM` of the callout, which is the header line.

### 7. A long search hit wraps the rest of the line into the sidebar

Severity: moderate.

Repro:

1. Search for `FarNeedle` in a note whose matching line is thirty `padding` words, then `FarNeedle at the far side`, then thirty more `padding` words.
2. Look at the result row.

Expected: the snippet wraps so the text around the match is visible, instead of being clipped to one line. The window around the match stays short.

Actual: the row is `white-space: pre-wrap`, 312 px tall, with a line-height of 15.6 px, about twenty lines. The text starts with an ellipsis and the words before `FarNeedle`, then continues through the whole tail of `padding` words. One hit fills the search list.

Suspected: `snippetParts` in `src/shell/mentions.ts` lines 60–79 trims the head to about 60 characters and then pushes `text.slice(at)` through the end of the line. `.search-view .search-result-file-match` in `src/styles/fileTree.css` lines 194–205 wraps that full tail and sets no max height.

### 8. An embedded heading in Reading view stays at the Live Preview size

Severity: minor.

Repro:

1. Open a note in Reading view that has its own `# Reading Title` and an embed whose note starts with `# Alpha note`.
2. Read the computed font size of both H1s.

Expected: under `.is-reading-mode`, H1 is about 31 px with no top padding.

Actual: the note's own H1 is 31 px, padding-top 0. The embedded H1 (`Alpha note`) is 25.888 px, the Live Preview size. An H2 in the same Reading view is 23.392 px with padding-top 0 and a 16 px top margin. Live Preview's own H1 stays 25.888 px. The Reading H1 that is not the first line of the note has a 16 px top margin; the first-heading margin of 0 is the `:first-child` rule and was not the line under test.

Suspected: `src/styles/editor.css` lines 507–509. The selector is `.is-reading-mode .cm-content > .cm-line.cm-h1`, so a heading painted inside `.markdown-embed-content` never matches.

## What held

Hover:

- Live Preview: a plain hover stays closed. Ctrl+hover is still closed at 200 ms and open at 500 ms. One popover.
- Moving the pointer into the popover keeps it open after Ctrl is released. Leaving both: still open at 80 ms, gone by 330 ms.
- Escape closes it. Typing `Q` closes it and inserts `Q`.
- Wheeling `.view-content` outside the popup scrolls the note (0 to 240) and closes the preview.
- An external `https` link does not preview and adds no remote request. Clicking an `https` link inside an internal preview also fetches nothing and leaves the current note open.
- A missing note's copy contains "not created yet".
- Clicking `[[Sibling]]` inside the preview, after the popup is scrolled until that link is on screen, opens Sibling.
- Source mode has no `data-href` chip. A plain hover on the wikilink text stays closed. Ctrl+hover opens the target (`Sibling` / `Body`).
- Reading view opens on a plain hover.
- A same-note `[[#Reading Title]]` preview opens.
- Ctrl+hover on a backlink row opens that note. The BackFrom row showed `Links to ShortTarget in a backlink line.`

Find, tags, search, embeds, reading, tables:

- Ctrl+F focuses the search field. After the query is committed with a keyup, `here` is selected and the count reads `1 / 3`, drawn inside the field and not over the text. The bar is in `.cm-panels-top`. The close control lines up with the row (delta 0). Ctrl+H shows the replace row and focuses it. Escape removes the bar. The bar sits under the inline title (title bottom about 117, panel top about 128). The round notes already record that Obsidian's bar is above the title.
- Clicking `#orchard` searches `tag:#orchard` and lists the note. `#nested/child` keeps the slash. A click with the caret already in the tag does not search.
- Search jumps select `UniqueNeedle`, `FarNeedle` (on screen, not merely the start of the line), and `TailNeedle` when that note is already open.
- Clicking the second embed on a line reveals `![[Beta]]` at the caret. An embed's task checkbox toggles the other note (`- [x] Embed task`). A Reading-view embed stays rendered and read-only.
- Clicking a table cell and typing inserts the character (`one` became `onZe` from a click in the middle of the word).
- A drag that starts on ordinary text still selects that word.

Paragraph-margin parity in Reading view is the deferral recorded in `ROUND18_NOTES.md`. Reading view is still source lines, so that gap is not filed again.

## Suggested next

These are suggestions only.

1. **Drag files and folders in the explorer.** Notes and folders are still moved from a menu. It matters because rearranging a vault is what the file explorer is open for. Size: medium. Its own round, as the brief already scheduled, after the round 19 cleanup.

2. **Reading view as its own preview.** Heading padding is improved, and paragraph gaps are still the source-line layout. It matters because Reading view is the surface people put next to Obsidian, and the brief left this for when a separate preview document is worth it. Size: large.

3. **Paste rich text as Markdown.** Copied text from a browser or a document still lands as plain text. It matters because that is how notes pick up links, lists, and emphasis from somewhere else. Size: medium. A paste handler on the editor, with the existing markdown serializer, and the rename-error line under the title left as the smaller follow-up from the same list.
