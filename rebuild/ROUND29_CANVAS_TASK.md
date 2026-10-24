# Task: Round 29, Canvas part 6: toolbar while editing, Obsidian-style groups, card body spacing

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/ROUND28_CANVAS_TASK.md` and `rebuild/ROUND28_NOTES.md` (round 28, as merged) first. The canvas view lives in `src/canvas/`.

**Who builds.** You (Codex) build round 29. A bug hunter (Grok) tests your branch afterwards and confirmed bugs come back to you. **This round is deliberately small** (your usage budget is tight): three focused polish items, no new subsystems. Reuse what exists (selection toolbar, group label editor in `labels.ts`, card rendering, the shared note editor, menus, history). Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**Grok is building in parallel on other files** (properties, file explorer, tabs, status bar, new-tab page). Touch only `src/canvas/`, `src/styles/canvas.css` and canvas tests. If you must touch a shared file outside the canvas, keep it to a few lines and say exactly what and why in your notes.

Grove is now **32,982 lines** of TS/CSS/Rust (TS 25,625, CSS 4,043, Rust 3,314; scripts `*.mjs` 5,722), up 319 since round 28 started. Count lines from `rebuild/app` with:
```
for e in ts css rs mjs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## The features
Observe Obsidian 1.14.4 yourself first (headless or private Xvfb, private HOME/profile, scratch vault, no network, as in rounds 24 to 28). Work only from observation, never from Obsidian's code, CSS or assets. The numbers below were measured on Obsidian 1.14.4 (default light theme, zoom 1) during the round 28 merge; re-check them yourself.

1. **Keep the card toolbar while editing in place** (your round 28 next improvement #2). When a text or note card is being edited on the board, Obsidian keeps the selection toolbar (Remove, Set color, Zoom to selection, Edit) shown above the card; Grove hides it until editing ends. Keep it shown and positioned above the edited card, and keep it working (e.g. Set color while editing) without stealing focus from or remounting the card's editor. Use cheap incremental refreshes (update the toolbar/preview in place on passive file refreshes instead of redrawing the board), as you suggested. Roughly 60-120 lines.
2. **Groups styled like Obsidian.**
   - *Selected group border*: Obsidian draws a selected group (and a selected card) with a 1px accent border plus a 2px accent ring (`box-shadow: 0 0 0 2px accent` plus its normal soft shadow), radius 8px. Unselected group: 1px grey border with the soft shadow. Match Grove's selected group to this using the existing accent variables.
   - *Label*: Obsidian's group label is a small box: padding 4px 8px, radius 4px, faint background (~10% grey, or 10% of the group color), 22.5px text, sitting just above the group's top-left corner. While the label is edited it shows as a boxed, outlined text field. Make Grove's label box and its selected/editing states match what you observe (Grove currently shows plain text and a 2px accent outline only while editing).
   - *Group selection toolbar*: Obsidian shows **6 buttons** for a selected group, in this order: **Remove, Set color, Zoom to selection (Shift + 2), Align, Edit label, Set background**. Grove shows 4. Bring Grove's group toolbar to the same buttons and order, reusing existing actions (Remove, color menu, zoom, label editor). *Align* and *Set background* are new: observe what they do in Obsidian (Align's menu choices; Set background's image picker and the `background` / `backgroundStyle` fields it writes to the group record) and implement the smallest faithful version that saves Obsidian-compatible fields, with background images loaded only from the vault (no remote URLs). If either is too large for this round, ship the button with the observed menu and say what is left in your notes rather than half-building it.
3. **Card body spacing and list indent like Obsidian.** In a canvas text card Obsidian measured (CSS px, zoom 1): H1 margin 0/16px (first block has no top margin), paragraphs 16px/16px, lists 16px/16px, **H2 margin-top 40px** (so ~40px space above a heading after a list), list items indented ~27.5px with bullets drawn in the indent. Grove's card bodies are tighter and indent bullets less. Match the block spacing and list indent for text cards and note cards (reading render inside cards), without changing the main note view. Inside note cards that are being edited, CodeMirror rules apply: spacing must come from padding, never vertical margins on `.cm-content` children.

Not this round: indexing canvas text and links for search, backlinks and the graph (your round 28 #1). It is held for its own later round. Bases come after Canvas.

## Testing
**Test with real mouse input**: CDP `Input` events (or Playwright `page.mouse`) with the pointer moved over each card, group label, handle, toolbar button and menu item before pressing, including repeated clicks without moving and a double-click on toolbar/menu buttons, never DOM `.click()` or synthetic drag events. Check the toolbar stays visible and usable while typing in a card with real key events, and that the card editor keeps focus. Measure Grove's card body block spacing and list indent against the numbers above in a test. Re-run the editor checks on notes with frontmatter and H1 to H3 headings in Live Preview, Source and Reading, with real mouse hover and clicks (including repeated clicks without moving). Save a canvas changed by every new group action (Align, Set background, color, label) and confirm it opens unchanged in Obsidian (round-trip fixtures as in rounds 24 to 28), unknown fields and key order preserved. Write `rebuild/ROUND29_NOTES.md` with what you observed, each commit, any shared hook you touched, line counts, net line change by language (production TS, test TS, CSS, Rust, mjs), and up to 2-3 next improvements (each with why it matters and roughly how big).

## Guardrails
- The smallest change that works; reuse existing code; delete dead code you find on the way. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines.
- Typing inside a canvas note card must be no slower than typing in a tab; the 300-card / 400-edge canvas pan, zoom and drag stay under 20ms per frame.
- **Geometry.** Keep the permanent geometry suite (`scripts/test-geometry.mjs`) and all real-pointer checks passing (Live Preview, Source, Reading; frontmatter; H1 to H3). Never space lines or widgets inside `.cm-content` with vertical margins (use padding), including inside canvas note cards: every direct child of `.cm-content` keeps zero vertical margin and every rendered line's CodeMirror top stays within 1px of its DOM top. Fold arrows stay visible after stationary fold and unfold clicks.
- **No prompt, menu, popover or tooltip animations.** Ctrl+O, Ctrl+P, right-click menus, canvas toolbars and canvas menus (including the new Align / Set background menus) open within two frames with no frame over 20ms in the first 300ms.
- **File compatibility.** Canvases stay in Obsidian's `.canvas` JSON format: unknown fields and key order preserved, tab indentation as Obsidian writes it.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look and feel is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private Xvfb display with scratch `HOME`/`XDG_*` folders.
- Commit locally only. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run test:geometry`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass. `npm test` rewrites screenshot/canvas fixtures: restore the ones you did not mean to change with `git checkout` before committing.
- All three items work with real pointer and key input, group changes round-trip through Obsidian unchanged, and `rebuild/ROUND29_NOTES.md` has its notes, line counts and next improvements.
