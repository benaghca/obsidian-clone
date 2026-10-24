# Round 26 — Part A: canvas arrows

Baseline `0fe6a72`, worktree `grove-r26-codex`, branch `rebuild/r26-codex`.
Part A only. Part B's edge toolbar and label editing remain unimplemented.
No dependencies or backend commands were added. All commits are local.

## Observation

Observed installed Obsidian **1.14.4-2**, using the existing round-25 driver
with headless Ozone, private HOME/XDG/profile/vault directories under this
worktree, and an isolated loopback-only network namespace. Only public
workspace/vault APIs, rendered DOM measurements and CDP input were used;
no application code, stylesheet or assets were read/copied.

- Hovered/selected cards expose four **20×20px** connection targets at side
  midpoints. The individual target's accent circle appears on hover, with
  a 3px gray border. [Native hover](round26-shots/obsidian-dots.png).
- Dragging a dot creates a preview and snaps to the nearest target border.
  A 220×140 target's center picks **top**, the nearer horizontal border;
  choosing near its left border picks left. Releasing on the source card
  does not create a self-connection.
- An edge has a transparent **24px** interaction stroke and a **2px**
  display stroke. Selection thickens the display stroke to **5.5px**, in
  its existing color, with a pale surrounding highlight. Clicking an edge
  selects it; Delete removes that edge, and Undo restores its ID/content.
  [Selection](round26-shots/obsidian-edge-selected.png).
- Existing ends reconnect by dragging the exposed path/arrow near a card:
  the target arrow just outside the card's top reattached to Gamma's top;
  the source segment outside Alpha's right reattached to Beta's left.
  Both retained the original edge ID. [Reconnect](round26-shots/obsidian-reconnected.png).
- Empty-background drops open **Add card**, then **Add note from vault**.
  Escape leaves the document unchanged. **Deferred:** Grove cancels empty
  new/reconnect drops without a menu or file change. The brief explicitly
  permits leaving the add-card menu for later.
- New edges write **16 lower-case hex characters** as their ID, in order:
  `id`, `fromNode`, `fromSide`, `toNode`, `toSide`. Default source/no-arrow
  and target/arrow omit both end keys. Nondirectional adds `toEnd:"none"`;
  bidirectional adds `fromEnd:"arrow"`; unidirectional removes both keys.
  Optional `color` precedes `label` in native output. Flat edge records sit
  on one line inside tab-indented JSON, without a trailing newline.
- Observed for Part B, without implementing it: the native edge toolbar
  is Remove (trash-2), Set color (palette), Zoom to selection, Line direction
  (arrow-right), Edit label (edit), in that order. Direction menu rows are
  Nondirectional, Unidirectional and Bidirectional; icons are horizontal
  line, arrow-right and move-horizontal. Color uses the same six presets
  and custom picker as cards. A red choice writes `color:"1"`.
- Double-clicking the path creates a contenteditable `canvas-path-label`;
  typing and Enter writes `label`. Double-clicking the label edits it in
  place. Native label insertion/editing and the direction variants were
  recorded for the later Part B implementation.

Drivers and results: [arrows](round26-shots/observe-arrows.mjs),
[measurements and JSON](round26-shots/obsidian-arrows.txt),
[menus/labels](round26-shots/observe-edge-menus.mjs),
[menu/label results](round26-shots/obsidian-menus.txt).
Run these with `unshare -Urn sh -c 'ip link set lo up; exec node <driver>'`.

## Implementation and commits

1. `e91a3d8` — Extend the existing document patcher for edge creation,
   endpoint updates and deletion, retaining other records, metadata and key
   order. Reuse the existing curve's anchors and add nearest-border lookup.
   Serializer/geometry tests cover native field order, implicit arrowheads,
   unknown fields and mixed deletion.
2. `29fbcf5` — Add connection targets, live previews, forgiving edge hit
   paths, selection and endpoint reconnection to the existing renderer and
   `canvasEditing` pointer handler. Reuse `dragPointer`, canvas transforms,
   serializer, debounced saving and history. Shift-click supports mixed
   card/edge selection; Delete/Backspace removes selected edges and cards,
   including incident edges. Existing labels can select edges; label
   editing and edge-only toolbar actions remain Part B.
