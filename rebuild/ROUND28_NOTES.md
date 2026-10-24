# Round 28 — note-card editing, groups and steady edge picking

Baseline `ee00c4b`, branch `rebuild/r28-codex`, worktree `grove-r28-codex`.
`node_modules` was missing; the requested `npm install` installed the locked
dependencies without changing the manifest or lockfile. No dependency or
backend command was added. All commits are local; no push or merge.

## Obsidian observations

Observed installed Obsidian 1.14.4 in headless Ozone with private HOME/XDG,
profile and scratch vault, inside a loopback-only network namespace. Used
public workspace/vault APIs, rendered DOM measurements and real CDP input;
no Obsidian application code, stylesheets or assets were read or copied.
[Initial driver](round28-shots/observe.mjs),
[initial observations](round28-shots/observation.log),
[group driver](round28-shots/observe-groups.mjs),
[group observations](round28-shots/groups.log),
[detail driver](round28-shots/observe-details.mjs),
[detail observations](round28-shots/details.log).

- Double-clicking a note's body or choosing its toolbar **Edit** starts
  **Live Preview** inside the card. The filename title and editable
  properties stay visible. Obsidian uses a controlled iframe for this
  editor; Grove uses its existing CodeMirror editor and note store directly.
  Edits change the `.md` file. The `.canvas` remains unchanged.
- A wheel over the editing note scrolls its content instead of panning the
  board. Escape and clicking away end editing and keep changes. Grove also
  flushes on leaving the canvas and cancels a still-loading editor on Escape.
  [Native editor](round28-shots/obsidian-note-edit.png),
  [Grove editor](round28-shots/grove-note-editor.png).
- A selection of two cards exposes **Create group** after Zoom to selection
  in the toolbar, and in the background context menu. No default shortcut
  is shown. The new group surrounds the selected geometry with **20px** on
  all four sides and starts with **Untitled group**. Its record precedes
  existing cards, ordered `id,x,y,width,height,type,label`, with a 16-hex ID.
  [Native selection menu](round28-shots/obsidian-group-menu.png),
  [native group](round28-shots/obsidian-group-created.png).
- A single group-label click selects the group; a double-click or
  **Edit label** edits its text. The label's contenteditable DOM changes
  before the native document snapshot catches up. Enter, Escape or blur
  retain the draft; an empty label removes `label` from the saved record.
  The group context menu is **Zoom to selection, Edit label, Remove**.
- **Remove** is the native ungroup operation: cards and edges between them
  remain. Resizing a group changes its boundary; moving it carries fully
  contained cards. Color uses the existing six-color/custom menu. Those
  geometry/color paths were already present in Grove and are reused.
- Native edge interaction paths report `stroke-width:24px` without a
  vector effect. This round explicitly improves low-zoom picking: Grove's
  invisible hit stroke stays **24 screen pixels** at every supported zoom.

## Implementation and local commits

1. `356b481` — Size only the invisible edge hit stroke with the existing
   scoped inverse-zoom rule. Real pointer tests select at ±11 screen pixels
   and miss at 14px at 1×, ¼×, 1/16× and 2×, without changing file bytes.
   SVG `non-scaling-stroke` alone failed under the outer HTML/CSS transform,
   so that attempted rule was replaced rather than retained alongside it.
2. `168da12` — Edit note cards with the normal note editor, document store,
   mirrors, history and debounced saving. The actual note path controls
   links, properties and attachments. Open note tabs update immediately;
   one document/history remains authoritative. Escape, click away, disposal
   and pending-load cancellation release the temporary view and flush edits.
   The card title stays outside `.cm-content`. Canvas history/bytes are
   separate from the note's edit history.
3. `72b7afc` — Create groups from the toolbar or selection background menu;
   edit group labels with the extracted existing edge-label editor; reuse
   resizing, movement, color, deletion and canvas history. Native field
   order, unknown fields and empty-label removal have serializer tests.
   Extend the existing first-control-click guard to prevent a double-click
   on a disappearing menu from editing the card underneath it.
4. `1b60f0b` — Retain the selected card and Edit toolbar after Escape and
   the pending note save. Preserve a single-card selection across passive
   file refreshes. A real-key/pointer regression saves an edit, then reopens
   the same Edit control twice without moving the pointer.
5. `d56db93` — Wire all three new pointer suites into `npm test`, save the
   group action fixtures and check the native return file in Grove.

Only two production source files outside the canvas were touched:

- `src/noteEditors.ts`: a small `embed` hook registers a temporary view
  with the existing pane/mirror/save machinery and maps its links/menus to
  the real pane. The shared history command temporarily enables its owner
  when an editable mirror shares history with a Reading tab, then restores
  that mode. This fixes the Reading-tab undo case exercised by the card.
- `src/shell/icons.ts`: one `group: lucide.Group` entry supplies the bundled
  icon to both existing toolbar/menu helpers.

The NoteEditors diff is 15 added lines and one removed line; the icon map
adds one line. Both hooks have real-pointer regression coverage.

`package.json` only wires the three new pointer scripts into `npm test`.
No explorer, tab, status-bar, attachment or command implementation was
changed. All production files remain below 800 lines.

