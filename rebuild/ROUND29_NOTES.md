# Round 29 — canvas polish

Worktree `grove-r29-codex`, branch `rebuild/r29-codex`, baseline `610855b`.
No dependency changes. All work and commits stayed in this worktree;
nothing was pushed or merged. Tests used headless browsers, private
profiles and scratch/mock vaults. No windows opened on the screen and no
owner vault was accessed.

## Observation

Observed installed Obsidian 1.14.4 with the existing headless driver,
private HOME/XDG/profile and scratch vault, in a loopback-only network
namespace. Used public vault/workspace APIs, rendered DOM and real CDP
input; no Obsidian application code, stylesheet or asset was copied.
[Driver](round29-shots/observe.mjs), [measurements](round29-shots/observe.log),
[native editing screenshot](round29-shots/obsidian-edit.png).
[Grove editing screenshot](round29-shots/grove-note-editor.png).

- The four card controls remain visible during in-place editing.
- Selected group container: 1px accent border, 2px accent ring plus the
  soft shadow, 8px radius. Label: 4px/8px padding, 4px radius, 22.5px text
  with 22.5px line height; the uncolored label has a faint gray background.
  Colored labels use a faint tint when unselected, and native solid color
  with white text when selected. Editing keeps the outlined input box.
- Group controls: Remove, Set color, Zoom to selection (Shift + 2), Align,
  Edit label, Set background. A background changes the last label to
  Edit background.
- Align offers left/center/right, top/middle/bottom, row/column/grid,
  horizontal/vertical spacing distribution and horizontal/vertical
  justification. Align left moves contained cards to their minimum x;
  the enclosing group retains its geometry.
- Background selection uses a searchable image picker. Edit background
  offers Replace background, Remove background, Cover, Keep aspect ratio,
  Repeat. The fields are `background` (vault path) and `backgroundStyle`
  (`ratio` or `repeat`); Cover omits the style key. Choosing ratio adjusts
  group width to image aspect times its current height.
- Fresh native actions omit the default Cover field. In an additional
  check, native Cover retained a `backgroundStyle: "repeat"` key loaded
  from disk; the explicit ratio action is used for the return fixture.
- Text-card preview measurements at zoom 1: first H1 top/bottom margins
  0/16px; paragraph/list margins 16/16px; H2 margins 40/16px. Native list
  items measured about 26.7px indent with the installed font; Grove uses
  the requested 27.5px. Native list item vertical padding was 1.2px.
  Native previews retain auto overflow in short cards, selected or not;
  [overflow measurements](round29-shots/overflow.log) and
  [driver](round29-shots/observe-overflow.mjs).

## Changes and local commits

1. `88d8ab0` — Small group-menu helper and native background fields.
   Six basic alignments reuse canvas geometry, repaint and undo. The
   image picker reuses the shared prompt, fuzzy matching and vault image
   loader. Backgrounds use local blob URLs, cover/repeat rendering and
   ratio conversion. Clearing a background removes both keys. Serializer
   coverage retains unknown fields/values and existing key order.
2. `a6006db` — Keep text/note editing toolbars visible and preserve focus
   across toolbar/color-menu input. Repaint passive file previews locally
   instead of rebuilding the board; keep the active editor, toolbar,
   selection and scroll surface mounted. Refresh image references locally
   and release their watches/URLs on disposal. Match selected borders and
   group label boxes. Add card-only block spacing with the existing
   Markdown parser and renderer; editable `.cm-content` is untouched.
3. `bf65c5f` — Permanent real-input regression suite and 13 group-action
   fixtures, native return fixture and driver. Notify previews after a
   cached note's canonical text finishes reloading. Guard the second click
   of a toolbar double-click from selecting the new image picker's first
   row accidentally. The existing group suite imports the new suite, so
   `npm test` runs it without a package manifest edit.
4. `0c2d937` — Match the native selected colored label state: solid color
   and white text, while retaining the faint tint when unselected.
5. `a302262` — Reuse the renderer's syntax tree and mark block starts/ends
   on existing lines instead of adding wrapper elements. Leave unchanged
   selection handles mounted. Give only the selected, non-editing card a
   compositor hint; editable CodeMirror geometry remains unaffected.
   Native scrolling is retained. The focused large-board drag check passes
   at 16.8ms after this change.
6. `d909248` — Update the round 27 canvas regression's later-heading
   expectation from 16px to the requested 40px. Keep its original half-em
   title-gap assertion. The focused suite passes.

The deliberate small-round limit: the Align menu shows all 13 observed
choices, but the seven arrangement/distribution/justification choices are
**disabled**. Six basic alignments are implemented. This uses the brief's
explicit allowance to show the observed menu and document remaining work.

Only two production source files outside canvas/CSS changed:

- `src/shell/icons.ts`: one line registering bundled Lucide
  `AlignStartVertical`, the observed group toolbar glyph.
- `src/noteEditors.ts`: one notification after successful external reload,
  plus its event comment. The existing saved/disk-change callback already
  routes to `vault.written`; emitting it after the canonical document
  changes lets loaded-note previews refresh accurately. Preview refreshes
  keep editor state authoritative and do not reload over pending edits.

