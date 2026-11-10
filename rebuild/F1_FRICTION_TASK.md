# F1: Friction hunt in everyday flows (look and feel, speed, focus)

Chosen on 10 Nov 2026 under Chris's standing direction (9 Nov 2026): keep Grove moving without asking him, and put core features, speed, responsiveness, a seamless feel and look/feel polish ahead of new features. Small annoyances drive people away. Build this on `rebuild/g1-claude` from the brief commit on `rebuild/integration`. Claude builds; Codex reviews independently, read-only. Commit locally. Never push.

## In plain words

Grove has every feature Chris needs to leave Cinder. What decides whether he enjoys it is the dozens of small moments in a normal day: opening a note, typing, switching and closing tabs, searching, using the sidebars, the quick switcher and the command palette. A 40 ms freeze, a caret that lands in the wrong place, a panel that flashes empty, or one extra click is each small, but together they make an app feel cheap.

This task finds those moments, measures them, and fixes the worst ones. No new features.

## Phase 1: hunt and measure (do this first, before changing product code)

Drive each flow below in headless Chromium against the mock's `?synthetic=5000` vault, with real key and mouse input through `scripts/browser.mjs` (the same way `scripts/test-feel.mjs` does). For each flow record:

- **Lag:** time from the input to the result painted, long tasks (> 50 ms), frame gaps (p95, max), Event Timing entries over 16 ms.
- **Focus:** where `document.activeElement` is afterwards, and whether the caret and selection are where a user expects (for example, back in the editor at the same spot after closing a modal or returning to a tab).
- **Flicker:** whether the editor, tab strip, sidebars or a pane remount, flash an empty state, or shift layout during the action (a `MutationObserver` on the main containers, plus checking for empty-state elements between frames).
- **Extra steps:** keystrokes or clicks needed, compared with `rebuild/OBSIDIAN_FEEL_SPEC.md` and the Obsidian behaviour Grove already copies.
- **Stale display:** anything that shows old content (title, breadcrumb, backlinks count, word count, tab label, file-tree selection) after the action finishes.

Flows (everyday use only):

1. Open a note: single click in the file tree, a `[[link]]` click in the editor, back/forward (buttons and shortcuts), opening in a new tab (Ctrl/middle click).
2. Typing: plain typing mid-document in a long note (the 5,000-line "Big note"), Enter on list items, `[[` suggester open/choose/Esc, undo/redo, the autosave and the link/backlink refresh after it.
3. Tabs: new tab, Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+W, reopen closed tab if it exists, clicking between tabs. Scroll position and caret must come back on return.
4. Search: open the search pane, type a query, results updating while typing, click a result (does it open at the match with the match visible?), clearing the query.
5. Sidebars: toggle left and right sidebars, switch sidebar tabs (Files, Search, Bookmarks, Backlinks, Outline, Tags), resize, collapse/expand folders, reveal the active file.
6. Quick switcher (Ctrl+O) and command palette (Ctrl+P): time to open, each keystroke, Enter, Ctrl+Enter, Esc, and where focus goes afterwards.
7. New note (Ctrl+N) and rename from the inline title: is the title focused and selected, does Enter move into the body, does the tree and tab label update without a flash.
8. Splits: split right, move focus between panes, close a split.

Also run the same script once at `?synthetic=20000` and record it, report-only (do not add the 20k run to `npm test`).

Put the findings in a table in the notes (flow, what a user feels, measured number, cause, fix or reason not fixed), ranked by how often a user hits it times how bad it feels.

## Phase 2: fix the worst ones

- Fix the top findings, in rank order. Aim for about 6–10 fixes. If time runs short, fix fewer well rather than many halfway.
- Every fix gets a regression assertion in the friction script (or an existing test), which fails before the fix and passes after (check this).
- Only friction in the flows above. If a finding belongs to a planned perf piece (P2 quiet saves, P4 graph, P5 search in Rust, P6 file-tree virtualization, P8 switcher cache) or needs Rust, measure and record it with the piece it belongs to, and do not build that piece here.

## Budgets

From `rebuild/RUST_PERF_PLAN.md` §1, at 5k:

- Keystroke to paint ≤ 16 ms, 0 frames over 20 ms across typing, including the save and refresh that follow.
- Note switch, tab switch, back/forward ≤ 50 ms to the note painted; backlinks count ≤ 100 ms.
- Quick switcher and command palette: ≤ 50 ms to results, ≤ 16 ms of JS per keystroke; opening feels instant (< ~100 ms).
- Search as you type ≤ 100 ms from the last keystroke to results painted.
- No main-thread block over 50 ms in any flow.
- Focus and caret always land where the user expects; no empty-state flash; no stale label after the action.

