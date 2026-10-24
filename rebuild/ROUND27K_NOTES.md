# Round 27k

In-note date width, property row height, and explorer indent. No canvas files. Nothing was pushed.

## What changed

A date value in a note is 116px wide. Padding stays `4px 0 4px 24px` and the field still uses `flex: 0 1 auto`. `field-sizing: fixed` replaces Chromium's 132px content minimum. The daily-note link sits on the field's right edge (the 4px flex gap is cancelled by the link's existing -4px margin), so the link moves left with the field. Arrow keys still edit the date, and a real click on the calendar still focuses the input. File properties keeps `field-sizing: content`, so that date stays 101px in the narrow column. A datetime value still fills the note column (560px) and keeps seconds.

Date and datetime inputs are 29px tall, the same as the key, so those rows are 29px instead of 31px. Text and tag rows were already 29px. Body lines stay on the editor's layout. Nothing adds a vertical margin to a `.cm-content` child.

The file list's padding is `4px 12px 24px`. File and folder rows use `8px + depth * 17px + 16px` of left padding, so labels start at 36px, then 53px, then 70px. Rows stay 24.89px. The chevron stays at 16px from the list on a root folder and 33px one level down. Bookmarks keep `4px 8px 16px`.

Date text is `rgb(34, 34, 34)` at weight 400 and 14px, the same as Obsidian. The value calendar is a 16px muted glyph in the 24px left padding. Side-by-side clips did not show a clear size or colour difference, so it was left.

## How it was checked

Obsidian 1.14, headless, scratch vault, loopback only, public DOM only, 1280×800. In this environment the in-note date input measured 108px, because the interface font names did not resolve (the same figure as round 27j). The task's side-by-side figure is 116px, and that is the width the note field uses. The link starts at the field's right edge in both. File properties measured the date at 103×28px in a 29px row, inside a 300px sidebar. Explorer labels were at 36, 53, and 70px, rows 24.89px, list padding `4px 12px 24px`. The chevron glyph is 10px there and 14px here. Text and icon positions already match, so the glyph size was left. A file menu, a "daily" command-palette query, and the status bar were compared the same way.

From `rebuild/app`, headless Chromium and Vite, real pointer and key input, scratch vault only. Chris's vaults were not opened. No window was opened on the real screen.

- `npm run build`
- `npm test`: browser discovery, vitest (47 files, 273 tests), geometry in Live Preview, Source, and Reading, and the browser scripts through `scripts/test-r27k.mjs`. All passed.
- `scripts/test-r27k.mjs` checks the 116px date and the link beside it, 29px rows, the datetime value with seconds, the calendar click, an arrow-key edit, the file-properties date near 101px, explorer positions through a nested folder, bookmark padding, and two clicks without moving on a frontmatter note in Live Preview, Source, and Reading.
- `npm run audit:offline`: passed, 144 source files.

The screenshot and canvas fixtures `npm test` rewrites were restored and are not part of this change. Rust was not changed, so cargo was not run.

## Left out

The file-properties date row stays taller than 29px. The daily-note link wraps under the field. The right sidebar defaults to 260px, so the value column is about 101px. Obsidian's sidebar was 300px, and a 103px date shares the 29px row with the link. Widening the sidebar, or shrinking the date to make room, would miss the 101–103px width. The input itself is 29px.

One file's menu item is still "Bookmark" and bookmarks at once. Obsidian's item is "Bookmark..." and opens a dialog. The menu also has no Open version history, Open in default app, or Show in system explorer. The empty tab has no New base. The status bar has no sync item. "daily" in the command palette and "wel" in the quick switcher already matched Obsidian's top hit and highlight. Canvas source and canvas CSS were not touched.

No production file exceeds 800 lines.

## Line counts

Net lines in this round. The notes file is not included.

- TS: **0**.
- CSS: **+21**.
- RS: **0**.

The new browser script is 161 lines. `package.json` is unchanged in length.
