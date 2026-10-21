# Task: Round 14, cleanup 3 (smaller, simpler Grove with no visible change)

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/CLEANUP2_NOTES.md` (round 11, the last cleanup), `rebuild/EMBEDS_BLOCKS_NOTES.md` (round 12) and `rebuild/BLOCK_EDITING_NOTES.md` (round 13, as merged; read its top section first) first.

You are one of three agents given this same task in separate worktrees. Work only in yours. Commit locally, never push. Test headlessly. Never open app windows on this screen. Write the round notes file (see "Done when").

## The problem
Grove has a cleanup round after every two feature rounds so it never grows into the hard-to-change 18,000-line app the owner had before. Rounds 12 (callouts, tables, embeds, images) and 13 (code highlighting, table editing, image zoom and resize, tasks in embeds, coloured highlights) were feature rounds and added about 2,640 lines. Grove is now **26,890 lines** (`rebuild/integration` at the commit that added this brief):

| | Lines |
|---|---|
| TypeScript | 20,189 (18,161 app + 2,028 tests) |
| CSS | 3,482 |
| Rust | 3,219 |

The largest files are `src/workspace.ts` (676), `src/graph/view.ts` (649), `src/styles/settings.css` (647), `src/shell/pane.ts` (625), `src-tauri/src/vault.rs` (561), `src/editor/livePreview.ts` (547), `src/appCommands.ts` (546), `src-tauri/src/index.rs` (535), `src/editor/properties.ts` (509), `src-tauri/src/watch.rs` (495), `src/settings/sections.ts` (495), `src/main.ts` (473), `src/shell/menus.ts` (471), `src/noteEditors.ts` (465) and `src/styles/editor.css` (421).

This round adds **no features**. It makes Grove smaller, easier to read and easier to change, while the app looks and behaves exactly as it does now.

Count lines the same way before and after (from `rebuild/app`):

```
for e in ts css rs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
git ls-files '*.ts' '*.css' '*.rs' | grep -v '/gen/' | xargs wc -l | sort -rn | head -15
```

## Requirements
1. **No visible behaviour change.** No new features, settings, defaults, styling, hotkeys, menus, text or file formats (`.grove/*.json`, the layout, `graph.json` keys, `core-plugins.json`), and the Markdown Grove writes (table padding, image size suffixes, `==🔴text==`, task ticks) stays byte for byte the same. If you find a real bug, write it down in the notes; fix it only if the fix is tiny and obviously safe, in its own commit.
2. **Net line count must go down** for the app as a whole (TS + CSS + Rust): aim for 3–5% (roughly 800–1,300 lines) with fewer, clearer lines, not denser ones. Do not delete tests to get there, and do not reformat or join lines to cheat the count.
3. **The block code from rounds 12 and 13 first.** It was added quickly across `editor/blocks.ts`, `callouts.ts`, `tables.ts`, `tableEdit.ts`, `embeds.ts`, `render.ts`, `imageZoom.ts`, `codeHighlight.ts`, `embedHost.ts`, `livePreview.ts`, `sourceMode.ts`, `format.ts` and `styles/blocks.css`. Look for:
   - two ways of doing one thing between Live Preview widgets and `render.ts` (Reading view and embeds): block detection, table parsing, callout title/fold handling, image sizing, task-checkbox handling, highlight drawing;
   - table parsing and padding helpers split between `tables.ts` and `tableEdit.ts`;
   - repeated CSS in `blocks.css` and `editor.css` that should be one rule or a token;
   - per-feature listener and lifetime code that `listeners.ts`/`perWorkspace.ts` already covers.
4. **Win back the code-block typing cost, with no visible change.** Round 13 left typing inside a screen-full 300-line code block about 1.5 ms slower per key than before highlighting. Codex's round 13 branch got back to the round-start range by reusing Lezer tree fragments inside the edited block and mapping decorations for edits outside code. Measure first; keep it only if it makes `codeHighlight.ts` no bigger and the colours stay identical.
5. **Keep headroom.** No file in `src/` over ~650 lines afterwards. `workspace.ts` (676) and `graph/view.ts` (649) are the ones to split by what they own; keep every WebKitGTK performance fix in the graph exactly as it works now (whole-pixel canvas size, one-device-pixel links on HiDPI, low resolution only when full resolution can't keep up, every-other-frame settle, yielding to typing, the nine-slice panel shadow, whole-device-pixel label size). `styles/settings.css` (647) should lose repeated blocks rather than be split.
6. **Remove dead code and duplication** everywhere else too: unused exports, functions, CSS selectors and variables nobody reads, copy-pasted helpers. Check every removal (grep, `tsc --noEmit`, exports used only by their own file, single-caller functions that add nothing, and the tests).
7. **Tighten module boundaries.** No import cycles (check with a quick script over the imports). Prefer plain functions and small modules over new classes or abstraction layers. No framework, state library or generic "plugin system" to save lines.
8. **Tests.** Keep every existing test passing. Anything you move or merge keeps a test; if a piece you touch has none, add a small one.
9. **Dependencies.** Add none. Removing one is welcome if it is truly unused or trivially replaced, and you say why. Keep the offline audit allowlist accurate.
10. **Rust too.** `vault.rs`, `index.rs` and `watch.rs` are each around 500 lines; look for duplication (path checks, error mapping, frontmatter slicing). Keep every command, its permission and `CONTRACT.md` meaning unchanged.

## Hard performance rules
- Typing on the 5,000-line Big note, inside a 300-line code block and inside a 40-row table, note switching, opening a note with frontmatter, and search typing on the mock vault plus `?synthetic=1000` must be no slower than now. Graph open, pan and wheel zoom must not regress.
- Nothing may move onto the per-keystroke path. Highlighting stays on the visible ranges and re-parses only the edited block.
- Measure before and after with headless Chromium on the mock vault (round 13's notes describe the harness) and report the numbers.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets, and don't read them out of `obsidian.asar`.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private virtual display (for example `Xvfb :99`) with scratch `HOME`/`XDG_*` folders, and is closed when done.
- Commit locally only, in small commits with clear messages. Do NOT push, do NOT merge into other branches.

## Not this round (round 15, the next feature round), so they aren't lost
Do **not** build these now:
- Image "Zoom in" button is hidden in Reading view (check Obsidian); the image right-click menu (Copy image, Reset size …).
- Obsidian's indent guides inside code blocks and its lighter code-block background.
- Tasks inside a callout or table inside an embedded note can't be ticked; tables are still source-on-touch.
- Round 10 leftovers: search match-case toggle and sort menu, match counts, File properties view, Rename/Delete property, "Link with tab…".

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- No file in `src/` is over ~650 lines.
- The net line count (TS + CSS + Rust) is lower than at the commit that added this brief, measured with the commands above, without dropping tests.
- The app looks and behaves the same: a headless before/after screenshot check shows no difference on a note with highlighted code, a table (and its right-click menu), a local image, a note embed with tasks, callouts and coloured highlights, in Live Preview, Reading and Source, plus the file tree, settings modal, search pane and graph view. The Markdown written by Tab/Enter in a table, a table menu action, an image resize, an embed task tick and a coloured highlight is byte for byte what it was.
- Work is committed in small, reviewable commits (one kind of change per commit).
- Finish by writing `rebuild/CLEANUP3_NOTES.md`:
  - a before/after table of lines for TS (app and tests separately), CSS and Rust, with the net change for each and in total, and the 15 largest files before and after;
  - the new module map: each file you created, split or merged, what it owns, and its line count;
  - what you removed as dead or duplicated, and how you checked it was unused;
  - any bug you found (fixed or not), any dependency change, and performance before/after;
  - anything you chose not to simplify and why.
