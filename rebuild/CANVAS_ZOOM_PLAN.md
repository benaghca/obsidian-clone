# Canvas: smooth zoom, zoomed-out cards, and four small fixes (plan)

Written 2026-10-30 on `rebuild/canvas-zoom-plan-claude` (from `rebuild/integration` `298c169`). Plan and design only; no app code changed. Mockups are in `rebuild/canvas-zoom-mockups/` (README there).

## In plain words

- **Why zooming stutters, measured.** Every zoom or pan frame does far more than move the board:
  - **It rewrites a stylesheet.** Five CSS variables are rewritten in a stylesheet on every frame. The browser then restyles the board, repaints every edge's hit area, and re-rasters the whole board.
  - **Every card body is a scroll container.** With hundreds of cards, the browser's layer bookkeeping grows with the card count.
  - **Every card draws its full content at every zoom,** even at 6%.

  Headless Chromium, board fitted to the screen, one zoom step:
  - 300 cards: about 25 ms (every step drops a frame).
  - 1,000 cards: about 110 ms (6–8 fps).
  - 3,000 cards: about 440 ms (2 fps).
- **Opening a big canvas freezes the app.** 1,000 cards take 1.05 s and 3,000 take 7 s, each in one task. Each card builds its own hidden CodeMirror view, and each one forces a style update of the whole page.
- **The fix, in one rule: a zoom frame only moves the board.**
  - Nothing else is written per frame.
  - Zoom-dependent sizes update once, when the gesture pauses.
  - Card bodies stop being scroll containers unless selected.
  - Off-screen card bodies are skipped.
  - Below a zoom threshold, cards show just their title.

  In the same bench, removing the stylesheet write and the bodies took a 1,000-card zoom step from about 110 ms to about 6 ms, with no dropped frames.
- **Zoomed-out cards.**
  - Below 45%, each card shows its title, centred and bold, on a raised fill with a crisp border, as in Chris's Obsidian screenshot.
  - Above 55% it shows its content again. The gap stops flicker at the threshold.
  - Images stay pictures, groups keep their labels at a readable size, and link cards show their host name.
- **Stronger card definition at every zoom.** The card fill is one step lighter than the canvas (today they are the same colour). The border stays 1 px on screen instead of fading out, coloured cards get a full-colour border, and groups get an outline.
- **The three smaller requests:**
  - **Ctrl+hover previews:** these work in headless Chromium in every canvas case. The likely WebKitGTK cause is the canvas cancelling `pointerdown`, which can silence `mousemove`. The fix is to listen to `pointermove`, and to let a Ctrl press alone open the preview.
  - **Ctrl+drag** draws a box, then offers Add card, note, media or web page, or Create group, sized to the box.
  - **Right-click on empty canvas** gets a menu: the add items, Undo, Paste, the snap toggles and Read-only. Today it shows nothing.
- **Recommendations:**
  - Zoomed-out look **A** (title only).
  - The 45%/55% threshold.
  - Double-click on a zoomed-out card zooms to it.
- **The build** is eight small pieces (§9). Four can start at once: CZ-H (Grok), CZ0 measuring (Codex), CZ1 (Claude) and CZ4 (Grok).

## 1. What Chris reported

1. **"Obsidian is way smoother when zooming out and in."** Zooming a canvas in Grove stutters (real app, WebKitGTK).
2. **"A canvas in Obsidian displays just the note title when you zoom out to the point where it's unreadable."** Grove keeps drawing full card contents at any zoom.
3. **"It's also more defined with the borders and colors in Obsidian"** (addendum 1, with three screenshots).
4. **"I also can't ctrl+hover over links to show embedded pages on the selected note within a canvas"** (addendum 2).
5. **"And ctrl+click+drag does this on Obsidian"**: a drawn box, then a menu to add a card, note, media, web page or group in that box (addendum 3, screenshot).
6. **"Alt+right click does this on Obsidian"**: an empty-canvas menu with the add items, Undo, Paste, the two snap toggles and Read-only (addendum 4, screenshot).

The bar: steady 60 fps while zooming and panning, no visible hitch, the best we can do on modern hardware, not just parity with Obsidian.

## 2. What this plan relied on

