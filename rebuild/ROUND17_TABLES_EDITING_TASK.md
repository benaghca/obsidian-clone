# Task: Round 17, in-place table cell editing, then editing quick wins

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md` and `rebuild/CLEANUP4_NOTES.md` (round 16, as merged) first.

**Who builds.** Claude is out on its weekly limit until Oct 27, so you (Codex) are the builder this round. A bug hunter (Grok) will test your branch afterwards and confirmed bugs come back to you. There is no separate trim pass, so **keep your own changes small**: reuse what exists, delete what you replace, no new abstractions. Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**Your usage limit is tight, so the round is in two parts. Do Part A only, write its notes, commit, and stop.** Part B comes as a separate message in the same session.

Grove is now **27,461 lines** (TS 20,816 of which 2,306 tests, CSS 3,541, Rust 3,104). Count lines from `rebuild/app` with:
```
for e in ts css rs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## Part A: tables are edited in place (the owner's request)
Today clicking a rendered table in Live Preview swaps it for raw pipe syntax, so the layout jumps. In Obsidian the table **stays drawn** and you edit each cell's text right inside the cell.
1. Clicking a cell puts a caret in that cell's text; the table keeps its borders, widths and header style. Inline markdown inside the cell (bold, links, code) is shown rendered except in the cell being edited, like the rest of Live Preview.
2. Tab / Shift+Tab move to the next / previous cell (Tab in the last cell adds a row, as today); Enter moves to the cell below (adds a row at the end); arrow keys leave the cell at its edges; Escape or clicking outside leaves the table.
3. Typing `|` in a cell is escaped (`\|`) so it can't break the table. Column alignment and the pipe-padding Grove writes today stay byte for byte the same for unchanged cells.
4. The table's existing menu, row/column actions and checkbox ticking keep working. Source mode is unchanged (raw text). Reading view is unchanged.
5. Undo/redo works per edit, and the caret lands back in the same cell.
6. Start from `src/editor/tables.ts` and the table widget in `src/editor/livePreview.ts`; the smallest approach wins (for example, a nested editable per cell or mapping cell DOM to document ranges). Explain your choice in the notes.

**Test with real mouse input**, not scripted `.click()` calls: move the pointer over a cell, then press and release; drag-select inside a cell; hover the table's controls before clicking them. Compare side by side with Obsidian on the same note (headless Chromium for Grove), and put before/after screenshots in the notes. Add small tests for Tab/Enter navigation, the `|` escape, and undo.

Finish Part A by writing `rebuild/ROUND17_NOTES.md` (what was built, what differs from Obsidian, net line change by language, any new module and why) and committing. Then stop.

## Part B: editing quick wins (only when asked, after Part A)
From the owner's hands-on list (`ANNOYANCES` numbers), each in its own commit with a test:
1. **Ctrl+F focuses the find box** instead of typing into the note, and shows a match count (e.g. "1 / 6"); Enter steps through matches, Escape closes and leaves the match selected. Cause: `src/appCommands.ts` (~211-220) refocuses the editor right after `openSearchPanel`. Fix the focus first; a compact top-of-note bar styled like Obsidian's only if it stays small.
2. **Home in a list item, task or quote** goes to just after the marker (`- `, `- [ ] `, `1. `, `> `); a second Home goes to column 0. Shift+Home selects the same way.
3. **Focus after Ctrl+E**: going to Reading view and back leaves the caret where it was, focused, so typing works. In Reading view, Enter in the inline title commits the rename.
4. **Consistent auto-pairing**: `"`, `` ` `` and `*` pair like Obsidian; typing `"` (or a bracket) with a selection wraps it instead of replacing it. Typing a code fence and Enter adds the closing fence. See `src/editor/config.ts` (`closeBrackets`, `markdownPairs`).
5. **Ctrl+B / Ctrl+I / Ctrl+/ with the caret inside a word** format the whole word and keep the caret in place (`toggleWrap()` in `src/editor/format.ts`).
6. Grok's round 16 suggestions, if they stay small: **Source-mode headings at their real sizes** (Obsidian keeps H1 at 25.888px / weight 700 and H2 at 23.392px / weight 680 on the raw line, no extra top padding), and **clicks on the left edge of a rendered bold word** landing inside the hidden `**` (clamp the position past the leading marks).

Append Part B to `rebuild/ROUND17_NOTES.md` with the final line counts.

## Not this round (so they aren't lost)
- Reading view as a separate preview document with Obsidian's spacing (Grok's suggestion; medium).
- Link hover previews, and file drag-and-drop in the explorer: their own later rounds.
- Linked tabs remembered across restarts and complete search counts for common terms (Codex's round 16 suggestions).

## Guardrails
- The smallest change that works; reuse existing code; delete dead code you find on the way. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines (today none in `src/` is over 650).
- Typing on the 5,000-line Big note and inside a 40-row table must be no slower than now. Nothing new on the per-keystroke path outside tables.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look and feel is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private Xvfb display with scratch `HOME`/`XDG_*` folders.
- Commit locally only. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- Part A works with real-mouse checks beside Obsidian, and `rebuild/ROUND17_NOTES.md` has its notes and line counts.
