# Task: Round 30, Bases part 1 (Part A): open a `.base` file as a read-only table

You are working in a git worktree of Grove, a Tauri 2 + Vite + TypeScript + CodeMirror 6 notes app (no React) at `rebuild/app` (Rust in `rebuild/app/src-tauri`). Read `rebuild/OBSIDIAN_FEEL_SPEC.md`, `rebuild/CONTRACT.md` and `rebuild/ROUND29_NOTES.md` first. Look at how a `.canvas` file opens as its own tab type (`src/workspace.ts` `openAttachment`, `src/tabs.ts`, `src/canvas/view.ts`) and how the vault's properties are read (`src/editor/frontmatter.ts`, `src/shell/propertyIndex.ts`): reuse both.

**Who builds.** You (Codex) build round 30. A bug hunter (Grok) tests your branch afterwards and confirmed bugs come back to you. **This round is deliberately small** (your usage budget is a tight 5-hour plan): Part A only, a read-only table view. No editing, no view switcher, no new subsystems beyond the small bases module. Work only in your worktree. Commit locally in small commits, never push, never merge. Test headlessly. Never open app windows on this screen.

**Grok is fixing bugs in parallel on other files** (properties, settings, search, outline/backlinks, editor commands, tab menus, Reading view). Put the new code in a new `src/bases/` folder and `src/styles/bases.css`. Shared files (`workspace.ts`, `tabs.ts`, file explorer, icons) get only the few lines needed to recognise and open `.base` files; say exactly what and why in your notes.

Grove is now **33,263 lines** of TS/CSS/Rust (TS 25,807, CSS 4,142, Rust 3,314; scripts `*.mjs` 6,297), after round 29 merged. Count lines from `rebuild/app` with:
```
for e in ts css rs mjs; do printf "%s " $e; git ls-files "*.$e" | grep -v '/gen/' | xargs cat | wc -l; done
git ls-files '*.test.ts' | xargs cat | wc -l
```

## What Bases are
Obsidian's Bases (core plugin, Obsidian 1.9+) show notes as a database-like table built from their properties (frontmatter). A base is a plain-text **`.base` file in YAML**. Observe Obsidian 1.14.4 yourself first (headless or a private Xvfb display, private HOME/profile, a scratch vault, no network, as in rounds 24 to 29). Work only from observation and the file format, never from Obsidian's code, CSS or assets. The notes below were observed on Obsidian 1.14.4 (default light theme) during the round 29 merge; re-check them.

The observed sample (a folder `BaseTest/` with four notes having `status`, `priority` (number), `due` (date) and `tags`; Obsidian opened it and kept the file byte-for-byte):
```yaml
filters:
  and:
    - file.inFolder("BaseTest")
    - 'status != "done"'
formulas:
  late: 'if(due < today(), "late", "")'
properties:
  note.status:
    displayName: Status
  formula.late:
    displayName: Late
views:
  - type: table
    name: Open tasks
    order:
      - file.name
      - status
      - priority
      - due
      - tags
      - formula.late
    sort:
      - property: priority
        direction: DESC
```
- Top-level keys: `filters` (a boolean tree: `and:` / `or:` / `not:` lists whose leaves are expression strings), `formulas` (name → expression), `properties` (per-property display config such as `displayName`), `views` (a list; each has `type: table`, `name`, optional `filters` (same shape, ANDed with the global ones), `order` (the column list), `sort` (list of `property` + `direction: ASC|DESC`), optional `limit`, and other keys such as column sizes that you must ignore but never lose).
- Property ids: `file.name`, `file.path`, `file.folder`, `file.ext`, `file.mtime`, `file.ctime`, `file.tags`... for file facts, `note.status` or plain `status` for frontmatter properties, `formula.x` for formulas.
- **New base** (command `bases:new-file`) creates `Untitled.base`, first empty and then written as `views:\n  - type: table\n    name: View\n` ; an empty base matches every note and shows one `file name` column.
- Look: tab header shows a toolbar row (view name `Open tasks` with a chevron, `3 results`, then on the right `Sort`, `Group`, `Filter`, `Properties`, `Search`, `New`). The table is below: a header row 30px high with a small type icon then the name (13.125px, muted grey text) per column, sort direction shown on the sorted column; body rows 30px high, cell text 13.125px with 4px 8px padding, thin grid lines; `file name` cells are internal links (accent colour, click opens the note); numbers right-aligned; dates shown with a small calendar glyph; list/tags values as pills; missing values empty. In the sample, `done` notes are filtered out and rows are sorted by priority descending (Task D 5, Task A 3, Task C 2), and the `Late` formula column shows `late` only for Task A. The file explorer shows `.base` files with a `BASE` tag, like `CANVAS`. Reference screenshot from the merge: re-take your own.

