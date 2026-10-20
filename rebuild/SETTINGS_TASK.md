# Task: Settings for Grove (Obsidian-style settings, dark theme, hotkeys, core features)

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app`. Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/MOTION_NOTES.md`, `rebuild/LOCKDOWN_SIDEBAR_NOTES.md`, `rebuild/ICONS_MENUS_NOTES.md` and `rebuild/SPLITS_PANES_NOTES.md` first. The motion pass, offline lockdown, icons/menus/palette pass and splits/panes pass are merged; reuse the motion tokens and helpers in `src/motion.ts` / `theme.css`, the Lucide icon module in `shell/icons.ts`, the menu component in `shell/menu.ts` / `shell/menus.ts`, the command registry in `src/commands.ts` / `src/appCommands.ts`, the shared prompt in `shell/prompt.ts`, the layout model in `src/layout.ts` and the prefs in `shell/prefs.ts`. Keep `npm run audit:offline` passing.

## Why Grove exists (non-negotiable)
Grove is an Obsidian the owner can use at work without infosec concerns: source available, no downloadable community plugins, and **nothing in the app ever reaches outside the machine**. No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images (bundle everything locally); keep the strict CSP in `tauri.conf.json` that allows only the app's own origin; external links open only on an explicit user click through the system opener; no previews of remote embeds; only reviewable, minimal dependencies. Any extensibility must be built-in features, not downloadable plugins. This applies to settings too: there is no "Community plugins" tab, no theme or plugin browser, no "Check for updates", no account, sync or publish sections, and no setting that can turn any outbound behaviour on.

## Visual direction
The owner likes Obsidian's look because it has character and isn't generic app boilerplate. Stay close to it. Use the same Lucide icon set Obsidian uses (already bundled in `shell/icons.ts`) and match Obsidian's settings modal closely: its size and position, the left navigation (section headings, item density, hover and selected states), the right pane's setting rows (name, description in muted smaller text, the control on the right, thin separators between rows), toggles, dropdowns, sliders, text inputs, buttons, search fields and the close button. **Recreate it by observing Obsidian; never copy Obsidian's proprietary source code, CSS files or bundled assets.** A subtle forest teal/green accent is welcome (the owner's favourite colour is teal/seafoam), but keep it subtle; structure, density and spacing should read as Obsidian.

## The problem
Grove has no settings at all. The left ribbon's bottom even notes that "Obsidian's help and settings buttons live here too; Grove has neither". Everything is hard-coded: light theme only, one font size, no way to rebind a hotkey, no way to turn built-in views off, and no control over how new notes, links and deletes behave. In Obsidian the settings modal (Ctrl+, or the gear at the bottom of the left ribbon) is where the owner tunes all of this. The round 5 side-by-side check with Obsidian also found these gaps:
1. Tab and More options menus still lack some Obsidian items: Backlinks in document, Add file property, Open in new window, Export to PDF, Open version history, Link with tab.
2. The tab drop-zone overlay is flatter and more opaque than Obsidian's, which is lighter and more translucent.
3. The pane minimum width is about 100px; Obsidian's is about 130px.
4. The active-pane cue was hard to see. Integration now dims the other panes' active tab, title and header icons to `--text-faint` (taken from Grok's round 5 pass); check it against Obsidian and tune it.
5. Not yet tried in the real Tauri window: dragging the window by an upper pane's empty tab bar, and the right-sidebar button next to the window buttons when split.
6. In the side-by-side screenshots, Grove showed the `#` marker on headings in panes where the cursor wasn't obviously on that line; check that a newly opened note doesn't place the cursor on line 1 in a way that reveals markup Obsidian keeps hidden.