3. `69b2c75` — Keep node and edge selection/deletion IDs independent, even
   when a card and an unrelated edge share the same ID. Support grabs of
   an exposed selected path within 24 screen pixels of its end, matching
   the native source-end observation. Native-input and serializer tests
   cover both behaviors.
4. `191289c` — Scope inverse zoom sizing to fixed-size controls with a
   per-canvas stylesheet, released on disposal. The previous world-level
   variable inherited through all card Markdown and caused a 33.3ms zoom
   frame. The unchanged navigation checks now pass; native checks cover
   stylesheet cleanup and reopening.

Edge commits update/create only the affected edge DOM; they do not rebuild
cards or their editors. Card movement reuses the same placement helper for
visible strokes, hit paths, labels and reconnect targets. Preview arrowheads
reuse the existing arrow renderer and preserve a pre-authored edge's color
and direction. There is no new note/table typing path or opening motion.
Read-only blocks mutations and hides connector/grab targets. Escape, blur,
empty drops, self-drops and no-op reconnections write nothing. Each real
create/reconnect/delete is a single existing-history checkpoint, with
Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y and the history buttons covered by real input.

The profiler measured about **0.48s → 0.19s** of style recalculation over
24 wheel zoom updates after scoping control sizing. Pan/zoom retains the
existing unchanged-card-DOM assertion. Hidden connector/grab targets do not
receive inverse transforms until visible.
[Before profile](round26-shots/zoom-profile.log),
[after profile](round26-shots/zoom-profile-final.log),
[unchanged navigation suite](round26-shots/navigation.log).

## Round trip

All seven saved action snapshots open in native Obsidian with matching
card geometry and edge endpoints, sides, arrowheads, colors and labels;
every original disk byte stays unchanged, including unknown fields and key
order. Snapshots cover creation, target/source/side reconnection, metadata
preservation, edge-only deletion and mixed deletion. A native Obsidian
endpoint drag saves the same edge ID; Grove reads its new path without
rewriting the native file. [Round-trip driver](round26-shots/roundtrip-arrows.mjs),
[results](round26-shots/roundtrip.log),
[native return file](round26-shots/Obsidian-arrows.canvas).

- [Grove created edge](round26-shots/grove-edge-created.png),
  [Obsidian opening it](round26-shots/obsidian-grove-created.png).
- [Native reconnection](round26-shots/obsidian-reverse.png),
  [Grove return](round26-shots/grove-edges-return.png).

The round-trip fixture uses valid node/edge types with unknown fields.
An initial deliberately malformed fixture (future node type and null edge)
was rejected by Obsidian; those damaged/future-record cases remain covered
by the existing browser and serializer tests. To refresh the saved action
snapshots through real input, run
`GROVE_UPDATE_EDGE_FIXTURES=1 node scripts/test-canvas-edges.mjs` from the app,
then rerun the native round-trip driver. Normal tests leave those snapshots
and the native return fixture intact.

## App line counts

Tracked newline counts under `rebuild/app`, excluding `/gen/`, compared
with the baseline above; evidence/observation scripts outside the app are
excluded. [Machine-readable counts](round26-shots/line-counts-parta.json).

- Production TS: **20,577 → 20,679 (+102)**.
- Test TS: **3,214 → 3,252 (+38)**.
- Total TS: **23,791 → 23,931 (+140)**.
- CSS: **3,865 → 3,887 (+22)**.
- Rust: **3,145 → 3,145 (0)**.
- mjs: **3,179 → 3,287 (+108)**.
- TS/CSS/Rust: **30,801 → 30,963 (+162)**.
- Including mjs: **33,980 → 34,250 (+270)**.

No production file exceeds 800 lines; the largest remains `pane.ts` at
678. Canvas editing, view and CSS remain below 300 lines each.

## Next improvements