- **Obsidian's public Canvas help page**, read once on 2026-10-30 (`https://obsidian.md/help/plugins/canvas`). Nothing else from Obsidian: no code, CSS, icons or other assets. What it says that matters here:
  - Zoom: "press `Space` or `Ctrl` (or `Cmd` on macOS) and scroll using the mouse wheel", the zoom controls, **Zoom to fit** (`Shift+1`), **Zoom to selection** (`Shift+2`), **Reset zoom**.
  - Pan: `Space`+drag, middle-button drag, scroll (vertical), `Shift`+scroll (horizontal). Mobile: "Drag to pan", "Pinch to zoom".
  - Groups: "Right-click the canvas and then select **Create group**" (so Obsidian has an empty-canvas menu with Create group).
  - It says **nothing** about how cards look when zoomed out, about card borders, about Ctrl+drag, or about performance. Those parts of the design come from Chris's screenshots only:
    - `.cz-ref-obsidian-zoomed-out.png`: zoomed out, each note card is a rounded box on a lighter fill with a visible border and only its title, centred and bold. Sampled pixels: canvas `#1d1c1c`, card fill `#262526`, border `#2e2d2e`–`#353435`.
    - `.cz-ref-grove-same-canvas.png`, `.cz-ref-grove-zoomed-out-playground.png`: Grove's card fill is the canvas colour (`#1c1c1c` on `#1c1c1c`), so only a 1-world-pixel border marks a card, and it fades as you zoom out. Content shrinks to unreadable text; the note name sits above the card in faint 14px text that shrinks too.
    - `.cz-ref-obsidian-ctrl-drag.png`, `.cz-ref-obsidian-context-menu.png`: the Ctrl+drag box and menu, and the empty-canvas menu.
- **Grove's own code and tests**, and the earlier notes `NOTES_CANVAS-LAG.md` (drag lag and alignment guides) and `NOTES_CANVAS-REVIEW.md`.

## 3. Measurements

### 3.1 How

- **Bench.** A scratch bench, `bench-zoom.mjs`, with a copy of `scripts/browser.mjs` that also listens for trace events, kept in the session scratchpad. CZ0 turns it into `scripts/bench-canvas-zoom.mjs`.
  - **Environment:** headless Chromium 155 at 1280 × 1000, device scale 1, `--disable-gpu` (software compositing, as in `npm test`), under the test lock.
  - **Boards:** generated with 100, 300, 1,000 and 3,000 cards of 250 × 160 (4 in 5 are text cards with a heading, bold, a wikilink, a bullet and a task, two thirds of them coloured; 1 in 5 are note cards of a short note). Each board also has `4/3 × cards` edges (1 in 25 labelled) and one coloured, labelled group per 50 cards.
- **Gestures,** each starting from **Zoom to fit**, the worst case with every card on screen:
  - **Wheel:** 12 Ctrl+wheel notches of 100 px in, then 12 out, one every 16 ms.
  - **Pinch:** a trackpad pinch arrives as many small Ctrl+wheel steps, here ±6 px every 8 ms (150 + 150 steps at 100–300 cards, 60 + 60 at 1,000–3,000).
  - **Pan:** 4,000 px wheel steps, for reference only. Those jumps expose fresh board every step, so pan raster numbers exaggerate.
- **What was counted:**
  - Chromium's own **`DrawFrame` and `DroppedFrame`** trace events, and main-thread time per step from the trace: `RunTask` total, style (`UpdateLayoutTree`), `Layerize`, `Paint`, `HitTest` and `Layout`.
  - Raster time on worker threads (`RasterTask`).
  - Long tasks.
- **Variants** apply in-page CSS, or a patch of `CSSStyleDeclaration.setProperty`, to switch one thing off. No app source changed. Each variant removes one suspect:
  - `nosheet`: no stylesheet variable writes.
  - `nobody`: card bodies `display: none` (what title mode does).
  - `noscroll`: bodies `overflow: hidden`.
  - `noedges`, `nolabels`, `nohit`: edges, edge labels, edge hit paths.
  - `nowillchange`, `nogrid`, `noshadow`, `nolabelwc` (edge labels without `will-change`).

### 3.2 The existing frame test can't see the stutter

`test-canvas-navigation.mjs` asserts "300-card/400-edge zoom presentation frames stay under 20ms" by timing `requestAnimationFrame` callbacks. In headless Chromium those callbacks tick every 16.7 ms whatever the work, so the test passes while **300 of 300 pinch steps drop a frame** (below). CZ0 replaces it with the compositor's own drawn and dropped frame counts.

### 3.3 Results

**Today, one zoom step with the board fitted to the screen** (main-thread ms per step; dropped frames over the whole gesture):

| Cards | DOM elements | Wheel ms/step | Pinch ms/step | Pinch: steps / dropped frames | Raster on workers, ms/step |
|---:|---:|---:|---:|---:|---:|
| 100 | 2,962 | 9.1 | 9.1 | 300 / 70 | 25 |
| 300 | 8,709 | 26.1 | 24.5 | 300 / 300 | 57 |
| 1,000 | 28,816 | 115 | 111 | 120 / 700 | 40–150 |
| 3,000 | 86,271 | 432 | 443 | 120 / 2,895 | 93–533 |

At 300 cards a pinch step's 24.5 ms is:
- style recalc 10.1 ms;
- layerize 6.6 ms;
- paint 4.6 ms;
- hit testing 1.2 ms;
- layout 0.9 ms;
- plus 57 ms of raster spread over the worker threads.