## Part A (this round)
1. **Open `.base` files.** The file explorer lists them (with the `BASE` tag as for `CANVAS`), and clicking one, the quick switcher, links and restored tabs open it in a base tab, like canvas tabs. Unknown or invalid YAML shows a short readable error in the tab instead of crashing, and never rewrites the file.
2. **Parse the file** with the smallest YAML reader that handles what Obsidian writes for bases (block maps and lists, plain/single/double-quoted scalars, numbers, booleans, comments). Prefer a small hand-written reader (reuse `frontmatter.ts` helpers where they fit); if you add a dependency instead, give the written reason. Part A is read-only: **never write the `.base` file**. Its bytes must stay identical after opening, scrolling and clicking around.
3. **Show the first view as a table** (if the file has no views, show the default `View` with a `file name` column): the rows are the vault's Markdown notes that match the global and the view's `filters`, the columns follow `order` with `displayName` labels from `properties` (else the property name; `file.name` shows as `file name`), sorted by the view's `sort` (multiple keys, ASC/DESC, numbers numerically, dates by date, text with the app's name collator, empty values last as Obsidian does: check), and capped by `limit`. Show the view name and `N results` in the toolbar row; the other toolbar buttons may appear but do nothing in Part A (or are left out; say which).
4. **Filters for Part A**: `and` / `or` / `not` trees; `file.inFolder("x")`, `file.hasTag("x")`, `file.hasLink("x")`, `file.name`/`file.ext`/`file.folder`/`file.path` comparisons; property comparisons `==`, `!=`, `>`, `>=`, `<`, `<=` against strings, numbers, booleans and dates (`"2026-10-20"`, `today()`), `!`, `&&`, `||` and parentheses; `contains()` on text and lists. Anything not supported (most formula functions, `this`, methods you do not implement) must not crash: treat the expression as unsupported, show nothing for that formula cell, keep the note in or out as Obsidian would where you can tell, and list unsupported expressions in a small notice. Formulas: support only trivial ones if cheap (`if()` and comparison as in the sample); otherwise leave the column blank and say so.
5. **Cells**: render values read-only with the existing property rendering where it fits: links for `file.name` (real click opens the note, Ctrl/Cmd-click in a new tab, as other links), numbers right-aligned, dates/datetimes formatted as the Properties view shows them with the small calendar glyph, lists and tags as pills, checkboxes as a disabled checkbox. Header cells show the property type icon used by the Properties view. Use the vault property index (`propertyIndex.ts`) so the table updates when a matching note's properties change or a note is added/renamed/deleted, without re-reading the whole vault.
6. Keep it fast: a vault of ~1,000 notes opens a base in under ~100ms after the property index is warm; scrolling a 1,000-row table stays under 20ms per frame (simple row virtualisation only if needed).

