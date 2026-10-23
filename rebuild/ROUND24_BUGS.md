# Round 24 bugs

Hunter pass on `rebuild/r24-grok` at `a2e8526` (Codex's round 24, notes in `ROUND24_NOTES.md`). No application source was changed. Grove was checked in headless Chromium against the Vite dev server (127.0.0.1 only), private profile, device scale 1, in-memory mock vault. Pointer input is `Input.dispatchMouseEvent` (move, then press, then release, with intermediate drag moves). Keys are `Input.dispatchKeyEvent`.

Obsidian 1.14.4 was opened for the canvas cases below. `Xvfb` is not installed on this machine, so Obsidian ran under `unshare -Urn` with the loopback interface up, `--headless --ozone-platform=headless`, an empty `DISPLAY`, and a scratch `HOME`, `XDG_*`, user-data dir, and vault under `/tmp/r24-obs-hunt`. No `~/Documents` vault was opened. Obsidian's code, CSS, and assets were not read.

`scripts/test-r24-bugs.mjs` encodes the bugs below and is wired into `npm test`. It fails on this commit. `npm run test:geometry` passed in this pass: stationary fold and unfold on `Geometry.md` and `GeometryFM.md` in Live Preview, Source, and Reading, and Ctrl+O, Ctrl+P, and the right-click menu were visible within two frames. The longest sampled frame was 17.1ms. `npm run audit:offline` passed (137 source files, `dist/`, CSP, capabilities, and dependencies). The existing canvas suites were not re-run.

## Bugs

### 1. A selected group's resize handles sit above cards and take their drags

Severity: high.

Repro:

1. Open a canvas with a group `x: 0, y: 0, width: 420, height: 300, label: "Group"` and a text card `x: 200, y: -40, width: 140, height: 90` whose box crosses the group's top edge.
2. Click the group label so the group is selected.
3. Move the pointer to the middle of that card (half its width, 55% of its height) and drag downward with intermediate moves.

Expected: the pointer is on the card, so the card moves and the group stays `420×300` at `y: 0`. In Obsidian 1.14.4, with the group focused, that point is `.canvas-node-content-blocker` on the crossing card. A 48px downward drag left the group at screen `420×300` and moved the card's screen box from `y: 196` to `y: 242` (the opening fit was scale 1; the group box measured 420×300).

Actual: `elementFromPoint` returns the group's top resizer (`data-resize="top"`, node id `g`). The same drag leaves the card at `y: -40` and writes the group as `y: 40, width: 420, height: 260`. A card flush with the group's top edge has the same strip: dragging 30px upward from that card's top edge wrote the group as `y: -20, height: 320` and left the card at `y: 0`.

Suspected: `src/styles/canvas.css` lines 11–14 give every card `z-index: 2`. Line 36 sets `.canvas-node-group` to `z-index: auto`, so the group does not make a stacking context. Lines 80–82 put `.canvas-node-resizer` at `z-index: 3` with a 20px top strip hanging 10px inside the group. Those handles join `.canvas-world`'s stacking context above the cards. Failing test: `scripts/test-r24-bugs.mjs`.

### 2. Double-clicking an edge label creates a text card

Severity: moderate.

Repro:

1. Open a canvas with two text cards and one edge whose `label` is `Lab`.
2. Double-click the label, with the pointer moved onto it first.

Expected: the board gains no card. Double-click creates a text card on empty background. In Obsidian the label is `.canvas-path-label`, and the same double-click left the node count at 7.

Actual: the label is the event target (`canvas-edge-label`), the node count goes from 2 to 3, and the new 250×60 card is `.is-editing`. The edge's `pointer-events` are none, so the label is the live target and the canvas background handler still runs.

Suspected: `src/canvas/cards.ts` lines 67–68. The background double-click ignores `.canvas-node`, `.canvas-controls`, and `.canvas-card-menu`, and still treats `.canvas-edge-label` as empty background. Failing test: `scripts/test-r24-bugs.mjs`.

### 3. Ctrl+Z does nothing after a text edit that nets back to the checkpoint

Severity: moderate.

Repro:

1. Open a canvas whose file is exactly `{}`.
2. Double-click empty background so a text card is created and focused.
3. Type `a`, press Backspace, press Escape, and wait for the 300ms save.
4. Press Ctrl+Z once and wait again.

Expected: the text session put the card back to `""`, which is the document from before typing, so this Ctrl+Z undoes the add. The file returns to `{}` and the card leaves the board.

Actual: the save after Escape is the new card with `"text":""`. The first Ctrl+Z leaves that file byte-identical and the card stays on the board. A second Ctrl+Z is what restores `{}`.

Suspected: `src/canvas/view.ts` lines 209–211 push one board checkpoint on the first `docChanged`. Typing `a` and deleting it makes `source` equal that checkpoint. Lines 70–74 pop the checkpoint and push the current source onto redo before `changed` runs, and lines 64–65 return when the strings are equal, so the pop is kept. Failing test: `scripts/test-r24-bugs.mjs`.

### 4. Escape while a move is in progress clears the selection

Severity: low.

Repro:

1. Select a text card and press on its center.
2. Drag it with intermediate moves (about 36px right and 16px down) so the card is following the pointer.
3. Press Escape, then release the pointer.

Expected: the card returns to where the drag started and stays selected. In Obsidian the card gained `is-dragging`, its screen box moved from `(622, 372)` to `(662, 397)`, and after Escape it was back at `(622, 372)` with `is-focused` still set.

Actual: the card's `left` and `top` return to `80px` (the drag is cancelled) and `is-selected` is removed.

Suspected: `src/canvas/editing.ts` lines 104–110. Escape calls the in-progress cancel, which restores geometry, then falls through and clears `selected`. Failing test: `scripts/test-r24-bugs.mjs`.

### 5. An odd-sized image is saved on a half-pixel coordinate

Severity: low.

Repro:

1. Add `Odd.svg` at 100×300.
2. Open an empty canvas and add that file from “Drag to add media from vault”.
3. Read the file after the save.

Expected: `x`, `y`, `width`, and `height` are whole board units. The round's Obsidian saves used integer coordinates. The image still fits in a 400px max side, so the card is 133×400.

Actual: the saved node is `x: -66.5, y: -200, width: 133, height: 400`. A viewBox-only SVG that decoded as 80×30 saved `y: -75.5, width: 400, height: 151`. The center is the integer viewport center; the half pixel is half an odd side.

Suspected: `src/canvas/cards.ts` lines 38–40 round each side, then line 21 sets `x: p.x - width / 2` after `point()` has already rounded the center. `JSON.stringify` keeps the `.5`. Failing test: `scripts/test-r24-bugs.mjs`.

### 6. A root scalar array is expanded by an unrelated card edit

Severity: low.

Repro:

1. Save a canvas with a text card and a root field `"tags":[1,2,3]` on one line, after `nodes` and `edges`.
2. Drag the card far enough to snap (the checked move wrote `x: 40`).
3. Read the file.

Expected: the untouched array stays `"tags":[1,2,3]` on one line. Values and key order stay as they were. The notes describe compact scalar arrays.

Actual: the card move is kept and the keys stay in order, and `tags` is rewritten as one number per line:

```
	"tags":[
		1,
		2,
		3
	]
```

Suspected: `src/canvas/document.ts` lines 28–33. `format` uses `JSON.stringify` for a scalar object only when `depth > 1`, so a root array is expanded. Failing test: `scripts/test-r24-bugs.mjs`.

## Checked, not filed

- A text card whose text is a leading `---` frontmatter block then `Visible body` shows `Visible body` in both apps. Grove drops that leading block through the existing embed path. The words `title` and `hidden` are absent in Obsidian's card text as well.
- At scale 2, a 40×16 screen drag moved a card by `x: +20` and `y: 0`, which is the 20-unit snap of the world delta. A double-click at world about `(231.7, 79.6)` centered the new card on `(232, 80)`.
- Alt+arrow does not move a card. Arrow keys move 5; a selected card's arrow nudge leaves the group where it is. A group nudge moves the group and cards fully inside it, and leaves a card that sticks out.
- A remote image in a text card stays the local `cm-remote-embed` chip, with no `http` request. Clicking a wikilink in a card opens that note. A colored card selected on its padding keeps the accent selection ring.
- Obsidian's handles on a focused 120×70 card at scale 1 are 20px thick, with 20×20 corners. Two Zoom-in clicks grew that card to 235.8×137.6 and the selection handles were gone, so handle size at that zoom was not measured.
- Grove keeps record and key order where Obsidian moves the edited card to the end. The task asks for the original order. Canvas settings, undo, redo, and help buttons are outside this round. Edge, group, and note-card editing are later rounds, apart from the label double-click above, which inserts a card. The shared tooltip still waits about 500ms and has no animation.

## Next improvements

1. Index canvas text and wikilinks for search, backlinks, and the graph. Board content is still missing from those surfaces, so a note linked from a card is hard to find. Roughly 250–450 lines, with one extraction path in the existing index.
2. Add edge creation and editing, then the remaining group and note-card interactions, in small rounds. Everyday boards need arrows and group edits after cards. Roughly 400–700 lines across those rounds.
3. Render Markdown only for cards near the viewport if a larger board shows a measured opening or memory cost. The checked 300-card drag stays under 20ms, so this waits on that measurement. Roughly 100–150 lines.
