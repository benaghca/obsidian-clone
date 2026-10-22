# Task: Round 16, cleanup 4 plus the owner's hands-on fixes (fold arrow, mouse and selection feel)

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/CLEANUP3_NOTES.md` (round 14, the last cleanup) and `rebuild/ROUND15_BLOCKS_SEARCH_NOTES.md` (round 15, as merged, including the comparison at the end) first.

**This round is a relay, not a race.** You (Claude) are the only builder. When you finish, a reviewer will trim your branch and a bug hunter will test it, and confirmed bugs come back to you to fix. Work only in your worktree. Commit locally, never push. Test headlessly. Never open app windows on this screen.

## The problem
Grove has a cleanup round after every two feature rounds so it never grows back into the hard-to-change app the owner had before. Rounds 15 added about 770 lines; Grove is now **27,416 lines** (TS 20,728 of which 2,165 tests, CSS 3,573, Rust 3,115). The largest files are `src/workspace.ts` (646), `src/styles/settings.css` (629), `src/shell/pane.ts` (620), `src/graph/view.ts` (609), `src-tauri/src/index.rs` (559), `src-tauri/src/vault.rs` (552), `src/appCommands.ts` (529), `src/editor/livePreview.ts` (528), `src/editor/properties.ts` (523) and `src/shell/menus.ts` (515).

The owner also used Grove by hand and found that headings can't be folded and that hovering and selecting text "feels off" next to Obsidian. Those fixes come first this round; they are the only visible changes allowed.

Count lines the same way as round 14 (from `rebuild/app`):
```
for e in ts css rs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
git ls-files '*.ts' '*.css' '*.rs' | grep -v '/gen/' | xargs wc -l | sort -rn | head -15
```

## Part A: the owner's fixes (do these first, each in its own commits)
1. **Heading fold arrow disappears.** The chevron beside a heading vanishes as the pointer moves toward it, so headings can't be folded. Hunch to verify: in `src/editor/fold.ts` (`hoverChevron`) the chevron sits outside `view.dom` because the editor has no left gutter, so `mouseleave` hides it. Fix it the smallest way, for example a left gutter area inside `view.dom` like Obsidian's, or tracking the pointer on `.view-content`. The arrow must stay visible while the pointer crosses to it, and clicking it must fold and unfold, in Live Preview and Source mode (and Reading view if Grove folds there).
2. **No markup reveal while the mouse button is down.** In `src/editor/livePreview.ts`, `build()` reacts to every selection change, including pointer drags, so `**`, `*`, `[[ ]]` and link URLs appear and disappear mid-drag, the text jumps sideways and the selection flickers. Obsidian keeps the reveal set frozen between mousedown and mouseup and updates it on mouseup. Do the same.
3. **Double-click on a bold word** must select the word, as in Obsidian. Today it selects only `**` because the first click reveals the markup and shifts the word; item 2 should fix it, so check it.
4. **Selection should look like Obsidian's:** the native browser selection hugging the text, not CodeMirror's drawn blocks. Today every wrapped line except the last fills to the right edge, blank lines become full-width bars, and list bullets get highlighted. In `src/editor/editor.ts`, use a styled `::selection` (as light as Obsidian's) and drop `drawSelection` or hide `.cm-selectionLayer`/`.cm-cursorLayer`; keep a drawn layer only if multiple cursors need it. Bullets stay unhighlighted.
5. **Text cursor only over text.** `src/styles/noteView.css` sets `cursor: text` on `.view-content` (about line 49) and `.inline-title` (about line 94). Obsidian shows the normal arrow over the margins, the gutter, the empty space below the document and Reading view's blank space. Match it.
6. **Spacing and text rendering, as measured in Obsidian 1.14.4 (light theme, same note):**
   - List lines are 26.4px tall: 24px line height plus 1.2px padding top and bottom (Grove: 24px, no padding).
   - The H1 line in Obsidian is 25.888px bold with a 1.2 line height (31.07px) and 16px top padding (Grove: 28px, 36.4px line height, 8.4px top padding). Measure H2–H6 in Obsidian yourself and match them.
   - The text column is 680px wide (Grove: 700px).
   - Drop `-webkit-font-smoothing: antialiased` in `src/styles/base.css` (about line 19); Obsidian uses the default.

**Test Part A with real mouse input**, not scripted `.click()` calls: move the pointer over the heading and onto the chevron, then click; drag-select across bold text, a link and a wrapped paragraph; double-click a bold word; hover the margins and below the document and read the computed cursor. Do this side by side with Obsidian (the test vault and Obsidian build in your notes harness), in headless Chromium, and in WebKitGTK if you can (Tauri on a private Xvfb display with a scratch HOME). Put before/after screenshots beside Obsidian's in the notes.

## Part B: cleanup (no visible change beyond Part A)
1. **No other visible change.** No new features, settings, defaults, hotkeys, menus, text or file formats, and the Markdown Grove writes stays byte for byte the same. If you find a real bug, write it down; fix it only if the fix is tiny and obviously safe, in its own commit.
2. **Net line count must go down** for the app as a whole (TS + CSS + Rust) even after Part A: aim for 3% (about 800 lines) with fewer, clearer lines, not denser ones. Do not delete tests or join lines to cheat the count.
3. **Round 15's code first:** the image menu, code indent guides, search sort/match case/counts, File properties and property rename/delete, and Link with tab. Look for duplication with existing menu, render, search and property code.
4. **Win back search typing.** Round 15 made search typing about 3 ms slower (the occurrence total walks every returned line). Codex's round 15 branch counted lazily, only for the rendered results, at idle, and was faster than before. Measure first, keep the same visible counts and labels, and keep it only if the search code gets no bigger.
5. **Headroom:** no file in `src/` over ~650 lines afterwards. Keep every WebKitGTK graph performance fix exactly as it works now.
6. **Dead code and duplication everywhere else too:** unused exports, functions, CSS selectors and variables, copy-pasted helpers. Check every removal (grep, `tsc --noEmit`, the tests). No import cycles. Plain functions and small modules, no new frameworks or abstraction layers.
7. **Rust:** `index.rs` and `vault.rs` are about 550 lines each; look for duplication (path checks, error mapping, frontmatter slicing). Keep every command, permission and `CONTRACT.md` meaning unchanged.
8. **Tests and dependencies:** keep every test passing, add small tests for Part A (reveal frozen during a drag, chevron hover area, the cursor rule). Add no dependency.

## Hard performance rules
- Typing on the 5,000-line Big note, inside a 300-line code block and inside a 40-row table, note switching, opening a note with frontmatter, and search typing on the mock vault plus `?synthetic=1000` must be no slower than now. Graph open, pan and wheel zoom must not regress. Part A must not add work on the per-keystroke path.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets, and don't read them out of `obsidian.asar`.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly. Any Tauri run happens only on a private virtual display with scratch `HOME`/`XDG_*` folders, and is closed when done.
- Commit locally only, in small commits with clear messages. Do NOT push, do NOT merge into other branches.

## Not this round (round 17, the next feature round), so they aren't lost
- **First item of round 17:** tables stay drawn as a table when clicked, and each cell's text is edited in place without the raw pipe syntax showing, as in Obsidian (the owner's request).
- The image menu's Swap file picker starts on all vault images (Obsidian starts on recent files); "Bookmark" without the ellipsis.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- Part A items 1–6 are done and shown beside Obsidian with real-mouse checks.
- The net line count is lower than at the commit that added this brief, and no file in `src/` is over ~650 lines.
- Apart from Part A, a headless before/after screenshot check shows no difference on a note with highlighted code, a table (and its menu), an image (and its menu), a note embed with tasks, callouts, the file tree, settings, the search pane with counts, and the graph view.
- Finish by writing `rebuild/CLEANUP4_NOTES.md`: Part A as observed and fixed (with screenshots), a before/after line table for TS (app and tests), CSS and Rust with the net change, the 15 largest files before and after, the module map of anything created, split or merged, what was removed and how you checked, bugs found, performance before/after, and anything you chose not to simplify.
