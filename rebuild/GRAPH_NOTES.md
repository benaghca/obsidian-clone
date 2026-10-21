# Round 7: graph view

Grove now has Obsidian's graph view: a global graph in a tab, a local graph in a tab or in the right sidebar, and Obsidian's floating settings panel (Filters, Groups, Display, Forces). It is drawn on one Canvas 2D element by a force simulation written for Grove, with no new dependency. The six round 6 settings findings are fixed. Everything in `GRAPH_TASK.md` is done, or left out with a reason at the end.

- **Checks:** `npm run build`, `npm test` (98 tests, up from 89), `npm run audit:offline`, `cargo build` and `cargo test` (26 tests, up from 24) all pass.
- **Speed:** typing and note switching are as fast as before, with the graph open in another pane. With a 1,011-node, 3,100-link vault, panning, zooming, dragging and hovering hold 60 fps in Chromium. Inside the real Tauri window (WebKitGTK) the first measurements were very slow, and fixing that took most of the performance work. Numbers are at the end.
- **Network:** nothing new reaches outside the machine. No dependency was added, and the audit passes.

Commits on `rebuild/r7-claude`, oldest first:

| Commit | What |
|---|---|
| `ca03d6e` | Link index: markdown links and unresolved targets (backend, `CONTRACT.md`, mock, Rust tests) |
| `4f809e6` | Graph view: global and local graph, Obsidian's settings panel |
| `f3cd8ee` | Tests, hover without redraws, excluded files, the local graph fits its note |
| `0fb756d` | Settings: the round 6 findings |
| `6d2e794` | Fast in the Tauri window (WebKitGTK) |
| `8ac95c0` | Draw once more after the canvas is resized (WebKitGTK) |
| (last) | These notes |

## How Obsidian was observed

As in rounds 5 and 6, Obsidian 1.14.4 (the installed package) was set up like this:

- It ran in its own network namespace (`unshare --net`, loopback only), headless.
- `HOME` and the `XDG_*` folders pointed into the session scratchpad.
- It opened throwaway vaults there: an 18-note vault with links, tags, two missing notes and two orphans, and a generated 1,000-note vault with 3,000 links.
- A CDP script read what was on screen: screenshots, computed styles, panel DOM, and the graph renderer's runtime numbers (node positions and sizes, zoom, label opacity, colours). It also drove the mouse and wheel.

No Obsidian source code, CSS file or asset was opened or copied. The owner's `~/.config/obsidian` and vaults were never touched.

## A. The global graph

### Opening it

