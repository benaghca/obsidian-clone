# Task: Round 22, cleanup round, then three small fixes

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md` and `rebuild/ROUND21_NOTES.md` (round 21, as merged) first.

**Who builds.** Claude is out on its weekly limit until Oct 27, so you (Codex) are the builder. A bug hunter (Grok) will test your branch afterwards and confirmed bugs come back to you. Keep changes small: reuse what exists, delete what you replace, no new abstractions. Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**Your usage limit is tight, so the round is in two parts. Do Part A only, write its notes, commit, and stop.** Part B comes as a separate message in the same session.

Grove is now **29,542 lines** (TS 22,705 of which 3,054 tests, CSS 3,733, Rust 3,104; scripts `*.mjs` 1,928), up 225 in round 21. Count lines from `rebuild/app` with:
```
for e in ts css rs mjs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## Part A: cleanup (every third round is a cleanup round)
Make the code smaller, simpler or faster **without changing behavior or looks**. Goal: a net cut in production TypeScript and CSS (aim for at least 300 lines), with every test still passing.
1. Delete dead code: unused exports, functions, CSS selectors nothing renders, leftover flags and comments describing removed behavior. Show how you checked each is unused.
2. Fold duplicates added in rounds 19–21 into existing helpers where two places do the same thing: explorer drag and drop vs tab drag (`src/shell/tabDrag.ts`), the breadcrumb/view header, the paste paths (`src/editor/clipboard.ts`, `src/editor/htmlToMarkdown.ts`, the table cell editor), the shared prompt / quick switcher, and hover previews.
3. Test scripts: `scripts/*.mjs` grew to 1,928 lines. Fold repeated CDP/launch/fixture boilerplate in the `test-*.mjs` scripts into one small shared helper if that removes lines, keeping every check.
4. Keep every file under about 800 lines; `src/shell/pane.ts` (664), `src/workspace.ts` (642), `src/editor/livePreview.ts` (610), `src/graph/view.ts` (609) and `src/styles/settings.css` (603) are the largest. Split only if it removes code or makes a real seam, not for its own sake.
5. CSS: merge rules that repeat the same values, remove overrides that the base rule already gives, and keep the visual output identical (compare before/after screenshots of Welcome, Callouts/tables/embeds, the file explorer during a drag, the view header with a long breadcrumb, Settings, the quick switcher and a hover preview in headless Chromium, and say they match).
6. Each cut is its own commit with a one-line reason. No new features, no new dependencies.

Write `rebuild/ROUND22_NOTES.md` with each commit, lines saved, the before/after screenshot check, and net line change by language (production TS, test TS, CSS, Rust, mjs). Commit and stop.

## Part B: three small fixes (only when asked, after Part A)
Each in its own commit with a test. Observe Obsidian 1.14.4 yourself first (headless, private HOME/profile, scratch vault, no network, as in round 21):
1. **`[[` link suggester (ANNOYANCES #18).** Obsidian lists recently opened notes first, includes attachments (photo.png, diagram.svg) and unresolved link targets, shows folders as `Projects/`, and its popup is wide enough that the "Type # to link heading · Type ^ to link blocks · Type | to change display text" hint stays on one line. Match it in `src/editor/wikilinkComplete.ts`, reusing the quick switcher's recent-files list.
2. **Styled tooltips (ANNOYANCES #15).** Ribbon, toolbar and header buttons show the browser's native `title` tooltip. Obsidian shows a small styled tooltip centred under (or beside) the button, with an arrow, after a short delay, and no fade or slide-in animation is needed. One small hover helper driven by `aria-label` in `src/shell/dom.ts`; replace the `title` attributes it covers.
3. **Paste parity (Grok's round 21 suggestions #1 and #3).** (a) A Word list item whose only marker is an `mso-list:Ignore` span keeps its number, as Obsidian does (`1.` then the item). (b) Parentheses in HTML link destinations are escaped with backslashes (`a\(b\)`) like Obsidian instead of percent-encoded. Update the converter fixtures.

**Test with real mouse input**: CDP `Input` events with the pointer moved over each control before pressing, including repeated clicks without moving, never DOM `.click()`, on notes with frontmatter, in Live Preview, Source and Reading. Append Part B to `rebuild/ROUND22_NOTES.md` with final line counts and up to 3 next improvements (each with why it matters and roughly how big).

## Round 21 suggestions
- **Save pasted clipboard images and files as attachments** (Codex #1 and Grok #2, both). Today a PNG on the clipboard falls through to its plain text because there's no byte-writing backend command. Medium (backend write, attachment path, offline rule), so it's held for its own small round rather than squeezed into cleanup.
- **Google Docs span bold/italic** (Codex #2): already done in round 21's bug fixes.
- **Drag an explorer row into a note to insert a link** (Codex #3): held, as in round 20.
- **Word list numbers** and **backslash escapes for parentheses** (Grok #1 and #3): Part B item 3 above.

## Not this round (so they aren't lost)
- Pasted images/files saved as attachments (above).
- Explorer-to-note link dragging; explorer multi-select and moving several files at once.
- Canvas, then Bases (Obsidian-compatible `.canvas` and `.base` files), each over several rounds, starting after this round.
- Explorer details (#20 rest), new-tab page (#21), other focus/keyboard leftovers (#22 rest: Esc from Settings focus, window title, Ctrl+Enter, Back caret), small visual differences (#23), quick switcher listing attachments (#19 rest).

## Guardrails
- The smallest change that works; reuse existing code; delete dead code you find on the way. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines.
- Typing on the 5,000-line Big note and inside a 40-row table must be no slower than now. Nothing new on the per-keystroke path.
- **Geometry.** Keep the permanent geometry suite (`scripts/test-geometry.mjs`) passing. Never space lines or widgets inside `.cm-content` with vertical margins (use padding): every direct child of `.cm-content` must keep zero vertical margin, and every rendered line's CodeMirror top must stay within 1px of its DOM top. Fold arrows must stay visible after stationary fold and unfold clicks.
- **No prompt, menu or tooltip animations.** Ctrl+O, Ctrl+P and right-click menus must keep opening within two frames with no frame over 20ms in the first 300ms.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look and feel is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private Xvfb display with scratch `HOME`/`XDG_*` folders.
- Commit locally only. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- Part A cuts lines with no visible change, and `rebuild/ROUND22_NOTES.md` has its notes and line counts.
