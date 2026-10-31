# CZ3 — Lazy canvas bodies and bounded settle work

Branch `rebuild/canvas-cz3-codex`, from integration `c0ad2bf`.
The completed/merged CZ0 branch was left intact. Local commits only, never pushed.

Implementation checkpoints `913ade5` and `9d7d612` follow independent scheduler/index/clip
commits `3548ec7`, `26e31aa`, `7fd2461`, and `648a404`.

Application/scripts/tests diff from `c0ad2bf`: 20 files, +825/−117 lines
(excluding this notes file).

## Design

- Shared read-only Markdown contexts per origin, acquired only for visible bodies.
- 1,000-unit spatial buckets, with an overflow set for huge groups and a sparse
  fit query that avoids scanning empty world coordinates. Geometry updates move
  nodes between buckets without rebuilding the index.
- Bodies and images load lazily. Off-screen card rectangles remain available for
  editing/selection; their content and titles are culled. A 300-body LRU releases
  detached Markdown widgets, context references, image handles and file watches.
- One work queue bounds body rendering, local band writes and edge construction.
  Wheel/pan gestures pause that queue; navigation still changes only its transform
  and grid/menu state per frame. Band and title decisions retain 45%/55% hysteresis.
- Per-element band attributes replace ancestor rules, so a single world change
  cannot invalidate all card descendants. Local title swaps and band writes are
  queued nearest the pointer first. Empty body containers detach in title mode.
- Title-mode edges batch curves by colour/arrow style and selection, with at most
  256 members per path. On boards with at least 1,000 edges, batches also occupy
  1,024-unit spatial cells. Candidate cells follow subdivided curve hulls; exact
  boundary intersections produce De Casteljau cubic pieces, preserving the curve.
  Arrow shapes belong to the endpoint's cell, avoiding duplicate arrowheads.
  Large path batches are split and separately weighted in the queue.
  Stable title mode has no per-edge hit paths, labels or reconnection ends.
  Full mode restores individual visible curves and creates ends only on selection.
- Edge drawing clips to an overscanned world-space viewport at settle, so paths
  spanning a huge board do not force full-board raster while zoomed in. This is
  culling, not CZ6 raster freeze: there is no animation or frozen bitmap layer.

## Before benchmark

CZ0's checked-in bench, Chromium 155, headless/software, 1280×1000, device scale 1,
under `/tmp/grove-npm-test.lock`, before any CZ3 product edit. Each gesture starts
fitted. CPU is completed trace-task duration per viewport transform update;
worker raster is parallel task time, not elapsed time. Input coalescing and raw
DrawFrame/DroppedFrame events retain CZ0's meaning. No rAF-based claim of smoothness.

| Cards | Gesture | Main ms/update | Raster ms/update | Dropped | Long tasks count/max | Open ms / longest |
|---:|---|---:|---:|---:|---|---|
| 100 | wheel | 2.8 | 7.3 | 2 | 0 | 93.3 / 77.0 |
| 100 | pinch | 1.8 | 5.1 | 0 | 0 | 93.3 / 77.0 |
| 100 | pan | 1.7 | 5.2 | 0 | 0 | 93.3 / 77.0 |
| 300 | wheel | 4.7 | 15.6 | 2 | 0 | 252.2 / 213.0 |
| 300 | pinch | 3.7 | 5.9 | 1 | 0 | 252.2 / 213.0 |
| 300 | pan | 3.1 | 5.6 | 0 | 0 | 252.2 / 213.0 |
| 1,000 | wheel | 19.4 | 82.1 | 16 | 2/67.6 | 1113.8 / 960.0 |
| 1,000 | pinch | 10.1 | 4.7 | 0 | 0 | 1113.8 / 960.0 |
| 1,000 | pan | 9.7 | 7.4 | 2 | 0 | 1113.8 / 960.0 |
| 3,000 | wheel | 183.0 | 499.9 | 88 | 9/707.9 | 6388.6 / 5659.0 |
| 3,000 | pinch | 38.6 | 8.4 | 72 | 0 | 6388.6 / 5659.0 |
| 3,000 | pan | 38.3 | 19.3 | 18 | 1/90.8 | 6388.6 / 5659.0 |

## Implementation and regressions

- `view.ts`: detached shell construction yields after 4 ms, attachment in 512-card
  frames; lazy text/note/link/image bodies and shared contexts. Note subscriptions
  defer refresh to a microtask, because removing/re-adding the callback during
  the shared watch Set's emission caused a renderer loop in an early probe.
  New blank-card editors install before the first yield, and Escape/board Undo
  remain available while the rest of the board is rebuilding.
- `bodies.ts`, `spatial.ts`, `work.ts`: overscanned indexed visibility, local band
  writes, nearest-pointer ordering, cull before rendering, one Markdown card per
  job, stale-work cancellation and bounded retained resources. Large coordinates
  outside safe bucket integers use the overflow path rather than non-advancing
  loops. Superseded settles compare against actually shown cards, so canceled
  cull jobs cannot strand old visible cards.
