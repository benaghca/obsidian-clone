# Task: Icons and menus pass for Grove (match Obsidian's look)

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app`. Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/MOTION_NOTES.md` and `rebuild/LOCKDOWN_SIDEBAR_NOTES.md` first. The motion pass and the offline lockdown are merged; reuse the motion tokens and helpers in `src/motion.ts` / `theme.css`, the dock code in `shell/sidedock.ts`, and keep `npm run audit:offline` passing.

## Why Grove exists (non-negotiable)
Grove is an Obsidian the owner can use at work without infosec concerns: source available, no downloadable community plugins, and **nothing in the app ever reaches outside the machine**. No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images (bundle everything locally); keep the strict CSP in `tauri.conf.json` that allows only the app's own origin; external links open only on an explicit user click through the system opener; no previews of remote embeds; only reviewable, minimal dependencies. Any extensibility must be built-in features, not downloadable plugins.

## Visual direction
The owner likes Obsidian's look because it has character and isn't generic app boilerplate. Stay close to it. Use the same Lucide icon set Obsidian uses (ISC licence) and match Obsidian's menus closely. **Recreate them by observing Obsidian; never copy Obsidian's proprietary source code, CSS files or bundled assets.** A subtle forest teal/green accent is welcome (the owner's favourite colour is teal/seafoam), but keep it subtle; structure, density and spacing should read as Obsidian.

## The problem
Side by side with Obsidian, Grove's chrome still looks generic:
1. **Menus are plain text lists.** `shell/menu.ts` renders a list of titles: no icons, no separators or grouping, no submenus, no keyboard navigation, no checkmarks/shortcut hints, and the item sets and order don't match Obsidian's.
2. **There is no command palette** (Ctrl/Cmd+P), so commands like toggling the right sidebar are only reachable by buttons or ad-hoc shortcuts.
3. **Icons are a hand-inlined subset** in `shell/icons.ts`. Some places Obsidian shows an icon (menu items, view headers, ribbon, status bar) have none or a different glyph, and stroke width/size don't consistently match Obsidian (Obsidian uses Lucide at ~16-18px with a ~1.75-2px stroke depending on context).
4. **Findings from the round 3 side-by-side check** (fix these too):
   - Obsidian's file-tree context menu has about 12 items with Lucide icons, separators, a Copy path submenu and a red Delete; its More options menu has about 25. Grove's have 3-4 plain-text items. The editor right-click shows no Grove menu at all.
   - Ctrl/Cmd+P does nothing.
   - The right sidebar header has only Backlinks and Outline. Obsidian shows Backlinks, Outgoing links, Tags, Bookmarks and Outline. Add icon tabs for Outgoing links and Tags with working views (Bookmarks only if it is cheap; otherwise leave it out, no dead tabs).
   - The Linked mentions count shows the number of source notes (3) where Obsidian shows the total mentions (138 for Ideas in the test vault). Match Obsidian. The Linked/Unlinked section headers are bolder and larger than Obsidian's.
   - The Outline highlights the active heading in the accent colour; Obsidian doesn't. Match Obsidian (a subtle hover only).
   - Pressing Enter twice after a checked task leaves an extra blank line before the new text; Obsidian leaves none.
   - The quick switcher footer is missing Obsidian's hints (e.g. "ctrl alt ↵ to open to the right", "shift ↵ to create") and wraps onto two lines.
   - The tab-list dropdown is a plain list of titles; Obsidian's has icons and its own items.
   - Placeholder buttons (help, settings, reading view) say "not available yet". Either wire them to something real or hide them rather than showing dead controls.

## Requirements
### A. Icons
1. One icon module backed by Lucide, bundled locally and tree-shaken: either the `lucide` npm package (ESM, import only the icons used) or vendored SVG path data with the ISC licence notice. No icon fonts or CDN. If you add `lucide`, it is the only new dependency allowed and must be added to the offline audit's dependency allowlist with a comment.
2. Use the same glyph Obsidian uses for each place: ribbon, left/right sidebar view tabs, file tree header buttons (new note, new folder, sort, collapse all), tab bar (+, tab list dropdown, right sidebar toggle), view header (back/forward, reading/editing toggle, more options), status bar, menus, the quick switcher and command palette. Match size, stroke width, colour (muted by default, normal on hover) and hover backgrounds/radii.

### B. Menus (shared component)
1. Rebuild `shell/menu.ts` as one reusable menu component that supports: an icon per item, section separators, disabled items, checked items, a right-aligned shortcut hint, submenus (opening on hover with a short delay and on ArrowRight), and danger items ("Delete" in red, like Obsidian).
2. Keyboard: Arrow Up/Down move the highlight (skipping separators and disabled items), Enter activates, ArrowLeft/Escape closes a submenu then the menu, Home/End, and type-ahead is optional. Mouse hover and keyboard highlight share one state, like Obsidian.
3. Placement: open at the pointer for context menus and under the button for dropdowns, flip/shift to stay inside the window, and keep Obsidian's look: padding, ~6px item radius, item height, font size, separator spacing, the subtle shadow and border, and the existing fade + slight-translate motion.
4. Recreate these menus with Obsidian's item order and grouping (observe Obsidian for the exact items; leave out anything Grove can't do yet rather than adding dead items, and note what you left out):
   - File tree item context menu (note and folder variants), and the empty-area/vault context menu.
   - Editor right-click menu (with the cursor on plain text, on a link, and with a selection).
   - Tab context menu and the tab bar's tab-list dropdown.
   - The view header "More options" (three dots) menu.
   - The ribbon's context menu if Obsidian has one; otherwise skip.

