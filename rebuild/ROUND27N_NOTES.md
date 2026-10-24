# Round 27n

Leftovers from the 27m side-by-side, then the outline, backlinks, and search behavior that was still short of Obsidian. No canvas files and no Bases files. Nothing was pushed.

## What changed

A date value draws an 11×12 calendar with a solid top bar, at the value's x+7.5. In the light theme the glyph is `#7e7e7e` (rgb 126, 126, 126) with a 1.6px stroke, so the bar stays visible at that size. The dark theme keeps `--text-faint`. The hidden native picker target still covers the icon.

Menu items use a 1.3 line-height, so a 13px row with 4px 8px padding is 24.9px tall. A separator's margin is 3px, which leaves 7px between the items around it. Menu padding stays 6px.

The right dock defaults to 300px, in the CSS fallback and in layout prefs. The light theme's sidebar tab row uses `#e4e4e4` for its 1px bottom line. The shared border token stays `#e0e0e0`, and the dark theme stays on that token.

In file properties, a date value does not wrap, and the field is 103px wide, the width measured on Obsidian's file-properties date in a 300px sidebar. The in-note date stays 116px. A measured file-properties row was 30px next to the 29px in-note row.

Backlink section headers show no chevron. The header still folds the section, and the count stays at the right. A one-line mention row is 48px, with 14px of vertical padding. Hover and the keyboard selection use `--background-modifier-active-hover`, the accent tint. The Link button is 25px tall. A Collapse results button at the top of the pane folds every result group, then reads Expand results. The toolbar sticks to the top of the pane.

Search has the same Collapse results button beside the existing sort menu. In search and in backlinks, ArrowDown and ArrowUp move a highlight through the visible matches, and Enter opens the highlighted one. ArrowDown with nothing highlighted selects the first visible match. ArrowUp selects the last. An open menu keeps those keys.

The outline lists the open note's headings. A filter hides rows whose text does not contain it, and while a query is set the chevrons stay hidden. A heading with children folds them. Collapse all folds every such heading, and the button swaps to Expand all. The heading at the top of the note stays highlighted, and the list scrolls to keep that row in view. Clicking a heading jumps the editor there. The note scrolls in `.view-content` (`.cm-scroller` is `overflow: visible`), and the highlight follows the line at that scroller's top edge. The parser treats a frontmatter's closing `---` as a setext underline, so the outline drops headings that start inside the frontmatter. `headingsFromTree` is unchanged.

## How it was checked

The glyph, menu pitch, separator gap, mention row, Link button, and header chevrons follow the round brief's 27m measurements at 1280×800. The 300px right dock is that brief's figure and round 27k's measurement of Obsidian's file-properties sidebar on a scratch vault. This round did not launch Obsidian again.

From `rebuild/app`, headless Chromium and Vite, real pointer input, scratch vault only, viewport 1280×800. No window was opened on the real screen.

`scripts/test-r27n.mjs` checks the 11×12 glyph, its grey, and its ink; two unmoved clicks in Live Preview, Source, and Reading; a 24.9px menu item and a 7px separator gap; a 300px right dock; backlink headers, counts, a 48px row, the accent hover, and a 25px Link button; Collapse results; ArrowDown, ArrowUp, and Enter in search; the outline highlight, nested fold, Collapse all, Expand all, and filter; a wheel on the editor that follows to the next heading; a click that jumps back; and the file-properties date row staying on one line (30px beside the 29px in-note row).

- `npm run build`
- `npm test`: browser discovery, vitest (47 files, 274 tests), geometry in Live Preview, Source, and Reading, and the browser scripts through `scripts/test-r27n.mjs`. All passed.
- `npm run audit:offline`: passed, 146 source files.

The screenshot and canvas fixtures `npm test` rewrites are restored and are not part of this change. Rust was not changed, so cargo was not run.

## Left out

Show more context needs the lines around a hit. Search already stores a few matching lines, and backlinks store the mention line. Drawing the surrounding lines, and the hover chevron Obsidian puts on a row, is more than a small fix, so it is not started.

Backlinks have no sort menu and no search filter. Search already has its sort menu. Explain search terms is not added.

Alias suggestions in the `[[` suggester are not added. `linkCandidates()` is synchronous and does not read frontmatter, and the property index is async, so offering aliases and inserting `[[note|alias]]` is not a small change.

Also left as they were: the Bookmark dialog, Open version history, Open in default app, Show in system explorer, New base on the empty tab, hotkey conflict pills, and the status-bar sync item.

No production file exceeds 800 lines. No new dependencies.

## Line counts

Net lines in this round, production code only. The notes file is not included.

- TS: **+182**.
- CSS: **+98**.
- RS: **0**.

The new browser script is 320 lines. `package.json` gained the `test-r27n.mjs` step. `scripts/test-r27m.mjs` now expects the readable glyph grey and the light tab-row line.