- `edges.ts`, `edgeClip.ts`: exact viewport/vector-cell clipping; visible full-mode
  hits/labels only; selected ends only; cached curves and clipped paths. Dragging
  updates affected title batches synchronously, with transient new cells merged
  at commit. Old fitted batches are removed before changing mode/viewport.
  A live edge-label editor survives rendering changes.
- `navigation.ts`, `canvas.css`: one immutable band sheet, local band targets and
  local title classes. Settle listeners pause/resume work around navigation.
  Fit/resize refresh visibility even without a band change. SVG viewport writes
  are skipped for an unchanged viewport; a 0.01-world-unit key tolerance ignores
  zoom out-and-back floating-point noise while the actual transform and all
  curve coordinates keep full precision. No stylesheet write
  or card/edge DOM mutation was added to gesture frames; the existing selection
  menu/grid exceptions remain. Hysteresis and double-click decisions are intact.
- `editing.ts`: only the edge-selection lifecycle callback and local sizing of
  connection dots. No marquee, add/create, context-menu, hover or Bases code changed.
- Five unit files cover index mutation/huge coordinates, weighted scheduling and
  cancellation, superseded culls, detachment, LRU disposal, exact cubic geometry,
  tile coverage, immediate title drag updates and lazy selection handles.
- `test-canvas-lazy.mjs` adds a 3,000-card/4,000-edge browser regression: zero
  initial Markdown contexts, visible shared contexts, no title hits/ends, bounded
  cache/watch counts, freshness, unchanged source bytes, same-band Fit after a
  distant pan, input/Undo during rebuilding and teardown with pending work. Its
  opening/transition limit remains 50 ms. Assertions run after the functional
  checks so a performance failure does not hide teardown/input failures.
- Existing edge/navigation tests account for detached content and batched title
  DOM. The compositor ceiling remains 6 drops per 24 inputs. The warmup drains
  settle work before the observer checks that gesture frames change no card DOM.
  The first full run stopped at the old hit-area test's expectation of edge
  selection at 25% and 1/16×. That contradicts approved Z9 (no title hit paths).
  Its ±11 px selection and 14 px miss assertions remain at 100%/200%, and 50%
  coverage was added. At 25%/1/16× it now uses native clicks to verify batched,
  non-selectable edges and no ends; the source-byte assertion remains.
- The bench now waits for pending work at open and trace end, and records
  `readyMs` separately from shell `ms`; slicing cannot escape its trace. It also
  drains pending work after Fit so gestures start with the full fitted drawing.

## After benchmark

Final implementation `9d7d612`, same command/harness, software Chromium 155,
viewport and DPR, shared lock. All pending rendering is drained before tracing
and at trace end. This is the final all-size run, not the best isolated run.
Zero in a long-task column means no task above 50 ms was observed; it does not
mean zero main-thread work.

| Cards | Gesture | Main ms/update | Raster ms/update | Dropped | Long tasks count/max | Shell open ms / max long task |
|---:|---|---:|---:|---:|---|---|
| 100 | wheel | 1.6 | 9.0 | 1 | 0 | 24.8 / 0.0 |
| 100 | pinch | 1.2 | 5.0 | 1 | 0 | 24.8 / 0.0 |
| 100 | pan | 1.2 | 5.4 | 0 | 0 | 24.8 / 0.0 |
| 300 | wheel | 3.0 | 36.7 | 3 | 0 | 24.2 / 0.0 |
| 300 | pinch | 1.8 | 8.2 | 1 | 0 | 24.2 / 0.0 |
| 300 | pan | 1.5 | 6.3 | 0 | 0 | 24.2 / 0.0 |
| 1,000 | wheel | 3.6 | 31.2 | 6 | 0 | 53.7 / 0.0 |
| 1,000 | pinch | 3.1 | 4.7 | 0 | 0 | 53.7 / 0.0 |
| 1,000 | pan | 2.5 | 6.7 | 1 | 0 | 53.7 / 0.0 |
| 3,000 | wheel | 20.9 | 62.9 | 6 | 2/78.0 | 184.3 / 0.0 |
| 3,000 | pinch | 12.2 | 8.7 | 4 | 0 | 184.3 / 0.0 |
| 3,000 | pan | 6.9 | 11.5 | 3 | 0 | 184.3 / 0.0 |

Opening distinguishes the first complete set of shells from the fully drained
render queue. Before rendering was synchronous, so these were the same event.

| Cards | Before synchronous open / max long task | After shells / queue ready / max long task | DOM before → after |
|---:|---|---|---|
| 300 | 252.2 / 213.0 | 24.2 / 85.7 / 0.0 | 7,851 → 1,079 |
| 1,000 | 1113.8 / 960.0 | 53.7 / 384.1 / 0.0 | 25,956 → 3,499 |
| 3,000 | 6388.6 / 5659.0 | 184.3 / 1317.8 / 0.0 | 77,691 → 10,413 |

