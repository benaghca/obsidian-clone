# Round 27h

Bugs in the canvas explorer drop, the note-card title, dropped attachment names, and datetime properties. No sidebar, tree-select, file-tree CSS, or empty new-tab edits. Nothing was pushed.

## Bugs

Fixed:

- A multi-selection dragged from the explorer onto a canvas added only the pressed file. The drag event already knew the selected paths and now sends them, in tree order. Folders add no card. Two or more files become one undo: a single row of 400×400 cards (images and other files included), 45px apart, the first card's top-left on the pointer. One remaining file still uses the existing insert, so a lone image keeps its aspect ratio. Escape, a drop outside the board, and a read-only canvas add nothing.
- The first heading under a canvas note title was no longer `:first-child`, so reading-mode's 16px heading margin replaced the title's half-em gap. The heading that follows the title now has no top margin. A later heading still has 16px. The measured gap is 12.94px.
- A dropped file named `image.png` (or the other generic clipboard names) was saved as `Pasted image …`. A drop keeps the file's name. A paste of `image.png` is still stamped.
- A datetime property with seconds, such as `2026-10-23T20:15:30`, drew a blank field. `datetime-local` defaults to a 60-second step, which rejects that value. The input's step is 1, set before the value.

Checked, and left as they are:

- Add embed and Add tag work in Live Preview. Add alias in Reading view focuses the aliases field. The backlinks tab stays on the note it was opened for after another note opens in a new tab.
- A note with frontmatter shows the properties block and the heading in Live Preview and Reading view, and the raw fence in Source mode. On a canvas card the fence is stripped and the title is the file name.
- `write_file_bytes` already stays inside the vault. Rust was not changed.
- The drag ghost still says "N items". Round 27b chose that, and the explorer files belong to the other builder.

## How it was checked

Obsidian 1.14, headless, scratch vault, loopback only, public DOM only. A seven-file explorer drop is one row of 400×400 cards, including an SVG and a canvas file, stride 445, tree order, first card at the drop point. The title-to-heading gap is 12.94px. Obsidian's ghost says "N files".

From `rebuild/app`, headless Chromium and Vite, real pointer and key input, scratch vault only. Chris's vaults were not opened.

- `npm run build`
- `npm test`: browser discovery, vitest (47 files, 269 tests), and the browser scripts through `scripts/test-r27h.mjs`. All passed.
- `scripts/test-r27h.mjs` ctrl-clicks a folder and three files, drags one selected row onto the canvas, and checks tree order, the 400×400 row, one undo and redo, Escape, an outside drop, read-only, and a folder-plus-image drop that stays 400×200. It measures the title gap, checks the frontmatter note in Live Preview, Source, and Reading view, drops `image.png` after moving the pointer, and runs Add embed, Add tag, Add alias, and the pinned backlinks tab.
- `npm run audit:offline`: passed, 142 source files.

The screenshot and canvas fixtures `npm test` rewrites were restored and are not part of this change. A headless browser cannot drag a real OS file, so the `image.png` case moves the pointer and then drops a `DataTransfer`, the same way round 27d does. Rust was not changed, so cargo was not run.

## Left out

Canvas note cards still do not show the properties block Obsidian draws under the title. Round 27 left note editing on the board for later.

`src/shell/sidebar.ts`, `src/shell/treeSelect.ts`, `src/styles/fileTree.css`, and the empty new-tab page were not edited.

No production file exceeds 800 lines.

## Line counts

Net lines in this round. The notes file is not included.

- TS: **+25** (production +23, test +2).
- CSS: **+2**.
- RS: **0**.
- The new browser script is 218 lines. `package.json` is unchanged in length.

## Suggestions

1. Draw the properties block on a canvas note card under the title, as Obsidian does. The card currently shows only the file name and the body.
2. Explorer multi-select still has no keyboard range and no drag rectangle. Round 27b left both out.
3. Edge hit strokes are canvas pixels, so they shrink when the board is zoomed out. Round 27 already noted this.
