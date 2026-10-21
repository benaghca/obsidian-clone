# Task: Round 9, polish and the biggest remaining Obsidian gaps

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/GRAPH_NOTES.md`, `rebuild/SETTINGS_NOTES.md` and `rebuild/CLEANUP_NOTES.md` first.

You are one of three agents given this same task in separate worktrees. Work only in yours.

## The problem
Grove now covers most of what the owner uses in Obsidian, and round 8 got the code into shape: 21,673 lines (TS 15,700 incl. 1,287 test lines, CSS 2,909, Rust 3,064), no file over ~750 lines. A handful of visible gaps remain. They are the ones the owner notices first. Close them **without undoing round 8**: the smallest change that matches Obsidian, built on the modules that already exist.

## Requirements
Do them in this order. If time runs short, finish and polish fewer items rather than half-building all of them.

1. **Graph speed in the real Tauri window (WebKitGTK).** Round 7 left two gaps (`GRAPH_NOTES.md`, "Inside the Tauri window"):
   - typing next to a visible, settled graph is ~14.5 ms key-to-frame vs ~10 ms next to a note. Target: within ~1 ms of typing next to a note;
   - pan and wheel zoom at 100% zoom with ~1,000 nodes run at 40–55 fps. Target: 60 fps (frame p95 under ~20 ms).
   
   Keep every existing fix (whole-pixel canvas, one-device-pixel HiDPI links, low-resolution draw while moving, every-other-frame settle, typing yield, nine-slice shadow). Ideas to try: avoid recompositing the canvas when the editor paints (layering, `contain`, `will-change` used sparingly), cache the static link layer while only labels or hover change, cheaper label drawing. WebGL was measured as unusable here (round 7); don't retry it without a new reason. Report before/after numbers.
2. **Groups colour every node they match.** In Obsidian a colour group's query also colours tag nodes and missing-note (unresolved) nodes where the query matches them (check by observation, e.g. a `tag:#x` group and a group matching a missing note's name). Grove currently leaves tag and missing-note nodes in their default colours. Match Obsidian.
3. **Properties in document.** Obsidian shows a note's YAML frontmatter as a Properties block at the top of the note in Live Preview and Reading view: a "Properties" heading, one row per property with a type icon, the key and an editable value (text, list, number, checkbox, date), "Add property", and a collapse chevron. Build the core of it, reusing the existing frontmatter parsing and "Add file property" (`markdown:add-metadata-property`, Ctrl/Cmd+;), which should focus a new row in that block. Add the Editor setting **Properties in document** (Visible / Hidden / Source, as in Obsidian). Edits must write plain YAML back to the note, round-trip unknown or complex YAML unchanged (fall back to showing it as source when it can't be edited safely), and never cost typing speed in the body. Source mode shows the raw frontmatter as now.
4. **Missing menu items, only if they stay inside the lockdown.**
   - **Open in new window** (tab menu, file menu, link menu): a second Grove window of the app's own origin with the same CSP, showing that note. Allowed only if the new window gets the same narrow capabilities as the main one (no remote URLs, no new permissions beyond what the window itself needs) and closes cleanly. Say exactly what changed in `tauri.conf.json` / capabilities.
   - **Export to PDF** (file menu, More options, command palette): allowed only if it is fully local (for example printing the rendered note through the webview to a PDF file the user picks), with no new dependency unless clearly justified, and no permission broader than needed.
   
   If either one needs loosening the CSP, network access or a broad permission, do not build it. Explain why in the notes. "Open in default app" and "Show in system explorer" stay out.
5. **The tab drop overlay.** Compare the drag-and-drop overlay (`src/shell/tabDrag.ts`, `SPLITS_PANES_NOTES.md`) with Obsidian's by observation: colour and opacity, corner radius, inset, how it glides between zones, and how the dragged tab's ghost looks. Match what differs.

## Size discipline (owner's rule; round 8's work must survive)
- Smallest change that does the job. Reuse existing modules, helpers, tokens and icons (`listeners.ts`, `storage.ts`, `paths.ts`, `shell/sideView.ts`, settings `row()`, menus, `graph/draw.ts`, `graph/camera.ts`) before writing new ones.
- Delete dead code you make or find along the way.
- **No new dependency** without a written reason in the notes (what it does, its size, why our own code would be worse). A YAML parser counts: prefer the existing frontmatter handling unless that is clearly unsafe.
- No file over ~800 lines. If a file you touch would cross that, split it first.
- Report the net line change by TS (app and tests), CSS and Rust. A feature round will grow the code. Keep the total under about +1,500 lines, and explain any item that cost more than ~400.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look is recreated by observation with bundled Lucide icons and Obsidian-like menus; never copy Obsidian's code, CSS or assets. Subtle forest-teal accent.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No windows on the owner's screen.** Test headlessly (Vite + headless Chromium). For the WebKitGTK measurements in item 1, run the Tauri app only on a private virtual display (for example `Xvfb :99` or a headless compositor) with scratch `HOME`/`XDG_*` folders, and close it when done. If that is impossible, say so and give Chromium numbers plus your reasoning.
- If you observe Obsidian, run it isolated (no network, e.g. `unshare --net`), on a private virtual display, with a scratch `HOME` and throwaway vaults. Never touch `~/.config/obsidian`.
- Commit locally only, in small commits with clear messages. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- Each item above is either done (with tests where it has logic: graph group matching, the properties YAML round trip, any new command) or explicitly skipped with a reason.
- Typing on the 5,000-line Big note and note switching are no slower than now.
- Finish by writing `rebuild/POLISH_GAPS_NOTES.md`:
  - per item, what you built, how it compares with Obsidian, and what you skipped and why;
  - before/after line counts for TS (app and tests), CSS and Rust, with the net change for each and in total, measured from `rebuild/app` with
    ```
    for e in ts css rs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
    git ls-files '*.ts' '*.css' '*.rs' | xargs wc -l | sort -rn | head -15
    ```
  - any dependency, permission, capability or CSP change, and why;
  - performance before/after (typing, note switch, graph open, pan/zoom; and the WebKitGTK numbers for item 1).