1. Part B: edge toolbar and label editing, using the observed existing
   menu/color/editor patterns. Makes direction, color and labels editable;
   roughly 100–200 production/test lines plus native checks.
2. Offer Add card / Add note after an empty connection drop. Completes the
   observed drawing workflow, reusing the existing card picker and a
   single compound history checkpoint; roughly 40–80 TS/test lines.
3. Round 27: canvas content in search, backlinks and graph, alongside
   group/note-card editing. Makes board content discoverable and finishes
   remaining card types; roughly 550–950 TS/Rust/test lines across slices.

## Verification

- `npm run build` and `npm run audit:offline` passed, including all **138**
  source files, built output, CSP, capabilities and dependencies.
  [Build](round26-shots/build.log), [audit](round26-shots/audit.log).
- Final `npm test` passed: **253 TypeScript tests in 44 files**, four
  browser-discovery tests, **1,034 named browser checks** and the existing
  paste cases. The new edge suite supplies **55** native-input checks:
  hover, stationary clicks, double-click Remove, nearest sides, both ends,
  no-ops/cancellation, self-drop rejection, independent/mixed selection,
  ID collisions, history, read-only, 2× zoom and stylesheet cleanup.
  [Full run](round26-shots/npm-test.log),
  [isolated edge suite](round26-shots/edges.log).
- The separate `npm run test:geometry` passed **187 checks**. Frontmatter
  notes in Live Preview, Source and Reading retain zero direct-child
  vertical margins, line positions within 1px and stationary fold/unfold
  arrows. All **18** popup checks passed within two frames with no sampled
  frame over 20ms; maximum **17.1ms** in both full and separate runs.
  Existing toolbar/palette latency assertions also passed.
  [Geometry](round26-shots/geometry.log).
- Full-suite 300-card/400-edge pan and zoom both sampled a maximum of
  **16.8ms**. Card drag, new-edge drag/commit and 401-edge reconnect/commit
  likewise stayed below 20ms, maximum **16.8ms**. Reconnection retains all
  existing card DOM nodes. No assertions, waits or frame thresholds were
  relaxed; the existing unchanged-card-DOM pan/zoom check is retained.
- `cargo build --offline` and `cargo test --offline` passed, all **34** Rust
  tests. Tauri was never launched. [Build](round26-shots/cargo-build.log),
  [tests](round26-shots/cargo-test.log).
- `git diff --check` and the staged whitespace check passed. Generated
  changes to older-round screenshots/fixtures were restored. No real
  vaults, real-screen windows, pushes or merges were used.

An [early full attempt](round26-shots/npm-test-first.log) stopped on the
existing Reading ribbon hover assertion while follow-up source edits were
underway; the unchanged canvas suite passed
[in isolation](round26-shots/canvas-rerun.log). The
[next full attempt](round26-shots/npm-test-zoom-first.log) caught the real
33.3ms zoom regression, fixed by scoping inverse sizing to controls in
`191289c`. The final complete run and separate geometry run passed with
source held fixed and no competing builds.

The notes/evidence commit completes Part A. Stop here; Part B requires the
separate user message.

# Part B — edge toolbar and labels

Authorized separately after Part A; baseline `a476c00`, same worktree and
branch. No new dependencies, Rust changes, pushes, merges or real vaults.

## Further native observation

The same installed Obsidian/private headless driver confirms the toolbar's
170×34px dimensions and order: Remove (`trash-2`), Set color (`palette`),
Zoom to selection, Line direction (`arrow-right`), Edit label (`edit`).
An existing label adds **Remove label** (`x-square`) immediately before
Edit label. Direction rows are Nondirectional, Unidirectional and
Bidirectional, with horizontal-line, arrow-right and move-horizontal icons.
The six presets and custom native color picker match the card palette.

