# Round 27t

Gaps left after the 27s merge, measured again in headless Chromium at 1280×800, then the older annoyance list. No canvas files and no Bases files. Nothing was pushed.

## What changed

The link hint stays under the suggestion list. Typing `[[Zep` one character at a time used to append the footer before the list existed, so the children were the footer and then the list. `showOptions` rebuilds the list at the end, and the layout step now appends the footer again so it moves last. Measured children: `UL` then `DIV.cm-link-suggest-footer`. The box was 466.5×438.2, height 126.2, because that query matches both the alias and the note.

A one-insert `[[Ide` (paste, IME, or CDP `Input.insertText`) lands on the same x as typing. CodeMirror parks a new tooltip at `top: -10000px` and `left: 0` until its own measure sets `left`. Measuring in that frame made the translate equal the caret x, and the later `left` doubled it, so the popup sat near 933. The layout now skips the translate while the tooltip is parked and asks for one more measure. After the fix, char-by-char `[[Zep` and one-insert `[[Ide` both sit at visual x 466.5, with `left` 466.5 and translate 0. The two visible frames of the one-insert popup were 467 and 467.

`[[#` in a note with no headings already used the shared anchor (visual x 466.5). Its box was 87.8×79.1. A fresh Obsidian observation at the same viewport is 93.89×78.09; the brief's 97.6 was an older layout. The empty popup now has `min-width: 94px`. Measured 94.0×79.1 at x 466.5. The placeholder text stays `rgb(171, 171, 171)`.

Suggestion titles are 15px, padding `6px 12px`, line-height 19.5px, min-height 31.5px. A note row measured 31.5px. They were 13px on a 28px row. Alias rows stay 47.1px on their own rule, and the alias-only `[[Zep` popup stayed 438.2×94.7. The footer command is the whole `Type #` (and `Type ^`, `Type |`) at weight 600 and `rgb(92, 92, 92)`. The key alone used to be weight 700 and `rgb(34, 34, 34)`. Footer padding stays `8px 12px`.

The inline-title rename error is a red tooltip under the title. It keeps the class `rename-error` and stays the next sibling of the field, so the explorer error is still the in-flow red line. The pill is 400.0×32.9 at (606.0, 149.1), white text on `rgb(233, 49, 71)`, padding `8px 12px`, radius 12px, 13px/400, line-height 16.9px, text centred. A 10×5 arrow sits 5px above the pill, centred. The title centre was 806 and the title bottom 141.1. It was a transparent red line, 700×16.8 at (456, 150), 12px. The `top` includes the sizer's 32px padding because an absolute top is measured from that padding edge. Escape still clears it. The message keeps ordinary spaces.

The delete dialog, other than the canvas help dialog, is 201.5px tall. The gap from the last paragraph's top to the checkbox is 62.8px, and the "Don't ask again" label is 15px. It was 183.5px tall, a 26px gap, and a 13px label. The row's `margin-top` is 38px. Obsidian measured 201.3px tall with about 64.5px from the paragraph to the checkbox. The wording stays "the vault's .trash folder".

The quick switcher lists attachments. Searching `photo` returns `photo.png`. An empty query still lists recent notes only. `includedNotes()` was notes, canvases, and bases; other non-directory files now follow them.

## How it was checked

From `rebuild/app`, headless Chromium and Vite, real pointer, real keyboard, and CDP `Input.insertText`, scratch vault only, viewport 1280×800. No window was opened on the real screen. Chris's vaults were not opened. Obsidian 1.14 was observed the same way, rendered UI only, on a scratch vault.

`scripts/test-r27t.mjs` checks the footer order, both link-popup anchors, the frames of a one-insert popup, the 15px row, the empty heading size, attachments and `Projects/` and "Missing note" in the link menu, the rename pill, the delete-dialog spacing, the 25px file row, `photo.png` in the quick switcher, the window title, Expand all and Collapse all, the vault switcher's Manage vaults item, and the status-bar words. `scripts/test-r27r.mjs` now expects each bold footer command to be `Type #`, `Type ^`, and `Type |`. `scripts/test-r27s.mjs` still expects the empty popup near 94×78 and the alias popup at 94.7px. `scripts/test-round19.mjs` still expects the class `rename-error`.

The annoyance list, checked against the current tree:

- #18 The link menu already lists recent notes first, `photo.png`, `diagram.svg`, unresolved "Missing note", and a folder as `Projects/`. The hint already fits on one line. The new test asserts the attachments, the folder, and the missing note.
- #19 Attachments were missing from the quick switcher. Searching `photo` now lists `photo.png`.
- #20 File rows are 24.9px. The rename outline was already in place. A folder menu still has no Make a copy. A file menu still has no Open version history, Open in default app, or Show in system explorer.
- #22 Settings stays a modal. The title is `R27t Plain - Sample Vault - Grove`. `scripts/test-r27e.mjs`, inside `npm test`, already checks that Escape returns to the note and that Back restores the caret.
- #24 The hover preview already has the embed's top-right Open link icon, and a click opens the note. A short preview already shrinks beneath 250px and keeps the note title. Those checks passed in `scripts/test-round19.mjs` and the hover scripts. The exact Ideas box of 452×220 was not remeasured this round.
- Collapse all starts as Expand all, opens `Projects/Project roadmap.md`, and the label becomes Collapse all. The next click restores Expand all.
- The vault switcher shows Sample Vault and offers Manage vaults.
- The status bar on this note read `1 backlink | 4 words | 33 characters`. Properties stay hidden when the note has no frontmatter. Sync stays out.

- `npm run build`: passed (`tsc --noEmit` and the Vite production build).
- `npm test`: passed. Vitest was 52 files and 298 tests. The browser scripts ran through `scripts/test-r27t.mjs`. `npm run test:geometry` is inside that script and passed. The first full run stopped in `scripts/test-r27r.mjs` because the footer bold was still expected to be only `#`, `^`, and `|`. That assertion now matches the Obsidian command, and the rerun passed.
- `npm run audit:offline`: passed, 162 source files.

The screenshot fixtures `npm test` rewrites are restored and are not part of this change. Rust was not changed, so cargo was not run.

## Bases bugs for Codex

None found. Bases files were not edited and were not part of this hunt.

## Left out

Bookmarks stay a path list. Rename and drag-to-reorder need a title and an order. That is a later change.

Keychain, Community plugins, and the account pages stay out. Settings stays a modal.

Deleting several files still asks once. Obsidian asks once per file.

A folder's menu has no Make a copy. Copying a folder is a separate operation from copying a note.

Open version history, Open in default app, and Show in system explorer need a local opener. They are omitted on the file menu.

The empty heading popup is 79.1px tall against Obsidian's 78.1. The delete-dialog gap is 62.8px against about 64.5, and the dialog height is 201.5 against 201.3. Both sit inside the test bands.

No production file exceeds 800 lines. `wikilinkComplete.ts` is 243. `sidebar.ts` and `pane.ts` were left alone. No new dependencies.

## Line counts

Net lines in this round, production code only. The notes file is not included.

- TS: **+18**.
- CSS: **+40**.
- RS: **0**.

The new browser script is 202 lines. `package.json` adds `scripts/test-r27t.mjs` at the end of `test`, after `scripts/test-r27s.mjs`.

## Next

- Give a folder "Make a copy" once a folder copy has a name and a contents rule.
- Add Open version history, Open in default app, and Show in system explorer once a local opener exists.
- Let bookmarks be renamed and reordered by dragging.
