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

# Part B — add cards and edit text

Part B starts at `2a5eaa9`. The implementation stays within adding text,
note and local image/SVG cards, plus editing text-card Markdown. The other
Round 23 suggestions were reviewed: field-preserving add/drag/resize/save
is now covered; canvas indexing remains a separate medium-sized round,
and offscreen Markdown rendering remains deferred while the 300-card board
meets the frame budget.

## Additional observation

Obsidian 1.14.4 again ran only on private Xvfb `:124`, scratch HOME/XDG/profile
and vault folders, in a loopback-only network namespace. No owner's vault,
visible-screen window, Tauri run, application source or stylesheet was used.

- The three bottom buttons are 48×48px, in a centered group 16px above the
  canvas bottom. Their rendered Lucide names are `sticky-note`, `file-text`
  and `file-image`; labels are “Drag to add card”, “Drag to add note from
  vault”, and “Drag to add media from vault”.
- Background double-click creates a 250×60 text card centered at the pointer,
  using whole board coordinates and a 16-character lower-case hex id.
  Text editing retains that size; overflowing Markdown scrolls within it.
  Escape ends editing and displays the rendered Markdown. Obsidian hosts
  its editing surface inside an iframe; Grove reuses its own CodeMirror.
- A note picker choice creates a 400×400 file card. The observed 320×160 SVG
  becomes a 400×200 image card. The note/media prompts support native
  pointer choices and keyboard dismissal.
- Text edits retain the tab-indented, compact-record JSON format observed
  in Part A. The settled saved Markdown and coordinates were read from disk,
  after waiting for Obsidian's autosave.

[Observation output](round24-shots/obsidian-partb-observations.txt),
[Obsidian additions screenshot](round24-shots/obsidian-partb.png),
[observed additions JSON](round24-shots/Obsidian-partb-additions.canvas).

## Changes

A 94-line `cards.ts` reuses the quick switcher's ranking/rendering and shared
prompt for note selection, and the existing attachment `pickFrom` helper
for local images/SVG. The toolbar uses bundled Lucide icons and the shared
instant tooltip behavior. Native toolbar drags add at the drop position;
a release outside the canvas cancels. No external drop support was added.

New text cards start editing immediately. Existing text cards enter editing
on double-click. The temporary editor uses `createNoteState`, including
Markdown, pairing, links, lists, tables and local editor history. Its host
resolves links relative to the canvas and saves only through the canvas
JSON document. Escape or a pointer press outside the card ends editing;
note cards remain read only. Escape is captured at the card editor so an
active completion cannot consume it. Wheel input inside an editing card
scrolls its text; ordinary board navigation remains unchanged.

Part A's debounce, atomic write path, pending-save flush and document undo
are reused. Each text-edit session adds one board undo checkpoint; undoing
an addition restores the original empty canvas bytes. New records append
without reordering existing records or unknown fields. Creating cards on
an empty canvas adds the `nodes` and `edges` arrays. Card styling is scoped
to the canvas, including its editor padding; no ordinary note keystroke
work or new dependency was introduced.

## Part B verification and round trip

All required checks passed on the finished code:

- `npm run build` and `npm run audit:offline`: passed. The audit checked
  137 source files, output, CSP, capabilities and dependencies.
- `npm test`: passed: 4 browser-discovery tests, 238 TypeScript tests in
  42 files, 842 named browser checks and the existing paste cases.
  [Full output](round24-shots/full-tests-partb.txt).
- All permanent geometry checks passed on frontmatter notes in Live Preview,
  Source and Reading: CodeMirror/DOM line tops within 1px, zero direct-child
  vertical margins and visible arrows after stationary fold/unfold clicks.
- All **18** instant menu/switcher/palette checks passed within two frames,
  with no frame over 20ms; maximum sampled opening interval **17.0ms**.
- The new Part B suite adds **37** checks: all three native toolbar hovers
  and stationary repeated clicks, pointer-centered creation, typing versus
  board keys, text scrolling, immediate Escape, unchanged-byte preservation,
  note/media filtering, sizes and local image rendering, add/text undo/redo,
  real toolbar dragging, cancelled outside drops, pending-save flush and the
  Obsidian fixture. [Part B output](round24-shots/canvas-cards-results.txt).
- The existing 300-card/400-edge tests still pass. Native drag: **49** sampled
  intervals, maximum **16.8ms**; pan and zoom: **70** intervals each, maximum
  **16.8ms**. Thresholds were not relaxed. These are fixture/machine results.
- `cargo build --offline` and `cargo test --offline` passed; **34** Rust tests.
  Tauri was not launched. `git diff --check` passed.
- A fresh native Obsidian round trip and **3** headless Grove return checks
  additionally verify the new Markdown, every geometry field and exact file
  bytes. [Return checks](round24-shots/roundtrip-grove-return-results.txt).

All interactive checks used native CDP input, including pointer hover before
pressing, intermediate drag moves and clicks without moving the pointer.
No DOM `.click()` or owner's vault was used.

Part B local commits:

1. `9dcd4b3` — toolbar creation, note/media pickers, text editing, native
   regressions and paired round-trip fixtures.
2. The notes/evidence commit containing this section — final screenshots,
   observations, verification output and language counts.

No push or merge was performed. Part B is complete; stop here.

Same saved new/edited card: [Grove](round24-shots/grove-partb.png),
[Obsidian opening Grove's file](round24-shots/obsidian-partb-from-grove.png).
Sidebar widths, viewport framing, configured accent and Obsidian's card
context toolbar differ. These compare saved card layout and content.

Fixtures: [Grove-created text](round24-shots/Grove-partb.canvas),
[Obsidian-edited text](round24-shots/Obsidian-partb.canvas).
The native Obsidian check compares the Grove file's text and every geometry
field, then double-clicks the card, replaces its Markdown and presses Escape.
Its actual disk output supplies the reverse Grove fixture.
[Round-trip evidence](round24-shots/roundtrip-partb-results.txt).

## Part B and final line counts

Tracked app newline counts, excluding `/gen/`. Part B compares `2a5eaa9`;
whole-round deltas compare integration `5e42368`. Test TypeScript remains
**3,133** lines.

- TypeScript: Part B **+147**, whole round **+340**, final **23,468**
  (production **20,335**).
- CSS: Part B **+9**, whole round **+27**, final **3,849**.
- Rust: **0** in both parts, final **3,145**.
- mjs: Part B **+80**, whole round **+174**, final **2,615**.
- JSON: **0** in both parts, final **2,229**.
- TS/CSS/Rust: Part B **+156**, whole round **+367**, final **30,462**.
- Including mjs: Part B **+236**, whole round **+541**, final **33,077**.

Fixtures, screenshots and notes are outside these source counts. The
largest canvas implementation file is 247 lines.

## Next improvements

1. Index canvas text and wikilinks for search, backlinks and graph results.
   This makes board content discoverable alongside notes. Roughly 250–450
   TS/Rust/test lines, with a shared extraction path in the existing index.
2. Add edge creation/editing and the remaining group/note-card interactions
   in separate small rounds. These complete everyday board editing.
   Roughly 400–700 TS/test lines across those rounds.
3. Render Markdown only near the viewport if larger boards show a measured
   opening/memory problem. This would help beyond the tested 300 cards;
   roughly 100–150 TS/test lines. Current measurements do not require it.
