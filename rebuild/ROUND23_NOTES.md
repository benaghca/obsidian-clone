# Round 23 — Part A: read-only Canvas

Worktree `/home/chris/workspaces/remote/grove-r23-codex`, branch
`rebuild/r23-codex`, baseline `95f23e5`. Local commits only; nothing pushed
or merged. Part B is pending its separate request.

## Commits

- `6e32d23` — Open `.canvas` files as attachment tabs, preserving their
  original bytes. Add a small DOM/SVG board, reuse Reading rendering and
  local image blobs, and include canvases in the explorer, quick switcher,
  wikilink suggestions, saved tabs and navigation. Add parser, filesystem
  read/list and native mouse regressions.
- `48b523b` — Chris's ribbon report, in its own commit. Match the fresh
  Obsidian order and Lucide icons; add Create new canvas, its palette
  command and the explorer's New canvas item after New folder. Reuse the
  existing file creation, folder setting and numbering helpers. Serialize
  creation so repeated stationary clicks cannot choose the same free name.
  Keep Ctrl+N and Random note commands. Omit the Base slot until Bases exists.
- `14956da` — Resolve attachment wikilinks without creating `.canvas.md`
  notes; reuse the existing workspace host instead of creating subscriptions
  per card. Add navigation, subscription cleanup and attachment-link checks.
  Match the measured Canvas heading size and avoid image-card scrollbars.
- `5583184` — Match the settled Obsidian empty file exactly (`{}`). The
  initial zero-byte read preceded its autosave. Rerun build/offline audit,
  all 34 Canvas browser checks and the Playwright pointer checks.
- Final notes/evidence commit: this document and the final screenshots and
  observation/test evidence (its hash is the commit containing this file).

## Obsidian observation

Observed installed Obsidian 1.14.4 through headless Electron/Ozone at
1280×800. It used private HOME, XDG folders, user-data profile and a scratch
vault under this worktree's ignored `rebuild/app/node_modules/.r23-reference`.
The driver and Obsidian ran in `unshare -Urn`, with only loopback enabled.
Only public workspace/command APIs, rendered DOM, computed element metrics
and native Playwright mouse/keyboard input were used. No application code,
stylesheets or assets were read or copied. No real vault, Tauri window or
visible desktop window was opened.

The scratch board has text cards, a frontmatter note with `#Section`, a local
SVG, a URL, a labelled group, presets 1–6 plus a hex color, and 16 edges
covering every source/destination side pair, both ends and a label. It was
opened and edited with real mouse/keyboard input in Obsidian, then its saved
JSON was used by Grove: [Reference.canvas](round23-shots/Reference.canvas),
[Note.md](round23-shots/Note.md), [diagram.svg](round23-shots/diagram.svg).

Measured/observed:

- Cards: 8px corner radius, 1px border, subtle `0 .5px 1px .5px` shadow at
  10% black; colored cards have a 70% color border/inset outline and a
  lightly tinted body. Body is 16px/24px with 16px horizontal padding;
  first-level heading is 25.888px/31.0656px, weight 700.
- Groups: tinted area behind the cards; label above the top-left corner,
  solid card color, white text, 4px radius, 4px/8px padding and
  22.5px/22.5px type. File labels sit just above their cards.
- Grid: 20 board-unit dot spacing. At opening scale 0.787878, the rendered
  pattern spacing is 15.757576px and the circle radius is 0.7px. At 2×
  spacing is 40px; at 1/16× Obsidian coarsens it to 10px. The rendered circle
  radius remains 0.7px at all three measured scales. The captures below
  show those zoom extremes; the navigation/grid scaling work is for Part B.
- Edges: a 7-unit stub into a cubic Bézier and a 7-unit stub at the other
  card. One measured top/top edge is
  `M120 0 L120 -7 M120,-7 C120,-137 380,-137 380,-7 M380 -7 L380 0`.
  Arrowheads are filled triangles; the observed polygon spans 13×10.4
  board units. Labels have a small white background above the curve.
- Right controls, top to bottom: Canvas settings; Zoom in (`plus`), Reset
  zoom (`rotate-cw`), Zoom to fit (`maximize`, Shift+1), Zoom out (`minus`);
  Undo, Redo; Canvas help. These controls and interactive navigation belong
  to Part B and are not added here.
