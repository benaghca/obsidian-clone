# Round 31 — Bases part 2, Part A

Implemented Part A only on `rebuild/r31-codex`, working only in this worktree.
No push, merge, owner vault, visible window, dependency or backend change.
Part B and the later features below remain held.

## What changed

- Flush table, measured column sizing with the last column filling, native toolbar
  placement/fonts, 14px header icons, `info`/function glyphs, right-side chevrons,
  underlined links, and 228-grey grid lines in the light theme. Dates, datetimes,
  checkboxes, text, numbers, list and tag pills reuse the Properties controls and
  styling. Replaced the old separate calendar/pill rendering.
- Cell commits use `setValue` / `addProperty` on the current frontmatter. Loaded
  notes change through their editor state and history; unloaded notes write only
  the changed text. Missing properties are added. Enter/blur commits; Escape
  cancels pending text/number/date/list input. File facts and formulas stay read-only.
- Focused editors remain in place while typing; the committed row re-sorts and
  re-filters when focus leaves the field, including Enter. Tag/list pills refresh
  in the focused cell without rebuilding the whole table. Serialized cell writes
  read the latest note text and keep unrelated properties/comments intact.
- Sort: change key, toggle direction, remove and Add sort. Properties: checked
  current columns first, supported file facts, note properties and existing
  formulas; Find or create filters the choices; toggles and Hide all work.
  Header right-click offers Hide column, ascending/descending sort and Clear sort.
  All use the existing instant menu component. Drag reordering is held.
- `write.ts` replaces only a view's `sort` or `order` block, or inserts the missing
  block, in canonical two-space/block-list YAML. Other bytes, quoted names,
  filters, comments outside the edited block, other views and CRLF are preserved.
  Empty lists and default views work. The reader gained scalar flow lists so
  Obsidian's existing `order: [file.name, status]` can be changed to a block list;
  broader YAML/expression work remains held.
- `Bases: Create new base`, explorer/folder `New base`, and the empty-tab action
  reuse canvas attachment creation's queue, naming, folder and open behavior.
  Content is exactly `views:\n  - type: table\n    name: View\n`; repeated creation
  chooses `Untitled.base`, `Untitled 1.base`, etc.

Toolbar decisions: Sort and Properties are enabled. Filter is visible, accented
when filters exist, and visibly disabled with a Part B explanation. Group, Search
and New row are omitted. View and results buttons are present; their menus are
held. Properties lists supported file facts; unsupported file facts are not
advertised. Add formula is visibly disabled.

## Native observation and measured comparison

Rechecked Obsidian 1.14.4 using the existing headless Ozone driver, private
HOME/XDG/profile and disposable scratch vault, in an unprivileged network
namespace with only loopback. Only public vault/workspace APIs, rendered DOM,
computed geometry and actual CDP pointer/key input were used. No application
code, stylesheet or assets were copied.

`round31-shots/observe.mjs` recreates the six notes and both bases at 1280x800.
Task F has priority 3 and the same past due date as A; the second view therefore
orders F, A, D under its date/name sorts and limit 3. Both apps show D, A, F, C, E
in the first view, with A and F marked late. Complete initial row values match.

Measurements (native / Grove):

- View left/top: 344/78 in both.
- Toolbar left/top: 352/83.094 / 352/83; height 28.891 / 29.
- Table/header left/top: 344/118.047 / 344/118.
- First view widths: **88, 72, 90, 128, 131, 414** in both.
- By-due widths: **78, 128, 74, 643** in native; same header-based rules in Grove.
- Header/body height 30 in both; header glyphs 14×14, glyph x = cell x+8,
  label x = cell x+26. Header/cell text 13.125px; header 400, rgb(92,92,92).
- Native uses its system UI font stack. Bases locally uses `ui-sans-serif` /
  `system-ui`, leaving the rest of Grove's interface font alone. This reproduces
  the current observed widths, which differ slightly from the merge brief.

Native typing changed the displayed cell while the saved note stayed unchanged;
Enter saved `status: Xopen`. Editing priority to zero kept D in place while
focused; Enter moved it behind C and ahead of the missing value. Grove matches.
Native Sort shows Sort by / key / direction / trash / Add sort; Properties has
Find or create, checked columns, remaining property choices and Hide all.

[Initial comparison](round31-shots/comparison.png),
[By-due comparison](round31-shots/due-comparison.png),
[Written-file comparison](round31-shots/written-comparison.png).
`roundtrip.mjs` opens the Grove-written sort/order YAML with the changed notes in
Obsidian, checks identical rows/columns/values, and verifies YAML bytes unchanged
on opening. `Grove-written.base`, source notes and structured captures are kept
beside the screenshots. All data is synthetic.

Reproduction: `unshare -Urn sh -c 'ip link set lo up; exec node /home/chris/workspaces/remote/grove-r31-codex/rebuild/round31-shots/observe.mjs'`;
use the same invocation with `roundtrip.mjs` for the native return check.

## Shared hooks (no shared refactors)

- `editor/properties.ts`: one exported `propertyValue` wrapper, optional value
  writer callback, and passing that callback through the existing list renderer.
  The ordinary Properties block keeps its existing writer. No duplicate typed
  editor or note YAML serializer was introduced.
