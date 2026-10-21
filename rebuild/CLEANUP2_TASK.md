# Task: Round 11, cleanup 2 (smaller, simpler Grove with no visible change)

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md`, `rebuild/CLEANUP_NOTES.md` (round 8, the last cleanup), `rebuild/POLISH_GAPS_NOTES.md` (round 9) and `rebuild/PROPERTIES_SEARCH_NOTES.md` (round 10, as merged) first.

You are one of three agents given this same task in separate worktrees. Work only in yours.

## The problem
The owner's first Obsidian clone grew past 18,000 lines and became hard to change. Grove has a cleanup round after every two feature rounds so that does not happen again. Rounds 9 (polish gaps) and 10 (properties and search) were feature rounds and added about 2,700 lines. Grove is now **24,396 lines** (from the round 10 merge, `rebuild/integration` at the commit that added this brief):

| | Lines |
|---|---|
| TypeScript | 18,003 (16,380 app + 1,623 tests) |
| CSS | 3,191 |
| Rust | 3,202 (tests inline and in `index/tests.rs`) |

The largest files are `src/workspace.ts` (761), `src/shell/pane.ts` (743), `src/graph/view.ts` (733), `src/styles/settings.css` (681), `src/editor/properties.ts` (622), `src/appCommands.ts` (540), `src-tauri/src/index.rs` (538), `src/settings/sections.ts` (534), `src-tauri/src/watch.rs` (522) and `src-tauri/src/vault.rs` (511). None is over 800 yet, but the first three are within ~40–70 lines of it, so the next feature round would push them over.

This round adds **no features**. It makes Grove smaller, easier to read and easier to change, while the app looks and behaves exactly as it does now.

Count lines the same way before and after (tracked files under `rebuild/app`, from `rebuild/app`):

```
for e in ts css rs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
git ls-files '*.ts' '*.css' '*.rs' | grep -v '/gen/' | xargs wc -l | sort -rn | head -15
```

## Requirements
1. **No visible behaviour change.** No new features, settings, defaults, styling, hotkeys, menus, text or file formats (`.grove/*.json` including the new `types.json`, the layout, `graph.json` keys, `core-plugins.json`). If you find a real bug, write it down in the notes; fix it only if the fix is tiny and obviously safe, and say so in its own commit.
2. **Net line count must go down** for the app as a whole (TS + CSS + Rust). Aim for at least 3–5% (roughly 700–1,200 lines) without making code denser or cleverer: fewer, clearer lines, not longer ones. Do not delete tests to get there, and do not reformat or join lines to cheat the count. Round 8 only managed −207; look harder this time, especially at the code rounds 9 and 10 added quickly.
3. **Split the files closest to the limit** so each leaves real headroom (target: no file in `src/` over ~650 lines afterwards), each new module with one job and a short header comment:
   - `src/workspace.ts` (761): it still mixes tabs/groups, note windows and Move to new window, outside-change handling (`onVaultChanged`), link refresh timers and history. Pull out at least one whole concern.
   - `src/shell/pane.ts` (743): separate the tab strip / drag-and-drop overlay from the pane's view hosting.
   - `src/graph/view.ts` (733): keep input/camera/frame loop and drawing apart (round 8 started this with `graph/draw.ts`). Keep every WebKitGTK performance fix exactly as it works now: whole-pixel canvas size, one-device-pixel links on HiDPI, low resolution only when full resolution can't keep up, every-other-frame settle, yielding to typing, the nine-slice panel shadow, and round 10's whole-device-pixel label size.
   - Then `src/editor/properties.ts` (622, it grew +286 in round 10): separate the type menu / clipboard / suggestion wiring from the row widgets if that makes both clearer.
4. **Remove dead code and duplication.** Unused exports, functions, CSS selectors and variables nobody reads, copy-pasted helpers. Round 10 added pieces that likely overlap with older ones; check each pair and merge where one can serve both:
   - `shell/suggest.ts` (the new property/value suggestion popover) vs the `[[` suggester in `editor/wikilinkComplete.ts` and the prompt/palette suggestion rendering (`shell/prompt.ts`, `shell/commandPalette.ts`, `shell/fuzzy.ts`);
   - `shell/propertiesView.ts` vs `shell/tagsView.ts` and the other side views on `shell/sideView.ts` (header buttons, sort menus, filter field, row rendering);
   - `shell/propertyIndex.ts` vs the tag reader in `shell/linksTags.ts` (both keep a lazily-built, incrementally-updated vault index from `vault-changed`);
   - `shell/searchFacts.ts`, `shell/searchQuery.ts` and `shell/searchView.ts` vs `shell/sidebar.ts` and the graph's use of the query (`graph/source.ts`);
   - CSS: `styles/settings.css` (681) and `styles/properties.css` for repeated blocks that should be one rule or a token.
   Check every removal: grep, `tsc --noEmit` (temporarily turning on `noUnusedLocals`/`noUnusedParameters` finds nothing today, so also look for exports used only by their own file and for functions with a single caller that add nothing), and the tests.
5. **Tighten module boundaries.** No import cycles (check, e.g. with a quick script over the imports); the shell, editor, settings and graph talk through the existing workspace events and APIs, not by reaching into each other's internals. Prefer plain functions and small modules over new classes or abstraction layers. No framework, state library or generic "plugin system" to save lines.
6. **Tests.** Keep every existing test passing. Anything you move or merge keeps a test; if a piece you touch has none, add a small one. In particular `shell/propertyIndex.ts` has no test of its own (Grok's round 10 version had one; build-lazily, update-one-note-from-`vault-changed`, and open-editor-wins are the cases), and the search view's result building has none outside the query parser. Tests count toward lines, which is fine.
7. **Dependencies.** Add none. Removing one is welcome if it is truly unused or trivially replaced, and you say why.
8. **Rust too.** `index.rs`, `watch.rs` and `vault.rs` are each over 500 lines; look for duplication (path checks, error mapping, frontmatter slicing shared by `search`, `link_index` and round 10's `frontmatter` command). Keep every command, its permission and `CONTRACT.md` meaning unchanged.

## Hard performance rules
- Typing on the 5,000-line Big note, note switching, opening a note with frontmatter, and search typing on the mock vault plus `?synthetic=1000` must be no slower than now. Graph open, pan and wheel zoom must not regress.
- Nothing may move onto the per-keystroke path: properties, counts and link styling still read only the frontmatter lines or what the existing decorations already visit; the properties index stays lazy and incremental; search still parses the query once per change.
- Measure before and after with headless Chromium on the mock vault (the round 10 notes describe the harness) and report the numbers. No WebKitGTK numbers are needed this round; if you take any, only on a private virtual display (see below).

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images (bundle locally); strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit user click through the system opener; no remote embed previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; extensibility only as built-in features. Minimal, reviewable dependencies.
- Obsidian's look is recreated **by observation** with bundled Lucide icons and Obsidian-like menus; never copy Obsidian's code, CSS or assets, and don't read them out of `obsidian.asar`.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Don't launch `tauri dev` or any window on the owner's display; any Tauri run happens only on a private virtual display (for example `Xvfb :99`) with scratch `HOME`/`XDG_*` folders, and is closed when done.
- Commit locally only, in small commits with clear messages. Do NOT push, do NOT merge into other branches.

## Scope
Everything under `rebuild/app` (front end, styles, `src-tauri`). `CONTRACT.md` must not change in meaning; editing it only to reflect a pure rename is fine.

## Not this round (next feature round), so they aren't lost
Gaps seen side by side with Obsidian 1.14.4 in the round 10 comparison. Do **not** build these now; they are listed so the next feature brief can pick them up:
- Search pane: match-case toggle (`Aa`) and the sort menu (file name, modified time, created time); the result count counts files where Obsidian counts matches ("5 results" for one note); long result lines are cut with "…" where Obsidian wraps them; no collapse chevron per result file; "show more context"; regex, `section:`, `block:`, `task:`; more than five lines per note.
- Properties: the "N properties" status item isn't clickable (Obsidian opens a File properties view); Rename and Delete property in the All properties menu; a name picked from suggestions should take its vault-wide type; tag-field suggestions to double-check by hand.
- Word count differs slightly from Obsidian's on the same note (16 vs 18 words on a note with `#x` and two wikilinks).
- Graph wheel zoom p95 sits at the 20 ms edge on Xvfb; link stroking is the remaining cost.
- Obsidian's tab menu also has "Link with tab…".

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass.
- No file in `src/` is over ~650 lines, and `workspace.ts`, `shell/pane.ts` and `graph/view.ts` are split as above.
- The net line count (TS + CSS + Rust) is lower than at the commit that added this brief, measured with the commands above, without dropping tests.
- The app looks and behaves the same: a headless before/after screenshot check of the editor (a note with frontmatter in Live Preview, Reading and Source), the Properties type menu, the search pane with an operator query, the All properties view, the file tree, the settings modal and the graph view shows no difference.
- Work is committed on your branch in small, reviewable commits (one kind of change per commit, e.g. "Split workspace.ts: outside changes", "One suggestion popover for properties and links").
- Finish by writing `rebuild/CLEANUP2_NOTES.md`:
  - a before/after table of lines for TS (app and tests separately), CSS and Rust, with the net change for each and in total, and the 15 largest files before and after;
  - the new module map: each file you created, split or merged, what it owns, and its line count;
  - what you removed as dead or duplicated, and how you checked it was unused;
  - any bug you found (fixed or not), any dependency change, and performance before/after;
  - anything you chose not to simplify and why.
