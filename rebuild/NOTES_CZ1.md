# CZ1: no stylesheet writes per frame, card bodies not scrollers, cached rect

Branch `rebuild/canvas-cz1-claude`, from `18f43a9` (the CZ plan, on `rebuild/integration` `298c169`), 2026-10-30. Local commits only; nothing pushed. No app window opened; every browser run was headless Chromium under the test lock.

Chris approved the plan's build split and all recommendations (D1 = A, D2 = 45%/55%, D3 = zoom first, D4 = the four small changes). This piece is CZ1 from `CANVAS_ZOOM_PLAN.md` §9: **Z1, Z2 and Z7.** I stayed out of the hover-preview code (CZ-H, Grok) and the right-click menu (CZ4).

## What changed

### Z1: a pan or zoom frame writes no stylesheet

**`canvas/navigation.ts`**
- **Removed:** the per-canvas adopted stylesheet. Every pan and zoom frame used to rewrite `--canvas-inverse-scale` and four `--canvas-view-*` bounds in it, and the world needed a random id to scope it. A stylesheet change restyles everything its rules can match (the whole document in WebKit). Here that meant every edge's hit path repainted and the whole board re-rastered on every frame.
- **The selection menu,** the only thing that has to follow every frame, now gets those five variables inline on its own element. Only that element's few children restyle. `canvas.css` already read them from the element itself, so its rules are unchanged.
  - Navigation finds the menu by walking the world's children from the end, where `selectionMenu()` appends it, and caches it.
  - It rewrites the variables whenever a redraw of the board brings a new menu, even if the viewport is the same.
- **Connection points, edge-end handles and edge hit paths** keep their screen size through **zoom bands**:
  - There are 21 quarter-octave bands from 1/16× to 2×, with `zoomBand(scale)` exported for CZ2.
  - One static stylesheet, built once for all canvases and never written again, has a rule per band: `.canvas-world[data-zoom-band="b"] :is(.canvas-node-connection-point, .canvas-edge-end, .canvas-edge-hit) { --canvas-inverse-scale: 2^(-b/4) }`.
  - **Settle:** navigation sets `data-zoom-band` on the world straight away for buttons, fit, zoom to selection, resize and the first draw. For wheel and pinch zoom it waits until the wheel has rested for **120 ms**. A zoom frame therefore changes only the world's transform and the grid background, and the band change restyles only the matched handles, once per gesture.
  - Handle sizes are now within ±9% (one eighth of an octave) of the exact inverse scale, instead of exact. The handles are 20 px and the hit width is 24 px, so the error is at most about 2 px.

### Z2: card bodies scroll only on a selected or edited card (D4)

**`styles/canvas.css`**
- `.canvas-node-content` is `overflow: hidden`.
- `.canvas-node:is(.is-selected, .is-editing) > .canvas-node-content` is `overflow: auto`.
- The wheel already pans everywhere except inside an edited card, so the only interaction lost is dragging the scrollbar of an unselected card. Select the card and its scrollbar is there, as before.
- Note cards keep `scrollbar-gutter: stable`, so selecting one doesn't reflow its text.
- An image card keeps its own `overflow: hidden` (its rule is more specific).

### Z7: small input costs

**`canvas/navigation.ts`**
- **Cached rect.** The wheel handler no longer calls `getBoundingClientRect()` on every event. It caches the rect, clearing it on resize (ResizeObserver) and on `pointerenter`.
- **Space+wheel zooms,** as Obsidian's Canvas help page says ("press `Space` or `Ctrl` … and scroll using the mouse wheel"). It used to pan. **`canvas/controls.ts`:** the help dialog's Zoom row now shows `Space + Scroll` and `Ctrl + Scroll`.

### Tests

- **`scripts/test-canvas-navigation.mjs`:**
  - **Narrowed check.** The check "Pan/zoom transforms one world without changing card DOM or geometry" now ignores the selection menu's own inline variables. The menu isn't card DOM, and those variables are what replaced the stylesheet write.
  - **Five new checks:**
    - Ctrl+wheel zoom writes no stylesheet rule (counted with a patched `CSSStyleDeclaration.setProperty`).
    - The band doesn't change mid-gesture, then matches the zoom once the wheel rests, and the hit paths' variable equals the band's inverse scale.
    - Space+wheel zooms around the pointer at the Ctrl+wheel rate.
    - An unselected card's body computes to `overflow: hidden`, and to `auto` once the card is clicked.
    - The visible selection menu's inline inverse scale is exactly `1/scale`.
- **`scripts/test-canvas-edges.mjs`:** "Leaving the canvas releases its control-sizing stylesheet" and "Reopening installs exactly one" became one check. There is exactly one zoom-band sheet, the same one before and after reopening, and no per-canvas sheet.

### Two fixes the measurements called for

Both are needed so that Z1 actually leaves "nothing else restyled" behind.