Double-clicking a path or label opens a centered, 20px contenteditable
label; its empty editing box is 12×38px. Escape and clicking away keep the
draft. The follow-up empty-label experiment also clarifies the earlier
Enter observation: native Enter can insert a newline (`label:"\n"`). Grove
uses the brief's permitted smaller single-line editor: Enter, Escape or
blur finish the edit, and an empty string removes the key as requested.
[Observation driver](round26-shots/observe-partb.mjs),
[results](round26-shots/obsidian-partb.txt),
[native screenshot](round26-shots/obsidian-partb.png).

## Implementation and commits

- `6d7868c` — Extend the existing raw-document patcher to edge color,
  arrowheads and labels. Removing defaults deletes only those keys;
  inserting a new field respects native metadata order without moving
  existing or unknown keys. A serializer regression covers hex colors,
  head defaults, empty labels and unknown-field order.
- `1e2f8b7` — Reuse the existing selection toolbar, palette, native color
  input, shared menu, history and save path for selected edges. Add the
  observed direction menu and conditional Remove label action, using
  bundled Lucide icons. Color changes support mixed card/edge selections
  as one history step. Zoom/Shift+2 fit the selected curve bounds. A small
  geometry helper computes exact extrema without an SVG layout read.
  Visible strokes, head colors/directions and labels update incrementally;
  card DOM and editors stay intact. Both heads share one existing arrow
  marker. Double-clicking a path or label, or Edit label, starts a temporary
  plain-text label editor. Labels remain centered as attached cards move.
  Read-only blocks editing and retains zoom; no animations were added.

- `ab604d4` — Add the native CDP regression suite, 18 saved Grove action
  fixtures, the native return fixture and reproducible Obsidian observation/
  round-trip drivers. Wire the suite into `npm test`.

- `3d42a4a` — Dispose an open direction menu anchored inside the toolbar
  when an external canvas reload replaces that toolbar. Two real-pointer
  regressions check dismissal and prevent an old menu position from
  overwriting the externally changed document.

- `6dccac1` — Include the selected edge label in the toolbar placement
  bounds, preventing overlap, and reflect the current arrowheads in the
  direction button glyph. Native screenshot comparison and assertions
  cover label clearance and all three icons.
- `bb2e127` — Return focus to the canvas after toolbar mutations. Immediate
  Ctrl+Z/Ctrl+Y on each direction choice and a single Remove click exposed
  focus loss when a toolbar button was moved/removed. Native input now
  verifies history without an intervening canvas click.

The native-input regressions cover the keyboard deletion guard for a
`plaintext-only` editor and a double click falling on the shifted Edit
label control after Remove label disappears. The second click cannot
start another label edit or create a card.

Profiling caught a real large-board regression: enlarged label backgrounds
made Chromium's Layerize work take about 43–49ms, yielding 50–66.7ms frames.
The comparison with Part A and the old stylesheet isolated label painting.
Keeping the labels on transform layers removes that long compositing work
while retaining the observed padding/line height. The existing 20ms
thresholds remain unchanged.
[Before trace summary](round26-shots/label-layer-before-partb.log),
[after](round26-shots/label-layer-after-partb.log).

## Part B round trip

All **18** `Grove-B-*.canvas` action snapshots open in Obsidian with every
known displayed property matching and every original disk byte unchanged:
six presets, default, a native-picker hex color, all three directions,
path label insertion, label double-click editing, toolbar/blur editing,
empty removal, Remove label, edge deletion and mixed-selection color.
Unknown root/node/edge fields and their order survive Grove's changes.
Obsidian then edits a label, chooses bidirectional and yellow, and saves
`Obsidian-partb.canvas`; Grove renders that native result without rewriting
it. Zoom is verified to leave file bytes unchanged.
[Driver](round26-shots/roundtrip-partb.mjs),
[results](round26-shots/roundtrip-partb.log),
[native return](round26-shots/obsidian-partb-return.png),
[Grove return](round26-shots/grove-partb-return.png).

## Part B line counts

Using tracked app files and excluding `/gen/`, with newline counts matching
the brief's `git ls-files`/`wc -l` method. Baseline is the Part A stop.
[Machine-readable counts](round26-shots/line-counts-partb.json).

