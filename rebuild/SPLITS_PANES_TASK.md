# Task: Splits and panes for Grove (Obsidian-style tab groups)

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app`. Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/MOTION_NOTES.md`, `rebuild/LOCKDOWN_SIDEBAR_NOTES.md` and `rebuild/ICONS_MENUS_NOTES.md` first. The motion pass, the offline lockdown and the icons/menus/palette pass are merged; reuse the motion tokens and helpers in `src/motion.ts` / `theme.css`, the Lucide icon module in `shell/icons.ts`, the menu component in `shell/menu.ts` / `shell/menus.ts`, the command registry in `src/commands.ts` / `src/appCommands.ts`, and the shared prompt in `shell/prompt.ts`. Keep `npm run audit:offline` passing.

## Why Grove exists (non-negotiable)
Grove is an Obsidian the owner can use at work without infosec concerns: source available, no downloadable community plugins, and **nothing in the app ever reaches outside the machine**. No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images (bundle everything locally); keep the strict CSP in `tauri.conf.json` that allows only the app's own origin; external links open only on an explicit user click through the system opener; no previews of remote embeds; only reviewable, minimal dependencies. Any extensibility must be built-in features, not downloadable plugins.

## Visual direction
The owner likes Obsidian's look because it has character and isn't generic app boilerplate. Stay close to it. Use the same Lucide icon set Obsidian uses (ISC licence, already bundled in `shell/icons.ts`) and match Obsidian's splits, tab bars, resize handles and drop-zone overlays closely. **Recreate them by observing Obsidian; never copy Obsidian's proprietary source code, CSS files or bundled assets.** A subtle forest teal/green accent is welcome (the owner's favourite colour is teal/seafoam), but keep it subtle; structure, density and spacing should read as Obsidian.

## The problem
Grove has one tab strip and one editor. `Workspace` (`src/workspace.ts`) owns a single `EditorView`, one `tabs` list and one `active` tab, so there is no way to read one note while writing another, which is half of how the owner uses Obsidian. Round 4 had to leave out every split and "to the right" item and hint because splits didn't exist. The round 4 side-by-side check with Obsidian also found these gaps:
1. Menus are still shorter than Obsidian's. Some missing items need splits (below); others are now possible without new permissions.
2. The command palette's command list is small next to Obsidian's.
3. The ribbon has fewer icons than Obsidian's.
4. Grove's menu shadow is heavier than Obsidian's, which is lighter and softer.
5. The quick switcher is 700px wide (round 4 chose Obsidian's documented default); it has not been checked against Obsidian side by side.
6. Source mode shows unstyled plain text. Obsidian's source mode keeps markdown syntax highlighting (in the normal text font, not monospace) with heading sizes turned off.
7. The Outgoing links view has no Unlinked mentions section; Obsidian's has one.
8. Tags in frontmatter (`tags:` as a list or inline) aren't counted in the Tags view.

## Requirements
### A. Tab groups and splits
1. **Model.** Replace the single tab strip with a layout tree like Obsidian's: leaves are tab groups (each with its own tab bar, tabs, active tab and view header), and inner nodes are horizontal or vertical splits that can nest (split right inside a split down, and so on). One group is the active pane. Keep the model in a small, tested module that doesn't depend on the DOM.
2. **Split right / split down** the current tab: the new group opens beside or below with the same note, and becomes active.
3. **Resize handles** between splits: draggable, Obsidian's thin handle with a hover/drag highlight, a sensible minimum size per pane (no pane can be dragged to nothing), and sizes kept as fractions so window resizes scale them.
4. **Closing the last tab in a group collapses the group**, and its space goes to its sibling; a split with one child left is flattened. Closing the last tab in the last group leaves Obsidian's empty "New tab" state, not a blank window.
5. **Active pane indication** like Obsidian: subtle (the active group's tab and header read as active, the others slightly muted); no heavy borders or loud accent.
6. **Drag and drop tabs**: drag a tab within its tab bar to reorder (keep what exists), onto another group's tab bar to move it there at the drop position, or onto an edge (or the centre) of a pane to create a split there, with an Obsidian-like translucent drop-zone overlay showing where it will land. Dropping onto the centre moves the tab into that group.
7. **Move tab between groups** also from the keyboard/menu side where Obsidian has it; at minimum the drag above and a command if cheap.
8. **Open to the right:** Ctrl/Cmd+click on a link opens in a new tab (as Obsidian does); "Open to the right" opens a note in a split to the right (reusing an existing right neighbour group if Obsidian does; observe it). Bind Ctrl+Alt+Enter in the quick switcher to open to the right and show its footer hint ("ctrl alt ↵ to open to the right"), which round 4 left out.
9. **Same note in two panes stays in sync.** Edits in one show in the other immediately, with one shared document (CodeMirror's split-view pattern: one source of truth, the other view's changes forwarded as annotated transactions), not two copies of heavy state or two save loops. Each pane keeps its own selection and scroll position. Saving still happens once per note.
10. **Linked panes** (Obsidian's "Link with tab") are optional; skip them and say so unless they fall out cheaply.
11. **Navigation history per pane:** back/forward in a pane walks that pane's history only.
12. **Restore the layout on next launch:** the split tree, sizes, each group's tabs and active tab, and the active pane, saved per vault in the app's local state (localStorage or the existing prefs), never anywhere networked. Notes that no longer exist are dropped quietly.
13. **Existing features keep working per active pane:** right sidebar views (backlinks, outgoing, tags, outline) follow the active pane's note; the status bar shows the active pane's counts; reading/source mode is per tab; the command palette and editor commands act on the active pane.

### B. Menu items and commands that need splits
1. Add **Split right** and **Split down** to the tab context menu and the More options menu, in Obsidian's positions and with Obsidian's Lucide icons.
2. Add **Open to the right** to the file-tree note menu and the editor link menu (and "Open in new tab" where Obsidian has it), in Obsidian's order.
3. Register commands for every new action in the command registry with Obsidian-style names (e.g. "Workspace: Split right", "Workspace: Split down", "Workspace: Close this tab group", focus left/right/up/down pane if cheap), each with Obsidian's default hotkey if it has one. Obsidian has none for splitting by default, so leave those unbound.

### C. Findings from the round 4 side-by-side check (fix these too)
1. **Longer menus.** Add the Obsidian items now possible without new permissions to the file-tree, tab, editor and More options menus, in Obsidian's order. Leave out Open in default app and Show in system explorer, because the lockdown denies the opener permissions they need, and say so in the notes. No dead items.
2. **More commands.** Register more of the actions that already exist (file, editor formatting, view, navigation, bookmarks, sidebar views and so on) in the palette with Obsidian-style "Group: Action" names.
3. **Ribbon.** Add ribbon icons Obsidian has only where Grove can back them with a real feature; no dead buttons. Note which ones you left out.
4. **Menu shadow.** Match Obsidian's lighter shadow.
5. **Quick switcher width.** Check the 700px choice against Obsidian side by side (and the spec's ~465px), and settle it with the footer still on one line.
6. **Source mode styling.** Match Obsidian's source mode: markdown syntax highlighting stays (marks, links, emphasis colours) in the normal text font, with heading sizes off. Live preview and reading view are unchanged.
7. **Outgoing links: Unlinked mentions.** Add Obsidian's Unlinked mentions section to the Outgoing links view (names of other notes that appear in this note as plain text, not as links), collapsed by default like Obsidian, with a cheap computation that never runs on the typing path beyond a debounced update while the view is open.
8. **Frontmatter tags.** Count `tags:` in YAML frontmatter (list and inline forms, with or without `#`) in the Tags view, without breaking its fenced-code skipping or its unsaved-editor-text handling.

## Performance rules (hard)
- Typing latency on the 5,000-line note must stay at the current ~10ms key-to-frame, including with the same note open in two panes.
- Note switching must still show content in under 50ms, in any pane.
- Resize drags run at 60fps: update flex-basis or transforms in a `requestAnimationFrame`, read layout once per frame at most (no layout thrash), and never re-create an editor on resize.
- Splitting, closing a group and moving a tab finish within one frame; reuse existing editor views where possible instead of rebuilding them.
- Animate only `opacity` and `transform`; respect `prefers-reduced-motion`.
- Measure key-to-frame, note-switch time, split/close time and resize-drag frame times before and after with the CDP / Performance-API harness from earlier rounds (if it isn't in your worktree, recreate a small dependency-free one against the Vite dev server and the mock vault) and record the numbers.

## Scope
`rebuild/app` front end (`src`, `index.html`, styles) and the mock backend. Backend (`src-tauri`) changes only if something truly needs a new command; then add it to the mock and document it in `CONTRACT.md`. Do not touch the owner's real vaults or anything outside this worktree.

## Done when
- `npm run build`, `npm test`, `npm run audit:offline`, and `cargo build` (in `rebuild/app/src-tauri`) all pass.
- Every requirement above is done or explicitly noted as not applicable with a reason.
- Commit your work on the current branch with clear messages (several small commits are fine). Do NOT push, do NOT merge into other branches.
- Finish by writing `rebuild/SPLITS_PANES_NOTES.md`: the layout model and how it's persisted, how the same note is shared between panes, drag/drop and drop-zone behaviour, each menu's added items compared with Obsidian's, the new commands and hotkeys, the round 4 findings and how each was fixed, performance numbers before/after, and anything skipped and why.
