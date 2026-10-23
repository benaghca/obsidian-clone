# Task: Round 19, cleanup round, then four small fixes

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/ROUND18_NOTES.md` and `rebuild/ROUND18_FIXES.md` (round 18, as merged) first.

**Who builds.** Claude is out on its weekly limit until Oct 27, so you (Codex) are the builder. A bug hunter (Grok) will test your branch afterwards and confirmed bugs come back to you. Keep changes small: reuse what exists, delete what you replace, no new abstractions. Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**Your usage limit is tight, so the round is in two parts. Do Part A only, write its notes, commit, and stop.** Part B comes as a separate message in the same session.

Grove is now **28,665 lines** (TS 21,863 of which 2,742 tests, CSS 3,698, Rust 3,104), up 541 in round 18. Count lines from `rebuild/app` with:
```
for e in ts css rs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## Part A: cleanup (every third round is a cleanup round)
Make the code smaller, simpler or faster **without changing behavior or looks**. Goal: a net cut in production TypeScript and CSS (aim for at least 300 lines), with every test still passing.
1. Delete dead code: unused exports, functions, CSS selectors nothing renders, leftover flags and comments describing removed behavior. Show how you checked each is unused.
2. Fold duplicates added in rounds 16–18 (hover previews, find bar, table cells, search/backlink snippets, embed clicks) into the existing helpers where two places do the same thing.
3. Keep every file under about 800 lines; `src/shell/pane.ts` (649), `src/workspace.ts` (642), `src/editor/livePreview.ts` (610) and `src/graph/view.ts` (609) are the largest. Split only if it removes code or makes a real seam, not for its own sake.
4. CSS: merge rules that repeat the same values, remove overrides that the base rule already gives, and keep the visual output identical (compare before/after screenshots of Welcome, Callouts/tables/embeds, Search, the find bar and a hover preview in headless Chromium, and say they match).
5. Each cut is its own commit with a one-line reason. No new features, no new dependencies.

Write `rebuild/ROUND19_NOTES.md` with each commit, lines saved, the before/after screenshot check, and net line change by language. Commit and stop.

## Part B: four small fixes (only when asked, after Part A)
From the owner's hands-on list (`ANNOYANCES` numbers), each in its own commit with a test:
1. **Hover preview title and size (#24, new).** Obsidian's popover starts with the note's title as a large heading and an expand (open) icon top-right, and shrinks to fit a short note (a three-line note is about 452×220); Grove shows only the body in a fixed 450×400 box. Add the title, keep 400px as the max height, and let short notes shrink.
2. **Rename errors (#12, Grok's round 18 follow-up).** An invalid or clashing name in the inline title or explorer rename shows a short error line under the field (as Obsidian does) instead of failing silently or dropping characters.
3. **Tab / Shift+Tab renumber numbered lists (#13).** Indenting or outdenting an ordered item renumbers that list and its new sublist like Obsidian.
4. **Backspace at the start of a list item (#14).** Match Obsidian: the first Backspace removes the bullet/number (keeping the indent), the next one outdents or joins the line above.

**Test with real mouse input** (hover first, then click), not scripted `.click()` calls, and compare side by side with Obsidian. Append Part B to `rebuild/ROUND19_NOTES.md` with final line counts.

## Not this round (so they aren't lost)
- Drag files and folders in the explorer (ANNOYANCES #6, Grok's round 17 and 18 suggestion #1): round 20.
- Rich-text paste converted to Markdown (#5, Grok's round 18 suggestion #3): after round 20.
- Reading view as a separate preview document (Grok's round 18 suggestion #2): large; only when the spacing gap is worth it.
- Linked tabs remembered across restarts and complete search counts for common terms (Codex's round 16 suggestions).

## Guardrails
- The smallest change that works; reuse existing code; delete dead code you find on the way. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines.
- Typing on the 5,000-line Big note and inside a 40-row table must be no slower than now. Nothing new on the per-keystroke path.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look and feel is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private Xvfb display with scratch `HOME`/`XDG_*` folders.
- Commit locally only. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- Part A cuts lines with no visible change, and `rebuild/ROUND19_NOTES.md` has its notes and line counts.
