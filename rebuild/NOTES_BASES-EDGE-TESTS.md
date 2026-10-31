# Bases edge tests

Branch `rebuild/bases-edge-tests-grok`, from `c9fe49f` (`rebuild/integration`). Nothing was pushed. Product code in `src/` and `src-tauri/` was not changed. `rebuild/app/package.json` was not changed.

## What these tests rely on

The four rules Chris already decided, tested here and not re-opened:

- Renaming a column in a base changes only that base's display name. The note's property key stays, and another base keeps the default label.
- Summaries and CSV follow the Bases toolbar search, on top of the view's filter.
- A file whose name is only `.md` (any case, including inside a folder) is not a note and is not a base row. It stays in the file list.
- Search saves a pending edit before it queries. A Bases cell commits when search takes focus. Vault search calls `editors.flush()` before `searchNotes`.

Everything else follows the current Grove implementation (formula errors, group keys, CSV quoting, the missing-file embed, the virtual table). Obsidian's source and assets were not used. Public Obsidian help pages were not fetched for this pass; these cases pin Grove's behavior, including the comments already in the Bases sources.

Already covered, and not repeated: `1 / 0` inside an expression, a custom summary of `1 / 0`, `formula.self` returning null, CSV comma/quote/newline units, one-base Edit property (Escape and an empty name), group headings and a Count summary following search, host-note and folder rename of an embed, `isNoteFile(".md")`, flush-before-search in `readOrdering.test.ts`, the 1,000-row table scroll, and the 10,000-row list and kanban scrolls.

## Tests added

`rebuild/app/src/bases/edge.test.ts` (vitest, picked up by `vitest run` with no `package.json` change):

- `baseNoteFiles` drops `.md`, `.MD`, `Folder/.md`, `Folder/.MD`, a directory, `readme.markdown`, and `photo.png`. It keeps `a.md` and `Note.MD`. An empty base selects those two as `a` and `Note`.
- Formula columns through `baseModel`. `1 / points` is `#ERROR: Division by zero` when points is 0, and `0.25` when points is 4. `if(points == 0, 0, 1 / points)` is 0. `formula.boom + 1` repeats the error on the zero row and is `1.25` on the other row (the error does not stick). `note.points.lower()` is `#ERROR: Expected text`. A missing formula name is null, with no notice. Text `"10" * 2` is `#ERROR: Expected a number`; `number("10") * 2` is 20; `number("10 apples")` is `#ERROR: Cannot convert value to a number`; `number("")` is null. `"2024-02-29".year` is 2024. `"2024-02-30".year` is `#ERROR: Property year is not available on this value`. A date-typed `2024-03-01` is 2024. `formula.self` and a cycle `a → b → c → a` are null, with notices only for `formula.self` and `formula.a`. Formula names are case-sensitive (`formula.Score` is null). Note keys are not (`note.STATUS` reads `Status`). Fifty-one nested `if`s fail at compile (`Unsupported expression:`) and the column is null. Forty separate formulas chained `+ 1` from `note.n + 1` yield 41, with no notice.
- Filters: `1 / 0` selects nothing; `note.absent == null` selects every row; text `"10"` does not satisfy `note.label > 9`, while `number(note.label) > 9` keeps that row; a checkbox `true` matches `== true` and the text `"true"` does not.
- Sort: numbers `2`, `10`, then a blank last. Text `"2"`, `"10"`, `"10a"` (numeric collation). Date text `2024-02-29`, `2024-03-01`, then `"March"`. `n > 9` keeps the number 10 and drops the text rows.
- Groups: `open`, `Open`, and `OPEN` are three groups. A one-item list `["Open"]` displays as `Open` and is still its own group. Empty text, a missing value, and `[]` share one Empty group, last. Tag lists that differ only by item order are different groups. Grouping `1 / 0` puts the row in Empty and records the error.
- Emoji and length: `"Naïve 🎉".upper()` is `"NAÏVE 🎉"`. A 20,000-character string plus `TAIL` still lowercases. A 100,001-character value is `#ERROR: Formula value is too large`, is not searchable, and groups as Empty. Another column on that row still matches. Search does not match across the skipped value.
- Summaries and CSV of a filtered base, then a search on those rows. Unsearched open rows sum points to 5, and the sum of `1 / points` is an error because the zero row is included. CSV uses the display names `State` and `Boom`, quotes `he said "hi",` plus CR/LF and the emoji, and leaves `#ERROR: Division by zero` unquoted. Search `plain` keeps Alpha only (sum 1, and the formula sum is 1). Search for the emoji keeps the quoted row. A second model without a `properties` block still labels `status` and `formula.boom` with the default names. The note value stays `open`.
- 10,000 rows sorted by `rank` descending finish under 50 ms. The first name is `09999` with rank 9999, and the last rank is 0. On the run that printed per-test times this case took 12 ms. The file later finished in 23 ms.