The focused 3,000-card regression completed with no opening or transition task
above 50 ms. It opened all shells/edges in 1,512 ms focused / 1,529 ms in the full suite (its `open.ms` includes
queue drain), initialized zero Markdown contexts, then rendered 48 visible bodies
with two contexts at 100%. Six disjoint visits held the cache at 300 and visible
note watches below 70. All resource/freshness/source-byte/input/Undo/teardown
checks passed. Work slices usually stop at 4 ms, but a single context/render job
is not preemptible: the focused run observed a maximum of 16 ms. That exceeds
Z4's approximate 4 ms swap goal and the 12 ms settle goal.

## Checks

All required checks completed on the final code; no application changes followed.

- `npm run build`: passed; existing bundle-size warning only.
- `npm run audit:offline`: passed, 189 source files, built assets/CSP/capabilities
  and dependencies checked. No packages or crates were added.
- `flock /tmp/grove-npm-test.lock npm test`: exit 0, including the entire
  `posttest` chain and K7 fuzz (48 cases, seed 27447). Vitest: 77 files / 1,257
  tests. Browser suite: 2,255 PASS lines. The final 300-card compositor checks
  recorded 0 pan / 0 zoom drops, with the ceiling still 6 per 24 inputs. Both
  traces had no long task. The 3,000-card test recorded no opening/transition
  long tasks and passed its unmodified 50 ms limits.
- Focused hit-area, lazy rendering and all-size zoom bench: each exit 0 under
  the shared lock. Native ±11 px hits / 14 px misses pass at 50%, 100% and 200%;
  native clicks stay background in title mode at 25% and 1/16×.
- `cargo build --offline`: passed. `cargo test --offline`: 73 passed, 4 ignored,
  zero failures; native source is unchanged.

The initial full run stopped at the incompatible old title-hit expectation;
that coverage change is described above. The final full run passed without a
flake rerun. Earlier failed performance experiments are retained below rather
than treated as passing checks. Generated `rebuild/round*-shots/` files are
restored before the final commit.

## Measurements and remaining limits

The initial opening trace showed 58–61 ms tasks despite zero Markdown contexts;
detaching empty bodies removed those tasks. Exact viewport clipping and weighted
full-mode construction then removed repeated 60–450 ms settle stalls. Smaller
64-edge batches made things worse (66 ms focused transition, 218 ms shell open,
long tasks in the 3,000-card bench), and were reverted. Promoting the whole SVG
with `will-change` also regressed Layerize heavily and was removed.

Spatial vector batches cut the pathological raster. Before the final Fit fix,
an isolated 3,000-card run had no >50 ms tasks, but the all-size run recorded
61.5/91.1 ms waits at 1,000 cards and 151.2 ms at 3,000. Their traces spent almost
all of those long tasks in `LayerTreeHost::WaitForCommitCompletion`. Those runs
motivated removing identical SVG viewBox writes and float-noise rebuilds; they
are not the final table above.

On the final all-size run, 3,000-card wheel main CPU/update fell 183.0 → 20.9 ms,
pinch 38.6 → 12.2 ms and pan 38.3 → 6.9 ms. Drops fell 88 → 6, 72 → 4 and 18 → 3,
respectively. Every final main-CPU row improves over baseline. Worker-raster CPU
is not uniformly better on small boards, and it is parallel time, not elapsed
frame time. Gesture totals include all queued settle work; they are not a claim
of 60 fps from rAF intervals.

**Targets partially met:** no long opening or focused title/content-transition
task, and no final benchmark long task at 100/300/1,000 cards. However, the final
3,000-card wheel trace still has 54.9 and 78.0 ms tasks (baseline max 707.9 ms).
The universal 50 ms requirement and zero drops on every board are therefore not
met. Shells appear in 184 ms at 3,000, but the complete vector queue takes 1,318 ms
(baseline synchronous opening 6,389 ms); complete-board readiness under 200 ms is
also not met. A single context/render job still reached 16 ms, above the soft
4 ms swap / 12 ms settle goals. These limits remain open for review; neither
performance assertions nor compositor ceilings were loosened to conceal them.

Real WebKitGTK/HiDPI presentation still needs the existing CZ0 in-app measurement.
No conclusion about a need for CZ6 is made from software Chromium alone. CZ6
raster freeze/paused animations were not implemented.

No hover-preview, marquee/add-item, context-menu, Kanban/Bases or native changes.
No Obsidian code/assets were used: behaviour follows the approved canvas plan and
CZ0/CZ1/CZ2/review notes. No external lookup, package/crate or GUI window was used.
Only this worktree/branch and isolated scratch fixtures were used. Screenshots
are restored before every commit; prompts, logs and raw traces are not committed.
