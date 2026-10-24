# Round 27r

Gaps left after the 27q merge, measured again in headless Chromium at 1280×800, then a pass over the older annoyance list. No canvas files and no Bases files. Nothing was pushed.

## What changed

The search settings button is the one side-pane control that uses the accent. While it is open its icon is `--text-accent` on `color-mix` of `--interactive-accent` at 10%. Measured `rgb(39, 134, 122)` on that tint. The other toolbar buttons stay `--text-normal` on `rgba(0, 0, 0, 0.067)`.

The open search settings block is inset 16px (x=60, 268×97 inside the 300px view). Rows are 19px on a 35px pitch, so they sit at y=94, 129, and 164. Toggles in this panel only are 34×19 with a 15px knob. The count row's top is y=195, 4px under the block. Before this round the first row was already near y=94, the pitch was 34, the toggles were the 40×22 settings size, and the count row was y=193. A first pass pulled the block up to y=87; the top margin is 4px so the first row is y=94 again.

The more-options mark is an 11×11 filled circle (`currentColor`, muted grey at rest) with three dots in `--background-secondary`. It sits 6.5px down inside the 24px count control (padding 4px 6px). It was a 14×14 stroke icon.

The sort dropdown stays 166×24, ending at x=332, borderless and muted. Its text aligns to the start, with padding `0 28.8px 0 9.6px`, and the chevron is 7.8px from the right edge. It was right-aligned.

The outline Auto-scroll glyph is three bars of one width: a bar, a rounded rectangle, a bar, with the bars outside the rectangle. The class is still `grove-auto-scroll`.

Backlink section headers use the pane's 12px inset (x=12, 276px wide in the 300px dock). File rows and match cards take one more pixel (x=13, 274px). The file row stays at y=115 and Unlinked mentions at y=199.4.

`Files: Show file explorer` (`file-explorer:open`) reveals the explorer and focuses the list. The ring starts on the active file and the selection is left alone. Enter still opens the file and moves focus to the editor, and the ring stays on that row. A plain ArrowUp or ArrowDown moves only the ring. Shift+arrows still extend. ArrowLeft on a file inside an expanded folder focuses the parent and collapses it in one press. ArrowLeft on an expanded folder still collapses it. ArrowRight on a collapsed folder expands it, and a second ArrowRight moves to the first child. A click still clears the selection and opens the file.

The single-file delete dialog is titled "Delete file". The body is two paragraphs: `Are you sure you want to delete “R27qB.md”?` (the name keeps its extension) and `It will be moved to the vault's .trash folder.` When trash is off, the second paragraph is `It will be permanently deleted.` Grove has no system-trash option. One bottom row holds "Don't ask again" on the left, then Cancel, then Delete. A close button sits at the top right. Escape cancels. Focus stays on Delete. Several selected files still share one "Delete N items" dialog. The close button and the Cancel-then-Delete order are shared with the other yes/no dialogs.

The wikilink menu is anchored 7px left of `[[` (measured Δ −7). `[[#` is 252px wide, heading rows are 31.5px with the level on the right, nothing is preselected, and there is no footer. `[[Zep` is 433px wide, the alias row is 47.1px and preselected, with a small corner arrow, and the footer is `Type #  to link heading   Type ^  to link blocks   Type |  to change display text` with those three keys in bold and no middots.

Settings nav items are 24.9px tall with a 2px gap (pitch 26.9). They were a 1px gap.

## How it was checked

`/workspace/grove-feel/ANNOYANCES.md` is not on this machine. The items named in the round brief were checked against the current tree instead of being rebuilt:

- Rename errors already show under the inline title and the explorer rename (`fieldError`).
- Tab and Shift+Tab already renumber the affected lists (`format.ts`, `format.test.ts`).
- Backspace on a list marker already removes the marker and keeps the indent; the next Backspace outdents (`backspaceList`, with tests).
- Created-time sort orders are already in the explorer menu. File rows are already about 25px. "Bookmark…" on a single file still bookmarks at once. A dialog and a title model are not a small change.
- The empty tab already has New note, Go to file, and Close. New base belongs to Bases.
- The window title is already "Note - vault - Grove". Escape from Settings already restores focus. Ctrl+Enter follows an internal link under the caret and does nothing on an ordinary line. Back already restores the caret.
- The status bar already shows a backlinks count, the command is already "Backlinks: Open backlinks for the current note", and Add alias and Add tag already exist.
- The hover preview already starts with the note title and shrinks to the note.

Two real clicks, without moving the pointer, on the frontmatter key and on H1–H3 stay in the note in Live Preview, Source, and Reading.

From `rebuild/app`, headless Chromium and Vite, real pointer and keyboard, scratch vault only, viewport 1280×800. No window was opened on the real screen.

`scripts/test-r27r.mjs` checks those clicks, the search settings accent and geometry (including y=94 and y=195), the 11px dot, the start-aligned sort field, the auto-scroll bars, explorer focus and the ring on the active file, Enter keeping the ring, plain arrows leaving the selection alone, Shift-extend, one-press ArrowLeft, the delete dialog (extension, two paragraphs, checkbox, Cancel then Delete, close button), `[[#` with nothing selected, the alias row and footer, and the settings nav pitch. `scripts/test-r27p.mjs` and `scripts/test-r27q.mjs` expect backlink headers at x=12 / 276px beside file rows at x=13 / 274px. `scripts/test-r27q.mjs` also expects the accent settings icon, the 11px dot, start alignment, selection that does not follow a plain arrow, and one-press ArrowLeft.

- `npm run build`: passed (`tsc --noEmit` and the Vite production build).
- `npm test`: passed. Vitest was 49 files and 288 tests. The browser scripts ran through `scripts/test-r27r.mjs`.
- `npm run audit:offline`: passed, 155 source files.

The screenshot and canvas fixtures `npm test` rewrites are restored and are not part of this change. Rust was not changed, so cargo was not run.

## Left out

Bookmarks stay a path list in local storage. Rename and drag-to-reorder in the Bookmarks view need a title and an order model. That is a later change, not a half-built editor on the path list.

Keychain, Community plugins, and the account pages stay out of scope. Settings stays a modal (the separate 900×700 window is the same leftover as before).

Deleting several files still asks once, with the existing "Delete N items" wording. Obsidian asks once per file.

No production file exceeds 800 lines. `sidebar.ts` is 705. No new dependencies.

## Line counts

Net lines in this round, production code only. The notes file is not included.

- TS: **+129**.
- CSS: **+97**.
- RS: **0**.

The new browser script is 245 lines. `package.json` adds `scripts/test-r27r.mjs` at the end of `test`, after `scripts/test-r27q.mjs`. `scripts/test-round22b.mjs` and `scripts/test-r27c.mjs` read the suggester footer element for the one-line hint. `scripts/test-link-subpaths.mjs` presses ArrowDown before accepting `[[#`, because that list opens with nothing selected.
