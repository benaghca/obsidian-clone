# Task: Round 24, Canvas part 2: select, move, resize, add and delete cards, and save

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/ROUND23_CANVAS_TASK.md` and `rebuild/ROUND23_NOTES.md` (round 23, as merged, including its Stage 3 fixes) first. The canvas view lives in `src/canvas/`.

**Who builds.** You are the builder for this round. A bug hunter will test your branch afterwards and confirmed bugs come back to you. Keep changes small: reuse what exists (the round 23 parser, renderer, pan/zoom transform and gestures), no speculative abstractions. Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**If you are Codex, your usage limit is tight, so the round is in two parts. Do Part A only, write its notes, commit, and stop.** Part B comes as a separate message in the same session. Any other builder does A then B in one go.

Grove is now **30,095 lines** (TS 23,128 of which 3,133 tests, CSS 3,822, Rust 3,145; scripts `*.mjs` 2,441), up 495 in round 23. Count lines from `rebuild/app` with:
```
for e in ts css rs mjs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## The feature
Round 23 made canvases open read-only with pan and zoom. **This round makes cards editable in place: select, move, resize, add and delete, and save the file** so it still opens in Obsidian exactly. Arrows (creating/editing edges), groups editing, editing note cards and canvas search/backlinks come in later rounds; do not start those here.

Observe Obsidian 1.14.4 yourself first (private Xvfb, private HOME/profile, scratch vault, no network, as in round 23). Record: how a card shows selection (outline, handles), click vs Shift-click vs drag-box on empty background, how dragging moves cards (snap to grid? which step? Alt/Shift modifiers?), the resize handles and minimum card size, what Delete/Backspace removes (and that edges to a deleted card go too), what double-click on empty background does, the bottom toolbar (its buttons, order, tooltips, and what each adds), and **exactly how Obsidian writes the file after an edit** (indentation, one node per line, key order, number formatting, ids it generates, trailing newline). Work only from observation, never from Obsidian's code, CSS or assets.

## Part A: select, move, resize, delete, save
1. Click a card to select it (Obsidian's selection outline and resize handles); Shift-click to add/remove; click empty background to clear; drag on empty background draws a selection box if Obsidian does. Arrow-key nudging only if Obsidian has it. Clicking a wikilink or task box inside a card still behaves as in round 23.
2. Drag selected cards to move them (with Obsidian's snapping), and drag the handles to resize (Obsidian's minimum size). Edges follow live. Moving a group moves the cards inside it the way Obsidian does (observe).
3. Delete/Backspace removes the selected cards and any edges attached to them.
4. **Saving:** write the file only after a real change, debounced like note saves, through the existing write path (no new Rust command unless needed). Write it the way Obsidian does (observed format), and **keep every field and node Grove doesn't understand, in its original order**. A canvas you only open, pan or zoom must stay byte-identical. External changes to the file reload the board like notes do.
5. Undo/redo (Ctrl+Z / Ctrl+Shift+Z) for move, resize and delete, if Obsidian supports them on canvas (it does in 1.14 per its undo/redo controls; confirm).

Write `rebuild/ROUND24_NOTES.md` with what you observed, each commit, Grove/Obsidian screenshots of the same edit, a round-trip check (edit in Grove, open in Obsidian scratch vault, and the reverse), and net line change by language. Commit and stop.

## Part B: add cards (only when asked, after Part A, if you are Codex)
1. Double-click empty background adds a text card where Obsidian puts it (observe size and placement) and starts editing it.
2. The bottom toolbar, matching Obsidian's buttons, order, icons (bundled Lucide) and instant tooltips: add a text card; add a note from the vault (reuse the quick switcher as the picker); add media from the vault (images/SVG only; reuse the attachment picker if one exists). No drag-to-board from outside the app.
3. Editing a text card's text: double-click a text card to edit its Markdown in place with the existing editor setup (keep it minimal; Escape or clicking away ends editing and saves). Editing note (file) cards stays out of scope.
Append Part B to `rebuild/ROUND24_NOTES.md` with final line counts and up to 3 next improvements (each with why it matters and roughly how big).

**Test with real mouse input**: CDP `Input` events with the pointer moved over each card, handle and control before pressing, real drags with intermediate moves, and repeated clicks without moving, never DOM `.click()`. Also re-check notes with frontmatter in Live Preview, Source and Reading so nothing regressed there. Moving a card on the 300-card fixture must keep frames under 20ms.

## Round 23 suggestions (Grok)
- **Add, drag and resize cards and save without dropping unknown fields** (Grok). This is this round.
- **Index canvas card text and wikilinks for search, backlinks and the graph** (Grok). Good fit, but medium-sized; held for the next Canvas round (arrows and groups) so this round stays small for the builder's limit.
- **Skip Markdown rendering for cards far from the viewport** (Grok). Held until a real board gets slow; the 300-card fixture is already under budget.

## Not this round (so they aren't lost)
- Canvas part 3: creating and editing arrows, editing groups and note cards, canvas text in search/backlinks. Then Bases (`.base` table views from properties), over several rounds, and the ribbon's "Create new base" once Bases exists.
- Pasted images/files as attachments; `#`/`^` heading and block suggestions in `[[`; explorer-to-note link dragging; explorer multi-select.
- Explorer details (#20 rest), new-tab page (#21), focus/keyboard leftovers (#22 rest), small visual differences (#23), quick switcher listing attachments (#19 rest).

## Guardrails
- The smallest change that works; reuse existing code (canvas parser/renderer, transform, tooltip helper, menus, quick switcher, editor setup); delete dead code you find on the way. Any new dependency needs a written reason (prefer none; no canvas or graph libraries). Files stay under about 800 lines.
- Typing on the 5,000-line Big note and inside a 40-row table must be no slower than now. Nothing new on the per-keystroke path of notes.
- **Geometry.** Keep the permanent geometry suite (`scripts/test-geometry.mjs`) passing. Never space lines or widgets inside `.cm-content` with vertical margins (use padding): every direct child of `.cm-content` must keep zero vertical margin, and every rendered line's CodeMirror top must stay within 1px of its DOM top. Fold arrows must stay visible after stationary fold and unfold clicks.
- **No prompt, menu or tooltip animations.** Ctrl+O, Ctrl+P and right-click menus must keep opening within two frames with no frame over 20ms in the first 300ms. Card moves and resizes follow the pointer directly; don't add easing Obsidian doesn't have.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed or link-card previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look and feel is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri or Obsidian run happens only on a private Xvfb display with scratch `HOME`/`XDG_*` folders.
- Commit locally only. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- A canvas edited in Grove opens in Obsidian with the same layout, a canvas edited in Obsidian opens in Grove the same, unknown fields survive, and an unedited canvas stays byte-identical. `rebuild/ROUND24_NOTES.md` has the notes, screenshots and line counts.
