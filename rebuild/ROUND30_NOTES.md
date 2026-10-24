# Round 30 — Bases Part A

Read-only first-table views for `.base` files, on `rebuild/r30-codex` from
`b5e6af7`. Only this worktree was used. No push, merge, owner vault, visible
window, new dependency, backend command or canvas change.

## Built

- Small block-YAML reader: maps/lists, quoted/plain scalars, numbers, booleans,
  comments, empty collections. Invalid or unsupported YAML gets a readable error.
  The reader never serializes or writes a base.
- First table view with default `View` / `file name`, global and view filters,
  column order and display names, numeric/date/name sorting, multiple sort keys,
  empty values last in either direction, and a result limit.
- Boolean filter trees and the requested comparisons, logical operators,
  folder/tag/link predicates, text/list `contains`, `today()` and `if()`.
  Expressions are interpreted; no JavaScript evaluation. Unsupported expressions
  produce a notice; formula values stay blank and unsupported filter leaves
  exclude rows. Formula cycles are bounded and reported.
- Read-only file links, numbers, date/time inputs using the Properties formatting,
  calendar icons, pills and disabled checkboxes; existing property type icons.
  Normal, Ctrl/Cmd and middle-click links reuse standard open destinations.
- Existing property index supplies cached frontmatter and unsaved loaded-note
  properties. File/doc/link events update rows after changes, additions, renames
  and deletes. Tags reuse the Tags view's index/readers; links reuse the vault
  link index. The base itself is only reread when it changes.
- Above 200 results, the table keeps only viewport rows plus overscan in the DOM.
  Header/body rows are 30px with 13.125px text and 4px/8px cell padding.

The toolbar shows the view name, chevron and result count. Sort/Group/Filter/
Properties/Search/New buttons are omitted because their write behavior is held.
There is no view switching, cell editing, column resizing, grouping, embedding,
full YAML or full formula language. Unknown view types show an error. No data is
written to `.base` files on opening, clicking, keyboard input or scrolling.

## Native observation and evidence

Obsidian 1.14.4 ran with Electron's headless Ozone backend, private HOME/XDG/profile
and a disposable scratch vault, inside an unprivileged network namespace with
only private loopback. Observation used public vault/workspace APIs and rendered
DOM/input values, never application code, stylesheets or assets.

Reproduction: `unshare -Urn sh -c 'ip link set lo up; exec node /home/chris/workspaces/remote/grove-r30-codex/rebuild/round30-shots/observe.mjs'`.
Fixtures and captured row/column/value observations are in `round30-shots/`.
The fixture dates 2000/2099 keep the late formula deterministic; two additional
notes exercise equal priorities and missing values.

- Tasks: D, A, F, C, E, with priorities 5, 3, 3, 2, empty; only A is late.
  Grove's complete sample columns and values equal the native capture.
- Multiple: C, F, A, B. Ascending numeric priority, descending name tie-break,
  global AND view filters, and limit 4 match.
- Not: A, C, E, F. Native `not: [a, b]` means neither condition may match.
- Functions: A, C, D, E, F. Folder, nested/inline tags, resolved links, file
  comparisons, and text/list `.contains()` match. `file.tags` is named `file tags`.
- Unsupported formula: six rows; native renders an error in each formula cell.
  Part A intentionally leaves these cells blank with one unsupported notice.
- Unsupported filter: zero rows, matching native. Invalid YAML shows an error in
  each app and keeps its bytes.
- An empty native base includes **all file types**, including the eight `.base`
  fixtures (14 results). Grove deliberately follows this task's Markdown-only
  scope: all included Markdown notes, one `file name` column. Its scratch mock
  vault also has the existing demo notes, so its default count differs.

[Side-by-side capture](round30-shots/comparison.png),
[Obsidian capture](round30-shots/obsidian.png),
[Grove capture](round30-shots/grove.png).
The screenshot comparison script places the two original captures beside one
another. Captures do not contain owner data. Native fixture bytes are checked
again after stationary cell clicks.

## Shared hooks

- `workspace.ts` (2 changed lines): recognize `.base` as an attachment and choose
  its new view type instead of loading a Markdown editor.
- `tabs.ts` (3 changed lines): include `base` in view types, use the already bundled
  table icon, and derive its title from the attachment path.
