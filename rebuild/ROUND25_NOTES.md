# Round 25 — Part A cleanup

Baseline: `c44239facf38ac361d8bc0de2a9d88c56f1f8556`, worktree
`grove-r25-codex`, branch `rebuild/r25-codex`. Part A only. Part B remains
unimplemented. All commits are local; nothing was pushed or merged.

The production cut is **22 lines** (8 TypeScript, 14 CSS), below the
suggested 250-line target. Including browser scripts, the cut is **31 lines**.
I kept the cuts small rather than remove useful code, compress formatting,
or change behavior to meet the aspirational count. No dependencies were added.

## Cuts and reasons

- `716ea03` — Remove obsolete prompt/menu exit-motion plumbing: **10 lines
  saved** (TS −4, CSS −6; 4 added, 14 deleted). Checked the menu and modal
  selectors across all stylesheets: neither has entry/exit animation or
  transitions. `animateOut` therefore already removed these elements
  synchronously. Direct removal preserves focus restoration and listener
  cleanup. The two closing-state pointer rules are unreachable during a
  rendered frame; removed the old comments claiming an animated exit.
- `9e13775` — Reuse canvas link, bounds and keyboard-button helpers:
  **1 TS line saved** (13 added, 14 deleted), also removing a duplicated
  bounds calculation and link-resolution body. Cards and navigation use
  the shell's existing `keyButton`; navigation retains its distinct key
  propagation/focus behavior. Rendered card links call their existing
  editor host. Narrowed `whereFromEvent`'s type to its actual three return
  values; its implementation is unchanged.
- `5a7558b` — Share canvas fixture and native double-click test helpers:
  **9 mjs lines saved** (23 added, 32 deleted). The round-22 driver already
  owned Vite, Chromium, CDP and scratch-profile setup in every canvas
  suite. Extended it with the repeated fixture-open, current-file-read and
  double-click operations, then removed their local copies in the card,
  editing and round-24 regression suites. All assertions remain. Different
  drag sampling/timing and specialized fixtures stay local.
- `d347d6a` — Remove redundant canvas rules and share pane declarations:
  **8 CSS lines saved** (14 added, 22 deleted). The four exact side-resizer
  offsets were duplicated by the later prefix/suffix selectors at the same
  specificity. Canvas H1 line-height already comes from `.cm-line.cm-h1`.
  Merged the two canvas-view rules and grouped identical pane declarations,
  retaining selector specificity and the root's original minimum height.
- `640bc31` — Share recent-note ordering between links and the switcher:
  **3 TS lines saved** (13 added, 16 deleted). Their duplicate selection
  loops now use `recentNotes` in the existing switcher-items module. Links
  still normalize lookup keys case-insensitively, include attachments and
  unresolved names, and append every remaining candidate. The switcher
  still excludes the active file and caps results at 50.

## Review boundaries

TypeScript already enables `noUnusedLocals` and `noUnusedParameters`;
`tsc --noEmit` passed. Searches of exported names and CSS classes found no
safe wholesale module/selector deletion. Dynamic class names and token
uses were checked as well: for example, `--color-gray` has no literal
`var()` reference but is used by quote callouts, so it remains.

Canvas gestures already use `dragPointer`, card pickers already use the
shared prompt/switcher/media helpers, and all icon tooltips already use
`installTooltips`. Ordinary tag-row native titles serve a different label
and were retained. Canvas history checkpoints have different lifetimes
(gesture versus text session versus addition); their no-op checkpoint
handling and serializer's unknown-field/key-order preservation remain.
No per-keystroke note processing was added.

No file needed splitting. The existing largest production files remain
678 lines (`pane.ts`), 644 (`workspace.ts`), 611 (`livePreview.ts`), 609
(`graph/view.ts`) and 602 (`settings.css`).

## Visual comparison

[Reproduction driver](round25-shots/compare.mjs), run with `before` and
`after`, captures 1280×800 headless Chromium using only the in-memory mock
vault and an added mock canvas. It hides the caret in both runs for stable
comparison; input uses native CDP pointer/key events.

All **16 PNG pairs are byte-identical**, including their pixels
([hash comparison](round25-shots/screenshot-comparison.json)):