1. **A `:has()` was searching the board on every frame** (`canvas.css`, `canvas/labels.ts`).
   - The rule hiding the selection menu while a label is edited was `.canvas-world:has(.canvas-node-group.is-editing, .canvas-edge-label.is-editing) .canvas-selection-menu`. So each restyle of the menu, now once per zoom frame, made the browser search the whole board for an editing label.
   - A trace at 1,000 cards: only 3 elements restyled per zoom step, yet each style pass took about 4 ms. At 3,000 cards it was over 20 ms.
   - `editCanvasLabel` now puts `is-editing-label` on the world while a group or edge label is edited, and the rule uses that class instead.
   - After the fix, the style pass per step was 0.25 ms at 1,000 cards.
2. **Connection dots are created lazily** (`canvas/editing.ts`).
   - Each card used to get its four dots when the board was drawn: 4,000 hidden elements at 1,000 cards, all restyled by every band change.
   - Now a card gets its dots on its first `pointerover`, or when it is selected. Dots only ever show on a hovered or selected card, so nothing visible changes.
   - Measured settle cost (one band change, forced style and layout, median of 5):

     | Cards | Eager dots, `:is()` rule | Lazy dots, selector list |
     |---:|---:|---:|
     | 300 | 5.5 ms | 2.9 ms |
     | 1,000 | 20 ms | 11.6 ms |
     | 3,000 | 64.6 ms | 39 ms |

   - What's left is the edge-end handles (two per edge) and edge hit paths: about 20 ms each at 3,000 cards and 4,000 edges.

**Lines** (`git diff --numstat`, excluding screenshots), 105 added and 33 removed:
- `navigation.ts`: +57/−21
- `editing.ts`: +10/−3
- `labels.ts`: +5/−2
- `canvas.css`: +5/−2
- `controls.ts`: +1/−1
- `test-canvas-navigation.mjs`: +22/−1
- `test-canvas-edges.mjs`: +5/−3

## Decisions

- **Bands for handles** instead of per-frame or exact sizes. The plan's Z1 says handles "read a zoom band (Z5) that changes at settle". CZ1 builds just the part needed for that, and CZ2 extends the same sheet and `zoomBand()` for the card ring, titles and labels.
- **Ruled out: `vector-effect: non-scaling-stroke` for edge hit paths.** Chromium sizes such a stroke without the world's CSS transform. At 59% zoom, a probe found a 24 px hit band shrank to about 14 px.
- **Ruled out: restricting the band rules to hovered or selected handles,** such as `.canvas-node:is(:hover, .is-selected) > …`. Chromium still invalidates every element with the subject's class, measured at 4.5 ms for 1,000 cards.

## Before and after

**How it was measured.** The scratch bench from the CZ plan (`bench-zoom.mjs`, session scratchpad; CZ0 makes it permanent). It ran headless Chromium 155 at 1280 × 1000, device scale 1, under the lock.
- **Before:** a pristine copy of the app at `18f43a9`, served from the scratchpad, so the baseline couldn't pick up edits.
- **After:** this branch's final code.
- **Boards:** generated with 100/300/1,000/3,000 cards, `4/3 ×` edges and a group per 50 cards.
- **Gestures,** each from **Zoom to fit** (every card on screen, the worst case):
  - 12 + 12 Ctrl+wheel notches;
  - a pinch of 60 + 60 small Ctrl+wheel steps;
  - 40 large wheel pans.
- **The trace window** runs until 300 ms after the last event, so the settle step is included.
- **"Main ms/step"** is the main thread's task time divided by the number of style updates. The phase columns are per step too. "Dropped frames" is Chromium's own `DroppedFrame` count for the whole gesture.

| Cards | Gesture | Steps | Main ms/step before → after | Style | Layerize | Paint | Raster (workers) | Dropped frames before → after | Longest task before → after |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | wheel | 23→24 | 10.1 → **3.2** | 4 → 0.2 | 1.9 → 1 | 1.7 → 0.3 | 27 → 7 | 5 → **1** | 10 → 5 |
| 100 | pinch | 120→120 | 8.8 → **2.6** | 3.6 → 0.1 | 1.9 → 0.9 | 1.6 → 0.2 | 27 → 5 | 71 → **0** | 9 → 3 |
| 100 | pan | 40→40 | 7.6 → **3.5** | 3.2 → 0.2 | 1.6 → 0.9 | 1.3 → 1.2 | 9 → 23 | 0 → **0** | 8 → 4 |
| 300 | wheel | 24→24 | 25.8 → **7.5** | 10.3 → 0.2 | 6.8 → 3.2 | 5.2 → 0.5 | 66 → 13 | 23 → **1** | 26 → 11 |
| 300 | pinch | 120→120 | 25.6 → **7.2** | 10.3 → 0.2 | 6.9 → 3.2 | 4.8 → 0.3 | 41 → 5 | 120 → **0** | 27 → 8 |
| 300 | pan | 40→40 | 23.5 → **9.7** | 9.8 → 0.2 | 6.2 → 3.2 | 3.9 → 3.5 | 35 → 88 | 40 → **20** | 26 → 10 |
| 1,000 | wheel | 24→26 | 118 → **35.1** | 38.1 → 1.4 | 50.6 → 19 | 17.7 → 4.9 | 146 → 64 | 138 → **35** | 120 → 46 |
| 1,000 | pinch | 120→120 | 120.7 → **32** | 37.4 → 0.4 | 52 → 19.8 | 18.4 → 0.9 | 44 → 5 | 733 → **120** | 127 → 42 |
| 1,000 | pan | 40→40 | 116.3 → **39.7** | 38 → 0.4 | 50.1 → 19.6 | 15.5 → 12.3 | 59 → 47 | 241 → **80** | 129 → 48 |
| 3,000 | wheel | 24→48 | 454.2 → **164.7** | 118.8 → 23.4 | 216.2 → 65.1 | 66.1 → 29.5 | 553 → 312 | 549 → **364** | 485 → 432 |
| 3,000 | pinch | 120→130 | 469.8 → **158** | 115.4 → 4.2 | 240.8 → 95.4 | 62.7 → 24.7 | 99 → 12 | 3,060 → **1,130** | 506 → 251 |
| 3,000 | pan | 40→40 | 442.2 → **186.2** | 112.4 → 1 | 229.8 → 102.5 | 49.6 → 50.4 | 167 → 157 | 971 → **400** | 468 → 210 |

