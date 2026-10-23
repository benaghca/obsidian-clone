# Round 24 — Canvas Part A

Baseline: integration `5e42368`, branch `rebuild/r24-codex`. Part A only:
selection, movement, resizing, deletion, saving and keyboard undo/redo.
No dependencies, Rust commands, capabilities, CSP changes or note typing-path
work were added. Part B is deferred.

## Observation

Observed installed Obsidian 1.14.4 on private Xvfb `:124`, with scratch
HOME/XDG/profile/vault folders. Obsidian and its CDP driver ran inside
`unshare -Urn`, with only loopback enabled. No owner's vault, Tauri window,
real-screen window, application source, stylesheet or asset was accessed.
Only public vault/workspace APIs, rendered DOM/computed metrics, saved JSON
and native CDP input were used.

- Single selection adds a 2px accent shadow around the existing card shadow.
  Four side and four corner resize targets surround it; side cursors are
  horizontal/vertical and corner cursors diagonal. Shift-click adds/removes
  a card. Empty background clears selection. A drag-box also selects cards
  that intersect it, including partial intersections.
- Moves snap to a 20-unit grid. Alt bypasses that grid, rounding positions
  to whole board units; Shift locks the dominant axis. Arrow keys move
  5 units; Shift-arrow moves 100; Alt-arrow did not move the card.
- Resizing reaches a 50×50 minimum. A group drag translates its fully
  contained card with it; deleting the group leaves the contained card.
- Delete and Backspace remove selected cards and their attached edges.
  Ctrl+Z and Ctrl+Shift+Z undo/redo movement, resizing and deletion.
- Settled autosaves use tab indentation, no spaces after JSON separators,
  one flat node/edge per line, expanded records containing nested objects,
  integer coordinates from these gestures, and no trailing newline.
  Obsidian moves the interacted-with card to the end and reorders some known
  keys. Grove keeps the existing record/key order, including unknown data,
  as the task requires. Initial observation snapshots can precede Obsidian's
  disk autosave; the round-trip driver polls the actual saved coordinates.
- For the later Part B: double-clicking empty background creates a 250×60
  text card centered on the click and starts editing. Observed generated ids
  are 16 lower-case hex characters. The bottom toolbar shows a blank-page,
  lined-page and image-page button, in that order, labelled “Drag to add
  card”, “Drag to add note from vault”, and “Drag to add media from vault”.
  Clicking the first adds a 250×60 text card at the viewport center; the
  others open vault-file/media pickers. These features were observed only.

Raw evidence: [selection/geometry](round24-shots/obsidian-observations.txt),
[settled save, toolbar actions and round trip](round24-shots/roundtrip-results.txt).

## Implementation

The existing parser remains a tolerant display projection. A 24-line
serializer patches only changed card records and filters deleted cards and
incident edges in the original JSON. Unrecognized nodes, null records,
nested fields and remaining array/key order survive edits. Merely opening,
selecting, panning or zooming never serializes or writes the file.

A small canvas-only pointer controller reuses `dragPointer`, the existing
world transform and the existing renderer. Movement/resizing updates card
geometry and incident curves/labels directly; it does not recreate Markdown
renderers during a drag. Selection outlines and eight invisible resize
hit targets follow the observed treatment. Shift-click deselection waits
until release so it does not prevent Shift-dragging. Escape cancels a drag.

Each completed gesture is one undo step. Saves debounce for 300ms through
`api.writeNote`/the existing atomic backend write, serialize concurrent
writes, notify the vault, and flush pending work when leaving the view or
unloading. External modifications reload the board and clear stale history;
local save notifications do not rebuild the current view. File-card content
refreshes redraw from the current canvas document rather than discarding a
pending edit. Asynchronous render and file-load generations are separate.

## Round trip and screenshots

Grove moves Card A from (0,0) to (40,20), keeping its nested `extra` field and
its edge's `future` field. Obsidian opens that saved file with identical
coordinates and dimensions for every card. A native Obsidian drag then
moves A to (80,40); its settled disk output is opened in Grove, checking
all rendered card geometry and exact untouched file bytes.

- Same saved edit: [Grove](round24-shots/grove-edit.png) and
  [Obsidian opening Grove's file](round24-shots/obsidian-from-grove.png).
  Sidebar widths, viewport scale and configured accent differ; these are
  layout/selection comparisons, not pixel-identity claims. Obsidian's card
  action bar and add toolbar belong to later editing work.
- Saved fixtures: [Grove](round24-shots/Grove.canvas),
  [Obsidian](round24-shots/Obsidian.canvas).
- Separate native-input stress checks preserve an unknown node, root data,
  nested fields, unknown edges and null records, and restore original bytes
  on undo. Malformed/future records are tested separately from the valid
  cross-application fixture.

## Verification

All required checks passed on the completed code:

- `npm run build` and `npm run audit:offline`: passed. The audit checked
  136 source files, built output, CSP, capabilities and dependencies.
- `npm test`: passed, including 4 browser-discovery tests, 238 TypeScript
  tests in 42 files, 805 named browser checks and the existing paste cases.
  [Complete output](round24-shots/full-tests.txt).
- Permanent geometry checks passed on plain/frontmatter notes in Live
  Preview, Source and Reading: every line within 1px of its CodeMirror top,
  no direct-child vertical margins, and stationary fold/unfold arrows visible.
- All 18 instant switcher/palette/context-menu checks passed within two
  frames, without animation or a frame over 20ms. Maximum sampled opening
  interval: **17.1ms**.
- The new native-input editing suite adds **36** checks, including stationary
  clicks, modifier gestures, live edges, both resize directions, undo/redo,
  group movement/deletion, unknown-field retention, cancellation, external
  reload, pending-save flush and the reverse round trip.
  [Editing output](round24-shots/canvas-editing-results.txt).
- On the 300-card/400-edge fixture, the new drag check sampled **49** frame
  intervals with maximum **16.8ms**. Existing pan/zoom checks each sampled
  **70** intervals, also maximum **16.8ms**. Every measured interval remained
  below 20ms; thresholds were unchanged. These are fixture/machine results.
- `cargo build` and `cargo test`: passed; all **34** Rust tests. Tauri was
  never launched. `git diff --check` passed.
- All browser input used real CDP move/press/release/key/wheel events,
  including intermediate drag moves and repeated stationary clicks. No DOM
  `.click()` was used.

## Local commits

1. `111d343` — Part A implementation, native editing regressions, and saved
   Grove/Obsidian round-trip fixtures.
2. The notes/evidence commit containing this file — observations, screenshots,
   complete verification output and final language counts.

Commits remain local. Nothing was pushed or merged. Part A is complete;
stop here until Part B is requested.

## Net app line changes

Tracked newline counts under `rebuild/app`, excluding `/gen/`, against
`5e42368`. Test TypeScript remains 3,133 lines.

- TypeScript: **+193**, final **23,321** (production **20,188**).
- CSS: **+18**, final **3,840**.
- Rust: **0**, final **3,145**.
- mjs scripts/tests: **+94**, final **2,535**.
- JSON: **0**, final **2,229**.
- TS/CSS/Rust total: **+211**, final **30,306**.
- Including mjs: **+305**, final **32,841**.

Screenshots, fixtures and these notes are outside the app-source counts.
The largest modified canvas source file is 209 lines. No new dependency.
