# Task: Round 28, Canvas part 5: edit note cards and groups on the board, zoom-steady edge hit area

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/ROUND27_CANVAS_TASK.md` and `rebuild/ROUND27_NOTES.md` (round 27, as merged) first. The canvas view lives in `src/canvas/`.

**Who builds.** You (Codex) build round 28. A bug hunter (Grok) tests your branch afterwards and confirmed bugs come back to you. Keep changes small: reuse what exists (cards, gestures, history, selection toolbar, menus, the editor setup the main note view already uses). Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**Grok is building in parallel on other files** (file explorer, tabs, status bar, attachments, commands). Touch only `src/canvas/`, `src/styles/canvas.css`, and the minimum hook needed to reuse the note editor. If you must touch a shared file outside the canvas, keep it to a few lines and say exactly what and why in your notes.

Grove is now **32,663 lines** of TS/CSS/Rust (TS 25,349, CSS 4,000, Rust 3,314; scripts `*.mjs` 5,052), up 701 since round 27 started. Count lines from `rebuild/app` with:
```
for e in ts css rs mjs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## The features
Observe Obsidian 1.14.4 yourself first (headless or private Xvfb, private HOME/profile, scratch vault, no network, as in rounds 24 to 27). Work only from observation, never from Obsidian's code, CSS or assets.

1. **Edit note cards in place** (planned since round 24; your round 27 next improvement #1). Double-click (or the toolbar's edit button) on a note card edits the embedded note right on the board the way Obsidian does: what starts editing, which mode it opens in, how scrolling inside the card works versus panning, and what ends editing (Escape, click away). Edits save to the note's own `.md` file (not the `.canvas`) through the normal save path, so an open tab of the same note shows the change. Card title header from round 27 stays. Typing in a card must feel as fast as in a tab.
2. **Edit groups** (planned since round 24). Match Obsidian for: creating a group from the current selection (menu/shortcut as observed), renaming the group label in place, resizing, Ungroup / removing a group without deleting its cards, group color through the existing color menu, and whether moving a group carries its cards (already observed in round 24; keep that). Each action is one undo step.
3. **Edge hit area steady when zoomed out** (your round 27 #2, Grok's round 26 suggestion). Keep the invisible edge hit stroke a constant width in screen pixels so arrows stay easy to pick at low zoom. Small.

Not this round: indexing canvas text and links for search, backlinks and the graph (your #3; it touches search code Grok may be changing, held for its own round). Bases come after Canvas.

## Testing
**Test with real mouse input**: CDP `Input` events with the pointer moved over each card, group label, handle, edge and button before pressing, including repeated clicks without moving and a double-click on toolbar/menu buttons, never DOM `.click()` or synthetic drag events. Type into a note card with real key events and confirm the `.md` file and an open tab of that note both update. Re-run the editor checks on notes with frontmatter in Live Preview, Source and Reading. Save a canvas changed by every new group action and confirm it opens unchanged in Obsidian (round-trip fixtures as in rounds 24 to 27), unknown fields and key order preserved. Write `rebuild/ROUND28_NOTES.md` with what you observed, each commit, any shared hook you touched, line counts, net line change by language (production TS, test TS, CSS, Rust, mjs), and up to 3 next improvements (each with why it matters and roughly how big).

## Guardrails
- The smallest change that works; reuse existing code; delete dead code you find on the way. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines.
- Typing on the 5,000-line Big note, inside a 40-row table and inside a canvas note card must be no slower than typing in a tab; the 300-card / 400-edge canvas pan, zoom and drag stay under 20ms per frame.
- **Geometry.** Keep the permanent geometry suite (`scripts/test-geometry.mjs`) and all real-pointer checks passing (Live Preview, Source, Reading; frontmatter; H1 to H3). Never space lines or widgets inside `.cm-content` with vertical margins (use padding), including inside canvas note cards: every direct child of `.cm-content` keeps zero vertical margin and every rendered line's CodeMirror top stays within 1px of its DOM top. Fold arrows stay visible after stationary fold and unfold clicks.
- **No prompt, menu, popover or tooltip animations.** Ctrl+O, Ctrl+P, right-click menus and canvas menus open within two frames with no frame over 20ms in the first 300ms.
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
- All three features work with real pointer and key input, group changes round-trip through Obsidian unchanged, and `rebuild/ROUND28_NOTES.md` has its notes and line counts.
