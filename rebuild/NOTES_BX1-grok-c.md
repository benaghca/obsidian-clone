# BX1 — Cinder `.base` corpus

Branch `rebuild/bx1-grok-c` from `rebuild/integration` `b5d0a34`. Local commit only.

## What landed

`rebuild/app/fixtures/cinder-bases/` holds one file for each view type and key `ui/bases.js` reads or writes, taken from that file and from the `BASE` example in `ui/test/bases.test.js`. `src/bases/cinderCorpus.test.ts` loads them with `import.meta.glob` and checks three things: Grove parses the file, `baseModel` draws the layout Cinder's view type maps to, and writing the parsed filters, properties, and view fields back (a fresh copy of each value, not the same object) leaves the source bytes alone. Opening a base still does not write. A ` ```base ` fence in `block.md` is checked the same way through `baseBlockYaml` and `baseBlockChange`.

`reading-list.base` is the test's `BASE` text, including the comment, the single-quoted filter and formula, and `type: board`. `flow.base` keeps a flow `order` list and a quoted name. `crlf.base` is CRLF. `empty.base` is zero bytes. `views-empty.base` is `views: []`.

## Small fixes

Cinder's `board` is Grove's kanban. `layoutOf` maps `board` to `kanban`, so the view draws the board pane and the menu icon is `square-kanban`. The file keeps `type: board`. The view menu can select that view. Configure view shows Kanban because it reads the drawn layout. It writes `type: kanban` only if someone changes the layout control.

`file.basename` is a file property. `fileFact` returns `noteName`, the same title Grove already uses for `file.name`. The reading-list formula `if(status == "done", "✓ " + file.basename, file.basename)` compiles. On `Books/Dune.md` with status `done` and pages `700`, the cards view shows label `✓ Dune` and pages/day `100`. Cinder's `file.name` still includes `.md`. Grove's `file.name` stays the note title. A `.MD` suffix differs: Cinder's basename strip is case-sensitive, and `noteName` is not.

`writeView`, `writeTop`, and `writeViewSetting` return the original string when the new value deep-equals the parsed value. Quotes, comments, flow lists, and CRLF stay. List order matters and mapping key order does not. A missing view index still throws "View does not exist". A real edit still rewrites that block, and the first real edit of a non-canonical block still uses Grove's double-quoted writer.

## Left for a later piece

- A string `groupBy` (`groupBy: status`) still throws. `groups.test.ts` treats that shape as invalid. Cinder's reader accepts a string. Its UI writes `{property, direction}`.
- `view.columns` on a board stays on disk and is ignored. It does not become `groupBy.order`. Kanban column order and empty columns still come from `groupBy.order` and `hidden`.
- `file.links`, `file.backlinks`, `file.embeds`, and `file.properties` parse and evaluate to null. The link index lives in the view, not in `baseModel`.
- Word operators `and`, `or`, and `not`, and the ternary `? :`, are still "Unsupported expression" notices. An unquoted formula that contains `: ` fails earlier, in the YAML reader (`Unsupported YAML value`). Cinder quotes those strings. The gap fixture quotes the ternary so the expression notice is what fires.
- Block scalars (`|` and `>`) throw `Unsupported YAML value`. Cinder's saver does not emit them.
- A boolean filter and a bare filter list parse, draw the view, and notice "Unsupported filter tree". They match nothing. Cinder treats a boolean as that boolean and a bare list as AND. Its UI writes `{and: [...]}`.
- An empty file and `views: []` synthesize a table named `View`. Cinder names that view `Table`. Existing Grove tests depend on `View`.
- Cinder's summary footer is computed. It is not a YAML key. Grove summaries stay optional YAML.

## Checks

Headless Chromium only. No desktop window.

- `cd rebuild/app && ./node_modules/.bin/tsc --noEmit --pretty false` — exit 0.
- `cd rebuild/app && ./node_modules/.bin/vitest run src/bases` — vitest 5.0.5, 21 files, 486 tests, all passed.
- `cd rebuild/app && node scripts/test-bases-embed.mjs` — passed. Cold open 29.6 ms. Warm opens 8.2 / 8.9 / 9.1 ms. Typing max frame 16.8 ms. Embed scroll max frame 16.8 ms.
- `cd rebuild/app && node scripts/test-bases-edge.mjs` — passed. 10,000-row sort 24.6 ms. Scroll p95 16.8 ms, max 16.8 ms, 46 rows mounted.
