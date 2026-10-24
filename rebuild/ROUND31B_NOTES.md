# Round 31 Part B — Bases filters and views

Built only in `grove-r31b-codex`, branch `rebuild/r31b-codex`, from integration
`111a59b`. Local commits only; no push or merge. All fixtures are synthetic;
no owner vaults or visible app windows were used. No dependencies added.

## Changes

- Enabled Filter using the shared instant menu: collapsible All views / This view
  sections with leaf counts; and/or/not conjunctions; property/operator/value
  rows; Add filter, Add filter group; nested groups and trash. Number, boolean,
  text/date literals, the existing file functions and contains comparisons use
  the existing expression evaluator. Compound expressions have an Advanced filter
  input; unsupported existing structures are kept and identified without rewriting.
  Enter/blur saves a value; Escape cancels its pending edit.
- Added the view menu: list/check the selected table view, switch without writing
  YAML, and Add view with a free `View N` name. Unsupported layouts stay disabled.
  A WeakMap keyed by tab remembers the selected index separately for each file
  in that tab, including switching away and returning. It is session memory,
  rather than new saved-layout/config state.
- Added lossless global/per-view `filters` block writes and canonical nested
  block YAML. Appending a view keeps previous view bytes, comments, root keys,
  CRLF and quoted strings intact. An implicit default view is materialized before
  appending the second view. Sort/Properties writes now target the selected view.
  The existing serialized read/modify/write queue remains the only Bases write path.
- Header menus show Clear sort only for sorted columns; Hide column and Clear sort
  have bundled icons. Properties is 225px wide and unchecked rows/icons are muted.
- New base retains the three-line canonical content, opens with its breadcrumb
  title selected, and reuses `editInPlace` for rename/error/cancel behavior.
  Renaming keeps the `.base` extension and file contents.

## Native observation and evidence

Rechecked Obsidian 1.14.4 at 1280×800, default light theme, using the existing
headless Ozone driver, private HOME/XDG/profile, disposable scratch vault and an
unprivileged network namespace containing only loopback. Only public APIs,
rendered controls and actual pointer/key input were used; no application code,
styles or assets were copied.

The Filter popover is 520px wide. It shows All views and This view with counts,
opens the local section when it has filters, and displays the conjunction,
where/or rows, Advanced filter/trash icons and Add filter / Add filter group.
The existing native fixture exposes file has tag work and priority > 1 under or,
with status != waiting under the global not group. Grove reproduces that tree.
The native view menu lists its current view and Add view. Native Add view opens
its wider configuration controls; this task implements the requested table append
and selection only. Native new-base focus is `view-header-title` and the selected
text is `Untitled`; Grove now matches that rename entry point.

Evidence lives in `round31b-shots/`: native observations, original captures,
Grove-written YAML and notes, all selected-view row/column/value snapshots, and
side-by-side captures. Reproduce native checks with:

```
unshare -Urn sh -c 'ip link set lo up; exec node /home/chris/workspaces/remote/grove-r31b-codex/rebuild/round31b-shots/observe.mjs'
unshare -Urn sh -c 'ip link set lo up; exec node /home/chris/workspaces/remote/grove-r31b-codex/rebuild/round31b-shots/roundtrip.mjs'
```

Native return check passed for Open, Done and View 1: identical columns, rows,
order and values, and YAML remained byte-identical after opening/switching.
The final Properties capture measured 220px in this native profile (the brief's
225px target is retained in Grove). Unchecked native labels are rgb(171,171,171);
Grove uses the existing faint-text token for both text and icons.

[Filter comparison](round31b-shots/filter-comparison.png),
[Written-file comparison](round31b-shots/written-comparison.png),
[native Properties](round31b-shots/obsidian-properties.png).

## Shared files touched

- `src/fileOps.ts`: one changed line recognizes `.base` when preserving the
  extension during the existing `renameFile` operation. Canvas behavior is unchanged.
- `src/shell/icons.ts`: two entries bundle Lucide EyeOff and ListX for Hide column
  and Clear sort. No copied assets or new icon renderer.