- Production TS: **20,679 → 20,775 (+96)**.
- Test TS: **3,252 → 3,262 (+10)**.
- Total TS: **23,931 → 24,037 (+106)**.
- CSS: **3,887 → 3,891 (+4)**.
- Rust: **3,145 → 3,145 (0)**.
- mjs: **3,287 → 3,362 (+75)**.
- TS/CSS/Rust: **30,963 → 31,073 (+110)**.
- Including mjs: **34,250 → 34,435 (+185)**.

The largest production file remains `pane.ts` at 678 lines; the canvas
view remains below 330. Across all of round 26, TS/CSS/Rust grow by 272
lines from the round-25 baseline.

## Next improvements after Part B

1. Offer Add card / Add note after an empty connection drop. Completes the
   observed drawing workflow with existing pickers and one compound undo
   step; roughly 40–80 TS/test lines.
2. Round 27 canvas indexing plus group/note-card editing. Makes board
   content discoverable in search/backlinks/graph and completes remaining
   card editing; roughly 550–950 TS/Rust/test lines across small slices.

## Part B verification

- `npm run build` passed. [Build](round26-shots/build-partb.log).
- Final `npm test` passed: **254 TypeScript tests in 44 files**, four
  browser-discovery tests, **1,109 named browser checks** and existing paste
  cases. The new edge-control suite supplies **75** real CDP-input checks,
  including repeated stationary clicks, double-clicking toolbar buttons,
  preset/default/native-picker hex colors, all direction glyphs and saved
  defaults, immediate keyboard undo/redo, path/label/toolbar editing,
  empty/removal semantics, label clearance, mixed selection, read-only,
  stale-menu cleanup and native reverse-file rendering.
  [Full run](round26-shots/npm-test-partb.log),
  [focused edge run](round26-shots/edge-controls-partb.log).
- The separate `npm run test:geometry` passed **187 checks**, including
  frontmatter in Live Preview, Source and Reading, line tops within 1px,
  zero direct-child vertical margins and stationary fold/unfold arrows.
  All **18** popup checks opened within two frames; maximum sampled frame
  **17.0ms**. [Geometry](round26-shots/geometry-partb.log).
- Final 300-card/400-edge pan, zoom, card drag and edge create/commit all
  sampled a maximum **16.8ms**; 401-edge reconnect/commit also stayed at
  **16.8ms** while retaining every existing card DOM node. The new edge
  toolbar, palette and direction menu opened within two frames, maximum
  **16.7ms**, without animations. No thresholds or legacy assertions were
  relaxed.
- `npm run audit:offline` passed for **138** source files, built output,
  CSP, capabilities and dependencies. [Audit](round26-shots/audit-partb.log).
- `cargo build --offline` and `cargo test --offline` passed, including all
  **34** Rust tests. Tauri was never launched.
  [Rust build](round26-shots/cargo-build-partb.log),
  [Rust tests](round26-shots/cargo-test-partb.log).
- `git diff --check` and the staged whitespace check passed. Generated
  changes to prior-round snapshots were restored to avoid unrelated churn.
  All UI and native observations used private headless processes/scratch
  vaults; no owner-screen windows or real vaults were opened. No push or
  merge was performed.

The final local documentation commit records these appended notes, counts,
checked logs and screenshots. Part B is complete; stop after committing.

# Stage 3 fixes

Baseline `741d236`, after Grok's confirmed report. Work remains in
`grove-r26-codex` on `rebuild/r26-codex`; all commits are local. The
[unchanged hunter regression](app/scripts/test-r26-bugs.mjs) reproduced all
three bugs before changes. [Baseline output](round26-shots/stage3-baseline.log).

1. **Short edge labels — `bb02726`.** Verify the visible label beneath an
   overlapping reconnect handle, keeping covering cards ahead of labels.
   Label presses bypass endpoint-grab inference. Retain the label target
   across the two presses and handle its double-click during capture,
   before the background add-card handler can see a retargeted event.
   Repeated stationary double-clicks now edit the same label with unchanged
   file bytes. Controls/background clicks clear that remembered target;
   covering-card editing and deliberate background insertion still work.
