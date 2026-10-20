# Task: Graph view for Grove (Obsidian-style global and local graph)

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app`. Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/MOTION_NOTES.md`, `rebuild/LOCKDOWN_SIDEBAR_NOTES.md`, `rebuild/ICONS_MENUS_NOTES.md`, `rebuild/SPLITS_PANES_NOTES.md` and `rebuild/SETTINGS_NOTES.md` first. The motion, lockdown, icons/menus/palette, splits/panes and settings passes are merged. Reuse the motion tokens and helpers in `src/motion.ts` / `theme.css`, the Lucide icons in `shell/icons.ts`, the menu component in `shell/menu.ts` / `shell/menus.ts`, the command registry in `src/commands.ts` / `src/appCommands.ts`, the layout model in `src/layout.ts` and panes in `shell/pane.ts`, the link and tag index used by backlinks/outgoing/tags views, the settings store, schema, controls and core-plugin toggles in `src/settings/`, and the light/dark theme tokens. Keep `npm run audit:offline` passing.

## Why Grove exists (non-negotiable)
Grove is an Obsidian the owner can use at work without infosec concerns: source available, no downloadable community plugins, and **nothing in the app ever reaches outside the machine**. No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images (bundle everything locally); keep the strict CSP in `tauri.conf.json` that allows only the app's own origin; external links open only on an explicit user click through the system opener; no previews of remote embeds; only reviewable, minimal dependencies. Any extensibility must be built-in features, not downloadable plugins. For the graph this means: no graph library that phones home, loads workers or WASM from a CDN, or pulls in a large dependency tree. Prefer writing the force simulation and renderer yourself (Canvas 2D or WebGL, no new dependency); if you do add one, it must be small, reviewable, fully bundled and justified in the notes, and the audit must pass.

