# Round 27g

Explorer multi-select, the selection menu, selected-row pills, the empty new-tab page, and the vault footer. No canvas files. Nothing was pushed.

## What changed

Alt-click adds or removes one explorer row. It does not open the file, and it does not toggle a folder. Shift-click adds the inclusive visible range from the anchor and leaves the anchor where it is. Ctrl-click and Cmd-click clear the selection. A file then opens in a new tab. A folder still toggles. Middle-click is unchanged. The drag payload is unchanged.

The multi-select menu starts with "New folder with selection". That makes an Untitled folder in the deepest folder that already holds every top-level item, moves those items in, and then starts the rename. "Bookmark..." is included because bookmarks already exist and are on by default. It bookmarks each top-level path that is not bookmarked yet. Grove bookmarks at once, so there is no dialog. The ellipsis is only that multi-select label. One file still says "Bookmark" or "Remove bookmark".

Selected rows use the 8px radius. While a menu is open, the right-clicked row has a 2px focus outline. The other selected rows do not.

The empty tab's view header reads "New tab". There is no Close pill. The pills are New note (square-pen, Ctrl + N), Go to file (layout-list, Ctrl + O), Search (search, Ctrl + Shift + F), and New canvas (layout-dashboard, no shortcut). Grove has canvas and no bases, so there is no New base. Each shortcut is its own muted span, with no brackets. The column is centred, and the icon and label sit on the left of each pill. A fixed 168px clips "Ctrl + Shift + F", so the pills share the width of the longest one. That measured 183.625px, and the column is at least 168px wide. The installed app assigns these icons differently: layout-list is New base there, and search is Go to file. This follows the list in the task.

The vault switcher's end padding is 7px, one pixel less than before, so "Sample Vault" fits a 200px sidebar. The name measured 81px in an 81px box. A long name still ends in an ellipsis. The vault menu opens at the click. The button is still the toggle, so a second click closes it, and Manage vaults still opens under the button.

## How it was checked

From `rebuild/app`, headless only (Vite and headless Chromium, real pointer and key input). Scratch browser profiles and scratch vaults. Chris's vaults were not opened. No window was opened on the real screen. The installed Obsidian app was not launched. The empty-tab layout and the vault menu were read from that app's installed stylesheet, then measured on Grove.

- `npx tsc --noEmit`, and again inside the production build.
- `npm test`: browser discovery, vitest (267, including the selection gestures), geometry in Live Preview, Source, and Reading on notes with frontmatter, the existing browser scripts, and `scripts/test-r27a.mjs` through `scripts/test-r27g.mjs`. All passed.
- `npm run audit:offline`: passed, 141 source files.
- Rust was not changed, so `cargo test` was not run.

## Left out

Ctrl-click clears a multi-selection before the new tab opens. Shift-click adds the range and does not drop rows outside it. A folder's Ctrl-click toggles the folder. Bookmark... does not open a dialog. The shared pill width is 183.625px, because 168px cut off the Search shortcut. The installed app's empty-tab icons differ from the list this round followed. The drag ghost text is unchanged. Canvas source and canvas CSS were not touched.

## Net

+394 lines, counting this file. The screenshot files the browser tests rewrite were not kept. Every touched file stays under 800 lines.
