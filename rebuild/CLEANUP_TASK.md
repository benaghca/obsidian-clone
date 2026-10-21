
# Task: Round 8, cleanup (smaller, simpler Grove with no visible change)

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md` and `rebuild/GRAPH_NOTES.md` first.

## The problem
The owner's first Obsidian clone grew past 18,000 lines and became hard to change. Grove is heading the same way. It was about 18,600 lines after round 6 (`2a35a97`). After the round 7 graph view (merge `ada4ed4`) it is **21,880 lines**:

| | Lines | Files |
|---|---|---|
| TypeScript | 15,687 (14,516 app + 1,171 tests) | 98 |
| CSS | 2,991 | |
| Rust | 3,202 (tests inline) | |

The largest files are `src/workspace.ts` (1,354), `src-tauri/src/index.rs` (1,338), `src/styles/app.css` (1,301), `src/graph/view.ts` (1,009), `src/shell/pane.ts` (771), `src/styles/settings.css` (707) and `src/appCommands.ts` (648).

This round adds **no features**. It makes Grove smaller, easier to read and easier to change, while the app looks and behaves exactly as it does now.

Count lines the same way before and after (tracked files under `rebuild/app`, from `rebuild/app`):

```
for e in ts css rs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.ts' '*.css' '*.rs' | xargs wc -l | sort -rn | head -15
```

## Requirements
1. **No visible behaviour change.** No new features, no new settings, no changed defaults, no restyling, no changed hotkeys, menus, text or file formats (`.grove/*.json`, the layout, `graph.json` keys). If you find a real bug, write it down in the notes; fix it only if the fix is tiny and obviously safe, and say so.
2. **Net line count must go down** for the app as a whole (TS + CSS + Rust). Aim for at least 8–10% (roughly 1,800+ lines) without making code denser or cleverer: fewer, clearer lines, not longer ones. Do not delete tests to get there, and do not reformat to cheat the count.
3. **Split oversized files**, starting with:
   - `src/workspace.ts`: separate the concerns it mixes (tab/pane layout, history, persistence of the layout, view registry, events). Each new module has one job and a short header comment.
   - `src/styles/app.css`: split by area (shell, tabs, sidebars, tree, menus, modals …) in the same way `graph.css` and `settings.css` already stand alone. Keep the cascade order the same so nothing renders differently.
   - `src/graph/view.ts` (over ~800 lines): move canvas drawing into its own module (for example `src/graph/draw.ts`), separate from input handling, camera and the frame loop. Keep every WebKitGTK performance fix from round 7 (whole-pixel canvas size, one-device-pixel links on HiDPI, the low-resolution draw while moving, the nine-slice panel shadow, yielding to typing) exactly as it works now.
   - Then any other file over ~800 lines (`src-tauri/src/index.rs` is the next one; splitting its tests into a `tests` module or its parsers into their own file is fine).
4. **Remove dead code and duplication.** Unused exports, functions, CSS selectors and variables nobody reads, copy-pasted helpers (menus, toggles, sliders, icon buttons, debounce/timer helpers, path/name helpers), repeated CSS blocks that should be one rule or a token. Check every removal: grep, `tsc --noEmit` (consider temporarily turning on `noUnusedLocals`/`noUnusedParameters` to find dead code), and the tests.
5. **Tighten module boundaries.** No import cycles; the shell, editor, settings and graph talk through the existing workspace events and APIs, not by reaching into each other's internals. Prefer plain functions and small modules over new classes or abstraction layers. Don't introduce a framework, a state library or a generic "plugin system" to save lines.
6. **Tests.** Keep every existing test passing. Anything you move or merge keeps a test; if a piece you touch had none, add a small one (tests count toward lines, which is fine).
7. **Dependencies.** Add none. Removing one is welcome if it is truly unused or trivially replaced, and you say why.
8. **Performance must not regress:** typing on the 5,000-line Big note (~10 ms key to frame), note switching, and the graph numbers in `GRAPH_NOTES.md`. Re-measure at least typing and graph open/pan with the same harness approach as round 7 and report before/after.

## Hard rules (unchanged from every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed previews.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look is recreated by observation with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- Do not open GUI windows on the owner's screen: the owner is at this machine. Measure headlessly (Vite dev server + headless Chromium), and do not launch `tauri dev` windows this round.
- Commit locally only. Do NOT push, do NOT merge into other branches.

## Scope
Everything under `rebuild/app` (front end, styles, `src-tauri`). `CONTRACT.md` must not change in meaning; editing it only to reflect a pure rename is fine.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- No file in `src/` is over ~800 lines, and `workspace.ts`, `app.css` and `graph/view.ts` are split as above.
- The net line count is lower than at `ada4ed4`, measured with the commands above.
- The app looks and behaves the same: a quick headless before/after screenshot check of the editor, file tree, settings modal and graph view shows no difference.
- Work is committed on your branch in small, reviewable commits (one kind of change per commit, e.g. "Split workspace.ts: layout persistence", "Remove unused menu helpers").
- Finish by writing `rebuild/CLEANUP_NOTES.md`:
  - a before/after table of lines for TS (app and tests separately), CSS and Rust, with the net change for each and in total, and the 15 largest files before and after;
  - the new module map: each file you created or split, what it owns, and its line count;
  - what you removed as dead or duplicated, and how you checked it was unused;
  - any bug you found (fixed or not), any dependency change, and the performance before/after;
  - anything you chose not to simplify and why.