Not this round (held, list in your next improvements if you like): editing cells, adding/removing columns, Sort/Filter/Properties menus that write the file, column resizing, the views switcher and `cards`/`list` views, Group by, Search, New row, embedding a base in a note (` ```base ` code block and `![[x.base]]`), the full formula language and summaries. Also held from earlier rounds: indexing canvas text and links for search, backlinks and the graph (your round 28 suggestion); the seven disabled Align arrangements (round 29 #1); and the round 29 canvas leftovers below. Do not start them.

Round 29 canvas leftovers found at the merge (held for a later canvas round, not this one): Obsidian's Align left/top align contained cards to the group's inner edge (group x/y + 20px padding) while Grove aligns to the leftmost/topmost card; a colored group's label stays solid color with white text when unselected in Obsidian (Grove: faint tint); a selected colored group's border and ring use the group color in Obsidian (Grove: accent); double-clicking a text card places the caret where you clicked (or at the end below the text) in Obsidian, Grove at the start of the text; Obsidian's Align menu has icons and separators between its five groups; canvas card list bullets are small grey dots in Obsidian.

## Testing
**Test with real mouse input**: CDP `Input` events (or Playwright `page.mouse`) with the pointer moved over the explorer item, the table cells and links before pressing, including repeated clicks without moving, never DOM `.click()`. Add a focused `scripts/test-bases.mjs` (appended to the `npm test` chain in `package.json`) and unit tests for the YAML reader, filter evaluation and sorting. Fixtures: put a few sample notes and `.base` files (including the sample above, an empty base, multiple sort keys, `or`/`not` filters, a `limit`, an unsupported formula and invalid YAML) in the mock vault and check: the rows and their order, the column labels, the result count, link clicks open the note, bytes unchanged after opening. Open the same `.base` files in Obsidian (scratch vault) and confirm the same rows, order and columns (side-by-side screenshot in `rebuild/round30-shots/`). Re-run the editor checks on notes with frontmatter and H1 to H3 headings in Live Preview, Source and Reading, with real mouse hover and clicks (including repeated clicks without moving). Write `rebuild/ROUND30_NOTES.md` with what you observed, each commit, any shared file you touched, line counts, net line change by language (production TS, test TS, CSS, Rust, mjs), and up to 3 next improvements (each with why it matters and roughly how big).

## Guardrails
- The smallest change that works; reuse existing code (tab plumbing, property index and rendering, links, icons, menus); delete dead code you find on the way. Any new dependency needs a written reason in the notes (prefer none). Files stay under about 800 lines.
- **Geometry.** Keep the permanent geometry suite (`scripts/test-geometry.mjs`) and all real-pointer checks passing (Live Preview, Source, Reading; frontmatter; H1 to H3). Never space lines or widgets inside `.cm-content` with vertical margins (use padding): every direct child of `.cm-content` keeps zero vertical margin and every rendered line's CodeMirror top stays within 1px of its DOM top. Fold arrows stay visible after stationary fold and unfold clicks.
- **No prompt, menu, popover or tooltip animations.** Ctrl+O, Ctrl+P, right-click menus and any new menus open within two frames with no frame over 20ms in the first 300ms.
- **File compatibility.** `.base` files stay Obsidian's YAML; Part A never writes them. `.canvas` and `.md` behaviour is unchanged.

## Hard rules (every round)
- **Fully offline.** No network calls, telemetry, crash reporting, update checks or analytics; no remote fonts, scripts, styles or images; strict CSP in `tauri.conf.json` allowing only the app's own origin; external links open only on an explicit click through the system opener; no remote previews. `npm run audit:offline` must pass.
- **No downloadable plugins**; built-in features only. Minimal, reviewable dependencies.
- Obsidian's look and feel is recreated **by observation** with bundled Lucide icons; never copy Obsidian's code, CSS or assets.
- Never open or modify the owner's real vaults (`~/Documents/Programming Learning`, `~/Documents/obsidian-backup-2026-10-19`). Use the mock vault or scratch copies under `/tmp`.
- **No app windows on the owner's screen.** Test headlessly (Vite + headless Chromium). Any Tauri run happens only on a private Xvfb display with scratch `HOME`/`XDG_*` folders.
- Commit locally only. Do NOT push, do NOT merge into other branches.

## Done when
- In `rebuild/app`: `npm run build`, `npm test`, `npm run test:geometry`, `npm run audit:offline` pass; in `rebuild/app/src-tauri`: `cargo build` and `cargo test` pass. `npm test` rewrites screenshot/canvas fixtures: restore the ones you did not mean to change with `git checkout` before committing.
- `.base` files open as read-only tables matching Obsidian's rows, order and columns for the fixtures, the files' bytes never change, and `rebuild/ROUND30_NOTES.md` has its notes, line counts and up to 3 next improvements.