- Light and dark Welcome with the file explorer.
- Light and dark Callouts/tables/image embeds in Live Preview, Source and
  Reading (six pairs).
- Light and dark canvas with a group, labelled edge and selected card.
- Light and dark Settings, quick switcher and the shared tooltip.

Before/after examples: [Welcome before](round25-shots/before/light-welcome-explorer.png),
[after](round25-shots/after/light-welcome-explorer.png);
[canvas before](round25-shots/before/light-canvas.png),
[after](round25-shots/after/light-canvas.png);
[blocks before](round25-shots/before/dark-blocks-reading.png),
[after](round25-shots/after/dark-blocks-reading.png).

## Verification

All required checks passed on the completed code:

- `npm test`: **42 TypeScript test files, 238 tests**, **850 named browser
  checks**, four browser-discovery tests and the existing paste checks.
  [Full output](round25-shots/full-tests.txt). Assertions and thresholds
  were retained, including all round-23/24 hunter regressions.
- Permanent geometry: line tops within 1px, zero direct-child vertical
  margins and stationary folding checks passed, including frontmatter
  notes in Live Preview, Source and Reading.
- All **18** instant switcher/palette/context-menu checks passed within
  two frames, without a frame over 20ms. The 300-card/400-edge pan and
  zoom checks each sampled 70 frames, maximum **16.8ms**. The native card
  drag sampled 49 intervals, maximum **16.8ms**.
- `npm run audit:offline`, including `npm run build`: passed, checking
  137 source files, built output, CSP, capabilities and dependencies.
  [Output](round25-shots/offline-audit.txt).
- `cargo build --offline` and `cargo test --offline`: passed; all **34**
  Rust tests. [Build](round25-shots/cargo-build.txt),
  [tests](round25-shots/cargo-test.txt). Tauri was never launched.
- `git diff --check`: passed. No owner's vault was accessed and no window
  was opened on the owner's screen.

The [first full attempt](round25-shots/full-tests-first-attempt.txt)
stopped when the header test's background-tab lookup returned null after
its first split/drop/reset sequence. The unchanged test then passed all
56 checks [in isolation](round25-shots/header-rerun.txt), and a complete
second `npm test` passed. The final full run had no concurrent build.
No test assertions, waits or performance thresholds were relaxed.

## Net app line counts

Tracked newline counts under `rebuild/app`, excluding `/gen/`, compared
with the baseline above. Screenshot/evidence scripts and these notes live
outside the app-source totals. [Machine-readable counts](round25-shots/line-counts.json).

- Production TypeScript: **20,336 → 20,328 (−8)**.
- Test TypeScript: **3,133 → 3,133 (0)**.
- CSS: **3,850 → 3,836 (−14)**.
- Rust: **3,145 → 3,145 (0)**.
- mjs: **2,778 → 2,769 (−9)**.
- TS/CSS/Rust: **30,464 → 30,442 (−22)**.
- Including mjs: **33,242 → 33,211 (−31)**.

The final notes/evidence commit contains this file and the verification
artifacts. Stop after Part A and wait for the separate Part B request.

# Part B — canvas controls and link subpaths

Part B starts at `a5dd6d3`. The two features have separate commits and tests,
followed by a small regression-fix commit. No dependencies, backend commands
or Rust changes were added. Everything remains local to `rebuild/r25-codex`.

## Observation

Observed installed Obsidian **1.14.4-2** (application 1.14.4), with headless
Ozone, private HOME/XDG/profile/vault directories and a loopback-only network
namespace. Drivers use public workspace/vault/editor APIs, rendered DOM and
computed measurements, and native CDP input. No owner's vault, real-screen
window, application code, stylesheet or SVG asset was accessed.

- Selected text-card toolbar: **137×34px**, 2px padding, 1px gaps, **32×28px**
  buttons, about 10px above the card. Order: Remove, Set color, Zoom to
  selection, Edit. Screen size stays constant while zooming.
- Right stack: settings; four zoom controls; Undo/Redo; help. Groups have
  8px gaps. Buttons are 32px wide, with 33px rows where separated. Settings
  offers Snap to grid, Snap to objects and Read-only. Snap preferences use
  `canvas.json`; read-only is a view state.