- **Ribbon:** a button with Lucide `git-fork`, second after the quick switcher, as in Obsidian's ribbon.
- **Command:** "Graph view: Open graph view", Ctrl/Cmd+G (Obsidian's default), also in the palette.
- It opens in the active tab if that tab is empty, otherwise in a new tab. It is a normal tab:
  - it can be split, dragged between panes, pinned, closed and reopened with Undo close tab;
  - it is saved and restored with the layout.
- The tab has the `git-fork` icon, as in Obsidian. The view header reads "Graph view".
- The tab menu has Close, Close others, Close tabs after, Close all, Pin, then Split right / Split down. More options has the split items. The tab list shows it with its icon.

### Clicking a node

- **Click (observed):** the graph's own tab becomes the note. Back returns to the graph and Forward goes to the note again. Tab history now holds graph entries alongside note paths.
- **Ctrl/Cmd+click, middle click:** opens the note in a new tab. Ctrl/Cmd+Alt+click opens it to the right.
- **A missing note:** it is created, as following a link to it does.
- **A tag node:** searches the vault for the tag.
- **Right-click** shows Obsidian's node menu (observed): the note's name as a muted title, then:
  - Open in new tab, Open to the right;
  - Move file to..., Bookmark, Merge entire file with...;
  - Copy path ▸;
  - Open local graph, Reveal file in navigation;
  - Delete file.

  "Open to the right" is the brief's addition; Obsidian's menu doesn't have it. Obsidian's Open in new window, Open in default app and Show in system explorer are left out, as in every other Grove menu (the lockdown).

### Nodes and links

- **Nodes** are notes. With the panel's options they also include:
  - tags (`#tag`, linked to every note carrying them);
  - attachments: Grove does list non-note files, and `![[pic.png]]` or `[x](pic.png)` link to them;
  - notes that don't exist yet (unresolved link targets, merged by name in any case).
- **Links** are resolved wikilinks, embeds and markdown links. They are drawn undirected, one line per pair, but they remember their direction for arrows.
- **Orphans** are nodes with no link in the graph as drawn.
- **Excluded files** (Settings → Files and links) are left out. A change to the filters updates the graph at once.

The backend's link index only knew wikilinks, so it now also returns:

- `markdown`: per note, the resolved targets of its `[text](path)` links;
- `unresolved`: per note, link targets that match no file.

`outgoing` and `backlinks` are unchanged, so the Backlinks and Outgoing views behave as before. The change is documented in `CONTRACT.md` and has two Rust tests. Markdown targets are percent-decoded, `<angle-bracketed>` targets work, titles and `#fragments` are dropped, and URLs and same-note anchors are not links. The mock backend does the same.

### How it compares with Obsidian

| | Obsidian 1.14.4 (observed) | Grove |
|---|---|---|
| Node size | 8px radius up to about 6 links, then 3·√(links+1). Links = in + out. | The same formula and count. "Node size" multiplies it. |
| Node size with zoom | Nodes grow and shrink with the square root of the zoom (8px at 100%, 16px at 400%). | The same. |
| Colours, light | Nodes #5c5c5c, lines #dadada, labels #222, missing notes #ababab at 50%, tags #08b94e, attachments #e0ac00 | The same values as theme tokens (`--graph-*` in `theme.css`). |
| Colours, dark | Nodes #b3b3b3, lines #3f3f3f, labels #dadada, missing #666 at 50%, tags #44cf6e, attachments #e0de71 | The same. |
| Hover | The node and its links take a lighter accent; its neighbours stay; everything else fades to 20%. The label moves down a little. | The same, in Grove's teal, over 150ms (instant with reduced motion). The hovered label always shows, moved down a little. |
| Current note | Obsidian draws the open file in the accent. | Accent fill and a thin accent ring (teal; lifted in dark). In the local graph, its middle note. |
| Labels | 16px interface font, centred under the node. Opacity = clamp(log₂(zoom) + 1 − threshold): all from 100%, none at 50%. | The same formula (checked against Obsidian's numbers at 72% zoom with thresholds −1, 0, 1: 1, 0.52, 0). |
| Zoom | One wheel notch (100px) zooms to 71% around the pointer, easing in. Range 1/128 to 8. Saved as `scale`. | The same. A pinch (Ctrl+wheel) zooms in small steps. |
| Settling | It starts hot and moves fast for a second, then creeps. It stops after about 5 seconds, both for 18 notes and for 1,000. | Velocity Verlet with alpha decaying over 300 ticks: the same curve, stopping at ~5 s. |
| Spread at defaults | Furthest node about 430px from the middle for the 18 notes, 3,170px for the 1,000. | 382px and 2,923px (the force constants were tuned to these). |
| Drag | The node follows the pointer; neighbours follow; the graph warms up and settles again after release. | The same: the node is held, alpha is kept up while dragging, and it cools after. |

### The settings panel (`src/graph/panel.ts`)

Observed in Obsidian:

- **Panel:** 240px wide, 12px from the top-right corner, 8px radius, the menu's background, border and three-layer shadow, scrolling when taller than the graph.
- **Sections:** 40px headers with a chevron, in this order:
  - **Filters:** "Search files..." with a search icon; toggles for Tags, Attachments, Existing files only and Orphans.
  - **Groups:** one row per group (a query field "Enter query...", a round colour swatch, a delete ×), then "New group".
  - **Display:** Arrows; sliders for Text fade threshold, Node size and Link thickness (the name on one line, the value then the slider under it); an "Animate" button on the right.
  - **Forces:** Center force, Repel force, Link force, Link distance.
- **Header:** the first header row holds Restore default settings (`rotate-ccw`) and Close (`x`).
- **Closed:** only a gear (Open graph settings) and a wand (Start timelapse animation) are left.

Grove builds the same, with the same Lucide icons (`wand-sparkles` is the current name of Obsidian's `wand-2`). The slider ranges and defaults are Obsidian's:

| Slider | Range | Default |
|---|---|---|
| Text fade threshold | −3…3, step 0.1 | 0 |
| Node size | 0.1…5 | 1 |
| Link thickness | 0.1…5 | 1 |
| Center force | 0…1 | 0.5187 |
| Repel force | 0…20 | 10 |
| Link force | 0…1 | 1 |
| Link distance | 30…500 | 250 |

How the controls behave:

- **Everything applies live.** A force change warms the layout up a little.
- **The search** uses Grove's search syntax:
  - words are searched for in the notes (all words on one line, as in the search view);
  - `path:`, `file:` and `tag:` narrow by place, name or tag.

  Group queries use the same syntax. A note takes the colour of the first group it matches.
- **Animate** plays Obsidian's timelapse: notes appear one after another with the layout running. Grove has no creation time, so they appear in order of their last change.
- **Saving:** settings go to `.grove/graph.json` through the settings store, with Obsidian's keys (`showTags`, `hideUnresolved`, `colorGroups` as `{query, color: {a, rgb}}`, `centerStrength`, `scale`, `close`, `collapse-filter` and so on).
  - As with every Grove settings file, only what differs from the defaults is written.
  - The local graph's settings sit under `"local"`.
  - The open sections, the open or closed panel and the zoom are saved too.
- **The panel's shadow** is Obsidian's three layers, drawn once into an image and shown as a nine-slice border image. A CSS shadow with a 30px blur is repainted by WebKitGTK with every frame of anything else on the page (see Performance).

## B. The local graph

- **"Graph view: Open local graph"** opens the active note's graph in a new pane to the right, titled "Graph of *note*" with the view header "Local graph". This is what Obsidian does (observed). A local graph tab follows the note open in the active pane.
- **The right sidebar** has a Local graph view (the `git-fork` tab after Outline). It shows the neighbourhood of the note in the active pane, and keeps it while a graph or an empty tab is active. "Graph view: Show local graph in sidebar" opens it; Obsidian has no such command, but the sidebar needs a way in.
- **Panel:** the same panel. Filters has Obsidian's local graph rows: Depth (1–5), Incoming links, Outgoing links, Neighbor links, then Tags, Attachments and Existing files only. There is no Orphans row, as in Obsidian.
  - **Depth** follows links out of the notes reached (outgoing) and into them (incoming), as allowed.
  - **Neighbor links** adds links between notes that were reached by other paths.
- **Clicking a node** in a local graph tab opens the note in the pane it follows. In the sidebar, it opens the note in the active pane.
- **The current note** has the accent fill and ring.
- **Two deliberate differences from Obsidian:**
  - Obsidian's local graph opens at 100% zoom, and in the narrow sidebar most of the neighbourhood is cut off (observed). Grove keeps the note in the middle and zooms out just enough for the whole neighbourhood to fit, until you pan or zoom by hand. While it is fitted, labels stay visible (at least 12px) rather than fading with the zoom.
  - The sidebar's panel starts closed (the gear and the wand), because the sidebar is narrow.

## C. Core plugin

"Graph view" is a core plugin (Obsidian's id `graph`). Turning it off removes:

- the ribbon button;
- the three commands and their hotkeys;
- the sidebar's Local graph tab;
- Open local graph in menus;
- every open graph tab (they close, as Obsidian closes the plugin's views).

## How the simulation and renderer work

### Simulation (`src/graph/sim.ts`)

This is a d3-force-style velocity Verlet simulation written for Grove, using flat typed arrays and no objects per node.

**Forces:**
- **Link:** a spring towards the link distance, stronger on the end with fewer links (d3's bias and strength).
- **Repel:** every pair pushes apart, weaker with distance. It is approximated with a Barnes–Hut quadtree (θ = 0.9) rebuilt each tick in flat arrays, so a tick costs n log n. That is about 1ms for 1,000 nodes.
- **Centre:** a pull towards the middle in proportion to the distance, so orphans and separate clusters stay near.

The sliders scale these through two constants tuned against Obsidian's measured spread.

**Cooling:**
- `alpha` scales every force and decays from 1 to 0.001 over 300 ticks. Velocity keeps 60% from tick to tick.
- Below 0.001 the layout is settled, and the view requests no more frames.
- Dragging holds alpha at 0.3; a change to the graph reheats it to 0.3.

**Stable start:**
- New nodes go on a golden-angle spiral, in the same order every time.
- A new node with a placed neighbour starts next to it.
- The global graph's settled positions are kept for the session, so reopening it starts from its last layout and only warms up a little.

### Renderer (`src/graph/view.ts`)

- **One canvas.** Each frame clears, strokes the links (one path, or dimmed ones and highlighted ones), fills the nodes (one path per colour and brightness), then draws the labels in view with one `fillText` each.
- **Culling:** off-screen nodes, labels and links are skipped.
- **Hit-testing** is one pass over the nodes in world space (a few microseconds for 1,000), done on pointer move. A frame is requested only when the hovered node changes.
- **The frame loop** runs only while something moves: the simulation cooling, the zoom easing, the hover fading, a drag or a pan. Otherwise no `requestAnimationFrame` is pending at all. This was checked: 0 frames in the second after settling.
- **Hidden graphs do no work.** A graph tab that isn't the active tab of its pane, or the sidebar view while the sidebar is closed or on another view, does nothing. It catches up when shown.
- **Colours** are read from the `--graph-*` tokens, and again when the scheme or accent changes.
- **Reduced motion:** the hover fade and the zoom easing are instant. The layout still settles.

### Live updates

The graph listens to the workspace's `links` and `files` changes. These come after a note is saved and the link index refreshes (300ms after typing stops, then 1s), or after a create, rename, move or delete. They never come on a keystroke.

On a change the graph:
- rebuilds its model, which is cheap;
- maps the new nodes to the old ones by id, so every node that is still there keeps its place and speed;
- places new nodes beside a linked node;
- warms the layout up slightly.

The simulation itself is never rebuilt from scratch. Tags (for the Tags filter and `tag:` queries) come from the Tags view's search-based reader, now shared as `shell/vaultTags.ts`. It is read only when needed and kept until the next change.

Checked in the browser:
- a new note linking two others appears with its two links, and every other node stays put;
- a rename keeps the node;
- excluding the note removes it at once;
- deleting it removes it.

### Dependencies

None added. The simulation, the quadtree, the renderer and the panel are Grove's own code. Lucide gained two icons (`git-fork`, `wand-sparkles`) from the package already in use.

## Round 6 findings

| # | Finding | Fix |
|---|---|---|
| 1 | Searching settings for "line" listed a stray Hotkeys section | Two causes. A row that only shows in some states (a custom date format, a folder field) counted as a match while hidden; now only visible rows count. And the Hotkeys page was searched once it had been opened, listing command rows (Move line up, ...) as if they were settings; it has its own Filter field, so the settings search leaves it out. Searching "line" now lists Editor and Core plugins only; searching "custom" lists nothing. |
| 2 | No "Search plugins" field on Core plugins | A "Search plugins..." field above the list filters by name and description, with "No plugins match." when nothing does. Esc clears it. |
| 3 | Core plugin rows don't say what turning them off removes | Each plugin now says what it does and what turning it off removes, in one line in Obsidian's tone. For example: "Show links from other notes to the current note. Turning it off removes the Backlinks tab, the backlink count in the status bar and backlinks at the bottom of notes." |
| 4 | The settings modal was larger than Obsidian's | Measured in Obsidian with "Open settings in new window" off, at five window sizes: the modal is min(90% of the width, 1100px) by min(85% of the height, 1000px); the navigation column is min(250px, a quarter of the modal). Grove's was min(1100px, width − 48px), larger below 1,222px, with a fixed 250px column. Grove now measures 900×595/225, 990×638/247, 1100×680/250, 1100×850 and 1100×1000 at 1000×700, 1100×750, 1280×800, 1600×1000 and 2400×1400, the same as Obsidian at each. |
| 5 | Editor settings missing | **Show editing mode in status bar** is added. In Obsidian it is the hidden `editor-status` core plugin (observed in `core-plugins.json`), and Grove stores it the same way. The status bar item shows the mode's icon (`pen-line` Live Preview, `code-xml` Source mode, `book-open` Reading, as observed) between the backlinks and the word count. A click offers the three modes with a check on the current one. **Properties in document** is left out: Grove has no properties UI yet (only "Add file property" writes a frontmatter line). |
| 6 | Accent colour had only a picker | A hex field beside it, in the monospace font. Typing or pasting `#rrggbb` (the # is optional) applies at once. An invalid value is marked and not applied. The picker, the field and Restore default stay in step. |

While measuring in the Tauri window, one more bug turned up and was fixed. The status bar's word count threw for a tab whose note was still loading (after closing a tab next to a restored one).

## Performance

### Harness

- A dependency-free CDP harness (session scratchpad, not committed) drives headless Chromium 154 at 1280×800 against the Vite dev server and the mock vault.
- `?synthetic=1000` on the dev page adds a generated vault: 1,000 notes, 3,000 links with preferential attachment, every fifth a markdown link, missing notes and orphans. That gives 1,011 nodes and 3,100 links.
- The baseline is this round's start (`f97e701`), extracted and served on its own port. Each run starts with cleared storage.

What each measurement does:

- **Typing:** 80 key presses at line 2,500 of Big note (5,000 lines), keydown to the end of the next painted frame. "Graph" has the graph open and settled in a pane to the right.
- **Switch:** 40 alternating opens of Welcome and Big note, to the painted frame.
- **Graph open:** the command to the end of the first painted frame, checking that the nodes are in that frame.
- **Frames:** requestAnimationFrame gaps during each gesture, plus the graph's own work per frame (simulation tick and drawing).

### Chromium, before and after

Means in ms (p95 in brackets).

| | Before (`f97e701`) | After | After, graph open in the other pane |
|---|---|---|---|
| Typing, key to frame | 10.3 (17.7), 9.7 (16.8) | 9.9 (17.3), 10.1 (17.7) | 9.5 (16.9), 9.4 (16.1); 10.6 (18.3) with the 1,011-node graph |
| Note switch, to painted frame | 16.5 (22.3), 16.5 (22.2) | 16.5 (21.8), 16.5 (22.1) | 16.5 (18.7), 16.5 (18.7); 16.5 (18.6) with 1,011 nodes |
| Note switch, sync work | 2.2, 2.0 | 1.8, 1.9 | 2.0, 2.0 |

Graph open, to the first painted frame (which already has every node):
- sample vault: 14.1 ms;
- 1,011 nodes: 16–21 ms;
- 1,011 nodes at 4× CPU: 65 ms.

The brief's limits are 100 and 300 ms.

1,011 nodes and 3,100 links, frame gaps (all frames were 16.7ms unless noted):

| Gesture | 1× CPU | 4× CPU |
|---|---|---|
| Pan at 100% zoom (labels on) | 0 of 100 frames over 20ms; work 0.3ms | 9 of 90 over 20ms; work 1.4ms |
| Wheel zoom out to 1/128 and back | 0 of 152 over 20ms; work 0.7ms (p95 1.8) | 25 of 152 over 20ms; work 2.1ms (p95 5.7) |
| Pan with the whole graph on screen (8%) | 0 of 107; work 0.4ms | 0 of 130; work 1.4ms |
| Drag a node (simulation running) | 0 of 143; work 1.5ms | 0 of 170; work 5.7ms |
| Hover sweep across the graph | 0 of 137; work 1.5ms | 0 of 178; work 5.6ms |
| Layout settles and the loop stops | after 4.8 s; 0 frames in the next second | after 6.6 s; 0 frames in the next second |
| After a drag | stops within 2 s; 0 frames after | stops within 1.2 s; 0 frames after |

A few notes on these numbers:
- At 4×, the frames over 20ms while panning or zooming at full zoom are the browser's rasterising, not graph code (the graph's own work stays under 2ms). Headless Chromium draws canvases in software.
- The first version redrew on every pointer move during a hover sweep. It now redraws only when the hovered node changes.

### Inside the Tauri window (WebKitGTK)

Grove was run with `tauri dev` on a scratch copy of the test vaults under `/tmp` (the 18 notes, a 1,000-note synthetic folder and Big note), with scratch `XDG_*` folders. The owner's remembered vault was never read. A temporary self-test (never committed) reported through blocked navigations. The window was 2024×1102 CSS px at 2× (a 2560×1440 screen at 200%), then 985×1102 when tiled.

The first run was very slow:
- opening took 1,476 ms;
- each pan frame took 360 ms;
- typing next to the graph took 200 ms per key.

WebKitGTK draws canvases with the CPU (Cairo), and a breakdown found four causes:

1. **Lines cost their length times their width in device pixels.** Stroking 3,100 links at 100% zoom took 544ms a frame at 2× and 10ms at 1×. Stroking in batches or clipping to the view didn't help. One-device-pixel lines took 30ms at 2×.
   - **Fix:** on a high-density screen, links at the default thickness are one device pixel wide.
   - **Fix:** while the graph moves, a canvas that took over 10ms at full resolution is drawn at 1× (stepping down to 0.5× if 1× is slow too), and once more at full resolution when it comes to rest.
2. **A canvas whose CSS size isn't a whole number of pixels** (a pane 377.5px wide) was resampled whenever anything on the page was painted. The editor's frames in the next pane went from 10ms to 47–90ms with a settled, idle graph beside them.
   - **Fix:** the canvas is sized in whole CSS pixels, exactly matching its backing store.
3. **The panel's 30px box-shadow blur** was repainted with every page frame, costing about 7ms.
   - **Fix:** a pre-drawn nine-slice image of the same three shadows costs about 1ms.
4. **A graph settling on its own competed with typing.**
   - **Fix:** while settling with a slow canvas it draws every other frame.
   - **Fix:** it waits while a key was pressed elsewhere in the last 400ms, then carries on.

WebGL was tried too. It draws fast (0.55ms for everything), but WebKitGTK showed it at about one frame a second here: the DMABUF renderer is turned off for Hyprland, and every WebGL frame is copied through the CPU. So it was not used.

After the fixes, with 1,024 nodes and 3,113 links at 2×. These are the self-test's numbers; the typing figure is an insert through the editor to the next painted frame, a proxy for a key press.

| | |
|---|---|
| Graph open, first frame | 40–49 ms |
| Typing, Big note alone / with a note in the right pane | 9.6–10.3 / 9.4–10.9 ms |
| Typing with the settled graph in the right pane | 14.2–14.6 ms (p95 17) |
| Typing while the graph settles in the right pane | 13.9 ms (was 160) |
| Note switch, alone / with the graph in the right pane | 31–41 / 27–33 ms |
| Drag a node, hover sweep, pan zoomed out | 16.1, 16.1, 15.9 ms frames: 60 fps; graph work 6–7 ms |
| Pan at 100% zoom with ~400 labels and long links | 17.7 ms frames (p95 27); work 7 ms |
| Wheel zoom around 100% | 23 ms frames (p95 30) |
| Layout settles, loop stops | yes, 0 frames afterwards |

## Skipped, deviations and caveats

- **Typing next to a visible graph in the Tauri window** is about 4 ms slower than next to a note (14.5 vs 10 ms). This is WebKitGTK compositing the canvas and the panel with each editor frame; with the canvas hidden it was 12 ms. In Chromium there is no difference. A background graph tab costs nothing.
- **Panning and zooming at 100% zoom in WebKitGTK with ~1,000 nodes** run at 40–55 fps rather than 60. Everything else, and every gesture zoomed out, holds 60. Chromium holds 60 throughout.
- **Lines are one device pixel on high-density screens** at the default thickness, so they are a little finer than Obsidian's at 2×. "Link thickness" above 1 draws real widths.
- **A visual check of the Tauri window** was limited:
  - the screen was locked during part of the session;
  - later the owner was at the machine, so window launches were stopped;
  - the screenshots taken show the graph, hover and panel as in Chromium (dark theme).

  One WebKitGTK quirk seen there is fixed (a frame drawn right after the canvas was resized could stay unshown until the next repaint), but that fix wasn't re-checked by eye in the window.
- **Timelapse ("Animate")** orders notes by their last change: Grove's file list has no creation time.
- **Groups** colour notes and attachments; tag and missing-note nodes keep their colours.
- **The global graph** opens in the active tab only when it is empty, otherwise in a new tab. Obsidian opened it in an empty tab when observed; with a note open, it may reuse an existing graph tab, which was not checked.
- **Settings search** leaves out the Hotkeys page (it has its own filter).
- **Properties in document** (Editor) is not built: Grove has no properties UI.
- **Open in new window, Open in default app, Show in system explorer** stay out of the node menu, as everywhere in Grove (the lockdown).
- **The settings modal's sizes** now match Obsidian's at every window size measured. The owner's comparison may have been at a smaller window, where Grove's old formula gave a larger modal.
- **Harness and observation scripts** live in the session scratchpad, as in earlier rounds. The Obsidian sandbox, the `/tmp` test vault and the scratch XDG folders are scratch only.
