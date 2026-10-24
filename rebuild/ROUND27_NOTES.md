# Round 27 — canvas file drops, note titles and connected cards

Baseline `d63633d`; worktree `grove-r27-codex`, branch `rebuild/r27-codex`.
All commits are local. No dependencies or backend commands were added.
Production changes stay in `src/canvas/`, `src/styles/canvas.css` and the
three-line explorer hook described below. Grok's explorer header, vault
switcher and status-bar files were not edited.

## Native observations

Observed installed Obsidian 1.14.4 with headless Ozone, private HOME/XDG,
profile and scratch vault, inside an isolated loopback-only network
namespace. Only public vault/workspace APIs, rendered DOM and real CDP
pointer/key input were used; no native application code, CSS or assets.
[Driver](round27-shots/observe.mjs),
[measurements](round27-shots/observation.log),
[side placement/title driver](round27-shots/observe-placement.mjs),
[placement measurements](round27-shots/placement.log).

- An explorer note drop creates a **400×400** file card with its **top-left
  at the pointer**, in canvas coordinates. A 600×300 SVG becomes **400×200**.
  Dropping on another card creates a separate overlapping card; it does
  not replace or edit the first one. Folder drops add nothing.
  Native screenshots: [note](round27-shots/note.png),
  [image](round27-shots/image.png), [overlap](round27-shots/on-card.png),
  [folder](round27-shots/folder.png).
- The drag ghost is a small dark rounded box with a file/folder icon and
  name. There is no extra canvas border/tint or replacement-card highlight.
  Grove reuses its existing explorer ghost and destination handling.
  [Native drag](round27-shots/note-drag.png),
  [Grove drag](round27-shots/grove-explorer-drag.png).
- Notes retain an internal title **17px inside the card border**: **25.888px,
  weight 700, line-height 1.2**, with a half-em gap before the body. Long
  titles wrap; they are not ellipsized. The existing outside file label
  stays one line and ellipsizes. Selection retains the title, and zoom
  scales it with the card. Clicking the internal title does not navigate
  away. Native Obsidian can edit that title; this round explicitly keeps
  the header display only and leaves note editing for later.
  [Native header](round27-shots/obsidian-header.png),
  [Grove header](round27-shots/grove-note-header.png).
- An empty new-connection drop opens **Add card**, then **Add note from
  vault**, with no icons or media-only third row. The native vault picker
  includes notes, canvas files and media. Grove therefore uses the same
  two-row layout and lets the reused vault picker choose media too.
  [Native menu](round27-shots/connection.png),
  [native picker](round27-shots/connection-picker.png),
  [Grove menu](round27-shots/grove-add-menu.png).
- A new text card is **250×60**. Its side opposite the source connection
  touches the drop point: left/right sides center vertically; top/bottom
  sides center horizontally. Notes and images use the same alignment with
  their own dimensions. The pending arrow remains visible until dismissal
  or choice. Escape and clicking away leave the document unchanged.

## Implementation and commits

1. `51cfb55` — Receive explorer drops in the existing card controller,
   reuse `insert`, media decoding, saving and history; retain note titles
   above the existing Markdown renderer. Note/image drops, overlap,
   folders, outside drops, Escape and read-only are covered by CDP input.
2. `1f070a5` — Reuse the shared menu and existing vault picker after an
   empty new-connection drop. Card and edge enter the document patcher
   together with one history checkpoint. Media shares the existing aspect
   ratio loader. A document revision guard prevents stale pickers or image
   decodes from changing a replaced canvas; disposal closes pending menus.
   Reconnection drops still cancel. No serializer changes were needed.
3. `0bd2512` — Keep large-board explorer drags smooth, retain control hit
   targets above the cursor surface, and run insertion after the explorer's
   focus restoration so a receiving inactive canvas pane owns immediate
   Undo. Extend the pointer regressions and wire them into `npm test`.
4. `8de6652` — Save all nine action fixtures, verify them in Obsidian, then
   check the native return file in Grove through the permanent pointer
   suite. Record the native driver and both return screenshots.

The **only `src/shell/treeDrag.ts` changes** are two notifications (current
entry/position during a drag, then completion/cancellation) and a conditional
on the existing global grabbing-cursor class when a canvas is mounted.
The move destination, threshold, ghost, auto-expansion, scrolling, file
operations and cancellation logic remain the existing implementation.
Canvas receives the notifications without synthetic DOM drag/drop events.

Profiling found that the global grabbing-cursor selector restyled **10,635
elements**, taking **37.6–43.4ms** and producing **33–50ms** frames when a
large canvas was visible. A transparent canvas cursor surface avoids that
global restyle; the repeat profile stays at **16.8ms** maximum. It adds no
canvas highlight. [Before](round27-shots/drag-profile.log),
[after](round27-shots/drag-profile-fixed.log),
[reproducible profile](round27-shots/profile-drag.mjs).

