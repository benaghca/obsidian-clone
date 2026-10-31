# CZ2 review

VERDICT: OK

Reviewed `rebuild/canvas-cz2-claude` (`47de197`, notes `a30d56d`) on `rebuild/cz2-review-grok`. One fix is on this branch: `9da9375`. Nothing was pushed. Hover preview (CZ-H), the empty-canvas menu (CZ4), and lazy bodies / culling (CZ3) were left alone. `git diff --name-only 0df34d6..HEAD` is the CZ2 files plus this note.

## What CZ2 does

Z3 and Z5 from `CANVAS_ZOOM_PLAN.md`, plus the card definition in section 5.3. Chris's decisions, as recorded in `NOTES_CZ2.md`:

- D1. Below the zoom-out threshold a card shows its title only, centred.
- D2. Title mode begins below 45% and ends above 55%. Exactly 45% stays on content. Exactly 55% stays on titles. The class `is-zoomed-out` is applied when a zoom settles (wheel and pinch wait 120 ms). Buttons, fit, zoom-to-selection, resize, and the first draw apply it at once. A pan does neither.
- D3. A double-click on a zoomed-out card zooms to it. A second double-click edits.
- D4. Card body scrolls only when the card is selected or edited. Edge labels hide while zoomed out. The light canvas is `#fafafa` under white cards. A coloured card's border is the full colour. Raised fill is `#262626` on the dark canvas. Borders stay about 1 px on screen, 1.5 px for a coloured card. Edges stay about 1.5 px on screen. Group outline and label strengthen with the band.

Bodies use `content-visibility: hidden` (with `display: none` where that is unsupported), except a card that is being edited and an image card. The band sheet is still the one static `CSSStyleSheet` from CZ1. `test-canvas-navigation.mjs` checks that a ctrl-wheel writes no stylesheet rule.

`git diff --numstat 0df34d6..a30d56d`, excluding `NOTES_CZ2.md` and screenshots: 205 insertions, 33 deletions. `test-canvas-navigation.mjs` +61/−1, `editing.ts` +6/−1, `model.test.ts` +13/−1, `model.ts` +18, `navigation.ts` +34/−10, `view.ts` +18/−8, `canvas.css` +55/−12.

## Two fixes

**A wheel aimed at 55% left title mode.** Chrome delivers a CDP `mouseWheel` `deltaY` as float32. A zoom aimed at exactly 0.55 landed at `0.5500000052555477`. `String(0.55)` is still `"0.55"`, so the transform style looked exact, and `<= 0.55` was false, so title mode turned off. The same noise at 0.45 landed at `0.45000000665697404`, which correctly stayed on content because the predicate is `< 0.45`.

`titleEdge` snaps a scale within `1e-6` of 0.45 or 0.55 onto that edge before the predicate. One wheel notch is about 0.2%. The navigation script now wheels to 0.55, 0.551, 0.45, and 0.449, with a settle wait, in both directions.

**A card that cannot pass 55% never edited.** Zoom-to-fit of a normal card goes to 200% and leaves title mode, so the second double-click hits the card's own editor. A card that still fits at 55% or below stayed in title mode, and the second double-click zoomed again. The handler remembers the card and the scale of a title-mode zoom that stayed zoomed out. A later double-click on that card, with the scale still within `1e-4` and the canvas writable, calls `edit`. One wheel notch moves the scale by more than that, so a zoom between the clicks frames the card again. Read-only canvases still zoom. Groups are unchanged: their label still edits. The navigation script opens a 4000×2400 card, drags it in title mode (x 0 → 380), checks the first double-click stays zoomed out and not editing, and checks the second opens the editor.

`9da9375` is `navigation.ts` +5/−1, `editing.ts` +16/−3, `test-canvas-navigation.mjs` +23. 44 insertions, 4 deletions.

## Bench

Same CZ0 trace, rerun for this review. Scratch scripts under `/tmp` (not committed). Headless Chromium 155.0.8059.84, 1280×1000, device scale 1, `--disable-gpu`, under `/tmp/grove-npm-test.lock`. Before is pristine `0df34d6`. After is this branch, including `9da9375`. The bench does not double-click, so the edit fix is outside these numbers.