## Requirements
### A. Settings modal
1. **Open it** with Ctrl/Cmd+, , a gear button at the bottom of the left ribbon (Obsidian's position and icon), and a command ("Open settings"). Esc and the close button close it with the existing modal motion.
2. **Layout like Obsidian:** a large centred modal, left navigation with an "Options" heading and a "Core plugins" heading, right pane with the selected section. Remember the last section while the app runs.
3. **A shared settings-row component** (name, description, control) with toggle, dropdown, slider (with value shown), text input, number input, button and hotkey-chip controls, matching Obsidian's look and keyboard behaviour (Tab order, Space/Enter on toggles, arrow keys on sliders).
4. **Every visible setting works.** Changes apply live without a reload, and no dead or placeholder settings. Leave out anything Grove can't back and list it in the notes.

### B. Sections (Obsidian's order; adapt to what Grove has)
1. **General:** app version, a short plain statement that Grove makes no network connections and has no updater, and a button to open the vault's config folder location only if the lockdown allows it (otherwise leave it out and say so).
2. **Editor:** default view for new tabs (editing or reading), default editing mode (live preview or source), readable line length, strict line breaks, show line numbers, spellcheck (only if the webview's checker is fully local; verify and note it), auto-pair brackets and markdown syntax, smart lists, indent using tabs and tab size, fold heading and fold indent if cheap. Use CodeMirror `Compartment`s so changes reconfigure open editors in place, in every pane, without re-creating them.
3. **Files and links:** default location for new notes (vault root, same folder as current file, or a chosen folder), new link format (shortest path, relative, absolute), use `[[wikilinks]]`, automatically update internal links on rename (wire to the existing rename), confirm file deletion, deleted files go to (Grove's `.trash` or permanent; system trash only if it needs no new permission), and excluded files (patterns hidden from the switcher, search and graph-like views).
4. **Appearance:** base colour scheme (light, dark, adapt to system), a **dark theme** that matches Obsidian's default dark theme (observe it; recreate the variables, don't copy its CSS), accent colour (defaulting to Grove's forest teal, with a reset), interface font, text font and monospace font (local system fonts only, chosen by name; nothing downloaded), base font size slider, zoom level, show inline title, show tab title bar, show ribbon. Switching scheme must not flash or re-create editors.
5. **Hotkeys:** a searchable list of every registered command with its current hotkeys, add/remove/reset per command, Obsidian's "press a hotkey" capture, conflict warnings, and a filter for commands that have hotkeys. Changes take effect immediately everywhere (palette hints included).
6. **Core plugins:** toggles for Grove's built-in features where turning one off really removes it (commands, ribbon icons, views, menu items): backlinks, outgoing links, tags view, outline, bookmarks, daily notes, quick switcher, command palette, random note, word count. No "Community plugins" entry. Features with options get their own page under the Core plugins heading, as in Obsidian (for example Daily notes: date format, new file location, template file; Backlinks: show backlinks at the bottom of the note if you implement Backlinks in document).

### C. Storage
1. Settings are saved **per vault in the vault's own config folder** (Grove's equivalent of `.obsidian/`, e.g. `.grove/app.json`, `appearance.json`, `hotkeys.json`, `core-plugins.json`), as plain human-readable JSON, so they travel with the vault and can be reviewed. App-wide window state may stay in local storage.
2. If this needs backend support, add the smallest possible commands (read and write JSON files only inside the vault's config folder, path-checked with the existing `fsutil` helpers, atomic writes), add them to the mock backend, and document them in `CONTRACT.md`. The config folder stays hidden from the file tree, search and the watcher's note events.
3. Unknown or invalid values fall back to defaults quietly; a missing file means defaults. Writes are debounced and never happen on the typing path.

### D. Findings from the round 5 side-by-side check (fix these too)
1. Add the missing menu items Grove can now back (Backlinks in document if you build it, Add file property if cheap), in Obsidian's order. Leave out Open in new window, Export to PDF and Open version history unless they can be done fully offline without new permissions, and say why.
2. Make the drop-zone overlay lighter and more translucent like Obsidian's.
3. Raise the pane minimum to about Obsidian's (~130px) so words never break mid-word.
4. Check and tune the active-pane cue against Obsidian.
5. Run `tauri dev` with a scratch test vault (never the owner's real vaults) and check window dragging by an empty tab bar and the right-sidebar button when split; fix what's wrong.
6. Check the heading-marker/cursor behaviour on newly opened notes against Obsidian.

## Performance rules (hard)
- Typing latency on the 5,000-line note must stay at the current ~10ms key-to-frame, including with the same note open in two panes.
- Note switching must still show content in under 50ms, in any pane.
- The settings modal opens within one frame of the shortcut and its sections switch within one frame; build section DOM lazily.
- Changing any setting applies within one frame for open editors (reconfigure via compartments; never re-create editors or reload the page). Theme and font changes cause one style recalculation, no flash of the wrong theme at startup (apply the saved scheme before first paint).
- Settings writes are debounced and off the typing path.
- Animate only `opacity` and `transform`; respect `prefers-reduced-motion`.
- Measure key-to-frame, note-switch time, settings-open time and theme-switch time before and after with the CDP / Performance-API harness from earlier rounds (recreate a small dependency-free one if it isn't in your worktree) and record the numbers.

## Scope
`rebuild/app` front end (`src`, `index.html`, styles) and the mock backend, plus the smallest backend commands section C needs (documented in `CONTRACT.md`, with Rust tests). Do not touch the owner's real vaults or anything outside this worktree.

## Done when
- `npm run build`, `npm test`, `npm run audit:offline`, and `cargo build` (in `rebuild/app/src-tauri`) all pass, plus `cargo test` if you add backend code.
- Every requirement above is done or explicitly noted as not applicable with a reason.
- Commit your work on the current branch with clear messages (several small commits are fine). Do NOT push, do NOT merge into other branches.
- Finish by writing `rebuild/SETTINGS_NOTES.md`: each section and setting compared with Obsidian's (what's in, what's left out and why), how settings are stored and loaded, the dark theme and how it was matched, the hotkey editor, which core features can be turned off and what that removes, any backend commands added, the round 5 findings and how each was fixed, performance numbers before/after, and anything skipped and why.