**What each fix is worth** (pinch, main-thread ms per step, and dropped frames):

| Variant | 300 cards | 1,000 cards | 3,000 cards |
|---|---:|---:|---:|
| today | 24.5 (300) | 111 (700) | 443 (2,895) |
| no stylesheet writes (Z1) | **10.5 (0)** | 62.5 (366) | 281 (1,901) |
| … and bodies not scroll containers (Z2) | — | 36.4 (238) | 137 (915) |
| … and no bodies (title mode, Z3) | — | **5.7 (0)** | **19.7 (121)** |
| … and no edges at all | — | 4.6 (0) | 12.7 (21) |
| … no bodies, no edge labels or hit paths | — | 4.5 (0) | 14.9 (46) |
| no stylesheet writes, no edges, bodies kept | 12.8 (5) | 19.5 (120) | 69.8 (370) |
| edge labels without `will-change` (with Z1) | — | 602 (4,218) | not run |
| today without bodies only | 12.8 (218) | 47 (47, wheel) | — |
| today without grid, or without shadows | 23.5, 24.0 | — | — |

Reading the table:
- **The stylesheet write is the first wall.** Removing it alone makes 300 cards smooth in Chromium. It also takes the style recalc from 10 ms to 0.1 ms and the raster from 57 ms to 5 ms, since nothing on the board is repainted any more.
- **Beyond a few hundred cards, the bodies are the second wall,** through Chromium's layerize step (48 ms at 1,000). Not being scroll containers halves that. Not being drawn (title mode) removes it.
- **At 3,000 cards zoomed out, the 4,000 edges are the third cost** (about 7 ms). They stay drawn by design, so Z9 batches them into a few paths in title mode, where labels and hit paths are left out.
- **Dead ends:**
  - The dot grid and the card shadows cost nothing measurable.
  - Removing `will-change` from the world or from edge labels makes things worse, the latter 10×.

**Opening** (from `ws.open` until the board is in the DOM; longest task):

| Cards | Board shown | Longest task |
|---:|---:|---:|
| 100 | 98 ms | 79 ms |
| 300 | 291 ms | 233 ms |
| 1,000 | 1,293 ms | 1,050 ms |
| 3,000 | 7,891 ms | 7,013 ms |

A CPU profile of the 1,000-card open (`probe-open.mjs`, scratchpad) puts **723 ms in the native getter `FontFaceSet.ready`**. CodeMirror's `EditorView` constructor reads `document.fonts.ready` (`@codemirror/view` `dist/index.js:7996`), once for each card's hidden context view. Each read updates the whole page's style, which keeps growing as cards are added; hence the superlinear curve. Rendering the Markdown itself (`render` and `decorate`) was 124 ms of the 1,038 ms in `draw()`.

**Switching 1,000 visible cards** between full content and title in one go:

| Switch | To titles | Back to content |
|---|---:|---:|
| `display: none` on bodies | 47 ms | 858 ms |
| `content-visibility: hidden` on bodies | 127 ms | 799 ms |

The way back costs about as much as rendering everything again. Hence Z4's rule: swap a few bodies per frame, and only on-screen ones.

### 3.4 Input probes (`probe-input.mjs`, scratchpad)

- **Ctrl+hover a wikilink:** the preview opens in all five canvas cases (text card, note card, selected note card, editing either) in headless Chromium (§5.4).
- **Ctrl+drag on empty canvas:** draws the ordinary selection box, and no menu opens.
- **Right-click and Alt+right-click on empty canvas:** no menu at all.

### 3.5 What transfers to the real app (WebKitGTK)

- **Should transfer:**
  - **The stylesheet write.** WebKit restyles the whole document for a stylesheet change, so this cost is larger there (see `NOTES_CANVAS-LAG.md`).
  - **Paint and raster** scale with what is visible in both engines.
  - **Scroll containers.** WebKitGTK composites scrollable boxes for async scrolling in recent releases, so 1,000 scroll containers are likely expensive there too.
  - **The `fonts.ready` read** is in CodeMirror, so WebKit runs it too, with its own style update.
- **May not transfer:**
  - The layerize step is Chromium's.
  - **Raster per scale step.** Chromium keeps the raster scale of a `will-change: transform` layer while script changes its scale; WebKit may re-raster at each new scale. Not known for WebKitGTK; CZ0 measures it, and Z8 is the fallback.
- **Untested here:** device scale 2 (HiDPI) and GPU rasterization; CZ0 covers both in the real app.

## 4. Why zooming stutters (root causes, largest first)

1. **A stylesheet is rewritten on every pan and zoom frame** (`navigation.ts:41-44`).
   - It writes `--canvas-inverse-scale` and four `--canvas-view-*` bounds into an adopted stylesheet's rules.
   - The browser restyles whatever those rules can match. Because `.canvas-edge-hit`'s stroke width uses the variable, every edge's hit path repaints, and with it the whole board layer re-rasters.
   - Measured: 10 ms of style and 57 ms of raster per step at 300 cards, and all of it goes away without the write.
   - WebKit restyles the whole document for a stylesheet change, so the real app pays more (`NOTES_CANVAS-LAG.md`).
   - The drag fix there skipped the write when the viewport was unchanged. Zoom always changes it.