`rebuild/app/scripts/test-bases-edge.mjs` (headless Chromium, real pointer and key input, scratch mock vault). The bases are filtered with `file.inFolder("Edge")` so the sample notes stay out of the table.

- Divide by zero, a number used as text, an emoji status, and a double-quoted label that becomes a real quote, CR, LF, and emoji all render in the cells.
- The Filtered view (`status == "open"`) sums points to 8 and shows `#ERROR!` in the formula footer. Search `plain` narrows the sums to 1 and exports only that row as `Filtered.csv`. Search `hi` exports the quoted emoji field. `Edge.base` is unchanged.
- Group headings are `open (4)`, `Open (1)`, `done (1)`, `🎉 (1)`, and `Empty (1)`.
- Edit property renames `status` to `State` and `formula.boom` to `Broken` in `Edge.base` only. `Edge/Beta.md` still says `status: done`. `EdgeOther.base` still heads the column `status`.
- Filling Alpha's status with `zedword` and then opening search leaves the note unchanged until search takes focus, then finds the one row. The base file does not contain `zedword`.
- A source-mode insert of `EDGEPENDINGTOKEN` is flushed and written before vault search queries. The result file name is `Pending`.
- `.md`, `Edge/.md`, and `Edge/.MD` are in `vault.files`, absent from `vault.notes`, and absent from the base. After the file explorer is shown again (vault search had replaced it), the root `.md` row carries the tag `md`. `Edge/Pending.md` is a row. The recount is 9 (the eight Edge notes plus Pending).
- Deleting `EdgeHost.md` (a `base` block) drops the embed and the file. Deleting `EdgeFile.base` while `EdgeStay.md` embeds `![[EdgeFile.base]]` leaves that note open and byte-identical. The embed becomes the missing-file chip `“EdgeFile.base” could not be found.` Host rename stays in `test-bases-embed.mjs`.
- 10,000 notes in `Edge10/`, ranks chosen so name order and rank order disagree (`00001` is rank 9999, `00000` is rank 0). Sort Z → A on `rank` shows `Edge10/00001.md` with rank 9999. Scroll mounts 46 rows. Ceilings are the existing ones: sort `reconcile.lastMs` ≤ 50 ms, scroll p95 ≤ 20 ms and max ≤ 25 ms, no long task over 50 ms, mounted rows under 80.

## Bugs found

None. No test is skipped or expected-fail.

## Timing

`node scripts/test-bases-edge.mjs`, three times under `flock /tmp/grove-npm-test.lock`, all passed. No long task over 50 ms.

| Run | Sort `lastMs` | Scroll p95 | Scroll max | Mounted rows |
|---|---:|---:|---:|---:|
| 1 | 18.8 ms | 16.7 ms | 16.8 ms | 46 |
| 2 | 18.8 ms | 16.8 ms | 16.8 ms | 46 |
| 3 | 22.0 ms | 16.8 ms | 16.8 ms | 46 |

`npm run build` (`tsc --noEmit && vite build`) passed with the new vitest file. The usual Vite chunk-size warning remains. Full `npm test` was not run; product code is unchanged.

## `package.json` later

`vitest run` already loads `src/bases/edge.test.ts`. No change for that file.

Append the browser script to `posttest` in `rebuild/app/package.json`:

```json
"posttest": "node scripts/test-bases-config.mjs && node scripts/test-bases-cards.mjs && node scripts/test-bases-embed.mjs && node scripts/test-bases-search.mjs && node scripts/test-bases-group-order.mjs && node scripts/test-bases-kanban.mjs && node scripts/test-bases-kanban-move.mjs && node scripts/test-bases-list.mjs && node --experimental-strip-types scripts/fuzz-property-edit.mjs && node scripts/test-bases-edge.mjs"
```

The added piece is ` && node scripts/test-bases-edge.mjs`.
