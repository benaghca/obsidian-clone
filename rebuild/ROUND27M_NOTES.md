# Round 27m

Date and datetime chrome, the left sidebar tab line, a Link button on unlinked mentions, and Move to new window on an inactive tab. No canvas files. Nothing was pushed.

## What changed

A date value and a datetime value both keep a calendar on the left. The glyph is 11×12, light grey (`--text-faint`), and sits at the value's x+7.5. The datetime input's padding is 4px 8px 4px 24px, so the text lines up with a date. The hidden native picker target still covers that icon and still opens the clock. The `/`, `,`, and `:` separators inside both fields use the faint text colour. Chromium reports the input's own colour for `::-webkit-datetime-edit-text`, so the check is the painted pixels: separator columns stay faint and the digits stay dark.

The left sidebar tab row has a 1px bottom border. The ribbon starts under that 40px row (0,40, 44×760). The sidebar toggle is 44×39 in the row above. Ribbon actions still start at y=48. The border uses the existing border token, rgb(224, 224, 224).

Unlinked mentions are one row per occurrence. Hovering a row shows Link. A real click wraps only that occurrence with the usual link formatter (`[[Dates]]` when the word is the note's name) and leaves the other words on the line alone. The open note stays put. The other note is patched through its editor when it is loaded, and on disk otherwise.

An inactive file tab's menu is Close, Close others, Close tabs after, Close all, Pin, Link with tab..., then Move to new window. Choosing it moves that tab. The active tab's menu is unchanged.

## How it was checked

Obsidian 1.14, headless, scratch vault, loopback only, public DOM only, 1280×800. Launched with `electron43` under `unshare -Urn`, a scratch `HOME`, and empty `DISPLAY` and `WAYLAND_DISPLAY`. The `obsidian` wrapper was not used. Chris's vaults were not opened.

On that vault the left tab header was (44,0, 300×40) with a 1px bottom line, the ribbon was (0,40, 44×760), and the toggle was 44×39. A datetime value's padding was 4px 8px 4px 24px. An unlinked mention row carried a Link button; clicking the second "Dates" in `See Dates and Dates on one line.` wrote `See Dates and [[Dates]] on one line.` The inactive tab menu ended with Move to new window, and its close item reads Close tabs after. Toggle checkbox status is Mod+L. Open link under cursor in a new tab is Mod+Enter. Move line, fold all, unfold all, and indent list have no default hotkey.

From `rebuild/app`, headless Chromium and Vite, real pointer input, scratch vault only. No window was opened on the real screen.

- `npm run build`
- `npm test`: browser discovery, vitest (47 files, 273 tests), geometry in Live Preview, Source, and Reading, and the browser scripts through `scripts/test-r27m.mjs`. All passed.
- `scripts/test-r27m.mjs` checks the 11×12 faint glyph, datetime padding, separator pixels, the tab-row line, the ribbon and 44×39 toggle, a click on the datetime glyph, two unmoved clicks in Live Preview, Source, and Reading, one Link click wrapping only the second mention, and Move to new window on an inactive tab.
- `npm run audit:offline`: passed, 144 source files.

The screenshot and canvas fixtures `npm test` rewrites were restored and are not part of this change. Rust was not changed, so cargo was not run.

## Left out

The sidebar line stays on `--background-modifier-border` (rgb 224, 224, 224). Obsidian's measured line was rgb(228, 228, 228). The file-properties date row stays taller than the in-note row when the daily-note link wraps. The right dock still defaults to 260px, and the date there stays about 101px wide.

Outline still has no search filter, no auto-scroll to the current heading, no collapse-all, and no nested collapse. Backlinks and search still have no Collapse results, Show more context, or Explain search terms. Search already parses `path:`, `tag:`, `file:`, quotes, and match case, and ArrowDown still does not move a result selection. Hotkey conflict pills were left as they are.

The link suggester still does not offer aliases or insert `[[note|alias]]`. Bookmark still bookmarks at once. The tab menu still has no Open version history, Open in default app, or Show in system explorer. The empty tab has no New base. The status bar has no sync item.

No production file exceeds 800 lines. No new dependencies.

## Line counts

Net lines in this round, production code only. The notes file is not included.

- TS: **+51**.
- CSS: **+73**.
- RS: **0**.

The new browser script is 226 lines. `package.json` gained the `test-r27m.mjs` step.