2. **Every card body is a scroll container** (`.canvas-node-content { overflow: auto }`, plus `scrollbar-gutter: stable` on note cards).
   - Hundreds of scroll nodes make each frame's layer update grow with the card count: 48 ms per step at 1,000 cards in Chromium, halved without them.
   - The wheel never scrolls them anyway (it pans or zooms) unless the card is being edited.
3. **Every card draws its full content at every zoom,** including off-screen cards and cards shrunk to a few pixels.
   - Paint, raster and layer work scale with all the Markdown on the board, not with what is visible or readable.
   - Without bodies, a step at 1,000 cards falls from 62 ms to 6 ms.
4. **At very large counts, edges** (paths, hit paths, labels with their own layers) are the next cost: about 7 ms per step at 3,000 cards with 4,000 edges.
5. **Opening is superlinear** (1.05 s at 1,000 cards, 7 s at 3,000). Each card's hidden CodeMirror view reads `document.fonts.ready`, which updates the style of a page that grows with every card. This doesn't affect zooming, but it makes big canvases feel frozen and is the same per-card overhead Z4 removes.
6. **Small per-event costs:** `getBoundingClientRect()` in every wheel event, and hit testing a large DOM on each wheel event (1 ms at 300 cards, 6 ms at 1,000, 26 ms at 3,000; under 1 ms at 1,000 once the bodies are gone).
7. **Possibly in WebKitGTK only:** re-raster of the board at each new scale step during a gesture. It can't be measured headless (§3.5); CZ0 decides it.

## 5. The design

One rule runs through the zoom work: **a zoom or pan frame changes only the board's transform.** It writes nothing else, so nothing else is restyled, laid out or repainted. Everything that depends on the zoom level waits for a short **settle** (about 120 ms after the last wheel or pinch event, or straight after a button, `Shift+1` or `Shift+2`). The settle is spread over frames so it never makes a hitch of its own.

### 5.1 Zoom smoothness

- **Z1: no stylesheet write per frame** (`navigation.ts draw()`).
  - Today every pan and zoom frame rewrites `--canvas-inverse-scale` and four `--canvas-view-*` values in an adopted stylesheet. That restyles every element the rule's selector can match, repaints all 400+ edge hit paths, and makes the whole board re-raster. WebKit restyles the whole document for any stylesheet change (`NOTES_CANVAS-LAG.md`).
  - Instead, the frame writes only `world.style.transform` and the grid's background size and position, as today.
  - The **selection menu**, the only thing that must track every frame, gets its inverse scale and view bounds as inline variables on its own element, so only that one element restyles.
  - **Edge hit width, connection points and edge-end handles** read a zoom band (Z5) that changes at settle. Nobody can aim at them mid-gesture anyway.
- **Z2: card bodies stop being scroll containers.**
  - Every card body has `overflow: auto` today, and a note card adds `scrollbar-gutter: stable`. A board of 1,000 cards is 1,000 scrollers, each its own scroll node in the browser's layer tree. That is what makes Chromium's layerize step grow with the card count.
  - The wheel never scrolls a card body (it pans or zooms), except in a card that is being edited. So a body gets `overflow: hidden` by default and `overflow: auto` only while its card is selected or edited. A selected card still shows its scrollbar and can be scrolled by dragging it, as now.
  - Measured with Z1 (§3.3): at 1,000 cards a step falls from 62 ms to 36 ms, and at 3,000 from 281 ms to 137 ms. Not enough on its own at those counts, which is why Z3/Z4 follow. It does make the full-content zooms above the threshold, where about 100 cards are on screen, comfortable.
- **Z3: level of detail** (title mode, §5.2).
  - Below the threshold, the board gets one class. Card bodies get `content-visibility: hidden`: their DOM stays, but they are neither laid out nor painted.
  - Each card shows one short title element.
  - Measured: at 1,000 cards this takes a zoom step from 62 ms to 6 ms (with Z1).
- **Z4: only visible cards have a rendered body, and bodies are swapped in a few at a time.**
  - **Lazy rendering.** A card renders its Markdown (and creates its read-only editor context) only when it is on screen above the threshold. Off-screen bodies get `content-visibility: hidden`. A canvas that opens zoomed out therefore renders no Markdown at all.
  - **Spatial index.** A grid of 1,000-unit buckets is built when the board is drawn and updated on drag. Each settle reads it to find the visible cards.
  - **Incremental swap.** Bodies are swapped in nearest the pointer first, within about 4 ms per frame. A card keeps its title view until its body is ready. Measured: switching 1,000 visible cards back to full content in one frame costs about 860 ms.
  - **Releasing.** Bodies far off screen are released after a while (LRU, cap around 300), so memory stays flat on huge boards.
