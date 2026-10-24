# Round 27s

Gaps left after the 27r merge, measured again in headless Chromium at 1280×800, then the older annoyance list. No canvas files and no Bases files. Nothing was pushed.

## What changed

The search count control is 76.8px wide. Its more-options mark is an 11×11 circle (`rgb(92, 92, 92)`, radius 50%) 6px after the label, at x=115.8, inside padding `4px 6px`. It was an svg about 5px further right, and the control was 81.7px wide.

`Files: Show file explorer` focuses the list and parks on the active file with no ring. The first plain ArrowUp or ArrowDown draws the ring on that row and does not move. Later arrows move the ring. A click sets the cursor to that row, opens the file, and leaves no ring, so the next arrow moves from the clicked row. Enter still does not create or clear the ring. ArrowLeft still collapses a parent in one press. The class stays `.is-focused`.

`[[#` in a note with no headings opens a muted "Heading" row and a "↵ to accept" footer. Measured 87.8×79.1, text `rgb(171, 171, 171)`, left edge 10.5px to the right of `[[` (the right edge of the brackets). It was no popup. The placeholder does not insert a link. A note that has headings still opens with nothing selected, a 31.5px heading row, and no note-suggester footer.

The link menu's left edge is that same point, 10.5px to the right of `[[`. It was 7px to the left. `[[Zep` measured 433.4×94.7. The alias row stays 47.1px and preselected. The footer is one space after each bold key (`#`, `^`, `|`), with padding `8px 12px` and line-height 15.6px. The list padding is `6.5px 4px`.

An unclosed `[[Zep` in Live Preview is already a link: the brackets are `cm-formatting cm-formatting-link` at `rgb(171, 171, 171)`, and the text is `cm-wikilink` in the accent at full opacity. It was plain text until `]]`. A closed wikilink, fenced code, inline code, an HTML block, or frontmatter is left alone.

The delete dialog, other than the canvas help dialog, is 560px wide with 16px padding. The title is 15px/600. Body paragraphs are 15px on a 34.5px pitch, and the first paragraph starts 45.5px below the title top. The checkbox is 15×15. Buttons are 30px tall with padding `4px 12px` (the first button measured 64.5px wide). It was 450px wide, 24px padding, 13px body, a 32px title-to-body gap, a 13px checkbox, and button padding `4px 14px`. The wording stays "the vault's .trash folder" or "permanently deleted".

Renaming from the inline title or the explorer reports the problem while the name is typed. `:` shows "File name cannot contain any of these characters: \ / :". A name that is already taken shows "There's already a file with the same name". An empty name is reported only on commit. The draft stays until Escape or a legal name.

The status bar counts each backlink mention. Two links to one note from one file read "2 backlinks". It was the number of source files.

## How it was checked

From `rebuild/app`, headless Chromium and Vite, real pointer and keyboard, scratch vault only, viewport 1280×800. No window was opened on the real screen. Chris's vaults were not opened.

`scripts/test-r27s.mjs` checks the count dot, the parked explorer ring, the empty heading popup, the alias popup anchor and the unclosed link, the delete-dialog metrics, both rename messages, and the two-mention backlink count. `scripts/test-r27r.mjs` expects no ring until the first arrow, the grey circle, and the popup anchored just after `[[`. `scripts/test-r27q.mjs` expects a click to leave no ring. `scripts/test-round19.mjs` and `fileOps.test.ts` expect the "same name" wording.

The annoyance list, checked against the current tree rather than rebuilt:

- Tab and Shift+Tab already renumber ordered lists (`format.ts`, and the round 19 keyboard checks).
- Backspace on a list marker already removes the marker and keeps the indent. The next Backspace outdents.
- Tooltips are already a delayed styled tip with an arrow. The ribbon, toolbar, and header checks cover them.
- Dragging a background tab does not activate it. A click with no movement still does.
- Quick switcher Tab already completes the selected name. An empty query already lists recent files, and the switcher already includes canvas and base files.
- Explorer sort already has created time, the rename field already has an accent outline, and file rows are already about 25px.
- The empty tab already shows New note, New canvas, New base, and Go to file, and a new tab is appended at the end.
- The window title is already "Note - vault - Grove". Escape from Settings already returns to the note. Ctrl+Enter on an ordinary line does nothing. Alt+Up and Alt+Down do nothing. Back already restores the caret.
- The command "Backlinks: Open backlinks for the current note" already exists, as do Add alias, Add embed, and Add tag. Date properties already show a calendar on the left.
- The hover preview already starts with the note title and shrinks to a short note.

Two real clicks, without moving the pointer, on the frontmatter key and on H1–H3 stay in the note in Live Preview, Source, and Reading.

- `npm run build`: passed (`tsc --noEmit` and the Vite production build).
- `npm test`: passed. Vitest was 51 files and 295 tests. The browser scripts ran through `scripts/test-r27s.mjs`. `npm run test:geometry` is inside that script and passed.
- `npm run audit:offline`: passed, 159 source files.

The screenshot fixtures `npm test` rewrites are restored and are not part of this change. Rust was not changed, so cargo was not run. One `npm test` attempt stopped in `scripts/test-canvas-editing.mjs` on a 300-card drag frame of 33.2ms against a 20ms budget. That script does not cover these edits. The rerun passed.

## Left out

Bookmarks stay a path list. Rename and drag-to-reorder need a title and an order. That is a later change.

Keychain, Community plugins, and the account pages stay out. Settings stays a modal.

Deleting several files still asks once. Obsidian asks once per file.

A folder's menu has no Make a copy. Copying a folder is a separate operation from copying a note.

The hover preview has no expand control. The popover already uses the note title and a max height of 400px.

The quick switcher does not list image attachments. Notes, canvases, and bases are already there.

The empty heading popup is 87.8px wide against the brief's 97.6. The width is the "↵ to accept" footer in this font. The alias popup is 433.4px wide. The brief's 448.8 was a different layout; the same-layout figure was about 425. The height, 94.7, matches 93.7.

No production file exceeds 800 lines. `sidebar.ts` is 731. No new dependencies.

## Line counts

Net lines in this round, production code only. The notes file is not included.

- TS: **+70**.
- CSS: **+52**.
- RS: **0**.

The new browser script is 171 lines. `package.json` adds `scripts/test-r27s.mjs` at the end of `test`, after `scripts/test-r27r.mjs`.

## Next

- Give a folder "Make a copy" once a folder copy has a name and a contents rule.
- Add the hover-preview expand control without changing the title or the short-note height.
- List image attachments in the quick switcher the same way canvases and bases are listed.