- Measured scale endpoints: 1/16× and 2×. Ctrl+wheel zooms around the mouse;
  wheel pans (100 wheel units moved the board 93px in this run).
  Space+drag and middle drag each moved the board by the pointer's 40×40px
  displacement. Shift+1 restored the initial fit. The group measured
  850.909px wide at fit, 2160px at maximum and 67.5px at minimum, for its
  1080-unit width. Grove has only static opening framing in Part A.
- Fresh ribbon: Open quick switcher (`file-search`), Open graph view
  (`git-fork`), Create new canvas (`layout-dashboard`), Open today's daily
  note (`calendar`), Insert template (`files`), Open command palette
  (`terminal`), Create new base (`layout-list`). There is no Random note or
  New note button in this fresh default. Canvas hover says "Create new
  canvas"; explorer empty-space menu is New note, New folder, New canvas,
  New base. Grove leaves out Base as requested.
- An early read of a just-created Obsidian canvas returned zero bytes; a cleared board
  was also observed saved as `{}`. A follow-up read after autosave settled
  confirmed a new canvas writes exactly `{}` (no newline). Grove matches
  those bytes, as Part A requires observing the exact empty format. The
  brief's explicit-array example `{"nodes":[],"edges":[]}` also opens.

Comparison captures use the same saved board at 1280×800. The sidebars and
chrome differ; these are visual references, not a pixel-identity claim:

- Board: [Obsidian](round23-shots/obsidian-canvas.png),
  [Grove](round23-shots/grove-canvas.png).
- Ribbon tooltip: [Obsidian](round23-shots/obsidian-ribbon.png),
  [Grove Live Preview](round23-shots/grove-ribbon-live.png),
  [Source](round23-shots/grove-ribbon-source.png),
  [Reading](round23-shots/grove-ribbon-reading.png).
- Reference zoom extremes: [2×](round23-shots/obsidian-zoom-max.png),
  [1/16×](round23-shots/obsidian-zoom-min.png).

## Read-only and offline behavior

Canvas data never enters a saving Markdown editor and is never serialized.
Unknown fields, their ordering and unknown node records remain in the
original file; only the on-screen projection skips unknown node types.
Invalid JSON, empty files, missing fields and invalid edges render the
usable portion or an empty board without throwing.

Text and note cards use the existing Reading renderer with read-only
contexts and disabled task changes. Note subpaths scroll to the requested
heading. Images/SVGs use the existing local-byte/blob path and release their
URLs; watched file changes refresh cards. Link cards show only URL text.
They contain no fetching target, iframe, remote image or preview; only an
explicit trusted click or Enter invokes the existing guarded system opener.

No runtime dependency, backend command, capability or CSP change was needed.
The backend already lists and reads arbitrary supported vault files; a new
Rust test verifies a Canvas read leaves its file byte-identical. Temporary
Playwright tooling was installed only under ignored `node_modules/.r23-tools`;
no package manifest or lockfile dependency was added.

## Verification

- `npm run build`: passed, including the final empty-file format.
- `npm test`: passed: 4 browser-discovery tests, 237 TypeScript tests in
  42 files, 700 named browser checks (34 new Canvas checks), and the existing
  paste cases. After the final empty-file constant changed from explicit
  arrays to the observed `{}`, the affected 34 Canvas checks and the
  Playwright run were repeated and passed.
- Permanent geometry suite: passed on plain and frontmatter notes in Live
  Preview, Source and Reading; every line within 1px of CodeMirror's top,
  no direct-child vertical margins, and fold arrows visible after stationary
  unfold clicks.
- All 18 Ctrl+O, Ctrl+P and context-menu timing checks passed: visible within
  two frames, no opening animation, longest sampled frame **17.1ms**.
- `npm run audit:offline`: passed on the final format, checking the build,
  133 source files, output, CSP, capabilities and dependencies.
- `cargo build` and `cargo test`: passed; **34** Rust tests.
- `git diff --check`: passed.

[Raw reference measurements](round23-shots/obsidian-observations.txt).

Permanent `scripts/test-canvas.mjs` runs in `npm test`. It checks card and
edge display, native wikilink navigation and Back, attachment suggestions,
canvas-to-note subscription cleanup, damaged JSON, numbered ribbon creation,
palette and folder-context creation, all three frontmatter modes, stationary
clicks and exact original file text including unknown fields.

The supplemental headless Playwright run uses `page.mouse.move`, `down` and
`up`; the second click sends down/up again without moving. It covers the
Canvas ribbon tooltip and repeated creation in Live Preview, Source and
Reading with frontmatter; it also verifies a file-card heading leads its
scroller, all four card types, wikilink navigation and byte preservation.
Request monitoring observed **zero remote requests**, before and after two
URL clicks; a mock of the system-opener adapter recorded exactly two calls.
No DOM `.click()` was used. [Playwright results](round23-shots/playwright-results.txt).