No properties, explorer, tab, status-bar or new-tab implementation changed.
All production files remain below 800 lines. Canvas view: 372; editing:
242; group helper: 51; spacing helper: 19; canvas CSS: 181; NoteEditors: 455.

## Compatibility and checks

The 13 forward files cover all six alignments, color, label, background
selection, ratio, repeat, cover and removal. Each opens in Obsidian with
matching geometry, text, label, color and background/style, and its disk
bytes remain identical, including unknown fields and old key order.
Native Keep aspect ratio then creates a return file which Grove opens
with unchanged bytes and a local image.
[Round-trip driver](round29-shots/roundtrip.mjs),
[native results](round29-shots/roundtrip.log),
[return file](round29-shots/Obsidian-polish.canvas),
[native screenshot](round29-shots/obsidian-background.png),
[Grove return](round29-shots/grove-return.png).

Regenerate forward files with `GROVE_UPDATE_POLISH_FIXTURES=1 node
scripts/test-canvas-polish.mjs`; run the native driver with
`unshare -Urn sh -c 'ip link set lo up; exec node rebuild/round29-shots/roundtrip.mjs'`.

The new suite has **54 named checks**: real key insertion in text/note
cards; toolbar placement, color and focus preservation; repeated stationary
clicks and toolbar/menu double-clicks; passive and external cached-note
refreshes; measured card margins/indent; group controls and menu timings;
exact-byte alignment undo/redo; local background fields/styles; no remote
background loading; and the native return. New menus/picker opened within
two frames, maxima 16.7–16.8ms, without animations.
[Focused results](round29-shots/polish.log).

- `npm run build`: passed. [Build log](round29-shots/build.log).
- `npm test`: passed **274 TypeScript tests in 47 files**, all 4 browser
  discovery checks, and **1,600 named browser checks**, including the 54
  new polish checks. [Full log](round29-shots/npm-test.log).

All final large-board pan, zoom, card drag, edge creation/reconnection and
explorer-drag checks passed, each with a **16.8ms** maximum frame interval.
The pan/zoom no-child-DOM-mutations check also passed. Note-card checks
cover frontmatter, H1–H3, Live Preview/Source/Reading tabs, stationary
fold/unfold, zero direct-child margins and line tops within 1px.

- Separate `npm run test:geometry`: passed **187 checks**, including 18
  popup timing checks. [Geometry log](round29-shots/geometry.log).
- `npm run audit:offline`: passed, including a fresh production build;
  146 source files, dist, CSP, capabilities and dependencies checked.
  [Audit log](round29-shots/audit-offline.log).
- `cargo build --offline`: passed. [Build log](round29-shots/cargo-build.log).
- `cargo test --offline`: passed **37 Rust tests**, plus binary and doc-test
  targets. [Rust test log](round29-shots/cargo-test.log).

[Typing driver](round29-shots/check-typing.mjs) and
[results](round29-shots/typing.log): 26 real key insertions per target.
Measured `beforeinput` to the next animation frame, not paint latency:
5,000-line tab/card maxima **16.8/16.1ms**, means **7.21/6.75ms**;
40-row table tab/card maxima **15.3/16.7ms**, means **5.68/6.12ms**.
Every sample stayed below 20ms, all characters arrived, and all lines/rows
remained. The table cell was entered and scrolled with real pointer input.

Generated round 23–28 snapshots were restored after testing. The final
documentation/evidence commit changes no application code.

Earlier full runs stopped at a 49.9ms zoom frame and a 33.3ms drag frame.
The starting source's drag check passed at 16.8ms. Profiling separated
layout/compositing work from JavaScript/GC, leading to the small final
change above. Timing thresholds were not relaxed.
[Earlier failures](round29-shots/timing-before.log),
[starting-source comparison](round29-shots/baseline-editing.log),
[final focused drag check](round29-shots/editing.log).

## Tracked app line counts

Newline counts from tracked `rebuild/app` files, excluding `/gen/`, relative
to `610855b`. [Machine-readable counts](round29-shots/line-counts.json).

- Production TS: **22,130 → 22,238 (+108)**.
- Test TS: **3,495 → 3,511 (+16)**.
- Total TS: **25,625 → 25,749 (+124)**.
- CSS: **4,043 → 4,059 (+16)**.
- Rust: **3,314 → 3,314 (0)**.
- mjs: **5,722 → 5,778 (+56)**.
- TS/CSS/Rust: **32,982 → 33,122 (+140)**.
- Including mjs: **38,704 → 38,900 (+196)**.

## Next improvements

1. Implement the seven disabled arrangement/distribution/justification
   operations, including nested-group movement. Makes the Align menu
   complete; roughly 120–200 TS/test lines in small slices.
2. Index canvas text and links for search, backlinks and the graph.
   Makes boards discoverable alongside notes; roughly 500–800 TS/Rust/test
   lines, held for a separate round as requested.
