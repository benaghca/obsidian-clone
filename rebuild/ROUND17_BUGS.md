# Round 17 bugs

Hunter pass on `rebuild/r17-grok` at `c4cee69` (Codex's round 17, notes in `ROUND17_NOTES.md`). Nothing in the app was changed. Checked in headless Chromium against the Vite dev server, with real pointer events (`Input.dispatchMouseEvent`: move, then press, then release) and one key event per character (`rawKeyDown`, then a single `char` for printable keys). Device scale 1, window 1280×800, light theme, in-memory mock vault.

Obsidian 1.14.4 was not driven in this pass. An early `obsidian --help` started Electron against the real config directory and was killed before it opened a vault. Expected behavior below is the round brief, plus the Obsidian 1.14.4 behavior already recorded for these same gestures in the round notes and in the editor comments.

## Bugs

### 1. "Edit this block" on a table opens the first cell

Severity: moderate.

Repro:

1. Open a note in Live Preview with a table, for example `| A | B |` / `| --- | --- |` / `| one | two |`.
2. Move the pointer over the table so the code icon in the top right appears (`aria-label="Edit this block"`, opacity about 0.85).
3. Press and release on that icon. Its box sits above the cells (measured around y=132 while the first body cell is around y=174).

Expected: the caret goes into the table's source, the same as "Edit this block" on a callout. `src/editor/callouts.ts` and `BlockWidget.box` in `src/editor/render.ts` both describe that click as putting the caret in the block so the source shows. That is how you reach the pipes without switching the whole note to Source mode.

Actual: the table stays drawn and a cell editor opens on the header. The caret lands at the start of `| A | B |` (head 2 in the fixture). The icon has no click handler of its own. The widget's mousedown treats anything that is not a `td` or `th` as the first header cell.

Suspected: `src/editor/tables.ts` around the widget `mousedown` (the `closest("td, th") ?? table.rows[0].cells[0]` fallback, just after line 233). The button is built by `editButton()` / `widgetAction()` in `src/editor/render.ts`, which does not pass an `onClick`.

### 2. A table cell does not auto-pair quotes or stars

Severity: moderate.

Repro:

1. Open `| A | B |` / `| --- | --- |` / `|  | two |` in Live Preview.
2. Move the pointer over the empty cell and click it, so the nested editor appears.
3. Type `"`. Repeat in a fresh empty cell with `*`.

Expected: the same pairing as the rest of the note, which matches the brief and Obsidian. In the note body, one `"` becomes `""` with the caret between the quotes, and one `*` becomes `**` the same way. A second press steps over the closer. Backspace on an empty pair removes both characters. A selection is wrapped.

Actual: the cell stores a single character. After `"`, the row is `| " | two |`. After `*`, the row is `| * | two |`. The nested editor's extensions are the cell class, line wrapping, the pipe-escape filter, the cell key handler, and `defaultKeymap`. The note's `closeBrackets` / `markdownPairs` setup from `src/editor/config.ts` is not on that view. The same keystrokes in the note body pair, wrap a selection, skip a closer, and remove an empty pair on Backspace.

Suspected: the nested `EditorState.create` in `src/editor/tables.ts` (extensions starting at line 160).

### 3. Find shows `0 / N` until Enter selects a match

Severity: minor.

Repro:

1. Open a note whose text is `alpha beta alpha`, `alpha gamma`, `Alpha`.
2. Press Ctrl+F. The find field takes focus and the note is unchanged.
3. Type `alpha`.
4. Press Enter.

Expected: a current match, as in the brief's example "1 / 6". After the query is typed, one match is selected and the count's first number is that match.

Actual: after typing, the field reads `alpha`, the count reads `0 / 4`, and the note selection is still empty at the start. Enter then selects the first `alpha` and the count becomes `1 / 4`. Shift+Enter steps backward and wraps. Escape closes the panel, focuses the editor, and leaves that match selected, so the next typed character replaces it. A query with no matches reads `0 / 0`. The total is right. The current index stays 0 for as long as the selection is not exactly one of the match ranges, including a caret sitting inside a match.

Suspected: `searchCounter` in `src/editor/editor.ts` (lines 129–130). The index is `findIndex` of a range equal to the main selection, plus one. CodeMirror's search panel does not select a match until Enter / Shift+Enter.

## What held

Part A, in Live Preview, with the pointer moved onto the target before the press:

- The table stays drawn. Clicking the middle of `alpha` opens that cell and puts the caret inside the word. Other cells stay rendered, including bold in an inactive cell. The active cell shows its markdown source (`beta **bold**`).
- Tab and Shift+Tab move between cells. Enter moves down. Tab in the last cell, and Enter in the last row, add a row. ArrowLeft and ArrowRight leave at the edges. ArrowDown leaves downward. Escape closes the cell. A click outside closes it and moves the caret.
- Dragging inside a cell selects part of the word. Double-click selects the word (`alpha`).
- One typed `|` is stored as `\|` once. Shift+Enter inserts `<br>`.
- A space typed in the middle of `one` (`o ne`) is still there after Tab. Undo and redo of one typed character restore it and keep the cell focused.
- Ctrl+B inside a word in a cell wraps that word (`**hello**`). Ctrl+F from a cell focuses the find box.
- A right-click on a cell opens the editor menu with Row and Column. Resting the pointer on Row opens Add row below, Move row up, Duplicate row, and Delete row.
- A 12-column table is wider than the note column. The widget's overflow is `auto` (scroll width about 1061, client width about 732), so the later columns sit in that scroller.
- A compact table without outer pipes renders and accepts typing. Center alignment stays center while the cell is edited. A click at the right side of a wide cell lands at the end of the text.
- Source mode shows the raw pipes. Reading view does not open a cell editor. A task checkbox outside a table still ticks.
- The fold chevron appears while the pointer rests on a heading and on a list item (18×18, `display: flex`), and the fold command collapses the section to `…`.

Part B:

- Ctrl+B, Ctrl+I, and Ctrl+/ with the caret inside `hello` wrap that word (`**hello**`, `*hello*`, `%%hello%%`) and leave the caret on the same character. Ctrl+B again removes the bold.
- `"`, `` ` ``, and `*` pair on an empty caret. A second press steps over the closer. A quote or star typed after or inside a word stays single. `"`, `(`, and `[` wrap a selection. Backspace removes an empty pair. Enter after a new fence, including one with a language, adds the closer and does not duplicate a fence that is already closed.
- Home, then Home again, lands after the marker and then at column 0 for `- `, a nested bullet, `- [ ] `, `- [x] `, `1. `, `12. `, `> `, nested quotes, `> - `, `>   - `, and `1. [ ] `. Shift+Home selects back to the marker. Home inside a fence does not use the marker rule.
- Ctrl+E to Reading view and back keeps the caret and focuses the editor, so typing lands there. The mode button does the same. Enter in the Reading-view inline title commits the rename (`Renamed Note.md`). When other notes link the old name, focus then sits on the Update button of the link prompt.
- Source mode headings: H1 is 25.888px, weight 700, padding-top 0. H2 is 23.392px, weight 680, padding-top 0.
- Clicks at 0, 0.5, 1, 2, and 3px into a rendered bold word land on the `b` of `boldword`, inside the hidden `**`. Typing there produces `see **Qboldword**`. A drag across bold text keeps the marks hidden. Double-click selects `boldword`. A click in the left margin stays on that line.
- Reading view uses the I-beam over the paragraph and the arrow on the margin. Source and Live Preview list lines match (26.375px, padding 1.2px).

## Suggested next

These are suggestions only.

1. **Reading view as its own preview.** Grove's Reading view is still the Live Preview document with editing turned off, so heading boxes keep Live Preview's 16px top padding. Obsidian's reading preview is a separate document: the H1 is about 31px with no padding, and the gaps between headings and paragraphs are margins. It matters because Reading view is the surface people put next to Obsidian. Size: medium. Spacing can be adjusted under `.is-reading-mode`; matching the preview's margins means a real preview document.

2. **Link hover previews.** Hovering an internal link does not show the target note. It matters because that preview is how people check a link without leaving the sentence. Size: medium. A small popover fed by the note that is already in the vault, dismissed on pointer leave and on Escape.

3. **Drag files in the explorer.** Notes and folders are still moved from a menu, not by dragging them onto a folder. It matters because rearranging a vault is the thing the file explorer is open for. Size: medium. A drag on a row, a drop highlight on folders, and the existing move-file path.
