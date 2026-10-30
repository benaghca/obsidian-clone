VERDICT: OK

Review of Claude's Bases B6 on `rebuild/b6-review-grok`, created from `rebuild/bases-b6-claude` (`5ebb7c8`, still there). Parent is integration `98f932f`. No product code was changed. Nothing was pushed.

B6 is the toolbar Search box and the header items "Edit property..." and "Property type". That is plan item 6 and task B6. The diff against `98f932f` is 10 files, +702 / −31, including `NOTES_B6.md`. The feature commit is `3db2a7a`. `search.ts` and `writeTop` in `write.ts` are outside the file list in §8; they are the matcher and the display-name writer, and they stay inside the feature. No extra feature was added.

## Scope

Search sits between Properties and New, which is toolbar order D1. Typing narrows the rows the view already shows (after the limit), in tables, grouped tables, cards, and an embedded ` ```base ` block. The query is not saved and is not written. The browser test records no `writeNote` and no settings write while searching, and the `.base` and the host note stay byte-identical.

"Edit property..." writes only `properties.<id>.displayName`, under the id the file already uses, or `note.<name>` when it has none. Other keys in that entry stay. An empty name removes the entry, and removing the last one removes the block, which the unit test and the browser test both check against the original bytes. Escape restores the field and writes nothing.

"Property type" is `typeItems` from the Properties block. It calls `settings.setPropertyType`, which writes `.grove/types.json` only. File and formula columns stay disabled. The base redraws when `types.json` changes.

The two side fixes are right, and editing still works:

- A focus move rebuilds only when focus leaves a cell field. Clicking Search, Sort, or Filter no longer rebuilds. The full Bases browser scripts (cells, columns, menus, results, config, cards, embeds, B0) passed.
- `writeTop` replaces a top-level `filters:` or `properties:` that begins with a BOM, and keeps the BOM, instead of adding a second block. A unit test covers BOM and CRLF.

Search matches every word, ignoring case, in the text of the shown columns (and the card title). A word cannot span two values. Checkboxes, empty cells, and formula errors contribute no text. That matches the plan: plain text on the visible cells, not the search engine. Summaries, group headings, and Copy / Export CSV follow the rows on screen. That is what filtering `drawn` does. It stays unless Chris's Obsidian sums the unsearched rows.

"Edit property..." is the column display name, not a rename of the property in every note, and not a formula editor. That matches `properties.<id>.displayName`, which `model.label()` already reads. Chris can still confirm it against Obsidian. I would not switch it to `rewriteEverywhere` without that.

## Speed

Re-measured on this machine. No regression against `NOTES_B6.md` or the integration column in that file.

Search bench, `node scripts/bench-bases-search.mjs 5000,50000`. Only keys that change the rows are counted (4 of 14). No long task. Worst frame 16.8 ms in every view.

| Rows / view | Work, median (max) | Frames to paint | Key to paint, median (max) | Claude's work / frames / upper |
|---|---|---|---|---|
| 5,000 table | 6.2 (11.7) ms | 1, 1, 1, 1 | 22.8 (33.0) ms | 6.1 (11.4); 1×4; 24.2 (32.5) |
| 5,000 grouped | 7.5 (10.0) ms | 2, 1, 2, 2 | 23.3 (28.6) ms | 8.7 (10.3); 2, 1, 2, 2; 25.2 (26.2) |
| 5,000 cards | 1.7 (3.0) ms | 1, 1, 1, 1 | 13.7 (19.5) ms | 1.6 (3.0); 1×4; 17.1 (19.4) |
| 50,000 table | 8.1 (8.3) ms | 1, 1, 1, 1 | 26.0 (27.5) ms | 11.8 (17.4); 2, 1, 2, 1; 26.5 (31.6) |
| 50,000 grouped | 52.3 (55.7) ms | 4, 2, 5, 4 | 68.3 (71.9) ms | 53.3 (55.4); 4, 2, 5, 4; 69.1 (71.3) |
| 50,000 cards | 6.0 (17.2) ms | 3, 1, 1, 1 | 22.2 (35.6) ms | 6.2 (18.2); 2, 1, 1, 1; 21.8 (34.9) |

One 50,000-card key took 3 frames instead of Claude's 2. The work on that key was 17.2 ms, inside Claude's 18.2 ms max, and the frame cap held. Same case: a key that changes tens of thousands of rows.

Existing benches, this run versus Claude's before (integration `98f932f`) and after:

| Measure | Integration | Claude after | This review |
|---|---|---|---|
| Warm 1,000-note open | 9.5 ms | 9.4 ms | 8.3 ms |
| 1,000-row scroll | 16.8 ms | 16.8 ms | 16.8 ms |
| 5,000-row B0 cold | 44.4 ms | 42.2 ms | 41.1 ms |
| 5,000-row B0 warm | 18.3 / 11.7 / 13.3 ms | 19.2 / 11.9 / 23.7 ms | 19.2 / 11.8 / 14.2 ms |
| B0 typing frame; rebuilds during / after | 16.8 ms; 0 / 1 | 16.8 ms; 0 / 1 | 16.8 ms; 0 / 1 |
| 1,000 grouped cards scroll | 16.7 ms | 16.8 ms | 16.8 ms |
| 1,000-card grid scroll | 17.4 ms | 17.3 ms | 16.8 ms |
| Embed cold / warm | 23.2 / 6.7–7.2 ms | 22.4 / 6.3–6.6 ms | 23.7 / 7.0, 6.6, 7.4 ms |
| Embed paging scroll | 16.8 ms | 16.7 ms | 16.7 ms |

The 23.7 ms B0 warm sample did not recur. These three warms sit with the integration samples (11.7–18.3 ms) and Claude's first after sample (19.2 ms). That outlier was noise.

`bench-bases-groups` on `/tmp/grove-bases-b5-claude-review/vault` (current model, the "after" column): 5k select tag / formula 8.4 / 9.1 ms (Claude 8.0 / 8.6). 50k select 96.0 / 167.7 ms (Claude 94.6 / 163.6). 50k first aggregation wall 195 ms, max slice 5.05 ms (Claude 218 ms, 5.31 ms). Browser 50k max frame 16.8 ms for both variants. `bench-frontend` 5,000: tags median 10.4 ms, `garden` median 12.2 ms (Claude 10.8 / 12.1). Same bytes as before on the link refresh (639,766 bytes, 3,946 outgoing notes, median 40.4 ms).

## The 50,000-row grouped lag

It is still there: about 52–56 ms of work and 4–5 frames, key to paint about 68–72 ms, when a grouped result changes. Frames themselves stay at 16.8 ms, and nothing blocks the key. At 5,000 notes the grouped work is 7.5–10 ms, inside the plan's extra 20 ms for group and summaries. The second frame is `groups.ts` yielding once above 200 rows, then regrouping and resummarising.

That 50,000-row lag should be a follow-up in `groups.ts`, for whoever next changes grouping: filter the groups already built instead of building them again. It is not B7. B7 is the Rust pre-filter of the base expression, before `select`. This run still sees that select at about 96 ms (tag) and 168 ms (formula) for 50,000 rows, and about 108 ms in the browser. Search runs after `select` and does not add to it. Codex owns B7 in the plan. B6 was right to leave `groups.ts` alone.

## Checks

No Obsidian page was fetched. Behaviour is the plan (D1, §3 item 6, §5's plain-text search, §8 B6) and the rules already in the code. Claude's notes also cite the public "Bases syntax" and "Views" pages from memory. No Obsidian code or assets were used.

Full checks, first run, no retry. `test-canvas-groups.mjs` did not flake this time.

- `npm run build`: passed. The existing Vite large-chunk warning remains.
- `npm run audit:offline`: passed, 175 source files, dist, CSP, capabilities, dependencies.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0. Vitest 67 files / 1,110 tests. Geometry, browser, and posttest passed, including `test-bases-search.mjs` (46 keys, max 17.3 ms through the driver; header menu, Display name, and Property type on frame 1). 300-card drag max 16.8 ms. No assertion was weakened.
- `cargo build --offline` and `cargo test --offline` from `src-tauri`: 58 passed, 0 failed, 2 ignored. Registry not contacted.

`rebuild/bases-b6-claude` is still `5ebb7c8`. Integration is still `98f932f`.