- `package.json`: one changed script line appends the focused real-pointer test.

All other production edits are in `src/bases/` and `src/styles/bases.css`.
No changes to pane.ts, menu.ts, editors, sidebar, properties, settings, Rust,
backend contract, CSP, existing browser driver or other worktrees.

## Validation

- `npm run build`: passed; repeated by the final offline audit.
- `npm test`: passed: 50 Vitest files / 291 tests and the entire headless browser
  chain, including the new Filter/View script.
- `npm run test:geometry`: passed within that chain, with frontmatter and H1–H3
  in Live Preview, Source and Reading, including stationary fold/unfold clicks.
- `npm run audit:offline`: passed on final source: 157 source files, distribution,
  CSP, capabilities and dependencies.
- `cargo build --offline`: passed.
- `cargo test --offline`: passed: 37 tests, zero failures, plus binary/doc targets.
- Native observation and three-view return check: passed.
- `git diff --check`: passed. Restored 39 generated older-round files, including
  screenshots, canvas fixtures and `round30-shots/performance.json`.

The full run sampled Filter/View at frame 1, max 16.7/16.8ms, without animations.
The 1,000-note warm open was 12.6ms and maximum scroll frame 16.8ms. An earlier
full run hit one 33.4ms existing canvas drag frame; the unchanged threshold passed
at 16.8ms in the complete rerun. The only production change after that full pass
was the native faint-text color token; the focused pointer script and build/offline
checks passed again, including exact 171-grey text and icon assertions (Filter /
View max frames 16.8/16.7ms). No timing thresholds were relaxed.

The focused script uses CDP hover then click and keyboard events, including
stationary repeated Filter and View clicks. It checks exact global/local filter
diffs, all conjunctions, property/operator/value changes, nested groups, advanced
compound expressions, trash, row re-filtering, non-writing view switches,
independent tabs and return navigation, canonical Add view, header icons/Clear
sort, Properties width/muted options, and selected new-base title/real rename.
Five unit tests cover byte-preserving global/local writes, nested canonical YAML,
quotes, comments, CRLF, missing filters, view append/defaults and comparison parsing.

## Line counts

Tracked app files, excluding `/gen/`, counting newline bytes. Baseline `111a59b`:

- Production TS: 23,521 → 23,723 (**+202**).
- Test TS: 3,608 → 3,671 (**+63**).
- All TS: 27,129 → 27,394 (**+265**).
- CSS: 4,509 → 4,529 (**+20**).
- Rust: 3,314 → 3,314 (**0**).
- TS/CSS/Rust total: 34,952 → 35,237 (**+285**).
- App mjs: 7,533 → 7,644 (**+111**).

Evidence scripts outside the app add 49 mjs lines; total task mjs increase **+160**. All new files are under 800 lines; the largest
Bases production file is 170 lines. No new dependencies.

## Local commits

- `ae680ca` — Write only edited Bases filters and append table views.
- `7ec1ad7` — Edit Bases filters and switch table views per tab.
- `86cf615` — Check Bases filters and view changes with real pointer input.
- `6744ca6` — Keep a blurred filter commit from reopening its menu.
- `205bb89` — Match native unchecked property text and icon colors.
- `5f88314` — Record native Bases filter and multi-view return evidence.
- This notes commit — Document round 31 Part B results and held work.

## Held and next improvements

1. Column resize/reordering and the remaining header/property actions: useful
   for wider tables; about one small round for a bounded set of actions.
2. More expression/YAML coverage and visible formula errors: improves existing
   file compatibility; about one round per small group of native fixtures.
3. Results actions (limit/copy/export) and new-row creation: makes task tables
   easier to use; about one or two small rounds with native round trips.

Still held: cards/list views, Group, Search, New row/popover, summaries, Add formula,
full formula language, embedding, non-Markdown Bases, extra file facts (backlinks,
base name, embeds, full name, links), Sort/Properties drag handles and reordering,
header Summarize/Group by/Edit property/Property type, canvas indexing, disabled
canvas Align arrangements and earlier canvas leftovers. No further feature work
started.
