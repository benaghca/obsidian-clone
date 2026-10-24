# Round 26 bugs

Hunter pass on `rebuild/r26-grok` at `dae9fd2` (Codex's round 26, notes in `ROUND26_NOTES.md`). No application source was changed. Grove was checked in headless Chromium against the Vite dev server (127.0.0.1 only), private profile, device scale 1, in-memory mock vault. Pointer input is `Input.dispatchMouseEvent` (move, then press, then release). Keys are `Input.dispatchKeyEvent`. A double-click is press/release with clickCount 1, then press/release with clickCount 2, with the pointer left where it is.

Obsidian 1.14.4 was launched with the existing round-25 driver: headless Ozone, private HOME/XDG/profile/vault, and `unshare -Urn` so only loopback exists. Comparison used the rendered DOM and CDP input. Obsidian's source, CSS, and assets were not read.

`scripts/test-r26-bugs.mjs` encodes the bugs below and is wired into `npm test`. It fails on this commit. `npm run test:geometry` passed: stationary fold and unfold on `Geometry.md` and `GeometryFM.md` in Live Preview, Source, and Reading, and Ctrl+O, Ctrl+P, and the right-click menu were visible within two frames. The longest sampled frame was 17.2ms. `npm run audit:offline` passed (138 source files, `dist/`, CSP, capabilities, and dependencies).

## Bugs

### 1. Double-clicking a short edge label creates a text card

Severity: high.

Repro:

1. Open a canvas with Dee at `x: 80, y: 240, width: 180, height: 80`, Eff at `x: 270, y: 240, width: 180, height: 80`, and one edge from Dee's right to Eff's left labeled `X`. Reset zoom. The viewport is 1280×860.
2. Double-click the center of the label. This run that point was `(754.5, 469)`. Leave the pointer there between the two clicks.

Expected: the label editor opens and the file still has Dee and Eff. A longer edge already does this. The same double-click in Obsidian 1.14.4 left this canvas byte-for-byte unchanged: two cards, label `X`, no new node.

Actual: the label is not editing. A third text card is saved and focused, empty, at `x: 140, y: 250` (the id changes; this run saved `dcd8bd2fa7944118`). That is the background double-click's new card, centered on the label. The first press hits `.canvas-edge-label` and selects the edge. The 20px end handles then cover the label, because the gap is only 10px. The second press hits `.canvas-edge-end` and starts a reconnect, which hides that handle. The synthesized double-click lands on `.canvas-view`, so the edge editor never runs and the background handler inserts the card.

Suspected: `src/canvas/editing.ts` lines 62–71 and 171–175, `src/canvas/cards.ts` lines 70–71, `src/styles/canvas.css` lines 141–147. Failing test: `scripts/test-r26-bugs.mjs`.

### 2. The outer half of a connection dot does not connect

Severity: moderate.

Repro:

1. Open a canvas with Alpha at `x: 80, y: 200, width: 200, height: 120` and Beta at `x: 480, y: 200, width: 200, height: 120`. No edges. Reset zoom.
2. Click Beta so its handles stay up. The left handle is a 20×20 box. This run its left edge was `845.5` and Beta's left edge was `854.5`.
3. Drag from the center of Alpha's right handle `(653.5, 469)` to `(848, 469)`. That point is on the handle (`aria-label` `Connect left`) and 6.5px outside Beta.

Expected: one edge, Alpha's right side to Beta's left side. Obsidian 1.14.4 created that edge from the same kind of drop, 7px outside the card (`fromSide: "right"`, `toSide: "left"`, id `6b2a283562acff48`). Dropping 6px inside Beta, at `(861, 469)`, already creates the edge in Grove.

Actual: the file still has no edges. The drop test uses the card rectangle, and the outer 10px of the 20px handle hangs outside that rectangle.

Suspected: `src/canvas/editing.ts` lines 85–87. Failing test: `scripts/test-r26-bugs.mjs`.

### 3. The edge toolbar is clipped off the top of the canvas

Severity: moderate.

Repro:

1. Open a canvas with two text cards at `y: 80` (180×80, starting at `x: 80` and `x: 420`) and an edge between them labeled `Gap`. Reset zoom and click the edge so the toolbar is showing.
2. Hold Space and drag the canvas until the edge sits at the top of the view. Release Space and click the edge again.

Expected: the toolbar stays inside the canvas and Set color opens the palette. After the same space-drag, Obsidian placed the toolbar at top `88` with the canvas wrapper at top `78`. Set color was the hit target, and the click opened the eight-swatch picker. Shift+2 is not a substitute for color, direction, or the label.

Actual: the toolbar's box is top `27`, bottom `61`, height `34`, while `.canvas-view` starts at `78`. The whole bar sits above the view. A click at Set color's center `(705, 44)` hits `.view-header`. The palette does not open. `.canvas-view` is `overflow: hidden`, and the bar is positioned in the world and then shifted up by its own height plus 10px. Delete and Shift+2 still work from the keyboard.

Suspected: `src/styles/canvas.css` lines 3 and 105, `src/canvas/controls.ts` lines 75 and 89–93. Failing test: `scripts/test-r26-bugs.mjs`.

## Checked, not filed

- An untouched canvas with unknown fields, a quoted label (`Say "hi" café`), a null edge, a group, a file card, and a link card whose URL is `https://example.com/secret.png` stayed byte-identical after open, hover, select, Escape, zoom, and space-pan. The page loaded no remote resource and did not call `window.open`.
- An edge and its label stay on the curve when a card is dragged, nudged with the arrow keys, or resized, when a group moves its children, and when only an inner card moves. One undo restores the file bytes. Card moves do not rewrite the edge record.
- Creating an edge at scale 2 with the board panned snaps to the dragged sides, uses a 16-character hex id, and writes `id`, `fromNode`, `fromSide`, `toNode`, `toSide` in that order.
- At scale 1, a click 10px off the stroke selects the edge on an empty board and on an edge that crosses a group. The group click selects the edge. A marquee around the gap selects nothing; Obsidian's marquee also leaves the edge unselected.
- Set color, both direction changes (nondirectional `toEnd: "none"`, bidirectional `fromEnd: "arrow"` with both markers), label add, edit, and clear, a quoted label, and unknown metadata all save. Undo restores the exact bytes and Ctrl+Y redoes a color change. An edge follows a 60px card drag.
- A stationary click on a connection dot writes nothing. Escape during a new connection writes nothing. A drop on the source card writes nothing. Read-only mode blocks creation and Backspace. A drop 10px outside the card, and not on the handle, writes nothing. An empty-background drop does not open Add card; the brief defers that menu.
- Dragging the card's right edge above the handle grows the card (200 to 240). The handle does not block that resize.
- Double-clicking Remove deletes the selected edge and does not add a card.
- A label that runs under a third card is not the hit target (the card is). Obsidian's label is covered by `canvas-node-content-blocker` across the same span.
- At about 0.35 scale the hit stroke still responds at 4px off the path and misses at 8px. Obsidian's interaction stroke computes as about 24px with `vector-effect: none` and misses at the same 8px offset. The shrink matches.
- The on-screen edge toolbar's buttons are real hit targets. An earlier empty `elementFromPoint` result was the icon SVG's `className` object, not a missed click.
- `square-pen` and `square-x` are the current Lucide names for the label icons. The single-line label editor is the behavior recorded in the round notes.

## Next improvements

1. Offer Add card and Add note from vault after an empty connection drop. Obsidian opens that menu, and a missed drop currently cancels the gesture. Reuse the card picker and one history step. About 40–80 lines. The brief deferred this.
2. Keep a zoomed-out edge about as easy to grab as it is at 100%. At scale 0.35 the 24-unit stroke is only about 8 screen pixels wide, in Grove and in Obsidian, so a large board becomes a precision task. A screen-space stroke is about 20–40 lines.
3. Index canvas text for search, backlinks, and the graph, and edit groups and note cards on the board. Board content is still absent from those surfaces, and those two card types still cannot be edited in place. About 550–950 lines.
