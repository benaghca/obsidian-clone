# Round 32 — Bases Part A

Built only in `grove-r32-codex`, branch `rebuild/r32-codex`, from `a6dffd2`.
Part A only. No push, merge, owner vault, visible window, new dependency,
backend change or non-Bases feature work.

## What changed

- Every header has a 6×30px resizer straddling its right edge (edge−5 through
  edge+1), a col-resize cursor and an instant accent line. Dragging follows the
  pointer without snapping, previews locally, and writes once on release.
  Display and saved widths clamp to 40px. Escape cancels without writing.
  Double-click removes that column's size; other map entries remain, and an
  empty map is removed. Existing invalid sizes clamp on display without a write.
- `columnSize` uses full property ids (`note.due`, `file.name`, `formula.x`).
  The writer inserts/replaces/removes only that view's map, preserving other
  blocks, comments outside it, quoted names, other views and CRLF. Map keys are
  quoted when needed. Explicit widths are honored, including the last column;
  an unsized last column fills the viewport. Wider tables scroll horizontally.
- Header dragging moves a column before/after the target by its pointer half.
  The first column can move too. An instant drop line marks the slot. Escape or
  a release outside the header cancels; a plain click still does nothing and
  right-click still opens the header menu. Only `order` changes.
- Sort rows have 16×16 grab grips. Dragging rewrites only `sort`, keeps the menu
  open and redraws it. Date/datetime direction labels are Old to new / New to old;
  numbers use 0 → 1 / 1 → 0 and text A → Z / Z → A. File dates/sizes use their
  fact types. No Properties dragging was added.
- Add filter now opens a searchable property picker (file properties first),
  keeps incomplete rows only in the current menu session, and writes only when
  completed. Dismissing the incomplete row leaves the file unchanged. No-value
  is empty / is not empty operators can complete without a value. Existing
  expression evaluation and the same serialized read/modify/write queue are reused.
- Filter rows/value fields are 28px, icon buttons 28×24, and conjunction controls
  226px wide. Tag values have a clear icon.
- Add view now chooses View, then View 1, etc. The view menu is 225px, with Search...
  and a highlighted current view. Its options affordance is inert; Configure view
  and view-options functionality are held.
- Header menus check the active sort direction, show danger-red Clear sort, and
  separate the native groups. Held Summarize/Group/Edit property/Property type
  entries are visible but disabled. Properties uses a raised search field with
  a search icon, normal-colored (still disabled) Add formula and an eye-off Hide all.

The small pointer lifetime helper is shared by header interactions and Sort grips.
The existing automatic-width calculation and cell editor remain in place.
`view.ts` stays below 300 lines. No editor geometry code or `.cm-content` styles
were changed; there are no new transitions or animations.

## Native observations and compatibility

Rechecked Obsidian 1.14.4 at 1280×800, default light, using the existing headless
Ozone driver, private HOME/XDG/profile, synthetic BaseTest notes and a scratch
vault in a loopback-only network namespace. Observations use public vault/workspace
APIs, rendered DOM/computed geometry and real CDP pointer/key events only. No
application code, CSS or assets were copied.

- Initial widths: Task 78, Due date 128, priority 74, status 643; resizers 6×30.
- The first column is draggable: dropping Task after priority yields
  due, priority, file.name, status. It is not pinned.
- A +60px resize changes Due date 128 → 188 exactly and writes `note.due: 188`.
- Sort grip dragging swaps due ASC / file.name DESC to file.name DESC / due ASC.
  The date label is Old to new and the text label Z → A.
- Add filter shows file / links to / empty plus the property picker, and leaves
  the file unchanged while incomplete. Its native picker lists file facts then
  note properties. Grove advertises the supported facts only.
- Native writes reserialize the file; Grove deliberately keeps bytes outside the
  edited block. Native opens the Grove-written file with identical headers,
  column order, widths, rows and values, and opening does not change its YAML.

Original captures, structured observations, Grove-written YAML, synthetic notes,
return-check data and [side-by-side capture](round32-shots/comparison.png) are in
`round32-shots/`. Native reproduction:

```
unshare -Urn sh -c 'ip link set lo up; exec node /home/chris/workspaces/remote/grove-r32-codex/rebuild/round32-shots/observe.mjs'
unshare -Urn sh -c 'ip link set lo up; exec node /home/chris/workspaces/remote/grove-r32-codex/rebuild/round32-shots/roundtrip.mjs'
```

## Shared files and existing tests

- `src/shell/icons.ts`: one entry bundles the existing Lucide GripVertical icon.
- `package.json`: one script-line change appends `test-bases-columns.mjs`, keeping
  every previous test-chain entry.