No editor transaction listener or ordinary per-keystroke processing was
added. Big-note and table editing continue to use the existing editor paths.
Each new Canvas source file is under 200 lines; the existing pane is 674.

## Net tracked app line changes

Newline counts under `rebuild/app`, tracked files only, excluding `/gen/`,
relative to `95f23e5`, as requested:

- Production TypeScript: 19,630 → **19,872 (+242)**.
- Test TypeScript: 3,090 → **3,117 (+27)**.
- TypeScript total: 22,720 → **22,989 (+269)**.
- CSS: 3,746 → **3,807 (+61)**.
- Rust (including tests): 3,134 → **3,145 (+11)**.
- mjs test/scripts: 2,120 → **2,198 (+78)**.
- JSON: 2,229 → **2,229 (0)**.
- TS/CSS/Rust total: 29,600 → **29,941 (+341)**.
- Including mjs: 31,720 → **32,139 (+419)**.

Documentation, fixture JSON/Markdown/SVG and PNG evidence are outside these
app-source counts. Part A only; stop here until Part B is requested.

# Part B — pan and zoom

The separate Part B request authorizes continuing from Part A (`126770a`).
Same worktree and branch; commits remain local, with nothing pushed or merged.

## Changes and commits

- `cc84bfa` — Add Canvas navigation in 109 lines of TypeScript. Reuse
  `dragPointer`, `iconButton`, the existing tooltip helper and the current
  DOM/SVG world. Replace Part A's static framing rather than keeping a
  second camera. Add native-input regression/performance checks and the
  generated [300-card, 400-edge fixture](round23-shots/Large.canvas).
- The final Part B evidence commit contains this appendix, captures and
  test/reference results; its hash is the commit containing this appendix.

Wheel/trackpad pans on both axes; Space+left-drag and middle-drag follow the
pointer. Ctrl+wheel anchors the world coordinate under the mouse. The right
zoom group is Zoom in, Reset zoom, Zoom to fit (Shift+1), Zoom out, using the
observed Lucide plus, rotate-cw, maximize and minus icons. Buttons retain the
shared delayed tooltip with no animation, and repeated stationary clicks
work. Clicking a control returns focus to the board so Space-drag works
immediately afterward. A Space-held press on a wikilink cannot follow it.

Viewport center and scale are remembered in a WeakMap keyed by the live tab.
Separate tabs showing the same canvas have independent views. Switching
away and back preserves the live canvas viewport; replacing its file in the
same tab, closing/reopening it or restarting starts at fit. This state is
not serialized into the workspace or canvas file. Resize preserves the
world center and scale; file refresh preserves the current view.

## Further Obsidian observations

Observed Obsidian 1.14.4 again before implementing navigation, headless with
the same scratch HOME/XDG/profile/vault and a network namespace containing
only loopback. Only rendered DOM metrics, public workspace commands/APIs
and native Playwright/CDP input were used. No app code, CSS or assets were
inspected. [Reference results](round23-shots/obsidian-partb-observations.txt).

- Opening/fit centers the node bounds, without adding the origin or group
  label to those bounds. The measured fit equals the smaller of viewport
  width/(bounds width × 1.1), viewport height/(bounds height × 1.1) and 1.
  A 200×100 card located at (1000,1000) opens at 1×, centered on that card.
- Zoom in/out multiply/divide by √2. Two clicks without moving doubled
  scale. Reset changes scale to 1× around the viewport center, retaining
  that center. Limits remain 1/16× and 2×.
- Ctrl+wheel −100 multiplies scale by 2^(1/3), around the pointer. Wheel
  (60,100) moves the board (−55.8,−93) screen pixels. Space and middle-drag
  follow the pointer, as measured in Part A.
- The live canvas retained its pan after switching to a different tab and
  returning. Replacing it with a note in the same tab, then reopening the
  canvas, restored fit. Closing/reopening also restored fit. Two live tabs
  keep independent viewports (the second opens at fit while the first
  remains panned).
- Dots retain .7px screen radius, with 20 board-unit spacing and coarser
  spacing below 10 screen pixels. At 2× the spacing is 40px; at 1/16× it is
  10px. Grove now uses that spacing/radius behavior too.

Grove implements the four working zoom controls. Obsidian's separate Canvas
settings, Undo/Redo and Help groups are omitted while their related editing
features are pending. No inactive placeholders were added.

