# Task: Round 20, drag and drop in the file explorer, then three small fixes

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/ROUND19_NOTES.md` and `rebuild/ROUND19_FIXES.md` (round 19, as merged) first.

**Who builds.** Claude is out on its weekly limit until Oct 27, so you (Codex) are the builder. A bug hunter (Grok) will test your branch afterwards and confirmed bugs come back to you. Keep changes small: reuse what exists, delete what you replace, no new abstractions. Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**Your usage limit is tight, so the round is in two parts. Do Part A only, write its notes, commit, and stop.** Part B comes as a separate message in the same session.

Grove is now **29,010 lines** (TS 22,230 of which 2,969 tests, CSS 3,676, Rust 3,104), up 345 in round 19 (same convention as before: tracked `*.ts`, `*.css`, `*.rs` under `rebuild/app`, excluding `/gen/`; scripts `*.mjs` and JSON are reported separately). Count lines from `rebuild/app` with:
```
for e in ts css rs mjs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## Part A: drag files and folders in the file explorer (ANNOYANCES #6; Grok's round 17 and 18 suggestion #1)
Today nothing happens when you drag a row in the explorer; the only way to move is right-click → Move file to…. Obsidian 1.14.4 was observed on Oct 22 2026 (real drags in its file explorer, notes below). Match what it does:

1. **Start.** Pressing a file or folder row and moving about 5px starts a drag (reuse `THRESHOLD` and the ghost from `src/shell/tabDrag.ts`, and `dragPointer` from `src/shell/dom.ts`; use pointer events, not HTML5 drag and drop, so Tauri's file-drop handler never sees it and CDP mouse events drive it). A plain click still opens/toggles as now and shows no ghost. The dragged row gets an `is-being-dragged` look (Obsidian fills it with the accent colour).
2. **Ghost.** Obsidian shows a small dark rounded box beside the pointer: line 1 the file icon and name (no `.md`), line 2 `Move into “FolderB”` (the vault's name when the target is the root). Reuse the tab-drag ghost and add the second line.
3. **Target and highlight.** Over a folder row the target is that folder; over a file row the target is that file's parent folder; over empty space below the tree (or a root-level file) the target is the vault root. The target gets `is-being-dragged-over`: in Obsidian the whole folder item (its title and its open children) is tinted with a light accent background and its title turns accent; for the root the whole `.nav-files-container` is tinted. Only one target is lit at a time.
4. **Drop.** Moves with the existing `moveFile()` in `src/fileOps.ts`, so open tabs, editors and their undo history follow as on rename. Dropping on the item's current parent is a silent no-op (Obsidian lights it, then does nothing and shows no notice).
5. **Can't drop a folder into itself.** Over the dragged folder or anything inside it, nothing is lit and the ghost shows only the name (no "Move into" line); a drop there does nothing. Also guard `moveFile()`/`relocate()` itself with `isUnder` so no caller can do it.
6. **Name collisions.** Obsidian moved `FolderA/A1.md` into a `FolderB` that already had `A1.md` as `FolderB/A1 1.md`, with no error. Do the same with the existing `freeName(…, numbered)` in `fileOps.ts` (same rule for folders; say in the notes if you could not confirm folders).
7. **Links.** Reuse the rename path (`fileSettings.renamed` → `updateLinks`) unchanged. Obsidian then asked "Update links — Do you want to update internal links that link to this file? This will affect 2 links in 1 file." (Always update / Just once / Do not update) and after "Just once" showed "Updated 1 link in 1 file."; `[[FolderA/Uniq]]` became `[[Uniq]]` once the name was unique (shortest-path style). Grove's existing "Update links?" dialog and setting are fine as they are; just check a move takes that path and gives the same text result.
8. **Auto-expand.** Hovering a collapsed folder for about **750ms** (measured: 760ms in both of two tries) expands it with the existing `toggleFolder`; leaving it earlier cancels the timer. A folder opened this way stays open after the drag ends or is cancelled.
9. **Auto-scroll.** Within about 40px of the top or bottom edge of the explorer list it scrolls, faster nearer the edge (measured roughly 200px/s at 40px, 500px/s at 25px, 1,600px/s at 10px). One `requestAnimationFrame` loop while the pointer is in the zone; nothing runs when it is not.
10. **Cancel.** Escape cancels: ghost and highlight go, nothing moves, focus returns where it was. `pointercancel` and window blur cancel the same way. No drag state outlives the drag (no leftover listeners or classes).
11. **Undo-safe.** File moves are not undoable in Obsidian; don't add a file-move undo. But a move must not break the undo history of an open note (Ctrl+Z in a moved, open note still undoes its last edit), and link rewrites stay undoable as they are now.
12. **No animation on open.** The ghost and highlight appear on the frame the pointer crosses the threshold/target; no fade or scale. A short background transition on the highlight is fine only if it matches the existing tree hover transition.

Tests (in `npm test`): unit tests for target choice (folder, file → parent, root, self/descendant refused, own parent no-op), collision naming and the `moveFile` guard; and a browser suite (extend `scripts/browser.mjs`, e.g. `scripts/test-explorer-drag.mjs`) that drives **real pointer input** (`Input.dispatchMouseEvent`: move over the row first, press, move in steps, release) for: file into a collapsed folder (auto-expands after the delay; not before 600ms), folder into a folder, file to root via empty space, folder onto its own child (refused), collision (`A1 1.md`), Escape mid-drag (nothing moves), auto-scroll in a list longer than the pane, and a move of a note that is open with frontmatter in each of Live Preview, Source and Reading (tab follows, title updates, its editor still undoes, and the geometry checks below still hold on it). Write measured numbers (delay, scroll speeds) in the notes.

Write `rebuild/ROUND20_NOTES.md`: what you built, which existing code you reused, anything deferred and why, test results, and net line change by language (production TS, test TS, CSS, Rust, mjs). Commit and stop.

## Part B: three small fixes (only when asked, after Part A)
Each in its own commit with a test:
1. **Starting to drag a background tab switches to it (ANNOYANCES #17).** Obsidian keeps the pane on the tab you were on while you drag another, and after the drop the source pane still shows it. `src/shell/tabStrip.ts` `onpointerdown` calls `ws.activate(tab)` before `startTabDrag`; activate on a click (pointer up without a drag) instead. Small and in the same drag code as Part A.
2. **Classic grey scrollbars outside Settings on Windows/WebView2 (ANNOYANCES #16).** The owner runs Grove on Windows, where the panes show Chrome's wide grey scrollbars with arrow buttons; Obsidian has thin light thumbs and no buttons. Move the `::-webkit-scrollbar` rules in `src/styles/settings.css` (lines ~46–63) to `base.css` so they apply everywhere, deleting the Settings-only copy (net CSS change near zero).
3. **`npm test` cannot find a browser on Windows.** `scripts/browser.mjs` spawns `chromium` by name, which does not exist on the owner's Windows machine (and many Linux ones), so the new browser suites fail there. Look for the browser in this order: a `GROVE_BROWSER` environment variable, then `chromium`, `chromium-browser`, `google-chrome`, then the standard Chrome and Edge install paths on Windows. If none is found, fail with one clear line saying how to set `GROVE_BROWSER`; never pass silently. No new dependency.

Append Part B to `rebuild/ROUND20_NOTES.md` with final line counts.

## Grok's round 19 suggestions
All three (move list items with their children inside quotes/callouts; keep the preview title and Open icon on screen; make failed renames and list Backspaces undo one step at a time) were the same issues as Grok's round 19 bugs and were already fixed in round 19 stage 3, so none is repeated here.

## Not this round (so they aren't lost)
- Dragging a file from the explorer into a note to insert a link, or onto a tab bar to open it (Obsidian does both): after this round, reusing Part A's drag.
- Multi-select in the explorer and moving several files at once.
- Rich-text paste converted to Markdown (ANNOYANCES #5, Grok's round 18 suggestion #3): next feature round.
- Styled tooltips (#15), link suggester and quick-switcher details (#18, #19), explorer details (#20), new-tab page (#21), focus/keyboard leftovers (#22), small visual differences (#23).
- Reading view as a separate preview document (Grok's round 18 suggestion #2): large; only when the spacing gap is worth it.

## Guardrails
- The smallest change that works; reuse existing code (`moveFile`, `freeName`, `updateLinks`, `toggleFolder`/`expandTo`, the tab-drag ghost, `dragPointer`); delete dead code you find on the way. Any new dependency needs a written reason (prefer none). Files stay under about 800 lines (`src/shell/sidebar.ts` is 373; if the drag code is large, put it in its own `src/shell/treeDrag.ts` next to `tabDrag.ts` rather than growing `sidebar.ts`).
- Measure once at drag start and only do arithmetic per frame, as `tabDrag.ts` does. Nothing new on the typing path; typing on the 5,000-line Big note and in a 40-row table must be no slower than now.
- **Geometry.** Keep the permanent geometry suite (`scripts/test-geometry.mjs`) passing. Never space lines or widgets inside `.cm-content` with vertical margins (use padding): every direct child of `.cm-content` must keep zero vertical margin, and every rendered line's CodeMirror top must stay within 1px of its DOM top.
- **No prompt or menu animations.** Ctrl+O, Ctrl+P and right-click menus must keep opening within two frames with no frame over 20ms in the first 300ms.
- **Test with real mouse input**: CDP `Input` events with the pointer moved over each control before pressing, never DOM `.click()`, on notes with frontmatter, in Live Preview, Source and Reading.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; bundle everything locally; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look and feel is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private Xvfb display with scratch `HOME`/`XDG_*` folders.
- Commit locally only. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test` (unit tests, the geometry suite and your new drag suite), `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- Part A's twelve points work with real pointer input, and `rebuild/ROUND20_NOTES.md` has its notes, measurements and line counts.
- At the end of the notes, suggest up to 3 next improvements (one line each: what, why it matters, size).

## Chris-reported bug (Oct 22, 8:39 PM PT) - fix FIRST, before drag and drop, in its own commit
Heading fold arrow disappears after unfold without mouse movement: click a heading's fold arrow to collapse, keep the pointer still, click again to expand. The section expands, but the arrow vanishes until the pointer moves again (the heading line is re-rendered and hover state is lost). Obsidian keeps the arrow visible. Fix so the arrow stays visible under a stationary pointer after both fold and unfold, in Live Preview and Reading, with and without frontmatter. Add a real-pointer regression test (click, click, no mousemove, assert arrow visible).

## Chris-reported (Oct 22, 8:42 PM PT) - tab bar and header look different from Obsidian (fix after the fold-arrow bug, before drag and drop, own commit)
Compare Grove's tab strip and view header with Obsidian side by side (same window size, same note) and match: tab height, tab font family/size/weight (Grove's tab and header text looks larger and in a different face than Obsidian's UI font), active-tab shape/background/radius, close-button size and spacing, the "+" new-tab button, nav arrows, and the breadcrumb/title row (Obsidian shows the note title centered in the header in this layout; Grove shows a "folder / note" breadcrumb). Use the app's bundled UI font consistently in the tab bar and header. Take before/after screenshots beside Obsidian and list measured differences in the round notes. No open animations.