Boards: 100 / 300 / 1,000 / 3,000 cards, one file card in five, `floor(4/3 × cards)` edges, one coloured group per 50 cards. Each gesture starts from zoom to fit. Main ms/update is main-thread `RunTask` per viewport update. Long tasks are `RunTask` over 50 ms.

### Before (`0df34d6`) → after (this branch)

| Cards | Gesture | Main ms/update | Dropped | Long tasks (count / max ms) | Open ms / longest | DOM |
|---:|---|---:|---:|---|---|---:|
| 100 | wheel | 2.5 → 3.0 | 1 → 1 | 0 → 0 | 90 / 77 → 92 / 76 | 2,474 → 2,676 |
| 100 | pinch | 2.2 → 2.0 | 0 → 0 | 0 → 0 | | |
| 100 | pan | 1.7 → 1.9 | 0 → 0 | 0 → 0 | | |
| 300 | wheel | 6.6 → 5.0 | 2 → 2 | 0 → 0 | 238 / 203 → 257 / 214 | 7,245 → 7,851 |
| 300 | pinch | 6.2 → 3.5 | 1 → 1 | 0 → 0 | | |
| 300 | pan | 3.7 → 3.8 | 1 → 0 | 0 → 0 | | |
| 1,000 | wheel | 45.1 → 20.5 | 19 → 6 | 3 / 106 → 1 / 105 | 1,070 / 923 → 1,118 / 942 | 23,936 → 25,956 |
| 1,000 | pinch | 31.4 → 10.5 | 52 → 0 | 0 → 0 | | |
| 1,000 | pan | 17.4 → 9.3 | 6 → 2 | 1 / 65 → 0 | | |
| 3,000 | wheel | 180 → 262 | 108 → 130 | 13 / 326 → 11 / 580 | 6,341 / 5,857 → 6,446 / 5,724 | 71,631 → 77,691 |
| 3,000 | pinch | 122 → 34.9 | 384 → 65 | 61 / 147 → 0 | | |
| 3,000 | pan | 60.4 → 36.5 | 34 → 19 | 2 / 256 → 1 / 86 | | |

DOM counts match `NOTES_CZ2.md`. At 100–1,000 cards, and for the 3,000-card pinch and pan, this rerun matches Claude's after column within noise and is faster than `0df34d6`. Layerize on a zoom falls at every size (1,000-card wheel 19.5 → 1.9 ms/update; 3,000-card wheel 96 → 16).

**The 3,000-card wheel got slower.** 262 ms/update against 180 before, 130 dropped frames against 108, longest task 580 ms against 326. Style, paint, and layout rose on that row (style 8.1 → 25.4, paint 4.9 → 46.3, layout 1.6 → 9.3) while layerize fell, which is the content switch at the end of the gesture. Claude measured 152 → 189 ms/update on that row, longest task 720 ms. This machine's longest wheel task was 580 ms. The 720 ms figure did not recur. The plan leaves bounding that switch to CZ3. It was not built here.

Opening is a little slower at every size (two elements per card: title and ring) and the longest open task is in the same band as before. CZ3 owns open time.

### Title / content switch

Separate settle trace on the same board shape (edges and groups). Longest main `RunTask`. The band-step here is one zoom-in notch (`deltaY: -80`) from fit, so a board already on the 1/16 floor still changes band and stays in title mode. That step is a different action from Claude's zoom-out-from-fit, and at 3,000 cards it is one notch off the floor (scale 0.075, band −15), so his 185 ms band-step is not the comparison. The title switches are.

| Cards | Band-step | Titles off (this / Claude) | Titles on (this / Claude) |
|---:|---:|---|---|
| 300 | 16.1 ms | 33.5 / 34.8 | 30.5 / 30.2 |
| 1,000 | 54 ms | 130.8 / 135.5 | 132.4 / 119.7 |
| 3,000 | 31.5 ms | 477 / 538 | 608 / 604 |

