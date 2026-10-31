# CZ2: title mode, zoom bands at settle, card definition

Branch `rebuild/canvas-cz2-claude`, from `rebuild/integration` `0df34d6` (CZ1 plus Grok's `fbe7816`), 2026-10-30. Local commits only; nothing pushed. No app window opened; every browser run was headless Chromium under the test lock.

Chris approved (Oct 30, 8:18 PM PT): **D1 = A** (title only, centred), **D2 = 45%/55%**, **D3 = double-click zooms first**, **D4 = all four small changes**. This piece is CZ2 from `CANVAS_ZOOM_PLAN.md` §9: title mode (§5.2, Z3), zoom bands at settle (Z5) and card definition (§5.3). I stayed out of the hover-preview code (CZ-H), the right-click menu (CZ4), and lazy bodies and culling (CZ3).

## In short

- **Zoomed out below 45%, cards show their title,** centred and bold at about 13 px on screen, on a raised fill with a crisp border, as in Chris's Obsidian screenshot. Content returns above 55%. The switch happens when the wheel rests (or at once for buttons and fit), never mid-gesture.
- **Card definition at every zoom:**
  - cards are one step lighter than the canvas;
  - borders stay 1 px on screen (1.5 px for coloured cards, in full colour);
  - groups get an outline and a stronger, readable label;
  - edges stay 1.5 px on screen.
- **Gestures got much cheaper at 1,000+ cards** (pinch at 1,000 cards: 29.5 → 10.2 ms per update, 42 → 0 dropped frames).
- **Not solved here:** at 1,000+ cards, the end of a gesture is one long task. It runs 56–61 ms for a band change at 1,000 cards, and about 120–140 ms when cards switch between titles and content. At 3,000 cards both are larger (table below). Bounding those needs per-card slicing and culling, which is CZ3's machinery (details under "Left open").

## What changed

**Lines** (`git diff --numstat`, excluding screenshots): 205 added, 33 removed.

| File | Lines |
|---|---:|
| `src/styles/canvas.css` | +55/−12 |
| `src/canvas/navigation.ts` | +34/−10 |
| `src/canvas/view.ts` | +18/−8 |
| `src/canvas/model.ts` | +18/−0 |
| `src/canvas/editing.ts` | +6/−1 |
| `src/canvas/model.test.ts` | +13/−1 |
| `scripts/test-canvas-navigation.mjs` | +61/−1 |

### Title mode (Z3, §5.2)

- **`navigation.ts`.** Title mode is one class, `is-zoomed-out`, on the world.
  - **When it switches:**
    - it starts below 45% and ends above 55% (`titleMode(scale, now)`);
    - it changes in `applyBand`, together with the zoom band;
    - so it follows the same settle as the bands from CZ1 and Grok's `fbe7816`. Wheel and pinch wait out 120 ms; buttons, fit, zoom to selection, resize and the first draw apply at once; a pan never applies it.
  - **`syncBand`** now also counts a pending title-mode change as "not settled", so a zoom that crosses 45% within one band (45% and 44% are both band −5) still settles.
- **`model.ts`: `canvasTitle(node)`,** a string operation that renders nothing:
  - **Note card:** the note name, plus ` › heading` for a subpath. This is the same text as the faint file label, which now uses this helper too.
  - **Link card:** its host (`jsoncanvas.org`). Nothing is fetched.
  - **Other file:** its file name.
  - **Text card:** its first heading, or else its first non-empty line, outside code fences. List, quote and heading marks and `** __ ~~ == * \`` are removed, and links and wikilinks keep their text or alias.
- **`view.ts`:**
  - Every card except groups and images gets a `.canvas-node-title`, hidden unless zoomed out.
  - Image cards get `is-image`. That replaces the old `:has(> .canvas-node-content > img)` rule, and title mode leaves image cards showing their picture.
  - A text card's title is refreshed when its editor closes.
- **`canvas.css`, title mode:**
  - Bodies get `content-visibility: hidden`: their DOM stays, but they are neither laid out nor painted. A card being edited, and an image card, never switch. Where `content-visibility` isn't supported, `display: none` is the fallback.
  - The title is centred, bold, up to two lines with an ellipsis, at `13px × the band's inverse scale`.
  - The faint note-name label and edge labels hide.
- **Tiny cards show as a box.**
  - Each card's `data-title-band` holds the band below which it is under 26 px tall or 50 px wide on screen. `titleBand()` in `navigation.ts` sets it when drawn and on resize, and skips writes that don't change it.
  - The static band sheet hides those titles with one rule per band. Nothing happens per card at settle.
- **D3 (`editing.ts`).** In title mode, a double-click on a card (not a group) zooms to it. It uses the same fit as Zoom to selection, so up to 200%. The next double-click edits. It works on read-only canvases too, since it only zooms. A group label still edits on double-click.
- **Initial zoom.** A canvas that opens fitted below 45% opens in title mode.

### Zoom bands at settle (Z5)

The static sheet from CZ1 now also sizes:
- the card **ring**;
- the **title**;
- the **group label**;
- the **edge stroke**.

These sit beside the connection points, edge ends and hit paths it already sized. The sheet is still built once and never written.

**What I measured and changed on the way:**
- **No band rule touches a card.** A rule on `.canvas-node` restyled each card and, through it, its children: about 15–28 µs per card at 1,000 cards, even when the rule set an unused variable or an outline width. The zoom-dependent ring is therefore its own child, `.canvas-node-ring` (`position: absolute; inset: -1px; pointer-events: none`), and the band sets the ring.
- **No `inherit` values on restyled elements.** The ring first had `border-radius: inherit`. A forced restyle at 1,000 cards took 41.9 ms with it and 30.7 ms with a fixed `8px`, apparently because the browser can't reuse cached styles for an element with an inherited value. The card body, which the title switch restyles, also had `border-radius: inherit`. It now has a fixed `7px`, the card's inner radius, so it looks the same.
- **No `@property` registration.** I first registered `--canvas-inverse-scale` as non-inherited, for rules on cards. Once only leaf elements are targeted, an A/B at 1,000 cards showed no difference (style 51 vs 47 ms, noise), so I took it out.

### Card definition (§5.3)

**`canvas.css`, with tokens on `.canvas-view`:**

| | Dark theme | Light theme |
|---|---|---|
| Canvas | `--background-primary` (`#1c1c1c`) | `--background-primary-alt` (`#fafafa`), changed per D4 |
| Card fill | `#262626` | White |

The fill steps are the ones from the plan and the mockup, measured on Chris's reference screenshot.
- **Border:** `--background-modifier-border-hover` (`#3f3f3f` dark, `#d4d4d4` light), 1 px CSS as before, so card geometry and the geometry tests are unchanged.
  - Below 100%, the ring adds `(1/scale − 1)` px around it, so the edge stays 1 px on screen.
  - A **coloured card** has a full-colour border (it was a 70% mix) and a 1.5 px on-screen ring.
  - Its 12% tint now sits on the card. It was a 7% tint on the body, which title mode hides.
- **Selected card:** the existing 2 px accent ring, plus a ring child that keeps it 2 px on screen when zoomed out. A `:where()` keeps the coloured-ring rule from outranking it.
- **Groups:**
  - The 7% fill stays.
  - The outline is the group colour at 55%, kept at 1 px on screen.
  - The label is semibold on an opaque 16% chip (it was 10% over transparent).
  - Below about 62% the label grows from its bottom-left corner (a `transform`, so no relayout) to stay about 14 px on screen.
- **Edges:** `stroke-width: max(2, 1.5/scale)` (selected: `max(5.5, 4/scale)`), so they stay about 1.5 px on screen.

### Tests

**`scripts/test-canvas-navigation.mjs`: 21 new checks** on a small board with a coloured text card, note, image, link, tiny card, group and labelled edge.
- **At 100%:**
  - cards show content, not titles;
  - no ring, half a pixel extra on coloured cards, 2 px edges, a label scale of 1;
  - the full-colour border;
  - light theme: white cards on `#fafafa`; dark theme: `#262626` on `#1c1c1c`.
- **At 50%:** cards still show content.
- **At 35%:**
  - bodies are `content-visibility: hidden` and the image is not;
  - titles read `Plan the trip`, `Target` and `jsoncanvas.org` and measure 13.0 px on screen;
  - the tiny card shows no title;
  - file and edge labels hide;
  - borders measure about 1 px (1.5 px coloured) on screen;
  - edges are 1.5 px and group labels about 14 px on screen;
  - a selected coloured card keeps a 2 px accent ring.
- **Hysteresis:**
  - Zooming in to 50% keeps titles, and above 55% content returns only once the wheel rests.
  - Zooming out to 50% keeps content, and below 45% titles return.
- **D3:** a double-click zooms to the card without editing, and a second double-click edits it.
- **Titles follow edits:** after editing, the card's title is the new text.

The permanent geometry and real-mouse tests are unchanged. **`model.test.ts`** gained a unit test for `canvasTitle`.

## Before and after

**How it was measured:**
- **Bench:** CZ0's `scripts/bench-canvas-zoom.mjs`, copied from `rebuild/canvas-cz0-codex` with its `canvas-zoom-trace.mjs` and its `browser.mjs` (which adds CDP event listeners). It ran headless Chromium 155 at 1280 × 1000, device scale 1, under the lock. Not committed.
- **Before:** a pristine copy of `0df34d6` in the scratchpad.
- **After:** a copy of this branch's code.
- **Boards:** CZ0's, with `4/3 ×` edges and a group per 50 cards.
- **Gestures,** each from Zoom to fit:
  - **Wheel:** 12 + 12 Ctrl+wheel notches. From fit it clamps at 1/16 and then ends at 100%, so at the end every card switches back to content.
  - **Pinch:** 60 + 60 small steps (150 + 150 at ≤300 cards).
  - **Pan:** 24 large pans.
- **"Main ms/update"** is the main thread's task time per viewport update. "Dropped" is Chromium's `DroppedFrame` count for the gesture, and long tasks are tasks over 50 ms.

| Cards | Gesture | Main ms/update | Layerize ms/update | Dropped frames | Long tasks (count / longest ms) |
|---:|---|---:|---:|---:|---:|
| 100 | wheel | 2.6 → 3.0 | 0.95 → 0.53 | 1 → 2 | 0 → 0 |
| 100 | pinch | 2.3 → 2.1 | 0.90 → 0.51 | 0 → 0 | 0 → 0 |
| 100 | pan | 1.7 → 1.8 | 0.23 → 0.19 | 0 → 0 | 0 → 0 |
| 300 | wheel | 7.5 → **4.7** | 3.4 → 0.8 | 2 → 2 | 0 → 0 |
| 300 | pinch | 6.2 → **3.4** | 3.1 → 0.7 | 1 → 1 | 0 → 0 |
| 300 | pan | 5.4 → **3.1** | 0.6 → 0.3 | 1 → 0 | 0 → 0 |
| 1,000 | wheel | 46.0 → **21.2** | 19.5 → 1.9 | 19 → **6** | 3 / 103 → 2 / 106 |
| 1,000 | pinch | 29.5 → **10.2** | 18.7 → 1.9 | 42 → **0** | 0 → 0 |
| 1,000 | pan | 13.2 → **9.7** | 2.7 → 0.4 | 6 → 2 | 1 / 63 → 0 |
| 3,000 | wheel | 152 → 189 | 86.3 → 14.8 | 98 → 90 | 13 / 325 → 8 / **720** |
| 3,000 | pinch | 121 → **39.2** | 85.9 → 7.7 | 384 → **74** | 61 / 149 → **0** |
| 3,000 | pan | 62.0 → **38.0** | 13.8 → 1.6 | 36 → 19 | 2 / 259 → 1 / 92 |

**Opening** (board shown / longest task, ms):

| Cards | Before | After | DOM elements |
|---:|---:|---:|---|
| 100 | 88 / 75 | 98 / 81 | 2,474 → 2,676 |
| 300 | 243 / 206 | 251 / 213 | 7,245 → 7,851 |
| 1,000 | 1,086 / 939 | 1,119 / 947 | 23,936 → 25,956 |
| 3,000 | 6,359 / 5,883 | 6,609 / 5,861 | 71,631 → 77,691 |

Opening is unchanged within noise: two small elements per card (title, ring) on top of each card's CodeMirror context. CZ3's Z6 owns open time.

### The settle itself

The bench averages the settle into the gesture, so I also traced it directly. This is a scratch probe, `settle.mjs` in the session scratchpad, on the same boards.
- It traces one action and takes the longest main-thread task ("max") and the total.
- "Restyled" is the sum of `UpdateLayoutTree` element counts.
- Each row starts where the previous one ended.

| Cards | Action | Longest task (ms) | Total main (ms) | Elements restyled |
|---:|---|---:|---:|---:|
| 300 | band step in title mode (fit, one wheel) | 6.8 → **4.6** | 8.3 → 5.9 | 3 → 3 |
| 300 | 35% → 60% (titles off) | 11.4 → 34.8 | 19.7 → 44.8 | 1,203 → 2,591 |
| 300 | 60% → 40% (titles on) | 11.8 → 30.2 | 20.4 → 41.2 | 1,203 → 2,591 |
| 300 | Reset zoom from fit (to 100%, titles off) | 16.9 → 34.8 | 55.7 → 57.9 | 1,289 → 2,667 |
| 1,000 | band step in title mode | 43.8 → 56.3 | 83.0 → 71.5 | 4,002 → 7,375 |
| 1,000 | 35% → 60% (titles off) | 45.5 → **135.5** | 84.8 → 160.6 | 4,002 → 8,629 |
| 1,000 | 60% → 40% (titles on) | 45.6 → **119.7** | 76.9 → 162.7 | 4,002 → 8,629 |
| 1,000 | Zoom to fit from 40% | 34.7 → 48.1 | 145.9 → 133.6 | 4,053 → 7,435 |
| 3,000 | band step in title mode | 171.6 → 185.1 | 287.8 → 227.6 | 12,003 → 22,123 |
| 3,000 | 35% → 60% (titles off) | 200 → **538** | 325 → 595 | 12,003 → 25,883 |
| 3,000 | 60% → 40% (titles on) | 176 → **604** | 321 → 804 | 12,003 → 25,883 |
| 3,000 | Zoom to fit from 40% | 141 → 230 | 494 → 356 | 12,027 → 22,147 |

### Reading it

- **During gestures, title mode does what the plan said.** At 1,000 cards a pinch step is 10 ms with no dropped frames, and layerize per update fell 10× at 1,000 and 3,000 cards. The 3,000-card pinch still drops frames (39 ms per update): edges, hit testing and raster of 4,000 edges, which is Z9 in CZ3.
- **At 100–300 cards everything is smooth.**
  - A band change in title mode costs about 5 ms.
  - Switching between titles and content costs 30–35 ms in one task: under 50 ms, over the plan's 12 ms target.
- **At 1,000 and 3,000 cards the end of a gesture is a long task:**
  - A band change restyles each title (font size), ring, edge stroke, hit path and edge end. Measured per element at 1,000 cards: a title about 20 µs (the font-size change; with a fixed font, about 3 µs), a ring about 3 µs once its radius was fixed, an edge about 8 µs, a hit path about 5 µs, an edge end about 2 µs.
  - Switching titles on or off also repaints every card (paint 48–65 ms at 1,000 cards), because nothing is culled yet.
  - The 3,000-card wheel row's 720 ms task is that switch back to content at 100%, with all 3,000 bodies laid out and painted at once.

## Decisions

- **The settle is one task, not sliced.**
  - I tried slicing with one world attribute per chunk of cards (`data-zoom-band-k`, eight chunks). Each chunk's restyle was precise, but every attribute change on the world makes the browser walk the whole board subtree for its invalidation: about 8 ms at 1,000 cards and more at 3,000, paid once per slice.
  - Slicing that actually bounds frames needs per-card writes, applied nearest the pointer first. That is CZ3's spatial index and incremental swap (Z4), so I left it there rather than build a second mechanism.
- **The image downscale** (§5.2: "a very large image gets a downscaled bitmap") **is not done.** Chromium already decodes large images at a reduced scale when they're drawn small, and none of the bench boards has images. Whether WebKitGTK needs it is a question for CZ0's in-app measurement. If it does, it fits CZ3's lazy bodies.
- **Long titles break inside words on narrow cards** (`overflow-wrap: anywhere`), for example "Welcom/e" at 18%, as in the mockup. Hiding the title below 50 px wide limits it.
- **The group label grows by `transform`, not font size,** so a band change doesn't re-lay out or re-shape it.

## What I relied on for Obsidian

Only Chris's reference screenshots (`.cz-ref-obsidian-zoomed-out.png` and the others, not committed) and the plan's mockups. No Obsidian code, CSS or assets, and no help page beyond what the CZ plan already cited.

## Checks

- **`npm run build`:** passed (existing chunk-size warning only).
- **`flock /tmp/grove-npm-test.lock npm test`:** exit 0 in one run, no reruns. Browser discovery 4/4; Vitest 70 files, 1,227 tests; 2,094 PASS lines including every canvas script and `posttest`. The 300-card pan and zoom frame checks: max 16.8 ms.
- **`npm run audit:offline`:** passed (180 source files).
- **`cargo build`:** passed.
- **`cargo test`:** 73 passed, 4 ignored.
- **Screenshots** under `rebuild/round*-shots/` were restored before committing.

## Left open

- **Long tasks at the end of gestures on 1,000+ card boards** (tables above). Suggestions for CZ3:
  - **Batched edges and no hit paths or edge ends in title mode** (Z9) would remove about 60% of the elements a title-mode band change restyles (5,332 of 7,375 at 1,000 cards).
  - **Culling,** with off-screen bodies `content-visibility: hidden` and off-screen titles not displayed, bounds the switch's paint and the titles' font work to what is on screen. A hidden title costs about 2 µs to restyle, against about 20 µs for a visible one.
  - **Per-card band writes, sliced nearest-first, instead of one world attribute,** if a settle still exceeds about 12 ms after that. A world attribute costs a full-board invalidation walk per change.
  - **The switch back to content** should swap bodies in slices (Z4); it is the 720 ms task at 3,000 cards.
- **WebKitGTK:** `content-visibility` needs WebKitGTK 2.46 or later. The `display: none` fallback is untested in the real app.
- **The 300-card frame test** still reads rAF intervals (CZ0 replaces it).
