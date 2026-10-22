# Task: Round 15, finish blocks and search (Obsidian-feel leftovers)

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/BLOCK_EDITING_NOTES.md` (round 13) and `rebuild/CLEANUP3_NOTES.md` (round 14, as merged, including its "Bugs found" and the comparison at the end) first.

You are one of three agents given this same task in separate worktrees. Work only in yours. Commit locally, never push. Test headlessly. Never open app windows on this screen. Write the round notes file (see "Done when").

## The problem
Rounds 12 and 13 added callouts, tables, embeds, images and code highlighting, and round 14 cleaned them up (Grove is now 26,649 lines). A handful of gaps against Obsidian were deliberately left for this round, plus the search pane's round 10 leftovers. The owner uses Grove at work in place of Obsidian, so these small mismatches are what he notices.

## Goal
Close these gaps so the blocks and the search pane behave like Obsidian, with the smallest change that does it.

## Requirements
1. **Table caret after Tab.** When Tab adds a row, the caret must land inside the new empty cell so typed text goes inside the padded cell, as in Obsidian (round 14 bug 2). Keep the Markdown Grove writes otherwise byte-for-byte the same.
2. **Ticking tasks everywhere.** Tasks inside a callout, and inside a table, inside an embedded note can be ticked and write to the source note, like round 13's embed ticks.
3. **Images.** Observe Obsidian and match: whether the image "Zoom in" button shows in Reading view, and the image right-click menu (its items, order and separators, e.g. Copy image, Reset size, Open in default app, Reveal in navigation), using existing menu code.
4. **Code blocks.** Obsidian's indent guides inside code blocks and its lighter code-block background, in Live Preview and Reading view, both themes. Nothing on the per-keystroke path; highlighting stays visible-range only.
5. **Search pane leftovers (round 10).** Match-case toggle, the sort menu (Obsidian's order and labels), and per-file match counts, matching Obsidian's layout and density.
6. **Properties leftovers.** The "File properties" view (core Properties plugin, as Obsidian shows it) and Rename / Delete property from a property's menu. Rename/delete across the vault must go through existing backend commands where possible; if a new Tauri command is truly needed, document it in `CONTRACT.md` with its permission.
7. **"Link with tab…"** in the tab menu, if Obsidian shows it in this version; otherwise note that it is absent.

Work only from side-by-side observation of Obsidian (the test vault and Obsidian build in your notes harness), never from Obsidian's code or assets. Use bundled Lucide icons.

## Size discipline (every round)
- The smallest change that delivers each item; reuse and extend existing modules (`menus.ts`, `render.ts`, the widget kit, `tableEdit.ts`, search modules) before adding new ones.
- Delete code made dead by your change.
- No new dependency without a written reason in the notes. Expect none.
- No file over ~650 lines in `src/` (split by responsibility if you would cross it).
- Report the net line change by language in the notes. Aim to stay under about +1,200 lines for the whole round.

## Hard performance rules
- Typing on the 5,000-line Big note, inside a 300-line code block and inside a 40-row table, note switching, opening a note with frontmatter, and search typing on the mock vault plus `?synthetic=1000` must be no slower than now (round 14's notes have the numbers and harness). Match counts must not make search typing slower; count lazily or per visible result if needed.
- Graph open, pan and wheel zoom must not regress.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets, and don't read them out of `obsidian.asar`.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private virtual display (for example `Xvfb :99`) with scratch `HOME`/`XDG_*` folders, and is closed when done.
- Commit locally only, in small commits with clear messages. Do NOT push, do NOT merge into other branches.

## Out of scope
Canvas, Mermaid, new core plugins, sync, and anything that needs the network. Round 16 is the next feature round and round 17 is cleanup.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass. New behaviour has small tests.
- Every item in "Requirements" is done or explicitly noted as not applicable, with a headless screenshot of Grove beside Obsidian for items 3–6.
- Finish by writing `rebuild/ROUND15_BLOCKS_SEARCH_NOTES.md`: what you built against Obsidian as observed, anything skipped and why, dependencies (expected none), performance before/after, and a before/after line table for TS (app and tests), CSS and Rust with the net change.
