# Bases B5 review: Group by and Summaries

Reviewed by Claude on `rebuild/b5-review-claude`. The branch was made from `rebuild/bases-b5-codex` (`8844101`), with `rebuild/integration` (`78d3bb3`, which has B4's embeds) merged in using `--no-ff`. Nothing was pushed.

VERDICT: OK. The fixes below are committed on this branch, so merge it rather than `rebuild/bases-b5-codex`.

## Commits

| Commit | What |
|---|---|
| `436e2c4` | The merge, with the conflicts in `model.ts` and `view.ts` resolved. |
| `6c71d60` | Copy and Export CSV follow the group order. The B5 CSS moves into `styles/bases.css`. |
| `8fdc177` | A custom summary is saved by its plain name, not `custom.<name>`. |
| `2a7ef33` | A browser test for groups and summaries inside an embedded base. |

My changes on top of B5: +60 / −23 lines in 6 files. Against integration, the whole branch is +978 / −22. Everything is in `src/bases/`, `styles/bases.css` and the Bases test scripts; nothing else in the app changed.

## The merge (B4 + B5)

- **`model.ts`:** both changes are kept: B5's `groupBy` and `summaryPlan`, and B4's `Row.host`. The model now also returns `hostContext`.
- **`view.ts`:** B5's presenter (`createGroupedView`) now sits in the shared `createBase`, so a base tab and an embed get the same groups and summaries.
  - The presenter draws all card views (grouped or not) and any table with groups or summaries.
  - A plain table keeps its existing fast path; B5 adds nothing to it.
  - The view's own card grid from B4 is removed, so cards have one renderer. Ungrouped cards now go through B5's card path. It calls the same `createCardGrid`, and the card tests and frame times are unchanged.
- **`this` in custom summaries:** `summaryContext` uses `model.hostContext(host)`, so a custom summary in an embed reads the embedding note. A browser test checks this: `this.file.name + ": " + count` shows `Grouped: 3`.
- **Dead code removed from `groups.ts`:**
  - the `display:contents` wrapper around the table, which only guarded against the old card adapter that B4 deleted;
  - its duplicate updates of the view icon, `aria-label` and `table.hidden`, which `createBase` already does.

## Findings

### Fixed on this branch

1. **Copy and Export CSV ignored the groups.**
   - A grouped table drew its rows group by group, but Copy and Export CSV listed them in the ungrouped sort order.
   - Now `groupedView.rows()` gives the drawn order, and both follow it. Group headers and summary rows are still not exported.
   - The plan doesn't say how export should treat groups; following the screen seemed the natural reading.
   - The B5 browser test checks the copied order: C, A, B, D, where ungrouped it would be A, B, C, D.
2. **Custom summaries were saved as `custom.<name>`.**
   - In a `.base` file, a view's `summaries` names a summary directly. That's from Obsidian's "Bases syntax" help page, from memory; nothing was fetched.
   - Grove now writes the plain name, and keeps `custom.` only when a custom name is the same as a built-in's (for example a custom summary called `Sum`).
   - Both forms are still read. The browser test now expects `note.points: span`.
3. **CSS was injected from JavaScript.**
   - `groups.ts` added its CSS as a `<style>` element per view, so a note with three embeds got three copies.
   - It's the only place in the app that did this. The rules now live in `styles/bases.css` (15 rules), reformatted to that file's style but otherwise unchanged.
4. **The dead wrapper and duplicate DOM updates** (see the merge section).

### Checked, with no change needed

- **YAML shapes:**
  - `groupBy: {property, direction}`, with the direction ASC when not given;
  - `views[i].summaries` maps a property to a summary name;
  - top-level `summaries:` holds the custom formulas.
  - These match the plan (§4) and my memory of Obsidian's help.
- **Writes keep every other byte:** comments, other views, BOM, CRLF and a missing final newline. Unit and browser tests check the exact bytes.
- **No writes when only viewing.** Viewing and collapsing write nothing, in a tab (B5's test) and in an embed (new test).
- **Group order:**
  - The empty group comes last in both directions.
  - Null, `""` and `[]` share the empty group; `0`, `false` and whitespace are values.
  - Numbers, dates and durations sort by value; other values sort by label with `compareNames`.
  - Rows keep the view's sort within a group.
  - A list is one grouping value, so a note isn't repeated under each tag.
- **Summaries on mixed types:**
  - The numeric summaries ignore text and booleans, so `"5"` doesn't count.
  - Checked and Unchecked count only true booleans.
  - Sum of nothing is 0; Average, Min, Max, Range and Median of nothing are empty.
  - Earliest and Latest parse date strings.
  - An error in a cell shows `#ERROR!` in every summary except Count.
  - All of this is covered by `summaries.test.ts` (one case per built-in on mixed and empty values).
- **Footer (design A):**
  - A table has a footer row under each group and a sticky overall footer.
  - A summaries-only table gets just the sticky footer.
  - Cards get a summary strip under each group and one overall.
- **Ungrouped behaviour is unchanged:** plain tables, cards and embeds. All the existing Bases browser tests pass.
- **Geometry:** the live and reading geometry checks pass, and so does a new one with a grouped embed. No vertical margins on `.cm-content` children; the group header and footer heights are fixed (32 and 44 px) and included in the virtual layout.
- **Menus:** they open on the first frame, with no animation.

### For Chris to check against your Obsidian (not changed)

These come from my memory of the "Bases syntax" help page, and may be wrong:

- **Missing summaries:** I believe Obsidian also lists **Stddev**, and a **Range on dates** (the time between the earliest and latest date). Grove has neither: its Range is numbers only, so a date column shows an empty Range. Each is a few lines in `summaries.ts` if you want them.
- **Count:** I'm not sure Obsidian has a Count summary. The plan listed it, and it's harmless.
- **Custom summaries written in Obsidian's style** use list methods on `values`, such as `values.mean()`. B1's language has no list methods except `contains`, `join` and `length`, so those formulas show errors in Grove.
  - B5 adds scalar names (`count`, `sum`, `average`, …) that Grove understands, but a file written in Obsidian won't use them.
  - Fixing this belongs to the formula language (B1's files), not B5.
- **Where the empty group goes:** it comes last in Grove (the plan's rule). I haven't confirmed Obsidian's order.

### Known limits, recorded and not fixed

- **Selecting rows at 50,000 notes stalls the page.**
  - Selection (filter and sort, unchanged by B5) still runs in one go: 104–107 ms in the browser at 50,000 rows. That is roughly six dropped frames on every open and every rebuild (after a save, or after the 300 ms typing pause).
  - It's a visible stall at 50,000 notes. At 5,000 the B0 warm opens take 11–20 ms, with no stall.
  - B5 doesn't add to it, since its own work runs in slices of about 5 ms. B7 (the Rust pre-filter) is the planned fix.
- **Grouping at 50,000 rows shows up late.**
  - A grouped or summarised base finishes its group and summary work 385 ms (100 groups) to 680 ms (50,000 groups) after selection.
  - Until then the previous view stays on screen, marked `aria-busy`; on a first open the body is empty.
  - Frames stay at 16.8 ms the whole time.
- **The footer can be briefly out of date.** While a summaries-only table is recomputing, its new rows are drawn under the old footer until the summary work finishes, a few milliseconds at 5,000 notes.
- **One slice ran long.** In one 5,000-row run a slice took 7.2 ms against the 5 ms target. That's still far under 20 ms.

## Performance

All runs are headless and were made under `/tmp/grove-npm-test.lock`. Integration (`78d3bb3`) and this branch were interleaved over three rounds, with the order flipped in round 2 (my scratchpad scripts `paired.sh` / `one.sh`).

| Measure | Integration | This branch |
|---|---|---|
| Warm 1,000-note table open (single sample per run, 6 rounds) | 8.2 / 9.1 / 8.3 / 8.4 / 8.2 / 9.2 ms | 9.5 / 8.4 / 9.2 / 9.5 / 10.9 / 8.5 ms |
| Same, median of 15 opens per run, 2 runs each | 6.3 / 6.6 ms | 6.3 / 6.3 ms |
| 1,000-row table scroll, worst frame | 16.8 ms | 16.7–16.8 ms |
| 1,000-card scroll, worst frame | 16.8 / 17.1 / 16.9 ms | 16.8 / 16.9 / 16.9 ms |
| 5,000-note cold open (B0) | 47.3 / 42.6 / 44.2 ms | 39.6 / 44.4 / 41.4 ms |
| 5,000-note warm open, median per run (B0) | 14.4 / 17.2 / 16.2 ms | 14.2 / 14.3 / 13.9 ms |
| Typing beside an open base: worst frame; rebuilds during / after a burst | 16.8 ms; 0 / 1 | 16.8 ms; 0 / 1 |
| Embed: cold open | 84.6 / 85.7 / 85.6 ms | 83.3 / 83.8 / 83.1 ms |
| Embed: warm open | 5.6–7.3 ms | 5.9–7.4 ms |
| Embed: typing in the note, worst frame; rebuilds during / after | 16.8 ms; 0 / 1 | 16.8 ms; 0 / 1 |
| Embed: paging scroll, worst frame | 16.7–16.8 ms | 16.7 ms |
| 1,000 grouped cards, wheel scroll (branch only) | – | 16.8 ms in all 3 runs |

- **Warm 1,000-note open:** the single samples looked about 1 ms slower here, so I ran 15 opens per run (my scratchpad script `warm15.mjs`). The medians match, so it's noise, not a regression. On a plain table, B5's work runs only after the result count is drawn.
- **Nothing else regressed.** The 5,000-note warm and cold opens are a little faster here, but the ranges overlap.

### Codex's 50,000-note benchmark, rerun

- **Vault:** I made a fresh one with `node scripts/gen-vault.mjs /tmp/grove-bases-b5-claude-review/vault 50000`. Its SHA-256 is `d5723282…421be`, the same as Codex's, so the vault is reproducible.
- **Runs:** two, each `node scripts/bench-bases-groups.mjs <vault>` under the lock.

| Measure | Codex | Run 1 | Run 2 |
|---|---|---|---|
| 5k group + 4 summaries, first run, CPU | 19.1 ms | 19.1 ms | 18.5 ms |
| 5k, warm runs, CPU | 12.0 / 8.9 / 9.4 ms | 11.6 / 12.0 / 8.6 ms | 14.5 / 10.0 / 8.8 ms |
| 50k / 100 folders, first run, CPU (wall) | 170 (211) ms | 157 (194) ms | 158 (196) ms |
| 50k, warm runs, CPU | 110–112 ms | 104–106 ms | 105–107 ms |
| Browser, 50k / 100 folders: wall, CPU, worst slice, worst frame | 381 ms, 122 ms, 5.1 ms, 16.8 ms | 385 ms, 120 ms, 5.1 ms, 16.8 ms | 386 ms, 123 ms, 5.0 ms, 16.8 ms |
| Browser, 50k distinct groups: wall, CPU, worst slice, worst frame | 666 ms, 203 ms, 5.0 ms, 16.7 ms | 650 ms, 201 ms, 5.6 ms, 16.8 ms | 681 ms, 208 ms, 5.0 ms, 16.8 ms |
| Row selection before B5's work (browser, 50k) | 107 / 120 ms | 105 / 107 ms | 104 / 104 ms |

- **Codex's numbers reproduce.** The 5k warm medians (8.6–10.0 ms CPU) meet the plan's target of 20 ms extra.
- **The script's own before/after `select()` timings don't measure B5.** It compares against `08641e4`'s model, and selection is unchanged. They moved both ways between runs: 5k tag sort 8.9 → 9.9 ms in run 1 and 8.9 → 8.7 ms in run 2; 50k formula sort 169 → 163 ms and 167 → 168 ms. That's noise, as Codex also said.

## Tests

- **What B5 tested already:**
  - grouping order, empty values and value keys;
  - byte-exact writes of `groupBy` and `summaries`;
  - every built-in summary on mixed and empty values;
  - custom formulas (aggregate names, cycles, errors, the 10,000-value cap);
  - sliced work and cancellation;
  - real-mouse menus, collapse by mouse and keyboard, cell-edit totals;
  - cards, recovery after a failed reload, and grouped-card scrolling.
- **Added here:**
  - the copied row order of a grouped table;
  - a ```` ```base ```` block in a note with a `this` custom summary: "Group by this property" from the header menu, the write into the block, collapsing with no writes, and the geometry checks.
- **Not covered by a frame test:** scrolling a grouped *table*. The 50k browser benchmark shows it virtualised (27 rows drawn) with 16.8 ms frames, but no test runs it every time.
- **After the merge:** the full suite passed: build; `flock … npm test` with 66 files / 1,100 unit tests, every browser script and posttest, exit 0; `audit:offline` over 174 files; `cargo build`; `cargo test` with 58 passed and 2 ignored.
- **Final run after the fixes:** see below.
- **Final run, after the fixes (`2a7ef33`):** `npm run build` passed. `flock /tmp/grove-npm-test.lock npm test` exited 0, with 66 files / 1,100 unit tests and every browser script plus posttest, including the new grouped-embed step and B5's groups script. `npm run audit:offline` passed over 174 files. `cargo build` passed, and `cargo test` gave 58 passed, 2 ignored. No flakes or reruns.

## Sources

- `rebuild/BASES_PLAN.md` (B5, §4, §6 and §8), `rebuild/NOTES_BASES-B5.md` and the code.
- Obsidian's public "Bases syntax" and "Views" help pages, from memory only; nothing was fetched, since there's no network.
- No Obsidian code, CSS or assets were used.
- The test vaults are under `/tmp` (`/tmp/grove-bases-b5-claude-review`). No real vaults, other worktrees or Herdr panes were touched.
