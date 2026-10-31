# CZ0 — Canvas zoom measurements

Branch `rebuild/canvas-cz0-codex`, from `18f43a9` (integration `298c169` plus
the approved Canvas zoom plan). K5 was complete and committed before switching;
its implementation is not part of this branch. No zoom optimisation is included.

Implementation commit: `6ca9904`; **8 files, +268/-14**, excluding these notes.
New files: bench 98 lines, trace helper 43, trace tests 21, debug command module
55. Existing edits: browser harness +8/-2, navigation test +33/-11, command
registration +9, package script +1/-1.

## Changes and decisions

- `scripts/bench-canvas-zoom.mjs` generates 100/300/1,000/3,000-card boards:
  250 × 160 cards, four text cards per note card, two thirds coloured,
  floor(4N/3) edges, every 25th edge labelled, and one coloured labelled group
  per 50 cards. The note is short local Markdown; no external assets are used.
- Each gesture starts at Zoom to fit. Wheel sends 12 × -100 then 12 × +100 px
  at requested 16 ms spacing. Pinch sends 150 × -6 then 150 × +6 at 8 ms for
  100/300 cards, 60 + 60 for 1,000/3,000. Pan uses 12 + 12 wheel jumps of
  4,000 px, for reference. Native CDP inputs are sent without waiting for each
  ACK, so a busy renderer cannot silently throttle the input generator.
- Chromium can coalesce native wheel inputs. The output reports requested
  inputs, DOM wheel deliveries and viewport transform updates separately, and
  reports CPU per requested input in JSON and per viewport update in the table.
  These denominators matter: coalescing must not make expensive frames look
  cheap. The final input carries an explicit timestamp; the trace stays open
  until that timestamp reaches the DOM and two rAF callbacks plus 250 ms have
  elapsed. Counters stop before trace transfer. ACK alone was insufficient in
  a preliminary measurement and let input leak into the next gesture; those
  preliminary numbers are excluded below.
- `scripts/canvas-zoom-trace.mjs` collects a CDP trace through a stream and
  counts renderer DrawFrame/DroppedFrame events. It sums renderer-main RunTask,
  UpdateLayoutTree, Layerize, Paint, HitTest and Layout durations, and worker
  RasterTask durations in the same renderer process. Long tasks are main
  RunTask durations over 50 ms. Raster is summed worker CPU, not elapsed time;
  style/layer/paint categories are components of inclusive RunTask time and
  must not be added to it. CPU here means completed trace-task durations, not
  hardware counters; scheduling delays can contribute. Frame counts are raw
  trace events and need not map one-to-one to JavaScript viewport updates; no
  FPS ratio is inferred from them. Missing renderer metadata, missing DrawFrame events
  or trace data loss fails measurement rather than passing with zero counts.
- `scripts/browser.mjs` exposes a small CDP event subscription helper, reused
  for Tracing.tracingComplete; it does not copy or change browser startup.
- The 300-card/400-edge navigation regression now starts fitted, counts actual
  compositor events for both pan and zoom, and prints CPU/drop data. It removes
  the misleading rAF-under-20-ms assertion. Current unoptimised code drops
  frames: **the explicit interim ceiling is 24 dropped frames per 24 inputs**
  for each gesture. This is a baseline regression ceiling, not the zero-drop
  acceptance target. CZ1 should tighten it to **zero**, as the plan requires.
  The existing no-child-DOM-mutation and unchanged-file checks remain.
- The command **Canvas: measure zoom** (`canvas:measure-zoom`) is registered
  only inside `import.meta.env.DEV` and dynamically imports `canvas/measureZoom`.
  It is available only with an active canvas, fits it, drives 300 synthetic
  Ctrl+wheel steps (150 in/150 out, ±6 px, 8 ms requested spacing), and shows
  callback-gap p50/p95/max, gaps over 20 ms, device scale, engine and long tasks
  where that API exists. It restores the prior live viewport and never saves.
  Escape, window blur, hiding the document or leaving the canvas cancels it.
  Concurrent runs are suppressed. It explicitly reports **compositor dropped
  frames unavailable**: the page API exposes neither those counts nor raster
  timing. Callback gaps cannot prove presented-frame smoothness. The command
  and its implementation are absent from the production bundle.
- Permanent regressions cover trace-process/thread filtering, unavailable
  instrumentation, the 300-step debug command, viewport restoration,
  cancellation, no file writes and command availability outside a canvas.