### C. Command palette and quick switcher
1. Add a command palette (Ctrl/Cmd+P) with a small command registry: every action that exists today (new note, new tab, close tab, toggle left/right sidebar, open quick switcher, navigate back/forward, toggle reading view if it exists, show backlinks, show outline, etc.) is registered once with an id, name ("Group: Action" like Obsidian), optional icon and default hotkey. Buttons, menus and shortcuts call commands through the registry.
2. Match Obsidian's palette layout: the prompt at the top, fuzzy-matched results with matched characters highlighted, hotkey chips on the right, recently used commands first, and the instructions footer (↑↓ to navigate, ↵ to use, esc to dismiss). Reuse the quick switcher's modal and motion.
3. Bring the quick switcher's layout in line with the palette (same modal, row height, highlight and footer), keeping its round-3 behaviour.

### D. Leftover lockdown work
1. If it can be done safely, run the app in a real Tauri window (`npm run tauri dev`) against a throwaway test vault inside your worktree, without reading or changing the owner's real app config or vaults (if Grove's config dir can't be redirected, skip this and say so). Check that external links open the system browser, a blocked navigation is logged, and the docks animate in WebKitGTK.
2. Keep every check in `npm run audit:offline` passing and extend it if you add a dependency.

## Performance rules (hard)
- Typing latency on the 5,000-line note must stay at the current ~10ms key-to-frame. Nothing in this pass runs on the typing path.
- Note switching must still show content in under 50ms.
- A menu or the palette must open within one frame of the click/keypress (build DOM lazily; no heavy work on open). Fuzzy matching in the palette must stay under 2ms per keystroke for the full command list.
- Animate only `opacity` and `transform`; respect `prefers-reduced-motion`.
- Icons must not bloat the bundle: import only the icons used, and report the bundle size before/after.
- Measure key-to-frame and note-switch time before and after (the CDP / Performance-API harness from earlier rounds is fine) and record the numbers.

## Scope
`rebuild/app` front end (`src`, `index.html`, styles), `package.json`/lockfile if you add `lucide`, the offline audit script, and the mock backend if a menu action needs it. Backend (`src-tauri`) changes only if a menu action truly needs a new command; then add it to the mock and document it in `CONTRACT.md`. Do not touch the owner's real vaults or anything outside this worktree.

## Done when
- `npm run build`, `npm test`, `npm run audit:offline`, and `cargo build` (in `rebuild/app/src-tauri`) all pass.
- Every requirement above is done or explicitly noted as not applicable with a reason.
- Commit your work on the current branch with clear messages (several small commits are fine). Do NOT push, do NOT merge into other branches.
- Finish by writing `rebuild/ICONS_MENUS_NOTES.md`: the icon approach and licence handling, each menu's final item list compared with Obsidian's, the command registry and palette design, keyboard behaviour, bundle size before/after, performance numbers before/after, and anything skipped and why.
