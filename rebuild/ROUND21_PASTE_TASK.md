# Task: Round 21, paste web rich text as Markdown, then three small fixes

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md` and `rebuild/ROUND20_NOTES.md` (round 20, as merged) first.

**Who builds.** Claude is out on its weekly limit until Oct 27, so you (Codex) are the builder. A bug hunter (Grok) will test your branch afterwards and confirmed bugs come back to you. Keep changes small: reuse what exists, delete what you replace, no new abstractions. Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**Your usage limit is tight, so the round is in two parts. Do Part A only, write its notes, commit, and stop.** Part B comes as a separate message in the same session.

Grove is now **29,317 lines** (TS 22,480 of which 3,047 tests, CSS 3,733, Rust 3,104; scripts `*.mjs` 1,513), up 307 in round 20 (same convention as before: tracked `*.ts`, `*.css`, `*.rs` under `rebuild/app`, excluding `/gen/`; `*.mjs` and JSON reported separately). Count lines from `rebuild/app` with:
```
for e in ts css rs mjs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## Part A: paste rich text from the web as Markdown (ANNOYANCES #5; Codex's and Grok's round 20 suggestion #3)
Today Ctrl+V of formatted text from a web page or document pastes only `text/plain`: bold, links, bullets and headings are lost and links lose their URLs. Obsidian (setting **Editor → Auto convert HTML**, on by default) converts the clipboard's `text/html` to Markdown. Observe Obsidian 1.14.4 yourself (headless, private HOME/profile, scratch vault, no network, as in round 20) by putting HTML on the clipboard and pasting, and match what it produces. Earlier observation: a paragraph `From a web page: <b>important</b> point, see <a href="https://example.com/doc">the docs</a>.` plus a two-item list and an `<h2>` became
```
From a web page: **important** point, see [the docs](https://example.com/doc).

- first
- second

## Heading
```

1. **Convert on paste** when the clipboard has `text/html` and the setting is on: `b/strong`, `i/em`, `s/del`, `code`, `pre` (fenced block, keep the language from a `language-xxx` class when present), `a` (`[text](href)`; bare URL when text equals href), `ul/ol/li` (nested, numbered from `start`), task-list checkboxes (`- [ ]` / `- [x]`), `h1`–`h6`, `blockquote` (nested `>`), `p`/`div`/`br`, `hr`, `img` (`![alt](src)`), and simple `table`s to a pipe table (Grove's table widget should then render it). Collapse whitespace like a browser; escape Markdown characters in plain text only where Obsidian does; drop `script`, `style`, comments, and Office/Google Docs wrapper junk (for example Google Docs' `<b style="font-weight:normal" id="docs-internal-guid-...">` wrapper must not make everything bold).
2. **No dependency.** Parse with `DOMParser` (an inert document: nothing loads, no scripts run, no images fetched) and walk the tree in one small module, e.g. `src/editor/htmlToMarkdown.ts` (well under 300 lines). Hook it into the existing paste path in `src/editor/clipboard.ts`; don't add a second paste handler.
3. **Offline.** Converting must never fetch anything. A pasted remote image stays as `![alt](https://...)` text and, as now, is not previewed (no remote embeds). The offline audit must still pass.
4. **Plain-text paste stays.** Ctrl+Shift+V still pastes plain text. When the HTML is just plain text (only `text/plain` meaning, e.g. copying from Grove or another code editor, or a single line with no markup), paste exactly the plain text so normal copy and paste inside Grove is unchanged. Pasting inside a code block or frontmatter pastes plain text.
5. **Setting.** Add the **Auto convert HTML** toggle in Settings → Editor (default on), reusing the existing settings plumbing.
6. **Undo.** One paste is one undo step, and the caret ends after the pasted text, as in Obsidian.
7. **Existing paste features still work**: pasting a URL over a selection still makes `[word](url)`; pasted images/files still go to attachments as now.

Tests (in `npm test`): unit tests for the converter (each element above, nesting, whitespace, Google Docs wrapper, Word-style `<o:p>`/`mso-` junk, a table, a remote image that stays text) and a browser test that dispatches a real paste with `text/html` + `text/plain` into a note **with frontmatter** in Live Preview and Source, and checks Reading shows the converted result. Note the exact Obsidian outputs you observed in the notes, and any case where Grove differs.

Write `rebuild/ROUND21_NOTES.md`: what you built, which existing code you reused, anything deferred and why, test results, net line change by language (production TS, test TS, CSS, Rust, mjs), and up to 3 next improvements (each with why it matters and roughly how big). Commit and stop.

## Part B: three small fixes (only when asked, after Part A)
Each in its own commit with a test:
1. **Folding near the end of a note moves the arrow away from the pointer** (from Grok's round 20 hunt). Scrolled to the bottom of a long note with frontmatter, folding a heading shortens the document, the scroll position is clamped, the heading jumps away from the pointer, and a second click without moving the mouse misses. First observe whether Obsidian keeps the heading under the pointer there (for example by allowing scrolling past the end). If it does, match it with the smallest change (padding, not margins, inside the scroller); if Obsidian behaves the same as Grove, write that in the notes and change nothing.
2. **Quick switcher details (ANNOYANCES #19).** Tab completes the selected name into the input; with an empty query show only recently opened files (most recent first, the current note not first), as Obsidian does. Files in `src/shell/quickSwitcher.ts` / `src/shell/switcherItems.ts`.
3. **Pasting a URL over a selection selects only the word (ANNOYANCES #22).** Grove makes `[word](url)` and leaves only "word" selected; Obsidian leaves the caret after the whole link. Match Obsidian.

Append Part B to `rebuild/ROUND21_NOTES.md` with final line counts.

## Round 20 suggestions
Codex and Grok both suggested the same three: paste rich text as Markdown (this round's Part A), dragging explorer rows into a note to insert a link, and multi-select in the explorer. The last two are held for a later round so this one stays small.

## Not this round (so they aren't lost)
- Drag a file from the explorer into a note to insert a link, or onto the tab bar to open it; explorer multi-select and moving several files at once.
- Round 22 is a cleanup round. Then Canvas, then Bases (Obsidian-compatible `.canvas` and `.base` files), each over several rounds.
- Link suggester details (#18), styled tooltips (#15), explorer details (#20, apart from Auto-reveal which round 20 added), new-tab page (#21), other focus/keyboard leftovers (#22), small visual differences (#23).

## Guardrails
- The smallest change that works; reuse existing code; delete dead code you find on the way. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines.
- Nothing new on the typing path; typing on the 5,000-line Big note and in a 40-row table must be no slower than now. The converter runs only on paste.
- **Geometry.** Keep the permanent geometry suite (`scripts/test-geometry.mjs`) passing. Never space lines or widgets inside `.cm-content` with vertical margins (use padding): every direct child of `.cm-content` must keep zero vertical margin, and every rendered line's CodeMirror top must stay within 1px of its DOM top. Fold arrows must stay visible after stationary fold and unfold clicks.
- **No prompt or menu animations.** Ctrl+O, Ctrl+P and right-click menus must keep opening within two frames with no frame over 20ms in the first 300ms.
- **Test with real mouse input**: CDP `Input` events with the pointer moved over each control before pressing, including repeated clicks without moving, never DOM `.click()`, on notes with frontmatter, in Live Preview, Source and Reading.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; bundle everything locally; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look and feel is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private Xvfb display with scratch `HOME`/`XDG_*` folders.
- Commit locally only. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test` (unit tests, the geometry suite and your new paste tests), `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- Part A's seven points work, and `rebuild/ROUND21_NOTES.md` has its notes, observed Obsidian outputs and line counts.