Saving while leaving a card exposed a notification loop: redraw removed
and re-added embed listeners while the live listener set was being iterated.
Deferring the canvas refresh to a guarded microtask lets notification finish
first and coalesces callbacks from multiple copies of a file. Saves during
active note editing keep its editor mounted. No global event utility change
was needed.

## File round trips

Nine saved action fixtures cover group creation (toolbar/background menu),
rename, empty/remade label, resize, contained-card movement, color and
removal. Each opens in native Obsidian with identical displayed properties
and **every original disk byte unchanged**, including unknown root/node/
edge fields and old key order. Native rename/color actions then save a
return fixture for Grove's permanent tests.
[Driver](round28-shots/roundtrip.mjs),
[native results](round28-shots/roundtrip.log),
[native return](round28-shots/Obsidian-groups.canvas),
[native screenshot](round28-shots/obsidian-group-return.png),
[Grove return](round28-shots/grove-group-return.png).

Regenerate forward fixtures with `GROVE_UPDATE_GROUP_FIXTURES=1 node
scripts/test-canvas-groups.mjs`, then run the native driver in the isolated
network namespace. Normal tests retain the checked fixtures.

## Tracked line counts

Tracked app newline counts, excluding `/gen/`, relative to `ee00c4b`.
[Machine-readable counts](round28-shots/line-counts.json).

- Production TS: **21,894 → 22,026 (+132)**.
- Test TS: **3,455 → 3,476 (+21)**.
- Total TS: **25,349 → 25,502 (+153)**.
- CSS: **4,000 → 4,003 (+3)**.
- Rust: **3,314 → 3,314 (0)**.
- mjs: **5,052 → 5,135 (+83)**.
- TS/CSS/Rust: **32,663 → 32,819 (+156)**.
- Including mjs: **37,715 → 37,954 (+239)**.

The canvas view is 349 lines, editing 239, card controller 139, new note
surface 37, shared label editor 19 and canvas CSS 163. NoteEditors is 454.

## Final verification

All browser checks used headless Chromium and real CDP pointer/key input.
No app window opened on the screen and no real vault was accessed.
Production source stayed fixed during the final full run. Generated
snapshots from rounds 23–27 were restored afterward.

- `npm run build`: passed. [Build log](round28-shots/build.log).
- `npm test`: passed: 4 browser-discovery checks, 271 TypeScript tests
  in 47 files, and **1,488 named browser checks**, including the new
  13 edge-hit, 38 note-card and 27 group checks.
  [Full log](round28-shots/npm-test.log).
- Separate `npm run test:geometry`: passed **187 checks**, including
  18 popup timing checks. Live Preview, Source and Reading with and
  without frontmatter preserve zero direct-child vertical margins,
  line tops within 1px, and stationary fold/unfold arrows. Popup maxima
  stayed under 20ms. [Geometry log](round28-shots/geometry.log).
- `npm run audit:offline`: passed, including a fresh production build,
  source/dist checks, CSP, capabilities and dependencies.
  [Audit log](round28-shots/audit-offline.log).
- `cargo build --offline`: passed. [Build log](round28-shots/cargo-build.log).
- `cargo test --offline`: passed all **37 Rust tests**; binary and doc-test
  targets also passed. [Rust test log](round28-shots/cargo-test.log).

Final screenshots: [groups](round28-shots/grove-groups.png) and
[read-only note card](round28-shots/grove-note-readonly.png).

The large-board drag/create/reconnect/explorer-drag measurements each
had a maximum frame interval of **16.8ms**. Edge toolbar, edge palette and
group context-menu maxima were also **16.8ms**, with no animations.
Pan/zoom retained the existing no-child-DOM-mutations check.

The [typing driver](round28-shots/check-typing.mjs) sends 26 real key
insertions into each target. Measured `beforeinput` to the next animation
frame (not a claim about paint latency): 5,000-line tab maximum **17.1ms**,
card **15.5ms**; 40-row table tab **14.5ms**, card **16.3ms**. Mean times
were 6.87/6.70ms and 6.09/5.68ms respectively. Every insertion arrived,
all lines/rows remained, and every sampled interval was under 20ms.
[Typing results](round28-shots/typing.log).

The saved [stationary-click failure](round28-shots/notes-stationary-before.log)
preceded `1b60f0b`; the [focused rerun](round28-shots/notes.log) and final
full run pass the added regressions. Native compatibility results are
linked above; all nine forward files and the native return file passed.
The final documentation/evidence commit records these observations, exact
counts, measurements and check logs without changing application code.

## Next improvements

1. Index canvas text and file links for search, backlinks and the graph.
   Makes boards discoverable with notes; roughly 500–800 TS/Rust/test lines
   across small slices, outside the parallel work this round.
2. Keep the selection toolbar available while editing, with incremental
   passive-preview refreshes. Grove currently reuses its text-card editing
   chrome, which hides the toolbar until editing ends; a shared refresh
   path would avoid losing focus while other copies update. Roughly
   60–120 TS/CSS/test lines.