The implementation touches only measurement/test infrastructure and the DEV
command registration/module. No navigation, zoom, rendering, scrolling CSS,
hover-preview or context-menu implementation changes; no native command,
permission, dependency or file-format changes. The plan is the behaviour and
measurement source. No fresh Obsidian lookup, code or assets were used.

## Measurements

Chromium 155.0.8059.84, 1280 × 1000, device scale 1, headless with
`--disable-gpu` (the shared harness's software path). Every gesture starts fitted.
These are unoptimised baseline figures for CZ1–CZ3. All durations below are ms;
main and raster CPU are per viewport transform update.

| Cards | DOM | Wheel main | Pinch main | Pinch requested/delivered/updates | Pinch drawn/dropped | Pinch worker raster | Pan main (reference) | Open / longest task |
|---:|---:|---:|---:|---|---|---:|---:|---:|
| 100 | 2,882 | 9.4 | 8.7 | 300/231/147 | 147/2 | 31.6 | 4.7 | 101.2 / 83.0 |
| 300 | 8,469 | 28.0 | 27.1 | 300/154/135 | 135/89 | 62.4 | 15.3 | 252.2 / 201.0 |
| 1,000 | 28,016 | 110.7 | 109.6 | 120/61/61 | 61/336 | 34.7 | 60.0 | 1169.7 / 955.0 |
| 3,000 | 83,867 | 411.2 | 411.4 | 120/61/61 | 78/1441 | 59.5 | 221.8 | 6977.3 / 6219.0 |

Trace breakdown per viewport update (worker raster is parallel CPU):

| Cards / gesture | Requested/delivered/updates | Drawn/dropped | Main | Style | Layerize | Paint | HitTest | Layout | Raster | Long tasks count/max |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 100 / wheel | 24/24/18 | 18/4 | 9.380 | 3.876 | 2.057 | 0.439 | 0.560 | 0.296 | 30.320 | 0 |
| 100 / pinch | 300/231/147 | 147/2 | 8.690 | 3.851 | 2.082 | 0.445 | 0.455 | 0.294 | 31.604 | 0 |
| 100 / pan | 24/24/24 | 24/0 | 4.713 | 2.833 | 0.460 | 0.536 | 0.282 | 0.000 | 5.314 | 0 |
| 300 / wheel | 24/21/18 | 18/14 | 28.000 | 9.781 | 7.433 | 1.727 | 1.537 | 0.852 | 62.636 | 1/72.2 |
| 300 / pinch | 300/154/135 | 135/89 | 27.120 | 10.420 | 7.720 | 1.269 | 1.489 | 0.856 | 62.413 | 0 |
| 300 / pan | 24/24/23 | 23/5 | 15.317 | 8.961 | 1.398 | 1.705 | 1.018 | 0.000 | 6.079 | 0 |
| 1,000 / wheel | 24/14/10 | 10/49 | 110.712 | 36.209 | 50.861 | 5.462 | 7.267 | 3.233 | 87.178 | 10/111.5 |
| 1,000 / pinch | 120/61/61 | 61/336 | 109.584 | 36.397 | 50.014 | 4.096 | 6.148 | 3.317 | 34.654 | 61/124.8 |
| 1,000 / pan | 24/13/13 | 13/34 | 59.991 | 33.441 | 9.092 | 9.711 | 5.134 | 0.000 | 9.151 | 4/140.4 |
| 3,000 / wheel | 24/13/13 | 15/285 | 411.247 | 114.055 | 214.119 | 26.555 | 22.654 | 10.427 | 522.967 | 13/504.1 |
| 3,000 / pinch | 120/61/61 | 78/1441 | 411.382 | 108.362 | 225.826 | 13.887 | 23.308 | 10.424 | 59.532 | 62/468.1 |
| 3,000 / pan | 24/13/13 | 13/146 | 221.836 | 104.507 | 40.124 | 32.832 | 22.012 | 0.000 | 17.350 | 13/588.0 |

These are baseline limitations, not accepted smoothness results: 300-card
pinch costs 27.1 ms/update; 1,000 and 3,000 cost 109.6 and 411.4 ms/update.
The large opening and gesture long tasks remain for CZ1–CZ3. Counts differ
from the plan's scratch run; input coalescing and machine load affect the
number of drawn and dropped frames. Compare future changes using this
same bench and options, including the delivery barrier and denominators.

Dedicated final navigation regression: pan **8 drawn / 9 dropped**, zoom
**8 drawn / 8 dropped**, each over 24 inputs; both below the interim ceiling.
The small-canvas debug probe sent exactly 300 synthetic inputs, 148 callback
gaps, p50/p95/max **16.7/16.7/16.8 ms**, no long tasks, with compositor counts
correctly unavailable. Those callback numbers are diagnostic, not a claim
that the expensive fitted 300-card board presents smoothly.

Device-scale-2 sensitivity, same 300-card board and software path, passed:

| Gesture | Requested/delivered/updates | Drawn/dropped | Main ms/update | Worker raster ms/update | Long tasks count/max |
|---|---|---|---:|---:|---|
| Wheel | 24/18/14 | 14/12 | 26.630 | 64.281 | 0 |
| Pinch | 300/152/146 | 146/109 | 29.100 | 52.570 | 1/57.9 |
| Pan | 24/23/19 | 19/6 | 16.013 | 6.675 | 0 |

Open/longest task was **289.8/237.0 ms**. Against scale 1's 300-card pinch,
main work was **27.1 → 29.1 ms/update**, drops **89 → 109**, parallel raster
**62.4 → 52.6 ms/update**. This single pair is not a causal raster-speed claim:
scale, coalescing, tile reuse and scheduling affect worker totals. Both fail the
smoothness target. No GPU or native-WebKit conclusion follows from it.

Reproduce from `rebuild/app`:

```sh
flock /tmp/grove-npm-test.lock node scripts/bench-canvas-zoom.mjs
# Optional raw traces and device-scale sensitivity:
flock /tmp/grove-npm-test.lock node scripts/bench-canvas-zoom.mjs --cards=300 --device-scale=2 --trace-dir=/tmp/grove-cz0-traces
```

The benchmark remains outside npm test: big boards intentionally demonstrate
multi-second opening tasks and heavy tracing. The 300-card regression and the
debug-command checks run through the existing navigation script in npm test.

## Checks and limits

- `npm run build`: PASS, existing large-chunk warning only.
- `npm run audit:offline`: PASS, 181 source files plus dist/CSP/capabilities/
  dependencies. A separate scan of dist found none of `canvas:measure-zoom`,
  `Canvas: measure zoom` or the diagnostic result text; no measureZoom chunk.
- Node browser-discovery and trace-parser tests: PASS, 6 tests.
- Vitest: PASS, 70 files / 1,226 tests, in the full npm invocation.
- `cargo build --offline` and `cargo test --offline`: PASS, 73 passed,
  0 failed, 4 ignored; binary/doc tests passed. Native code is unchanged.
- All-size baseline bench and scale-2 300-card bench: PASS under the shared lock.
- Dedicated navigation/debug regression: PASS under the shared lock.
- Full `flock /tmp/grove-npm-test.lock npm test`, including posttest: PASS,
  exit 0, **618 s** including the shared lock. Permanent geometry/real-mouse
  checks passed. The new compositor test repeated at **10 drawn / 11 dropped**
  for pan and **10 drawn / 10 dropped** for zoom, within the explicit baseline
  ceiling; debug p50/p95/max **16.7/16.8/16.8 ms**. No test failure or timing
  rerun was needed. Final K7 fuzz: 48 cases, seed 27447, 1 MiB maximum input;
  39 done, 4 refused, 1 conflict, 4 unchanged.

Chris still needs the real-app WebKitGTK measurement on a scratch vault before
and after CZ1. Use a development frontend, open a canvas, then Command palette →
Canvas: measure zoom. Escape cancels. Repeat on the target HiDPI/GPU setup;
the report records device scale and engine. No agent GUI window was opened.
The command is a callback-gap diagnostic, so it cannot establish whether WebKit
re-rasters each scale change. That question still needs native inspector/profiler
or compositor evidence before deciding whether speculative CZ6 is needed.
Chromium's layerize and software raster figures do not answer that question.

No new product decision is needed. All work stayed in this worktree and the CZ0
branch; no real vault, Herdr pane, other worktree, network, new package or crate
was used. Scratch boards were in the existing isolated mock harness; raw traces
were under /tmp. Git hooks were disabled; screenshots restored before each
commit. Prompts, logs and raw traces are not committed. Never pushed.
