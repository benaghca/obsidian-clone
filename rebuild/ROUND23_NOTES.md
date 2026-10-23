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