## Visual direction
The owner likes Obsidian's look because it has character and isn't generic app boilerplate. Stay close to it. Observe Obsidian's graph view side by side (the box has Obsidian at `/workspace/obsidian-app`, run with `--no-sandbox` and a throwaway vault; earlier rounds ran it in a network namespace with a scratch HOME, which is fine too) and match: node size and colour, link thickness and colour, label fade-in with zoom, hover highlighting of a node and its neighbours (everything else dims), the drag feel, the settle/cool-down motion, the zoom and pan feel, and the floating graph-settings panel in the top-right corner with its collapsible Filters, Groups, Display and Forces sections, sliders and toggles. **Recreate it by observing Obsidian; never copy Obsidian's proprietary source code, CSS files or bundled assets.** The subtle forest teal accent (the owner's favourite colour is teal/seafoam) is welcome for the hovered or active node; keep it subtle and make it work in both light and dark themes.

## The problem
Grove has no graph view. In Obsidian the graph is one of the most recognisable screens: "Open graph view" from the ribbon (Lucide `git-fork`), the command palette or a hotkey opens the global graph in a tab, and "Open local graph" shows the current note's neighbourhood, which also lives in the right sidebar. The round 6 side-by-side check with Obsidian also found these settings gaps:
1. Settings search for "line" listed a stray "Hotkeys" section with no matching row. Only sections with real matches should appear.
2. Core plugins has no "Search plugins" field above the list, as Obsidian's has.
3. Core plugin rows don't say what turning a plugin off removes. Grok's round 6 build had a clear one-line description per plugin ("Removes the Backlinks tab, the backlink count in the status bar..."); use descriptions like that, in Obsidian's tone.
4. The settings modal is larger than Obsidian's in-app settings at the same window size; check its size against Obsidian with "Open settings in new window" switched off and tune it.
5. Missing Editor settings Obsidian has: "Show editing mode in status bar" (add it, with the status-bar indicator), and "Properties in document" (leave out unless properties are built; say so).
6. Accent colour has only a colour picker; add a hex text field next to it, as Grok's build had.

## Requirements
### A. Global graph view
1. **Open it** from a ribbon button, the command "Graph view: Open graph view" (Obsidian's default Ctrl/Cmd+G), and the palette. It opens as a normal tab, so it can be split, dragged and restored with the layout like any other tab, with the tab and More options menus that make sense for it.
2. **Nodes are notes, edges are resolved links** (wikilinks and markdown links to notes), drawn as an undirected graph. Options in the settings panel: show tags as nodes, show attachments (only if Grove tracks them; else leave out), show non-existing files (unresolved link targets), show orphans.
3. **Force-directed layout** with centre force, repel force, link force and link distance, matching Obsidian's feel: it settles quickly from a stable starting position, cools down and stops computing when still, and reheats briefly when a node is dragged or the graph changes.
4. **Interaction:** pan by dragging empty space, zoom with the wheel or trackpad pinch around the pointer, drag a node (its neighbours follow), hover a node to highlight it and its links and neighbours while the rest dims, click a node to open that note (Ctrl/Cmd-click or middle-click opens it in a new tab), right-click a node for a small menu (Open in new tab, Open to the right, and the file menu items that make sense). Labels fade in as you zoom in, and the hovered node's label always shows.
5. **The graph-settings panel** (top-right, collapsible, with the Lucide icons Obsidian uses): Filters (search field using Grove's search syntax, tags, attachments, existing files only, orphans), Groups (a query plus a colour per group; nodes matching the first group take its colour), Display (arrows, text fade threshold, node size, link thickness, an Animate button), Forces (centre, repel, link force, link distance). All sliders apply live. Settings are saved per vault in `.grove/graph.json` through the existing settings store.
6. **Live updates:** creating, renaming, deleting or editing links in a note updates the graph without a rebuild of the whole simulation, and never on the typing path (debounce, reuse the existing index updates).
7. **Excluded files** from Files and links settings are hidden from the graph.

### B. Local graph
1. "Graph view: Open local graph" opens the active note's graph in a tab, and a Local graph view is available in the right sidebar like Backlinks and Outline. It follows the active note.
2. Depth slider (1 to 5 hops), plus incoming links, outgoing links and neighbour links toggles, as in Obsidian, with the same Filters, Groups, Display and Forces panel.
3. The current note is highlighted (accent ring or fill).

### C. Core plugin and settings
1. "Graph view" becomes a core plugin toggle; turning it off removes the ribbon button, commands, the sidebar view and any menu items.
2. Fix the round 6 findings listed in "The problem" (items 1 to 6).

## Performance rules (hard)
- Typing latency on the 5,000-line note must stay at the current ~10ms key-to-frame, with the graph view open in another pane.
- Note switching must still show content in under 50ms, in any pane.
- The graph must render at 60fps while panning, zooming and dragging with at least 1,000 nodes and 3,000 links (generate a synthetic test vault for measuring; never use the owner's real vaults). Use Canvas 2D or WebGL, not one DOM or SVG element per node.
- The simulation runs in a cooling loop and stops completely (no `requestAnimationFrame` spinning) once settled and nothing is moving. A hidden or background graph tab does no work.
- Opening the global graph shows a first frame within 100ms for the sample vault and within 300ms for the 1,000-node vault.
- Hit-testing for hover uses a spatial index or a cheap pass; hover must not drop frames.
- Animate only `opacity` and `transform` for any DOM chrome; respect `prefers-reduced-motion` (the graph can still settle, but no decorative animation).
- Measure key-to-frame, note switch, graph open time and pan/zoom/drag frame times before and after with the CDP / Performance-API harness from earlier rounds (recreate a small dependency-free one if it isn't in your worktree) and record the numbers.

## Scope
`rebuild/app` front end (`src`, `index.html`, styles) and the mock backend. Backend changes only if the graph truly needs data the index doesn't already give (unlikely); if so, add the smallest commands, documented in `CONTRACT.md`, with Rust tests. Do not touch the owner's real vaults or anything outside this worktree.

## Done when
- `npm run build`, `npm test`, `npm run audit:offline`, and `cargo build` (in `rebuild/app/src-tauri`) all pass, plus `cargo test` if you add backend code.
- Every requirement above is done or explicitly noted as not applicable with a reason.
- Commit your work on the current branch with clear messages (several small commits are fine). Do NOT push, do NOT merge into other branches.
- Finish by writing `rebuild/GRAPH_NOTES.md`: how the graph compares with Obsidian's (layout feel, look, hover, panel, local graph), how the simulation and renderer work, any dependency added and why, how live updates work, the round 6 findings and how each was fixed, performance numbers before/after (including 1,000-node frame times), and anything skipped and why.
