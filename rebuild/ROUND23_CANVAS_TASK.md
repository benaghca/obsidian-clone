# Task: Round 23, Canvas part 1: open, display, pan and zoom

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md` and `rebuild/ROUND22_NOTES.md` plus `rebuild/ROUND22_FIXES.md` (round 22, as merged) first.

**Who builds.** You are the builder for this round. A bug hunter will test your branch afterwards and confirmed bugs come back to you. Keep changes small: reuse what exists, no speculative abstractions. Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**If you are Codex, your usage limit is tight, so the round is in two parts. Do Part A only, write its notes, commit, and stop.** Part B comes as a separate message in the same session. Any other builder does A then B in one go.

Grove is now **29,600 lines** (TS 22,720 of which 3,090 tests, CSS 3,746, Rust 3,134; scripts `*.mjs` 2,120), up 58 in round 22. Count lines from `rebuild/app` with:
```
for e in ts css rs mjs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## The feature
Obsidian's **Canvas** is an infinite board of cards (text cards, note/file cards, link cards and groups) joined by arrows, saved as a `.canvas` file: JSON with a `nodes` array (`id`, `type` of `text`/`file`/`link`/`group`, `x`, `y`, `width`, `height`, optional `color`, plus `text`, `file` (+ optional `subpath`), `url`, or `label` by type) and an `edges` array (`id`, `fromNode`, `toNode`, optional `fromSide`/`toSide` of `top`/`right`/`bottom`/`left`, `fromEnd`/`toEnd` of `none`/`arrow`, `color`, `label`). This is the public JSON Canvas format; canvases must open in **both** Grove and Obsidian, and Grove must never drop or reorder fields it does not understand.

Canvas is split across several rounds: **this round is read-only display, pan and zoom.** Adding, moving and resizing cards comes next round; arrows editing, groups and editing note cards after that. Do not start those here.

Observe Obsidian 1.14.4 yourself first (headless or private Xvfb, private HOME/profile, scratch vault, no network, as in rounds 21 and 22). Build a scratch canvas in it with each card type, colors (preset `"1"`–`"6"` and a hex), a group with a label, and edges with every side/end combination and a label, then save screenshots and measurements: card radius, border, shadow, the background dot grid at several zoom levels, edge curve shape, arrowheads, label pills, group label position, the zoom controls on the right and their order, min/max zoom, and what wheel, Ctrl+wheel, Space+drag, middle-drag and the zoom-to-fit shortcut do. Work only from observation, never from Obsidian's code, CSS or assets.

## Part A: open and display
1. `.canvas` files show in the file explorer (with Obsidian's canvas icon equivalent from bundled Lucide), the quick switcher and `[[` suggester (as attachments), and open in a tab with the normal view header and breadcrumb. Opening a canvas never rewrites the file. Rust: list and read `.canvas` like other vault files; no new commands unless needed.
2. A new `src/canvas/` view (keep each file under about 800 lines) that renders the board with plain DOM/SVG: the dot grid background, text cards (Markdown rendered with the existing Reading renderer, including wikilinks that open on click), file cards (a note's rendered content, or an image/SVG attachment; `subpath` scrolls to that heading), link cards (show the URL as text only; **no fetching, no iframe, no preview**; opening it needs an explicit click through the system opener), groups with their label, card colors, and edges as curves with arrowheads and label pills matching Obsidian.
3. Malformed or empty files (`{}`, empty file, unknown node types, missing fields) show what they can without crashing; unknown nodes are skipped on screen but kept in the file.
4. Command palette: "Create new canvas" (and the explorer's New canvas entry, matching Obsidian's placement) creates `Untitled.canvas` (then `Untitled 1.canvas` …) with exactly what Obsidian writes for a new empty canvas (observe it).

Write `rebuild/ROUND23_NOTES.md` with what you observed, each commit, screenshots of Grove and Obsidian on the same scratch canvas, and net line change by language. Commit and stop.

## Part B: pan and zoom (only when asked, after Part A, if you are Codex)
1. Pan with wheel/trackpad scroll, Space+drag and middle-drag; zoom with Ctrl+wheel (around the pointer) and the zoom controls (zoom in, zoom out, reset, zoom to fit, matching Obsidian's control set and order). Match Obsidian's min/max zoom and its zoom-to-fit-on-open. Respect the existing tooltip helper for the controls (no animation).
2. Smooth on a 300-card, 400-edge canvas (generate it as a fixture): pan and zoom frames under 20ms in headless Chromium; transform one container rather than re-laying out cards. Cards far off screen may skip rendering their Markdown until near the viewport.
3. Remember each canvas's viewport per tab session like Obsidian does (observe whether it persists across reopen).
Append Part B to `rebuild/ROUND23_NOTES.md` with final line counts and up to 3 next improvements (each with why it matters and roughly how big).

**Test with real mouse input**: CDP `Input` events with the pointer moved over each control before pressing, including repeated clicks without moving, never DOM `.click()`. Also re-check notes with frontmatter in Live Preview, Source and Reading so nothing regressed there.

## Round 22 suggestions
- **Save pasted clipboard images and files as attachments** (Codex and Grok, both). Held for its own small round after Canvas part 1, as before.
- **Heading and block suggestions after `#` and `^`** in the `[[` suggester (Grok). Good fit; held for the round after this so Canvas gets the full round.
- **Drag an explorer row into a note to insert a link** (Grok). Held.
- Codex's other two (escaped link targets in indexes/renames, identical-frontmatter replacement) were fixed in round 22 stage 3.

## Not this round (so they aren't lost)
- Canvas editing (add/move/resize cards, then arrows, groups and editing note cards), then Bases (`.base` table views from properties), each over several rounds.
- Pasted images/files as attachments; `#`/`^` heading and block suggestions; explorer-to-note link dragging; explorer multi-select.
- Explorer details (#20 rest), new-tab page (#21), focus/keyboard leftovers (#22 rest), small visual differences (#23), quick switcher listing attachments (#19 rest).

## Guardrails
- The smallest change that works; reuse existing code (Reading renderer, tabs, view header, tooltip helper, menus); delete dead code you find on the way. Any new dependency needs a written reason (prefer none; no canvas or graph libraries). Files stay under about 800 lines.
- Typing on the 5,000-line Big note and inside a 40-row table must be no slower than now. Nothing new on the per-keystroke path.
- **Geometry.** Keep the permanent geometry suite (`scripts/test-geometry.mjs`) passing. Never space lines or widgets inside `.cm-content` with vertical margins (use padding): every direct child of `.cm-content` must keep zero vertical margin, and every rendered line's CodeMirror top must stay within 1px of its DOM top. Fold arrows must stay visible after stationary fold and unfold clicks.
- **No prompt, menu or tooltip animations.** Ctrl+O, Ctrl+P and right-click menus must keep opening within two frames with no frame over 20ms in the first 300ms. Canvas zoom may be instant; don't add easing Obsidian doesn't have.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed or link-card previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look and feel is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri or Obsidian run happens only on a private Xvfb display with scratch `HOME`/`XDG_*` folders.
- Commit locally only. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- A canvas made in Obsidian opens in Grove looking the same, and a file Grove opened is byte-identical afterwards. `rebuild/ROUND23_NOTES.md` has the notes, screenshots and line counts.
