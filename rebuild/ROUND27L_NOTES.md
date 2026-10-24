# Round 27l

Explorer spacing, ribbon and sidebar chrome, property key and datetime icons, and backlinks for a newly created note. No canvas files. Nothing was pushed.

## What changed

File and folder rows stay 24.89px tall. Each one now has a 2px bottom margin, so the next row starts 26.89px down. The margin is only on the file explorer's `.tree-item-self`, not on bookmarks and not on anything inside `.cm-content`. Labels stay at 36px, then 53px, then 70px.

The file explorer header is the 40px row under the sidebar tabs. Its buttons are 28×24 with 16px icons, starting 8px down. Other nav headers stay short.

The left ribbon is 44px. Its actions are 28×24 with 16px icons, starting 8px under the tab row. The sidebar toggle is still the full header control. A fresh vault's left dock is 300px (`--sidebar-width`). The right dock still defaults to 260px and still starts collapsed. Sidebar tab buttons are 28×25 around a 16px icon, with 3px between them. The vault name uses a 1.3 line height, so the profile footer is 41.89px.

A property key icon sits 4px inside its 20px box, so the label still starts 20px into the row. The in-note key box is 124×28. The row stays 29px. A date value still has the calendar on the left. A datetime value does not. The hidden native picker target still opens the clock.

Creating a note (a copy, a daily note from a template, a note opened from a missing link) now marks the file written. The link index refreshes a second later, the same way a save does. Before this, those links never appeared in backlinks until some other save or rename.

## How it was checked

Obsidian 1.14, headless, scratch vault, loopback only, public DOM only, 1280×800. Launched with `electron43` under `unshare -Urn`, a scratch `HOME`, and empty `DISPLAY` and `WAYLAND_DISPLAY`. The `obsidian` wrapper was not used. Chris's vaults were not opened.

On that fresh vault the file rows were 24.89px with a 2px bottom margin, the explorer header was 40px with 28×24 buttons 8px down, the ribbon was 44px with 28×24 actions under the tab row, and the left dock was 300px. The right dock was collapsed. A plain callout (`[!note]`) is not collapsible; a `[!tip]-` callout is, and it starts collapsed. ArrowDown in the search field does not move a result selection. The command list has Move line up/down, Fold all, Indent, and Toggle bold, italic, and checkbox. It has no Duplicate line command. An active tab's menu includes Bookmark..., Open version history, Open in default app, and Show in system explorer.

From `rebuild/app`, headless Chromium and Vite, real pointer and key input, scratch vault only. No window was opened on the real screen.

- `npm run build`
- `npm test`: browser discovery, vitest (47 files, 273 tests), geometry in Live Preview, Source, and Reading, and the browser scripts through `scripts/test-r27l.mjs`. All passed.
- `scripts/test-r27l.mjs` checks the row pitch, label indent, explorer header, ribbon, 300px dock, sidebar tab, footer, key icon and 124×28 label, datetime without a value icon, two clicks without moving in Live Preview, Source, and Reading, and a created note's link showing in backlinks and opening with a real click.
- `npm run audit:offline`: passed, 144 source files.

The same headless Grove session also checked search collapse and highlight, an outline click landing on the heading, unlinked mentions opening from a collapsed section, `[[` file ranking, `[[note#` headings, Enter accepting a heading, tab drag reorder, and Reading view callouts, tables, and embeds.

The screenshot and canvas fixtures `npm test` rewrites were restored and are not part of this change. Rust was not changed, so cargo was not run.

## Left out

The link suggester still offers file names, headings, and blocks. It does not offer aliases. That needs the property index on each keystroke and the `[[note|alias]]` insertion Obsidian uses. It is larger than this fix.

One file's menu item is still "Bookmark" and bookmarks at once. Obsidian's item is "Bookmark..." and opens a dialog. The tab menu also has no Open version history, Open in default app, or Show in system explorer. The empty tab has no New base. The status bar has no sync item.

The in-note date still uses the 16px calendar glyph from round 27k. The file-properties date row stays taller than the in-note row when the link wraps, for the same reason as 27k. The right sidebar was not widened.

No production file exceeds 800 lines. No new dependencies.

## Line counts

Net lines in this round, production code only. The notes file is not included.

- TS: **+6**.
- CSS: **+33**.
- RS: **0**.

The new browser script is 138 lines. `package.json` is unchanged in length.