## Round trips and checks

All **nine** saved Grove action fixtures open in native Obsidian with every
node/edge property matching and every original disk byte unchanged,
including unknown fields and key order. They cover explorer note/image and
overlapping drops, connected text on all four sides, connected note and
connected media. Obsidian then adds an explorer note and connected media
to a Grove file; the resulting native file returns to Grove with identical
geometry and paths, its note header, local image and unchanged bytes.
[Round-trip driver](round27-shots/roundtrip.mjs),
[results](round27-shots/roundtrip.log),
[native return](round27-shots/Obsidian-return.canvas),
[native screenshot](round27-shots/obsidian-roundtrip.png),
[Grove return](round27-shots/grove-roundtrip.png).

To regenerate Grove fixtures, run `GROVE_UPDATE_CANVAS_FIXTURES=1 node
scripts/test-canvas-drops.mjs` from the app, then the round-trip driver in
the private network namespace. Normal tests leave fixtures unchanged.

## Tracked line counts

Tracked app files excluding `/gen/`, counting newline bytes as in the task's
`git ls-files`/`wc -l` commands, relative to `d63633d`.
[Machine-readable counts](round27-shots/line-counts.json).

- Production TS: **20,788 → 20,836 (+48)**.
- Test TS: **3,262 → 3,262 (0)**.
- Total TS: **24,050 → 24,098 (+48)**.
- CSS: **3,895 → 3,900 (+5)**.
- Rust: **3,145 → 3,145 (0)**.
- mjs: **3,518 → 3,622 (+104)**.
- TS/CSS/Rust: **31,090 → 31,143 (+53)**.
- Including mjs: **34,608 → 34,765 (+157)**.

The canvas controller is 137 lines, editing 211, view 322 and CSS 160.
No production file exceeds 800 lines. No editor or Rust source was changed.

## Final verification

- `npm run build` passed. [Build](round27-shots/build.log).
- `npm test` passed: **254 TS tests in 44 files**, four browser-discovery
  tests and **1,215 named browser checks**, including **65** new canvas
  checks. All feature interactions use real CDP input, including explorer
  drags, repeated stationary controls, double-clicking menu/toolbar buttons,
  both file pickers, exact one-step undo/redo, read-only and stale picker
  cancellation. [Full run](round27-shots/npm-test.log),
  [focused run before adding the two native-return checks](round27-shots/drops.log).
- The separate `npm run test:geometry` passed **187 checks**: frontmatter
  in Live Preview, Source and Reading, H1–H3, zero direct-child margins,
  line tops within 1px and visible stationary fold/unfold arrows. All **18**
  popup checks opened within two frames, maximum **17.1ms**, with no
  animations. The full suite's popup maximum was **17.6ms**.
  [Separate geometry](round27-shots/geometry.log).
- All 300-card/400-edge pan, zoom, card drag, edge create/commit and explorer
  drag checks passed at **16.8ms** maximum; 401-edge reconnection/commit also
  passed at **16.8ms**. The unchanged navigation assertion confirms no child
  DOM/geometry mutations while panning or zooming. The new Add card menu
  opened within two frames with no animation, maximum **16.8ms**. No timing
  threshold or legacy assertion was relaxed; the existing empty-new-drop
  assertion now explicitly checks the requested menu and unchanged bytes.
- Real typing smoke checks in the **5,000-line Big note** and a **40-row
  table cell** each inserted 26 characters, retained every line/row, and
  reached the next animation frame within **16.5ms / 16.9ms**, respectively.
  These are input-to-next-frame samples, not a paint-latency benchmark.
  [Driver](round27-shots/check-typing.mjs), [results](round27-shots/typing.log).
- `npm run audit:offline` passed for **138** source files, built output,
  CSP, capabilities and dependencies. [Audit](round27-shots/audit.log).
- `cargo build --offline` and `cargo test --offline` passed, including all
  **34** Rust tests. Tauri was not launched.
  [Rust build](round27-shots/cargo-build.log),
  [Rust tests](round27-shots/cargo-test.log).
- Whitespace checks passed. Generated changes to older-round snapshots
  were restored. Production source was held fixed throughout final checks;
  browser timing checks ran without competing builds. All app observation
  and interaction was headless, with private scratch/mock vaults. No
  owner-screen windows, real vaults, pushes or merges were used.

The final local documentation commit records these notes, counts,
observation evidence and check logs. Round 27 canvas work is complete.

## Next improvements

1. Edit note cards and groups on the board. Completes those card types
   without leaving the canvas; roughly 150–300 TS/test lines in slices.
2. Keep edge hit strokes constant in screen pixels when zoomed out.
   Makes distant arrows easier to select; roughly 20–50 TS/CSS/test lines.
3. Index canvas text and file links for search, backlinks and the graph.
   Makes boards discoverable alongside notes; roughly 500–800 TS/Rust/test
   lines across several small slices.