- **Z5: zoom bands for zoom-dependent sizes, applied at settle.**
  - **Bands.** The zoom range (1/16× to 2×) is cut into quarter-octave bands (about 21). Settle writes one attribute, `data-zoom-band`, on the world element.
  - **One stylesheet.** It is generated once and never rewritten, with a rule per band. Each rule sets only non-inherited properties on direct children: the card ring width (a constant 1 px on screen), the title font size, the group label size, the edge stroke and hit widths, and the connection-point size.
  - **Cost.** Changing one attribute restyles only the card elements, never their Markdown, and repaints once.
  - **Title fit.** Titles on cards too small to hold one line are hidden by a rule that pairs the band with a size class given to each card when it is drawn. No per-card work happens at settle.
- **Z6: open time.** Opening is superlinear today: 1,000 cards take 1.05 s and 3,000 take 7.0 s, each in one task.
  - **The cause, from the profile (§3.3).** Every text and note card creates its own read-only CodeMirror `EditorView` (`view.ts`, the `context` per card). CodeMirror's constructor reads `document.fonts.ready`, and reading that getter makes the browser bring the whole document's style up to date. As cards are added one by one, each read costs more than the last.
  - **Fix part 1: share contexts.** One context view serves each origin note: all text cards share the canvas's, and each distinct note file gets one. The context only supplies facets to `render()`; it is never shown.
  - **Fix part 2: render lazily.** Z4 renders only what is on screen above the threshold.
  - **Fix part 3: build in slices.** The DOM is built in slices of at most 8 ms.
  - **Target:** a 3,000-card canvas shows its board in under 200 ms, with no task over 50 ms.
- **Z7: small input costs.**
  - The wheel handler calls `getBoundingClientRect()` on every event. Cache the rect, refreshing it from the ResizeObserver and on `pointerenter`.
  - Keep `will-change` on edge labels. Removing it made Chromium's layerize step 10× slower (§3).
  - **Space+wheel zooms,** as the help page says ("press `Space` or `Ctrl` … and scroll"). Grove pans on Space+wheel today. The canvas already tracks Space for Space+drag (`navigation.ts`), so this is a one-condition change in CZ1, and the help dialog gains it.
- **Z9: batched edges in title mode** (only matters at thousands of edges).
  - At 3,000 cards fitted to the screen, the board without bodies, edge labels or hit paths still takes 14.9 ms per step. That is right at the frame budget, and the 4,000 separate edge paths and their arrow markers are most of what is left.
  - In title mode, edges are drawn as one `<path>` per colour and arrow style, with many subpaths, instead of one element per edge. Hit paths are left out, since nobody can aim at a 0.2 px edge.
  - The per-edge elements come back above the threshold, built in slices like the bodies.
  - Part of CZ3.
- **Z8: WebKitGTK only, if CZ0 shows it is needed: freeze the raster during a gesture.**
  - Chromium keeps a `will-change: transform` layer's raster scale while the scale changes, so a zoom step costs no re-raster there once Z1 is in.
  - WebKit's behaviour for a script-driven scale on a composited layer is not documented for WebKitGTK. If CZ0 shows a full repaint per step, the gesture's transform is driven through a paused Web Animation, which browsers do not re-raster mid-animation. The layer is re-rastered once at settle.
  - This is the only speculative piece, and it ships only if it measures well in the real app.

### 5.2 Zoomed-out cards (level of detail)

- **When.**
  - Cards switch to titles when zooming out **below 45%**, where 16 px body text is under about 7 px on screen.
  - They switch back when zooming in **above 55%**. The 10-point gap (hysteresis) means a small wobble at the threshold never flickers.
  - The switch happens at settle and in slices, never in the middle of a frame.
- **What each card shows** (mockups `lod-options.png`, `threshold.png`):
  - **Note card:** the note name, centred and bold, plus ` › heading` when it shows a subpath.
  - **Text card:** its first heading, or else its first non-empty line, with Markdown marks stripped. This is a string operation; nothing is rendered.
  - **Image card:** the image itself. A very large image gets a downscaled bitmap (`createImageBitmap` with a resize, once), so zooming doesn't resample a 4,000 px photo every frame.
  - **Link card:** the host name, for example `jsoncanvas.org`. Nothing is fetched (round 23 rule).
  - **Other file (PDF and so on):** the file name.
  - **Group:** its fill and outline stay. The label stays above the group at about 14 px on screen.
  - **Edge labels:** hidden, since they would be unreadable.
  - **Edges:** stay, about 1.5 px on screen.