- `noteEditors.ts`: two changed lines install the existing mirror history keys
  for owners too and let that path handle a read-only owner. It already temporarily
  enables the owner for undo/redo and restores the mode. This lets Reading undo a
  Bases property edit while remaining read-only; Live Preview/Source fall through
  to their existing history behavior.
- `fileOps.ts`: two changed lines let `newCanvas` accept an attachment kind and
  select the extension/initial content. Its queue, free naming and opening logic
  are shared with the four-line `bases/new.ts` wrapper.
- `appCommands.ts`: one import and one Bases command.
- `shell/menus.ts`: one import and two New base items (folder and vault menus).
- `shell/pane.ts`: one New base empty-tab action; 740 → 741 lines.
- `shell/icons.ts`: three bundled Lucide entries: chevron-up, list-filter,
  square-function.
- `shell/menu.ts`: one input-target guard so the Properties search field receives
  typing instead of menu type-ahead; Escape still closes the menu.
- `package.json`: append the focused editing script to the test chain.
- `scripts/test-r27{e,g,i,j}.mjs`: update only empty-tab action expectations
  for the explicitly requested New base action (including its icon and the
  shifted Go to file index). Timing and geometry assertions remain unchanged.

No changes to settings, sidebar, search, backlinks/outline, Reading rendering,
canvas, Rust or the existing browser driver.

## Validation

- `npm run build`: passed.
- `npm test`: passed, including 49 Vitest files / 285 unit tests and the full
  headless real-pointer browser chain.
- `npm run test:geometry`: passed separately, including frontmatter, H1–H3,
  Live Preview, Source, Reading and stationary fold/unfold clicks.
- `npm run audit:offline`: passed; 155 source files, distribution, CSP,
  capabilities and dependencies checked.
- `cargo build --offline`: passed.
- `cargo test --offline`: passed; 37 tests, zero failures, plus binary/doc targets.
- Native return check: passed; Grove-written YAML opens with identical
  rows/columns/values and stays byte-identical on opening.
- `git diff --check`: passed. Restored 36 generated older-round fixtures;
  no older-round screenshot or canvas fixture changes are retained.

All browser checks ran headlessly against synthetic fixtures. Rust checks used
the existing dependency cache, without network access or an application window.

The focused test uses real pointer/key input for clicked text caret placement,
commit/cancel, missing properties, date/datetime segments, checkboxes, adding and
removing list/tag pills, post-commit sorting/filtering, all sort operations,
column search/toggle/Hide all, stationary repeated Sort and checkbox clicks,
command-palette creation and both explorer creation menus. It checks exact note
bytes and base bytes, and verifies editor undo in Live Preview, Source and Reading
(with Reading still read-only afterward). New menus are visible within two
frames, have no animation and stay below 20ms in the sampled first 300ms.

The existing round 30 read-only, byte-preservation, cached-index and 1,000-note
checks also pass with editable controls: final full run warm open 8.9ms, maximum
scroll frame 16.8ms. Sort and Properties sampled maximum frames were 16.8ms and
16.7ms respectively. Four writer unit tests cover lossless writes, both EOL
styles, empty/default views, another view, flow lists and all supported round 30
fixtures. A label regression test keeps note keys such as `constructor` literal
instead of consulting inherited file-label keys.

## Line counts

Tracked app files only, excluding `/gen/`, newline-byte counts as requested;
baseline `0323354` (the round 30 integration).

- Production TS: 22,727 → 22,981 (**+254**).
- Test TS: 3,560 → 3,599 (**+39**).
- All TS: 26,287 → 26,580 (**+293**).
- CSS: 4,239 → 4,269 (**+30**).
- Rust: 3,314 → 3,314 (**0**).
- TS/CSS/Rust: 33,840 → 34,163 (**+323**).
- App mjs: 6,639 → 6,736 (**+97**).

Evidence scripts outside the app add 76 mjs lines; total task mjs increase +173.
All new code files are well under 800 lines; the largest Bases file is 165 lines.
No dependency added.

## Local commits

- `54636fc` — Write only the edited Bases sort or order block.
- `3da3209` — Edit Bases cells through shared Properties controls and note history.
- `a190856` — Create new Bases through existing attachment naming and menus.
- `70bfb9e` — Match Bases table geometry and add Sort and Properties menus.
- `7e8b148` — Verify editable Bases and literal property labels.
- `c771da3` — Record round 31 pointer checks and native Bases round trips.
- This notes commit — Document round 31 Part A results and held work.

## Held and next improvements

1. **Part B: Filter editor and view menu**, using the same lossless writer. This
   makes existing multi-view bases configurable; about one small round. Not started.
2. **Column sizing/reordering and remaining Properties/header actions.** These
   improve navigation in wider tables; about one small round for a bounded set.
3. **More expressions/YAML and visible formula errors.** Native fixtures should
   drive each addition so compatibility stays reviewable; about one round per
   small function/format group.

Also held: cards/list views, Group by, Search, New row/popover, summaries, results
menu/limit/export, Add formula/full formulas, embedding, non-Markdown Bases, column
resize/drag, property type/Edit property header actions, canvas indexing, disabled
canvas Align arrangements and the round 29 canvas leftovers. Part A only; stop.
