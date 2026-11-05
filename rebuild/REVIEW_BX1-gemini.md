# BX1 Review — Cinder `.base` corpus

Reviewed commit `d07dde1` (`rebuild/bx1-grok-c` from `rebuild/integration` `b5d0a34`) on branch `rebuild/bx1-review-gemini`.

## Plan & Checklist Verification

- **Corpus (`rebuild/app/fixtures/cinder-bases/`):** Covers every view type (`table`, `cards`, `list`, `board`) and YAML key that `ui/bases.js` reads or writes (`filters`, `formulas`, `properties.<id>.displayName`, `views`, `type`, `name`, `order`, `sort`, `limit`, `groupBy`, `image`, `columns`), plus `ui/test/bases.test.js`'s `BASE` fixture (`reading-list.base`), comments, single/double quotes, flow lists (`flow.base`), CRLF (`crlf.base`), empty/zero-view bases (`empty.base`, `views-empty.base`), a `` ```base `` block in a note (`block.md`), and the documented gap fixtures (`gap-string-groupby.base`, `gap-block-scalar.base`, `gap-filter-bool.base`, `gap-filter-list.base`, `gap-expressions.base`).
- **Byte-stable no-op save (`src/bases/write.ts`, `src/bases/groups.ts`):** `yamlEqual` and `unchanged` check deep equality (order-independent for YAML mappings, order-sensitive for lists) in `writeView`, `writeTop`, and `writeViewSetting`. Writing back fresh copies of parsed values preserves comments, quote styles, flow lists, and CRLF byte-for-byte, while out-of-range view indices still throw `"View does not exist"`.
- **`type: board` drawn as kanban (`src/bases/model.ts`, `src/bases/menus.ts`, `src/bases/list.test.ts`, `src/bases/model.test.ts`):** `layoutOf("board")` returns `"kanban"` and `viewGlyph("board")` returns `"square-kanban"`, while `model.view.type` preserves `"board"` on disk unless the user explicitly changes the layout in Configure view. The view menu enables `board` views.
- **`file.basename` (`src/bases/functions.ts`, `src/bases/model.ts`):** Added `"basename"` to `fileProperties`, `"file.basename": "basename"` to `FILE_LABELS`, and `case "file.basename": return noteName(f.path)` in `fileFact`. `reading-list.base`'s `label` formula compiles and evaluates as expected.
- **Tests (`src/bases/cinderCorpus.test.ts`):** Verifies that every file in `fixtures/cinder-bases/` is accounted for, parses, maps to the expected layout and icon, round-trips with zero byte changes on a no-op save (both standalone `.base` and `` ```base `` fenced blocks), evaluates `reading-list.base` and `builtins.base`, ignores `board-columns.base`'s `columns` key without turning it into `groupBy.order`, and locks the expected errors/notices on the `gap-*` fixtures.
- **Honesty of unsupported list (`rebuild/NOTES_BX1-grok-c.md`):** Checked against `ui/bases.js` and Grove's `src/bases/`. All eight items accurately describe the remaining differences (`groupBy: string`, `view.columns`, `file.links`/`backlinks`/`embeds`/`properties` in `baseModel`, word boolean/ternary operators and unquoted `: `, block scalars, boolean/bare-list filters, synthesized `View` vs `Table` default name, and computed summary footers), and `file.name` / `.MD` case differences are clearly noted.

## Command Results

- `cd rebuild/app && npm run build`:
  - Exit 0 (`tsc --noEmit && vite build`, 2137 modules transformed, built in 386 ms).
- `cd rebuild/app && flock /tmp/grove-npm-test.lock npm test`:
  - Exit 0 on first run (node test 6/6 passed; Vitest 81 files, 1,289 tests passed in 1.08 s; all browser and `posttest` scripts including `test-bases-embed.mjs` and `test-bases-edge.mjs` passed).
- `cd rebuild/app && npm run audit:offline`:
  - Exit 0 (`Offline audit passed: 191 source files, dist/, CSP, capabilities and dependencies checked.`).
- `cd rebuild/app/src-tauri && cargo test --offline`:
  - Exit 0 (`84 passed; 0 failed; 4 ignored` in 0.30 s).

VERDICT: OK — All BX1 scope requirements, checks, and constraints are cleanly met, no regressions found, and the unsupported list in the notes is accurate and complete.
