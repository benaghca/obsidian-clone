# Bases: plan for the next version

Written 2026-10-29 on `rebuild/bases-plan-claude` (from `rebuild/integration` `2f82a1f`). Plan and design only; no feature code. Mockups are in `rebuild/bases-mockups/`.

## In plain words

- **Grove already has a first Bases.** Rounds 30–33 built it: 1,279 lines in `src/bases/`, plus six browser test scripts. A `.base` file opens as a table. It has:
  - global and per-view filters (`and`/`or`/`not`), formulas, sort and limit;
  - editable cells that write the note's frontmatter;
  - column resize and reorder;
  - view switching and Add view;
  - the results menu (limit, copy as TSV), New row, and the Configure view page (rename, row height);
  - virtualised rows above 200.
- **What's missing, against Obsidian's public docs:**
  - card and list views;
  - Group by and Summaries;
  - most of the formula language: there is no arithmetic, no string, list or date functions, and no `this`;
  - visible formula errors;
  - the toolbar Search box and Export CSV;
  - **embedding a base in a note** (a ` ```base ` code block, or `![[Tasks.base]]` / `![[Tasks.base#View]]`).
- **The next version should add, in this order:**
  1. the formula language;
  2. card view;
  3. Group by;
  4. Summaries;
  5. embedding.

  List view, the property-type menu and Rust-side evaluation come later, and the Rust part only if it's measured to be needed.
- **Rows stay evaluated in TypeScript.** Their data already comes from Rust: properties (Step 3), tags (Step 1) and the link index. Evaluating in TypeScript keeps unsaved edits in open notes visible, as today, and avoids a second copy of a whole expression language. A Rust pre-filter is planned only if the 5,000-note numbers in §6 miss their targets.
- **Decisions for Chris (§1):** which table layout (three mockups), whether embedding comes before or after Group by and Summaries, and how faithful to stay to Obsidian's toolbar.

## 1. Decisions for Chris

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | **Table look** (`bases-mockups/table-*.png`) | **A**: Obsidian's layout. One toolbar row (view menu, result count, Sort, Group, Filter with a count badge, Properties, Search, New), and summaries in a footer row. **B**: view tabs plus filter chips, with views and active filters always visible and group headers in the table. **C**: docked view settings, with properties, sort, filter and group open in a panel beside the table. | **A.** It is what Grove already draws (rounds 31–33 matched Obsidian), so it costs nothing to keep, and files and habits carry over from Obsidian. B's chips could become an option later: show active filters under the toolbar. C takes too much width in a split pane. |
| D2 | **Card view** (`cards.png`) | A cover from an image property (none if unset), the title, then the view's properties as label/value rows. | As drawn. Cover images are loaded lazily, only for visible cards. |
| D3 | **Filter editor** (`filter.png`) | Obsidian's structure (All views / This view, nested any/all/none groups, `where property operator value`), plus a **Formula** switch per group that shows and edits the same filter as one expression. | As drawn. The formula line matters because the visual rows can't express everything the language can. |
| D4 | **Order of the big pieces** | Embedding in notes, before or after Group by + Summaries | **After the formula language, alongside Group by.** Embedding needs `this` (formula work), and it touches the editor, which is a different file set, so it can run in parallel (§8). |
| D5 | **Rust for rows** | Never; a pre-filter only if measured; or port all evaluation | **A pre-filter only if measured** (§5). |

## 2. What exists today (verified in the code)

| File | Lines | Does |
|---|---:|---|
| `bases/view.ts` | 183 | The table tab. Builds rows from `ws.vault.files` + `propertyIndex` (Rust `properties`) + `vaultTags` (Rust `tags`) + the link index, with unsaved tags for loaded notes (`view.ts:127-145`). Renders only visible rows above 200. Re-evaluates 20 ms after any `files`/`doc`/`links` change (`view.ts:177-179`). **`doc` fires on every edit in any open note** (`noteEditors.ts:324` → `workspace.ts:82`), so an open base, even in a hidden tab, rebuilds every row after each pause in typing. That is fine at 1,000 notes, but at 5,000 it competes with typing (§6, task B0). |
| `bases/model.ts` | 95 | Parses the YAML, compiles global + view filters (`and`/`or`/`not` trees) and formulas, then `select()` filters, sorts (multi-key, empties last, dates, `compareNames` ties) and applies `limit`. Only `type: table` (`model.ts:109`). |
| `bases/expression.ts` | 84 | A small parser and interpreter: `|| && == != > >= < <=`, `!`, unary `-`, strings, numbers, `true`/`false`/`null`, properties (`note.x`, `file.name/path/folder/ext/mtime/ctime/tags/size`, `formula.x`), and functions `today()`, `if()`, `file.inFolder()`, `file.hasTag()`, `file.hasLink()`, `contains()` / `x.contains()`. Rejects `this`. Limits: 4,000 characters, 500 tokens, depth 50. |
| `bases/yaml.ts` | 87 | A read-only YAML subset. It never re-serialises. |
| `bases/write.ts` | 100 | Replaces only the edited YAML block, in Obsidian's canonical style, through a writer queue. |
| `bases/filters.ts`, `filterMenu.ts` | 146 | The filter popover: rows and groups, writing `filters`. |
| `bases/menus.ts`, `results.ts`, `config.ts`, `columns.ts`, `cells.ts`, `newRow.ts`, `new.ts`, `drag.ts`, … | ~380 | Sort, Properties and header menus; the results menu; Configure view; widths and order; cell editing through the Properties writer; New row; New base. |
| Tests | 6 vitest files + `test-bases*.mjs` (6 scripts) | Model, filters, columns, write, config and results units; browser tests with real mouse input, byte-exact writes, a warm 1,000-note open in under 100 ms (`test-bases.mjs:86`) and 1,000-row scroll frames under 20 ms. |

## 3. Scope

### Version 2 (this plan)

1. **The formula language.** Grounded in Obsidian's public "Bases syntax" and "Functions" help pages, from prior knowledge, since there's no network access here (§10).
   - Arithmetic: `+ - * / %`, string concatenation, and parentheses (already supported).
   - Global functions: `date()`, `now()`, `today()` (exists), `duration()`, `if()` (exists), `list()`, `number()`, `link()`, `min()`, `max()`.
   - `file.*`: `hasTag`, `hasLink` and `inFolder` exist; add `hasProperty()` and `asLink()`.
   - Methods on values:
     - text: `.contains()` (exists), `.startsWith()`, `.endsWith()`, `.lower()`, `.upper()`, `.trim()`, `.length`;
     - list: `.contains()`, `.length`, `.join()`, `.isEmpty()`;
     - date: `.year`, `.month`, `.day`, `.format()`;
     - number: `.round()`, `.toFixed()`.
   - Date arithmetic with duration strings (`file.mtime > now() - "1 week"`, `due < today() + "7d"`).
   - **Visible errors.** A formula that fails to parse shows an error cell (and a one-line notice in the toolbar), not a silent `null` as today (`model.ts:111-112`).
   - **`this`** for embedded bases (item 5).
   - The existing safety limits stay (length, tokens, depth), as does "no `eval`, no JS property access".
2. **Card view** (`type: cards`):
   - a responsive grid with card size from the view; a cover from an image property (lazy `blob:` URLs, the same as `![[embeds]]`); the title, then the view's `order` properties;
   - virtualised by row of cards above 200 items;
   - click to open, Ctrl-click for a new tab;
   - the same toolbar, filters, sort and limit as the table.
3. **Group by** (`groupBy: { property, direction }`) in the table and in cards: group header rows with the value and count, collapsible, with the empty group last. Header menu "Group by this property".
4. **Summaries**: a footer row per column (table) and per group.
   - Built-in summaries: Count, Empty, Filled, Unique, Sum, Average, Min, Max, Range, Median, Earliest, Latest, Checked, Unchecked.
   - Custom summary formulas (top-level `summaries:`).
   - Header menu "Summarize…" writes `views[i].summaries`.
5. **Embedding in notes**:
   - a ` ```base ` fenced block (YAML inside) and `![[X.base]]` / `![[X.base#View]]` render as the view, inside Live Preview and Reading;
   - `this` is the embedding note;
   - the height is capped, with the base scrolling inside it;
   - editing a cell writes the target note, as in the tab;
   - the embedded toolbar is compact.

   The permanent geometry rules apply (no vertical margins on `.cm-content` children; the block widget measures its own height).
6. **Small items:** the toolbar Search box (filters visible rows by text), Export CSV in the results menu, and the header menu items "Edit property…" and "Property type ›" (reusing the Properties menus).

### Later

- List view.
- A map view (a plugin in Obsidian; not planned).
- Drag-to-reorder rows in a sorted view (Obsidian doesn't do it either).
- Formulas over other bases.
- Relation and backlink columns beyond `file.backlinks`.
- A Rust pre-filter (§5), only if measured.

## 4. The `.base` format we read and write

- **YAML, the same as Obsidian's.** We read a subset (`yaml.ts`) and never re-serialise. Edits replace one block in Obsidian's canonical style (2-space indents, block lists, plain scalars when safe), and every other byte is kept (`write.ts`). That rule stays.
- **Top level:** `filters` (a string expression, or a tree of `and`/`or`/`not` lists), `formulas` (name → expression), `properties` (id → `displayName`), `summaries` (name → formula, new), and `views` (a list).
- **A view:** `type` (`table`, then `cards`, later `list`), `name`, `limit`, `filters`, `order` (property ids), `sort` (`property`, `direction: ASC|DESC`), `groupBy` (`property`, `direction`) (new), `summaries` (property id → summary name) (new), `columnSize` and `rowHeight` (table).
- **Card keys** (the cover property, its fit and aspect, the card size): new. **Exact key names to be checked against a file written by Chris's Obsidian before B2 starts** (§10). Until then, an unknown key is kept on disk and ignored, as today.
- **Property ids:** `file.*`, `note.x` or plain `x`, and `formula.x`, as today. Add `file.backlinks`, `file.links`, `file.embeds`, `file.properties` when a column or formula asks for them (B1/B5).
- **Embedded code block:** the same YAML, inline. `this` is the embedding note.
- **Unsupported YAML** (anchors, flow maps it can't place) stays on disk. The view shows "Unable to open base" with the reason, as today.

## 5. How it uses the Rust work, and the Rust/TS split

| Data | Comes from | Notes |
|---|---|---|
| Properties | Rust `properties` (Step 3), through `propertyIndex` (mtime cache, open-editor override) | Already the case. The typed values and `line` are what cells and filters need. |
| Tags | Rust `tags` (Step 1), through `vaultTags`, plus `tagsInText` for loaded notes | Already the case. `file.hasTag` uses the same `isUnder` rule as search's `tag:` (STEP4 §2), and the corpus checks both. |
| Links | Rust `link_index` (outgoing + markdown) | `file.hasLink`; `file.backlinks` would use the Step 2 `backlinks` command (on demand, only for the visible rows). |
| File facts | `list_files` (`mtime`, `ctime`, `size`) | As today. |
| Search syntax (Q1 / C1-A) | Not reused as code | Bases expressions are a different language from search queries. What carries over is the method: a shared JSON corpus, a TS reference, and a differential fuzz. The toolbar Search box (item 6) is plain text matching on the visible cells, not the search engine. |

**Rust/TS split.** Evaluation, sorting, grouping and summaries stay in TS, for three reasons:

- **Unsaved edits.** They need the open-editor overlay, which only the page has. The tab already shows unsaved tags and properties.
- **One evaluator.** A Rust port of the whole language means two evaluators and a parity burden on every new function.
- **Speed.** Today's numbers (§6) say TS opens 5,000 notes in 50 ms warm. Only re-evaluation (about 50 ms) needs work, and B0 cuts how often it runs before any Rust is considered.

**The planned Rust step is a pre-filter, and only if §6's 5,000-note targets are missed.** Rust would evaluate the index-friendly leaves of the global and view filters (`file.inFolder`, `file.hasTag`, a property's existence or a literal equality) over its index and return the candidate paths. TS would then evaluate the full filter on those candidates only. That leaves a single expression language, with Rust answering a few leaf questions. A small parity corpus (`fixtures/parity/bases-leaves.json`) would hold both to the same answers.

## 6. Performance targets (5,000 notes)

Measured today with the mock vault in headless Chromium, using `scratchpad` script `measure2.mjs` (not committed): a base over a folder of N generated notes, with `file.inFolder` + `status != "done"` + a formula column + a two-key sort.

| Notes | Cold open | Warm open | One note saved → table updated (includes the 20 ms debounce) |
|---:|---:|---:|---:|
| 1,000 | 33 ms | 21 ms | 41 ms |
| 5,000 | 79 ms | 50 ms | 71 ms (about 50 ms of re-evaluation) |

These come from the browser mock, so there's no IPC. In the app, the first property read also carries Rust's `properties` reply: 0.59 MB at 5,000 notes (NOTES_S3). Opening is well within budget. Re-evaluation is the weak spot: about 50 ms at 5,000 notes. Because of the `doc` listener (§2), that cost lands after every pause in typing anywhere while a base is open, so B0 comes first.

| Measure | Target at 5,000 notes |
|---|---|
| Warm open of a table base, to the result count shown | ≤ 150 ms (today 50 ms; the existing test: 1,000 notes ≤ 100 ms) |
| Re-evaluation after one note changes (save → table updated, excluding the 20 ms debounce) | ≤ 30 ms (today about 50 ms), and never more than one re-evaluation per change burst |
| Typing in an open note while a base is open in another pane | No frame over 20 ms: a re-evaluation can't block a keystroke (it runs after the debounce, and `doc` changes from typing are debounced longer, 300 ms, matching the save) |
| Scrolling a 5,000-row table, or a 5,000-card grid | No frame over 20 ms (virtualised) |
| Group by + summaries over 5,000 rows | ≤ 20 ms extra per re-evaluation |
| Embedded base in a note | Renders within 100 ms of the note opening, and doesn't move the editor's line geometry |

If the warm open or the re-evaluation misses its target after B1–B5, add the Rust pre-filter (§5), then measure again.

## 7. Test plan

- **Formula language (B1):**
  - one vitest table per function and operator, including errors and empty values;
  - a precedence and associativity table;
  - date arithmetic across month ends and DST;
  - the safety limits (length, tokens, depth);
  - Grok's fuzz (B3): random token streams must never throw outside the parser, hang, or take more than 50 ms per expression.
- **YAML round-trip:** every write test stays byte-exact (`write.test.ts`). Add `groupBy`, `summaries` and card keys.
- **Models:** pure tests for grouping (empties last, direction, ties), summaries (each built-in, on numbers, dates, checkboxes, lists and empty values) and card layout maths.
- **Browser tests (real mouse input, as `test-bases*.mjs` do):**
  - card view: open, click, Ctrl-click, cover image loads, virtual scroll;
  - Group by: menu, header rows, collapse, written `groupBy`;
  - Summaries: menu, footer values, written `summaries`;
  - embedded base: code block and `![[X.base#View]]` in Live Preview and Reading, `this.file.name` filter, cell edit, geometry suite still green;
  - Search box; Export CSV file content.
- **Performance:** extend `test-bases.mjs` with a 5,000-note open, a one-edit update and card-grid scroll frames. Extend `bench-frontend.mjs` with Bases evaluation time.
- **Obsidian compatibility:**
  - a folder of `.base` fixtures written by Obsidian (Chris's copies, or files made in a scratch vault under `/tmp` by observation), each opening with the same rows, order, groups and summaries;
  - no write when only viewing;
  - edited blocks match Obsidian's style.

## 8. Build split

Sizes: big (Claude or Codex, about 500 lines or more), medium (Gemini, 150–400), small (Grok, under 150, plus review and fuzz). Each task lists the files it owns. Two tasks running at once never own the same file.

| Task | Who | Needs | Owns | Size |
|---|---|---|---|---|
| **B0** Stop re-evaluating on every keystroke: `doc` changes wait 300 ms of quiet, a hidden base tab defers until shown, and a change to a note outside the base's folder/tag pre-filter is skipped when that's decidable | Grok | – | `bases/view.ts` (the `ws.on` handler only) | Small |
| **B1** Formula language + visible errors + `this` plumbing | Codex | – | `bases/expression.ts`, new `bases/functions.ts`, new `bases/dates.ts`, their tests | Big |
| **B2** Card view | Gemini | D2 confirmed; card key names checked | new `bases/cards.ts`, new `styles/bases-cards.css`, `model.ts` (view type line and card keys only), a new `test-bases-cards.mjs` | Medium |
| **B3** Export CSV + B1 fuzz + review of B1/B2 | Grok | – (fuzz after B1) | `bases/results.ts`; fuzz script in its scratchpad | Small |
| **B4** Embedding in notes | Claude | B1 merged (for `this`) | new `bases/embed.ts`, `editor/embeds.ts` (code-block and `![[x.base]]` hooks), `bases/view.ts` (split the tab into a reusable view + tab wrapper) | Big |
| **B5** Group by + Summaries | Codex | B1 merged (custom summary formulas), B2 merged (cards share grouping) | new `bases/groups.ts`, new `bases/summaries.ts`, `bases/menus.ts` (header menu), `model.ts` (groupBy/summaries parse) | Big |
| **B6** Search box, header "Edit property…" / "Property type ›" | Gemini | B4 merged (`view.ts` split) | `bases/menus.ts` toolbar, `bases/view.ts` row filter | Medium |
| **B7** Rust pre-filter (only if §6 misses) | Codex | B5 merged + a re-measure | new `index/bases.rs`, one command, `fixtures/parity/bases-leaves.json` | Medium |
| **Reviews** | Grok reviews B2/B4/B6; Claude reviews B1/B5; Codex reviews B4 | | | |

**Order:**

```text
wave 1 (parallel): B0 (Grok, first) · B1 (Codex) · B2 (Gemini) · B3 (Grok; Export CSV now, fuzz once B1 lands)
wave 2 (parallel): B4 (Claude) · B5 (Codex)      — B4 owns view.ts/editor, B5 owns groups/summaries/menus
wave 3:            B6 (Gemini) · re-measure §6 → B7 only if needed
```

**Shared-file conflicts:**
- `model.ts` is touched by B2 (view types, card keys) and B5 (groupBy, summaries), in different waves.
- `menus.ts` is touched by B5 (header menu) and B6 (toolbar), in different waves.
- `view.ts` is touched by B4 (split) before B6.
- `styles/bases.css` gets small additions from B4/B5/B6; B2 has its own CSS file.
- Merge order: B0 → B1 → B2 → B3 → B4 → B5 → B6. B0's one handler change in `view.ts` lands before B4 splits that file.

## 9. Rules every task follows

- Bases files stay Obsidian's YAML: byte-preserving edits, and nothing is written when only viewing.
- No network, no new npm packages or crates, and `npm run audit:offline` passes.
- Behaviour comes from Obsidian's public help pages and observation, never its code, CSS or assets. Icons are the bundled Lucide set.
- Real mouse input in browser tests. Menus open on frame 1 with no animation. No frame over 20 ms.
- The permanent geometry and real-pointer tests stay green; no vertical margins on `.cm-content` children (this matters most for B4).
- Run `flock /tmp/grove-npm-test.lock npm test` and `cargo test`, and restore `rebuild/round*-shots/`.

## 10. What this plan relied on, and what's unverified

- **Obsidian's public help pages** for Bases ("Introduction to Bases", "Bases syntax", "Functions", "Views", "Embed a base"), **from prior knowledge**. No page was fetched (no network). The function list and the view keys in §3–§4 should be checked against a `.base` file written by Chris's Obsidian before B1 and B2 start: mainly the card-view keys and the summary names. Grok's first task can be that check, by observation.
- **The current code**, read at `2f82a1f` (file:line above). The round 30–33 task files record what was matched against Obsidian 1.14.4 by observation.
- **The mockups** use Grove's own dark-theme tokens and bundled Lucide icons (`bases-mockups/build.mjs` writes the icon paths in from the app's `lucide` dependency). There are no Obsidian assets.
