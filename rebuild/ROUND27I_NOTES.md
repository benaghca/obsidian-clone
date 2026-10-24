# Round 27i

Selection menu, empty new-tab chips, and the vault name. No canvas files. Nothing was pushed.

## What changed

The multi-select menu's first item is "New folder with selection (N items)". A separator sits immediately after it, then Move, Bookmark..., and Delete. Two selected notes read "(2 items)".

The empty tab is New note, New canvas, then Go to file. There is no New base and no Search. Each shortcut is a grey chip (the hover fill, fully rounded, padding `2px 6px 2px 4px`) placed just after the label. The pills are 168px. Go to file uses the search icon.

The vault footer's action icons are 16px, in 28px buttons, and the switcher padding is `4px 8px`. In a 200px sidebar the name box is 84px. "Sample Vault" at Noto Sans 500 13px is 81.12px, so it is not cut off. A long name still ends in an ellipsis.

## How it was checked

Obsidian 1.14, headless, scratch vault, loopback only, public DOM only. The selection menu is the count, a separator, Move, Bookmark..., a separator, and Delete. The empty-tab chip is one rounded span with that padding and a 0.067 grey fill, sitting after the label. The footer icons are 16px inside 28px buttons, and the switcher padding is `4px 8px`. Shift-click keeps rows that sit outside the new range. Grove already did that.

From `rebuild/app`, headless Chromium and Vite, real pointer and key input, scratch vault only. Chris's vaults were not opened. No window was opened on the real screen.

- `npm run build`
- `npm test`: browser discovery, vitest (47 files, 271 tests), geometry in Live Preview, Source, and Reading, and the browser scripts through `scripts/test-r27i.mjs`. All passed.
- `scripts/test-r27i.mjs` checks the count and the separator, clicks twice without moving on a frontmatter note in Live Preview, Source, and Reading, checks the chip sits 8px after "New note" inside a 168px pill, and checks the 81.12px name against the 84px box.
- `npm run audit:offline`: passed, 142 source files.

The screenshot and canvas fixtures `npm test` rewrites were restored and are not part of this change. Rust was not changed, so cargo was not run.

## Left out

A fresh Obsidian empty leaf showed New note, New base, and New canvas. Go to file is here because this round asks for it. The chip text is `Ctrl + N`, without the leading space in Obsidian's text node. Bookmark... still bookmarks at once. Collapse all, the status bar, attachment paste and drop, and the Alt/Shift gestures were re-run in the existing scripts and left as they are. Canvas source and canvas CSS were not touched.

No production file exceeds 800 lines.

## Line counts

Net lines in this round. The notes file is not included.

- TS: **+1**.
- CSS: **+7**.
- RS: **0**.

The new browser script is 136 lines. `package.json` is unchanged in length.