**Opening** (from `ws.open` until the board is in the DOM). CZ1 doesn't target this; the gain at 3,000 cards is the 12,000 dots no longer built.

| Cards | Board shown, before → after | Longest task, before → after |
|---:|---:|---:|
| 100 | 103 → 96 ms | 84 → 79 ms |
| 300 | 283 → 271 ms | 220 → 227 ms |
| 1,000 | 1,238 → 1,125 ms | 980 → 966 ms |
| 3,000 | 9,602 → 6,526 ms | 8,652 → 5,939 ms |

**Reading it:**
- **100 and 300 cards:** smooth. Pinch drops no frames (71 and 120 before), and the one dropped wheel frame is the settle step.
- **1,000 and 3,000 cards:** every step is 3–4× cheaper, but layerize (19 and 95 ms) and paint still exceed a frame. That cost is the card bodies, which the plan gives to CZ2 (title mode) and CZ3 (lazy bodies, culling). The plan's §3 measured title mode plus Z1 at about 6 ms per step for 1,000 cards.
- **Pan raster went up** (100: 9 → 23 ms; 300: 35 → 88 ms). That is the bench's 4,000 px jumps exposing a fresh board each step, and more of those frames are now actually drawn. The real Space+drag pan is covered by the 300-card frame test, which still passes.
- **3,000 cards, wheel, steps 24 → 48:** the settle restyle counts as extra style updates. That halves the per-step figures in that row without making them comparable; read the dropped frames.

## Tests

All on the final code:
- **`npm run build`:** passed, with the existing chunk-size warning only.
- **`npm run audit:offline`:** passed (180 source files).
- **`flock /tmp/grove-npm-test.lock npm test`:** exit 0 in one run, with no reruns.
  - Browser discovery 4/4.
  - Vitest: 70 files, 1,226 tests.
  - 2,060 PASS lines, including every canvas script and `posttest`.
  - The 300-card pan and zoom frame checks: max 16.8 ms.
  - The new CZ1 checks and the updated stylesheet check in `test-canvas-edges.mjs` passed. So did the canvas edge, connection-dot, drag-work and hit-area scripts, which exercise the lazy dots.
- **`cargo build`:** passed.
- **`cargo test`:** 73 passed, 4 ignored.
- **Screenshots** under `rebuild/round*-shots/` were restored with `git checkout` before committing.

## Left open

- **The settle step at large counts.**
  - One band change still restyles every edge-end handle (two per edge, hidden unless the edge is selected) and every edge hit path: 39 ms at 3,000 cards and 4,000 edges, once at the end of each zoom gesture.
  - **For CZ3:** create edge ends only when an edge is selected (like the dots here), and leave hit paths out in title mode, as Z9 already plans.
- **Unselected text cards whose text overflows** no longer show a scrollbar. With classic (non-overlay) scrollbars, selecting such a card brings the scrollbar back and narrows its text by the scrollbar's width. Note cards keep `scrollbar-gutter: stable`, so they don't reflow.
- **The 300-card zoom test in `test-canvas-navigation.mjs`** still times `requestAnimationFrame` intervals, which can't see dropped frames (plan §3.2). Replacing it is CZ0's job (Codex).
- **The real app.** These numbers are Chromium's. WebKitGTK should gain more from Z1, since it restyles the whole document for a stylesheet change. CZ0's in-app command is how to check that.
- **Screenshots.** `test-canvas-navigation.mjs` regenerated `round23-shots/grove-partb-*.png`; they were restored before committing. The committed copies predate several rounds of UI changes. The one visible change from CZ1 is that an unselected note card no longer shows a scrollbar.
