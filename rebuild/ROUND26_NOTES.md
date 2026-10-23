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