Captures: [Grove fit](round23-shots/grove-partb-fit.png),
[Obsidian fit](round23-shots/obsidian-partb-fit.png),
[Grove large board at 1×](round23-shots/grove-partb-large.png),
[Obsidian zoom controls](round23-shots/obsidian-partb-controls.png).
The fit comparison uses the same saved Reference canvas and its local note
and SVG; sidebar widths differ, so these are not pixel-identity claims.

## Verification and performance

All required checks passed on the completed change:

- `npm run build` and `npm run audit:offline`: passed; the audit checked
  134 source files, built output, CSP, capabilities and dependencies.
- `npm test`: passed, including 4 browser-discovery tests, 237 TypeScript
  tests in 42 files, 733 named browser checks, and the existing paste cases.
- The permanent geometry suite passed on plain/frontmatter notes in Live
  Preview, Source and Reading: line tops within 1px, zero direct-child
  vertical margins, stationary fold/unfold arrows remaining visible.
- All 18 instant switcher/palette/context-menu checks passed within two
  frames, with no opening animation and no frame above 20ms. Maximum
  sampled opening interval: **17.2ms**.
- `cargo build` and `cargo test`: passed; all 34 Rust tests. Tauri was not
  launched. No real-screen window or owner's vault was used.
- `git diff --check`: passed.

New `scripts/test-canvas-navigation.mjs` contributes **33** named checks.
It runs Vite and headless Chromium with private profiles; input is native
CDP mouse move/press/release/wheel and key events. Each zoom control is
hovered, pressed, then pressed again without pointer movement. Tests cover
pointer anchoring, limits, initial/offset fit behavior, Space/middle
panning, Shift+1, tab isolation and reopen, resize, refresh, original bytes
and the large fixture. Existing Part A/native-frontmatter tests also pass.
[Navigation results](round23-shots/canvas-navigation-results.txt).

For the 300-card/400-edge board at 1280×800, after warming the compositor,
24 native pan events and 24 native Ctrl+wheel events were recorded with
requestAnimationFrame timestamps. In the full-suite run:

- Pan: **70** sampled intervals, p95 **16.7ms**, maximum **16.8ms**.
- Zoom: **70** sampled intervals, p95 **16.8ms**, maximum **16.8ms**.

The check requires every measured interval to be below 20ms; its threshold
was not relaxed. A MutationObserver also verifies no card DOM or geometry
changes during navigation. One promoted world container is transformed;
the background grid position/spacing follows it. All 300 Markdown cards are
rendered; lazy rendering was unnecessary for this target. These measurements
cover this fixture/machine and do not establish performance for larger boards.

No dependency, backend command, capability, CSP change or ordinary editor
keystroke work was added. Canvas keys are handled only on the Canvas element.
Link cards still use the existing explicit system-opener path; navigation
adds no fetching or persistence of canvas JSON.

## Final tracked app line counts

Tracked newline counts under `rebuild/app`, excluding `/gen/`. Part B deltas
compare `126770a` with the completed implementation:

- Production TypeScript: **19,975**; Part B **+103**, whole round **+345**.
- Test TypeScript: **3,117**; Part B **0**, whole round **+27**.
- TypeScript total: **23,092**; Part B **+103**, whole round **+372**.
- CSS: **3,817**; Part B **+10**, whole round **+71**.
- Rust, including tests: **3,145**; Part B **0**, whole round **+11**.
- mjs scripts/tests: **2,292**; Part B **+94**, whole round **+172**.
- JSON: **2,229**, unchanged in both parts.
- TS/CSS/Rust total: **30,054**; Part B **+113**, whole round **+454**.
- Including mjs: **32,346**; Part B **+207**, whole round **+626**.

Whole-round deltas use `95f23e5`, as in Part A. Screenshots, notes and Canvas
fixtures are outside these app-source counts. The navigation file is 109
lines, the renderer 145 and the existing pane 678; all stay below 800.

## Next improvements

1. Card dragging/resizing with undo and field-preserving writes. This makes
   the board useful for arranging notes while retaining JSON Canvas
   compatibility. Roughly 250–400 TypeScript/test lines in a separate round.
2. Lazy Markdown for much larger boards. Only instantiate card renderers
   near the viewport to reduce opening time and memory beyond the tested
   300 cards. Roughly 100–150 TypeScript/test lines; no need to add it for
   the current measured navigation target.

Part B complete. Commit locally and stop.
