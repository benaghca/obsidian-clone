# Round 27b

Dragging a file from the explorer into an open note, and multi-select in the file explorer. No canvas files. The single-item drag payload is unchanged. Nothing was pushed.

## What changed

Dropping a file from the file explorer into Live Preview or Source mode inserts an internal link at the caret. The caret follows the pointer while the drag is over the editor. Notes use the same formatter as the link suggester (`[[Note]]`, or a longer path when the name is not unique). Images and other non-markdown files are embeds (`![[photo.png]]`). Several selected files insert one link per line, in the order they appear in the tree. A folder inserts nothing. Reading view ignores the drop, and an editor drop does not also move the file.

Ctrl or Cmd-click toggles a file or folder in the selection without opening or expanding it. Shift-click selects the inclusive visible range. Selected rows use the accent tint (`--background-modifier-active-hover`), which stays visible over hover and is distinct from the open file's hover tint. Escape, or a plain click, clears the selection. A plain click still opens the note or toggles the folder.

Dragging a row that is part of a multi-selection moves every selected item onto the folder under the pointer. Children of a selected folder are not moved on their own; they go with the folder, through the existing `moveFile` path (numbered names and link updates included). The ghost title is `3 items` when three items are dragged. The pressed row is still the only `.is-being-dragged` row, and it keeps its `data-path`. A drag that is not part of a multi-selection still shows the note or folder name and the same `Move into “…”` line.

The right-click menu on a multi-selection is `Move N items to...` and `Delete`. Move reuses the folder prompt and then `moveFile` for each top-level path. Delete asks once, then deletes with the existing confirmed delete. A right-click on a row that is not in the selection still opens that row's own menu. Menus and prompts still open with no animation.

## How it was checked

From `rebuild/app`, headless only (Vite + headless Chromium, real pointer and key input). No windows on the real screen. The browser suite uses the in-memory sample vault. Chris's vaults were not opened.

- `npx tsc --noEmit` (also as part of `npm run audit:offline`'s build)
- `npm test`: browser discovery, vitest (254, including `treeSelect` and `treeDrag`), geometry, the existing browser scripts, the explorer drag script, `scripts/test-r27a.mjs`, and `scripts/test-r27b.mjs`. All passed.
- `scripts/test-r27b.mjs` uses CDP mouse and key input. It moves the pointer across rows, clicks twice without moving, and covers Live Preview, Source, and Reading on notes with frontmatter. It checks the link text, the image embed, a folder drop, a three-item move, the `3 items` ghost, the single-item ghost payload, and the move and delete menu.
- `npm run audit:offline`: passed, 141 source files.
- Rust was not changed, so `cargo test` was not run.

The screenshot and canvas fixtures the suite rewrites were restored and are not part of this change.

## Left out

Bookmarks are not multi-selectable. There is no drag-rectangle selection, and the keyboard does not extend the selection.

After a move, the selection is dropped because the old paths are gone. It is not retargeted at the new paths.

The link is inserted exactly at the caret, including in the middle of a word or against the frontmatter fence. A multi-file drop does not add an extra blank line first.

Wikilinks off (markdown links) goes through the existing `linkTo` formatter and was not given its own browser case.

The canvas still sees one dragged row. Selected paths were not added to the drag payload.

## Net line change

- TypeScript: +236 (253 insertions, 17 deletions), including `treeSelect.ts` and its unit test
- CSS: +4
- JavaScript: +237 (`scripts/test-r27b.mjs`)
- JSON: 0 (the `npm test` script gained the new file)
- Markdown: +51 (this notes file)

## Suggested next

1. Keep the selection on the paths a move just created. The next delete or drag then applies to those files. Small: `moveFile` would need to report the final path, and the explorer would swap the selected paths.
2. Arrow keys, Shift-arrows, and Delete for the current selection. Mouse selection is in place; the keyboard is the matching half of the explorer. Small to medium.
3. An extra drag field listing every selected path, leaving the current row and ghost fields as they are, so a canvas drop can place every selected note. Small on the explorer. The canvas work is separate.