- Color menu: centered 24px swatches, 5px apart; default, six presets and a
  native color input. Presets write `"1"`–`"6"`; default removes `color`;
  custom values use hex strings.
- Heading choices preserve source text, including inline Markdown, show
  `H1`–`H6`, and start in document order. Queries use fuzzy ranking. `[[#`
  uses current-note headings; acceptance inserts `#Heading`.
- `^` and `#^` list block text with line breaks. Existing IDs appear
  separately and are searchable. New IDs are six lower-case hex characters.
  Paragraph/list-item IDs append inline; quote/code IDs get a separate line
  after the block. Existing IDs are reused without rewriting the target.
- Canvas editors resolve vault-note subpaths. Observed `[[#` inside a canvas
  card offers no note-local headings; Grove follows that boundary.

Evidence and reproduction drivers:
[controls/suggestions](round25-shots/obsidian-partb-observations.txt),
[labels, ID insertion and settings](round25-shots/obsidian-details.txt),
[canvas context](round25-shots/obsidian-canvas-links.txt),
[native picker](round25-shots/obsidian-custom-color.txt).

## Implementation and local commits

1. `8bf5c7a` — Canvas toolbar and settings/history/help groups, native
   regressions and serializer tests. Reuses `keyButton`, shared menus and
   tooltips, text-card editing, navigation, serialization and history.
   Snap preferences use the validated settings store. Read-only blocks
   mutations; help lists supported shortcuts. Group/note-card editors
   remain part of the planned later canvas work.
2. `4a129e6` — Heading/block suggestions in `wikilinkComplete.ts`, reusing
   the heading reader and CodeMirror fuzzy matcher. Target editor states
   include unsaved edits; parsing advances in 4ms slices. ID insertion
   uses `NoteEditors` and the existing save/undo/split path. A document
   guard rejects stale block choices; same-note edits map completion
   positions and the caret. Relative/Markdown settings apply to subpaths.
   Navigation and embeds recognize standalone quote/code IDs.
3. `71bcc69` — Match canvas color menus, fragment scope and history focus.
   Uses the native color input, centers the shared palette and marks its
   current swatch. No-op choices preserve bytes. History restores focus
   after rebuilding cards; external reloads close stale palettes. Menus
   handle outside pointer presses even when canvas gestures suppress mouse
   compatibility events. Native regressions cover these cases.

The native picker is tested for mouse/keyboard opening and cancellation.
Dedicated serializer tests cover hex values, color removal, key order and
future color values. A real preset choice supplies the native round trip.

## Round trip and screenshots

Grove's palette saves a green card. Obsidian opens it with identical
geometry, Markdown and color, leaving disk bytes untouched. A native
Obsidian palette choice then saves purple (`"6"`). Grove opens that file
with identical geometry/color and preserves its exact bytes.

- [Grove edit](round25-shots/grove-toolbar-green.png),
  [Obsidian opening it](round25-shots/obsidian-toolbar-from-grove.png).
- [Obsidian purple edit](round25-shots/obsidian-toolbar-purple.png),
  [Grove return](round25-shots/grove-controls-roundtrip.png).
- Saved [Grove](round25-shots/Grove-controls.canvas) and
  [Obsidian](round25-shots/Obsidian-controls.canvas) JSON;
  [round-trip assertions](round25-shots/roundtrip-controls-results.txt).
- [Heading choices](round25-shots/grove-heading-live.png),
  [Source](round25-shots/grove-heading-source.png),
  [canvas links](round25-shots/grove-canvas-suggestions.png),
  [native picker](round25-shots/grove-keyboard-color-picker.png).

These compare controls and saved content, not pixel identity: sidebar
widths, viewport framing and accents differ. Obsidian's custom zoom/snapping
icons use bundled Lucide equivalents. The 16 identical screenshot pairs
recorded earlier apply to Part A's cleanup checkpoint.

## Verification

- `npm test` passed: **245 TS tests in 44 files**, four browser-discovery
  tests, **943 named browser checks** and the existing paste cases.
  [Full output](round25-shots/full-tests-partb.txt). New native suites:
  **46 controls** ([output](round25-shots/canvas-controls-results.txt)) and
  **47 link subpaths** ([output](round25-shots/link-subpaths-results.txt)).