- **Title size:** about 13 px bold on screen at every zoom, up to two lines with an ellipsis. On a card under about 26 px tall or 50 px wide on screen, the title is hidden and the card is just a box.
- **Exceptions:**
  - A card being edited never switches.
  - A selected card keeps its accent ring.
  - Dragging, resizing, connecting and the alignment guides work the same in title mode.
- **Double-click in title mode** zooms to that card instead of opening a 7 px editor. A second double-click edits (decision D3).
- **The faint note-name label above note cards** (`.canvas-file-label`) goes away in title mode, because the title is inside the card.

### 5.3 Card definition (addendum 1)

Mockup: `definition.png`, today and proposed side by side at 62%, 36% and 20%.

- **A raised card fill.** New token `--canvas-card-background`.
  - **Dark theme:** `#262626` on the `#1c1c1c` canvas, matching the step in Chris's Obsidian screenshot.
  - **Light theme:** the canvas becomes `--background-primary-alt` (`#fafafa`) and cards stay white.
  - Today a card is the same colour as the canvas.
- **A border that stays 1 px on screen at every zoom.**
  - The 1 px CSS border stays for layout, so card geometry and the geometry tests don't move.
  - Below 100% a ring (`box-shadow`, which doesn't affect layout) is drawn at the band's width, giving a constant 1 px on screen (Z5).
  - Border colour: `--background-modifier-border-hover` (`#3f3f3f`).
- **Coloured cards:**
  - **Border:** full colour, about 1.5 px on screen. Today it is a 70% mix.
  - **Tint:** 12% over the card fill, on the card itself. Today the 7% tint sits on the body only, which disappears in title mode.
- **Groups:**
  - The fill tint stays.
  - A 1 px colour outline at 55% is added.
  - The label is bolder on a stronger chip (16% colour mix) and kept readable (Z5).
- **Edges** stay about 1.5 px on screen instead of shrinking to nothing when zoomed out.

### 5.4 Ctrl+hover link previews in canvas cards (addendum 2)

- **What the code does.** One document-level `mousemove` listener (`shell/hoverPreview.ts`) serves notes, the sidebars and canvas cards. When the pointer is on a `[data-href]` link with Ctrl held, it shows the preview after 350 ms. Canvas card bodies render their links with `data-href`, so cards are covered by the same code.
- **Headless Chromium finds no bug.**
  - The probe (`probe-input.mjs`, §3.4) Ctrl+hovers a wikilink in five places: a text card, a note card, a selected note card, a note card being edited, and a text card being edited.
  - The preview opened every time, above the canvas (z-index 40).
  - So the failure is specific to WebKitGTK or to something in Chris's setup.
- **The likely cause in WebKitGTK.**
  - The canvas calls `preventDefault()` on every `pointerdown` (`editing.ts`, to stop text selection and native drag).
  - By the Pointer Events spec, that suppresses the *compatibility mouse events* (`mousedown`, `mousemove`, `mouseup`) for that pointer until it is released. Chromium clears this at `pointerup`.
  - If WebKitGTK keeps suppressing `mousemove` after a click on the canvas, the preview listener never hears the pointer. That matches "on the selected note", since selecting a card is exactly such a click.
  - Ordinary notes never cancel `pointerdown`, so previews work there.
  - Pointer events themselves are never suppressed.
- **The fix (CZ-H), whichever way the WebKit behaviour turns out:**
  - Listen to `pointermove` (for `pointerType` `mouse` or `pen`) instead of `mousemove`.
  - Also re-check the element under the last pointer position when **Ctrl is pressed** without moving. Today you must move the mouse after pressing Ctrl, both in notes and on the canvas.
  - Both are a few lines in `hoverPreview.ts`.
  - A headless test covers the five canvas cases, the "press Ctrl while still" case, and a case after a click-select.
  - Chris confirms it in the real app.
- **If it still fails in WebKitGTK after that,** the next suspects, in order:
  1. The canvas's own `pointerdown` focus handling stealing the hover target.
  2. A stacking or clipping difference for the popover.

  A one-line debug log behind the debug build will tell which.

### 5.5 Ctrl+drag to create (addendum 3)

Mockup: `ctrl-drag.png`.

- **Today.** Ctrl is ignored on empty canvas, so Ctrl+drag draws the ordinary selection box (`editing.ts`, the marquee branch of `pointerdown`). The headless probe confirms it (§3.4).
- **Proposed.** With `Ctrl` (`Cmd` on macOS) held on empty canvas:
  - **The box.** The drag draws an accent box: a 2 px outline and a 12% accent fill, in screen space. When grid snapping is on, the box snaps its corners to the grid; Alt turns snapping off, as for drags.
  - **The menu.** On release, a menu opens at the release corner with:
    - **Add card**
    - **Add note from vault**
    - **Add media from vault**
    - **Add web page**
    - **Create group**
  - **The new item** takes exactly the box's position and size in board units, with the existing 50 × 50 minimum.
  - **Cancelling.** Esc, a click elsewhere, or a box under 10 px drops it.
  - **Read-only.** Ctrl+drag selects as today.
- **Reuse:**
  - `cards.ts` `insert()` already takes a point, width and height. A rect variant passes `atStart` with the box size.
  - `pickNote()` and `pickMedia()` pass the box through to `insertFile()`. For a box, media keeps the box size (image `object-fit: contain`) instead of the 400 px aspect fit.
  - **Create group** reuses `editing.ts createGroup`'s node shape, with the box as its rect.
- **Add web page is new** (also used by §5.6).
  - A one-field prompt asks for a URL and accepts only `http(s)` URLs.
  - It creates a `type: "link"` node, which Grove already draws as URL text and never fetches.
  - The prompt is `shell/confirm.ts confirmDialog` with a URL `<input>` as its message. Enter already confirms there, so no new dialog code is needed.

### 5.6 Right-click on empty canvas (addendum 4)

Mockup: `context-menu.png`.

- **Today.** Right-click on empty canvas shows **nothing**: `editing.ts` returns when nothing is selected, and `main.ts` blocks the browser menu. With a selection, a right-click on empty space shows the selection menu, which is surprising.
- **Proposed:** on empty canvas (not on a card, edge or label), always this menu, added at the pointer:
  - **Add card**, **Add note from vault**, **Add media from vault**, **Add web page**, **Create group** (an empty group at the pointer).
  - **Undo**, plus **Redo** only when there is something to redo.
  - **Paste.**
    - Clipboard text becomes a text card at the pointer, and a lone `http(s)` URL becomes a link card.
    - It reads the clipboard through the same native-command-then-async-API path the editor's context menu uses (`editor/clipboard.ts`).
    - Copying and pasting cards themselves (`Ctrl+C`/`Ctrl+V` as a JSON Canvas fragment) is a separate follow-up; Grove has no card copy today.
  - **Snap to grid ✓**, **Snap to objects ✓**, **Read-only**: the same settings as the gear menu (`controls.ts canvasSettings`), built from one shared item list so the two menus can't drift. Snap to objects already drives the alignment guides.
  - **In Read-only,** the add items, Create group and Paste are hidden.
- **Alt+right-click and plain right-click** both fire the same `contextmenu` event in WebKitGTK and Chromium, and both get this menu.
  - On Linux, some window managers take Alt+drag or Alt+right-click for moving or resizing windows. Omarchy's Hyprland binds window mouse actions to Super, so Alt+right-click reaches the app there.
  - Plain right-click is the reliable one; the help dialog will say "Right-click".

## 6. Targets

**Headless Chromium** (`bench-canvas-zoom.mjs`, the board fitted to the screen, which is the worst case with every card visible):

| Cards (+ edges) | Main-thread work per zoom or pan step | Dropped frames, wheel and pinch | Opening: board shown / longest task |
|---|---:|---:|---:|
| 100 (133) | ≤ 4 ms | 0 | ≤ 50 ms / ≤ 50 ms |
| 300 (400) | ≤ 6 ms | 0 | ≤ 80 ms / ≤ 50 ms |
| 1,000 (1,333) | ≤ 8 ms | 0 | ≤ 120 ms / ≤ 50 ms |
| 3,000 (4,000) | ≤ 14 ms (needs Z9) | 0 | ≤ 200 ms / ≤ 50 ms |

Also:
- **The settle work** (bands, swaps) stays under 12 ms in any frame.
- **The swap back to full content** takes at most about 4 ms per frame.
- **No task over 50 ms** happens while zooming, panning or opening.

**Real app** (WebKitGTK, Chris's machine, CZ0's command):
- 300 cards: 60 fps, with no frame gap over 20 ms while zooming and panning.
- 1,000 and 3,000 cards zoomed out: at least 58 fps.
- Chris's own bar decides: "seamless", with no visible hitch at the threshold or at settle.

## 7. Risks

- **Headless Chromium is not WebKitGTK.** The numbers in §3 are Chromium's. What should transfer:
  - **Style.** The stylesheet write per frame (Z1) is worse in WebKit, which restyles the whole document for a stylesheet change.
  - **Paint and raster.** These scale with the visible content in both engines, so Z2–Z4 help both.
  - **Layer counts.** WebKitGTK composites scrollable boxes for async scrolling in recent versions, so 1,000 scroll containers are likely costly there too.

  What may not transfer:
  - Chromium's "layerize" step is its own.
  - **Raster on a scale change.** Chromium keeps a `will-change` layer's raster scale during script-driven zoom, while WebKitGTK may re-raster every step (Z8).

  Hence CZ0: one measurement in the real app before and after CZ1, run by Chris (no agent may open app windows).
- **HiDPI.** Headless ran at device scale 1. A 2× display rasters 4× the pixels. Title mode and culling cut raster work in proportion, but WebKitGTK's CPU raster at 2× is the case to watch in CZ0.
- **The settle frame.** Applying a band (Z5) repaints the visible board once. With bodies culled and titles at low zoom, that is bounded by what is on screen (about 100 full cards at most above the threshold). It has to be measured (target under 12 ms) and sliced like Z4 if it isn't.
- **The swap back to full content** must never block, because one frame for 1,000 bodies costs about 860 ms. Z4's slicing is the guard. A card can show its title for a few frames after zooming in, as map apps do with tiles.
- **`content-visibility` support in WebKitGTK.** WebKit has supported `content-visibility` since 2024 (Safari 18). If Chris's WebKitGTK predates it, Z3 falls back to `display: none` on bodies, which costs a relayout of each card when shown again. Z4's slicing covers that too.
- **Behaviour changes Chris will notice:**
  - Card bodies no longer scroll unless selected (Z2).
  - Double-click in title mode zooms instead of editing (D3).
  - Edge labels hide when zoomed out.
  - The light theme's canvas becomes `#fafafa`.
- **Paste** depends on clipboard access in WebKitGTK. The editor's context menu already uses the same path successfully, so the risk is low.
- **Tests that assert today's look:**
  - The canvas round tests compare some computed styles, such as border colours.
  - CZ2 updates those expectations deliberately and keeps the permanent geometry and real-mouse tests unchanged. The 1 px CSS border stays for that reason.

## 8. Decisions for Chris

- **D1: the zoomed-out look** (`lod-options.png`):
  - **A: title only, centred (recommended).** It is closest to Obsidian, the calmest, and the cheapest.
  - **B:** the title plus faint content bars.
  - **C:** the title plus a type icon.
- **D2: where cards switch.** **Below 45% going out, back above 55% coming in (recommended).** Other numbers are a one-line change.
- **D3: double-click on a card while zoomed out.**
  - **Zoom to the card (recommended);** a second double-click edits.
  - The alternative is to edit straight away in a tiny editor.
- **D4: four small look-and-feel changes that come with the work.** OK as a set (recommended)?
  - A card body scrolls only when the card is selected or being edited. The wheel already pans everywhere else.
  - Edge labels hide when zoomed out.
  - The light theme's canvas becomes `#fafafa`, so white cards stand out.
  - Coloured cards get a full-colour border instead of a 70% mix.

## 9. Build split

Small pieces, each with its own branch, notes and full checks, and each reviewed by a different agent. Gemini is out of quota until about Nov 3, so it has no piece. **Start first, in parallel:** CZ-H, CZ0, CZ1 and CZ4.

| Piece | What | Agent | Needs | Review |
|---|---|---|---|---|
| **CZ-H** | Ctrl+hover previews in canvas cards (§5.4). Small, and can start as soon as Chris approves. | Grok | nothing | Claude |
| **CZ0** | **Measuring.** Turn the scratch bench into `scripts/bench-canvas-zoom.mjs` (100/300/1,000/3,000 cards, wheel and pinch, counting compositor `DrawFrame`/`DroppedFrame` and main-thread time per step, not rAF intervals). Change the 300-card zoom/pan test in `test-canvas-navigation.mjs` to assert no dropped frames, since its rAF intervals read 16.7 ms even while every frame drops (§3.2). Add a debug-build-only command, **"Canvas: measure zoom"**, that drives 300 synthetic Ctrl+wheel steps on the open canvas and shows frame-gap p50/p95/max. Chris runs it in the real app on a scratch vault, before and after CZ1. | Codex | nothing | Claude |
| **CZ1** | Z1 (no stylesheet writes per frame), Z2 (bodies not scrollers unless selected or edited), Z7 (cached rect). The biggest win for the least code. | Claude | nothing | Codex |
| **CZ2** | Title mode (§5.2, Z3) with hysteresis, zoom bands applied at settle (Z5), and card definition (§5.3). Updates the canvas look tests on purpose. | Claude | CZ1, D1–D4 | Codex |
| **CZ3** | Lazy bodies, culling, spatial index, incremental swap and release (Z4), open time (Z6), and batched edges in title mode (Z9). | Codex | CZ2 | Claude |
| **CZ4** | Empty-canvas right-click menu, **Add web page**, and **Paste** of text or a URL (§5.6). One shared item list with the gear menu. | Grok | nothing | Claude |
| **CZ5** | Ctrl+drag to create (§5.5), reusing CZ4's add items. | Grok | CZ4 | Codex |
| **CZ6** | *Only if CZ0 shows per-step re-raster in WebKitGTK after CZ1–CZ3:* freeze the raster during a gesture (Z8). | Claude | CZ0–CZ3 | Codex |

Every piece follows the usual rules: no new crates or npm packages, no app windows, `flock` for npm tests, the full checks, and restoring screenshots. Each zoom piece reruns `bench-canvas-zoom.mjs` before and after and puts both tables in its notes.
