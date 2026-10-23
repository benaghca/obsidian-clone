# Round 23 bugs

Hunter pass on `rebuild/r23-grok` at `7b612a5` (Codex's round 23, notes in `ROUND23_NOTES.md`). No application source was changed. Grove was checked in headless Chromium against the Vite dev server (127.0.0.1 only), private profile, device scale 1, in-memory mock vault. Pointer input is `Input.dispatchMouseEvent` (move, then press, then release). Keys are `Input.dispatchKeyEvent`.

Obsidian 1.14.4 was opened in this pass for the canvas cases below. It ran under `unshare -Urn` with the loopback interface up, `--headless --ozone-platform=headless`, an empty `DISPLAY`, and a scratch `HOME`, `XDG_*`, user-data dir, and vault under `/tmp/r23-obs-hunt`. Its log shows the system package `/usr/lib/obsidian/obsidian.asar` and an update check that failed with `ERR_INTERNET_DISCONNECTED`. No `~/Documents` vault was opened. Obsidian's code, CSS, and assets were not read.

`scripts/test-r23-bugs.mjs` encodes the bugs below and is wired into `npm test`. It fails on this commit. `npm run test:geometry` passed in this pass: stationary fold and unfold on `Geometry.md` and `GeometryFM.md` in Live Preview, Source, and Reading, and Ctrl+O, Ctrl+P, and the right-click menu were visible within two frames. The longest sampled frame was 17.1ms. The existing canvas suites were not re-run.

## Bugs

### 1. An edge with no sides always leaves the right edge and enters the left

Severity: high.

Repro:

1. Save a canvas whose only nodes are a text card at `x: 100, y: 520, width: 200, height: 100` and a text card directly below it at `x: 100, y: 780, width: 200, height: 100`.
2. Add one edge between them and omit `fromSide` and `toSide`. Open the file.

Expected: the curve attaches to the facing sides. Obsidian 1.14.4 draws `M200 620 L200 627 M200,627 C200,700 200,700 200,773`: it leaves the bottom center of the upper card and arrives on the top of the lower card. The same file with two cards side by side still leaves the right edge and enters the left (`M1580 80 …`).

Actual: the vertical edge is `M300,570 L307,570 M307,570 C437,570 -37,830 93,830 M93,830 L100,830`. It leaves the right side of the upper card, loops out to the left, and enters the left side of the lower card. A horizontal pair still takes the short right-to-left route.

Suspected: `src/canvas/model.ts` lines 46–48. `sideOf` falls back to `"right"` and `"left"` for any missing or unknown side. Failing test: `scripts/test-r23-bugs.mjs`.

### 2. A file card subpath shows the whole note

Severity: moderate.

Repro:

1. Create `Long.md` with frontmatter, `# Top`, several filler lines, `## Destination`, `Arrived at destination.`, `Block line two. ^bid`, and `## Later`.
2. Open a canvas with a file card `file: "Long.md"`, `subpath: "#Destination"`, about 280×180.

Expected: the card shows that heading's section. In Obsidian the card's text is the heading `Destination`, `Arrived at destination.`, the two block lines, and the file label `Long › Destination`. The filler above the heading, `## Later`, and the characters `^bid` are not in the card. The heading is inside the card's box.

Actual: the card's text starts `Long.md › Destination`, then `# Top`, `ABOVE the destination.`, every filler line, `Destination`, `Arrived at destination.`, `Block line two. ^bid`, `Later`, and `After the destination.`. On a 40-line preamble the same card's content measured `scrollHeight` 2395 and `clientHeight` 196, with `scrollTop` 2031 so `Destination` sat just inside the card. The task text says the subpath scrolls to the heading, and that heading is in view. The card still contains the rest of the note, and the block-id marker is visible text.

Suspected: `src/canvas/view.ts` lines 124–135. `paint` renders `embedPart(source, "")`, which is the whole note without frontmatter, and then scrolls to `embedSection`'s line. The shared reading renderer never removes a trailing ` ^id` (no match for a block-id stripper under `src/`). Failing test: `scripts/test-r23-bugs.mjs`.

### 3. Group labels are a solid pill even when the group has no label or no color

Severity: moderate.

Repro:

1. Open a canvas with three groups: one with `color: "2"` and no `label`, one with `color: "2"` and `label: ""`, and one with `label: "No color"` and no `color`.

Expected: Obsidian gives the two labelless groups a label element with `display: none` and a 0×0 box. The labeled group with no color uses dark text (`rgb(92, 92, 92)`) on a faint wash (`oklch(0.807791 0.0000401911 none / 0.1)`). Colored labels stay solid preset color with white text. Those still match.

Actual: both labelless groups paint a white-on-orange pill. On an opening fit the pill is about 8×4 screen pixels; at scale 1 it is 16×8, which is the 4px/8px padding around an empty string, background `rgb(236, 117, 0)`. The uncolored label is white (`rgb(255, 255, 255)`) on solid `rgb(189, 189, 189)`.

Suspected: `src/canvas/view.ts` line 73 always appends `node.label ?? ""`, and lines 25–26 and 69 set `--canvas-color` to `var(--background-modifier-border-focus)` when the color is missing. `src/styles/canvas.css` lines 36–47 paint that variable as a solid background with `color: white`. Failing test: `scripts/test-r23-bugs.mjs`.

### 4. A later group covers an earlier group's label

Severity: moderate.

Repro:

1. Put a group labeled `Inner` (`color: "4"`, `x: 200, y: 220, width: 280, height: 180`) first in `nodes`.
2. Put a larger group labeled `Outer` (`color: "1"`, `x: 140, y: 140, width: 420, height: 340`) after it, so the outer rectangle contains the inner label.
3. Move the pointer onto the Inner pill.

Expected: the Inner pill stays visible and is the element under the pointer. Obsidian's hit target at that point is `.canvas-group-label` with the text `Inner`. A text card that a later group overlaps stays above the group in both apps (the hit target remains the card).

Actual: `elementFromPoint` on the Inner pill returns the Outer group (`.canvas-node-group`). The inner label is under the later group's box.

Suspected: `src/styles/canvas.css` line 35 sets every group to `z-index: -1`, and `src/canvas/view.ts` appends groups in array order. The label is inside the group, so a later group paints over an earlier group's label. Failing test: `scripts/test-r23-bugs.mjs`.

### 5. A canvas file cannot be renamed, and its menu cannot open it in a new tab

Severity: moderate.

Repro:

1. Create `Probe.canvas` from the ribbon or by saving a canvas file.
2. Right-click its row in the file explorer with the pointer moved onto the row.
3. Press F2 while the canvas tab is active.

Expected: Obsidian's menu on that row is Open in new tab, Open to the right, Open in new window, Make a copy, Move file to..., Bookmark..., Copy path, Open version history, Open in default app, Show in system explorer, Rename..., Delete. Rename changes `Probe.canvas` to the new name and keeps the `.canvas` extension.

Actual: the menu is Move file to..., Bookmark, Copy path, Delete. `animation-name` on that menu is `none`. F2 does not start a rename. The breadcrumb title is a plain span. Middle-click on the row still opens the canvas in a new tab, because that path is not limited to `.md`.

Suspected: `src/shell/menus.ts` lines 121–132 treat only `path.endsWith(".md")` as a note, so the canvas row skips Open in new tab, Make a copy, and Rename. `src/appCommands.ts` line 86 (`hasNote` requires `active.path`) and lines 357–358 gate F2; a canvas tab keeps `path` null and stores the file on `viewFile` (`src/shell/pane.ts` lines 408 and 430). `src/fileOps.ts` lines 77–85 append `.md` for every file that is not a folder, so sending a canvas through `renameFile` would write `Name.md`. Failing test: `scripts/test-r23-bugs.mjs`.

### 6. Three-digit hex, eight-digit hex, and a CSS color name draw as the focus gray

Severity: moderate.

Repro:

1. Open four text cards colored `#abc`, `#11223380`, `red`, and `#FF0000`.

Expected: Obsidian gives each the custom-color class. The bordered container is a light blue for `#abc` (`oklch(0.78443 0.0306406 248.268 / 0.7)`), a dark blue for `#11223380` (`oklch(0.246188 0.0398396 249.743 / 0.7)`), and the same red for `red` and `#FF0000` (`oklch(0.627966 0.257704 29.2346 / 0.7)`).

Actual: `#FF0000` sets `--canvas-color` to `#FF0000`. The other three set `--canvas-color` to `var(--background-modifier-border-focus)`. The `#abc` card's border is that gray at 70% (`color(srgb 0.741 0.741 0.741 / 0.7)`), and the card still has `is-colored`.

Suspected: `src/canvas/view.ts` lines 25–26 accept only `"1"`–`"6"` and `/^#[0-9a-f]{6}$/i`. Line 68 adds `is-colored` for any non-empty `color` string, including the values the fallback then paints gray. Failing test: `scripts/test-r23-bugs.mjs`.

### 7. Grid dots sit in the middle of each cell

Severity: low.

Repro:

1. Open any canvas and read the board background at the opening fit.

Expected: Obsidian's dot pattern places the circle at `cx = 0.7`, `cy = 0.7`, `r = 0.7`, on the corner of a cell whose size is 20 board units times the scale (measured cell about 18.5px at the opening fit). The dots sit on that lattice, including after the pattern coarsens.

Actual: the background image is `radial-gradient(circle, rgb(224, 224, 224) 0.7px, rgba(0, 0, 0, 0) 0.7px)`. The circle's default position is the center of the cell. `background-position` is the world origin, so each dot is half a cell away from the lattice point. At the measured fit the cell was 19.5px, about a 10px shift. Coarsening doubles that shift.

Suspected: `src/styles/canvas.css` line 6. The radius matches the observed 0.7px. The gradient has no `at` position, and `src/canvas/navigation.ts` lines 26–29 only set the cell size and the origin. Failing test: `scripts/test-r23-bugs.mjs`.

## Checked, not filed

- Link cards stay offline. A card for `https://example.invalid/canvas-hunt` has no `href`, and the board has no iframe and no `http` image. Rendering it added no `example.invalid` resource. A trusted click calls `openExternal` with that URL; `javascript:alert(1)` does not. A remote image inside a text card is the existing non-fetching chip. Ctrl-hover on a `[[wikilink]]` in a text card opens the local popover.
- Wheel over a card pans the board in both apps. Obsidian's overflowing text card (`scrollHeight` 1173, `clientHeight` 138, `overflow-y: auto`) kept `scrollTop` at 0 while the card moved up by 111.6px, which is `120 × 0.93`. Grove's overflowing file card did the same: `scrollTop` stayed 2031 and the world `y` moved by 111.6px. Ctrl+wheel at the maximum scale 2 left the scale at 2 and left the world point under the pointer in place. Reset zoom set scale to 1 and kept the panned center.
- Space keyup clears `is-grabbable`. A following real click on a text-card wikilink opens that note. A click while Space is still held does not, which the navigation suite already checks.
- Viewport memory was not re-run. The navigation suite's cases match the `WeakMap`: another tab leaves the canvas tab's center and scale, a second tab of the same file starts at fit, and opening a note in the canvas's own tab drops that entry (`src/shell/pane.ts` line 486) so the next open fits.
- A group listed after a card does not cover the card. Both apps hit the card. Missing notes and missing images render `File not found` and do not throw. A leading BOM makes `JSON.parse` fail, the board is empty, and the bytes stay in the file. Obsidian was not given that BOM file.
- Explicit horizontal stubs are 7 board units and one arrowhead is drawn. The marker geometry is 10×10; the round notes measured Obsidian's arrow at about 13×10.4. The arrow is on the target end.
- Preset colors `"1"`–`"6"` and `#FF0000` color the card. Edges with a preset use that color; an edge with no color uses the focus-border gray.
- Explorer, quick switcher, and `[[` suggestions list `.canvas` files, and a reading-mode wikilink opens the canvas. Create new canvas still writes `{}` and numbers `Untitled 1.canvas`. The ribbon order matches the observed default, and its tooltip has no animation.
- Frontmatter notes in Live Preview, Source, and Reading kept every measured line within 1px, zero vertical margin on `.cm-content` children, and a visible fold arrow on the heading row after a stationary unfold. Menus and prompts opened within two frames.
- Search and backlinks of canvas text differ between the desktop index and the mock, and from Obsidian. That is the first improvement below, not a display bug in this round's list/read requirement.

## Next improvements

- Index canvas card text and wikilinks for search, backlinks, and the graph. Obsidian's backlinks for `ProbeTarget.md` listed `Probe.canvas` and `Linked.canvas`, and `resolvedLinks` for those files pointed at the note. `src-tauri/src/index.rs` `is_note_path` (line 491) skips every non-`.md` file, so the desktop index never sees a canvas. The browser mock scans every file's raw text, so the two builds disagree. Offline parsing of the JSON, with no fetches. Medium: on the order of 150–250 lines in the index plus tests.
- Add, drag, and resize cards, then write the file without dropping unknown fields. The board is read-only, so a canvas made in Grove cannot be arranged. This is the next canvas round and the thing that makes the view useful. Medium-large: about 250–400 lines, reusing the current parser and the pan gestures.
- Skip Markdown for cards far from the viewport. Every card is rendered up front, which is fine for the measured 300-card board and will not stay fine for a much larger one. About 100–150 lines: create the reading view when the card nears the viewport and release it when it leaves. No new dependency, and link cards still must not fetch.