- CDP input moves over controls before pressing, includes stationary
  repeats, and covers frontmatter notes in Live Preview, Source and Reading
  plus canvases. Cases include ID reuse, concurrent target edits, relative
  and Markdown settings, read-only state, history, cancellation and saves.
- Permanent geometry passed: line tops within 1px, zero direct-child
  vertical margins, and visible arrows after stationary fold/unfold.
- All **18** instant popup checks passed within two frames; maximum sampled
  interval **17.1ms**. The new toolbar/palette also passed two-frame and
  no-frame-over-20ms checks. The 300-card pan/zoom/drag maximum was **16.8ms**.
- `npm run audit:offline`, including `npm run build`, passed: **138 source
  files**, output, CSP, capabilities and dependencies checked.
  [Output](round25-shots/offline-audit-partb.txt).
- `cargo build --offline` and `cargo test --offline` passed, all **34** Rust
  tests. Tauri was never launched. [Build](round25-shots/cargo-build-partb.txt),
  [tests](round25-shots/cargo-test-partb.txt).
- `git diff --check` passed. No real vault, real-screen window, push or merge.

An [earlier full run](round25-shots/full-tests-partb-first-attempt.txt)
caught keyboard redo losing focus after undo rebuilt the toolbar. Returning
focus to the canvas fixes it; the final full suite and native focus
regression pass. Assertions and thresholds were retained.

## Final app line counts

Tracked newline counts under `rebuild/app`, excluding `/gen/`. Part B
compares `a5dd6d3`; whole round compares `c44239f`. Notes, observation
scripts, screenshots and fixtures outside the app are excluded.
[Machine-readable counts](round25-shots/line-counts-partb.json).

- Production TS: **20,549**; Part B **+221**, whole round **+213**.
- Test TS: **3,191**; Part B and whole round **+58**.
- Total TS: **23,740**; Part B **+279**, whole round **+271**.
- CSS: **3,865**; Part B **+29**, whole round **+15**.
- Rust: **3,145**, unchanged.
- mjs: **2,912**; Part B **+143**, whole round **+134**.
- TS/CSS/Rust: **30,750**; Part B **+308**, whole round **+286**.
- Including mjs: **33,662**; Part B **+451**, whole round **+420**.

No source file exceeds 800 lines. The notes/evidence commit containing this
section completes Part B; stop here.

## Next improvements

1. Canvas arrows: create, reconnect, label and delete edges (round 26).
   This completes editing relationships between cards. Roughly 350–600
   TS/test lines using the existing edge model and history.
2. Canvas indexing for search, backlinks and graph (round 27). Board
   content becomes discoverable alongside notes. Roughly 250–450
   TS/Rust/test lines through the existing vault index.
3. Group and note-card editing (round 27). Makes the remaining card types
   editable in place. Roughly 300–500 TS/test lines, reusing the current
   editor and toolbar callbacks.

## Stage 3 fixes

Worktree `grove-r25-codex`, branch `rebuild/r25-codex`. Cherry-picked hunter
commit `3819656` as `8364964`, including its report, native-input regression
suite and `npm test` wiring. The fixes add **28 production TS lines net**;
no dependencies, CSS, Rust or opening animations were added.

1. **Remove double-click:** capture the first click's control target before
   its action removes the selection toolbar. The canvas retains that fact
   through the second click and ignores its background double-click. A new
   background double-click still creates a card normally.
2. **Heading block IDs:** share heading-label cleanup between suggestions,
   heading navigation and heading embeds. A trailing ` ^id` is metadata,
   so `Has id` is offered/inserted and resolves to `# Has id ^keep`.
3. **Heading pipes:** preserve the complete suggestion label, but remove
   pipes and collapse spaces in its target, matching the observed native
   Obsidian insertion `[[Land#Pipe split]]`. Navigation and embeds use the
   same normalization to find `# Pipe | split`. The private headless
   [observation](round25-shots/observe-stage3.mjs) and
   [results](round25-shots/obsidian-stage3.txt) also record toolbar positions.
   Native Obsidian retains a heading's block-ID text in its own suggestion;
   Grove deliberately removes it as requested in this stage.
