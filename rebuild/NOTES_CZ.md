# CZ: canvas zoom plan (notes)

Branch `rebuild/canvas-zoom-plan-claude`, from `rebuild/integration` `298c169`, 2026-10-30. Plan and design only. No app source changed, nothing pushed, and no app window opened (every browser run was headless Chromium under the test lock).

## What was done

- **`rebuild/CANVAS_ZOOM_PLAN.md`** (new): measurements, root causes, design, targets, risks, four decisions and an eight-piece build split. It covers the original task plus Chris's four addenda: card definition, Ctrl+hover previews, Ctrl+drag to create, and the empty-canvas right-click menu.
- **`rebuild/canvas-zoom-mockups/`** (new): `build.mjs`, `canvas.css`, a README, and five pages as HTML + PNG:
  - `definition`: today vs proposed, side by side;
  - `lod-options`: zoomed-out options A/B/C;
  - `threshold`: when cards switch, and what each type shows;
  - `ctrl-drag`;
  - `context-menu`.
- **Scratch tools** (session scratchpad only, not committed):
  - `bench-zoom.mjs`: zoom/pan bench with trace counters and CSS-variant switches;
  - `browser-bench.mjs`: `scripts/browser.mjs` plus an event hook;
  - `probe-input.mjs`: Ctrl+hover, Ctrl+drag, right-click;
  - `probe-open.mjs`: CPU profile of opening a big canvas;
  - `px.mjs`: reads pixel colours from the reference screenshots.

  CZ0 turns the bench into `scripts/bench-canvas-zoom.mjs`.

## Main findings

- **The cause of the stutter.**
  - **First wall:** each pan or zoom frame rewrites an adopted stylesheet (`navigation.ts:41-44`). That repaints every edge's hit path and re-rasters the whole board: 300 cards drop a frame on every pinch step. Removing it alone makes 300 cards smooth in Chromium.
  - **Next walls:** card bodies as scroll containers, then full content drawn at every zoom. At 1,000 cards, removing the stylesheet write and the bodies took a step from 111 ms to 5.7 ms.
- **The existing 300-card zoom test can't see any of this:** rAF intervals stay at 16.7 ms while every frame drops.
- **The open-time cause.** Opening 1,000/3,000 cards takes 1.05 s/7.0 s in one task. Every card creates a CodeMirror `EditorView`, whose constructor reads `document.fonts.ready` (a forced style update of a growing page).
- **Ctrl+hover previews work headless** in every canvas case. The likely WebKitGTK-only cause is the canvas's `preventDefault()` on `pointerdown` silencing `mousemove`; the fix is to listen to `pointermove`.

## What I relied on for Obsidian

Only its public Canvas help page (`https://obsidian.md/help/plugins/canvas`, read once) and Chris's screenshots (`.cz-ref-*.png`, not committed). No Obsidian code, CSS or assets. The help page says nothing about zoomed-out cards, borders or Ctrl+drag, so those designs follow the screenshots.

## Checks

- **No app source changed,** so build and tests were not rerun for a code change.
- **What did run:**
  - `node rebuild/canvas-zoom-mockups/build.mjs`, which regenerates the PNGs.
  - The bench and probes above.
- **Not committed:** the prompt files, the `.cz-*` reference screenshots and the logs. No `round*-shots` changes were made.

## Left open / for Chris

- Decisions D1–D4 in plan §8.
- **CZ0's real-app measurement** is needed before and after CZ1, because headless Chromium can't show WebKitGTK's raster behaviour. Chris runs it, since agents may not open app windows.
- **The bench's pan numbers** use 4,000 px jumps and overstate pan raster. They are kept for reference only.
