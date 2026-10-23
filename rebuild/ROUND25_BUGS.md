# Round 25 bugs

Hunter pass on `rebuild/r25-grok` at `4d04807` (Codex's round 25, notes in `ROUND25_NOTES.md`). No application source was changed. Grove was checked in headless Chromium against the Vite dev server (127.0.0.1 only), private profile, device scale 1, in-memory mock vault. Pointer input is `Input.dispatchMouseEvent` (move, then press, then release). Keys are `Input.dispatchKeyEvent`. A double-click is press/release with clickCount 1, then press/release with clickCount 2, with the pointer left where it is.

Obsidian 1.14.4 was not launched again in this pass. The redo shortcut in bug 8 is the help text already recorded in `round25-shots/obsidian-partb-observations.txt`.

`scripts/test-r25-bugs.mjs` encodes the bugs below and is wired into `npm test`. It fails on this commit. `npm run test:geometry` passed: stationary fold and unfold on `Geometry.md` and `GeometryFM.md` in Live Preview, Source, and Reading, and Ctrl+O, Ctrl+P, and the right-click menu were visible within two frames. The longest sampled frame was 17.1ms. `npm run audit:offline` passed (138 source files, `dist/`, CSP, capabilities, and dependencies).

## Bugs

### 1. Double-clicking Remove creates a text card

Severity: high.

Repro:

1. Open a canvas with one text card, `x: 80, y: 80, width: 200, height: 80, text: "Keep"`.
2. Click the card so the selection toolbar is showing.
3. Double-click Remove, with the pointer moved onto the button first and not moved again.

Expected: the board is empty. Remove deletes the selected card. A double-click creates a text card on empty background, and the toolbar is one of the targets that click ignores.

Actual: the card is gone and a new card is `.is-editing` with empty text. The saved file is one node, `x: 6, y: 23, width: 250, height: 60, type: "text", text: ""` (the id changes each run; this pass saved `8e84b2b73fb9417f`). The first click deletes the card and removes the toolbar, so the second click lands on empty background. The controls suite waits 350ms between clicks, so it never hits this.

Suspected: `src/canvas/cards.ts` lines 68–69. The background double-click ignores `.canvas-selection-menu`, and that element is already gone when the second click arrives. Failing test: `scripts/test-r25-bugs.mjs`.

### 2. A heading's trailing block id is part of its link text

Severity: moderate.

Repro:

1. Save `Land.md` as `Before the headings.`, a blank line, `# Has id ^keep`, a blank line, and `# Pipe | split`.
2. In another note, type `[[Land#Has` and read the suggestion. Press Enter.
3. On its own line in a third note, type the whole link `[[Land#Has id]]`, click onto the following line so the link renders, and click the rendered link.

Expected: the suggestion label is `Has id` and Enter inserts `[[Land#Has id]]`. The block list already shows a heading's text with the id removed. Clicking `[[Land#Has id]]` puts the caret on `# Has id ^keep`.

Actual: the only row is `Has id ^keep`, and Enter inserts `[[Land#Has id ^keep]]`. The rendered link `Land#Has id` is a real target (its text is `Land#Has id`), and the click leaves the caret on `Before the headings.`

Suspected: `src/editor/wikilinkComplete.ts` lines 73–75 take the heading line, strip the hashes, and keep a trailing ` ^keep`. `src/editor/headings.ts` lines 26–28 compare that same remainder, so `Has id` does not match `# Has id ^keep`. Failing test: `scripts/test-r25-bugs.mjs`.

### 3. A heading that contains `|` is inserted as an alias

Severity: moderate.

Repro:

1. Use the `Land.md` from bug 2.
2. Type `[[Land#Pipe` and press Enter on the suggestion `Pipe | split`.
3. Click onto the next line so the link renders, then click it.

Expected: the accepted link still refers to the heading `Pipe | split`. The click puts the caret on `# Pipe | split`.

Actual: the note contains `[[Land#Pipe | split]]`. The rendered `data-href` is `Land#Pipe` and the visible text is ` split`. The click leaves the caret on `Before the headings.`

Suspected: `src/links/internal.ts` lines 56–57 append `subpath` inside `[[...]]` with the pipe untouched. The wikilink pattern on line 141, and the Live Preview mark in `src/editor/livePreview.ts` (`decorateWikiLink`), both stop the target at `|`. Failing test: `scripts/test-r25-bugs.mjs`.

### 4. Accepting a block reference is two history steps

Severity: moderate.

Repro:

1. Open a note whose body is frontmatter `title: S` and then `Target paragraph.` Type `[[^Target` and press Enter on that row.
2. Press Ctrl+Z once.
3. In another note, type `[[Nest^Body` against `Nest.md` (frontmatter `title: Nest`, heading `Alpha`, paragraph `Body paragraph.`) and press Enter. Press Ctrl+Z once in the source note.

Expected: one Ctrl+Z reverses the accept. The typed query is back and the generated id is gone, including the id written into the other note.

Actual: the accept writes `Target paragraph. ^452ee7` and `[[#^452ee7]]` (the id changes each run). One Ctrl+Z restores `[[^Target` and leaves ` ^452ee7` on the paragraph. A second Ctrl+Z in that same note, checked earlier in this pass, is what removes the id. Across notes, one Ctrl+Z restores `[[Nest^Body` while `Nest.md` still ends `Body paragraph. ^16ced5`.

Suspected: `src/editor/wikilinkComplete.ts` lines 63–69 call `insertBlockId` and then `insertLink` as two transactions. `src/editorHost.ts` lines 52–57 dispatch the id on its own. The other file's history is a different stack. Failing test: `scripts/test-r25-bugs.mjs`.

### 5. The selection toolbar covers group labels and long file names

Severity: moderate.

Repro:

1. Open a canvas with a group `x: 80, y: 160, width: 420, height: 220, label: "Notes from the whole first chapter"` and a file card `x: 80, y: 460, width: 260, height: 110` whose file name is `A very long note name that should sit above the card.md`.
2. Click the group. Sample `elementFromPoint` every 4px along the label's horizontal midline, inside the canvas view.
3. Click the file card and sample its label the same way.

Expected: each sample hits that label. The name stays readable and is the click target across its width.

Actual: the group label measures 380×31 and 26 of 95 midline samples miss it. The file label measures 258×19 and 26 of 64 samples miss it. A short `Group label` (139×31) on the same 420-wide group missed 0 of 34, so the covered strip is the centered toolbar, about 137px wide, where the label runs underneath it.

Suspected: `src/canvas/controls.ts` lines 64–66 place the toolbar at the selection's top center. `src/styles/canvas.css` line 103 gives it `z-index: 4` and pulls it up by its own height plus 10px. Lines 41–52 and line 66 put the group label and the file label in that same band (`bottom: calc(100% + 4px)`). Failing test: `scripts/test-r25-bugs.mjs`.

### 6. A nested list item is not its own block row

Severity: moderate.

Repro:

1. Save `Lists.md` as `- Parent item` and an indented `- Nested item`.
2. In another note, type `[[Lists^` and read the rows.

Expected: `Nested item` is its own row, the same way the two top-level items in the round's block list are separate rows.

Actual: the only row is `Parent item` and `Nested item` in one label. With the newline collapsed for the assertion, the text is `Parent item Nested item`.

Suspected: `src/editor/wikilinkComplete.ts` lines 39–42 add each direct child of a top-level list and do not walk a list nested inside that item. `linkBlocks` then joins the item's lines into one label. Failing test: `scripts/test-r25-bugs.mjs`.

### 7. `[[Note#Heading^` lists every block in the note

Severity: moderate.

Repro:

1. Save `Section.md` as `# Alpha`, `Alpha only.`, `# Beta`, `Beta only.`
2. In another note, type `[[Section#Alpha^` and read the rows.

Expected: the rows stay in Alpha. The heading already typed is `Alpha`. The brief's `[[Note^` and `[[Note#^` forms are the ones that list the whole note; this string has a heading in it.

Actual: the rows are `# Alpha`, `Alpha only.`, `# Beta`, and `Beta only.`

Suspected: `src/editor/wikilinkComplete.ts` lines 88–89 treat the final `^` as the block marker and pass `Section#Alpha` through as the file. Resolution splits on `#`, so the suggester lists the whole note. Accept always inserts `#^id` (line 69). Failing test: `scripts/test-r25-bugs.mjs`.

### 8. Ctrl+Y does not redo a canvas edit

Severity: low.

Repro:

1. Select a text card and set its color to Cyan.
2. Wait for the save. The file contains `"color":"5"`.
3. Click Undo, click the card so the canvas is focused, and press Ctrl+Y.

Expected: the color comes back. The Obsidian 1.14.4 canvas help recorded for this round lists Redo as `Ctrl + Y` and `Ctrl + Shift + Z`.

Actual: the file is the pre-color document and has no `color` key. Grove's help lists `Ctrl + Shift + Z` and the key handler returns on `Y`.

Suspected: `src/canvas/editing.ts` lines 118–122. Undo is Ctrl/Cmd+Z, and anything else other than Delete, Backspace, arrows, and Escape returns before `history` runs. `src/canvas/controls.ts` lines 27–28 omit Ctrl+Y from the help rows. Failing test: `scripts/test-r25-bugs.mjs`.

## Checked, not filed

- An untouched canvas that already contained an unknown node field and a root `tags` array stayed byte-identical after open. A note whose body contained `https://example.com/secret.png` added no remote resource entry; the recorded requests were `http://127.0.0.1/...`.
- The selection toolbar at scale 1 and after Zoom to selection (scale 2) stayed 137×34, 10px above the card, and Remove was still the hit target. Shift-click of two text cards hid Edit, wrote Yellow (`"3"`) on both text cards, left the file card uncolored, and Undo restored that. Remove then deleted both cards and the edge. A double-click on Set color, pointer unmoved, closed the menu and did not add a card or a color.
- Heading rows for two headings of different names accept from the keyboard (ArrowDown twice, then Enter, inserted the third heading). An H3 under another heading is listed. A frontmatter `title` is not. Escape closes the popup and leaves the typed `[[` query. `[[No Such Note#` and `[[No Such Note^` show no rows. Source mode lists duplicate headings. Reading mode ignores typed `[[` and stays read-only.
- `[[Ne` suggests `Nest`, Ctrl+O opens the quick switcher, and a click in the file explorer opens `Nest.md`.
- A blockquote line `> # Quoted heading` is absent from `[[#`. The heading index walks top-level blocks, and a real nested H3 is listed, so this stays unfiled.
- Panning a card toward the top of the view never put the toolbar past the clip edge in the checks that were run. A wheel burst that flung the card to `y` around 4863 was not a clip test.
- Cyan is `"5"` and Green is `"4"`. The Redo button and Ctrl+Shift+Z are the redo path the controls suite already covers.

## Next improvements

1. Canvas arrows: create, reconnect, label, and delete an edge. Cards and a pre-authored edge are on the board, and everyday use needs a way to draw the connection. Roughly 350–600 lines. This is the round 26 slice already named in the task.
2. Index canvas text and wikilinks for search, backlinks, and the graph. A note named from a card is still absent from those surfaces. Roughly 250–450 lines, one extraction path beside the existing note index.
3. Edit groups and note cards on the board. The label and the file card are visible, and the selection toolbar already sits on top of long names, while the text of either one still cannot be changed there. Roughly 300–500 lines.
