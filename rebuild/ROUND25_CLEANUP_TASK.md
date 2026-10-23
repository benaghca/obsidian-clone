# Task: Round 25, cleanup round, then canvas controls and link heading/block suggestions

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/ROUND24_CANVAS_TASK.md` and `rebuild/ROUND24_NOTES.md` (round 24, as merged) first.

**Who builds.** Claude is out on its weekly limit until Oct 27, so you (Codex) are the builder. A bug hunter (Grok) will test your branch afterwards and confirmed bugs come back to you. Keep changes small: reuse what exists, delete what you replace, no new abstractions. Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**Your usage limit is tight, so the round is in two parts. Do Part A only, write its notes, commit, and stop.** Part B comes as a separate message in the same session.

Grove is now **30,464 lines** of TS/CSS/Rust (TS 23,469 of which 3,133 tests, CSS 3,850, Rust 3,145; scripts `*.mjs` 2,778), up 369 in round 24. Count lines from `rebuild/app` with:
```
for e in ts css rs mjs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## Part A: cleanup (every third round is a cleanup round)
Make the code smaller, simpler or faster **without changing behavior or looks**. Goal: a net cut in production TypeScript and CSS (aim for at least 250 lines), with every test still passing.
1. Delete dead code: unused exports, functions, CSS selectors nothing renders, leftover flags and comments describing removed behavior. Show how you checked each is unused.
2. Fold duplicates added in rounds 22–24 into existing helpers: the canvas code (`src/canvas/*`: pointer gestures in `view.ts`/`editing.ts`/`navigation.ts`, history checkpoints, card creation in `cards.ts`, JSON formatting in `document.ts`) against the shell's existing drag, prompt, menu and tooltip helpers; the link suggester vs the quick switcher's recent-files list; the tooltip helper vs any leftover `title` handling.
3. Test scripts: `scripts/*.mjs` grew to 2,778 lines (+850 since round 22). The canvas scripts (`test-canvas*.mjs`, `test-r23-bugs.mjs`, `test-r24-bugs.mjs`) repeat CDP/launch/fixture boilerplate; fold it into the shared helper from round 22 if that removes lines, keeping every check.
4. Keep every file under about 800 lines; `src/shell/pane.ts` (678), `src/workspace.ts` (644), `src/editor/livePreview.ts` (611), `src/graph/view.ts` (609) and `src/styles/settings.css` (602) are the largest. Split only if it removes code or makes a real seam.
5. CSS: merge rules that repeat the same values, remove overrides the base rule already gives, and keep the visual output identical (compare before/after screenshots of Welcome, Callouts/tables/embeds, a canvas with groups/edges/a selected card, the file explorer, Settings, the quick switcher and a tooltip in headless Chromium, and say they match).
6. Each cut is its own commit with a one-line reason. No new features, no new dependencies.

Write `rebuild/ROUND25_NOTES.md` with each commit, lines saved, the before/after screenshot check, and net line change by language (production TS, test TS, CSS, Rust, mjs). Commit and stop.

## Part B: two small features (only when asked, after Part A)
Each in its own commit with a test. Observe Obsidian 1.14.4 yourself first (headless, private HOME/profile, scratch vault, no network, as in round 24):
1. **Canvas controls Obsidian has and Grove lacks** (seen side by side at the round 24 merge). (a) The small floating toolbar above a selected card (delete, set color, zoom to selection, edit), with Obsidian's order, icons, spacing and menus; the color menu writes Obsidian's `color` values ("1"–"6" or hex). (b) In the right-hand control stack, the extra groups Obsidian shows: canvas settings, undo/redo (wired to the existing canvas history, disabled when there's nothing to undo/redo), and help. Reuse the existing menu, tooltip and Lucide icon helpers; no animations.
2. **Heading and block suggestions in links (Grok's held suggestion).** After `[[Note#` the link suggester lists that note's headings (and `[[#` the current note's); after `[[Note^` (or `[[Note#^`) it lists blocks and, on accept, adds a `^id` to that block if it has none, the way Obsidian does. Reuse `src/editor/wikilinkComplete.ts` and the existing heading index; observe Obsidian's ranking, labels and inserted text and match them.

**Test with real mouse input**: CDP `Input` events with the pointer moved over each control before pressing, including repeated clicks without moving, never DOM `.click()`, on notes with frontmatter, in Live Preview, Source and Reading, and on canvases. Save a canvas changed by the new toolbar and confirm it opens unchanged in Obsidian (round-trip, as in round 24). Append Part B to `rebuild/ROUND25_NOTES.md` with final line counts and up to 3 next improvements (each with why it matters and roughly how big).

## Round 24 suggestions
- **Index canvas text and links for search, backlinks and the graph** (Codex #1 and Grok #1, both): planned for round 27 with group and note-card editing, after arrows in round 26. Too big for a cleanup round.
- **Edge, group and note-card editing in small rounds** (Codex #2 and Grok #2, both): that is the plan: round 26 arrows (create, reconnect, label, delete), round 27 groups and note cards.
- **Render only cards near the viewport** (both #3): held until a board shows a measured cost; 300 cards still drag under 20ms.

## Not this round (so they aren't lost)
- Canvas arrows (round 26), groups, note-card editing and canvas indexing (round 27), then Bases (`.base` table views of notes from their properties), each over several rounds.
- Pasted images/files saved as attachments (its own small round, needs a backend write).
- Explorer-to-note link dragging; explorer multi-select and moving several files at once.
- Explorer details (ANNOYANCES #20 rest), new-tab page (#21), focus/keyboard leftovers (#22 rest), small visual differences (#23), quick switcher listing attachments (#19 rest).

## Guardrails
- The smallest change that works; reuse existing code; delete dead code you find on the way. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines.
- Typing on the 5,000-line Big note and inside a 40-row table must be no slower than now, and the 300-card canvas drag must stay under 20ms per frame.
- **Geometry.** Keep the permanent geometry suite (`scripts/test-geometry.mjs`) passing. Never space lines or widgets inside `.cm-content` with vertical margins (use padding): every direct child of `.cm-content` must keep zero vertical margin, and every rendered line's CodeMirror top must stay within 1px of its DOM top. Fold arrows must stay visible after stationary fold and unfold clicks.
- **No prompt, menu, popover or tooltip animations.** Ctrl+O, Ctrl+P, right-click menus and the new canvas toolbar/menus must open within two frames with no frame over 20ms in the first 300ms.
- **File compatibility.** Canvases stay in Obsidian's `.canvas` JSON format: unknown fields and key order preserved, tab indentation as Obsidian writes it.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed or link-card previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look and feel is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private Xvfb display with scratch `HOME`/`XDG_*` folders.
- Commit locally only. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- Part A cuts lines with no visible change, and `rebuild/ROUND25_NOTES.md` has its notes and line counts.