- `savedLayout.ts` (2 changed lines): recognize and restore the base type/path.
- `shell/pane.ts` (9 insertions / 8 deletions): base path/title breadcrumbs and
  mount/dispose the base through the existing canvas attachment-view slot. The
  factory result needs only `el` and `dispose`; canvas behavior stays intact.
- `shell/sidebar.ts` (2 changed lines): hide the `.base` suffix and reuse the
  existing table icon. The BASE tag already follows generically from extensions.
- `shell/quickSwitcher.ts` (1 changed line): include non-excluded `.base` files.
- `main.ts` (1 added line): import `styles/bases.css`.
- `package.json` (1 changed line): append `scripts/test-bases.mjs` to `npm test`.

No changes to properties, settings, search, outline/backlinks, Reading view,
editor commands, tab menus, the existing browser driver or icon definitions.

## Validation

- `npm run build`: passed.
- `npm test`: passed, including 48 unit files / 280 tests and the full browser
  chain (1,663 logged PASS checks). Includes the permanent frontmatter/H1–H3
  geometry and stationary fold/unfold checks in Live Preview, Source and Reading.
- Separate `npm run test:geometry`: passed.
- `npm run audit:offline`: passed (151 source files, distribution, CSP,
  capabilities and dependencies).
- `cargo build --offline`: passed.
- `cargo test --offline`: passed (37 tests).
- `git diff --check`: passed; 34 generated older-round screenshots/canvas fixtures
  restored. Only round 30 source, test and evidence changes are retained.

The final 1,000-note run opened with a warm property index in **9.1ms**; maximum
scroll frame was **16.7ms**. The source was frozen for the complete passing test
run. An earlier run was interrupted by Vite reloading after the final source edit;
the affected canvas-drop check also passed independently before the full rerun.

The focused CDP test uses real pointer and key input: explorer and quick switcher
opening, a rendered wikilink, normal and Ctrl-click file links, repeated cell
clicks without moving, double-clicked cells followed by typing, restored-tab
serialization, native scrollbar clicks and wheel scrolling. It also verifies
that a changed note rereads only its own frontmatter, and that the first inline
tag typed into a loaded note matches before the note is saved, even when the
saved tag index is empty. It compares native fixture rows/columns, checks sample
values, and verifies all fixture YAML bytes
plus the 1,000-row performance base remain identical.

Warm property-index opening is measured separately from cold indexing. Native
scrollbar input samples animation frames after the mock backend's delayed link
refresh has settled. Earlier wheel-only profiling showed alternating 16.7/33ms
RAF intervals from headless wheel scheduling; scroll row reconstruction and layout
were each under 1ms. The permanent test checks actual wheel movement separately
and keeps the strict <20ms frame threshold during native scrollbar scrolling.
No existing timing thresholds were changed.

## Line counts

Counts use tracked `*.ts`, `*.css`, `*.rs`, `*.mjs` from `rebuild/app`, excluding
`/gen/`, counting newline bytes as in the task. Baseline is `b5e6af7`.

- Production TS: 22,296 → 22,676 (**+380**).
- Test TS: 3,511 → 3,560 (**+49**).
- All TS: 25,807 → 26,236 (**+429**).
- CSS: 4,142 → 4,166 (**+24**).
- Rust: 3,314 → 3,314 (**0**).
- TS/CSS/Rust total: 33,263 → 33,716 (**+453**).
- App mjs: 6,297 → 6,413 (**+116**).

New Bases production TS is 378 lines across four files; the unit test is 49 lines
and the stylesheet 24. Shared production hooks net +2 TS lines. Proof scripts
under `rebuild/round30-shots/` add 125 mjs lines (96 fixture, 18 native
observation, 11 comparison), outside the task's app-only count: +241 mjs lines
across this task including evidence.

## Local commits

- `9bd3c86` — Read Bases YAML and evaluate table filters and sorting.
- `17e956f` — Open base attachments as read-only indexed tables.
- `0cd2275` — Include the first unsaved tag when the saved tag index is empty.
- `7c61698` — Check Bases with native pointer input and Obsidian fixtures.
- This notes commit — Document round 30 results and held improvements.

## Next improvements (held)

1. Read-only view switching and measured native column widths: makes multi-view
   bases useful and improves layout fidelity; about one small round.
2. Cell editing with lossless YAML/property writes and real native round trips:
   enables task management safely; about one or two rounds, including menus.
3. Extend expressions and YAML only against additional native fixtures: reduces
   unsupported notices in existing bases; about one small round per bounded
   group of functions or YAML constructs.
