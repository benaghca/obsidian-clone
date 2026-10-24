# Task: Round 27, Canvas part 4: drag notes onto the canvas, note-card titles, Add card after an empty connection drop

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/ROUND26_ARROWS_TASK.md` and `rebuild/ROUND26_NOTES.md` (round 26, as merged, including its Stage 3 fixes) first. The canvas view lives in `src/canvas/`.

**Who builds.** You (Codex) build the canvas part of round 27. A bug hunter (Grok) will test your branch afterwards and confirmed bugs come back to you. Keep changes small: reuse what exists (the card picker and `insert` in `canvas/cards.ts`, the gestures, history, selection toolbar and menus from rounds 24 to 26). Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**Grok is building in parallel on other files.** Grok is changing the file explorer header (Collapse all / Expand all toggle in `src/shell/sidebar.ts`), adding a vault switcher at the bottom left of the left sidebar, and reformatting the status bar. **Do not edit those areas** (`src/shell/sidebar.ts`, `src/styles/fileTree.css`, `src/styles/sidedock.css`, the status bar code and styles). Touch only `src/canvas/`, `src/styles/canvas.css` and the minimum hook needed to receive an explorer drag. If the explorer drag source (`src/shell/treeDrag.ts`) needs a change, keep it to a few lines, and say exactly what and why in your notes so the merge with Grok's branch stays clean.

Grove is now **31,090 lines** of TS/CSS/Rust (TS 24,050, CSS 3,895, Rust 3,145; scripts `*.mjs` 3,518), up 289 in round 26. Count lines from `rebuild/app` with:
```
for e in ts css rs mjs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## The features (Chris's own requests first)
Observe Obsidian 1.14.4 yourself first (headless or private Xvfb, private HOME/profile, scratch vault, no network, as in rounds 24 to 26). Work only from observation, never from Obsidian's code, CSS or assets.

1. **Drag notes from the file explorer onto the canvas** (Chris). Dragging a note (or an image/media file) from the explorer and dropping it on empty canvas space adds it as a file card at the drop point, as Obsidian does. Record Obsidian's card size, where it lands relative to the pointer, what a drop on an existing card does, what a folder drop does, and what the drag ghost and canvas highlight look like. Explorer drags elsewhere (moving files into folders, onto tabs or the editor) must keep working exactly as now. One drop is one undo step.
2. **Note cards keep the note's title as a header** (Chris). Embedded notes on the canvas currently lose their title. Show the note name as the card's header the way Obsidian does (position, size, weight, how it truncates, whether it is clickable to open the note, how it looks when the card is selected or zoomed). This is display only; the `.canvas` file stays the same.
3. **Add card menu after dropping a connection on empty space** (Grok's suggestion, also Codex's round 26 next improvement #1). Dropping a new connection on empty background opens Obsidian's small menu to add a card there (text card, note from vault, media from vault, as observed); choosing one creates the card and the edge to it as one undo step; Escape or a click away cancels with no file change. Reuse the existing pickers and history.

Not this round: canvas text in search/backlinks/graph, group and note-card editing (next canvas round); screen-space edge hit stroke when zoomed out (Grok's other suggestion, held for later).

## Testing
**Test with real mouse input**: CDP `Input` events with the pointer moved over each row, card, edge and button before pressing, including repeated clicks without moving and a double-click on toolbar/menu buttons (must not add a card), never DOM `.click()` or synthetic drag events. Drive the explorer-to-canvas drag with real pointer moves (and check a drop on a card, a drop outside the canvas and Escape mid-drag). Re-run the editor checks on notes with frontmatter in Live Preview, Source and Reading. Save a canvas changed by every new action and confirm it opens unchanged in Obsidian (round-trip fixtures, as in rounds 24 to 26), with unknown fields and key order preserved. Write `rebuild/ROUND27_NOTES.md` with what you observed, each commit, any explorer hook you touched, line counts, net line change by language (production TS, test TS, CSS, Rust, mjs), and up to 3 next improvements (each with why it matters and roughly how big).

## Guardrails
- The smallest change that works; reuse existing code; delete dead code you find on the way. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines.
- Typing on the 5,000-line Big note and inside a 40-row table must be no slower than now; the 300-card / 400-edge canvas pan, zoom and drag must stay under 20ms per frame, including during an explorer drag over the canvas.
- **Geometry.** Keep the permanent geometry suite (`scripts/test-geometry.mjs`) and all real-pointer checks passing (Live Preview, Source, Reading; frontmatter; H1 to H3). Never space lines or widgets inside `.cm-content` with vertical margins (use padding): every direct child of `.cm-content` keeps zero vertical margin and every rendered line's CodeMirror top stays within 1px of its DOM top. Fold arrows stay visible after stationary fold and unfold clicks.
- **No prompt, menu, popover or tooltip animations.** Ctrl+O, Ctrl+P, right-click menus, the canvas toolbar and the new Add card menu must open within two frames with no frame over 20ms in the first 300ms.
- **File compatibility.** Canvases stay in Obsidian's `.canvas` JSON format: unknown fields and key order preserved, tab indentation as Obsidian writes it.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look and feel is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private Xvfb display with scratch `HOME`/`XDG_*` folders.
- Commit locally only. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run test:geometry`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- All three features work with real pointer input, round-trip through Obsidian unchanged, and `rebuild/ROUND27_NOTES.md` has its notes and line counts.