- `scripts/test-bases-edit.mjs`: Sort button selectors account for the new grip,
  and the header action is chosen by title after adding the native held groups.
- `scripts/test-bases-menus.mjs`: Add filter tests choose from the new picker and
  do not expect an incomplete row to affect results; Add view expects View first.
  Existing assertions for bytes, menus, note editing and performance remain.

All other production changes are in `src/bases/` and `src/styles/bases.css`.
No changes to pane.ts, shared menu code, Grok's non-Bases files, Rust, dependencies,
CSP or the existing browser driver.

## Validation

- `npm run build`: passed; repeated on final source by the offline audit.
- `npm test`: passed, including 51 Vitest files / 295 tests and the complete
  headless real-pointer browser chain.
- `npm run test:geometry`: passed within that chain, including frontmatter,
  H1–H3, Live Preview, Source, Reading and stationary fold/unfold clicks.
- `npm run audit:offline`: passed; 159 source files, distribution, CSP,
  capabilities and dependencies checked.
- `cargo build --offline`: passed.
- `cargo test --offline`: passed; 37 tests, zero failures, plus binary/doc targets.
- Native observation and final return check: passed with identical widths,
  columns, rows and values; opening kept the YAML bytes unchanged.
- `git diff --check`: passed. Restored 45 older-round generated fixtures,
  including round 31/31B evidence and round30-shots/performance.json.

The final full run measured Sort / Filter / Properties / View on frame 1 after
click, with maximum frames 16.7 / 16.8 / 16.8 / 16.7ms and no animations. The
1,000-note warm open was 15.0ms; maximum scroll frame was 16.7ms. Existing canvas
300-card drag frames also passed at 16.7ms. No thresholds were relaxed.

The focused real-pointer script checks +60 and −400 drags, exact YAML diffs,
40px minimum, double-click reset, resize Escape, plain/stationary header clicks,
before/after header drops (including file.name), outside/Escape cancellations,
Sort grip swap/date labels, invalid existing sizes, incomplete/picker dismissal,
completed and no-value filters, row metrics, naming/search/highlight, checked/red
header actions, Properties icons/search and all four menu timings. Menu opening
is measured at the first animation frame after the actual click; all four are
required on frame 1 with no sampled frame ≥20ms during the first 300ms, and no
animations. Stationary clicks then close/reopen each menu without pointer movement.

Two unit tests cover columnSize insert/update/remove, other-view preservation,
comments/quoted keys/CRLF, and order/sort reordering with byte-exact block diffs.

## Line counts

Tracked app source (`src`, `src-tauri/src`, `vite.config.ts`, `src-tauri/build.rs`),
excluding `/gen/`, counting newline bytes; mjs counts app scripts. Baseline `a6dffd2`
(the brief atop integration `a68cf5c`):

- Production TS: 24,021 → 24,150 (**+129**).
- Test TS: 3,703 → 3,729 (**+26**).
- All TS: 27,724 → 27,879 (**+155**).
- CSS: 4,558 → 4,576 (**+18**).
- Rust: 3,314 → 3,314 (**0**).
- TS/CSS/Rust: 35,596 → 35,769 (**+173**).
- App mjs: 8,080 → 8,145 (**+65**).

Evidence scripts outside the app add 45 mjs lines; total task mjs increase **+110**.
No new dependencies; all new files are under 800 lines. The largest Bases
production file is view.ts at 182 lines.

## Local commits

- `e92da02` — Persist Bases column sizes without rewriting other YAML.
- `ca91f00` — Resize and reorder Bases headers and Sort rows with pointer input.
- `aa32a8d` — Keep incomplete Bases filter rows in menu session state.
- `9753afa` — Check Bases columns and menu gaps with real pointer input.
- `4c475fb` — Record native Bases column and Sort compatibility evidence.
- This notes commit — Document round 32 Part A results and held work.

## Held and next improvements

1. **Part B: results limit/copy and New row.** Makes tables useful for sharing and
   creating tasks; about one or two small rounds, with filtered-folder/frontmatter
   and popover behavior checked against native fixtures. Not started.
2. **Configure view and view options.** Adds explicit row-height and view-management
   controls; about one small round for a bounded set of options. Held here.
3. **More expression/YAML coverage and visible formula errors.** Improves existing
   file compatibility; about one round per small native-fixture group.

Also held: cards/list views, Group by, Search, summaries, Add formula/full formulas,
Export CSV, header Summarize/Group by/Edit property/Property type behavior, embedding,
non-Markdown Bases, extra file facts (backlinks, base name, embeds, full name, links),
canvas indexing, disabled canvas Align actions and earlier canvas leftovers.
Properties-menu reordering is not implemented: native has no grip there. Part A only.