Claude's 1,000-card switch of about 120–136 ms is confirmed (131–132 ms here). The 3,000-card switch back to titles is 608 ms, next to his 604. The switch to content is 477 ms, same class as his 538–600. Both are one task over 50 ms. CZ3's per-card slicing and culling are what bound them.

## Tests

All on `9da9375`, one run each, no flake rerun:

- `npm run build` (via `npm run audit:offline`, which runs the build first): passed, `✓ built in 417ms`. Existing chunk-size warning only (`index-Dw_mV4SG.js` 1,107.59 kB).
- `npm run audit:offline`: passed, 180 source files.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0. Vitest 70 files, 1,227 tests. 2,102 PASS lines. New checks passed: exactly 55% stays in title mode, just above 55% leaves it, exactly 45% stays on content, just below 45% returns to titles, the second double-click edits, and the 4000×2400 card drags (0 → 380) and edits on the second double-click. 300-card pan and zoom presentation max 16.8 ms. 300-card drag max 16.8 ms (49 intervals). 1000-row Bases scroll max 16.8 ms. Posttest included, K7 fuzz `cases=48 seed=27447`.
- `cargo build` and `cargo test` from `rebuild/app/src-tauri`: 73 passed, 4 ignored. Rust did not change.

Screenshots under `rebuild/round*-shots/` were restored with `git checkout` before this commit.

## Integration

`rebuild/integration` was `565d826` ("Merge branch 'rebuild/cz4-review-grok' into rebuild/integration") and was not moved. Scratch merge of `9da9375` onto that commit in `/tmp/cz2-int`, not committed.

One conflict, in `rebuild/app/scripts/test-canvas-navigation.mjs`. The destructure keeps both `on` (integration's CZ0 `traceGesture`) and `chord` (CZ2's title-edit test):

`await withBrowser(async ({send,on,run,click,move,point,check,press,chord,double,shot})=>{`

`editing.ts`, `view.ts`, `navigation.ts`, `model.ts`, and `canvas.css` merged cleanly. The merged editor has `titleZoom` and CZ4's empty-canvas menu. The merged view has `canvasTitle` and CZ-H's `card.dataset.path`.

`npm run build` in the scratch tree passed. The first `npm test` passed vitest (72 files, 1,242 tests) and the canvas navigation checks, including exactly 55% and the huge-card second double-click, then stopped in `test-canvas-notes.mjs`. `geometry()` imports `/node_modules/@codemirror/view/dist/index.js`, and the page threw `Failed to resolve module specifier "@codemirror/state"`. The same script passes on this branch. The scratch `node_modules` was a symlink to this tree's `node_modules`, which lives on another filesystem, outside the Vite root. Vite realpath'd the file, refused to transform it, and the static handler served the published file with its bare import intact. A direct request on this tree's own Vite rewrites that import to `/node_modules/.vite/deps/@codemirror_state.js`.

The scratch `vite.config.ts` gained a `server.fs.allow` entry for this tree's `node_modules`. That file is only in the throwaway worktree. With that, the request is transformed. The suite was then rerun from `test-canvas-notes.mjs` through `test-search-commands.mjs` and `posttest`, under the lock. Exit 0, 697 PASS lines, including the note-card geometry checks and K7 fuzz `cases=48 seed=27447`. No product failure on the merge.

## Left open

- The 1,000-card and 3,000-card title/content switch, and the 3,000-card wheel, are over 50 ms. CZ3 (lazy bodies, culling, slicing the swap) is the bound. Not started here.
- Image downscale for a very large image drawn small is still undone, as in `NOTES_CZ2.md`. The bench boards have no images.
- `content-visibility` needs WebKitGTK 2.46 or later. The `display: none` fallback was not run in WebKit. No real GUI window was opened. Checks are headless Chromium.

## Reading

This review used `rebuild/CANVAS_ZOOM_PLAN.md` and `rebuild/NOTES_CZ2.md`. No Obsidian source, CSS, or assets. Claude's notes say he used Chris's uncommitted reference screenshots and the Canvas help quotation already in the plan.
