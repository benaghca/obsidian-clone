# Round 27j

Date and datetime properties, the daily-note link, empty-tab labels, and explorer row height. No canvas files. Nothing was pushed.

## What changed

A date value is as wide as its text. In the note it measures 132px inside a 560px column. In file properties it measures 101px. Padding is `4px 0 4px 24px`, `flex` is `0 1 auto`, and the input uses `field-sizing: content`. A datetime value fills the column (560px in the note) and still shows seconds (`2026-10-23T20:15:30`). The value icon on both types is a calendar. The property key for a datetime stays a clock. The native picker glyph stays invisible, and a real click on the calendar still focuses the date input. Arrow keys still edit the date.

Date values, including an empty date, have an "Open daily note" link after the field. Datetime values do not. The link opens the daily note for that `YYYY-MM-DD`, or creates it from Settings → Daily notes (folder, format, template). An empty or impossible date does nothing. An existing file is opened and left as it is. `{{date}}` is that day and `{{time}}` is the current clock. Today's daily note command uses the same function.

Empty-tab labels clip. A label that overflows by a pixel or less is given a `min-width` of its text, so "New note" (58.47px of text in a 58px slot) stays whole. A label that overflows by more than a pixel gets `is-ellipsized` and an ellipsis. The pills stay 168px, in the order New note, New canvas, Go to file.

Explorer rows use 4px vertical padding and `line-height: 1.3` at 13px, so a file row is 24.890625px. The collapse icon is centered on the row. Graph section headers keep their own padding and line-height.

## How it was checked

Obsidian 1.14, headless, scratch vault, loopback only, public DOM only. The date input was 108px (`flex: 0 1 auto`, padding `4px 0 4px 24px`). The datetime input filled the note column at 556px and kept seconds; an unconstrained clone was about 201px. File properties measured the date at 103px and the datetime at 141px. Both value icons are calendars. The link (`aria-label` "Open daily note", 14px link icon, about 22×22) follows date values only, including empty dates, and a plain click created `2026-10-23.md`. The link is still there when the daily-notes plugin is off. Explorer rows were 24.890625px (13px, line-height 16.9px, padding `4px 8px 4px 24px`). The status bar was 27px and flush to the corner, with a sync item Grove does not add. Empty-tab pills were about 163px and included New base.

From `rebuild/app`, headless Chromium and Vite, real pointer and key input, scratch vault only. Chris's vaults were not opened. No window was opened on the real screen.

- `npm run build`
- `npm test`: browser discovery, vitest (47 files, 273 tests), geometry in Live Preview, Source, and Reading, and the browser scripts through `scripts/test-r27j.mjs`. All passed.
- `scripts/test-r27j.mjs` checks the 132px date field, the datetime value with seconds, both calendars, the daily-note link (empty no-op, create, reopen without overwrite, folder and template), two clicks without moving on a frontmatter note in Live Preview, Source, and Reading, Alt-click multi-select, the 24.89px explorer row, the 27px status bar, short labels that fit, and a long label that ellipsizes.
- `scripts/test-r27d.mjs` now expects a calendar on the datetime value and a date input under 180px.
- `npm run audit:offline`: passed, 144 source files.

The screenshot and canvas fixtures `npm test` rewrites were restored and are not part of this change. Rust was not changed, so cargo was not run.

## Left out

The prompt described both fields as content-sized, about 116px. Side by side, only the date field is content-sized, so the datetime field stays column-width. The in-note date field is 132px, wider than Obsidian's 108px; the extra width is Chromium's date-input minimum plus the icon padding. Empty-tab pills stay 168px, and there is no New base. The status bar has no sync item. The vault footer was already matched and was left as it is. Bookmark... still bookmarks at once. Explorer indent was left as it is. Canvas source and canvas CSS were not touched.

No production file exceeds 800 lines.

## Line counts

Net lines in this round. The notes file is not included.

- TS: **+52**.
- CSS: **+29**.
- RS: **0**.

The new browser script is 207 lines. `package.json` is unchanged in length.