The existing P0 `scripts/test-feel.mjs` budgets stay enforced, with the graph still a reported known gap unless `GROVE_FEEL_STRICT_GRAPH=1`. Do not weaken any assertion.

## Requirements

1. One friction script, `rebuild/app/scripts/test-friction.mjs`, reusing `scripts/browser.mjs` helpers (and test-feel's measuring code where it can be shared without making either file messy). Add it to `npm test` at 5k. It must take `GROVE_FEEL_N` like `test-feel.mjs` does. Keep it under ~500 lines.
2. Fixes for the top findings, each with a regression assertion.
3. No new setting, command, prompt or visible feature. Behaviour changes only where the current behaviour is friction (wrong focus, flash, lag, extra step, stale label), and then toward what `OBSIDIAN_FEEL_SPEC.md` describes.
4. Look/feel: if a flow shows a visual glitch (misaligned row, jumping width, wrong hover state, theme colour missing), it counts as a finding too, but keep fixes small.

## Hard rules

- Work only under `rebuild/app/` TypeScript, CSS, scripts and tests, plus this brief's notes. Do not edit Cinder at the repo root (`ui/`, `src/`). It is reference only.
- Do not edit `rebuild/app/src-tauri/` (Rust). If a finding needs Rust, record it for later.
- No new crates or npm packages. No new dependency without a written reason, and this task should not need one.
- No Obsidian or Excalidraw code, assets, or fetched pages.
- No network. `npm run audit:offline` must stay green.
- No app or GUI windows. Do not start Grove, Tauri, or a visible browser. Headless Chromium only.
- Test and bench vaults only under `/tmp`. Never touch real vaults: `~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`. Leave `/tmp/grove-playground` and `~/grove-compare-vault` alone.
- `flock /tmp/grove-npm-test.lock npm test` (including `posttest`), `npm run build`, and `npm run audit:offline` must pass. `cargo test --offline` only if Rust changed, which it should not.
- Restore any screenshots the suite rewrites before committing.
- Commit locally on `rebuild/g1-claude`. Never push. Never force-push. Do not commit prompt files (`.x-*.txt`).
- Do not buy credits or change tool/user config.

## Size discipline

- The smallest change that removes each annoyance. Reuse and extend existing modules (`workspace.ts`, `tabs.ts`, `shell/pane.ts`, `shell/sidebar.ts`, `shell/quickSwitcher.ts`, `shell/searchView.ts`, `shell/prompt.ts`, `listeners.ts`, styles) before writing new ones.
- Delete code your changes make dead.
- No new dependency without a written reason.
- Keep every file under ~800 lines; if a touched file would cross that, split it by responsibility first (`workspace.ts` is already ~700).
- App code (TS + CSS) net change should stay under about +300 lines; explain anything over that. The friction script is extra and should stay under ~500 lines.

## Scope

**In scope:** the everyday flows listed above, their code in `rebuild/app/src/` (workspace, tabs, pane, sidebars, search view, quick switcher, command palette, prompts, editor setup and Live Preview only where a typing finding points there), styles, the new friction script and tests.

**Out of scope:** new features; Bases, canvas, drawing, web embeds and presentations internals (unless an everyday flow above breaks in them); P2–P8 perf pieces; Rust; changing P0 feel budgets, including the held graph gap; opening or measuring the real app window.

## Done when

- Phase 1 findings table is in the notes, with numbers at 5k and the report-only 20k run.
- The top findings are fixed, each with a regression assertion that fails before and passes after.
- `scripts/test-friction.mjs` runs in `npm test` at 5k and passes; `test-feel.mjs` still passes at 5k.
- `flock /tmp/grove-npm-test.lock npm test`, `npm run build`, and `npm run audit:offline` pass. No assertion was weakened.
- Worktree is committed locally, clean except untracked prompt files, and not pushed.

## Notes file

Write `rebuild/NOTES_F1-claude.md` before you finish, and commit it with the code. Include:

- In plain words: what a user will feel differently, flow by flow.
- The findings table (fixed and not fixed), with before/after numbers.
- Focus, flicker, extra-step and stale-display checks: what you checked, what you could only reason about without a real window (WebKitGTK), and what you ruled out.
- Anything recorded for P2, P4, P5, P6, P8 or Rust, without doing that work.
- Net line change by language and by file; any file near 800 lines; any new dependency (should be none).
