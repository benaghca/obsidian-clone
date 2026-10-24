# Round 27e

Empty new-tab page, and the leftover keyboard and focus behaviour. No canvas files, no sidebar, no status bar. Nothing was pushed.

## What changed

Ctrl+T and the tab strip's + button open an empty tab at the end of the strip. The page is a centred column of pills: New note (Ctrl + N), New canvas, Go to file (Ctrl + O), Close. There is no "No file is open" heading and no New base. New note and New canvas fill that empty tab. Close removes it and shows the neighbour. The pills use padding, a fully rounded border, and the muted text colour. They do not animate.

Opening a file in a new tab still lands immediately after the current tab. That is the existing `addTab` default, and it is what Obsidian does for Open in new tab, Ctrl+click, and Ctrl+Enter on a link. Only the New tab command appends.

Esc from Settings returns focus to the note and keeps the selection. The search field still clears itself first when it has text. The window title is `Note - vault - Grove` (`document.title`, and `getCurrentWindow().setTitle` when the Tauri window API is present). An empty tab is "New tab - vault - Grove".

Ctrl+Enter on a line that is not a link does nothing. On a wikilink it still opens that note in the next tab. Alt+Up and Alt+Down no longer move the line, in the note and in a table cell. Shift+Alt still copies a line, and Move line up / Move line down stay in the command palette without a default hotkey.

Pasting a URL over a selection wraps it as `[word](url)` and selects the whole link. A bare URL still leaves the caret after the address. Ctrl+Shift+V still inserts the plain URL. Typing while the link is selected replaces it.

Back (Ctrl+Alt+Left) restores the caret that was left on that history entry, including a selection. Forward does the same. Leaving a note, opening it again at a different place, and going Back twice returns to the earlier caret rather than the later one. The carets sit beside the existing path history and are not written into the saved layout. Deleting a file drops its history entry and the caret that belonged to it.

## How it was checked

From `rebuild/app`, headless only (Vite + headless Chromium, real pointer and key input). No windows on the real screen. Scratch paths under `/tmp` only. Chris's vaults were not opened.

- `npx tsc --noEmit`
- `npm test` ran browser discovery, vitest (259 tests), geometry in Live Preview, Source, and Reading (including the frontmatter note), and the browser scripts through `test-paste.mjs`. That run stopped in `test-round21b.mjs`, which still expected the caret after a pasted link. The assertion now expects the whole link selected.
- `node scripts/test-round21b.mjs` passed after that update (live, source, and reading).
- The scripts from `test-r21-bugs.mjs` through `test-r27e.mjs` then passed, including the explorer drag script and `scripts/test-r27e.mjs`.
- `npm run audit:offline` passed, 140 source files.
- No Rust was changed, so cargo tests were not run.

Net change against the branch tip, including this file: +544 / −54 lines. `scripts/test-r27e.mjs` is 293 of those. Every touched source file stays under 800 lines.

## Left out

The pill size was not measured against a live Obsidian window. The buttons are 15px muted text, 1px border, 6px 16px padding, 8px apart, fully rounded.

History carets are kept for the session only. A restored layout still stores back/forward as path strings, so Back after a reload opens the note without the caret from the earlier visit.

Jumps inside one visit (a heading in the note already on screen) do not add a history entry. Back restores the caret from when the note was left.

`setTitle` is called only when Grove is running inside Tauri. The headless browser has no Tauri window, so that call was not exercised.

Shift+Alt+Up/Down still copies the line. Ctrl+Alt+Up/Down still adds a cursor.