4. **Block-reference undo:** insert the generated ID and accepted link in
   one isolated CodeMirror transaction when both belong to the current
   note; one Undo/Redo reverses/restores both, including mapped caret
   positions. **Cross-note limitation:** histories remain per file. Undo in
   the source restores the typed query; the generated ID remains in the
   target and is removed by one Undo there. Target insertions are isolated
   from other edits. There is no automatic cross-file rollback that could
   delete an ID another link has since reused. The prompt explicitly allows
   this limitation; the hunter's stronger cross-file assertion was changed
   to check both independent undo operations and exact target restoration.
5. **Toolbar over labels:** measure selected group/file labels and anchor
   the existing toolbar above their top edge, retaining its fixed screen
   size and existing gap. Every sampled pixel remains a label hit target,
   including a long file name after zoom-to-selection.
   [Group](round25-shots/grove-stage3-group.png),
   [zoomed file](round25-shots/grove-stage3-file.png).
6. **Nested list blocks:** recursively visit nested lists, emitting each
   item in document order. A parent's label, ID and insertion position end
   before its child list; blank lines and deeper ordered lists are covered.
7. **Heading-scoped blocks:** separate the file and heading in
   `[[Note#Heading^`, then limit rows using the existing heading index and
   the next heading of equal or lesser depth. Acceptance still inserts
   `#^id`; a missing section offers no unrelated rows.
8. **Canvas redo:** route Ctrl+Y through the existing redo callback and list
   it beside Ctrl+Shift+Z in Canvas help.

Expanded Reading checks exposed stale DOM selection after reopening an
already-read note: its noneditable content could not receive focus and a
correct heading jump drifted to the final blank line. One `tabindex="0"`
content attribute makes Reading focusable so CodeMirror can synchronize
selection. It remains noneditable and read-only; both heading cases now
land on their heading when revisiting the note.

### Stage 3 line changes

[Tracked app newline counts](round25-shots/line-counts-stage3.json), excluding
`/gen/` and evidence outside `rebuild/app`. Fixes compare `8364964`, after
importing the report; the full stage compares `4d04807`.

- Production TS: **20,577**, fixes/stage **+28**.
- Test TS: **3,214**, fixes/stage **+23**.
- Total TS: **23,791**, fixes/stage **+51**.
- CSS: **3,865**, net **0**; Rust: **3,145**, net **0**.
- mjs: **3,179**, fixes **+58**, full stage **+267** (includes the hunter's
  209-line browser regression).
- All app languages above: **33,980**, fixes **+109**, full stage **+318**.

### Stage 3 verification

- `npm run build` and `npm run audit:offline` passed; the audit checked
  138 source files, the output, CSP, capabilities and dependencies.
  [Build](round25-shots/stage3-build.log),
  [audit](round25-shots/stage3-audit.log).
- `npm test` passed: **248 TypeScript tests in 44 files**, four browser
  discovery tests, **979 named browser checks** and the existing paste
  cases. This includes the expanded **36-check hunter regression**, with
  native CDP pointer/keyboard input, stationary double-clicks, frontmatter
  notes in Live Preview/Source/Reading, independent cross-note undo, label
  hit-testing at two zoom levels, and canvas Ctrl+Y/help.
  [Full run](round25-shots/stage3-npm-test.log),
  [isolated regression](round25-shots/stage3-bugs.log).
- The separate `npm run test:geometry` also passed: all line positions
  within 1px, zero direct-child vertical margins and stationary fold/unfold
  in all three modes, with and without frontmatter. All 18 popup checks
  passed within two frames with no frame over 20ms; the full suite's
  maximum sampled popup interval was **17.0ms**. Existing toolbar/palette
  latency and 300-card/400-edge pan/zoom/drag checks passed; maximum drag
  interval **16.8ms**. [Geometry](round25-shots/stage3-geometry.log).
- `cargo build --offline` and `cargo test --offline` passed, **34 Rust
  tests**. [Build](round25-shots/stage3-cargo-build.log),
  [tests](round25-shots/stage3-cargo-test.log).
- Final diff whitespace checks passed. Test-generated changes to old-round
  evidence were restored. Everything ran headlessly in scratch/mock vaults;
  native Obsidian used private HOME/profile and an isolated loopback-only
  network namespace. No real vaults, real-screen windows, push or merge.
