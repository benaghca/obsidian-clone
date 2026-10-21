# Task: Round 10, properties and search, the way Obsidian has them

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/POLISH_GAPS_NOTES.md` (round 9, as merged), `rebuild/GRAPH_NOTES.md` and `rebuild/CLEANUP_NOTES.md` first.

You are one of three agents given this same task in separate worktrees. Work only in yours.

## The problem
Round 9 gave Grove Obsidian's Properties block, Open in new window and Export to PDF. It is now 22,958 lines (TS 16,685 incl. 1,445 test lines, CSS 3,144, Rust 3,129), no file over ~745 lines. Side by side with Obsidian 1.14.4 the gaps the owner meets first are now about **metadata and finding things**: the Properties block can't change a property's type or suggest names and values, the status bar and word count ignore properties, Search only knows plain words and `path:`, there is no "All properties" view, and links to missing notes look like ordinary links. This is a feature round (round 11 will be cleanup): build these on the modules that already exist, with the smallest change that matches Obsidian.

## Requirements
Do them in this order. If time runs short, finish and polish fewer items rather than half-building all of them. Check each against Obsidian by observation (see the rules below), not from memory.

1. **Finish Properties in document** (`editor/frontmatter.ts`, `editor/properties.ts`):
   - **Type menu:** clicking a row's type icon opens Obsidian's menu (Property type → Text, List, Number, Checkbox, Date, Date & time; plus the other items Obsidian shows there, such as Cut / Copy / Paste / Remove, where they make sense). Changing the type rewrites only that property's value, safely; if the value can't be converted, follow what Obsidian does.
   - **Suggestions:** typing a property name suggests the vault's existing names (with their type icon); typing a value suggests existing values for that name, and vault tags for `tags`. Reuse the existing suggestion popup / `[[` suggester styling and the backend data you already have (frontmatter reading or `search`); add a backend command only if that is clearly smaller and faster, and document it in `CONTRACT.md`.
   - **Status bar and counts:** the "N properties" item Obsidian shows in the status bar, and word / character counts that leave the frontmatter out, as Obsidian's do.
   - **YAML safety (from Codex's round 9 version):** a value with a trailing `# comment`, numbers YAML would read differently from how they are written (`012`, `1e3`, `.5`, `0x1F`), and a `...` closing line must either round-trip unchanged or be shown read-only, never silently rewritten. Add tests for each.
   - **Export to PDF:** print the Properties block the way Obsidian's export does (observe whether it is included by default; Grok's round 9 version printed it as rows).
2. **Search operators**, as Obsidian's Search has them: `tag:`, `file:`, `path:` (exists), `line:` if cheap, `[property]` and `[property:value]`, quoted phrases, `-` to exclude, and `OR`. **Reuse `graph/query.ts`** (the graph's filter and colour groups already parse `tag:`, `file:`, `path:`) rather than writing a second parser; move it to a shared place if needed and keep the graph's tests passing. Results, highlighting, the search options and "Search in folder" must keep working. Typing in the search box must stay responsive on the mock vault plus `?synthetic=1000`.
3. **All properties view** (Obsidian's core plugin "Properties view"): a sidebar view listing every property name in the vault with its type icon and count, sortable as Obsidian's is, opened from the command palette and the sidebar like the Tags view. Clicking a name runs the `[name]` search from item 2. It is a core plugin that can be turned off in Settings → Core plugins. Build it on `shell/sideView.ts` and the Tags view's patterns.
4. **Links to missing notes look unresolved**, in Live Preview and Reading view, as in Obsidian (observe its colour/opacity, light and dark). Clicking still creates the note as now. Keep it cheap: no extra scan per keystroke beyond what link rendering already does.
5. **Window menu items (only inside the round 9 lockdown):** "Move to new window" in the tab menu (the tab leaves this window and opens in a note window) and the palette commands Obsidian has for it ("Move current tab to new window", "Open current tab in new window" exists). Reuse `open_note_window`; **no new permission, capability or CSP change**. If an item needs more, skip it and say why.
6. **If there is time: wheel zoom in the Tauri window.** Round 9 left wheel zoom around 100% at p95 21–22 ms on Xvfb with ~1,000 nodes (pan is 17–18 ms). Target p95 under 20 ms without undoing any graph fix (whole-pixel canvas, one-device-pixel HiDPI links, low resolution only when full resolution can't keep up, every-other-frame settle, typing yield, nine-slice shadow). Report before/after numbers measured on a private display.

## Hard performance rules
- Typing on the 5,000-line Big note and note switching must be no slower than now; measure before and after (headless Chromium, mock vault) and report.
- Nothing new runs on every keystroke in the note body: properties, counts and link styling read only the frontmatter lines or what the existing decorations already visit.
- Search parses the query once per change, not per file; vault-wide property data is built lazily (when the view, a suggestion or a search needs it) and updated incrementally from `vault-changed`, never by rescanning the vault per keystroke.
- Graph open, pan and zoom must not regress.

## Size discipline (owner's rule; round 8's shape must survive)
- Smallest change that does the job. Reuse existing modules, helpers, tokens and icons (`editor/frontmatter.ts`, `editor/properties.ts`, `graph/query.ts`, `shell/sideView.ts`, the Tags view, `listeners.ts`, `storage.ts`, `paths.ts`, settings `row()`, menus, the suggester) before writing new ones.
- Delete dead code you make or find along the way (for example a second query parser).
- **No new dependency** without a written reason in the notes (what it does, its size, why our own code would be worse). A YAML parser counts.
- No file over ~800 lines. If a file you touch would cross that, split it first.
- Report the net line change by TS (app and tests), CSS and Rust. A feature round will grow the code: keep the total under about **+1,500 lines**, and explain any item that cost more than ~400.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote embed previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look is recreated **by observation** with bundled Lucide icons and Obsidian-like menus; never copy Obsidian's code, CSS or assets, and don't read them out of `obsidian.asar` either. Subtle forest-teal accent.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run (item 5's window, item 6's numbers) happens only on a private virtual display (for example `Xvfb :99`) with scratch `HOME`/`XDG_*` folders, and is closed when done. If that is impossible, say so and give Chromium numbers plus your reasoning.
- If you observe Obsidian, run it isolated (no network, e.g. `unshare -rn`), on a private virtual display or headless, with a scratch `HOME` and throwaway vaults. Never touch `~/.config/obsidian`.
- Commit locally only, in small commits with clear messages. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- Each item above is either done (with tests where it has logic: type conversion, YAML safety cases, suggestion data, the search query parser and matcher, the properties index) or explicitly skipped with a reason.
- A note with frontmatter opens, edits and saves correctly in Live Preview, Reading view and Source mode (check it in the browser, not only in unit tests).
- Typing on the 5,000-line Big note and note switching are no slower than now.
- Finish by writing `rebuild/PROPERTIES_SEARCH_NOTES.md`:
  - per item, what you built, how it compares with Obsidian (what you observed), and what you skipped and why;
  - before/after line counts for TS (app and tests), CSS and Rust, with the net change for each and in total, measured from `rebuild/app` with
    ```
    for e in ts css rs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
    git ls-files '*.ts' '*.css' '*.rs' | xargs wc -l | sort -rn | head -15
    ```
  - any dependency, permission, capability, command or CSP change, and why;
  - performance before/after (typing, note switch, search typing, graph open, pan/zoom; WebKitGTK numbers if you did item 6).
