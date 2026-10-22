# Task: Round 18, link hover previews, then finding and clicking quick wins

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md` and `rebuild/ROUND17_NOTES.md` plus `rebuild/ROUND17_FIXES.md` (round 17, as merged) first.

**Who builds.** Claude is out on its weekly limit until Oct 27, so you (Codex) are the builder again. A bug hunter (Grok) will test your branch afterwards and confirmed bugs come back to you. There is no separate trim pass, so **keep your own changes small**: reuse what exists, delete what you replace, no new abstractions. Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**Your usage limit is tight, so the round is in two parts. Do Part A only, write its notes, commit, and stop.** Part B comes as a separate message in the same session.

Grove is now **28,124 lines** (TS 21,448 of which 2,585 tests, CSS 3,572, Rust 3,104). Count lines from `rebuild/app` with:
```
for e in ts css rs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## Part A: link hover previews (Obsidian's Page preview)
Today hovering an internal link shows nothing. In Obsidian a popover shows the target note so you can check a link without leaving the sentence. Suggested by Grok in round 17 and on the owner's hands-on list (ANNOYANCES #4).
1. In Live Preview and Source mode, **Ctrl (Cmd on macOS) + hover** over a `[[link]]` or `[text](note.md)` opens a popover of the target note after a short delay. In Reading view, plain hover opens it (as Obsidian does by default). Links in the Backlinks and Search panes open it on Ctrl+hover too, if that stays small.
2. The popover shows the note rendered read-only (reuse the note-embed renderer in `src/editor/embeds.ts`, `NoteEmbedWidget`, rather than writing a new one). `[[note#heading]]` scrolls to that heading; `[[note#^block]]` to that block. A missing note shows a short "not created yet" line, never an error.
3. Size and placement like Obsidian: about 450×400 max, below the link (above if there's no room), kept inside the window, scrollable, with the usual popover radius and shadow. Moving the pointer from the link into the popover keeps it open; leaving both closes it after a short delay; Escape closes it; clicking a link inside it opens that note; scrolling the note or typing closes it.
4. Only one popover at a time, nothing on the per-keystroke path, and no work until a hover actually starts. Purely local: never fetch anything; external `http` links get **no** preview.

**Test with real mouse input**, not scripted `.click()` calls: move the pointer onto the link with Ctrl held, wait, move into the popover, scroll it, move out. Compare side by side with Obsidian on the same notes (headless Chromium for Grove), and put screenshots in the notes. Add small tests for target resolution (heading, block, missing note) and open/close timing.

Finish Part A by writing `rebuild/ROUND18_NOTES.md` (what was built, what differs from Obsidian, net line change by language, any new module and why) and committing. Then stop.

## Part B: finding and clicking quick wins (only when asked, after Part A)
From the owner's hands-on list (`ANNOYANCES` numbers), each in its own commit with a test:
1. **Obsidian-style find bar (#1, second half).** Round 17 fixed focus and the count, but the panel is still CodeMirror's stock form at the bottom. Restyle it as a compact bar at the top of the note: input with the "1 / 6" count inside, previous/next arrow buttons, a replace toggle, match-case/regex toggles as small icon buttons, Lucide icons. Keep CodeMirror's search logic; this is placement and CSS, not a new search.
2. **Clickable tags (#10).** Clicking `#tag` in Live Preview or Reading view opens Search with `tag:#tag`. The hook exists (`searchTag` in `src/main.ts`); it only needs a click handler on `.cm-tag`. Clicking with the caret already inside the tag text in Live Preview still edits it, as in Obsidian.
3. **Search results show the match (#9).** Clicking a hit in the Search pane opens the note scrolled to the match with the matched text selected, not just the start of the line. Snippets wrap to show the surrounding text instead of being cut to one line.
4. **Clicking an embed (#11).** Clicking the text of an embedded note in Live Preview moves the caret to the embed's `![[…]]` line (revealing its source) instead of leaving focus stuck in the widget.
5. **Reading-view spacing (Grok's round 17 suggestion #1), CSS only if it stays small.** Under `.is-reading-mode`, match Obsidian's preview: H1 about 31px with no top padding, and heading/paragraph gaps as margins. If doing it right needs a separate preview document, skip it and say so in the notes.

Append Part B to `rebuild/ROUND18_NOTES.md` with the final line counts.

## Not this round (so they aren't lost)
- Drag files and folders in the explorer (ANNOYANCES #6, Grok's round 17 suggestion #3): its own round after the round 19 cleanup.
- Reading view as a separate preview document, if Part B item 5 shows it's needed.
- Rich-text paste converted to Markdown (#5), and rename errors shown under the title (#12).
- Linked tabs remembered across restarts and complete search counts for common terms (Codex's round 16 suggestions).

## Guardrails
- The smallest change that works; reuse existing code; delete dead code you find on the way. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines (today none in `src/` is over 650).
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
- Part A works with real-mouse checks beside Obsidian, and `rebuild/ROUND18_NOTES.md` has its notes and line counts.