2. **Outer connection dots — `4385e36`.** Reuse the existing drop predicate
   and nearest-side snapping, including the actual 20-screen-pixel square
   targets at the four side midpoints. Account for zoom and the card's 1px
   border; extend only the dot areas, leaving other outside drops invalid.
   Native pointer tests cover all four outer halves at 1× and 2×, exact
   one-step undo, and cancellation beyond the dots. The same gesture path
   handles both creation and reconnection.
3. **Clipped toolbar — `b829f12`.** Clamp the existing toolbar transform to
   a 10px viewport inset. Its own percentage width/height keep every button
   inside the view. The existing navigation draw publishes bounds through
   a toolbar-only stylesheet rule, so pan/zoom/resize update placement
   without child DOM mutations, per-frame element measurements or variables
   inherited through card Markdown. The reported bar now starts at **88px**
   with the canvas at **78px**, matching the native observation, and Set
   color is the actual hit target. Added checks cover stationary reopening,
   continuous pan without reselecting, left-edge clamping, zoom, resize and
   exact unchanged file bytes.

The added [boundary suite](app/scripts/test-r26-fixes.mjs) is wired into
`npm test` after the original regression. No existing assertions, timing
thresholds, geometry rules or test waits were weakened. No dependencies,
backend commands, file format changes, animations or `.cm-content` margins
were added. All affected source files remain below 320 lines.
[Fixed regression output](round26-shots/stage3-bugs.log),
[boundary output](round26-shots/stage3-boundaries.log),
[headless clamped-toolbar screenshot](round26-shots/grove-stage3-clamped.png).

## Stage 3 line counts

Tracked app files, excluding `/gen/`, relative to `741d236`; the baseline
already includes Grok's regression script.
[Machine-readable counts](round26-shots/line-counts-stage3.json).

- Production TS: **20,775 → 20,788 (+13)**.
- Test TS: **3,262 → 3,262 (0)**.
- Total TS: **24,037 → 24,050 (+13)**.
- CSS: **3,891 → 3,895 (+4)**.
- Rust: **3,145 → 3,145 (0)**.
- mjs: **3,481 → 3,518 (+37)**.
- TS/CSS/Rust: **31,073 → 31,090 (+17)**.
- Including mjs: **34,554 → 34,608 (+54)**.

## Stage 3 checks

- `npm run build` passed. [Build](round26-shots/stage3-build.log).
- `npm test` passed: **254 TS tests in 44 files**, four browser-discovery
  tests and **1,150 named browser checks**, including all six original
  hunter checks and **35** added boundary checks. The hunter script is
  unchanged from `741d236`. [Full run](round26-shots/stage3-npm-test.log).
- The included geometry suite passed **187 checks**: frontmatter notes in
  Live Preview, Source and Reading, zero direct-child vertical margins,
  line tops within 1px and stationary fold/unfold arrows. All **18** popup
  checks opened within two frames, maximum **17.1ms**, without animations.
- The 300-card/400-edge pan, zoom, card drag and edge creation/commit checks
  passed, maximum **16.8ms**; 401-edge reconnect/commit also stayed at
  **16.8ms**. The unchanged navigation assertion confirms no child DOM or
  geometry mutations during pan/zoom. [Focused navigation run](round26-shots/stage3-navigation.log).
- `npm run audit:offline` passed: 138 source files, built output, CSP,
  capabilities and dependencies. [Audit](round26-shots/stage3-audit.log).
- `cargo build --offline` and `cargo test --offline` passed, all **34** Rust
  tests. [Rust build](round26-shots/stage3-cargo-build.log),
  [Rust tests](round26-shots/stage3-cargo-test.log).
- Whitespace checks passed. Older generated snapshots were restored to
  avoid unrelated churn. All UI checks used private headless Chromium and
  the mock vault; no owner-screen windows, real vaults, pushes or merges.

The local notes/evidence commit completes Stage 3. Stop after committing.
