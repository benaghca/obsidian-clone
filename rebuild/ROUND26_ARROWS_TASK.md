# Task: Round 26, Canvas part 3: arrows (create, reconnect, label and delete edges)

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/ROUND24_CANVAS_TASK.md`, `rebuild/ROUND25_CLEANUP_TASK.md` and `rebuild/ROUND25_NOTES.md` (round 25, as merged, including its Stage 3 fixes) first. The canvas view lives in `src/canvas/`.

**Who builds.** Claude is out on its weekly limit until Oct 27, so you (Codex) are the builder. A bug hunter (Grok) will test your branch afterwards and confirmed bugs come back to you. Keep changes small: reuse what exists (the edge model and renderer from round 23, the gestures, history, selection toolbar and menus from rounds 24 and 25), delete what you replace, no new abstractions. Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**Your usage limit is tight, so the round is in two parts. Do Part A only, write its notes, commit, and stop.** Part B comes as a separate message in the same session.

Grove is now **30,801 lines** of TS/CSS/Rust (TS 23,791 of which 3,214 tests, CSS 3,865, Rust 3,145; scripts `*.mjs` 3,179), up 337 in round 25. Count lines from `rebuild/app` with:
```
for e in ts css rs mjs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## The feature
Cards can be added, moved, resized, colored and edited, and existing arrows display. **This round lets you draw and edit the arrows themselves**, the way Obsidian does. Groups editing, note-card editing and canvas search/backlinks come in round 27; do not start those here.

Observe Obsidian 1.14.4 yourself first (headless or private Xvfb, private HOME/profile, scratch vault, no network, as in rounds 24 and 25). Record: where the connection dots appear on a hovered or selected card and how they look, dragging from a dot to another card's side (and what happens when you drop on empty background), how the edge snaps to the nearest side, how an existing edge is selected (hit area, highlight), dragging an edge end to reconnect it, the toolbar or menu a selected edge shows (delete, color, line direction/arrowheads, label, zoom to selection) with order, icons and menus, how a label is added and edited (double-click), what Delete/Backspace does on a selected edge, and **exactly how Obsidian writes edges** (`id`, `fromNode`, `fromSide`, `toNode`, `toSide`, `fromEnd`/`toEnd`, `color`, `label`, key order, id format). Work only from observation, never from Obsidian's code, CSS or assets.

## Part A: create, select, reconnect and delete edges
1. Connection dots on card sides on hover/selection; drag from a dot to another card to create an edge, snapping to the side Obsidian picks. Matching Obsidian, decide what dropping on empty background does (if it opens a menu to add a card, do the smallest version of that or note it as left for later).
2. Click an edge to select it (a forgiving hit area along the path, Obsidian's highlight); Shift-click adds to a mixed card/edge selection; Delete/Backspace removes selected edges.
3. Drag either end of a selected edge to reconnect it to another card or side.
4. Every change is one undo step in the existing canvas history (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y and the redo button), and the file is saved in Obsidian's format.

## Part B: edge toolbar and labels (only when asked, after Part A)
1. The selection toolbar for a selected edge, with Obsidian's buttons, order, icons and menus: delete, set color ("1"–"6" or hex, as for cards), line direction (none / one-way / two-way via `fromEnd`/`toEnd`), edit label, zoom to selection. Reuse the round 25 toolbar and color menu; no animations.
2. Edge labels: add or edit by double-clicking the edge or the label (reuse the canvas text editing from round 24 or a plain input, whichever is smaller), shown centred on the path with Obsidian's look; an empty label removes the `label` key.

**Test with real mouse input**: CDP `Input` events with the pointer moved over each dot, edge and button before pressing, including repeated clicks without moving and a double-click on toolbar buttons (must not add a card), never DOM `.click()`. Also re-run the editor checks on notes with frontmatter in Live Preview, Source and Reading. Save a canvas changed by every new action and confirm it opens unchanged in Obsidian (round trip, as in round 24), with unknown fields and key order preserved. Write `rebuild/ROUND26_NOTES.md` (Part A, then append Part B) with what you observed, each commit, line counts, net line change by language (production TS, test TS, CSS, Rust, mjs), and up to 3 next improvements (each with why it matters and roughly how big).

## Round 25 suggestions
- **Canvas arrows: create, reconnect, label, delete** (Codex #1 and Grok #1, both): this round.
- **Index canvas text and links for search, backlinks and the graph** (Codex #2 and Grok #2, both): round 27, after arrows, together with group and note-card editing if it fits; otherwise round 28.
- **Edit groups and note cards on the board** (Codex #3 and Grok #3, both): round 27.

## Not this round (so they aren't lost)
- Groups and note-card editing, canvas indexing (round 27); round 28 is the next cleanup round; then Bases (`.base` table views of notes from their properties), over several rounds.
- Pasted images/files saved as attachments (its own small round, needs a backend write).
- Explorer-to-note link dragging; explorer multi-select and moving several files at once.
- Render only cards near the viewport: held until a board shows a measured cost.
- Explorer details (ANNOYANCES #20 rest), new-tab page (#21), focus/keyboard leftovers (#22 rest), small visual differences (#23), quick switcher listing attachments (#19 rest).

## Guardrails
- The smallest change that works; reuse existing code; delete dead code you find on the way. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines.
- Typing on the 5,000-line Big note and inside a 40-row table must be no slower than now; the 300-card / 400-edge canvas pan, zoom and drag must stay under 20ms per frame, including while an edge is being dragged.
- **Geometry.** Keep the permanent geometry suite (`scripts/test-geometry.mjs`) passing. Never space lines or widgets inside `.cm-content` with vertical margins (use padding): every direct child of `.cm-content` must keep zero vertical margin, and every rendered line's CodeMirror top must stay within 1px of its DOM top. Fold arrows must stay visible after stationary fold and unfold clicks.
- **No prompt, menu, popover or tooltip animations.** Ctrl+O, Ctrl+P, right-click menus and the canvas toolbar/menus must open within two frames with no frame over 20ms in the first 300ms.
- **File compatibility.** Canvases stay in Obsidian's `.canvas` JSON format: unknown fields and key order preserved, tab indentation as Obsidian writes it.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed or link-card previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look and feel is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private Xvfb display with scratch `HOME`/`XDG_*` folders.
- Commit locally only. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run test:geometry`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- Part A (then Part B) works with real pointer input, round-trips through Obsidian unchanged, and `rebuild/ROUND26_NOTES.md` has its notes and line counts.
